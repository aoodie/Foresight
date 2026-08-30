const countries = "US,EU,GB,JP,CH,CA,AU,NZ";
const preEventMinutes = 10;
const postEventMinutes = 10;

const currencyMap: Record<string, string[]> = {
  EUR_USD: ["EUR", "USD"],
  GBP_USD: ["GBP", "USD"],
  USD_JPY: ["USD", "JPY"],
  USD_CHF: ["USD", "CHF"],
  AUD_USD: ["AUD", "USD"],
  NZD_USD: ["NZD", "USD"],
  USD_CAD: ["USD", "CAD"],
  EUR_GBP: ["EUR", "GBP"],
  EUR_JPY: ["EUR", "JPY"],
  GBP_JPY: ["GBP", "JPY"],
  XAU_USD: ["USD"],
  US30_USD: ["USD"],
};

type TradingViewEvent = {
  id?: string;
  title?: string;
  country?: string;
  currency?: string;
  actual?: number | string | null;
  forecast?: number | string | null;
  previous?: number | string | null;
  importance?: number;
  date?: string;
};

type TradingViewResponse = { result?: TradingViewEvent[] };

export type HighImpactEvent = {
  id: string;
  title: string;
  country: string | null;
  currency: string | null;
  date: string;
  importance: number;
  actual: number | string | null;
  forecast: number | string | null;
  previous: number | string | null;
  minutesUntil: number;
  minutesSince: number;
  phase: "before" | "after" | null;
};

export type EconomicEventStatus = {
  available: boolean;
  instrument: string;
  checkedAt: string;
  blocked: boolean;
  blockedBy: HighImpactEvent[];
  events: HighImpactEvent[];
  nextEvent: HighImpactEvent | null;
  error?: string;
};

function relevantCurrencies(instrument: string) {
  return new Set(currencyMap[instrument] ?? []);
}

async function fetchEvents(from: Date, to: Date) {
  const url = new URL("https://economic-calendar.tradingview.com/events");
  url.searchParams.set("from", from.toISOString());
  url.searchParams.set("to", to.toISOString());
  url.searchParams.set("countries", countries);
  const response = await fetch(url, {
    headers: { Origin: "https://www.tradingview.com" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as TradingViewResponse;
  if (!response.ok || !Array.isArray(payload.result)) {
    throw new Error("The economic calendar is temporarily unavailable.");
  }
  return payload.result;
}

function normaliseEvent(event: TradingViewEvent, now: Date): HighImpactEvent | null {
  if (!event.id || !event.title || !event.date || event.importance !== 1) return null;
  const timestamp = Date.parse(event.date);
  if (!Number.isFinite(timestamp)) return null;
  const differenceMinutes = (timestamp - now.getTime()) / 60000;
  const minutesUntil = Math.max(0, differenceMinutes);
  const minutesSince = Math.max(0, -differenceMinutes);
  return {
    id: event.id,
    title: event.title,
    country: event.country ?? null,
    currency: event.currency ?? null,
    date: new Date(timestamp).toISOString(),
    importance: event.importance,
    actual: event.actual ?? null,
    forecast: event.forecast ?? null,
    previous: event.previous ?? null,
    minutesUntil,
    minutesSince,
    phase: differenceMinutes >= 0 ? "before" : "after",
  };
}

export async function getEconomicEventStatus(instrument: string, now = new Date()): Promise<EconomicEventStatus> {
  const checkedAt = now.toISOString();
  try {
    const rawEvents = await fetchEvents(
      new Date(now.getTime() - postEventMinutes * 60000),
      new Date(now.getTime() + 24 * 60 * 60000),
    );
    const currencies = relevantCurrencies(instrument);
    const events = rawEvents
      .filter((event) => currencies.has(event.currency ?? ""))
      .map((event) => normaliseEvent(event, now))
      .filter((event): event is HighImpactEvent => Boolean(event))
      .filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const blockedBy = events.filter((event) => event.minutesUntil <= preEventMinutes || event.minutesSince <= postEventMinutes);
    return {
      available: true,
      instrument,
      checkedAt,
      blocked: blockedBy.length > 0,
      blockedBy,
      events,
      nextEvent: events.find((event) => event.phase === "before") ?? null,
    };
  } catch (error) {
    return {
      available: false,
      instrument,
      checkedAt,
      blocked: true,
      blockedBy: [],
      events: [],
      nextEvent: null,
      error: error instanceof Error ? error.message : "The economic calendar is temporarily unavailable.",
    };
  }
}
