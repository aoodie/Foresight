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

test("attaches client extensions to both the OANDA order and resulting trade", async () => {
  const { submitOandaMarketOrder } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const originalFetch = globalThis.fetch;
  let submittedBody;
  globalThis.fetch = async (_url, init) => {
    submittedBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ orderFillTransaction: { id: "11", time: "2026-01-01T00:00:00Z", units: "1000", price: "1.1", tradeOpened: { tradeID: "12" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const extensions = { id: "foresight-test", tag: "foresight-manual", comment: "intraday" };
    await submitOandaMarketOrder({ token: "test", environment: "practice", accountId: "account", instrument: "EUR_USD", units: 1000, clientExtensions: extensions });
    assert.deepEqual(submittedBody.order.clientExtensions, extensions);
    assert.deepEqual(submittedBody.order.tradeClientExtensions, extensions);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("follows OANDA transaction pages and preserves the historical client order ID", async () => {
  const { fetchOandaOrderFills } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("/transactions?")) {
      return new Response(JSON.stringify({ count: 1, pages: ["https://api-fxpractice.oanda.com/v3/accounts/account/transactions/idrange?from=10&to=20"] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ transactions: [{ id: "11", time: "2026-08-31T08:00:00.000Z", instrument: "EUR_USD", clientOrderID: "foresight-test", units: "1000", price: "1.1", pl: "0", reason: "MARKET_ORDER", tradeOpened: { tradeID: "12", units: "1000", price: "1.1" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const fills = await fetchOandaOrderFills({ token: "test", environment: "practice", accountId: "account", from: new Date("2026-08-01T00:00:00.000Z") });
    assert.equal(requested.length, 2);
    assert.match(requested[1], /type=ORDER_FILL/);
    assert.equal(fills.length, 1);
    assert.equal(fills[0].openedTradeId, "12");
    assert.equal(fills[0].clientId, "foresight-test");
    assert.equal(fills[0].clientTag, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalises broker close reasons to the journal taxonomy", async () => {
  const { normaliseOandaOrderFills } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  const reasons = [
    ["TAKE_PROFIT_ORDER", "TP"],
    ["STOP_LOSS_ORDER", "SL"],
    ["TRAILING_STOP_LOSS_ORDER", "TRAILING_STOP"],
    ["MARKET_ORDER_TRADE_CLOSE", "MANUAL"],
    ["UNKNOWN_ORDER_REASON", "BROKER"],
  ];
  for (const [reason, expected] of reasons) {
    const [fill] = normaliseOandaOrderFills([{ id: reason, time: "2026-09-03T01:00:00.000Z", instrument: "EUR_USD", tradeID: "42", tradeClosed: { tradeID: "42", realizedPL: "2" }, units: "-1000", price: "1.17", pl: "2", reason }]);
    assert.equal(fill.closeReason, expected);
  }
});

test("sends pair chat with a fixed research-only role and selected-pair context", async () => {
  const { askPairAnalyst, pairChatInstructions } = await vite.ssrLoadModule("/lib/pair-chat.ts");
  const originalFetch = globalThis.fetch;
  let submittedBody;
  globalThis.fetch = async (_url, init) => {
    submittedBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "response-1", output: [{ content: [{ type: "output_text", text: "USD/JPY is ranging near resistance." }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await askPairAnalyst({ apiKey: "test", model: "test-model", instrument: "USD_JPY", question: "What is the regime?", messages: [], snapshot: { marketRegime: { type: "ranging" } } });
    assert.match(result.answer, /ranging/i);
    assert.equal(submittedBody.instructions, pairChatInstructions);
    assert.match(submittedBody.instructions, /cannot place, change or close an order/i);
    const input = JSON.parse(submittedBody.input);
    assert.equal(input.selectedInstrument, "USD_JPY");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  assert.ok(["trending", "breakout"].includes(result.marketRegime.type));
  assert.equal(result.marketRegime.direction, "bullish");
  assert.ok(result.marketRegime.confidence >= 60);
});

test("identifies volatility compression from completed candles", async () => {
  const { classifyMarketRegime } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  const candles = Array.from({ length: 70 }, (_, index) => {
    const wide = index < 50;
    const range = wide ? 0.004 : 0.0005;
    const centre = 1.1 + Math.sin(index) * range * 0.1;
    return { time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(), open: centre, high: centre + range / 2, low: centre - range / 2, close: centre, complete: true };
  });
  const regime = classifyMarketRegime(candles);
  assert.equal(regime.type, "compression");
  assert.equal(regime.volatility, "low");
  assert.match(regime.playbook, /breakout/i);
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

test("detects clustered support and resistance zones from completed swing points", async () => {
  const { detectSupportResistanceZones } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  const candles = Array.from({ length: 80 }, (_, index) => {
    const centre = 1.1 + Math.sin(index * Math.PI / 4) * 0.004;
    return { time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(), open: centre, high: centre + 0.001, low: centre - 0.001, close: centre, complete: true };
  });
  const zones = detectSupportResistanceZones({ candles, timeframe: "H1", currentPrice: 1.1 });
  assert.ok(zones.some((zone) => zone.kind === "support"));
  assert.ok(zones.some((zone) => zone.kind === "resistance"));
  assert.ok(zones.every((zone) => zone.low < zone.high));
  assert.ok(zones.some((zone) => zone.touches >= 2));
});

test("builds all four pending order types without enabling live execution", async () => {
  const { buildPendingOrderPlans } = await vite.ssrLoadModule("/lib/market-scanner.ts");
  const support = { kind: "support", timeframe: "H4", low: 98, high: 99, midpoint: 98.5, touches: 3, strength: 80, distanceAtr: 1.5 };
  const resistance = { kind: "resistance", timeframe: "H4", low: 103, high: 104, midpoint: 103.5, touches: 3, strength: 80, distanceAtr: 1.5 };
  const longPlans = buildPendingOrderPlans({ bias: "long", price: 101, atr: 1, support, resistance, inside: null, mode: "intraday" });
  const shortPlans = buildPendingOrderPlans({ bias: "short", price: 101, atr: 1, support, resistance, inside: null, mode: "intraday" });
  assert.deepEqual(longPlans.map((plan) => plan.orderType), ["buy_limit", "buy_stop"]);
  assert.deepEqual(shortPlans.map((plan) => plan.orderType), ["sell_limit", "sell_stop"]);
  assert.ok([...longPlans, ...shortPlans].every((plan) => plan.expiry === "4 trigger candles"));
  const blocked = buildPendingOrderPlans({ bias: "long", price: 98.5, atr: 1, support, resistance, inside: support, mode: "intraday" });
  assert.ok(blocked.every((plan) => plan.status === "blocked"));
});
