// Periodic dirty-row flush of the in-memory World to SQLite, wrapped in a single
// transaction. Called every FLUSH_MS and once more on graceful shutdown so a
// deploy/restart loses at most one flush interval of progress.
import type { Db } from './db.js';
import type { World } from '../sim/world.js';

export function flush(db: Db, world: World): void {
  const h = db.handle;

  const upsertEntity = h.prepare(
    `INSERT OR REPLACE INTO entities (id, kind, owner_player_id, x, y, hp, max_hp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const upMove = h.prepare(
    `INSERT OR REPLACE INTO ent_movement (entity_id, speed, target_x, target_y) VALUES (?, ?, ?, ?)`,
  );
  const upGather = h.prepare(
    `INSERT OR REPLACE INTO ent_gather (entity_id, state, carrying, carry_type, node_id) VALUES (?, ?, ?, ?, ?)`,
  );
  const upConstruct = h.prepare(
    `INSERT OR REPLACE INTO ent_construct (entity_id, build_time, elapsed, complete) VALUES (?, ?, ?, ?)`,
  );
  const upTrain = h.prepare(`INSERT OR REPLACE INTO ent_train (entity_id, queue_json) VALUES (?, ?)`);
  const upResource = h.prepare(`INSERT OR REPLACE INTO resource_nodes (entity_id, amount) VALUES (?, ?)`);

  const delEntity = h.prepare('DELETE FROM entities WHERE id = ?');
  const delMove = h.prepare('DELETE FROM ent_movement WHERE entity_id = ?');
  const delGather = h.prepare('DELETE FROM ent_gather WHERE entity_id = ?');
  const delConstruct = h.prepare('DELETE FROM ent_construct WHERE entity_id = ?');
  const delTrain = h.prepare('DELETE FROM ent_train WHERE entity_id = ?');
  const delResource = h.prepare('DELETE FROM resource_nodes WHERE entity_id = ?');

  const deleteAllSidecars = (id: number) => {
    delMove.run(id);
    delGather.run(id);
    delConstruct.run(id);
    delTrain.run(id);
    delResource.run(id);
  };

  h.exec('BEGIN IMMEDIATE');
  try {
    for (const id of world.removedEntities) {
      delEntity.run(id);
      deleteAllSidecars(id);
    }

    for (const id of world.dirtyEntities) {
      const kind = world.kind.get(id);
      const tf = world.transform.get(id);
      const hp = world.health.get(id);
      if (!kind || !tf || !hp) continue;
      upsertEntity.run(id, kind, world.owner.get(id) ?? null, tf.x, tf.y, hp.hp, hp.maxHp);

      const mv = world.movement.get(id);
      if (mv) upMove.run(id, mv.speed, mv.target?.x ?? null, mv.target?.y ?? null);
      else delMove.run(id);

      const g = world.gatherer.get(id);
      if (g) upGather.run(id, g.state, g.carrying, g.carryType, g.nodeId);

      const c = world.construction.get(id);
      if (c) upConstruct.run(id, c.buildTime, c.elapsed, c.complete ? 1 : 0);

      const q = world.trainQueue.get(id);
      if (q) upTrain.run(id, JSON.stringify(q));

      const amt = world.resourceAmount.get(id);
      if (amt != null) upResource.run(id, amt);
    }

    for (const pid of world.dirtyPlayers) {
      const p = world.players.get(pid);
      if (p) db.upsertStockpile(pid, p.stockpile);
    }

    db.setMeta('next_entity_id', String(world.peekNextId()));
    h.exec('COMMIT');
  } catch (err) {
    h.exec('ROLLBACK');
    throw err;
  }

  world.dirtyEntities.clear();
  world.removedEntities.clear();
  world.dirtyPlayers.clear();
}
