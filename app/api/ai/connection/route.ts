import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAiKey, saveAiKey } from "@/lib/ai-secret";
import { aiEndpoint, defaultAiBaseUrl, normalizeAiBaseUrl } from "@/lib/ai-config";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }

export async function GET() {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  return NextResponse.json({ connected: Boolean(connection), model: connection?.model ?? "gpt-5.5", baseUrl: connection?.baseUrl ?? defaultAiBaseUrl, updatedAt: connection?.updatedAt ?? null });
}

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json() as { apiKey?: string; model?: string; baseUrl?: string };
  const existing = await getAiKey();
  const apiKey = body.apiKey?.trim() || existing?.apiKey;
  if (!apiKey) return NextResponse.json({ error: "Enter an API key for the selected LLM provider." }, { status: 400 });
  const model = body.model?.trim() || existing?.model || "gpt-5.5";
  if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(model)) return NextResponse.json({ error: "Enter a valid model ID." }, { status: 400 });
  let baseUrl: string;
  try {
    baseUrl = normalizeAiBaseUrl(body.baseUrl || existing?.baseUrl || defaultAiBaseUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid LLM API base URL." }, { status: 400 });
  }
  const check = await fetch(aiEndpoint(baseUrl, "/models"), { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!check.ok) {
    const payload = await check.json().catch(() => ({})) as { error?: { message?: string } };
    return NextResponse.json({ connected: false, error: payload.error?.message || "The LLM provider rejected this API key or base URL." }, { status: check.status });
  }
  await saveAiKey(apiKey, model, baseUrl);
  return NextResponse.json({ connected: true, model, baseUrl });
}
