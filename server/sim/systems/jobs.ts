// Villager-jobs system (v8). Villagers are no longer hand-controlled — the
// player assigns how many villagers should do each job and this system:
//   1. reconciles each villager's job to match the desired counts (clamped to
//      the kingdom's capacity), and
//   2. auto-tasks every villager from its job: a builder walks to the nearest
//      unbuilt foundation inside the kingdom's territory; a gatherer walks to
//      the nearest matching resource node within a host building's radius; a
//      farmer is bound 1:1 to a farm.
// The low-level walk/harvest/haul/build cycle is still executed by gather.ts and
// construction.ts — this system only decides WHAT each villager should target.
// Runs first each tick (before pathfinding) so freshly-tasked villagers path the
// same tick. Connection-agnostic, like every system.
import { MAP_PX, TILE } from '../../../shared/constants.js';
import {
  BUILDING_STATS,
  IDLE_WARN_S,
  JOB_NODE_KIND,
  NON_BUILDER_JOBS,
  isBuilding,
} from '../../../shared/stats.js';
import type { EntityId, JobReport, PlayerId, VillagerJob } from '../../../shared/types.js';
import type { Gatherer } from '../components.js';
import type { World } from '../world.js';
import { clearMove, setMoveTarget } from './movement.js';

type Villager = [EntityId, Gatherer];
interface Source { x: number; y: number; r: number } // r in px

// Per-player context computed once per tick: territory circles (for builders)
// and the gather-radius circles of each job's host buildings.
interface PlayerCtx {
  tc: Source[]; // operational town-center territory circles
  hosts: Map<VillagerJob, Source[]>; // job -> buildings hosting it (with radius)
}

// --- capacity ---------------------------------------------------------------
// How many villagers of each non-builder job the kingdom can support right now,
// summed over the jobSlots of every operational building. Builder is uncapped.
export function jobCapacity(world: World, pid: PlayerId): Record<VillagerJob, number> {
  const cap: Record<VillagerJob, number> = {
    builder: Infinity, farmer: 0, forager: 0, lumberjack: 0, stonemason: 0, goldminer: 0,
  };
  for (const [id, owner] of world.owner) {
    if (owner !== pid) continue;
    const k = world.kind.get(id);
    if (!k || !isBuilding(k) || !world.isOperational(id)) continue;
    const slots = BUILDING_STATS[k].jobSlots;
    if (!slots) continue;
    for (const j of Object.keys(slots) as VillagerJob[]) cap[j] += slots[j] ?? 0;
  }
  return cap;
}

function buildCtx(world: World, pid: PlayerId): PlayerCtx {
  const tc: Source[] = [];
  const hosts = new Map<VillagerJob, Source[]>();
  for (const [id, owner] of world.owner) {
    if (owner !== pid) continue;
    const k = world.kind.get(id);
    if (!k || !isBuilding(k) || !world.isOperational(id)) continue;
    const tf = world.transform.get(id)!;
    const stat = BUILDING_STATS[k];
    if (k === 'townCenter') tc.push({ x: tf.x, y: tf.y, r: (world.tcRadius.get(id) ?? 0) * TILE });
    if (stat.jobSlots && stat.gatherRadius) {
      const src: Source = { x: tf.x, y: tf.y, r: stat.gatherRadius * TILE };
      for (const j of Object.keys(stat.jobSlots) as VillagerJob[]) {
        if (!JOB_NODE_KIND[j]) continue; // farmer has no gather radius
        let list = hosts.get(j);
        if (!list) hosts.set(j, (list = []));
        list.push(src);
      }
    }
  }
  return { tc, hosts };
}

function within(srcs: Source[] | undefined, x: number, y: number): boolean {
  if (!srcs) return false;
  for (const s of srcs) if (Math.hypot(s.x - x, s.y - y) <= s.r) return true;
  return false;
}

// --- assignment helpers -----------------------------------------------------
function setJob(world: World, id: EntityId, g: Gatherer, job: VillagerJob): void {
  if (g.job === job) return;
  g.job = job;
  g.state = 'idle';
  g.nodeId = null;
  g.buildTargetId = null;
  g.carrying = 0;
  g.carryType = null;
  g.idleTime = 0;
  const mv = world.movement.get(id);
  if (mv) clearMove(mv);
  world.markDirty(id);
}

function goIdle(world: World, id: EntityId, g: Gatherer): void {
  if (g.state !== 'idle') {
    g.state = 'idle';
    const mv = world.movement.get(id);
    if (mv) clearMove(mv);
    world.markDirty(id);
  }
}

function startTask(world: World, id: EntityId, g: Gatherer, tx: number, ty: number): void {
  setMoveTarget(world, id, tx, ty);
  world.markDirty(id);
}

