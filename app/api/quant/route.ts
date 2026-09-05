import { NextResponse } from 'next/server';
import { isOwnerRequest } from '@/lib/owner-request';
import { getOandaToken } from '@/lib/oanda-secret';
import { strategies, strategyById } from '@/lib/quant/registry';
import { historicalData, parseCandleCsv } from '@/lib/quant/history';
import { oandaHistory } from '@/lib/quant/oanda-history';
import { historyCache, researchHistory, saveResearch } from '@/lib/quant/store';
import { research } from '@/lib/quant/research';
import { marketContext } from '@/lib/quant/context';
import { decide } from '@/lib/quant/engine';
import { type Bar, timeframeMs } from '@/lib/quant/types';

export async function GET() {
 if (!(await isOwnerRequest())) return NextResponse.json({error:'Unauthorised'},{status:401});
 try { return NextResponse.json({ strategies, runs:await researchHistory(), engineVersion:'1.0.0', liveExecution:false }); }
 catch { return NextResponse.json({strategies,runs:[],error:'Research storage is not ready. Apply the database migrations before running research.'},{status:503}); }
}
export async function POST(request:Request) {
 if (!(await isOwnerRequest())) return NextResponse.json({error:'Unauthorised'},{status:401});
 try {
  const text=await request.text(); if(text.length>3_000_000) return NextResponse.json({error:'Dataset exceeds 3 MB.'},{status:413});
  const body=JSON.parse(text) as {instrument:string;timeframe:string;strategyId:string;version?:string;costBps:number;bars?:Bar[];csv?:string;days?:number};
  const strategy=strategyById(body.strategyId,body.version);
  if(!strategy.markets.includes(body.instrument)||!strategy.timeframes.includes(body.timeframe)) throw new Error('Choose a supported market and timeframe.');
  if(!Number.isFinite(body.costBps)||body.costBps<=0||body.costBps>50) throw new Error('Specify round-trip costs between 0 and 50 bps.');
  let bars:readonly Bar[]; let source:string;
  if(body.bars||body.csv) { bars=body.csv?parseCandleCsv(body.csv,body.timeframe):body.bars!;source='User import; price provenance not independently verified'; }
  else {
   const connection=await getOandaToken();if(!connection) throw new Error('Connect OANDA or import a completed-candle file.');
   const days=body.days??90;if(!Number.isInteger(days)||days<7||days>180)throw new Error('History range must be 7–180 days.');
   const step=timeframeMs[body.timeframe],to=Math.floor(Date.now()/step)*step,from=to-days*86400000;
   bars=await historicalData(oandaHistory(connection.token,connection.environment),historyCache,{instrument:body.instrument,timeframe:body.timeframe,from,to});source='OANDA unsmoothed midpoint candles, UTC';
  }
  if(bars.some(b=>b.closeTime>Date.now())) throw new Error('Future-dated candles are not accepted.');
  const report=research({instrument:body.instrument,timeframe:body.timeframe,bars,strategy,costBps:body.costBps});
  const latest=decide(marketContext({instrument:body.instrument,timeframe:body.timeframe,bars,asOf:bars.at(-1)!.closeTime}),strategy);
  return NextResponse.json(await saveResearch({...report,source,latest},bars));
 } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:'Research failed. Check data and connection.'},{status:400}); }
}
