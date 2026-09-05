import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
let directory;
before(async () => { directory = await mkdtemp(join(tmpdir(), "foresight-worker-state-")); });
after(async () => { await vite.close(); if (directory) await rm(directory, { recursive: true }); });

test("re-delivers a journal event when the same trade later changes", async () => {
  const { WorkerState } = await vite.ssrLoadModule("/autotrader/state.ts");
  const state = new WorkerState(join(directory, "state.sqlite"));
  state.enqueueSync("journal.create:trade-1", "journal.create", { status: "submitted" });
  const first = state.dueSyncEvents();
  assert.equal(first.length, 1);
  state.markSyncDelivered(first[0].id);
  assert.equal(state.dueSyncEvents().length, 0);

  state.enqueueSync("journal.create:trade-1", "journal.create", { status: "open", brokerTradeId: "123" });
  const changed = state.dueSyncEvents();
  assert.equal(changed.length, 1);
  assert.deepEqual(JSON.parse(changed[0].payload_json), { status: "open", brokerTradeId: "123" });
  assert.equal(changed[0].attempts, 0);
  state.close();
});

test("stores the broker close time instead of reconciliation time", async () => {
  const { WorkerState } = await vite.ssrLoadModule("/autotrader/state.ts");
  const state = new WorkerState(join(directory, "journal.sqlite"));
  state.journalCreate({ id: "journal-1", brokerTradeId: "501", environment: "practice", accountId: "account", instrument: "USD_JPY", direction: "long", style: "intraday", strategyName: "test", entryPrice: 150, stopLoss: 149.8, takeProfit1: 150.3, takeProfit2: 150.5, units: 10_000, riskPercent: 0.5, riskAmount: 13.4, status: "open" });
  state.journalUpdateByBrokerTradeId("501", "closed", 20, "TP hit", { closeTime: "2026-08-30T21:15:00.000Z", closeReason: "TP hit" });
  const row = state.journalRows()[0];
  assert.equal(row.closed_at, "2026-08-30T21:15:00.000Z");
  assert.equal(row.pnl, 20);
  state.close();
});
