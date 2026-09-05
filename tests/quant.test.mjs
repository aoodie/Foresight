import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType:'custom', configFile:false, root, server:{ middlewareMode:true, hmr:false } });
after(() => vite.close());
const { marketContext, confirmedPivots } = await vite.ssrLoadModule('/lib/quant/context.ts');
const { decide } = await vite.ssrLoadModule('/lib/quant/engine.ts');
const { strategies } = await vite.ssrLoadModule('/lib/quant/registry.ts');
const { replay } = await vite.ssrLoadModule('/lib/quant/replay.ts');
const bars = Array.from({length:220},(_,i)=> { const open=100+i*.02+Math.sin(i/3); const close=open+Math.cos(i)*.4; return {openTime:i*3600000,closeTime:(i+1)*3600000,availableAt:(i+1)*3600000,open,close,high:Math.max(open,close)+.1,low:Math.min(open,close)-.1,complete:true}; });
test('every strategy is prefix consistent and does not access future bars',()=> {
 for (const s of strategies) for (const length of [60,100,150]) {
  const short=marketContext({instrument:'EUR_USD',timeframe:'H1',bars:bars.slice(0,length),asOf:bars[length-1].closeTime});
  const full=marketContext({instrument:'EUR_USD',timeframe:'H1',bars,asOf:bars[length-1].closeTime});
  assert.deepEqual(decide(short,s),decide(full,s));
  assert.deepEqual(replay({instrument:'EUR_USD',timeframe:'H1',bars:bars.slice(0,length),strategy:s,costBps:2}).decisions,replay({instrument:'EUR_USD',timeframe:'H1',bars,strategy:s,costBps:2}).decisions.slice(0,length));
 }
});
test('higher bars and delayed observations are visible only when complete and available',()=> {
 const higher=[{...bars[0],closeTime:4*3600000,availableAt:4*3600000}];
 assert.equal(marketContext({instrument:'EUR_USD',timeframe:'H1',bars,higherBars:higher,asOf:3*3600000}).higherBars.length,0);
 assert.equal(marketContext({instrument:'EUR_USD',timeframe:'H1',bars,higherBars:higher,asOf:4*3600000}).higherBars.length,1);
 const revised=bars.map((b,i)=>i===0?{...b,availableAt:200*3600000}:b);
 assert.equal(marketContext({instrument:'EUR_USD',timeframe:'H1',bars:revised,asOf:3600000}).bars.length,0);
 assert.throws(()=>marketContext({instrument:'EUR_USD',timeframe:'H1',bars:[{...bars[0],availableAt:0}],asOf:3600000}),/backward/);
});
test('pivots appear on confirmation bars and external historical data requires verification',()=> {
 const pivots=confirmedPivots(bars.slice(0,100)); assert.deepEqual(pivots,confirmedPivots(bars).filter(p=>p.confirmedAt<=bars[99].closeTime));
 assert.ok(pivots.every(p=>p.confirmedAt>p.extremeAt));
 const c=marketContext({instrument:'EUR_USD',timeframe:'H1',bars,asOf:bars.at(-1).closeTime,historical:true,external:[{provider:'LuxAlgo',name:'trend',value:1,observedAt:1,availableAt:1,verifiedNonRepainting:false,evidence:''}]});
 assert.equal(c.external.length,0);
 assert.throws(()=>{strategies[0].parameters.lookback=1;},TypeError);
});
test('replay enters after decisions and charges costs',()=>{
 const r=replay({instrument:'EUR_USD',timeframe:'H1',bars,strategy:strategies[2],costBps:2});
 assert.ok(r.trades.length>0); assert.ok(r.trades.every(t=>t.entryTime>=t.signal.asOf&&t.costR>0));
 assert.throws(()=>replay({instrument:'EUR_USD',timeframe:'H1',bars,strategy:strategies[0],costBps:0}),/cost/);
});
