"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDot,
  FlaskConical,
  Info,
  RefreshCw,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TradingViewChart } from "@/components/tradingview-chart";

type Gate = { id: string; label: string; status: "pass" | "wait" | "block"; value: string; explanation: string };
type RecordRow = {
  id: string; environment: string; instrument: string; direction: "long" | "short"; style: string;
  strategyName: string; strategyVersion: string | null; status: string; brokerTradeId: string | null;
  plannedEntry: number | null; actualEntry: number | null; stopLoss: number | null; takeProfit1: number | null;
  takeProfit2: number | null; actualExit: number | null; units: number | null; riskAmount: number | null;
  pnl: number | null; plannedR: number | null; realisedR: number | null; slippagePips: number | null;
  closeReason: string | null; openedAt: string; closedAt: string | null; durationMinutes: number | null;
  thesis: string | null; evidence: string | null; invalidation: string | null; notes: string | null;
  brokerMatched: boolean; evidenceComplete: number; evidenceTotal: number;
};
type Report = {
  connected: boolean;
  brokerError?: string;
  generatedAt: string;
  source: { kind: "broker-forward"; environment: "practice" | "live" | null; currency: string | null; statement: string };
  verdict: { label: string; passedGates: number; totalGates: number; score: number; explanation: string };
  metrics: {
    closedTrades: number; practiceClosedTrades: number; liveClosedTrades: number; netPnl: number;
    winRate: number | null; expectancyR: number | null; profitFactor: number | null; maxDrawdown: number;
    averageEntrySlippagePips: number | null; brokerMatchRate: number | null; evidenceCoverage: number | null;
    unprotectedOpenTrades: number; reconciliationCount: number;
  };
  gates: Gate[];
  records: RecordRow[];
  equityCurve: Array<{ time: string; value: number }>;
};
type Candle = { time: string; open: number; high: number; low: number; close: number; complete: boolean };

function NavLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return <Link href={href} className={(active ? "bg-[#a4ffcf] text-[#07100f]" : "text-[#a9bdb6] hover:bg-white/[.06] hover:text-white") + " rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors"}>{children}</Link>;
}

function priceDecimals(instrument: string) {
  if (instrument.endsWith("JPY") || instrument === "XAU_USD") return 3;
  if (instrument === "US30_USD") return 1;
  return 5;
}

function price(value: number | null, instrument: string) {
  return value === null ? "—" : value.toFixed(priceDecimals(instrument));
}

