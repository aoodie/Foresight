import type { NormalisedCandle } from "./oanda-api.ts";
import { observeLiveStrategies } from "./quant/live.ts";
import type { Decision } from "./quant/types.ts";

export const STRATEGY_VERSION = "scanner-v1.3.0";

export type MarketRegime = {
  type: "trending" | "ranging" | "breakout" | "volatile" | "compression";
  direction: "bullish" | "bearish" | "neutral";
  volatility: "low" | "normal" | "high";
  label: string;
  confidence: number;
  explanation: string;
  playbook: string;
};

export type SupportResistanceZone = {
  kind: "support" | "resistance";
  timeframe: string;
  low: number;
  high: number;
  midpoint: number;
  touches: number;
  strength: number;
  distanceAtr: number;
};

export type PendingOrderPlan = {
  orderType: "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  setup: "pullback" | "breakout";
  status: "watch" | "blocked";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  zone: SupportResistanceZone;
  rationale: string;
  confirmation: string;
  expiry: string;
  warning: string | null;
};

export type ScannerResult = {
  quantObservations?: Decision[];
  strategyVersion: string;
  instrument: string;
  label: string;
  assetClass: "forex" | "metal" | "index";
  bias: "long" | "short" | "neutral";
  score: number;
  price: number;
  change24h: number;
  rsi: number;
  atrPercent: number;
  marketRegime: MarketRegime;
  rangePosition: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward1: number | null;
  riskReward2: number | null;
  technicalStructure: string;
  analysis: string;
  reasons: string[];
  invalidation: string;
  setup: string;
  updatedAt: string;
  timeframeMode?: "scalping" | "intraday" | "swing";
  timeframeAlignment?: Array<{
    timeframe: string;
    bias: "long" | "short" | "neutral";
    score: number;
  }>;
  confirmations?: number;
  supportResistance?: {
    support: SupportResistanceZone | null;
    resistance: SupportResistanceZone | null;
    priceInsideZone: SupportResistanceZone | null;
  };
  pendingOrderPlans?: PendingOrderPlan[];
  strategies?: StrategyEvidence[];
  selectedStrategy?: StrategyEvidence;
};

export type StrategyEvidence = {
  id:
    | "trend-continuation"
    | "liquidity-reclaim"
    | "imbalance-continuation"
    | "range-breakout";
  name: string;
  status: "selected" | "confirmed" | "waiting" | "rejected";
  evidence: string;
  why: string;
  nextStep: string;
};

export type TimeframeMode = "scalping" | "intraday" | "swing";

export const timeframeProfiles: Record<
  TimeframeMode,
  { context: string; setup: string; trigger: string; frames: string[] }
> = {
  scalping: {
    context: "H1",
    setup: "M15",
    trigger: "M5",
    frames: ["H1", "M15", "M5"],
  },
  intraday: {
    context: "H4",
    setup: "H1",
    trigger: "M15",
    frames: ["H4", "H1", "M15"],
  },
  swing: {
    context: "D",
    setup: "H4",
    trigger: "H1",
    frames: ["D", "H4", "H1"],
  },
};

export function candleCountForGranularity(granularity: string) {
  if (granularity === "M5") return 300;
  if (granularity === "M15") return 100;
  return 80;
}

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  return values
    .slice(1)
    .reduce(
      (result, value) => (value - result) * multiplier + result,
      values[0],
    );
}

function rsi(values: number[], period = 14) {
  const changes = values
    .slice(-period - 1)
    .slice(1)
    .map((value, index) => value - values.slice(-period - 1)[index]);
  const gains =
    changes.reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  const losses =
    changes.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  if (!gains && !losses) return 50;
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(candles: NormalisedCandle[], period = 14) {
  const recent = candles.slice(-period - 1);
  const ranges = recent
    .slice(1)
    .map((candle, index) =>
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - recent[index].close),
        Math.abs(candle.low - recent[index].close),
      ),
    );
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

