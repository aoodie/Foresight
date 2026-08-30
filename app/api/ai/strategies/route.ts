import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { generateStrategies, isStrategyMarket } from "@/lib/openai-strategy";
import { getLuxAlgoGrounding } from "@/lib/luxalgo-mcp";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Add an OpenAI API key in Settings before generating AI strategies." }, { status: 503 });
  const body = await request.json() as { markets?: unknown[]; mode?: "scalping" | "intraday" | "swing" };
  const markets = body.markets?.slice(0, 3) ?? [];
  if (!markets.length || !markets.every(isStrategyMarket)) return NextResponse.json({ error: "The scanner data is incomplete. Run the daily scan again." }, { status: 400 });
  try {
    const luxAlgoSources = await getLuxAlgoGrounding();
    const strategies = await generateStrategies(connection.apiKey, connection.model, markets, luxAlgoSources, body.mode ?? "intraday");
    return NextResponse.json({ model: connection.model, generatedAt: new Date().toISOString(), strategies, luxAlgoSources: luxAlgoSources.map((source) => ({ slug: source.slug, name: source.name, family: source.family, url: source.url })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate AI strategies." }, { status: 502 });
  }
}
