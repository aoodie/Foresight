import type { NormalisedCandle } from "./oanda-api";

// A deliberately small, fixed search space; never tune it against holdout results.
export const lookbacks = [6, 12, 24, 48] as const;
export type LearningInput = { candles: NormalisedCandle[]; roundTripCostBps: number };
export type Metrics = { trades: number; netBps: number; meanBps: number; maxDrawdownBps: number; lowerBoundBps: number };
function metrics(returns: number[]): Metrics {
  const n = returns.length;
  const sum = returns.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const variance = n > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  let equity = 0, peak = 0, drawdown = 0;
  for (const r of returns) { equity += r; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity); }
  return { trades: n, netBps: sum, meanBps: mean, maxDrawdownBps: drawdown, lowerBoundBps: mean - 2.58 * Math.sqrt(variance / Math.max(1, n)) };
}
// Signal uses only completed prior bars; enter at the next open and exit at its close.
// Each trade is independent and flat overnight between bars. Costs are charged per trade.
function replay(c: NormalisedCandle[], from: number, to: number, lookback: number, cost: number) {
  const returns: number[] = [];
  for (let i = Math.max(from, lookback + 1); i < to; i++) {
    const side = Math.sign(c[i - 1].close - c[i - 1 - lookback].close);
    if (side) returns.push(side * (c[i].close / c[i].open - 1) * 10000 - cost);
  }
  return returns;
}
export function evaluateLearning(input: LearningInput) {
  const { candles: c, roundTripCostBps: cost } = input;
  if (!Array.isArray(c) || c.length < 1500 || c.length > 20000) throw new Error("Provide 1,500–20,000 completed candles.");
  if (!Number.isFinite(cost) || cost <= 0 || cost > 100) throw new Error("Round-trip cost must be greater than 0 and at most 100 basis points.");
  for (let i = 0; i < c.length; i++) {
    const bar = c[i];
    if (!bar || bar.complete !== true || !Number.isFinite(Date.parse(bar.time)) || (i > 0 && Date.parse(bar.time) <= Date.parse(c[i - 1].time)) || ![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0) || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)) throw new Error(`Invalid, incomplete, duplicate, or unordered candle at row ${i + 1}.`);
  }
  const holdoutStart = Math.floor(c.length * 0.8);
  const initialTrain = Math.floor(c.length * 0.4);
  const foldSize = Math.floor((holdoutStart - initialTrain) / 4);
  const gap = 50;
  const choose = (end: number) => [...lookbacks].sort((a, b) => {
    const score = (lookback: number) => metrics(replay(c, 49, end, lookback, cost)).lowerBoundBps;
    return score(b) - score(a) || a - b;
  })[0];
  const validationReturns: number[] = [];
  const folds = Array.from({ length: 4 }, (_, i) => {
    const start = initialTrain + i * foldSize;
    const end = i === 3 ? holdoutStart : start + foldSize;
    const selected = choose(start - gap);
    const values = replay(c, start, end, selected, cost);
    validationReturns.push(...values);
    return { trainEnd: c[start - gap - 1].time, testStart: c[start].time, testEnd: c[end - 1].time, lookback: selected, metrics: metrics(values) };
  });
  // Lock the final model before reading the final 20%.
  const selected = choose(holdoutStart - gap);
  const holdout = metrics(replay(c, holdoutStart, c.length, selected, cost));
  const stressed = metrics(replay(c, holdoutStart, c.length, selected, cost * 2));
  const benchmark = metrics(replay(c, holdoutStart, c.length, 24, cost));
  const validation = metrics(validationReturns);
  const checks = [
    { label: "At least 200 holdout trades", pass: holdout.trades >= 200 },
    { label: "At least three profitable forward folds", pass: folds.filter((f) => f.metrics.netBps > 0).length >= 3 },
    { label: "Positive forward-validation mean", pass: validation.meanBps > 0 },
    { label: "Positive conservative holdout mean estimate", pass: holdout.lowerBoundBps > 0 },
    { label: "Profitable at double estimated cost", pass: stressed.netBps > 0 },
    { label: "Beats fixed 24-bar benchmark on holdout", pass: holdout.netBps > benchmark.netBps },
    { label: "No worse drawdown than benchmark", pass: holdout.maxDrawdownBps <= benchmark.maxDrawdownBps },
  ];
  return { version: 1, bars: c.length, from: c[0].time, to: c.at(-1)!.time, costBps: cost, gapBars: gap, candidates: lookbacks.length, selectedLookback: selected, holdoutStart: c[holdoutStart].time, folds, validation, holdout, stressed, benchmark, checks, status: checks.every((check) => check.pass) ? "paper_candidate" : "rejected", executionEnabled: false as const };
}
export type LearningReport = ReturnType<typeof evaluateLearning>;
