import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const oandaConnection = sqliteTable("oanda_connection", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull().default("practice"),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  updatedAt: text("updated_at").notNull(),
  accountId: text("account_id"),
});

export const aiConnection = sqliteTable("ai_connection", {
  id: text("id").primaryKey(),
  keyCiphertext: text("key_ciphertext").notNull(),
  keyIv: text("key_iv").notNull(),
  model: text("model").notNull().default(""),
  baseUrl: text("base_url").notNull().default("https://api.aoodie.xyz/v1"),
  updatedAt: text("updated_at").notNull(),
});

export const tradeJournal = sqliteTable("trade_journal", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  environment: text("environment").notNull(),
  accountId: text("account_id"),
  instrument: text("instrument").notNull(),
  direction: text("direction").notNull(),
  style: text("style").notNull(),
  strategyName: text("strategy_name"),
  setupType: text("setup_type"),
  status: text("status").notNull().default("planned"),
  entryPrice: real("entry_price"),
  stopLoss: real("stop_loss"),
  takeProfit1: real("take_profit_1"),
  takeProfit2: real("take_profit_2"),
  units: integer("units"),
  lots: real("lots"),
  riskPercent: real("risk_percent"),
  riskAmount: real("risk_amount"),
  pnl: real("pnl"),
  brokerTradeId: text("broker_trade_id"),
  thesis: text("thesis"),
  evidence: text("evidence"),
  invalidation: text("invalidation"),
  notes: text("notes"),
  openedAt: text("opened_at"),
  closedAt: text("closed_at"),
  metadataJson: text("metadata_json"),
});

// Immutable lifecycle evidence for each journal record. Current trade state
// remains in trade_journal for fast reads; this table preserves how it changed.
export const tradeJournalEvents = sqliteTable("trade_journal_events", {
  id: text("id").primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  journalId: text("journal_id").notNull(),
  brokerTradeId: text("broker_trade_id"),
  eventType: text("event_type").notNull(),
  eventAt: text("event_at").notNull(),
  source: text("source").notNull(),
  status: text("status"),
  price: real("price"),
  pnl: real("pnl"),
  reason: text("reason"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_trade_journal_events_journal_id").on(table.journalId),
]);

export const systemLogs = sqliteTable("system_logs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  level: text("level").notNull(),
  category: text("category").notNull(),
  event: text("event").notNull(),
  message: text("message").notNull(),
  instrument: text("instrument"),
  environment: text("environment"),
  correlationId: text("correlation_id"),
  durationMs: integer("duration_ms"),
  detailsJson: text("details_json"),
});

// Append-only record of every actual custom-LLM decision. Cache hits point back to
// one of these records so the original prompt, evidence and output remain
// auditable without charging for a second generation.
export const aiDecisionLedger = sqliteTable("ai_decision_ledger", {
  id: text("id").primaryKey(),
  cacheKey: text("cache_key").notNull(),
  decisionType: text("decision_type").notNull(),
  subjectKey: text("subject_key").notNull(),
  provider: text("provider").notNull().default("custom_llm"),
  model: text("model").notNull(),
  instructions: text("instructions").notNull(),
  inputJson: text("input_json").notNull(),
  outputJson: text("output_json").notNull(),
  validationJson: text("validation_json"),
  responseId: text("response_id"),
  usageJson: text("usage_json"),
  trigger: text("trigger").notNull(),
  createdAt: text("created_at").notNull(),
});

export const aiDecisionCache = sqliteTable("ai_decision_cache", {
  cacheKey: text("cache_key").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  decisionType: text("decision_type").notNull(),
  subjectKey: text("subject_key").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  hitCount: integer("hit_count").notNull().default(0),
});
