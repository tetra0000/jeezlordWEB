// Standalone generator for ONLY client/assets/market.png. Kept separate from
// gen-assets.mjs so adding the market sprite doesn't require regenerating (and
// possibly clobbering hand-reskinned) every other PNG. Greyscale + tintable, in
// the same house style. The same drawing is mirrored in gen-assets.mjs:market()
// so a full regen stays consistent.
//   node scripts/gen-market-asset.mjs
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets');
const L = [228, 228, 224], M = [168, 168, 162], D = [64, 64, 60], W = [245, 245, 245];

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
  circle(cx, cy, r, c, a = 255) { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) this.px(cx + xx, cy + yy, c, a); }
  outline(c = D) {
    const copy = this.d.slice();
    const op = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && copy[(y * this.w + x) * 4 + 3] > 40;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (op(x, y)) continue;
      if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1)) this.px(x, y, c);
    }
  }
  save(name) {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.d.buffer, 0, this.w * this.h * 4);
    writeFileSync(join(OUT, name + '.png'), PNG.sync.write(png));
  }
}

// 64x64 (footprint 2): a market stall — stone base, striped awning, a coin.
const im = new Img(64, 64);
im.rect(14, 30, 36, 28, L);       // stall body
im.rect(14, 30, 36, 3, W);        // top edge highlight
im.rect(14, 55, 36, 3, M);        // bottom shade
im.rect(22, 42, 20, 16, M);       // counter opening
// Striped awning overhanging the front.
for (let i = 0; i < 9; i++) im.rect(10 + i * 5, 24, 5, 8, i % 2 ? M : L);
im.rect(10, 24, 44, 2, W);        // awning lip
// A coin sitting on the counter (mid + highlight so it reads even when tinted).
im.circle(32, 50, 4, W);
im.circle(32, 50, 4, M, 0);
im.outline();
im.save('market');
console.log('[gen-market-asset] wrote client/assets/market.png');
