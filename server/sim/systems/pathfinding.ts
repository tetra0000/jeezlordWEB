// A* on the tile grid (8-directional, no corner-cutting through blocked tiles),
// producing pixel-space waypoints (tile centres). A bounded request queue keeps
// the per-tick cost capped; unreachable/oversized searches fail gracefully and
// the unit falls back to a straight line.
import { MAP_TILES, TILE } from '../../../shared/constants.js';
import type { Vec2 } from '../../../shared/types.js';
import type { World } from '../world.js';

const MAX_EXPANSIONS = 9000;
const ORTHO = 10;
const DIAG = 14;
const MAX_GOAL_SEARCH = 6; // rings to search for a free tile near a blocked goal

const tileCenter = (t: number): number => t * TILE + TILE / 2;
const toTile = (px: number): number => Math.floor(px / TILE);

// Minimal binary min-heap keyed by f-score.
class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, f: number): void {
    this.ids.push(id);
    this.fs.push(f);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p] <= this.fs[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastF = this.fs.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.fs[0] = lastF;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.fs[l] < this.fs[m]) m = l;
        if (r < n && this.fs[r] < this.fs[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.fs[a], this.fs[b]] = [this.fs[b], this.fs[a]];
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return ORTHO * (dx + dy) + (DIAG - 2 * ORTHO) * Math.min(dx, dy);
}

// Find the nearest non-blocked tile to (gx,gy) within a few rings. Orthogonal
// neighbours are preferred over diagonals so a unit ends up directly beside a
// blocked goal (e.g. a resource tile) rather than at a corner one tile away.
function nearestFree(world: World, gx: number, gy: number): { x: number; y: number } | null {
  if (!world.isBlockedTile(gx, gy)) return { x: gx, y: gy };
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    if (!world.isBlockedTile(gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy };
  }
  for (let r = 1; r <= MAX_GOAL_SEARCH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = gx + dx;
        const ty = gy + dy;
        if (!world.isBlockedTile(tx, ty)) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

// Result of a path request. `partial` is true when the path stops short of the
// goal (unreachable, or the search hit its budget) and only reaches the closest
// tile found — the caller re-plans from there rather than stranding the unit.
export interface PathResult {
  path: Vec2[];
  partial: boolean;
}

export function findPath(
  world: World,
  sxPx: number,
  syPx: number,
  gxPx: number,
  gyPx: number,
): PathResult | null {
  const sx = toTile(sxPx);
  const sy = toTile(syPx);
  let gx = toTile(gxPx);
  let gy = toTile(gyPx);

  const goal = nearestFree(world, gx, gy);
  if (!goal) return null;
  gx = goal.x;
  gy = goal.y;

  if (sx === gx && sy === gy) return { path: [{ x: gxPx, y: gyPx }], partial: false };

  const startIdx = sy * MAP_TILES + sx;
  const goalIdx = gy * MAP_TILES + gx;

  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  const open = new Heap();
  gScore.set(startIdx, 0);
  open.push(startIdx, octile(sx, sy, gx, gy));
  const closed = new Set<number>();

  // Closest-to-goal tile settled so far. If the goal turns out unreachable or
  // we blow the expansion budget, we hand back a path to this tile (a "best
  // effort" partial) instead of failing — which previously triggered a
  // straight-line-through-walls fallback in the caller.
  let bestIdx = startIdx;
  let bestH = octile(sx, sy, gx, gy);

  let expansions = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalIdx) return { path: reconstruct(cameFrom, cur, true), partial: false };
    if (closed.has(cur)) continue;
    closed.add(cur);

    const cx = cur % MAP_TILES;
    const cy = (cur - cx) / MAP_TILES;
    const h = octile(cx, cy, gx, gy);
    if (h < bestH) {
      bestH = h;
      bestIdx = cur;
    }
    if (++expansions > MAX_EXPANSIONS) break;

    const cg = gScore.get(cur)!;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (world.isBlockedTile(nx, ny)) continue;
        // No corner cutting: a diagonal step requires both orthogonal tiles free.
        if (dx !== 0 && dy !== 0) {
          if (world.isBlockedTile(cx + dx, cy) || world.isBlockedTile(cx, cy + dy)) continue;
        }
        const ni = ny * MAP_TILES + nx;
        if (closed.has(ni)) continue;
        const step = dx !== 0 && dy !== 0 ? DIAG : ORTHO;
        const tentative = cg + step;
        if (tentative < (gScore.get(ni) ?? Infinity)) {
          cameFrom.set(ni, cur);
          gScore.set(ni, tentative);
          open.push(ni, tentative + octile(nx, ny, gx, gy));
        }
      }
    }
  }

  // Goal not reached. Return a partial path toward the closest tile we settled,
  // so the unit walks as far as it can on walkable ground (never through walls).
  // If we never got anywhere, the unit is boxed in — report failure.
  if (bestIdx === startIdx) return null;
  return { path: reconstruct(cameFrom, bestIdx, false), partial: true };

  function reconstruct(from: Map<number, number>, end: number, reachedGoal: boolean): Vec2[] {
    const tiles: number[] = [end];
    let c = end;
    while (from.has(c)) {
      c = from.get(c)!;
      tiles.push(c);
    }
    tiles.reverse();
    // Drop the start tile, convert to pixel centres, and simplify collinear runs.
    const pts: Vec2[] = [];
    for (let i = 1; i < tiles.length; i++) {
      const tx = tiles[i] % MAP_TILES;
      const ty = (tiles[i] - tx) / MAP_TILES;
      pts.push({ x: tileCenter(tx), y: tileCenter(ty) });
    }
    // Use the exact clicked point as the final waypoint when we actually reached
    // the goal and its tile was free (smoother off-grid arrival). Partial paths
    // end on a tile centre, not the unreachable click point.
    if (reachedGoal && !world.isBlockedTile(toTile(gxPx), toTile(gyPx))) {
      pts[pts.length - 1] = { x: gxPx, y: gyPx };
    }
    return simplify(pts);
  }
}

// Remove intermediate waypoints that lie on a straight line between neighbours.
function simplify(pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Bounded path computation for entities that have a target but no current path
// (pathIndex < 0). Called once per tick before movement.
const MAX_PATHS_PER_TICK = 50;

export function pathfindingSystem(world: World): void {
  let budget = MAX_PATHS_PER_TICK;
  for (const [id, mv] of world.movement) {
    if (budget <= 0) break;
    if (!mv.target || mv.pathIndex >= 0) continue;
    if (mv.repathCooldown > 0) continue;
    const tf = world.transform.get(id);
    if (!tf) continue;
    budget--;
    const result = findPath(world, tf.x, tf.y, mv.target.x, mv.target.y);
    if (result && result.path.length > 0) {
      mv.path = result.path;
      mv.pathIndex = 0;
      mv.partial = result.partial;
      // A partial path stops short; re-plan from the new vantage point soon
      // after arriving (small cooldown so we don't recompute the same leg every
      // tick while walking it).
      if (result.partial) mv.repathCooldown = 0.5;
    } else {
      // Boxed in: no reachable tile makes progress toward the goal. Stand still
      // (never straight-line through walls) and retry after a short delay.
      mv.path = [];
      mv.pathIndex = -1;
      mv.partial = false;
      mv.repathCooldown = 1;
    }
  }
}
