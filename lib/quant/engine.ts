import { type MarketContext, type Decision, type Strategy, type Regime } from "./types.ts";
export function features(context: MarketContext) {
  const c = context.bars; const recent = c.slice(-21);
  if (recent.length < 21) return { atr: 0, efficiency: 0, direction: 0, compression: false, expansion: false };
  const ranges = recent.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - recent[i].close), Math.abs(b.low - recent[i].close)));
  const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const distance = recent.slice(1).reduce((sum, b, i) => sum + Math.abs(b.close - recent[i].close), 0);
  const change = recent.at(-1)!.close - recent[0].close;
  return { atr, efficiency: distance ? Math.abs(change) / distance : 0, direction: Math.sign(change), compression: ranges.slice(-5).reduce((a, b) => a + b, 0) / 5 < atr * 0.65, expansion: ranges.at(-1)! > atr * 2 };
}
export function regimeFor(context: MarketContext): Regime {
  const f = features(context);
  if (context.newsRisk) return "news_driven";
  if (context.bars.length < 55 || !f.atr) return "uncertain";
  if (f.expansion) return "volatility_expansion";
  if (f.compression) return "compression";
  return f.efficiency > 0.55 ? "strong_trend" : f.efficiency > 0.25 ? "weak_trend" : "range";
}
export function strategyInstance(s: Strategy) { return `${s.id}@${s.version}:${JSON.stringify(s.parameters)}`; }
export function decide(context: MarketContext, strategy: Strategy): Decision {
  const f = features(context); const regime = regimeFor(context); const c = context.bars;
  const result: Decision = { strategyId: strategy.id, strategyVersion: strategy.version, strategyInstance: strategyInstance(strategy), instrument: context.instrument, timeframe: context.timeframe, asOf: context.asOf, regime, action: "wait", entry: null, stop: null, target: null, score: 0, explanation: "There is not enough completed price history to make a decision.", invalidation: strategy.invalidation, features: f, externalEvidence: context.external };
  if (!strategy.timeframes.includes(context.timeframe) || !strategy.markets.includes(context.instrument)) return { ...result, explanation: "This strategy has not been configured for this market and timeframe." };
  if (c.length < Math.max(55, strategy.parameters.lookback + 2) || !f.atr) return result;
  if (context.asOf - c.at(-1)!.closeTime > 1) return { ...result, explanation: "Wait for a fresh completed candle. This snapshot is stale." };
  if (strategy.avoidRegimes.includes(regime) || context.newsRisk) return { ...result, explanation: "Current conditions do not suit this strategy. Waiting avoids a forced entry." };
  const last = c.at(-1)!; const previous = c.at(-2)!;
  const window = c.slice(-strategy.parameters.lookback - 1, -1);
  const high = Math.max(...window.map((b) => b.high)); const low = Math.min(...window.map((b) => b.low));
  const mean = window.reduce((sum, b) => sum + b.close, 0) / window.length;
  let direction = 0;
  if (strategy.id === "trend-pullback") direction = f.efficiency > 0.25 && f.direction > 0 && last.low <= mean && last.close > mean ? 1 : f.efficiency > 0.25 && f.direction < 0 && last.high >= mean && last.close < mean ? -1 : 0;
  if (strategy.id === "range-breakout") direction = last.close > high ? 1 : last.close < low ? -1 : 0;
  if (strategy.id === "liquidity-reclaim") direction = last.low < low && last.close > low && last.close > last.open ? 1 : last.high > high && last.close < high && last.close < last.open ? -1 : 0;
  if (strategy.id === "imbalance-continuation") direction = last.low > c.at(-3)!.high && previous.close > previous.open ? 1 : last.high < c.at(-3)!.low && previous.close < previous.open ? -1 : 0;
  if (context.higherBars.length >= 21) {
    const higherDirection = Math.sign(context.higherBars.at(-1)!.close - context.higherBars.at(-21)!.close);
    if (direction && higherDirection && direction !== higherDirection) return { ...result, explanation: "The entry signal disagrees with the last completed higher-timeframe trend." };
  }
  if (!direction) return { ...result, score: 25, explanation: `No entry yet: ${strategy.entryRules}` };
  const distance = f.atr * strategy.parameters.stopAtr;
  const stop = last.close - direction * distance, target = last.close + direction * distance * strategy.parameters.targetR;
  if (stop <= 0 || target <= 0) return { ...result, explanation: "Price protection could not be placed at valid positive prices." };
  return { ...result, action: direction > 0 ? "long" : "short", entry: last.close, stop, target, score: 60 + Math.round(f.efficiency * 30), explanation: `${direction > 0 ? "Buyers" : "Sellers"} confirmed the ${strategy.name.toLowerCase()} condition on a completed candle. The next available price must still pass risk and news checks.` };
}
