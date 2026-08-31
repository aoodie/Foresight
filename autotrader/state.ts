import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type WorkerJournalInput = {
  id: string;
  brokerTradeId?: string | null;
  environment: string;
  accountId: string;
  instrument: string;
  direction: "long" | "short";
  style: string;
  strategyName: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  units: number;
  riskPercent: number;
  riskAmount: number;
  status: string;
  metadata?: unknown;
};

export type WorkerJournalRow = WorkerJournalInput & {
  created_at: string;
  updated_at: string;
  pnl: number | null;
  closed_at: string | null;
};

export type WorkerEvent = {
  level?: "info" | "warning" | "error";
  event: string;
  message: string;
  instrument?: string | null;
  details?: unknown;
};

export class WorkerState {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        level TEXT NOT NULL,
        event TEXT NOT NULL,
        instrument TEXT,
        message TEXT NOT NULL,
        details_json TEXT
      );
      CREATE TABLE IF NOT EXISTS worker_journal (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        broker_trade_id TEXT,
        environment TEXT NOT NULL,
        account_id TEXT NOT NULL,
        instrument TEXT NOT NULL,
        direction TEXT NOT NULL,
        style TEXT NOT NULL,
        strategy_name TEXT NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit_1 REAL NOT NULL,
        take_profit_2 REAL,
        units INTEGER NOT NULL,
        risk_percent REAL NOT NULL,
        risk_amount REAL NOT NULL,
        status TEXT NOT NULL,
        pnl REAL,
        closed_at TEXT,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS worker_ai_cache (
        cache_key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        model TEXT NOT NULL,
        output_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS worker_journal_broker_trade_id_idx ON worker_journal (broker_trade_id);
      CREATE INDEX IF NOT EXISTS worker_journal_status_idx ON worker_journal (status, created_at);
    `);
  }

  get<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM worker_state WHERE key = ?").get(key) as { value?: string } | undefined;
    if (!row?.value) return null;
    try { return JSON.parse(row.value) as T; } catch { return null; }
  }

  set(key: string, value: unknown) {
    this.db.prepare("INSERT INTO worker_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  delete(key: string) {
    this.db.prepare("DELETE FROM worker_state WHERE key = ?").run(key);
  }

  event(input: WorkerEvent) {
    this.db.prepare("INSERT INTO worker_events (created_at, level, event, instrument, message, details_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), input.level ?? "info", input.event, input.instrument ?? null, input.message, input.details == null ? null : JSON.stringify(input.details));
  }

  cacheGet<T>(key: string, now = new Date()): { value: T; model: string; createdAt: string } | null {
    const row = this.db.prepare("SELECT output_json, model, created_at FROM worker_ai_cache WHERE cache_key = ? AND expires_at > ?")
      .get(key, now.toISOString()) as { output_json?: string; model?: string; created_at?: string } | undefined;
    if (!row?.output_json || !row.model || !row.created_at) return null;
    try { return { value: JSON.parse(row.output_json) as T, model: row.model, createdAt: row.created_at }; } catch { return null; }
  }

  cacheSet(key: string, model: string, value: unknown, ttlMs: number) {
    const now = new Date();
    this.db.prepare("INSERT INTO worker_ai_cache (cache_key, created_at, expires_at, model, output_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at, model = excluded.model, output_json = excluded.output_json")
      .run(key, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(), model, JSON.stringify(value));
  }

  journalCreate(input: WorkerJournalInput) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO worker_journal (id, created_at, updated_at, broker_trade_id, environment, account_id, instrument, direction, style, strategy_name, entry_price, stop_loss, take_profit_1, take_profit_2, units, risk_percent, risk_amount, status, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, now, now, input.brokerTradeId ?? null, input.environment, input.accountId, input.instrument, input.direction, input.style, input.strategyName, input.entryPrice, input.stopLoss, input.takeProfit1, input.takeProfit2, input.units, input.riskPercent, input.riskAmount, input.status, input.metadata == null ? null : JSON.stringify(input.metadata));
  }

  journalUpdateByBrokerTradeId(brokerTradeId: string, status: string, pnl?: number | null, notes?: string, metadata?: Record<string, unknown>) {
    const existing = this.db.prepare("SELECT metadata_json FROM worker_journal WHERE broker_trade_id = ?").get(brokerTradeId) as { metadata_json?: string | null } | undefined;
    let mergedMetadata: Record<string, unknown> = {};
    try { mergedMetadata = existing?.metadata_json ? JSON.parse(existing.metadata_json) : {}; } catch { /* Replace malformed metadata with the new audit fields. */ }
    if (notes) mergedMetadata.lastNote = notes;
    if (metadata) Object.assign(mergedMetadata, metadata);
    const now = new Date().toISOString();
    const closeTime = metadata && typeof metadata.closeTime === "string" ? metadata.closeTime : now;
    this.db.prepare("UPDATE worker_journal SET status = ?, pnl = COALESCE(?, pnl), closed_at = CASE WHEN ? IN ('closed', 'cancelled', 'win', 'loss', 'breakeven') THEN ? ELSE closed_at END, updated_at = ?, metadata_json = ? WHERE broker_trade_id = ?")
      .run(status, pnl ?? null, status, closeTime, now, JSON.stringify(mergedMetadata), brokerTradeId);
  }

  journalUpdateById(id: string, input: { status?: string; brokerTradeId?: string | null; entryPrice?: number | null; pnl?: number | null; notes?: string; metadata?: Record<string, unknown> }) {
    const existing = this.db.prepare("SELECT metadata_json FROM worker_journal WHERE id = ?").get(id) as { metadata_json?: string | null } | undefined;
    let mergedMetadata: Record<string, unknown> = {};
    try { mergedMetadata = existing?.metadata_json ? JSON.parse(existing.metadata_json) : {}; } catch { /* Preserve the new audit data even when old metadata is malformed. */ }
    if (input.notes) mergedMetadata.lastNote = input.notes;
    if (input.metadata) Object.assign(mergedMetadata, input.metadata);
    const now = new Date().toISOString();
    const terminal = input.status && ["closed", "cancelled", "win", "loss", "breakeven"].includes(input.status) ? (typeof input.metadata?.closeTime === "string" ? input.metadata.closeTime : now) : null;
    this.db.prepare(`UPDATE worker_journal SET status = COALESCE(?, status), broker_trade_id = COALESCE(?, broker_trade_id),
      entry_price = COALESCE(?, entry_price), pnl = COALESCE(?, pnl), closed_at = COALESCE(?, closed_at),
      updated_at = ?, metadata_json = ? WHERE id = ?`)
      .run(input.status ?? null, input.brokerTradeId ?? null, input.entryPrice ?? null, input.pnl ?? null, terminal, now, JSON.stringify(mergedMetadata), id);
  }

  managedOpenTrades(): Array<{ id: string; broker_trade_id: string; instrument: string; status: string; created_at: string }> {
    return this.db.prepare("SELECT id, broker_trade_id, instrument, status, created_at FROM worker_journal WHERE broker_trade_id IS NOT NULL AND status IN ('submitted', 'open')")
      .all() as Array<{ id: string; broker_trade_id: string; instrument: string; status: string; created_at: string }>;
  }

  pendingJournals(): Array<{ id: string; instrument: string; created_at: string; metadata: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT id, instrument, created_at, metadata_json FROM worker_journal WHERE broker_trade_id IS NULL AND status = 'submitted' ORDER BY created_at ASC")
      .all() as Array<{ id: string; instrument: string; created_at: string; metadata_json?: string | null }>;
    return rows.map((row) => ({ id: row.id, instrument: row.instrument, created_at: row.created_at, metadata: this.parseMetadata(row.metadata_json) ?? {} }));
  }

  journalRows(): WorkerJournalRow[] {
    const rows = this.db.prepare("SELECT id, broker_trade_id, environment, account_id, instrument, direction, style, strategy_name, entry_price, stop_loss, take_profit_1, take_profit_2, units, risk_percent, risk_amount, status, metadata_json, created_at, updated_at, pnl, closed_at FROM worker_journal ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), brokerTradeId: row.broker_trade_id == null ? null : String(row.broker_trade_id),
      environment: String(row.environment), accountId: String(row.account_id), instrument: String(row.instrument),
      direction: String(row.direction) as "long" | "short", style: String(row.style), strategyName: String(row.strategy_name),
      entryPrice: Number(row.entry_price), stopLoss: Number(row.stop_loss), takeProfit1: Number(row.take_profit_1),
      takeProfit2: row.take_profit_2 == null ? null : Number(row.take_profit_2), units: Number(row.units),
      riskPercent: Number(row.risk_percent), riskAmount: Number(row.risk_amount), status: String(row.status),
      metadata: row.metadata_json == null ? undefined : this.parseMetadata(row.metadata_json),
      created_at: String(row.created_at), updated_at: String(row.updated_at), pnl: row.pnl == null ? null : Number(row.pnl),
      closed_at: row.closed_at == null ? null : String(row.closed_at),
    }));
  }

  private parseMetadata(value: unknown) {
    try { return JSON.parse(String(value)); } catch { return undefined; }
  }

  enqueueSync(eventKey: string, eventType: string, payload: unknown) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO worker_sync_queue (event_key, event_type, payload_json, created_at, updated_at, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at,
        attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL, delivered_at = NULL`)
      .run(eventKey, eventType, JSON.stringify(payload), now, now, now);
  }

  dueSyncEvents(limit = 20): Array<{ id: number; event_type: string; payload_json: string; attempts: number }> {
    return this.db.prepare("SELECT id, event_type, payload_json, attempts FROM worker_sync_queue WHERE delivered_at IS NULL AND next_attempt_at <= ? ORDER BY id ASC LIMIT ?")
      .all(new Date().toISOString(), limit) as Array<{ id: number; event_type: string; payload_json: string; attempts: number }>;
  }

  markSyncDelivered(id: number) {
    this.db.prepare("UPDATE worker_sync_queue SET delivered_at = ?, updated_at = ?, last_error = NULL WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), id);
  }

  markSyncFailed(id: number, error: string) {
    const row = this.db.prepare("SELECT attempts FROM worker_sync_queue WHERE id = ?").get(id) as { attempts?: number } | undefined;
    const attempts = Number(row?.attempts ?? 0) + 1;
    const delayMs = Math.min(60 * 60 * 1000, 5000 * (2 ** Math.min(attempts - 1, 8)));
    const nextAttempt = new Date(Date.now() + delayMs).toISOString();
    this.db.prepare("UPDATE worker_sync_queue SET attempts = ?, next_attempt_at = ?, updated_at = ?, last_error = ? WHERE id = ?")
      .run(attempts, nextAttempt, new Date().toISOString(), error.slice(0, 1000), id);
  }

  dailyPnl(dayStart: Date) {
    const row = this.db.prepare("SELECT COALESCE(SUM(pnl), 0) AS pnl FROM worker_journal WHERE closed_at >= ? AND pnl IS NOT NULL")
      .get(dayStart.toISOString()) as { pnl?: number } | undefined;
    return Number(row?.pnl ?? 0);
  }

  dailyTradeCount(dayStart: Date) {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM worker_journal WHERE created_at >= ?")
      .get(dayStart.toISOString()) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  close() { this.db.close(); }
}
