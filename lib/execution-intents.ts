import { env } from 'cloudflare:workers';
const db=(env as unknown as {DB:D1Database}).DB;
export async function reserveExecution(input: {accountId:string;environment:string;instrument:string;direction:string;signalTime:string;strategyVersion:string;request:unknown}) {
 const key=JSON.stringify([input.accountId,input.environment,input.instrument,input.direction,input.signalTime,input.strategyVersion]);
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
 const id=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
 const result=await db.prepare("INSERT OR IGNORE INTO execution_intents (id,created_at,request_json,status) VALUES (?,?,?,'reserved')").bind(id,new Date().toISOString(),JSON.stringify(input.request)).run();
 if(Number(result.meta.changes)>0)return {id,claimed:true as const,result:null};
 const existing=await db.prepare('SELECT status, result_json FROM execution_intents WHERE id = ?').bind(id).first<{status:string;result_json:string|null}>();
 let saved:unknown=null;
 if(existing?.status==='filled' && existing.result_json) { try { saved=JSON.parse(existing.result_json); } catch { /* Keep replay blocked until broker reconciliation restores the result. */ } }
 return {id,claimed:false as const,result:saved};
}
export async function finishExecution(id:string,status:'filled'|'reconciliation_required',result?:unknown) {
 await db.prepare("UPDATE execution_intents SET status = ?, result_json = ? WHERE id = ? AND status != 'filled'").bind(status,result?JSON.stringify(result):null,id).run();
}
