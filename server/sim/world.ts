// The authoritative world: entity/component store, tile-occupancy grid, and
// player registry. Sim systems mutate this; persistence flushes it; snapshots
// read from it. In-RAM is the source of truth at runtime.
import type { Action, EntityId, EntityKind, EntityView, PlayerId } from '../../shared/types.js';
import { MAP_TILES, TILE, TERRAIN_WATER, TERRAIN_MOUNTAIN } from '../../shared/constants.js';
import {
  BASE_POP_CAP,
  BUILDING_STATS,
  CORPSE_TTL_S,
  UNIT_STATS,
  isBuilding,
  isUnit,
} from '../../shared/stats.js';
import type {
  CombatState,
  Construction,
  Corpse,
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
  // Production buildings' rally points: trained units walk here on spawn.
  readonly rally = new Map<EntityId, { x: number; y: number }>();
  // Town centers' current territory radius (tiles) and player-given name.
  readonly tcRadius = new Map<EntityId, number>();
  readonly tcName = new Map<EntityId, string>();
  // Farms' auto-reseed toggle (absent = default ON).
  readonly farmAuto = new Map<EntityId, boolean>();
  readonly combat = new Map<EntityId, CombatState>();
  readonly resourceAmount = new Map<EntityId, number>();
  // Dead units' bodies (kind === 'corpse'): decorative, neutral, decaying.
  readonly corpses = new Map<EntityId, Corpse>();

  readonly players = new Map<PlayerId, PlayerState>();

  // Global market price multipliers per tradable commodity (baseline 1.0). A
  // shared economy: trades move these, and marketSystem drifts them back toward
  // 1.0. Persisted in world_meta.
  readonly market = { wood: 1, food: 1, stone: 1 };

  // Resource nodes each player has discovered (entered vision once). Discovered
  // nodes stay visible through fog (AoE-style "explored" memory). In-memory only
  // — re-discovered cheaply after a restart.
  readonly discoveredResources = new Map<PlayerId, Set<EntityId>>();

  // Players with admin mode enabled (toggled by renaming a town center to
  // "adminmode"), and the subset with full-map reveal active. Both in-memory
  // only — a cheat/debug tool, not persisted; re-enable after a restart.
  readonly admin = new Set<PlayerId>();
  readonly adminReveal = new Set<PlayerId>();

  // Tile occupancy: count of blockers per tile (buildings, walls, resource
  // nodes). >0 means impassable for pathfinding.
  readonly blocked = new Uint8Array(MAP_TILES * MAP_TILES);

  // Static terrain code per tile (grass/water/bridge — see shared/constants).
  // Generated once by worldgen, persisted, and shipped to clients. Water is
  // impassable; bridges are passable like grass (handled in isBlockedTile).
  readonly terrain = new Uint8Array(MAP_TILES * MAP_TILES);

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
    const i = this.tileIndex(tx, ty);
    // Water and mountains are impassable terrain; a bridge tile sits over water
    // but is passable (so it's never treated as water here). Dynamic blockers
    // stack on top.
    const t = this.terrain[i];
    if (t === TERRAIN_WATER || t === TERRAIN_MOUNTAIN) return true;
    return this.blocked[i] > 0;
  }
  terrainAt(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return TERRAIN_WATER;
    return this.terrain[this.tileIndex(tx, ty)];
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
    this.rally.delete(id);
    this.tcRadius.delete(id);
    this.tcName.delete(id);
    this.farmAuto.delete(id);
    this.combat.delete(id);
    this.resourceAmount.delete(id);
    this.corpses.delete(id);
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
      // Rounded on the wire: internal hp is fractional (slow healing accrues
      // sub-hp each tick), but the snapshot diff should only fire when the
      // displayed whole-hp changes — not every tick. Damage is integer, so this
      // never affects combat readouts.
      hp: Math.round(hp.hp),
      maxHp: hp.maxHp,
    };
    const c = this.construction.get(id);
    if (c && !c.complete) v.build = c.buildTime > 0 ? c.elapsed / c.buildTime : 0;
    const q = this.trainQueue.get(id);
    if (q && q.length > 0) {
      const front = q[0];
      v.train = {
        pct: front.total > 0 ? 1 - front.timeLeft / front.total : 0,
        queued: q.length,
        items: q.map((it) => it.kind),
      };
    }
    const rp = this.rally.get(id);
    if (rp) v.rally = { x: rp.x, y: rp.y };

    // Town center territory + name (territory radius drives the border render).
    if (kind === 'townCenter') {
      // Round so a continuously-growing radius doesn't emit a delta every tick.
      v.territory = Math.round((this.tcRadius.get(id) ?? 0) * 10) / 10;
      const nm = this.tcName.get(id);
      if (nm) v.name = nm;
    }
    // Farm auto-reseed state (shown on the owner's info panel).
    if (kind === 'farm') v.farmAuto = this.farmAuto.get(id) ?? true;

    // Villager job (shown on the owner's info panel / tooltip).
    if (kind === 'villager') {
      const g = this.gatherer.get(id);
      if (g) v.job = g.job;
    }

    // Corpse: the original unit kind (sprite), its team (tint), and decay. Fade
    // is quantised so a slowly-decaying corpse doesn't emit a delta every tick.
    if (kind === 'corpse') {
      const cp = this.corpses.get(id);
      if (cp) {
        const fade = Math.max(0, 1 - cp.age / CORPSE_TTL_S);
        v.corpse = { kind: cp.unitKind, team: cp.team, fade: Math.round(fade * 50) / 50 };
      }
    }

    // Resource nodes report remaining amount (for the hover tooltip).
    const amt = this.resourceAmount.get(id);
    if (amt != null && amt < 100000) v.amount = Math.ceil(amt);

    // Current activity (drives client animation + tooltip). Omitted when idle.
    const action = this.actionOf(id);
    if (action !== 'idle') v.action = action;

    // Remaining move waypoints, so the owner's client can draw the planned path
    // for selected units. Owner-only (stripped for other viewers in snapshot).
    const mv = this.movement.get(id);
    if (mv) {
      const pts = mv.pathIndex >= 0 && mv.pathIndex < mv.path.length ? mv.path.slice(mv.pathIndex) : [];
      // Append queued shift-waypoints so the path line previews the whole route
      // (these are raw destinations, not yet pathfound — a straight-segment hint).
      if (mv.waypoints && mv.waypoints.length > 0) for (const w of mv.waypoints) pts.push({ x: w.x, y: w.y });
      if (pts.length > 0) v.path = pts;
    }
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

  // Whether a player is still in the game: owns at least one unit, or has one
  // queued in training. (Training keeps a player who lost their last villager
  // mid-build alive until it pops, avoiding a false defeat flicker.)
  isAlive(playerId: PlayerId): boolean {
    for (const [id, owner] of this.owner) {
      if (owner !== playerId) continue;
      const k = this.kind.get(id);
      if (k && isUnit(k)) return true;
    }
    for (const [id, q] of this.trainQueue) {
      if (q.length > 0 && this.owner.get(id) === playerId) return true;
    }
    return false;
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
