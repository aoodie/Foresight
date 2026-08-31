import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { createJournalEntry, updateJournalByBrokerTradeId, writeSystemLog } from "@/lib/trading-records";

type RuntimeEnv = { AUTOTRADER_WEBHOOK_SECRET?: string };
const runtime = env as unknown as RuntimeEnv;

function sameSecret(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function stringOrNull(value: unknown) { return typeof value === "string" && value.length <= 4000 ? value : null; }
function numberOrNull(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export async function POST(request: Request) {
  const configuredSecret = runtime.AUTOTRADER_WEBHOOK_SECRET;
  const suppliedSecret = request.headers.get("x-autotrader-secret") ?? "";
  if (!configuredSecret || !sameSecret(suppliedSecret, configuredSecret)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json().catch(() => null) as { type?: string; payload?: Record<string, unknown> } | null;
  if (!body?.type || !body.payload || typeof body.payload !== "object") return NextResponse.json({ error: "Invalid autonomous-worker event." }, { status: 400 });
  const payload = body.payload;
  if (body.type === "log") {
    await writeSystemLog({
      level: payload.level === "warning" || payload.level === "error" ? payload.level : "info",
      category: "autotrader",
      event: stringOrNull(payload.event) ?? "worker.event",
      message: stringOrNull(payload.message) ?? "Autonomous worker event.",
      instrument: stringOrNull(payload.instrument),
      environment: stringOrNull(payload.environment),
      details: payload.details,
    });
    return NextResponse.json({ ok: true });
  }
  if (body.type === "journal.create") {
    const required = ["id", "environment", "accountId", "instrument", "direction", "style"];
    if (!required.every((key) => typeof payload[key] === "string")) return NextResponse.json({ error: "Journal event is missing required fields." }, { status: 400 });
    const id = await createJournalEntry({
      id: String(payload.id), environment: String(payload.environment), accountId: String(payload.accountId), instrument: String(payload.instrument), direction: String(payload.direction), style: String(payload.style),
      strategyName: stringOrNull(payload.strategyName), setupType: stringOrNull(payload.setupType), status: stringOrNull(payload.status) ?? "open", entryPrice: numberOrNull(payload.entryPrice), stopLoss: numberOrNull(payload.stopLoss), takeProfit1: numberOrNull(payload.takeProfit1), takeProfit2: numberOrNull(payload.takeProfit2), units: numberOrNull(payload.units), lots: numberOrNull(payload.lots), riskPercent: numberOrNull(payload.riskPercent), riskAmount: numberOrNull(payload.riskAmount), brokerTradeId: stringOrNull(payload.brokerTradeId), thesis: stringOrNull(payload.thesis), evidence: stringOrNull(payload.evidence), invalidation: stringOrNull(payload.invalidation), metadata: payload.metadata,
    });
    return NextResponse.json({ ok: true, id });
  }
  if (body.type === "journal.update") {
    if (typeof payload.brokerTradeId !== "string" || typeof payload.status !== "string") return NextResponse.json({ error: "Journal update is missing brokerTradeId or status." }, { status: 400 });
    await updateJournalByBrokerTradeId({ brokerTradeId: payload.brokerTradeId, status: payload.status, pnl: numberOrNull(payload.pnl), notes: stringOrNull(payload.notes) });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unsupported autonomous-worker event." }, { status: 400 });
}
