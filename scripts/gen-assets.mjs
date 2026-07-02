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

// --- shared drawing helpers ---------------------------------------------------
// Soft elliptical ground shadow under a unit (reads at any tint).
function shadow(im, cx, cy, rx = 8, ry = 3) {
  im.ellipse(cx, cy, rx, ry, [16, 16, 12], 80);
}
// A two-tone humanoid: lit torso with a shaded right edge, head, and legs.
// Gives every figure a consistent, readable silhouette with cheap depth.
function body(im, x, y, w, h) {
  im.rect(x, y, w, h, L);
  im.rect(x + w - 2, y, 2, h, M); // shaded edge
  im.rect(x, y, w, 1, W); // shoulder highlight
}
function head(im, cx, cy, r = 5, helmet = false) {
  im.circle(cx, cy, r, L);
  im.px(cx - 2, cy, D); // eyes read as a face at a glance
  im.px(cx + 2, cy, D);
  if (helmet) {
    im.rect(cx - r, cy - r, r * 2 + 1, r - 1, M); // helm dome
    im.rect(cx - r, cy - 2, r * 2 + 1, 1, D); // brim
  }
}
function legs(im, cx, y, gap = 3, h = 5) {
  im.rect(cx - gap - 1, y, 3, h, M);
  im.rect(cx + gap - 1, y, 3, h, M);
}

