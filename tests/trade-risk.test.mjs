import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("accepts only directionally ordered, protected orders with at least 1.5R", async () => {
  const { validateProtectedOrder } = await vite.ssrLoadModule("/lib/trade-risk.ts");
  const long = validateProtectedOrder({ instrument: "EUR_USD", units: 10_000, entry: 1.1, stopLoss: 1.095, takeProfit: 1.1075 });
  assert.equal(long.ok, true);
  assert.ok(Math.abs(long.riskReward - 1.5) < 1e-9);

  const short = validateProtectedOrder({ instrument: "USD_JPY", units: -10_000, entry: 150, stopLoss: 150.2, takeProfit: 149.7 });
  assert.equal(short.ok, true);
  assert.ok(short.riskReward >= 1.5);

  assert.match(validateProtectedOrder({ instrument: "EUR_USD", units: 10_000, entry: 1.1, stopLoss: null, takeProfit: 1.12 }).error, /stop loss and take profit/i);
  assert.match(validateProtectedOrder({ instrument: "EUR_USD", units: 10_000, entry: 1.1, stopLoss: 1.11, takeProfit: 1.12 }).error, /required order/i);
  assert.match(validateProtectedOrder({ instrument: "EUR_USD", units: 10_000, entry: 1.1, stopLoss: 1.095, takeProfit: 1.105 }).error, /at least 1\.50/i);
});

test("risk sizing is bounded and uses the loss conversion factor", async () => {
  const { calculateRiskSizedUnits } = await vite.ssrLoadModule("/lib/trade-risk.ts");
  const result = calculateRiskSizedUnits({ equity: 100_000, riskPercent: 0.5, stopDistance: 0.005, lossConversionFactor: 0.8, maxUnits: 1_000_000 });
  assert.deepEqual(result, { units: 125_000, riskAmount: 500, cashRiskPerUnit: 0.004 });
  assert.equal(calculateRiskSizedUnits({ equity: 100_000, riskPercent: 2.1, stopDistance: 0.005, lossConversionFactor: 1 }), null);
});

test("selected trigger strategies remain valid confirmations", async () => {
  const { hasTriggerConfirmation } = await vite.ssrLoadModule("/lib/trade-risk.ts");
  assert.equal(hasTriggerConfirmation([{ id: "liquidity-reclaim", status: "selected" }]), true);
  assert.equal(hasTriggerConfirmation([{ id: "trend-continuation", status: "selected" }]), false);
  assert.equal(hasTriggerConfirmation([{ id: "range-breakout", status: "waiting" }]), false);
});

test("uses broker-compatible price precision for FX, gold and US30", async () => {
  const { instrumentPricePrecision } = await vite.ssrLoadModule("/lib/trade-risk.ts");
  assert.equal(instrumentPricePrecision("EUR_USD"), 5);
  assert.equal(instrumentPricePrecision("USD_JPY"), 3);
  assert.equal(instrumentPricePrecision("XAU_USD"), 3);
  assert.equal(instrumentPricePrecision("US30_USD"), 1);
});
