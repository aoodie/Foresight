import { marketContext } from './context.ts';
import { decide, regimeFor } from './engine.ts';
import { strategies } from './registry.ts';
import { research } from './research.ts';
import { conditionLabel } from '../display-language.ts';
import type { Bar, Regime, Strategy } from './types.ts';

// Fixed, versioned hypotheses, never fitted to the most recent winners.
const conditions: Record<string, readonly Regime[]> = {
 'trend-pullback':['strong_trend','weak_trend'],
 'range-breakout':['compression','weak_trend','volatility_expansion'],
 'liquidity-reclaim':['range'],
 'imbalance-continuation':['strong_trend','volatility_expansion'],
};
export const adaptiveStrategies: readonly Strategy[] = Object.freeze(strategies.map(s=>Object.freeze({...s,version:`${s.version}-conditions-v1`,activeRegimes:Object.freeze([...conditions[s.id]])})));
export function senseConditions(instrument: string, timeframe: string, bars: readonly Bar[], now: number) {
 const visible=bars.filter(b=>b.complete&&b.closeTime<=now&&b.availableAt<=now);
 const recent=visible.slice(-3).map(b=>regimeFor(marketContext({instrument,timeframe,bars:visible,asOf:b.closeTime})));
 const current=recent.at(-1)??'uncertain',stable=recent.length===3&&recent.every(r=>r===current);
 const fresh=Boolean(visible.length&&now-visible.at(-1)!.closeTime<2*3600000);
 return {condition:current,label:conditionLabel(current),stable,fresh,asOf:visible.at(-1)?.closeTime??null,explanation:!fresh?'Waiting for fresh completed prices.':!stable?'Conditions are changing. Wait until three completed price periods agree.':`The last three completed price periods agree: ${conditionLabel(current).toLowerCase()}.`};
}
export function adaptiveResearch(instrument:string,bars:readonly Bar[],now:number,costBps=2) {
 const timeframe='H1',sense=senseConditions(instrument,timeframe,bars,now);
 const reports=adaptiveStrategies.map(strategy=>research({instrument,timeframe,bars,strategy,costBps}));
 // Never rank candidates using the reserved final evaluation period.
 const suitable=reports.filter(r=>r.strategy.activeRegimes?.includes(sense.condition));
 const ranked=[...suitable].sort((a,b)=>b.folds.reduce((s,f)=>s+f.performance.netR,0)-a.folds.reduce((s,f)=>s+f.performance.netR,0));
 const selected=ranked[0];
 const evidence=selected?.byRegime.find(g=>g.condition===sense.condition);
 const ready=Boolean(sense.stable&&sense.fresh&&selected?.checks.every(c=>c.pass)&&evidence&&evidence.trades>=30&&evidence.netR>0);
 const latest=ready&&selected?decide(marketContext({instrument,timeframe,bars,asOf:bars.at(-1)!.closeTime}),selected.candidate):null;
 const summaries=reports.map(({trades,...report})=>({...report,recordedTrades:trades.length}));
 return {instrument,timeframe,sense,reports:summaries,recommendation:{strategyId:selected?.strategy.id??null,name:selected?.strategy.name??null,version:selected?.candidate.version??null,status:ready?'paper_candidate':'wait',explanation:!sense.fresh||!sense.stable?sense.explanation:!selected?'No research strategy currently fits these conditions.':ready?`${selected.strategy.name} fits these conditions and passed the reserved checks. A future practice test is the next step.`:`${selected.strategy.name} fits the condition hypothesis, but has not earned a practice recommendation from the available evidence.`,latest},executionEnabled:false,warning:'Hourly reports use overlapping history. They are monitoring updates, not independent tests or proof of improvement. Historical news and variable spreads are not measured. No live rules are changed.'};
}
