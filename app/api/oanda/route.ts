import { NextResponse } from "next/server";
import { getOandaToken } from "@/lib/oanda-secret";
import { fetchOandaCandles, OandaApiError } from "@/lib/oanda-api";
const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "XAU_USD"]);
const granularities = new Set(["M15", "H1", "H4"]);
export async function GET(request: Request) {
  const url = new URL(request.url), instrument = url.searchParams.get("instrument") ?? "EUR_USD", granularity = url.searchParams.get("granularity") ?? "H1";
  if (!allowed.has(instrument)) return NextResponse.json({ error: "Unsupported instrument" }, { status: 400 });
  if (!granularities.has(granularity)) return NextResponse.json({ error: "Unsupported granularity" }, { status: 400 });
  const connection = await getOandaToken();
  if (!connection) return NextResponse.json({ connected: false, message: "Connect OANDA in settings to retrieve candles." }, { status: 503 });
  try {
    const data = await fetchOandaCandles({ token: connection.token, environment: connection.environment, instrument, granularity });
    return NextResponse.json({ connected: true, environment: connection.environment, instrument, granularity, ...data });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unable to load OANDA data.";
    return NextResponse.json({ connected: false, error: message }, { status });
  }
}
