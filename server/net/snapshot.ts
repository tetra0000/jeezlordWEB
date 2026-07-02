// The single serialization chokepoint for outbound state. It restricts the
// player's visible set to entities they own or that stand on a currently-visible
// tile (the fog-of-war anti-cheat boundary: out-of-vision entities are NEVER
// serialized), diffs against what was last sent, and emits enter/update/leave
// plus stockpile/population changes.
import type { DeltaMsg, MarketState } from '../../shared/protocol.js';
import type { DiploEntry, EntityId, EntityView, JobReport, Pop, Shot, Stockpile, TradeRouteView, Vec2 } from '../../shared/types.js';
import type { Session } from './session.js';
import { World } from '../sim/world.js';
import { MAP_TILES, TILE } from '../../shared/constants.js';
import { isResourceNode } from '../../shared/stats.js';
import { visibleTileSet } from '../sim/systems/vision.js';
import { jobReport } from '../sim/systems/jobs.js';

function pathChanged(a?: Vec2[], b?: Vec2[]): boolean {
  if (!a && !b) return false;
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i].x !== b[i].x || a[i].y !== b[i].y) return true;
  return false;
}

function viewChanged(a: EntityView, b: EntityView): boolean {
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.hp !== b.hp ||
    a.maxHp !== b.maxHp ||
    a.owner !== b.owner ||
    a.build !== b.build ||
    a.action !== b.action ||
    a.amount !== b.amount ||
    a.train?.pct !== b.train?.pct ||
    a.train?.queued !== b.train?.queued ||
    (a.train?.items ?? []).join(',') !== (b.train?.items ?? []).join(',') ||
    a.rally?.x !== b.rally?.x ||
    a.rally?.y !== b.rally?.y ||
    a.territory !== b.territory ||
    a.name !== b.name ||
    a.farmAuto !== b.farmAuto ||
    a.gate !== b.gate ||
    a.job !== b.job ||
    a.stance !== b.stance ||
    a.trade?.route !== b.trade?.route ||
    a.trade?.next !== b.trade?.next ||
    a.corpse?.fade !== b.corpse?.fade ||
    a.corpse?.kind !== b.corpse?.kind ||
    pathChanged(a.path, b.path)
  );
}

// Entities the player may currently see:
//  - their own (always),
//  - resource nodes AND markets they've discovered (persist through fog,
//    AoE-style memory — markets stay routable trade partners once found),
//  - any other entity standing on a currently-visible tile.
// Out-of-vision ENEMY entities are never serialized (the anti-cheat boundary).
function visibleViews(world: World, playerId: number): Map<EntityId, EntityView> {
  const visTiles = visibleTileSet(world, playerId);
  // Allies share vision (the Neptune's-Pride-style intel perk of an alliance):
  // union the allies' visible tiles into ours. Still the single enforcement
  // point — the visible SET grows, but the boundary rule is unchanged.
  for (const ally of world.allies(playerId)) {
    for (const t of visibleTileSet(world, ally)) visTiles.add(t);
  }
  // Admin reveal: lift the fog entirely for this player (still the single
  // enforcement point — we just treat every tile as in-vision below).
  const reveal = world.adminReveal.has(playerId);
  let discovered = world.discoveredResources.get(playerId);
  if (!discovered) {
    discovered = new Set<EntityId>();
    world.discoveredResources.set(playerId, discovered);
  }
  let knownMarkets = world.discoveredMarkets.get(playerId);
  if (!knownMarkets) {
    knownMarkets = new Set<EntityId>();
    world.discoveredMarkets.set(playerId, knownMarkets);
  }

  const out = new Map<EntityId, EntityView>();
  for (const id of world.entityIds()) {
    const owner = world.owner.get(id);
    if (owner !== playerId) {
      const tf = world.transform.get(id)!;
      const tx = Math.floor(tf.x / TILE);
      const ty = Math.floor(tf.y / TILE);
      const inVision = reveal || visTiles.has(ty * MAP_TILES + tx);
      const kind = world.kind.get(id)!;
      if (isResourceNode(kind)) {
        // Neutral resource: reveal once discovered, then keep revealing it.
        if (inVision) discovered.add(id);
        else if (!discovered.has(id)) continue;
      } else if (kind === 'market') {
        // Markets get the same memory: once seen, they stay on your map (a
        // trade partner has to stay routable through fog).
        if (inVision) knownMarkets.add(id);
        else if (!knownMarkets.has(id)) continue;
      } else if (!inVision) {
        continue; // out-of-vision enemy/neutral — never sent
      }
    }
    const v = world.view(id);
    if (v) {
      // Private intel — only the owner sees their own rally points and farm
      // toggles. Territory radius + town-center names stay public (visible
      // borders/labels are part of the shared world).
      if (owner !== playerId) {
        if (v.rally) delete v.rally;
        if (v.farmAuto !== undefined) delete v.farmAuto;
        if (v.job !== undefined) delete v.job;
        if (v.stance !== undefined) delete v.stance;
        if (v.trade !== undefined) delete v.trade;
        if (v.path) delete v.path;
      }
      out.set(id, v);
    }
  }
  return out;
}

function popEq(a: Pop, b: Pop): boolean {
  return a.used === b.used && a.cap === b.cap;
}
function stockEq(a: Stockpile, b: Stockpile): boolean {
  return a.wood === b.wood && a.gold === b.gold && a.food === b.food && a.stone === b.stone;
}

