import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("recovers a tagged Foresight trade that opened and closed before reconciliation", async () => {
  const { missingJournalRecordsFromFills } = await vite.ssrLoadModule("/lib/journal-recovery.ts");
  const fills = [
    { id: "101", time: "2026-08-31T08:00:00.000Z", instrument: "USD_JPY", openedTradeId: "102", tradeIds: ["102"], pnl: 0, units: 10000, price: 147.2, closeReason: null, isEntry: true, isClose: false, clientId: "foresight-abc", clientTag: "foresight-autotrader", clientComment: "intraday:daily" },
    { id: "110", time: "2026-08-31T09:00:00.000Z", instrument: "USD_JPY", openedTradeId: null, tradeIds: ["102"], pnl: 25, pnlByTradeId: { "102": 25 }, units: -10000, price: 147.4, closeReason: "TP hit", isEntry: false, isClose: true },
  ];
  const records = missingJournalRecordsFromFills({ openTrades: [], fills, knownBrokerIds: new Set(), environment: "practice", accountId: "account" });
  assert.equal(records.length, 1);
  assert.equal(records[0].brokerTradeId, "102");
  assert.equal(records[0].status, "closed");
  assert.equal(records[0].pnl, 25);
  assert.equal(records[0].metadata.closeReason, "TP hit");
  assert.equal(records[0].direction, "long");
});

test("ignores untagged broker fills and known trade IDs", async () => {
  const { missingJournalRecordsFromFills } = await vite.ssrLoadModule("/lib/journal-recovery.ts");
  const base = { id: "1", time: "2026-08-31T08:00:00.000Z", instrument: "EUR_USD", openedTradeId: "2", tradeIds: ["2"], pnl: 0, units: 1000, price: 1.1, closeReason: null, isEntry: true, isClose: false };
  assert.deepEqual(missingJournalRecordsFromFills({ openTrades: [], fills: [base], knownBrokerIds: new Set(), environment: "practice" }), []);
  assert.deepEqual(missingJournalRecordsFromFills({ openTrades: [], fills: [{ ...base, clientTag: "foresight-manual" }], knownBrokerIds: new Set(["2"]), environment: "practice" }), []);
});
