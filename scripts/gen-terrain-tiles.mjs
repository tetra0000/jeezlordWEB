// Standalone generator for the new terrain tiles: tile_mud.png + tile_beach.png.
// Kept separate from gen-assets.mjs so we don't regenerate (and risk clobbering
// hand-reskinned) every other PNG. The same draws are mirrored in gen-assets.mjs.
//   node scripts/gen-terrain-tiles.mjs
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets');

class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  px(x, y, c, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, af = a / 255, ia = 1 - af;
    this.d[i] = c[0] * af + this.d[i] * ia;
    this.d[i + 1] = c[1] * af + this.d[i + 1] * ia;
    this.d[i + 2] = c[2] * af + this.d[i + 2] * ia;
    this.d[i + 3] = Math.min(255, this.d[i + 3] + a);
  }
  rect(x, y, w, h, c, a = 255) { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, c, a); }
  save(name) {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.d.buffer, 0, this.w * this.h * 4);
    writeFileSync(join(OUT, name + '.png'), PNG.sync.write(png));
  }
}

// Deterministic per-tile noise so the tiles read as textured ground, not flat.
function noisy(name, base, specks) {
  const im = new Img(32, 32);
  let seed = name.length * 7919 + 13;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, base);
  for (let i = 0; i < 90; i++) {
    const c = specks[Math.floor(rnd() * specks.length)];
    im.px(rnd() * 32, rnd() * 32, c, 150 + rnd() * 90);
  }
  im.save(name);
}

// Mud: wet brown with darker/lighter mottling.
noisy('tile_mud', [104, 76, 46], [[88, 62, 36], [122, 92, 58], [72, 50, 30]]);
// Beach: pale sand with a few pebbles + darker grains.
noisy('tile_beach', [216, 200, 150], [[230, 216, 168], [196, 178, 130], [168, 150, 110]]);
console.log('[gen-terrain-tiles] wrote tile_mud.png + tile_beach.png');
