import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { isOwnerRequest } from '@/lib/owner-request';
import { journalInsights } from '@/lib/journal-context';
import { diagnoseJournal, type JournalObservation } from '@/lib/quant/diagnosis';
import { portfolioExposure } from '@/lib/quant/risk';
const db=(env as unknown as {DB:D1Database}).DB;
export async function GET() {
 if(!(await isOwnerRequest()))return NextResponse.json({error:'Unauthorised'},{status:401});
 try {
  const rows=await db.prepare('SELECT j.*,c.context_json FROM trade_journal j LEFT JOIN trade_entry_context c ON j.id=c.journal_id ORDER BY j.created_at DESC LIMIT 5000').all<Record<string,unknown>>();
  const observations:JournalObservation[]=(rows.results??[]).filter(r=>['closed','win','loss','breakeven'].includes(String(r.status))).map(r=>{const i=journalInsights(r);return {id:String(r.id),instrument:String(r.instrument),strategy:String(i.strategyId??r.strategy_name??'Unknown'),version:i.strategyVersion?String(i.strategyVersion):null,regime:i.entryContext.marketRegime?String(i.entryContext.marketRegime):null,timeframe:String(r.style),openedAt:typeof r.opened_at==='string'?r.opened_at:null,pnl:typeof r.pnl==='number'?r.pnl:null,riskAmount:typeof i.entryContext.riskAmount==='number'?i.entryContext.riskAmount:typeof r.risk_amount==='number'?r.risk_amount:null,exitReason:i.exitReason};});
  const [broker,ai,intents,latest,cached]=await Promise.all([db.prepare('SELECT environment,updated_at FROM oanda_connection LIMIT 1').first(),db.prepare('SELECT updated_at FROM ai_connection LIMIT 1').first(),db.prepare("SELECT COUNT(*) AS count FROM execution_intents WHERE status != 'filled'").first<{count:number}>(),db.prepare('SELECT event,message,created_at,level FROM system_logs ORDER BY created_at DESC LIMIT 8').all(),db.prepare('SELECT COUNT(*) AS count FROM quant_history').first<{count:number}>()]);
  const open=(rows.results??[]).filter(r=>r.status==='open');
  const risk=portfolioExposure(open.map(r=>({instrument:String(r.instrument),riskAmount:typeof r.risk_amount==='number'?r.risk_amount:null})),100);
  return NextResponse.json({diagnosis:diagnoseJournal(observations),sampleLimit:5000,risk:{openTrades:open.length,recordedCashRisk:risk.totalRiskAmount,complete:risk.complete,warning:'Cash risk is from recorded entry plans. Refresh the broker account for current equity, currency and exposure; totals across accounts are not combined into a risk percentage.'},system:{database:'available',brokerConfigured:Boolean(broker),broker,modelsConfigured:Boolean(ai),unresolvedExecutions:intents?.count??0,cachedHistoryChunks:cached?.count??0,recentEvents:latest.results??[],checkedAt:new Date().toISOString(),connectionNote:'Configured does not mean reachable. Use dashboard connection checks to verify live access.'}});
 }catch{return NextResponse.json({error:'Platform data is unavailable. Check the database connection and apply the Quant Engine migrations.'},{status:503});}
}
