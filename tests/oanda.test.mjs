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

test("rejects empty OANDA candle payloads", async () => {
  const { normaliseOandaPayload } = await vite.ssrLoadModule("/lib/oanda-api.ts");
  assert.throws(() => normaliseOandaPayload({ candles: [] }), /no usable candles/i);
});
