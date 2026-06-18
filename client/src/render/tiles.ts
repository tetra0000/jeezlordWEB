// Draws the static map background: a tiling grass sprite, the rivers/bridges from
// the terrain grid, a faint 32px grid, and the world border. Grass tiles
// everywhere; water/bridge sprites are stamped only on the (sparse) non-grass
// tiles, so the layer stays cheap to build.
import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { TERRAIN_WATER, TERRAIN_BRIDGE } from '../../../shared/constants.js';
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

  // Rivers + bridges. Water draws first (so bridges sit on top), each as a
  // texture sprite when available, falling back to flat colour.
  if (terrain) {
    const waterLayer = new Container();
    const bridgeLayer = new Container();
    for (let ty = 0; ty < mapTiles; ty++) {
      for (let tx = 0; tx < mapTiles; tx++) {
        const code = terrain[ty * mapTiles + tx];
        if (code !== TERRAIN_WATER && code !== TERRAIN_BRIDGE) continue;
        const isWater = code === TERRAIN_WATER;
        const t = isWater ? tex.tile_water : tex.tile_bridge;
        if (t) {
          const s = new Sprite(t);
          s.width = tile;
          s.height = tile;
          s.position.set(tx * tile, ty * tile);
          (isWater ? waterLayer : bridgeLayer).addChild(s);
        } else {
          const g = new Graphics();
          g.rect(tx * tile, ty * tile, tile, tile).fill(isWater ? 0x2c5a86 : 0x8a5a32);
          (isWater ? waterLayer : bridgeLayer).addChild(g);
        }
      }
    }
    layer.addChild(waterLayer);
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
