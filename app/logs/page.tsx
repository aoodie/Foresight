"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type SystemLog = Record<string, string | number | null> & { id: string; created_at: string; level: string; category: string; event: string; message: string };

export default function LogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "300" });
    if (level !== "all") params.set("level", level);
    if (category !== "all") params.set("category", category);
    const response = await fetch("/api/logs?" + params, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load system logs.");
    setLogs(Array.isArray(payload.logs) ? payload.logs : []);
  }, [category, level]);
  useEffect(() => { const first = window.setTimeout(() => void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load system logs.")), 0); const timer = window.setInterval(() => void load().catch(() => undefined), 5000); return () => { window.clearTimeout(first); window.clearInterval(timer); }; }, [load]);
  return <main className="min-h-screen bg-[#07100f] text-[#e8f3ee]"><header className="mx-auto flex max-w-[1460px] flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 lg:px-10"><Link href="/" className="text-sm font-semibold tracking-[.18em]">FORESIGHT FX <span className="text-[#89f6bf]">/ SYSTEM LOGS</span></Link><nav className="flex flex-wrap gap-2 text-xs"><Link href="/" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Overview</Link><Link href="/open-trades" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Open trades</Link><Link href="/markets" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Markets</Link><Link href="/journal" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">Journal</Link><Link href="/research" className="rounded-md px-3 py-2 text-[#a9bdb6] hover:bg-white/5">News & events</Link></nav></header><div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs tracking-[.16em] text-[#8aa29a]">READ-ONLY OPERATIONAL HISTORY</p><h1 className="mt-2 text-3xl font-medium">System logs</h1><p className="mt-2 text-sm text-[#a9bdb6]">Scanner runs, AI analysis, order requests, broker submissions, monitoring reviews and failures.</p></div><Button variant="ghost" onClick={() => void load()} className="text-[#a4ffcf]"><RefreshCw size={16} /> Refresh</Button></div>{message && <p className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/[.06] p-3 text-sm text-rose-200">{message}</p>}<div className="mt-6 flex flex-wrap gap-3"><select className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm text-white" value={level} onChange={e => setLevel(e.target.value)}><option value="all">All levels</option><option value="info">Info</option><option value="warning">Warnings</option><option value="error">Errors</option></select><select className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm text-white" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option><option value="scanner">Scanner</option><option value="ai">AI</option><option value="execution">Execution</option><option value="monitor">Monitor</option></select><span className="self-center text-xs text-[#71887f]">{logs.length} records · refreshes every 5 seconds</span></div><section className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0c1916]"><div className="divide-y divide-white/[.06]">{logs.length ? logs.map(log => <article key={log.id} className="grid gap-2 p-4 lg:grid-cols-[150px_90px_120px_1fr]"><time className="text-xs text-[#71887f]">{new Date(log.created_at).toLocaleString("en-GB")}</time><span className={(log.level === "error" ? "text-rose-300" : log.level === "warning" ? "text-amber-200" : "text-[#89f6bf]") + " text-xs font-semibold uppercase"}>{log.level}</span><span className="text-xs text-[#a9bdb6]">{log.category}<br /><span className="text-[#71887f]">{log.event}</span></span><div><p className="text-sm text-white">{log.message}</p>{log.instrument && <p className="mt-1 text-xs text-[#71887f]">{log.instrument}{log.environment ? ` · ${log.environment}` : ""}{log.duration_ms ? ` · ${log.duration_ms}ms` : ""}</p>}</div></article>) : <p className="p-8 text-sm text-[#71887f]">No system logs yet. Activity will appear after the scanner, AI analysis or an order is used.</p>}</div></section></div></main>;
}
