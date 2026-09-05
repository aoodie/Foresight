export type ContractSpec = { unitStep: number; minUnits: number; maxUnits: number; tickSize: number; cashPerPriceUnit: number };
export function sizePosition(input: {equity:number;riskPercent:number;entry:number;stop:number;spec:ContractSpec}) {
 const {spec:s}=input;
 if (![input.equity,input.riskPercent,input.entry,input.stop,s.unitStep,s.minUnits,s.maxUnits,s.tickSize,s.cashPerPriceUnit].every(v=>Number.isFinite(v)&&v>0)||input.riskPercent>2||s.minUnits>s.maxUnits) return null;
 const distance=Math.abs(input.entry-input.stop);if(distance<s.tickSize)return null;
 const budget=input.equity*input.riskPercent/100;
 const units=Math.floor(Math.min(s.maxUnits,budget/(distance*s.cashPerPriceUnit))/s.unitStep + 1e-10)*s.unitStep;
 if(units<s.minUnits)return null;
 return {units,riskAmount:units*distance*s.cashPerPriceUnit,budget,stopDistance:distance};
}
export function portfolioExposure(positions: Array<{instrument:string;riskAmount:number|null}>,equity:number) {
 if(!Number.isFinite(equity)||equity<=0)throw new Error('Account equity is unavailable.');
 const incomplete=positions.some(p=>p.riskAmount===null||!Number.isFinite(p.riskAmount)||p.riskAmount!<0);
 const total=positions.reduce((sum,p)=>sum+(p.riskAmount??0),0);
 const currencies:Record<string,number>={};for(const p of positions)for(const c of new Set(p.instrument.split('_')))currencies[c]=(currencies[c]??0)+(p.riskAmount??0);
 return {complete:!incomplete,totalRiskAmount:total,totalRiskPercent:total/equity*100,sharedCurrencyRisk:Object.entries(currencies).map(([currency,risk])=>({currency,riskPercent:risk/equity*100})), explanation:incomplete?'Some positions have no verified cash risk. Total exposure is incomplete.':'Shared currency exposure is a conservative grouping, not an estimated statistical correlation.'};
}
