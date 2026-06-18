// Generates placeholder sprite PNGs into client/assets/. Units and buildings are
// drawn in greyscale so the client can tint them by owner colour (team colour);
// resources, tiles and effects keep their own colours. Replace these PNGs with
// real art later — the filenames (one per kind) are the contract.
//
//   node scripts/gen-assets.mjs
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets');
mkdirSync(OUT, { recursive: true });

// Tintable greyscale palette (multiply by owner colour on the client).
const L = [228, 228, 224]; // light (takes team colour strongly)
const M = [168, 168, 162]; // mid shade
const D = [64, 64, 60]; // dark outline / detail
const W = [245, 245, 245]; // near-white highlight

class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  px(x, y, c, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const af = a / 255;
    const ia = 1 - af;
    this.d[i] = c[0] * af + this.d[i] * ia;
    this.d[i + 1] = c[1] * af + this.d[i + 1] * ia;
    this.d[i + 2] = c[2] * af + this.d[i + 2] * ia;
    this.d[i + 3] = Math.min(255, this.d[i + 3] + a);
  }
  rect(x, y, w, h, c, a = 255) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, c, a);
  }
  circle(cx, cy, r, c, a = 255) {
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++)
        if (xx * xx + yy * yy <= r * r) this.px(cx + xx, cy + yy, c, a);
  }
  ellipse(cx, cy, rx, ry, c, a = 255) {
    for (let yy = -ry; yy <= ry; yy++)
      for (let xx = -rx; xx <= rx; xx++)
        if ((xx * xx) / (rx * rx) + (yy * yy) / (ry * ry) <= 1) this.px(cx + xx, cy + yy, c, a);
  }
  line(x0, y0, x1, y1, c, thick = 1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick, c);
    }
  }
  // Dark 1px outline pass: any opaque pixel adjacent to a transparent one.
  outline(c = D) {
    const copy = this.d.slice();
    const op = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && copy[(y * this.w + x) * 4 + 3] > 40;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
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

// --- units (32x32, tintable) -----------------------------------------------
function villager() {
  const im = new Img(32, 32);
  im.rect(12, 16, 8, 11, L); // torso
  im.circle(16, 11, 5, L); // head
  im.rect(11, 26, 3, 5, M); // legs
  im.rect(18, 26, 3, 5, M);
  im.outline();
  im.save('villager');
}
function infantry() {
  const im = new Img(32, 32);
  im.rect(11, 14, 10, 13, L); // armoured torso
  im.circle(16, 9, 5, L);
  im.rect(10, 27, 4, 4, M);
  im.rect(18, 27, 4, 4, M);
  im.line(24, 6, 24, 22, M, 1); // sword
  im.line(21, 9, 27, 9, M, 1); // crossguard
  im.outline();
  im.save('infantry');
}
function archer() {
  const im = new Img(32, 32);
  im.rect(12, 14, 8, 12, L);
  im.circle(16, 9, 5, L);
  im.rect(11, 26, 3, 5, M);
  im.rect(18, 26, 3, 5, M);
  for (let a = -1.1; a <= 1.1; a += 0.12) im.px(24 + Math.cos(a) * 8, 16 + Math.sin(a) * 8, M); // bow arc
  im.line(24, 8, 24, 24, M, 0); // string
  im.outline();
  im.save('archer');
}
function cavalry() {
  const im = new Img(32, 32);
  im.ellipse(16, 19, 11, 6, L); // mount body
  im.rect(7, 22, 3, 7, M); // legs
  im.rect(13, 22, 3, 7, M);
  im.rect(22, 22, 3, 7, M);
  im.ellipse(25, 14, 4, 3, L); // head
  im.rect(14, 6, 5, 9, L); // rider
  im.circle(16, 5, 3, L);
  im.outline();
  im.save('cavalry');
}
function horse() {
  const im = new Img(32, 32);
  im.ellipse(16, 20, 13, 7, L); // big mount
  im.rect(6, 24, 3, 7, M);
  im.rect(12, 24, 3, 7, M);
  im.rect(20, 24, 3, 7, M);
  im.rect(25, 24, 3, 7, M);
  im.ellipse(27, 13, 4, 3, L);
  im.rect(13, 3, 6, 11, L); // armoured rider
  im.circle(16, 3, 3, L);
  im.line(20, 2, 20, 16, M, 0); // lance
  im.outline();
  im.save('horse');
}
function catapult() {
  const im = new Img(32, 32);
  im.rect(8, 16, 18, 9, M); // frame
  im.circle(12, 26, 4, D); // wheels
  im.circle(22, 26, 4, D);
  im.line(10, 22, 24, 8, L, 1); // throwing arm
  im.circle(24, 8, 3, L); // bucket
  im.outline();
  im.save('catapult');
}

// --- buildings (square footprint*32, tintable) -----------------------------
function box(im, x, y, w, h) {
  im.rect(x, y, w, h, L);
  im.rect(x, y, w, 3, W); // top edge highlight
  im.rect(x, y + h - 3, w, 3, M); // bottom shade
}
function townCenter() {
  const s = 96;
  const im = new Img(s, s);
  box(im, 14, 34, 68, 54);
  // pitched roof
  for (let i = 0; i < 30; i++) im.rect(48 - i, 34 - i, 2 * i, 2, M);
  im.rect(40, 60, 16, 28, M); // door
  im.rect(22, 44, 12, 12, D); // windows
  im.rect(62, 44, 12, 12, D);
  im.outline();
  im.save('townCenter');
}
function house() {
  const s = 64;
  const im = new Img(s, s);
  box(im, 12, 28, 40, 30);
  for (let i = 0; i < 22; i++) im.rect(32 - i, 28 - i, 2 * i, 2, M);
  im.rect(26, 40, 12, 18, M); // door
  im.outline();
  im.save('house');
}
function mill() {
  const s = 64;
  const im = new Img(s, s);
  box(im, 14, 26, 36, 32);
  im.circle(46, 36, 12, M); // wheel
  im.circle(46, 36, 12, D, 0);
  for (let a = 0; a < 6.28; a += 0.78) im.line(46, 36, 46 + Math.cos(a) * 12, 36 + Math.sin(a) * 12, D, 0);
  im.outline();
  im.save('mill');
}
function lumbercamp() {
  const s = 32;
  const im = new Img(s, s);
  box(im, 6, 14, 16, 14);
  im.ellipse(24, 22, 6, 3, [120, 82, 44]); // log pile (wood colour reads even tinted)
  im.outline();
  im.save('lumbercamp');
}
function miningcamp() {
  const s = 32;
  const im = new Img(s, s);
  box(im, 6, 14, 16, 14);
  im.line(22, 24, 28, 14, M, 1); // pick handle
  im.line(25, 12, 31, 16, D, 1); // pick head
  im.outline();
  im.save('miningcamp');
}
function militaryBuilding(name, glyphDraw) {
  const s = 96;
  const im = new Img(s, s);
  box(im, 12, 30, 72, 58);
  im.rect(40, 58, 16, 30, M); // gate
  glyphDraw(im);
  im.outline();
  im.save(name);
}

// --- resources (colored, no tint) ------------------------------------------
function tree() {
  const im = new Img(32, 32);
  im.rect(14, 20, 5, 10, [104, 70, 38]); // trunk
  im.circle(16, 14, 11, [54, 110, 46]); // canopy
  im.circle(12, 12, 6, [64, 124, 54]);
  im.circle(21, 13, 6, [46, 98, 40]);
  im.outline([30, 50, 26]);
  im.save('tree');
}
function gold() {
  const im = new Img(32, 32);
  im.circle(16, 20, 11, [120, 118, 120]); // rock
  im.circle(13, 18, 3, [245, 205, 70]); // nuggets
  im.circle(20, 21, 3, [255, 220, 90]);
  im.circle(16, 15, 2, [255, 230, 120]);
  im.outline([60, 58, 60]);
  im.save('gold');
}
function stone() {
  const im = new Img(32, 32);
  im.circle(13, 21, 7, [150, 150, 156]);
  im.circle(21, 19, 8, [168, 168, 174]);
  im.circle(17, 23, 6, [132, 132, 140]);
  im.outline([70, 70, 76]);
  im.save('stone');
}
function berry() {
  const im = new Img(32, 32);
  im.circle(16, 19, 11, [58, 116, 52]); // bush
  for (const [x, y] of [[12, 16], [20, 17], [16, 22], [11, 22], [22, 23], [16, 14]])
    im.circle(x, y, 2, [206, 54, 64]); // berries
  im.outline([32, 64, 30]);
  im.save('berry');
}

// --- tile + effects --------------------------------------------------------
function grass() {
  const im = new Img(32, 32);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [74, 112, 60]);
  for (let i = 0; i < 90; i++) {
    const c = rnd() > 0.5 ? [82, 124, 66] : [64, 100, 52];
    im.px(rnd() * 32, rnd() * 32, c);
  }
  im.save('tile_grass');
}
function water() {
  const im = new Img(32, 32);
  let seed = 778;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [40, 92, 140]); // deep blue base
  for (let i = 0; i < 70; i++) im.px(rnd() * 32, rnd() * 32, rnd() > 0.5 ? [52, 108, 158] : [34, 80, 126]);
  // A couple of horizontal wave crests (kept off the tile edges to tile cleanly).
  for (const wy of [9, 20, 27]) {
    for (let x = 3; x < 29; x++) im.px(x, wy + Math.round(Math.sin((x + wy) * 0.6) * 1.2), [120, 170, 210], 180);
  }
  im.save('tile_water');
}
function bridge() {
  const im = new Img(32, 32);
  im.rect(0, 0, 32, 32, [120, 82, 44]); // plank wood
  im.rect(0, 0, 32, 32, [96, 64, 34], 0); // (base)
  // Plank seams across, plus two support rails along the edges.
  for (let y = 4; y < 32; y += 6) im.rect(0, y, 32, 2, [80, 52, 26]);
  im.rect(0, 1, 32, 3, [150, 108, 62]); // top rail highlight
  im.rect(0, 28, 32, 3, [88, 58, 30]); // bottom rail shade
  for (let x = 0; x < 32; x += 1) if ((x & 7) === 0) im.rect(x, 0, 1, 32, [100, 68, 36], 120);
  im.save('tile_bridge');
}
function fx(name, draw) {
  const im = new Img(16, 16);
  draw(im);
  im.save('fx_' + name);
}

