import { NextResponse } from "next/server";
import { closeOandaTrade, fetchOandaOpenTrades, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { updateJournalByBrokerTradeId, writeSystemLog } from "@/lib/trading-records";
import { isOwnerRequest } from "@/lib/owner-request";

const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD", "US30_USD"]);

export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json().catch(() => null) as { scope?: "selected" | "all"; instrument?: string; confirm?: boolean } | null;
  if (!body?.confirm) return NextResponse.json({ error: "Flattening is locked. Confirm the close action explicitly." }, { status: 409 });
  if (body.scope !== "selected" && body.scope !== "all") return NextResponse.json({ error: "Choose whether to close the selected instrument or all trades." }, { status: 400 });
  if (body.scope === "selected" && !allowed.has(body.instrument ?? "")) return NextResponse.json({ error: "Select a supported instrument to flatten." }, { status: 400 });
  const connection = await getOandaToken();
  if (!connection?.accountId) return NextResponse.json({ error: "Connect an OANDA account with an account number first." }, { status: 503 });
  const accountEnvironment = connection.environment;
  const correlationId = crypto.randomUUID();
  try {
    const trades = await fetchOandaOpenTrades({ token: connection.token, environment: accountEnvironment, accountId: connection.accountId });
    const selected = body.scope === "selected" ? trades.filter((trade) => trade.instrument === body.instrument) : trades;
    if (!selected.length) return NextResponse.json({ status: "no_open_trades", closed: 0 });
    await writeSystemLog({ level: "warning", category: "execution", event: "flatten.requested", message: `${body.scope === "all" ? "All open trades" : body.instrument} flatten requested.`, environment: accountEnvironment, instrument: body.instrument ?? null, correlationId, details: { tradeIds: selected.map((trade) => trade.id) } });
    const results = [];
    for (const trade of selected) {
      try {
        const closed = await closeOandaTrade({ token: connection.token, environment: accountEnvironment, accountId: connection.accountId, tradeId: trade.id });
        let journalWarning: string | null = null;
        try {
          await updateJournalByBrokerTradeId({ brokerTradeId: trade.id, status: "closed", pnl: closed.pnl, notes: "Manual close from Foresight FX.", closedAt: closed.closeTime, metadata: { closeReason: "MANUAL", closePrice: Number.isFinite(closed.price) ? closed.price : null, closeTransactionId: closed.transactionId, closeTime: closed.closeTime } });
        } catch (error) {
          journalWarning = error instanceof Error ? error.message : "The closed trade could not be updated in the journal.";
        }
        results.push({ id: trade.id, instrument: trade.instrument, status: "closed", pnl: closed.pnl, journalWarning });
      } catch (error) {
        results.push({ id: trade.id, instrument: trade.instrument, status: "failed", error: error instanceof Error ? error.message : "Unable to close trade." });
      }
    }
    const closed = results.filter((result) => result.status === "closed").length;
    await writeSystemLog({ level: closed === selected.length ? "warning" : "error", category: "execution", event: "flatten.completed", message: `Flatten completed: ${closed}/${selected.length} trade(s) closed.`, environment: accountEnvironment, instrument: body.instrument ?? null, correlationId, details: { results } });
    return NextResponse.json({ status: closed === selected.length ? "closed" : "partial", accountEnvironment, closed, requested: selected.length, results });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "execution", event: "flatten.failed", message: error instanceof Error ? error.message : "Flatten failed.", environment: accountEnvironment, instrument: body.instrument ?? null, correlationId }); } catch { /* Preserve the original broker error. */ }
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to flatten open trades." }, { status });
  }
}