export function classifyMarketRegime(candlesInput: NormalisedCandle[]): MarketRegime {
  const candles = candlesInput.filter((candle) => candle.complete);
  if (candles.length < 55) throw new Error("At least 55 completed candles are required for regime classification.");
  const closes = candles.map((candle) => candle.close);
  const currentAtr = atr(candles);
  const ema20 = ema(closes.slice(-50), 20);
  const ema50 = ema(closes, 50);
  const recentCloses = closes.slice(-21);
  const path = recentCloses.slice(1).reduce((sum, close, index) => sum + Math.abs(close - recentCloses[index]), 0);
  const efficiency = path > 0 ? Math.abs(recentCloses.at(-1)! - recentCloses[0]) / path : 0;
  const trueRanges = candles.slice(-43).slice(1).map((candle, index) => {
    const previous = candles.slice(-43)[index];
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
  });
  const baselineRanges = trueRanges.slice(0, -14);
  const baselineAtr = baselineRanges.length ? baselineRanges.reduce((sum, value) => sum + value, 0) / baselineRanges.length : currentAtr;
  const volatilityRatio = baselineAtr > 0 ? currentAtr / baselineAtr : 1;
  const trendStrength = currentAtr > 0 ? Math.abs(ema20 - ema50) / currentAtr : 0;
  const last = candles.at(-1)!;
  const prior = candles.slice(-21, -1);
  const breaksHigh = last.close > Math.max(...prior.map((candle) => candle.high));
  const breaksLow = last.close < Math.min(...prior.map((candle) => candle.low));
  const direction = ema20 > ema50 && last.close > ema20 ? "bullish" : ema20 < ema50 && last.close < ema20 ? "bearish" : "neutral";
  const volatility = volatilityRatio >= 1.25 ? "high" : volatilityRatio <= 0.8 ? "low" : "normal";

  if ((breaksHigh || breaksLow) && volatilityRatio >= 0.95) {
    const breakoutDirection = breaksHigh ? "bullish" : "bearish";
    return {
      type: "breakout", direction: breakoutDirection, volatility,
      label: `${breakoutDirection === "bullish" ? "Moving above" : "Moving below"} its recent range`,
      confidence: Math.round(Math.min(95, 62 + efficiency * 24 + Math.max(0, volatilityRatio - 1) * 18)),
      explanation: `Price finished beyond its highest or lowest level of the previous 20 price periods. Recent moves are ${volatilityRatio.toFixed(2)} times their usual size.`,
      playbook: "Wait to see whether price stays beyond the old boundary or returns to it and holds. The first fast move alone is not enough.",
    };
  }
  if (trendStrength >= 0.65 && efficiency >= 0.28 && direction !== "neutral") {
    return {
      type: "trending", direction, volatility,
      label: `${direction === "bullish" ? "Steadily rising" : "Steadily falling"}`,
      confidence: Math.round(Math.min(95, 55 + trendStrength * 18 + efficiency * 28)),
      explanation: `Recent average prices and the latest price agree on an ${direction === "bullish" ? "upward" : "downward"} direction. The move has been relatively consistent.`,
      playbook: "Look for a brief move against the direction, followed by signs that the main move is resuming. A reversal needs its own evidence.",
    };
  }
  if (volatilityRatio <= 0.78) {
    return {
      type: "compression", direction: "neutral", volatility: "low", label: "Small, quiet price moves",
      confidence: Math.round(Math.min(95, 58 + (0.78 - volatilityRatio) * 90)),
      explanation: `Recent price moves are ${volatilityRatio.toFixed(2)} times their usual size. There is little progress in either direction.`,
      playbook: "Stand aside until price closes outside the range with confirmation; prepare both breakout directions.",
    };
  }
  if (volatilityRatio >= 1.3) {
    return {
      type: "volatile", direction, volatility: "high", label: "Unusually large price swings",
      confidence: Math.round(Math.min(95, 60 + (volatilityRatio - 1.3) * 35 + (1 - efficiency) * 12)),
      explanation: `Recent price moves are ${volatilityRatio.toFixed(2)} times their usual size, with frequent changes in direction.`,
      playbook: "Check how much the planned trade could lose, wait for clearer evidence and avoid rushing into a large price move.",
    };
  }
  return {
    type: "ranging", direction: "neutral", volatility, label: "Moving sideways",
    confidence: Math.round(Math.min(90, 55 + (1 - efficiency) * 25 + Math.max(0, 0.65 - trendStrength) * 15)),
    explanation: "Price keeps changing direction within a recent band. Neither buyers nor sellers have maintained control.",
    playbook: "Wait for price to turn at a recent lower or upper boundary. The middle of the range gives less useful evidence.",
  };
}

