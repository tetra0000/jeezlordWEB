// Selection + commands + build/train menus + placement ghost.
//  - Left-click selects an owned unit/building; left-drag box-selects own units.
//  - Right-click is context-sensitive: enemy -> attack, resource -> gather,
//    else -> move. Right-click also cancels placement.
//  - The command panel (DOM) shows Build buttons when villagers are selected and
//    Train buttons when an owned production building is selected.
import { Graphics } from 'pixi.js';
import { TILE } from '../../../shared/constants.js';
import {
  BUILDING_STATS,
  UNIT_STATS,
  costOf,
  isBuilding,
  isResourceNode,
} from '../../../shared/stats.js';
import type { Cost } from '../../../shared/stats.js';
import type { EntityKind } from '../../../shared/types.js';
import type { GameRenderer } from '../render/app.js';
import type { ClientState } from '../state.js';
import type { Net } from '../net.js';
import { KIND_STYLE } from '../render/colors.js';

const DRAG_THRESHOLD = 5;
const BUILDABLE: EntityKind[] = [
  'townCenter', 'house', 'mill', 'lumbercamp', 'miningcamp',
  'farm', 'barracks', 'range', 'stable', 'tower', 'wall',
];
const LABEL: Record<string, string> = {
  townCenter: 'Town Center', house: 'House', mill: 'Mill', lumbercamp: 'Lumber Camp',
  miningcamp: 'Mining Camp', farm: 'Farm', barracks: 'Barracks', range: 'Archery', stable: 'Stable',
  tower: 'Tower', wall: 'Wall', villager: 'Villager', infantry: 'Infantry', archer: 'Archer',
  cavalry: 'Cavalry', horse: 'Knight', catapult: 'Catapult',
  tree: 'Tree', gold: 'Gold Mine', stone: 'Stone', berry: 'Berry Bush',
};
const RES_TYPE: Record<string, string> = { tree: 'wood', gold: 'gold', stone: 'stone', berry: 'food' };
const ACTION_LABEL: Record<string, string> = {
  move: 'moving', attack: 'fighting', build: 'building', gatherWood: 'chopping wood',
  gatherGold: 'mining gold', gatherStone: 'mining stone', gatherFood: 'foraging',
};

function costStr(c: Cost): string {
  const parts: string[] = [];
  if (c.wood) parts.push(`🌲${c.wood}`);
  if (c.food) parts.push(`🍖${c.food}`);
  if (c.gold) parts.push(`🪙${c.gold}`);
  if (c.stone) parts.push(`🪨${c.stone}`);
  return parts.join(' ');
}

export class Input {
  private leftDown = false;
  private dragging = false;
  private startX = 0;
  private startY = 0;
  private shift = false;
  private pendingBuild: EntityKind | null = null;
  private readonly ghost = new Graphics();
  private readonly panel = document.getElementById('command-panel')!;
  private readonly toastEl = document.getElementById('toast')!;
  private readonly tooltipEl = document.getElementById('tooltip')!;
  private readonly coordsEl = document.getElementById('coords')!;
  private panelKey = '';
  private toastTimer = 0;

