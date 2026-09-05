import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getAiKey, saveAiKey } from '@/lib/ai-secret';
import { isOwnerRequest } from '@/lib/owner-request';
import { modelRoles, isLlmProtocol } from '@/lib/llm-provider';
import { normalizeAiBaseUrl } from '@/lib/ai-config';
const db=(env as unknown as {DB:D1Database}).DB;
export async function GET() {
 if(!(await isOwnerRequest()))return NextResponse.json({error:'Unauthorised'},{status:401});
 try { const roles=await Promise.all(modelRoles.map(async role=>{const c=await getAiKey(role);return {role,model:c?.model??'',protocol:c?.protocol??'responses',baseUrl:c?.baseUrl??'',connected:Boolean(c)};}));return NextResponse.json({roles}); }
 catch {return NextResponse.json({error:'Model configuration could not be loaded. Check database and encryption configuration.'},{status:503});}
}
export async function POST(request:Request) {
 if(!(await isOwnerRequest()))return NextResponse.json({error:'Unauthorised'},{status:401});
 try {
  const b=await request.json();if(!modelRoles.includes(b.role)||!isLlmProtocol(b.protocol)||typeof b.model!=='string'||!b.model.trim()||b.model.length>150)throw new Error('Choose a valid role, protocol and model ID.');
  const existing=await getAiKey(b.role);const baseUrl=normalizeAiBaseUrl(b.baseUrl||existing?.baseUrl);
  if(existing?.baseUrl!==baseUrl&&!b.apiKey?.trim())throw new Error('A new provider address requires its own API key. Existing keys are never forwarded to a different provider.');
  if(b.apiKey?.trim())await saveAiKey(b.apiKey.trim(),b.model.trim(),baseUrl,b.role);
  else if(!existing)throw new Error('Connect a provider or enter an API key first.');
  await db.prepare('INSERT INTO model_profiles (role,protocol,model,updated_at) VALUES (?,?,?,?) ON CONFLICT(role) DO UPDATE SET protocol=excluded.protocol, model=excluded.model, updated_at=excluded.updated_at').bind(b.role,b.protocol,b.model.trim(),new Date().toISOString()).run();
  return NextResponse.json({saved:true,message:'Model role saved. Provider availability is checked when it is used.'});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid model configuration.'},{status:400});}
}
