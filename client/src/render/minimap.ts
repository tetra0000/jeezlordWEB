// Minimap drawn on a plain 2D canvas: own entities (bright), currently-visible
// others (server-filtered, so out-of-vision enemies never appear), and the
// camera viewport rectangle. Click to recentre the camera.
import { MAP_PX } from '../../../shared/constants.js';
import { isBuilding, isResourceNode } from '../../../shared/stats.js';
import type { ClientState } from '../state.js';
import type { GameRenderer } from './app.js';
import { ownerColor } from './colors.js';

export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly size: number;
  private readonly scale: number;

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

  draw(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#11160f';
    ctx.fillRect(0, 0, this.size, this.size);

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
