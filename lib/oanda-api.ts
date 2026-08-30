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
  candles?: Array<{
    time?: string;
    complete?: boolean;
    mid?: { o?: string; h?: string; l?: string; c?: string };
  }>;
  errorMessage?: string;
};

export class OandaApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function normaliseOandaPayload(payload: OandaCandlePayload) {
  const candles: NormalisedCandle[] = (payload.candles ?? [])
    .filter((c) => c.time && c.mid?.o && c.mid?.h && c.mid?.l && c.mid?.c)
    .map((c) => ({
      time: c.time!,
      open: Number(c.mid!.o),
      high: Number(c.mid!.h),
      low: Number(c.mid!.l),
      close: Number(c.mid!.c),
      complete: Boolean(c.complete),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));

  if (!candles.length) throw new OandaApiError("OANDA returned no usable candles.", 502);
  const first = candles[0].close;
  const price = candles.at(-1)!.close;
  return {
    candles,
    price,
    changePercent: first ? ((price - first) / first) * 100 : 0,
    lastUpdated: candles.at(-1)!.time,
  };
}

export async function fetchOandaCandles(args: {
  token: string;
  environment: OandaEnvironment;
  instrument: string;
  granularity: string;
  count?: number;
}) {
  const host = args.environment === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
  let response: Response;
  try {
    response = await fetch(
      `https://${host}/v3/instruments/${args.instrument}/candles?count=${args.count ?? 120}&granularity=${args.granularity}&price=M`,
      { headers: { Authorization: `Bearer ${args.token}` }, cache: "no-store" },
    );
  } catch {
    throw new OandaApiError("OANDA could not be reached. Try again shortly.", 502);
  }

  const payload = (await response.json().catch(() => ({}))) as OandaCandlePayload;
  if (!response.ok) {
    const message = response.status === 401
      ? `OANDA rejected this token for the ${args.environment} environment. Check the token and account type.`
      : payload.errorMessage || `OANDA request failed (${response.status}).`;
    throw new OandaApiError(message, response.status);
  }
  return normaliseOandaPayload(payload);
}
