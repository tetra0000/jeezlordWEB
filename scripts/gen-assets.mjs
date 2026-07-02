// Generates ALL sprite PNGs into client/assets/ in one consistent pixel style.
//
// Colour + team-colour contract (v12):
//  - Base sprites (<kind>.png) carry their OWN colours (skin, leather, steel,
//    timber, thatch...). They are NOT tinted by the client any more.
//  - Ownership shows through a separate OVERLAY sprite (team_<kind>.png): the
//    flags / tabards / pennants / trim, drawn in white + light grey so the
//    client can tint them with the owner colour. Base and overlay share the
//    same canvas per kind, so they align pixel-for-pixel.
//  - icon_<kind>.png / icon_job_<job>.png are the little overhead badges drawn
//    above units (16x16, self-coloured).
//  - decor_*.png are small environment props scattered on the grass client-side.
//
//   node scripts/gen-assets.mjs
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets');
mkdirSync(OUT, { recursive: true });

// --- palette (shared by every sprite so the set reads as one style) ----------
const SKIN = [224, 178, 138];
const SKIN_SH = [193, 145, 106];
const HAIR = [96, 66, 42];
const CLOTH = [186, 172, 146]; // undyed linen (team tabards go in the overlay)
const CLOTH_D = [150, 136, 112];
const LEATHER = [134, 96, 58];
const LEATHER_D = [104, 72, 42];
const STEEL = [178, 184, 196];
const STEEL_D = [124, 130, 142];
const STEEL_W = [228, 232, 240];
const WOODC = [124, 88, 48];
const WOODC_D = [94, 64, 34];
const WOODC_W = [156, 116, 66];
const HORSE = [150, 112, 72];
const HORSE_D = [118, 86, 52];
const HORSE_W = [176, 138, 94];
const PLASTER = [216, 202, 172];
const PLASTER_SH = [186, 170, 140];
const THATCH = [190, 154, 86];
const THATCH_D = [152, 118, 62];
const THATCH_W = [216, 184, 112];
const STONEC = [168, 168, 176];
const STONEC_D = [130, 130, 140];
const STONEC_W = [202, 202, 212];
const OUTC = [44, 36, 28]; // universal dark outline
// Team overlay tones (tinted by owner colour on the client — keep them bright).
const TEAM = [255, 255, 255];
const TEAM_SH = [190, 190, 190];

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
      if (thick <= 0) this.px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c);
      else this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick, c);
    }
  }
  // Dark 1px outline pass: any opaque pixel adjacent to a transparent one.
  outline(c = OUTC) {
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

// A base + team-overlay canvas pair, saved together so they always align.
function pair(name, size, draw) {
  const im = new Img(size, size);
  const tm = new Img(size, size);
  draw(im, tm);
  im.outline();
  im.save(name);
  tm.save('team_' + name);
}

// --- shared drawing helpers ---------------------------------------------------
function shadow(im, cx, cy, rx = 8, ry = 3) {
  im.ellipse(cx, cy, rx, ry, [16, 16, 12], 80);
}
// A clothed humanoid: linen tunic with a shaded edge, skin head, legs. The team
// tabard (a bright vertical panel down the torso) goes in the overlay.
function body(im, tm, x, y, w, h, { armor = false } = {}) {
  const top = armor ? STEEL : CLOTH;
  const shade = armor ? STEEL_D : CLOTH_D;
  im.rect(x, y, w, h, top);
  im.rect(x + w - 2, y, 2, h, shade);
  im.rect(x, y, w, 1, armor ? STEEL_W : [214, 202, 178]);
  if (tm) {
    // Team tabard: centre panel + a shaded bottom so it reads as cloth.
    const tw = Math.max(2, Math.floor(w / 2) - 1);
    const tx = x + Math.floor((w - tw) / 2);
    tm.rect(tx, y + 1, tw, h - 1, TEAM);
    tm.rect(tx, y + h - 3, tw, 2, TEAM_SH);
  }
}
function head(im, cx, cy, r = 5, helmet = false) {
  im.circle(cx, cy, r, SKIN);
  im.ellipse(cx + 2, cy + 1, r - 2, r - 1, SKIN_SH, 120);
  im.px(cx - 2, cy, OUTC); // eyes
  im.px(cx + 2, cy, OUTC);
  if (helmet) {
    im.rect(cx - r, cy - r, r * 2 + 1, r - 1, STEEL);
    im.rect(cx - r, cy - 2, r * 2 + 1, 1, STEEL_D);
    im.px(cx - r + 1, cy - r + 1, STEEL_W);
  } else {
    im.rect(cx - r + 1, cy - r, r * 2 - 1, r - 2, HAIR);
  }
}
function legs(im, cx, y, gap = 3, h = 5) {
  im.rect(cx - gap - 1, y, 3, h, LEATHER_D);
  im.rect(cx + gap - 1, y, 3, h, LEATHER_D);
}
// A shaded mount with legs, head, mane and tail.
function mount(im, cx, cy, rx, ry, tone = HORSE) {
  im.ellipse(cx, cy, rx, ry, tone);
  im.ellipse(cx - 2, cy - Math.max(1, ry - 2), rx - 3, 2, HORSE_W, 160);
  im.ellipse(cx, cy + Math.max(1, ry - 2), rx - 2, 2, HORSE_D);
  im.line(cx - rx, cy, cx - rx - 2, cy + 5, HORSE_D, 1); // tail
}

// --- units (32x32) -----------------------------------------------------------
pair('villager', 32, (im, tm) => {
  shadow(im, 16, 29, 7, 2);
  body(im, tm, 12, 16, 8, 11);
  head(im, 16, 11);
  legs(im, 16, 26);
  im.line(22, 24, 25, 15, WOODC, 0); // walking staff
});
pair('militia', 32, (im, tm) => {
  shadow(im, 16, 30, 8, 2);
  body(im, tm, 12, 16, 8, 11);
  im.px(13, 22, CLOTH_D); // patched tunic
  im.px(17, 19, CLOTH_D);
  head(im, 16, 11);
  legs(im, 16, 26);
  im.line(23, 22, 27, 8, WOODC, 1); // raised club
  im.circle(27, 8, 2, WOODC_D);
  im.px(27, 7, WOODC_W);
});
pair('warrior', 32, (im, tm) => {
  shadow(im, 16, 30, 9, 2);
  body(im, tm, 11, 14, 10, 13, { armor: true });
  im.rect(11, 12, 10, 2, STEEL_D); // shoulder plate
  im.rect(11, 20, 10, 1, LEATHER); // belt
  head(im, 16, 9, 5, true);
  legs(im, 16, 27, 4, 4);
  im.line(24, 6, 24, 22, STEEL_W, 1); // sword blade
  im.line(21, 9, 27, 9, WOODC, 1); // crossguard
  im.circle(8, 19, 4, LEATHER); // round shield (face is team-coloured)
  tm.circle(8, 19, 3, TEAM);
  tm.px(8, 19, TEAM_SH);
});
pair('spearman', 32, (im, tm) => {
  shadow(im, 16, 30, 8, 2);
  body(im, tm, 12, 15, 8, 12);
  im.rect(12, 15, 8, 2, LEATHER); // leather cuirass line
  head(im, 16, 10, 5, true);
  legs(im, 16, 27, 3, 4);
  im.line(23, 28, 27, 4, WOODC, 0); // long spear shaft
  im.rect(26, 2, 3, 5, STEEL_W); // spearhead
  im.px(27, 7, STEEL_D); // socket
  im.rect(6, 15, 3, 8, LEATHER_D); // tall shield on the off arm
  tm.rect(6, 16, 3, 3, TEAM); // shield stripe
});
pair('archer', 32, (im, tm) => {
  shadow(im, 16, 30, 8, 2);
  body(im, tm, 12, 14, 8, 12);
  head(im, 16, 9);
  im.rect(12, 5, 8, 2, LEATHER); // hood
  tm.rect(12, 5, 8, 1, TEAM); // hood band
  legs(im, 16, 26);
  for (let a = -1.1; a <= 1.1; a += 0.12) im.px(24 + Math.cos(a) * 8, 16 + Math.sin(a) * 8, WOODC); // bow arc
  im.line(24, 8, 24, 24, [232, 228, 214], 0); // string
  im.line(18, 16, 24, 16, WOODC_D, 0); // nocked arrow
});
pair('longbowman', 32, (im, tm) => {
  shadow(im, 16, 30, 8, 2);
  body(im, tm, 12, 14, 8, 12);
  head(im, 16, 9);
  im.rect(12, 5, 8, 2, LEATHER); // hood
  tm.rect(12, 5, 8, 1, TEAM);
  legs(im, 16, 26);
  for (let a = -1.35; a <= 1.35; a += 0.1) im.px(24 + Math.cos(a) * 11, 15 + Math.sin(a) * 11, WOODC); // tall bow
  im.line(24, 4, 24, 26, [232, 228, 214], 0); // long string
  im.rect(8, 12, 3, 9, LEATHER_D); // quiver
  im.line(9, 10, 9, 12, [232, 228, 214], 0); // fletchings
  im.px(8, 11, [232, 228, 214]);
});
pair('scoutCavalry', 32, (im, tm) => {
  shadow(im, 16, 30, 11, 2);
  mount(im, 15, 20, 10, 4, HORSE_W);
  im.rect(8, 23, 2, 6, HORSE_D); // thin legs
  im.rect(13, 23, 2, 6, HORSE_D);
  im.rect(21, 23, 2, 6, HORSE_D);
  im.ellipse(24, 16, 3, 2, HORSE_W); // head
  im.rect(22, 13, 2, 3, HORSE_D); // mane
  im.line(27, 16, 30, 18, HORSE_D, 0); // muzzle
  body(im, tm, 13, 8, 4, 8); // slim rider
  head(im, 15, 6, 3);
  im.line(19, 4, 19, 14, WOODC, 0); // pennant pole
  tm.rect(19, 4, 5, 3, TEAM); // pennant (team)
  tm.px(23, 5, TEAM_SH);
});
pair('knight', 32, (im, tm) => {
  shadow(im, 16, 31, 13, 2);
  mount(im, 16, 20, 13, 7);
  im.rect(6, 24, 3, 7, HORSE_D);
  im.rect(12, 24, 3, 7, HORSE_D);
  im.rect(20, 24, 3, 7, HORSE_D);
  im.rect(25, 24, 3, 7, HORSE_D);
  im.ellipse(27, 13, 4, 3, HORSE); // head
  im.rect(24, 10, 3, 3, HORSE_D); // mane
  tm.rect(10, 20, 12, 3, TEAM); // team barding stripe
  tm.rect(10, 22, 12, 1, TEAM_SH);
  body(im, tm, 13, 3, 6, 11, { armor: true }); // armoured rider
  head(im, 16, 3, 3, true);
  im.line(20, 2, 20, 16, WOODC, 0); // lance
  im.px(20, 1, STEEL_W); // lance tip
  im.rect(9, 8, 3, 6, STEEL_D); // kite shield
  tm.rect(9, 9, 3, 3, TEAM); // shield blazon
});
pair('horseArcher', 32, (im, tm) => {
  shadow(im, 16, 31, 11, 2);
  mount(im, 15, 20, 11, 5);
  im.rect(7, 23, 3, 7, HORSE_D);
  im.rect(13, 23, 3, 7, HORSE_D);
  im.rect(21, 23, 3, 7, HORSE_D);
  im.ellipse(25, 15, 3, 2, HORSE); // head
  im.rect(23, 12, 2, 3, HORSE_D); // mane
  tm.rect(9, 19, 11, 2, TEAM); // saddle blanket
  body(im, tm, 13, 7, 5, 9); // rider twisted to shoot
  head(im, 15, 5, 3);
  for (let a = -0.9; a <= 0.9; a += 0.12) im.px(21 + Math.cos(a) * 6, 10 + Math.sin(a) * 6, WOODC); // compact bow
  im.line(21, 4, 21, 16, [232, 228, 214], 0); // string
});
pair('catapult', 32, (im, tm) => {
  shadow(im, 17, 30, 11, 2);
  im.rect(8, 16, 18, 9, WOODC); // frame
  im.rect(8, 16, 18, 2, WOODC_W); // lit rail
  im.line(10, 18, 24, 18, WOODC_D, 0); // brace
  im.circle(12, 26, 4, WOODC_D); // wheels
  im.circle(22, 26, 4, WOODC_D);
  im.circle(12, 26, 1, WOODC_W);
  im.circle(22, 26, 1, WOODC_W);
  im.line(10, 22, 24, 8, WOODC_W, 1); // throwing arm
  im.circle(24, 8, 3, LEATHER); // bucket
  im.circle(24, 8, 1, STONEC_D); // stone in the bucket
  im.line(6, 14, 6, 22, WOODC, 0); // little standard pole on the frame
  tm.rect(6, 14, 4, 3, TEAM);
});
pair('caravan', 32, (im, tm) => {
  im.rect(8, 15, 14, 8, WOODC); // cart bed
  im.rect(8, 22, 14, 1, WOODC_D);
  im.rect(9, 11, 12, 5, [226, 218, 200]); // canvas hood
  for (let i = 0; i < 7; i++) im.rect(9 + i, 9 + Math.abs(3 - i) * 0.6, 12 - i, 2, [238, 232, 216]); // rounded top
  tm.rect(9, 12, 12, 2, TEAM); // team stripe along the canvas
  im.circle(11, 25, 4, WOODC_D); // wheels
  im.circle(19, 25, 4, WOODC_D);
  im.circle(11, 25, 1, WOODC_W);
  im.circle(19, 25, 1, WOODC_W);
  im.ellipse(26, 19, 4, 3, HORSE); // mule
  im.rect(24, 22, 2, 6, HORSE_D);
  im.rect(28, 22, 2, 6, HORSE_D);
  im.ellipse(29, 15, 2, 2, HORSE);
  im.line(22, 18, 25, 18, LEATHER_D, 0); // harness
});

// --- buildings -----------------------------------------------------------------
// Timber-framed wall: plaster infill with dark oak posts/beams and braces.
function timberWall(im, x, y, w, h) {
  im.rect(x, y, w, h, PLASTER);
  im.rect(x + w - 2, y, 2, h, PLASTER_SH); // shaded right edge
  im.rect(x, y + h - 3, w, 3, PLASTER_SH); // base shade
  im.rect(x, y, w, 2, WOODC_D); // top beam
  im.rect(x, y + h - 1, w, 1, WOODC_D); // sill
  for (let px = x; px <= x + w - 2; px += Math.max(8, Math.floor(w / 5))) im.rect(px, y, 2, h, WOODC_D); // posts
  im.rect(x + w - 2, y, 2, h, WOODC_D);
  // A diagonal brace between the first two posts.
  const p = Math.max(8, Math.floor(w / 5));
  im.line(x + 2, y + h - 3, x + p, y + 3, WOODC_D, 0);
}
// Stone wall for military works.
function stoneWall(im, x, y, w, h) {
  im.rect(x, y, w, h, STONEC);
  for (let yy = y + 4; yy < y + h - 2; yy += 5) im.rect(x, yy, w, 1, STONEC_D, 150); // courses
  for (let yy = y + 4, row = 0; yy < y + h - 2; yy += 5, row++)
    for (let px = x + (row % 2 ? 3 : 7); px < x + w - 2; px += 8) im.rect(px, yy - 4, 1, 4, STONEC_D, 110); // joints
  im.rect(x, y, w, 2, STONEC_W); // lit top
  im.rect(x, y + h - 3, w, 3, STONEC_D); // base shade
  im.rect(x + w - 2, y, 2, h, STONEC_D); // shaded edge
}
// A pitched thatch roof rising from (cx, baseY) `rise` px up.
function thatchRoof(im, cx, baseY, halfW, rise) {
  for (let i = 0; i < rise; i++) {
    const w = Math.round(halfW * (1 - i / rise));
    const c = i % 3 === 2 ? THATCH_D : (i > rise - 4 ? THATCH_W : THATCH);
    im.rect(cx - w, baseY - i, w * 2, 1, c);
  }
  im.rect(cx - halfW, baseY, halfW * 2, 1, THATCH_D); // eave shadow line
}
function door(im, x, y, w, h) {
  im.rect(x - 1, y - 1, w + 2, h + 1, WOODC_D); // frame
  im.rect(x, y, w, h, WOODC);
  for (let px = x + 2; px < x + w; px += 3) im.rect(px, y, 1, h, WOODC_D, 120); // planks
  im.px(x + w - 2, y + Math.floor(h / 2), THATCH_W); // handle
}
function windowPane(im, x, y, w = 8, h = 8) {
  im.rect(x - 1, y - 1, w + 2, h + 2, WOODC_D); // frame
  im.rect(x, y, w, h, [58, 60, 74]);
  im.px(x + 1, y + 1, [148, 158, 186]); // glint
}
// Banner pole + team flag. Pole goes in the base, cloth in the overlay.
function flag(im, tm, x, top, fw = 8, fh = 5) {
  im.rect(x, top, 2, 13, WOODC_D);
  im.px(x, top, THATCH_W);
  tm.rect(x + 2, top, fw, fh, TEAM);
  tm.rect(x + 2, top + fh - 1, fw, 1, TEAM_SH);
  tm.px(x + 1 + fw, top + 1, TEAM_SH);
}

pair('townCenter', 96, (im, tm) => {
  im.ellipse(48, 88, 40, 6, [16, 16, 12], 60);
  timberWall(im, 14, 40, 68, 48);
  thatchRoof(im, 48, 40, 38, 26);
  flag(im, tm, 44, 6, 10, 6); // banner on the ridge
  door(im, 40, 62, 16, 26);
  tm.rect(39, 60, 18, 2, TEAM); // team-painted door lintel
  windowPane(im, 22, 48, 10, 10);
  windowPane(im, 64, 48, 10, 10);
  im.rect(14, 58, 68, 1, WOODC_D); // string course
});
pair('house', 64, (im, tm) => {
  im.ellipse(32, 58, 26, 4, [16, 16, 12], 60);
  timberWall(im, 12, 30, 40, 28);
  thatchRoof(im, 32, 30, 24, 16);
  im.rect(40, 10, 4, 8, STONEC_D); // chimney
  im.rect(40, 9, 4, 2, STONEC_W);
  door(im, 26, 42, 10, 16);
  windowPane(im, 15, 36, 7, 7);
  windowPane(im, 42, 36, 7, 7);
  tm.rect(25, 40, 12, 2, TEAM); // door lintel trim
});
pair('mill', 64, (im, tm) => {
  im.ellipse(32, 58, 26, 4, [16, 16, 12], 60);
  timberWall(im, 12, 28, 34, 30);
  thatchRoof(im, 29, 28, 20, 12);
  door(im, 22, 44, 10, 14);
  im.circle(48, 38, 13, WOODC); // water wheel
  im.circle(48, 38, 13, WOODC_D, 0);
  im.circle(48, 38, 3, WOODC_D);
  for (let a = 0; a < 6.28; a += 0.78) im.line(48, 38, 48 + Math.cos(a) * 12, 38 + Math.sin(a) * 12, WOODC_D, 0);
  flag(im, tm, 14, 12, 7, 4);
});
pair('lumbercamp', 32, (im, tm) => {
  im.ellipse(16, 29, 13, 2, [16, 16, 12], 60);
  timberWall(im, 5, 14, 15, 14);
  thatchRoof(im, 12, 14, 9, 6);
  im.ellipse(25, 23, 6, 3, WOODC); // log pile
  im.ellipse(25, 21, 5, 2, WOODC_W);
  im.line(24, 12, 28, 6, WOODC, 1); // leaning axe
  im.rect(27, 4, 3, 3, STEEL_W);
  flag(im, tm, 4, 4, 5, 3);
});
pair('miningcamp', 32, (im, tm) => {
  im.ellipse(16, 29, 13, 2, [16, 16, 12], 60);
  timberWall(im, 5, 14, 15, 14);
  thatchRoof(im, 12, 14, 9, 6);
  im.line(22, 24, 28, 14, WOODC, 1); // pick handle
  im.line(25, 12, 31, 16, STEEL_D, 1); // pick head
  im.circle(25, 26, 2, STONEC);
  im.circle(29, 25, 2, STONEC_W);
  flag(im, tm, 4, 4, 5, 3);
});
pair('market', 64, (im, tm) => {
  im.ellipse(32, 58, 26, 4, [16, 16, 12], 60);
  timberWall(im, 14, 30, 36, 28);
  im.rect(22, 42, 20, 16, [64, 54, 44]); // counter opening
  im.rect(22, 42, 20, 2, OUTC);
  // Striped awning: undyed stripes in the base, team stripes in the overlay.
  for (let i = 0; i < 9; i++) {
    im.rect(10 + i * 5, 22, 5, 10, [232, 226, 210]);
    if (i % 2) tm.rect(10 + i * 5, 22, 5, 10, TEAM);
  }
  im.rect(10, 22, 44, 2, [244, 240, 228]); // awning lip
  im.rect(9, 22, 2, 36, WOODC_D); // posts
  im.rect(53, 22, 2, 36, WOODC_D);
  im.rect(52, 48, 9, 9, WOODC); // crate
  im.rect(52, 52, 9, 1, WOODC_D);
  im.circle(32, 50, 4, [245, 205, 70]); // coin
  im.circle(32, 50, 4, [180, 140, 40], 0);
});
function militaryBuilding(name, glyphDraw) {
  pair(name, 96, (im, tm) => {
    im.ellipse(48, 90, 40, 5, [16, 16, 12], 60);
    stoneWall(im, 12, 34, 72, 54);
    for (let x = 12; x < 84; x += 10) im.rect(x, 26, 6, 8, STONEC); // crenellations
    for (let x = 12; x < 84; x += 10) im.rect(x, 26, 6, 1, STONEC_W);
    im.rect(12, 32, 72, 3, STONEC_D);
    im.rect(40, 58, 16, 30, WOODC); // gate
    im.rect(40, 58, 16, 3, OUTC); // arch shadow
    im.rect(47, 58, 2, 30, WOODC_D); // double doors
    flag(im, tm, 46, 8, 10, 6); // keep banner
    tm.rect(39, 56, 18, 2, TEAM); // painted gate lintel
    glyphDraw(im, tm);
  });
}
militaryBuilding('barracks', (im) => {
  im.line(38, 40, 58, 52, STEEL_W, 1); // crossed swords over the gate
  im.line(58, 40, 38, 52, STEEL_W, 1);
  im.px(38, 40, OUTC); im.px(58, 40, OUTC);
  im.rect(20, 44, 6, 12, WOODC); // weapon rack
  im.line(21, 44, 21, 56, WOODC_D, 0);
  im.line(24, 44, 24, 56, WOODC_D, 0);
});
militaryBuilding('range', (im) => {
  im.circle(60, 46, 9, [236, 230, 214]); // archery target
  im.circle(60, 46, 9, OUTC, 0);
  im.circle(60, 46, 5, [200, 90, 90]);
  im.circle(60, 46, 2, OUTC);
  for (let a = -1.0; a <= 1.0; a += 0.1) im.px(26 + Math.cos(a) * 8, 48 + Math.sin(a) * 8, WOODC_D); // strung bow
  im.line(26, 40, 26, 56, WOODC, 0);
});
militaryBuilding('stable', (im) => {
  im.ellipse(48, 44, 6, 4, HORSE_W); // horse head over the gate
  im.ellipse(52, 41, 3, 2, HORSE_W);
  im.px(47, 43, OUTC); // eye
  im.rect(18, 50, 16, 2, WOODC); // fence
  im.rect(19, 46, 2, 8, WOODC);
  im.rect(30, 46, 2, 8, WOODC);
});
pair('tower', 32, (im, tm) => {
  im.ellipse(16, 30, 10, 2, [16, 16, 12], 60);
  stoneWall(im, 9, 8, 14, 22);
  for (let x = 8; x < 24; x += 5) im.rect(x, 4, 3, 5, STONEC); // battlements
  for (let x = 8; x < 24; x += 5) im.px(x, 4, STONEC_W);
  im.rect(8, 8, 16, 1, STONEC_D);
  windowPane(im, 13, 16, 6, 7);
  flag(im, tm, 22, 0, 6, 4);
});
pair('wall', 32, (im, tm) => {
  stoneWall(im, 2, 8, 28, 18);
  for (let x = 2; x < 30; x += 7) im.rect(x, 4, 5, 4, STONEC); // crenellations
  for (let x = 2; x < 30; x += 7) im.rect(x, 4, 5, 1, STONEC_W);
  tm.rect(13, 12, 6, 6, TEAM, 210); // small painted crest on the face
  tm.rect(13, 16, 6, 2, TEAM_SH, 210);
});
// Gate: a wall block with heavy wooden doors. Closed base + an open variant
// (the client swaps textures when the mode is 'open'). Same team crest banner.
function gateBase(im, doorsOpen) {
  stoneWall(im, 2, 8, 28, 18);
  for (let x = 2; x < 30; x += 7) im.rect(x, 4, 5, 4, STONEC);
  for (let x = 2; x < 30; x += 7) im.rect(x, 4, 5, 1, STONEC_W);
  // Archway.
  im.rect(9, 12, 14, 14, [52, 46, 40]); // arch interior (dark passage)
  im.rect(9, 12, 14, 2, OUTC);
  if (doorsOpen) {
    // Doors swung inward: two slivers against the jambs, ground showing through.
    im.rect(10, 14, 3, 12, WOODC);
    im.rect(19, 14, 3, 12, WOODC);
    im.rect(13, 20, 6, 6, [96, 112, 66]); // grass visible through the arch
  } else {
    im.rect(10, 14, 12, 12, WOODC); // closed double doors
    for (let px = 11; px < 22; px += 3) im.rect(px, 14, 1, 12, WOODC_D, 130); // planks
    im.rect(15, 14, 2, 12, WOODC_D); // seam
    im.rect(10, 18, 12, 1, STEEL_D); // iron band
    im.rect(10, 23, 12, 1, STEEL_D);
  }
}
pair('gate', 32, (im, tm) => {
  gateBase(im, false);
  tm.rect(12, 9, 8, 3, TEAM); // banner over the arch
  tm.rect(12, 11, 8, 1, TEAM_SH);
});
{
  // Open variant shares the closed gate's overlay (same canvas + banner spot).
  const im = new Img(32, 32);
  gateBase(im, true);
  im.outline();
  im.save('gate_open');
}
pair('farm', 64, (im, tm) => {
  im.rect(8, 8, 48, 48, [150, 120, 70]);
  for (let y = 12; y < 56; y += 6) im.rect(8, y, 48, 2, [120, 92, 52]);
  let seed = 606;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 13; y < 56; y += 6)
    for (let x = 10; x < 54; x += 4)
      if (rnd() < 0.7) im.px(x + rnd() * 2, y, [96, 150, 60]); // sprouts
  im.rect(8, 8, 48, 1, [170, 140, 86]); // lit top edge
  // Boundary posts + a little team marker post so ownership reads at a glance.
  im.rect(8, 8, 2, 6, WOODC_D);
  im.rect(54, 8, 2, 6, WOODC_D);
  tm.rect(10, 8, 5, 3, TEAM);
});

