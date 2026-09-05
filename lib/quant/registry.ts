import type { Strategy, StrategyId } from "./types.ts";
const markets = Object.freeze(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY"]);
const definitions: Array<[StrategyId, string, string]> = [
  ["trend-pullback", "Trend pullback", "Price must revisit its recent average and close back in the established trend direction."],
  ["range-breakout", "Range breakout", "A completed candle must close beyond the preceding 20-candle range."],
  ["liquidity-reclaim", "Failed breakout recovery", "Price must cross a recent extreme, then close back inside the range in the opposite direction."],
  ["imbalance-continuation", "Strong directional move", "Three completed candles must leave a price gap in the direction of the middle candle."],
];
// Released definitions are frozen. New rules require a new version, not mutation.
export const strategies: readonly Strategy[] = Object.freeze(definitions.map(([id, name, entryRules]) => Object.freeze({ id, name, version: "1.0.0", parameters: Object.freeze({ lookback: 20, stopAtr: 1.5, targetR: 2, maxBars: 24 }), markets, timeframes: Object.freeze(["M5", "M15", "H1", "H4"]), preferredRegimes: Object.freeze(id === "liquidity-reclaim" ? ["range" as const] : ["strong_trend" as const, "weak_trend" as const]), avoidRegimes: Object.freeze(["news_driven" as const, "uncertain" as const]), entryRules, exitRules: "Exit at the original stop, at two times initial risk, or after 24 completed bars. If stop and target both occur within a bar, assume the stop happens first.", invalidation: "The original stop is reached, or the maximum holding period expires.", lifecycle: "research" as const })));
export function strategyById(id: string, version = "1.0.0") { const s = strategies.find((s) => s.id === id && s.version === version); if (!s) throw new Error("Unknown strategy version. Old versions cannot be silently substituted."); return s; }
