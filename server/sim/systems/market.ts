// Market price reversion: every commodity's price multiplier drifts back toward
// the baseline 1.0 at MARKET_REVERT_RATE per sim-second, so a price moved by
// trading "returns to baseline after an hour" (a full deviation of 1.0 unwinds
// in ~an hour; smaller ones sooner). Trades themselves move the multiplier (see
// dispatch.ts). Global, connection-agnostic, TIME_SCALE-aware like every system.
import {
  MARKET_REVERT_RATE,
  MARKET_TRADABLE,
} from '../../../shared/stats.js';
import type { ResourceType } from '../../../shared/types.js';
import type { World } from '../world.js';

export function marketSystem(world: World, dt: number): void {
  const step = MARKET_REVERT_RATE * dt;
  for (const r of MARKET_TRADABLE) {
    const res = r as Exclude<ResourceType, 'gold'>;
    const m = world.market[res];
    if (m === 1) continue;
    const diff = 1 - m;
    world.market[res] = Math.abs(diff) <= step ? 1 : m + Math.sign(diff) * step;
  }
}
