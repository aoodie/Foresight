import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("reviews worker and tagged dashboard trades but ignores unrelated broker trades", async () => {
  const { tradeReviewSource } = await vite.ssrLoadModule("/lib/trade-monitoring.ts");
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