// --- resources (colored, no tint, no team overlay) ---------------------------
function tree() {
  const im = new Img(32, 32);
  im.ellipse(16, 29, 9, 2, [24, 34, 20], 110);
  im.rect(14, 20, 5, 10, [104, 70, 38]);
  im.rect(14, 20, 2, 10, [126, 88, 48]);
  im.circle(16, 14, 11, [54, 110, 46]);
  im.circle(12, 11, 6, [72, 134, 58]);
  im.circle(21, 13, 6, [42, 92, 38]);
  im.circle(17, 8, 4, [86, 148, 66]);
  for (const [x, y] of [[10, 16], [19, 18], [14, 12], [22, 10]]) im.px(x, y, [96, 158, 74]);
  im.outline([30, 50, 26]);
  im.save('tree');
}
function gold() {
  const im = new Img(32, 32);
  im.ellipse(16, 28, 11, 2, [24, 24, 20], 110);
  im.circle(16, 20, 11, [120, 118, 120]);
  im.circle(12, 16, 5, [138, 136, 138]);
  im.circle(20, 24, 5, [100, 98, 102]);
  im.circle(13, 18, 3, [245, 205, 70]);
  im.circle(20, 21, 3, [255, 220, 90]);
  im.circle(16, 14, 2, [255, 230, 120]);
  im.px(13, 17, [255, 245, 170]);
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
  im.circle(22, 16, 4, [190, 190, 196]);
  im.line(18, 20, 24, 22, [110, 110, 118], 0);
  im.outline([70, 70, 76]);
  im.save('stone');
}
function berry() {
  const im = new Img(32, 32);
  im.ellipse(16, 28, 10, 2, [24, 34, 20], 110);
  im.circle(16, 19, 11, [58, 116, 52]);
  im.circle(12, 15, 5, [74, 136, 62]);
  for (const [x, y] of [[12, 16], [20, 17], [16, 22], [11, 22], [22, 23], [16, 14]]) {
    im.circle(x, y, 2, [206, 54, 64]);
    im.px(x - 1, y - 1, [240, 120, 130]);
  }
  im.outline([32, 64, 30]);
  im.save('berry');
}

