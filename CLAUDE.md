# CLAUDE.md — Jeezlord

Persistent shared-world RTS. Read this before editing; see the full roadmap at
`C:\Users\User\.claude\plans\pure-weaving-music.md`.

## Diplomacy (v11) — players start NEUTRAL

- Every player pair has a relation: `neutral` (default) | `ally` | `war`
  (`World.relations`, key `"a:b"` with a<b; `World.relationOf`). Persisted in
  the `diplomacy` table; cleared for a player on defeat restart.
- **Combat only happens at war.** Auto-acquire and commanded attacks both check
  `relationOf === 'war'` (combat.ts `isEnemyOf`/`acquireTarget`; dispatch
  `attack` rejects otherwise). Declaring war is UNILATERAL and open (the other
  side is toasted); peace (war→neutral) and alliances (neutral→ally) need a
  `propose` from one side and a `propose` back (= accept) — one pending offer
  per pair in `World.diploOffers`. Breaking an alliance is unilateral.
- **Allies share vision**: snapshot.ts unions allies' `visibleTileSet`s. Still
  the single anti-cheat enforcement point.
- Wire: `diplomacy` intent; per-player roster (`DeltaMsg.diplo`, every other
  player + relation + offer) diffed client-side for toasts; menu in the
  top-right "🤝 Diplomacy" button (`renderDiplo` in input/commands.ts).

## Military squads, stances & formations (v11)

- Military units are **SQUADS**: one entity = `UnitStat.squad` soldiers sharing
  one hp pool. Damage output scales with men standing (`squadMen`/
  `damageMultiplier` in stats.ts); the client draws one figure per man and hides
  the fallen. Roster: militia/warrior/spearman + catapult (barracks),
  archer/longbowman (archery range), scoutCavalry/knight/horseArcher (stable).
  `bonusVs` gives class counters (spearmen 5x vs cavalry — a hard counter).
  Archer squads volley one visible arrow per man.
- **Stances** per squad (`CombatState.stance`, persisted in `ent_stance`):
  aggressive (long chase leash) / defensive (default) / standGround (engage at
  weapon range only, never move) / noAttack (never auto-engage). `stance`
  intent; owner-only on the wire.
- **Formations**: `move` intents may carry `formation: 'line'|'box'|'loose'`;
  the server spreads destinations (`formationTargets` in dispatch.ts). The
  bottom-centre stance/formation panel appears when squads are selected.

## Trade routes & caravans (v13)

- Markets train `caravan` units (defenceless: `combatOf` returns null for
  attack<=0). Trade is organised as ROUTES: an owned, ordered loop of
  2..`TRADE_ROUTE_MAX_STOPS` (8) market stops (`World.tradeRoutes`, persisted in
  `trade_routes`; caravan assignment — route_id/stop_index/last_stop — in
  `ent_trade`). Assigned caravans cycle the stops; arriving at a FOREIGN stop
  pays `caravanGold(legTiles)` for the leg just travelled; own stops pay
  nothing. **No trading with yourself:** a route with no other player's market
  is rejected/dissolved. Stops must be discovered markets
  (`World.discoveredMarkets` — snapshot.ts gives markets the same AoE fog
  memory as resource nodes) whose owners you aren't at war with; a dead/at-war
  stop is dropped each tick and a route left invalid dissolves, idling its
  caravans (`reconcileRoutes` in trade.ts).
- Wire: `tradeRoute` intent (create/delete/assign); per-player roster
  `DeltaMsg.routes` (owner-only). The `trade` intent (right-click a FOREIGN
  market with caravans selected) is a quick-route: creates/reuses the two-stop
  route [nearest own market → target]. Manual move/stop cancels the assignment.
- Client: the 🤝 modal is TABBED — the **Trade** tab (`renderTrade` in
  input/commands.ts) lists your routes (zoom / assign selected caravans /
  delete), a route-builder draft, and every known market with a "zoom to"
  button.
- `ARRIVE_DIST` is 2 tiles: markets block their 2x2 footprint, so the nearest
  walkable tile centre is ~1.58 tiles from the centre — a smaller radius makes
  a caravan jostled by station traffic bounce forever without ever "arriving".

## Walls, gates & roads (v12, reworked v13)

