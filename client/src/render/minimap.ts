// Minimap drawn on a plain 2D canvas: own entities (bright), currently-visible
// others (server-filtered, so out-of-vision enemies never appear), and the
// camera viewport rectangle. Click to recentre the camera.
import {
  MAP_PX, TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_MOUNTAIN, TERRAIN_MUD, TERRAIN_BEACH,
  TERRAIN_DIRT, TERRAIN_FLOWERS, TERRAIN_LONGGRASS, TERRAIN_SWAMP, TERRAIN_ROCKS, TERRAIN_PASS,
} from '../../../shared/constants.js';
import { isBuilding, isResourceNode } from '../../../shared/stats.js';
import type { ClientState } from '../state.js';
import type { GameRenderer } from './app.js';
import { ownerColor } from './colors.js';

export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly size: number;
  private readonly scale: number;
  // Terrain is static, so rasterize it once into an offscreen canvas and blit
  // that each frame instead of scanning the whole grid 5×/sec.
  private terrainCanvas: HTMLCanvasElement | null = null;
  // Fog: a cached overlay that blacks out never-explored tiles, rebuilt only when
  // the explored set grows (state.exploredVersion changes).
  private unexplored: HTMLCanvasElement | null = null;
  private exploredVersion = -1;

  constructor(
    private readonly r: GameRenderer,
    private readonly state: ClientState,
    onClickWorld: (wx: number, wy: number) => void,
  ) {
    this.size = this.canvas.width;
    this.scale = this.size / MAP_PX;
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const wx = ((e.clientX - rect.left) / rect.width) * MAP_PX;
      const wy = ((e.clientY - rect.top) / rect.height) * MAP_PX;
      onClickWorld(wx, wy);
    });
  }

  // Rasterize the terrain grid via ImageData at tile resolution (one write per
  // tile — no per-tile fillRect calls, which get slow on the 768-tile map),
  // then downscale into a minimap-sized canvas once.
  private buildTerrain(terrain: Uint8Array, mapTiles: number): HTMLCanvasElement {
    const src = document.createElement('canvas');
    src.width = mapTiles;
    src.height = mapTiles;
    const sctx = src.getContext('2d')!;
    const img = sctx.createImageData(mapTiles, mapTiles);
    const d = img.data;
    // [r, g, b] per terrain code; grass-likes use the dark base.
    const BASE: [number, number, number] = [0x11, 0x16, 0x0f];
    const COLOR: Record<number, [number, number, number]> = {
      [TERRAIN_WATER]: [0x2c, 0x5a, 0x86],
      [TERRAIN_BRIDGE]: [0x8a, 0x5a, 0x32],
      [TERRAIN_MOUNTAIN]: [0x56, 0x54, 0x5a],
      [TERRAIN_MUD]: [0x6b, 0x4a, 0x2a],
      [TERRAIN_BEACH]: [0xd9, 0xc8, 0x9a],
      [TERRAIN_DIRT]: [0x4a, 0x3e, 0x28],
      [TERRAIN_FLOWERS]: [0x2a, 0x38, 0x1e],
      [TERRAIN_LONGGRASS]: [0x1a, 0x28, 0x14],
      [TERRAIN_SWAMP]: [0x2e, 0x38, 0x24],
      [TERRAIN_ROCKS]: [0x3e, 0x40, 0x3a],
      [TERRAIN_PASS]: [0x4e, 0x4a, 0x46],
    };
    for (let i = 0; i < terrain.length; i++) {
      const c = COLOR[terrain[i]] ?? BASE;
      const o = i * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const c = document.createElement('canvas');
    c.width = this.size;
    c.height = this.size;
    c.getContext('2d')!.drawImage(src, 0, 0, this.size, this.size);
    return c;
  }

  // Fog overlay: opaque where never explored, transparent where explored. Built
  // via ImageData at tile resolution and downscaled — this rebuilds every time
  // exploration grows, so it has to be cheap.
  private buildUnexplored(explored: Uint8Array, mapTiles: number): HTMLCanvasElement {
    const src = document.createElement('canvas');
    src.width = mapTiles;
    src.height = mapTiles;
    const sctx = src.getContext('2d')!;
    const img = sctx.createImageData(mapTiles, mapTiles);
    const d = img.data;
    for (let i = 0; i < explored.length; i++) {
      if (explored[i]) continue; // transparent
      const o = i * 4;
      d[o] = 3; d[o + 1] = 5; d[o + 2] = 8; d[o + 3] = 235;
    }
    sctx.putImageData(img, 0, 0);
    const c = document.createElement('canvas');
    c.width = this.size;
    c.height = this.size;
    c.getContext('2d')!.drawImage(src, 0, 0, this.size, this.size);
    return c;
  }

  draw(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#11160f';
    ctx.fillRect(0, 0, this.size, this.size);

    if (this.state.terrain && this.state.mapTiles > 0) {
      if (!this.terrainCanvas) this.terrainCanvas = this.buildTerrain(this.state.terrain, this.state.mapTiles);
      ctx.drawImage(this.terrainCanvas, 0, 0);
    } else if (this.terrainCanvas) {
      this.terrainCanvas = null; // map reset — rebuild on next terrain
    }

    for (const e of this.state.entities.values()) {
      if (e.view.kind === 'corpse') continue; // corpses don't clutter the minimap
      const own = e.view.owner === this.state.playerId;
      if (isResourceNode(e.view.kind)) {
        ctx.fillStyle = '#3a5a30';
      } else {
        ctx.fillStyle = own ? '#ffffff' : `#${ownerColor(e.view.owner).toString(16).padStart(6, '0')}`;
      }
      const px = e.view.x * this.scale;
      const py = e.view.y * this.scale;
      const s = isBuilding(e.view.kind) ? 3 : own ? 2 : 2;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }

    // Fog overlay: black out never-explored tiles (skipped under admin reveal).
    if (!this.state.adminReveal && this.state.explored && this.state.mapTiles > 0) {
      if (!this.unexplored || this.exploredVersion !== this.state.exploredVersion) {
        this.unexplored = this.buildUnexplored(this.state.explored, this.state.mapTiles);
        this.exploredVersion = this.state.exploredVersion;
      }
      ctx.drawImage(this.unexplored, 0, 0);
    } else if (this.unexplored) {
      this.unexplored = null;
      this.exploredVersion = -1;
    }

    // Camera viewport rectangle.
    const tl = this.r.screenToWorld(0, 0);
    const br = this.r.screenToWorld(this.r.screenWidth, this.r.screenHeight);
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      tl.x * this.scale,
      tl.y * this.scale,
      (br.x - tl.x) * this.scale,
      (br.y - tl.y) * this.scale,
    );
  }
}
