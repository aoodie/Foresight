"use client";
import Link from "next/link";
import { useState } from "react";
import { evaluateLearning, type LearningReport } from "@/lib/learning";
import "./learning.css";

export default function LearningPage() {
  const [report, setReport] = useState<LearningReport | null>(null);
  const [cost, setCost] = useState("2");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [instrument, setInstrument] = useState("EUR_USD");
  const [provenance, setProvenance] = useState({ source: "", fingerprint: "" });
  async function evaluate(candles: Parameters<typeof evaluateLearning>[0]["candles"], source: string) {
    const result = evaluateLearning({ candles, roundTripCostBps: Number(cost) });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(candles)));
    setProvenance({ source, fingerprint: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("") });
    setReport(result);
  }
  async function loadHistory() {
    setBusy(true); setError(""); setReport(null);
    try {
      const response = await fetch(`/api/learning/candles?instrument=${instrument}`, { signal: AbortSignal.timeout(60000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Historical candles are unavailable.");
      await evaluate(data.candles, `${data.instrument} / ${data.source}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load history."); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setReport(null);
    try {
      if (file.size > 8_000_000) throw new Error("Keep the candle file below 8 MB.");
      const data = JSON.parse(await file.text());
      await evaluate(Array.isArray(data) ? data : data.candles, `Imported file: ${file.name} (source unverified)`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not evaluate this file."); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...report, provenance }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "foresight-learning-report.json"; a.click(); URL.revokeObjectURL(url);
  }
  return <main className="learning">
    <nav aria-label="Main navigation"><Link href="/">Foresight FX</Link><Link href="/markets">Markets</Link><Link href="/research">Research</Link><Link href="/learning" aria-current="page">Learning lab</Link></nav>
    <header><span className="learning-kicker">RESEARCH / MODEL VALIDATION</span><h1>Learn from the past.<br />Earn the next test.</h1><p>A bounded momentum learner selects from four lookback windows using past data, then evaluates on later candles. Every result stays in research until independently reviewed.</p></header>
    <section className="learning-input" aria-label="Dataset and costs"><div><h2>Start with completed candles</h2><p>Import 1,500–20,000 chronological OHLC candles for one instrument and timeframe. Files are processed in your browser.</p><details><summary>JSON format and assumptions</summary><pre>{JSON.stringify([{ time: "2026-01-01T00:00:00Z", open: 1.1, high: 1.102, low: 1.099, close: 1.101, complete: true }], null, 2)}</pre><p>Use consistent, unsmoothed bars. Signals use the previous close; fills use the next open and close. Enter estimated spread, slippage, commissions and financing in the total cost. Midpoint fills and constant costs are approximations. Irregular sessions, financing and currency conversion are not independently simulated.</p></details></div><div className="learning-controls"><label>Instrument<select disabled={busy} value={instrument} onChange={(e) => { setInstrument(e.target.value); setReport(null); }}>{["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY"].map((value) => <option key={value}>{value}</option>)}</select></label><button disabled={busy} onClick={() => void loadHistory()}>{busy ? "Evaluating…" : "Load OANDA history and evaluate"}</button><label>Estimated round-trip cost (basis points)<input disabled={busy} type="number" min="0.01" max="100" step="0.1" value={cost} onChange={(e) => { setCost(e.target.value); setReport(null); }} /></label><label className="learning-upload">{busy ? "Evaluating…" : "Import candles and evaluate"}<input aria-label="Import candle JSON" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label><small>1 basis point = 0.01% of price. No orders are placed.</small></div></section>
    {error && <p role="alert" className="learning-error">{error}</p>}
    <section aria-label="Evaluation timeline"><h2>A chronological test, with room between samples</h2><div className="learning-timeline"><span>40% initial training</span><span>40% forward validation</span><span>20% final holdout</span></div><p>Four forward folds · 50-bar separation · four fixed candidates · double-cost stress test</p></section>
    {report ? <section aria-live="polite"><div className="learning-result-head"><div><span className="learning-kicker">{report.status === "paper_candidate" ? "READY FOR PAPER REVIEW" : "CANDIDATE REJECTED"}</span><h2>{report.selectedLookback}-bar momentum</h2><p>{provenance.source}<br />{report.bars.toLocaleString()} candles · holdout starts {report.holdoutStart.slice(0, 10)}</p></div><button onClick={download}>Export report</button></div><div className="learning-metrics">{[["Holdout net", report.holdout.netBps], ["Double-cost net", report.stressed.netBps], ["Holdout drawdown", report.holdout.maxDrawdownBps], ["Fixed benchmark net", report.benchmark.netBps]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{Number(value).toFixed(1)} <small>bps</small></strong></article>)}</div><ul className="learning-checks">{report.checks.map((check) => <li key={check.label}><b>{check.pass ? "PASS" : "FAIL"}</b>{check.label}</li>)}</ul><div className="learning-table"><table><caption>Forward validation: models selected before each test window</caption><thead><tr><th>Test start</th><th>Lookback</th><th>Trades</th><th>Net bps</th></tr></thead><tbody>{report.folds.map((fold) => <tr key={fold.testStart}><td>{fold.testStart.slice(0, 10)}</td><td>{fold.lookback}</td><td>{fold.metrics.trades}</td><td>{fold.metrics.netBps.toFixed(1)}</td></tr>)}</tbody></table></div></section> : <section className="learning-empty"><h2>No candidate has earned a result yet.</h2><p>Import real data to see forward performance, stress results and rejection reasons.</p></section>}
    <footer>Research only. Repeatedly inspecting the same holdout makes it part of training. Reserve new future data for subsequent decisions. The conservative mean estimate assumes independent returns and is not a guarantee against overfitting. A passing result permits paper review only; live execution is never enabled here.</footer>
  </main>;
}
