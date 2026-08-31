import { NextResponse } from "next/server";
import { fetchOandaAccountSummary, fetchOandaPrice, OandaApiError, submitOandaMarketOrder } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { createJournalEntry, updateJournalEntry, writeSystemLog } from "@/lib/trading-records";
import { getEconomicEventStatus } from "@/lib/economic-calendar";
import { isOwnerRequest } from "@/lib/owner-request";
import { calculateRiskSizedUnits, MAX_ABSOLUTE_UNITS, MAX_RISK_PERCENT, validateProtectedOrder } from "@/lib/trade-risk";

const allowed = new Set(["EUR_USD","GBP_USD","USD_JPY","USD_CHF","AUD_USD","NZD_USD","USD_CAD","EUR_GBP","EUR_JPY","GBP_JPY","XAU_USD","US30_USD"]);

export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { instrument?: string; units?: number; stopLoss?: number | null; takeProfit?: number | null; mode?: "paper" | "live"; confirmLive?: boolean; riskPercent?: number; journal?: Record<string, unknown> } | null;
  if (!body || !allowed.has(body.instrument ?? "") || !Number.isSafeInteger(body.units) || !body.units || Math.abs(body.units) > MAX_ABSOLUTE_UNITS) return NextResponse.json({ error: `Instrument and whole-number units between 1 and ${MAX_ABSOLUTE_UNITS.toLocaleString()} are required.` }, { status: 400 });
  if (!Number.isFinite(body.riskPercent) || body.riskPercent! <= 0 || body.riskPercent! > MAX_RISK_PERCENT) return NextResponse.json({ error: `Risk must be greater than 0% and no more than ${MAX_RISK_PERCENT}%.` }, { status: 400 });
  if (body.mode === "paper") return NextResponse.json({ error: "The internal paper simulator has been removed. Use the OANDA Demo or Live account path." }, { status: 410 });
  if (body.mode !== "live") return NextResponse.json({ error: "The execution mode must be explicitly set to live OANDA execution." }, { status: 400 });
  if (!body.confirmLive) return NextResponse.json({ error: "OANDA execution requires explicit confirmation after reviewing the risk controls." }, { status: 409 });
  const connection = await getOandaToken();
  if (!connection?.accountId) return NextResponse.json({ error: "Connect an OANDA account with an account number first." }, { status: 503 });
  const newsStatus = await getEconomicEventStatus(body.instrument!);
  if (!newsStatus.available) {
    await writeSystemLog({ level: "error", category: "execution", event: "order.blocked_news_unavailable", message: "Order blocked because the high-impact economic calendar could not be verified.", instrument: body.instrument, environment: connection.environment, details: { calendarError: newsStatus.error } });
    return NextResponse.json({ error: "Order blocked: the high-impact economic calendar is unavailable. Try again when the news check is available." }, { status: 503 });
  }
  if (newsStatus.blocked) {
    const event = newsStatus.blockedBy[0];
    await writeSystemLog({ level: "warning", category: "execution", event: "order.blocked_high_impact_news", message: `Order blocked during the high-impact news window for ${event.title}.`, instrument: body.instrument, environment: connection.environment, details: { eventId: event.id, eventDate: event.date, phase: event.phase } });
    return NextResponse.json({ error: `Order blocked for 10 minutes around high-impact news: ${event.title} at ${new Date(event.date).toISOString()}.` }, { status: 409 });
  }
  let account: Awaited<ReturnType<typeof fetchOandaAccountSummary>>;
  let quote: Awaited<ReturnType<typeof fetchOandaPrice>>;
  try {
    [account, quote] = await Promise.all([
      fetchOandaAccountSummary({ token: connection.token, environment: connection.environment, accountId: connection.accountId }),
      fetchOandaPrice({ token: connection.token, environment: connection.environment, accountId: connection.accountId, instrument: body.instrument! }),
    ]);
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to verify the live account and price." }, { status });
  }
  if (!quote.tradeable) return NextResponse.json({ error: "Order blocked because OANDA reports that the instrument is not tradeable." }, { status: 409 });
  const liveEntry = body.units! > 0 ? quote.ask : quote.bid;
  const protection = validateProtectedOrder({ instrument: body.instrument!, units: body.units!, entry: liveEntry, stopLoss: body.stopLoss, takeProfit: body.takeProfit });
  if (!protection.ok) return NextResponse.json({ error: `Order blocked: ${protection.error}` }, { status: 409 });
  const sizing = calculateRiskSizedUnits({ equity: account.equity, riskPercent: body.riskPercent!, stopDistance: protection.stopDistance, lossConversionFactor: quote.homeConversionFactors.negativeUnits });
  if (!sizing) return NextResponse.json({ error: "Order blocked because a safe position size could not be calculated from the live quote." }, { status: 409 });
  if (Math.abs(body.units!) > sizing.units) return NextResponse.json({ error: `Order blocked: ${Math.abs(body.units!).toLocaleString()} units exceeds the live ${body.riskPercent}% risk limit of ${sizing.units.toLocaleString()} units.` }, { status: 409 });
  const journal = body.journal ?? {};
  const correlationId = crypto.randomUUID();
  let journalId: string | null = null;
  let orderSubmitted = false;
  try {
    journalId = await createJournalEntry({
      environment: connection.environment,
      accountId: connection?.accountId ?? null,
      instrument: body.instrument!,
      direction: body.units! > 0 ? "long" : "short",
      style: typeof journal.style === "string" ? journal.style : "intraday",
      strategyName: typeof journal.strategyName === "string" ? journal.strategyName : null,
      setupType: typeof journal.setupType === "string" ? journal.setupType : null,
      status: "submitted",
      entryPrice: liveEntry,
      stopLoss: body.stopLoss ?? null,
      takeProfit1: body.takeProfit ?? null,
      takeProfit2: typeof journal.takeProfit2 === "number" ? journal.takeProfit2 : null,
      units: body.units,
      lots: typeof journal.lots === "number" ? journal.lots : null,
      riskPercent: body.riskPercent ?? null,
      riskAmount: sizing.riskAmount,
      thesis: typeof journal.thesis === "string" ? journal.thesis : null,
      evidence: typeof journal.evidence === "string" ? journal.evidence : null,
      invalidation: typeof journal.invalidation === "string" ? journal.invalidation : null,
      metadata: journal.metadata,
      openedAt: null,
    });
    await writeSystemLog({ category: "execution", event: "order.requested", message: `OANDA ${connection.environment} order requested for ${body.instrument}.`, instrument: body.instrument, environment: connection.environment, correlationId, details: { journalId, units: body.units, stopLoss: body.stopLoss, takeProfit: body.takeProfit } });
    const result = await submitOandaMarketOrder({ token: connection.token, environment: connection.environment, accountId: connection.accountId, instrument: body.instrument!, units: body.units!, stopLoss: body.stopLoss, takeProfit: body.takeProfit, clientExtensions: { id: `foresight-ui-${journalId.slice(0, 24)}`, tag: "foresight-manual", comment: typeof journal.style === "string" ? journal.style.slice(0, 128) : "manual" } });
    orderSubmitted = true;
    const brokerTradeId = result.tradeId;
    const status = brokerTradeId ? "open" : "closed";
    const notes = brokerTradeId
      ? `OANDA ${connection.environment} order filled with broker-side protection.`
      : "OANDA filled the order without opening a new trade; it reduced or closed an existing position.";
    let journalWarning: string | null = null;
    try {
      await updateJournalEntry({ id: journalId, status, brokerTradeId, pnl: brokerTradeId ? null : result.realisedPnl, notes, openedAt: result.fillTime, metadata: { fillTransactionId: result.fillTransactionId, fillPrice: result.fillPrice, fillTime: result.fillTime, reducedTradeId: result.reducedTradeId, closedTradeIds: result.closedTradeIds, riskReward: protection.riskReward } });
      await writeSystemLog({ category: "execution", event: brokerTradeId ? "order.submitted" : "order.netted", message: notes, instrument: body.instrument, environment: connection.environment, correlationId, details: { journalId, brokerTradeId, orderId: result.orderId, fillTransactionId: result.fillTransactionId, units: body.units, riskAmount: sizing.riskAmount, riskReward: protection.riskReward } });
    } catch (error) {
      journalWarning = error instanceof Error ? error.message : "The filled order could not be written to the journal.";
    }
    return NextResponse.json({ mode: "live", accountEnvironment: connection.environment, status: brokerTradeId ? "submitted" : "netted", journalId, journalWarning, ...result });
  } catch (error) {
    if (journalId && !orderSubmitted) {
      try { await updateJournalEntry({ id: journalId, status: "cancelled", notes: error instanceof Error ? error.message : "Order submission failed." }); } catch { /* Preserve the original order error. */ }
    }
    try { await writeSystemLog({ level: "error", category: "execution", event: "order.failed", message: error instanceof Error ? error.message : "Order submission failed.", instrument: body.instrument, environment: connection.environment, correlationId }); } catch { /* Preserve the original order error. */ }
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit order." }, { status });
  }
}
