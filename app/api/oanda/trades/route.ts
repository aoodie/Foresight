import { NextResponse } from "next/server";
import { fetchOandaOpenTrades, fetchOandaOrderFills, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { isOwnerRequest } from "@/lib/owner-request";
import { reconcileJournalFromBrokerSnapshot } from "@/lib/trading-records";

export async function GET() {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getOandaToken();
  if (!connection?.accountId) {
    return NextResponse.json({ connected: false, error: "Connect OANDA with an account number first." }, { status: 503 });
  }
  try {
    const [trades, fills] = await Promise.all([
      fetchOandaOpenTrades({ token: connection.token, environment: connection.environment, accountId: connection.accountId }),
      fetchOandaOrderFills({ token: connection.token, environment: connection.environment, accountId: connection.accountId, from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }),
    ]);
    const reconciliation = await reconcileJournalFromBrokerSnapshot({ openTrades: trades, fills, environment: connection.environment, accountId: connection.accountId });
    return NextResponse.json({ connected: true, environment: connection.environment, trades, fills, reconciliation, checkedAt: new Date().toISOString() });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Unable to monitor OANDA trades." }, { status });
  }
}
