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
  speedOf,
} from '../../shared/stats.js';
import type { EntityKind, ResourceType, VillagerJob } from '../../shared/types.js';
import type { Db } from './db.js';
import { World } from '../sim/world.js';
import type { TrainItem } from '../sim/components.js';

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

  const metaById = new Map<number, { name: string | null; radius: number | null; farm_auto: number | null }>();
  for (const m of h.prepare('SELECT entity_id, name, radius, farm_auto FROM ent_building_meta').all() as Array<{ entity_id: number; name: string | null; radius: number | null; farm_auto: number | null }>)
    metaById.set(m.entity_id, m);

  const resourceById = new Map<number, number>();
  for (const r of h.prepare('SELECT entity_id, amount FROM resource_nodes').all() as Array<{ entity_id: number; amount: number }>)
    resourceById.set(r.entity_id, r.amount);

  const corpseById = new Map<number, { unit_kind: string; team: number | null; age: number }>();
  for (const c of h.prepare('SELECT entity_id, unit_kind, team, age FROM ent_corpse').all() as Array<{ entity_id: number; unit_kind: string; team: number | null; age: number }>)
    corpseById.set(c.entity_id, c);

  for (const e of db.allEntities()) {
    const { id, kind, owner_player_id: owner, x, y, hp, max_hp } = e;
    world.insert(id, kind, owner, x, y, hp, max_hp);

    if (isUnit(kind)) {
      const m = moveById.get(id);
      world.movement.set(id, {
        speed: speedOf(kind),
        target: m && m.tx != null && m.ty != null ? { x: m.tx, y: m.ty } : null,
        path: [],
        pathIndex: -1,
        repathCooldown: 0,
      });
      if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false });
      if (kind === 'villager') {
        const g = gatherById.get(id);
        world.gatherer.set(id, g
          ? { state: g.state as 'idle', carrying: g.carrying, carryType: (g.carry_type as ResourceType) ?? null, nodeId: g.node_id, job: (g.job as VillagerJob) ?? 'builder', idleTime: 0 }
          : { state: 'idle', carrying: 0, carryType: null, nodeId: null, job: 'builder', idleTime: 0 });
      }
    } else if (isBuilding(kind)) {
      const f = BUILDING_STATS[kind].footprint;
      const tileX = Math.round(x / TILE - f / 2);
      const tileY = Math.round(y / TILE - f / 2);
      world.blockFootprint(tileX, tileY, f);
      const c = constructById.get(id);
      world.construction.set(id, c
        ? { buildTime: c.build_time, elapsed: c.elapsed, complete: c.complete !== 0 }
        : { buildTime: BUILDING_STATS[kind].buildTime, elapsed: BUILDING_STATS[kind].buildTime, complete: true });
      if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false });
      if (BUILDING_STATS[kind].trains) {
        const qj = trainById.get(id);
        world.trainQueue.set(id, qj ? (JSON.parse(qj) as TrainItem[]) : []);
        const rp = rallyById.get(id);
        if (rp) world.rally.set(id, rp);
      }
      const meta = metaById.get(id);
      if (kind === 'townCenter') {
        world.tcRadius.set(id, meta?.radius ?? TERRITORY_MIN_TILES);
        if (meta?.name) world.tcName.set(id, meta.name);
      } else if (kind === 'farm') {
        world.farmAuto.set(id, meta ? meta.farm_auto !== 0 : true);
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
      world.corpses.set(id, {
        unitKind: (c?.unit_kind as EntityKind) ?? 'villager',
        team: c?.team ?? null,
        age: c?.age ?? 0,
      });
    }
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
