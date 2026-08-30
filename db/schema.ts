import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
