import type { Bar, Strategy } from "./types.ts";
import { replay, performance, type ResearchTrade } from "./replay.ts";
export function groupedPerformance(trades: readonly ResearchTrade[], field: "regime" | "instrument" | "timeframe" | "session") {
  const groups: Record<string, ResearchTrade[]> = {};
  for (const t of trades) { const hour = new Date(t.entryTime).getUTCHours(); const key = field === "session" ? (hour < 7 ? "00–07 UTC" : hour < 13 ? "07–13 UTC" : hour < 21 ? "13–21 UTC" : "21–24 UTC") : String(t.signal[field]); (groups[key] ??= []).push(t); }
  return Object.entries(groups).map(([condition,rows])=>({ condition, ...performance(rows) }));
}
export function research(input: { instrument: string; timeframe: string; bars: readonly Bar[]; strategy: Strategy; costBps: number }) {
  if (input.bars.length < 800 || input.bars.length > 6000) throw new Error("Research requires 800–6,000 completed bars.");
  const end = input.bars.length, holdout = Math.floor(end*.8), initial = Math.floor(end*.4), gap = 50;
  const candidates = [10,20,40].map(lookback=>({...input.strategy, version:`${input.strategy.version}-candidate-lookback-${lookback}`, parameters:{...input.strategy.parameters,lookback} }));
  const score = (s: Strategy, toIndex: number) => { const p=replay({...input,strategy:s,toIndex}).performance; return p.trades >= 20 && p.meanR !== null ? p.meanR - p.maxDrawdownR/Math.max(20,p.trades) : -Infinity; };
  const choose=(end:number)=>candidates.reduce((best,s)=>score(s,end)>score(best,end)?s:best,candidates[0]);
  const folds=Array.from({length:3},(_,i)=>{ const from=initial+Math.floor((holdout-initial)*i/3), to=initial+Math.floor((holdout-initial)*(i+1)/3); const chosen=choose(from-gap); return { from:input.bars[from].closeTime,to:input.bars[to-1].closeTime,version:chosen.version,performance:replay({...input,strategy:chosen,fromIndex:from,toIndex:to}).performance }; });
  const chosen=choose(holdout-gap);
  const champion=replay({...input,fromIndex:holdout});
  const candidate=replay({...input,strategy:chosen,fromIndex:holdout});
  const stressed=replay({...input,strategy:chosen,fromIndex:holdout,costBps:input.costBps*2});
  const checks=[{ label:"At least 30 unseen trades",pass:candidate.performance.trades>=30 },{label:"Positive unseen performance",pass:candidate.performance.netR>0},{label:"Improves on existing strategy",pass:candidate.performance.netR>champion.performance.netR},{label:"No worse drawdown",pass:candidate.performance.maxDrawdownR<=champion.performance.maxDrawdownR},{label:"Still profitable at double cost",pass:stressed.performance.netR>0},{label:"Positive in at least two forward windows",pass:folds.filter(f=>f.performance.netR>0).length>=2}];
  const byRegime=groupedPerformance(candidate.trades,"regime");
  return { strategy:input.strategy, candidate:chosen, instrument:input.instrument,timeframe:input.timeframe,bars:end,from:input.bars[0].openTime,to:input.bars.at(-1)!.closeTime,holdoutFrom:input.bars[holdout].openTime,costBps:input.costBps,gapBars:gap, folds, champion:champion.performance,performance:candidate.performance,stress:stressed.performance,checks,byRegime,bySession:groupedPerformance(candidate.trades,"session"),decision:checks.every(c=>c.pass)?"Recommend a prospective paper test":"Keep the existing strategy; candidate has not earned promotion", diagnosis:candidate.performance.trades<30?"Not enough independent completed trades to judge this candidate.":candidate.performance.netR<0?"The candidate lost money after estimated costs. Review the condition groups before changing rules.":"Positive on this sample; verify it on fresh future data before changing any live strategy.",hypothesis:"A different lookback may reduce poorly timed entries. Candidate lookbacks were chosen using training data only.",notMeasured:["Historical news impact","Broker liquidity and variable spreads","Financing and account-currency conversion","Statistical significance under repeated trials"], trades:candidate.trades,executionEnabled:false };
}
