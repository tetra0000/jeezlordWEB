// Client fog of war — three states:
//   visible      — inside current own vision: clear.
//   explored     — seen before but not right now: terrain shown, dimmed.
//   undiscovered — never seen: opaque, hides terrain entirely.
//
// Layers over the world:
//   - a dim layer (semi-transparent dark) inverse-masked by the union of CURRENT
//     vision circles (`visMask`, a Graphics geometry mask — zoom-safe), so it
//     lifts inside vision and dims explored-but-not-visible ground.
//   - an "undiscovered" layer: a tile-resolution CANVAS (opaque where never seen)
//     with transparent holes punched in as tiles enter vision, shown as a plain
//     sprite scaled to world px. No GPU mask and no blend tricks — so it renders
//     at every zoom and can't accidentally paint the explored area (an earlier
//     RenderTexture+erase approach mis-blended and showed explored area white).
// Enemies out of vision are already withheld by the server (snapshot.ts) — this
// is purely the visual layer and can't leak hidden info.
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { MAP_PX, TILE } from '../../../shared/constants.js';
import { visionOf } from '../../../shared/stats.js';
import type { ClientState } from '../state.js';

const FOG_COLOR = 0x05070a;
const FOG_FILL = 'rgb(5,7,10)'; // FOG_COLOR, opaque — the undiscovered canvas fill

export class Fog {
  readonly container = new Container();
  private readonly dim = new Graphics(); // explored-but-not-visible dimming
  private readonly visMask = new Graphics(); // union of current vision circles
  // Undiscovered layer (see header): a tile-resolution canvas -> texture -> sprite.
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tex: Texture | null = null;
  private sprite: Sprite | null = null;

  constructor() {
    this.dim.rect(0, 0, MAP_PX, MAP_PX).fill({ color: FOG_COLOR, alpha: 0.5 });
    this.container.addChild(this.dim, this.visMask);
    // Inverse mask: the dim layer is hidden where the mask is painted (in vision).
    this.dim.setMask?.({ mask: this.visMask, inverse: true });
  }

  // New map / reconnect: drop the accumulated exploration so it rebuilds.
  resetExplored(): void {
    this.sprite?.destroy();
    this.sprite = null;
    this.tex?.destroy(true);
    this.tex = null;
    this.canvas = null;
    this.ctx = null;
  }

  private ensure(mapTiles: number, explored: Uint8Array | null): void {
    if (this.canvas || mapTiles <= 0) return;
    const c = document.createElement('canvas');
    c.width = mapTiles;
    c.height = mapTiles;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = FOG_FILL;
    ctx.fillRect(0, 0, mapTiles, mapTiles); // everything undiscovered to start
    // Sync to any already-explored tiles (e.g. canvas rebuilt mid-session).
    if (explored) {
      for (let i = 0; i < explored.length; i++)
        if (explored[i]) ctx.clearRect(i % mapTiles, Math.floor(i / mapTiles), 1, 1);
    }
    this.canvas = c;
    this.ctx = ctx;
    this.tex = Texture.from(c);
    this.sprite = new Sprite(this.tex);
    this.sprite.scale.set(TILE); // tile-res texture -> world px
    this.container.addChild(this.sprite); // drawn on top of the dim layer
  }

  update(state: ClientState): void {
    // Admin reveal: hide both layers (server is also sending everything).
    if (state.adminReveal) {
      this.dim.visible = false;
      if (this.sprite) this.sprite.visible = false;
      return;
    }
    this.dim.visible = true;

    const mt = state.mapTiles;
    if (!state.explored && mt > 0) state.explored = new Uint8Array(mt * mt);
    const explored = state.explored;
    this.ensure(mt, explored);
    if (this.sprite) this.sprite.visible = true;

    // Build the current-vision mask (smooth circles around own entities) and, in
    // the same pass, punch newly-seen tiles out of the undiscovered canvas.
    this.visMask.clear();
    let any = false;
    let dirty = false;
    for (const e of state.entities.values()) {
      if (e.view.owner !== state.playerId) continue;
      const vTiles = visionOf(e.view.kind);
      if (vTiles <= 0) continue;
      this.visMask.circle(e.rx, e.ry, vTiles * TILE + TILE * 0.5);
      any = true;
      if (explored && mt > 0) {
        const cx = Math.floor(e.rx / TILE);
        const cy = Math.floor(e.ry / TILE);
        const r2 = vTiles * vTiles;
        for (let dy = -vTiles; dy <= vTiles; dy++) {
          const ty = cy + dy;
          if (ty < 0 || ty >= mt) continue;
          for (let dx = -vTiles; dx <= vTiles; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const tx = cx + dx;
            if (tx < 0 || tx >= mt) continue;
            const i = ty * mt + tx;
            if (explored[i] === 0) {
              explored[i] = 1;
              this.ctx?.clearRect(tx, ty, 1, 1); // explored tile -> transparent hole
              dirty = true;
            }
          }
        }
      }
    }
    if (any) this.visMask.fill(0xffffff);
    if (dirty) {
      state.exploredVersion++;
      this.tex?.source.update(); // re-upload the changed canvas
    }
  }
}