// An idle villager with nothing to do strolls to a nearby random spot now and
// then, so workless builders mill about instead of standing frozen. Cheap: each
// villager only re-targets every few sim-seconds (paced by wanderCd), so this
// never floods the bounded pathfinding queue. Only kicks in when truly idle and
// not already walking somewhere.
const WANDER_RADIUS = TILE * 5; // how far a stroll may wander from the current spot
function maybeWander(world: World, id: EntityId, g: Gatherer, dt: number): void {
  if (g.state !== 'idle') return;
  const mv = world.movement.get(id);
  if (mv?.target) return; // already strolling somewhere
  g.wanderCd = (g.wanderCd ?? Math.random() * 4) - dt;
  if (g.wanderCd > 0) return;
  g.wanderCd = 4 + Math.random() * 6; // next stroll in 4–10 sim-seconds
  const tf = world.transform.get(id);
  if (!tf) return;
  const ang = Math.random() * Math.PI * 2;
  const r = WANDER_RADIUS * (0.3 + 0.7 * Math.random());
  const tx = Math.min(MAP_PX - 1, Math.max(1, tf.x + Math.cos(ang) * r));
  const ty = Math.min(MAP_PX - 1, Math.max(1, tf.y + Math.sin(ang) * r));
  setMoveTarget(world, id, tx, ty);
  world.markDirty(id);
}

// Bring each villager's job into line with the player's desired counts, clamped
// to capacity. Surplus villagers fall back to builder; deficits are filled from
// the builder pool. Stable: villagers already on the right job are left alone.
function reconcile(world: World, pid: PlayerId, vills: Villager[]): void {
  const cap = jobCapacity(world, pid);
  const desired = world.players.get(pid)?.jobDesired ?? {};
  const byJob = new Map<VillagerJob, EntityId[]>();
  for (const [id, g] of vills) {
    let l = byJob.get(g.job);
    if (!l) byJob.set(g.job, (l = []));
    l.push(id);
  }
  const gOf = new Map<EntityId, Gatherer>(vills);
  const pool = [...(byJob.get('builder') ?? [])]; // builders available to promote

  // Demote surplus to builder.
  for (const job of NON_BUILDER_JOBS) {
    const eff = Math.min(desired[job] ?? 0, cap[job]);
    const list = byJob.get(job) ?? [];
    while (list.length > eff) {
      const id = list.pop()!;
      setJob(world, id, gOf.get(id)!, 'builder');
      pool.push(id);
    }
  }
  // Promote from the builder pool to fill deficits.
  for (const job of NON_BUILDER_JOBS) {
    const eff = Math.min(desired[job] ?? 0, cap[job]);
    let have = (byJob.get(job) ?? []).length;
    while (have < eff && pool.length) {
      const id = pool.pop()!;
      setJob(world, id, gOf.get(id)!, job);
      have++;
    }
  }
}

