"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, CircleDot, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TradingViewChart } from "@/components/tradingview-chart";

type Candle = { time: string; open: number; high: number; low: number; close: number; complete: boolean };
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
type TradeFill = {
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
type JournalEntry = {
  id: string;
  instrument: string;
  direction: string;
  status: string;
  broker_trade_id: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  pnl: number | null;
  notes: string | null;
  opened_at: string | null;
  closed_at: string | null;
  metadata_json: string | null;
};
type Account = { currency: string; equity: number; marginAvailable: number | null };
type Quote = { mid: number; bid: number; ask: number; time: string };

const granularities = ["M5", "M15", "H1", "H4"];

function decimalsFor(instrument: string) {
  if (instrument.endsWith("JPY")) return 3;
  if (instrument === "XAU_USD") return 3;
  if (instrument === "US30_USD") return 1;
  return 5;
}

function priceText(value: number | null | undefined, instrument: string) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(decimalsFor(instrument));
}

function moneyText(value: number, currency: string) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} ${currency}`;
}

function directionFor(units: number) { return units >= 0 ? "LONG" : "SHORT"; }

function journalMetadata(entry: JournalEntry | null | undefined) {
  if (!entry?.metadata_json) return {} as Record<string, unknown>;
  try { return JSON.parse(entry.metadata_json) as Record<string, unknown>; } catch { return {}; }
}

function closeSummary(entry: JournalEntry | null | undefined) {
  if (!entry) return null;
  const metadata = journalMetadata(entry);
  const reason = typeof metadata.closeReason === "string"
    ? metadata.closeReason
    : entry.notes?.startsWith("LLM closed:")
      ? "LLM close"
      : entry.notes?.startsWith("Manual close")
        ? "Manual close"
        : null;
  if (!reason && !entry.notes) return null;
  return {
    reason: reason ?? "Journal note",
    notes: entry.notes?.startsWith("LLM closed:") ? entry.notes.slice("LLM closed:".length).trim() : entry.notes,
  };
}

function NavLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return <Link href={href} className={(active ? "bg-[#a4ffcf] text-[#07100f]" : "text-[#a9bdb6] hover:bg-white/[.06] hover:text-white") + " rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors"}>{children}</Link>;
}

export default function OpenTradesPage() {
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
  const [fills, setFills] = useState<TradeFill[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [selectedId, setSelectedId] = useState("");
  const [granularity, setGranularity] = useState("H1");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candlesInstrument, setCandlesInstrument] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [tradesResponse, journalResponse, accountResponse] = await Promise.all([
        fetch("/api/oanda/trades?t=" + Date.now(), { cache: "no-store" }),
        fetch("/api/journal?limit=200&t=" + Date.now(), { cache: "no-store" }),
        fetch("/api/oanda/account?t=" + Date.now(), { cache: "no-store" }),
      ]);
      const tradesPayload = await tradesResponse.json();
      const journalPayload = await journalResponse.json();
      const accountPayload = await accountResponse.json();
      if (!tradesResponse.ok) throw new Error(tradesPayload.error || tradesPayload.message || "Connect OANDA to monitor open trades.");
      const nextTrades = Array.isArray(tradesPayload.trades) ? tradesPayload.trades as OpenTrade[] : [];
      setOpenTrades(nextTrades);
      setFills(Array.isArray(tradesPayload.fills) ? tradesPayload.fills as TradeFill[] : []);
      if (journalResponse.ok) setJournal(Array.isArray(journalPayload.entries) ? journalPayload.entries as JournalEntry[] : []);
      if (accountResponse.ok) setAccount(accountPayload as Account);
      setLastUpdated(tradesPayload.checkedAt ?? new Date().toISOString());
      setMessage("");
      setSelectedId((current) => current && nextTrades.some((trade) => trade.id === current) ? current : nextTrades[0]?.id ?? "");

      const uniqueInstruments = [...new Set(nextTrades.map((trade) => trade.instrument))];
      const priceResults = await Promise.all(uniqueInstruments.map(async (instrument) => {
        const response = await fetch(`/api/oanda/price?instrument=${encodeURIComponent(instrument)}&t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json() as Quote & { instrument?: string };
        return payload.instrument ? [payload.instrument, payload] as const : null;
      }));
      setQuotes(Object.fromEntries(priceResults.filter((value): value is readonly [string, Quote] => Boolean(value))));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load open trades.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  const selectedTrade = openTrades.find((trade) => trade.id === selectedId) ?? openTrades[0] ?? null;
  const selectedTradeId = selectedTrade?.id ?? "";
  const selectedInstrument = selectedTrade?.instrument ?? "";
  const selectedJournal = selectedTrade
    ? journal.find((entry) => entry.broker_trade_id === selectedTrade.id) ?? journal.find((entry) => entry.instrument === selectedTrade.instrument && entry.status === "open") ?? null
    : null;
  const selectedQuote = selectedTrade ? quotes[selectedTrade.instrument] : null;

  const chartMarkers = useMemo(() => fills
    .filter((fill) => selectedTrade && fill.instrument === selectedTrade.instrument && (fill.isEntry || fill.isClose) && fill.price !== null)
    .flatMap((fill) => {
      const fillJournal = journal.find((entry) => entry.broker_trade_id && fill.tradeIds.includes(entry.broker_trade_id));
      const llmClose = Boolean(fillJournal?.notes?.startsWith("LLM closed:"));
      const markers: Array<{ time: string; price: number; kind: "entry" | "close"; label: string; color: string }> = [];
      if (fill.isEntry) markers.push({ time: fill.time, price: fill.price!, kind: "entry", label: fill.units < 0 ? "SHORT ENTRY" : "LONG ENTRY", color: "#a4ffcf" });
      if (fill.isClose) markers.push({ time: fill.time, price: fill.price!, kind: "close", label: llmClose ? "LLM CLOSE" : fill.closeReason ?? "CLOSE", color: llmClose ? "#c4b5fd" : fill.closeReason === "TP hit" ? "#7dd3fc" : "#fb7185" });
      return markers;
    }), [fills, journal, selectedTrade]);

  useEffect(() => {
    if (!selectedTradeId || !selectedInstrument) return;
    let cancelled = false;
    const loadChart = async () => {
      const response = await fetch(`/api/oanda?instrument=${encodeURIComponent(selectedInstrument)}&granularity=${granularity}&t=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!cancelled && response.ok) {
        setCandles(Array.isArray(payload.candles) ? payload.candles as Candle[] : []);
        setCandlesInstrument(selectedInstrument);
      }
    };
    void loadChart().catch(() => { if (!cancelled) setMessage("Unable to load the selected trade chart."); });
    return () => { cancelled = true; };
  }, [granularity, selectedInstrument, selectedTradeId]);

  const totalPL = openTrades.reduce((total, trade) => total + trade.unrealizedPL, 0);
  const recentClosed = fills.filter((fill) => fill.isClose).slice(0, 6);

  return (
    <main className="min-h-screen bg-[#07100f] text-[#e8f3ee] selection:bg-[#a4ffcf] selection:text-[#07100f]">
      <header className="mx-auto flex max-w-[1460px] flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#a4ffcf] text-[#07100f]"><CircleDot size={19} /></span>
          <span><span className="block text-sm font-semibold tracking-[.18em]">FORESIGHT FX</span><span className="block text-[10px] tracking-[.2em] text-[#8aa29a]">OPEN TRADES MONITOR</span></span>
        </Link>
        <nav className="order-3 flex w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-black/15 p-1 sm:order-none sm:w-auto" aria-label="Primary navigation">
          <NavLink href="/">Overview</NavLink>
          <NavLink href="/open-trades" active>Open trades</NavLink>
          <NavLink href="/markets">Markets</NavLink>
          <NavLink href="/research">News & events</NavLink>
          <NavLink href="/validation">Validation</NavLink>
          <NavLink href="/journal">Journal</NavLink>
          <NavLink href="/logs">System logs</NavLink>
        </nav>
        <div className="flex items-center gap-3 text-xs text-[#8aa29a]"><span className="flex items-center gap-1.5 text-[#89f6bf]"><Activity size={14} /> LIVE</span><span>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en-GB")}` : "Connecting…"}</span></div>
      </header>

      <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs tracking-[.16em] text-[#89f6bf]">EXECUTION CONTROL</p><h1 className="mt-2 text-3xl font-medium">Open trades</h1><p className="mt-2 max-w-2xl text-sm text-[#a9bdb6]">Monitor every live position, its broker prices and protective levels. The board refreshes automatically every 5 seconds.</p></div>
          <Button variant="ghost" onClick={() => void load()} className="text-[#a4ffcf]"><RefreshCw size={16} /> Refresh now</Button>
        </div>
        {message && <p className="mt-5 rounded-lg border border-rose-300/20 bg-rose-300/[.06] p-3 text-sm text-rose-200">{message}</p>}

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Open positions" value={String(openTrades.length)} detail={account ? `${account.currency} account · equity ${account.equity.toFixed(2)}` : "Waiting for account summary"} />
          <Metric label="Unrealised P/L" value={moneyText(totalPL, account?.currency ?? "account currency")} tone={totalPL >= 0 ? "positive" : "negative"} detail="Across all open trades" />
          <Metric label="Selected market" value={selectedTrade?.instrument.replace("_", " / ") ?? "—"} detail={selectedQuote ? `Bid ${priceText(selectedQuote.bid, selectedTrade!.instrument)} · Ask ${priceText(selectedQuote.ask, selectedTrade!.instrument)}` : "Select an open position"} />
          <Metric label="Protection" value={openTrades.length ? `${openTrades.filter((trade) => trade.stopLoss !== null && trade.takeProfit !== null).length}/${openTrades.length} protected` : "—"} detail="Positions with both SL and TP" />
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#0c1916] p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">LIVE POSITION BOARD</p><h2 className="mt-1 text-xl">Active positions</h2></div><span className="text-xs text-[#71887f]">Click a row to open its chart</span></div>
          {loading && !openTrades.length ? <p className="mt-6 text-sm text-[#71887f]">Loading broker positions…</p> : openTrades.length ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="text-[10px] uppercase tracking-[.14em] text-[#71887f]"><tr className="border-b border-white/10"><th className="pb-3 pr-4">Position</th><th className="pb-3 pr-4">Units</th><th className="pb-3 pr-4">Entry</th><th className="pb-3 pr-4">Current</th><th className="pb-3 pr-4">SL</th><th className="pb-3 pr-4">TP</th><th className="pb-3 pr-4">Live P/L</th><th className="pb-3">Trade</th></tr></thead><tbody className="divide-y divide-white/[.06]">{openTrades.map((trade) => { const quote = quotes[trade.instrument]; const active = trade.id === selectedTrade?.id; return <tr key={trade.id} onClick={() => setSelectedId(trade.id)} className={(active ? "bg-[#a4ffcf]/[.06] " : "") + "cursor-pointer transition-colors hover:bg-white/[.04]"}><td className="py-4 pr-4"><div className="flex items-center gap-2"><span className={(trade.units >= 0 ? "bg-[#59dfa9]/10 text-[#89f6bf]" : "bg-rose-300/10 text-rose-200") + " inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold tracking-[.08em]"}>{trade.units >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{directionFor(trade.units)}</span><span className="font-medium text-white">{trade.instrument.replace("_", " / ")}</span></div><p className="mt-1 text-[11px] text-[#71887f]">Opened {trade.openTime ? new Date(trade.openTime).toLocaleString("en-GB") : "—"}</p></td><td className="py-4 pr-4 text-[#c7d2cc]">{Math.abs(trade.units).toLocaleString()}</td><td className="py-4 pr-4 font-mono text-[#c7d2cc]">{priceText(trade.price, trade.instrument)}</td><td className="py-4 pr-4 font-mono text-white">{priceText(quote?.mid, trade.instrument)}</td><td className="py-4 pr-4 font-mono text-rose-200">{priceText(trade.stopLoss, trade.instrument)}</td><td className="py-4 pr-4 font-mono text-sky-200">{priceText(trade.takeProfit, trade.instrument)}</td><td className={(trade.unrealizedPL >= 0 ? "text-[#89f6bf]" : "text-rose-200") + " py-4 pr-4 font-medium"}>{moneyText(trade.unrealizedPL, account?.currency ?? "")}</td><td className="py-4 font-mono text-[11px] text-[#71887f]">#{trade.id}</td></tr>; })}</tbody></table></div> : <div className="mt-6 rounded-xl border border-dashed border-white/10 p-8 text-center"><p className="text-lg text-white">No open trades currently</p><p className="mt-2 text-sm text-[#71887f]">Executed positions will appear here automatically as soon as OANDA reports them.</p><Link href="/" className="mt-4 inline-block text-sm text-[#a4ffcf] hover:underline">Return to overview</Link></div>}
        </section>

        {selectedTrade && <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-white/10 bg-[#0c1916] p-4 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">EXECUTED ORDER · {selectedTrade.id}</p><h2 className="mt-1 text-xl">{selectedTrade.instrument.replace("_", " / ")} <span className="text-sm text-[#89f6bf]">{directionFor(selectedTrade.units)}</span></h2></div><select value={granularity} onChange={(event) => setGranularity(event.target.value)} className="h-9 rounded-md border border-white/10 bg-[#10221d] px-3 text-xs text-white">{granularities.map((value) => <option key={value}>{value}</option>)}</select></div><div className="mt-4 h-[430px] overflow-hidden rounded-xl border border-white/5"><TradingViewChart instrument={selectedTrade.instrument} granularity={granularity} candles={candlesInstrument === selectedTrade.instrument ? candles : undefined} levels={{ entry: selectedTrade.price, stopLoss: selectedTrade.stopLoss, takeProfit1: selectedTrade.takeProfit }} markers={chartMarkers} tradeSummary={{ status: "OPEN" }} /></div><p className="mt-3 text-[11px] leading-5 text-[#71887f]">TradingView Lightweight Charts uses the executed broker fill for entry, live SL/TP levels and the recorded OANDA fill history. Closed orders are labelled TP hit, SL hit or LLM close when available.</p></div>
          <aside className="space-y-4"><section className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"><p className="text-xs tracking-[.14em] text-[#8aa29a]">POSITION DETAILS</p><div className="mt-4 space-y-3 text-sm"><Detail label="Direction" value={directionFor(selectedTrade.units)} /><Detail label="Entry" value={priceText(selectedTrade.price, selectedTrade.instrument)} /><Detail label="Current" value={priceText(selectedQuote?.mid, selectedTrade.instrument)} /><Detail label="Units" value={Math.abs(selectedTrade.units).toLocaleString()} /><Detail label="Stop loss" value={priceText(selectedTrade.stopLoss, selectedTrade.instrument)} /><Detail label="Take profit" value={priceText(selectedTrade.takeProfit, selectedTrade.instrument)} /><Detail label="Unrealised P/L" value={moneyText(selectedTrade.unrealizedPL, account?.currency ?? "")} valueClass={selectedTrade.unrealizedPL >= 0 ? "text-[#89f6bf]" : "text-rose-200"} /></div></section><section className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"><p className="text-xs tracking-[.14em] text-[#8aa29a]">LLM / JOURNAL STATUS</p>{selectedJournal ? <><p className="mt-3 text-sm text-white">{selectedJournal.status.toUpperCase()} · {selectedJournal.direction}</p>{selectedJournal.notes && <p className="mt-2 text-sm leading-6 text-[#c7d2cc]">{selectedJournal.notes}</p>}<Link href="/journal" className="mt-4 inline-block text-xs text-[#a4ffcf] hover:underline">Open full journal →</Link></> : <p className="mt-3 text-sm leading-6 text-[#71887f]">No journal record is linked to this broker trade yet.</p>}</section></aside>
        </section>}

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#0c1916] p-5 sm:p-6"><div className="flex items-center gap-2"><Clock3 size={16} className="text-[#89f6bf]" /><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">RECENT CLOSES</p><h2 className="mt-1 text-lg">Why orders closed</h2></div></div>{recentClosed.length ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{recentClosed.map((fill) => { const fillJournal = journal.find((entry) => entry.broker_trade_id && fill.tradeIds.includes(entry.broker_trade_id)); const summary = closeSummary(fillJournal); return <article key={fill.id} className="rounded-xl border border-white/8 bg-black/10 p-4"><div className="flex items-center justify-between gap-3"><span className="font-medium text-white">{fill.instrument?.replace("_", " / ") ?? "Unknown"}</span><span className={(fill.closeReason === "TP hit" ? "text-sky-200" : fill.closeReason === "SL hit" ? "text-rose-200" : "text-[#c4b5fd]") + " text-xs font-semibold"}>{summary?.reason ?? fill.closeReason ?? "Closed order"}</span></div><p className="mt-2 text-xs text-[#71887f]">{new Date(fill.time).toLocaleString("en-GB")} · realised {moneyText(fill.pnl, account?.currency ?? "")}</p>{summary?.notes && <p className="mt-2 text-sm leading-5 text-[#c7d2cc]">{summary.notes}</p>}</article>; })}</div> : <p className="mt-4 text-sm text-[#71887f]">No closed fills in the last 7 days.</p>}</section>
      </div>
    </main>
  );
}

function Metric({ label, value, detail, tone = "default" }: { label: string; value: string; detail: string; tone?: "default" | "positive" | "negative" }) {
  return <div className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"><p className="text-xs tracking-[.14em] text-[#8aa29a]">{label}</p><p className={(tone === "positive" ? "text-[#89f6bf]" : tone === "negative" ? "text-rose-200" : "text-white") + " mt-3 text-xl font-medium"}>{value}</p><p className="mt-1 text-xs text-[#71887f]">{detail}</p></div>;
}

function Detail({ label, value, valueClass = "text-white" }: { label: string; value: string; valueClass?: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-white/[.06] pb-2"><span className="text-[#8aa29a]">{label}</span><span className={valueClass + " font-mono text-right"}>{value}</span></div>;
}