export function detectSupportResistanceZones(args: {
  candles: NormalisedCandle[];
  timeframe: string;
  currentPrice?: number;
}): SupportResistanceZone[] {
  const candles = args.candles.filter((candle) => candle.complete).slice(-100);
  if (candles.length < 15) return [];
  const currentPrice = args.currentPrice ?? candles.at(-1)!.close;
  const currentAtr = atr(candles);
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return [];
  const pivots: Array<{ price: number; index: number }> = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const neighbours = candles.slice(index - 2, index + 3);
    if (candle.high === Math.max(...neighbours.map((item) => item.high))) pivots.push({ price: candle.high, index });
    if (candle.low === Math.min(...neighbours.map((item) => item.low))) pivots.push({ price: candle.low, index });
  }
  if (pivots.length < 2) {
    const recent = candles.slice(-20);
    pivots.push(
      { price: Math.min(...recent.map((candle) => candle.low)), index: candles.length - 1 },
      { price: Math.max(...recent.map((candle) => candle.high)), index: candles.length - 1 },
    );
  }
  const clusterDistance = currentAtr * 0.45;
  const clusters: Array<Array<{ price: number; index: number }>> = [];
  for (const pivot of [...pivots].sort((a, b) => a.price - b.price)) {
    const cluster = clusters.find((items) => {
      const centre = items.reduce((sum, item) => sum + item.price, 0) / items.length;
      return Math.abs(pivot.price - centre) <= clusterDistance;
    });
    if (cluster) cluster.push(pivot);
    else clusters.push([pivot]);
  }
  return clusters.map((items) => {
    const midpoint = items.reduce((sum, item) => sum + item.price, 0) / items.length;
    const halfWidth = Math.max(currentAtr * 0.18, (Math.max(...items.map((item) => item.price)) - Math.min(...items.map((item) => item.price))) / 2);
    const recency = Math.max(...items.map((item) => item.index)) / Math.max(1, candles.length - 1);
    return {
      kind: midpoint <= currentPrice ? "support" as const : "resistance" as const,
      timeframe: args.timeframe,
      low: midpoint - halfWidth,
      high: midpoint + halfWidth,
      midpoint,
      touches: items.length,
      strength: Math.round(Math.min(100, 28 + items.length * 14 + recency * 18)),
      distanceAtr: Math.abs(currentPrice - midpoint) / currentAtr,
    };
  }).sort((a, b) => Math.abs(currentPrice - a.midpoint) - Math.abs(currentPrice - b.midpoint));
}

