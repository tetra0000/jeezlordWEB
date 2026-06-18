// Draws the static map background: a tiling grass sprite, a faint 32px grid, and
// the world border. The grass uses the generated tile_grass.png texture.
import { Container, Graphics, TilingSprite } from 'pixi.js';
import { tex } from './assets.js';

export function buildTileLayer(mapTiles: number, tile: number): Container {
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
