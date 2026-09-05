import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { isOwnerRequest } from "@/lib/owner-request";
import { askPairAnalyst, type PairChatMessage } from "@/lib/pair-chat";
import { writeSystemLog } from "@/lib/trading-records";

const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD", "US30_USD"]);

export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 80_000) return NextResponse.json({ error: "The pair-chat request is too large." }, { status: 413 });
  const body = await request.json().catch(() => null) as { instrument?: unknown; question?: unknown; messages?: unknown; snapshot?: unknown } | null;
  if (!body || typeof body.instrument !== "string" || !allowed.has(body.instrument)) return NextResponse.json({ error: "Choose a supported market first." }, { status: 400 });
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 2_000) return NextResponse.json({ error: "Enter a question of no more than 2,000 characters." }, { status: 400 });
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
  const messages: PairChatMessage[] = rawMessages.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim()) return [];
    return [{ role: item.role, content: item.content.trim().slice(0, 2_000) }];
  });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Connect your LLM provider in Settings first." }, { status: 503 });
  const started = Date.now();
  try {
    const result = await askPairAnalyst({ apiKey: connection.apiKey, model: connection.model, baseUrl: connection.baseUrl, instrument: body.instrument, question, messages, snapshot: body.snapshot ?? null });
    try { await writeSystemLog({ category: "ai", event: "pair_chat.completed", message: `Pair assistant answered a question about ${body.instrument}.`, instrument: body.instrument, durationMs: Date.now() - started, details: { model: connection.model, baseUrl: connection.baseUrl, responseId: result.responseId, usage: result.usage, historyLength: messages.length } }); } catch { /* A log failure must not discard a valid answer. */ }
    return NextResponse.json({ answer: result.answer, model: connection.model, generatedAt: new Date().toISOString() });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "ai", event: "pair_chat.failed", message: error instanceof Error ? error.message : "Pair chat failed.", instrument: body.instrument, durationMs: Date.now() - started }); } catch { /* Preserve the original error. */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to answer this pair question." }, { status: 502 });
  }
}
