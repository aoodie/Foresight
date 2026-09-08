import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,server:{middlewareMode:true,hmr:false}});
after(()=>vite.close());
test('API guard requires the configured owner and rejects cross-site writes',async()=>{
 const {requestProblem}=await vite.ssrLoadModule('/lib/request-security.ts');
 const request=(headers={})=>new Request('https://foresight.example/api/journal',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-email':'owner@example.com',...headers},body:'{}'});
 assert.equal(requestProblem(request(),'owner@example.com'),null);
 assert.equal(requestProblem(request(),undefined).status,401);
 assert.equal(requestProblem(request(),'other@example.com').status,401);
 assert.equal(requestProblem(request({origin:'https://evil.example'}),'owner@example.com').status,403);
 assert.equal(requestProblem(request({'sec-fetch-site':'cross-site'}),'owner@example.com').status,403);
 assert.equal(requestProblem(request({'content-type':'text/plain'}),'owner@example.com').status,415);
});
test('streamed request limit works without trusting Content-Length',async()=>{
 const {boundedBody,privateResponse}=await vite.ssrLoadModule('/lib/request-security.ts');
 const make=()=>new Request('https://example.com',{method:'POST',body:'abcdef'});
 assert.equal(new TextDecoder().decode(await boundedBody(make(),6)),'abcdef');
 await assert.rejects(boundedBody(make(),5),/too large/);
 const response=privateResponse(Response.json({ok:true}));
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});
test('journal accepts actual UI markets and scalping, rejects invalid values and dates',async()=>{
 const {journalCreateSchema,journalUpdateSchema}=await vite.ssrLoadModule('/lib/journal-validation.ts');
 const entry={instrument:'XAU_USD',direction:'long',style:'scalping',entryPrice:2500,metadata:{strategyVersion:'1.0.0'}};
 assert.equal(journalCreateSchema.safeParse(entry).success,true);
 assert.equal(journalCreateSchema.safeParse({...entry,instrument:'US30_USD'}).success,true);
 for(const invalid of [{entryPrice:-1},{riskPercent:Infinity},{direction:'buy'},{metadata:'bad'},{status:'invented'},{openedAt:'yesterday'},{notes:'x'.repeat(8001)},{openedAt:'2026-09-02T00:00:00Z',closedAt:'2026-09-01T00:00:00Z'}]) assert.equal(journalCreateSchema.safeParse({...entry,...invalid}).success,false);
 assert.equal(journalUpdateSchema.safeParse({id:'a',pnl:NaN}).success,false);
 assert.equal(journalUpdateSchema.safeParse({id:'a',status:'garbage'}).success,false);
});
test('provider URLs reject plaintext, credentials, local hosts and encoded IP forms',async()=>{
 const {normalizeAiBaseUrl}=await vite.ssrLoadModule('/lib/ai-config.ts');
 assert.equal(normalizeAiBaseUrl('https://api.example.com/v1/'),'https://api.example.com/v1');
 for(const url of ['http://api.example.com','https://localhost','https://127.1','https://0x7f000001','https://[::1]','https://metadata.internal','https://user:secret@api.example.com','https://api.example.com?a=b']) assert.throws(()=>normalizeAiBaseUrl(url));
});
test('research rejects overlaps, incomplete bars, corrupt cache and timezone-free CSV',async()=>{
 const {validateBars}=await vite.ssrLoadModule('/lib/quant/context.ts');
 const {historicalData,parseCandleCsv}=await vite.ssrLoadModule('/lib/quant/history.ts');
 const {dataQuality}=await vite.ssrLoadModule('/lib/quant/data-quality.ts');
 const bar={openTime:0,closeTime:3600000,availableAt:3600000,open:1,high:1.2,low:.9,close:1.1,complete:true};
 assert.throws(()=>validateBars([bar,{...bar,openTime:100,closeTime:3600100,availableAt:3600100}]),/overlapping/);
 assert.throws(()=>dataQuality([{...bar,complete:false}],'H1'),/complete/);
 assert.throws(()=>parseCandleCsv('time,open,high,low,close\n2026-09-01T10:00:00,1,1.2,.9,1.1','H1'),/timezone/);
 await assert.rejects(historicalData({id:'test',fetchHistory:()=>{throw new Error('should not fetch');}},{read:async()=>[{...bar,complete:false}],write:async()=>{}},{instrument:'EUR_USD',timeframe:'H1',from:0,to:3600000}),/Cached history/);
 assert.equal(dataQuality([bar,{...bar,openTime:7200000,closeTime:10800000,availableAt:10800000}],'H1').gaps[0].missingPeriods,1);
});
test('broker fills count transaction P&L once and order requests have deadlines',async()=>{
 const {submitOandaMarketOrder,normaliseOandaPrice}=await vite.ssrLoadModule('/lib/oanda-api.ts');
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async(_url,init)=>{assert.ok(init.signal);assert.equal(init.redirect,'manual');return Response.json({orderFillTransaction:{id:'1',pl:'25',tradesClosed:[{tradeID:'2',realizedPL:'25'}]}});};
  const fill=await submitOandaMarketOrder({token:'fake',environment:'practice',accountId:'a',instrument:'EUR_USD',units:100});
  assert.equal(fill.realisedPnl,25);
  assert.throws(()=>normaliseOandaPrice({prices:[{time:'2026-09-01T00:00:00Z',bids:[{price:'2'}],asks:[{price:'1'}]}]},'EUR_USD'),/usable live quote/);
 } finally {globalThis.fetch=original;}
});
test('model transport rejects incomplete responses and hides upstream error content',async()=>{
 const {llmFetch}=await vite.ssrLoadModule('/lib/llm-provider.ts');
 const original=globalThis.fetch,init={method:'POST',body:JSON.stringify({model:'test'})};
 try {
  globalThis.fetch=async()=>Response.json({status:'incomplete',output:[]});
  await assert.rejects(llmFetch('https://api.example.com/responses',init),/complete response/);
  globalThis.fetch=async()=>Response.json({error:{message:'secret echoed by upstream'}},{status:401});
  const result=await llmFetch('https://api.example.com/responses',init);
  assert.equal(result.status,401);assert.ok(!(await result.text()).includes('secret echoed'));
 } finally {globalThis.fetch=original;}
});