- **Walls are drag-buildable** (client-side: pointer-down anchors, Bresenham run
  of 1-tile builds on release, filtered by an occupancy-aware `placementValid`)
  and **autotile**: the client picks `wall_<mask>` per segment from the
  same-owner walls/gates on its 4 neighbours (bit 1=N, 2=E, 4=S, 8=W), so runs
  join into one continuous curtain wall. The shared `team_wall` crest overlay
  keeps the owner tint.
- **Gates** are wall segments with a mode (`GateMode`: `locked` | `trade` |
  `open`, default trade = owner + allies + non-enemy caravans pass).
  Pathfinding is mover-aware: `world.isBlockedTileFor(tx, ty, moverId)` consults
  `World.gateTiles`/`gateMode` (+`gatePassable`); `findPath` takes the mover id.
  `gate` intent sets the mode (owner-only); mode is public on the wire
  (`EntityView.gate`); persisted in `ent_building_meta.gate_mode`. The client
  swaps `gate`/`gate_open` textures, rotates the sprite to sit in vertical wall
  runs, and shows mode buttons in the info panel. **A gate may be placed ON one
  of your own completed walls** — dispatch tears the wall down (no refund, full
  gate cost) and skips the territory checks the standing wall already passed.
- **Roads (no longer cosmetic):** caravans on active routes wear their tile
  (`trade.ts` `wearRoad`, `ROAD_WEAR_PER_S`, cap 1). `World.roadWear` (sparse),
  persisted in `road_wear`; full snapshot in `init.roads`, quantised increments
  (`ROAD_LEVELS`) in `delta.roads` (public, like terrain). Mechanics: everyone
  moves up to `ROAD_SPEED_BONUS` faster on worn road (movement.ts
  `terrainSpeedMult`), and CARAVAN pathfinding discounts steps onto worn tiles
  down to `ROAD_PATH_COST_MIN` (findPath scales its heuristic to match) — so
  trade traffic converges onto shared roads and reinforces them. Client
  (`render/roads.ts`): alpha ∝ level; heavy-wear tiles swap to the cobbled
  `tile_road2` highway texture.

## Commanding & selection QoL (v12, all client-side except line moves)

- **Right-click-HOLD + drag** = line order: `MoveMsg.lineTo`; the server spreads
  the units evenly along the segment (`lineTargets` in dispatch.ts).
- **Double-click** an own entity selects all of that kind on screen.
- **Ctrl+digit** stores a control group; digit recalls; double-tap centres.
- **`.` / `,`** cycle idle civilians (villagers/caravans) / idle military.
- **Overhead icons:** every unit draws a 16px badge above its head
  (`icon_<kind>` / villagers `icon_job_<job>` — job is owner-only on the wire,
  enemies see the generic villager badge).

## Architecture (the load-bearing ideas)

- **The server is authoritative.** Clients send *intents* (`shared/protocol.ts`);
  the server re-validates everything (ownership, bounds, later cost/cooldowns).
  Never trust the client.
- **The sim runs 24/7, connection-agnostic.** Online/offline only affects
  networking, never the simulation. Every system in the tick loop runs over all
  entities regardless of whether the owner is connected. This is what makes
  offline progress + always-vulnerable PvP work.
- **In-RAM is the source of truth at runtime; SQLite is the durable snapshot.**
  The `World` (`server/sim/world.ts`) holds component `Map`s; `db/persist.ts`
  flushes dirty rows every 30s and once on SIGTERM; `db/load.ts` rebuilds the
  world on boot.
- **`server/net/snapshot.ts` is the single serialization chokepoint.** All
  outbound entity state goes through `buildDelta`. v6's fog-of-war will filter
  the "visible set" *there* — the anti-cheat rule (never send out-of-vision
  entities) must have exactly one enforcement point.

## Layout

- `shared/` — protocol, constants, types, (later) stat tables. Pure data, **no
  Node or DOM APIs** (imported by both server and client). Relative imports use
  `.js` extensions (NodeNext); esbuild resolves them to `.ts` via a plugin in
  `scripts/build-client.mjs`.
- `server/` — `sim/` (loop + systems + world), `net/` (ws, session/auth,
  dispatch, snapshot), `db/`, `auth/`. Built with `tsc` → `dist/`.
- `client/src/` — `render/` (Pixi), `input/` (camera, selection/commands),
  `net.ts`, `state.ts`. Bundled by esbuild → `client/bundle.js`.

## Villager jobs (v8) — villagers are NOT hand-controlled

- The player never moves/gathers individual villagers. They **assign job counts**
  (bottom-left villager panel → `assignJob` intent); the sim auto-tasks each
  villager. See `server/sim/systems/jobs.ts` (runs FIRST each tick).
