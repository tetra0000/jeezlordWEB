// Fixed-timestep authoritative game loop. Driven by a real-clock accumulator
// (hrtime), with capped catch-up so a GC/VPS hiccup can't trigger a spiral of
// death. Runs 24/7 regardless of who is connected.
//
// TIME_SCALE (env) multiplies simulation dt — leave at 1 for real (slow) pacing;
// set higher to fast-forward the whole sim for testing.
import { TICK_MS } from '../../shared/constants.js';
import { jobsSystem } from './systems/jobs.js';
import { pathfindingSystem } from './systems/pathfinding.js';
import { movementSystem } from './systems/movement.js';
import { separationSystem } from './systems/separation.js';
import { gatherSystem } from './systems/gather.js';
import { farmSystem } from './systems/farm.js';
import { constructionSystem } from './systems/construction.js';
import { territorySystem } from './systems/territory.js';
import { trainingSystem } from './systems/training.js';
import { combatSystem } from './systems/combat.js';
import { corpseSystem } from './systems/corpse.js';
import { marketSystem } from './systems/market.js';
import { healSystem } from './systems/heal.js';
import type { World } from './world.js';

const MAX_CATCHUP_STEPS = 5;
const TIME_SCALE = Number(process.env.TIME_SCALE ?? 1);
const DT = (TICK_MS / 1000) * TIME_SCALE; // simulation seconds per tick

export class GameLoop {
  private timer: NodeJS.Timeout | null = null;
  private last = 0n;
  private accumulatorMs = 0;
  private tick = 0;

  constructor(
    private readonly world: World,
    private readonly onTick: (tick: number) => void,
  ) {}

  start(): void {
    this.last = process.hrtime.bigint();
    const schedule = () => {
      this.timer = setTimeout(() => {
        this.step();
        schedule();
      }, TICK_MS);
    };
    schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  currentTick(): number {
    return this.tick;
  }

  private step(): void {
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - this.last) / 1e6;
    this.last = now;
    this.accumulatorMs += elapsedMs;

    let steps = 0;
    while (this.accumulatorMs >= TICK_MS && steps < MAX_CATCHUP_STEPS) {
      this.advance();
      this.accumulatorMs -= TICK_MS;
      steps++;
    }
    if (this.accumulatorMs > TICK_MS) this.accumulatorMs = 0;
  }

  private advance(): void {
    this.tick++;
    // Deterministic system order. Jobs runs first so freshly-tasked villagers
    // (assigned a node/foundation/farm) pathfind the same tick.
    jobsSystem(this.world, DT);
    pathfindingSystem(this.world);
    movementSystem(this.world, DT);
    separationSystem(this.world); // ease overlapping units apart (crowds, not blobs)
    gatherSystem(this.world, DT);
    farmSystem(this.world, DT);
    constructionSystem(this.world, DT);
    territorySystem(this.world, DT);
    trainingSystem(this.world, DT);
    combatSystem(this.world, DT);
    corpseSystem(this.world, DT); // age + clear corpses combat just created
    marketSystem(this.world, DT); // drift market prices back toward baseline
    healSystem(this.world, DT);
    this.onTick(this.tick);
  }
}
