// Dev helper: compose client/assets sprites into one contact sheet PNG (4x
// scale, dark background) for eyeballing art changes. Not part of the build.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'client/assets';
const names = readdirSync(DIR).filter((f) => f.endsWith('.png') && !f.startsWith('logo')).sort();
const SCALE = 4;
const CELL = 96 * 1; // enough for the 96px buildings at 1x, smaller sprites centred
const COLS = 8;
const rows = Math.ceil(names.length / COLS);
const sheet = new PNG({ width: COLS * CELL, height: rows * (CELL + 12) });
sheet.data.fill(40);
for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;

names.forEach((name, idx) => {
  const img = PNG.sync.read(readFileSync(join(DIR, name)));
  const cx = (idx % COLS) * CELL;
  const cy = Math.floor(idx / COLS) * (CELL + 12);
  const ox = cx + Math.floor((CELL - img.width) / 2);
  const oy = cy + Math.floor((CELL - img.height) / 2);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const a = img.data[si + 3];
      if (a === 0) continue;
      const di = ((oy + y) * sheet.width + ox + x) * 4;
      const af = a / 255;
      for (let c = 0; c < 3; c++) sheet.data[di + c] = img.data[si + c] * af + sheet.data[di + c] * (1 - af);
      sheet.data[di + 3] = 255;
    }
});
const out = process.argv[2] ?? 'sheet.png';
writeFileSync(out, PNG.sync.write(sheet));
console.log('wrote', out, names.length, 'sprites');
