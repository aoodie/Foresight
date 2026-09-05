import { type MarketDataProvider } from "./history.ts";
import { timeframeMs } from "./types.ts";
import type { OandaEnvironment } from "../oanda-api.ts";
export function oandaHistory(token: string, environment: OandaEnvironment): MarketDataProvider {
 return { id: `oanda-${environment}-midpoint-v1`, async fetchHistory(request) {
   const host = environment === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
   const params = new URLSearchParams({ from:new Date(request.from).toISOString(), to:new Date(request.to).toISOString(), granularity:request.timeframe, price:"M", smooth:"false" });
   const response = await fetch(`https://${host}/v3/instruments/${encodeURIComponent(request.instrument)}/candles?${params}`, { headers:{ Authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(20000) });
   if (!response.ok) throw new Error(`Historical data request failed (${response.status}). Check the broker connection.`);
   const data = await response.json() as { candles?: Array<{time:string;complete:boolean;mid:{o:string;h:string;l:string;c:string}}> };
   if (!Array.isArray(data.candles)) throw new Error("Broker returned invalid historical data.");
   return data.candles.filter(b=>b.complete).map(b=> { const openTime=Date.parse(b.time),closeTime=openTime+timeframeMs[request.timeframe]; return { openTime,closeTime,availableAt:closeTime,open:Number(b.mid.o),high:Number(b.mid.h),low:Number(b.mid.l),close:Number(b.mid.c),complete:true }; }).filter(b=>b.openTime>=request.from&&b.closeTime<=request.to);
 } };
}
