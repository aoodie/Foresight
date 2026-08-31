import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("normalises OANDA midpoint candles", async () => {
  const { normaliseOandaPayload } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const result = normaliseOandaPayload({ candles: [
    { time: "2026-01-01T00:00:00Z", complete: true, mid: { o: "1.1000", h: "1.1020", l: "1.0990", c: "1.1010" } },
    { time: "2026-01-01T01:00:00Z", complete: true, mid: { o: "1.1010", h: "1.1040", l: "1.1000", c: "1.1030" } },
  ] });
  assert.equal(result.candles.length, 2);
  assert.equal(result.price, 1.103);
  assert.ok(result.changePercent > 0);
});

test("normalises an OANDA bid and ask quote", async () => {
  const { normaliseOandaPrice } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const result = normaliseOandaPrice({ prices: [{ time: "2026-01-01T12:00:00Z", tradeable: true, status: "tradeable", bids: [{ price: "1.10120" }], asks: [{ price: "1.10134" }], quoteHomeConversionFactors: { positiveUnits: "0.8", negativeUnits: "0.81" } }] });
  assert.equal(result.bid, 1.1012);
  assert.equal(result.ask, 1.10134);
  assert.equal(result.mid, 1.10127);
  assert.ok(result.spread > 0);
  assert.equal(result.tradeable, true);
  assert.equal(result.homeConversionFactors.negativeUnits, 0.81);
});

test("rejects empty OANDA payloads", async () => {
  const { normaliseOandaPayload, normaliseOandaPrice } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  assert.throws(() => normaliseOandaPayload({ candles: [] }), /no usable candles/i);
  assert.throws(() => normaliseOandaPrice({ prices: [] }), /no usable live quote/i);
  assert.throws(() => normaliseOandaPrice({ prices: [{ time: "2026-01-01T12:00:00Z", bids: [{ price: "1.1" }], asks: [{ price: "1.2" }] }] }), /conversion factors/i);
});

test("ranks a strongly trending instrument with an actionable bias", async () => {
  const { analyseInstrument } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  const candles = Array.from({ length: 80 }, (_, index) => {
    const open = 1.08 + index * 0.0004;
    return { time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString(), open, high: open + 0.0007, low: open - 0.0003, close: open + 0.0005, complete: true };
  });
  const result = analyseInstrument({ instrument: "EUR_USD", label: "EUR / USD", assetClass: "forex", candles });
  assert.equal(result.bias, "long");
  assert.ok(result.score >= 70);
  assert.ok(result.atrPercent > 0);
  assert.ok(result.stopLoss < result.entry);
  assert.ok(result.takeProfit1 > result.entry);
  assert.ok(result.takeProfit2 > result.takeProfit1);
  assert.equal(result.riskReward1, 1.5);
  assert.equal(result.reasons.length, 4);
});

test("treats a flat market as neutral momentum instead of overbought", async () => {
  const { analyseInstrument } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  const candles = Array.from({ length: 60 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    open: 1.1,
    high: 1.101,
    low: 1.099,
    close: 1.1,
    complete: true,
  }));
  const result = analyseInstrument({ instrument: "EUR_USD", label: "EUR / USD", assetClass: "forex", candles });
  assert.equal(result.rsi, 50);
  assert.equal(result.bias, "neutral");
});

test("requires 55 completed candles", async () => {
  const { analyseInstrument } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  const candles = Array.from({ length: 55 }, (_, index) => ({ time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(), open: 1, high: 2, low: 0.5, close: 1.5, complete: index !== 54 }));
  assert.throws(() => analyseInstrument({ instrument: "EUR_USD", label: "EUR / USD", assetClass: "forex", candles }), /55 completed candles/i);
});

test("swing trading uses daily context, H4 setup and H1 trigger", async () => {
  const { candleCountForGranularity, timeframeProfiles } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  assert.deepEqual(timeframeProfiles.swing, { context: "D", setup: "H4", trigger: "H1", frames: ["D", "H4", "H1"] });
  assert.equal(candleCountForGranularity("M5"), 300);
  assert.equal(candleCountForGranularity("M15"), 100);
});
