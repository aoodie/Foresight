import type { NormalisedCandle } from "./oanda-api.ts";

export const STRATEGY_VERSION = "scanner-v1.1.0";

export type ScannerResult = {
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
  timeframeMode?: "scalping" | "intraday" | "swing";
  timeframeAlignment?: Array<{
    timeframe: string;
    bias: "long" | "short" | "neutral";
    score: number;
  }>;
  confirmations?: number;
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
  const triggerCandles = (args.candles[profile.trigger] ?? []).filter(
    (candle) => candle.complete,
  );
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
      name: "Multi-timeframe trend continuation",
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
      name: "Liquidity sweep and reclaim",
      status: sweepMatched && directionConfirmed ? "confirmed" : "waiting",
      evidence: sweepMatched
        ? `The latest ${profile.trigger} candle swept the prior ${alignedBias === "long" ? "low" : "high"} and closed back inside the range.`
        : `No confirmed ${alignedBias === "long" ? "low" : "high"} sweep-and-reclaim is visible on the ${profile.trigger} trigger candle.`,
      why: "A failed push beyond a recent extreme can trap breakout traders. Reclaiming the level shows that the opposing side may have lost control.",
      nextStep: sweepMatched
        ? "Wait for the reclaim candle to hold; enter only if price does not immediately break back through the swept level."
        : `For a ${alignedBias} idea, wait for price to take a nearby ${alignedBias === "long" ? "low" : "high"} and close back through it.`,
    },
    {
      id: "imbalance-continuation",
      name: "Imbalance continuation",
      status: imbalanceMatched && directionConfirmed ? "confirmed" : "waiting",
      evidence: imbalanceMatched
        ? `The latest three ${profile.trigger} candles left a ${alignedBias} imbalance: price moved quickly with little overlap.`
        : `No fresh ${alignedBias === "long" ? "bullish" : "bearish"} three-candle imbalance is confirmed on the trigger chart.`,
      why: "A fast directional move can leave an area where little two-way trading happened. A retest that holds can offer a defined entry area; a close through it weakens the idea.",
      nextStep: imbalanceMatched
        ? "Do not chase the move. Wait for a retest that holds the imbalance edge, then use the stop beyond the far side."
        : "Treat an imbalance as a possible future entry zone, not as a trade until price reacts from it.",
    },
    {
      id: "range-breakout",
      name: "Range breakout continuation",
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
        ? `The ${profile.context}, ${profile.setup} and ${profile.trigger} readings are mixed. Wait for the timeframes to agree before considering a trade.`
        : `${confirmations} of ${alignment.length} timeframes support ${directionLabel}. Use the ${profile.trigger} chart only for entry confirmation, not for changing the higher-timeframe direction.`,
    reasons: [
      `${profile.context} context: ${context.bias === "neutral" ? "mixed" : context.bias}.`,
      `${profile.setup} setup: ${args.analyses[profile.setup]?.bias ?? "neutral"}.`,
      `${profile.trigger} trigger: ${args.analyses[profile.trigger]?.bias ?? "neutral"}.`,
      `${confirmations} of ${alignment.length} timeframes currently agree.`,
    ],
    strategies,
    selectedStrategy: selected,
  };
}
