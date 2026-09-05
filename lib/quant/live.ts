import type { NormalisedCandle } from '../oanda-api.ts';
import { marketContext } from './context.ts';
import { decide } from './engine.ts';
import { strategies } from './registry.ts';
import { timeframeMs } from './types.ts';

// Observe research rules on live closed candles using the same inputs as replay.
// Observation does not promote a research version to execution eligibility.
export function observeLiveStrategies(instrument: string, timeframe: string, candles: readonly NormalisedCandle[]) {
  const duration = timeframeMs[timeframe];
  if (!duration) return [];
  const bars = candles.filter(c => c.complete).map(c => {
    const openTime = Date.parse(c.time);
    return { ...c, openTime, closeTime: openTime + duration, availableAt: openTime + duration };
  });
  if (!bars.length) return [];
  const context = marketContext({ instrument, timeframe, bars, asOf: bars.at(-1)!.closeTime });
  return strategies.map(strategy => decide(context, strategy));
}
