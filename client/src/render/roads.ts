// Caravan road wear: a sprite per worn tile, fading in as the wear level rises
// (level 1..ROAD_LEVELS from the server). Sits above the terrain, below
// territory/entities. Sprites are created/updated only when the road state
// version bumps; per-frame work is just a viewport visibility pass.
import { Container, Sprite } from 'pixi.js';
import { ROAD_LEVELS } from '../../../shared/stats.js';
import type { ClientState } from '../state.js';
import type { Viewport } from './entities.js';
import { tex } from './assets.js';

export class RoadLayer {
  readonly container = new Container();
  private readonly sprites = new Map<number, Sprite>();
  private shownVersion = -1;

  // Sync sprites with the client road state (no-op unless it changed).
  update(state: ClientState): void {
    if (state.roadsVersion === this.shownVersion) return;
    this.shownVersion = state.roadsVersion;
    const t = tex.tile_road;
    if (!t || state.mapTiles === 0) return;

    // Remove sprites for tiles no longer present (only happens on reset()).
    if (state.roads.size < this.sprites.size) {
      for (const [tile, s] of this.sprites) {
        if (!state.roads.has(tile)) {
          s.destroy();
          this.sprites.delete(tile);
        }
      }
    }

    for (const [tile, lvl] of state.roads) {
      let s = this.sprites.get(tile);
      if (!s) {
        s = new Sprite(t);
        const tx = tile % state.mapTiles;
        const ty = (tile - tx) / state.mapTiles;
        s.width = state.tile;
        s.height = state.tile;
        s.position.set(tx * state.tile, ty * state.tile);
        this.container.addChild(s);
        this.sprites.set(tile, s);
      }
      // A faint track at level 1 deepening into a packed road; heavy-traffic
      // tiles upgrade to the cobbled highway texture — busy trade arteries
      // visibly outgrow the side tracks that feed them.
      const f = Math.min(1, lvl / ROAD_LEVELS);
      const paved = f >= 0.6 && tex.tile_road2;
      const want = paved ? tex.tile_road2 : t;
      if (s.texture !== want) s.texture = want;
      s.alpha = paved ? 0.75 + 0.25 * f : 0.18 + 0.82 * f;
    }
  }

  // Hide off-screen road sprites (same viewport the entity layer uses).
  cull(view: Viewport, tile: number): void {
    for (const s of this.sprites.values()) {
      s.visible = !(s.x + tile < view.minX || s.x > view.maxX || s.y + tile < view.minY || s.y > view.maxY);
    }
  }
}