function signed(value: number | null, digits = 2, suffix = "") {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function money(value: number, currency: string | null) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}${currency ? ` ${currency}` : ""}`;
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "risk" }) {
  return <article className="rounded-2xl border border-white/10 bg-[#0c1916] p-5">
    <p className="text-[10px] uppercase tracking-[.16em] text-[#71887f]">{label}</p>
    <p className={(tone === "good" ? "text-[#89f6bf]" : tone === "risk" ? "text-rose-200" : "text-white") + " mt-3 text-2xl font-medium tabular-nums"}>{value}</p>
    <p className="mt-2 text-xs leading-5 text-[#8aa29a]">{detail}</p>
  </article>;
}

function GateIcon({ status }: { status: Gate["status"] }) {
  if (status === "pass") return <CheckCircle2 size={17} className="text-[#89f6bf]" />;
  if (status === "block") return <XCircle size={17} className="text-rose-300" />;
  return <AlertTriangle size={17} className="text-amber-200" />;
}

function EquityCurve({ points }: { points: Array<{ value: number }> }) {
  if (!points.length) return <div className="grid h-44 place-items-center rounded-xl border border-dashed border-white/10 text-sm text-[#71887f]">Closed-trade P/L will draw this curve.</div>;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const chartPoints = points.map((point, index) => `${points.length === 1 ? 50 : (index / (points.length - 1)) * 100},${95 - ((point.value - min) / span) * 85}`).join(" ");
  const zeroY = 95 - ((0 - min) / span) * 85;
  return <div className="relative h-44 rounded-xl border border-white/[.06] bg-black/10 p-2">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Cumulative realised profit and loss">
      <line x1="0" x2="100" y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,.12)" strokeDasharray="2 2" />
      <polyline points={chartPoints} fill="none" stroke="#a4ffcf" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

export default function ValidationPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [environment, setEnvironment] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [granularity, setGranularity] = useState("H1");
  const [candles, setCandles] = useState<Candle[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/validation?t=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Validation evidence could not be loaded.");
      setReport(payload as Report);
      setSelectedId((current) => current && payload.records.some((record: RecordRow) => record.id === current) ? current : payload.records[0]?.id ?? "");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Validation evidence could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const records = useMemo(() => report?.records.filter((record) => environment === "all" || record.environment === environment) ?? [], [environment, report]);
  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;

  useEffect(() => {
    if (!selected?.instrument) return;
    let cancelled = false;
    void fetch(`/api/oanda?instrument=${encodeURIComponent(selected.instrument)}&granularity=${granularity}&t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, payload: await response.json() }))
      .then(({ ok, payload }) => { if (!cancelled) setCandles(ok && Array.isArray(payload.candles) ? payload.candles : []); })
      .catch(() => { if (!cancelled) setCandles([]); });
    return () => { cancelled = true; };
  }, [granularity, selected?.id, selected?.instrument]);

  const blockers = report?.gates.filter((gate) => gate.status === "block") ?? [];
  const environmentLabel = report?.source.environment === "live" ? "LIVE ACCOUNT" : report?.source.environment === "practice" ? "PRACTICE ACCOUNT" : "JOURNAL ONLY";

  return <main className="min-h-screen bg-[#07100f] text-[#e8f3ee] selection:bg-[#a4ffcf] selection:text-[#07100f]">
    <header className="mx-auto flex max-w-[1460px] flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 lg:px-10">
      <Link href="/" className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#a4ffcf] text-[#07100f]"><CircleDot size={19} /></span><span><span className="block text-sm font-semibold tracking-[.18em]">FORESIGHT FX</span><span className="block text-[10px] tracking-[.2em] text-[#8aa29a]">VALIDATION LAB</span></span></Link>
      <nav className="order-3 flex w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-black/15 p-1 sm:order-none sm:w-auto" aria-label="Primary navigation">
        <NavLink href="/">Overview</NavLink><NavLink href="/open-trades">Open trades</NavLink><NavLink href="/markets">Markets</NavLink><NavLink href="/research">News & events</NavLink><NavLink href="/validation" active>Validation</NavLink><NavLink href="/journal">Journal</NavLink><NavLink href="/logs">Logs</NavLink>
      </nav>
      <Button variant="ghost" onClick={() => void load()} disabled={loading} className="text-[#a4ffcf]"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh</Button>
    </header>

    <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10">
      <section className="relative overflow-hidden rounded-3xl border border-[#a4ffcf]/15 bg-[radial-gradient(circle_at_85%_15%,rgba(164,255,207,.12),transparent_34%),#0c1916] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2"><span className={(report?.source.environment === "live" ? "border-rose-300/30 bg-rose-300/10 text-rose-200" : "border-[#89f6bf]/30 bg-[#89f6bf]/10 text-[#89f6bf]") + " rounded-full border px-3 py-1 text-[10px] font-semibold tracking-[.14em]"}>{environmentLabel}</span><span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-[10px] tracking-[.12em] text-[#a9bdb6]">BROKER-FORWARD EVIDENCE</span></div>
            <p className="mt-6 text-xs tracking-[.18em] text-[#89f6bf]">PROMOTION CONTROL</p>
            <h1 className="mt-2 text-3xl font-medium sm:text-4xl">Know what is proven before risking real money.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#a9bdb6]">This lab reconciles the plan in your journal with actual OANDA fills, then checks the minimum evidence required for live promotion. Missing evidence is shown as a blocker—not estimated or hidden.</p>
          </div>
          <div className="flex min-w-[270px] items-center gap-5 rounded-2xl border border-white/10 bg-black/15 p-5">
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#a4ffcf ${report?.verdict.score ?? 0}%, rgba(255,255,255,.08) 0)` }}><div className="grid h-20 w-20 place-items-center rounded-full bg-[#0c1916]"><span className="text-2xl font-semibold tabular-nums">{report?.verdict.score ?? 0}<small className="text-xs text-[#8aa29a]">%</small></span></div></div>
            <div><p className="text-[10px] tracking-[.14em] text-[#71887f]">READINESS</p><p className="mt-2 text-sm font-semibold text-white">{report?.verdict.label ?? "CHECKING EVIDENCE"}</p><p className="mt-2 text-xs leading-5 text-[#8aa29a]">{report ? `${report.verdict.passedGates} of ${report.verdict.totalGates} gates pass.` : "Loading evidence gates…"}</p></div>
          </div>
        </div>
      </section>

      {message && <p className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/[.06] p-4 text-sm text-rose-200">{message}</p>}
      {report?.brokerError && <div className="mt-5 flex gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-4 text-sm text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p><strong>Broker reconciliation is incomplete.</strong> {report.brokerError}</p></div>}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Closed evidence" value={String(report?.metrics.closedTrades ?? 0)} detail={`${report?.metrics.practiceClosedTrades ?? 0} practice · ${report?.metrics.liveClosedTrades ?? 0} live`} />
        <Metric label="Net realised P/L" value={money(report?.metrics.netPnl ?? 0, report?.source.currency ?? null)} detail="Journal P/L reconciled to fills" tone={(report?.metrics.netPnl ?? 0) >= 0 ? "good" : "risk"} />
        <Metric label="Expectancy" value={signed(report?.metrics.expectancyR ?? null, 2, "R")} detail="Average outcome per planned unit of risk" tone={(report?.metrics.expectancyR ?? 0) > 0 ? "good" : "risk"} />
        <Metric label="Win rate" value={report?.metrics.winRate === null || report?.metrics.winRate === undefined ? "—" : `${Math.round(report.metrics.winRate * 100)}%`} detail="Wins divided by measured closes" />
        <Metric label="Profit factor" value={report?.metrics.profitFactor === null || report?.metrics.profitFactor === undefined ? "—" : report.metrics.profitFactor.toFixed(2)} detail="Gross profit ÷ gross loss" />
        <Metric label="Max drawdown" value={money(-(report?.metrics.maxDrawdown ?? 0), report?.source.currency ?? null)} detail="Largest peak-to-trough realised decline" tone={(report?.metrics.maxDrawdown ?? 0) > 0 ? "risk" : "neutral"} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-2xl border border-white/10 bg-[#0c1916] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">CUMULATIVE REALISED P/L</p><h2 className="mt-1 text-xl">Broker-forward equity curve</h2></div><BarChart3 size={19} className="text-[#89f6bf]" /></div>
          <p className="mt-2 text-xs leading-5 text-[#71887f]">This line uses closed broker-forward trades only. Deposits, withdrawals and open P/L are excluded.</p>
          <div className="mt-5"><EquityCurve points={report?.equityCurve ?? []} /></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><SmallStat label="Broker match" value={report?.metrics.brokerMatchRate == null ? "—" : `${Math.round(report.metrics.brokerMatchRate * 100)}%`} /><SmallStat label="Evidence coverage" value={report?.metrics.evidenceCoverage == null ? "—" : `${Math.round(report.metrics.evidenceCoverage * 100)}%`} /><SmallStat label="Avg entry slippage" value={signed(report?.metrics.averageEntrySlippagePips ?? null, 2, " pips")} /></div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0c1916] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">EVIDENCE GATES</p><h2 className="mt-1 text-xl">What blocks promotion</h2></div><ShieldCheck size={19} className="text-[#89f6bf]" /></div>
          <div className="mt-5 divide-y divide-white/[.06]">{report?.gates.map((gate) => <article key={gate.id} className="grid grid-cols-[auto_1fr] gap-3 py-3 first:pt-0 last:pb-0"><GateIcon status={gate.status} /><div><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-white">{gate.label}</p><span className={(gate.status === "pass" ? "text-[#89f6bf]" : gate.status === "block" ? "text-rose-200" : "text-amber-200") + " text-xs font-medium"}>{gate.value}</span></div><p className="mt-1 text-xs leading-5 text-[#71887f]">{gate.explanation}</p></div></article>) ?? <p className="text-sm text-[#71887f]">Checking promotion gates…</p>}</div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#0c1916] p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">PLAN VS ACTUAL</p><h2 className="mt-1 text-xl">Trade evidence ledger</h2><p className="mt-2 text-xs leading-5 text-[#71887f]">Select a trade to replay its planned levels, broker fills and recorded reasoning.</p></div><div className="flex rounded-lg border border-white/10 bg-black/10 p-1">{["all", "practice", "live"].map((value) => <button key={value} type="button" onClick={() => setEnvironment(value)} className={(environment === value ? "bg-white/10 text-white" : "text-[#71887f] hover:text-white") + " rounded-md px-3 py-1.5 text-xs capitalize"}>{value}</button>)}</div></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="text-[10px] uppercase tracking-[.12em] text-[#71887f]"><tr className="border-b border-white/10"><th className="pb-3 pr-4">Trade</th><th className="pb-3 pr-4">Version</th><th className="pb-3 pr-4">Planned → fill</th><th className="pb-3 pr-4">Slippage</th><th className="pb-3 pr-4">Realised</th><th className="pb-3 pr-4">Close</th><th className="pb-3">Evidence</th></tr></thead><tbody className="divide-y divide-white/[.06]">{records.map((record) => <tr key={record.id} className={selected?.id === record.id ? "bg-[#a4ffcf]/[.045]" : "hover:bg-white/[.025]"}><td className="py-3 pr-4"><button type="button" onClick={() => setSelectedId(record.id)} className="text-left"><span className="font-medium text-white">{record.instrument.replace("_", " / ")}</span><span className={(record.direction === "long" ? "text-[#89f6bf]" : "text-rose-200") + " ml-2 text-[10px] font-semibold uppercase"}>{record.direction}</span><span className="mt-1 block text-[11px] text-[#71887f]">{record.environment} · {record.style}</span></button></td><td className="py-3 pr-4"><span className={record.strategyVersion ? "text-[#c7d2cc]" : "text-amber-200"}>{record.strategyVersion ?? "Unversioned"}</span></td><td className="py-3 pr-4 tabular-nums text-[#c7d2cc]">{price(record.plannedEntry, record.instrument)} <ArrowRight size={12} className="mx-1 inline" /> {price(record.actualEntry, record.instrument)}</td><td className={(record.slippagePips !== null && record.slippagePips > 0 ? "text-rose-200" : "text-[#89f6bf]") + " py-3 pr-4 tabular-nums"}>{signed(record.slippagePips, 2, " pips")}</td><td className={(record.pnl !== null && record.pnl < 0 ? "text-rose-200" : "text-[#89f6bf]") + " py-3 pr-4 tabular-nums"}>{record.pnl === null ? "—" : money(record.pnl, report?.source.currency ?? null)}<span className="ml-2 text-[11px] text-[#71887f]">{signed(record.realisedR, 2, "R")}</span></td><td className="py-3 pr-4 text-[#c7d2cc]">{record.closeReason ?? "—"}</td><td className="py-3"><span className={record.brokerMatched ? "text-[#89f6bf]" : "text-amber-200"}>{record.brokerMatched ? "Matched" : "Incomplete"}</span><span className="ml-2 text-[11px] text-[#71887f]">{record.evidenceComplete}/{record.evidenceTotal}</span></td></tr>)}</tbody></table>{!records.length && <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-white/10 text-center text-sm text-[#71887f]">No closed {environment === "all" ? "" : `${environment} `}trades are available yet.</div>}</div>
      </section>

      {selected && <section className="mt-6 overflow-hidden rounded-2xl border border-[#a4ffcf]/15 bg-[#0c1916]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 p-5 sm:p-6"><div><p className="text-xs tracking-[.14em] text-[#89f6bf]">TRADE REPLAY</p><h2 className="mt-1 text-xl">{selected.instrument.replace("_", " / ")} · {selected.strategyName}</h2><p className="mt-2 text-xs text-[#71887f]">{selected.openedAt ? new Date(selected.openedAt).toLocaleString("en-GB") : "Opening time unavailable"} · {selected.durationMinutes === null ? "Duration unavailable" : `${selected.durationMinutes} minutes`} · {selected.brokerTradeId ? `OANDA trade ${selected.brokerTradeId}` : "No broker ID"}</p></div><select value={granularity} onChange={(event) => setGranularity(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#10221d] px-3 text-xs text-white">{["M15", "H1", "H4", "D"].map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[1.35fr_.65fr]">
          <TradingViewChart instrument={selected.instrument} granularity={granularity} candles={candles} levels={{ entry: selected.plannedEntry, stopLoss: selected.stopLoss, takeProfit1: selected.takeProfit1, takeProfit2: selected.takeProfit2 }} markers={[...(selected.actualEntry !== null ? [{ time: selected.openedAt, price: selected.actualEntry, kind: "entry" as const, label: selected.direction === "short" ? "SHORT ENTRY" : "LONG ENTRY", color: "#a4ffcf" }] : []), ...(selected.actualExit !== null && selected.closedAt ? [{ time: selected.closedAt, price: selected.actualExit, kind: "close" as const, label: selected.closeReason ?? "CLOSE", color: selected.pnl !== null && selected.pnl >= 0 ? "#7dd3fc" : "#fb7185" }] : [])]} tradeSummary={{ status: selected.status.toUpperCase(), closeReason: selected.closeReason, closeNotes: selected.notes }} />
          <aside className="space-y-4">
            <ReplayCard icon={<Scale size={16} />} title="Plan versus execution"><ReplayRow label="Planned entry" value={price(selected.plannedEntry, selected.instrument)} /><ReplayRow label="Actual entry" value={price(selected.actualEntry, selected.instrument)} /><ReplayRow label="Actual exit" value={price(selected.actualExit, selected.instrument)} /><ReplayRow label="Entry slippage" value={signed(selected.slippagePips, 2, " pips")} /><ReplayRow label="Planned reward" value={signed(selected.plannedR, 2, "R")} /><ReplayRow label="Realised outcome" value={signed(selected.realisedR, 2, "R")} /></ReplayCard>
            <ReplayCard icon={<FlaskConical size={16} />} title="Decision record"><Explanation label="Thesis" text={selected.thesis} fallback="No thesis was recorded for this trade." /><Explanation label="Evidence" text={selected.evidence} fallback="No supporting evidence was recorded." /><Explanation label="Invalidation" text={selected.invalidation} fallback="No invalidation rule was recorded." /></ReplayCard>
          </aside>
        </div>
      </section>}

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <ExplainCard icon={<FlaskConical size={18} />} title="Forward evidence" text="Real orders in a practice or live broker environment. It reveals fills, slippage and operational mistakes, but does not test unseen history." />
        <ExplainCard icon={<BarChart3 size={18} />} title="Backtest evidence" text="A deterministic replay over historical events with costs, walk-forward splits and non-repainting checks. This project does not claim that evidence yet." />
        <ExplainCard icon={<ShieldCheck size={18} />} title="Promotion" text={`${blockers.length} blocking gate${blockers.length === 1 ? "" : "s"} remain. Passing gates permits a human review; it never silently enables live trading.`} />
      </section>
      <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-[#71887f]"><Info size={15} className="mt-0.5 shrink-0" />{report?.source.statement ?? "Loading evidence source…"} Last calculated {report ? new Date(report.generatedAt).toLocaleString("en-GB") : "—"}.</p>
    </div>
  </main>;
}

function SmallStat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-[#71887f]">{label}</p><p className="mt-2 text-sm font-medium text-white">{value}</p></div>; }
function ReplayRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-white/[.06] py-2.5 last:border-0"><span className="text-xs text-[#71887f]">{label}</span><strong className="text-xs font-medium tabular-nums text-white">{value}</strong></div>; }
function ReplayCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-white/[.08] bg-black/10 p-4"><div className="flex items-center gap-2 text-[#89f6bf]">{icon}<h3 className="text-sm font-medium text-white">{title}</h3></div><div className="mt-3">{children}</div></section>; }
function Explanation({ label, text, fallback }: { label: string; text: string | null; fallback: string }) { return <div className="mt-4 first:mt-0"><p className="text-[10px] uppercase tracking-[.12em] text-[#71887f]">{label}</p><p className={(text ? "text-[#c7d2cc]" : "text-amber-100/70") + " mt-1 text-xs leading-5"}>{text ?? fallback}</p></div>; }
function ExplainCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <article className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"><div className="flex items-center gap-2 text-[#89f6bf]">{icon}<h3 className="text-sm font-medium text-white">{title}</h3></div><p className="mt-3 text-xs leading-5 text-[#8aa29a]">{text}</p></article>; }
