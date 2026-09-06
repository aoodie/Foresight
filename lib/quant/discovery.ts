import type { Bar,Regime,RulePredicate,RuleSet,Strategy } from './types.ts';
import { replay,performance } from './replay.ts';
import { senseConditions } from './adaptive.ts';
import { marketContext } from './context.ts';
import { decide } from './engine.ts';
const p=(feature:RulePredicate['feature'],op:RulePredicate['op'],value:number):RulePredicate=>({feature,op,value});
const templates:Array<{name:string;reason:string;conditions:Regime[];rules:RuleSet}>=[
 {name:'Recovery through the average',reason:'Price crosses back through its recent average in the direction that average is moving.',conditions:['strong_trend','weak_trend'],rules:{long:[p('previousDistance','lt',0),p('distance','gt',0),p('trend','gt',0)],short:[p('previousDistance','gt',0),p('distance','lt',0),p('trend','lt',0)]}},
 {name:'Reversal after an extended move',reason:'Price is far from its average and the latest period starts moving back toward it.',conditions:['range','weak_trend'],rules:{long:[p('distance','lt',-1),p('body','gt',0)],short:[p('distance','gt',1),p('body','lt',0)]}},
 {name:'Fresh high or low with momentum',reason:'Price finishes beyond its recent boundary while the average moves in the same direction.',conditions:['strong_trend','weak_trend','volatility_expansion'],rules:{long:[p('aboveHigh','gt',0),p('trend','gt',0)],short:[p('aboveLow','lt',0),p('trend','lt',0)]}},
 {name:'Failed move beyond the boundary',reason:'Price crosses a recent extreme, returns inside and finishes moving away from it.',conditions:['range','volatility_expansion'],rules:{long:[p('lowSweep','lt',0),p('aboveLow','gt',0),p('body','gt',0)],short:[p('highSweep','gt',0),p('aboveHigh','lt',0),p('body','lt',0)]}},
 {name:'Short burst with follow-through',reason:'A five-period price move continues with another period in the same direction.',conditions:['strong_trend','weak_trend','compression'],rules:{long:[p('momentum','gt',0.5),p('body','gt',0)],short:[p('momentum','lt',-0.5),p('body','lt',0)]}},
 {name:'Wide reversal toward the average',reason:'An unusually wide price period reverses toward the recent average.',conditions:['volatility_expansion','range'],rules:{long:[p('rangeSize','gt',1.5),p('distance','lt',-0.5),p('body','gt',0)],short:[p('rangeSize','gt',1.5),p('distance','gt',0.5),p('body','lt',0)]}},
];
// A fixed grammar produces combinations of entry rules, confirmation filters,
// lookbacks, stops, targets and holding limits. No generated code is executed.
export function generateCandidates(instrument:string):readonly Strategy[]{
 return Object.freeze(templates.flatMap((t,family)=>[0,1,2,3].map(v=>{
  const extra=v===1?[p('rangeSize','lt',2)]:v===2?[p('rangeSize','gt',0.7)]:[];
  const rules=Object.freeze({long:Object.freeze([...t.rules.long,...extra].map(x=>Object.freeze({...x}))),short:Object.freeze([...t.rules.short,...extra].map(x=>Object.freeze({...x})))});
  return Object.freeze({id:'discovered-rules' as const,version:`grammar-v1.f${family+1}.v${v+1}`,name:`${t.name} · ${v+1}`,ruleSet:rules,parameters:Object.freeze({lookback:[10,20,30,40][v],stopAtr:[1,1.5,2,1.5][v],targetR:[1.5,2,3,2.5][v],maxBars:[12,24,24,36][v]}),markets:Object.freeze([instrument]),timeframes:Object.freeze(['H1']),preferredRegimes:Object.freeze([...t.conditions]),activeRegimes:Object.freeze([...t.conditions]),avoidRegimes:Object.freeze(['news_driven','uncertain'] as Regime[]),entryRules:t.reason+(v===1?' Avoid price periods larger than twice their usual size.':v===2?' Require a price period at least 70% of its usual size.':''),exitRules:`Keep the original stop and target; exit after ${[12,24,24,36][v]} hours if neither is reached.`,invalidation:'The original stop is reached or the holding limit expires.',lifecycle:'research' as const});
 })));
}
const regimes:Regime[]=['strong_trend','weak_trend','range','compression','volatility_expansion'];
export function discoverStrategies(instrument:string,bars:readonly Bar[],costBps=2){
 if(bars.length<800||bars.length>6000)throw new Error('Strategy discovery requires 800–6,000 completed prices.');
 const holdout=Math.floor(bars.length*.8),developmentEnd=holdout-50,midpoint=Math.floor(developmentEnd/2);
 const args={instrument,timeframe:'H1',bars,costBps};
 const candidates=generateCandidates(instrument).map(strategy=>{
  const development=replay({...args,strategy,toIndex:developmentEnd});
  return {strategy,development:development.performance,byCondition:regimes.map(condition=>{
   const rows=development.trades.filter(t=>t.signal.regime===condition),stats=performance(rows);
   const first=rows.filter(t=>t.entryTime<bars[midpoint].closeTime),second=rows.filter(t=>t.entryTime>=bars[midpoint].closeTime);
   return {condition,...stats,stable:first.length>=5&&second.length>=5&&performance(first).netR>0&&performance(second).netR>0,score:stats.trades>=20&&stats.meanR!==null?stats.meanR-stats.maxDrawdownR/stats.trades:null};
  })};
 });
 // Choose one finalist per condition on development data only; testing more
 // alternatives on the reserved period would turn that period into training.
 const finalists=regimes.map(condition=>{
  const choices=candidates.filter(c=>c.strategy.activeRegimes?.includes(condition)&&c.byCondition.some(g=>g.condition===condition&&g.score!==null&&g.stable));
  choices.sort((a,b)=>b.byCondition.find(g=>g.condition===condition)!.score!-a.byCondition.find(g=>g.condition===condition)!.score!);
  const chosen=choices[0];if(!chosen)return {condition,strategy:null,checks:[],performance:null,status:'insufficient_development_evidence' as const};
  const strategy={...chosen.strategy,activeRegimes:[condition],version:`${chosen.strategy.version}.${condition}`};
  const evaluation=replay({...args,strategy,fromIndex:holdout});
  const stressed=replay({...args,strategy,fromIndex:holdout,costBps:costBps*2});
  const checks=[{label:'At least 30 reserved-period trades in this condition',pass:evaluation.performance.trades>=30},{label:'Positive results after estimated costs',pass:evaluation.performance.netR>0},{label:'Positive results when estimated costs double',pass:stressed.performance.netR>0},{label:'Largest decline no greater than 10 times initial risk',pass:evaluation.performance.maxDrawdownR<=10}];
  return {condition,strategy,checks,performance:evaluation.performance,status:checks.every(c=>c.pass)?'awaiting_future_paper_test' as const:'failed_reserved_checks' as const};
 });
 return {instrument,timeframe:'H1',grammarVersion:'grammar-v1',candidateCount:candidates.length,costBps,from:bars[0].openTime,to:bars.at(-1)!.closeTime,holdoutFrom:bars[holdout].openTime,gapBars:50,candidates,finalists,limitations:['Search covers a bounded rule grammar, not every possible strategy.','Twenty-four candidates and up to five condition finalists create selection bias; no statistical significance is claimed.','Overlapping daily history is not independent evidence.','Midpoint prices and estimated costs omit historical news, variable spreads and financing.'],executionEnabled:false};
}
export type Discovery=ReturnType<typeof discoverStrategies>;
export function discoveryObservation(discovery:Discovery,bars:readonly Bar[],now:number){
 const sense=senseConditions(discovery.instrument,'H1',bars,now),chosen=discovery.finalists.find(f=>f.condition===sense.condition);
 const ready=sense.fresh&&sense.stable&&chosen?.status==='awaiting_future_paper_test'&&chosen.strategy;
 return {instrument:discovery.instrument,timeframe:'H1',sense,discovery,recommendation:{strategyId:chosen?.strategy?.id??null,name:chosen?.strategy?.name??null,version:chosen?.strategy?.version??null,status:ready?'paper_candidate':'wait',explanation:!sense.fresh||!sense.stable?sense.explanation:ready?`Discovered ${chosen.strategy!.name} fits current conditions and passed the reserved checks. It still needs a future practice test.`:`No discovered strategy has enough evidence for ${sense.label.toLowerCase()}. Waiting is the current recommendation.`,latest:ready?decide(marketContext({instrument:discovery.instrument,timeframe:'H1',bars,asOf:bars.at(-1)!.closeTime}),chosen.strategy!):null},reports:[],executionEnabled:false,warning:'Discovery creates new rule combinations. Daily searches reuse overlapping prices; a winning test is not proof of an edge. Live trading rules are unchanged.'};
}