  constructor(
    private readonly r: GameRenderer,
    private readonly state: ClientState,
    private readonly net: Net,
  ) {
    r.world.addChild(this.ghost);
    this.ghost.visible = false;
    const canvas = r.app.canvas;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.shift = true;
      if (e.key === 'Escape') this.cancelPlacement();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        if (this.pendingBuild) {
          this.placeBuilding(e.clientX, e.clientY);
          return;
        }
        this.leftDown = true;
        this.dragging = false;
        this.startX = e.clientX;
        this.startY = e.clientY;
      } else if (e.button === 2) {
        if (this.pendingBuild) this.cancelPlacement();
        else this.onRightClick(e.clientX, e.clientY);
      }
    });

    window.addEventListener('pointermove', (e) => {
      this.updateCoords(e.clientX, e.clientY);
      if (this.pendingBuild) this.updateGhost(e.clientX, e.clientY);
      this.updateTooltip(e.clientX, e.clientY);
      if (!this.leftDown) return;
      if (!this.dragging && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > DRAG_THRESHOLD)
        this.dragging = true;
      if (this.dragging) this.drawBox(e.clientX, e.clientY);
    });

    canvas.addEventListener('pointerleave', () => this.tooltipEl.classList.add('hidden'));

    window.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.leftDown) return;
      this.leftDown = false;
      this.r.selectionBox.clear();
      if (this.dragging) this.boxSelect(e.clientX, e.clientY);
      else this.clickSelect(e.clientX, e.clientY);
      this.dragging = false;
    });
  }

  // --- selection ------------------------------------------------------------
  private drawBox(cx: number, cy: number): void {
    const x = Math.min(this.startX, cx);
    const y = Math.min(this.startY, cy);
    this.r.selectionBox
      .clear()
      .rect(x, y, Math.abs(cx - this.startX), Math.abs(cy - this.startY))
      .fill({ color: 0xffffff, alpha: 0.08 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.8 });
  }

  private clickSelect(cx: number, cy: number): void {
    const p = this.r.screenToWorld(cx, cy);
    const hit = this.state.entityAt(p.x, p.y);
    if (!this.shift) this.state.selection.clear();
    if (hit && hit.view.owner === this.state.playerId) this.state.selection.add(hit.view.id);
  }

  private boxSelect(cx: number, cy: number): void {
    const a = this.r.screenToWorld(this.startX, this.startY);
    const b = this.r.screenToWorld(cx, cy);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (!this.shift) this.state.selection.clear();
    for (const [id, e] of this.state.entities) {
      if (e.view.owner !== this.state.playerId) continue;
      // Box-select prefers units (so you don't grab buildings by accident).
      if (isBuilding(e.view.kind)) continue;
      if (e.view.x >= x0 && e.view.x <= x1 && e.view.y >= y0 && e.view.y <= y1)
        this.state.selection.add(id);
    }
  }

  private selectedVillagers(): number[] {
    const out: number[] = [];
    for (const id of this.state.selection) {
      const e = this.state.entities.get(id);
      if (e && e.view.owner === this.state.playerId && e.view.kind === 'villager') out.push(id);
    }
    return out;
  }

  // --- right-click intent ---------------------------------------------------
  private onRightClick(cx: number, cy: number): void {
    if (this.state.selection.size === 0) return;
    const p = this.r.screenToWorld(cx, cy);
    const ids = [...this.state.selection];
    const target = this.state.entityAt(p.x, p.y);

    if (target && target.view.owner != null && target.view.owner !== this.state.playerId) {
      this.net.send({ t: 'attack', unitIds: ids, targetId: target.view.id });
    } else if (target && isResourceNode(target.view.kind)) {
      const vills = this.selectedVillagers();
      if (vills.length) this.net.send({ t: 'gather', unitIds: vills, nodeId: target.view.id });
      else this.net.send({ t: 'move', unitIds: ids, x: p.x, y: p.y });
    } else {
      this.net.send({ t: 'move', unitIds: ids, x: p.x, y: p.y });
    }
  }

  // --- build placement ------------------------------------------------------
  private startPlacement(kind: EntityKind): void {
    this.pendingBuild = kind;
    this.refreshPanel(true);
  }

  cancelPlacement(): void {
    this.pendingBuild = null;
    this.ghost.visible = false;
    this.refreshPanel(true);
  }

  private ghostTile(cx: number, cy: number): { tileX: number; tileY: number; f: number } {
    const kind = this.pendingBuild!;
    const f = BUILDING_STATS[kind].footprint;
    const p = this.r.screenToWorld(cx, cy);
    const tileX = Math.round(p.x / TILE - f / 2);
    const tileY = Math.round(p.y / TILE - f / 2);
    return { tileX, tileY, f };
  }

  private updateGhost(cx: number, cy: number): void {
    if (!this.pendingBuild) return;
    const { tileX, tileY, f } = this.ghostTile(cx, cy);
    this.ghost.clear()
      .rect(tileX * TILE, tileY * TILE, f * TILE, f * TILE)
      .fill({ color: 0x6ad06a, alpha: 0.35 })
      .stroke({ width: 2, color: 0x9af09a });
    this.ghost.visible = true;
  }

  private placeBuilding(cx: number, cy: number): void {
    if (!this.pendingBuild) return;
    const { tileX, tileY } = this.ghostTile(cx, cy);
    const builders = this.selectedVillagers();
    this.net.send({ t: 'build', builderIds: builders, kind: this.pendingBuild, tileX, tileY });
    if (!this.shift) this.cancelPlacement();
  }

  // --- command panel --------------------------------------------------------
  private trainerBuilding(): number | null {
    for (const id of this.state.selection) {
      const e = this.state.entities.get(id);
      if (e && e.view.owner === this.state.playerId && isBuilding(e.view.kind) && BUILDING_STATS[e.view.kind].trains)
        return id;
    }
    return null;
  }

  // Rebuild the panel when the selection's relevant signature changes.
  update(): void {
    const trainer = this.trainerBuilding();
    const hasVill = this.selectedVillagers().length > 0;
    const key = `${trainer ?? ''}|${hasVill}|${this.pendingBuild ?? ''}`;
    if (key !== this.panelKey) this.refreshPanel(false);
    if (this.toastTimer > 0 && (this.toastTimer -= 1) === 0) this.toastEl.classList.remove('show');
  }

  private refreshPanel(force: boolean): void {
    const trainer = this.trainerBuilding();
    const hasVill = this.selectedVillagers().length > 0;
    this.panelKey = `${trainer ?? ''}|${hasVill}|${this.pendingBuild ?? ''}`;
    this.panel.innerHTML = '';

    if (trainer != null) {
      const kind = this.state.entities.get(trainer)!.view.kind;
      for (const unit of BUILDING_STATS[kind].trains ?? []) {
        this.panel.appendChild(this.makeButton(LABEL[unit] ?? unit, costOf(unit), () =>
          this.net.send({ t: 'train', buildingId: trainer, unit }),
        ));
      }
    } else if (hasVill) {
      for (const kind of BUILDABLE) {
        const btn = this.makeButton(LABEL[kind] ?? kind, BUILDING_STATS[kind].cost, () => this.startPlacement(kind));
        if (kind === this.pendingBuild) btn.classList.add('placing');
        this.panel.appendChild(btn);
      }
    }
    void force;
  }

  private makeButton(label: string, cost: Cost, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerHTML = `${label}<span class="cost">${costStr(cost)}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // Show the cursor's tile coordinates on the game grid (top-right HUD) so
  // players can call out locations to each other.
  private updateCoords(cx: number, cy: number): void {
    const p = this.r.screenToWorld(cx, cy);
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.state.mapTiles || ty >= this.state.mapTiles) {
      this.coordsEl.textContent = '—, —';
    } else {
      this.coordsEl.textContent = `${tx}, ${ty}`;
    }
  }

  // Hover tooltip describing whatever is under the cursor.
  private updateTooltip(cx: number, cy: number): void {
    if (this.pendingBuild || this.dragging) {
      this.tooltipEl.classList.add('hidden');
      return;
    }
    const p = this.r.screenToWorld(cx, cy);
    const hit = this.state.entityAt(p.x, p.y);
    if (!hit) {
      this.tooltipEl.classList.add('hidden');
      return;
    }
    const v = hit.view;
    const name = LABEL[v.kind] ?? v.kind;
    let sub = '';
    if (RES_TYPE[v.kind]) {
      sub = `${v.amount ?? '?'} ${RES_TYPE[v.kind]} left`;
    } else {
      const who = v.owner === this.state.playerId ? 'you' : v.owner == null ? 'neutral' : 'enemy';
      const lines = [`${who} · ${Math.ceil(v.hp)}/${v.maxHp} hp`];
      if (v.build != null) lines.push(`building ${Math.round(v.build * 100)}%`);
      else if (v.train) lines.push(`training (${v.train.queued} queued)`);
      else if (v.action && ACTION_LABEL[v.action]) lines.push(ACTION_LABEL[v.action]);
      sub = lines.join(' · ');
    }
    this.tooltipEl.innerHTML = `<span class="ttl">${name}</span><br><span class="sub">${sub}</span>`;
    this.tooltipEl.style.left = `${cx + 14}px`;
    this.tooltipEl.style.top = `${cy + 16}px`;
    this.tooltipEl.classList.remove('hidden');
  }

  showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = 150; // frames (~2.5s at 60fps)
  }
}

// Keep the placeholder import referenced (sizes used elsewhere); avoids
// accidental tree-shake confusion during refactors.
void KIND_STYLE;
void UNIT_STATS;
