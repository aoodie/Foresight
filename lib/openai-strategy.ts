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

export async function generateStrategies(apiKey: string, model: string, markets: StrategyMarket[]): Promise<AiStrategy[]> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "You are a cautious institutional-style FX research analyst. Produce one independent intraday-to-swing research strategy for each supplied market using only the supplied H4 technical snapshot. Set structure-aware entry, stop loss and two take profits; do not mechanically copy the baseline levels. A valid trade must have coherent directional price ordering and TP1 risk/reward of at least 1.5. Return wait/no_trade with null levels when evidence conflicts or confidence is below 60. Never invent news or economic events: eventRisk must tell the reader which relevant currency or US event risks to verify in the live calendar before entry. Keep analysis concise. This is research, not personalised financial advice, and no trade is executed.",
      input: JSON.stringify({ timeframe: "H4", generatedAt: new Date().toISOString(), markets }),
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
