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
  const result = normaliseOandaPrice({ prices: [{ time: "2026-01-01T12:00:00Z", tradeable: true, status: "tradeable", bids: [{ price: "1.10120" }], asks: [{ price: "1.10134" }] }] });
  assert.equal(result.bid, 1.1012);
  assert.equal(result.ask, 1.10134);
  assert.equal(result.mid, 1.10127);
  assert.ok(result.spread > 0);
  assert.equal(result.tradeable, true);
});

test("rejects empty OANDA payloads", async () => {
  const { normaliseOandaPayload, normaliseOandaPrice } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  assert.throws(() => normaliseOandaPayload({ candles: [] }), /no usable candles/i);
  assert.throws(() => normaliseOandaPrice({ prices: [] }), /no usable live quote/i);
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

const brokerArgs = { token: "test-token", environment: "practice", accountId: "test-account" };

test("loads every transaction page instead of treating the index as empty history", async (t) => {
  const { fetchOandaOrderFills } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const base = "https://api-fxpractice.oanda.com/v3/accounts/test-account/transactions";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith("/transactions")) return Response.json({ pages: [`${base}/idrange?from=1&to=2`, `${base}/idrange?from=3&to=4`] });
    assert.equal(url.searchParams.get("type"), "ORDER_FILL");
    return Response.json({ transactions: [{ id: url.searchParams.get("from"), type: "ORDER_FILL", time: "2026-01-01T12:00:00Z", pl: "-25", units: "100" }, { id: "other", type: "MARKET_ORDER", time: "2026-01-01T12:00:00Z" }] });
  });
  const fills = await fetchOandaOrderFills({ ...brokerArgs, from: new Date("2026-01-01") });
  assert.equal(calls.length, 3);
  assert.deepEqual(fills.map((fill) => fill.id), ["1", "3"]);
  assert.equal(fills.reduce((sum, fill) => sum + fill.pnl, 0), -50);
});

test("does not forward broker credentials to a foreign transaction page", async (t) => {
  const { fetchOandaOrderFills } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ pages: ["https://example.com/transactions/idrange"] }));
  await assert.rejects(fetchOandaOrderFills({ ...brokerArgs, from: new Date("2026-01-01") }), /invalid transaction page/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("rejects cancelled or unconfirmed market orders even on HTTP success", async (t) => {
  const { submitOandaMarketOrder } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  t.mock.method(globalThis, "fetch", async () => Response.json({ orderCreateTransaction: { id: "1" }, orderCancelTransaction: { reason: "INSUFFICIENT_MARGIN" } }));
  await assert.rejects(submitOandaMarketOrder({ ...brokerArgs, instrument: "EUR_USD", units: 100 }), /INSUFFICIENT_MARGIN/);
});

test("returns confirmed fills and rejects unconfirmed trade closes", async (t) => {
  const { submitOandaMarketOrder, closeOandaTrade } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  t.mock.method(globalThis, "fetch", async () => Response.json({ orderFillTransaction: { id: "2", units: "100", tradeOpened: { tradeID: "3" } } }));
  assert.deepEqual(await submitOandaMarketOrder({ ...brokerArgs, instrument: "EUR_USD", units: 100 }), { orderId: "2", tradeId: "3", units: "100" });
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(closeOandaTrade({ ...brokerArgs, tradeId: "3" }), /did not confirm/);
});
