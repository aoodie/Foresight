import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

async function ownerRequest() { return Boolean((await headers()).get("oai-authenticated-user-email")); }
const runtime = env as unknown as { DB: D1Database };

export async function GET(request: Request) {
  if (!(await ownerRequest())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const limit = Math.min(300, Math.max(1, Number(params.get("limit") ?? 150) || 150));
  const level = params.get("level");
  const category = params.get("category");
  const rows = level || category
    ? await runtime.DB.prepare("SELECT * FROM system_logs WHERE (? IS NULL OR level = ?) AND (? IS NULL OR category = ?) ORDER BY created_at DESC LIMIT ?").bind(level, level, category, category, limit).all()
    : await runtime.DB.prepare("SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return NextResponse.json({ logs: rows.results ?? [] });
}
