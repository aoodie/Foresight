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
  await runtime.DB.prepare(`INSERT INTO trade_journal (id, created_at, updated_at, environment, account_id, instrument, direction, style, strategy_name, setup_type, status, entry_price, stop_loss, take_profit_1, take_profit_2, units, lots, risk_percent, risk_amount, pnl, broker_trade_id, thesis, evidence, invalidation, notes, opened_at, closed_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, environment = excluded.environment,
      account_id = excluded.account_id, instrument = excluded.instrument, direction = excluded.direction,
      style = excluded.style, strategy_name = excluded.strategy_name, setup_type = excluded.setup_type,
      status = CASE WHEN trade_journal.status IN ('closed', 'cancelled', 'win', 'loss', 'breakeven') AND excluded.status IN ('planned', 'submitted', 'open') THEN trade_journal.status ELSE excluded.status END,
      entry_price = excluded.entry_price, stop_loss = excluded.stop_loss,
      take_profit_1 = excluded.take_profit_1, take_profit_2 = excluded.take_profit_2,
      units = excluded.units, lots = COALESCE(excluded.lots, trade_journal.lots),
      risk_percent = excluded.risk_percent, risk_amount = excluded.risk_amount,
      pnl = COALESCE(excluded.pnl, trade_journal.pnl), broker_trade_id = COALESCE(excluded.broker_trade_id, trade_journal.broker_trade_id),
      thesis = COALESCE(excluded.thesis, trade_journal.thesis), evidence = COALESCE(excluded.evidence, trade_journal.evidence),
      invalidation = COALESCE(excluded.invalidation, trade_journal.invalidation), notes = COALESCE(excluded.notes, trade_journal.notes),
      opened_at = COALESCE(excluded.opened_at, trade_journal.opened_at), closed_at = COALESCE(excluded.closed_at, trade_journal.closed_at),
      metadata_json = CASE WHEN excluded.metadata_json IS NULL THEN trade_journal.metadata_json ELSE json_patch(CASE WHEN json_valid(trade_journal.metadata_json) THEN trade_journal.metadata_json ELSE '{}' END, excluded.metadata_json) END`).bind(
    id, now, now, input.environment, input.accountId ?? null, input.instrument, input.direction, input.style,
    input.strategyName ?? null, input.setupType ?? null, input.status ?? "planned", input.entryPrice ?? null,
    input.stopLoss ?? null, input.takeProfit1 ?? null, input.takeProfit2 ?? null, input.units ?? null,
    input.lots ?? null, input.riskPercent ?? null, input.riskAmount ?? null, input.pnl ?? null,
    input.brokerTradeId ?? null, input.thesis ?? null, input.evidence ?? null, input.invalidation ?? null,
    input.notes ?? null, input.openedAt ?? null, input.closedAt ?? null, json(input.metadata),
  ).run();
  return id;
}

export async function updateJournalEntry(input: { id: string; status?: string; pnl?: number | null; brokerTradeId?: string | null; notes?: string | null; openedAt?: string | null; closedAt?: string | null; metadata?: Record<string, unknown>; }) {
  const now = new Date().toISOString();
  const closedAt = input.closedAt ?? (input.status && ["closed", "cancelled", "win", "loss", "breakeven"].includes(input.status) ? now : null);
  const metadataJson = input.metadata == null ? null : json(input.metadata);
  const result = await runtime.DB.prepare("UPDATE trade_journal SET status = COALESCE(?, status), pnl = COALESCE(?, pnl), broker_trade_id = COALESCE(?, broker_trade_id), notes = COALESCE(?, notes), opened_at = COALESCE(?, opened_at), closed_at = COALESCE(?, closed_at), metadata_json = CASE WHEN ? IS NULL THEN metadata_json ELSE json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, ?) END, updated_at = ? WHERE id = ?")
    .bind(input.status ?? null, input.pnl ?? null, input.brokerTradeId ?? null, input.notes ?? null, input.openedAt ?? null, closedAt, metadataJson, metadataJson, now, input.id).run();
  return Number(result.meta?.changes ?? 0);
}

