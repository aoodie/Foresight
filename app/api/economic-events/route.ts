import { NextResponse } from "next/server";
import { getEconomicEventStatus } from "@/lib/economic-calendar";

const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD", "US30_USD"]);

export async function GET(request: Request) {
  const instrument = new URL(request.url).searchParams.get("instrument") ?? "EUR_USD";
  if (!allowed.has(instrument)) return NextResponse.json({ error: "Unsupported instrument." }, { status: 400 });
  const status = await getEconomicEventStatus(instrument);
  return NextResponse.json(status, { status: status.available ? 200 : 503 });
}
