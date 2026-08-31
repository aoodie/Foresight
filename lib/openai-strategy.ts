export type StrategyMarket = {
  instrument: string;
  label: string;
  bias: "long" | "short" | "neutral";
  score: number;
  price: number;
  change24h: number;
  rsi: number;
  atrPercent: number;
  rangePosition: number;
  analysis: string;
  reasons: string[];
  invalidation: string;
  updatedAt: string;
};

export type AiStrategy = {
  instrument: string;
  verdict: "long" | "short" | "wait";
  strategyName: string;
  setupType: "breakout" | "pullback" | "reversal" | "range" | "no_trade";
  confidence: number;
  entryType: "limit" | "stop" | "market" | "none";
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward1: number | null;
  riskReward2: number | null;
  analysis: string;
  reasons: string[];
  trigger: string;
  invalidation: string;
  eventRisk: string;
  methodology: string[];
};

export const strategyInstructions = "You are a cautious institutional-style FX research analyst writing for an ordinary trader. Produce one independent research strategy for each supplied market using the selected trading mode's timeframe profile and the supplied multi-timeframe OANDA snapshot plus LuxAlgo Library MCP research. Require confluence from multiple independent LuxAlgo families when available: Price Action Concepts market structure, liquidity, order blocks or imbalances, momentum, and volatility-based risk. Do not let RSI alone create a trade. List the actual LuxAlgo concepts used in methodology and say when confirmation is missing. Write every user-facing field in direct, plain English. Do not use abbreviations or unexplained jargon such as H4, EMA, RSI, ATR, SMC, ICT, FVG, displacement, structure shift or liquidity sweep. If a technical term is essential, explain it immediately in everyday language. Say exactly what must happen before entry, why the stop belongs there, and what would prove the idea wrong. Set structure-aware entry, stop loss and two take profits; do not mechanically copy the scanner's baseline levels. A valid trade must have coherent directional price ordering and first-target risk/reward of at least 1.5. Treat extreme momentum readings as a warning that price may bounce or pull back; never encourage chasing an overstretched move. Return wait/no_trade with null levels when timeframes conflict, LuxAlgo confirmation is insufficient, or confidence is below 60. Never invent chart patterns not established by the supplied data, and never invent news or economic events: eventRisk must tell the reader which relevant currency or US event risks to verify in the live calendar before entry. Keep analysis concise. This is research, not personalised financial advice, and no trade is executed.";

export const reviewInstructions = "Review an already-open FX or CFD trade against the strategy that created it. This is a monitoring check, not an order-execution instruction. Decide whether the strategy has materially drifted. Use only the supplied trade, current quote, original plan, volatility, timeframe data and high-impact event data. If an event context is supplied, assess the event's likely sentiment only from the supplied actual, forecast and previous values; if actual data is missing, use unclear or mixed and say that confirmation is unavailable. Decide whether to hold, review, reduce or close the position. Do not invent news or prices. Keep the explanation plain English and concise. Do not tell the system to move a stop automatically. If the stop or target has been reached, say so clearly. A normal fluctuation inside the original plan is hold; a meaningful break of the invalidation logic or adverse event reaction needs review or close. This is research, not personalised financial advice.";

const strategyProperties = {
  instrument: { type: "string" },
  verdict: { type: "string", enum: ["long", "short", "wait"] },
  strategyName: { type: "string" },
  setupType: { type: "string", enum: ["breakout", "pullback", "reversal", "range", "no_trade"] },
  confidence: { type: "number", minimum: 0, maximum: 100 },
  entryType: { type: "string", enum: ["limit", "stop", "market", "none"] },
  entry: { type: ["number", "null"] },
  stopLoss: { type: ["number", "null"] },
  takeProfit1: { type: ["number", "null"] },
  takeProfit2: { type: ["number", "null"] },
  riskReward1: { type: ["number", "null"] },
  riskReward2: { type: ["number", "null"] },
  analysis: { type: "string" },
  reasons: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
  trigger: { type: "string" },
  invalidation: { type: "string" },
  eventRisk: { type: "string" },
  methodology: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    strategies: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "object", additionalProperties: false, properties: strategyProperties, required: Object.keys(strategyProperties) },
    },
  },
  required: ["strategies"],
};

