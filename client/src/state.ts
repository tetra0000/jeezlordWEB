// Client-side world model: the last-known entity views (the authoritative
// target positions) plus interpolated render positions, the local player's
// identity/stockpile, and the current selection. Pure data — render and input
// modules read/write this.
import type { EntityView, EntityId, PlayerId, Pop, Stockpile } from '../../shared/types.js';
import type { DeltaMsg } from '../../shared/protocol.js';
import { TILE } from '../../shared/constants.js';
import { BUILDING_STATS, isBuilding } from '../../shared/stats.js';
import { KIND_STYLE } from './render/colors.js';

export interface ClientEntity {
  view: EntityView; // authoritative state (target position lives here)
  rx: number; // interpolated render x
  ry: number; // interpolated render y
}

export class ClientState {
  playerId: PlayerId = -1;
  mapTiles = 0;
  tile = 32;
  stockpile: Stockpile = { wood: 0, gold: 0, food: 0, stone: 0 };
  pop: Pop = { used: 0, cap: 0 };

  readonly entities = new Map<EntityId, ClientEntity>();
  readonly selection = new Set<EntityId>();

  applyDelta(d: DeltaMsg): void {
    for (const v of d.enter) {
      this.entities.set(v.id, { view: v, rx: v.x, ry: v.y });
    }
    for (const v of d.update) {
      const e = this.entities.get(v.id);
      if (e) e.view = v;
      else this.entities.set(v.id, { view: v, rx: v.x, ry: v.y });
    }
    for (const id of d.leave) {
      this.entities.delete(id);
      this.selection.delete(id);
    }
  }

  isOwn(id: EntityId): boolean {
    return this.entities.get(id)?.view.owner === this.playerId;
  }

  // Topmost entity whose shape contains the world point (smallest hit wins).
  entityAt(wx: number, wy: number): ClientEntity | null {
    let best: ClientEntity | null = null;
    let bestHalf = Infinity;
    for (const e of this.entities.values()) {
      const kind = e.view.kind;
      const half = isBuilding(kind)
        ? (BUILDING_STATS[kind].footprint * TILE) / 2
        : KIND_STYLE[kind].size + 3;
      const within = isBuilding(kind)
        ? Math.abs(wx - e.view.x) <= half && Math.abs(wy - e.view.y) <= half
        : Math.hypot(wx - e.view.x, wy - e.view.y) <= half;
      if (within && half < bestHalf) {
        best = e;
        bestHalf = half;
      }
    }
    return best;
  }

  reset(): void {
    this.entities.clear();
    this.selection.clear();
  }
}
