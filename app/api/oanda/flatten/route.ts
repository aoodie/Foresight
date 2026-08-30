import { NextResponse } from "next/server";
import { closeOandaTrade, fetchOandaOpenTrades, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { updateJournalByBrokerTradeId, writeSystemLog } from "@/lib/trading-records";

const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD", "US30_USD"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { scope?: "selected" | "all"; instrument?: string; confirm?: boolean } | null;
  if (!body?.confirm) return NextResponse.json({ error: "Flattening is locked. Confirm the close action explicitly." }, { status: 409 });
  if (body.scope === "selected" && !allowed.has(body.instrument ?? "")) return NextResponse.json({ error: "Select a supported instrument to flatten." }, { status: 400 });
  const connection = await getOandaToken();
  if (!connection?.accountId) return NextResponse.json({ error: "Connect an OANDA account with an account number first." }, { status: 503 });
  if (connection.environment !== "live") return NextResponse.json({ error: "Flattening requires an OANDA Live account connection. Change the account environment in Settings first." }, { status: 409 });
  const correlationId = crypto.randomUUID();
  try {
    const trades = await fetchOandaOpenTrades({ token: connection.token, environment: "live", accountId: connection.accountId });
    const selected = body.scope === "selected" ? trades.filter((trade) => trade.instrument === body.instrument) : trades;
    if (!selected.length) return NextResponse.json({ status: "no_open_trades", closed: 0 });
    await writeSystemLog({ level: "warning", category: "execution", event: "flatten.requested", message: `${body.scope === "all" ? "All open trades" : body.instrument} flatten requested.`, environment: "live", instrument: body.instrument ?? null, correlationId, details: { tradeIds: selected.map((trade) => trade.id) } });
    const results = [];
    for (const trade of selected) {
      try {
        const closed = await closeOandaTrade({ token: connection.token, environment: "live", accountId: connection.accountId, tradeId: trade.id });
        await updateJournalByBrokerTradeId({ brokerTradeId: trade.id, status: "closed", pnl: closed.pnl, notes: "Flattened from Foresight FX." });
        results.push({ id: trade.id, instrument: trade.instrument, status: "closed", pnl: closed.pnl });
      } catch (error) {
        results.push({ id: trade.id, instrument: trade.instrument, status: "failed", error: error instanceof Error ? error.message : "Unable to close trade." });
      }
    }
    const closed = results.filter((result) => result.status === "closed").length;
    await writeSystemLog({ level: closed === selected.length ? "warning" : "error", category: "execution", event: "flatten.completed", message: `Flatten completed: ${closed}/${selected.length} trade(s) closed.`, environment: "live", instrument: body.instrument ?? null, correlationId, details: { results } });
    return NextResponse.json({ status: closed === selected.length ? "closed" : "partial", closed, requested: selected.length, results });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "execution", event: "flatten.failed", message: error instanceof Error ? error.message : "Flatten failed.", environment: "live", instrument: body.instrument ?? null, correlationId }); } catch { /* Preserve the original broker error. */ }
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to flatten open trades." }, { status });
  }
}
