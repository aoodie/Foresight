import { env } from "cloudflare:workers";

type RuntimeEnv = { DB: D1Database; OANDA_TOKEN_ENCRYPTION_KEY?: string };
const runtime = env as unknown as RuntimeEnv;
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function encryptionKey() {
  const secret = runtime.OANDA_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("Secure API key storage is not configured.");
  return crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveAiKey(apiKey: string, model = "gpt-5.5") {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(apiKey));
  await runtime.DB.prepare("INSERT INTO ai_connection (id, key_ciphertext, key_iv, model, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET key_ciphertext = excluded.key_ciphertext, key_iv = excluded.key_iv, model = excluded.model, updated_at = excluded.updated_at")
    .bind("primary", encode(new Uint8Array(encrypted)), encode(iv), model, new Date().toISOString()).run();
}

export async function getAiKey() {
  const row = await runtime.DB.prepare("SELECT key_ciphertext, key_iv, model, updated_at FROM ai_connection WHERE id = ?")
    .bind("primary").first<{ key_ciphertext: string; key_iv: string; model: string; updated_at: string }>();
  if (!row) return null;
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(row.key_iv) }, await encryptionKey(), decode(row.key_ciphertext));
  return { apiKey: new TextDecoder().decode(decrypted), model: row.model, updatedAt: row.updated_at };
}
