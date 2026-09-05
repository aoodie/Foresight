import { journalInsights } from "@/lib/journal-context";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { backfillJournalLifecycleEvents, createJournalEntry, reconcileJournalFromBrokerSnapshot, updateJournalEntry } from "@/lib/trading-records";
import { getOandaToken } from "@/lib/oanda-secret";
import { fetchOandaOpenTrades, fetchOandaOrderFills } from "@/lib/oanda-api";
import { env } from "cloudflare:workers";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }
const runtime = env as unknown as { DB: D1Database };

export async function GET(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100) || 100));
  let reconciliation: Awaited<ReturnType<typeof reconcileJournalFromBrokerSnapshot>> | null = null;
  let reconciliationError: string | null = null;
  if (searchParams.get("reconcile") === "1") {
    try {
      const connection = await getOandaToken();
      if (!connection?.accountId) throw new Error("OANDA is not connected, so broker reconciliation was skipped.");
      const [openTrades, fills] = await Promise.all([
        fetchOandaOpenTrades({ token: connection.token, environment: connection.environment, accountId: connection.accountId }),
        fetchOandaOrderFills({ token: connection.token, environment: connection.environment, accountId: connection.accountId, from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) }),
      ]);
      reconciliation = await reconcileJournalFromBrokerSnapshot({ openTrades, fills, environment: connection.environment, accountId: connection.accountId });
    } catch (error) {
      reconciliationError = error instanceof Error ? error.message : "Broker reconciliation failed.";
    }
  }
  const lifecycleBackfilled = await backfillJournalLifecycleEvents(limit);
  const [rows, eventCount] = await Promise.all([
    runtime.DB.prepare("SELECT j.*, c.context_json FROM trade_journal j LEFT JOIN trade_entry_context c ON c.journal_id = j.id ORDER BY COALESCE(j.opened_at, j.created_at) DESC LIMIT ?").bind(limit).all(),
    runtime.DB.prepare("SELECT COUNT(*) AS count FROM trade_journal_events").first<{ count: number }>(),
  ]);
  return NextResponse.json({ entries: (rows.results ?? []).map((row) => ({ ...row, ...journalInsights(row as Record<string, unknown>) })), reconciliation, reconciliationError, lifecycleBackfilled, lifecycleEventCount: Number(eventCount?.count ?? 0) });
}

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.instrument !== "string" || typeof body.direction !== "string" || typeof body.style !== "string") return NextResponse.json({ error: "Instrument, direction and trading style are required." }, { status: 400 });
  try {
    const id = await createJournalEntry({
      environment: body.environment === "live" || body.environment === "practice" ? body.environment : (await getOandaToken())?.environment ?? "practice",
      accountId: typeof body.accountId === "string" ? body.accountId : null,
      instrument: body.instrument, direction: body.direction, style: body.style,
      strategyName: typeof body.strategyName === "string" ? body.strategyName : null,
      setupType: typeof body.setupType === "string" ? body.setupType : null,
      status: typeof body.status === "string" ? body.status : "planned",
      entryPrice: typeof body.entryPrice === "number" ? body.entryPrice : null,
      stopLoss: typeof body.stopLoss === "number" ? body.stopLoss : null,
      takeProfit1: typeof body.takeProfit1 === "number" ? body.takeProfit1 : null,
      takeProfit2: typeof body.takeProfit2 === "number" ? body.takeProfit2 : null,
      units: typeof body.units === "number" ? body.units : null,
      lots: typeof body.lots === "number" ? body.lots : null,
      riskPercent: typeof body.riskPercent === "number" ? body.riskPercent : null,
      riskAmount: typeof body.riskAmount === "number" ? body.riskAmount : null,
      pnl: typeof body.pnl === "number" ? body.pnl : null,
      thesis: typeof body.thesis === "string" ? body.thesis : null,
      evidence: typeof body.evidence === "string" ? body.evidence : null,
      invalidation: typeof body.invalidation === "string" ? body.invalidation : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      openedAt: typeof body.openedAt === "string" ? body.openedAt : null,
      closedAt: typeof body.closedAt === "string" ? body.closedAt : null,
      metadata: body.metadata,
    });
    return NextResponse.json({ id, status: "created" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save journal entry." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "Journal entry ID is required." }, { status: 400 });
  try {
    await updateJournalEntry({
      id: body.id,
      status: typeof body.status === "string" ? body.status : undefined,
      pnl: typeof body.pnl === "number" ? body.pnl : null,
      brokerTradeId: typeof body.brokerTradeId === "string" ? body.brokerTradeId : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      closedAt: typeof body.closedAt === "string" ? body.closedAt : null,
    });
    return NextResponse.json({ status: "updated" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update journal entry." }, { status: 503 });
  }
}
