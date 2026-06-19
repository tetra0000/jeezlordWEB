// Draws the static map background: a tiling grass sprite, the rivers/bridges from
// the terrain grid, a faint 32px grid, and the world border. Grass tiles
// everywhere; water/bridge sprites are stamped only on the (sparse) non-grass
// tiles, so the layer stays cheap to build.
import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_MOUNTAIN, TERRAIN_MUD, TERRAIN_BEACH } from '../../../shared/constants.js';
import { tex } from './assets.js';

export function buildTileLayer(mapTiles: number, tile: number, terrain: Uint8Array | null): Container {
  const layer = new Container();
  const sizePx = mapTiles * tile;

  if (tex.tile_grass) {
    const ground = new TilingSprite({ texture: tex.tile_grass, width: sizePx, height: sizePx });
    layer.addChild(ground);
  } else {
    const bg = new Graphics();
    bg.rect(0, 0, sizePx, sizePx).fill(0x4a705a);
    layer.addChild(bg);
  }

  // Subtle ground variation so the repeating grass tile doesn't read as a uniform
  // grid: a sparse scatter of faint lighter/darker patches, drawn once. Water /
  // mountains / bridges are stamped on top below, so this only shows on grass.
  {
    const variation = new Graphics();
    let seed = 1337;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const patches = Math.floor((mapTiles * mapTiles) / 45);
    for (let i = 0; i < patches; i++) {
      const x = rnd() * sizePx;
      const y = rnd() * sizePx;
      const rx = 8 + rnd() * 18;
      const ry = 6 + rnd() * 14;
      const col = rnd() > 0.5 ? 0x5c8048 : 0x3a5234;
      variation.ellipse(x, y, rx, ry).fill({ color: col, alpha: 0.05 + rnd() * 0.07 });
    }
    layer.addChild(variation);
  }

  // Non-grass terrain: water/mountains draw first, then bridges on top, each as a
  // texture sprite when available, falling back to flat colour.
  if (terrain) {
    const baseLayer = new Container(); // water + mountains
    const bridgeLayer = new Container();
    for (let ty = 0; ty < mapTiles; ty++) {
      for (let tx = 0; tx < mapTiles; tx++) {
        const code = terrain[ty * mapTiles + tx];
        if (code === undefined) continue;
        if (code !== TERRAIN_WATER && code !== TERRAIN_BRIDGE && code !== TERRAIN_MOUNTAIN
          && code !== TERRAIN_MUD && code !== TERRAIN_BEACH) continue;
        const t = code === TERRAIN_WATER ? tex.tile_water
          : code === TERRAIN_MOUNTAIN ? tex.tile_mountain
          : code === TERRAIN_MUD ? tex.tile_mud
          : code === TERRAIN_BEACH ? tex.tile_beach
          : tex.tile_bridge;
        if (t) {
          const s = new Sprite(t);
          s.width = tile;
          s.height = tile;
          s.position.set(tx * tile, ty * tile);
          (code === TERRAIN_BRIDGE ? bridgeLayer : baseLayer).addChild(s);
        } else {
          const fallback = code === TERRAIN_WATER ? 0x2c5a86 : code === TERRAIN_MOUNTAIN ? 0x56545a
            : code === TERRAIN_MUD ? 0x6b4a2a : code === TERRAIN_BEACH ? 0xd9c89a : 0x8a5a32;
          const g = new Graphics();
          g.rect(tx * tile, ty * tile, tile, tile).fill(fallback);
          (code === TERRAIN_BRIDGE ? bridgeLayer : baseLayer).addChild(g);
        }
      }
    }
    layer.addChild(baseLayer);
    layer.addChild(bridgeLayer);
  }

  const grid = new Graphics();
  for (let i = 0; i <= mapTiles; i++) {
    const p = i * tile;
    grid.moveTo(p, 0).lineTo(p, sizePx);
    grid.moveTo(0, p).lineTo(sizePx, p);
  }
  grid.stroke({ width: 1, color: 0x000000, alpha: 0.06 });
  layer.addChild(grid);

  const border = new Graphics();
  border.rect(0, 0, sizePx, sizePx).stroke({ width: 4, color: 0x222018 });
  layer.addChild(border);

  return layer;
}
