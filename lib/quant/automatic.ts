import { env } from 'cloudflare:workers';
import { getOandaToken } from '../oanda-secret.ts';
import { historicalData } from './history.ts';
import { oandaHistory } from './oanda-history.ts';
import { historyCache } from './store.ts';
import { discoverStrategies,discoveryObservation,type Discovery } from './discovery.ts';
const db=(env as unknown as {DB:D1Database}).DB;
function parseJson<T>(value:string|null|undefined):T|null { if(!value) return null; try { return JSON.parse(value) as T; } catch { return null; } }
const instruments=['EUR_USD','GBP_USD','USD_JPY'];
async function initialise() {
 await db.prepare("INSERT OR IGNORE INTO quant_automation_settings (id,enabled) VALUES ('primary',1)").run();
 for(const instrument of instruments)await db.prepare('INSERT OR IGNORE INTO quant_automation_jobs (instrument,next_due_at,lease_until) VALUES (?,0,0)').bind(instrument).run();
}
export async function automaticStatus() {
 await initialise();
 const config=await db.prepare("SELECT enabled FROM quant_automation_settings WHERE id='primary'").first<{enabled:number}>();
 const rows=await db.prepare('SELECT * FROM quant_automation_jobs ORDER BY instrument').all<{instrument:string;next_due_at:number;lease_until:number;completed_at:string|null;result_json:string|null;last_error:string|null}>();
 return {enabled:Boolean(config?.enabled),intervalMinutes:60,driver:'Checks run while Foresight is open or when the connected background worker sends a heartbeat. A scheduled Codex task can also trigger checks while the app is running.',jobs:rows.results.map(r=>({instrument:r.instrument,nextDueAt:r.next_due_at,running:r.lease_until>Date.now(),completedAt:r.completed_at,error:r.last_error,result:parseJson<Record<string,any>>(r.result_json)}))};
}
export async function setAutomaticEnabled(enabled:boolean) {
 await initialise();await db.prepare("UPDATE quant_automation_settings SET enabled=? WHERE id='primary'").bind(enabled?1:0).run();
}
export async function claimResearch(now=Date.now()) {
 await initialise();
 const enabled=await db.prepare("SELECT enabled FROM quant_automation_settings WHERE id='primary'").first<{enabled:number}>();
 if(!enabled?.enabled)return null;
 const token=crypto.randomUUID();
 // Upgrade a successful legacy four-strategy result immediately; failures keep
 // their retry delay. New discovery results use the ordinary hourly schedule.
 const row=await db.prepare("UPDATE quant_automation_jobs SET lease_until=?,lease_token=? WHERE instrument=(SELECT instrument FROM quant_automation_jobs WHERE (next_due_at<=? OR (result_json IS NOT NULL AND json_extract(result_json,'$.discovery') IS NULL AND last_error IS NULL)) AND lease_until<=? ORDER BY next_due_at,instrument LIMIT 1) AND lease_until<=? RETURNING instrument").bind(now+300000,token,now,now,now).first<{instrument:string}>();
 return row?{instrument:row.instrument,token}:null;
}
export async function finishResearch(claim:{instrument:string;token:string},result:unknown,error:string|null,now=Date.now()) {
 if(result)await db.prepare('INSERT OR IGNORE INTO quant_automatic_history (id,instrument,created_at,result_json) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM quant_automation_jobs WHERE instrument=? AND lease_token=?)').bind(claim.token,claim.instrument,new Date(now).toISOString(),JSON.stringify(result),claim.instrument,claim.token).run();
 // A timed-out old runner cannot overwrite a newer runner's result.
 await db.prepare('UPDATE quant_automation_jobs SET lease_until=0,lease_token=NULL,next_due_at=?,completed_at=CASE WHEN ? IS NULL THEN ? ELSE completed_at END,result_json=COALESCE(?,result_json),last_error=? WHERE instrument=? AND lease_token=?').bind(now+(error?900000:3600000),error,new Date(now).toISOString(),result?JSON.stringify(result):null,error,claim.instrument,claim.token).run();
}
export async function runAutomaticResearch() {
 const claim=await claimResearch();if(!claim)return {message:'Research is up to date, paused, or already running.'};
 try {
  const connection=await getOandaToken();if(!connection)throw new Error('Connect OANDA to start automatic research.');
  const now=Date.now(),to=Math.floor(now/3600000)*3600000;
  const bars=await historicalData(oandaHistory(connection.token,connection.environment),historyCache,{instrument:claim.instrument,timeframe:'H1',from:to-90*86400000,to});
  const prior=await db.prepare('SELECT result_json FROM quant_automation_jobs WHERE instrument=?').bind(claim.instrument).first<{result_json:string|null}>();
  const previous=parseJson<{discovery?:Discovery;discoveredAt?:number}>(prior?.result_json);
  // Reassess conditions hourly, but search at most once per day and only when
  // there are new completed prices. All candidate definitions remain recorded.
  const reuse=previous?.discovery&&(now-(previous.discoveredAt??0)<86400000||bars.at(-1)!.closeTime<=previous.discovery.to);
  const discovery=reuse?previous!.discovery!:discoverStrategies(claim.instrument,bars);
  const result={...discoveryObservation(discovery,bars,now),discoveredAt:reuse?previous!.discoveredAt:now};
  await finishResearch(claim,result,null);return {message:`Updated ${claim.instrument.replace('_',' / ')} research.`};
 }catch(e){const message=e instanceof Error?e.message:'Automatic research failed.';await finishResearch(claim,null,message);return {message,error:true};}
}