export function buildPendingOrderPlans(args: {
  bias: "long" | "short" | "neutral";
  price: number;
  atr: number;
  support: SupportResistanceZone | null;
  resistance: SupportResistanceZone | null;
  inside: SupportResistanceZone | null;
  mode: TimeframeMode;
}): PendingOrderPlan[] {
  if (args.bias === "neutral" || !args.support || !args.resistance || args.atr <= 0) return [];
  const buffer = args.atr * 0.15;
  const expiry = args.mode === "scalping" ? "6 trigger candles" : args.mode === "intraday" ? "4 trigger candles" : "3 trigger candles";
  const build = (input: Omit<PendingOrderPlan, "status" | "riskReward" | "expiry" | "warning">): PendingOrderPlan => {
    const risk = Math.abs(input.entry - input.stopLoss);
    const reward = Math.abs(input.takeProfit - input.entry);
    const riskReward = risk > 0 ? reward / risk : 0;
    const wrongSide = args.bias === "long"
      ? input.stopLoss >= input.entry || input.takeProfit <= input.entry
      : input.stopLoss <= input.entry || input.takeProfit >= input.entry;
    const warning = args.inside
      ? `Price is currently inside a ${args.inside.timeframe} ${args.inside.kind} zone. Wait for price to leave and confirm direction.`
      : wrongSide
        ? "The available opposing zone does not provide valid protective levels."
        : riskReward < 1.5
          ? `Projected reward is only ${riskReward.toFixed(1)}R; minimum is 1.5R.`
          : null;
    return { ...input, riskReward, expiry, status: warning ? "blocked" : "watch", warning };
  };
  if (args.bias === "long") {
    const limitEntry = args.support.high;
    const limitStop = args.support.low - buffer;
    const stopEntry = args.resistance.high + buffer;
    const stopStop = args.resistance.low - buffer;
    return [
      build({ orderType: "buy_limit", setup: "pullback", entry: limitEntry, stopLoss: limitStop, takeProfit: args.resistance.midpoint, zone: args.support, rationale: "Buy a controlled retest of confirmed support in the higher-timeframe bullish direction.", confirmation: "Activate only after a bullish rejection closes above the support zone; use the limit on the subsequent retest." }),
      build({ orderType: "buy_stop", setup: "breakout", entry: stopEntry, stopLoss: stopStop, takeProfit: stopEntry + (stopEntry - stopStop) * 2, zone: args.resistance, rationale: "Buy only if resistance breaks and price demonstrates acceptance above the zone.", confirmation: "Require a full trigger candle to close above resistance; a wick through the zone is not confirmation." }),
    ];
  }
  const limitEntry = args.resistance.low;
  const limitStop = args.resistance.high + buffer;
  const stopEntry = args.support.low - buffer;
  const stopStop = args.support.high + buffer;
  return [
    build({ orderType: "sell_limit", setup: "pullback", entry: limitEntry, stopLoss: limitStop, takeProfit: args.support.midpoint, zone: args.resistance, rationale: "Sell a controlled retest of confirmed resistance in the higher-timeframe bearish direction.", confirmation: "Activate only after a bearish rejection closes below the resistance zone; use the limit on the subsequent retest." }),
    build({ orderType: "sell_stop", setup: "breakout", entry: stopEntry, stopLoss: stopStop, takeProfit: stopEntry - (stopStop - stopEntry) * 2, zone: args.support, rationale: "Sell only if support breaks and price demonstrates acceptance below the zone.", confirmation: "Require a full trigger candle to close below support; a wick through the zone is not confirmation." }),
  ];
}

