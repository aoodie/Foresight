import { NextResponse } from 'next/server';
import { isOwnerRequest } from '@/lib/owner-request';
import { getAiKey } from '@/lib/ai-secret';
import { llmFetch,modelRoles } from '@/lib/llm-provider';
import { aiEndpoint } from '@/lib/ai-config';
import { parseStructuredOutput } from '@/lib/structured-output';
export async function POST(request:Request){
 if(!(await isOwnerRequest()))return NextResponse.json({error:'Unauthorised'},{status:401});
 try{const body=await request.json();if(!modelRoles.includes(body.role))throw new Error('Choose a model role.');const c=await getAiKey(body.role);if(!c)throw new Error('Save this model connection first.');
 const schema={type:'object',properties:{status:{type:'string',enum:['ok']}},required:['status'],additionalProperties:false};
 const r=await llmFetch(aiEndpoint(c.baseUrl,'/responses'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.apiKey}`},body:JSON.stringify({model:c.model,instructions:'Return a JSON object with status set to ok.',input:'Test the connection only.',max_output_tokens:256,text:{format:{type:'json_schema',name:'connection_test',strict:true,schema}}})},c.protocol);
 if(!r.ok)throw new Error(`Provider returned HTTP ${r.status}. Check the model ID, connection mode and key.`);const data=await r.json() as {output?:Array<{content?:Array<{text?:string}>}>};parseStructuredOutput(data.output?.flatMap(o=>o.content??[]).map(c=>c.text??'').join('')??'',schema);
 return NextResponse.json({message:'Connection passed. This model returned data Foresight can read and validate.'});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Connection test failed.'},{status:400});}
}
