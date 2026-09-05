import { env } from "cloudflare:workers";
import type { HistoryCache } from "./history.ts";
import type { Bar } from "./types.ts";
const db = (env as unknown as { DB: D1Database }).DB;
export const historyCache: HistoryCache = {
 async read(key) { const row = await db.prepare('SELECT bars_json FROM quant_history WHERE key = ?').bind(key).first<{ bars_json: string }>(); return row ? JSON.parse(row.bars_json) as Bar[] : null; },
 async write(key,bars) { await db.prepare('INSERT OR IGNORE INTO quant_history (key,bars_json,fetched_at) VALUES (?,?,?)').bind(key,JSON.stringify(bars),new Date().toISOString()).run(); },
};
export async function saveResearch(report: unknown, bars: readonly Bar[]) {
 const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(bars)));
 const hash = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const prior = await db.prepare('SELECT COUNT(*) AS count FROM quant_research_runs WHERE dataset_hash = ?').bind(hash).first<{count:number}>();
 const id=crypto.randomUUID(),createdAt=new Date().toISOString();
 const saved = { report, id, createdAt, datasetHash:hash, previousUses:prior?.count ?? 0, holdoutWarning:(prior?.count ?? 0)>0 ? 'This dataset has already been inspected. It is no longer a fresh holdout.' : 'Reserve new future data before making another promotion decision.' };
 await db.prepare('INSERT INTO quant_research_runs (id,created_at,dataset_hash,report_json) VALUES (?,?,?,?)').bind(id,createdAt,hash,JSON.stringify(saved)).run(); return saved;
}
export async function researchHistory() { const rows=await db.prepare('SELECT id,created_at,dataset_hash,report_json FROM quant_research_runs ORDER BY created_at DESC LIMIT 20').all<{report_json:string}>(); return (rows.results ?? []).map(row=>JSON.parse(row.report_json)); }
