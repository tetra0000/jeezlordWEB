// Rebuilds the in-memory World from SQLite on boot (crash recovery). Base
// components are reconstructed from each entity's kind via the stat tables; the
// persisted sidecars then overlay dynamic state (movement target, gather state,
// construction progress, training queue, resource amount). Tile occupancy is
// re-derived so pathfinding works immediately after a restart.
import { TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  RESOURCE_NODE_STATS,
  TERRITORY_MIN_TILES,
  combatOf,
  isBuilding,
  isResourceNode,
  isUnit,
  maxHpOf,
  speedOf,
} from '../../shared/stats.js';
import type { EntityKind, GateMode, ResourceType, Stance, VillagerJob } from '../../shared/types.js';
import type { Db } from './db.js';
import { World } from '../sim/world.js';
import { applyBuildingFootprint, registerGate } from '../sim/spawn.js';
import type { TrainItem } from '../sim/components.js';

// Pre-squads unit kinds that may still exist in an older database, mapped to
// their closest squad-era replacement. Remapped entities get their hp scaled to
// the new pool (same fraction) and are marked dirty so the next flush rewrites
// the row under the new kind.
const LEGACY_KIND: Record<string, EntityKind> = {
  infantry: 'warrior',
  scout: 'scoutCavalry',
  cavalry: 'knight',
  horse: 'knight',
};

