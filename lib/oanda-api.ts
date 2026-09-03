export type OandaEnvironment = "practice" | "live";

import { instrumentPricePrecision } from "./trade-risk.ts";

export type NormalisedCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  complete: boolean;
};

type OandaCandlePayload = {
  candles?: Array<{ time?: string; complete?: boolean; mid?: { o?: string; h?: string; l?: string; c?: string } }>;
  errorMessage?: string;
};
type OandaAccountsPayload = { accounts?: Array<{ id?: string }>; errorMessage?: string };
type OandaAccountSummaryPayload = {
  account?: {
    id?: string;
    currency?: string;
    balance?: string;
    NAV?: string;
    marginAvailable?: string;
    openTradeCount?: number;
    openPositionCount?: number;
  };
  errorMessage?: string;
};
type OandaPricingPayload = {
  prices?: Array<{
    time?: string;
    tradeable?: boolean;
    status?: string;
    bids?: Array<{ price?: string }>;
    asks?: Array<{ price?: string }>;
    closeoutBid?: string;
    closeoutAsk?: string;
    quoteHomeConversionFactors?: { positiveUnits?: string; negativeUnits?: string };
  }>;
  homeConversions?: Array<{ currency?: string; accountGain?: string; accountLoss?: string }>;
  errorMessage?: string;
};

export class OandaApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function hostFor(environment: OandaEnvironment) {
  return environment === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
}

async function oandaJson<T>(url: string, token: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new OandaApiError("OANDA could not be reached. Try again shortly.", 502);
  }
  const payload = (await response.json().catch(() => ({}))) as T & { errorMessage?: string };
  if (!response.ok) {
    const message = response.status === 401
      ? "OANDA rejected this token. Check the selected environment and token."
      : payload.errorMessage || `OANDA request failed (${response.status}).`;
    throw new OandaApiError(message, response.status);
  }
  return payload;
}

export async function submitOandaMarketOrder(args: {
  token: string; environment: OandaEnvironment; accountId: string; instrument: string;
  units: number; stopLoss?: number | null; takeProfit?: number | null;
  clientExtensions?: { id?: string; tag?: string; comment?: string };
}) {
  const host = hostFor(args.environment);
  const body = {
    order: {
      type: "MARKET", instrument: args.instrument, units: String(args.units),
      timeInForce: "FOK", positionFill: "DEFAULT",
      ...(args.clientExtensions ? {
        clientExtensions: args.clientExtensions,
        tradeClientExtensions: args.clientExtensions,
      } : {}),
      ...(args.stopLoss ? { stopLossOnFill: { price: args.stopLoss.toFixed(instrumentPricePrecision(args.instrument)), timeInForce: "GTC" } } : {}),
      ...(args.takeProfit ? { takeProfitOnFill: { price: args.takeProfit.toFixed(instrumentPricePrecision(args.instrument)), timeInForce: "GTC" } } : {}),
    },
  };
  let response: Response;
  try {
    response = await fetch(`https://${host}/v3/accounts/${encodeURIComponent(args.accountId)}/orders`, {
      method: "POST", headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
  } catch { throw new OandaApiError("OANDA could not be reached. Try again shortly.", 502); }
  const payload = (await response.json().catch(() => ({}))) as {
    orderFillTransaction?: {
      id?: string; time?: string; units?: string; price?: string; pl?: string; reason?: string;
      tradeOpened?: { tradeID?: string };
      tradeReduced?: { tradeID?: string; realizedPL?: string };
      tradesClosed?: Array<{ tradeID?: string; realizedPL?: string }>;
    };
    orderCreateTransaction?: { id?: string };
    errorMessage?: string;
  };
  if (!response.ok) throw new OandaApiError(payload.errorMessage || `OANDA order failed (${response.status}).`, response.status);
  const fill = payload.orderFillTransaction;
  const fillPrice = Number(fill?.price);
  const realisedPnl = Number(fill?.pl ?? fill?.tradeReduced?.realizedPL ?? 0) +
    (fill?.tradesClosed ?? []).reduce((sum, trade) => sum + Number(trade.realizedPL ?? 0), 0);
  return {
    orderId: payload.orderCreateTransaction?.id ?? null,
    fillTransactionId: fill?.id ?? null,
    tradeId: fill?.tradeOpened?.tradeID ?? null,
    reducedTradeId: fill?.tradeReduced?.tradeID ?? null,
    closedTradeIds: (fill?.tradesClosed ?? []).flatMap((trade) => trade.tradeID ? [trade.tradeID] : []),
    units: fill?.units ?? String(args.units),
    fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
    fillTime: fill?.time ?? null,
    realisedPnl: Number.isFinite(realisedPnl) ? realisedPnl : 0,
    reason: fill?.reason ?? null,
  };
}

export async function closeOandaTrade(args: { token: string; environment: OandaEnvironment; accountId: string; tradeId: string }) {
  const host = hostFor(args.environment);
  let response: Response;
  try {
    response = await fetch(`https://${host}/v3/accounts/${encodeURIComponent(args.accountId)}/trades/${encodeURIComponent(args.tradeId)}/close`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ units: "ALL" }),
      cache: "no-store",
    });
  } catch { throw new OandaApiError("OANDA could not be reached. Try again shortly.", 502); }
  const payload = (await response.json().catch(() => ({}))) as { orderFillTransaction?: { id?: string; time?: string; pl?: string; price?: string; reason?: string }; errorMessage?: string };
  if (!response.ok) throw new OandaApiError(payload.errorMessage || `OANDA could not close trade (${response.status}).`, response.status);
  return { transactionId: payload.orderFillTransaction?.id ?? null, closeTime: payload.orderFillTransaction?.time ?? null, pnl: Number(payload.orderFillTransaction?.pl ?? 0), price: Number(payload.orderFillTransaction?.price ?? NaN), reason: payload.orderFillTransaction?.reason ?? null };
}