// --- tiles ---------------------------------------------------------------------
function grass() {
  const S = 64;
  const im = new Img(S, S);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, S, S, [74, 112, 60]);
  for (let i = 0; i < 140; i++) {
    const c = rnd() > 0.5 ? [80, 120, 64] : [68, 104, 55];
    im.rect(rnd() * S, rnd() * S, 2, 2, c, 160);
  }
  for (let i = 0; i < 320; i++) {
    const c = rnd() > 0.5 ? [86, 128, 70] : [62, 96, 50];
    im.px(rnd() * S, rnd() * S, c);
  }
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
  im.rect(0, 0, 32, 32, [138, 116, 78]);
  const specks = [[156, 134, 94], [118, 98, 64], [146, 126, 88], [104, 88, 58]];
  for (let i = 0; i < 110; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 4)], 140 + rnd() * 100);
  for (let i = 0; i < 4; i++) im.circle(rnd() * 32, rnd() * 32, 1, [160, 152, 140], 200);
  im.save('tile_dirt');
}
function flowers() {
  const im = new Img(32, 32);
  let seed = 9013;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [78, 118, 62]);
  for (let i = 0; i < 70; i++) {
    const c = rnd() > 0.5 ? [88, 130, 70] : [70, 106, 56];
    im.px(rnd() * 32, rnd() * 32, c);
  }
  const petals = [[228, 176, 84], [216, 120, 150], [200, 90, 90], [236, 232, 220], [150, 130, 220]];
  for (let i = 0; i < 9; i++) {
    const x = 2 + rnd() * 28, y = 2 + rnd() * 28;
    const c = petals[Math.floor(rnd() * petals.length)];
    im.px(x, y, c); im.px(x + 1, y, c); im.px(x, y + 1, c); im.px(x + 1, y + 1, c);
    im.px(x + 0.5, y + 0.5, [250, 240, 160]);
  }
  im.save('tile_flowers');
}
function water() {
  const im = new Img(32, 32);
  let seed = 778;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [40, 92, 140]);
  for (let i = 0; i < 70; i++) im.px(rnd() * 32, rnd() * 32, rnd() > 0.5 ? [52, 108, 158] : [34, 80, 126]);
  for (const wy of [9, 20, 27]) {
    for (let x = 3; x < 29; x++) im.px(x, wy + Math.round(Math.sin((x + wy) * 0.6) * 1.2), [120, 170, 210], 180);
  }
  im.save('tile_water');
}
function mountainTile() {
  const im = new Img(32, 32);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [86, 84, 88]);
  for (let i = 0; i < 60; i++) im.px(rnd() * 32, rnd() * 32, rnd() > 0.5 ? [98, 96, 100] : [72, 70, 74]);
  for (const [px, ph] of [[10, 22], [22, 26]]) {
    for (let i = 0; i < ph; i++) {
      const w = Math.round((i / ph) * 9);
      im.rect(px - w, 30 - i, 2 * w + 1, 1, [120, 118, 122]);
    }
    im.rect(px - 2, 30 - ph, 4, 3, [232, 234, 240]);
  }
  im.save('tile_mountain');
}
function mud() {
  const im = new Img(32, 32);
  let seed = 9157;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [104, 76, 46]);
  const specks = [[88, 62, 36], [122, 92, 58], [72, 50, 30]];
  for (let i = 0; i < 90; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 3)], 150 + rnd() * 90);
  im.save('tile_mud');
}
function beach() {
  const im = new Img(32, 32);
  let seed = 5531;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [216, 200, 150]);
  const specks = [[230, 216, 168], [196, 178, 130], [168, 150, 110]];
  for (let i = 0; i < 90; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 3)], 150 + rnd() * 90);
  im.save('tile_beach');
}
function path() {
  const im = new Img(32, 32);
  let seed = 7321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  im.rect(0, 0, 32, 32, [122, 108, 84]);
  const specks = [[150, 134, 104], [98, 86, 64], [140, 138, 132]];
  for (let i = 0; i < 80; i++) im.px(rnd() * 32, rnd() * 32, specks[Math.floor(rnd() * 3)], 150 + rnd() * 80);
  im.save('tile_path');
}
function bridge() {
  const im = new Img(32, 32);
  im.rect(0, 0, 32, 32, [120, 82, 44]);
  for (let y = 4; y < 32; y += 6) im.rect(0, y, 32, 2, [80, 52, 26]);
  im.rect(0, 1, 32, 3, [150, 108, 62]);
  im.rect(0, 28, 32, 3, [88, 58, 30]);
  for (let x = 0; x < 32; x += 1) if ((x & 7) === 0) im.rect(x, 0, 1, 32, [100, 68, 36], 120);
  im.save('tile_bridge');
}
// Caravan road: trodden earth with wheel-rut speckles, soft-edged so adjacent
// road tiles blend into a track over the grass. Drawn at partial alpha by the
// client (deepening with wear), so keep the tile itself fully opaque-ish in the
// middle and feathered at the rim.
function road() {
  const S = 32;
  const im = new Img(S, S);
  let seed = 6161;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // Feathered edge: alpha falls off toward the tile rim with some noise.
      const ex = Math.min(x, S - 1 - x) / (S / 2);
      const ey = Math.min(y, S - 1 - y) / (S / 2);
      const edge = Math.min(1, (ex + 0.25) * (ey + 0.25) * 2.2);
      const a = Math.max(0, Math.min(1, edge - rnd() * 0.25)) * 255;
      if (a < 12) continue;
      const t = rnd();
      const c = t < 0.12 ? [112, 94, 66] : t < 0.24 ? [148, 130, 98] : [131, 112, 82];
      im.px(x, y, c, a);
    }
  // Faint wheel ruts (two darker streaks) + the odd pebble.
  for (let x = 0; x < S; x++) {
    im.px(x, 11 + Math.round(Math.sin(x * 0.4) * 1.2), [104, 88, 62], 130);
    im.px(x, 21 + Math.round(Math.sin(x * 0.4 + 2) * 1.2), [104, 88, 62], 130);
  }
  for (let i = 0; i < 5; i++) im.px(2 + rnd() * 28, 2 + rnd() * 28, [160, 152, 138], 180);
  im.save('tile_road');
}

