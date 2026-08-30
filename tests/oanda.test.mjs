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