export async function fetchOandaAccountId(token: string, environment: OandaEnvironment) {
  const payload = await oandaJson<OandaAccountsPayload>(`https://${hostFor(environment)}/v3/accounts`, token);
  const accountId = payload.accounts?.find((account) => account.id)?.id;
  if (!accountId) throw new OandaApiError("No OANDA account is available for this token.", 404);
  return accountId;
}

export function normaliseOandaPrice(payload: OandaPricingPayload, instrument?: string) {
  const quote = payload.prices?.[0];
  const bid = Number(quote?.bids?.[0]?.price ?? quote?.closeoutBid);
  const ask = Number(quote?.asks?.[0]?.price ?? quote?.closeoutAsk);
  if (!quote?.time || !Number.isFinite(bid) || !Number.isFinite(ask)) throw new OandaApiError("OANDA returned no usable live quote.", 502);
  const quoteCurrency = instrument?.split("_").at(-1);
  const homeConversion = quoteCurrency ? payload.homeConversions?.find((item) => item.currency === quoteCurrency) : null;
  const positiveUnits = Number(quote.quoteHomeConversionFactors?.positiveUnits ?? homeConversion?.accountGain);
  const negativeUnits = Number(quote.quoteHomeConversionFactors?.negativeUnits ?? homeConversion?.accountLoss);
  if (!Number.isFinite(positiveUnits) || positiveUnits <= 0 || !Number.isFinite(negativeUnits) || negativeUnits <= 0) {
    throw new OandaApiError("OANDA returned no usable home-currency conversion factors.", 502);
  }
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    spread: ask - bid,
    time: quote.time,
    tradeable: Boolean(quote.tradeable),
    marketStatus: quote.status ?? (quote.tradeable ? "tradeable" : "closed"),
    homeConversionFactors: {
      positiveUnits,
      negativeUnits,
    },
  };
}

export async function fetchOandaPrice(args: { token: string; environment: OandaEnvironment; accountId: string; instrument: string }) {
  const payload = await oandaJson<OandaPricingPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/pricing?instruments=${encodeURIComponent(args.instrument)}&includeHomeConversions=true`,
    args.token,
  );
  return normaliseOandaPrice(payload, args.instrument);
}

export async function fetchOandaAccountSummary(args: { token: string; environment: OandaEnvironment; accountId: string }) {
  const payload = await oandaJson<OandaAccountSummaryPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/summary`,
    args.token,
  );
  const account = payload.account;
  const balance = Number(account?.balance);
  const nav = Number(account?.NAV);
  const marginAvailable = Number(account?.marginAvailable);
  if (!account?.id || !account.currency || !Number.isFinite(balance) || !Number.isFinite(nav)) {
    throw new OandaApiError("OANDA returned no usable account summary.", 502);
  }
  return {
    accountId: account.id,
    currency: account.currency,
    balance,
    equity: nav,
    marginAvailable: Number.isFinite(marginAvailable) ? marginAvailable : null,
    openTradeCount: account.openTradeCount ?? 0,
    openPositionCount: account.openPositionCount ?? 0,
  };
}

