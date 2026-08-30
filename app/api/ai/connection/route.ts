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
  const body = await request.json() as { apiKey?: string; model?: string };
  const existing = await getAiKey();
  const apiKey = body.apiKey?.trim() || existing?.apiKey;
  if (!apiKey || apiKey.length < 20) return NextResponse.json({ error: "Enter a valid OpenAI API key." }, { status: 400 });
  const model = body.model?.trim() || existing?.model || "gpt-5.5";
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(model)) return NextResponse.json({ error: "Enter a valid OpenAI model ID." }, { status: 400 });
  const check = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!check.ok) {
    const payload = await check.json().catch(() => ({})) as { error?: { message?: string } };
    return NextResponse.json({ connected: false, error: payload.error?.message || "OpenAI rejected this API key." }, { status: check.status });
  }
  const modelCheck = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!modelCheck.ok) {
    const payload = await modelCheck.json().catch(() => ({})) as { error?: { message?: string } };
    return NextResponse.json({ connected: false, error: payload.error?.message || `The model “${model}” is not available to this API key.` }, { status: modelCheck.status });
  }
  await saveAiKey(apiKey, model);
  return NextResponse.json({ connected: true, model });
}
