import type { NormalisedCandle } from "@/lib/oanda-api";

export type ScannerResult = {
  instrument: string;
  label: string;
  assetClass: "forex" | "metal" | "index";
  bias: "long" | "short" | "neutral";
  score: number;
  price: number;
  change24h: number;
  rsi: number;
  atrPercent: number;
  rangePosition: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward1: number | null;
  riskReward2: number | null;
  analysis: string;
  reasons: string[];
  invalidation: string;
  setup: string;
  updatedAt: string;
};

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  return values.slice(1).reduce((result, value) => (value - result) * multiplier + result, values[0]);
}

function rsi(values: number[], period = 14) {
  const changes = values.slice(-period - 1).slice(1).map((value, index) => value - values.slice(-period - 1)[index]);
  const gains = changes.reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  const losses = changes.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(candles: NormalisedCandle[], period = 14) {
  const recent = candles.slice(-period - 1);
  const ranges = recent.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - recent[index].close),
    Math.abs(candle.low - recent[index].close),
  ));
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

export function analyseInstrument(args: {
  instrument: string;
  label: string;
  assetClass: "forex" | "metal" | "index";
  candles: NormalisedCandle[];
}): ScannerResult {
  if (args.candles.length < 55) throw new Error("At least 55 candles are required for scanning.");
  const candles = args.candles.filter((candle) => candle.complete);
  const closes = candles.map((candle) => candle.close);
  const price = closes.at(-1)!;
  const ema20 = ema(closes.slice(-50), 20);
  const ema50 = ema(closes, 50);
  const currentRsi = rsi(closes);
  const currentAtr = atr(candles);
  const changeBase = closes.at(-7) ?? closes[0];
  const change24h = ((price - changeBase) / changeBase) * 100;
  const momentum = currentAtr ? (price - changeBase) / currentAtr : 0;
  const recent = candles.slice(-7);
  const low = Math.min(...recent.map((candle) => candle.low));
  const high = Math.max(...recent.map((candle) => candle.high));
  const rangePosition = high === low ? 50 : ((price - low) / (high - low)) * 100;

  let directional = 0;
  directional += price > ema20 ? 25 : -25;
  directional += ema20 > ema50 ? 25 : -25;
  directional += Math.max(-25, Math.min(25, momentum * 12));
  directional += Math.max(-15, Math.min(15, (currentRsi - 50) * 0.75));

  const bias = directional >= 12 ? "long" : directional <= -12 ? "short" : "neutral";
  const score = Math.round(Math.min(95, 48 + Math.abs(directional) * 0.58));
  const trend = price > ema20 && ema20 > ema50 ? "clear upward trend" : price < ema20 && ema20 < ema50 ? "clear downward trend" : "mixed trend";
  const momentumLabel = Math.abs(momentum) >= 0.8 ? "moving strongly" : Math.abs(momentum) >= 0.35 ? "moving steadily" : "moving slowly";
  const setup = bias === "neutral" ? "Wait — the signals disagree" : (bias === "long" ? "Possible buy" : "Possible sell") + " · " + trend + " · " + momentumLabel;
  const direction = bias === "long" ? 1 : bias === "short" ? -1 : 0;
  const stopDistance = currentAtr * 1.25;
  const entry = direction ? price : null;
  const stopLoss = direction ? price - direction * stopDistance : null;
  const takeProfit1 = direction ? price + direction * stopDistance * 1.5 : null;
  const takeProfit2 = direction ? price + direction * stopDistance * 2.5 : null;
  const momentumExplanation = currentRsi >= 70
    ? "Buying has been strong, but the market may be stretched and vulnerable to a pullback."
    : currentRsi <= 30
      ? "Selling has been strong, but the market may be stretched and vulnerable to a bounce."
      : currentRsi >= 55
        ? "Buyers currently have more momentum than sellers."
        : currentRsi <= 45
          ? "Sellers currently have more momentum than buyers."
          : "Buying and selling pressure are roughly balanced.";
  const reasons = [
    "Price is trading " + (price >= ema20 ? "above" : "below") + " its recent average, which " + (price >= ema20 ? "favours buyers." : "favours sellers."),
    "The short-term average is " + (ema20 >= ema50 ? "above" : "below") + " the longer-term average, showing a " + (ema20 >= ema50 ? "rising" : "falling") + " four-hour trend.",
    momentumExplanation,
    "Over the last 24 hours, price moved " + Math.abs(change24h).toFixed(2) + "% " + (change24h >= 0 ? "higher" : "lower") + "—about " + Math.abs(momentum).toFixed(1) + " times its normal four-hour movement.",
  ];
  const analysis = bias === "neutral"
    ? "There is no clear opportunity yet because the trend and recent price movement disagree."
    : "The four-hour trend is " + (bias === "long" ? "rising" : "falling") + " and price is " + momentumLabel + ". Do not enter yet; wait for a clear short-term confirmation near a sensible entry level.";
  const invalidation = bias === "neutral"
    ? "Wait until the four-hour trend and momentum point in the same direction."
    : "Ignore this idea if a four-hour candle closes firmly against the trend or the short-term trend turns the other way.";

  return {
    instrument: args.instrument,
    label: args.label,
    assetClass: args.assetClass,
    bias,
    score,
    price,
    change24h,
    rsi: currentRsi,
    atrPercent: (currentAtr / price) * 100,
    rangePosition,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskReward1: direction ? 1.5 : null,
    riskReward2: direction ? 2.5 : null,
    analysis,
    reasons,
    invalidation,
    setup,
    updatedAt: candles.at(-1)!.time,
  };
}
