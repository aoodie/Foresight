import { NextResponse } from "next/server";
import { getOandaToken } from "@/lib/oanda-secret";
const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "XAU_USD"]);
export async function GET(request: Request) {
  const url = new URL(request.url), instrument = url.searchParams.get("instrument") ?? "EUR_USD", granularity = url.searchParams.get("granularity") ?? "H1";
  if (!allowed.has(instrument)) return NextResponse.json({ error: "Unsupported instrument" }, { status: 400 });
  const connection = await getOandaToken();
  if (!connection) return NextResponse.json({ connected: false, message: "Connect OANDA in settings to retrieve candles." }, { status: 503 });
  const host = connection.environment === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
  const response = await fetch(`https://${host}/v3/instruments/${instrument}/candles?count=120&granularity=${granularity}&price=M`, { headers: { Authorization: `Bearer ${connection.token}` }, cache: "no-store" });
  return NextResponse.json(await response.json(), { status: response.status });
}
