import { env } from "cloudflare:workers";

type RuntimeEnv = { DB: D1Database };
const runtime = env as unknown as RuntimeEnv;

export type JournalRecordInput = {
  id?: string;
  environment: string;
  accountId?: string | null;
  instrument: string;
  direction: string;
  style: string;
  strategyName?: string | null;
  setupType?: string | null;
  status?: string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  units?: number | null;
  lots?: number | null;
  riskPercent?: number | null;
  riskAmount?: number | null;
  pnl?: number | null;
  brokerTradeId?: string | null;
  thesis?: string | null;
  evidence?: string | null;
  invalidation?: string | null;
  notes?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  metadata?: unknown;
};

function json(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

export async function createJournalEntry(input: JournalRecordInput) {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await runtime.DB.prepare(`INSERT INTO trade_journal (id, created_at, updated_at, environment, account_id, instrument, direction, style, strategy_name, setup_type, status, entry_price, stop_loss, take_profit_1, take_profit_2, units, lots, risk_percent, risk_amount, pnl, broker_trade_id, thesis, evidence, invalidation, notes, opened_at, closed_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, now, now, input.environment, input.accountId ?? null, input.instrument, input.direction, input.style,
    input.strategyName ?? null, input.setupType ?? null, input.status ?? "planned", input.entryPrice ?? null,
    input.stopLoss ?? null, input.takeProfit1 ?? null, input.takeProfit2 ?? null, input.units ?? null,
    input.lots ?? null, input.riskPercent ?? null, input.riskAmount ?? null, input.pnl ?? null,
    input.brokerTradeId ?? null, input.thesis ?? null, input.evidence ?? null, input.invalidation ?? null,
    input.notes ?? null, input.openedAt ?? null, input.closedAt ?? null, json(input.metadata),
  ).run();
  return id;
}

export async function updateJournalEntry(input: { id: string; status?: string; pnl?: number | null; brokerTradeId?: string | null; notes?: string | null; closedAt?: string | null; }) {
  await runtime.DB.prepare("UPDATE trade_journal SET status = COALESCE(?, status), pnl = COALESCE(?, pnl), broker_trade_id = COALESCE(?, broker_trade_id), notes = COALESCE(?, notes), closed_at = COALESCE(?, closed_at), updated_at = ? WHERE id = ?")
    .bind(input.status ?? null, input.pnl ?? null, input.brokerTradeId ?? null, input.notes ?? null, input.closedAt ?? null, new Date().toISOString(), input.id).run();
}

export async function writeSystemLog(input: {
  level?: "info" | "warning" | "error";
  category: string;
  event: string;
  message: string;
  instrument?: string | null;
  environment?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
  details?: unknown;
}) {
  const id = crypto.randomUUID();
  await runtime.DB.prepare("INSERT INTO system_logs (id, created_at, level, category, event, message, instrument, environment, correlation_id, duration_ms, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, new Date().toISOString(), input.level ?? "info", input.category, input.event, input.message, input.instrument ?? null, input.environment ?? null, input.correlationId ?? null, input.durationMs ?? null, json(input.details)).run();
  return id;
}
