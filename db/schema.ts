import { text, sqliteTable } from "drizzle-orm/sqlite-core";

export const oandaConnection = sqliteTable("oanda_connection", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull().default("practice"),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  updatedAt: text("updated_at").notNull(),
});
