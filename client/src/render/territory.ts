// Territory overlay. A player's territory is the UNION of their town centers'
// circles, so same-owner circles must read as one merged blob — not stacked
// rings with crossing interior borders and double-darkened overlaps.
//
// Per owner we draw, into a reused slot:
//   - fill:   every circle added to one path, filled once (nonzero winding =>
//             overlaps merge with no seam and no alpha build-up),
//   - stroke: every circle stroked, but masked by the INVERSE of the union
//             shrunk by the border width, so only the outer boundary survives
//             (arcs that fall inside another of the owner's circles vanish).
// Different owners keep separate slots, so rival borders still cross where their
// territories contest — only same-owner territory merges.
import { Container, Graphics } from 'pixi.js';
import { TILE } from '../../../shared/constants.js';
import type { PlayerId } from '../../../shared/types.js';
import type { ClientState } from '../state.js';
import { ownerColor } from './colors.js';

const BORDER_WIDTH = 2;

interface Slot {
  group: Container;
  fill: Graphics;
  stroke: Graphics;
  mask: Graphics;
}

export class TerritoryLayer {
  readonly container = new Container();
  private readonly slots: Slot[] = [];

  private slot(i: number): Slot {
    if (this.slots[i]) return this.slots[i];
    const group = new Container();
    const fill = new Graphics();
    const stroke = new Graphics();
    const mask = new Graphics();
    // The mask must live in the scene graph to take effect; it isn't drawn
    // visibly when used as a mask. Inverse mask: stroke shows only OUTSIDE it.
    group.addChild(fill, stroke, mask);
    stroke.setMask?.({ mask, inverse: true });
    this.container.addChild(group);
    const s: Slot = { group, fill, stroke, mask };
    this.slots[i] = s;
    return s;
  }

  draw(state: ClientState): void {
    // Group every visible town center's circle by owner.
    const groups = new Map<PlayerId | null, Array<{ x: number; y: number; r: number }>>();
    for (const e of state.entities.values()) {
      const v = e.view;
      if (v.kind !== 'townCenter' || !v.territory) continue;
      let arr = groups.get(v.owner);
      if (!arr) groups.set(v.owner, (arr = []));
      arr.push({ x: v.x, y: v.y, r: v.territory * TILE });
    }

    let i = 0;
    for (const [owner, circles] of groups) {
      const { group, fill, stroke, mask } = this.slot(i++);
      const col = ownerColor(owner);
      fill.clear();
      stroke.clear();
      mask.clear();
      for (const c of circles) {
        fill.circle(c.x, c.y, c.r);
        stroke.circle(c.x, c.y, c.r);
        // Shrink so a lone circle's whole stroke survives, while arcs buried in a
        // neighbouring circle (well inside its radius) get masked away.
        mask.circle(c.x, c.y, Math.max(0, c.r - BORDER_WIDTH));
      }
      fill.fill({ color: col, alpha: 0.08 });
      stroke.stroke({ width: BORDER_WIDTH, color: col, alpha: 0.55 });
      mask.fill(0xffffff);
      group.visible = true;
    }
    // Hide any slots left over from a previous frame with more owners.
    for (; i < this.slots.length; i++) this.slots[i].group.visible = false;
  }
}
