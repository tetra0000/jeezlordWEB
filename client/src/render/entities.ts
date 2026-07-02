// Renders entities as sprites (one PNG per kind), tinting units/buildings by
// owner colour, with a selection ring, health bar, construction fade + progress,
// and training progress. Each unit's `action` drives a procedural animation
// (chopping / mining / picking / hammering / fighting / walking) plus short-lived
// effect particles. Positions interpolate toward the authoritative target.
import { Container, Graphics, Point, Sprite, Text } from 'pixi.js';
import { TILE } from '../../../shared/constants.js';
import { BUILDING_STATS, TERRITORY_MAX_TILES, UNIT_STATS, isBuilding, isResourceNode, squadMen } from '../../../shared/stats.js';
import type { Action, EntityId, EntityKind, PlayerId, ProjectileKind } from '../../../shared/types.js';
import type { ClientState } from '../state.js';
import { ownerColor } from './colors.js';
import { tex } from './assets.js';
import { sound, type SoundName, panAt, vary } from '../audio/sound.js';

// Padded camera rect in world px; entities outside it are not rendered.
export interface Viewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Sprite_ {
  node: Container;
  body: Sprite;
  // Squad rendering: military squads draw one small figure per soldier. `body`
  // is figures[0]; each figure keeps its formation offset in figureOffs and its
  // own animation phase. Figures beyond the squad's surviving men are hidden.
  figures: Sprite[];
  figureOffs: Array<{ x: number; y: number }>;
  menShown: number; // last drawn surviving-men count (-1 = not a squad)
  // Overhead badge (unit type / villager job) so units read at a glance.
  icon?: Sprite;
  iconKey: string; // last texture key drawn ('' = none)
  gateOpenShown?: boolean; // gates: last drawn open/closed texture state
  // Overlay graphics are created lazily and skipped entirely for resource nodes
  // (the bulk of the world): they're never selected, damaged, or built/trained,
  // so they need none of these — saving 4 Graphics per node under admin reveal.
  ring?: Graphics;
  hpBg?: Graphics;
  hpFg?: Graphics;
  prog?: Graphics;
  label?: Text; // town-center name label
  half: number;
  phase: number; // per-entity animation offset
  fxTimer: number;
  hpShown: boolean; // last health-bar visibility (so geometry only rebuilds on change)
  hpRatio: number; // last drawn hp ratio
  progKey: string; // last drawn construction/training state
}

interface Effect {
  spr: Sprite;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
}

// An in-flight ranged projectile (arrow/boulder) arcing from shooter to target.
// Cosmetic only — the server already applied the damage when it fired.
interface Projectile {
  g: Graphics;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number; // seconds left in flight
  maxLife: number;
  arc: number; // peak lift of the parabola, in world px
  kind: ProjectileKind;
}

// Expanding ground ring (move/attack/gather marker, building-complete flash).
interface Ping {
  g: Graphics;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  r0: number;
  r1: number;
  color: number;
}

const INTERP_RATE = 12;
const UNIT_SIZE = 26;
const RESOURCE_SIZE = 28;
// A squad's individual soldiers draw smaller than a lone unit, spread in a tight
// formation around the entity position (2x2 for foot squads, side-by-side pairs
// for cavalry). Offsets are slightly ragged so it reads as men, not a grid.
const FIGURE_SIZE = 19;
const SQUAD_OFFSETS: Record<number, Array<{ x: number; y: number }>> = {
  2: [{ x: -7, y: 1 }, { x: 7, y: -2 }],
  3: [{ x: -8, y: -5 }, { x: 8, y: -3 }, { x: 0, y: 7 }],
  4: [{ x: -7, y: -7 }, { x: 8, y: -5 }, { x: -6, y: 7 }, { x: 7, y: 8 }],
};

function displaySize(kind: EntityKind): number {
  if (isBuilding(kind)) return BUILDING_STATS[kind].footprint * TILE;
  if (isResourceNode(kind)) return RESOURCE_SIZE;
  return UNIT_SIZE;
}

// Draw order within the shared entity container (higher = on top). Resource
// nodes / ground items sit lowest, buildings above them, and units on top of
// everything so they're never hidden behind a building or a tree.
const Z_GROUND = 0; // fx particles, rally lines, command pings
const Z_RESOURCE = 1;
const Z_BUILDING = 2;
const Z_UNIT = 3;
const Z_PATH = 4; // planned move path, drawn over units so it stays visible
const Z_RALLY = 5; // rally flags, above the move paths so the flag stays readable
const Z_PROJECTILE = 6; // arrows/boulders in flight, above everything

