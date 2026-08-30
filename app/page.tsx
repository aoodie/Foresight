"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDot, RefreshCw, Settings2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Candle = { time: string; open: number; high: number; low: number; close: number; complete: boolean };
type MarketData = { candles: Candle[]; price: number; changePercent: number; lastUpdated: string; environment: "practice" | "live" };
type Quote = { bid: number; ask: number; mid: number; spread: number; time: string; tradeable: boolean; marketStatus: string; environment: "practice" | "live" };
type ConnectionState = "checking" | "disconnected" | "configured" | "connected" | "error";

const instruments = [
  { value: "EUR_USD", label: "EUR / USD", note: "Most liquid major" },
  { value: "GBP_USD", label: "GBP / USD", note: "London momentum" },
  { value: "USD_JPY", label: "USD / JPY", note: "Rates-sensitive major" },
  { value: "XAU_USD", label: "XAU / USD", note: "Gold versus US dollar" },
];

function priceDecimals(instrument: string) {
  if (instrument === "USD_JPY") return 3;
  if (instrument === "XAU_USD") return 2;
  return 5;
}

function pipMultiplier(instrument: string) {
  if (instrument === "USD_JPY") return 100;
  if (instrument === "XAU_USD") return 10;
  return 10000;
}

function chartPoints(candles: Candle[]) {
  if (candles.length < 2) return "";
  const values = candles.map((c) => c.close);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  return values.map((value, index) => String((index / (values.length - 1)) * 780) + "," + String(164 - ((value - min) / span) * 142)).join(" ");
}

