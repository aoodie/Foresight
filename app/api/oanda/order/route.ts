import { NextResponse } from "next/server";
import { OandaApiError, submitOandaMarketOrder } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";

const allowed = new Set(["EUR_USD","GBP_USD","USD_JPY","USD_CHF","AUD_USD","NZD_USD","USD_CAD","EUR_GBP","EUR_JPY","GBP_JPY","XAU_USD","US30_USD"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { instrument?: string; units?: number; stopLoss?: number | null; takeProfit?: number | null; mode?: "paper" | "live"; confirmLive?: boolean } | null;
  if (!body || !allowed.has(body.instrument ?? "") || !Number.isFinite(body.units) || !body.units) return NextResponse.json({ error: "Instrument and non-zero units are required." }, { status: 400 });
  const mode = body.mode ?? "paper";
  if (mode === "paper") return NextResponse.json({ mode: "paper", status: "simulated", orderId: `paper-${Date.now()}`, units: body.units });
  if (!body.confirmLive) return NextResponse.json({ error: "Live execution is locked. Confirm live trading explicitly after reviewing the risk controls." }, { status: 409 });
  const connection = await getOandaToken();
  if (!connection?.accountId) return NextResponse.json({ error: "Connect an OANDA account with an account number first." }, { status: 503 });
  try {
    const result = await submitOandaMarketOrder({ token: connection.token, environment: "live", accountId: connection.accountId, instrument: body.instrument!, units: body.units!, stopLoss: body.stopLoss, takeProfit: body.takeProfit });
    return NextResponse.json({ mode: "live", status: "submitted", ...result });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit order." }, { status });
  }
}
