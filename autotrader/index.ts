import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  fetchOandaAccountSummary,
  fetchOandaCandles,
  fetchOandaOpenTrades,
  fetchOandaOrderFills,
  fetchOandaPrice,
  fetchOandaTradeDetails,
  submitOandaMarketOrder,
  closeOandaTrade,
  OandaApiError,
  type OandaEnvironment,
} from "../lib/oanda-api.ts";
import { getEconomicEventStatus } from "../lib/economic-calendar.ts";
import { analyseInstrument, candleCountForGranularity, combineTimeframes, timeframeProfiles, type ScannerResult, type TimeframeMode } from "../lib/market-scanner.ts";
import { reviewLiveTrade, type LiveTradeReview } from "../lib/openai-strategy.ts";
import { defaultAiBaseUrl, normalizeAiBaseUrl } from "../lib/ai-config.ts";
import { calculateRiskSizedUnits, hasTriggerConfirmation, pipSize, validateProtectedOrder } from "../lib/trade-risk.ts";
import { WorkerState, type WorkerEvent, type WorkerJournalRow } from "./state.ts";

type Config = {
  enabled: boolean;
  environment: OandaEnvironment;
  token: string;
  accountId: string;
  instruments: string[];
  mode: TimeframeMode;
  pollMs: number;
  scanMs: number;
  riskPercent: number;
  maxDailyLossPercent: number;
  maxTradesPerDay: number;
  maxOpenTrades: number;
  maxOpenTradesPerInstrument: number;
  minScore: number;
  minConfirmations: number;
  maxSpreadPips: number;
  maxUnits: number;
  llmApiKey?: string;
  llmModel: string;
  llmBaseUrl: string;
  llmReviewMs: number;
  llmMoveAtrFraction: number;
  heartbeatMs: number;
  requireTriggerConfirmation: boolean;
  autoCloseOnLlmClose: boolean;
  closeUnprotected: boolean;
  databasePath: string;
  lockPath: string;
  dashboardUrl?: string;
  webhookSecret?: string;
};

const truthy = (value: string | undefined, fallback = false) => value == null ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());
const numberEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

