// Renders entities as sprites (one PNG per kind), tinting units/buildings by
// owner colour, with a selection ring, health bar, construction fade + progress,
// and training progress. Each unit's `action` drives a procedural animation
// (chopping / mining / picking / hammering / fighting / walking) plus short-lived
// effect particles. Positions interpolate toward the authoritative target.
import { Container, Graphics, Sprite } from 'pixi.js';
import { TILE } from '../../../shared/constants.js';
import { BUILDING_STATS, isBuilding, isResourceNode } from '../../../shared/stats.js';
import type { Action, EntityId, EntityKind } from '../../../shared/types.js';
import type { ClientState } from '../state.js';
import { ownerColor } from './colors.js';
import { tex } from './assets.js';

interface Sprite_ {
  node: Container;
  body: Sprite;
  ring: Graphics;
  hpBg: Graphics;
  hpFg: Graphics;
  prog: Graphics;
  half: number;
  phase: number; // per-entity animation offset
  fxTimer: number;
}

interface Effect {
  spr: Sprite;
  life: number;
  vy: number;
}

const INTERP_RATE = 12;
const UNIT_SIZE = 26;
const RESOURCE_SIZE = 28;

function displaySize(kind: EntityKind): number {
  if (isBuilding(kind)) return BUILDING_STATS[kind].footprint * TILE;
  if (isResourceNode(kind)) return RESOURCE_SIZE;
  return UNIT_SIZE;
}

// Which fx sprite + cadence each work action uses.
const FX_FOR: Partial<Record<Action, string>> = {
  gatherWood: 'fx_chop',
  gatherGold: 'fx_spark',
  gatherStone: 'fx_dust',
  gatherFood: 'fx_leaf',
  build: 'fx_dust',
  attack: 'fx_slash',
};

export class EntityLayer {
  readonly container = new Container();
  private readonly fxLayer = new Container();
  private readonly sprites = new Map<EntityId, Sprite_>();
  private readonly effects: Effect[] = [];
  private t = 0;

  constructor() {
    this.container.addChild(this.fxLayer);
  }

  private create(state: ClientState, id: EntityId): Sprite_ {
    const e = state.entities.get(id)!;
    const kind = e.view.kind;
    const size = displaySize(kind);
    const half = size / 2;

    const node = new Container();
    const body = new Sprite(tex[kind]);
    body.anchor.set(0.5, 0.5);
    body.width = size;
    body.height = size;
    if (isBuilding(kind) || (!isResourceNode(kind))) body.tint = ownerColor(e.view.owner);
    node.addChild(body);

    const ring = new Graphics();
    if (isBuilding(kind)) ring.rect(-half - 2, -half - 2, half * 2 + 4, half * 2 + 4).stroke({ width: 2, color: 0xffffff });
    else ring.circle(0, 0, half + 3).stroke({ width: 2, color: 0xffffff });
    ring.visible = false;
    node.addChild(ring);

    const hpBg = new Graphics();
    hpBg.rect(-half, -half - 8, half * 2, 4).fill(0x000000);
    hpBg.visible = false;
    const hpFg = new Graphics();
    const prog = new Graphics();
    prog.visible = false;
    node.addChild(hpBg, hpFg, prog);

    this.container.addChild(node);
    const s: Sprite_ = { node, body, ring, hpBg, hpFg, prog, half, phase: (id * 1.7) % 6.283, fxTimer: 0 };
    this.sprites.set(id, s);
    return s;
  }

  private spawnEffect(kind: string, x: number, y: number): void {
    const t = tex[kind];
    if (!t) return;
    const spr = new Sprite(t);
    spr.anchor.set(0.5);
    spr.x = x;
    spr.y = y;
    this.fxLayer.addChild(spr);
    this.effects.push({ spr, life: 0.5, vy: -22 });
  }

