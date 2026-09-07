import { isOwnerRequest } from '@/lib/owner-request';
import { NextResponse } from "next/server";
import { getOandaToken, saveOandaToken } from "@/lib/oanda-secret";
import {
  fetchOandaAccountId,
  fetchOandaPrice,
  OandaApiError,
} from "@/lib/oanda-api";

async function ownerRequest() {
  return isOwnerRequest();
}

export async function GET() {
  if (!(await ownerRequest()))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getOandaToken();
  return NextResponse.json({
    connected: Boolean(connection),
    environment: connection?.environment ?? "practice",
    updatedAt: connection?.updatedAt ?? null,
  });
}

export async function POST(request: Request) {
  if (!(await ownerRequest()))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    accountId?: string;
    environment?: "practice" | "live";
  } | null;
  if (!body || typeof body.token !== 'string' || body.token.length > 4096 || (body.accountId !== undefined && (typeof body.accountId !== 'string' || body.accountId.length > 128)) || !['practice','live'].includes(body.environment ?? 'practice')) return NextResponse.json({ error: 'Enter valid broker connection fields.' }, { status: 400 });
  const token = body.token?.trim();
  const suppliedAccountId = body.accountId?.trim();
  const environment = body.environment === "live" ? "live" : "practice";
  if (!token || token.length < 20)
    return NextResponse.json(
      { error: "Enter a valid OANDA personal access token." },
      { status: 400 },
    );
  try {
    const accountId =
      suppliedAccountId || (await fetchOandaAccountId(token, environment));
    await fetchOandaPrice({
      token,
      environment,
      accountId,
      instrument: "EUR_USD",
    });
    await saveOandaToken(token, environment, accountId);
    return NextResponse.json({ connected: true, environment });
  } catch (error) {
    const status = error instanceof OandaApiError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Unable to validate this OANDA token.";
    return NextResponse.json({ connected: false, error: message }, { status });
  }
}
