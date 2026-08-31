import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { fetchOandaAccountSummary, fetchOandaOpenTrades, fetchOandaOrderFills } from "@/lib/oanda-api";
import { getOandaToken } from "@/lib/oanda-secret";
import { isOwnerRequest } from "@/lib/owner-request";
import { buildValidationReport, type ValidationJournalRow } from "@/lib/validation";

const runtime = env as unknown as { DB: D1Database };

export async function GET() {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const rows = await runtime.DB.prepare("SELECT * FROM trade_journal ORDER BY created_at DESC LIMIT 500").all<ValidationJournalRow>();
  const journal = rows.results ?? [];
  const connection = await getOandaToken();
  if (!connection?.accountId) {
    return NextResponse.json({
      connected: false,
      brokerError: "Connect OANDA to reconcile journal records with actual entry and exit fills.",
      ...buildValidationReport({ journal, fills: [], openTrades: [], environment: connection?.environment ?? null }),
    });
  }

  try {
    const [fills, openTrades, account] = await Promise.all([
      fetchOandaOrderFills({
        token: connection.token,
        environment: connection.environment,
        accountId: connection.accountId,
        from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      }),
      fetchOandaOpenTrades({ token: connection.token, environment: connection.environment, accountId: connection.accountId }),
      fetchOandaAccountSummary({ token: connection.token, environment: connection.environment, accountId: connection.accountId }),
    ]);
    return NextResponse.json({
      connected: true,
      ...buildValidationReport({ journal, fills, openTrades, environment: connection.environment, currency: account.currency }),
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      brokerError: error instanceof Error ? error.message : "OANDA evidence could not be loaded.",
      ...buildValidationReport({ journal, fills: [], openTrades: [], environment: connection.environment }),
    });
  }
}
