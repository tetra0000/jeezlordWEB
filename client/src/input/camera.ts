// Camera control: WASD/arrow panning, middle-drag panning, and wheel zoom
// toward the cursor. The camera is purely client-side and independent of what
// the server reveals (vision is unit-based, added in v6).
import type { GameRenderer } from '../render/app.js';

const PAN_SPEED = 900; // screen px / second
const MIN_SCALE = 0.15;
const MAX_SCALE = 2.0;

export class Camera {
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly r: GameRenderer) {
    window.addEventListener('keydown', (e) => {
      if (this.isPanKey(e.key)) this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    const canvas = r.app.canvas;
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        e.preventDefault();
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.r.world.x += e.clientX - this.lastX;
      this.r.world.y += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 1) this.dragging = false;
    });
    // Suppress the browser context menu so right-click can be a game command.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private isPanKey(key: string): boolean {
    const k = key.toLowerCase();
    return ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const old = this.r.world.scale.x;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor));
    if (next === old) return;
    // Keep the world point under the cursor fixed.
    const mx = e.clientX;
    const my = e.clientY;
    this.r.world.x = mx - ((mx - this.r.world.x) * next) / old;
    this.r.world.y = my - ((my - this.r.world.y) * next) / old;
    this.r.world.scale.set(next);
  }

  /** Center the camera on a world coordinate. */
  centerOn(wx: number, wy: number): void {
    const s = this.r.world.scale.x;
    this.r.world.x = this.r.screenWidth / 2 - wx * s;
    this.r.world.y = this.r.screenHeight / 2 - wy * s;
  }

  update(dtSeconds: number): void {
    const d = PAN_SPEED * dtSeconds;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.r.world.x += d;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.r.world.x -= d;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.r.world.y += d;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.r.world.y -= d;
  }
}
