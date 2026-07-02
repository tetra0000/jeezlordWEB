// Trade caravan system: a caravan with a route shuttles home market -> target
// market -> home, and deposits gold with its owner on every arrival home. The
// payout scales with route length; trading with ANOTHER player's market pays
// +50% (CARAVAN_FOREIGN_BONUS). Runs regardless of owner online status, like
// every system — trade routes keep earning while you sleep.
//
// Route resilience: if the home market dies, the nearest surviving own market
// adopts the route; if the target dies (or war breaks out with its owner) the
// caravan goes idle where it stands and waits for new orders.
import { TILE } from '../../../shared/constants.js';
import { CARAVAN_MIN_OWN_TRADE_TILES, caravanGold } from '../../../shared/stats.js';
import type { EntityId, PlayerId } from '../../../shared/types.js';
import type { Trader } from '../components.js';
import type { World } from '../world.js';
import { clearMove, setMoveTarget } from './movement.js';

// A caravan has "arrived" at a market when it stands within a tile and a half
// of its centre (markets are 2x2, so this is right up against the stall).
const ARRIVE_DIST = TILE * 1.5;

function isLiveMarket(world: World, id: EntityId | null): boolean {
  return id != null && world.kind.get(id) === 'market' && world.isOperational(id);
}

export function nearestOwnMarket(world: World, pid: PlayerId, x: number, y: number, excludeId?: EntityId): EntityId | null {
  let best: EntityId | null = null;
  let bestD = Infinity;
  for (const [id, owner] of world.owner) {
    if (owner !== pid || id === excludeId) continue;
    if (!isLiveMarket(world, id)) continue;
    const tf = world.transform.get(id)!;
    const d = Math.hypot(tf.x - x, tf.y - y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function stopTrading(world: World, id: EntityId, tr: Trader): void {
  tr.state = 'idle';
  tr.homeId = null;
  tr.targetId = null;
  const mv = world.movement.get(id);
  if (mv) clearMove(mv);
  world.markDirty(id);
}

export function tradeSystem(world: World, _dt: number): void {
  for (const [id, tr] of world.trader) {
    if (tr.state === 'idle') continue;
    const owner = world.owner.get(id);
    const tf = world.transform.get(id);
    if (owner == null || !tf) continue;

    // Validate the route's endpoints every tick (markets can be razed).
    if (!isLiveMarket(world, tr.homeId)) {
      // Home died: the nearest surviving own market adopts the route.
      tr.homeId = nearestOwnMarket(world, owner, tf.x, tf.y);
      if (tr.homeId == null) { stopTrading(world, id, tr); continue; }
      world.markDirty(id);
    }
    if (!isLiveMarket(world, tr.targetId)) { stopTrading(world, id, tr); continue; }
    // War cuts trade: no dealing with a player you're fighting.
    const targetOwner = world.owner.get(tr.targetId!);
    if (targetOwner != null && targetOwner !== owner && world.relationOf(owner, targetOwner) === 'war') {
      stopTrading(world, id, tr);
      continue;
    }

    const destId = tr.state === 'outbound' ? tr.targetId! : tr.homeId!;
    const dest = world.transform.get(destId)!;
    const d = Math.hypot(dest.x - tf.x, dest.y - tf.y);

    if (d <= ARRIVE_DIST) {
      if (tr.state === 'homebound') {
        // Delivered: pay out gold scaled by the route length (+50% foreign).
        const h = world.transform.get(tr.homeId!)!;
        const t = world.transform.get(tr.targetId!)!;
        const distTiles = Math.hypot(t.x - h.x, t.y - h.y) / TILE;
        const foreign = world.owner.get(tr.targetId!) !== owner;
        const p = world.players.get(owner);
        if (p) {
          p.stockpile.gold += caravanGold(distTiles, foreign);
          world.markPlayerDirty(owner);
        }
      }
      // Turn around and head for the other end.
      tr.state = tr.state === 'outbound' ? 'homebound' : 'outbound';
      const next = world.transform.get(tr.state === 'outbound' ? tr.targetId! : tr.homeId!)!;
      setMoveTarget(world, id, next.x, next.y);
      world.markDirty(id);
    } else {
      // En route: make sure a move order exists (it's lost on server restart —
      // paths are in-memory) and tracks the destination.
      const mv = world.movement.get(id);
      if (mv && !mv.target) setMoveTarget(world, id, dest.x, dest.y);
    }
  }
}

// Assign a trade route (from dispatch): the caravan's home is the nearest own
// market; it immediately heads out to the target. Returns an error string for
// the client toast, or null on success.
export function assignTradeRoute(world: World, caravanId: EntityId, marketId: EntityId): string | null {
  const owner = world.owner.get(caravanId);
  if (owner == null) return 'not your caravan';
  const tf = world.transform.get(caravanId);
  if (!tf) return 'caravan is gone';
  if (!isLiveMarket(world, marketId)) return 'that is not a working market';

  const targetOwner = world.owner.get(marketId);
  if (targetOwner != null && targetOwner !== owner && world.relationOf(owner, targetOwner) === 'war')
    return 'you cannot trade with a player you are at war with';

  const home = nearestOwnMarket(world, owner, tf.x, tf.y, targetOwner === owner ? marketId : undefined);
  if (home == null) return 'you need a market of your own first';

  if (targetOwner === owner) {
    const h = world.transform.get(home)!;
    const t = world.transform.get(marketId)!;
    const distTiles = Math.hypot(t.x - h.x, t.y - h.y) / TILE;
    if (distTiles < CARAVAN_MIN_OWN_TRADE_TILES)
      return `your own markets must be at least ${CARAVAN_MIN_OWN_TRADE_TILES} tiles apart to trade`;
  }

  let tr = world.trader.get(caravanId);
  if (!tr) {
    tr = { state: 'idle', homeId: null, targetId: null };
    world.trader.set(caravanId, tr);
  }
  tr.homeId = home;
  tr.targetId = marketId;
  tr.state = 'outbound';
  const t = world.transform.get(marketId)!;
  setMoveTarget(world, caravanId, t.x, t.y);
  world.markDirty(caravanId);
  return null;
}
