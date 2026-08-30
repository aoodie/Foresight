import { NextResponse } from "next/server";
import { OandaApiError, submitOandaMarketOrder } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { createJournalEntry, updateJournalEntry, writeSystemLog } from "@/lib/trading-records";

const allowed = new Set(["EUR_USD","GBP_USD","USD_JPY","USD_CHF","AUD_USD","NZD_USD","USD_CAD","EUR_GBP","EUR_JPY","GBP_JPY","XAU_USD","US30_USD"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { instrument?: string; units?: number; stopLoss?: number | null; takeProfit?: number | null; mode?: "paper" | "live"; confirmLive?: boolean; riskPercent?: number; journal?: Record<string, unknown> } | null;
  if (!body || !allowed.has(body.instrument ?? "") || !Number.isFinite(body.units) || !body.units) return NextResponse.json({ error: "Instrument and non-zero units are required." }, { status: 400 });
  if (body.mode === "paper") return NextResponse.json({ error: "The internal paper simulator has been removed. Use the OANDA Demo or Live account path." }, { status: 410 });
  if (!body.confirmLive) return NextResponse.json({ error: "OANDA execution requires explicit confirmation after reviewing the risk controls." }, { status: 409 });
  const connection = await getOandaToken();
  if (!connection?.accountId) return NextResponse.json({ error: "Connect an OANDA account with an account number first." }, { status: 503 });
  const journal = body.journal ?? {};
  const correlationId = crypto.randomUUID();
  try {
    const journalId = await createJournalEntry({
      environment: connection.environment,
      accountId: connection?.accountId ?? null,
      instrument: body.instrument!,
      direction: body.units! > 0 ? "long" : "short",
      style: typeof journal.style === "string" ? journal.style : "intraday",
      strategyName: typeof journal.strategyName === "string" ? journal.strategyName : null,
      setupType: typeof journal.setupType === "string" ? journal.setupType : null,
      status: "submitted",
      entryPrice: typeof journal.entryPrice === "number" ? journal.entryPrice : null,
      stopLoss: body.stopLoss ?? null,
      takeProfit1: body.takeProfit ?? null,
      takeProfit2: typeof journal.takeProfit2 === "number" ? journal.takeProfit2 : null,
      units: body.units,
      lots: typeof journal.lots === "number" ? journal.lots : null,
      riskPercent: body.riskPercent ?? null,
      riskAmount: typeof journal.riskAmount === "number" ? journal.riskAmount : null,
      thesis: typeof journal.thesis === "string" ? journal.thesis : null,
      evidence: typeof journal.evidence === "string" ? journal.evidence : null,
      invalidation: typeof journal.invalidation === "string" ? journal.invalidation : null,
      metadata: journal.metadata,
      openedAt: null,
    });
    await writeSystemLog({ category: "execution", event: "order.requested", message: `OANDA ${connection.environment} order requested for ${body.instrument}.`, instrument: body.instrument, environment: connection.environment, correlationId, details: { journalId, units: body.units, stopLoss: body.stopLoss, takeProfit: body.takeProfit } });
    const result = await submitOandaMarketOrder({ token: connection.token, environment: connection.environment, accountId: connection.accountId, instrument: body.instrument!, units: body.units!, stopLoss: body.stopLoss, takeProfit: body.takeProfit });
    await updateJournalEntry({ id: journalId, status: "open", brokerTradeId: result.orderId, notes: `OANDA ${connection.environment} order submitted.` });
    await writeSystemLog({ category: "execution", event: "order.submitted", message: `OANDA ${connection.environment} order submitted for ${body.instrument}.`, instrument: body.instrument, environment: connection.environment, correlationId, details: { journalId, brokerTradeId: result.orderId, units: body.units } });
    return NextResponse.json({ mode: "live", accountEnvironment: connection.environment, status: "submitted", journalId, ...result });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "execution", event: "order.failed", message: error instanceof Error ? error.message : "Order submission failed.", instrument: body.instrument, environment: connection.environment, correlationId }); } catch { /* Preserve the original order error. */ }
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit order." }, { status });
  }
}
