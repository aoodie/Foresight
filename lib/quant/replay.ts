import { marketContext } from "./context.ts";
import { decide } from "./engine.ts";
import type { Bar, Decision, Strategy } from "./types.ts";
export type ResearchTrade = { signal: Decision; entryTime: number; exitTime: number; entry: number; exit: number; initialRisk: number; netR: number; costR: number; exitReason: "TP HIT" | "SL HIT" | "TIME LIMIT" | "END OF DATA" };
export function replay(input: { instrument: string; timeframe: string; bars: readonly Bar[]; strategy: Strategy; costBps: number; fromIndex?: number; toIndex?: number }) {
  if (!Number.isFinite(input.costBps) || input.costBps <= 0 || input.costBps > 100) throw new Error("A positive round-trip execution cost up to 100 bps is required.");
  const context = marketContext({ ...input, asOf: Number.MAX_SAFE_INTEGER, historical: true });
  const bars = context.bars; const trades: ResearchTrade[] = []; const decisions: Decision[] = [];
  let position: { signal: Decision; entry: number; entryTime: number; initialRisk: number; index: number } | null = null;
  let pending: Decision | null = null;
  const end = Math.min(input.toIndex ?? bars.length, bars.length);
  for (let i = input.fromIndex ?? 0; i < end; i++) {
    const bar = bars[i];
    if (pending && !position) {
      const long = pending.action === "long";
      if (pending.stop !== null && pending.target !== null && (long ? pending.stop < bar.open && bar.open < pending.target : pending.target < bar.open && bar.open < pending.stop)) position = { signal: pending, entry: bar.open, entryTime: bar.openTime, initialRisk: Math.abs(bar.open - pending.stop), index: i };
      pending = null;
    }
    if (position) {
      const p = position; const s = p.signal; const long = s.action === "long";
      const stopHit = long ? bar.low <= s.stop! : bar.high >= s.stop!;
      const targetHit = long ? bar.high >= s.target! : bar.low <= s.target!;
      const expiry = i - p.index + 1 >= input.strategy.parameters.maxBars;
      if (stopHit || targetHit || expiry || i === end - 1) {
        const exit = stopHit ? (long ? Math.min(bar.open, s.stop!) : Math.max(bar.open, s.stop!)) : targetHit ? s.target! : bar.close;
        const costR = input.costBps / 10000 * p.entry / p.initialRisk;
        trades.push({ signal: s, entryTime: p.entryTime, exitTime: bar.closeTime, entry: p.entry, exit, initialRisk: p.initialRisk, netR: (long ? 1 : -1) * (exit - p.entry) / p.initialRisk - costR, costR, exitReason: stopHit ? "SL HIT" : targetHit ? "TP HIT" : expiry ? "TIME LIMIT" : "END OF DATA" });
        position = null;
      }
    }
    const decision = decide(marketContext({ ...input, bars: bars.slice(Math.max(0, i + 1 - Math.max(55, input.strategy.parameters.lookback + 2)), i + 1), asOf: bar.closeTime, historical: true }), input.strategy);
    decisions.push(decision);
    if (!position && decision.action !== "wait") pending = decision;
  }
  return { trades, decisions, performance: performance(trades) };
}
export function performance(trades: readonly ResearchTrade[]) {
  let sum = 0, peak = 0, maxDrawdownR = 0;
  for (const t of trades) { sum += t.netR; peak = Math.max(peak, sum); maxDrawdownR = Math.max(maxDrawdownR, peak - sum); }
  return { trades: trades.length, netR: sum, meanR: trades.length ? sum / trades.length : null, maxDrawdownR, winRate: trades.length ? trades.filter((t) => t.netR > 0).length / trades.length : null };
}