export function analyseInstrument(args: {
  instrument: string;
  label: string;
  assetClass: "forex" | "metal" | "index";
  candles: NormalisedCandle[];
}): ScannerResult {
  const candles = args.candles.filter((candle) => candle.complete);
  if (candles.length < 55)
    throw new Error("At least 55 completed candles are required for scanning.");
  const closes = candles.map((candle) => candle.close);
  const price = closes.at(-1)!;
  const ema20 = ema(closes.slice(-50), 20);
  const ema50 = ema(closes, 50);
  const currentRsi = rsi(closes);
  const currentAtr = atr(candles);
  const marketRegime = classifyMarketRegime(candles);
  const latestTime = new Date(candles.at(-1)!.time).getTime();
  const comparisonTime = latestTime - 24 * 60 * 60 * 1000;
  const comparisonCandle = [...candles].reverse().find((candle) => new Date(candle.time).getTime() <= comparisonTime) ?? candles[0];
  const changeBase = comparisonCandle.close;
  const change24h = ((price - changeBase) / changeBase) * 100;
  const momentum = currentAtr ? (price - changeBase) / currentAtr : 0;
  const recent = candles.slice(-7);
  const low = Math.min(...recent.map((candle) => candle.low));
  const high = Math.max(...recent.map((candle) => candle.high));
  const rangePosition =
    high === low ? 50 : ((price - low) / (high - low)) * 100;

  let directional = 0;
  directional += price > ema20 ? 25 : price < ema20 ? -25 : 0;
  directional += ema20 > ema50 ? 25 : ema20 < ema50 ? -25 : 0;
  directional += Math.max(-25, Math.min(25, momentum * 12));
  directional += Math.max(-15, Math.min(15, (currentRsi - 50) * 0.75));

  const bias =
    directional >= 12 ? "long" : directional <= -12 ? "short" : "neutral";
  const score = Math.round(Math.min(95, 48 + Math.abs(directional) * 0.58));
  const trend =
    price > ema20 && ema20 > ema50
      ? "clear upward trend"
      : price < ema20 && ema20 < ema50
        ? "clear downward trend"
        : "mixed trend";
  const technicalStructure =
    price > ema20 && ema20 > ema50
      ? "price is above its recent average, which is above its longer-term average"
      : price < ema20 && ema20 < ema50
        ? "price is below its recent average, which is below its longer-term average"
        : "price and its recent averages disagree about the direction";
  const momentumLabel =
    Math.abs(momentum) >= 0.8
      ? "moving strongly"
      : Math.abs(momentum) >= 0.35
        ? "moving steadily"
        : "moving slowly";
  const setup =
    bias === "neutral"
      ? "Wait — the signals disagree"
      : (bias === "long" ? "Possible buy" : "Possible sell") +
        " · " +
        trend +
        " · " +
        momentumLabel;
  const direction = bias === "long" ? 1 : bias === "short" ? -1 : 0;
  const stopDistance = currentAtr * 1.25;
  const entry = direction ? price : null;
  const stopLoss = direction ? price - direction * stopDistance : null;
  const takeProfit1 = direction ? price + direction * stopDistance * 1.5 : null;
  const takeProfit2 = direction ? price + direction * stopDistance * 2.5 : null;
  const momentumExplanation =
    currentRsi >= 70
      ? "Buying has been strong, but the market may be stretched and vulnerable to a pullback."
      : currentRsi <= 30
        ? "Selling has been strong, but the market may be stretched and vulnerable to a bounce."
        : currentRsi >= 55
          ? "Buyers currently have more momentum than sellers."
          : currentRsi <= 45
            ? "Sellers currently have more momentum than buyers."
            : "Buying and selling pressure are roughly balanced.";
  const reasons = [
    "Price is trading " +
      (price >= ema20 ? "above" : "below") +
      " its recent average, which " +
      (price >= ema20 ? "favours buyers." : "favours sellers."),
    "The short-term average is " +
      (ema20 >= ema50 ? "above" : "below") +
      " the longer-term average, showing a " +
      (ema20 >= ema50 ? "rising" : "falling") +
      " four-hour trend.",
    momentumExplanation,
    "Over the last 24 hours, price moved " +
      Math.abs(change24h).toFixed(2) +
      "% " +
      (change24h >= 0 ? "higher" : "lower") +
      "—about " +
      Math.abs(momentum).toFixed(1) +
      " times its normal four-hour movement.",
  ];
  const analysis =
    bias === "neutral"
      ? "There is no clear opportunity yet because the trend and recent price movement disagree."
      : "The four-hour trend is " +
        (bias === "long" ? "rising" : "falling") +
        " and price is " +
        momentumLabel +
        ". Do not enter yet; wait for a clear short-term confirmation near a sensible entry level.";
  const invalidation =
    bias === "neutral"
      ? "Wait until the four-hour trend and momentum point in the same direction."
      : "Ignore this idea if a four-hour candle closes firmly against the trend or the short-term trend turns the other way.";

  return {
    strategyVersion: STRATEGY_VERSION,
    instrument: args.instrument,
    label: args.label,
    assetClass: args.assetClass,
    bias,
    score,
    price,
    change24h,
    rsi: currentRsi,
    atrPercent: (currentAtr / price) * 100,
    marketRegime,
    rangePosition,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskReward1: direction ? 1.5 : null,
    riskReward2: direction ? 2.5 : null,
    technicalStructure,
    analysis,
    reasons,
    invalidation,
    setup,
    updatedAt: candles.at(-1)!.time,
  };
}

