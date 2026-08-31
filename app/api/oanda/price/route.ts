import { NextResponse } from "next/server";
import { fetchOandaAccountId, fetchOandaPrice, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken, saveOandaAccountId } from "@/lib/oanda-secret";
import { isOwnerRequest } from "@/lib/owner-request";

const allowed = new Set(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD", "US30_USD"]);

export async function GET(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const instrument = new URL(request.url).searchParams.get("instrument") ?? "EUR_USD";
  if (!allowed.has(instrument)) return NextResponse.json({ error: "Unsupported instrument" }, { status: 400 });
  const connection = await getOandaToken();
  if (!connection) return NextResponse.json({ connected: false, message: "Connect OANDA in settings to retrieve live prices." }, { status: 503 });
  try {
    const accountId = connection.accountId ?? await fetchOandaAccountId(connection.token, connection.environment);
    if (!connection.accountId) await saveOandaAccountId(accountId);
    const quote = await fetchOandaPrice({ token: connection.token, environment: connection.environment, accountId, instrument });
    return NextResponse.json({ connected: true, environment: connection.environment, instrument, ...quote });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unable to load OANDA live pricing.";
    return NextResponse.json({ connected: false, error: message }, { status });
  }
}