type OandaOpenTradesPayload = {
  trades?: Array<{
    id?: string;
    instrument?: string;
    price?: string;
    openTime?: string;
    currentUnits?: string;
    initialUnits?: string;
    unrealizedPL?: string;
    clientExtensions?: { id?: string; tag?: string; comment?: string };
    stopLossOrder?: { price?: string };
    takeProfitOrder?: { price?: string };
  }>;
  errorMessage?: string;
};

export async function fetchOandaOpenTrades(args: { token: string; environment: OandaEnvironment; accountId: string }) {
  const payload = await oandaJson<OandaOpenTradesPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/openTrades`,
    args.token,
  );
  return (payload.trades ?? []).flatMap((trade) => {
    const price = Number(trade.price);
    const units = Number(trade.currentUnits ?? trade.initialUnits);
    if (!trade.id || !trade.instrument || !Number.isFinite(price) || !Number.isFinite(units)) return [];
    return [{
      id: trade.id,
      instrument: trade.instrument,
      price,
      openTime: trade.openTime ?? null,
      units,
      unrealizedPL: Number(trade.unrealizedPL ?? 0),
      clientId: trade.clientExtensions?.id ?? null,
      clientTag: trade.clientExtensions?.tag ?? null,
      clientComment: trade.clientExtensions?.comment ?? null,
      stopLoss: Number.isFinite(Number(trade.stopLossOrder?.price)) ? Number(trade.stopLossOrder?.price) : null,
      takeProfit: Number.isFinite(Number(trade.takeProfitOrder?.price)) ? Number(trade.takeProfitOrder?.price) : null,
    }];
  });
}

type OandaTradeDetailsPayload = {
  trade?: {
    id?: string;
    instrument?: string;
    state?: string;
    realizedPL?: string;
    closeTime?: string;
    averageClosePrice?: string;
    closingTransactionIDs?: string[];
  };
  errorMessage?: string;
};

export async function fetchOandaTradeDetails(args: { token: string; environment: OandaEnvironment; accountId: string; tradeId: string }) {
  const payload = await oandaJson<OandaTradeDetailsPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/trades/${encodeURIComponent(args.tradeId)}`,
    args.token,
  );
  const trade = payload.trade;
  const pnl = Number(trade?.realizedPL);
  const closePrice = Number(trade?.averageClosePrice);
  if (!trade?.id || !trade.instrument || !trade.state) throw new OandaApiError("OANDA returned no usable trade details.", 502);
  return {
    id: trade.id,
    instrument: trade.instrument,
    state: trade.state,
    pnl: Number.isFinite(pnl) ? pnl : null,
    closeTime: trade.closeTime ?? null,
    closePrice: Number.isFinite(closePrice) ? closePrice : null,
    closingTransactionIds: trade.closingTransactionIDs ?? [],
  };
}

type OandaTransactionPayload = {
  count?: number;
  pages?: string[];
  transactions?: Array<{
    id?: string;
    type?: string;
    time?: string;
    instrument?: string;
    tradeID?: string;
    orderID?: string;
    clientOrderID?: string;
    pl?: string;
    units?: string;
    price?: string;
    reason?: string;
    tradeOpened?: {
      tradeID?: string;
      units?: string;
      price?: string;
    };
    tradeReduced?: { tradeID?: string; realizedPL?: string };
    tradeClosed?: { tradeID?: string; realizedPL?: string };
    tradesClosed?: Array<{ tradeID?: string; realizedPL?: string }>;
  }>;
  errorMessage?: string;
};

function closeReasonFor(reason: string | null) {
  if (reason === "TAKE_PROFIT_ORDER") return "TP";
  if (reason === "STOP_LOSS_ORDER") return "SL";
  if (reason === "TRAILING_STOP_LOSS_ORDER") return "TRAILING_STOP";
  if (reason === "MARKET_ORDER_TRADE_CLOSE" || reason === "CLIENT_REQUEST") return "MANUAL";
  return "BROKER";
}

