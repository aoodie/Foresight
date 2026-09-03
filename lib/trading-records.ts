import { env } from "cloudflare:workers";
import { foresightJournalId, foresightTradeSource, type JournalTradeSource } from "./trade-monitoring";
import { standardLots } from "./trade-risk";
import { missingJournalRecordsFromFills, type JournalRecoveryFill } from "./journal-recovery";

type RuntimeEnv = { DB: D1Database };
const runtime = env as unknown as RuntimeEnv;

export type JournalRecordInput = {
  id?: string;
  environment: string;
  accountId?: string | null;
  instrument: string;
  direction: string;
  style: string;
  strategyName?: string | null;
  setupType?: string | null;
  status?: string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  units?: number | null;
  lots?: number | null;
  riskPercent?: number | null;
  riskAmount?: number | null;
  pnl?: number | null;
  brokerTradeId?: string | null;
  thesis?: string | null;
  evidence?: string | null;
  invalidation?: string | null;
  notes?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  metadata?: unknown;
};

function json(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function eventTypeFor(status: string, metadata: Record<string, unknown>) {
  if (["closed", "win", "loss", "breakeven"].includes(status)) return "trade.closed";
  if (status === "cancelled") return "order.cancelled";
  if (status === "reconciliation_required") return "trade.reconciliation_required";
  if (status === "open") {
    if (metadata.lastBrokerActivityAt || metadata.lastLlmReview) return "trade.managed";
    return "trade.opened";
  }
  if (status === "submitted") return "order.submitted";
  return "signal.generated";
}

async function appendJournalEvent(input: {
  journalId: string;
  brokerTradeId?: string | null;
  status: string;
  price?: number | null;
  pnl?: number | null;
  reason?: string | null;
  eventAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const metadata = input.metadata ?? {};
  const eventType = eventTypeFor(input.status, metadata);
  const eventAt = input.eventAt
    ?? (typeof metadata.closeTime === "string" ? metadata.closeTime : null)
    ?? (typeof metadata.lastBrokerActivityAt === "string" ? metadata.lastBrokerActivityAt : null)
    ?? (typeof metadata.fillTime === "string" ? metadata.fillTime : null)
    ?? new Date().toISOString();
  const transactionId = typeof metadata.closeTransactionId === "string" ? metadata.closeTransactionId
    : typeof metadata.entryTransactionId === "string" ? metadata.entryTransactionId
    : typeof metadata.fillTransactionId === "string" ? metadata.fillTransactionId
    : "";
  const eventKey = [input.journalId, eventType, input.brokerTradeId ?? "", transactionId, eventAt].join(":");
  const source = metadata.recoveredFromBroker || metadata.reconciledAt ? "broker_reconciliation"
    : metadata.lastLlmReview ? "llm_monitor"
    : "application";
  await runtime.DB.prepare("INSERT OR IGNORE INTO trade_journal_events (id, event_key, journal_id, broker_trade_id, event_type, event_at, source, status, price, pnl, reason, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), eventKey, input.journalId, input.brokerTradeId ?? null, eventType, eventAt, source, input.status, input.price ?? null, input.pnl ?? null, input.reason ?? null, json(metadata), new Date().toISOString()).run();
}

async function appendCurrentJournalEvent(id: string, metadata?: Record<string, unknown>) {
  const row = await runtime.DB.prepare("SELECT id, broker_trade_id, status, entry_price, pnl, opened_at, closed_at, notes, metadata_json FROM trade_journal WHERE id = ?")
    .bind(id).first<{ id: string; broker_trade_id: string | null; status: string; entry_price: number | null; pnl: number | null; opened_at: string | null; closed_at: string | null; notes: string | null; metadata_json: string | null }>();
  if (!row) return;
  const mergedMetadata = { ...parsedMetadata(row.metadata_json), ...(metadata ?? {}) };
  const closePrice = typeof mergedMetadata.closePrice === "number" ? mergedMetadata.closePrice : null;
  const managedAt = typeof mergedMetadata.lastBrokerActivityAt === "string" ? mergedMetadata.lastBrokerActivityAt
    : typeof mergedMetadata.lastLlmReview === "object" && mergedMetadata.lastLlmReview && "reviewedAt" in mergedMetadata.lastLlmReview && typeof mergedMetadata.lastLlmReview.reviewedAt === "string"
      ? mergedMetadata.lastLlmReview.reviewedAt
      : null;
  await appendJournalEvent({
    journalId: row.id,
    brokerTradeId: row.broker_trade_id,
    status: row.status,
    price: row.status === "open" ? row.entry_price : closePrice,
    pnl: row.pnl,
    reason: typeof mergedMetadata.closeReason === "string" ? mergedMetadata.closeReason : row.notes,
    eventAt: row.closed_at ?? managedAt ?? row.opened_at,
    metadata: mergedMetadata,
  });
}

async function appendHistoricalOpenEvent(id: string) {
  const row = await runtime.DB.prepare("SELECT id, broker_trade_id, status, entry_price, opened_at, metadata_json FROM trade_journal WHERE id = ?")
    .bind(id).first<{ id: string; broker_trade_id: string | null; status: string; entry_price: number | null; opened_at: string | null; metadata_json: string | null }>();
  if (!row?.opened_at || !["closed", "win", "loss", "breakeven"].includes(row.status)) return;
  const metadata = parsedMetadata(row.metadata_json);
  delete metadata.closeReason;
  delete metadata.closePrice;
  delete metadata.closeTransactionId;
  delete metadata.closeTime;
  delete metadata.reconciledAt;
  delete metadata.lastBrokerActivityAt;
  delete metadata.lastLlmReview;
  await appendJournalEvent({ journalId: row.id, brokerTradeId: row.broker_trade_id, status: "open", price: row.entry_price, eventAt: row.opened_at, reason: "Trade opened at OANDA.", metadata });
}

export async function createJournalEntry(input: JournalRecordInput) {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await runtime.DB.prepare(`INSERT INTO trade_journal (id, created_at, updated_at, environment, account_id, instrument, direction, style, strategy_name, setup_type, status, entry_price, stop_loss, take_profit_1, take_profit_2, units, lots, risk_percent, risk_amount, pnl, broker_trade_id, thesis, evidence, invalidation, notes, opened_at, closed_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, environment = excluded.environment,
      account_id = excluded.account_id, instrument = excluded.instrument, direction = excluded.direction,
      style = excluded.style, strategy_name = excluded.strategy_name, setup_type = excluded.setup_type,
      status = CASE WHEN trade_journal.status IN ('closed', 'cancelled', 'win', 'loss', 'breakeven') AND excluded.status IN ('planned', 'submitted', 'open') THEN trade_journal.status ELSE excluded.status END,
      entry_price = excluded.entry_price, stop_loss = excluded.stop_loss,
      take_profit_1 = excluded.take_profit_1, take_profit_2 = excluded.take_profit_2,
      units = excluded.units, lots = COALESCE(excluded.lots, trade_journal.lots),
      risk_percent = excluded.risk_percent, risk_amount = excluded.risk_amount,
      pnl = COALESCE(excluded.pnl, trade_journal.pnl), broker_trade_id = COALESCE(excluded.broker_trade_id, trade_journal.broker_trade_id),
      thesis = COALESCE(excluded.thesis, trade_journal.thesis), evidence = COALESCE(excluded.evidence, trade_journal.evidence),
      invalidation = COALESCE(excluded.invalidation, trade_journal.invalidation), notes = COALESCE(excluded.notes, trade_journal.notes),
      opened_at = COALESCE(excluded.opened_at, trade_journal.opened_at), closed_at = COALESCE(excluded.closed_at, trade_journal.closed_at),
      metadata_json = CASE WHEN excluded.metadata_json IS NULL THEN trade_journal.metadata_json ELSE json_patch(CASE WHEN json_valid(trade_journal.metadata_json) THEN trade_journal.metadata_json ELSE '{}' END, excluded.metadata_json) END`).bind(
    id, now, now, input.environment, input.accountId ?? null, input.instrument, input.direction, input.style,
    input.strategyName ?? null, input.setupType ?? null, input.status ?? "planned", input.entryPrice ?? null,
    input.stopLoss ?? null, input.takeProfit1 ?? null, input.takeProfit2 ?? null, input.units ?? null,
    input.lots ?? null, input.riskPercent ?? null, input.riskAmount ?? null, input.pnl ?? null,
    input.brokerTradeId ?? null, input.thesis ?? null, input.evidence ?? null, input.invalidation ?? null,
    input.notes ?? null, input.openedAt ?? null, input.closedAt ?? null, json(input.metadata),
  ).run();
  await appendCurrentJournalEvent(id, input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : undefined);
  if (input.closedAt && input.openedAt) await appendHistoricalOpenEvent(id);
  return id;
}

export async function updateJournalEntry(input: { id: string; status?: string; pnl?: number | null; brokerTradeId?: string | null; notes?: string | null; openedAt?: string | null; closedAt?: string | null; metadata?: Record<string, unknown>; }) {
  const now = new Date().toISOString();
  const closedAt = input.closedAt ?? (input.status && ["closed", "cancelled", "win", "loss", "breakeven"].includes(input.status) ? now : null);
  const metadataJson = input.metadata == null ? null : json(input.metadata);
  const result = await runtime.DB.prepare("UPDATE trade_journal SET status = CASE WHEN status IN ('closed', 'cancelled', 'win', 'loss', 'breakeven') AND ? IN ('planned', 'submitted', 'open', 'reconciliation_required') THEN status ELSE COALESCE(?, status) END, pnl = COALESCE(?, pnl), broker_trade_id = COALESCE(?, broker_trade_id), notes = COALESCE(?, notes), opened_at = COALESCE(?, opened_at), closed_at = COALESCE(?, closed_at), metadata_json = CASE WHEN ? IS NULL THEN metadata_json ELSE json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, ?) END, updated_at = ? WHERE id = ?")
    .bind(input.status ?? null, input.status ?? null, input.pnl ?? null, input.brokerTradeId ?? null, input.notes ?? null, input.openedAt ?? null, closedAt, metadataJson, metadataJson, now, input.id).run();
  const changes = Number(result.meta?.changes ?? 0);
  if (changes) await appendCurrentJournalEvent(input.id, input.metadata);
  return changes;
}

export async function updateJournalByBrokerTradeId(input: { brokerTradeId: string; status: string; pnl?: number | null; notes?: string | null; closedAt?: string | null; metadata?: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const closedAt = input.closedAt ?? (["closed", "cancelled", "win", "loss", "breakeven"].includes(input.status) ? now : null);
  const metadataJson = input.metadata == null ? null : json(input.metadata);
  const result = await runtime.DB.prepare("UPDATE trade_journal SET status = CASE WHEN status IN ('closed', 'cancelled', 'win', 'loss', 'breakeven') AND ? IN ('planned', 'submitted', 'open', 'reconciliation_required') THEN status ELSE ? END, pnl = COALESCE(?, pnl), notes = COALESCE(?, notes), closed_at = COALESCE(?, closed_at), metadata_json = CASE WHEN ? IS NULL THEN metadata_json ELSE json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, ?) END, updated_at = ? WHERE broker_trade_id = ?")
    .bind(input.status, input.status, input.pnl ?? null, input.notes ?? null, closedAt, metadataJson, metadataJson, now, input.brokerTradeId).run();
  const changes = Number(result.meta?.changes ?? 0);
  if (changes) {
    const row = await runtime.DB.prepare("SELECT id FROM trade_journal WHERE broker_trade_id = ? ORDER BY created_at ASC LIMIT 1").bind(input.brokerTradeId).first<{ id: string }>();
    if (row) await appendCurrentJournalEvent(row.id, input.metadata);
  }
  return changes;
}

async function enrichRecoveredJournal(input: {
  id: string;
  source: JournalTradeSource;
  clientId?: string | null;
  clientTag?: string | null;
  clientComment?: string | null;
}) {
  const strategyName = input.source === "autonomous" ? "Autotrader recovery"
    : input.source === "dashboard_manual" ? "Dashboard trade recovery"
    : "Foresight project recovery";
  const metadata = { source: input.source, clientId: input.clientId ?? null, clientTag: input.clientTag ?? null, clientComment: input.clientComment ?? null };
  const metadataJson = json(metadata);
  const result = await runtime.DB.prepare("UPDATE trade_journal SET strategy_name = CASE WHEN strategy_name = 'OANDA broker import' THEN ? ELSE strategy_name END, style = COALESCE(?, style), metadata_json = json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, ?), updated_at = ? WHERE id = ? AND (strategy_name = 'OANDA broker import' OR COALESCE(json_extract(metadata_json, '$.source'), '') != ? OR COALESCE(json_extract(metadata_json, '$.clientId'), '') != ?)")
    .bind(strategyName, input.clientComment ?? null, metadataJson, new Date().toISOString(), input.id, input.source, input.clientId ?? "").run();
  if (Number(result.meta?.changes ?? 0)) await appendCurrentJournalEvent(input.id, { ...metadata, lastBrokerActivityAt: new Date().toISOString() });
}

export async function writeSystemLog(input: {
  level?: "info" | "warning" | "error";
  category: string;
  event: string;
  message: string;
  instrument?: string | null;
  environment?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
  details?: unknown;
}) {
  const id = crypto.randomUUID();
  await runtime.DB.prepare("INSERT INTO system_logs (id, created_at, level, category, event, message, instrument, environment, correlation_id, duration_ms, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, new Date().toISOString(), input.level ?? "info", input.category, input.event, input.message, input.instrument ?? null, input.environment ?? null, input.correlationId ?? null, input.durationMs ?? null, json(input.details)).run();
  return id;
}

export async function backfillJournalLifecycleEvents(limit = 200) {
  const rows = await runtime.DB.prepare("SELECT j.id FROM trade_journal j WHERE NOT EXISTS (SELECT 1 FROM trade_journal_events e WHERE e.journal_id = j.id) ORDER BY j.created_at ASC LIMIT ?")
    .bind(Math.min(500, Math.max(1, limit))).all<{ id: string }>();
  for (const row of rows.results ?? []) {
    await appendCurrentJournalEvent(row.id);
    await appendHistoricalOpenEvent(row.id);
  }
  return rows.results?.length ?? 0;
}

type BrokerSnapshotTrade = {
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

type BrokerSnapshotFill = {
  id: string;
  time: string;
  instrument: string | null;
  tradeIds: string[];
  pnl: number;
  pnlByTradeId?: Record<string, number>;
  units: number;
  price: number | null;
  closeReason: string | null;
  isEntry: boolean;
  isClose: boolean;
  openedTradeId?: string | null;
  clientId?: string | null;
  clientTag?: string | null;
  clientComment?: string | null;
};

function parsedMetadata(value: unknown) {
  if (typeof value !== "string") return {} as Record<string, unknown>;
  try {
    const result = JSON.parse(value) as unknown;
    return result && typeof result === "object" ? result as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

type KnownJournalRow = { id: string; broker_trade_id: string | null; metadata_json: string | null };

function linkedJournalRow(clientId: string | null | undefined, knownById: Map<string, KnownJournalRow>) {
  const exactId = foresightJournalId(clientId);
  if (exactId) return knownById.get(exactId) ?? null;

  // Dashboard orders created before full IDs were introduced retained the
  // first 24 UUID characters. Resolve that legacy prefix only when unique.
  if (!clientId?.startsWith("foresight-ui-")) return null;
  const prefix = clientId.slice("foresight-ui-".length);
  if (prefix.length < 20) return null;
  const matches = [...knownById.values()].filter((row) => row.id.startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

export async function reconcileJournalFromBrokerSnapshot(input: {
  openTrades: BrokerSnapshotTrade[];
  fills: BrokerSnapshotFill[];
  environment: string;
  accountId?: string | null;
}) {
  const reclassifiedAt = new Date().toISOString();
  const legacyMetadata = json({ source: "project_recovery", reclassifiedAt });
  const reclassified = await runtime.DB.prepare("UPDATE trade_journal SET strategy_name = CASE WHEN strategy_name = 'OANDA broker import' THEN 'Foresight project recovery' ELSE strategy_name END, metadata_json = json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, ?), updated_at = ? WHERE strategy_name = 'OANDA broker import' OR COALESCE(json_extract(metadata_json, '$.source'), '') = 'broker_account'")
    .bind(legacyMetadata, reclassifiedAt).run();
  const reclassifiedUpdates = Number(reclassified.meta?.changes ?? 0);
  if (reclassifiedUpdates) {
    await writeSystemLog({ category: "reconciliation", event: "journal.project_ownership_restored", message: `${reclassifiedUpdates} recovered journal record(s) reclassified as Foresight project trades.`, environment: input.environment, details: { reclassifiedUpdates } });
  }

  const knownRows = await runtime.DB.prepare("SELECT id, broker_trade_id, metadata_json FROM trade_journal LIMIT 2000").all<KnownJournalRow>();
  const knownById = new Map((knownRows.results ?? []).map((row) => [row.id, row]));
  const brokerRows = (knownRows.results ?? []).filter((row): row is KnownJournalRow & { broker_trade_id: string } => typeof row.broker_trade_id === "string");
  const knownBrokerIds = new Set(brokerRows.map((row) => row.broker_trade_id));
  const knownByBrokerId = new Map(brokerRows.map((row) => [row.broker_trade_id, row]));
  let importedUpdates = 0;
  const recoveredFromFills = missingJournalRecordsFromFills({
    openTrades: input.openTrades,
    fills: input.fills satisfies JournalRecoveryFill[],
    knownBrokerIds,
    environment: input.environment,
    accountId: input.accountId,
  });
  for (const recovered of recoveredFromFills) {
    const recoveredClientId = typeof recovered.metadata.clientId === "string" ? recovered.metadata.clientId : null;
    const linked = knownById.get(recovered.id) ?? linkedJournalRow(recoveredClientId, knownById);
    const journalId = linked?.id ?? recovered.id;
    if (linked) {
      await updateJournalEntry({
        id: linked.id,
        status: recovered.status,
        pnl: recovered.pnl,
        brokerTradeId: recovered.brokerTradeId,
        notes: recovered.notes,
        openedAt: recovered.openedAt,
        closedAt: recovered.closedAt,
        metadata: recovered.metadata,
      });
      await enrichRecoveredJournal({ id: linked.id, source: recovered.metadata.source as JournalTradeSource, clientId: recoveredClientId, clientTag: typeof recovered.metadata.clientTag === "string" ? recovered.metadata.clientTag : null, clientComment: typeof recovered.metadata.clientComment === "string" ? recovered.metadata.clientComment : null });
    } else {
      await createJournalEntry(recovered);
      knownById.set(recovered.id, { id: recovered.id, broker_trade_id: recovered.brokerTradeId, metadata_json: json(recovered.metadata) });
    }
    knownByBrokerId.set(recovered.brokerTradeId, { id: journalId, broker_trade_id: recovered.brokerTradeId, metadata_json: json(recovered.metadata) });
    await writeSystemLog({
      category: "reconciliation",
      event: linked ? "trade.missing_linked_from_fills" : "trade.missing_recovered_from_fills",
      message: `${recovered.instrument}: ${recovered.notes}`,
      instrument: recovered.instrument,
      environment: input.environment,
      details: { journalId, brokerTradeId: recovered.brokerTradeId, status: recovered.status },
    });
    importedUpdates += 1;
  }

  // Historical ORDER_FILL records expose clientOrderID instead of the tag
  // object. Use it (and the richer open-trade snapshot when available) to
  // correct generic broker imports created by older reconciliation code.
  const openById = new Map(input.openTrades.map((trade) => [trade.id, trade]));
  for (const fill of input.fills) {
    if (!fill.isEntry || !fill.openedTradeId) continue;
    const row = knownByBrokerId.get(fill.openedTradeId);
    if (!row) continue;
    const openTrade = openById.get(fill.openedTradeId) ?? null;
    const source = foresightTradeSource(fill.clientTag ?? openTrade?.clientTag, fill.clientId ?? openTrade?.clientId) ?? "project_recovery";
    const metadata = parsedMetadata(row.metadata_json);
    if (metadata.source === source && metadata.clientId === (fill.clientId ?? openTrade?.clientId ?? null)) continue;
    await enrichRecoveredJournal({
      id: row.id,
      source,
      clientId: fill.clientId ?? openTrade?.clientId,
      clientTag: fill.clientTag ?? openTrade?.clientTag,
      clientComment: fill.clientComment ?? openTrade?.clientComment,
    });
  }
  for (const trade of input.openTrades) {
    const source = foresightTradeSource(trade.clientTag, trade.clientId) ?? "project_recovery";
    if (knownBrokerIds.has(trade.id)) {
      const row = knownByBrokerId.get(trade.id);
      if (row) await enrichRecoveredJournal({ id: row.id, source, clientId: trade.clientId, clientTag: trade.clientTag, clientComment: trade.clientComment });
      continue;
    }
    const linked = linkedJournalRow(trade.clientId, knownById);
    if (linked) {
      const metadata = { recoveredFromBroker: true, recoverySource: "project_open_trade", source, clientId: trade.clientId, clientTag: trade.clientTag, clientComment: trade.clientComment };
      await updateJournalEntry({ id: linked.id, status: "open", brokerTradeId: trade.id, notes: "Foresight journal record relinked to its open OANDA trade.", openedAt: trade.openTime, metadata });
      await enrichRecoveredJournal({ id: linked.id, source, clientId: trade.clientId, clientTag: trade.clientTag, clientComment: trade.clientComment });
      knownBrokerIds.add(trade.id);
      knownByBrokerId.set(trade.id, { id: linked.id, broker_trade_id: trade.id, metadata_json: json(metadata) });
      importedUpdates += 1;
      continue;
    }
    await createJournalEntry({
      id: foresightJournalId(trade.clientId) ?? `oanda:${input.environment}:${input.accountId ?? "unknown"}:${trade.id}`,
      environment: input.environment,
      accountId: input.accountId ?? null,
      instrument: trade.instrument,
      direction: trade.units > 0 ? "long" : "short",
      style: trade.clientComment || "intraday",
      strategyName: source === "autonomous" ? "Autotrader recovery" : source === "dashboard_manual" ? "Dashboard trade recovery" : "Foresight project recovery",
      status: "open",
      entryPrice: trade.price,
      stopLoss: trade.stopLoss,
      takeProfit1: trade.takeProfit,
      units: trade.units,
      lots: standardLots(trade.instrument, trade.units),
      brokerTradeId: trade.id,
      notes: "Recovered from the Foresight OANDA trade because its journal event was missing.",
      openedAt: trade.openTime,
      metadata: { recoveredFromBroker: true, recoverySource: "project_open_trade", source, clientId: trade.clientId, clientTag: trade.clientTag, clientComment: trade.clientComment },
    });
    knownBrokerIds.add(trade.id);
    importedUpdates += 1;
  }

  const rows = await runtime.DB.prepare("SELECT id, broker_trade_id, instrument, status, opened_at, metadata_json FROM trade_journal WHERE broker_trade_id IS NOT NULL AND status IN ('submitted', 'open', 'reconciliation_required') ORDER BY created_at ASC LIMIT 200").all<{
    id: string; broker_trade_id: string; instrument: string; status: string; opened_at: string | null; metadata_json: string | null;
  }>();
  let activityUpdates = 0;
  let closedUpdates = 0;

  for (const row of rows.results ?? []) {
    const openTrade = openById.get(row.broker_trade_id);
    if (openTrade) {
      const metadata = parsedMetadata(row.metadata_json);
      const brokerSnapshot = { units: openTrade.units, entryPrice: openTrade.price, stopLoss: openTrade.stopLoss, takeProfit: openTrade.takeProfit };
      if (JSON.stringify(metadata.brokerSnapshot) !== JSON.stringify(brokerSnapshot) || row.status !== "open") {
        const previous = metadata.brokerSnapshot && typeof metadata.brokerSnapshot === "object" ? metadata.brokerSnapshot as Record<string, unknown> : null;
        const changedFields = previous ? Object.keys(brokerSnapshot).filter((key) => previous[key] !== brokerSnapshot[key as keyof typeof brokerSnapshot]) : ["initial broker state"];
        const activityAt = new Date().toISOString();
        const notes = previous ? `Broker activity changed: ${changedFields.join(", ")}.` : "Broker position confirmed and protection snapshot recorded.";
        await updateJournalEntry({ id: row.id, status: "open", brokerTradeId: row.broker_trade_id, notes, openedAt: row.opened_at ?? openTrade.openTime, metadata: { brokerSnapshot, lastBrokerActivityAt: activityAt } });
        await writeSystemLog({ level: previous ? "warning" : "info", category: "reconciliation", event: previous ? "trade.broker_activity_changed" : "trade.broker_snapshot_recorded", message: `${row.instrument}: ${notes}`, instrument: row.instrument, environment: input.environment, details: { journalId: row.id, brokerTradeId: row.broker_trade_id, changedFields, previous, current: brokerSnapshot } });
        activityUpdates += 1;
      }
      continue;
    }

    const relatedCloseFills = input.fills.filter((fill) => fill.isClose && fill.tradeIds.includes(row.broker_trade_id)).sort((a, b) => a.time.localeCompare(b.time));
    if (!relatedCloseFills.length) continue;
    const latest = relatedCloseFills.at(-1)!;
    const pnl = relatedCloseFills.reduce((sum, fill) => {
      const allocated = fill.pnlByTradeId?.[row.broker_trade_id];
      return sum + (Number.isFinite(allocated) ? Number(allocated) : fill.tradeIds.length === 1 ? fill.pnl : 0);
    }, 0);
    const closeReason = latest.closeReason ?? "BROKER";
    const notes = `${closeReason}. Journal reconciled to OANDA transaction ${latest.id}.`;
    await updateJournalEntry({ id: row.id, status: "closed", brokerTradeId: row.broker_trade_id, pnl, notes, closedAt: latest.time, metadata: { closeReason, closePrice: latest.price, closeTransactionId: latest.id, closeTime: latest.time, reconciledAt: new Date().toISOString() } });
    await writeSystemLog({ category: "reconciliation", event: "trade.closed_reconciled", message: `${row.instrument}: ${notes}`, instrument: row.instrument, environment: input.environment, details: { journalId: row.id, brokerTradeId: row.broker_trade_id, pnl, closePrice: latest.price, closeTime: latest.time } });
    closedUpdates += 1;
  }

  return { checked: rows.results?.length ?? 0, reclassifiedUpdates, importedUpdates, activityUpdates, closedUpdates };
}
