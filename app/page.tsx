"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Newspaper,
  RefreshCw,
  ScanSearch,
  Settings2,
  ShieldAlert,
  Sparkles,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TradingViewChart } from "@/components/tradingview-chart";
import { EconomicCalendar, PairNews } from "@/components/tradingview-context";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  complete: boolean;
};
type MarketData = {
  candles: Candle[];
  price: number;
  changePercent: number;
  lastUpdated: string;
  environment: "practice" | "live";
};
type Quote = {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  time: string;
  tradeable: boolean;
  marketStatus: string;
  environment: "practice" | "live";
  homeConversionFactors?: { positiveUnits: number; negativeUnits: number };
};
type AccountSummary = {
  accountId: string;
  currency: string;
  balance: number;
  equity: number;
  marginAvailable: number | null;
  openTradeCount: number;
  openPositionCount: number;
};
type OpenTrade = {
  id: string;
  instrument: string;
  price: number;
  openTime: string | null;
  units: number;
  unrealizedPL: number;
  stopLoss: number | null;
  takeProfit: number | null;
};
type TradeReview = {
  drifted: boolean;
  decision: "hold" | "review" | "reduce" | "close";
  confidence: number;
  explanation: string;
  recommendedAction: string;
  reviewedAt: string;
};
type StrategyEvidence = {
  id: string;
  name: string;
  status: "selected" | "confirmed" | "waiting" | "rejected";
  evidence: string;
  why: string;
  nextStep: string;
};
type ScanResult = {
  instrument: string;
  label: string;
  assetClass: "forex" | "metal" | "index";
  bias: "long" | "short" | "neutral";
  score: number;
  price: number;
  change24h: number;
  rsi: number;
  atrPercent: number;
  rangePosition: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward1: number | null;
  riskReward2: number | null;
  analysis: string;
  reasons: string[];
  invalidation: string;
  setup: string;
  updatedAt: string;
  timeframeMode?: "scalping" | "intraday" | "swing";
  timeframeAlignment?: Array<{
    timeframe: string;
    bias: "long" | "short" | "neutral";
    score: number;
  }>;
  confirmations?: number;
  strategies?: StrategyEvidence[];
  selectedStrategy?: StrategyEvidence;
};
type ScannerData = {
  generatedAt: string;
  mode: "scalping" | "intraday" | "swing";
  timeframes: {
    context: string;
    setup: string;
    trigger: string;
    frames: string[];
  };
  results: ScanResult[];
  unavailable: Array<{ instrument: string; label: string }>;
};
type AiStrategy = {
  instrument: string;
  verdict: "long" | "short" | "wait";
  strategyName: string;
  setupType: "breakout" | "pullback" | "reversal" | "range" | "no_trade";
  confidence: number;
  entryType: "limit" | "stop" | "market" | "none";
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward1: number | null;
  riskReward2: number | null;
  analysis: string;
  reasons: string[];
  trigger: string;
  invalidation: string;
  eventRisk: string;
  methodology: string[];
};
type AiStrategyData = {
  model: string;
  generatedAt: string;
  strategies: AiStrategy[];
  luxAlgoSources: Array<{
    slug: string;
    name: string;
    family: string;
    url: string;
  }>;
};
type ConnectionState =
  "checking" | "disconnected" | "configured" | "connected" | "error";

const instruments = [
  { value: "EUR_USD", label: "EUR / USD", note: "Most liquid major" },
  { value: "GBP_USD", label: "GBP / USD", note: "London momentum" },
  { value: "USD_JPY", label: "USD / JPY", note: "Rates-sensitive major" },
  { value: "USD_CHF", label: "USD / CHF", note: "Defensive dollar pair" },
  { value: "AUD_USD", label: "AUD / USD", note: "Risk and China sensitivity" },
  { value: "NZD_USD", label: "NZD / USD", note: "Asia-Pacific momentum" },
  { value: "USD_CAD", label: "USD / CAD", note: "Oil-sensitive major" },
  { value: "EUR_GBP", label: "EUR / GBP", note: "European relative strength" },
  { value: "EUR_JPY", label: "EUR / JPY", note: "Risk-on cross" },
  { value: "GBP_JPY", label: "GBP / JPY", note: "High-volatility cross" },
  { value: "XAU_USD", label: "XAU / USD", note: "Gold versus US dollar" },
  { value: "US30_USD", label: "US30", note: "Dow Jones CFD" },
];

function priceDecimals(instrument: string) {
  if (instrument.endsWith("_JPY")) return 3;
  if (instrument === "XAU_USD") return 2;
  if (instrument === "US30_USD") return 1;
  return 5;
}

function pipMultiplier(instrument: string) {
  if (instrument.endsWith("_JPY")) return 100;
  if (instrument === "XAU_USD") return 10;
  if (instrument === "US30_USD") return 1;
  return 10000;
}

function formatScannerPrice(instrument: string, value: number | null) {
  return value === null ? "Wait" : value.toFixed(priceDecimals(instrument));
}

function chartPoints(candles: Candle[]) {
  if (candles.length < 2) return "";
  const values = candles.map((c) => c.close);
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  return values
    .map(
      (value, index) =>
        String((index / (values.length - 1)) * 780) +
        "," +
        String(164 - ((value - min) / span) * 142),
    )
    .join(" ");
}

