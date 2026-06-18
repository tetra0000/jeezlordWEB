// The authoritative world: entity/component store, tile-occupancy grid, and
// player registry. Sim systems mutate this; persistence flushes it; snapshots
// read from it. In-RAM is the source of truth at runtime.
import type { Action, EntityId, EntityKind, EntityView, PlayerId } from '../../shared/types.js';
import { MAP_TILES, TILE } from '../../shared/constants.js';
import {
  BASE_POP_CAP,
  BUILDING_STATS,
  UNIT_STATS,
  isBuilding,
  isUnit,
} from '../../shared/stats.js';
import type {
  CombatState,
  Construction,
  Gatherer,
  Movement,
  PlayerState,
  TrainItem,
} from './components.js';

export class World {
  readonly kind = new Map<EntityId, EntityKind>();
  readonly owner = new Map<EntityId, PlayerId | null>();
  readonly transform = new Map<EntityId, { x: number; y: number }>();
  readonly health = new Map<EntityId, { hp: number; maxHp: number }>();
  readonly movement = new Map<EntityId, Movement>();
  readonly gatherer = new Map<EntityId, Gatherer>();
  readonly construction = new Map<EntityId, Construction>();
  readonly trainQueue = new Map<EntityId, TrainItem[]>();
  readonly combat = new Map<EntityId, CombatState>();
  readonly resourceAmount = new Map<EntityId, number>();

  readonly players = new Map<PlayerId, PlayerState>();

  // Resource nodes each player has discovered (entered vision once). Discovered
  // nodes stay visible through fog (AoE-style "explored" memory). In-memory only
  // — re-discovered cheaply after a restart.
  readonly discoveredResources = new Map<PlayerId, Set<EntityId>>();

  // Tile occupancy: count of blockers per tile (buildings, walls, resource
  // nodes). >0 means impassable for pathfinding.
  readonly blocked = new Uint8Array(MAP_TILES * MAP_TILES);

  private nextId = 1;

  readonly dirtyEntities = new Set<EntityId>();
  readonly removedEntities = new Set<EntityId>();
  readonly dirtyPlayers = new Set<PlayerId>();

  // --- id allocation --------------------------------------------------------
  setNextId(id: number): void {
    this.nextId = Math.max(this.nextId, id);
  }
  peekNextId(): number {
    return this.nextId;
  }

