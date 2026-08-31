export type OandaEnvironment = "practice" | "live";

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
      ...(args.clientExtensions ? { clientExtensions: args.clientExtensions } : {}),
      ...(args.stopLoss ? { stopLossOnFill: { price: args.stopLoss.toFixed(args.instrument.endsWith("JPY") ? 3 : 5), timeInForce: "GTC" } } : {}),
      ...(args.takeProfit ? { takeProfitOnFill: { price: args.takeProfit.toFixed(args.instrument.endsWith("JPY") ? 3 : 5), timeInForce: "GTC" } } : {}),
    },
  };
  let response: Response;
  try {
    response = await fetch(`https://${host}/v3/accounts/${encodeURIComponent(args.accountId)}/orders`, {
      method: "POST", headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
  } catch { throw new OandaApiError("OANDA could not be reached. Try again shortly.", 502); }
  const payload = (await response.json().catch(() => ({}))) as { orderFillTransaction?: { id?: string; units?: string; tradeOpened?: { tradeID?: string } }; orderCreateTransaction?: { id?: string }; errorMessage?: string };
  if (!response.ok) throw new OandaApiError(payload.errorMessage || `OANDA order failed (${response.status}).`, response.status);
  return { orderId: payload.orderFillTransaction?.id ?? payload.orderCreateTransaction?.id ?? null, tradeId: payload.orderFillTransaction?.tradeOpened?.tradeID ?? null, units: payload.orderFillTransaction?.units ?? String(args.units) };
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
  const payload = (await response.json().catch(() => ({}))) as { orderFillTransaction?: { id?: string; pl?: string }; errorMessage?: string };
  if (!response.ok) throw new OandaApiError(payload.errorMessage || `OANDA could not close trade (${response.status}).`, response.status);
  return { transactionId: payload.orderFillTransaction?.id ?? null, pnl: Number(payload.orderFillTransaction?.pl ?? 0) };
}

export async function fetchOandaAccountId(token: string, environment: OandaEnvironment) {
  const payload = await oandaJson<OandaAccountsPayload>(`https://${hostFor(environment)}/v3/accounts`, token);
  const accountId = payload.accounts?.find((account) => account.id)?.id;
  if (!accountId) throw new OandaApiError("No OANDA account is available for this token.", 404);
  return accountId;
}

export function normaliseOandaPrice(payload: OandaPricingPayload) {
  const quote = payload.prices?.[0];
  const bid = Number(quote?.bids?.[0]?.price ?? quote?.closeoutBid);
  const ask = Number(quote?.asks?.[0]?.price ?? quote?.closeoutAsk);
  if (!quote?.time || !Number.isFinite(bid) || !Number.isFinite(ask)) throw new OandaApiError("OANDA returned no usable live quote.", 502);
  const positiveUnits = Number(quote.quoteHomeConversionFactors?.positiveUnits);
  const negativeUnits = Number(quote.quoteHomeConversionFactors?.negativeUnits);
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    spread: ask - bid,
    time: quote.time,
    tradeable: Boolean(quote.tradeable),
    marketStatus: quote.status ?? (quote.tradeable ? "tradeable" : "closed"),
    homeConversionFactors: {
      positiveUnits: Number.isFinite(positiveUnits) && positiveUnits > 0 ? positiveUnits : 1,
      negativeUnits: Number.isFinite(negativeUnits) && negativeUnits > 0 ? negativeUnits : 1,
    },
  };
}

export async function fetchOandaPrice(args: { token: string; environment: OandaEnvironment; accountId: string; instrument: string }) {
  const payload = await oandaJson<OandaPricingPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/pricing?instruments=${encodeURIComponent(args.instrument)}&includeHomeConversions=true`,
    args.token,
  );
  return normaliseOandaPrice(payload);
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
      stopLoss: Number.isFinite(Number(trade.stopLossOrder?.price)) ? Number(trade.stopLossOrder?.price) : null,
      takeProfit: Number.isFinite(Number(trade.takeProfitOrder?.price)) ? Number(trade.takeProfitOrder?.price) : null,
    }];
  });
}

type OandaTransactionPayload = {
  transactions?: Array<{
    id?: string;
    type?: string;
    time?: string;
    instrument?: string;
    tradeID?: string;
    pl?: string;
    units?: string;
  }>;
  errorMessage?: string;
};

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
  const payload = await oandaJson<OandaTransactionPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/transactions?${params.toString()}`,
    args.token,
  );
  return (payload.transactions ?? []).flatMap((transaction) => {
    const pnl = Number(transaction.pl ?? 0);
    if (!transaction.id || !transaction.time || !Number.isFinite(pnl)) return [];
    return [{
      id: transaction.id,
      time: transaction.time,
      instrument: transaction.instrument ?? null,
      tradeId: transaction.tradeID ?? null,
      pnl,
      units: Number(transaction.units ?? 0),
    }];
  });
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
