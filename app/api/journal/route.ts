import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createJournalEntry, updateJournalEntry } from "@/lib/trading-records";
import { env } from "cloudflare:workers";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }
const runtime = env as unknown as { DB: D1Database };

export async function GET(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 100) || 100));
  const rows = await runtime.DB.prepare("SELECT * FROM trade_journal ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return NextResponse.json({ entries: rows.results ?? [] });
}

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.instrument !== "string" || typeof body.direction !== "string" || typeof body.style !== "string") return NextResponse.json({ error: "Instrument, direction and trading style are required." }, { status: 400 });
  try {
    const id = await createJournalEntry({
      environment: typeof body.environment === "string" ? body.environment : "paper",
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