export function normaliseOandaOrderFills(transactions: NonNullable<OandaTransactionPayload["transactions"]>) {
  return transactions.flatMap((transaction) => {
    const pnl = Number(transaction.pl ?? 0);
    if (!transaction.id || !transaction.time || !Number.isFinite(pnl)) return [];
    const openedTradeId = transaction.tradeOpened?.tradeID ?? null;
    const tradeIds = [...new Set([
      transaction.tradeID,
      openedTradeId,
      transaction.tradeReduced?.tradeID,
      transaction.tradeClosed?.tradeID,
      ...(transaction.tradesClosed ?? []).map((trade) => trade.tradeID),
    ].filter((value): value is string => Boolean(value)))];
    const isEntry = Boolean(openedTradeId);
    const isClose = Boolean(transaction.tradeReduced?.tradeID || transaction.tradeClosed?.tradeID || transaction.tradesClosed?.length);
    const reason = transaction.reason ?? null;
    const price = Number(transaction.price ?? transaction.tradeOpened?.price);
    const units = Number(transaction.tradeOpened?.units ?? transaction.units ?? 0);
    const pnlByTradeId: Record<string, number> = {};
    if (transaction.tradeReduced?.tradeID) pnlByTradeId[transaction.tradeReduced.tradeID] = Number(transaction.tradeReduced.realizedPL ?? 0);
    if (transaction.tradeClosed?.tradeID) pnlByTradeId[transaction.tradeClosed.tradeID] = Number(transaction.tradeClosed.realizedPL ?? 0);
    for (const trade of transaction.tradesClosed ?? []) if (trade.tradeID) pnlByTradeId[trade.tradeID] = Number(trade.realizedPL ?? 0);
    for (const [tradeId, value] of Object.entries(pnlByTradeId)) if (!Number.isFinite(value)) delete pnlByTradeId[tradeId];
    return [{
      id: transaction.id,
      time: transaction.time,
      instrument: transaction.instrument ?? null,
      tradeId: tradeIds[0] ?? null,
      openedTradeId,
      tradeIds,
      pnlByTradeId,
      pnl,
      units: Number.isFinite(units) ? units : 0,
      price: Number.isFinite(price) ? price : null,
      reason,
      closeReason: isClose ? closeReasonFor(reason) : null,
      isEntry,
      isClose,
      clientId: transaction.clientOrderID ?? null,
      // OANDA's historical ORDER_FILL schema carries clientOrderID but not the
      // original extension tag/comment. Source inference uses the ID prefix.
      clientTag: null,
      clientComment: null,
    }];
  });
}

export async function fetchOandaOrderFills(args: {
  token: string;
  environment: OandaEnvironment;
  accountId: string;
  from: Date;
  to?: Date;
}) {
  const params = new URLSearchParams({
    from: args.from.toISOString(),
    to: (args.to ?? new Date()).toISOString(),
    type: "ORDER_FILL",
    pageSize: "1000",
  });
  const host = hostFor(args.environment);
  const payload = await oandaJson<OandaTransactionPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/transactions?${params.toString()}`,
    args.token,
  );
  const pages = payload.pages ?? [];
  if (pages.length > 50) throw new OandaApiError("OANDA transaction history is too large to reconcile safely in one request.", 413);
  const pagePayloads: OandaTransactionPayload[] = [];
  for (const page of pages) {
    let url: URL;
    try { url = new URL(page); } catch { throw new OandaApiError("OANDA returned an invalid transaction page URL.", 502); }
    const expectedPrefix = `/v3/accounts/${encodeURIComponent(args.accountId)}/transactions/idrange`;
    if (url.protocol !== "https:" || url.hostname !== host || url.pathname !== expectedPrefix) {
      throw new OandaApiError("OANDA returned an unexpected transaction page URL.", 502);
    }
    url.searchParams.set("type", "ORDER_FILL");
    pagePayloads.push(await oandaJson<OandaTransactionPayload>(url.toString(), args.token));
  }
  const transactions = [
    ...(payload.transactions ?? []),
    ...pagePayloads.flatMap((page) => page.transactions ?? []),
  ];
  return normaliseOandaOrderFills(transactions);
}

export function normaliseOandaPayload(payload: OandaCandlePayload) {
  const candles: NormalisedCandle[] = (payload.candles ?? [])
    .filter((c) => c.time && c.mid?.o && c.mid?.h && c.mid?.l && c.mid?.c)
    .map((c) => ({ time: c.time!, open: Number(c.mid!.o), high: Number(c.mid!.h), low: Number(c.mid!.l), close: Number(c.mid!.c), complete: Boolean(c.complete) }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));
  if (!candles.length) throw new OandaApiError("OANDA returned no usable candles.", 502);
  const first = candles[0].close;
  const price = candles.at(-1)!.close;
  return { candles, price, changePercent: first ? ((price - first) / first) * 100 : 0, lastUpdated: candles.at(-1)!.time };
}

export async function fetchOandaCandles(args: { token: string; environment: OandaEnvironment; instrument: string; granularity: string; count?: number }) {
  const payload = await oandaJson<OandaCandlePayload>(
    `https://${hostFor(args.environment)}/v3/instruments/${args.instrument}/candles?count=${args.count ?? 120}&granularity=${args.granularity}&price=M`,
    args.token,
  );
  return normaliseOandaPayload(payload);
}