export function isStrategyMarket(value: unknown): value is StrategyMarket {
  if (!value || typeof value !== "object") return false;
  const market = value as Record<string, unknown>;
  return typeof market.instrument === "string" && typeof market.label === "string" && ["long", "short", "neutral"].includes(String(market.bias)) &&
    ["score", "price", "change24h", "rsi", "atrPercent", "rangePosition"].every((key) => typeof market[key] === "number" && Number.isFinite(market[key])) &&
    typeof market.analysis === "string" && Array.isArray(market.reasons) && market.reasons.every((reason) => typeof reason === "string") &&
    typeof market.invalidation === "string" && typeof market.updatedAt === "string";
}

export type AiCallResult<T> = { value: T; responseId: string | null; usage: Record<string, unknown> | null; input: unknown; instructions: string };

export async function generateStrategies(apiKey: string, model: string, markets: StrategyMarket[], luxAlgoResearch: unknown, mode: "scalping" | "intraday" | "swing" = "intraday", baseUrl = defaultAiBaseUrl): Promise<AiCallResult<AiStrategy[]>> {
  const input = { tradingMode: mode, timeframeProfile: mode === "scalping" ? { context: "H1", setup: "M15", trigger: "M5" } : { context: "H4", setup: "H1", trigger: "M15" }, markets, luxAlgoResearch };
  const response = await fetch(aiEndpoint(baseUrl, "/responses"), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(model.trim() ? { model: model.trim() } : {}),
      instructions: strategyInstructions,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name: "daily_trade_strategies", strict: true, schema: outputSchema } },
    }),
  });
  const payload = await response.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (!response.ok) throw new Error(payload.error?.message || "The LLM provider could not generate the daily strategies.");
  const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("The LLM provider returned no structured strategy output.");
  const parsed = JSON.parse(text) as { strategies?: AiStrategy[] };
  if (!Array.isArray(parsed.strategies)) throw new Error("The LLM provider returned an invalid strategy payload.");
  return { value: parsed.strategies, responseId: typeof (payload as { id?: unknown }).id === "string" ? (payload as { id: string }).id : null, usage: payload && typeof (payload as { usage?: unknown }).usage === "object" ? (payload as { usage: Record<string, unknown> }).usage : null, input, instructions: strategyInstructions };
}

export type LiveTradeReview = {
  drifted: boolean;
  decision: "hold" | "review" | "reduce" | "close";
  sentiment: "bullish" | "bearish" | "mixed" | "unclear";
  confidence: number;
  explanation: string;
  recommendedAction: string;
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    drifted: { type: "boolean" },
    decision: { type: "string", enum: ["hold", "review", "reduce", "close"] },
    sentiment: { type: "string", enum: ["bullish", "bearish", "mixed", "unclear"] },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    explanation: { type: "string" },
    recommendedAction: { type: "string" },
  },
  required: ["drifted", "decision", "sentiment", "confidence", "explanation", "recommendedAction"],
};

export async function reviewLiveTrade(apiKey: string, model: string, input: unknown, baseUrl = defaultAiBaseUrl): Promise<AiCallResult<LiveTradeReview>> {
  const response = await fetch(aiEndpoint(baseUrl, "/responses"), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(model.trim() ? { model: model.trim() } : {}),
      instructions: reviewInstructions,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name: "live_trade_review", strict: true, schema: reviewSchema } },
    }),
  });
  const payload = await response.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (!response.ok) throw new Error(payload.error?.message || "The LLM provider could not review the live trade.");
  const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("The LLM provider returned no trade review.");
  return { value: JSON.parse(text) as LiveTradeReview, responseId: typeof (payload as { id?: unknown }).id === "string" ? (payload as { id: string }).id : null, usage: payload && typeof (payload as { usage?: unknown }).usage === "object" ? (payload as { usage: Record<string, unknown> }).usage : null, input, instructions: reviewInstructions };
}
import { aiEndpoint, defaultAiBaseUrl } from "./ai-config.ts";
