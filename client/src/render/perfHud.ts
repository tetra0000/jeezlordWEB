// Lightweight on-screen perf readout. It's a DOM overlay, so it costs nothing on
// the canvas itself. Shows a smoothed FPS + frame time plus entity / sprite / fx
// counts — the entity count is the tell for when the world (e.g. thousands of
// discovered resource nodes) is what's dragging the frame down. Toggle with F3.
export class PerfHud {
  private readonly el: HTMLElement;
  private emaMs = 16.7; // exponential moving average of frame time
  private acc = 0; // ms since the last text refresh
  private visible = true;

  constructor() {
    const el = document.createElement('div');
    el.id = 'perf-hud';
    el.textContent = '— fps';
    document.body.appendChild(el);
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this.visible = !this.visible;
        this.el.classList.toggle('hidden', !this.visible);
      }
    });
  }

  frame(dtMs: number, stats: { entities: number; sprites: number; fx: number }): void {
    // Clamp the occasional huge dt (tab refocus / GC pause) so it doesn't poison
    // the average and make the readout lie for a second afterwards.
    this.emaMs += (Math.min(dtMs, 100) - this.emaMs) * 0.1;
    this.acc += dtMs;
    if (this.acc < 250) return; // refresh the text ~4x/s to avoid layout churn
    this.acc = 0;
    const fps = 1000 / this.emaMs;
    this.el.textContent =
      `${fps.toFixed(0)} fps · ${this.emaMs.toFixed(1)} ms\n` +
      `${stats.entities} ent · ${stats.sprites} spr · ${stats.fx} fx`;
  }
}
