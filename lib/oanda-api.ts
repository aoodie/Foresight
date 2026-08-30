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
type OandaPricingPayload = {
  prices?: Array<{
    time?: string;
    tradeable?: boolean;
    status?: string;
    bids?: Array<{ price?: string }>;
    asks?: Array<{ price?: string }>;
    closeoutBid?: string;
    closeoutAsk?: string;
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
  return { bid, ask, mid: (bid + ask) / 2, spread: ask - bid, time: quote.time, tradeable: Boolean(quote.tradeable), marketStatus: quote.status ?? (quote.tradeable ? "tradeable" : "closed") };
}

export async function fetchOandaPrice(args: { token: string; environment: OandaEnvironment; accountId: string; instrument: string }) {
  const payload = await oandaJson<OandaPricingPayload>(
    `https://${hostFor(args.environment)}/v3/accounts/${encodeURIComponent(args.accountId)}/pricing?instruments=${encodeURIComponent(args.instrument)}&includeHomeConversions=false`,
    args.token,
  );
  return normaliseOandaPrice(payload);
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
