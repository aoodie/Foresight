import type { JournalRecordInput } from "./trading-records";
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function entryContext(input: JournalRecordInput) {
  const m = object(input.metadata), selected = object(m.selectedStrategy);
  const version = typeof m.strategyVersion === "string" ? m.strategyVersion : null;
  const id = typeof m.strategyId === "string" ? m.strategyId : typeof selected.id === "string" ? `scanner/${selected.id}` : null;
  const instance = typeof m.strategyInstance === "string" ? m.strategyInstance : id && version ? `${id}@${version}:${input.style}` : null;
  const regime = object(m.marketRegime);
  return { strategyId: id, strategyVersion: version, strategyInstance: instance, strategyName: input.strategyName ?? null, marketRegime: typeof regime.type === "string" ? regime.type : typeof m.marketRegime === "string" ? m.marketRegime : null, marketExplanation: typeof regime.explanation === "string" ? regime.explanation : null, setupScore: typeof m.score === "number" ? m.score : null, instrument: input.instrument, timeframe: input.style, entry: input.entryPrice ?? null, stop: input.stopLoss ?? null, target: input.takeProfit1 ?? null, units: input.units ?? null, riskAmount: input.riskAmount ?? null, riskPercent: input.riskPercent ?? null, reasoning: input.thesis ?? (typeof m.reasoning === "string" ? m.reasoning : null), evidence: input.evidence ?? null, invalidation: input.invalidation ?? null, observedAt: m.signalTime ?? input.openedAt ?? null, source: m.source ?? "manual_record", evidenceQuality: id && version && instance && Object.keys(regime).length ? "recorded_at_entry" : "incomplete", parameters: m.parameters ?? null, aiDecisionId: m.aiDecisionId ?? null };
}
export function journalInsights(row: Record<string, unknown>) {
  let m: Record<string, unknown> = {}, context: Record<string, unknown> = {};
  try { m = object(JSON.parse(String(row.metadata_json ?? '{}'))); } catch { /* Missing legacy evidence stays unknown. */ }
  try { context = object(JSON.parse(String(row.context_json ?? '{}'))); } catch { /* Do not infer historical context. */ }
  if (!Object.keys(context).length) {
    const regime = object(m.marketRegime), selected = object(m.selectedStrategy);
    context = { strategyId: m.strategyId ?? (typeof selected.id === "string" ? `scanner/${selected.id}` : null), strategyVersion: m.strategyVersion ?? null, strategyInstance: m.strategyInstance ?? null, marketRegime: regime.type ?? null, marketExplanation: regime.explanation ?? null, riskAmount: row.risk_amount ?? null, reasoning: row.thesis ?? null, setupScore: m.score ?? null, evidenceQuality: "historical_metadata_only" };
  }
  const risk = typeof context.riskAmount === "number" ? context.riskAmount : typeof row.risk_amount === "number" ? row.risk_amount : null;
  const pnl = typeof row.pnl === "number" ? row.pnl : null;
  const reason = String(m.closeReason ?? "");
  const names: Record<string,string> = { TP: "TP HIT", SL: "SL HIT", TRAILING_STOP: "TRAILING STOP", MANUAL: "MANUAL", BROKER: "Broker close — reason unavailable" };
  return { entryContext: context, entryReasoning: context.reasoning ?? row.thesis ?? null, setupScore: context.setupScore ?? null, strategyId: context.strategyId ?? null, strategyVersion: context.strategyVersion ?? null, strategyInstance: context.strategyInstance ?? null, marketCondition: context.marketExplanation ?? context.marketRegime ?? "Not recorded at entry", rMultiple: risk && risk > 0 && pnl !== null ? pnl / risk : null, exitPrice: m.closePrice ?? null, exitReason: names[reason] ?? (reason || (row.status === "open" ? "Still open" : "Not recorded")), evidenceQuality: context.evidenceQuality ?? "Historical entry context unavailable" };
}
