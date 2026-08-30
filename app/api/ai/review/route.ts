import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { reviewLiveTrade } from "@/lib/openai-strategy";
import { writeSystemLog } from "@/lib/trading-records";
import { hashAiInput, readCachedDecision, storeDecision, withInFlightDedup } from "@/lib/ai-cache";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Add an OpenAI API key in Settings before monitoring a trade." }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Trade review data is missing." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const technical = input.technicalSnapshot && typeof input.technicalSnapshot === "object" ? input.technicalSnapshot as Record<string, unknown> : {};
  const trade = input.trade && typeof input.trade === "object" ? input.trade as Record<string, unknown> : {};
  const price = Number(input.currentPrice);
  const atrPercent = Number(technical.atrPercent);
  const moveBucket = Number.isFinite(price) && price > 0 ? Math.max(price * Math.max(0.0005, (Number.isFinite(atrPercent) ? atrPercent : 0.2) * 0.25 / 100), 0.00000001) : 0.0001;
  const eventContext = input.eventContext && typeof input.eventContext === "object" ? input.eventContext as Record<string, unknown> : null;
  const cacheKey = await hashAiInput({ type: "live_trade_review", version: 3, model: connection.model, reviewReason: input.reviewReason, eventContext: eventContext ? { id: eventContext.id, title: eventContext.title, currency: eventContext.currency, date: eventContext.date, actual: eventContext.actual, forecast: eventContext.forecast, previous: eventContext.previous, phase: eventContext.phase } : null, trade: { id: trade.id, instrument: trade.instrument, units: trade.units, price: trade.price, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit }, priceBucket: Number.isFinite(price) ? Math.round(price / moveBucket) : null, style: input.style, timeframes: input.timeframes, strategy: input.strategy, technicalSnapshot: input.technicalSnapshot });
  const subjectKey = `trade:${String(trade.id ?? "unknown")}`;
  try {
    const cached = await readCachedDecision<Record<string, unknown>>(cacheKey);
    if (cached) {
      const review = cached.value;
      await writeSystemLog({ level: review.drifted || review.decision === "close" ? "warning" : "info", category: "monitor", event: "strategy.review_cache_hit", message: "Reused the captured trade review; no OpenAI request was made.", instrument: typeof trade.instrument === "string" ? trade.instrument : null, details: { decisionId: cached.decisionId, fetchedAt: cached.fetchedAt, decision: review.decision, sentiment: review.sentiment, confidence: review.confidence } });
      return NextResponse.json({ ...review, reviewedAt: cached.fetchedAt, lastFetchedAt: cached.fetchedAt, model: cached.model, cacheHit: true, decisionId: cached.decisionId, usage: cached.usage });
    }
    const result = await withInFlightDedup(cacheKey, async () => {
      const concurrentCache = await readCachedDecision<Record<string, unknown>>(cacheKey);
      if (concurrentCache) return concurrentCache;
      const aiCall = await reviewLiveTrade(connection.apiKey, connection.model, body);
      return await storeDecision({ cacheKey, decisionType: "live_trade_review", subjectKey, model: connection.model, instructions: aiCall.instructions, input: aiCall.input, output: aiCall.value, validation: { valid: true, schema: "live_trade_review.v2" }, responseId: aiCall.responseId, usage: aiCall.usage, trigger: input.reviewReason === "high_impact_news_released" ? "post_news_event" : "material_trade_change", ttlMs: 15 * 60 * 1000 });
    });
    const review = result.value as Record<string, unknown>;
    await writeSystemLog({ level: review.drifted || review.decision === "close" ? "warning" : "info", category: "monitor", event: result.cacheHit ? "strategy.review_cache_hit" : (review.drifted ? "strategy.drift_detected" : "strategy.reviewed"), message: result.cacheHit ? "Reused a captured trade review; no additional OpenAI request was made." : String(review.explanation ?? "Trade reviewed."), instrument: typeof trade.instrument === "string" ? trade.instrument : null, details: { decisionId: result.decisionId, cacheHit: result.cacheHit, decision: review.decision, sentiment: review.sentiment, confidence: review.confidence, usage: result.usage } });
    return NextResponse.json({ ...review, reviewedAt: result.fetchedAt, lastFetchedAt: result.fetchedAt, model: result.model, cacheHit: result.cacheHit, decisionId: result.decisionId, usage: result.usage });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "monitor", event: "strategy.review_failed", message: error instanceof Error ? error.message : "Trade review failed." }); } catch { /* Preserve the original review error. */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review the open trade." }, { status: 502 });
  }
}
