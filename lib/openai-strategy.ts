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

export async function generateStrategies(apiKey: string, model: string, markets: StrategyMarket[], luxAlgoResearch: unknown): Promise<AiStrategy[]> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "You are a cautious institutional-style FX research analyst writing for an ordinary trader. Produce one independent intraday-to-swing research strategy for each supplied market using the four-hour technical snapshot and the supplied LuxAlgo Library MCP research. Apply only LuxAlgo concepts actually present in that research and list their official names in methodology. Write every user-facing field in direct, plain English. Do not use abbreviations or unexplained jargon such as H4, EMA, RSI, ATR, SMC, ICT, FVG, displacement, structure shift or liquidity sweep. If a technical term is essential, explain it immediately in everyday language. Say exactly what must happen before entry, why the stop belongs there, and what would prove the idea wrong. Set structure-aware entry, stop loss and two take profits; do not mechanically copy the scanner's baseline levels. A valid trade must have coherent directional price ordering and first-target risk/reward of at least 1.5. Treat extreme momentum readings as a warning that price may bounce or pull back; never encourage chasing an overstretched move. Return wait/no_trade with null levels when evidence conflicts or confidence is below 60. Never invent chart patterns not established by the supplied data, and never invent news or economic events: eventRisk must tell the reader which relevant currency or US event risks to verify in the live calendar before entry. Keep analysis concise. This is research, not personalised financial advice, and no trade is executed.",
      input: JSON.stringify({ timeframe: "H4", generatedAt: new Date().toISOString(), markets, luxAlgoResearch }),
      text: { format: { type: "json_schema", name: "daily_trade_strategies", strict: true, schema: outputSchema } },
    }),
  });
  const payload = await response.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI could not generate the daily strategies.");
  const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no structured strategy output.");
  const parsed = JSON.parse(text) as { strategies?: AiStrategy[] };
  if (!Array.isArray(parsed.strategies)) throw new Error("OpenAI returned an invalid strategy payload.");
  return parsed.strategies;
}