export function combineTimeframes(args: {
  instrument: string;
  label: string;
  assetClass: "forex" | "metal" | "index";
  mode: TimeframeMode;
  analyses: Record<string, ScannerResult>;
  candles: Record<string, NormalisedCandle[]>;
}): ScannerResult {
  const profile = timeframeProfiles[args.mode];
  const context =
    args.analyses[profile.context] ?? args.analyses[profile.frames[0]];
  const trigger =
    args.analyses[profile.trigger] ?? args.analyses[profile.frames.at(-1)!];
  const alignment = profile.frames.map((timeframe) => ({
    timeframe,
    bias: args.analyses[timeframe]?.bias ?? "neutral",
    score: args.analyses[timeframe]?.score ?? 0,
  }));
  const directional = alignment.filter((item) => item.bias !== "neutral");
  const longCount = directional.filter((item) => item.bias === "long").length;
  const shortCount = directional.filter((item) => item.bias === "short").length;
  const alignedBias =
    longCount >= 2 && longCount > shortCount
      ? "long"
      : shortCount >= 2 && shortCount > longCount
        ? "short"
        : "neutral";
  const confirmations =
    alignedBias === "neutral"
      ? Math.max(longCount, shortCount)
      : alignment.filter((item) => item.bias === alignedBias).length;
  const direction = alignedBias === "long" ? 1 : alignedBias === "short" ? -1 : 0;
  const triggerAtr = trigger.price * trigger.atrPercent / 100;
  const stopDistance = triggerAtr * 1.25;
  const result = {
    ...context,
    bias: alignedBias as ScannerResult["bias"],
    score: Math.round(
      Math.min(
        95,
        context.score * 0.55 + (confirmations / alignment.length) * 45,
      ),
    ),
    timeframeMode: args.mode,
    timeframeAlignment: alignment,
    confirmations,
    price: trigger.price,
    change24h: trigger.change24h,
    rsi: trigger.rsi,
    atrPercent: trigger.atrPercent,
    rangePosition: trigger.rangePosition,
    entry: direction ? trigger.price : null,
    stopLoss: direction ? trigger.price - direction * stopDistance : null,
    takeProfit1: direction ? trigger.price + direction * stopDistance * 1.5 : null,
    takeProfit2: direction ? trigger.price + direction * stopDistance * 2.5 : null,
    riskReward1: direction ? 1.5 : null,
    riskReward2: direction ? 2.5 : null,
    updatedAt: trigger.updatedAt,
  };
  const directionLabel =
    alignedBias === "long"
      ? "buying"
      : alignedBias === "short"
        ? "selling"
        : "mixed";
  const frameExplanation = (timeframe: string) => {
    const frame = args.analyses[timeframe];
    if (!frame) return `${timeframe}: data unavailable.`;
    const direction = frame.bias === "neutral" ? "mixed" : frame.bias;
    const movement = `${Math.abs(frame.change24h).toFixed(2)}% ${frame.change24h >= 0 ? "higher" : "lower"} over the last 24h`;
    const range = `${frame.rangePosition.toFixed(0)}% through its latest seven-candle range`;
    return `${timeframe}: ${direction}; ${frame.technicalStructure}; ${movement}; ${range}.`;
  };
  const triggerCandles = (args.candles[profile.trigger] ?? []).filter(
    (candle) => candle.complete,
  );
  const zones = [profile.context, profile.setup].flatMap((timeframe) =>
    detectSupportResistanceZones({
      candles: args.candles[timeframe] ?? [],
      timeframe,
      currentPrice: trigger.price,
    }),
  );
  const priceInsideZone = zones
    .filter((zone) => trigger.price >= zone.low && trigger.price <= zone.high)
    .sort((a, b) => b.strength - a.strength)[0] ?? null;
  const nearestSupport = zones
    .filter((zone) => zone.kind === "support" && zone.midpoint < trigger.price)
    .sort((a, b) => a.distanceAtr - b.distanceAtr || b.strength - a.strength)[0] ?? null;
  const nearestResistance = zones
    .filter((zone) => zone.kind === "resistance" && zone.midpoint > trigger.price)
    .sort((a, b) => a.distanceAtr - b.distanceAtr || b.strength - a.strength)[0] ?? null;
  const last = triggerCandles.at(-1);
  const prior = triggerCandles.slice(-7, -1);
  const priorHigh = prior.length
    ? Math.max(...prior.map((candle) => candle.high))
    : Number.NaN;
  const priorLow = prior.length
    ? Math.min(...prior.map((candle) => candle.low))
    : Number.NaN;
  const bullishBreak = Boolean(last && last.close > priorHigh);
  const bearishBreak = Boolean(last && last.close < priorLow);
  const bullishSweep = Boolean(
    last && last.low < priorLow && last.close > priorLow,
  );
  const bearishSweep = Boolean(
    last && last.high > priorHigh && last.close < priorHigh,
  );
  const three = triggerCandles.slice(-3);
  const bullishImbalance = three.length === 3 && three[2].low > three[0].high;
  const bearishImbalance = three.length === 3 && three[2].high < three[0].low;
  const directionConfirmed = alignedBias !== "neutral" && confirmations >= 2;
  const matchesDirection = (longCondition: boolean, shortCondition: boolean) =>
    alignedBias === "long"
      ? longCondition
      : alignedBias === "short"
        ? shortCondition
        : false;
  const trendStatus: StrategyEvidence["status"] = directionConfirmed
    ? "confirmed"
    : "rejected";
  const sweepMatched = matchesDirection(bullishSweep, bearishSweep);
  const imbalanceMatched = matchesDirection(bullishImbalance, bearishImbalance);
  const breakoutMatched = matchesDirection(bullishBreak, bearishBreak);
  const strategies: StrategyEvidence[] = [
    {
      id: "trend-continuation",
      name: "Following the broader price direction",
      status: trendStatus,
      evidence: directionConfirmed
        ? `${confirmations}/${alignment.length} timeframes are ${alignedBias}; the ${profile.context} chart sets the direction.`
        : `Only ${confirmations}/${alignment.length} timeframes agree, so trend direction is not reliable enough.`,
      why: "When the larger chart, setup chart and entry chart agree, a lower-timeframe entry is less likely to fight the broader move.",
      nextStep: directionConfirmed
        ? `Use ${profile.trigger} only to time the entry in the ${alignedBias} direction.`
        : "Wait for at least two selected timeframes to agree.",
    },
    {
      id: "liquidity-reclaim",
      name: "Recovery after a failed breakout",
      status: sweepMatched && directionConfirmed ? "confirmed" : "waiting",
      evidence: sweepMatched
        ? `The latest ${profile.trigger} candle crossed the previous ${alignedBias === "long" ? "low" : "high"} and finished back inside the recent price band.`
        : `No confirmed ${alignedBias === "long" ? "low" : "high"} failed breakout recovery is visible on the ${profile.trigger} trigger candle.`,
      why: "A failed push beyond a recent extreme can trap breakout traders. Reclaiming the level shows that the opposing side may have lost control.",
      nextStep: sweepMatched
        ? "Wait for the recovery to hold; enter only if price does not immediately break back through the previous boundary."
        : `For a ${alignedBias} idea, wait for price to take a nearby ${alignedBias === "long" ? "low" : "high"} and close back through it.`,
    },
    {
      id: "imbalance-continuation",
      name: "Following a strong price move",
      status: imbalanceMatched && directionConfirmed ? "confirmed" : "waiting",
      evidence: imbalanceMatched
        ? `The latest three ${profile.trigger} candles left a ${alignedBias} gap between price periods after a fast move.`
        : `No fresh ${alignedBias === "long" ? "bullish" : "bearish"} gap between three finished price periods is confirmed on the trigger chart.`,
      why: "A fast directional move can leave an area where little two-way trading happened. A retest that holds can offer a defined entry area; a close through it weakens the idea.",
      nextStep: imbalanceMatched
        ? "Do not chase the move. Wait for a retest that holds the edge of the gap, then use the stop beyond the far side."
        : "Treat a price gap as a possible future entry area, not as a trade until price reacts from it.",
    },
    {
      id: "range-breakout",
      name: "Moving beyond a recent price range",
      status: breakoutMatched && directionConfirmed ? "confirmed" : "waiting",
      evidence: breakoutMatched
        ? `The latest ${profile.trigger} close broke the prior six-candle ${alignedBias === "long" ? "high" : "low"} in the same direction as the higher-timeframe bias.`
        : `Price has not yet closed beyond the prior six-candle ${alignedBias === "long" ? "high" : "low"} on the trigger chart.`,
      why: "A close outside a short range can show that price has accepted a new level. It is stronger when it agrees with the higher-timeframe trend.",
      nextStep: breakoutMatched
        ? "Prefer a retest or a second candle that holds outside the range before entering."
        : "Wait for a full trigger candle to close outside the range; a wick alone is not confirmation.",
    },
  ];
  const selected =
    strategies.find(
      (strategy) =>
        strategy.id === "liquidity-reclaim" && strategy.status === "confirmed",
    ) ??
    strategies.find(
      (strategy) =>
        strategy.id === "imbalance-continuation" &&
        strategy.status === "confirmed",
    ) ??
    strategies.find(
      (strategy) =>
        strategy.id === "range-breakout" && strategy.status === "confirmed",
    ) ??
    strategies.find((strategy) => strategy.id === "trend-continuation");
  if (selected) selected.status = directionConfirmed ? "selected" : "rejected";
  return {
    ...result,
    setup:
      alignedBias === "neutral"
        ? `Wait · ${profile.context} context and ${profile.trigger} entry are not aligned`
        : `${args.mode} · ${profile.context} context → ${profile.setup} setup → ${profile.trigger} trigger`,
    analysis:
      alignedBias === "neutral"
        ? `No trade thesis yet: ${profile.context}, ${profile.setup} and ${profile.trigger} do not form a consistent directional structure. The scanner is showing the conflict, not recommending an entry.`
        : `${directionLabel === "selling" ? "Bearish" : "Bullish"} structure is aligned across ${confirmations}/${alignment.length} timeframes. The ${profile.context} chart defines the directional thesis; ${profile.setup} must remain aligned, and ${profile.trigger} is used only to time a low-risk entry.`,
    reasons: [
      frameExplanation(profile.context),
      frameExplanation(profile.setup),
      frameExplanation(profile.trigger),
      selected
        ? `Entry condition: ${selected.nextStep}`
        : "Entry condition: wait for a defined trigger before considering a trade.",
    ],
    supportResistance: {
      support: nearestSupport,
      resistance: nearestResistance,
      priceInsideZone,
    },
    pendingOrderPlans: buildPendingOrderPlans({
      bias: alignedBias,
      price: trigger.price,
      atr: triggerAtr,
      support: nearestSupport,
      resistance: nearestResistance,
      inside: priceInsideZone,
      mode: args.mode,
    }),
    strategies,
    selectedStrategy: selected,
    quantObservations: observeLiveStrategies(args.instrument, profile.trigger, args.candles[profile.trigger] ?? []),
  };
}