function zIndexFor(kind: EntityKind): number {
  if (kind === 'corpse') return Z_RESOURCE; // on the ground, under the living
  if (isResourceNode(kind)) return Z_RESOURCE;
  if (isBuilding(kind)) return Z_BUILDING;
  return Z_UNIT;
}

// A corpse's colour: the dead unit's team tint, blended most of the way toward
// grey so it reads as a faded body but you can still tell whose it was. Neutral
// (no team) corpses are plain grey.
function corpseTint(team: PlayerId | null): number {
  const grey = 0x6f6f6f;
  if (team == null) return grey;
  const c = ownerColor(team);
  const mix = (shift: number): number => {
    const cc = (c >> shift) & 0xff;
    const gg = (grey >> shift) & 0xff;
    return Math.round(gg * 0.65 + cc * 0.35);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
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

// Looping work-action SFX (positional, throttled in the sound engine). Combat
// audio comes from actual damage events (hp drops), not the attack swing, so
// 'attack' is intentionally absent here.
const SFX_FOR: Partial<Record<Action, SoundName>> = {
  gatherWood: 'chop',
  gatherGold: 'mine',
  gatherStone: 'mine',
  gatherFood: 'forage',
  build: 'hammer',
};

export class EntityLayer {
  readonly container = new Container();
  private readonly fxLayer = new Container();
  private readonly rallyG = new Graphics(); // rally flags for selected buildings
  private readonly rangeG = new Graphics(); // attack radius of selected towers
  private readonly gatherG = new Graphics(); // harvest radius of selected gather camps
  private readonly territoryG = new Graphics(); // max-growth border of selected town centers
  private readonly pathG = new Graphics(); // planned move paths for selected units
  private readonly projLayer = new Container(); // arrows/boulders in flight
  private readonly sprites = new Map<EntityId, Sprite_>();
  private readonly effects: Effect[] = [];
  private readonly pings: Ping[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly tmp = new Point();
  private t = 0;

  constructor() {
    // Depth is by zIndex (set per-entity in create()), not insertion order, so
    // units always draw over buildings/resources regardless of when each sprite
    // was lazily created on entering the viewport.
    this.container.sortableChildren = true;
    this.fxLayer.zIndex = Z_GROUND;
    this.rallyG.zIndex = Z_RALLY;
    this.rangeG.zIndex = Z_GROUND;
    this.gatherG.zIndex = Z_GROUND;
    this.territoryG.zIndex = Z_GROUND;
    this.pathG.zIndex = Z_PATH;
    this.projLayer.zIndex = Z_PROJECTILE;
    this.container.addChild(this.fxLayer);
    this.container.addChild(this.rallyG);
    this.container.addChild(this.rangeG);
    this.container.addChild(this.gatherG);
    this.container.addChild(this.territoryG);
    this.container.addChild(this.pathG);
    this.container.addChild(this.projLayer);
  }

  // Draw a rally flag (+ a line from the building) for every selected own
  // building that has a rally point set.
  private drawRallyFlags(state: ClientState): void {
    const g = this.rallyG;
    g.clear();
    for (const id of state.selection) {
      const e = state.entities.get(id);
      if (!e || !e.view.rally) continue;
      const { x, y } = e.view.rally;
      g.moveTo(e.rx, e.ry).lineTo(x, y).stroke({ width: 1.5, color: 0xffd24a, alpha: 0.5 });
      // Flag: pole + pennant at the rally point.
      g.moveTo(x, y).lineTo(x, y - 18).stroke({ width: 2, color: 0xffe9a8 });
      g.poly([x, y - 18, x + 12, y - 14, x, y - 10]).fill({ color: 0xffd24a });
      g.circle(x, y, 3).fill({ color: 0xffd24a, alpha: 0.8 });
    }
  }

  // Draw the planned move path (server-sent remaining waypoints) for every
  // selected own unit, from its current render position through each waypoint,
  // with a small ring at the destination.
  private drawPaths(state: ClientState): void {
    const g = this.pathG;
    g.clear();
    for (const id of state.selection) {
      const e = state.entities.get(id);
      const path = e?.view.path;
      if (!e || !path || path.length === 0) continue;
      g.moveTo(e.rx, e.ry);
      for (const p of path) g.lineTo(p.x, p.y);
      g.stroke({ width: 2, color: 0x8ad06a, alpha: 0.55 });
      const dest = path[path.length - 1];
      g.circle(dest.x, dest.y, 4).stroke({ width: 2, color: 0x8ad06a, alpha: 0.8 });
    }
  }

  // Draw the attack radius of every selected own tower (any building that fires)
  // so the player can see its coverage.
  private drawRanges(state: ClientState): void {
    const g = this.rangeG;
    g.clear();
    for (const id of state.selection) {
      const e = state.entities.get(id);
      if (!e || !isBuilding(e.view.kind)) continue;
      const stat = BUILDING_STATS[e.view.kind];
      if (stat.attack == null || !stat.range) continue;
      g.circle(e.rx, e.ry, stat.range)
        .fill({ color: 0xff6a4a, alpha: 0.06 })
        .stroke({ width: 1.5, color: 0xff8a5a, alpha: 0.5 });
    }
  }

  // Draw the harvest radius of every selected gather camp (lumber/mining/mill):
  // the area within which its gatherers work resource nodes. This is NOT
  // territory (units don't heal in it); the town center shows territory instead.
  private drawGatherRadius(state: ClientState): void {
    const g = this.gatherG;
    g.clear();
    for (const id of state.selection) {
      const e = state.entities.get(id);
      if (!e || e.view.kind === 'townCenter' || !isBuilding(e.view.kind)) continue;
      const radius = BUILDING_STATS[e.view.kind].gatherRadius;
      if (!radius) continue;
      g.circle(e.rx, e.ry, radius * TILE)
        .fill({ color: 0xffcf6a, alpha: 0.05 })
        .stroke({ width: 1.5, color: 0xffd98a, alpha: 0.55 });
    }
  }

  // Draw the maximum border every selected town center will grow to (its
  // territory radius caps at TERRITORY_MAX_TILES), so the player can see how far
  // the frontier will eventually reach.
  private drawTerritoryMax(state: ClientState): void {
    const g = this.territoryG;
    g.clear();
    for (const id of state.selection) {
      const e = state.entities.get(id);
      if (!e || e.view.kind !== 'townCenter') continue;
      g.circle(e.rx, e.ry, TERRITORY_MAX_TILES * TILE)
        .stroke({ width: 2, color: 0x8af0c0, alpha: 0.5 });
    }
  }

  private create(state: ClientState, id: EntityId): Sprite_ {
    const e = state.entities.get(id)!;
    const kind = e.view.kind;
    // A corpse renders the dead unit's sprite (greyed + flat in frame()), and —
    // like a resource node — carries none of the live overlays (ring/hp/label).
    const isCorpse = kind === 'corpse';
    const texKind = isCorpse ? (e.view.corpse?.kind ?? 'villager') : kind;
    const size = isCorpse ? UNIT_SIZE : displaySize(kind);
    const half = size / 2;
    const resource = isResourceNode(kind);
    const minimal = resource || isCorpse; // no selection ring / hp / progress / label
    // The entity may have moved while culled (sprite absent); snap the render
    // position to the authoritative target so it doesn't slide in from a stale
    // spot when it re-enters the viewport.
    e.rx = e.view.x;
    e.ry = e.view.y;

    const node = new Container();
    // Trees sit on a patch of forest floor (drawn behind the trunk, tile-sized).
    // It's a child of the node, so it's created/removed with the tree.
    if (kind === 'tree' && tex.tile_forestground) {
      const floor = new Sprite(tex.tile_forestground);
      floor.anchor.set(0.5, 0.5);
      floor.width = TILE;
      floor.height = TILE;
      node.addChild(floor);
    }
    // Military buildings (barracks/range/stable) reserve a walkable, no-build
    // courtyard ring around their footprint (BuildingStat.outline). Draw a dirt
    // path over those ring tiles — a ground decal behind the body, created and
    // destroyed with the building (like the tree's forest-floor patch).
    if (isBuilding(kind) && tex.tile_path) {
      const stat = BUILDING_STATS[kind];
      const o = stat.outline ?? 0;
      const f = stat.footprint;
      for (let dy = -o; dy < f + o; dy++)
        for (let dx = -o; dx < f + o; dx++) {
          if (dx >= 0 && dx < f && dy >= 0 && dy < f) continue; // under the body
          const path = new Sprite(tex.tile_path);
          path.anchor.set(0.5, 0.5);
          path.width = TILE;
          path.height = TILE;
          path.position.set((dx + 0.5 - f / 2) * TILE, (dy + 0.5 - f / 2) * TILE);
          node.addChild(path);
        }
    }

    // Military squads render one figure per soldier; everything else is a single
    // body sprite. (A corpse is always a single fallen figure, even for squads.)
    const squad = !isCorpse && !resource && !isBuilding(kind) ? (UNIT_STATS[kind]?.squad ?? 1) : 1;
    const figures: Sprite[] = [];
    const figureOffs = squad > 1 ? SQUAD_OFFSETS[squad] ?? [] : [{ x: 0, y: 0 }];
    // Sprites carry their own colours; ownership shows through a team-colour
    // OVERLAY (flags/tabards/trim in team_<kind>.png) tinted by owner — not a
    // whole-sprite hue shift.
    const teamTex = !isCorpse && e.view.owner != null ? tex['team_' + texKind] : undefined;
    for (let i = 0; i < Math.max(1, squad); i++) {
      const fig = new Sprite(tex[texKind]);
      fig.anchor.set(0.5, 0.5);
      const fsize = squad > 1 ? FIGURE_SIZE : size;
      fig.width = fsize;
      fig.height = fsize;
      const off = figureOffs[i] ?? { x: 0, y: 0 };
      fig.position.set(off.x, off.y);
      if (isCorpse) {
        fig.tint = corpseTint(e.view.corpse?.team ?? null);
        fig.rotation = Math.PI / 2; // lying down
      } else if (teamTex) {
        // Overlay is a child of the figure so it inherits scale + animation.
        const overlay = new Sprite(teamTex);
        overlay.anchor.set(0.5, 0.5);
        overlay.tint = ownerColor(e.view.owner);
        fig.addChild(overlay);
      }
      node.addChild(fig);
      figures.push(fig);
    }
    const body = figures[0];

    // Overhead badge: unit type at a glance (villagers show their job — the
    // texture is swapped in frame() as the job changes).
    let icon: Sprite | undefined;
    if (!isCorpse && !resource && !isBuilding(kind)) {
      icon = new Sprite();
      icon.anchor.set(0.5, 1);
      icon.y = -half - 10;
      icon.visible = false;
      node.addChild(icon);
    }

    let ring: Graphics | undefined;
    let hpBg: Graphics | undefined;
    let hpFg: Graphics | undefined;
    let prog: Graphics | undefined;
    if (!minimal) {
      ring = new Graphics();
      if (isBuilding(kind)) ring.rect(-half - 2, -half - 2, half * 2 + 4, half * 2 + 4).stroke({ width: 2, color: 0xffffff });
      else ring.circle(0, 0, half + 3).stroke({ width: 2, color: 0xffffff });
      ring.visible = false;
      node.addChild(ring);

      hpBg = new Graphics();
      hpBg.rect(-half, -half - 8, half * 2, 4).fill(0x000000);
      hpBg.visible = false;
      hpFg = new Graphics();
      prog = new Graphics();
      prog.visible = false;
      node.addChild(hpBg, hpFg, prog);
    }

    let label: Text | undefined;
    if (kind === 'townCenter') {
      label = new Text({
        text: '',
        style: { fontSize: 13, fill: 0xffffff, fontFamily: 'system-ui, sans-serif', stroke: { color: 0x000000, width: 3 } },
      });
      label.anchor.set(0.5, 1);
      label.y = -half - 4;
      label.visible = false;
      node.addChild(label);
    }

    node.zIndex = zIndexFor(kind);
    this.container.addChild(node);
    const s: Sprite_ = {
      node, body, figures, figureOffs, menShown: squad > 1 ? squad : -1,
      icon, iconKey: '',
      ring, hpBg, hpFg, prog, label, half,
      phase: (id * 1.7) % 6.283, fxTimer: 0, hpShown: false, hpRatio: -1, progKey: '',
    };
    this.sprites.set(id, s);
    return s;
  }

  get spriteCount(): number {
    return this.sprites.size;
  }
  get fxCount(): number {
    return this.effects.length + this.pings.length + this.projectiles.length;
  }

  private spawnEffect(
    kind: string,
    x: number,
    y: number,
    opts: { vx?: number; vy?: number; life?: number; scale?: number } = {},
  ): void {
    const t = tex[kind];
    if (!t) return;
    const spr = new Sprite(t);
    spr.anchor.set(0.5);
    spr.x = x;
    spr.y = y;
    if (opts.scale != null) spr.scale.set(opts.scale);
    this.fxLayer.addChild(spr);
    const life = opts.life ?? 0.5;
    this.effects.push({ spr, life, maxLife: life, vx: opts.vx ?? 0, vy: opts.vy ?? -22 });
  }

  // --- public event FX (called from the delta/command layers) ---------------

  // Expanding ground ring used as a command marker / completion flash.
  ping(x: number, y: number, color: number, r1 = 34): void {
    const g = new Graphics();
    this.fxLayer.addChild(g);
    this.pings.push({ g, x, y, life: 0.5, maxLife: 0.5, r0: 6, r1, color });
  }

  // A spray of particles flying outward from a point.
  private burst(kind: string, x: number, y: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.5 + Math.random());
      this.spawnEffect(kind, x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 12,
        life: 0.35 + Math.random() * 0.25,
      });
    }
  }

  // Combat impact: a slash plus a couple of sparks.
  hitFx(x: number, y: number): void {
    this.spawnEffect('fx_slash', x, y, { vy: -8, life: 0.3 });
    this.burst('fx_spark', x, y, 2, 34);
  }

  // Unit/building destroyed: a dust cloud + slash.
  deathFx(x: number, y: number): void {
    this.burst('fx_dust', x, y, 5, 30);
    this.spawnEffect('fx_slash', x, y, { vy: -6, life: 0.4, scale: 1.4 });
  }

  // Launch a visible ranged projectile arcing from (x0,y0) to (x1,y1). Flight
  // time scales with distance (a fixed speed per kind); the parabolic arc gives
  // it a thrown/lobbed feel. Drawn each frame in frame(); impact FX on landing.
  spawnShot(x0: number, y0: number, x1: number, y1: number, kind: ProjectileKind): void {
    const g = new Graphics();
    this.projLayer.addChild(g);
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const speed = kind === 'boulder' ? 320 : 680; // world px / s
    const life = Math.max(0.1, dist / speed);
    const arc = kind === 'boulder' ? Math.min(70, dist * 0.28) : Math.min(20, dist * 0.1);
    this.projectiles.push({ g, x0, y0, x1, y1, life, maxLife: life, arc, kind });
  }

  // Construction finished: golden ring + rising sparks.
  completeFx(x: number, y: number): void {
    this.ping(x, y, 0xffd24a, 48);
    for (let i = 0; i < 4; i++)
      this.spawnEffect('fx_spark', x + (Math.random() - 0.5) * 24, y, {
        vy: -40 - Math.random() * 20,
        life: 0.6,
      });
  }

  // Apply the per-action animation to a unit's figures (transforms only). Each
  // squad figure animates around its formation offset with its own phase, so a
  // fighting squad reads as several men swinging out of step.
  private animate(s: Sprite_, action: Action | undefined, dt: number): void {
    for (let i = 0; i < s.figures.length; i++) {
      const b = s.figures[i];
      const off = s.figureOffs[i] ?? { x: 0, y: 0 };
      b.rotation = 0;
      b.x = off.x;
      b.y = off.y;
      const ph = this.t * 1000 + s.phase * 200 + i * 137;
      const fast = ph / 90;
      switch (action) {
        case 'gatherWood':
          b.rotation = Math.sin(fast) * 0.5; // chopping swing
          break;
        case 'gatherGold':
        case 'gatherStone':
          b.y = off.y - Math.abs(Math.sin(fast)) * 4; // pickaxe up/down
          b.rotation = Math.sin(fast) * 0.12;
          break;
        case 'gatherFood':
          b.y = off.y + Math.sin(fast * 0.6) * 2; // gentle picking bob
          break;
        case 'build':
          b.y = off.y - Math.abs(Math.sin(fast)) * 3; // hammering
          b.rotation = Math.sin(fast) * 0.1;
          break;
        case 'attack': {
          const l = Math.max(0, Math.sin(fast)); // lunge pulse
          b.y = off.y - l * 3;
          b.rotation = Math.sin(fast * 1.3) * 0.18;
          break;
        }
        case 'move':
          b.rotation = Math.sin(fast * 0.7) * 0.12; // waddle
          if (s.figures.length > 1) b.y = off.y + Math.sin(fast * 0.7) * 1.5; // marching bob
          break;
        default:
          break;
      }
    }
    // Spawn work particles + a looped, positional work sound on the same
    // cadence (the sound engine throttles per-name, so a crowd stays a rhythm).
    const fx = action ? FX_FOR[action] : undefined;
    s.fxTimer -= dt;
    if (fx && s.fxTimer <= 0) {
      s.fxTimer = 0.28;
      this.spawnEffect(fx, s.node.x + (Math.random() - 0.5) * 6, s.node.y - s.half);
      const sfx = action ? SFX_FOR[action] : undefined;
      if (sfx) {
        const p = s.node.getGlobalPosition(this.tmp); // screen-space (CSS px)
        if (p.x >= -40 && p.x <= window.innerWidth + 40 && p.y >= -40 && p.y <= window.innerHeight + 40)
          sound.play(sfx, { pan: panAt(p.x), rate: vary() });
      }
    }
  }

  frame(state: ClientState, dtSeconds: number, view: Viewport): void {
    this.t += dtSeconds;

    for (const id of this.sprites.keys()) {
      if (!state.entities.has(id)) {
        this.sprites.get(id)!.node.destroy({ children: true });
        this.sprites.delete(id);
      }
    }

    const k = Math.min(1, dtSeconds * INTERP_RATE);
    for (const [id, e] of state.entities) {
      // Viewport culling: entities outside the (padded) camera rect get no
      // sprite and skip all per-frame work, so cost scales with what's on
      // screen — not with world size. This is what keeps admin-reveal (which
      // unfogs the entire map's entities) from tanking the frame rate.
      const v = e.view;
      if (v.x < view.minX || v.x > view.maxX || v.y < view.minY || v.y > view.maxY) {
        const existing = this.sprites.get(id);
        if (existing) {
          existing.node.destroy({ children: true });
          this.sprites.delete(id);
        }
        continue;
      }

      let s = this.sprites.get(id);
      if (!s) s = this.create(state, id);

      e.rx += (e.view.x - e.rx) * k;
      e.ry += (e.view.y - e.ry) * k;
      s.node.x = e.rx;
      s.node.y = e.ry;

      // Corpse: greyed, lying flat, fading out with its decay. No live overlays
      // or animation — just track the fade and move on.
      if (v.kind === 'corpse') {
        const fade = v.corpse?.fade ?? 1;
        s.body.rotation = Math.PI / 2;
        s.body.tint = corpseTint(v.corpse?.team ?? null);
        s.node.alpha = Math.max(0, 0.9 * fade);
        continue;
      }

      if (s.ring) s.ring.visible = state.selection.has(id);

      const building = e.view.build;
      s.node.alpha = building != null ? 0.45 + 0.45 * building : 1;

      // Overhead badge: unit type, or the villager's current job. Only the
      // owner receives `job`, so enemy villagers show the generic badge.
      if (s.icon) {
        const key = v.kind === 'villager' && v.job ? 'icon_job_' + v.job : 'icon_' + v.kind;
        if (key !== s.iconKey) {
          const t = tex[key];
          if (t) {
            s.iconKey = key;
            s.icon.texture = t;
            s.icon.width = 14;
            s.icon.height = 14;
            s.icon.visible = true;
          }
        }
      }

      // Gates swap texture between closed and open (mode 'open' draws raised).
      if (v.kind === 'gate') {
        const open = v.gate === 'open';
        if (open !== s.gateOpenShown && tex.gate_open) {
          s.gateOpenShown = open;
          s.body.texture = open ? tex.gate_open : tex.gate;
        }
      }

      // Squads: hide the figures of fallen men (the hp pool maps to men standing).
      if (s.menShown >= 0) {
        const men = squadMen(v.kind, v.hp, v.maxHp);
        if (men !== s.menShown) {
          s.menShown = men;
          for (let i = 0; i < s.figures.length; i++) s.figures[i].visible = i < men;
        }
      }

      if (!isBuilding(e.view.kind) && !isResourceNode(e.view.kind)) {
        this.animate(s, e.view.action, dtSeconds);
      }

      // Health bar — only rebuild the geometry when it actually changes. Most
      // entities (every resource node, every idle building) sit at full hp, so
      // this skips a per-frame Graphics rebuild across the whole world.
      if (s.hpBg && s.hpFg) {
        const ratio = e.view.maxHp > 0 ? e.view.hp / e.view.maxHp : 1;
        const showHp = (ratio < 0.999 && building == null) || state.selection.has(id);
        if (showHp !== s.hpShown || (showHp && Math.abs(ratio - s.hpRatio) > 0.002)) {
          s.hpShown = showHp;
          s.hpRatio = ratio;
          s.hpBg.visible = showHp;
          if (showHp) {
            const w = s.half * 2 * Math.max(0, ratio);
            const col = ratio > 0.5 ? 0x4ad96a : ratio > 0.25 ? 0xd9c14a : 0xd94a4a;
            s.hpFg.clear().rect(-s.half, -s.half - 8, w, 4).fill(col);
          } else {
            s.hpFg.clear();
          }
        }
      }

      // Progress bar: construction (blue) or training (yellow). Keyed on the
      // percentage so it redraws at the sim rate (~10 Hz), not every frame.
      const progKey = !s.prog ? ''
        : building != null ? `b${building.toFixed(3)}`
        : e.view.train ? `t${e.view.train.pct.toFixed(3)}` : '';
      if (s.prog && progKey !== s.progKey) {
        s.progKey = progKey;
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
          s.prog.clear();
        }
      }

      // Town-center name label.
      if (s.label) {
        const nm = e.view.name ?? '';
        if (nm) {
          if (s.label.text !== nm) s.label.text = nm;
          s.label.visible = true;
        } else {
          s.label.visible = false;
        }
      }
    }

    this.drawRallyFlags(state);
    this.drawRanges(state);
    this.drawGatherRadius(state);
    this.drawTerritoryMax(state);
    this.drawPaths(state);

    // Advance + cull effect particles.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life -= dtSeconds;
      fx.spr.x += fx.vx * dtSeconds;
      fx.spr.y += fx.vy * dtSeconds;
      fx.spr.alpha = Math.max(0, fx.life / fx.maxLife);
      if (fx.life <= 0) {
        fx.spr.destroy();
        this.effects.splice(i, 1);
      }
    }

    // Advance + draw + cull in-flight projectiles. Position follows a parabola
    // (straight base path minus a sine lift), and arrows orient along their
    // instantaneous velocity. On landing we punch a small impact effect.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dtSeconds;
      const f = 1 - Math.max(0, p.life) / p.maxLife; // 0..1 flight progress
      const dx = p.x1 - p.x0;
      const dy = p.y1 - p.y0;
      const x = p.x0 + dx * f;
      const y = p.y0 + dy * f - Math.sin(Math.PI * f) * p.arc;
      const g = p.g.clear();
      if (p.kind === 'boulder') {
        g.circle(x, y, 4).fill({ color: 0x6b6660 }).stroke({ width: 1, color: 0x39352f });
      } else {
        // Velocity direction (derivative of the parabola) for the arrow's angle.
        const vy = dy - Math.cos(Math.PI * f) * Math.PI * p.arc;
        const ang = Math.atan2(vy, dx);
        const hx = Math.cos(ang);
        const hy = Math.sin(ang);
        const len = 9;
        const tipX = x + hx * len;
        const tipY = y + hy * len;
        const px = -hy; // perpendicular, for the arrowhead barbs
        const py = hx;
        g.moveTo(x - hx * len, y - hy * len).lineTo(tipX, tipY).stroke({ width: 2, color: 0x2e2418 });
        g.moveTo(tipX, tipY).lineTo(tipX - hx * 4 + px * 3, tipY - hy * 4 + py * 3)
          .moveTo(tipX, tipY).lineTo(tipX - hx * 4 - px * 3, tipY - hy * 4 - py * 3)
          .stroke({ width: 1.5, color: 0xcfcabf });
      }
      if (p.life <= 0) {
        if (p.kind === 'boulder') this.burst('fx_dust', p.x1, p.y1, 5, 30);
        else this.spawnEffect('fx_spark', p.x1, p.y1, { vy: -6, life: 0.22 });
        p.g.destroy();
        this.projectiles.splice(i, 1);
      }
    }

    // Advance + cull expanding rings (command markers / completion flash).
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.life -= dtSeconds;
      const f = 1 - Math.max(0, p.life) / p.maxLife;
      const radius = p.r0 + (p.r1 - p.r0) * f;
      p.g
        .clear()
        .circle(p.x, p.y, radius)
        .stroke({ width: 2.5, color: p.color, alpha: Math.max(0, p.life / p.maxLife) });
      if (p.life <= 0) {
        p.g.destroy();
        this.pings.splice(i, 1);
      }
    }
  }
}