export function buildDelta(world: World, session: Session, tick: number): DeltaMsg | null {
  const playerId = session.playerId;
  if (playerId == null) return null;

  const current = visibleViews(world, playerId);
  const prev = session.lastSent;

  const enter: EntityView[] = [];
  const update: EntityView[] = [];
  const leave: EntityId[] = [];
  const dead: EntityId[] = [];

  for (const [id, view] of current) {
    const before = prev.get(id);
    if (!before) enter.push(view);
    else if (viewChanged(view, before)) update.push(view);
  }
  for (const id of prev.keys()) {
    if (current.has(id)) continue;
    leave.push(id);
    // A real death (entity gone from the world) vs. merely leaving vision (still
    // exists, just fogged). Only deaths get death FX / a corpse; resource nodes
    // "deplete" rather than die, so they're excluded.
    if (!world.has(id) && !isResourceNode(prev.get(id)!.kind)) dead.push(id);
  }

  session.lastSent.clear();
  for (const [id, view] of current) session.lastSent.set(id, { ...view });

  // Stockpile / population changes.
  const p = world.players.get(playerId);
  let you: Partial<Stockpile> | undefined;
  let pop: Pop | undefined;
  if (p) {
    if (!stockEq(p.stockpile, session.lastStockpile)) {
      you = { ...p.stockpile };
      session.lastStockpile = { ...p.stockpile };
    }
    const curPop: Pop = { used: world.popUsed(playerId), cap: world.popCap(playerId) };
    if (!popEq(curPop, session.lastPop)) {
      pop = curPop;
      session.lastPop = curPop;
    }
  }

  // Villager-jobs summary (counts/caps/idle). Cheap to compute; only sent when
  // its serialization changes.
  let jobs: JobReport | undefined;
  const jr = jobReport(world, playerId);
  const jrKey = JSON.stringify(jr);
  if (jrKey !== session.lastJobs) {
    jobs = jr;
    session.lastJobs = jrKey;
  }

  // Global market prices — sent only when the (quantised) multipliers change.
  let market: MarketState | undefined;
  const mk = world.market;
  const mkKey = `${Math.round(mk.wood * 1000)},${Math.round(mk.food * 1000)},${Math.round(mk.stone * 1000)}`;
  if (mkKey !== session.lastMarket) {
    market = { wood: mk.wood, food: mk.food, stone: mk.stone };
    session.lastMarket = mkKey;
  }

  // Diplomacy roster: your relation (+ pending offers) with every other player.
  // Small, so it's rebuilt each tick and sent only when its key changes.
  let diplo: DiploEntry[] | undefined;
  {
    const roster: DiploEntry[] = [];
    for (const [pid, pl] of world.players) {
      if (pid === playerId) continue;
      const entry: DiploEntry = {
        id: pid, name: pl.name, color: pl.color,
        relation: world.relationOf(playerId, pid),
      };
      const proposer = world.diploOffers.get(World.pairKey(playerId, pid));
      if (proposer != null) entry.offer = proposer === playerId ? 'out' : 'in';
      roster.push(entry);
    }
    roster.sort((a, b) => a.id - b.id);
    const dKey = JSON.stringify(roster);
    if (dKey !== session.lastDiplo) {
      diplo = roster;
      session.lastDiplo = dKey;
    }
  }

  // Trade routes: the player's routes (stops + assigned caravan counts).
  // Small; rebuilt each tick and sent only when the key changes.
  let routes: TradeRouteView[] | undefined;
  {
    const list: TradeRouteView[] = [];
    for (const route of world.tradeRoutes.values()) {
      if (route.owner !== playerId) continue;
      let caravans = 0;
      for (const tr of world.trader.values()) if (tr.routeId === route.id) caravans++;
      const stops = route.stops.map((s) => {
        const tf = world.transform.get(s);
        return { id: s, x: tf?.x ?? 0, y: tf?.y ?? 0, owner: world.owner.get(s) ?? null };
      });
      list.push({ id: route.id, stops, caravans, gold: world.routeCircuitGold(route) });
    }
    list.sort((a, b) => a.id - b.id);
    const rKey = JSON.stringify(list);
    if (rKey !== session.lastRoutes) {
      routes = list;
      session.lastRoutes = rKey;
    }
  }

  // Defeat state (no units left, none training) — sent only when it flips.
  let defeated: boolean | undefined;
  const defeatedNow = !world.isAlive(playerId);
  if (defeatedNow !== session.lastDefeated) {
    defeated = defeatedNow;
    session.lastDefeated = defeatedNow;
  }

  // Ranged projectiles loosed this tick — only those whose shooter or target the
  // player can currently see (same fog boundary as entities). Strip the ids; the
  // wire only needs positions + kind. Transient, so never diffed against state.
  let shots: Shot[] | undefined;
  for (const s of world.shots) {
    if (!current.has(s.from) && !current.has(s.to)) continue;
    (shots ??= []).push({ kind: s.kind, x: s.x, y: s.y, tx: s.tx, ty: s.ty });
  }

  // Caravan road wear worn in this tick. Public cosmetic ground state (like
  // terrain) — every online player gets the same increments.
  const roads = world.roadEvents.length > 0 ? [...world.roadEvents] : undefined;

  if (enter.length === 0 && update.length === 0 && leave.length === 0 &&
      !you && !pop && !jobs && !market && defeated === undefined && !shots && !diplo && !roads && !routes)
    return null;
  const delta: DeltaMsg = { t: 'delta', tick, enter, update, leave };
  if (dead.length) delta.dead = dead;
  if (you) delta.you = you;
  if (pop) delta.pop = pop;
  if (jobs) delta.jobs = jobs;
  if (market) delta.market = market;
  if (defeated !== undefined) delta.defeated = defeated;
  if (shots) delta.shots = shots;
  if (diplo) delta.diplo = diplo;
  if (roads) delta.roads = roads;
  if (routes) delta.routes = routes;
  return delta;
}
