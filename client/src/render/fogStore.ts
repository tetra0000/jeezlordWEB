// Persistence for the fog-of-war "explored" bitmap. The explored set is purely
// a client-side visual layer (the server already withholds hidden entities), so
// we store it locally rather than on the wire: it survives a page reload but is
// scoped to (player, world) so a regenerated map or a different account starts
// fresh.
//
// Storage format: the explored Uint8Array (1 byte/tile, 0|1) is bit-packed (8
// tiles/byte) then base64'd — ~43 KB for a 512² map, well under the localStorage
// quota. The key folds in a cheap terrain hash so a server-side world regen
// (different terrain) naturally lands on a new key and shows no stale fog.

const PREFIX = 'jz_fog_';

// FNV-1a 32-bit over the terrain grid → hex. Same terrain ⇒ same world ⇒ same
// key; a regenerated map hashes differently and gets a clean slate.
function terrainHash(terrain: Uint8Array | null): string {
  let h = 0x811c9dc5;
  if (terrain) {
    for (let i = 0; i < terrain.length; i++) {
      h ^= terrain[i];
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

export function fogKey(playerId: number, mapTiles: number, terrain: Uint8Array | null): string {
  return `${PREFIX}${playerId}_${mapTiles}_${terrainHash(terrain)}`;
}

export function loadExplored(key: string, len: number): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(key);
    if (!b64) return null;
    const bin = atob(b64);
    const explored = new Uint8Array(len);
    for (let i = 0; i < len; i++)
      if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) explored[i] = 1;
    return explored;
  } catch {
    return null; // corrupt/oversized entry — fall back to a fresh fog
  }
}

export function saveExplored(key: string, explored: Uint8Array): void {
  try {
    const bytes = new Uint8Array(Math.ceil(explored.length / 8));
    for (let i = 0; i < explored.length; i++)
      if (explored[i]) bytes[i >> 3] |= 1 << (i & 7);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    localStorage.setItem(key, btoa(bin));
  } catch {
    // Quota exceeded or storage disabled — fog just won't persist this session.
  }
}

export function clearExplored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage disabled — nothing to clear */
  }
}