export default function Home() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedInstrument = searchParams.get("instrument");
  const [instrument, setInstrument] = useState(
    instruments.some((item) => item.value === requestedInstrument)
      ? requestedInstrument!
      : "EUR_USD",
  );
  const [granularity, setGranularity] = useState("H1");
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [environment, setEnvironment] = useState<"practice" | "live">(
    "practice",
  );
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [data, setData] = useState<MarketData | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
  const [tradeReview, setTradeReview] = useState<TradeReview | null>(null);
  const [monitorStatus, setMonitorStatus] = useState("");
  const [scanner, setScanner] = useState<ScannerData | null>(null);
  const [scanMode, setScanMode] = useState<"scalping" | "intraday" | "swing">(
    "intraday",
  );
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiData, setAiData] = useState<AiStrategyData | null>(null);
  const [aiSourceScan, setAiSourceScan] = useState("");
  const [aiPriceSnapshot, setAiPriceSnapshot] = useState<
    Record<string, number>
  >({});
  const [aiHydrated, setAiHydrated] = useState(false);
  const [executionMode, setExecutionMode] = useState<"paper" | "live">("paper");
  const [riskPercent, setRiskPercent] = useState("0.5");
  const [orderStatus, setOrderStatus] = useState("");
  const [liveConfirm, setLiveConfirm] = useState(false);
  const scanRequested = useRef(false);
  const reviewMemory = useRef<Record<string, { price: number; at: number }>>({});
  const reviewBusy = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("forex-research-ai-analysis");
      if (saved) {
        const parsed = JSON.parse(saved) as {
          data?: AiStrategyData;
          prices?: Record<string, number>;
        };
        if (parsed.data?.strategies?.length)
          window.setTimeout(() => setAiData(parsed.data!), 0);
        if (parsed.prices)
          window.setTimeout(() => setAiPriceSnapshot(parsed.prices!), 0);
      }
    } catch {
      // Ignore stale local analysis and fetch when needed.
    } finally {
      setAiHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!aiHydrated || !aiData) return;
    window.localStorage.setItem(
      "forex-research-ai-analysis",
      JSON.stringify({ data: aiData, prices: aiPriceSnapshot }),
    );
  }, [aiData, aiHydrated, aiPriceSnapshot]);

  const generateAiStrategies = useCallback(
    async (markets: ScanResult[], sourceScan: string, force = false) => {
      void force;
      setAiLoading(true);
      setAiError("");
      setAiSourceScan(sourceScan);
      try {
        const response = await fetch("/api/ai/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markets: markets.slice(0, 3),
            mode: scanner?.mode ?? scanMode,
          }),
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Unable to generate AI strategies.");
        setAiData(payload);
        setAiPriceSnapshot(
          Object.fromEntries(
            markets.map((market) => [market.instrument, market.price]),
          ),
        );
      } catch (error) {
        setAiError(
          error instanceof Error
            ? error.message
            : "Unable to generate AI strategies.",
        );
      } finally {
        setAiLoading(false);
      }
    },
    [scanMode, scanner],
  );

  const aiNeedsRefresh = useCallback(
    (markets: ScanResult[]) => {
      if (!aiData || !markets.length) return true;
      return markets.some((market) => {
        const previous = aiPriceSnapshot[market.instrument];
        if (!previous) return true;
        const move = Math.abs(market.price - previous) / previous;
        const meaningfulMove = Math.max(
          0.0005,
          (market.atrPercent * 0.25) / 100,
        );
        return move >= meaningfulMove;
      });
    },
    [aiData, aiPriceSnapshot],
  );

  const runScanner = useCallback(async () => {
    setScanning(true);
    setScannerError("");
    try {
      const response = await fetch(
        "/api/oanda/scanner?mode=" + scanMode + "&t=" + Date.now(),
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error ||
            payload.message ||
            "Unable to complete the daily scan.",
        );
      setScanner({
        ...payload,
        mode:
          payload.mode === "scalping" || payload.mode === "swing"
            ? payload.mode
            : "intraday",
        timeframes: payload.timeframes ?? {
          context: "H4",
          setup: "H1",
          trigger: "M15",
          frames: ["H4", "H1", "M15"],
        },
        results: Array.isArray(payload.results) ? payload.results : [],
        unavailable: Array.isArray(payload.unavailable)
          ? payload.unavailable
          : [],
      });
      setAiData(null);
      setAiSourceScan("");
    } catch (error) {
      setScannerError(
        error instanceof Error
          ? error.message
          : "Unable to complete the daily scan.",
      );
    } finally {
      setScanning(false);
    }
  }, [scanMode]);

  const refreshCandles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        "/api/oanda?instrument=" + instrument + "&granularity=" + granularity,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error ||
            payload.message ||
            "Unable to refresh OANDA candles.",
        );
      setData(payload);
      setEnvironment(payload.environment);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to refresh OANDA candles.",
      );
    } finally {
      setLoading(false);
    }
  }, [instrument, granularity]);

  const refreshQuote = useCallback(
    async (quiet = false) => {
      try {
        const response = await fetch(
          "/api/oanda/price?instrument=" + instrument + "&t=" + Date.now(),
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error ||
              payload.message ||
              "Unable to load OANDA live pricing.",
          );
        setQuote(payload);
        setEnvironment(payload.environment);
        setConnection("connected");
        if (!quiet) setMessage("");
      } catch (error) {
        if (!quiet) {
          setConnection("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load OANDA live pricing.",
          );
        }
      }
    },
    [instrument],
  );

  const refreshAccount = useCallback(async () => {
    try {
      const response = await fetch("/api/oanda/account?t=" + Date.now(), { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.connected) setAccount(payload);
    } catch {
      // Account data is supplementary; the quote and scanner can continue without it.
    }
  }, []);

  const refreshTrades = useCallback(async () => {
    try {
      const response = await fetch("/api/oanda/trades?t=" + Date.now(), { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.connected) setOpenTrades(Array.isArray(payload.trades) ? payload.trades : []);
    } catch {
      // The next polling cycle will retry without interrupting the trade screen.
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/oanda/connection", {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!active) return;
        if (response.ok && payload.connected) {
          setEnvironment(payload.environment);
          setConnection("configured");
          await Promise.all([refreshCandles(), refreshQuote(), refreshAccount()]);
        } else {
          setConnection("disconnected");
        }
      } catch {
        if (active) setConnection("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshAccount, refreshCandles, refreshQuote]);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/connection", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (active) setAiConnected(Boolean(response.ok && payload.connected));
      })
      .catch(() => {
        if (active) setAiConnected(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (connection !== "connected" && connection !== "configured") return;
    const timer = window.setInterval(() => {
      void refreshQuote(true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [connection, refreshQuote]);

  useEffect(() => {
    if (executionMode !== "live" || (connection !== "connected" && connection !== "configured")) return;
    const first = window.setTimeout(() => void refreshTrades(), 0);
    const timer = window.setInterval(() => void refreshTrades(), 5000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [connection, executionMode, refreshTrades]);

  useEffect(() => {
    if (pathname !== "/" || connection !== "connected" || scanRequested.current)
      return;
    scanRequested.current = true;
    void runScanner();
  }, [connection, pathname, runScanner]);

  useEffect(() => {
    if (
      !aiHydrated ||
      !aiConnected ||
      !scanner?.results.length ||
      aiLoading ||
      aiSourceScan === scanner.generatedAt ||
      !aiNeedsRefresh(scanner.results)
    )
      return;
    const timer = window.setTimeout(() => {
      void generateAiStrategies(scanner.results, scanner.generatedAt);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    aiConnected,
    aiHydrated,
    aiLoading,
    aiNeedsRefresh,
    aiSourceScan,
    generateAiStrategies,
    scanner,
  ]);

  useEffect(() => {
    if (
      !pathname.startsWith("/markets") ||
      connection !== "connected" ||
      (scanner && scanner.mode === scanMode)
    )
      return;
    const timer = window.setTimeout(() => {
      void runScanner();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [connection, pathname, runScanner, scanMode, scanner]);

  const saveConnection = async () => {
    setSaving(true);
    setMessage("Validating token and live pricing with OANDA…");
    try {
      const response = await fetch("/api/oanda/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, accountId, environment }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "OANDA rejected this connection.");
      setToken("");
      setMessage("");
      setSettingsOpen(false);
      setConnection("configured");
      await Promise.all([refreshCandles(), refreshQuote(), refreshAccount()]);
    } catch (error) {
      setConnection("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save this connection.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveAiConnection = async () => {
    setAiSaving(true);
    setAiError("");
    try {
      const response = await fetch("/api/ai/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: aiKey }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "OpenAI rejected this API key.");
      setAiKey("");
      setAiConnected(true);
    } catch (error) {
      setAiConnected(false);
      setAiError(
        error instanceof Error
          ? error.message
          : "Unable to save this OpenAI API key.",
      );
    } finally {
      setAiSaving(false);
    }
  };

  const recent = data?.candles.slice(-24) ?? [];
  const low = recent.length ? Math.min(...recent.map((c) => c.low)) : null;
  const high = recent.length ? Math.max(...recent.map((c) => c.high)) : null;
  const points = useMemo(() => chartPoints(data?.candles ?? []), [data]);
  const decimals = priceDecimals(instrument);
  const positive = (data?.changePercent ?? 0) >= 0;
  const displayPrice = quote?.mid ?? data?.price;
  const spreadPips = quote ? quote.spread * pipMultiplier(instrument) : null;
  const statusLabel =
    connection === "connected"
      ? "Live · " + environment
      : connection === "configured"
        ? "Connecting · " + environment
        : connection === "error"
          ? "Connection problem"
          : connection === "checking"
            ? "Checking OANDA"
            : "OANDA not connected";
  const topSetup = scanner?.results[0];
  const marketSetup = scanner?.results.find(
    (item) => item.instrument === instrument,
  );
  const marketAiPlan = aiData?.strategies.find(
    (item) => item.instrument === instrument,
  );
  const planEntry = marketAiPlan?.entry ?? marketSetup?.entry ?? null;
  const planStop = marketAiPlan?.stopLoss ?? marketSetup?.stopLoss ?? null;
  const planTp1 = marketAiPlan?.takeProfit1 ?? marketSetup?.takeProfit1 ?? null;
  const planTp2 = marketAiPlan?.takeProfit2 ?? marketSetup?.takeProfit2 ?? null;
  const direction = marketSetup?.bias === "short" || marketAiPlan?.verdict === "short" ? "short" : "long";
  const stopDistance = planEntry !== null && planStop !== null ? Math.abs(planEntry - planStop) : null;
  const tp1Distance = planEntry !== null && planTp1 !== null ? Math.abs(planTp1 - planEntry) : null;
  const tp2Distance = planEntry !== null && planTp2 !== null ? Math.abs(planTp2 - planEntry) : null;
  const parsedRiskPercent = Number(riskPercent);
  const validRiskPercent = Number.isFinite(parsedRiskPercent) && parsedRiskPercent > 0 && parsedRiskPercent <= 5;
  const riskAmount = account && validRiskPercent ? account.equity * parsedRiskPercent / 100 : null;
  const conversion = quote?.homeConversionFactors?.[direction === "short" ? "negativeUnits" : "positiveUnits"] ?? null;
  const cashRiskPerUnit = stopDistance !== null && conversion !== null ? stopDistance * conversion : null;
  const calculatedUnits = riskAmount !== null && cashRiskPerUnit !== null && cashRiskPerUnit > 0
    ? Math.max(0, Math.floor(riskAmount / cashRiskPerUnit))
    : 0;
  const calculatedLots = marketSetup?.assetClass === "forex" ? calculatedUnits / 100000 : null;
  const slPips = stopDistance === null ? null : stopDistance * pipMultiplier(instrument);
  const tp1Pips = tp1Distance === null ? null : tp1Distance * pipMultiplier(instrument);
  const tp2Pips = tp2Distance === null ? null : tp2Distance * pipMultiplier(instrument);
  const estimatedRisk = calculatedUnits && cashRiskPerUnit !== null ? calculatedUnits * cashRiskPerUnit : null;
  const estimatedTp1 = calculatedUnits && tp1Distance !== null && conversion !== null ? calculatedUnits * tp1Distance * conversion : null;
  const estimatedTp2 = calculatedUnits && tp2Distance !== null && conversion !== null ? calculatedUnits * tp2Distance * conversion : null;
  const monitoredTrade = openTrades.find((trade) => trade.instrument === instrument) ?? null;

  useEffect(() => {
    if (!monitoredTrade || !marketAiPlan || !marketSetup || !aiConnected || reviewBusy.current) return;
    const currentPrice = quote?.mid ?? monitoredTrade.price;
    const previous = reviewMemory.current[monitoredTrade.id];
    const volatilityMove = Math.max(currentPrice * (marketSetup.atrPercent / 100) * 0.25, currentPrice * 0.0005);
    const meaningfulMove = !previous || Math.abs(currentPrice - previous.price) >= volatilityMove;
    if (!meaningfulMove) return;
    const timer = window.setTimeout(() => {
      const latest = reviewMemory.current[monitoredTrade.id];
      if (reviewBusy.current || (latest && Date.now() - latest.at < 300000)) return;
      reviewMemory.current[monitoredTrade.id] = { price: currentPrice, at: Date.now() };
      reviewBusy.current = true;
      setMonitorStatus("Reviewing the open trade against its strategy…");
      void fetch("/api/ai/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trade: monitoredTrade,
        currentPrice,
        style: scanMode,
        timeframes: scanner?.timeframes ?? null,
        strategy: marketAiPlan,
        technicalSnapshot: {
          score: marketSetup.score,
          bias: marketSetup.bias,
          rsi: marketSetup.rsi,
          atrPercent: marketSetup.atrPercent,
          timeframeAlignment: marketSetup.timeframeAlignment,
          selectedStrategy: marketSetup.selectedStrategy,
        },
      }),
      }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Trade review failed.");
        setTradeReview(payload);
        setMonitorStatus(payload.drifted ? "Strategy drift detected — review required." : "Strategy still matches the open trade.");
      }).catch((error: unknown) => {
        setMonitorStatus(error instanceof Error ? error.message : "Trade review failed.");
      }).finally(() => {
        reviewBusy.current = false;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [aiConnected, marketAiPlan, marketSetup, monitoredTrade, quote?.mid, scanMode, scanner?.timeframes]);

  const submitOrder = async () => {
    if (!marketSetup) return;
    if (!calculatedUnits) {
      setOrderStatus("Waiting for account equity, a valid stop distance and a valid risk percentage.");
      return;
    }
    setOrderStatus("Submitting order…");
    try {
      const response = await fetch("/api/oanda/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: marketSetup.instrument,
          units: (direction === "short" ? -1 : 1) * calculatedUnits,
          stopLoss: planStop,
          takeProfit: planTp1,
          riskPercent: parsedRiskPercent,
          mode: executionMode,
          confirmLive: liveConfirm,
          journal: {
            style: scanMode,
            strategyName: marketAiPlan?.strategyName ?? marketSetup.selectedStrategy?.name ?? marketSetup.setup,
            setupType: marketAiPlan?.setupType ?? marketSetup.selectedStrategy?.id ?? null,
            entryPrice: planEntry,
            takeProfit2: planTp2,
            lots: calculatedLots,
            riskAmount,
            thesis: marketAiPlan?.analysis ?? marketSetup.analysis,
            evidence: marketAiPlan?.reasons?.join(" ") ?? marketSetup.reasons.join(" "),
            invalidation: marketAiPlan?.invalidation ?? marketSetup.invalidation,
            metadata: { score: marketSetup.score, rsi: marketSetup.rsi, atrPercent: marketSetup.atrPercent, timeframeAlignment: marketSetup.timeframeAlignment },
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Order could not be submitted.");
      setOrderStatus(
        `${payload.mode === "paper" ? "Paper order simulated" : "Live order submitted"} · ${payload.orderId ?? "no ID"}`,
      );
      if (payload.mode === "live") void refreshTrades();
      setLiveConfirm(false);
    } catch (error) {
      setOrderStatus(
        error instanceof Error
          ? error.message
          : "Order could not be submitted.",
      );
    }
  };
  const isOverview = pathname === "/";
  const isMarkets = pathname.startsWith("/markets");
  const isResearch = pathname.startsWith("/research");
  const pageTitle = isMarkets ? (
    <>
      Study one market <em className="font-serif text-[#a4ffcf]">in depth.</em>
    </>
  ) : isResearch ? (
    <>
      News and events{" "}
      <em className="font-serif text-[#a4ffcf]">before the trade.</em>
    </>
  ) : (
    <>
      Find today’s best setups{" "}
      <em className="font-serif text-[#a4ffcf]">without the clutter.</em>
    </>
  );

  return (
    <main className="min-h-screen bg-[#07100f] text-[#e8f3ee] selection:bg-[#a4ffcf] selection:text-[#07100f]">
      <header className="mx-auto flex max-w-[1460px] flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#a4ffcf] text-[#07100f]">
            <CircleDot size={19} />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-[.18em]">
              FORESIGHT FX
            </p>
            <p className="text-[10px] tracking-[.2em] text-[#8aa29a]">
              RESEARCH TERMINAL
            </p>
          </div>
        </div>
        <nav
          className="order-3 flex w-full gap-1 rounded-xl border border-white/10 bg-black/15 p-1 sm:order-none sm:w-auto"
          aria-label="Primary navigation"
        >
          <NavLink href="/" active={isOverview}>
            Overview
          </NavLink>
          <NavLink href="/markets" active={isMarkets}>
            Markets
          </NavLink>
          <NavLink href="/research" active={isResearch}>
            News & events
          </NavLink>
          <NavLink href="/journal" active={false}>
            Journal
          </NavLink>
          <NavLink href="/logs" active={false}>
            System logs
          </NavLink>
        </nav>
        <div className="flex items-center gap-2">
          <span
            className={
              (connection === "connected"
                ? "border-[#59dfa9]/30 bg-[#59dfa9]/10 text-[#89f6bf]"
                : connection === "error"
                  ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
                  : "border-white/10 bg-white/5 text-[#a9bdb6]") +
              " hidden rounded-full border px-3 py-1 text-xs sm:block"
            }
          >
            {statusLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setMessage("");
              setSettingsOpen(true);
            }}
            aria-label="Open data and AI settings"
            className="h-10 w-10 text-[#e8f3ee] hover:bg-white/10"
          >
            <Settings2 size={20} />
          </Button>
        </div>
      </header>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="border-white/10 bg-[#0c1916] text-white">
          <DialogHeader>
            <DialogTitle>Data and AI settings</DialogTitle>
            <DialogDescription className="text-[#a9bdb6]">
              Keys are validated, encrypted and saved server-side. They are
              never displayed again.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">OANDA market data</p>
              <StatusDot
                connected={
                  connection === "connected" || connection === "configured"
                }
              />
            </div>
            <label className="text-sm text-[#a9bdb6]">
              Account environment
            </label>
            <Select
              value={environment}
              onValueChange={(value) =>
                setEnvironment(value as "practice" | "live")
              }
            >
              <SelectTrigger className="w-full border-white/10 bg-[#10221d] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="practice">Practice account</SelectItem>
                <SelectItem value="live">Live account</SelectItem>
              </SelectContent>
            </Select>
            <label className="mt-2 text-sm text-[#a9bdb6]">
              Personal access token
            </label>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="Paste your OANDA token"
              className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm outline-none focus:border-[#a4ffcf]"
            />
            <label className="mt-2 text-sm text-[#a9bdb6]">
              OANDA account number
            </label>
            <input
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              type="text"
              autoComplete="off"
              placeholder="e.g. 101-001-1234567-001"
              className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm outline-none focus:border-[#a4ffcf]"
            />
            <Button
              onClick={saveConnection}
              disabled={!token || saving}
              className="mt-2 bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"
            >
              <RefreshCw className={saving ? "animate-spin" : ""} />
              {saving ? "Validating…" : "Validate and save"}
            </Button>
            {message && <p className="text-xs text-rose-300">{message}</p>}
            <div className="my-2 border-t border-white/10" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">
                  OpenAI strategy analysis
                </p>
                <p className="mt-1 text-xs text-[#81978f]">
                  Uses GPT-5.5 Structured Outputs for the top three daily cards.
                </p>
              </div>
              <StatusDot connected={aiConnected} />
            </div>
            <label className="mt-2 text-sm text-[#a9bdb6]">
              OpenAI API key
            </label>
            <input
              value={aiKey}
              onChange={(event) => setAiKey(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder={
                aiConnected
                  ? "Connected — paste to replace key"
                  : "Paste your OpenAI API key"
              }
              className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm outline-none focus:border-[#a4ffcf]"
            />
            <Button
              onClick={saveAiConnection}
              disabled={!aiKey || aiSaving}
              className="bg-white/10 text-white hover:bg-white/15"
            >
              <Sparkles className={aiSaving ? "animate-spin" : ""} />
              {aiSaving
                ? "Validating…"
                : aiConnected
                  ? "Replace AI key"
                  : "Validate and save AI key"}
            </Button>
            {aiError && <p className="text-xs text-rose-300">{aiError}</p>}
          </div>
        </DialogContent>
      </Dialog>

      <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10">
        <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="mb-2 text-xs font-medium tracking-[.16em] text-[#8aa29a]">
              OANDA DATA · LUXALGO RESEARCH · PLAIN ENGLISH
            </p>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
              {pageTitle}
            </h1>
          </div>
          <div className="text-xs text-[#94a9a2]">
            {quote
              ? "Quote: " +
                new Date(quote.time).toLocaleTimeString("en-GB", {
                  timeZone: "UTC",
                }) +
                " UTC · refreshes every 2s"
              : "Waiting for live OANDA pricing"}
          </div>
        </section>

        {message && !settingsOpen && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div>
              <p className="font-medium">OANDA connection failed</p>
              <p className="mt-1 text-rose-200/80">{message}</p>
              <button
                onClick={() => setSettingsOpen(true)}
                className="mt-2 underline underline-offset-4"
              >
                Check connection settings
              </button>
            </div>
          </div>
        )}

        {isOverview && (
          <>
            <section className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-[#0c1916]">
              <div className="flex flex-col justify-between gap-4 border-b border-white/10 p-5 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-lg bg-[#a4ffcf]/10 text-[#a4ffcf]">
                    <ScanSearch size={19} />
                  </span>
                  <div>
                    <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                      DAILY OPPORTUNITY SCANNER
                    </p>
                    <h2 className="mt-1 text-lg">
                      10 forex pairs + XAU/USD + US30
                    </h2>
                    <p className="mt-1 text-xs text-[#71887f]">
                      Four-hour trend, buying and selling strength, normal price
                      movement and today’s position
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={scanMode}
                    onValueChange={(value) =>
                      setScanMode(value as typeof scanMode)
                    }
                  >
                    <SelectTrigger className="w-32 border-white/10 bg-[#10221d] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scalping">Scalping</SelectItem>
                      <SelectItem value="intraday">Intraday</SelectItem>
                      <SelectItem value="swing">Swing</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={runScanner}
                    disabled={
                      scanning ||
                      connection === "disconnected" ||
                      connection === "checking"
                    }
                    className="bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"
                  >
                    <RefreshCw className={scanning ? "animate-spin" : ""} />
                    {scanning ? "Scanning 12 markets…" : "Run daily scan"}
                  </Button>
                </div>
              </div>

              {scannerError && (
                <div className="border-b border-rose-400/20 bg-rose-400/10 px-5 py-3 text-sm text-rose-200">
                  {scannerError}
                </div>
              )}
              {topSetup && (
                <button
                  onClick={() =>
                    window.location.assign(
                      "/markets?instrument=" + topSetup.instrument,
                    )
                  }
                  className="w-full border-b border-white/10 bg-[#a4ffcf]/[.045] p-5 text-left"
                >
                  <div className="grid gap-4 lg:grid-cols-[.8fr_1.5fr]">
                    <div>
                      <p className="text-[10px] tracking-[.14em] text-[#89f6bf]">
                        TOP TECHNICAL CANDIDATE
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {topSetup.label}
                      </p>
                      <div className="mt-2">
                        <Bias bias={topSetup.bias} />
                        <span className="ml-2 text-xs text-[#8aa29a]">
                          Score {topSetup.score}/100
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm leading-6 text-[#c0d1ca]">
                        {topSetup.analysis}
                      </p>
                      <p className="mt-1 text-xs text-[#81978f]">
                        {topSetup.reasons.join(" · ")}
                      </p>
                      <p className="mt-2 text-[11px] text-[#89f6bf]">
                        Open detailed market study →
                      </p>
                    </div>
                  </div>
                </button>
              )}

              <div className="mb-3 rounded-lg border border-[#a4ffcf]/10 bg-[#a4ffcf]/[.035] px-4 py-3 text-xs text-[#a9bdb6]">
                {scanner ? (
                  <>
                    <span className="font-medium text-[#89f6bf]">
                      {scanner.mode} mode:
                    </span>{" "}
                    {scanner.timeframes.context} context →{" "}
                    {scanner.timeframes.setup} setup →{" "}
                    {scanner.timeframes.trigger} entry trigger. A trade needs at
                    least two aligned timeframes plus LuxAlgo-grounded
                    confirmation.
                  </>
                ) : (
                  "Choose a trading style, then scan all 12 markets with aligned timeframes."
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[.12em] text-[#71887f]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Rank</th>
                      <th className="px-3 py-3 font-medium">Market</th>
                      <th className="px-3 py-3 font-medium">Bias</th>
                      <th className="px-3 py-3 font-medium">Score</th>
                      <th className="px-3 py-3 font-medium">Align</th>
                      <th className="px-3 py-3 font-medium">RSI</th>
                      <th className="px-5 py-3 font-medium">
                        Multi-timeframe analysis
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[.06]">
                    {scanner?.results.map((result, index) => (
                      <tr
                        key={result.instrument}
                        onClick={() =>
                          window.location.assign(
                            "/markets?instrument=" + result.instrument,
                          )
                        }
                        className="cursor-pointer align-top transition-colors hover:bg-white/[.035]"
                      >
                        <td className="px-5 py-4 text-[#71887f]">
                          {index + 1}
                        </td>
                        <td className="px-3 py-4 font-medium">
                          {result.label}
                          <span className="ml-2 text-[10px] uppercase text-[#71887f]">
                            {result.assetClass}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <Bias bias={result.bias} />
                        </td>
                        <td className="px-3 py-4 font-mono">{result.score}</td>
                        <td className="px-3 py-4">
                          <span className="font-mono text-[#89f6bf]">
                            {result.confirmations ?? 0}/
                            {result.timeframeAlignment?.length ?? 0}
                          </span>
                          <div className="mt-1 flex gap-1">
                            {result.timeframeAlignment?.map((item) => (
                              <span
                                key={item.timeframe}
                                className={
                                  (item.bias === result.bias &&
                                  result.bias !== "neutral"
                                    ? "text-[#89f6bf]"
                                    : "text-[#71887f]") + " text-[9px]"
                                }
                              >
                                {item.timeframe}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-4 font-mono">
                          {result.rsi.toFixed(0)}
                        </td>
                        <td className="max-w-[520px] px-5 py-4">
                          <p className="text-xs leading-5 text-[#c0d1ca]">
                            {result.analysis}
                          </p>
                          <ul className="mt-1 space-y-0.5 text-[11px] leading-4 text-[#81978f]">
                            {result.reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                          <p className="mt-1 text-[10px] text-amber-200/70">
                            Invalidation: {result.invalidation}
                          </p>
                        </td>
                      </tr>
                    ))}
                    {!scanner && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-5 py-10 text-center text-[#71887f]"
                        >
                          {scanning
                            ? "Reading aligned market data across 12 markets…"
                            : "Run the daily scan to rank today’s opportunities."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {scanner && (
                <div className="flex flex-col justify-between gap-2 border-t border-white/10 px-5 py-3 text-[11px] text-[#71887f] sm:flex-row">
                  <span>
                    Generated{" "}
                    {new Date(scanner.generatedAt).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </span>
                  <span>
                    {scanner.unavailable.length
                      ? "Unavailable on this OANDA account: " +
                        scanner.unavailable.map((item) => item.label).join(", ")
                      : "All 12 required markets included"}
                  </span>
                </div>
              )}
            </section>

            {scanner?.results.length ? (
              <section className="mb-5">
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                      DAILY AI ANALYSIS CARDS
                    </p>
                    <h2 className="mt-1 text-xl">
                      Three strategies explained in plain English
                    </h2>
                    <p className="mt-1 text-xs text-[#71887f]">
                      OpenAI combines aligned timeframes with multiple
                      LuxAlgo-grounded confirmations and may recommend waiting.
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      void generateAiStrategies(
                        scanner.results,
                        scanner.generatedAt,
                        true,
                      )
                    }
                    disabled={!aiConnected || aiLoading}
                    className="bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"
                  >
                    <BrainCircuit className={aiLoading ? "animate-spin" : ""} />
                    {aiLoading
                      ? "Analysing top 3…"
                      : aiConnected
                        ? "Regenerate AI plans"
                        : "Add AI key in Settings"}
                  </Button>
                </div>
                {aiError && (
                  <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
                    {aiError}{" "}
                    <button
                      onClick={() =>
                        aiConnected
                          ? void generateAiStrategies(
                              scanner.results,
                              scanner.generatedAt,
                            )
                          : setSettingsOpen(true)
                      }
                      className="ml-1 underline underline-offset-4"
                    >
                      {aiConnected ? "Try again" : "Open Settings"}
                    </button>
                  </div>
                )}
                <div className="grid gap-4 xl:grid-cols-3">
                  {scanner.results
                    .filter(
                      (result) =>
                        result.score >=
                        Math.max(70, (scanner.results[0]?.score ?? 0) - 15),
                    )
                    .slice(0, 3)
                    .map((result, index) => {
                      const plan = aiData?.strategies.find(
                        (item) => item.instrument === result.instrument,
                      );
                      return (
                        <article
                          key={result.instrument}
                          className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"
                        >
                          <button
                            onClick={() => {
                              setQuote(null);
                              setInstrument(result.instrument);
                            }}
                            className="w-full text-left"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-[10px] tracking-[.14em] text-[#71887f]">
                                  AI STRATEGY {index + 1}
                                </p>
                                <h3 className="mt-1 text-xl font-semibold">
                                  {result.label}
                                </h3>
                                <p className="mt-1 text-xs text-[#8aa29a]">
                                  {plan?.strategyName ?? "Awaiting AI analysis"}
                                </p>
                              </div>
                              <div className="text-right">
                                <Bias
                                  bias={
                                    plan?.verdict === "wait" || !plan
                                      ? "neutral"
                                      : plan.verdict
                                  }
                                />
                                <p className="mt-1 text-xs text-[#8aa29a]">
                                  {plan
                                    ? `${plan.confidence}% confidence`
                                    : `${result.score}/100 technical`}
                                </p>
                              </div>
                            </div>
                          </button>
                          {plan ? (
                            <>
                              <p className="mt-4 min-h-12 text-sm leading-6 text-[#b8cac3]">
                                {plan.analysis}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {plan.methodology.map((method) => (
                                  <span
                                    key={method}
                                    className="rounded-full border border-[#a4ffcf]/15 bg-[#a4ffcf]/[.06] px-2 py-1 text-[10px] text-[#89f6bf]"
                                  >
                                    LuxAlgo · {method}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-2">
                                <PlanLevel
                                  label={`${plan.entryType} entry`}
                                  value={formatScannerPrice(
                                    result.instrument,
                                    plan.entry,
                                  )}
                                />
                                <PlanLevel
                                  label="AI stop loss"
                                  value={formatScannerPrice(
                                    result.instrument,
                                    plan.stopLoss,
                                  )}
                                  tone="risk"
                                />
                                <PlanLevel
                                  label={`AI TP1${plan.riskReward1 ? ` · ${plan.riskReward1.toFixed(1)}R` : ""}`}
                                  value={formatScannerPrice(
                                    result.instrument,
                                    plan.takeProfit1,
                                  )}
                                  tone="reward"
                                />
                                <PlanLevel
                                  label={`AI TP2${plan.riskReward2 ? ` · ${plan.riskReward2.toFixed(1)}R` : ""}`}
                                  value={formatScannerPrice(
                                    result.instrument,
                                    plan.takeProfit2,
                                  )}
                                  tone="reward"
                                />
                              </div>
                              <p className="mt-3 text-xs leading-5 text-[#a9bdb6]">
                                <span className="text-[#89f6bf]">Trigger:</span>{" "}
                                {plan.trigger}
                              </p>
                              <ul className="mt-3 space-y-1 text-xs leading-5 text-[#81978f]">
                                {plan.reasons.map((reason) => (
                                  <li key={reason}>• {reason}</li>
                                ))}
                              </ul>
                              <p className="mt-3 text-[11px] leading-4 text-rose-200/75">
                                Invalidation: {plan.invalidation}
                              </p>
                              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300/10 bg-amber-300/[.05] p-3 text-[11px] leading-4 text-amber-100/70">
                                <ShieldAlert
                                  className="mt-0.5 shrink-0"
                                  size={14}
                                />
                                <span>{plan.eventRisk}</span>
                              </div>
                            </>
                          ) : (
                            <div className="mt-4 grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 p-6 text-center">
                              <div>
                                <BrainCircuit className="mx-auto text-[#71887f]" />
                                <p className="mt-3 text-sm text-[#a9bdb6]">
                                  {aiLoading
                                    ? "LuxAlgo MCP and the LLM are designing entry, stop and targets…"
                                    : "Add an OpenAI API key in Settings to generate this strategy."}
                                </p>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                </div>
                {aiData && (
                  <div className="mt-3 flex flex-col justify-between gap-2 text-[11px] text-[#71887f] sm:flex-row">
                    <p>
                      Generated{" "}
                      {new Date(aiData.generatedAt).toLocaleString("en-GB", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC with {aiData.model}. Plans are reused while price
                      movement remains insignificant; use Regenerate for a
                      manual refresh.
                    </p>
                    <p>
                      Grounded by{" "}
                      {aiData.luxAlgoSources.map((source, index) => (
                        <span key={source.slug}>
                          {index ? " · " : ""}
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#89f6bf] underline-offset-4 hover:underline"
                          >
                            {source.name}
                          </a>
                        </span>
                      ))}
                    </p>
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}

        {isResearch && (
          <>
            <div className="mb-5 flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-[#0c1916] p-5 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm tracking-[.14em] text-[#8aa29a]">
                  SELECT MARKET
                </p>
                <p className="mt-1 text-base text-[#a9bdb6]">
                  Choose a pair to filter the headline feed.
                </p>
              </div>
              <Select
                value={instrument}
                onValueChange={(value) => setInstrument(value)}
              >
                <SelectTrigger className="w-full border-white/10 bg-[#10221d] text-white sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {instruments.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <section className="mb-5 grid gap-5 xl:grid-cols-2">
              <div className="min-h-[820px] overflow-hidden rounded-2xl border border-white/10 bg-[#0c1916]">
                <div className="flex items-start gap-3 border-b border-white/10 p-6">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#a4ffcf]/10 text-[#a4ffcf]">
                    <Newspaper size={20} />
                  </span>
                  <div>
                    <p className="text-sm tracking-[.14em] text-[#8aa29a]">
                      PAIR NEWS
                    </p>
                    <h2 className="mt-1 text-2xl">
                      {instrument.replace("_", " / ")} related headlines
                    </h2>
                    <p className="mt-1 text-sm text-[#71887f]">
                      Changes automatically when you select a market
                    </p>
                  </div>
                </div>
                <PairNews instrument={instrument} />
              </div>
              <div className="min-h-[820px] overflow-hidden rounded-2xl border border-white/10 bg-[#0c1916]">
                <div className="flex items-start gap-3 border-b border-white/10 p-6">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-300/10 text-amber-200">
                    <CalendarDays size={20} />
                  </span>
                  <div>
                    <p className="text-sm tracking-[.14em] text-[#8aa29a]">
                      ECONOMIC EVENT RISK
                    </p>
                    <h2 className="mt-1 text-2xl">Scanner currency calendar</h2>
                    <p className="mt-1 text-sm text-[#71887f]">
                      US, Eurozone, UK, Japan, Switzerland, Canada, Australia
                      and New Zealand
                    </p>
                  </div>
                </div>
                <EconomicCalendar />
              </div>
            </section>
          </>
        )}

        {isMarkets && (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.65fr_.95fr]">
              <div className="rounded-2xl border border-white/10 bg-[#0c1916] p-4 sm:p-6">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                      ACTIVE STUDY
                    </p>
                    <h2 className="mt-1 text-xl font-medium">
                      {instrument.replace("_", " / ")}{" "}
                      <span className="text-sm font-normal text-[#8aa29a]">
                        — live quote + midpoint candles
                      </span>
                    </h2>
                  </div>
                  <div className="flex gap-2">
                    <Select
                      value={instrument}
                      onValueChange={(value) => {
                        setQuote(null);
                        setInstrument(value);
                      }}
                    >
                      <SelectTrigger className="border-white/10 bg-[#10221d] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {instruments.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={granularity} onValueChange={setGranularity}>
                      <SelectTrigger className="w-20 border-white/10 bg-[#10221d] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="M5">M5</SelectItem>
                        <SelectItem value="M15">M15</SelectItem>
                        <SelectItem value="H1">H1</SelectItem>
                        <SelectItem value="H4">H4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="relative h-[300px] overflow-hidden rounded-xl border border-white/5 bg-[linear-gradient(180deg,rgba(164,255,207,.07),transparent_55%)] p-5">
                  <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.07)_1px,transparent_1px)] [background-size:100%_25%,16.6%_100%]" />
                  <div className="relative flex items-start justify-between">
                    <div>
                      <span className="text-3xl font-semibold">
                        {displayPrice !== undefined
                          ? displayPrice.toFixed(decimals)
                          : "—"}
                      </span>
                      {data && (
                        <span
                          className={
                            (positive ? "text-[#59dfa9]" : "text-rose-400") +
                            " ml-3 text-sm"
                          }
                        >
                          {positive ? "+" : ""}
                          {data.changePercent.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    {quote && (
                      <span
                        className={
                          (quote.tradeable
                            ? "bg-[#59dfa9]/10 text-[#89f6bf]"
                            : "bg-amber-400/10 text-amber-300") +
                          " flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                        }
                      >
                        <Wifi size={13} />
                        {quote.tradeable ? "Live OANDA quote" : "Market closed"}
                      </span>
                    )}
                  </div>
                  {points ? (
                    <svg
                      className="absolute bottom-7 left-3 h-[180px] w-[calc(100%-24px)]"
                      viewBox="0 0 780 180"
                      preserveAspectRatio="none"
                      aria-label="OANDA midpoint candle closing-price chart"
                    >
                      <polyline
                        points={points}
                        fill="none"
                        stroke={positive ? "#a4ffcf" : "#fb7185"}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center pt-12 text-sm text-[#71887f]">
                      Connect OANDA to load market data
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label="Bid"
                    value={quote ? quote.bid.toFixed(decimals) : "—"}
                  />
                  <Metric
                    label="Ask"
                    value={quote ? quote.ask.toFixed(decimals) : "—"}
                  />
                  <Metric
                    label="Spread"
                    value={
                      spreadPips !== null
                        ? spreadPips.toFixed(1) + " pips"
                        : "—"
                    }
                  />
                  <Metric
                    label="Live midpoint"
                    value={
                      displayPrice !== undefined
                        ? displayPrice.toFixed(decimals)
                        : "—"
                    }
                    tone="mint"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Metric
                    label="24-candle low"
                    value={low?.toFixed(decimals) ?? "—"}
                  />
                  <Metric
                    label="24-candle high"
                    value={high?.toFixed(decimals) ?? "—"}
                  />
                </div>
              </div>

              <aside className="rounded-2xl border border-white/10 bg-[#0c1916] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                      DATA CONNECTION
                    </p>
                    <h2 className="mt-1 text-lg">OANDA pricing</h2>
                  </div>
                  {connection === "connected" ? (
                    <CheckCircle2 className="text-[#59dfa9]" size={22} />
                  ) : (
                    <AlertCircle
                      className={
                        connection === "error"
                          ? "text-rose-400"
                          : "text-[#8aa29a]"
                      }
                      size={22}
                    />
                  )}
                </div>
                <p className="mt-5 text-sm leading-6 text-[#a9bdb6]">
                  Current bid and ask come from your OANDA account pricing
                  endpoint. The chart uses OANDA midpoint candles.
                </p>
                <div className="my-5 border-t border-white/10" />
                <div className="space-y-4 text-sm">
                  <Row label="Status" value={statusLabel} />
                  <Row label="Market" value={quote?.marketStatus ?? "—"} />
                  <Row
                    label="Instrument"
                    value={instrument.replace("_", " / ")}
                  />
                  <Row label="Environment" value={environment} />
                  <Row label="Update rate" value="2 seconds" />
                </div>
                <Button
                  onClick={() => {
                    void Promise.all([refreshCandles(), refreshQuote()]);
                  }}
                  disabled={
                    loading ||
                    connection === "disconnected" ||
                    connection === "checking"
                  }
                  className="mt-7 w-full bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"
                >
                  <RefreshCw className={loading ? "animate-spin" : ""} />
                  {loading ? "Refreshing…" : "Refresh now"}
                </Button>
                {(connection === "disconnected" || connection === "error") && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMessage("");
                      setSettingsOpen(true);
                    }}
                    className="mt-2 w-full text-[#a4ffcf]"
                  >
                    Open connection settings
                  </Button>
                )}
              </aside>
            </section>

            <section className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
              <div className="rounded-2xl border border-[#a4ffcf]/15 bg-[#0c1916] p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs tracking-[.14em] text-[#89f6bf]">
                      STYLE-SPECIFIC MARKET PLAN
                    </p>
                    <h2 className="mt-1 text-xl">
                      {instrument.replace("_", " / ")} analysis
                    </h2>
                    <p className="mt-1 text-xs text-[#8aa29a]">
                      {scanMode} mode ·{" "}
                      {scanner
                        ? `${scanner.timeframes.context} context → ${scanner.timeframes.setup} setup → ${scanner.timeframes.trigger} trigger`
                        : "Run the scanner to load aligned timeframes"}
                    </p>
                  </div>
                  <Bias bias={marketSetup?.bias ?? "neutral"} />
                </div>
                {marketSetup ? (
                  <>
                    <p className="mt-5 text-sm leading-6 text-[#c0d1ca]">
                      {marketSetup.analysis}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <PlanLevel
                        label="Reference entry"
                        value={formatScannerPrice(
                          instrument,
                          marketAiPlan?.entry ?? marketSetup.entry,
                        )}
                      />
                      <PlanLevel
                        label="Stop loss"
                        value={formatScannerPrice(
                          instrument,
                          marketAiPlan?.stopLoss ?? marketSetup.stopLoss,
                        )}
                        tone="risk"
                      />
                      <PlanLevel
                        label="Take profit 1"
                        value={formatScannerPrice(
                          instrument,
                          marketAiPlan?.takeProfit1 ?? marketSetup.takeProfit1,
                        )}
                        tone="reward"
                      />
                      <PlanLevel
                        label="Take profit 2"
                        value={formatScannerPrice(
                          instrument,
                          marketAiPlan?.takeProfit2 ?? marketSetup.takeProfit2,
                        )}
                        tone="reward"
                      />
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/8 bg-black/15 p-4">
                        <p className="text-[10px] tracking-[.12em] text-[#89f6bf]">
                          STRATEGIES CHECKED ON THIS MARKET
                        </p>
                        <div className="mt-3 space-y-3">
                          {(marketSetup.strategies ?? []).map((strategy) => (
                            <div
                              key={strategy.id}
                              className="border-b border-white/[.07] pb-3 last:border-0 last:pb-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium text-white">
                                  {strategy.name}
                                </p>
                                <span
                                  className={
                                    (strategy.status === "selected" ||
                                    strategy.status === "confirmed"
                                      ? "bg-[#59dfa9]/10 text-[#89f6bf]"
                                      : strategy.status === "rejected"
                                        ? "bg-rose-400/10 text-rose-300"
                                        : "bg-amber-300/10 text-amber-200") +
                                    " rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[.08em]"
                                  }
                                >
                                  {strategy.status}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] leading-4 text-[#c7d2cc]">
                                Evidence: {strategy.evidence}
                              </p>
                              <p className="mt-1 text-[11px] leading-4 text-[#81978f]">
                                Why: {strategy.why}
                              </p>
                              <p className="mt-1 text-[11px] leading-4 text-[#89f6bf]">
                                Next: {strategy.nextStep}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-[#a4ffcf]/15 bg-[#07100f] p-4">
                        <p className="text-[10px] tracking-[.12em] text-[#89f6bf]">
                          AUTO-TRADE
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Select
                            value={scanMode}
                            onValueChange={(value) => {
                              setScanMode(value as typeof scanMode);
                              setTradeReview(null);
                              setOrderStatus("Trading style changed. Run the scan to refresh its strategy and levels.");
                            }}
                          >
                            <SelectTrigger className="border-white/10 bg-[#10221d] text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="scalping">Scalping · M5 entry</SelectItem>
                              <SelectItem value="intraday">Intraday · M15 entry</SelectItem>
                              <SelectItem value="swing">Swing · M15 entry</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={executionMode}
                            onValueChange={(value) => {
                              setExecutionMode(value as "paper" | "live");
                              setLiveConfirm(false);
                            }}
                          >
                            <SelectTrigger className="border-white/10 bg-[#10221d] text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="paper">
                                Paper trading (safe)
                              </SelectItem>
                              <SelectItem value="live">
                                Live OANDA (locked)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <input
                            aria-label="Risk percentage"
                            value={riskPercent}
                            onChange={(event) => {
                              setRiskPercent(event.target.value);
                            }}
                            inputMode="decimal"
                            className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm text-white"
                            placeholder="Risk % (e.g. 0.5)"
                          />
                        </div>
                        <p className="mt-3 text-xs text-[#a9bdb6]">
                          {marketSetup
                            ? `${direction.toUpperCase()} ${marketSetup.instrument} · ${scanMode} · Entry ${formatScannerPrice(marketSetup.instrument, planEntry)} · SL ${formatScannerPrice(marketSetup.instrument, planStop)} · TP1 ${formatScannerPrice(marketSetup.instrument, planTp1)}`
                            : "Run the scanner to prepare an order."}
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                          <PlanLevel label="Account equity" value={account ? `${account.currency} ${account.equity.toFixed(2)}` : "Loading…"} />
                          <PlanLevel label="Risk amount" value={riskAmount !== null ? `${account?.currency ?? ""} ${riskAmount.toFixed(2)}` : "—"} />
                          <PlanLevel label="Calculated size" value={calculatedUnits ? `${calculatedUnits.toLocaleString()} units` : "—"} />
                          <PlanLevel label="Lots" value={calculatedLots !== null ? calculatedLots.toFixed(2) : marketSetup?.assetClass ? "N/A for CFD" : "—"} />
                          <PlanLevel label="SL distance" value={slPips !== null ? `${slPips.toFixed(instrument.endsWith("_JPY") ? 1 : 1)} ${marketSetup?.assetClass === "forex" ? "pips" : "points"}` : "—"} tone="risk" />
                          <PlanLevel label="TP1 distance" value={tp1Pips !== null ? `${tp1Pips.toFixed(1)} ${marketSetup?.assetClass === "forex" ? "pips" : "points"}` : "—"} tone="reward" />
                          <PlanLevel label="TP2 distance" value={tp2Pips !== null ? `${tp2Pips.toFixed(1)} ${marketSetup?.assetClass === "forex" ? "pips" : "points"}` : "—"} tone="reward" />
                        </div>
                        <div className="mt-3 rounded-lg border border-white/8 bg-black/15 p-3 text-xs leading-5 text-[#a9bdb6]">
                          <p><span className="text-rose-200">Stop loss:</span> {planStop !== null ? formatScannerPrice(instrument, planStop) : "—"} · estimated risk {estimatedRisk !== null ? `${account?.currency ?? ""} ${estimatedRisk.toFixed(2)}` : "—"}</p>
                          <p><span className="text-sky-200">Take profit 1:</span> {planTp1 !== null ? formatScannerPrice(instrument, planTp1) : "—"} · estimated return {estimatedTp1 !== null ? `${account?.currency ?? ""} ${estimatedTp1.toFixed(2)}` : "—"}</p>
                          <p><span className="text-violet-200">Take profit 2:</span> {planTp2 !== null ? formatScannerPrice(instrument, planTp2) : "—"} · estimated return {estimatedTp2 !== null ? `${account?.currency ?? ""} ${estimatedTp2.toFixed(2)}` : "—"}</p>
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-[#71887f]">
                          Position size is calculated from account equity, your risk percentage, the selected strategy’s stop distance and OANDA’s home-currency conversion rate. No fixed unit size is used.
                        </p>
                        {executionMode === "live" && (
                          <label className="mt-3 flex items-start gap-2 text-xs text-amber-100/80">
                            <input
                              type="checkbox"
                              checked={liveConfirm}
                              onChange={(event) =>
                                setLiveConfirm(event.target.checked)
                              }
                              className="mt-0.5"
                            />
                            I understand this can place a real OANDA order.
                          </label>
                        )}
                        <Button
                          onClick={() => void submitOrder()}
                          disabled={
                            !marketSetup ||
                            !calculatedUnits ||
                            !validRiskPercent ||
                            (executionMode === "live" && !liveConfirm)
                          }
                          className="mt-3 w-full bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"
                        >
                          {executionMode === "paper"
                            ? "Simulate paper order"
                            : "Submit live order"}
                        </Button>
                        {orderStatus && (
                          <p className="mt-2 text-xs text-[#89f6bf]">
                            {orderStatus}
                          </p>
                        )}
                        {executionMode === "live" && (
                          <div className={(tradeReview?.drifted ? "border-rose-300/30 bg-rose-300/[.08]" : "border-[#a4ffcf]/15 bg-[#a4ffcf]/[.04]") + " mt-3 rounded-lg border p-3 text-xs leading-5"}>
                            <p className="font-medium text-white">
                              Live trade monitor {monitoredTrade ? `· ${monitoredTrade.id}` : "· no open trade on this market"}
                            </p>
                            {monitoredTrade ? (
                              <>
                                <p className="mt-1 text-[#a9bdb6]">
                                  OANDA trade: {monitoredTrade.units > 0 ? "long" : "short"} {Math.abs(monitoredTrade.units).toLocaleString()} units · open {formatScannerPrice(instrument, monitoredTrade.price)} · unrealised {monitoredTrade.unrealizedPL.toFixed(2)} {account?.currency ?? ""}
                                </p>
                                <p className={tradeReview?.drifted ? "mt-1 text-rose-200" : "mt-1 text-[#89f6bf]"}>
                                  {tradeReview ? `${tradeReview.decision.toUpperCase()}: ${tradeReview.explanation}` : monitorStatus || "Rule monitor is checking for a meaningful strategy change."}
                                </p>
                                {tradeReview?.drifted && <p className="mt-1 text-rose-200">Recommended action: {tradeReview.recommendedAction}</p>}
                                <p className="mt-1 text-[10px] text-[#71887f]">
                                  Rule checks poll every 5 seconds. AI re-checks only after a meaningful move and no more than once every 5 minutes; it never closes or changes an order automatically.
                                </p>
                              </>
                            ) : (
                              <p className="mt-1 text-[#a9bdb6]">{monitorStatus || "Waiting for an open OANDA trade."}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-amber-300/10 bg-amber-300/[.04] p-4">
                        <p className="text-[10px] tracking-[.12em] text-amber-200/80">
                          AI MARKET ANALYSIS
                        </p>
                        {!marketAiPlan && (
                          <Button
                            onClick={() =>
                              aiConnected && marketSetup
                                ? void generateAiStrategies(
                                    [marketSetup],
                                    scanner?.generatedAt ??
                                      new Date().toISOString(),
                                    true,
                                  )
                                : setSettingsOpen(true)
                            }
                            disabled={aiLoading}
                            className="mt-3 w-full bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"
                          >
                            <BrainCircuit
                              className={aiLoading ? "animate-spin" : ""}
                            />
                            {aiConnected
                              ? aiLoading
                                ? "Analysing this market…"
                                : "Generate AI analysis"
                              : "Add AI key in Settings"}
                          </Button>
                        )}
                        {marketAiPlan ? (
                          <>
                            <p className="mt-2 text-sm font-medium text-white">
                              {marketAiPlan.strategyName}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-[#c7d2cc]">
                              {marketAiPlan.analysis}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {marketAiPlan.methodology.map((method) => (
                                <span
                                  key={method}
                                  className="rounded-full border border-[#a4ffcf]/15 bg-[#a4ffcf]/[.06] px-2 py-1 text-[10px] text-[#89f6bf]"
                                >
                                  {method}
                                </span>
                              ))}
                            </div>
                            <p className="mt-3 text-xs leading-5 text-[#a9bdb6]">
                              <span className="text-[#89f6bf]">
                                Entry trigger:
                              </span>{" "}
                              {marketAiPlan.trigger}
                            </p>
                            <ul className="mt-3 space-y-1 text-xs leading-5 text-[#a9bdb6]">
                              {marketAiPlan.reasons.map((reason) => (
                                <li key={reason}>• {reason}</li>
                              ))}
                            </ul>
                            <p className="mt-3 text-xs leading-5 text-amber-100/75">
                              <span className="text-amber-200">News risk:</span>{" "}
                              {marketAiPlan.eventRisk}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-rose-200/75">
                              Invalidation: {marketAiPlan.invalidation}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="mt-2 text-sm font-medium text-white">
                              {marketSetup.selectedStrategy?.name ??
                                "No strategy selected yet"}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-[#c7d2cc]">
                              {marketSetup.selectedStrategy?.evidence ??
                                "The strategy engine is waiting for enough evidence."}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-[#a9bdb6]">
                              Why this plan:{" "}
                              {marketSetup.selectedStrategy?.why ??
                                "No valid setup yet."}
                            </p>
                            <ol className="mt-3 space-y-2 text-xs leading-5 text-[#c7d2cc]">
                              <li>
                                <span className="text-[#89f6bf]">
                                  1. Before entry:
                                </span>{" "}
                                {marketSetup.selectedStrategy?.nextStep ??
                                  "Wait for a confirmed trigger."}
                              </li>
                              <li>
                                <span className="text-rose-300">2. Stop:</span>{" "}
                                use the displayed stop only beyond the level
                                that would disprove this specific strategy.
                              </li>
                              <li>
                                <span className="text-[#89f6bf]">3. TP1:</span>{" "}
                                first risk/reward checkpoint; take partial
                                profit only when reached.
                              </li>
                              <li>
                                <span className="text-[#89f6bf]">4. TP2:</span>{" "}
                                hold the remainder only while the selected
                                strategy stays valid.
                              </li>
                            </ol>
                            <p className="mt-3 text-xs leading-5 text-rose-200/75">
                              Invalidation: {marketSetup.invalidation}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-5 rounded-xl border border-dashed border-white/10 p-6 text-sm text-[#81978f]">
                    Run the daily scanner to evaluate the current strategies,
                    evidence and style-specific TP/SL levels for this market.
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0c1916] p-5">
                <div className="flex items-center gap-2">
                  <Newspaper size={18} className="text-[#a4ffcf]" />
                  <div>
                    <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                      RELATED NEWS & EVENT RISK
                    </p>
                    <h2 className="mt-1 text-lg">
                      {instrument.replace("_", " / ")} headlines
                    </h2>
                  </div>
                </div>
                <div className="mt-4 h-[340px] overflow-hidden rounded-xl border border-white/5">
                  <PairNews instrument={instrument} />
                </div>
                <p className="mt-3 text-[11px] leading-5 text-amber-100/65">
                  Verify the live economic calendar before entry. High-impact
                  events can invalidate technical levels and widen spreads.
                </p>
              </div>
            </section>

            <section className="mt-5 rounded-2xl border border-white/10 bg-[#0c1916] p-4 sm:p-6">
              <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                    INTERACTIVE ANALYSIS
                  </p>
                  <h2 className="mt-1 text-lg">TradingView chart with live levels</h2>
                </div>
                <div className="text-xs text-[#81978f]">
                  {instrument.replace("_", " / ")} · {granularity} · TradingView
                  indicators and drawing tools
                </div>
              </div>
              <TradingViewChart
                instrument={instrument}
                granularity={granularity}
                candles={data?.candles}
                levels={
                  marketSetup
                    ? {
                        entry: marketAiPlan?.entry ?? marketSetup.entry,
                        stopLoss:
                          marketAiPlan?.stopLoss ?? marketSetup.stopLoss,
                        takeProfit1:
                          marketAiPlan?.takeProfit1 ?? marketSetup.takeProfit1,
                        takeProfit2:
                          marketAiPlan?.takeProfit2 ?? marketSetup.takeProfit2,
                      }
                    : undefined
                }
              />
              <p className="mt-3 text-[11px] leading-5 text-[#71887f]">
                Candles are fetched from OANDA and rendered with TradingView
                Lightweight Charts. Entry, stop loss and take-profit lines are
                actual chart overlays tied to the selected strategy.
              </p>
            </section>

            <section className="mt-5 rounded-2xl border border-white/10 bg-[#0c1916] p-5">
              <p className="text-xs tracking-[.14em] text-[#8aa29a]">
                MARKET LIST
              </p>
              <h2 className="mt-1 text-lg">Choose another market</h2>
              <div className="mt-4 grid gap-x-8 md:grid-cols-2">
                {instruments.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => {
                      setQuote(null);
                      setInstrument(item.value);
                    }}
                    className="flex items-center justify-between border-b border-white/8 py-3 text-left"
                  >
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="mt-0.5 text-xs text-[#81978f]">
                        {item.note}
                      </p>
                    </div>
                    <span
                      className={
                        instrument === item.value
                          ? "text-xs text-[#89f6bf]"
                          : "text-xs text-[#71887f]"
                      }
                    >
                      {instrument === item.value ? "Selected" : "Open study"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
        <p className="mt-6 text-xs leading-5 text-[#71887f]">
          For research and education only. This interface does not execute
          trades or provide investment advice.
        </p>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "mint";
}) {
  return (
    <div className="rounded-lg bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-[.12em] text-[#71887f]">
        {label}
      </p>
      <p
        className={
          (tone === "mint" ? "text-[#89f6bf]" : "text-white") +
          " mt-1 text-sm font-medium"
        }
      >
        {value}
      </p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#8aa29a]">{label}</span>
      <span className="text-right capitalize">{value}</span>
    </div>
  );
}
function Bias({ bias }: { bias: "long" | "short" | "neutral" }) {
  return (
    <span
      className={
        (bias === "long"
          ? "bg-[#59dfa9]/10 text-[#89f6bf]"
          : bias === "short"
            ? "bg-rose-400/10 text-rose-300"
            : "bg-amber-400/10 text-amber-300") +
        " inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.1em]"
      }
    >
      {bias}
    </span>
  );
}
function PlanLevel({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "risk" | "reward";
}) {
  return (
    <div className="rounded-md bg-black/20 p-2">
      <p className="text-[9px] uppercase tracking-[.1em] text-[#71887f]">
        {label}
      </p>
      <p
        className={
          (tone === "risk"
            ? "text-rose-300"
            : tone === "reward"
              ? "text-[#89f6bf]"
              : "text-white") + " mt-0.5 font-mono"
        }
      >
        {value}
      </p>
    </div>
  );
}
function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={
        (connected
          ? "bg-[#59dfa9]/10 text-[#89f6bf]"
          : "bg-white/5 text-[#81978f]") +
        " rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[.1em]"
      }
    >
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}
function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        (active
          ? "bg-[#a4ffcf] text-[#07100f]"
          : "text-[#a9bdb6] hover:bg-white/[.06] hover:text-white") +
        " flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors sm:flex-none"
      }
    >
      {children}
    </Link>
  );
}