- **Jobs:** `builder` (default for every new villager — walks to and finishes any
  unbuilt foundation inside the kingdom's territory), plus gathering jobs
  `lumberjack`/`stonemason`/`goldminer`/`forager`/`farmer`.
- **Capacity** is summed from operational buildings' `BuildingStat.jobSlots`:
  Town Center grants 2 each of lumberjack/stonemason/goldminer/forager + a
  `gatherRadius` (the base camp); Lumber/Mining Camps add **5** slots for their
  job(s) (v13) and open a new gather radius; a **Mill** adds forager slots +
  radius (it's the food/forage camp and the farm/berry food drop-off); each
  **Farm** grants exactly 1 farmer and IS that farmer's workplace. `assignJob`
  is clamped to capacity AND to villagers available; the remainder are builders.
- Gathering jobs find the nearest matching neutral node within a host building's
  `gatherRadius`; farmers bind 1:1 to a farm. A villager that can find no work
  accrues `idleTime` (sim-seconds); the per-player `JobReport` (owner-only, in the
  delta) carries `counts`/`caps`/`idleLong`, driving the panel + the "idle over an
  hour" warning (`IDLE_WARN_S`).
- Per-villager `job` persists in `ent_gather.job`; desired counts in the
  `player_jobs` table (`PlayerState.jobDesired`).
- **Military units are still hand-controlled** (`move`/`attack`/`stop`); the
  client excludes villagers from box-select and command. Villagers must stand
  within **half a tile** of a target to work it (`nearTarget` in `gather.ts`,
  used by gather + construction — replaces the old `BUILD_RANGE`/`GATHER_RANGE`).

## Resources & drop-off (AoE-style)

- Resource nodes (`tree`/`gold`/`stone`/`berry`) are neutral, finite, and block
  their tile. Villagers (per their job) harvest, then deposit at the nearest owned
  building that **accepts** the carried type (`BuildingStat.accepts: ResourceType[]`):
  Town Center = all four, Mill = food, Lumber Camp = wood, Mining Camp =
  gold+stone. Players start with a **Town Center** (also trains villagers, gives
  pop + vision + territory; rebuildable but expensive). Houses are pop-only.
- **Fog memory for resources:** once a player's vision touches a resource node it
  is added to `World.discoveredResources[playerId]` and thereafter always sent to
  that player (even out of vision) — see `snapshot.ts`. This is safe because
  nodes are neutral; **enemy** units/buildings are still withheld out of vision
  (the anti-cheat boundary is unchanged). Discovered set is in-memory only.
- **Farms are AoE2-style** (not a passive trickle): a villager harvests food from
  the farm's finite store (`resourceAmount`, seeded to `FARM_FOOD`) and hauls it
  to a food drop-off, like a resource node — the gather system special-cases
  `kind === 'farm'` (food; doesn't vanish when empty). Farm tiles are `walkable`
  (any unit may cross them) and since v13 the farmer works standing **ON** the
  field: `nearTarget` requires the villager's tile to be inside the farm's
  footprint (this also covers builders raising it). An empty farm is
  **auto-reseeded** by `farm.ts` (spends `FARM_RESEED_COST` wood) unless the
  owner toggles it off (`World.farmAuto`, per-farm `farmReseed` intent).

## Territory & construction

- **Construction needs a builder villager.** A placed building is a foundation
  that only advances while ≥1 of the owner's villagers is in the `building`
  gatherer state *and* within `nearTarget` range; more builders finish faster with
  diminishing returns (`n^0.75`). No builders ⇒ progress pauses (no decay). See
  `construction.ts`. The `build` intent just places the foundation (no builder
  list) — the jobs system auto-tasks idle builders inside territory to it. Build
  time is stretched by `BUILD_DURATION_SCALE` via `buildTimeOf()`.
- **Territory is the buildable zone.** Each *operational* Town Center projects a
  circle, radius `TERRITORY_MIN_TILES` → `TERRITORY_MAX_TILES` over
  `TERRITORY_GROW_TIME_S` of sim-time (`territory.ts`, `World.tcRadius`). A
  player's territory is the union of their TCs' circles. Placement (`dispatch.ts`
  build): a normal building's whole footprint must be inside; a TC need only
  **touch** it (frontier TCs push the border outward); with no TCs, only a TC may
  be placed (recovery). Geometry is in `shared/territory.ts` — used by the server
  check, the client ghost tint, and the border render
  (`client/src/render/territory.ts`).
- TCs can be **named/renamed** (`World.tcName`, `rename` intent), shown on the map
  label + tooltip + info panel. `territory`/`name` are public on the wire;
  `rally`/`farmAuto` are owner-only (stripped in `snapshot.ts`). The per-building
  extras persist via the `ent_building_meta` sidecar table.

## Sprites, animation & tooltip (client)

- Art is **generated PNGs** in `client/assets/` (one per entity kind, plus
  tiles, `fx_*`, `icon_*`, `decor_*`), written by `scripts/gen-assets.mjs`
  (`npm run gen:assets`, uses `pngjs`). Committed so deploys don't need the
  generator. Since v12 base sprites carry their **own colours** (no whole-sprite
  tint); ownership shows via a **`team_<kind>.png` overlay** (white flags/
  tabards/trim, drawn by `pair()` on the same canvas so they align) that the
  client tints with the owner colour — a child sprite per figure in
  `render/entities.ts`. Filenames are the contract. `tile_forestground.png` has
  no generator (don't add one); `logo.png` is hand-made.
- **Autotiling masks (v13):** `wall_<0..15>`, `tree_<0..15>` and
  `tile_mountain_<0..15>` are connection-mask variants (bit 1=N, 2=E, 4=S,
  8=W). Walls/gates join to same-owner neighbours and trees to any adjacent
  tree in `render/entities.ts` (which rebuilds a tile→wall/tree lookup each
  frame); mountains are static and masked at chunk-build time in
  `render/tiles.ts`. Connected tree variants draw at full tile size so canopies
  meet; a lone tree (`tree_0`) keeps the classic sprite.
- Grass gets a deterministic scatter of `decor_*` props per tile chunk
  (`render/tiles.ts`) so open ground isn't bare.
- `render/assets.ts` loads them into `tex[kind]`; `render/entities.ts` draws a
  `Sprite` per entity and animates it **procedurally** from `EntityView.action`
  (chop/mine/pick/hammer/lunge/walk) with short-lived `fx_*` particles. No
  spritesheets — animation is transform-based, so it survives art swaps.
- The server computes `EntityView.action` in `World.actionOf()` from combat
  (`CombatState.attacking`), gatherer state (incl. a `building` state set in
  `dispatch`/`gather`), and movement. Resource nodes also send `amount`.
  `viewChanged()` in `snapshot.ts` includes both so changes propagate.
- Hover tooltip lives in `input/commands.ts` (`updateTooltip`) using
  `ClientState.entityAt`; shows kind, owner, hp, action, build/train %, or
  resource amount.

## Conventions

- Tick rate `TICK_HZ` and all tuning live in `shared/constants.ts` (pacing will
  move to `shared/stats.ts` in v2). The engine is pacing-agnostic — tune data,
  not code.
- Add a new entity component as a `Map<EntityId, T>` on `World` + a sidecar
  table in `db/schema.ts` + handling in `persist.ts`/`load.ts`.
- New systems go in `server/sim/systems/` and are called in order from
  `loop.ts:advance()`.
- Placeholder graphics are data-driven in `client/src/render/colors.ts`
  (`KIND_STYLE`) — swapping in real art is a localized change.

## Systems (run each tick, in this order — see `sim/loop.ts`)

`jobs` (reconcile villager job assignments + auto-task each villager to a
node/farm/foundation) → `pathfinding` (A* on the tile grid, bounded request
queue; caravans discount worn-road steps) → `movement` (follows waypoints
off-grid; swamp slows, roads speed up) → `separation` (ease crowds apart) →
`gather` (villager harvest/haul/deposit, incl. farms) → `trade` (validate
routes, cycle caravans through stops, pay foreign arrivals, wear roads) →
`farm` (auto-reseed empty farms) →
`construction` (advance only with builders present) → `territory` (grow TC radii)
→ `training` (queue drain + spawn) → `combat` (acquire/chase/attack/kill —
war-relations + stances gate targeting; a dying UNIT leaves a neutral `corpse`
entity) → `corpse` (age + remove faded corpses) → `market` (drift global prices
back to baseline) → `heal` (regen units in own territory). Each runs over ALL
entities regardless of owner online status.

Other load-bearing pieces that aren't tick systems:
- **Defeat/restart:** a player with 0 units (and none training) is `defeated`
  (`World.isAlive`, surfaced in the delta); the `restart` intent
  (`session.restartPlayer`) wipes their entities + economy and re-seeds them at a
  fresh spawn via a fresh `init`. Territory is purely derived from live
  operational TCs, so destroying a TC drops its border immediately.
- **Market:** the `market` building is a trade desk; prices are a GLOBAL economy
  (`World.market` multipliers, persisted in `world_meta`). The `market` intent
  buys/sells wood/food/stone for gold (gold is the currency), moving the price;
  `marketSystem` reverts it toward baseline over ~an hour. All trade math is in
  `shared/stats.ts` (`marketBuyTotal`/`marketSellTotal`).

`TIME_SCALE` env multiplies the sim dt (default 1 = real slow pacing). Set high
(e.g. 30) to fast-forward for tests; the test scripts assume this.

All balance numbers live in `shared/stats.ts` (unit/building/resource tables,
gather/farm rates, costs, vision). Adjust pacing there, never in system code.
- **Combat speed:** `COMBAT_DURATION_SCALE` (in stats.ts) multiplies every attack
  cooldown — currently 5 (combat is deliberately slow, not micro-heavy). One knob
  scales all units/towers uniformly via `combatOf()`.
- **Movement speed:** `MOVE_DURATION_SCALE` (in stats.ts) divides every unit's
  speed — currently 5, matching the slow-combat feel. Applied in `speedOf()`, so
  spawns, the movement system, and DB-loaded units all use it.
- **Spawn spread:** new players' Town Centers are placed ≥ `MIN_SPAWN_DIST` (200)
  tiles apart by `findSpawnTile()` in `net/session.ts` (best-effort max-min
  distance if the map gets crowded), so players start far apart and must scout.

## Commands

- `npm run build` — server + client. `npm start` — run (serves client + ws :8081).
- `npm run typecheck:client` — type-check the client (esbuild doesn't type-check).
- `node scripts/smoke.mjs` / `test-economy.mjs` / `test-jobs.mjs` /
  `test-combat.mjs` / `test-farm.mjs` / `test-territory.mjs` /
  `test-resources.mjs` — end-to-end checks against a running (ideally
  `TIME_SCALE=30`) server.
- `node scripts/test-traderoutes.mjs` — trade-routes e2e against a running
  server (route wire, market fog memory, foreign-stop payout). NOTE: it flashes
  admin fog-reveal only briefly — leaving reveal ON makes the snapshot serialize
  every entity for that player each tick and drags the whole server.
- In-process tests (no server; run against `dist/`): `test-squads.mjs`,
  `test-stances.mjs`, `test-diplomacy.mjs`, `test-caravan.mjs` (routes,
  payouts, road-preferring caravan A*), `test-heal.mjs`, `test-worldgen.mjs`,
  `test-gates.mjs` (gates incl. gate-over-wall, road wear, line orders).
- `node scripts/render-map.mjs out.png` — generate + render a world to PNG
  (eyeball rivers/bridges/mountains). `node scripts/dev-sprite-sheet.mjs out.png`
  — contact sheet of all sprites.
- **Map size:** `MAP_TILES` is 768. A DB seeded at another size can't migrate —
  boot logs a warning; `node scripts/reset-world.mjs` regenerates. Worldgen
  (v13): heading-driven meandering rivers, straight 45°-snapped causeway bridges
  on stable reaches, wandering ridges/massifs whose punched passes are rocky
  `TERRAIN_PASS` floor (not grass) — connectivity corridors through mountains
  likewise; **swamps** hug rivers/lakes (passable but `SWAMP_SPEED_MULT`
  movement + `SWAMP_ATTACK_MULT` damage while standing in them); long-grass
  meadows, dirt/flower patches and rock outcrops vary the ground; forests are
  bigger with denser carved trails; lakes absorb any fully-enclosed island so a
  connectivity corridor never has to bridge a lake. The client tile layer is
  chunked (64 tiles) and culled per frame (`render/tiles.ts` `TileLayer.cull`);
  mountains autotile there via `tile_mountain_<mask>`.

## Gotchas (this is the first persistent-process project here)

- WebSockets need the heartbeat (`wsServer.ts` ping/pong) or dead sockets leak.
- nginx needs the `Upgrade`/`Connection`/`proxy_http_version 1.1` block or the
  wss upgrade silently fails (see `deploy/nginx.conf.example`).
- `node:sqlite` is synchronous; keep flushes small (dirty rows only) so the tick
  loop doesn't stall.
