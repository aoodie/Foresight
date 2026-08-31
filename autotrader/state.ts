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

  journalUpdateByBrokerTradeId(brokerTradeId: string, status: string, pnl?: number | null, notes?: string) {
    this.db.prepare("UPDATE worker_journal SET status = ?, pnl = COALESCE(?, pnl), closed_at = CASE WHEN ? IN ('closed', 'cancelled') THEN ? ELSE closed_at END, updated_at = ?, metadata_json = CASE WHEN ? IS NULL THEN metadata_json ELSE json_set(COALESCE(metadata_json, '{}'), '$.lastNote', ?) END WHERE broker_trade_id = ?")
      .run(status, pnl ?? null, status, new Date().toISOString(), new Date().toISOString(), notes ?? null, notes ?? null, brokerTradeId);
  }

  managedOpenTrades(): Array<{ broker_trade_id: string; instrument: string; status: string }> {
    return this.db.prepare("SELECT broker_trade_id, instrument, status FROM worker_journal WHERE broker_trade_id IS NOT NULL AND status IN ('submitted', 'open')")
      .all() as Array<{ broker_trade_id: string; instrument: string; status: string }>;
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