  // Apply the per-action animation to a unit's body sprite (transforms only).
  private animate(s: Sprite_, action: Action | undefined, dt: number): void {
    const b = s.body;
    b.rotation = 0;
    b.x = 0;
    b.y = 0;
    const ph = this.t * 1000 + s.phase * 200;
    const fast = ph / 90;
    switch (action) {
      case 'gatherWood':
        b.rotation = Math.sin(fast) * 0.5; // chopping swing
        break;
      case 'gatherGold':
      case 'gatherStone':
        b.y = -Math.abs(Math.sin(fast)) * 4; // pickaxe up/down
        b.rotation = Math.sin(fast) * 0.12;
        break;
      case 'gatherFood':
        b.y = Math.sin(fast * 0.6) * 2; // gentle picking bob
        break;
      case 'build':
        b.y = -Math.abs(Math.sin(fast)) * 3; // hammering
        b.rotation = Math.sin(fast) * 0.1;
        break;
      case 'attack': {
        const l = Math.max(0, Math.sin(fast)); // lunge pulse
        b.y = -l * 3;
        b.rotation = Math.sin(fast * 1.3) * 0.18;
        break;
      }
      case 'move':
        b.rotation = Math.sin(fast * 0.7) * 0.12; // waddle
        break;
      default:
        break;
    }
    // Spawn work particles.
    const fx = action ? FX_FOR[action] : undefined;
    s.fxTimer -= dt;
    if (fx && s.fxTimer <= 0) {
      s.fxTimer = 0.28;
      this.spawnEffect(fx, s.node.x + (Math.random() - 0.5) * 6, s.node.y - s.half);
    }
  }

  frame(state: ClientState, dtSeconds: number): void {
    this.t += dtSeconds;

    for (const id of this.sprites.keys()) {
      if (!state.entities.has(id)) {
        this.sprites.get(id)!.node.destroy({ children: true });
        this.sprites.delete(id);
      }
    }

    const k = Math.min(1, dtSeconds * INTERP_RATE);
    for (const [id, e] of state.entities) {
      let s = this.sprites.get(id);
      if (!s) s = this.create(state, id);

      e.rx += (e.view.x - e.rx) * k;
      e.ry += (e.view.y - e.ry) * k;
      s.node.x = e.rx;
      s.node.y = e.ry;

      s.ring.visible = state.selection.has(id);

      const building = e.view.build;
      s.node.alpha = building != null ? 0.45 + 0.45 * building : 1;

      if (!isBuilding(e.view.kind) && !isResourceNode(e.view.kind)) {
        this.animate(s, e.view.action, dtSeconds);
      }

      // Health bar.
      const ratio = e.view.maxHp > 0 ? e.view.hp / e.view.maxHp : 1;
      const showHp = (ratio < 0.999 && building == null) || state.selection.has(id);
      s.hpBg.visible = showHp;
      if (showHp) {
        const w = s.half * 2 * Math.max(0, ratio);
        const col = ratio > 0.5 ? 0x4ad96a : ratio > 0.25 ? 0xd9c14a : 0xd94a4a;
        s.hpFg.clear().rect(-s.half, -s.half - 8, w, 4).fill(col);
      } else {
        s.hpFg.clear();
      }

      // Progress bar: construction (blue) or training (yellow).
      if (building != null) {
        s.prog.visible = true;
        s.prog.clear().rect(-s.half, s.half + 4, s.half * 2 * building, 4).fill(0x6ab0ff);
      } else if (e.view.train) {
        s.prog.visible = true;
        const tr = e.view.train;
        s.prog
          .clear()
          .rect(-s.half, s.half + 4, s.half * 2, 4)
          .fill(0x222222)
          .rect(-s.half, s.half + 4, s.half * 2 * tr.pct, 4)
          .fill(0xffd24a);
      } else {
        s.prog.visible = false;
      }
    }

    // Advance + cull effect particles.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life -= dtSeconds;
      fx.spr.y += fx.vy * dtSeconds;
      fx.spr.alpha = Math.max(0, fx.life / 0.5);
      if (fx.life <= 0) {
        fx.spr.destroy();
        this.effects.splice(i, 1);
      }
    }
  }
}
