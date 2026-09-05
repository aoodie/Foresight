import { env } from "cloudflare:workers";

type RuntimeEnv = { DB: D1Database };
const runtime = env as unknown as RuntimeEnv;

export type AiDecisionType = "strategies" | "live_trade_review";

type LedgerRow = { id: string; model: string; output_json: string; usage_json: string | null; created_at: string };

export type CachedDecision<T> = {
  value: T;
  cacheHit: boolean;
  decisionId: string;
  fetchedAt: string;
  model: string;
  usage: Record<string, unknown> | null;
};

type StoreInput = {
  cacheKey: string;
  decisionType: AiDecisionType;
  subjectKey: string;
  model: string;
  instructions: string;
  input: unknown;
  output: unknown;
  validation: unknown;
  responseId?: string | null;
  usage?: unknown;
  trigger: string;
  ttlMs: number;
};

const inFlight = new Map<string, Promise<CachedDecision<unknown>>>();

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function stableJson(value: unknown) { return JSON.stringify(stable(value)); }

export async function hashAiInput(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Volatile timestamps and scanner prose are excluded so reloads do not create
// a new request. Structural changes and a quarter-ATR price move do.
export function compactStrategyMarkets(markets: unknown[]) {
  return markets.map((value) => {
    const market = value as Record<string, unknown>;
    const price = Number(market.price);
    const atrPercent = Number(market.atrPercent);
    const step = Number.isFinite(price) && price > 0 ? price * Math.max(0.0005, (Number.isFinite(atrPercent) ? atrPercent : 0.2) * 0.25 / 100) : 0.0001;
    return {
      instrument: market.instrument,
      bias: market.bias,
      score: Math.round(Number(market.score) * 10) / 10,
      priceBucket: Number.isFinite(price) ? Math.round(price / step) : null,
      change24h: Math.round(Number(market.change24h) * 10) / 10,
      rsi: Math.round(Number(market.rsi)),
      atrPercent: Math.round(atrPercent * 100) / 100,
      marketRegime: market.marketRegime ?? null,
      rangePosition: Math.round(Number(market.rangePosition) * 100) / 100,
      timeframeAlignment: market.timeframeAlignment ?? null,
      confirmations: market.confirmations ?? null,
      strategies: market.strategies ?? null,
      selectedStrategy: market.selectedStrategy ?? null,
      reasons: market.reasons ?? [],
      invalidation: market.invalidation ?? null,
    };
  });
}

function parseUsage(value: string | null) {
  if (!value) return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null; } catch { return null; }
}

export async function readCachedDecision<T>(cacheKey: string, now = new Date()): Promise<CachedDecision<T> | null> {
  const row = await runtime.DB.prepare(`SELECT l.id, l.model, l.output_json, l.usage_json, l.created_at FROM ai_decision_cache c JOIN ai_decision_ledger l ON l.id = c.ledger_id WHERE c.cache_key = ? AND c.expires_at > ? LIMIT 1`).bind(cacheKey, now.toISOString()).first<LedgerRow>();
  if (!row) return null;
  await runtime.DB.prepare("UPDATE ai_decision_cache SET last_used_at = ?, hit_count = hit_count + 1 WHERE cache_key = ?").bind(now.toISOString(), cacheKey).run();
  return { value: JSON.parse(row.output_json) as T, cacheHit: true, decisionId: row.id, fetchedAt: row.created_at, model: row.model, usage: parseUsage(row.usage_json) };
}

export async function storeDecision(input: StoreInput): Promise<CachedDecision<unknown>> {
  const id = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
  await runtime.DB.prepare(`INSERT INTO ai_decision_ledger (id, cache_key, decision_type, subject_key, provider, model, instructions, input_json, output_json, validation_json, response_id, usage_json, trigger, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.cacheKey, input.decisionType, input.subjectKey, "custom_llm", input.model, input.instructions, stableJson(input.input), stableJson(input.output), stableJson(input.validation), input.responseId ?? null, input.usage == null ? null : stableJson(input.usage), input.trigger, createdAt).run();
  await runtime.DB.prepare(`INSERT INTO ai_decision_cache (cache_key, ledger_id, decision_type, subject_key, created_at, last_used_at, expires_at, hit_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(cache_key) DO UPDATE SET ledger_id = excluded.ledger_id, decision_type = excluded.decision_type, subject_key = excluded.subject_key, created_at = excluded.created_at, last_used_at = excluded.last_used_at, expires_at = excluded.expires_at, hit_count = 0`).bind(input.cacheKey, id, input.decisionType, input.subjectKey, createdAt, createdAt, expiresAt).run();
  return { value: input.output, cacheHit: false, decisionId: id, fetchedAt: createdAt, model: input.model, usage: input.usage && typeof input.usage === "object" ? input.usage as Record<string, unknown> : null };
}

export async function withInFlightDedup<T>(cacheKey: string, work: () => Promise<CachedDecision<T>>): Promise<CachedDecision<T>> {
  const existing = inFlight.get(cacheKey);
  if (existing) return await existing as CachedDecision<T>;
  const promise = work() as Promise<CachedDecision<unknown>>;
  inFlight.set(cacheKey, promise);
  try { return await promise as CachedDecision<T>; } finally { if (inFlight.get(cacheKey) === promise) inFlight.delete(cacheKey); }
}
