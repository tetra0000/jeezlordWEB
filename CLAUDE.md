# CLAUDE.md — Jeezlord

Persistent shared-world RTS. Read this before editing; see the full roadmap at
`C:\Users\User\.claude\plans\pure-weaving-music.md`.

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

## Resources & drop-off (AoE-style)

- Resource nodes (`tree`/`gold`/`stone`/`berry`) are neutral, finite, and block
  their tile. Villagers harvest, then deposit at the nearest owned building that
  **accepts** the carried type (`BuildingStat.accepts: ResourceType[]`):
  Town Center = all four, Mill = food, Lumber Camp = wood, Mining Camp =
  gold+stone. Players start with a **Town Center** (also trains villagers, gives
  pop + vision; rebuildable but expensive). Houses are population-only.
- **Fog memory for resources:** once a player's vision touches a resource node it
  is added to `World.discoveredResources[playerId]` and thereafter always sent to
  that player (even out of vision) — see `snapshot.ts`. This is safe because
  nodes are neutral; **enemy** units/buildings are still withheld out of vision
  (the anti-cheat boundary is unchanged). Discovered set is in-memory only.
- Farms remain a passive food trickle (no villager/drop-off), see `farm.ts`.

## Sprites, animation & tooltip (client)

- Art is **generated placeholder PNGs** in `client/assets/` (one per entity kind,
  plus `tile_grass.png` and `fx_*.png`), written by `scripts/gen-assets.mjs`
  (`npm run gen:assets`, uses `pngjs`). They're committed so deploys don't need
  the generator. Units/buildings are greyscale and **tinted by owner colour** on
  the client (team colour); resources/tiles/effects keep their own colours.
  Replace a PNG to reskin — filenames (= kind) are the contract.
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

`pathfinding` (A* on the tile grid, bounded request queue) → `movement` (follows
waypoints off-grid) → `gather` (villager harvest/haul/deposit) → `farm`
(renewable food trickle) → `construction` (auto-progress) → `training` (queue
drain + spawn) → `combat` (acquire/chase/attack/kill). Each runs over ALL
entities regardless of owner online status.

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
- `node scripts/smoke.mjs` / `test-economy.mjs` / `test-combat.mjs` / `test-farm.mjs`
  — end-to-end checks against a running (ideally `TIME_SCALE=30`) server.

## Gotchas (this is the first persistent-process project here)

- WebSockets need the heartbeat (`wsServer.ts` ping/pong) or dead sockets leak.
- nginx needs the `Upgrade`/`Connection`/`proxy_http_version 1.1` block or the
  wss upgrade silently fails (see `deploy/nginx.conf.example`).
- `node:sqlite` is synchronous; keep flushes small (dirty rows only) so the tick
  loop doesn't stall.
