import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey, saveAiKey } from "@/lib/ai-secret";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function GET() {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  return NextResponse.json({ connected: Boolean(connection), model: connection?.model ?? "gpt-5.5", updatedAt: connection?.updatedAt ?? null });
}

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json() as { apiKey?: string };
  const apiKey = body.apiKey?.trim();
  if (!apiKey || apiKey.length < 20) return NextResponse.json({ error: "Enter a valid OpenAI API key." }, { status: 400 });
  const check = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!check.ok) {
    const payload = await check.json().catch(() => ({})) as { error?: { message?: string } };
    return NextResponse.json({ connected: false, error: payload.error?.message || "OpenAI rejected this API key." }, { status: check.status });
  }
  await saveAiKey(apiKey);
  return NextResponse.json({ connected: true, model: "gpt-5.5" });
}