export async function updateJournalByBrokerTradeId(input: { brokerTradeId: string; status: string; pnl?: number | null; notes?: string | null; closedAt?: string | null; metadata?: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const closedAt = input.closedAt ?? (["closed", "cancelled", "win", "loss", "breakeven"].includes(input.status) ? now : null);
  const metadataJson = input.metadata == null ? null : json(input.metadata);
  const result = await runtime.DB.prepare("UPDATE trade_journal SET status = ?, pnl = COALESCE(?, pnl), notes = COALESCE(?, notes), closed_at = COALESCE(?, closed_at), metadata_json = CASE WHEN ? IS NULL THEN metadata_json ELSE json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, ?) END, updated_at = ? WHERE broker_trade_id = ?")
    .bind(input.status, input.pnl ?? null, input.notes ?? null, closedAt, metadataJson, metadataJson, now, input.brokerTradeId).run();
  return Number(result.meta?.changes ?? 0);
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

type BrokerSnapshotTrade = {
  id: string;
  instrument: string;
  price: number;
  openTime: string | null;
  units: number;
  stopLoss: number | null;
  takeProfit: number | null;
};

type BrokerSnapshotFill = {
  id: string;
  time: string;
  tradeIds: string[];
  pnl: number;
  pnlByTradeId?: Record<string, number>;
  price: number | null;
  closeReason: string | null;
  isClose: boolean;
};

function parsedMetadata(value: unknown) {
  if (typeof value !== "string") return {} as Record<string, unknown>;
  try {
    const result = JSON.parse(value) as unknown;
    return result && typeof result === "object" ? result as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

export async function reconcileJournalFromBrokerSnapshot(input: {
  openTrades: BrokerSnapshotTrade[];
  fills: BrokerSnapshotFill[];
  environment: string;
}) {
  const rows = await runtime.DB.prepare("SELECT id, broker_trade_id, instrument, status, opened_at, metadata_json FROM trade_journal WHERE broker_trade_id IS NOT NULL AND status IN ('submitted', 'open', 'reconciliation_required') ORDER BY created_at ASC LIMIT 200").all<{
    id: string; broker_trade_id: string; instrument: string; status: string; opened_at: string | null; metadata_json: string | null;
  }>();
  const openById = new Map(input.openTrades.map((trade) => [trade.id, trade]));
  let activityUpdates = 0;
  let closedUpdates = 0;

  for (const row of rows.results ?? []) {
    const openTrade = openById.get(row.broker_trade_id);
    if (openTrade) {
      const metadata = parsedMetadata(row.metadata_json);
      const brokerSnapshot = { units: openTrade.units, entryPrice: openTrade.price, stopLoss: openTrade.stopLoss, takeProfit: openTrade.takeProfit };
      if (JSON.stringify(metadata.brokerSnapshot) !== JSON.stringify(brokerSnapshot) || row.status !== "open") {
        const previous = metadata.brokerSnapshot && typeof metadata.brokerSnapshot === "object" ? metadata.brokerSnapshot as Record<string, unknown> : null;
        const changedFields = previous ? Object.keys(brokerSnapshot).filter((key) => previous[key] !== brokerSnapshot[key as keyof typeof brokerSnapshot]) : ["initial broker state"];
        const activityAt = new Date().toISOString();
        const notes = previous ? `Broker activity changed: ${changedFields.join(", ")}.` : "Broker position confirmed and protection snapshot recorded.";
        await updateJournalEntry({ id: row.id, status: "open", brokerTradeId: row.broker_trade_id, notes, openedAt: row.opened_at ?? openTrade.openTime, metadata: { brokerSnapshot, lastBrokerActivityAt: activityAt } });
        await writeSystemLog({ level: previous ? "warning" : "info", category: "reconciliation", event: previous ? "trade.broker_activity_changed" : "trade.broker_snapshot_recorded", message: `${row.instrument}: ${notes}`, instrument: row.instrument, environment: input.environment, details: { journalId: row.id, brokerTradeId: row.broker_trade_id, changedFields, previous, current: brokerSnapshot } });
        activityUpdates += 1;
      }
      continue;
    }

    const relatedCloseFills = input.fills.filter((fill) => fill.isClose && fill.tradeIds.includes(row.broker_trade_id)).sort((a, b) => a.time.localeCompare(b.time));
    if (!relatedCloseFills.length) continue;
    const latest = relatedCloseFills.at(-1)!;
    const pnl = relatedCloseFills.reduce((sum, fill) => {
      const allocated = fill.pnlByTradeId?.[row.broker_trade_id];
      return sum + (Number.isFinite(allocated) ? Number(allocated) : fill.tradeIds.length === 1 ? fill.pnl : 0);
    }, 0);
    const closeReason = latest.closeReason ?? "Closed order";
    const notes = `${closeReason}. Journal reconciled to OANDA transaction ${latest.id}.`;
    await updateJournalEntry({ id: row.id, status: "closed", brokerTradeId: row.broker_trade_id, pnl, notes, closedAt: latest.time, metadata: { closeReason, closePrice: latest.price, closeTransactionId: latest.id, closeTime: latest.time, reconciledAt: new Date().toISOString() } });
    await writeSystemLog({ category: "reconciliation", event: "trade.closed_reconciled", message: `${row.instrument}: ${notes}`, instrument: row.instrument, environment: input.environment, details: { journalId: row.id, brokerTradeId: row.broker_trade_id, pnl, closePrice: latest.price, closeTime: latest.time } });
    closedUpdates += 1;
  }

  return { checked: rows.results?.length ?? 0, activityUpdates, closedUpdates };
}
