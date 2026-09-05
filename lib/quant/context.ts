import { type Bar, type ExternalFeature, type MarketContext, timeframeMs } from "./types.ts";
export function validateBars(bars: readonly Bar[]) {
  let previous = -Infinity;
  for (const b of bars) {
    if (![b.openTime, b.closeTime, b.availableAt, b.open, b.high, b.low, b.close].every(Number.isFinite) || b.openTime <= previous || b.closeTime <= b.openTime || b.availableAt < b.closeTime || Math.min(b.open, b.high, b.low, b.close) <= 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close)) throw new Error("Invalid, duplicate, unordered, or backward-filled bar.");
    previous = b.openTime;
  }
}
export function marketContext(input: { instrument: string; timeframe: string; asOf: number; bars: readonly Bar[]; higherBars?: readonly Bar[]; newsRisk?: boolean | null; external?: readonly ExternalFeature[]; historical?: boolean }): MarketContext {
  if (!timeframeMs[input.timeframe] || !Number.isFinite(input.asOf)) throw new Error("Unsupported timeframe or decision time.");
  validateBars(input.bars); validateBars(input.higherBars ?? []);
  const visible = (bars: readonly Bar[]) => bars.filter((b) => b.complete && b.closeTime <= input.asOf && b.availableAt <= input.asOf).map((b) => Object.freeze({ ...b }));
  const external = (input.external ?? []).filter((f) => f.availableAt <= input.asOf && f.observedAt <= input.asOf && Number.isFinite(f.value) && (!input.historical || (f.verifiedNonRepainting && f.evidence.length > 0)));
  return Object.freeze({ instrument: input.instrument, timeframe: input.timeframe, asOf: input.asOf, bars: Object.freeze(visible(input.bars)), higherBars: Object.freeze(visible(input.higherBars ?? [])), newsRisk: input.newsRisk ?? null, external: Object.freeze(external.map((f) => Object.freeze({ ...f }))) });
}
// A pivot becomes visible on its confirmation bar, never on the earlier extreme.
export function confirmedPivots(bars: readonly Bar[], width = 2) {
  if (!Number.isInteger(width) || width < 1) throw new Error("Invalid pivot width.");
  return bars.flatMap((bar, i) => {
    if (i < width * 2) return [];
    const pivot = bars[i - width]; const window = bars.slice(i - width * 2, i + 1);
    return [{ confirmedAt: bar.closeTime, extremeAt: pivot.closeTime, high: window.every((b) => b.high <= pivot.high) ? pivot.high : null, low: window.every((b) => b.low >= pivot.low) ? pivot.low : null }];
  });
}