// --- units (32x32, tintable) -----------------------------------------------
function villager() {
  const im = new Img(32, 32);
  shadow(im, 16, 29, 7, 2);
  body(im, 12, 16, 8, 11);
  head(im, 16, 11);
  legs(im, 16, 26);
  im.line(22, 24, 25, 15, M, 0); // walking staff
  im.outline();
  im.save('villager');
}
function militia() {
  // A rough figure with a club — cheap rabble, bare head, ragged tunic.
  const im = new Img(32, 32);
  shadow(im, 16, 30, 8, 2);
  body(im, 12, 16, 8, 11);
  im.px(13, 22, M); // patched tunic
  im.px(17, 19, M);
  head(im, 16, 11);
  legs(im, 16, 26);
  im.line(23, 22, 27, 8, M, 1); // raised club
  im.circle(27, 8, 2, M); // club head
  im.px(27, 7, W);
  im.outline();
  im.save('militia');
}
function warrior() {
  const im = new Img(32, 32);
  shadow(im, 16, 30, 9, 2);
  body(im, 11, 14, 10, 13);
  im.rect(11, 12, 10, 2, M); // shoulder plate
  im.rect(11, 20, 10, 1, M); // belt
  head(im, 16, 9, 5, true); // helmed
  legs(im, 16, 27, 4, 4);
  im.line(24, 6, 24, 22, W, 1); // sword blade
  im.line(21, 9, 27, 9, M, 1); // crossguard
  im.circle(8, 19, 4, M); // round shield
  im.circle(8, 19, 4, D, 0);
  im.circle(8, 19, 1, W); // boss
  im.outline();
  im.save('warrior');
}
function spearman() {
  const im = new Img(32, 32);
  shadow(im, 16, 30, 8, 2);
  body(im, 12, 15, 8, 12);
  im.rect(12, 15, 8, 2, M); // leather cuirass line
  head(im, 16, 10, 5, true);
  legs(im, 16, 27, 3, 4);
  im.line(23, 28, 27, 4, M, 0); // long spear shaft
  im.rect(26, 2, 3, 5, W); // spearhead
  im.px(27, 7, M); // socket
  im.rect(6, 15, 3, 8, M); // tall shield on the off arm
  im.rect(6, 15, 3, 1, W);
  im.outline();
  im.save('spearman');
}
function archer() {
  const im = new Img(32, 32);
  shadow(im, 16, 30, 8, 2);
  body(im, 12, 14, 8, 12);
  head(im, 16, 9);
  im.rect(12, 5, 8, 2, M); // hood
  legs(im, 16, 26);
  for (let a = -1.1; a <= 1.1; a += 0.12) im.px(24 + Math.cos(a) * 8, 16 + Math.sin(a) * 8, M); // bow arc
  im.line(24, 8, 24, 24, W, 0); // string
  im.line(18, 16, 24, 16, D, 0); // nocked arrow
  im.outline();
  im.save('archer');
}
function longbowman() {
  // Like the archer but with a taller bow (nearly body height) + quiver.
  const im = new Img(32, 32);
  shadow(im, 16, 30, 8, 2);
  body(im, 12, 14, 8, 12);
  head(im, 16, 9);
  im.rect(12, 5, 8, 2, M); // hood
  legs(im, 16, 26);
  for (let a = -1.35; a <= 1.35; a += 0.1) im.px(24 + Math.cos(a) * 11, 15 + Math.sin(a) * 11, M); // tall bow arc
  im.line(24, 4, 24, 26, W, 0); // long string
  im.rect(8, 12, 3, 9, M); // quiver on the back
  im.line(9, 10, 9, 12, W, 0); // arrow fletchings
  im.px(8, 11, W);
  im.outline();
  im.save('longbowman');
}
// A shaded mount: body ellipse with belly shade, mane, tail, muzzle and legs.
function mount(im, cx, cy, rx, ry) {
  im.ellipse(cx, cy, rx, ry, L);
  im.ellipse(cx, cy + Math.max(1, ry - 2), rx - 2, 2, M); // belly shade
  im.line(cx - rx, cy, cx - rx - 2, cy + 5, M, 1); // tail
}
function scoutCavalry() {
  // A light, lean mount with a slim rider carrying a pennant — reads as a fast
  // recon rider rather than a heavy cavalryman.
  const im = new Img(32, 32);
  shadow(im, 16, 30, 11, 2);
  mount(im, 15, 20, 10, 4);
  im.rect(8, 23, 2, 6, M); // legs (thin)
  im.rect(13, 23, 2, 6, M);
  im.rect(21, 23, 2, 6, M);
  im.ellipse(24, 16, 3, 2, L); // head
  im.rect(22, 13, 2, 3, M); // mane
  im.line(27, 16, 30, 18, M, 0); // muzzle
  body(im, 13, 8, 4, 8); // slim rider
  head(im, 15, 6, 3);
  im.line(19, 4, 19, 14, M, 0); // pennant pole
  im.rect(19, 4, 5, 3, W); // pennant flag
  im.outline();
  im.save('scoutCavalry');
}
function knight() {
  const im = new Img(32, 32);
  shadow(im, 16, 31, 13, 2);
  mount(im, 16, 20, 13, 7);
  im.rect(6, 24, 3, 7, M);
  im.rect(12, 24, 3, 7, M);
  im.rect(20, 24, 3, 7, M);
  im.rect(25, 24, 3, 7, M);
  im.ellipse(27, 13, 4, 3, L); // head
  im.rect(24, 10, 3, 3, M); // mane
  im.rect(10, 20, 12, 3, M); // barding stripe
  im.rect(10, 20, 12, 1, W);
  body(im, 13, 3, 6, 11); // armoured rider
  head(im, 16, 3, 3, true);
  im.line(20, 2, 20, 16, M, 0); // lance
  im.px(20, 1, W); // lance tip
  im.rect(9, 8, 3, 6, M); // kite shield
  im.outline();
  im.save('knight');
}
function horseArcher() {
  const im = new Img(32, 32);
  shadow(im, 16, 31, 11, 2);
  mount(im, 15, 20, 11, 5);
  im.rect(7, 23, 3, 7, M);
  im.rect(13, 23, 3, 7, M);
  im.rect(21, 23, 3, 7, M);
  im.ellipse(25, 15, 3, 2, L); // head
  im.rect(23, 12, 2, 3, M); // mane
  body(im, 13, 7, 5, 9); // rider twisted to shoot
  head(im, 15, 5, 3);
  for (let a = -0.9; a <= 0.9; a += 0.12) im.px(21 + Math.cos(a) * 6, 10 + Math.sin(a) * 6, M); // compact bow
  im.line(21, 4, 21, 16, W, 0); // string
  im.outline();
  im.save('horseArcher');
}
function caravan() {
  // A covered trade wagon pulled by a mule: cart body, canvas hood, two wheels.
  const im = new Img(32, 32);
  im.rect(8, 15, 14, 8, M); // cart bed
  for (let i = 0; i < 7; i++) im.rect(9 + i, 9 + Math.abs(3 - i) * 0.6, 12 - 0, 2, W); // rounded canvas hood
  im.rect(9, 11, 12, 5, W); // hood body
  im.circle(11, 25, 4, D); // wheels
  im.circle(19, 25, 4, D);
  im.circle(11, 25, 1, M);
  im.circle(19, 25, 1, M);
  im.ellipse(26, 19, 4, 3, L); // mule
  im.rect(24, 22, 2, 6, M); // mule legs
  im.rect(28, 22, 2, 6, M);
  im.ellipse(29, 15, 2, 2, L); // mule head
  im.line(22, 18, 25, 18, D, 0); // harness
  im.outline();
  im.save('caravan');
}
function catapult() {
  const im = new Img(32, 32);
  shadow(im, 17, 30, 11, 2);
  im.rect(8, 16, 18, 9, M); // frame
  im.rect(8, 16, 18, 2, L); // lit rail
  im.line(10, 18, 24, 18, D, 0); // frame brace
  im.circle(12, 26, 4, D); // wheels
  im.circle(22, 26, 4, D);
  im.circle(12, 26, 1, M); // hubs
  im.circle(22, 26, 1, M);
  im.line(10, 22, 24, 8, L, 1); // throwing arm
  im.circle(24, 8, 3, L); // bucket
  im.circle(24, 8, 1, D); // stone in the bucket
  im.outline();
  im.save('catapult');
}

