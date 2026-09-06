// Validator for the schema vocabulary used by Foresight's AI contracts.
type Schema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; minItems?: number; maxItems?: number; minimum?: number; maximum?: number };
export function parseStructuredOutput(text: string, schema: Schema): unknown {
 const trimmed = text.trim(), fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
 let value: unknown;
 try { value = JSON.parse(fenced ? fenced[1] : trimmed); }
 catch { throw new Error('The model did not return complete JSON. Try basic JSON mode or a different model. No trade decision was accepted.'); }
 function check(v: unknown, s: Schema, path: string, depth: number) {
  if(depth>20)throw new Error('Model output is too deeply nested.');
  const type=v===null?'null':Array.isArray(v)?'array':typeof v;
  if(s.type&&!(Array.isArray(s.type)?s.type:[s.type]).includes(type))throw new Error(`Invalid model value at ${path}.`);
  if(s.enum&&!s.enum.includes(v))throw new Error(`Unsupported model choice at ${path}.`);
  if(typeof v==='number'&&(!Number.isFinite(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))throw new Error(`Model value outside allowed range at ${path}.`);
  if(Array.isArray(v)) {
   if(v.length<(s.minItems??0)||v.length>(s.maxItems??10000))throw new Error(`Invalid number of model items at ${path}.`);
   if(s.items)v.forEach((item,i)=>check(item,s.items!,`${path}[${i}]`,depth+1));
  } else if(v!==null&&typeof v==='object') {
   const obj=v as Record<string,unknown>;
   for(const key of s.required??[])if(!Object.hasOwn(obj,key))throw new Error(`Model output missing ${path}.${key}.`);
   for(const [key,val] of Object.entries(obj)) {
    if(s.properties&&Object.hasOwn(s.properties,key))check(val,s.properties[key],`${path}.${key}`,depth+1);
    else if(s.additionalProperties===false)throw new Error(`Unexpected model field at ${path}.${key}.`);
   }
  }
 }
 check(value,schema,'response',0);return value;
}
