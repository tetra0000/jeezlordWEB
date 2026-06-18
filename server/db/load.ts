// Rebuilds the in-memory World from SQLite on boot (crash recovery). Base
// components are reconstructed from each entity's kind via the stat tables; the
// persisted sidecars then overlay dynamic state (movement target, gather state,
// construction progress, training queue, resource amount). Tile occupancy is
// re-derived so pathfinding works immediately after a restart.
import { TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  RESOURCE_NODE_STATS,
  combatOf,
  isBuilding,
  isResourceNode,
  isUnit,
  speedOf,
} from '../../shared/stats.js';
import type { ResourceType } from '../../shared/types.js';
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
    });
  }

  const h = db.handle;
  const moveById = new Map<number, { tx: number | null; ty: number | null }>();
  for (const m of h.prepare('SELECT entity_id, target_x, target_y FROM ent_movement').all() as Array<{ entity_id: number; target_x: number | null; target_y: number | null }>)
    moveById.set(m.entity_id, { tx: m.target_x, ty: m.target_y });

  const gatherById = new Map<number, { state: string; carrying: number; carry_type: string | null; node_id: number | null }>();
  for (const g of h.prepare('SELECT entity_id, state, carrying, carry_type, node_id FROM ent_gather').all() as Array<{ entity_id: number; state: string; carrying: number; carry_type: string | null; node_id: number | null }>)
    gatherById.set(g.entity_id, g);

  const constructById = new Map<number, { build_time: number; elapsed: number; complete: number }>();
  for (const c of h.prepare('SELECT entity_id, build_time, elapsed, complete FROM ent_construct').all() as Array<{ entity_id: number; build_time: number; elapsed: number; complete: number }>)
    constructById.set(c.entity_id, c);

  const trainById = new Map<number, string>();
  for (const t of h.prepare('SELECT entity_id, queue_json FROM ent_train').all() as Array<{ entity_id: number; queue_json: string }>)
    trainById.set(t.entity_id, t.queue_json);

  const resourceById = new Map<number, number>();
  for (const r of h.prepare('SELECT entity_id, amount FROM resource_nodes').all() as Array<{ entity_id: number; amount: number }>)
    resourceById.set(r.entity_id, r.amount);

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
          ? { state: g.state as 'idle', carrying: g.carrying, carryType: (g.carry_type as ResourceType) ?? null, nodeId: g.node_id }
          : { state: 'idle', carrying: 0, carryType: null, nodeId: null });
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
      }
    } else if (isResourceNode(kind)) {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      world.blockFootprint(tx, ty, 1);
      world.resourceAmount.set(id, resourceById.get(id) ?? RESOURCE_NODE_STATS[kind].amount);
    }
  }

  const stored = db.getMeta('next_entity_id');
  if (stored) world.setNextId(Number(stored));
}