// --- environment decor (16x16 props scattered on the grass client-side) ------
function decorRock() {
  const im = new Img(16, 16);
  im.ellipse(8, 13, 5, 2, [24, 30, 20], 90);
  im.circle(7, 10, 4, STONEC_D);
  im.circle(10, 9, 3, STONEC);
  im.circle(11, 7, 2, STONEC_W);
  im.outline([70, 70, 76]);
  im.save('decor_rock');
}
function decorTuft() {
  const im = new Img(16, 16);
  for (const [x, dy, c] of [[5, 0, [88, 132, 70]], [7, -2, [104, 148, 80]], [9, -1, [78, 118, 62]], [11, 0, [96, 140, 76]], [6, -1, [70, 108, 56]], [10, -3, [110, 156, 86]]]) {
    im.line(8, 14, x, 6 + dy, c, 0);
  }
  im.save('decor_tuft');
}
function decorShroom() {
  const im = new Img(16, 16);
  im.ellipse(8, 14, 4, 1, [24, 30, 20], 90);
  im.rect(7, 9, 2, 5, [222, 210, 188]); // stem
  im.ellipse(8, 8, 4, 3, [196, 84, 74]); // cap
  im.px(6, 7, [240, 226, 210]);
  im.px(10, 8, [240, 226, 210]);
  im.outline([90, 50, 44]);
  im.save('decor_shroom');
}
function decorStump() {
  const im = new Img(16, 16);
  im.ellipse(8, 13, 5, 2, [24, 30, 20], 90);
  im.rect(4, 7, 8, 6, [104, 70, 38]);
  im.ellipse(8, 7, 4, 2, [156, 124, 82]); // cut face
  im.ellipse(8, 7, 2, 1, [126, 96, 58]); // rings
  im.rect(4, 7, 1, 6, [126, 88, 48]);
  im.outline([50, 36, 22]);
  im.save('decor_stump');
}
function decorBush() {
  const im = new Img(16, 16);
  im.ellipse(8, 13, 6, 2, [24, 34, 20], 100);
  im.circle(8, 9, 5, [58, 106, 48]);
  im.circle(5, 8, 3, [74, 128, 60]);
  im.circle(11, 8, 3, [48, 92, 42]);
  im.px(7, 6, [96, 148, 74]);
  im.px(10, 10, [96, 148, 74]);
  im.outline([30, 50, 26]);
  im.save('decor_bush');
}

