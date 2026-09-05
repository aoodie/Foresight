import { NextResponse } from "next/server";
import { fetchOandaCandles, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";

const instruments = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY"]);
export async function GET(request: Request) {
  const instrument = new URL(request.url).searchParams.get("instrument") ?? "EUR_USD";
  if (!instruments.has(instrument)) return NextResponse.json({ error: "Select a supported FX instrument." }, { status: 400 });
  try {
    const connection = await getOandaToken();
    if (!connection) return NextResponse.json({ error: "Connect OANDA from the dashboard before loading historical candles, or import a JSON file." }, { status: 503 });
    const data = await fetchOandaCandles({ token: connection.token, environment: connection.environment, instrument, granularity: "H1", count: 5000 });
    return NextResponse.json({ source: "OANDA midpoint, H1, unsmoothed", instrument, candles: data.candles.filter((bar) => bar.complete) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof OandaApiError ? error.message : "Historical data is unavailable. Check the dashboard connection and database setup, or import a candle JSON file." }, { status: error instanceof OandaApiError ? error.status : 503 });
  }
}
