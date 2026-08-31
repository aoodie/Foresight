import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { generateStrategies, isStrategyMarket } from "@/lib/openai-strategy";
import { getLuxAlgoGrounding } from "@/lib/luxalgo-mcp";
import { writeSystemLog } from "@/lib/trading-records";
import { compactStrategyMarkets, hashAiInput, readCachedDecision, storeDecision, withInFlightDedup } from "@/lib/ai-cache";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Add an OpenAI API key in Settings before generating AI strategies." }, { status: 503 });
  const body = await request.json() as { markets?: unknown[]; mode?: "scalping" | "intraday" | "swing"; force?: boolean } | null;
  const markets = Array.isArray(body?.markets) ? body.markets.slice(0, 3) : [];
  if (!markets.length || !markets.every(isStrategyMarket)) return NextResponse.json({ error: "The scanner data is incomplete. Run the daily scan again." }, { status: 400 });
  const mode = body?.mode ?? "intraday";
  const cacheKey = await hashAiInput({ type: "strategies", version: 4, model: connection.model, baseUrl: connection.baseUrl, mode, markets: compactStrategyMarkets(markets) });
  const subjectKey = `strategies:${mode}`;
  try {
    if (!body?.force) {
      const cached = await readCachedDecision<{ strategies: unknown[]; luxAlgoSources?: unknown[] }>(cacheKey);
      if (cached) {
        await writeSystemLog({ category: "ai", event: "analysis.cache_hit", message: "Reused the captured AI strategy analysis; no OpenAI request was made.", details: { mode, instruments: markets.map((market) => (market as { instrument: string }).instrument), model: connection.model, decisionId: cached.decisionId, fetchedAt: cached.fetchedAt } });
        const output = cached.value;
        return NextResponse.json({ model: cached.model, mode, generatedAt: cached.fetchedAt, lastFetchedAt: cached.fetchedAt, strategies: output.strategies, luxAlgoSources: output.luxAlgoSources ?? [], cacheHit: true, decisionId: cached.decisionId, usage: cached.usage });
      }
    }
    const result = await withInFlightDedup(cacheKey, async () => {
      if (!body?.force) {
        const concurrentCache = await readCachedDecision<{ strategies: unknown[]; luxAlgoSources?: unknown[] }>(cacheKey);
        if (concurrentCache) return concurrentCache;
      }
      const luxAlgoSources = await getLuxAlgoGrounding();
      const aiCall = await generateStrategies(connection.apiKey, connection.model, markets, luxAlgoSources, mode, connection.baseUrl);
      const output = { strategies: aiCall.value, luxAlgoSources: luxAlgoSources.map((source) => ({ slug: source.slug, name: source.name, family: source.family, url: source.url })) };
      return await storeDecision({ cacheKey, decisionType: "strategies", subjectKey, model: connection.model, instructions: aiCall.instructions, input: aiCall.input, output, validation: { valid: true, schema: "daily_trade_strategies.v2" }, responseId: aiCall.responseId, usage: aiCall.usage, trigger: body?.force ? "manual_refresh" : "material_market_change", ttlMs: 6 * 60 * 60 * 1000 });
    });
    const output = result.value as { strategies: unknown[]; luxAlgoSources: unknown[] };
    await writeSystemLog({ category: "ai", event: result.cacheHit ? "analysis.cache_hit" : "analysis.completed", message: result.cacheHit ? "Reused an in-flight or captured AI strategy analysis; no additional OpenAI request was made." : `AI generated ${output.strategies.length} strategy plan(s).`, details: { mode, instruments: markets.map((market) => (market as { instrument: string }).instrument), model: connection.model, decisionId: result.decisionId, cacheHit: result.cacheHit, usage: result.usage } });
    return NextResponse.json({ model: result.model, mode, generatedAt: result.fetchedAt, lastFetchedAt: result.fetchedAt, strategies: output.strategies, luxAlgoSources: output.luxAlgoSources, cacheHit: result.cacheHit, decisionId: result.decisionId, usage: result.usage });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "ai", event: "analysis.failed", message: error instanceof Error ? error.message : "AI strategy generation failed." }); } catch { /* Preserve the original AI error. */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate AI strategies." }, { status: 502 });
  }
}