villager();
infantry();
archer();
cavalry();
horse();
catapult();
townCenter();
house();
mill();
lumbercamp();
miningcamp();
militaryBuilding('barracks', (im) => im.line(34, 44, 50, 44, D, 1)); // sword glyph
militaryBuilding('range', (im) => {
  im.circle(48, 50, 9, D, 0);
  im.circle(48, 50, 5, D, 0);
  im.circle(48, 50, 2, D);
});
militaryBuilding('stable', (im) => im.ellipse(48, 50, 10, 5, M));
(() => {
  // tower: tall, footprint 1 -> 32px square, drawn as a turret
  const im = new Img(32, 32);
  im.rect(9, 8, 14, 22, L);
  for (let x = 9; x < 23; x += 5) im.rect(x, 5, 3, 4, M); // battlements
  im.rect(13, 16, 6, 7, D); // window
  im.outline();
  im.save('tower');
})();
(() => {
  const im = new Img(32, 32); // wall block
  im.rect(2, 8, 28, 18, L);
  for (let x = 2; x < 30; x += 7) im.rect(x, 4, 5, 4, M); // crenellations
  im.line(2, 17, 30, 17, M, 0);
  im.outline();
  im.save('wall');
})();
(() => {
  const im = new Img(64, 64); // farm: tilled field
  im.rect(8, 8, 48, 48, [150, 120, 70]);
  for (let y = 12; y < 56; y += 6) im.rect(8, y, 48, 2, [120, 92, 52]);
  im.outline([90, 70, 40]);
  im.save('farm');
})();
tree();
gold();
stone();
berry();
grass();
water();
bridge();

fx('chop', (im) => { for (const [x, y] of [[6, 6], [9, 5], [7, 9], [10, 9]]) im.rect(x, y, 2, 2, [150, 100, 50]); });
fx('spark', (im) => { im.line(3, 8, 13, 8, [255, 224, 90], 0); im.line(8, 3, 8, 13, [255, 224, 90], 0); im.circle(8, 8, 2, [255, 245, 180]); });
fx('dust', (im) => { for (const [x, y, r] of [[5, 9, 2], [9, 7, 2], [11, 10, 2]]) im.circle(x, y, r, [200, 200, 200], 200); });
fx('leaf', (im) => { im.ellipse(8, 8, 4, 2, [120, 200, 90]); });
fx('slash', (im) => { for (let a = -0.6; a < 0.6; a += 0.08) im.px(8 + Math.cos(a) * 6, 8 + Math.sin(a) * 6, [255, 255, 255]); im.circle(8, 8, 1, [255, 220, 220]); });

console.log('[gen-assets] wrote sprites to client/assets/');
