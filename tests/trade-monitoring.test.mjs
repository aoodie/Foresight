import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("reviews worker and tagged dashboard trades but ignores unrelated broker trades", async () => {
  const { foresightTradeSource, tradeReviewSource } = await vite.ssrLoadModule("/lib/trade-monitoring.ts");
  assert.equal(foresightTradeSource("foresight-autotrader"), "autonomous");
  assert.equal(foresightTradeSource("foresight-manual"), "dashboard_manual");
  assert.equal(foresightTradeSource("other-system"), null);
  assert.equal(tradeReviewSource({ managedByWorker: true, clientTag: null, monitorDashboardTrades: true }), "autonomous");
  assert.equal(tradeReviewSource({ managedByWorker: false, clientTag: "foresight-manual", monitorDashboardTrades: true }), "dashboard_manual");
  assert.equal(tradeReviewSource({ managedByWorker: false, clientTag: "other-system", monitorDashboardTrades: true }), null);
  assert.equal(tradeReviewSource({ managedByWorker: false, clientTag: "foresight-manual", monitorDashboardTrades: false }), null);
});

test("dashboard trades require a separate automatic-close permission", async () => {
  const { canAutoCloseReviewedTrade } = await vite.ssrLoadModule("/lib/trade-monitoring.ts");
  assert.equal(canAutoCloseReviewedTrade({ source: "autonomous", autoCloseAutonomous: true, autoCloseDashboardManual: false }), true);
  assert.equal(canAutoCloseReviewedTrade({ source: "dashboard_manual", autoCloseAutonomous: true, autoCloseDashboardManual: false }), false);
  assert.equal(canAutoCloseReviewedTrade({ source: "dashboard_manual", autoCloseAutonomous: true, autoCloseDashboardManual: true }), true);
  assert.equal(canAutoCloseReviewedTrade({ source: "dashboard_manual", autoCloseAutonomous: false, autoCloseDashboardManual: true }), false);
});

test("infers trade source from OANDA historical client order IDs", async () => {
  const { foresightTradeSource } = await vite.ssrLoadModule("/lib/trade-monitoring.ts");
  assert.equal(foresightTradeSource(null, "foresight-abcd"), "autonomous");
  assert.equal(foresightTradeSource(null, "foresight-ui-abcd"), "dashboard_manual");
  assert.equal(foresightTradeSource(null, "foresight-at-abcd"), "autonomous");
  assert.equal(foresightTradeSource(null, "other-client"), null);
});

test("extracts only complete journal UUIDs from new OANDA client IDs", async () => {
  const { foresightJournalId } = await vite.ssrLoadModule("/lib/trade-monitoring.ts");
  const journalId = "c5a62dcc-bfc8-4b8a-a98f-7dca717339ec";
  assert.equal(foresightJournalId(`foresight-ui-${journalId}`), journalId);
  assert.equal(foresightJournalId(`foresight-at-${journalId}`), journalId);
  assert.equal(foresightJournalId("foresight-ui-c5a62dcc-bfc8-4b8a-a98f"), null);
  assert.equal(foresightJournalId("foresight-legacy-hash"), null);
});