// Nearest owned, unfinished foundation — anywhere. Builders walk to whatever
// unbuilt building is closest, including Town Centers / camps placed outside the
// current territory (that's how the player expands into new ground).
function nearestFoundation(world: World, pid: PlayerId, vid: EntityId): EntityId | null {
  const vtf = world.transform.get(vid);
  if (!vtf) return null;
  let best: EntityId | null = null;
  let bestD = Infinity;
  for (const [id, owner] of world.owner) {
    if (owner !== pid) continue;
    const k = world.kind.get(id);
    if (!k || !isBuilding(k) || world.isOperational(id)) continue;
    const tf = world.transform.get(id)!;
    const d = Math.hypot(tf.x - vtf.x, tf.y - vtf.y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Nearest owned, completed building/wall below max HP inside our territory — a
// repair target for an idle builder.
function nearestRepair(world: World, pid: PlayerId, ctx: PlayerCtx, vid: EntityId): EntityId | null {
  const vtf = world.transform.get(vid);
  if (!vtf) return null;
  let best: EntityId | null = null;
  let bestD = Infinity;
  for (const [id, owner] of world.owner) {
    if (owner !== pid) continue;
    const k = world.kind.get(id);
    if (!k || !isBuilding(k) || !world.isOperational(id)) continue;
    const h = world.health.get(id);
    if (!h || h.hp >= h.maxHp) continue;
    const tf = world.transform.get(id)!;
    if (!within(ctx.tc, tf.x, tf.y)) continue;
    const d = Math.hypot(tf.x - vtf.x, tf.y - vtf.y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Nearest neutral resource node of the job's kind within a host building radius.
function nearestNode(world: World, ctx: PlayerCtx, job: VillagerJob, vid: EntityId): EntityId | null {
  const kind = JOB_NODE_KIND[job];
  const hosts = ctx.hosts.get(job);
  if (!kind || !hosts) return null;
  const vtf = world.transform.get(vid);
  if (!vtf) return null;
  let best: EntityId | null = null;
  let bestD = Infinity;
  for (const [id, k] of world.kind) {
    if (k !== kind || world.owner.get(id) != null) continue;
    if ((world.resourceAmount.get(id) ?? 0) <= 0) continue;
    const tf = world.transform.get(id)!;
    if (!within(hosts, tf.x, tf.y)) continue;
    const d = Math.hypot(tf.x - vtf.x, tf.y - vtf.y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function isFoundation(world: World, pid: PlayerId, id: EntityId | null | undefined): boolean {
  if (id == null || !world.has(id)) return false;
  const k = world.kind.get(id);
  return world.owner.get(id) === pid && !!k && isBuilding(k) && !world.isOperational(id);
}

// A completed, owned building/wall below max HP inside our territory (repairable).
function isRepairTarget(world: World, pid: PlayerId, ctx: PlayerCtx, id: EntityId | null | undefined): boolean {
  if (id == null || !world.has(id)) return false;
  if (world.owner.get(id) !== pid) return false;
  const k = world.kind.get(id);
  if (!k || !isBuilding(k) || !world.isOperational(id)) return false;
  const h = world.health.get(id);
  if (!h || h.hp >= h.maxHp) return false;
  const tf = world.transform.get(id)!;
  return within(ctx.tc, tf.x, tf.y);
}

// Bind farmers 1:1 to operational farms. (Capacity already ensures #farmers <=
// #farms, so every farmer gets one.)
function assignFarmers(world: World, pid: PlayerId, vills: Villager[], dt: number): void {
  const farms: EntityId[] = [];
  for (const [id, owner] of world.owner)
    if (owner === pid && world.kind.get(id) === 'farm' && world.isOperational(id)) farms.push(id);
  const taken = new Set<EntityId>();
  const needing: Villager[] = [];
  for (const [id, g] of vills) {
    if (g.job !== 'farmer') continue;
    if (g.nodeId != null && farms.includes(g.nodeId) && !taken.has(g.nodeId)) {
      taken.add(g.nodeId); // keep current farm
      g.idleTime = 0;
    } else {
      needing.push([id, g]);
    }
  }
  for (const [id, g] of needing) {
    const farm = farms.find((f) => !taken.has(f));
    if (farm == null) { goIdle(world, id, g); g.idleTime += dt; continue; }
    taken.add(farm);
    g.nodeId = farm;
    g.buildTargetId = null;
    if (g.state === 'idle') g.state = 'toNode';
    const tf = world.transform.get(farm)!;
    startTask(world, id, g, tf.x, tf.y);
    g.idleTime = 0;
  }
}

function assignWork(world: World, pid: PlayerId, ctx: PlayerCtx, id: EntityId, g: Gatherer, dt: number): void {
  if (g.job === 'builder') {
    // Keep the current task if it's still a valid foundation or repair target.
    if (g.state === 'building' &&
        (isFoundation(world, pid, g.buildTargetId) || isRepairTarget(world, pid, ctx, g.buildTargetId))) {
      g.idleTime = 0;
      return;
    }
    // Prefer finishing foundations; otherwise repair the nearest damaged building.
    const target = nearestFoundation(world, pid, id) ?? nearestRepair(world, pid, ctx, id);
    if (target == null) { goIdle(world, id, g); g.idleTime += dt; maybeWander(world, id, g, dt); return; }
    g.state = 'building';
    g.buildTargetId = target;
    g.nodeId = null;
    const tf = world.transform.get(target)!;
    startTask(world, id, g, tf.x, tf.y);
    g.idleTime = 0;
    return;
  }

  // Gathering jobs: gather.ts runs the walk/harvest/haul cycle; we only need to
  // (re)assign a node when the villager is idle (its node depleted or it has
  // none yet).
  if (g.state !== 'idle') { g.idleTime = 0; return; }
  const node = nearestNode(world, ctx, g.job, id);
  if (node == null) { g.idleTime += dt; maybeWander(world, id, g, dt); return; }
  g.state = 'toNode';
  g.nodeId = node;
  g.buildTargetId = null;
  const tf = world.transform.get(node)!;
  startTask(world, id, g, tf.x, tf.y);
  g.idleTime = 0;
}

export function jobsSystem(world: World, dt: number): void {
  const byOwner = new Map<PlayerId, Villager[]>();
  for (const [id, g] of world.gatherer) {
    const owner = world.owner.get(id);
    if (owner == null) continue;
    let l = byOwner.get(owner);
    if (!l) byOwner.set(owner, (l = []));
    l.push([id, g]);
  }

  for (const [pid, vills] of byOwner) {
    reconcile(world, pid, vills);
    const ctx = buildCtx(world, pid);
    assignFarmers(world, pid, vills, dt);
    for (const [id, g] of vills) {
      if (g.job === 'farmer') continue; // handled by assignFarmers
      assignWork(world, pid, ctx, id, g, dt);
    }
  }
}

// Snapshot helper: the owner-facing summary of villager jobs.
export function jobReport(world: World, pid: PlayerId): JobReport {
  const counts: Record<VillagerJob, number> = {
    builder: 0, farmer: 0, forager: 0, lumberjack: 0, stonemason: 0, goldminer: 0,
  };
  let total = 0;
  let idleLong = 0;
  for (const [id, g] of world.gatherer) {
    if (world.owner.get(id) !== pid) continue;
    counts[g.job]++;
    total++;
    if (g.idleTime >= IDLE_WARN_S) idleLong++;
  }
  const cap = jobCapacity(world, pid);
  const caps: Partial<Record<VillagerJob, number>> = {};
  for (const job of NON_BUILDER_JOBS) caps[job] = cap[job];
  return { total, counts, caps, idleLong };
}
