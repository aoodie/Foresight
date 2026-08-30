import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { generateStrategies, isStrategyMarket } from "@/lib/openai-strategy";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Add an OpenAI API key in Settings before generating AI strategies." }, { status: 503 });
  const body = await request.json() as { markets?: unknown[] };
  const markets = body.markets?.slice(0, 3) ?? [];
  if (!markets.length || !markets.every(isStrategyMarket)) return NextResponse.json({ error: "The scanner data is incomplete. Run the daily scan again." }, { status: 400 });
  try {
    const strategies = await generateStrategies(connection.apiKey, connection.model, markets);
    return NextResponse.json({ model: connection.model, generatedAt: new Date().toISOString(), strategies });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate AI strategies." }, { status: 502 });
  }
}
