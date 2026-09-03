import { foresightJournalId, foresightTradeSource, type JournalTradeSource } from "./trade-monitoring";
import { standardLots } from "./trade-risk";

export type JournalRecoveryOpenTrade = {
  id: string;
  instrument: string;
  price: number;
  openTime: string | null;
  units: number;
  stopLoss: number | null;
  takeProfit: number | null;
  clientId?: string | null;
  clientTag?: string | null;
  clientComment?: string | null;
};

export type JournalRecoveryFill = {
  id: string;
  time: string;
  instrument: string | null;
  openedTradeId?: string | null;
  tradeIds: string[];
  pnl: number;
  pnlByTradeId?: Record<string, number>;
  units: number;
  price: number | null;
  closeReason: string | null;
  isEntry: boolean;
  isClose: boolean;
  clientId?: string | null;
  clientTag?: string | null;
  clientComment?: string | null;
};

export function missingJournalRecordsFromFills(input: {
  openTrades: JournalRecoveryOpenTrade[];
  fills: JournalRecoveryFill[];
  knownBrokerIds: Set<string>;
  environment: string;
  accountId?: string | null;
}) {
  const openById = new Map(input.openTrades.map((trade) => [trade.id, trade]));
  const recovered: Array<{
    id: string;
    environment: string;
    accountId: string | null;
    instrument: string;
    direction: "long" | "short";
    style: string;
    strategyName: string;
    status: "open" | "closed";
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit1: number | null;
    units: number;
    lots: number | null;
    pnl: number | null;
    brokerTradeId: string;
    notes: string;
    openedAt: string;
    closedAt: string | null;
    metadata: Record<string, unknown>;
  }> = [];

  for (const entry of input.fills) {
    const tradeId = entry.openedTradeId;
    const openTrade = tradeId ? openById.get(tradeId) ?? null : null;
    const taggedSource = foresightTradeSource(
      entry.clientTag ?? openTrade?.clientTag,
      entry.clientId ?? openTrade?.clientId,
    );
    const source: JournalTradeSource = taggedSource ?? "project_recovery";
    const clientId = entry.clientId ?? openTrade?.clientId;
    if (!entry.isEntry || !tradeId || input.knownBrokerIds.has(tradeId) || !entry.instrument || !entry.units) continue;
    const closes = input.fills.filter((fill) => fill.isClose && fill.tradeIds.includes(tradeId)).sort((a, b) => a.time.localeCompare(b.time));
    const latestClose = closes.at(-1) ?? null;
    const pnl = closes.reduce((sum, fill) => {
      const allocated = fill.pnlByTradeId?.[tradeId];
      return sum + (Number.isFinite(allocated) ? Number(allocated) : fill.tradeIds.length === 1 ? fill.pnl : 0);
    }, 0);
    const status = latestClose && !openTrade ? "closed" : "open";
    const closeReason = latestClose?.closeReason ?? "BROKER";
    recovered.push({
      id: foresightJournalId(clientId) ?? `oanda:${input.environment}:${input.accountId ?? "unknown"}:${tradeId}`,
      environment: input.environment,
      accountId: input.accountId ?? null,
      instrument: entry.instrument,
      direction: entry.units > 0 ? "long" : "short",
      style: entry.clientComment || openTrade?.clientComment || "intraday",
      strategyName: source === "autonomous" ? "Autotrader recovery" : source === "dashboard_manual" ? "Dashboard trade recovery" : "Foresight project recovery",
      status,
      entryPrice: entry.price,
      stopLoss: openTrade?.stopLoss ?? null,
      takeProfit1: openTrade?.takeProfit ?? null,
      units: entry.units,
      lots: standardLots(entry.instrument, entry.units),
      pnl: status === "closed" ? pnl : null,
      brokerTradeId: tradeId,
      notes: status === "closed"
        ? `${closeReason}. Recovered directly from OANDA entry and close transactions.`
        : "Recovered directly from an OANDA entry transaction because its journal event was missing.",
      openedAt: entry.time,
      closedAt: status === "closed" ? latestClose!.time : null,
      metadata: {
        recoveredFromBroker: true,
        recoverySource: taggedSource ? "tagged_entry_fill" : "project_entry_fill",
        source,
        entryTransactionId: entry.id,
        clientId,
        clientTag: entry.clientTag ?? openTrade?.clientTag,
        clientComment: entry.clientComment ?? openTrade?.clientComment,
        ...(status === "closed" ? {
          closeReason,
          closePrice: latestClose!.price,
          closeTransactionId: latestClose!.id,
          closeTime: latestClose!.time,
        } : {}),
      },
    });
    input.knownBrokerIds.add(tradeId);
  }
  return recovered;
}
