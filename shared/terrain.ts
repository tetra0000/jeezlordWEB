// Run-length codec for the static terrain grid (one byte per tile). The map is
// overwhelmingly grass with sparse rivers, so RLE collapses it to a tiny payload
// that ships in the init message. Pure data — no Node/DOM APIs.
//
// Format: a flat number[] of (count, value) pairs. Decoding sums the counts back
// up to `len` tiles. Server persistence uses raw base64 bytes instead (binary,
// written once); this codec is only for the wire.

export function encodeTerrainRLE(t: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < t.length) {
    const v = t[i];
    let n = 1;
    while (i + n < t.length && t[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  return out;
}

export function decodeTerrainRLE(rle: number[], len: number): Uint8Array {
  const t = new Uint8Array(len);
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    const n = rle[k];
    const v = rle[k + 1];
    for (let j = 0; j < n && i < len; j++) t[i++] = v;
  }
  return t;
}
