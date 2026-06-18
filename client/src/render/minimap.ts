// Minimap drawn on a plain 2D canvas: own entities (bright), currently-visible
// others (server-filtered, so out-of-vision enemies never appear), and the
// camera viewport rectangle. Click to recentre the camera.
import { MAP_PX, TERRAIN_WATER, TERRAIN_BRIDGE } from '../../../shared/constants.js';
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

  // Rasterize the terrain grid into an offscreen canvas at minimap resolution.
  private buildTerrain(terrain: Uint8Array, mapTiles: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.size;
    c.height = this.size;
    const tctx = c.getContext('2d')!;
    tctx.fillStyle = '#11160f'; // grass / unexplored base
    tctx.fillRect(0, 0, this.size, this.size);
    const px = this.size / mapTiles;
    const cell = Math.max(1, Math.ceil(px));
    for (let ty = 0; ty < mapTiles; ty++) {
      for (let tx = 0; tx < mapTiles; tx++) {
        const code = terrain[ty * mapTiles + tx];
        if (code !== TERRAIN_WATER && code !== TERRAIN_BRIDGE) continue;
        tctx.fillStyle = code === TERRAIN_WATER ? '#2c5a86' : '#8a5a32';
        tctx.fillRect(tx * px, ty * px, cell, cell);
      }
    }
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
