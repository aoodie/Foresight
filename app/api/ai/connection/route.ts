import { isOwnerRequest } from '@/lib/owner-request';
import { NextResponse } from "next/server";
import { getAiKey, saveAiKey } from "@/lib/ai-secret";
import { aiEndpoint, defaultAiBaseUrl, normalizeAiBaseUrl } from "@/lib/ai-config";

const ownerRequest = isOwnerRequest;

export async function GET() {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const connection = await getAiKey();
  return NextResponse.json({ connected: Boolean(connection), model: connection?.model ?? "", baseUrl: connection?.baseUrl ?? defaultAiBaseUrl, updatedAt: connection?.updatedAt ?? null });
}

export async function POST(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = await request.json().catch(() => null) as { apiKey?: string; model?: string; baseUrl?: string } | null;
  if (!body || [body.apiKey, body.model, body.baseUrl].some(v => v !== undefined && (typeof v !== 'string' || v.length > 4096))) return NextResponse.json({ error: 'Enter valid connection fields.' }, { status: 400 });
  const existing = await getAiKey();
  const apiKey = body.apiKey?.trim() || existing?.apiKey;
  if (!apiKey) return NextResponse.json({ error: "Enter an API key for the selected LLM provider." }, { status: 400 });
  const model = body.model?.trim() ?? existing?.model ?? "";
  if (model && !/^[A-Za-z0-9._:/-]{1,100}$/.test(model)) return NextResponse.json({ error: "Enter a valid model ID." }, { status: 400 });
  let baseUrl: string;
  try {
    baseUrl = normalizeAiBaseUrl(body.baseUrl || existing?.baseUrl || defaultAiBaseUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid LLM API base URL." }, { status: 400 });
  }
  if (existing && baseUrl !== existing.baseUrl && !body.apiKey?.trim()) return NextResponse.json({ error: 'Enter a new API key when changing the provider address.' }, { status: 400 });
  let check: Response;
  try { check = await fetch(aiEndpoint(baseUrl, "/models"), { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { return NextResponse.json({ error: 'The model provider could not be reached securely.' }, { status: 502 }); }
  if (!check.ok) {
    return NextResponse.json({ connected: false, error: 'The LLM provider rejected this API key or base URL.' }, { status: 502 });
  }
  await saveAiKey(apiKey, model, baseUrl);
  return NextResponse.json({ connected: true, model, baseUrl });
}
