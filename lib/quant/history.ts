import { validateBars } from "./context.ts";
import { type Bar, timeframeMs } from "./types.ts";
export type HistoryRequest = { instrument: string; timeframe: string; from: number; to: number };
export interface MarketDataProvider { readonly id: string; fetchHistory(request: HistoryRequest): Promise<readonly Bar[]> }
export interface HistoryCache { read(key: string): Promise<readonly Bar[] | null>; write(key: string, bars: readonly Bar[]): Promise<void> }
export async function historicalData(provider: MarketDataProvider, cache: HistoryCache, request: HistoryRequest) {
  const step = timeframeMs[request.timeframe];
  if (!step || !Number.isFinite(request.from) || !Number.isFinite(request.to) || request.from >= request.to || request.to - request.from > step * 20000) throw new Error("Request a supported timeframe and at most 20,000 bars.");
  const chunk = step * 500, start = Math.floor(request.from / chunk) * chunk;
  const result: Bar[] = [];
  for (let from = start; from < request.to; from += chunk) {
    const to = Math.min(from + chunk, request.to);
    const key = `${provider.id}:${request.instrument}:${request.timeframe}:${from}:${to}`;
    let rows = await cache.read(key);
    if (!rows) {
      rows = await provider.fetchHistory({ ...request, from, to }); validateBars(rows);
      if (rows.some((b) => !b.complete || b.openTime < from || b.closeTime > to)) throw new Error("Provider returned incomplete or out-of-range history.");
      await cache.write(key, rows);
    }
    result.push(...rows.filter((b) => b.openTime >= request.from && b.closeTime <= request.to));
  }
  validateBars(result); return result;
}
export function parseCandleCsv(csv: string, timeframe: string): Bar[] {
  const duration = timeframeMs[timeframe]; if (!duration) throw new Error("Unsupported timeframe.");
  const lines = csv.trim().split(/\r?\n/); if (lines.shift()?.trim() !== "time,open,high,low,close") throw new Error("CSV columns must be time,open,high,low,close.");
  const bars = lines.map((line) => { const [time,o,h,l,c,...extra] = line.split(','); if (extra.length) throw new Error("Unexpected CSV columns."); const openTime = Date.parse(time); return { openTime, closeTime: openTime + duration, availableAt: openTime + duration, open:Number(o), high:Number(h), low:Number(l), close:Number(c), complete:true }; });
  validateBars(bars); return bars;
}
