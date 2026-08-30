import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey } from "@/lib/ai-secret";
import { generateStrategies, isStrategyMarket } from "@/lib/openai-strategy";
import { getLuxAlgoGrounding } from "@/lib/luxalgo-mcp";
import { writeSystemLog } from "@/lib/trading-records";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  if (!connection) return NextResponse.json({ error: "Add an OpenAI API key in Settings before generating AI strategies." }, { status: 503 });
  const body = await request.json() as { markets?: unknown[]; mode?: "scalping" | "intraday" | "swing" } | null;
  const markets = Array.isArray(body?.markets) ? body.markets.slice(0, 3) : [];
  if (!markets.length || !markets.every(isStrategyMarket)) return NextResponse.json({ error: "The scanner data is incomplete. Run the daily scan again." }, { status: 400 });
  try {
    const luxAlgoSources = await getLuxAlgoGrounding();
    const strategies = await generateStrategies(connection.apiKey, connection.model, markets, luxAlgoSources, body?.mode ?? "intraday");
    await writeSystemLog({ category: "ai", event: "analysis.completed", message: `AI generated ${strategies.length} strategy plan(s).`, details: { mode: body?.mode ?? "intraday", instruments: markets.map((market) => (market as { instrument: string }).instrument), model: connection.model } });
    return NextResponse.json({ model: connection.model, generatedAt: new Date().toISOString(), strategies, luxAlgoSources: luxAlgoSources.map((source) => ({ slug: source.slug, name: source.name, family: source.family, url: source.url })) });
  } catch (error) {
    try { await writeSystemLog({ level: "error", category: "ai", event: "analysis.failed", message: error instanceof Error ? error.message : "AI strategy generation failed." }); } catch { /* Preserve the original AI error. */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate AI strategies." }, { status: 502 });
  }
}
