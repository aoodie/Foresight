import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { reviewLiveTrade } from "@/lib/openai-strategy";
import { writeSystemLog } from "@/lib/trading-records";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Add an OpenAI API key in Settings before monitoring a trade." }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Trade review data is missing." }, { status: 400 });
  try {
    const review = await reviewLiveTrade(connection.apiKey, connection.model, body);
    await writeSystemLog({ level: review.drifted || review.decision === "close" ? "warning" : "info", category: "monitor", event: review.drifted ? "strategy.drift_detected" : "strategy.reviewed", message: review.explanation, details: { decision: review.decision, sentiment: review.sentiment, confidence: review.confidence, eventContext: typeof body === "object" && body !== null && "eventContext" in body ? (body as { eventContext?: unknown }).eventContext : null } });
    return NextResponse.json({ ...review, reviewedAt: new Date().toISOString(), model: connection.model });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "monitor", event: "strategy.review_failed", message: error instanceof Error ? error.message : "Trade review failed." }); } catch { /* Preserve the original review error. */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review the open trade." }, { status: 502 });
  }
}
