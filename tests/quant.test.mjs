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
const { observeLiveStrategies } = await vite.ssrLoadModule('/lib/quant/live.ts');
const {senseConditions,adaptiveStrategies}=await vite.ssrLoadModule('/lib/quant/adaptive.ts');
const {generateCandidates,discoverStrategies,discoveryObservation}=await vite.ssrLoadModule('/lib/quant/discovery.ts');
const bars = Array.from({length:220},(_,i)=> { const open=100+i*.02+Math.sin(i/3); const close=open+Math.cos(i)*.4; return {openTime:i*3600000,closeTime:(i+1)*3600000,availableAt:(i+1)*3600000,open,close,high:Math.max(open,close)+.1,low:Math.min(open,close)-.1,complete:true}; });
test('live research observations equal replay decisions and ignore unfinished candles',()=> {
 const candles=bars.map(b=>({...b,time:new Date(b.openTime).toISOString()}));
 const observed=observeLiveStrategies('EUR_USD','H1',[...candles,{...candles.at(-1),time:new Date(bars.at(-1).closeTime).toISOString(),complete:false,close:999}]);
 for (const [index,strategy] of strategies.entries()) assert.deepEqual(observed[index],replay({instrument:'EUR_USD',timeframe:'H1',bars,strategy,costBps:2}).decisions.at(-1));
});
test('every strategy is prefix consistent and does not access future bars',()=> {
 for (const s of [...strategies,...adaptiveStrategies,...generateCandidates('EUR_USD')]) for (const length of [60,100,150]) {
  const short=marketContext({instrument:'EUR_USD',timeframe:'H1',bars:bars.slice(0,length),asOf:bars[length-1].closeTime});
  const full=marketContext({instrument:'EUR_USD',timeframe:'H1',bars,asOf:bars[length-1].closeTime});
  assert.deepEqual(decide(short,s),decide(full,s));
  assert.deepEqual(replay({instrument:'EUR_USD',timeframe:'H1',bars:bars.slice(0,length),strategy:s,costBps:2}).decisions,replay({instrument:'EUR_USD',timeframe:'H1',bars,strategy:s,costBps:2}).decisions.slice(0,length));
 }
});
test('adaptive conditions ignore future bars and refuse stale snapshots',()=>{
 const now=bars[99].closeTime;
 assert.deepEqual(senseConditions('EUR_USD','H1',bars,now),senseConditions('EUR_USD','H1',bars.slice(0,100),now));
 assert.equal(senseConditions('EUR_USD','H1',bars,bars.at(-1).closeTime+3*3600000).fresh,false);
 for(const strategy of adaptiveStrategies){const c=marketContext({instrument:'EUR_USD',timeframe:'H1',bars,asOf:bars.at(-1).closeTime});const d=decide(c,strategy);if(!strategy.activeRegimes.includes(d.regime))assert.equal(d.action,'wait');}
});
test('discovery generates immutable rule combinations and selection cannot see reserved prices',()=>{
 const candidates=generateCandidates('EUR_USD');assert.equal(candidates.length,24);assert.equal(new Set(candidates.map(c=>c.version)).size,24);
 assert.ok(candidates.every(c=>c.ruleSet.long.length>=2&&c.ruleSet.short.length>=2));
 assert.throws(()=>{candidates[0].ruleSet.long[0].value=999;},TypeError);
 const history=Array.from({length:1000},(_,i)=>{const open=100+Math.sin(i/12)*3+i*.005,close=open+Math.cos(i/5)*.4;return {openTime:i*3600000,closeTime:(i+1)*3600000,availableAt:(i+1)*3600000,open,close,high:Math.max(open,close)+.2,low:Math.min(open,close)-.2,complete:true};});
 const changed=history.map((b,i)=>i<800?b:{...b,open:b.open+40,close:b.close+40,high:b.high+40,low:b.low+40});
 const a=discoverStrategies('EUR_USD',history),b=discoverStrategies('EUR_USD',changed);
 assert.deepEqual(a.candidates,b.candidates);
 assert.deepEqual(a.finalists.map(f=>f.strategy?.version),b.finalists.map(f=>f.strategy?.version));
 const observed=discoveryObservation(a,history,history.at(-1).closeTime+3*3600000);
 assert.equal(observed.recommendation.status,'wait');assert.equal(observed.recommendation.latest,null);assert.equal(a.executionEnabled,false);
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
test('historical cache fetches only uncached chunks and CSV validates ordering',async()=>{
 const { historicalData, parseCandleCsv }=await vite.ssrLoadModule('/lib/quant/history.ts');
 let calls=0;const store=new Map();const cache={async read(k){return store.get(k)??null;},async write(k,v){store.set(k,v);}};
 const provider={id:'test',async fetchHistory(r){calls++;return bars.filter(b=>b.openTime>=r.from&&b.closeTime<=r.to);}};
 const query={instrument:'EUR_USD',timeframe:'H1',from:0,to:220*3600000};
 assert.equal((await historicalData(provider,cache,query)).length,220); await historicalData(provider,cache,query);assert.equal(calls,1);
 assert.throws(()=>parseCandleCsv('time,open,high,low,close\n2020-01-01,1,2,0,1','H1'),/Invalid/);
});
test('research candidate selection cannot observe final holdout returns',async()=>{
 const {research}=await vite.ssrLoadModule('/lib/quant/research.ts');
 const many=Array.from({length:1000},(_,i)=>({...bars[i%bars.length],openTime:i*3600000,closeTime:(i+1)*3600000,availableAt:(i+1)*3600000}));
 const base={instrument:'EUR_USD',timeframe:'H1',bars:many,strategy:strategies[2],costBps:2};
 const first=research(base); const changed=research({...base,bars:many.map((b,i)=>i<800?b:{...b,close:b.open+1,high:b.open+2})});
 assert.deepEqual(first.candidate,changed.candidate);assert.deepEqual(first.folds,changed.folds);assert.equal(first.executionEnabled,false);
});
test('risk sizing respects JPY conversion, minimums and broker increments',async()=>{
 const {sizePosition,portfolioExposure}=await vite.ssrLoadModule('/lib/quant/risk.ts');
 const sized=sizePosition({equity:10000,riskPercent:1,entry:150,stop:149,spec:{unitStep:100,minUnits:100,maxUnits:100000,tickSize:.001,cashPerPriceUnit:1/150}});
 assert.equal(sized.units,15000);assert.equal(sized.riskAmount,100);
 assert.equal(sizePosition({equity:1,riskPercent:1,entry:150,stop:149,spec:{unitStep:100,minUnits:100,maxUnits:100000,tickSize:.001,cashPerPriceUnit:1/150}}),null);
 assert.equal(portfolioExposure([{instrument:'USD_JPY',riskAmount:null}],10000).complete,false);
});
