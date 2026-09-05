import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

function row(overrides) {
  return {
    id: overrides.id,
    created_at: "2026-08-01T08:00:00.000Z",
    environment: "practice",
    instrument: "EUR_USD",
    direction: "long",
    style: "intraday",
    strategy_name: "Liquidity reclaim",
    status: "closed",
    entry_price: 1.1,
    stop_loss: 1.095,
    take_profit_1: 1.1075,
    risk_amount: 100,
    broker_trade_id: overrides.id,
    thesis: "Trend and trigger agree.",
    evidence: "Sweep reclaimed.",
    invalidation: "Close below the swept low.",
    opened_at: "2026-08-01T08:01:00.000Z",
    closed_at: "2026-08-01T10:01:00.000Z",
    metadata_json: JSON.stringify({ strategyVersion: "scanner-v1.1.0" }),
    ...overrides,
  };
}

function fill(id, tradeId, input) {
  return { id, tradeId, tradeIds: [tradeId], instrument: input.instrument ?? "EUR_USD", pnl: input.pnl ?? 0, units: input.units ?? 10_000, price: input.price, reason: null, closeReason: input.closeReason ?? null, isEntry: input.isEntry ?? false, isClose: input.isClose ?? false, time: input.time };
}

test("reconciles plan versus broker fills and computes risk metrics", async () => {
  const { buildValidationReport } = await vite.ssrLoadModule("/lib/validation.ts");
  const journal = [row({ id: "101", pnl: 100 }), row({ id: "202", direction: "short", instrument: "USD_JPY", entry_price: 150, stop_loss: 150.2, take_profit_1: 149.7, pnl: -50 })];
  const fills = [
    fill("1", "101", { price: 1.1002, isEntry: true, time: "2026-08-01T08:01:00.000Z" }),
    fill("2", "101", { price: 1.11, pnl: 100, isClose: true, closeReason: "TP hit", time: "2026-08-01T10:01:00.000Z" }),
    fill("3", "202", { instrument: "USD_JPY", price: 149.98, units: -10_000, isEntry: true, time: "2026-08-01T08:01:00.000Z" }),
    fill("4", "202", { instrument: "USD_JPY", price: 150.08, pnl: -50, isClose: true, closeReason: "SL hit", time: "2026-08-01T10:01:00.000Z" }),
  ];
  const report = buildValidationReport({ journal, fills, openTrades: [], environment: "practice", currency: "USD" });

  assert.equal(report.metrics.netPnl, 50);
  assert.equal(report.metrics.expectancyR, 0.25);
  assert.equal(report.metrics.profitFactor, 2);
  assert.equal(report.metrics.brokerMatchRate, 1);
  assert.ok(Math.abs(report.metrics.averageEntrySlippagePips - 2) < 1e-9);
  assert.ok(Math.abs(report.records[0].plannedR - 1.5) < 1e-9);
  assert.equal(report.gates.find((gate) => gate.id === "backtest").status, "block");
  assert.equal(report.gates.find((gate) => gate.id === "sample").status, "wait");
});

test("fails closed when broker fills or strategy versions are missing", async () => {
  const { buildValidationReport } = await vite.ssrLoadModule("/lib/validation.ts");
  const journal = [row({ id: "303", metadata_json: null })];
  const report = buildValidationReport({ journal, fills: [], openTrades: [{ id: "303", instrument: "EUR_USD", stopLoss: null, takeProfit: 1.2 }] });

  assert.equal(report.metrics.brokerMatchRate, 0);
  assert.equal(report.metrics.unprotectedOpenTrades, 1);
  assert.equal(report.gates.find((gate) => gate.id === "fills").status, "block");
  assert.equal(report.gates.find((gate) => gate.id === "protection").status, "block");
  assert.equal(report.gates.find((gate) => gate.id === "versioning").status, "block");
});