// --- buildings (square footprint*32, tintable) -----------------------------
// A textured wall block: plank/course lines, a lit top edge and shaded base.
function box(im, x, y, w, h) {
  im.rect(x, y, w, h, L);
  for (let yy = y + 5; yy < y + h - 3; yy += 5) im.rect(x, yy, w, 1, M, 130); // wall courses
  im.rect(x, y, w, 2, W); // top edge highlight
  im.rect(x, y + h - 3, w, 3, M); // bottom shade
  im.rect(x, y, 1, h, W, 90); // lit left edge
  im.rect(x + w - 2, y, 2, h, M, 150); // shaded right edge
}
// A pitched, shingled roof rising from (cx, baseY) to a peak `rise` px up.
function roof(im, cx, baseY, halfW, rise) {
  for (let i = 0; i < rise; i++) {
    const w = Math.round(halfW * (1 - i / rise));
    const c = i % 3 === 2 ? M : (i > rise - 4 ? W : L);
    im.rect(cx - w, baseY - i, w * 2, 1, c);
  }
}
// A framed door and a framed window.
function door(im, x, y, w, h) {
  im.rect(x - 1, y - 1, w + 2, h + 1, D); // frame
  im.rect(x, y, w, h, M);
  im.px(x + w - 2, y + Math.floor(h / 2), W); // handle
}
function windowPane(im, x, y, w = 8, h = 8) {
  im.rect(x - 1, y - 1, w + 2, h + 2, M); // frame
  im.rect(x, y, w, h, D);
  im.px(x + 1, y + 1, W); // glint
}
function townCenter() {
  const s = 96;
  const im = new Img(s, s);
  im.ellipse(48, 88, 40, 6, [16, 16, 12], 60); // ground shadow
  box(im, 14, 40, 68, 48);
  roof(im, 48, 40, 38, 26); // main shingled roof
  im.rect(44, 8, 2, 12, D); // banner pole on the ridge
  im.rect(46, 8, 8, 5, W); // banner (tints to team colour)
  door(im, 40, 62, 16, 26);
  windowPane(im, 22, 48, 10, 10);
  windowPane(im, 64, 48, 10, 10);
  im.rect(14, 58, 68, 1, M); // string course
  im.outline();
  im.save('townCenter');
}
function house() {
  const s = 64;
  const im = new Img(s, s);
  im.ellipse(32, 58, 26, 4, [16, 16, 12], 60);
  box(im, 12, 30, 40, 28);
  roof(im, 32, 30, 24, 16);
  im.rect(40, 10, 4, 8, M); // chimney
  im.rect(40, 9, 4, 2, W);
  door(im, 26, 42, 10, 16);
  windowPane(im, 15, 36, 7, 7);
  windowPane(im, 42, 36, 7, 7);
  im.outline();
  im.save('house');
}
function mill() {
  const s = 64;
  const im = new Img(s, s);
  im.ellipse(32, 58, 26, 4, [16, 16, 12], 60);
  box(im, 12, 28, 34, 30);
  roof(im, 29, 28, 20, 12);
  door(im, 22, 44, 10, 14);
  im.circle(48, 38, 13, M); // water wheel
  im.circle(48, 38, 13, D, 0);
  im.circle(48, 38, 3, D);
  for (let a = 0; a < 6.28; a += 0.78) im.line(48, 38, 48 + Math.cos(a) * 12, 38 + Math.sin(a) * 12, D, 0);
  im.outline();
  im.save('mill');
}
function lumbercamp() {
  const s = 32;
  const im = new Img(s, s);
  im.ellipse(16, 29, 13, 2, [16, 16, 12], 60);
  box(im, 5, 14, 15, 14);
  roof(im, 12, 14, 9, 6);
  im.ellipse(25, 23, 6, 3, [120, 82, 44]); // log pile (wood colour reads even tinted)
  im.ellipse(25, 21, 5, 2, [140, 98, 54]);
  im.line(24, 12, 28, 6, M, 1); // leaning axe
  im.rect(27, 4, 3, 3, W);
  im.outline();
  im.save('lumbercamp');
}
function miningcamp() {
  const s = 32;
  const im = new Img(s, s);
  im.ellipse(16, 29, 13, 2, [16, 16, 12], 60);
  box(im, 5, 14, 15, 14);
  roof(im, 12, 14, 9, 6);
  im.line(22, 24, 28, 14, M, 1); // pick handle
  im.line(25, 12, 31, 16, D, 1); // pick head
  im.circle(25, 26, 2, [150, 150, 156]); // ore chunks
  im.circle(29, 25, 2, [168, 168, 174]);
  im.outline();
  im.save('miningcamp');
}
function market() {
  // 64x64 (footprint 2): a market stall — body, striped awning, crates, a coin.
  const s = 64;
  const im = new Img(s, s);
  im.ellipse(32, 58, 26, 4, [16, 16, 12], 60);
  box(im, 14, 30, 36, 28);
  im.rect(22, 42, 20, 16, M); // counter opening
  im.rect(22, 42, 20, 2, D); // counter shade
  for (let i = 0; i < 9; i++) im.rect(10 + i * 5, 22, 5, 10, i % 2 ? M : W); // striped awning
  im.rect(10, 22, 44, 2, W); // awning lip
  im.rect(9, 22, 2, 36, M); // awning posts
  im.rect(53, 22, 2, 36, M);
  im.rect(52, 48, 9, 9, [140, 104, 60]); // crate
  im.rect(52, 52, 9, 1, [96, 70, 40]);
  im.circle(32, 50, 4, W); // coin
  im.circle(32, 50, 4, M, 0);
  im.outline();
  im.save('market');
}
function militaryBuilding(name, glyphDraw) {
  const s = 96;
  const im = new Img(s, s);
  im.ellipse(48, 90, 40, 5, [16, 16, 12], 60);
  box(im, 12, 34, 72, 54);
  // Crenellated parapet instead of a roof — reads as a military work.
  for (let x = 12; x < 84; x += 10) im.rect(x, 26, 6, 8, L);
  im.rect(12, 32, 72, 3, M);
  im.rect(40, 58, 16, 30, M); // gate
  im.rect(40, 58, 16, 3, D); // gate arch shadow
  im.rect(47, 58, 2, 30, D); // double doors
  glyphDraw(im);
  im.outline();
  im.save(name);
}

