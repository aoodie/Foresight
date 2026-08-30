import { NextResponse } from "next/server";
import { fetchOandaOpenTrades, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";

export async function GET() {
  const connection = await getOandaToken();
  if (!connection?.accountId) {
    return NextResponse.json({ connected: false, error: "Connect OANDA with an account number first." }, { status: 503 });
  }
  try {
    const trades = await fetchOandaOpenTrades({
      token: connection.token,
      environment: connection.environment,
      accountId: connection.accountId,
    });
    return NextResponse.json({ connected: true, environment: connection.environment, trades, checkedAt: new Date().toISOString() });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Unable to monitor OANDA trades." }, { status });
  }
}
