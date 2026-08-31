import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  fetchOandaAccountSummary,
  fetchOandaCandles,
  fetchOandaOpenTrades,
  fetchOandaOrderFills,
  fetchOandaPrice,
  submitOandaMarketOrder,
  closeOandaTrade,
  type OandaEnvironment,
} from "../lib/oanda-api.ts";
import { getEconomicEventStatus } from "../lib/economic-calendar.ts";
import { analyseInstrument, combineTimeframes, timeframeProfiles, type ScannerResult, type TimeframeMode } from "../lib/market-scanner.ts";
import { reviewLiveTrade, type LiveTradeReview } from "../lib/openai-strategy.ts";
import { defaultAiBaseUrl, normalizeAiBaseUrl } from "../lib/ai-config.ts";
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
    maxDailyLossPercent: Math.min(20, Math.max(0.1, numberEnv("MAX_DAILY_LOSS_PERCENT", 2))),
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

function pipSize(instrument: string) {
  if (instrument.endsWith("JPY")) return 0.01;
  if (instrument.startsWith("XAU")) return 0.1;
  if (instrument.startsWith("US30")) return 1;
  return 0.0001;
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

  constructor(config: Config) {
    this.config = config;
    mkdirSync(dirname(config.lockPath), { recursive: true });
    if (existsSync(config.lockPath)) throw new Error(`Another autonomous worker appears to be running: ${config.lockPath}`);
    this.lockFd = openSync(config.lockPath, "wx");
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
      if (row.brokerTradeId && ["closed", "cancelled", "win", "loss", "breakeven"].includes(row.status)) {
        await this.syncJournalUpdate({ id: row.id, brokerTradeId: row.brokerTradeId }, row.status, row.pnl ?? 0, "Recovered local journal outcome during worker startup reconciliation.");
      }
    }
  }

  private async syncJournalUpdate(row: { id: string; brokerTradeId: string }, status: string, pnl: number, notes: string) {
    await this.sync("journal.update", { journalId: row.id, brokerTradeId: row.brokerTradeId, status, pnl, notes }, `journal.update:${row.id}:${status}`);
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
      await fetchOandaCandles({ token: this.config.token, environment: this.config.environment, instrument, granularity, count: 80 }),
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

  private calculateUnits(accountEquity: number, result: ScannerResult, quote: Awaited<ReturnType<typeof fetchOandaPrice>>) {
    const riskAmount = accountEquity * this.config.riskPercent / 100;
    const stopDistance = Math.abs((result.entry ?? quote.mid) - (result.stopLoss ?? quote.mid));
    const conversion = quote.homeConversionFactors.negativeUnits;
    const cashRiskPerUnit = stopDistance * conversion;
    if (!Number.isFinite(riskAmount) || riskAmount <= 0 || !Number.isFinite(cashRiskPerUnit) || cashRiskPerUnit <= 0) return null;
    const units = Math.min(this.config.maxUnits, Math.floor(riskAmount / cashRiskPerUnit));
    return units >= 1 ? { units, riskAmount, stopDistance, cashRiskPerUnit } : null;
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
      this.store.journalUpdateByBrokerTradeId(trade.id, "closed", closed.pnl, "Closed automatically after high-confidence LLM close decision.");
      if (managed) await this.syncJournalUpdate({ id: managed.id, brokerTradeId: trade.id }, "closed", closed.pnl, "Closed automatically after high-confidence LLM close decision.");
      this.log({ level: "warning", event: "trade.closed_by_policy", message: `Closed ${trade.instrument} after a high-confidence LLM close decision.`, instrument: trade.instrument, details: { tradeId: trade.id, pnl: closed.pnl } });
    }
  }

  private async monitorTrades(trades: Awaited<ReturnType<typeof fetchOandaOpenTrades>>) {
    await this.flushSyncQueue();
    const managedRows = this.store.managedOpenTrades();
    const managedIds = new Set(managedRows.map((row) => row.broker_trade_id));
    for (const trade of trades) {
      if (!managedIds.has(trade.id)) continue;
      if (!trade.stopLoss || !trade.takeProfit) {
        this.log({ level: "error", event: "trade.unprotected", message: `${trade.instrument} trade ${trade.id} has no broker-side stop and target.`, instrument: trade.instrument, details: { tradeId: trade.id } });
        if (this.config.closeUnprotected) {
          const closed = await closeOandaTrade({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, tradeId: trade.id });
          const managed = managedRows.find((row) => row.broker_trade_id === trade.id);
          this.store.journalUpdateByBrokerTradeId(trade.id, "closed", closed.pnl, "Closed because broker-side protection was missing.");
          if (managed) await this.syncJournalUpdate({ id: managed.id, brokerTradeId: trade.id }, "closed", closed.pnl, "Closed because broker-side protection was missing.");
        }
        continue;
      }
      const eventStatus = await this.news(trade.instrument);
      const released = eventStatus.events.find((event) => event.phase === "after" && event.minutesSince <= 1);
      const result = await this.reviewAnalysis(trade.instrument);
      await this.maybeReviewTrade(trade, result, released ?? null);
    }
    const currentIds = new Set(trades.map((trade) => trade.id));
    const recentFills = await fetchOandaOrderFills({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, from: startOfUtcDay() });
    for (const managed of managedRows) {
      if (currentIds.has(managed.broker_trade_id)) continue;
      const pnl = recentFills.filter((fill) => fill.tradeId === managed.broker_trade_id).reduce((sum, fill) => sum + fill.pnl, 0);
      this.store.journalUpdateByBrokerTradeId(managed.broker_trade_id, "closed", pnl, "Trade no longer open at OANDA; reconciled from transaction history.");
      await this.syncJournalUpdate({ id: managed.id, brokerTradeId: managed.broker_trade_id }, "closed", pnl, "Trade no longer open at OANDA; reconciled from transaction history.");
    }
  }

  private async enterTrade(result: ScannerResult, equity: number, openTrades: Awaited<ReturnType<typeof fetchOandaOpenTrades>>) {
    const hasTriggerConfirmation = result.strategies?.some((strategy) => strategy.status === "confirmed" && strategy.id !== "trend-continuation") ?? false;
    if (!validPlan(result) || result.score < this.config.minScore || (result.confirmations ?? 0) < this.config.minConfirmations || (this.config.requireTriggerConfirmation && !hasTriggerConfirmation)) return;
    if (openTrades.length >= this.config.maxOpenTrades || openTrades.filter((trade) => trade.instrument === result.instrument).length >= this.config.maxOpenTradesPerInstrument) return;
    const newsStatus = await this.news(result.instrument);
    if (!newsStatus.available || newsStatus.blocked) {
      this.log({ level: "warning", event: newsStatus.available ? "entry.blocked_high_impact_news" : "entry.blocked_news_unavailable", message: `${result.instrument}: entry blocked by the economic-calendar gate.`, instrument: result.instrument, details: { blockedBy: newsStatus.blockedBy, error: newsStatus.error } });
      return;
    }
    const quote = await fetchOandaPrice({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument });
    const spreadPips = quote.spread / pipSize(result.instrument);
    if (!quote.tradeable || spreadPips > this.config.maxSpreadPips) {
      this.log({ level: "warning", event: "entry.blocked_market_condition", message: `${result.instrument}: entry blocked because the market is not tradeable or spread is too wide.`, instrument: result.instrument, details: { tradeable: quote.tradeable, spreadPips, maxSpreadPips: this.config.maxSpreadPips } });
      return;
    }
    const plan = { ...result, entry: result.bias === "long" ? quote.ask : quote.bid };
    const orderedLevels = result.bias === "long"
      ? result.stopLoss! < plan.entry && plan.entry < result.takeProfit1! && result.takeProfit1! <= result.takeProfit2!
      : result.takeProfit2! <= result.takeProfit1! && result.takeProfit1! < plan.entry && plan.entry < result.stopLoss!;
    if (!orderedLevels) {
      this.log({ level: "warning", event: "entry.blocked_invalid_levels", message: `${result.instrument}: entry, stop and targets are not ordered correctly at the live quote.`, instrument: result.instrument, details: { entry: plan.entry, stopLoss: result.stopLoss, takeProfit1: result.takeProfit1, takeProfit2: result.takeProfit2 } });
      return;
    }
    const sizing = this.calculateUnits(equity, plan, quote);
    if (!sizing) return;
    const bias: "long" | "short" = result.bias === "long" ? "long" : "short";
    const direction = bias === "long" ? 1 : -1;
    const signalKey = `${result.instrument}:${this.config.mode}:${bias}:${result.updatedAt}:${result.score}:${result.selectedStrategy?.id ?? "trend-continuation"}`;
    if (this.store.get<number>(`signal:${signalKey}`)) return;
    const journalId = randomUUID();
    const clientId = `foresight-${journalId.slice(0, 18)}`;
    const order = await submitOandaMarketOrder({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument, units: direction * sizing.units, stopLoss: result.stopLoss, takeProfit: result.takeProfit2 ?? result.takeProfit1, clientExtensions: { id: clientId, tag: "foresight-autotrader", comment: this.config.mode } });
    const brokerTradeId = order.tradeId ?? order.orderId;
    this.store.set(`signal:${signalKey}`, Date.now());
    this.store.journalCreate({ id: journalId, brokerTradeId, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument, direction: bias, style: this.config.mode, strategyName: result.selectedStrategy?.name ?? "Multi-timeframe trend continuation", entryPrice: plan.entry!, stopLoss: result.stopLoss!, takeProfit1: result.takeProfit1!, takeProfit2: result.takeProfit2, units: direction * sizing.units, riskPercent: this.config.riskPercent, riskAmount: sizing.riskAmount, status: "open", metadata: { score: result.score, confirmations: result.confirmations, selectedStrategy: result.selectedStrategy, timeframes: result.timeframeAlignment, clientId } });
    await this.sync("journal.create", { id: journalId, environment: this.config.environment, accountId: this.config.accountId, instrument: result.instrument, direction: bias, style: this.config.mode, strategyName: result.selectedStrategy?.name ?? "Multi-timeframe trend continuation", setupType: "autonomous", status: "open", entryPrice: plan.entry, stopLoss: result.stopLoss, takeProfit1: result.takeProfit1, takeProfit2: result.takeProfit2, units: direction * sizing.units, lots: Math.abs(sizing.units) / 100000, riskPercent: this.config.riskPercent, riskAmount: sizing.riskAmount, brokerTradeId, openedAt: new Date().toISOString(), metadata: { score: result.score, confirmations: result.confirmations, clientId } }, `journal.create:${journalId}`);
    this.log({ event: "trade.opened", message: `Opened ${bias} ${result.instrument} with ${Math.abs(sizing.units)} units.`, instrument: result.instrument, details: { brokerTradeId, journalId, score: result.score, confirmations: result.confirmations, entry: plan.entry, stopLoss: result.stopLoss, takeProfit: result.takeProfit2 ?? result.takeProfit1, riskAmount: sizing.riskAmount } });
  }

  private async cycle() {
    const account = await fetchOandaAccountSummary({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId });
    const trades = await fetchOandaOpenTrades({ token: this.config.token, environment: this.config.environment, accountId: this.config.accountId });
    const dayPnl = this.store.dailyPnl(startOfUtcDay());
    const maxLoss = account.equity * this.config.maxDailyLossPercent / 100;
    if (Date.now() - this.lastHeartbeatAt >= this.config.heartbeatMs) {
      this.lastHeartbeatAt = Date.now();
      this.log({ event: "worker.heartbeat", message: `Worker active: equity ${account.equity.toFixed(2)}, open trades ${trades.length}, local daily P&L ${dayPnl.toFixed(2)}.`, details: { equity: account.equity, openTrades: trades.length, dayPnl, mode: this.config.mode, model: this.config.llmModel, baseUrl: this.config.llmBaseUrl } });
    }
    await this.monitorTrades(trades);
    if (dayPnl <= -maxLoss) { this.log({ level: "error", event: "entry.blocked_daily_loss", message: `New entries blocked: local daily loss limit reached (${dayPnl.toFixed(2)}).`, details: { dayPnl, maxLoss } }); return; }
    if (this.store.dailyTradeCount(startOfUtcDay()) >= this.config.maxTradesPerDay) { this.log({ level: "warning", event: "entry.blocked_trade_count", message: "New entries blocked: daily trade limit reached." }); return; }
    if (Date.now() - this.lastScanAt < this.config.scanMs) return;
    this.lastScanAt = Date.now();
    const results: ScannerResult[] = [];
    for (const instrument of this.config.instruments) {
      try { results.push(await this.scan(instrument)); } catch (error) { this.log({ level: "error", event: "scan.failed", message: `${instrument}: ${error instanceof Error ? error.message : "scan failed"}`, instrument }); }
    }
    results.sort((a, b) => b.score - a.score);
    for (const result of results) await this.enterTrade(result, account.equity, trades);
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
