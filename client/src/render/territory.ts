// Territory overlay. A player's territory is the UNION of their town centers'
// tile-discs — the set of grid tiles whose centre falls within a TC's radius
// (the same centre-in-circle test the server uses for placement). The border is
// drawn tile-aligned (blocky), tracing only the edges where an owned tile meets
// a non-owned one, so same-owner discs merge into one outline and only the outer
// boundary shows. Different owners keep separate slots, so rival borders cross
// where their territories contest.
import { Container, Graphics } from 'pixi.js';
import { MAP_TILES, TILE } from '../../../shared/constants.js';
import { tileInTerritory, type TerritorySource } from '../../../shared/territory.js';
import type { PlayerId } from '../../../shared/types.js';
import type { ClientState } from '../state.js';
import { ownerColor } from './colors.js';

const BORDER_WIDTH = 3;

export class TerritoryLayer {
  readonly container = new Container();
  private readonly slots: Graphics[] = [];

  private slot(i: number): Graphics {
    if (this.slots[i]) return this.slots[i];
    const g = new Graphics();
    this.container.addChild(g);
    this.slots[i] = g;
    return g;
  }

  draw(state: ClientState): void {
    // Group every visible town center's territory by owner.
    const groups = new Map<PlayerId | null, TerritorySource[]>();
    for (const e of state.entities.values()) {
      const v = e.view;
      if (v.kind !== 'townCenter' || !v.territory) continue;
      let arr = groups.get(v.owner);
      if (!arr) groups.set(v.owner, (arr = []));
      arr.push({ x: v.x, y: v.y, radiusTiles: v.territory });
    }

    let i = 0;
    for (const [owner, sources] of groups) {
      const g = this.slot(i++);
      g.clear();

      // Owned tile set = union of the owner's TC tile-discs, scanned over the
      // bounding box of all their TCs.
      const owned = new Set<number>();
      let minX = MAP_TILES, minY = MAP_TILES, maxX = 0, maxY = 0;
      for (const s of sources) {
        const R = Math.ceil(s.radiusTiles) + 1;
        const cx = Math.floor(s.x / TILE);
        const cy = Math.floor(s.y / TILE);
        minX = Math.min(minX, cx - R); maxX = Math.max(maxX, cx + R);
        minY = Math.min(minY, cy - R); maxY = Math.max(maxY, cy + R);
      }
      minX = Math.max(0, minX); minY = Math.max(0, minY);
      maxX = Math.min(MAP_TILES - 1, maxX); maxY = Math.min(MAP_TILES - 1, maxY);
      for (let ty = minY; ty <= maxY; ty++)
        for (let tx = minX; tx <= maxX; tx++)
          if (tileInTerritory(sources, tx, ty)) owned.add(ty * MAP_TILES + tx);

      // Stroke only the boundary edges (owned tile adjacent to a non-owned one);
      // shared interior edges are skipped, merging same-owner discs.
      const has = (tx: number, ty: number): boolean => owned.has(ty * MAP_TILES + tx);
      for (const idx of owned) {
        const tx = idx % MAP_TILES;
        const ty = (idx - tx) / MAP_TILES;
        const x = tx * TILE;
        const y = ty * TILE;
        if (!has(tx - 1, ty)) g.moveTo(x, y).lineTo(x, y + TILE);
        if (!has(tx + 1, ty)) g.moveTo(x + TILE, y).lineTo(x + TILE, y + TILE);
        if (!has(tx, ty - 1)) g.moveTo(x, y).lineTo(x + TILE, y);
        if (!has(tx, ty + 1)) g.moveTo(x, y + TILE).lineTo(x + TILE, y + TILE);
      }
      g.stroke({ width: BORDER_WIDTH, color: ownerColor(owner), alpha: 0.85 });
      g.visible = true;
    }
    // Hide any slots left over from a previous frame with more owners.
    for (; i < this.slots.length; i++) this.slots[i].visible = false;
  }
}
