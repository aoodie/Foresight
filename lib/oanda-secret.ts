import { env } from "cloudflare:workers";

type RuntimeEnv = { DB: D1Database; OANDA_TOKEN_ENCRYPTION_KEY?: string };
const runtime = env as unknown as RuntimeEnv;
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function key() {
  const secret = runtime.OANDA_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("Secure token storage is not configured.");
  return crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveOandaToken(token: string, environment: "practice" | "live", accountId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(token));
  await runtime.DB.prepare("INSERT INTO oanda_connection (id, environment, token_ciphertext, token_iv, updated_at, account_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET environment = excluded.environment, token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, updated_at = excluded.updated_at, account_id = excluded.account_id")
    .bind("primary", environment, encode(new Uint8Array(encrypted)), encode(iv), new Date().toISOString(), accountId).run();
}

export async function saveOandaAccountId(accountId: string) {
  await runtime.DB.prepare("UPDATE oanda_connection SET account_id = ? WHERE id = ?").bind(accountId, "primary").run();
}

export async function getOandaToken() {
  const row = await runtime.DB.prepare("SELECT environment, token_ciphertext, token_iv, updated_at, account_id FROM oanda_connection WHERE id = ?").bind("primary").first<{ environment: "practice" | "live"; token_ciphertext: string; token_iv: string; updated_at: string; account_id: string | null }>();
  if (!row) return null;
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(row.token_iv) }, await key(), decode(row.token_ciphertext));
  return { token: new TextDecoder().decode(decrypted), environment: row.environment, updatedAt: row.updated_at, accountId: row.account_id };
}
