import { validateBars } from './context.ts';
import { type Bar, timeframeMs } from './types.ts';
export function dataQuality(bars: readonly Bar[], timeframe: string) {
  validateBars(bars);
  const step = timeframeMs[timeframe];
  if (!step || !bars.length) throw new Error('A supported timeframe and price history are required.');
  if (bars.some(b => !b.complete || b.closeTime - b.openTime !== step)) throw new Error('Research requires complete bars with the requested duration.');
  const gaps: Array<{ from: number; to: number; missingPeriods: number; includesWeekend: boolean }> = [];
  for (let i = 1; i < bars.length; i++) {
    const from = bars[i-1].closeTime, to = bars[i].openTime;
    if (to <= from) continue;
    let includesWeekend = to - from >= 7 * 86400000;
    for (let time = from; !includesWeekend && time < to; time += 86400000) {
      const day = new Date(time).getUTCDay();
      if (day === 0 || day === 6) { includesWeekend = true; break; }
    }
    gaps.push({ from, to, missingPeriods: Math.ceil((to - from) / step), includesWeekend });
  }
  return { bars: bars.length, from: bars[0].openTime, to: bars.at(-1)!.closeTime, timezone: 'UTC', priceSide: 'midpoint', gaps,
    assessment: 'Idea screening only',
    caveats: ['Gaps that include weekends may be scheduled closures; holiday and session calendars are not verified.', 'Historical bid/ask spreads, financing, news and account-currency conversion are not included.'] };
}
