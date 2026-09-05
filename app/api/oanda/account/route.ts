import { NextResponse } from "next/server";
import { fetchOandaAccountSummary, OandaApiError } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { isOwnerRequest } from "@/lib/owner-request";

export async function GET() {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getOandaToken();
  if (!connection?.accountId) {
    return NextResponse.json({ connected: false, error: "Connect OANDA with an account number first." }, { status: 503 });
  }
  try {
    const account = await fetchOandaAccountSummary({
      token: connection.token,
      environment: connection.environment,
      accountId: connection.accountId,
    });
    return NextResponse.json({ connected: true, environment: connection.environment, ...account });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Unable to load OANDA account summary." }, { status });
  }
}
