// Territory geometry, shared by server (placement validation) and client
// (border render + placement ghost tint). A player's territory is the union of
// circles centred on their town centers, each with a radius in tiles. Pure data
// — no Node/DOM APIs.
import { TILE } from './constants.js';

export interface TerritorySource {
  x: number; // center, px
  y: number; // center, px
  radiusTiles: number;
}

// Is the centre of tile (tx, ty) inside any source circle?
export function tileInTerritory(sources: TerritorySource[], tx: number, ty: number): boolean {
  const px = (tx + 0.5) * TILE;
  const py = (ty + 0.5) * TILE;
  for (const s of sources) {
    const r = s.radiusTiles * TILE;
    const dx = px - s.x;
    const dy = py - s.y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

// Every tile of a footprint must be inside territory (used for normal buildings).
export function footprintInTerritory(
  sources: TerritorySource[],
  tileX: number,
  tileY: number,
  footprint: number,
): boolean {
  for (let dy = 0; dy < footprint; dy++)
    for (let dx = 0; dx < footprint; dx++)
      if (!tileInTerritory(sources, tileX + dx, tileY + dy)) return false;
  return true;
}

// At least one footprint tile is inside territory (used for town centers, which
// expand the frontier — they only need to touch existing territory).
export function footprintTouchesTerritory(
  sources: TerritorySource[],
  tileX: number,
  tileY: number,
  footprint: number,
): boolean {
  for (let dy = 0; dy < footprint; dy++)
    for (let dx = 0; dx < footprint; dx++)
      if (tileInTerritory(sources, tileX + dx, tileY + dy)) return true;
  return false;
}
