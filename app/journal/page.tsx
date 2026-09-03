"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type JournalEntry = Record<string, string | number | null> & { id: string; created_at: string; instrument: string; direction: string; style: string; status: string; metadata_json: string | null };

type JournalMetadata = {
  closeReason?: string;
  closePrice?: number;
  closeTransactionId?: string;
  closeTime?: string;
  entryTransactionId?: string;
  source?: string;
};

function metadataFor(entry: JournalEntry) {
  try { return entry.metadata_json ? JSON.parse(entry.metadata_json) as JournalMetadata : {}; } catch { return {}; }
}

function resultStatus(entry: JournalEntry) {
  if (entry.status !== "closed") return entry.status;
  const pnl = Number(entry.pnl);
  if (!Number.isFinite(pnl) || pnl === 0) return "breakeven";
  return pnl > 0 ? "win" : "loss";
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeText(value: string | number | null) {
  return typeof value === "string" && value ? new Date(value).toLocaleString("en-GB") : "—";
}

const inputClass = "h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm text-white outline-none focus:border-[#a4ffcf]";

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lifecycleEventCount, setLifecycleEventCount] = useState(0);
  const [form, setForm] = useState({ instrument: "EUR_USD", direction: "long", style: "intraday", strategyName: "", entryPrice: "", stopLoss: "", takeProfit1: "", takeProfit2: "", riskPercent: "0.5", units: "", notes: "" });
  const [result, setResult] = useState({ status: "closed", pnl: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/journal?limit=200&reconcile=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load journal.");
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setLifecycleEventCount(Number(payload.lifecycleEventCount ?? 0));
      if (payload.reconciliationError) setMessage(`Journal loaded, but OANDA reconciliation needs attention: ${payload.reconciliationError}`);
      else if (payload.reconciliation?.importedUpdates || payload.reconciliation?.closedUpdates || payload.reconciliation?.activityUpdates || payload.lifecycleBackfilled) setMessage(`Journal repaired from OANDA: ${payload.reconciliation?.importedUpdates ?? 0} missing trade(s), ${payload.reconciliation?.closedUpdates ?? 0} close(s), ${payload.reconciliation?.activityUpdates ?? 0} activity change(s), and ${payload.lifecycleBackfilled ?? 0} lifecycle record(s) recovered.`);
      else setMessage("");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load journal.")), 0); return () => window.clearTimeout(timer); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, entryPrice: optionalNumber(form.entryPrice), stopLoss: optionalNumber(form.stopLoss), takeProfit1: optionalNumber(form.takeProfit1), takeProfit2: optionalNumber(form.takeProfit2), riskPercent: optionalNumber(form.riskPercent), units: optionalNumber(form.units) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save journal entry.");
      setMessage("Journal entry saved.");
      setForm({ instrument: "EUR_USD", direction: "long", style: "intraday", strategyName: "", entryPrice: "", stopLoss: "", takeProfit1: "", takeProfit2: "", riskPercent: "0.5", units: "", notes: "" });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save journal entry."); } finally { setSaving(false); }
  };

  const update = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, status: result.status, pnl: optionalNumber(result.pnl), notes: result.notes, closedAt: result.status === "open" ? null : new Date().toISOString() }) });
    const payload = await response.json();
    setMessage(response.ok ? "Journal result updated." : payload.error || "Unable to update journal.");
    if (response.ok) await load();
  };

  return (
    <main className="min-h-screen bg-[#07100f] text-[#e8f3ee]">
      <header className="mx-auto flex max-w-[1460px] flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 lg:px-10">
        <Link href="/" className="text-sm font-semibold tracking-[.18em]">FORESIGHT FX <span className="text-[#89f6bf]">/ TRADING JOURNAL</span></Link>
        <nav className="flex flex-wrap gap-2 text-xs">
          <Link href="/" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Overview</Link>
          <Link href="/open-trades" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Open trades</Link>
          <Link href="/markets" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Markets</Link>
          <Link href="/validation" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Validation</Link>
          <Link href="/logs" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">System logs</Link>
        </nav>
      </header>
      <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-[.16em] text-[#8aa29a]">EXECUTION HISTORY</p>
            <h1 className="mt-2 text-3xl font-medium">Trading journal</h1>
            <p className="mt-2 text-sm text-[#a9bdb6]">Review entries, risk, strategy reasoning and trade outcomes in one place.</p>
          </div>
          <Button variant="ghost" disabled={loading} onClick={() => void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load journal."))} className="text-[#a4ffcf]"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />{loading ? "Syncing…" : "Sync with OANDA"}</Button>
        </div>
        {message && <p className="mb-5 rounded-lg border border-white/10 bg-[#10221d] p-3 text-sm text-[#c7d2cc]">{message}</p>}
        <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <section className="rounded-2xl border border-white/10 bg-[#0c1916] p-5">
            <p className="text-xs tracking-[.14em] text-[#89f6bf]">NEW ENTRY</p>
            <h2 className="mt-1 text-xl">Record a trade idea</h2>
            <form onSubmit={create} className="mt-5 space-y-3">
              <label className="block text-xs text-[#a9bdb6]">Instrument<select className={inputClass + " mt-1 w-full"} value={form.instrument} onChange={(event) => setForm({ ...form, instrument: event.target.value })}>{["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD", "US30_USD"].map((value) => <option key={value} value={value}>{value.replace("_", " / ")}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-[#a9bdb6]">Direction<select className={inputClass + " mt-1 w-full"} value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}><option value="long">Long</option><option value="short">Short</option></select></label>
                <label className="block text-xs text-[#a9bdb6]">Trading style<select className={inputClass + " mt-1 w-full"} value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value })}><option value="scalping">Scalping</option><option value="intraday">Intraday</option><option value="swing">Swing</option></select></label>
              </div>
              <label className="block text-xs text-[#a9bdb6]">Strategy name<input className={inputClass + " mt-1 w-full"} value={form.strategyName} onChange={(event) => setForm({ ...form, strategyName: event.target.value })} placeholder="e.g. Liquidity reclaim" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-[#a9bdb6]">Entry price<input className={inputClass + " mt-1 w-full"} inputMode="decimal" value={form.entryPrice} onChange={(event) => setForm({ ...form, entryPrice: event.target.value })} /></label>
                <label className="block text-xs text-[#a9bdb6]">Risk %<input className={inputClass + " mt-1 w-full"} inputMode="decimal" value={form.riskPercent} onChange={(event) => setForm({ ...form, riskPercent: event.target.value })} /></label>
                <label className="block text-xs text-[#a9bdb6]">Stop loss<input className={inputClass + " mt-1 w-full"} inputMode="decimal" value={form.stopLoss} onChange={(event) => setForm({ ...form, stopLoss: event.target.value })} /></label>
                <label className="block text-xs text-[#a9bdb6]">Units<input className={inputClass + " mt-1 w-full"} inputMode="numeric" value={form.units} onChange={(event) => setForm({ ...form, units: event.target.value })} /></label>
                <label className="block text-xs text-[#a9bdb6]">Take profit 1<input className={inputClass + " mt-1 w-full"} inputMode="decimal" value={form.takeProfit1} onChange={(event) => setForm({ ...form, takeProfit1: event.target.value })} /></label>
                <label className="block text-xs text-[#a9bdb6]">Take profit 2<input className={inputClass + " mt-1 w-full"} inputMode="decimal" value={form.takeProfit2} onChange={(event) => setForm({ ...form, takeProfit2: event.target.value })} /></label>
              </div>
              <label className="block text-xs text-[#a9bdb6]">Notes<textarea className={inputClass + " mt-1 h-24 w-full py-2"} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Thesis, evidence or invalidation" /></label>
              <Button type="submit" disabled={saving} className="w-full bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"><RefreshCw className={saving ? "animate-spin" : ""} />{saving ? "Saving…" : "Save journal entry"}</Button>
            </form>
          </section>
          <section className="rounded-2xl border border-white/10 bg-[#0c1916] p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">SAVED RECORDS</p><h2 className="mt-1 text-xl">Recent trades and ideas</h2></div><div className="text-right text-xs text-[#71887f]"><p>{entries.length} entries</p><p>{lifecycleEventCount} lifecycle events</p></div></div>
            <div className="mt-5 space-y-2">
              {entries.length ? entries.map((entry) => { const metadata = metadataFor(entry); return <button key={entry.id} type="button" onClick={() => { setSelectedId(entry.id); setResult({ status: entry.status === "planned" ? "open" : resultStatus(entry), pnl: entry.pnl == null ? "" : String(entry.pnl), notes: typeof entry.notes === "string" ? entry.notes : "" }); }} className={(selectedId === entry.id ? "border-[#a4ffcf]/40 bg-[#a4ffcf]/[.08]" : "border-white/10 bg-[#10221d] hover:border-white/20") + " w-full rounded-xl border p-4 text-left"}>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{entry.instrument.replace("_", " / ")} · {entry.direction}</p><p className="mt-1 text-xs text-[#8aa29a]">{entry.strategy_name || "Unspecified strategy"} · {entry.style}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase text-[#a4ffcf]">{entry.status}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4"><span className="text-[#71887f]">Entry<strong className="ml-1 text-[#d9e8e1]">{entry.entry_price ?? "—"}</strong></span><span className="text-[#71887f]">SL<strong className="ml-1 text-[#d9e8e1]">{entry.stop_loss ?? "—"}</strong></span><span className="text-[#71887f]">TP<strong className="ml-1 text-[#d9e8e1]">{entry.take_profit_1 ?? "—"}</strong></span><span className="text-[#71887f]">Size<strong className="ml-1 text-[#d9e8e1]">{entry.lots == null ? `${Math.abs(Number(entry.units ?? 0)).toLocaleString()} units` : `${Number(entry.lots).toFixed(2)} lots`}</strong></span><span className="text-[#71887f]">Risk<strong className="ml-1 text-[#d9e8e1]">{entry.risk_percent == null ? "—" : `${entry.risk_percent}%`}</strong></span><span className="text-[#71887f]">P/L<strong className={(Number(entry.pnl) >= 0 ? "text-[#89f6bf]" : "text-rose-200") + " ml-1"}>{entry.pnl ?? "—"}</strong></span><span className="text-[#71887f]">Exit<strong className="ml-1 text-[#d9e8e1]">{metadata.closePrice ?? "—"}</strong></span><span className="text-[#71887f]">Reason<strong className="ml-1 text-[#d9e8e1]">{metadata.closeReason ?? (entry.status === "open" ? "Still open" : "—")}</strong></span></div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#71887f]"><span className="inline-flex items-center gap-1"><Clock3 size={11} />Opened {timeText(entry.opened_at ?? entry.created_at)}</span>{entry.closed_at && <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} />Closed {timeText(entry.closed_at)}</span>}</div>
                {entry.notes && <p className="mt-3 text-xs leading-5 text-[#a9bdb6]">{entry.notes}</p>}
              </button> }) : <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-[#71887f]">No journal entries yet. Save your first trade idea on the left.</div>}
            </div>
          </section>
        </div>
        {selectedId && <section className="mt-5 rounded-2xl border border-[#a4ffcf]/15 bg-[#0c1916] p-5"><p className="text-xs tracking-[.14em] text-[#89f6bf]">POST-TRADE REVIEW</p><h2 className="mt-1 text-xl">Update selected record</h2><form onSubmit={update} className="mt-4 grid gap-3 sm:grid-cols-[220px_220px_1fr_auto] sm:items-end"><label className="block text-xs text-[#a9bdb6]">Outcome<select className={inputClass + " mt-1 w-full"} value={result.status} onChange={(event) => setResult({ ...result, status: event.target.value })}><option value="open">Open</option><option value="win">Win</option><option value="loss">Loss</option><option value="breakeven">Breakeven</option><option value="cancelled">Cancelled</option></select></label><label className="block text-xs text-[#a9bdb6]">Realised P/L<input className={inputClass + " mt-1 w-full"} inputMode="decimal" value={result.pnl} onChange={(event) => setResult({ ...result, pnl: event.target.value })} /></label><label className="block text-xs text-[#a9bdb6]">Review notes<input className={inputClass + " mt-1 w-full"} value={result.notes} onChange={(event) => setResult({ ...result, notes: event.target.value })} /></label><Button type="submit" className="bg-white/10 text-white hover:bg-white/15">Save result</Button></form></section>}
      </div>
    </main>
  );
}
