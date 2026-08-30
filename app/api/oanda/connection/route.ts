import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getOandaToken, saveOandaToken } from "@/lib/oanda-secret";
import { fetchOandaCandles, OandaApiError } from "@/lib/oanda-api";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }
export async function GET() {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getOandaToken();
  return NextResponse.json({ connected: Boolean(connection), environment: connection?.environment ?? "practice", updatedAt: connection?.updatedAt ?? null });
}
export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json() as { token?: string; environment?: "practice" | "live" };
  const token = body.token?.trim(), environment = body.environment === "live" ? "live" : "practice";
  if (!token || token.length < 20) return NextResponse.json({ error: "Enter a valid OANDA personal access token." }, { status: 400 });
  try {
    await fetchOandaCandles({ token, environment, instrument: "EUR_USD", granularity: "H1", count: 1 });
    await saveOandaToken(token, environment);
    return NextResponse.json({ connected: true, environment });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unable to validate this OANDA token.";
    return NextResponse.json({ connected: false, error: message }, { status });
  }
}
