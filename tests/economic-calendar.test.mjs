import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = new URL("..", import.meta.url).pathname;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });

test("blocks only events inside the correct before/after window", async () => {
  const { isWithinNewsWindow } = await vite.ssrLoadModule("/lib/economic-calendar.ts");
  assert.equal(isWithinNewsWindow({ phase: "before", minutesUntil: 5, minutesSince: 0 }), true);
  assert.equal(isWithinNewsWindow({ phase: "after", minutesUntil: 0, minutesSince: 5 }), true);
  assert.equal(isWithinNewsWindow({ phase: "before", minutesUntil: 45, minutesSince: 0 }), false);
  assert.equal(isWithinNewsWindow({ phase: "after", minutesUntil: 0, minutesSince: 45 }), false);
  assert.equal(isWithinNewsWindow({ phase: null, minutesUntil: 0, minutesSince: 0 }), false);
});

after(async () => vite.close());