// --- resources (colored, no tint) ------------------------------------------
function tree() {
  const im = new Img(32, 32);
  im.ellipse(16, 29, 9, 2, [24, 34, 20], 110); // canopy shadow on the ground
  im.rect(14, 20, 5, 10, [104, 70, 38]); // trunk
  im.rect(14, 20, 2, 10, [126, 88, 48]); // lit side of the trunk
  im.circle(16, 14, 11, [54, 110, 46]); // canopy
  im.circle(12, 11, 6, [72, 134, 58]); // sunlit lobe (upper-left)
  im.circle(21, 13, 6, [42, 92, 38]); // shaded lobe
  im.circle(17, 8, 4, [86, 148, 66]); // crown highlight
  for (const [x, y] of [[10, 16], [19, 18], [14, 12], [22, 10]]) im.px(x, y, [96, 158, 74]); // leaf glints
  im.outline([30, 50, 26]);
  im.save('tree');
}
function gold() {
  const im = new Img(32, 32);
  im.ellipse(16, 28, 11, 2, [24, 24, 20], 110);
  im.circle(16, 20, 11, [120, 118, 120]); // rock
  im.circle(12, 16, 5, [138, 136, 138]); // lit face
  im.circle(20, 24, 5, [100, 98, 102]); // shaded face
  im.circle(13, 18, 3, [245, 205, 70]); // nuggets
  im.circle(20, 21, 3, [255, 220, 90]);
  im.circle(16, 14, 2, [255, 230, 120]);
  im.px(13, 17, [255, 245, 170]); // sparkle
  im.px(20, 20, [255, 245, 170]);
  im.outline([60, 58, 60]);
  im.save('gold');
}
function stone() {
  const im = new Img(32, 32);
  im.ellipse(17, 28, 11, 2, [24, 24, 20], 110);
  im.circle(13, 21, 7, [150, 150, 156]);
  im.circle(21, 19, 8, [168, 168, 174]);
  im.circle(17, 23, 6, [132, 132, 140]);
  im.circle(22, 16, 4, [190, 190, 196]); // lit top facet
  im.line(18, 20, 24, 22, [110, 110, 118], 0); // crack
  im.outline([70, 70, 76]);
  im.save('stone');
}
function berry() {
  const im = new Img(32, 32);
  im.ellipse(16, 28, 10, 2, [24, 34, 20], 110);
  im.circle(16, 19, 11, [58, 116, 52]); // bush
  im.circle(12, 15, 5, [74, 136, 62]); // lit side
  for (const [x, y] of [[12, 16], [20, 17], [16, 22], [11, 22], [22, 23], [16, 14]]) {
    im.circle(x, y, 2, [206, 54, 64]); // berries
    im.px(x - 1, y - 1, [240, 120, 130]); // glint
  }
  im.outline([32, 64, 30]);
  im.save('berry');
}

