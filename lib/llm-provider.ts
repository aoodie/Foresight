import { aiEndpoint } from './ai-config.ts';
export type LlmProtocol = 'responses' | 'chat_completions' | 'anthropic';
export const modelRoles = ['fast','reasoning','research','critic','chat'] as const;
export type ModelRole = typeof modelRoles[number];
export function isLlmProtocol(value: unknown): value is LlmProtocol { return value === 'responses' || value === 'chat_completions' || value === 'anthropic'; }
// Normalise transport only. Callers still validate their own structured results.
export async function llmFetch(url: string, init: RequestInit, protocol: LlmProtocol = 'responses'): Promise<Response> {
 const original = JSON.parse(String(init.body)) as { model?:string; instructions?:string; input?:string; max_output_tokens?:number; text?:{format?:{type:string;name:string;strict?:boolean;schema:unknown}} };
 if (protocol !== 'responses' && !original.model?.trim()) throw new Error('Choose an explicit model for this provider.');
 const base = url.replace(/\/responses$/, '');
 let target = url; let body:unknown = original;
 const headers = new Headers(init.headers);
 const format=original.text?.format;
 if (protocol === 'chat_completions') {
  target=aiEndpoint(base,'/chat/completions');
  body={model:original.model,messages:[{role:'system',content:original.instructions??''},{role:'user',content:original.input??''}],max_completion_tokens:original.max_output_tokens??4096,...(format?{response_format:{type:'json_schema',json_schema:{name:format.name,strict:format.strict??true,schema:format.schema}}}:{})};
 }
 if(protocol==='anthropic') {
  target=aiEndpoint(base,'/messages');const key=headers.get('Authorization')?.replace(/^Bearer\s+/i,'');headers.delete('Authorization');headers.set('x-api-key',key??'');headers.set('anthropic-version','2023-06-01');
  body={model:original.model,max_tokens:original.max_output_tokens??4096,system:(original.instructions??'')+(format?`\nReturn only a JSON object matching this schema: ${JSON.stringify(format.schema)}`:''),messages:[{role:'user',content:original.input??''}]};
 }
 let response:Response;
 try { response=await fetch(target,{...init,headers,body:JSON.stringify(body),signal:init.signal??AbortSignal.timeout(60000),redirect:'error'}); }
 catch { throw new Error('The model provider timed out or could not be reached. Your trading rules have not changed.'); }
 if(protocol==='responses'||!response.ok)return response;
 const data=await response.json() as {id?:string;usage?:unknown;choices?:Array<{message?:{content?:string};finish_reason?:string}>;content?:Array<{type?:string;text?:string}>;stop_reason?:string};
 if(data.choices?.[0]?.finish_reason==='length'||data.stop_reason==='max_tokens')throw new Error('The model response was truncated. Choose a model with sufficient output capacity.');
 const output=protocol==='anthropic'?data.content?.filter(c=>c.type==='text').map(c=>c.text??'').join('\n'):data.choices?.[0]?.message?.content;
 return Response.json({id:data.id,usage:data.usage,output:[{content:[{type:'output_text',text:output??''}]}]});
}
