import type { MarketContext, RuleFeature, RuleSet } from './types.ts';
export function ruleValues(context:MarketContext,lookback:number,atr:number):Record<RuleFeature,number> {
 const c=context.bars,last=c.at(-1)!,previous=c.at(-2)!;
 const window=c.slice(-lookback-1,-1),older=c.slice(-lookback-2,-2);
 const mean=window.reduce((s,b)=>s+b.close,0)/window.length;
 const oldMean=older.reduce((s,b)=>s+b.close,0)/older.length;
 const high=Math.max(...window.map(b=>b.high)),low=Math.min(...window.map(b=>b.low));
 return {distance:(last.close-mean)/atr,previousDistance:(previous.close-oldMean)/atr,trend:(mean-oldMean)/atr,momentum:(last.close-c.at(-6)!.close)/atr,aboveHigh:(last.close-high)/atr,aboveLow:(last.close-low)/atr,lowSweep:(last.low-low)/atr,highSweep:(last.high-high)/atr,body:(last.close-last.open)/atr,rangeSize:(last.high-last.low)/atr};
}
export function evaluateRules(rules:RuleSet,values:Record<RuleFeature,number>):number {
 const matches=(side:RuleSet['long'])=>side.length>=2&&side.length<=5&&side.every(p=>Number.isFinite(p.value)&&Number.isFinite(values[p.feature])&&(p.op==='gt'?values[p.feature]>p.value:values[p.feature]<p.value));
 const long=matches(rules.long),short=matches(rules.short);
 return long===short?0:long?1:-1;
}
