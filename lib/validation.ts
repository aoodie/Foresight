import { pipSize } from "./trade-risk.ts";

export type ValidationJournalRow = {
  id: string;
  created_at: string;
  updated_at?: string | null;
  environment: string;
  account_id?: string | null;
  instrument: string;
  direction: string;
  style: string;
  strategy_name?: string | null;
  setup_type?: string | null;
  status: string;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit_1?: number | null;
  take_profit_2?: number | null;
  units?: number | null;
  lots?: number | null;
  risk_percent?: number | null;
  risk_amount?: number | null;
  pnl?: number | null;
  broker_trade_id?: string | null;
  thesis?: string | null;
  evidence?: string | null;
  invalidation?: string | null;
  notes?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  metadata_json?: string | null;
};

export type ValidationFill = {
  id: string;
  time: string;
  instrument: string | null;
  tradeId: string | null;
  tradeIds: string[];
  pnl: number;
  units: number;
  price: number | null;
  reason: string | null;
  closeReason: string | null;
  isEntry: boolean;
  isClose: boolean;
};

export type ValidationOpenTrade = {
  id: string;
  instrument: string;
  stopLoss: number | null;
  takeProfit: number | null;
};

export type ValidationGate = {
  id: string;
  label: string;
  status: "pass" | "wait" | "block";
  value: string;
  explanation: string;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metadataFor(row: ValidationJournalRow) {
  if (!row.metadata_json) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function durationMinutes(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const value = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function buildValidationReport(input: {
  journal: ValidationJournalRow[];
  fills: ValidationFill[];
  openTrades?: ValidationOpenTrade[];
  environment?: "practice" | "live" | null;
  currency?: string | null;
  generatedAt?: string;
}) {
  const closedStatuses = new Set(["closed", "win", "loss", "breakeven"]);
  const executed = input.journal.filter((row) => Boolean(row.broker_trade_id) || row.status === "open" || closedStatuses.has(row.status));
  const closed = executed.filter((row) => closedStatuses.has(row.status) || Boolean(row.closed_at));
  const records = closed.map((row) => {
    const metadata = metadataFor(row);
    const related = row.broker_trade_id
      ? input.fills.filter((fill) => fill.tradeIds.includes(row.broker_trade_id!)).sort((a, b) => a.time.localeCompare(b.time))
      : [];
    const entryFill = related.find((fill) => fill.isEntry && finite(fill.price)) ?? null;
    const closeFill = [...related].reverse().find((fill) => fill.isClose && finite(fill.price)) ?? null;
    const plannedEntry = finite(row.entry_price) ? row.entry_price : null;
    const actualEntry = entryFill?.price ?? (finite(metadata.fillPrice) ? metadata.fillPrice : null);
    const actualExit = closeFill?.price ?? (finite(metadata.closePrice) ? metadata.closePrice : null);
    const direction = row.direction.toLowerCase() === "short" ? "short" : "long";
    const adverseSlippagePrice = plannedEntry !== null && actualEntry !== null
      ? (direction === "long" ? 1 : -1) * (actualEntry - plannedEntry)
      : null;
    const slippagePips = adverseSlippagePrice === null ? null : adverseSlippagePrice / pipSize(row.instrument);
    const plannedRiskDistance = plannedEntry !== null && finite(row.stop_loss) ? Math.abs(plannedEntry - row.stop_loss) : null;
    const plannedRewardDistance = plannedEntry !== null && finite(row.take_profit_1) ? Math.abs(row.take_profit_1 - plannedEntry) : null;
    const plannedR = plannedRiskDistance && plannedRewardDistance !== null ? plannedRewardDistance / plannedRiskDistance : null;
    const fillPnl = related.filter((fill) => fill.isClose).reduce((sum, fill) => sum + fill.pnl, 0);
    const pnl = finite(row.pnl) ? row.pnl : related.some((fill) => fill.isClose) ? fillPnl : null;
    const realisedR = pnl !== null && finite(row.risk_amount) && row.risk_amount > 0 ? pnl / row.risk_amount : null;
    const strategyVersion = typeof metadata.strategyVersion === "string" ? metadata.strategyVersion : null;
    const evidenceFields = [row.thesis, row.evidence, row.invalidation, finite(row.risk_amount) ? row.risk_amount : null, strategyVersion, row.broker_trade_id, closeFill];
    const evidenceComplete = evidenceFields.filter(Boolean).length;
    return {
      id: row.id,
      environment: row.environment,
      instrument: row.instrument,
      direction,
      style: row.style,
      strategyName: row.strategy_name ?? "Unspecified strategy",
      strategyVersion,
      status: row.status,
      brokerTradeId: row.broker_trade_id ?? null,
      plannedEntry,
      actualEntry,
      stopLoss: finite(row.stop_loss) ? row.stop_loss : null,
      takeProfit1: finite(row.take_profit_1) ? row.take_profit_1 : null,
      takeProfit2: finite(row.take_profit_2) ? row.take_profit_2 : null,
      actualExit,
      units: finite(row.units) ? row.units : null,
      riskAmount: finite(row.risk_amount) ? row.risk_amount : null,
      pnl,
      plannedR,
      realisedR,
      slippagePips,
      closeReason: closeFill?.closeReason ?? (typeof metadata.closeReason === "string" ? metadata.closeReason : row.notes ?? null),
      openedAt: row.opened_at ?? entryFill?.time ?? row.created_at,
      closedAt: row.closed_at ?? closeFill?.time ?? null,
      durationMinutes: durationMinutes(row.opened_at ?? entryFill?.time ?? row.created_at, row.closed_at ?? closeFill?.time),
      thesis: row.thesis ?? null,
      evidence: row.evidence ?? null,
      invalidation: row.invalidation ?? null,
      notes: row.notes ?? null,
      brokerMatched: Boolean(row.broker_trade_id && entryFill && closeFill),
      evidenceComplete,
      evidenceTotal: evidenceFields.length,
    };
  }).sort((a, b) => (b.closedAt ?? b.openedAt).localeCompare(a.closedAt ?? a.openedAt));

  const pnlValues = records.flatMap((record) => record.pnl === null ? [] : [record.pnl]);
  const rValues = records.flatMap((record) => record.realisedR === null ? [] : [record.realisedR]);
  const slippageValues = records.flatMap((record) => record.slippagePips === null ? [] : [record.slippagePips]);
  const gains = pnlValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(pnlValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const chronological = [...records].sort((a, b) => (a.closedAt ?? a.openedAt).localeCompare(b.closedAt ?? b.openedAt));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = chronological.map((record) => {
    equity += record.pnl ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    return { time: record.closedAt ?? record.openedAt, value: equity };
  });
  const matchedCount = records.filter((record) => record.brokerMatched).length;
  const versionedCount = executed.filter((row) => typeof metadataFor(row).strategyVersion === "string").length;
  const reconciliationCount = input.journal.filter((row) => row.status === "reconciliation_required").length;
  const protectedOpenCount = (input.openTrades ?? []).filter((trade) => trade.stopLoss !== null && trade.takeProfit !== null).length;
  const practiceClosedCount = records.filter((record) => record.environment === "practice").length;
  const expectancyR = rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null;
  const profitFactor = losses > 0 ? gains / losses : gains > 0 ? null : 0;
  const matchRate = records.length ? matchedCount / records.length : null;
  const gates: ValidationGate[] = [
    {
      id: "sample",
      label: "Practice sample",
      status: practiceClosedCount >= 30 ? "pass" : "wait",
      value: `${practiceClosedCount}/30 closed trades`,
      explanation: practiceClosedCount >= 30 ? "Enough broker-paper trades for a first review; 100+ is stronger." : "Collect at least 30 broker-paper closes before judging the strategy.",
    },
    {
      id: "expectancy",
      label: "Positive expectancy",
      status: expectancyR === null ? "wait" : expectancyR > 0 ? "pass" : "block",
      value: expectancyR === null ? "Not measurable" : `${expectancyR >= 0 ? "+" : ""}${expectancyR.toFixed(2)}R / trade`,
      explanation: "Average realised profit or loss measured against the cash risk planned for each trade.",
    },
    {
      id: "fills",
      label: "Journal ↔ broker match",
      status: matchRate === null ? "wait" : matchRate === 1 ? "pass" : "block",
      value: matchRate === null ? "No closed trades" : `${Math.round(matchRate * 100)}% matched`,
      explanation: "Every closed journal record should have both an entry fill and a closing fill from OANDA.",
    },
    {
      id: "protection",
      label: "Open-trade protection",
      status: (input.openTrades ?? []).length === protectedOpenCount ? "pass" : "block",
      value: (input.openTrades ?? []).length ? `${protectedOpenCount}/${input.openTrades!.length} protected` : "No open exposure",
      explanation: "Every open position must have broker-side stop-loss and take-profit orders.",
    },
    {
      id: "reconciliation",
      label: "Reconciliation",
      status: reconciliationCount === 0 ? "pass" : "block",
      value: reconciliationCount === 0 ? "No unresolved records" : `${reconciliationCount} need attention`,
      explanation: "Unknown broker outcomes must be resolved before trusting performance totals.",
    },
    {
      id: "versioning",
      label: "Strategy versioning",
      status: executed.length === 0 ? "wait" : versionedCount === executed.length ? "pass" : "block",
      value: executed.length ? `${versionedCount}/${executed.length} versioned` : "No executed trades",
      explanation: "A semantic version ties every decision to the exact rules that produced it.",
    },
    {
      id: "backtest",
      label: "Reproducible backtest",
      status: "block",
      value: "Evidence not connected",
      explanation: "This page has broker-forward evidence only. Walk-forward and out-of-sample backtests still need a reproducible event-driven runner.",
    },
  ];
  const passedGates = gates.filter((gate) => gate.status === "pass").length;
  const evidencePoints = records.reduce((sum, record) => sum + record.evidenceComplete, 0);
  const evidenceTotal = records.reduce((sum, record) => sum + record.evidenceTotal, 0);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: {
      kind: "broker-forward" as const,
      environment: input.environment ?? null,
      currency: input.currency ?? null,
      statement: "Metrics use journal decisions reconciled to OANDA order fills. They are not backtest results.",
    },
    verdict: {
      label: gates.some((gate) => gate.status === "block") ? "NOT READY FOR LIVE PROMOTION" : "READY FOR HUMAN REVIEW",
      passedGates,
      totalGates: gates.length,
      score: Math.round((passedGates / gates.length) * 100),
      explanation: gates.some((gate) => gate.status === "block")
        ? "Keep the strategy in practice mode until every blocking evidence gate is resolved."
        : "The evidence gates pass, but live promotion still requires an explicit human decision.",
    },
    metrics: {
      closedTrades: records.length,
      practiceClosedTrades: practiceClosedCount,
      liveClosedTrades: records.filter((record) => record.environment === "live").length,
      netPnl: pnlValues.reduce((sum, value) => sum + value, 0),
      winRate: pnlValues.length ? pnlValues.filter((value) => value > 0).length / pnlValues.length : null,
      expectancyR,
      profitFactor,
      maxDrawdown,
      averageEntrySlippagePips: slippageValues.length ? slippageValues.reduce((sum, value) => sum + value, 0) / slippageValues.length : null,
      brokerMatchRate: matchRate,
      evidenceCoverage: evidenceTotal ? evidencePoints / evidenceTotal : null,
      unprotectedOpenTrades: (input.openTrades ?? []).length - protectedOpenCount,
      reconciliationCount,
    },
    gates,
    records,
    equityCurve,
  };
}
