// The single serialization chokepoint for outbound state. It restricts the
// player's visible set to entities they own or that stand on a currently-visible
// tile (the fog-of-war anti-cheat boundary: out-of-vision entities are NEVER
// serialized), diffs against what was last sent, and emits enter/update/leave
// plus stockpile/population changes.
import type { DeltaMsg } from '../../shared/protocol.js';
import type { EntityId, EntityView, JobReport, Pop, Stockpile, Vec2 } from '../../shared/types.js';
import type { Session } from './session.js';
import type { World } from '../sim/world.js';
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
    a.job !== b.job ||
    pathChanged(a.path, b.path)
  );
}

// Entities the player may currently see:
//  - their own (always),
//  - resource nodes they've discovered (persist through fog, AoE-style memory),
//  - any other entity standing on a currently-visible tile.
// Out-of-vision ENEMY entities are never serialized (the anti-cheat boundary).
function visibleViews(world: World, playerId: number): Map<EntityId, EntityView> {
  const visTiles = visibleTileSet(world, playerId);
  // Admin reveal: lift the fog entirely for this player (still the single
  // enforcement point — we just treat every tile as in-vision below).
  const reveal = world.adminReveal.has(playerId);
  let discovered = world.discoveredResources.get(playerId);
  if (!discovered) {
    discovered = new Set<EntityId>();
    world.discoveredResources.set(playerId, discovered);
  }

  const out = new Map<EntityId, EntityView>();
  for (const id of world.entityIds()) {
    const owner = world.owner.get(id);
    if (owner !== playerId) {
      const tf = world.transform.get(id)!;
      const tx = Math.floor(tf.x / TILE);
      const ty = Math.floor(tf.y / TILE);
      const inVision = reveal || visTiles.has(ty * MAP_TILES + tx);
      if (isResourceNode(world.kind.get(id)!)) {
        // Neutral resource: reveal once discovered, then keep revealing it.
        if (inVision) discovered.add(id);
        else if (!discovered.has(id)) continue;
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

  for (const [id, view] of current) {
    const before = prev.get(id);
    if (!before) enter.push(view);
    else if (viewChanged(view, before)) update.push(view);
  }
  for (const id of prev.keys()) {
    if (!current.has(id)) leave.push(id);
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

  if (enter.length === 0 && update.length === 0 && leave.length === 0 && !you && !pop && !jobs)
    return null;
  const delta: DeltaMsg = { t: 'delta', tick, enter, update, leave };
  if (you) delta.you = you;
  if (pop) delta.pop = pop;
  if (jobs) delta.jobs = jobs;
  return delta;
}
