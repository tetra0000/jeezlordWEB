// Client fog of war. A dark overlay covers the whole map and is inverse-masked
// by the union of vision circles around the player's OWN units/buildings — so
// the area within line of sight is clear and everything else is dimmed. Enemies
// outside vision are already withheld by the server (snapshot.ts), so this is
// purely the visual layer; it can't leak hidden information.
import { Container, Graphics } from 'pixi.js';
import { MAP_PX, TILE } from '../../../shared/constants.js';
import { visionOf } from '../../../shared/stats.js';
import type { ClientState } from '../state.js';

export class Fog {
  readonly container = new Container();
  private readonly dark = new Graphics();
  private readonly mask = new Graphics();

  constructor() {
    this.dark.rect(0, 0, MAP_PX, MAP_PX).fill({ color: 0x05070a, alpha: 0.62 });
    this.container.addChild(this.dark);
    this.container.addChild(this.mask);
    // Inverse mask: fog is hidden where the mask is painted (inside vision).
    this.dark.setMask?.({ mask: this.mask, inverse: true });
  }

  update(state: ClientState): void {
    // Admin reveal: hide the dimming layer entirely (server is also sending all
    // entities, so there's nothing to dim).
    if (state.adminReveal) {
      this.dark.visible = false;
      return;
    }
    this.dark.visible = true;
    this.mask.clear();
    let any = false;
    for (const e of state.entities.values()) {
      if (e.view.owner !== state.playerId) continue;
      const r = visionOf(e.view.kind) * TILE + TILE * 0.5;
      if (r <= 0) continue;
      this.mask.circle(e.rx, e.ry, r);
      any = true;
    }
    if (any) this.mask.fill(0xffffff);
  }
}
