// The single serialization chokepoint for outbound state. It restricts the
// player's visible set to entities they own or that stand on a currently-visible
// tile (the fog-of-war anti-cheat boundary: out-of-vision entities are NEVER
// serialized), diffs against what was last sent, and emits enter/update/leave
// plus stockpile/population changes.
import type { DeltaMsg } from '../../shared/protocol.js';
import type { EntityId, EntityView, Pop, Stockpile } from '../../shared/types.js';
import type { Session } from './session.js';
import type { World } from '../sim/world.js';
import { MAP_TILES, TILE } from '../../shared/constants.js';
import { isResourceNode } from '../../shared/stats.js';
import { visibleTileSet } from '../sim/systems/vision.js';

function viewChanged(a: EntityView, b: EntityView): boolean {
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.hp !== b.hp ||
    a.maxHp !== b.maxHp ||
    a.owner !== b.owner ||
    a.build !== b.build ||
    a.action !== b.action ||
    a.amount !== b.amount ||
    a.train?.pct !== b.train?.pct ||
    a.train?.queued !== b.train?.queued
  );
}

// Entities the player may currently see:
//  - their own (always),
//  - resource nodes they've discovered (persist through fog, AoE-style memory),
//  - any other entity standing on a currently-visible tile.
// Out-of-vision ENEMY entities are never serialized (the anti-cheat boundary).
function visibleViews(world: World, playerId: number): Map<EntityId, EntityView> {
  const visTiles = visibleTileSet(world, playerId);
  let discovered = world.discoveredResources.get(playerId);
  if (!discovered) {
    discovered = new Set<EntityId>();
    world.discoveredResources.set(playerId, discovered);
  }

  const out = new Map<EntityId, EntityView>();
  for (const id of world.entityIds()) {
    const owner = world.owner.get(id);
    if (owner !== playerId) {
      const tf = world.transform.get(id)!;
      const tx = Math.floor(tf.x / TILE);
      const ty = Math.floor(tf.y / TILE);
      const inVision = visTiles.has(ty * MAP_TILES + tx);
      if (isResourceNode(world.kind.get(id)!)) {
        // Neutral resource: reveal once discovered, then keep revealing it.
        if (inVision) discovered.add(id);
        else if (!discovered.has(id)) continue;
      } else if (!inVision) {
        continue; // out-of-vision enemy/neutral — never sent
      }
    }
    const v = world.view(id);
    if (v) out.set(id, v);
  }
  return out;
}

function popEq(a: Pop, b: Pop): boolean {
  return a.used === b.used && a.cap === b.cap;
}
function stockEq(a: Stockpile, b: Stockpile): boolean {
  return a.wood === b.wood && a.gold === b.gold && a.food === b.food && a.stone === b.stone;
}

export function buildDelta(world: World, session: Session, tick: number): DeltaMsg | null {
  const playerId = session.playerId;
  if (playerId == null) return null;

  const current = visibleViews(world, playerId);
  const prev = session.lastSent;

  const enter: EntityView[] = [];
  const update: EntityView[] = [];
  const leave: EntityId[] = [];

  for (const [id, view] of current) {
    const before = prev.get(id);
    if (!before) enter.push(view);
    else if (viewChanged(view, before)) update.push(view);
  }
  for (const id of prev.keys()) {
    if (!current.has(id)) leave.push(id);
  }

  session.lastSent.clear();
  for (const [id, view] of current) session.lastSent.set(id, { ...view });

  // Stockpile / population changes.
  const p = world.players.get(playerId);
  let you: Partial<Stockpile> | undefined;
  let pop: Pop | undefined;
  if (p) {
    if (!stockEq(p.stockpile, session.lastStockpile)) {
      you = { ...p.stockpile };
      session.lastStockpile = { ...p.stockpile };
    }
    const curPop: Pop = { used: world.popUsed(playerId), cap: world.popCap(playerId) };
    if (!popEq(curPop, session.lastPop)) {
      pop = curPop;
      session.lastPop = curPop;
    }
  }

  if (enter.length === 0 && update.length === 0 && leave.length === 0 && !you && !pop) return null;
  const delta: DeltaMsg = { t: 'delta', tick, enter, update, leave };
  if (you) delta.you = you;
  if (pop) delta.pop = pop;
  return delta;
}
