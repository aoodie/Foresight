import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  model: text("model").notNull().default("gpt-5.5"),
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