// --- overhead badge icons (16x16) --------------------------------------------
// A dark rounded chip with a coloured glyph, so the badge reads over any ground.
function icon(name, draw) {
  const im = new Img(16, 16);
  im.circle(8, 8, 7, [26, 24, 20], 215);
  im.circle(8, 8, 7, [10, 9, 7], 0);
  for (let a = 0; a < 6.28; a += 0.05) im.px(8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, [180, 172, 150], 190); // rim
  draw(im);
  im.save(name);
}
icon('icon_villager', (im) => {
  im.circle(8, 5, 2, SKIN);
  im.rect(6, 8, 5, 5, CLOTH);
});
icon('icon_militia', (im) => {
  im.line(5, 12, 10, 5, WOODC, 1); // club
  im.circle(10, 5, 2, WOODC_W);
});
icon('icon_warrior', (im) => {
  im.line(8, 3, 8, 11, STEEL_W, 0); // sword
  im.line(8, 4, 8, 5, STEEL_W, 0);
  im.line(5, 9, 11, 9, WOODC, 0); // crossguard
  im.rect(7, 11, 2, 2, LEATHER); // grip
});
icon('icon_spearman', (im) => {
  im.line(5, 13, 10, 4, WOODC_W, 0); // shaft
  im.rect(10, 2, 2, 3, STEEL_W); // head
});
icon('icon_archer', (im) => {
  for (let a = -1.1; a <= 1.1; a += 0.1) im.px(7 + Math.cos(a) * 5, 8 + Math.sin(a) * 5, WOODC_W);
  im.line(7, 3, 7, 13, [232, 228, 214], 0);
  im.line(4, 8, 10, 8, STEEL_W, 0); // arrow
});
icon('icon_longbowman', (im) => {
  for (let a = -1.35; a <= 1.35; a += 0.08) im.px(7 + Math.cos(a) * 6, 8 + Math.sin(a) * 6, [156, 116, 66]);
  im.line(7, 2, 7, 14, [232, 228, 214], 0);
});
icon('icon_scoutCavalry', (im) => {
  im.ellipse(7, 9, 4, 3, HORSE_W); // pony body
  im.ellipse(11, 6, 2, 2, HORSE_W); // head
  im.rect(5, 11, 1, 3, HORSE_D);
  im.rect(9, 11, 1, 3, HORSE_D);
});
icon('icon_knight', (im) => {
  im.ellipse(7, 9, 4, 3, HORSE); // horse
  im.ellipse(11, 6, 2, 2, HORSE);
  im.rect(5, 11, 1, 3, HORSE_D);
  im.rect(9, 11, 1, 3, HORSE_D);
  im.rect(6, 4, 3, 4, STEEL_W); // armoured rider hint
});
icon('icon_horseArcher', (im) => {
  im.ellipse(7, 10, 4, 3, HORSE);
  im.ellipse(11, 7, 2, 2, HORSE);
  for (let a = -0.9; a <= 0.9; a += 0.12) im.px(6 + Math.cos(a) * 4, 5 + Math.sin(a) * 4, WOODC_W); // bow
});
icon('icon_catapult', (im) => {
  im.rect(4, 9, 8, 3, WOODC); // frame
  im.circle(5, 12, 2, WOODC_D);
  im.circle(11, 12, 2, WOODC_D);
  im.line(6, 9, 11, 4, WOODC_W, 0); // arm
  im.circle(11, 4, 2, STONEC); // boulder
});
icon('icon_caravan', (im) => {
  im.circle(8, 8, 4, [245, 205, 70]); // coin
  im.circle(7, 7, 1, [255, 240, 150]);
  im.circle(8, 8, 4, [170, 130, 40], 0);
});
icon('icon_job_builder', (im) => {
  im.line(5, 12, 10, 6, WOODC, 1); // hammer handle
  im.rect(8, 3, 5, 4, STEEL); // head
  im.px(8, 3, STEEL_W);
});
icon('icon_job_farmer', (im) => {
  im.line(8, 13, 8, 4, [188, 154, 70], 0); // wheat stalk
  for (const [dx, dy] of [[-2, 5], [2, 5], [-2, 7], [2, 7], [-1, 3], [1, 3]])
    im.px(8 + dx, dy + 1, [222, 186, 92]); // grains
});
icon('icon_job_forager', (im) => {
  im.circle(6, 8, 2, [206, 54, 64]); // berries
  im.circle(10, 9, 2, [206, 54, 64]);
  im.circle(8, 5, 2, [206, 54, 64]);
  im.px(5, 7, [240, 120, 130]);
  im.px(9, 8, [240, 120, 130]);
});
icon('icon_job_lumberjack', (im) => {
  im.line(5, 13, 10, 6, WOODC, 1); // axe handle
  im.rect(9, 3, 4, 5, STEEL); // blade
  im.px(12, 4, STEEL_W);
});
icon('icon_job_stonemason', (im) => {
  im.line(5, 13, 10, 6, WOODC, 0); // pick handle
  im.line(7, 4, 13, 8, STEEL_D, 1); // pick head
  im.circle(5, 11, 1, STONEC_W); // stone chip
});
icon('icon_job_goldminer', (im) => {
  im.line(5, 13, 10, 6, WOODC, 0);
  im.line(7, 4, 13, 8, STEEL_D, 1);
  im.circle(5, 11, 1, [255, 220, 90]); // gold chip
});

