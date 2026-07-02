// Draws the static map background: a tiling grass sprite, per-tile sprites for
// the non-grass terrain (water/bridge/mountain/mud/beach/dirt/flowers), painted
// grass variation, a faint 32px grid, and the world border.
//
// Everything per-tile lives in CHUNKS (64x64 tiles each) that are shown/hidden
// against the camera rect every frame (cull()). On the 768-tile map the
// non-grass tiles run to tens of thousands of sprites — culling whole chunks
// keeps the scene graph traversal and draw cost proportional to the viewport,
// not the world.
import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import {
  TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_MOUNTAIN, TERRAIN_MUD, TERRAIN_BEACH,
  TERRAIN_DIRT, TERRAIN_FLOWERS,
} from '../../../shared/constants.js';
import type { Viewport } from './entities.js';
import { tex } from './assets.js';

const CHUNK = 64; // tiles per chunk edge

const TILE_TEX: Record<number, string> = {
  [TERRAIN_WATER]: 'tile_water',
  [TERRAIN_BRIDGE]: 'tile_bridge',
  [TERRAIN_MOUNTAIN]: 'tile_mountain',
  [TERRAIN_MUD]: 'tile_mud',
  [TERRAIN_BEACH]: 'tile_beach',
  [TERRAIN_DIRT]: 'tile_dirt',
  [TERRAIN_FLOWERS]: 'tile_flowers',
};
const TILE_FALLBACK: Record<number, number> = {
  [TERRAIN_WATER]: 0x2c5a86,
  [TERRAIN_BRIDGE]: 0x8a5a32,
  [TERRAIN_MOUNTAIN]: 0x56545a,
  [TERRAIN_MUD]: 0x6b4a2a,
  [TERRAIN_BEACH]: 0xd9c89a,
  [TERRAIN_DIRT]: 0x8a744e,
  [TERRAIN_FLOWERS]: 0x5a7a3e,
};

interface Chunk {
  node: Container;
  x0: number; // world-px bounds
  y0: number;
  x1: number;
  y1: number;
}

export class TileLayer {
  readonly container = new Container();
  private chunks: Chunk[] = [];

  build(mapTiles: number, tile: number, terrain: Uint8Array | null): void {
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    this.chunks = [];
    const sizePx = mapTiles * tile;

    if (tex.tile_grass) {
      const ground = new TilingSprite({ texture: tex.tile_grass, width: sizePx, height: sizePx });
      this.container.addChild(ground);
    } else {
      const bg = new Graphics();
      bg.rect(0, 0, sizePx, sizePx).fill(0x4a705a);
      this.container.addChild(bg);
    }

    const nChunks = Math.ceil(mapTiles / CHUNK);
    for (let cy = 0; cy < nChunks; cy++) {
      for (let cx = 0; cx < nChunks; cx++) {
        const node = new Container();
        const tx0 = cx * CHUNK;
        const ty0 = cy * CHUNK;
        const tx1 = Math.min(mapTiles, tx0 + CHUNK);
        const ty1 = Math.min(mapTiles, ty0 + CHUNK);

        // Painted grass variation, local to the chunk (so it culls with it):
        // a couple of big soft hue blobs + a scatter of small speckle patches,
        // deterministic per chunk so the map looks the same every session.
        {
          const variation = new Graphics();
          let seed = 1337 + cy * nChunks + cx;
          const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
          const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
          const px0 = tx0 * tile;
          const py0 = ty0 * tile;
          const w = (tx1 - tx0) * tile;
          const h = (ty1 - ty0) * tile;
          const hues = [0x6e8c3e, 0x46724a, 0x2f4a30, 0x7a8a4a, 0x4a6e6a];
          for (let i = 0; i < 8; i++) {
            const r = 60 + rnd() * 140;
            variation.ellipse(px0 + rnd() * w, py0 + rnd() * h, r, r * (0.6 + rnd() * 0.5))
              .fill({ color: pick(hues), alpha: 0.06 + rnd() * 0.06 });
          }
          const shades = [0x5c8048, 0x3a5234, 0x6f9450, 0x33482c, 0x5a6e3a];
          for (let i = 0; i < 120; i++) {
            variation.ellipse(px0 + rnd() * w, py0 + rnd() * h, 6 + rnd() * 16, 5 + rnd() * 12)
              .fill({ color: pick(shades), alpha: 0.05 + rnd() * 0.08 });
          }
          node.addChild(variation);
        }

        // Non-grass terrain tiles inside this chunk.
        if (terrain) {
          for (let ty = ty0; ty < ty1; ty++) {
            for (let tx = tx0; tx < tx1; tx++) {
              const code = terrain[ty * mapTiles + tx];
              const texName = TILE_TEX[code];
              if (!texName) continue;
              const t = tex[texName];
              if (t) {
                const s = new Sprite(t);
                s.width = tile;
                s.height = tile;
                s.position.set(tx * tile, ty * tile);
                node.addChild(s);
              } else {
                const g = new Graphics();
                g.rect(tx * tile, ty * tile, tile, tile).fill(TILE_FALLBACK[code] ?? 0x777777);
                node.addChild(g);
              }
            }
          }
        }

        this.container.addChild(node);
        this.chunks.push({
          node,
          x0: tx0 * tile, y0: ty0 * tile,
          x1: tx1 * tile, y1: ty1 * tile,
        });
      }
    }

    // Grid + border sit above the chunks and are always drawn (cheap).
    const grid = new Graphics();
    for (let i = 0; i <= mapTiles; i++) {
      const p = i * tile;
      grid.moveTo(p, 0).lineTo(p, sizePx);
      grid.moveTo(0, p).lineTo(sizePx, p);
    }
    grid.stroke({ width: 1, color: 0x000000, alpha: 0.06 });
    this.container.addChild(grid);

    const border = new Graphics();
    border.rect(0, 0, sizePx, sizePx).stroke({ width: 4, color: 0x222018 });
    this.container.addChild(border);
  }

  // Show only the chunks intersecting the (padded) camera rect. Called every
  // frame from the main loop with the same viewport the entity layer uses.
  cull(view: Viewport): void {
    for (const ch of this.chunks) {
      ch.node.visible = !(ch.x1 < view.minX || ch.x0 > view.maxX || ch.y1 < view.minY || ch.y0 > view.maxY);
    }
  }
}
