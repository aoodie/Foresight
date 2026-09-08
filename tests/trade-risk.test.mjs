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

test("calculates USDJPY cash risk using the broker loss conversion factor", async () => {
  const { calculateRiskSizedUnits, positionRiskAmount, standardLots } = await vite.ssrLoadModule("/lib/trade-risk.ts");
  const sizing = calculateRiskSizedUnits({ equity: 100_000, riskPercent: 0.5, stopDistance: 0.2, lossConversionFactor: 0.0067, maxUnits: 1_000_000 });
  assert.equal(sizing.units, 373_134);
  assert.ok(positionRiskAmount({ units: sizing.units, stopDistance: 0.2, lossConversionFactor: 0.0067 }) <= 500);
  assert.equal(standardLots("USD_JPY", 100_000), 1);
  assert.equal(standardLots("XAU_USD", 100), null);
});
test('JPY previews agree with broker-unit sizing across account currencies and directions',async()=>{
 const {riskSizedOrderPreview,calculateRiskSizedUnits,formatPositionSize}=await vite.ssrLoadModule('/lib/trade-risk.ts');
 const time='2026-09-07T10:00:00Z',now=Date.parse(time);
 for(const instrument of ['USD_JPY','EUR_JPY','GBP_JPY']) for(const conversion of [1/150,1/195,1]) for(const direction of ['long','short']) {
  const entry=150,stop=direction==='long'?149.5:150.5,target=direction==='long'?151:149;
  const quote={instrument,time,bid:entry,ask:entry,tradeable:true,homeConversionFactors:{negativeUnits:conversion,positiveUnits:conversion}};
  const preview=riskSizedOrderPreview({instrument,direction,equity:10000,riskPercent:0.5,stop,target,quote,now});
  const backend=calculateRiskSizedUnits({equity:10000,riskPercent:0.5,stopDistance:.5,lossConversionFactor:conversion});
  assert.equal(preview.units,backend.units);assert.equal(preview.lots,backend.units/100000);assert.equal(preview.stopPips,50);assert.ok(preview.actualRisk<=50);
  assert.equal(riskSizedOrderPreview({instrument,direction,equity:10000,riskPercent:.5,stop,target,quote:{...quote,instrument:'EUR_USD'},now}),null);
  assert.equal(riskSizedOrderPreview({instrument,direction,equity:10000,riskPercent:.5,stop,target,quote,now:now+61000}),null);
 }
 assert.equal(formatPositionSize('USD_JPY',123),'0.00123 lots · 123 units');
 assert.equal(formatPositionSize('EUR_JPY',-125000),'1.25 lots · 125,000 units');
});
test('JPY pricing uses its matching quote and JPY home conversion',async()=>{
 const {normaliseOandaPrice}=await vite.ssrLoadModule('/lib/oanda-api.ts');
 const quote=(instrument,bid,ask)=>({instrument,time:'2026-09-07T10:00:00Z',tradeable:true,bids:[{price:String(bid)}],asks:[{price:String(ask)}]});
 const payload={prices:[quote('EUR_USD',1.1,1.1001),quote('USD_JPY',150,150.01)],homeConversions:[{currency:'USD',accountGain:'0.8',accountLoss:'0.81'},{currency:'JPY',accountGain:'0.005',accountLoss:'0.0051'}]};
 const price=normaliseOandaPrice(payload,'USD_JPY');assert.equal(price.bid,150);assert.equal(price.homeConversionFactors.negativeUnits,.0051);
 assert.throws(()=>normaliseOandaPrice(payload,'EUR_JPY'),/usable live quote/);
});

test("keeps a daily or weekly size fixed and blocks it when current risk is too high", async () => {
  const { positionSizeLockPeriod, resolveLockedPositionSize } = await vite.ssrLoadModule("/lib/trade-risk.ts");
  const date = new Date("2026-08-30T20:00:00.000Z");
  assert.equal(positionSizeLockPeriod("daily", date), "2026-08-30");
  assert.equal(positionSizeLockPeriod("weekly", date), "2026-08-24-week");
  assert.deepEqual(resolveLockedPositionSize({ riskSafeUnits: 50_000 }), { ok: true, units: 50_000, created: true });
  assert.deepEqual(resolveLockedPositionSize({ riskSafeUnits: 60_000, lockedUnits: 50_000 }), { ok: true, units: 50_000, created: false });
  assert.equal(resolveLockedPositionSize({ riskSafeUnits: 40_000, lockedUnits: 50_000 }).ok, false);
});
