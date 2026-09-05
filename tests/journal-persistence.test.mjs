import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const sqlite = new DatabaseSync(":memory:");
for (const file of readdirSync(`${root}/drizzle`).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`${root}/drizzle/${file}`, 'utf8'));
globalThis.foresightTestDb = { prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return { bind(...values) { args = values; return this; }, async run() { return { meta: statement.run(...args) }; }, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args) }; } }; } };
const vite = await createServer({ appType: "custom", configFile: false, root, plugins: [{ name: "test-db", resolveId(id) { if (id === "cloudflare:workers") return '\0test-db'; }, load(id) { if (id === '\0test-db') return 'export const env = { DB: globalThis.foresightTestDb };'; } }], server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); sqlite.close(); delete globalThis.foresightTestDb; });
test("replayed fills preserve entry reasoning and never reopen a closed trade", async () => {
 const { createJournalEntry, updateJournalEntry } = await vite.ssrLoadModule('/lib/trading-records.ts');
 const entry = { id: "immutable-entry", environment: "practice", accountId: "a", instrument: "EUR_USD", direction: "long", style: "intraday", strategyName: "Original strategy", thesis: "Original evidence before entry", status: "open", openedAt: "2026-01-01T10:00:00Z" };
 await createJournalEntry(entry);
 await updateJournalEntry({ id: entry.id, status: "closed", pnl: -10, closedAt: "2026-01-01T11:00:00Z" });
 await createJournalEntry({ ...entry, strategyName: "Rewritten after losing", thesis: "Hindsight", openedAt: "2026-01-02T10:00:00Z" });
 const row = sqlite.prepare('SELECT * FROM trade_journal WHERE id = ?').get(entry.id);
 assert.equal(row.strategy_name, entry.strategyName); assert.equal(row.thesis, entry.thesis); assert.equal(row.status, 'closed'); assert.equal(row.opened_at, entry.openedAt);
 await updateJournalEntry({ id: entry.id, status: 'closed', closedAt: '2026-02-01T00:00:00Z' });
 assert.equal(sqlite.prepare('SELECT closed_at FROM trade_journal WHERE id = ?').get(entry.id).closed_at, '2026-01-01T11:00:00Z');
});
test('execution claims are durable and repeated requests never claim twice',async()=>{
 const {reserveExecution,finishExecution}=await vite.ssrLoadModule('/lib/execution-intents.ts');
 const request={accountId:'account',environment:'practice',instrument:'USD_JPY',direction:'long',signalTime:'2026-01-01T10:00:00Z',strategyVersion:'1.0.0',request:{units:100}};
 const first=await reserveExecution(request);assert.equal(first.claimed,true);
 assert.equal((await reserveExecution(request)).claimed,false);
 await finishExecution(first.id,'filled',{tradeId:'123'});
 assert.deepEqual((await reserveExecution(request)).result,{tradeId:'123'});
 assert.equal((await reserveExecution({...request,accountId:'different'})).claimed,true);
});
test('the entry context remains unchanged by later reviews',async()=>{
 const {createJournalEntry,updateJournalEntry}=await vite.ssrLoadModule('/lib/trading-records.ts');
 await createJournalEntry({id:'snapshot',environment:'practice',instrument:'EUR_USD',direction:'long',style:'H1',metadata:{strategyId:'trend-pullback',strategyVersion:'1.0.0',marketRegime:{type:'strong_trend'},score:75},thesis:'Observed before entry'});
 const before=sqlite.prepare('SELECT context_json FROM trade_entry_context WHERE journal_id = ?').get('snapshot').context_json;
 await updateJournalEntry({id:'snapshot',status:'closed',metadata:{strategyVersion:'fake',marketRegime:{type:'range'}}});
 assert.equal(sqlite.prepare('SELECT context_json FROM trade_entry_context WHERE journal_id = ?').get('snapshot').context_json,before);
});