export default function Home() {
  const [instrument, setInstrument] = useState("EUR_USD");
  const [granularity, setGranularity] = useState("H1");
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [environment, setEnvironment] = useState<"practice" | "live">("practice");
  const [token, setToken] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [data, setData] = useState<MarketData | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);

  const refreshCandles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/oanda?instrument=" + instrument + "&granularity=" + granularity, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.message || "Unable to refresh OANDA candles.");
      setData(payload);
      setEnvironment(payload.environment);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh OANDA candles.");
    } finally {
      setLoading(false);
    }
  }, [instrument, granularity]);

  const refreshQuote = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/oanda/price?instrument=" + instrument + "&t=" + Date.now(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.message || "Unable to load OANDA live pricing.");
      setQuote(payload);
      setEnvironment(payload.environment);
      setConnection("connected");
      if (!quiet) setMessage("");
    } catch (error) {
      if (!quiet) {
        setConnection("error");
        setMessage(error instanceof Error ? error.message : "Unable to load OANDA live pricing.");
      }
    }
  }, [instrument]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/oanda/connection", { cache: "no-store" });
        const payload = await response.json();
        if (!active) return;
        if (response.ok && payload.connected) {
          setEnvironment(payload.environment);
          setConnection("configured");
          await Promise.all([refreshCandles(), refreshQuote()]);
        } else {
          setConnection("disconnected");
        }
      } catch {
        if (active) setConnection("error");
      }
    })();
    return () => { active = false; };
  }, [refreshCandles, refreshQuote]);

  useEffect(() => {
    if (connection !== "connected" && connection !== "configured") return;
    const timer = window.setInterval(() => { void refreshQuote(true); }, 2000);
    return () => window.clearInterval(timer);
  }, [connection, refreshQuote]);

  const saveConnection = async () => {
    setSaving(true);
    setMessage("Validating token and live pricing with OANDA…");
    try {
      const response = await fetch("/api/oanda/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, environment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "OANDA rejected this connection.");
      setToken("");
      setMessage("");
      setSettingsOpen(false);
      setConnection("configured");
      await Promise.all([refreshCandles(), refreshQuote()]);
    } catch (error) {
      setConnection("error");
      setMessage(error instanceof Error ? error.message : "Unable to save this connection.");
    } finally {
      setSaving(false);
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
  const statusLabel = connection === "connected" ? "Live · " + environment : connection === "configured" ? "Connecting · " + environment : connection === "error" ? "Connection problem" : connection === "checking" ? "Checking OANDA" : "OANDA not connected";

  return (
    <main className="min-h-screen bg-[#07100f] text-[#e8f3ee] selection:bg-[#a4ffcf] selection:text-[#07100f]">
      <header className="mx-auto flex max-w-[1460px] items-center justify-between border-b border-white/10 px-5 py-5 lg:px-10">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#a4ffcf] text-[#07100f]"><CircleDot size={19}/></span><div><p className="text-sm font-semibold tracking-[.18em]">FORESIGHT FX</p><p className="text-[10px] tracking-[.2em] text-[#8aa29a]">RESEARCH TERMINAL</p></div></div>
        <div className="flex items-center gap-2">
          <span className={(connection === "connected" ? "border-[#59dfa9]/30 bg-[#59dfa9]/10 text-[#89f6bf]" : connection === "error" ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "border-white/10 bg-white/5 text-[#a9bdb6]") + " hidden rounded-full border px-3 py-1 text-xs sm:block"}>{statusLabel}</span>
          <Button type="button" variant="ghost" size="icon" onClick={() => { setMessage(""); setSettingsOpen(true); }} aria-label="Open OANDA connection settings" className="h-10 w-10 text-[#e8f3ee] hover:bg-white/10"><Settings2 size={20}/></Button>
        </div>
      </header>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="border-white/10 bg-[#0c1916] text-white">
          <DialogHeader><DialogTitle>Connect OANDA</DialogTitle><DialogDescription className="text-[#a9bdb6]">Your token is tested against OANDA live pricing, encrypted, and saved securely. It is never displayed again.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <label className="text-sm text-[#a9bdb6]">Account environment</label>
            <Select value={environment} onValueChange={(value) => setEnvironment(value as "practice" | "live")}><SelectTrigger className="w-full border-white/10 bg-[#10221d] text-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="practice">Practice account</SelectItem><SelectItem value="live">Live account</SelectItem></SelectContent></Select>
            <label className="mt-2 text-sm text-[#a9bdb6]">Personal access token</label>
            <input value={token} onChange={(event) => setToken(event.target.value)} type="password" autoComplete="off" placeholder="Paste your OANDA token" className="h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm outline-none focus:border-[#a4ffcf]"/>
            <Button onClick={saveConnection} disabled={!token || saving} className="mt-2 bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"><RefreshCw className={saving ? "animate-spin" : ""}/>{saving ? "Validating…" : "Validate and save"}</Button>
            {message && <p className="text-xs text-rose-300">{message}</p>}
          </div>
        </DialogContent>
      </Dialog>

      <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-10">
        <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div><p className="mb-2 text-xs font-medium tracking-[.16em] text-[#8aa29a]">OANDA MARKET DATA / LIVE RESEARCH</p><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Read the market <em className="font-serif text-[#a4ffcf]">without guessing.</em></h1></div>
          <div className="text-xs text-[#94a9a2]">{quote ? "Quote: " + new Date(quote.time).toLocaleTimeString("en-GB", { timeZone: "UTC" }) + " UTC · refreshes every 2s" : "Waiting for live OANDA pricing"}</div>
        </section>

        {message && !settingsOpen && <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200"><AlertCircle className="mt-0.5 shrink-0" size={18}/><div><p className="font-medium">OANDA connection failed</p><p className="mt-1 text-rose-200/80">{message}</p><button onClick={() => setSettingsOpen(true)} className="mt-2 underline underline-offset-4">Check connection settings</button></div></div>}

        <section className="grid gap-4 xl:grid-cols-[1.65fr_.95fr]">
          <div className="rounded-2xl border border-white/10 bg-[#0c1916] p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs tracking-[.14em] text-[#8aa29a]">ACTIVE STUDY</p><h2 className="mt-1 text-xl font-medium">{instrument.replace("_", " / ")} <span className="text-sm font-normal text-[#8aa29a]">— live quote + midpoint candles</span></h2></div>
              <div className="flex gap-2"><Select value={instrument} onValueChange={(value) => { setQuote(null); setInstrument(value); }}><SelectTrigger className="border-white/10 bg-[#10221d] text-white"><SelectValue/></SelectTrigger><SelectContent>{instruments.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={granularity} onValueChange={setGranularity}><SelectTrigger className="w-20 border-white/10 bg-[#10221d] text-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="M15">M15</SelectItem><SelectItem value="H1">H1</SelectItem><SelectItem value="H4">H4</SelectItem></SelectContent></Select></div>
            </div>

            <div className="relative h-[300px] overflow-hidden rounded-xl border border-white/5 bg-[linear-gradient(180deg,rgba(164,255,207,.07),transparent_55%)] p-5">
              <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.07)_1px,transparent_1px)] [background-size:100%_25%,16.6%_100%]"/>
              <div className="relative flex items-start justify-between"><div><span className="text-3xl font-semibold">{displayPrice !== undefined ? displayPrice.toFixed(decimals) : "—"}</span>{data && <span className={(positive ? "text-[#59dfa9]" : "text-rose-400") + " ml-3 text-sm"}>{positive ? "+" : ""}{data.changePercent.toFixed(2)}%</span>}</div>{quote && <span className={(quote.tradeable ? "bg-[#59dfa9]/10 text-[#89f6bf]" : "bg-amber-400/10 text-amber-300") + " flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"}><Wifi size={13}/>{quote.tradeable ? "Live OANDA quote" : "Market closed"}</span>}</div>
              {points ? <svg className="absolute bottom-7 left-3 h-[180px] w-[calc(100%-24px)]" viewBox="0 0 780 180" preserveAspectRatio="none" aria-label="OANDA midpoint candle closing-price chart"><polyline points={points} fill="none" stroke={positive ? "#a4ffcf" : "#fb7185"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg> : <div className="absolute inset-0 grid place-items-center pt-12 text-sm text-[#71887f]">Connect OANDA to load market data</div>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Bid" value={quote ? quote.bid.toFixed(decimals) : "—"}/><Metric label="Ask" value={quote ? quote.ask.toFixed(decimals) : "—"}/><Metric label="Spread" value={spreadPips !== null ? spreadPips.toFixed(1) + " pips" : "—"}/><Metric label="Live midpoint" value={displayPrice !== undefined ? displayPrice.toFixed(decimals) : "—"} tone="mint"/></div>
            <div className="mt-3 grid grid-cols-2 gap-3"><Metric label="24-candle low" value={low?.toFixed(decimals) ?? "—"}/><Metric label="24-candle high" value={high?.toFixed(decimals) ?? "—"}/></div>
          </div>

          <aside className="rounded-2xl border border-white/10 bg-[#0c1916] p-5">
            <div className="flex items-center justify-between"><div><p className="text-xs tracking-[.14em] text-[#8aa29a]">DATA CONNECTION</p><h2 className="mt-1 text-lg">OANDA pricing</h2></div>{connection === "connected" ? <CheckCircle2 className="text-[#59dfa9]" size={22}/> : <AlertCircle className={connection === "error" ? "text-rose-400" : "text-[#8aa29a]"} size={22}/>}</div>
            <p className="mt-5 text-sm leading-6 text-[#a9bdb6]">Current bid and ask come from your OANDA account pricing endpoint. The chart uses OANDA midpoint candles.</p>
            <div className="my-5 border-t border-white/10"/>
            <div className="space-y-4 text-sm"><Row label="Status" value={statusLabel}/><Row label="Market" value={quote?.marketStatus ?? "—"}/><Row label="Instrument" value={instrument.replace("_", " / ")}/><Row label="Environment" value={environment}/><Row label="Update rate" value="2 seconds"/></div>
            <Button onClick={() => { void Promise.all([refreshCandles(), refreshQuote()]); }} disabled={loading || connection === "disconnected" || connection === "checking"} className="mt-7 w-full bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"><RefreshCw className={loading ? "animate-spin" : ""}/>{loading ? "Refreshing…" : "Refresh now"}</Button>
            {(connection === "disconnected" || connection === "error") && <Button variant="ghost" onClick={() => { setMessage(""); setSettingsOpen(true); }} className="mt-2 w-full text-[#a4ffcf]">Open connection settings</Button>}
          </aside>
        </section>

        <section className="mt-5 rounded-2xl border border-white/10 bg-[#0c1916] p-5"><p className="text-xs tracking-[.14em] text-[#8aa29a]">RESEARCH QUEUE</p><h2 className="mt-1 text-lg">Core markets</h2><div className="mt-4 grid gap-x-8 md:grid-cols-2">{instruments.map((item) => <button key={item.value} onClick={() => { setQuote(null); setInstrument(item.value); }} className="flex items-center justify-between border-b border-white/8 py-3 text-left"><div><p className="font-medium">{item.label}</p><p className="mt-0.5 text-xs text-[#81978f]">{item.note}</p></div><span className={instrument === item.value ? "text-xs text-[#89f6bf]" : "text-xs text-[#71887f]"}>{instrument === item.value ? "Selected" : "Open study"}</span></button>)}</div></section>
        <p className="mt-6 text-xs leading-5 text-[#71887f]">For research and education only. This interface does not execute trades or provide investment advice.</p>
      </div>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "mint" }) { return <div className="rounded-lg bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-[#71887f]">{label}</p><p className={(tone === "mint" ? "text-[#89f6bf]" : "text-white") + " mt-1 text-sm font-medium"}>{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-[#8aa29a]">{label}</span><span className="text-right capitalize">{value}</span></div>; }