function loadConfig(): Config {
  const environment = (process.env.OANDA_ENVIRONMENT?.trim() || "practice") as OandaEnvironment;
  if (environment !== "practice" && environment !== "live") throw new Error("OANDA_ENVIRONMENT must be practice or live.");
  if (environment === "live" && !(truthy(process.env.AUTOTRADER_ALLOW_LIVE) && process.env.AUTOTRADER_LIVE_CONFIRM === "I_UNDERSTAND_LIVE_RISK")) {
    throw new Error("Live execution is locked. Set AUTOTRADER_ALLOW_LIVE=true and AUTOTRADER_LIVE_CONFIRM=I_UNDERSTAND_LIVE_RISK deliberately.");
  }
  const instruments = (process.env.AUTOTRADER_INSTRUMENTS ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (!instruments.length) throw new Error("AUTOTRADER_INSTRUMENTS must contain at least one explicitly approved instrument.");
  const mode = (process.env.TRADING_STYLE?.trim() || "intraday") as TimeframeMode;
  if (!(mode in timeframeProfiles)) throw new Error("TRADING_STYLE must be scalping, intraday, or swing.");
  const databasePath = resolve(process.env.AUTOTRADER_DATABASE_PATH || "./data/autotrader.sqlite");
  return {
    enabled: truthy(process.env.AUTOTRADER_ENABLED),
    environment,
    token: required("OANDA_TOKEN"),
    accountId: required("OANDA_ACCOUNT_ID"),
    instruments,
    mode,
    pollMs: Math.max(5000, numberEnv("AUTOTRADER_POLL_MS", 5000)),
    scanMs: Math.max(15000, numberEnv("AUTOTRADER_SCAN_MS", 60000)),
    riskPercent: Math.min(2, Math.max(0.01, numberEnv("RISK_PERCENT", 0.5))),
    maxDailyLossPercent: Math.min(10, Math.max(0.1, numberEnv("MAX_DAILY_LOSS_PERCENT", 2))),
    maxTradesPerDay: Math.max(1, Math.floor(numberEnv("MAX_TRADES_PER_DAY", 5))),
    maxOpenTrades: Math.max(1, Math.floor(numberEnv("MAX_OPEN_TRADES", 2))),
    maxOpenTradesPerInstrument: Math.max(1, Math.floor(numberEnv("MAX_OPEN_TRADES_PER_INSTRUMENT", 1))),
    minScore: Math.min(95, Math.max(50, numberEnv("MIN_SCORE", 70))),
    minConfirmations: Math.min(3, Math.max(2, Math.floor(numberEnv("MIN_CONFIRMATIONS", 2)))),
    maxSpreadPips: Math.max(0.1, numberEnv("MAX_SPREAD_PIPS", 2.5)),
    maxUnits: Math.max(1, Math.floor(numberEnv("MAX_UNITS", 1000000))),
    llmApiKey: process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined,
    llmModel: process.env.LLM_MODEL?.trim() || "",
    llmBaseUrl: normalizeAiBaseUrl(process.env.LLM_BASE_URL?.trim() || defaultAiBaseUrl),
    llmReviewMs: Math.max(300000, numberEnv("LLM_REVIEW_MS", 900000)),
    llmMoveAtrFraction: Math.max(0.1, numberEnv("LLM_MOVE_ATR_FRACTION", 0.25)),
    heartbeatMs: Math.max(30000, numberEnv("AUTOTRADER_HEARTBEAT_MS", 60000)),
    requireTriggerConfirmation: truthy(process.env.REQUIRE_TRIGGER_CONFIRMATION, true),
    autoCloseOnLlmClose: truthy(process.env.AUTOTRADER_AUTOCLOSE_ON_LLM_CLOSE),
    closeUnprotected: truthy(process.env.AUTOTRADER_CLOSE_UNPROTECTED, true),
    databasePath,
    lockPath: resolve(process.env.AUTOTRADER_LOCK_PATH || "./data/autotrader.lock"),
    dashboardUrl: process.env.AUTOTRADER_DASHBOARD_URL?.trim() || undefined,
    webhookSecret: process.env.AUTOTRADER_WEBHOOK_SECRET?.trim() || undefined,
  };
}

function labelFor(instrument: string) { return instrument.replace("_", " / "); }
function assetClassFor(instrument: string): "forex" | "metal" | "index" {
  if (instrument.startsWith("XAU")) return "metal";
  if (instrument.startsWith("US30")) return "index";
  return "forex";
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function validPlan(result: ScannerResult) {
  return result.bias !== "neutral" && result.entry != null && result.stopLoss != null && result.takeProfit1 != null && result.takeProfit2 != null && result.stopLoss !== result.entry && result.takeProfit1 !== result.entry;
}

function priceBucket(price: number, atrPercent: number) {
  const step = price * Math.max(0.0005, (Number.isFinite(atrPercent) ? atrPercent : 0.2) * 0.25 / 100);
  return Math.round(price / Math.max(step, 0.00000001));
}

async function hashInput(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function acquireWorkerLock(lockPath: string) {
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${process.pid}\n`, "utf8");
    return fd;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const recordedPid = Number(readFileSync(lockPath, "utf8").trim());
  let active = Number.isSafeInteger(recordedPid) && recordedPid > 0 && recordedPid !== process.pid;
  if (active) {
    try { process.kill(recordedPid, 0); } catch { active = false; }
  }
  if (active) throw new Error(`Another autonomous worker appears to be running with process ${recordedPid}.`);
  unlinkSync(lockPath);
  const fd = openSync(lockPath, "wx");
  writeFileSync(fd, `${process.pid}\n`, "utf8");
  return fd;
}

class AutoTrader {
  private readonly config: Config;
  private readonly store: WorkerState;
  private readonly lockFd: number;
  private stopping = false;
  private lastScanAt = 0;
  private lastHeartbeatAt = 0;
  private syncTail: Promise<void> = Promise.resolve();
  private newsCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof getEconomicEventStatus>> }>();
  private analysisCache = new Map<string, { expiresAt: number; value: ScannerResult }>();
  private dailyPnlCache: { day: string; expiresAt: number; value: number } | null = null;

  constructor(config: Config) {
    this.config = config;
    this.lockFd = acquireWorkerLock(config.lockPath);
    this.store = new WorkerState(config.databasePath);
    process.once("SIGTERM", () => this.stop());
    process.once("SIGINT", () => this.stop());
  }

  private sync(type: string, payload: unknown, eventKey = `${type}:${randomUUID()}`) {
    this.syncTail = this.syncTail.then(() => this.syncNow(type, payload, eventKey), () => this.syncNow(type, payload, eventKey));
    return this.syncTail;
  }

  private async syncNow(type: string, payload: unknown, eventKey: string) {
    if (!this.config.dashboardUrl || !this.config.webhookSecret) return;
    this.store.enqueueSync(eventKey, type, payload);
    await this.flushSyncQueue();
  }

  private async flushSyncQueue() {
    if (!this.config.dashboardUrl || !this.config.webhookSecret) return;
    for (const queued of this.store.dueSyncEvents()) {
      try {
        const response = await fetch(`${this.config.dashboardUrl.replace(/\/$/, "")}/api/autotrader/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Autotrader-Secret": this.config.webhookSecret },
          body: JSON.stringify({ type: queued.event_type, payload: JSON.parse(queued.payload_json) }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`Dashboard journal sync returned HTTP ${response.status}.`);
        this.store.markSyncDelivered(queued.id);
      } catch (error) {
        this.store.markSyncFailed(queued.id, error instanceof Error ? error.message : "Dashboard sync failed.");
        this.store.event({ level: "warning", event: "dashboard.sync_failed", message: error instanceof Error ? error.message : "Dashboard sync failed.", details: { queueId: queued.id, eventType: queued.event_type, attempts: queued.attempts + 1 } });
        break;
      }
    }
  }

  private journalCreatePayload(row: WorkerJournalRow) {
    return {
      id: row.id, environment: row.environment, accountId: row.accountId, instrument: row.instrument,
      direction: row.direction, style: row.style, strategyName: row.strategyName, status: row.status,
      entryPrice: row.entryPrice, stopLoss: row.stopLoss, takeProfit1: row.takeProfit1, takeProfit2: row.takeProfit2,
      units: row.units, riskPercent: row.riskPercent, riskAmount: row.riskAmount, brokerTradeId: row.brokerTradeId,
      openedAt: row.created_at, closedAt: row.closed_at, pnl: row.pnl, metadata: row.metadata,
    };
  }

  private async queueExistingJournals() {
    if (!this.config.dashboardUrl || !this.config.webhookSecret) return;
    for (const row of this.store.journalRows()) {
      await this.sync("journal.create", this.journalCreatePayload(row), `journal.create:${row.id}`);
    }
  }

  private async syncJournalUpdate(row: { id: string; brokerTradeId: string }, status: string, pnl: number | null, notes: string, details: { closeReason?: string | null; closePrice?: number | null; closeTransactionId?: string | null } = {}) {
    const outcomeKey = details.closeTransactionId ?? status;
    await this.sync("journal.update", { journalId: row.id, brokerTradeId: row.brokerTradeId, status, pnl, notes, ...details }, `journal.update:${row.id}:${status}:${outcomeKey}`);
  }

  private closeFillFor(fills: Awaited<ReturnType<typeof fetchOandaOrderFills>>, tradeId: string) {
    return [...fills].reverse().find((fill) => fill.isClose && fill.tradeIds.includes(tradeId)) ?? null;
  }

  private log(input: WorkerEvent) {
    this.store.event(input);
    void this.sync("log", { ...input, environment: this.config.environment });
  }

  private async news(instrument: string) {
    const cached = this.newsCache.get(instrument);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await getEconomicEventStatus(instrument);
    this.newsCache.set(instrument, { expiresAt: Date.now() + 60000, value });
    return value;
  }

  private async scan(instrument: string) {
    const profile = timeframeProfiles[this.config.mode];
    const frameData = await Promise.all(profile.frames.map(async (granularity) => [
      granularity,
      await fetchOandaCandles({ token: this.config.token, environment: this.config.environment, instrument, granularity, count: candleCountForGranularity(granularity) }),
    ] as const));
    const candles = Object.fromEntries(frameData.map(([frame, data]) => [frame, data.candles]));
    const analyses = Object.fromEntries(frameData.map(([frame, data]) => [frame, analyseInstrument({ instrument, label: labelFor(instrument), assetClass: assetClassFor(instrument), candles: data.candles })]));
    return combineTimeframes({ instrument, label: labelFor(instrument), assetClass: assetClassFor(instrument), mode: this.config.mode, analyses, candles });
  }

  private async reviewAnalysis(instrument: string) {
    const cached = this.analysisCache.get(instrument);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await this.scan(instrument);
      this.analysisCache.set(instrument, { expiresAt: Date.now() + this.config.scanMs, value });
      return value;
    } catch {
      return null;
    }
  }

  private async brokerDailyPnl(dayStart: Date) {
    const day = dayStart.toISOString().slice(0, 10);
    if (this.dailyPnlCache?.day === day && this.dailyPnlCache.expiresAt > Date.now()) return this.dailyPnlCache.value;
    const fills = await fetchOandaOrderFills({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, from: dayStart });
    const value = fills.reduce((sum, fill) => sum + fill.pnl, 0);
    this.dailyPnlCache = { day, expiresAt: Date.now() + 60_000, value };
    return value;
  }

  private calculateUnits(accountEquity: number, result: ScannerResult, quote: Awaited<ReturnType<typeof fetchOandaPrice>>) {
    const stopDistance = Math.abs((result.entry ?? quote.mid) - (result.stopLoss ?? quote.mid));
    const sizing = calculateRiskSizedUnits({ equity: accountEquity, riskPercent: this.config.riskPercent, stopDistance, lossConversionFactor: quote.homeConversionFactors.negativeUnits, maxUnits: this.config.maxUnits });
    return sizing ? { ...sizing, stopDistance } : null;
  }

  private async maybeReviewTrade(trade: Awaited<ReturnType<typeof fetchOandaOpenTrades>>[number], result: ScannerResult | null, eventContext: unknown) {
    if (!this.config.llmApiKey) return;
    const prior = this.store.get<{ at: number; price: number; atr: number }>(`review:${trade.id}`);
    const quote = await fetchOandaPrice({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, instrument: trade.instrument });
    const currentPrice = trade.units > 0 ? quote.bid : quote.ask;
    const atr = result?.atrPercent && result.price ? result.price * result.atrPercent / 100 : Math.abs((trade.takeProfit ?? trade.price) - (trade.stopLoss ?? trade.price)) / 1.5;
    const materiallyMoved = !prior || Date.now() - prior.at >= this.config.llmReviewMs || Math.abs(currentPrice - prior.price) >= atr * this.config.llmMoveAtrFraction;
    if (!materiallyMoved) return;
    const technicalSnapshot = result ? { bias: result.bias, score: result.score, rsi: result.rsi, atrPercent: result.atrPercent, timeframeAlignment: result.timeframeAlignment, strategies: result.strategies, invalidation: result.invalidation } : {};
    const input = { reviewReason: eventContext ? "high_impact_news_released" : "material_trade_change", style: this.config.mode, trade: { id: trade.id, instrument: trade.instrument, units: trade.units, price: trade.price, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit }, currentPrice, technicalSnapshot, eventContext };
    const cacheKey = await hashInput({ model: this.config.llmModel, baseUrl: this.config.llmBaseUrl, input: { ...input, currentPriceBucket: priceBucket(currentPrice, result?.atrPercent ?? 0.2) } });
    const cached = this.store.cacheGet<LiveTradeReview>(cacheKey);
    const review = cached?.value ?? (await reviewLiveTrade(this.config.llmApiKey, this.config.llmModel, input, this.config.llmBaseUrl)).value;
    if (!cached) this.store.cacheSet(cacheKey, this.config.llmModel, review, 15 * 60 * 1000);
    this.store.set(`review:${trade.id}`, { at: Date.now(), price: currentPrice, atr });
    this.log({ level: review.drifted || review.decision === "close" ? "warning" : "info", event: cached ? "strategy.review_cache_hit" : "strategy.reviewed", message: `${trade.instrument}: LLM decision ${review.decision} (${review.sentiment}). ${review.explanation}`, instrument: trade.instrument, details: { tradeId: trade.id, model: this.config.llmModel, cacheHit: Boolean(cached), confidence: review.confidence, eventContext } });
    if (review.decision === "close" && review.confidence >= 70 && this.config.autoCloseOnLlmClose) {
      const closed = await closeOandaTrade({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, tradeId: trade.id });
      const managed = this.store.managedOpenTrades().find((row) => row.broker_trade_id === trade.id);
      const notes = `LLM closed: ${review.explanation}`;
      const closePrice = Number.isFinite(closed.price) ? closed.price : null;
      this.store.journalUpdateByBrokerTradeId(trade.id, "closed", closed.pnl, notes, { closeReason: "LLM close", closePrice, closeTransactionId: closed.transactionId });
      if (managed) await this.syncJournalUpdate({ id: managed.id, brokerTradeId: trade.id }, "closed", closed.pnl, notes, { closeReason: "LLM close", closePrice, closeTransactionId: closed.transactionId });
      this.log({ level: "warning", event: "trade.closed_by_policy", message: `Closed ${trade.instrument} after a high-confidence LLM close decision.`, instrument: trade.instrument, details: { tradeId: trade.id, pnl: closed.pnl } });
    }
  }

  private async monitorTrades(trades: Awaited<ReturnType<typeof fetchOandaOpenTrades>>) {
    await this.flushSyncQueue();
    for (const pending of this.store.pendingJournals()) {
      const clientId = typeof pending.metadata.clientId === "string" ? pending.metadata.clientId : null;
      const recovered = clientId ? trades.find((trade) => trade.clientId === clientId) : null;
      if (recovered) {
        this.store.journalUpdateById(pending.id, { status: "open", brokerTradeId: recovered.id, entryPrice: recovered.price, notes: "Recovered broker trade after an interrupted order response." });
        const row = this.store.journalRows().find((item) => item.id === pending.id);
        if (row) await this.sync("journal.create", this.journalCreatePayload(row), `journal.create:${row.id}`);
        this.log({ level: "warning", event: "trade.recovered", message: `${recovered.instrument}: recovered broker trade ${recovered.id} from its deterministic client ID.`, instrument: recovered.instrument, details: { tradeId: recovered.id, journalId: pending.id, clientId } });
      } else if (Date.now() - new Date(pending.created_at).getTime() >= 10 * 60 * 1000) {
        this.store.journalUpdateById(pending.id, { status: "cancelled", notes: "No matching broker trade was found within 10 minutes of submission." });
        const row = this.store.journalRows().find((item) => item.id === pending.id);
        if (row) await this.sync("journal.create", this.journalCreatePayload(row), `journal.create:${row.id}`);
        this.log({ level: "error", event: "trade.submission_unresolved", message: `${pending.instrument}: a submitted journal had no matching OANDA trade and was marked cancelled.`, instrument: pending.instrument, details: { journalId: pending.id, clientId } });
      }
    }
    const managedRows = this.store.managedOpenTrades();
    const managedIds = new Set(managedRows.map((row) => row.broker_trade_id));
    for (const trade of trades) {
      if (!managedIds.has(trade.id)) continue;
      if (!trade.stopLoss || !trade.takeProfit) {
        this.log({ level: "error", event: "trade.unprotected", message: `${trade.instrument} trade ${trade.id} has no broker-side stop and target.`, instrument: trade.instrument, details: { tradeId: trade.id } });
        if (this.config.closeUnprotected) {
          const closed = await closeOandaTrade({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, tradeId: trade.id });
          const managed = managedRows.find((row) => row.broker_trade_id === trade.id);
          const notes = "Safety close: broker-side stop/target was missing.";
          const closePrice = Number.isFinite(closed.price) ? closed.price : null;
          this.store.journalUpdateByBrokerTradeId(trade.id, "closed", closed.pnl, notes, { closeReason: "Safety close", closePrice, closeTransactionId: closed.transactionId });
          if (managed) await this.syncJournalUpdate({ id: managed.id, brokerTradeId: trade.id }, "closed", closed.pnl, notes, { closeReason: "Safety close", closePrice, closeTransactionId: closed.transactionId });
        }
        continue;
      }
      const eventStatus = await this.news(trade.instrument);
      const released = eventStatus.events.find((event) => event.phase === "after" && event.minutesSince <= 1);
      const result = await this.reviewAnalysis(trade.instrument);
      await this.maybeReviewTrade(trade, result, released ?? null);
    }
    const currentIds = new Set(trades.map((trade) => trade.id));
    const missingManaged = managedRows.filter((row) => !currentIds.has(row.broker_trade_id));
    if (!missingManaged.length) return;
    const earliestManaged = missingManaged.reduce((earliest, row) => Math.min(earliest, new Date(row.created_at).getTime()), Date.now());
    const recentFills = await fetchOandaOrderFills({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, from: new Date(Math.max(0, earliestManaged - 60 * 60 * 1000)) });
    for (const managed of missingManaged) {
      let brokerTrade: Awaited<ReturnType<typeof fetchOandaTradeDetails>>;
      try {
        brokerTrade = await fetchOandaTradeDetails({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, tradeId: managed.broker_trade_id });
      } catch (error) {
        if (!(error instanceof OandaApiError) || error.status !== 404) throw error;
        const notes = "The stored broker identifier is not an OANDA trade ID. This legacy journal needs manual reconciliation; no P&L was assumed.";
        this.store.journalUpdateByBrokerTradeId(managed.broker_trade_id, "reconciliation_required", null, notes);
        await this.syncJournalUpdate({ id: managed.id, brokerTradeId: managed.broker_trade_id }, "reconciliation_required", null, notes);
        this.log({ level: "error", event: "trade.reconciliation_required", message: `${managed.instrument}: ${notes}`, instrument: managed.instrument, details: { storedBrokerId: managed.broker_trade_id, journalId: managed.id } });
        continue;
      }
      if (brokerTrade.state !== "CLOSED") {
        this.log({ level: "error", event: "trade.reconciliation_mismatch", message: `${managed.instrument}: trade ${managed.broker_trade_id} was absent from open trades but OANDA reports ${brokerTrade.state}.`, instrument: managed.instrument, details: { tradeId: managed.broker_trade_id, brokerState: brokerTrade.state } });
        continue;
      }
      const relatedFills = recentFills.filter((fill) => fill.tradeIds.includes(managed.broker_trade_id));
      const fillPnl = relatedFills.reduce((sum, fill) => sum + fill.pnl, 0);
      const pnl = brokerTrade.pnl ?? fillPnl;
      const closeFill = this.closeFillFor(recentFills, managed.broker_trade_id);
      const closeReason = closeFill?.closeReason ?? "Closed order";
      const notes = `${closeReason}. Trade no longer open at OANDA; reconciled from transaction history.`;
      const closePrice = closeFill?.price ?? brokerTrade.closePrice;
      const closeTransactionId = closeFill?.id ?? brokerTrade.closingTransactionIds.at(-1) ?? null;
      this.store.journalUpdateByBrokerTradeId(managed.broker_trade_id, "closed", pnl, notes, { closeReason, closePrice, closeTransactionId });
      await this.syncJournalUpdate({ id: managed.id, brokerTradeId: managed.broker_trade_id }, "closed", pnl, notes, { closeReason, closePrice, closeTransactionId });
    }
  }

  private async enterTrade(result: ScannerResult, equity: number, openTrades: Awaited<ReturnType<typeof fetchOandaOpenTrades>>) {
    if (!validPlan(result) || result.score < this.config.minScore || (result.confirmations ?? 0) < this.config.minConfirmations || (this.config.requireTriggerConfirmation && !hasTriggerConfirmation(result.strategies))) return null;
    if (openTrades.length >= this.config.maxOpenTrades || openTrades.filter((trade) => trade.instrument === result.instrument).length >= this.config.maxOpenTradesPerInstrument) return null;
    const newsStatus = await this.news(result.instrument);
    if (!newsStatus.available || newsStatus.blocked) {
      this.log({ level: "warning", event: newsStatus.available ? "entry.blocked_high_impact_news" : "entry.blocked_news_unavailable", message: `${result.instrument}: entry blocked by the economic-calendar gate.`, instrument: result.instrument, details: { blockedBy: newsStatus.blockedBy, error: newsStatus.error } });
      return null;
    }
    const quote = await fetchOandaPrice({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument });
    const spreadPips = quote.spread / pipSize(result.instrument);
    if (!quote.tradeable || spreadPips > this.config.maxSpreadPips) {
      this.log({ level: "warning", event: "entry.blocked_market_condition", message: `${result.instrument}: entry blocked because the market is not tradeable or spread is too wide.`, instrument: result.instrument, details: { tradeable: quote.tradeable, spreadPips, maxSpreadPips: this.config.maxSpreadPips } });
      return null;
    }
    const plan = { ...result, entry: result.bias === "long" ? quote.ask : quote.bid };
    const bias: "long" | "short" = result.bias === "long" ? "long" : "short";
    const direction = bias === "long" ? 1 : -1;
    const target = result.takeProfit2 ?? result.takeProfit1;
    const protection = validateProtectedOrder({ instrument: result.instrument, units: direction, entry: plan.entry, stopLoss: result.stopLoss, takeProfit: target, maxUnits: this.config.maxUnits });
    if (!protection.ok) {
      this.log({ level: "warning", event: "entry.blocked_invalid_levels", message: `${result.instrument}: ${protection.error}`, instrument: result.instrument, details: { entry: plan.entry, stopLoss: result.stopLoss, takeProfit1: result.takeProfit1, takeProfit2: result.takeProfit2 } });
      return null;
    }
    const sizing = this.calculateUnits(equity, plan, quote);
    if (!sizing) return null;
    const signalKey = `${result.instrument}:${this.config.mode}:${bias}:${result.updatedAt}:${result.score}:${result.selectedStrategy?.id ?? "trend-continuation"}`;
    if (this.store.get<number>(`signal:${signalKey}`)) return null;
    const journalId = randomUUID();
    const signalHash = await hashInput(signalKey);
    const clientId = `foresight-${signalHash.slice(0, 24)}`;
    this.store.set(`signal:${signalKey}`, Date.now());
    this.store.journalCreate({ id: journalId, brokerTradeId: null, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument, direction: bias, style: this.config.mode, strategyName: result.selectedStrategy?.name ?? "Multi-timeframe trend continuation", entryPrice: plan.entry, stopLoss: result.stopLoss!, takeProfit1: result.takeProfit1!, takeProfit2: result.takeProfit2, units: direction * sizing.units, riskPercent: this.config.riskPercent, riskAmount: sizing.riskAmount, status: "submitted", metadata: { score: result.score, confirmations: result.confirmations, selectedStrategy: result.selectedStrategy, timeframes: result.timeframeAlignment, clientId, signalKey, riskReward: protection.riskReward } });
    try {
      const order = await submitOandaMarketOrder({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument, units: direction * sizing.units, stopLoss: result.stopLoss, takeProfit: target, clientExtensions: { id: clientId, tag: "foresight-autotrader", comment: this.config.mode } });
      if (!order.tradeId) {
        const notes = "OANDA filled the order but did not open a new trade. It may have reduced or closed an existing position; automatic management was not attached.";
        this.store.journalUpdateById(journalId, { status: "closed", entryPrice: order.fillPrice, pnl: order.realisedPnl, notes, metadata: { orderId: order.orderId, fillTransactionId: order.fillTransactionId, reducedTradeId: order.reducedTradeId, closedTradeIds: order.closedTradeIds } });
        const row = this.store.journalRows().find((item) => item.id === journalId);
        if (row) await this.sync("journal.create", this.journalCreatePayload(row), `journal.create:${journalId}`);
        this.log({ level: "error", event: "trade.fill_without_open_trade", message: `${result.instrument}: ${notes}`, instrument: result.instrument, details: { journalId, order } });
        return null;
      }
      const brokerTradeId = order.tradeId;
      this.store.journalUpdateById(journalId, { status: "open", brokerTradeId, entryPrice: order.fillPrice, notes: "OANDA order filled with broker-side stop loss and take profit.", metadata: { orderId: order.orderId, fillTransactionId: order.fillTransactionId, fillTime: order.fillTime } });
      const row = this.store.journalRows().find((item) => item.id === journalId);
      if (row) await this.sync("journal.create", this.journalCreatePayload(row), `journal.create:${journalId}`);
      this.log({ event: "trade.opened", message: `Opened ${bias} ${result.instrument} with ${Math.abs(sizing.units)} units.`, instrument: result.instrument, details: { brokerTradeId, journalId, score: result.score, confirmations: result.confirmations, entry: order.fillPrice ?? plan.entry, stopLoss: result.stopLoss, takeProfit: target, riskAmount: sizing.riskAmount, riskReward: protection.riskReward } });
      return { id: brokerTradeId, instrument: result.instrument, price: order.fillPrice ?? plan.entry, openTime: order.fillTime, units: direction * sizing.units, unrealizedPL: 0, stopLoss: result.stopLoss, takeProfit: target, clientId, clientTag: "foresight-autotrader" };
    } catch (error) {
      const notes = error instanceof Error ? error.message : "Order submission failed.";
      const outcomeUnknown = error instanceof OandaApiError && error.status === 502;
      this.store.journalUpdateById(journalId, { status: outcomeUnknown ? "submitted" : "cancelled", notes: outcomeUnknown ? `Broker outcome unknown: ${notes}` : notes });
      const row = this.store.journalRows().find((item) => item.id === journalId);
      if (row) await this.sync("journal.create", this.journalCreatePayload(row), `journal.create:${journalId}`);
      this.log({ level: "error", event: outcomeUnknown ? "trade.open_outcome_unknown" : "trade.open_failed", message: `${result.instrument}: ${notes}`, instrument: result.instrument, details: { journalId, clientId } });
      return null;
    }
  }

  private async cycle() {
    const account = await fetchOandaAccountSummary({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId });
    const trades = await fetchOandaOpenTrades({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId });
    await this.monitorTrades(trades);
    const dayStart = startOfUtcDay();
    const localDayPnl = this.store.dailyPnl(dayStart);
    const dayPnl = await this.brokerDailyPnl(dayStart);
    const baselineKey = `equity-baseline:${dayStart.toISOString().slice(0, 10)}`;
    let baselineEquity = this.store.get<number>(baselineKey);
    if (!baselineEquity || !Number.isFinite(baselineEquity) || baselineEquity <= 0) {
      baselineEquity = Math.max(account.balance - dayPnl, 0.01);
      this.store.set(baselineKey, baselineEquity);
    }
    const openLoss = Math.min(0, trades.reduce((sum, trade) => sum + trade.unrealizedPL, 0));
    const guardedDayPnl = dayPnl + openLoss;
    const maxLoss = baselineEquity * this.config.maxDailyLossPercent / 100;
    if (Date.now() - this.lastHeartbeatAt >= this.config.heartbeatMs) {
      this.lastHeartbeatAt = Date.now();
      this.log({ event: "worker.heartbeat", message: `Worker active: equity ${account.equity.toFixed(2)}, open trades ${trades.length}, guarded daily P&L ${guardedDayPnl.toFixed(2)}.`, details: { equity: account.equity, baselineEquity, openTrades: trades.length, brokerRealisedDayPnl: dayPnl, localJournalDayPnl: localDayPnl, openLoss, guardedDayPnl, mode: this.config.mode, model: this.config.llmModel, baseUrl: this.config.llmBaseUrl } });
    }
    if (guardedDayPnl <= -maxLoss) { this.log({ level: "error", event: "entry.blocked_daily_loss", message: `New entries blocked: daily loss limit reached (${guardedDayPnl.toFixed(2)} including open losses).`, details: { brokerRealisedDayPnl: dayPnl, localJournalDayPnl: localDayPnl, openLoss, guardedDayPnl, maxLoss, baselineEquity } }); return; }
    if (this.store.dailyTradeCount(dayStart) >= this.config.maxTradesPerDay) { this.log({ level: "warning", event: "entry.blocked_trade_count", message: "New entries blocked: daily trade limit reached." }); return; }
    if (Date.now() - this.lastScanAt < this.config.scanMs) return;
    this.lastScanAt = Date.now();
    const results: ScannerResult[] = [];
    for (const instrument of this.config.instruments) {
      try { results.push(await this.scan(instrument)); } catch (error) { this.log({ level: "error", event: "scan.failed", message: `${instrument}: ${error instanceof Error ? error.message : "scan failed"}`, instrument }); }
    }
    results.sort((a, b) => b.score - a.score);
    const currentTrades = [...trades];
    for (const result of results) {
      if (currentTrades.length >= this.config.maxOpenTrades || this.store.dailyTradeCount(dayStart) >= this.config.maxTradesPerDay) break;
      const opened = await this.enterTrade(result, account.equity, currentTrades);
      if (opened) currentTrades.push(opened);
    }
  }

  async run() {
    await this.queueExistingJournals();
    this.log({ event: "worker.started", message: `Autonomous ${this.config.environment} worker started in ${this.config.mode} mode.`, details: { instruments: this.config.instruments, riskPercent: this.config.riskPercent, llmModel: this.config.llmModel, llmBaseUrl: this.config.llmBaseUrl, llmEnabled: Boolean(this.config.llmApiKey) } });
    while (!this.stopping) {
      try { await this.cycle(); } catch (error) { this.log({ level: "error", event: "worker.cycle_failed", message: error instanceof Error ? error.message : "Worker cycle failed." }); }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.config.pollMs));
    }
    this.cleanup();
  }

  stop() { this.stopping = true; }
  private cleanup() { this.store.event({ event: "worker.stopped", message: "Autonomous worker stopped." }); this.store.close(); closeSync(this.lockFd); try { unlinkSync(this.config.lockPath); } catch {} }
}

const config = loadConfig();
if (!config.enabled) {
  console.log("AUTOTRADER_ENABLED is not true; no orders will be placed.");
} else {
  const trader = new AutoTrader(config);
  await trader.run();
}
