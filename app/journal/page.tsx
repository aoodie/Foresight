"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type JournalEntry = Record<string, string | number | null> & { id: string; created_at: string; instrument: string; direction: string; style: string; status: string };

const inputClass = "h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm text-white outline-none focus:border-[#a4ffcf]";

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ instrument: "EUR_USD", direction: "long", style: "intraday", strategyName: "", entryPrice: "", stopLoss: "", takeProfit1: "", takeProfit2: "", riskPercent: "0.5", units: "", notes: "" });
  const [result, setResult] = useState({ status: "closed", pnl: "", notes: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/journal?limit=200", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load journal.");
    setEntries(Array.isArray(payload.entries) ? payload.entries : []);
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load journal.")), 0); return () => window.clearTimeout(timer); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, environment: "paper", entryPrice: Number(form.entryPrice) || null, stopLoss: Number(form.stopLoss) || null, takeProfit1: Number(form.takeProfit1) || null, takeProfit2: Number(form.takeProfit2) || null, riskPercent: Number(form.riskPercent) || null, units: Number(form.units) || null }) });
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
    const response = await fetch("/api/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, status: result.status, pnl: Number(result.pnl) || null, notes: result.notes, closedAt: result.status === "open" ? null : new Date().toISOString() }) });
    const payload = await response.json();
    setMessage(response.ok ? "Journal result updated." : payload.error || "Unable to update journal.");
    if (response.ok) await load();
  };

  return <main className="min-h-screen bg-[#07100f] text-[#e8f3ee]"><header className="mx-auto flex max-w-[1460px] flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 lg:px-10"><Link href="/" className="text-sm font-semibold tracking-[.18em]">FORESIGHT FX <span className="text-[#89f6bf]">/ JOURNAL</span></Link><nav className="flex flex-wrap gap-2 text-xs"><Link href="/" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Overview</Link><Link href="/markets" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Markets</Link><Link href="/research" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">News & events</Link><Link href="/logs" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">System logs</Link></nav></header><div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs tracking-[.16em] text-[#8aa29a]">DURABLE TRADE RECORDS</p><h1 className="mt-2 text-3xl font-medium">Trading journal</h1><p className="mt-2 max-w-2xl text-sm text-[#a9bdb6]">Every paper or live order can carry its thesis, evidence, strategy, risk plan, broker ID and final outcome.</p></div><Button variant="ghost" onClick={() => void load()} className="text-[#a4ffcf]"><RefreshCw size={16} /> Refresh</Button></div>{message && <p className="mt-4 rounded-lg border border-[#a4ffcf]/15 bg-[#a4ffcf]/[.05] p-3 text-sm text-[#89f6bf]">{message}</p>}<section className="mt-6 grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form onSubmit={create} className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"><p className="text-xs tracking-[.14em] text-[#89f6bf]">NEW JOURNAL ENTRY</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-[#a9bdb6]">Instrument<select className={inputClass} value={form.instrument} onChange={e => setForm({...form, instrument:e.target.value})}><option>EUR_USD</option><option>GBP_USD</option><option>USD_JPY</option><option>USD_CHF</option><option>AUD_USD</option><option>NZD_USD</option><option>USD_CAD</option><option>EUR_GBP</option><option>EUR_JPY</option><option>GBP_JPY</option><option>XAU_USD</option><option>US30_USD</option></select></label><label className="grid gap-1 text-xs text-[#a9bdb6]">Direction<select className={inputClass} value={form.direction} onChange={e => setForm({...form, direction:e.target.value})}><option>long</option><option>short</option></select></label><label className="grid gap-1 text-xs text-[#a9bdb6]">Trading style<select className={inputClass} value={form.style} onChange={e => setForm({...form, style:e.target.value})}><option>scalping</option><option>intraday</option><option>swing</option></select></label><label className="grid gap-1 text-xs text-[#a9bdb6]">Strategy<input className={inputClass} value={form.strategyName} onChange={e => setForm({...form, strategyName:e.target.value})} placeholder="e.g. liquidity reclaim" /></label>{([["Entry", "entryPrice"],["Stop loss", "stopLoss"],["TP1", "takeProfit1"],["TP2", "takeProfit2"],["Risk %", "riskPercent"],["Units", "units"]] as const).map(([label, key]) => <label key={key} className="grid gap-1 text-xs text-[#a9bdb6]">{label}<input className={inputClass} inputMode="decimal" value={form[key]} onChange={e => setForm({...form, [key]:e.target.value})} /></label>)}<label className="grid gap-1 text-xs text-[#a9bdb6] sm:col-span-2">Notes / thesis<textarea className="min-h-24 rounded-md border border-white/10 bg-[#10221d] p-3 text-sm text-white outline-none focus:border-[#a4ffcf]" value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} placeholder="What did you see, why did you take it, and what will you learn?" /></label></div><Button disabled={saving} className="mt-4 w-full bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]">{saving ? "Saving…" : "Save journal entry"}</Button></form><div className="rounded-2xl border border-white/10 bg-[#0c1916] p-5"><div className="flex items-center justify-between"><p className="text-xs tracking-[.14em] text-[#89f6bf]">RECENT ENTRIES</p><span className="text-xs text-[#71887f]">{entries.length} records</span></div><div className="mt-4 space-y-2">{entries.length ? entries.map(entry => <button key={entry.id} onClick={() => { setSelectedId(entry.id); setResult({ status: entry.status === "open" ? "closed" : entry.status, pnl: entry.pnl == null ? "" : String(entry.pnl), notes: typeof entry.notes === "string" ? entry.notes : "" }); }} className="w-full rounded-xl border border-white/8 bg-black/15 p-3 text-left hover:border-[#a4ffcf]/25"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{entry.instrument} · {entry.direction}</span><span className="rounded-full bg-[#a4ffcf]/10 px-2 py-1 text-[10px] uppercase tracking-[.1em] text-[#89f6bf]">{entry.status}</span></div><p className="mt-1 text-xs text-[#a9bdb6]">{entry.style} · {entry.strategy_name || "Manual entry"} · {new Date(entry.created_at).toLocaleString("en-GB")}</p><p className="mt-1 text-xs text-[#71887f]">Entry {entry.entry_price ?? "—"} · SL {entry.stop_loss ?? "—"} · TP1 {entry.take_profit_1 ?? "—"} · P/L {entry.pnl ?? "—"}</p></button>) : <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-[#71887f]">No journal records yet. Paper and live orders will appear here automatically.</p>}</div>{selectedId && <form onSubmit={update} className="mt-5 rounded-xl border border-[#a4ffcf]/15 bg-[#07100f] p-4"><p className="text-xs tracking-[.12em] text-[#89f6bf]">UPDATE RESULT</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><select className={inputClass} value={result.status} onChange={e => setResult({...result, status:e.target.value})}><option value="open">Open</option><option value="win">Win</option><option value="loss">Loss</option><option value="breakeven">Breakeven</option><option value="cancelled">Cancelled</option></select><input className={inputClass} inputMode="decimal" value={result.pnl} onChange={e => setResult({...result, pnl:e.target.value})} placeholder="P/L in account currency" /><textarea className="min-h-20 rounded-md border border-white/10 bg-[#10221d] p-3 text-sm text-white sm:col-span-2" value={result.notes} onChange={e => setResult({...result, notes:e.target.value})} placeholder="Post-trade review" /></div><Button className="mt-3 bg-white/10 text-white hover:bg-white/15">Save outcome</Button></form>}</div></section></div></main>;
}