export function loadWorld(db: Db, world: World): void {
  const playerRows = db.handle
    .prepare('SELECT id, name, color, spawn_tile_x, spawn_tile_y FROM players')
    .all() as Array<{ id: number; name: string; color: number; spawn_tile_x: number; spawn_tile_y: number }>;
  for (const p of playerRows) {
    const sp = db.getStockpile(p.id) ?? { wood: 0, gold: 0, food: 0, stone: 0 };
    world.players.set(p.id, {
      id: p.id,
      name: p.name,
      color: p.color,
      spawnTileX: p.spawn_tile_x,
      spawnTileY: p.spawn_tile_y,
      stockpile: { ...sp },
      jobDesired: db.getPlayerJobs(p.id),
    });
  }

  const h = db.handle;
  const moveById = new Map<number, { tx: number | null; ty: number | null }>();
  for (const m of h.prepare('SELECT entity_id, target_x, target_y FROM ent_movement').all() as Array<{ entity_id: number; target_x: number | null; target_y: number | null }>)
    moveById.set(m.entity_id, { tx: m.target_x, ty: m.target_y });

  const gatherById = new Map<number, { state: string; carrying: number; carry_type: string | null; node_id: number | null; job: string }>();
  for (const g of h.prepare('SELECT entity_id, state, carrying, carry_type, node_id, job FROM ent_gather').all() as Array<{ entity_id: number; state: string; carrying: number; carry_type: string | null; node_id: number | null; job: string }>)
    gatherById.set(g.entity_id, g);

  const constructById = new Map<number, { build_time: number; elapsed: number; complete: number }>();
  for (const c of h.prepare('SELECT entity_id, build_time, elapsed, complete FROM ent_construct').all() as Array<{ entity_id: number; build_time: number; elapsed: number; complete: number }>)
    constructById.set(c.entity_id, c);

  const trainById = new Map<number, string>();
  for (const t of h.prepare('SELECT entity_id, queue_json FROM ent_train').all() as Array<{ entity_id: number; queue_json: string }>)
    trainById.set(t.entity_id, t.queue_json);

  const rallyById = new Map<number, { x: number; y: number }>();
  for (const r of h.prepare('SELECT entity_id, x, y FROM ent_rally').all() as Array<{ entity_id: number; x: number; y: number }>)
    rallyById.set(r.entity_id, { x: r.x, y: r.y });

  const metaById = new Map<number, { name: string | null; radius: number | null; farm_auto: number | null; gate_mode: string | null }>();
  for (const m of h.prepare('SELECT entity_id, name, radius, farm_auto, gate_mode FROM ent_building_meta').all() as Array<{ entity_id: number; name: string | null; radius: number | null; farm_auto: number | null; gate_mode: string | null }>)
    metaById.set(m.entity_id, m);

  const resourceById = new Map<number, number>();
  for (const r of h.prepare('SELECT entity_id, amount FROM resource_nodes').all() as Array<{ entity_id: number; amount: number }>)
    resourceById.set(r.entity_id, r.amount);

  const tradeById = new Map<number, { state: string; home_id: number | null; target_id: number | null }>();
  for (const t of h.prepare('SELECT entity_id, state, home_id, target_id FROM ent_trade').all() as Array<{ entity_id: number; state: string; home_id: number | null; target_id: number | null }>)
    tradeById.set(t.entity_id, t);

  const stanceById = new Map<number, string>();
  for (const s of h.prepare('SELECT entity_id, stance FROM ent_stance').all() as Array<{ entity_id: number; stance: string }>)
    stanceById.set(s.entity_id, s.stance);

  const corpseById = new Map<number, { unit_kind: string; team: number | null; age: number }>();
  for (const c of h.prepare('SELECT entity_id, unit_kind, team, age FROM ent_corpse').all() as Array<{ entity_id: number; unit_kind: string; team: number | null; age: number }>)
    corpseById.set(c.entity_id, c);

  for (const e of db.allEntities()) {
    const { id, owner_player_id: owner, x, y } = e;
    let { kind, hp, max_hp } = e;
    // Migrate pre-squads unit kinds: same hp fraction on the new squad's pool.
    const remap = LEGACY_KIND[kind];
    if (remap) {
      const newMax = maxHpOf(remap);
      hp = max_hp > 0 ? Math.max(1, Math.round((hp / max_hp) * newMax)) : newMax;
      max_hp = newMax;
      kind = remap;
    }
    world.insert(id, kind, owner, x, y, hp, max_hp);
    if (remap) world.markDirty(id);

    if (isUnit(kind)) {
      const m = moveById.get(id);
      world.movement.set(id, {
        speed: speedOf(kind),
        target: m && m.tx != null && m.ty != null ? { x: m.tx, y: m.ty } : null,
        path: [],
        pathIndex: -1,
        repathCooldown: 0,
      });
      if (combatOf(kind))
        world.combat.set(id, {
          cooldownLeft: 0, targetId: null, commanded: false, attacking: false,
          stance: (stanceById.get(id) as Stance) ?? 'defensive',
        });
      if (kind === 'villager') {
        const g = gatherById.get(id);
        world.gatherer.set(id, g
          ? { state: g.state as 'idle', carrying: g.carrying, carryType: (g.carry_type as ResourceType) ?? null, nodeId: g.node_id, job: (g.job as VillagerJob) ?? 'builder', idleTime: 0 }
          : { state: 'idle', carrying: 0, carryType: null, nodeId: null, job: 'builder', idleTime: 0 });
      }
      if (kind === 'caravan') {
        const t = tradeById.get(id);
        world.trader.set(id, t
          ? { state: t.state as 'idle', homeId: t.home_id, targetId: t.target_id }
          : { state: 'idle', homeId: null, targetId: null });
      }
    } else if (isBuilding(kind)) {
      const f = BUILDING_STATS[kind].footprint;
      const tileX = Math.round(x / TILE - f / 2);
      const tileY = Math.round(y / TILE - f / 2);
      applyBuildingFootprint(world, kind, tileX, tileY, 1);
      const c = constructById.get(id);
      world.construction.set(id, c
        ? { buildTime: c.build_time, elapsed: c.elapsed, complete: c.complete !== 0 }
        : { buildTime: BUILDING_STATS[kind].buildTime, elapsed: BUILDING_STATS[kind].buildTime, complete: true });
      if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false, stance: 'defensive' });
      if (BUILDING_STATS[kind].trains) {
        const qj = trainById.get(id);
        const q = qj ? (JSON.parse(qj) as TrainItem[]) : [];
        // Migrate legacy kinds queued before the squads roster.
        for (const it of q) if (LEGACY_KIND[it.kind]) it.kind = LEGACY_KIND[it.kind];
        world.trainQueue.set(id, q);
        const rp = rallyById.get(id);
        if (rp) world.rally.set(id, rp);
      }
      const meta = metaById.get(id);
      if (kind === 'townCenter') {
        world.tcRadius.set(id, meta?.radius ?? TERRITORY_MIN_TILES);
        if (meta?.name) world.tcName.set(id, meta.name);
      } else if (kind === 'farm') {
        world.farmAuto.set(id, meta ? meta.farm_auto !== 0 : true);
      } else if (kind === 'gate') {
        world.gateMode.set(id, (meta?.gate_mode as GateMode) ?? 'trade');
        registerGate(world, id, tileX, tileY);
      }
    } else if (isResourceNode(kind)) {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      world.blockFootprint(tx, ty, 1);
      world.resourceAmount.set(id, resourceById.get(id) ?? RESOURCE_NODE_STATS[kind].amount);
    } else if (kind === 'corpse') {
      const c = corpseById.get(id);
      // No blocking / components — a corpse is just a decaying marker. The decay
      // system removes it once age reaches CORPSE_TTL_S.
      const ck = (c?.unit_kind as EntityKind) ?? 'villager';
      world.corpses.set(id, {
        unitKind: LEGACY_KIND[ck] ?? ck,
        team: c?.team ?? null,
        age: c?.age ?? 0,
      });
    }
  }

  // Caravan road wear (cosmetic ground state).
  for (const r of h.prepare('SELECT tile, wear FROM road_wear').all() as Array<{ tile: number; wear: number }>)
    world.roadWear.set(r.tile, r.wear);

  // Diplomacy relations + pending proposals.
  for (const d of h.prepare('SELECT a, b, state, proposer FROM diplomacy').all() as Array<{ a: number; b: number; state: string; proposer: number | null }>) {
    const key = `${d.a}:${d.b}`;
    if (d.state === 'ally' || d.state === 'war') world.relations.set(key, d.state);
    if (d.proposer != null) world.diploOffers.set(key, d.proposer);
  }

  const stored = db.getMeta('next_entity_id');
  if (stored) world.setNextId(Number(stored));

  // Restore the global market price multipliers (default to baseline 1.0).
  const mw = db.getMeta('market_wood'); if (mw) world.market.wood = Number(mw);
  const mf = db.getMeta('market_food'); if (mf) world.market.food = Number(mf);
  const ms = db.getMeta('market_stone'); if (ms) world.market.stone = Number(ms);

  // Static terrain grid (base64 raw bytes, written once by worldgen). Absent on
  // a brand-new world — seedWorld fills it before the first persist.
  const terr = db.getMeta('terrain');
  if (terr) {
    const buf = Buffer.from(terr, 'base64');
    if (buf.length === world.terrain.length) world.terrain.set(buf);
    else console.warn(`[load] terrain blob size ${buf.length} != ${world.terrain.length}; ignoring`);
  }
}
