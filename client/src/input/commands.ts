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
  NON_BUILDER_JOBS,
  UNIT_STATS,
  costOf,
  isBuilding,
  isUnit,
} from '../../../shared/stats.js';
import type { Cost } from '../../../shared/stats.js';
import type { VillagerJob } from '../../../shared/types.js';
import {
  footprintInTerritory,
  footprintTouchesTerritory,
  type TerritorySource,
} from '../../../shared/territory.js';
import type { EntityKind } from '../../../shared/types.js';
import type { GameRenderer } from '../render/app.js';
import type { ClientState } from '../state.js';
import type { Net } from '../net.js';
import { KIND_STYLE } from '../render/colors.js';
import { sound, panAt } from '../audio/sound.js';

const DRAG_THRESHOLD = 5;
const BUILDABLE: EntityKind[] = [
  'townCenter', 'house', 'mill', 'lumbercamp', 'miningcamp',
  'farm', 'barracks', 'range', 'stable', 'tower', 'wall',
];
const LABEL: Record<string, string> = {
  townCenter: 'Town Center', house: 'House', mill: 'Mill', lumbercamp: 'Lumber Camp',
  miningcamp: 'Mining Camp', farm: 'Farm', barracks: 'Barracks', range: 'Archery', stable: 'Stable',
  tower: 'Tower', wall: 'Wall', villager: 'Villager', infantry: 'Infantry', archer: 'Archer',
  scout: 'Scout', cavalry: 'Cavalry', horse: 'Knight', catapult: 'Catapult',
  tree: 'Tree', gold: 'Gold Mine', stone: 'Stone', berry: 'Berry Bush',
};
// One-line "what does this do" blurbs shown as hover tooltips on the build/train
// buttons (cost is already on the button face).
const DESC: Record<string, string> = {
  // buildings
  townCenter: 'Your base: trains Villagers, accepts every resource, gives population, vision and territory.',
  house: 'Raises your population cap so you can support more units.',
  mill: 'Food drop-off and forage camp: adds Forager capacity and a gather area; farms/berries deposit here.',
  lumbercamp: 'Wood drop-off: place by trees to add Lumberjack capacity and a new gather area.',
  miningcamp: 'Gold & stone drop-off: place by mines to add Miner capacity and a new gather area.',
  farm: 'Grows food; one Farmer works it. Auto-reseeds with wood when empty (toggle in its panel).',
  barracks: 'Trains Infantry and Catapults.',
  range: 'Trains Archers.',
  stable: 'Trains Scouts, Cavalry and Knights.',
  tower: 'Defensive tower: fires at nearby enemies and has long vision. Build on your frontier.',
  wall: 'Cheap, tough barrier that blocks enemy movement.',
  // units
  villager: 'Gathers resources and builds/repairs. Assign jobs in the Villagers panel (bottom-left).',
  scout: 'Fast cavalry with long vision but weak attack — for exploring and spotting enemies.',
  infantry: 'Sturdy melee soldier; solid all-rounder.',
  archer: 'Ranged attacker: good damage from afar, fragile in melee.',
  cavalry: 'Fast, hard-hitting mounted melee unit.',
  horse: 'Knight: heavily armoured mounted unit with high HP and damage.',
  catapult: 'Slow siege engine: huge damage, devastating against buildings.',
};
const RES_TYPE: Record<string, string> = { tree: 'wood', gold: 'gold', stone: 'stone', berry: 'food' };
const ACTION_LABEL: Record<string, string> = {
  move: 'moving', attack: 'fighting', build: 'building', gatherWood: 'chopping wood',
  gatherGold: 'mining gold', gatherStone: 'mining stone', gatherFood: 'foraging',
};
// Villager job display names (plural for the panel, singular handled inline).
const JOB_LABEL: Record<VillagerJob, string> = {
  builder: 'Builders', farmer: 'Farmers', forager: 'Foragers',
  lumberjack: 'Lumberjacks', stonemason: 'Stonemasons', goldminer: 'Gold miners',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );
}

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
  private readonly villagerEl = document.getElementById('villager-panel')!;
  private readonly adminEl = document.getElementById('admin-panel')!;
  private readonly infoEl = document.getElementById('info-panel')!;
  private readonly toastEl = document.getElementById('toast')!;
  private readonly tooltipEl = document.getElementById('tooltip')!;
  private readonly coordsEl = document.getElementById('coords')!;
  private readonly renameModal = document.getElementById('rename-modal')!;
  private readonly renameInput = document.getElementById('rename-input') as HTMLInputElement;
  private renameId: number | null = null;
  private panelKey = '';
  private infoKey = '';
  private adminKey = '';
  private villagerKey = '';
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
      if (e.key === 'Delete') this.deleteSelected();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
    });

    // Rename dialog wiring. The input swallows keydowns (stopPropagation) so the
    // game's WASD/Delete/Esc shortcuts don't fire while typing.
    document.getElementById('rename-save')!.addEventListener('click', () => this.commitRename());
    document.getElementById('rename-cancel')!.addEventListener('click', () => this.closeRename());
    this.renameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeRename(); }
    });
    this.renameModal.addEventListener('pointerdown', (e) => {
      if (e.target === this.renameModal) this.closeRename(); // click backdrop to dismiss
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
    if (hit && hit.view.owner === this.state.playerId) {
      this.state.selection.add(hit.view.id);
      sound.play('select', { pan: panAt(cx) });
    }
  }

  private boxSelect(cx: number, cy: number): void {
    const a = this.r.screenToWorld(this.startX, this.startY);
    const b = this.r.screenToWorld(cx, cy);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (!this.shift) this.state.selection.clear();
    const before = this.state.selection.size;
    for (const [id, e] of this.state.entities) {
      if (e.view.owner !== this.state.playerId) continue;
      // Box-select grabs army units only — not buildings, and not villagers
      // (villagers are managed via the jobs panel, never hand-controlled).
      if (isBuilding(e.view.kind) || e.view.kind === 'villager') continue;
      if (e.view.x >= x0 && e.view.x <= x1 && e.view.y >= y0 && e.view.y <= y1)
        this.state.selection.add(id);
    }
    if (this.state.selection.size > before) sound.play('select');
  }

  // Own army units in the current selection (commandable). Villagers are not
  // hand-controlled, so they're never included.
  private selectedUnits(): number[] {
    const out: number[] = [];
    for (const id of this.state.selection) {
      const e = this.state.entities.get(id);
      if (e && e.view.owner === this.state.playerId && !isBuilding(e.view.kind) && e.view.kind !== 'villager')
        out.push(id);
    }
    return out;
  }

  // Own units (any kind, incl. villagers) in the current selection — the set the
  // Delete command acts on (buildings are not deletable).
  private selectedOwnUnits(): number[] {
    const out: number[] = [];
    for (const id of this.state.selection) {
      const e = this.state.entities.get(id);
      if (e && e.view.owner === this.state.playerId && isUnit(e.view.kind)) out.push(id);
    }
    return out;
  }

  // Destroy the selected own units (no resource refund). Server re-validates.
  private deleteSelected(): void {
    const ids = this.selectedOwnUnits();
    if (ids.length === 0) return;
    this.net.send({ t: 'delete', unitIds: ids });
    this.showToast(`deleted ${ids.length} unit${ids.length === 1 ? '' : 's'}`);
  }

  // Own production buildings (those with a train list) in the selection.
  private selectedTrainers(): number[] {
    const out: number[] = [];
    for (const id of this.state.selection) {
      const e = this.state.entities.get(id);
      if (e && e.view.owner === this.state.playerId && isBuilding(e.view.kind) && BUILDING_STATS[e.view.kind].trains)
        out.push(id);
    }
    return out;
  }

  // --- right-click intent ---------------------------------------------------
  private onRightClick(cx: number, cy: number): void {
    if (this.state.selection.size === 0) return;
    const p = this.r.screenToWorld(cx, cy);
    const target = this.state.entityAt(p.x, p.y);

    // A selected production building gets its rally point set to the click.
    const trainers = this.selectedTrainers();
    for (const b of trainers) this.net.send({ t: 'rally', buildingId: b, x: p.x, y: p.y });

    // Army units (villagers excluded) are commanded: attack an enemy, else move.
    const ids = this.selectedUnits();
    if (ids.length === 0) {
      if (trainers.length) {
        this.showToast('rally point set');
        sound.play('rally', { pan: panAt(cx) });
        this.r.entities.ping(p.x, p.y, 0xffd24a);
      }
      return;
    }

    const pan = panAt(cx);
    if (target && target.view.owner != null && target.view.owner !== this.state.playerId) {
      this.net.send({ t: 'attack', unitIds: ids, targetId: target.view.id });
      sound.play('attackCmd', { pan });
      this.r.entities.ping(target.view.x, target.view.y, 0xff5a5a);
    } else {
      // Shift queues the click as a waypoint after the current order; a plain
      // click replaces it.
      this.net.send({ t: 'move', unitIds: ids, x: p.x, y: p.y, queue: this.shift });
      sound.play('move', { pan });
      this.r.entities.ping(p.x, p.y, this.shift ? 0xffd24a : 0x8ad06a);
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

  // Your territory: a circle around each of your town centers (the buildable
  // zone). Mirrors the server's placement check so the ghost can preview it.
  private territorySources(): TerritorySource[] {
    const out: TerritorySource[] = [];
    for (const e of this.state.entities.values()) {
      const v = e.view;
      if (v.kind === 'townCenter' && v.owner === this.state.playerId && v.territory)
        out.push({ x: v.x, y: v.y, radiusTiles: v.territory });
    }
    return out;
  }

  private placementValid(tileX: number, tileY: number, kind: EntityKind): boolean {
    const f = BUILDING_STATS[kind].footprint;
    const sources = this.territorySources();
    if (sources.length === 0) return kind === 'townCenter'; // recovery: only a TC
    return kind === 'townCenter'
      ? footprintTouchesTerritory(sources, tileX, tileY, f)
      : footprintInTerritory(sources, tileX, tileY, f);
  }

  private updateGhost(cx: number, cy: number): void {
    if (!this.pendingBuild) return;
    const { tileX, tileY, f } = this.ghostTile(cx, cy);
    const ok = this.placementValid(tileX, tileY, this.pendingBuild);
    this.ghost.clear()
      .rect(tileX * TILE, tileY * TILE, f * TILE, f * TILE)
      .fill({ color: ok ? 0x6ad06a : 0xd06a6a, alpha: 0.35 })
      .stroke({ width: 2, color: ok ? 0x9af09a : 0xf09a9a });
    // Defensive buildings (towers) preview their attack radius so the player can
    // see the coverage before committing the placement.
    const stat = BUILDING_STATS[this.pendingBuild];
    if (stat.attack != null && stat.range) {
      const cx2 = (tileX + f / 2) * TILE;
      const cy2 = (tileY + f / 2) * TILE;
      this.ghost.circle(cx2, cy2, stat.range)
        .fill({ color: 0xff6a4a, alpha: 0.05 })
        .stroke({ width: 1.5, color: 0xff8a5a, alpha: 0.5 });
    }
    this.ghost.visible = true;
  }

  private placeBuilding(cx: number, cy: number): void {
    if (!this.pendingBuild) return;
    const { tileX, tileY, f } = this.ghostTile(cx, cy);
    const valid = this.placementValid(tileX, tileY, this.pendingBuild);
    this.net.send({ t: 'build', kind: this.pendingBuild, tileX, tileY });
    if (valid) {
      sound.play('place', { pan: panAt(cx) });
      this.r.entities.ping((tileX + f / 2) * TILE, (tileY + f / 2) * TILE, 0x8ad06a);
    } else {
      sound.play('error', { pan: panAt(cx) });
    }
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
    const key = `${trainer ?? ''}|${this.pendingBuild ?? ''}|d${this.selectedOwnUnits().length}`;
    if (key !== this.panelKey) this.refreshPanel(false);
    this.updateInfoPanel();
    this.updateAdminPanel();
    this.updateVillagerPanel();
    if (this.toastTimer > 0 && (this.toastTimer -= 1) === 0) this.toastEl.classList.remove('show');
  }

  // --- villager panel (bottom-left): assign jobs ----------------------------
  // The player tunes how many villagers do each non-builder job; the rest are
  // builders (auto-assigned to any unbuilt foundation). Rebuilt only when its
  // visible signature changes.
  private updateVillagerPanel(): void {
    const j = this.state.jobs;
    if (!j) {
      if (this.villagerKey !== '') { this.villagerKey = ''; this.villagerEl.classList.add('hidden'); }
      return;
    }
    const caps = j.caps;
    const key = `${j.total}|${j.idleLong}|` +
      NON_BUILDER_JOBS.map((job) => `${j.counts[job]}/${caps[job] ?? 0}`).join(',') +
      `|b${j.counts.builder}`;
    if (key === this.villagerKey) return;
    this.villagerKey = key;

    const parts = [`<div class="vp-title">👷 Villagers (${j.total})</div>`];
    if (j.idleLong > 0)
      parts.push(`<div class="vp-warn">⚠ ${j.idleLong} villager${j.idleLong === 1 ? '' : 's'} idle for over an hour — give them a job</div>`);
    parts.push(
      `<div class="vp-row"><span class="vp-name dim">${JOB_LABEL.builder}</span>` +
      `<span class="vp-count">${j.counts.builder}</span></div>`,
    );
    for (const job of NON_BUILDER_JOBS) {
      const cur = j.counts[job];
      const cap = caps[job] ?? 0;
      const full = cur >= cap && cap > 0;
      parts.push(
        `<div class="vp-row" data-job="${job}">` +
        `<span class="vp-name">${JOB_LABEL[job]}</span>` +
        `<button class="vp-btn vp-dec" data-job="${job}"${cur <= 0 ? ' disabled' : ''}>−</button>` +
        `<span class="vp-count${full ? ' full' : ''}">${cur} / ${cap}</span>` +
        `<button class="vp-btn vp-inc" data-job="${job}"${cur >= cap ? ' disabled' : ''}>+</button>` +
        `</div>`,
      );
    }
    this.villagerEl.innerHTML = parts.join('');
    this.villagerEl.classList.remove('hidden');

    // Each +/- sends an absolute target count (current assigned ± 1), clamped to
    // capacity; the server reconciles. Using the assigned count (not a stored
    // desired) keeps the buttons honest against the live capacity.
    for (const btn of this.villagerEl.querySelectorAll('.vp-inc')) {
      btn.addEventListener('click', () => {
        const job = (btn as HTMLElement).dataset.job as VillagerJob;
        const cur = this.state.jobs?.counts[job] ?? 0;
        this.net.send({ t: 'assignJob', job, count: cur + 1 });
      });
    }
    for (const btn of this.villagerEl.querySelectorAll('.vp-dec')) {
      btn.addEventListener('click', () => {
        const job = (btn as HTMLElement).dataset.job as VillagerJob;
        const cur = this.state.jobs?.counts[job] ?? 0;
        this.net.send({ t: 'assignJob', job, count: Math.max(0, cur - 1) });
      });
    }
  }

  // --- admin panel (cheat tools) --------------------------------------------
  // Shown only while admin mode is on (toggled by renaming a town center to
  // "adminmode"). Rebuilt when its visible signature changes.
  private updateAdminPanel(): void {
    const s = this.state;
    const key = s.adminEnabled ? `on|${s.adminReveal}` : 'off';
    if (key === this.adminKey) return;
    this.adminKey = key;

    if (!s.adminEnabled) {
      this.adminEl.classList.add('hidden');
      this.adminEl.innerHTML = '';
      return;
    }

    this.adminEl.innerHTML =
      `<div class="ip-title">⚙ Admin</div>`
      + `<button id="adm-boost" class="ip-btn">＋ Boost resources</button>`
      + `<button id="adm-reveal" class="ip-btn${s.adminReveal ? ' on' : ''}">`
      + `👁 Reveal fog: ${s.adminReveal ? 'ON' : 'OFF'}</button>`;
    this.adminEl.classList.remove('hidden');

    this.adminEl.querySelector('#adm-boost')?.addEventListener('click', () => {
      this.net.send({ t: 'admin', action: 'boostResources' });
      this.showToast('resources boosted');
    });
    this.adminEl.querySelector('#adm-reveal')?.addEventListener('click', () => {
      this.net.send({ t: 'admin', action: 'revealFog' });
    });
  }

  // --- info panel (bottom-right): details of the current selection ----------
  private updateInfoPanel(): void {
    const ids = [...this.state.selection];
    if (ids.length === 0) {
      if (this.infoKey !== '') {
        this.infoKey = '';
        this.infoEl.classList.add('hidden');
      }
      return;
    }

    const singleId = ids.length === 1 ? ids[0] : null;
    const html = singleId != null ? this.singleInfoHtml(singleId) : this.multiInfoHtml(ids);
    if (html === null) {
      // Selected entity vanished this frame; clear next tick.
      if (this.infoKey !== '') { this.infoKey = ''; this.infoEl.classList.add('hidden'); }
      return;
    }
    if (html !== this.infoKey) {
      this.infoKey = html;
      this.infoEl.innerHTML = html;
      this.infoEl.classList.remove('hidden');
      if (singleId != null) this.wireInfoButtons(singleId);
    }
  }

  // Attach handlers to the interactive controls the info panel may have rendered
  // (re-run whenever the panel HTML is rebuilt).
  private wireInfoButtons(id: number): void {
    const rename = this.infoEl.querySelector('#ip-rename');
    if (rename) rename.addEventListener('click', () => this.openRename(id));
    const toggle = this.infoEl.querySelector('#ip-farm-toggle') as HTMLElement | null;
    if (toggle) {
      this.setTip(toggle, 'Auto-reseed',
        'When the farm runs out, automatically spend wood to replant it. Turn off to stop spending wood.');
      toggle.addEventListener('click', () => {
        const cur = this.state.entities.get(id)?.view.farmAuto ?? true;
        this.net.send({ t: 'farmReseed', buildingId: id, on: !cur });
      });
    }
  }

  // --- in-game rename dialog ------------------------------------------------
  private openRename(id: number): void {
    this.renameId = id;
    this.renameInput.value = this.state.entities.get(id)?.view.name ?? '';
    this.renameModal.classList.remove('hidden');
    this.renameInput.focus();
    this.renameInput.select();
  }

  private commitRename(): void {
    if (this.renameId == null) return;
    this.net.send({ t: 'rename', buildingId: this.renameId, name: this.renameInput.value.trim() });
    this.closeRename();
  }

  private closeRename(): void {
    this.renameId = null;
    this.renameModal.classList.add('hidden');
  }

  private hpBar(hp: number, maxHp: number): string {
    const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
    const col = ratio > 0.5 ? '#4ad96a' : ratio > 0.25 ? '#d9c14a' : '#d94a4a';
    return `<div class="ip-row">❤ ${Math.ceil(hp)} / ${maxHp}</div>`
      + `<div class="ip-hp"><i style="width:${(ratio * 100).toFixed(0)}%;background:${col}"></i></div>`;
  }

  private singleInfoHtml(id: number): string | null {
    const e = this.state.entities.get(id);
    if (!e) return null;
    const v = e.view;
    const owned = v.owner === this.state.playerId;
    // Town centers show their player-given name (if any) as the title.
    const title = v.kind === 'townCenter' && v.name ? escapeHtml(v.name) : (LABEL[v.kind] ?? v.kind);
    const who = owned ? 'you' : v.owner == null ? 'neutral' : 'enemy';

    const parts = [`<div class="ip-title">${title}</div>`, `<div class="ip-sub">${who}</div>`];
    parts.push(this.hpBar(v.hp, v.maxHp));

    if (v.build != null) {
      parts.push(`<div class="ip-row">🔨 building ${Math.round(v.build * 100)}%</div>`);
    } else if (v.action && ACTION_LABEL[v.action]) {
      parts.push(`<div class="ip-row">${ACTION_LABEL[v.action]}</div>`);
    }

    // Villager: its assigned job (jobs are managed in the bottom-left panel).
    if (v.kind === 'villager' && v.job) {
      const jobName = JOB_LABEL[v.job].replace(/s$/, '');
      parts.push(`<div class="ip-row">🧰 job: ${jobName}</div>`);
    }

    // Town center: territory size + rename control.
    if (v.kind === 'townCenter') {
      if (v.territory != null)
        parts.push(`<div class="ip-row">🏳 territory: ${v.territory.toFixed(1)} / 15 tiles</div>`);
      if (owned) parts.push(`<button id="ip-rename" class="ip-btn">✎ Rename</button>`);
    }

    // Farm: remaining food + the auto-reseed toggle.
    if (v.kind === 'farm') {
      parts.push(`<div class="ip-row">🍖 ${v.amount ?? 0} food stored</div>`);
      if (owned) {
        const on = v.farmAuto ?? true;
        parts.push(
          `<button id="ip-farm-toggle" class="ip-btn${on ? ' on' : ''}">` +
          `Auto-reseed: ${on ? 'ON' : 'OFF'}</button>`,
        );
      }
    }

    // Production building: show the rally state + training queue.
    if (isBuilding(v.kind) && BUILDING_STATS[v.kind].trains) {
      parts.push(`<div class="ip-row">🚩 rally: ${v.rally ? 'set' : 'none'}</div>`);
      if (v.train && v.train.items.length) {
        const t = v.train;
        parts.push(`<div class="ip-label">Queue (${t.queued})</div>`);
        parts.push(`<div class="ip-trainbar"><i style="width:${(t.pct * 100).toFixed(0)}%"></i></div>`);
        const chips = t.items
          .map((k, i) => `<span class="ip-chip${i === 0 ? ' training' : ''}">${LABEL[k] ?? k}</span>`)
          .join('');
        parts.push(`<div class="ip-queue">${chips}</div>`);
      } else {
        parts.push(`<div class="ip-label">Queue empty</div>`);
      }
    }
    return parts.join('');
  }

  private multiInfoHtml(ids: number[]): string {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const e = this.state.entities.get(id);
      if (!e) continue;
      const label = LABEL[e.view.kind] ?? e.view.kind;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([label, n]) => `<li>${label}<span>×${n}</span></li>`)
      .join('');
    return `<div class="ip-title">${ids.length} selected</div><ul class="ip-list">${rows}</ul>`;
  }

  private refreshPanel(force: boolean): void {
    const trainer = this.trainerBuilding();
    const delUnits = this.selectedOwnUnits();
    this.panelKey = `${trainer ?? ''}|${this.pendingBuild ?? ''}|d${delUnits.length}`;
    this.panel.innerHTML = '';

    if (trainer != null) {
      const kind = this.state.entities.get(trainer)!.view.kind;
      for (const unit of BUILDING_STATS[kind].trains ?? []) {
        const btn = this.makeButton(LABEL[unit] ?? unit, costOf(unit), () =>
          this.net.send({ t: 'train', buildingId: trainer, unit }),
        );
        if (DESC[unit]) this.setTip(btn, LABEL[unit] ?? unit, DESC[unit]);
        this.panel.appendChild(btn);
      }
    } else {
      // No production building selected: the build palette is always available
      // (construction is carried out by the kingdom's builder villagers).
      for (const kind of BUILDABLE) {
        const btn = this.makeButton(LABEL[kind] ?? kind, BUILDING_STATS[kind].cost, () => this.startPlacement(kind));
        if (DESC[kind]) this.setTip(btn, LABEL[kind] ?? kind, DESC[kind]);
        if (kind === this.pendingBuild) btn.classList.add('placing');
        this.panel.appendChild(btn);
      }
    }

    // Delete button for any selected own units (destroys them; no refund).
    if (delUnits.length > 0) {
      const btn = this.makeButton(`✖ Delete (${delUnits.length})`, {}, () => this.deleteSelected());
      btn.classList.add('danger');
      this.setTip(btn, 'Delete', 'Destroy the selected units. No resources are refunded.');
      this.panel.appendChild(btn);
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

  // --- in-game tooltips (DOM panel, not native title=) ----------------------
  // Show a tooltip with a bold title + grey body, positioned to stay on-screen.
  private showTip(title: string, body: string, cx: number, cy: number): void {
    this.tooltipEl.innerHTML = `<span class="ttl">${escapeHtml(title)}</span>`
      + (body ? `<br><span class="sub">${escapeHtml(body)}</span>` : '');
    this.tooltipEl.classList.remove('hidden');
    this.positionTip(cx, cy);
  }

  private hideTip(): void {
    this.tooltipEl.classList.add('hidden');
  }

  // Place the (already-shown, so measurable) tooltip near the cursor, flipping
  // left/up when it would overflow the viewport — important for the bottom
  // command bar where a below-cursor tooltip would fall off-screen.
  private positionTip(cx: number, cy: number): void {
    const t = this.tooltipEl;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = cx + 14;
    let y = cy + 16;
    if (x + w > window.innerWidth - 8) x = cx - w - 14;
    if (y + h > window.innerHeight - 8) y = cy - h - 16;
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${Math.max(8, y)}px`;
  }

  // Attach a hover tooltip to a DOM element (replaces native `title=`).
  private setTip(el: HTMLElement, title: string, body: string): void {
    el.addEventListener('mouseenter', (e) => this.showTip(title, body, e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => this.positionTip(e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => this.hideTip());
  }

  // Hover tooltip describing whatever is under the cursor.
  private updateTooltip(cx: number, cy: number): void {
    if (this.pendingBuild || this.dragging || !this.renameModal.classList.contains('hidden')) {
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
    const name = v.kind === 'townCenter' && v.name ? escapeHtml(v.name) : (LABEL[v.kind] ?? v.kind);
    let sub = '';
    if (v.kind === 'farm') {
      sub = `${v.amount ?? 0} food stored`;
    } else if (RES_TYPE[v.kind]) {
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
    this.tooltipEl.classList.remove('hidden');
    this.positionTip(cx, cy);
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