// --- tile + effects --------------------------------------------------------
function grass() {
  // 64x64 (2x2 tiles per repeat) with layered speckles + a few grass blades so
  // the repeat is less obvious over the big map.
  const S = 64;
  const im = new Img(S, S);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, S, S, [74, 112, 60]);
  // Soft mottling: sparse 2px patches of lighter/darker green.
  for (let i = 0; i < 140; i++) {
    const c = rnd() > 0.5 ? [80, 120, 64] : [68, 104, 55];
    const x = rnd() * S, y = rnd() * S;
    im.rect(x, y, 2, 2, c, 160);
  }
  // Fine speckles.
  for (let i = 0; i < 320; i++) {
    const c = rnd() > 0.5 ? [86, 128, 70] : [62, 96, 50];
    im.px(rnd() * S, rnd() * S, c);
  }
  // A few tiny grass blades (2px verticals with a lighter tip).
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    im.px(x, y, [66, 104, 54]);
    im.px(x, y - 1, [96, 140, 76]);
  }
  im.save('tile_grass');
}
function dirt() {
  const im = new Img(32, 32);
  let seed = 3411;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [138, 116, 78]); // dry packed earth
  const specks = [[156, 134, 94], [118, 98, 64], [146, 126, 88], [104, 88, 58]];
  for (let i = 0; i < 110; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 4)], 140 + rnd() * 100);
  // A couple of small pebbles.
  for (let i = 0; i < 4; i++) im.circle(rnd() * 32, rnd() * 32, 1, [160, 152, 140], 200);
  im.save('tile_dirt');
}
function flowers() {
  const im = new Img(32, 32);
  let seed = 9013;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [78, 118, 62]); // slightly lusher grass base
  for (let i = 0; i < 70; i++) {
    const c = rnd() > 0.5 ? [88, 130, 70] : [70, 106, 56];
    im.px(rnd() * 32, rnd() * 32, c);
  }
  // Scattered blossom heads in a few colours, with the odd white daisy.
  const petals = [[228, 176, 84], [216, 120, 150], [200, 90, 90], [236, 232, 220], [150, 130, 220]];
  for (let i = 0; i < 9; i++) {
    const x = 2 + rnd() * 28, y = 2 + rnd() * 28;
    const c = petals[Math.floor(rnd() * petals.length)];
    im.px(x, y, c); im.px(x + 1, y, c); im.px(x, y + 1, c); im.px(x + 1, y + 1, c);
    im.px(x + 0.5, y + 0.5, [250, 240, 160]); // centre
  }
  im.save('tile_flowers');
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
function mountain() {
  const im = new Img(32, 32);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [86, 84, 88]); // rocky grey base
  for (let i = 0; i < 60; i++) im.px(rnd() * 32, rnd() * 32, rnd() > 0.5 ? [98, 96, 100] : [72, 70, 74]);
  // A couple of triangular peaks with snow caps.
  for (const [px, ph] of [[10, 22], [22, 26]]) {
    for (let i = 0; i < ph; i++) {
      const w = Math.round((i / ph) * 9);
      im.rect(px - w, 30 - i, 2 * w + 1, 1, [120, 118, 122]);
    }
    im.rect(px - 2, 30 - ph, 4, 3, [232, 234, 240]); // snow cap
  }
  im.save('tile_mountain');
}
function mud() {
  const im = new Img(32, 32);
  let seed = 9157;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [104, 76, 46]); // wet brown
  const specks = [[88, 62, 36], [122, 92, 58], [72, 50, 30]];
  for (let i = 0; i < 90; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 3)], 150 + rnd() * 90);
  im.save('tile_mud');
}
function beach() {
  const im = new Img(32, 32);
  let seed = 5531;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [216, 200, 150]); // pale sand
  const specks = [[230, 216, 168], [196, 178, 130], [168, 150, 110]];
  for (let i = 0; i < 90; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 3)], 150 + rnd() * 90);
  im.save('tile_beach');
}
function path() {
  const im = new Img(32, 32);
  let seed = 7321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [122, 108, 84]); // packed dry earth
  // Scattered cobbles (lighter/darker dirt + the odd grey stone) for a trodden
  // courtyard-path look.
  const specks = [[150, 134, 104], [98, 86, 64], [140, 138, 132]];
  for (let i = 0; i < 80; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 3)], 150 + rnd() * 80);
  im.save('tile_path');
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
militia();
warrior();
spearman();
archer();
longbowman();
scoutCavalry();
knight();
horseArcher();
caravan();
catapult();
townCenter();
house();
mill();
lumbercamp();
miningcamp();
market();
militaryBuilding('barracks', (im) => {
  // Crossed swords over the gate.
  im.line(38, 40, 58, 52, W, 1);
  im.line(58, 40, 38, 52, W, 1);
  im.px(38, 40, D); im.px(58, 40, D);
  im.rect(20, 44, 6, 12, M); // weapon rack by the wall
  im.line(21, 44, 21, 56, D, 0);
  im.line(24, 44, 24, 56, D, 0);
});
militaryBuilding('range', (im) => {
  // Archery target + a strung bow leaning on the wall.
  im.circle(60, 46, 9, W);
  im.circle(60, 46, 9, D, 0);
  im.circle(60, 46, 5, M);
  im.circle(60, 46, 2, D);
  for (let a = -1.0; a <= 1.0; a += 0.1) im.px(26 + Math.cos(a) * 8, 48 + Math.sin(a) * 8, D);
  im.line(26, 40, 26, 56, M, 0);
});
militaryBuilding('stable', (im) => {
  // Horse head over the gate + a fence rail.
  im.ellipse(48, 44, 6, 4, W);
  im.ellipse(52, 41, 3, 2, W); // muzzle
  im.px(47, 43, D); // eye
  im.rect(18, 50, 16, 2, M); // fence
  im.rect(19, 46, 2, 8, M);
  im.rect(30, 46, 2, 8, M);
});
(() => {
  // tower: tall, footprint 1 -> 32px square, drawn as a turret
  const im = new Img(32, 32);
  im.ellipse(16, 30, 10, 2, [16, 16, 12], 60);
  im.rect(9, 8, 14, 22, L);
  for (let yy = 12; yy < 28; yy += 5) im.rect(9, yy, 14, 1, M, 130); // stone courses
  im.rect(9, 8, 2, 22, W, 90); // lit edge
  im.rect(21, 8, 2, 22, M); // shaded edge
  for (let x = 8; x < 24; x += 5) im.rect(x, 4, 3, 5, L); // battlements
  im.rect(8, 8, 16, 1, M);
  windowPane(im, 13, 16, 6, 7);
  im.outline();
  im.save('tower');
})();
(() => {
  const im = new Img(32, 32); // wall block
  im.rect(2, 8, 28, 18, L);
  // Staggered stone coursing.
  for (let yy = 12; yy < 26; yy += 5) im.rect(2, yy, 28, 1, M, 150);
  for (let x = 6; x < 30; x += 8) im.rect(x, 8, 1, 4, M, 120);
  for (let x = 2; x < 30; x += 8) im.rect(x, 13, 1, 4, M, 120);
  for (let x = 2; x < 30; x += 7) im.rect(x, 4, 5, 4, L); // crenellations
  im.rect(2, 8, 28, 1, W);
  im.rect(2, 23, 28, 3, M); // base shade
  im.outline();
  im.save('wall');
})();
(() => {
  const im = new Img(64, 64); // farm: tilled field with sprouting rows
  im.rect(8, 8, 48, 48, [150, 120, 70]);
  for (let y = 12; y < 56; y += 6) im.rect(8, y, 48, 2, [120, 92, 52]);
  let seed = 606;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 13; y < 56; y += 6)
    for (let x = 10; x < 54; x += 4)
      if (rnd() < 0.7) im.px(x + rnd() * 2, y, [96, 150, 60]); // green sprouts
  im.rect(8, 8, 48, 1, [170, 140, 86]); // lit top edge
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
mountain();
mud();
beach();
dirt();
flowers();
path();

fx('chop', (im) => { for (const [x, y] of [[6, 6], [9, 5], [7, 9], [10, 9]]) im.rect(x, y, 2, 2, [150, 100, 50]); });
fx('spark', (im) => { im.line(3, 8, 13, 8, [255, 224, 90], 0); im.line(8, 3, 8, 13, [255, 224, 90], 0); im.circle(8, 8, 2, [255, 245, 180]); });
fx('dust', (im) => { for (const [x, y, r] of [[5, 9, 2], [9, 7, 2], [11, 10, 2]]) im.circle(x, y, r, [200, 200, 200], 200); });
fx('leaf', (im) => { im.ellipse(8, 8, 4, 2, [120, 200, 90]); });
fx('slash', (im) => { for (let a = -0.6; a < 0.6; a += 0.08) im.px(8 + Math.cos(a) * 6, 8 + Math.sin(a) * 6, [255, 255, 255]); im.circle(8, 8, 1, [255, 220, 220]); });

console.log('[gen-assets] wrote sprites to client/assets/');