  // --- tile grid ------------------------------------------------------------
  tileIndex(tx: number, ty: number): number {
    return ty * MAP_TILES + tx;
  }
  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES;
  }
  isBlockedTile(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return true;
    return this.blocked[this.tileIndex(tx, ty)] > 0;
  }
  private addBlock(tx: number, ty: number, delta: number): void {
    if (!this.inBounds(tx, ty)) return;
    const i = this.tileIndex(tx, ty);
    this.blocked[i] = Math.max(0, this.blocked[i] + delta);
  }
  blockFootprint(tileX: number, tileY: number, footprint: number): void {
    for (let dy = 0; dy < footprint; dy++)
      for (let dx = 0; dx < footprint; dx++) this.addBlock(tileX + dx, tileY + dy, 1);
  }
  unblockFootprint(tileX: number, tileY: number, footprint: number): void {
    for (let dy = 0; dy < footprint; dy++)
      for (let dx = 0; dx < footprint; dx++) this.addBlock(tileX + dx, tileY + dy, -1);
  }
  footprintFree(tileX: number, tileY: number, footprint: number): boolean {
    for (let dy = 0; dy < footprint; dy++)
      for (let dx = 0; dx < footprint; dx++)
        if (this.isBlockedTile(tileX + dx, tileY + dy)) return false;
    return true;
  }

  // --- entities -------------------------------------------------------------
  insert(
    id: EntityId,
    kind: EntityKind,
    owner: PlayerId | null,
    x: number,
    y: number,
    hp: number,
    maxHp: number,
  ): void {
    this.kind.set(id, kind);
    this.owner.set(id, owner);
    this.transform.set(id, { x, y });
    this.health.set(id, { hp, maxHp });
    this.setNextId(id + 1);
  }

  spawn(
    kind: EntityKind,
    owner: PlayerId | null,
    x: number,
    y: number,
    hp: number,
    maxHp: number,
  ): EntityId {
    const id = this.nextId++;
    this.insert(id, kind, owner, x, y, hp, maxHp);
    this.markDirty(id);
    return id;
  }

  remove(id: EntityId): void {
    this.kind.delete(id);
    this.owner.delete(id);
    this.transform.delete(id);
    this.health.delete(id);
    this.movement.delete(id);
    this.gatherer.delete(id);
    this.construction.delete(id);
    this.trainQueue.delete(id);
    this.combat.delete(id);
    this.resourceAmount.delete(id);
    this.dirtyEntities.delete(id);
    this.removedEntities.add(id);
  }

  markDirty(id: EntityId): void {
    this.dirtyEntities.add(id);
  }
  markPlayerDirty(id: PlayerId): void {
    this.dirtyPlayers.add(id);
  }
  has(id: EntityId): boolean {
    return this.kind.has(id);
  }

  view(id: EntityId): EntityView | null {
    const kind = this.kind.get(id);
    const tf = this.transform.get(id);
    const hp = this.health.get(id);
    if (!kind || !tf || !hp) return null;
    const v: EntityView = {
      id,
      kind,
      owner: this.owner.get(id) ?? null,
      x: tf.x,
      y: tf.y,
      hp: hp.hp,
      maxHp: hp.maxHp,
    };
    const c = this.construction.get(id);
    if (c && !c.complete) v.build = c.buildTime > 0 ? c.elapsed / c.buildTime : 0;
    const q = this.trainQueue.get(id);
    if (q && q.length > 0) {
      const front = q[0];
      v.train = { pct: front.total > 0 ? 1 - front.timeLeft / front.total : 0, queued: q.length };
    }

    // Resource nodes report remaining amount (for the hover tooltip).
    const amt = this.resourceAmount.get(id);
    if (amt != null && amt < 100000) v.amount = Math.ceil(amt);

    // Current activity (drives client animation + tooltip). Omitted when idle.
    const action = this.actionOf(id);
    if (action !== 'idle') v.action = action;
    return v;
  }

  private actionOf(id: EntityId): Action {
    const cs = this.combat.get(id);
    if (cs?.attacking) return 'attack';
    const g = this.gatherer.get(id);
    if (g) {
      if (g.state === 'gathering') {
        switch (g.carryType) {
          case 'wood': return 'gatherWood';
          case 'food': return 'gatherFood';
          case 'gold': return 'gatherGold';
          case 'stone': return 'gatherStone';
        }
      }
      if (g.state === 'building') return 'build';
    }
    const mv = this.movement.get(id);
    if (mv?.target) return 'move';
    return 'idle';
  }

  *entityIds(): IterableIterator<EntityId> {
    yield* this.kind.keys();
  }

  // A building is "operational" if it isn't an incomplete construction.
  isOperational(id: EntityId): boolean {
    const c = this.construction.get(id);
    return !c || c.complete;
  }

  // --- population -----------------------------------------------------------
  popCap(playerId: PlayerId): number {
    let cap = BASE_POP_CAP;
    for (const [id, owner] of this.owner) {
      if (owner !== playerId) continue;
      const k = this.kind.get(id)!;
      if (isBuilding(k) && this.isOperational(id)) cap += BUILDING_STATS[k].popProvided ?? 0;
    }
    return cap;
  }
  popUsed(playerId: PlayerId): number {
    let used = 0;
    for (const [id, owner] of this.owner) {
      if (owner !== playerId) continue;
      const k = this.kind.get(id)!;
      if (isUnit(k)) used += UNIT_STATS[k].pop;
      const q = this.trainQueue.get(id);
      if (q) for (const item of q) used += UNIT_STATS[item.kind]?.pop ?? 0;
    }
    return used;
  }
}