// --- fx -----------------------------------------------------------------------
function fx(name, draw) {
  const im = new Img(16, 16);
  draw(im);
  im.save('fx_' + name);
}
fx('chop', (im) => { for (const [x, y] of [[6, 6], [9, 5], [7, 9], [10, 9]]) im.rect(x, y, 2, 2, [150, 100, 50]); });
fx('spark', (im) => { im.line(3, 8, 13, 8, [255, 224, 90], 0); im.line(8, 3, 8, 13, [255, 224, 90], 0); im.circle(8, 8, 2, [255, 245, 180]); });
fx('dust', (im) => { for (const [x, y, r] of [[5, 9, 2], [9, 7, 2], [11, 10, 2]]) im.circle(x, y, r, [200, 200, 200], 200); });
fx('leaf', (im) => { im.ellipse(8, 8, 4, 2, [120, 200, 90]); });
fx('slash', (im) => { for (let a = -0.6; a < 0.6; a += 0.08) im.px(8 + Math.cos(a) * 6, 8 + Math.sin(a) * 6, [255, 255, 255]); im.circle(8, 8, 1, [255, 220, 220]); });

// --- run everything -------------------------------------------------------------
tree();
gold();
stone();
berry();
grass();
water();
bridge();
mountainTile();
mud();
beach();
dirt();
flowers();
path();
road();
decorRock();
decorTuft();
decorShroom();
decorStump();
decorBush();

console.log('[gen-assets] wrote sprites to client/assets/');
