import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { evaluateLearning } = await vite.ssrLoadModule("/lib/learning.ts");
function bars() {
  return Array.from({ length: 2000 }, (_, i) => {
    const open = 1.1 + i * 0.00001 + Math.sin(i / 15) * 0.001;
    const close = open + Math.sin(i / 9) * 0.0002;
    return { time: new Date(Date.UTC(2020, 0, 1, i)).toISOString(), open, close, high: Math.max(open, close) + 0.0001, low: Math.min(open, close) - 0.0001, complete: true };
  });
}
test("holdout changes cannot influence selected model or forward folds", () => {
  const c = bars();
  const before = evaluateLearning({ candles: c, roundTripCostBps: 2 });
  const altered = c.map((bar, i) => i < 1600 ? bar : { ...bar, close: bar.open * 1.01, high: bar.open * 1.02 });
  const after = evaluateLearning({ candles: altered, roundTripCostBps: 2 });
  assert.equal(before.selectedLookback, after.selectedLookback);
  assert.deepEqual(before.folds, after.folds);
  assert.notDeepEqual(before.holdout, after.holdout);
  assert.equal(before.executionEnabled, false);
});
test("enforces data validity and positive execution costs", () => {
  for (const cost of [0, -1, NaN, Infinity]) assert.throws(() => evaluateLearning({ candles: bars(), roundTripCostBps: cost }), /cost/);
  const c = bars(); c[100].complete = false;
  assert.throws(() => evaluateLearning({ candles: c, roundTripCostBps: 2 }), /incomplete/);
  c[100].complete = true; c[100].time = c[99].time;
  assert.throws(() => evaluateLearning({ candles: c, roundTripCostBps: 2 }), /duplicate/);
  assert.throws(() => evaluateLearning({ candles: c.slice(0, 100), roundTripCostBps: 2 }), /1,500/);
});
test("stress test charges additional cost for every holdout trade", () => {
  const result = evaluateLearning({ candles: bars(), roundTripCostBps: 2 });
  assert.ok(Math.abs(result.holdout.netBps - result.stressed.netBps - 2 * result.holdout.trades) < 1e-6);
  assert.equal(result.status, "rejected");
  for (const fold of result.folds) assert.ok(Date.parse(fold.testStart) - Date.parse(fold.trainEnd) >= 50 * 3600000);
});
