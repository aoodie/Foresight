"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Candle = { time: string; open: number; high: number; low: number; close: number; complete: boolean };
type ChartMarker = { time: string; price: number; kind: "entry" | "close"; label: string; color: string };
type SeriesApi = { setData(data: Array<Record<string, number>>): void; setMarkers(markers: Array<Record<string, unknown>>): void; createPriceLine(options: Record<string, unknown>): void };
type VisibleRange = { from: number; to: number };
type TimeScaleApi = {
  fitContent(): void;
  getVisibleRange(): VisibleRange | null;
  setVisibleRange(range: VisibleRange): void;
  subscribeVisibleTimeRangeChange(handler: (range: VisibleRange | null) => void): void;
  unsubscribeVisibleTimeRangeChange(handler: (range: VisibleRange | null) => void): void;
};
type ChartApi = {
  addCandlestickSeries(options: Record<string, unknown>): SeriesApi;
  applyOptions(options: Record<string, unknown>): void;
  timeScale(): TimeScaleApi;
  subscribeCrosshairMove(handler: (param: { time?: number }) => void): void;
  unsubscribeCrosshairMove(handler: (param: { time?: number }) => void): void;
  remove(): void;
};
type TradingViewLibrary = { createChart(container: HTMLElement, options: Record<string, unknown>): ChartApi };

declare global { interface Window { LightweightCharts?: TradingViewLibrary } }

let libraryPromise: Promise<TradingViewLibrary> | null = null;

function loadTradingViewLibrary() {
  if (typeof window === "undefined") return Promise.reject(new Error("Chart is only available in a browser."));
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-foresight-tv]");
    if (existing) {
      existing.addEventListener("load", () => window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error("TradingView chart library did not load.")), { once: true });
      existing.addEventListener("error", () => reject(new Error("TradingView chart library could not load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.dataset.foresightTv = "true";
    script.src = "https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js";
    script.async = true;
    script.onload = () => window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error("TradingView chart library did not load."));
    script.onerror = () => reject(new Error("TradingView chart library could not load."));
    document.head.appendChild(script);
  });
  return libraryPromise;
}

function unixTime(value: string) { return Math.floor(new Date(value).getTime() / 1000); }
function decimalsFor(instrument: string) {
  if (instrument.endsWith("JPY")) return 3;
  if (instrument === "XAU_USD") return 3;
  if (instrument === "US30_USD") return 1;
  return 5;
}

function viewportKey(instrument: string, granularity: string) {
  return `foresight:chart-viewport:${instrument}:${granularity}`;
}

function formatChartTime(unix?: number) {
  if (!unix) return "Move cursor over a candle";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(unix * 1000)) + " UTC";
}

export function TradingViewChart({ instrument, granularity, candles, levels, markers, tradeSummary }: {
  instrument: string;
  granularity: string;
  candles?: Candle[];
  levels?: { entry?: number | null; stopLoss?: number | null; takeProfit1?: number | null; takeProfit2?: number | null };
  markers?: ChartMarker[];
  tradeSummary?: { status: string; closeReason?: string | null; closeNotes?: string | null };
}) {
  const container = useRef<HTMLDivElement>(null);
  const [cursorTime, setCursorTime] = useState<number>();
  const decimals = decimalsFor(instrument);
  const chartLevels = useMemo(() => [
    { price: levels?.entry ?? NaN, color: "#a4ffcf", title: "ENTRY" },
    { price: levels?.stopLoss ?? NaN, color: "#fb7185", title: "SL" },
    { price: levels?.takeProfit1 ?? NaN, color: "#7dd3fc", title: "TP1" },
    { price: levels?.takeProfit2 ?? NaN, color: "#c4b5fd", title: "TP2" },
  ].filter((line) => Number.isFinite(line.price)), [levels?.entry, levels?.stopLoss, levels?.takeProfit1, levels?.takeProfit2]);
  const chartMarkers = useMemo(() => markers?.filter((marker) => Number.isFinite(marker.price) && Number.isFinite(unixTime(marker.time))) ?? [], [markers]);

  useEffect(() => {
    const host = container.current;
    if (!host || !candles?.length) return;
    let chart: ChartApi | null = null;
    let cancelled = false;
    void loadTradingViewLibrary().then((library) => {
      if (cancelled || !host) return;
      host.replaceChildren();
      chart = library.createChart(host, {
        width: host.clientWidth,
        height: 560,
        layout: { background: { color: "#0c1916" }, textColor: "#9eb3a9" },
        grid: { vertLines: { color: "rgba(255,255,255,.045)" }, horzLines: { color: "rgba(255,255,255,.045)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,.12)" },
        timeScale: { borderColor: "rgba(255,255,255,.12)", timeVisible: true, secondsVisible: false },
        crosshair: { mode: 0 },
      });
      const series = chart.addCandlestickSeries({
        upColor: "#a4ffcf", downColor: "#fb7185", borderVisible: false,
        wickUpColor: "#a4ffcf", wickDownColor: "#fb7185",
        priceFormat: { type: "price", precision: decimals, minMove: 1 / (10 ** decimals) },
      });
      series.setData(candles.filter((c) => c.complete || c === candles.at(-1)).map((c) => ({ time: unixTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      const firstCandle = unixTime(candles[0].time);
      const lastCandle = unixTime(candles.at(-1)!.time);
      series.setMarkers(chartMarkers.filter((marker) => {
        const time = unixTime(marker.time);
        return time >= firstCandle && time <= lastCandle;
      }).map((marker) => ({
        time: unixTime(marker.time), position: marker.kind === "entry" ? "belowBar" : "aboveBar",
        color: marker.color, shape: marker.kind === "entry" ? (marker.label === "SHORT ENTRY" ? "arrowDown" : "arrowUp") : "circle", text: marker.label,
      })));
      chartLevels.forEach((line) => series.createPriceLine({ price: line.price, color: line.color, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: line.title }));
      const timeScale = chart.timeScale();
      const savedViewport = window.localStorage.getItem(viewportKey(instrument, granularity));
      let restoredViewport = false;
      if (savedViewport) {
        try {
          const parsed = JSON.parse(savedViewport) as VisibleRange;
          if (Number.isFinite(parsed.from) && Number.isFinite(parsed.to) && parsed.from < parsed.to) {
            timeScale.setVisibleRange(parsed);
            restoredViewport = true;
          }
        } catch { window.localStorage.removeItem(viewportKey(instrument, granularity)); }
      }
      if (!restoredViewport) timeScale.fitContent();
      const saveViewport = (range: VisibleRange | null) => {
        if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
          window.localStorage.setItem(viewportKey(instrument, granularity), JSON.stringify(range));
        }
      };
      // Lightweight Charts does not always emit its range callback until the
      // gesture has fully settled. Save directly at the end of every pan/zoom
      // as well, and once more before a live-data re-render removes the chart.
      const persistViewport = () => saveViewport(timeScale.getVisibleRange());
      const updateCursorTime = (param: { time?: number }) => setCursorTime(param.time);
      timeScale.subscribeVisibleTimeRangeChange(saveViewport);
      chart.subscribeCrosshairMove(updateCursorTime);
      host.addEventListener("pointerup", persistViewport);
      host.addEventListener("touchend", persistViewport);
      const resize = new ResizeObserver(() => chart?.applyOptions({ width: host.clientWidth }));
      resize.observe(host);
      (host as HTMLDivElement & { __foresightResize?: ResizeObserver; __foresightCleanup?: () => void }).__foresightResize = resize;
      (host as HTMLDivElement & { __foresightCleanup?: () => void }).__foresightCleanup = () => {
        persistViewport();
        host.removeEventListener("pointerup", persistViewport);
        host.removeEventListener("touchend", persistViewport);
        timeScale.unsubscribeVisibleTimeRangeChange(saveViewport);
        chart?.unsubscribeCrosshairMove(updateCursorTime);
      };
    }).catch(() => {
      if (!cancelled && host) host.innerHTML = "<div class=\"grid h-full place-items-center text-sm text-[#71887f]\">TradingView chart could not load. Refresh to try again.</div>";
    });
    return () => {
      cancelled = true;
      const resize = (host as HTMLDivElement & { __foresightResize?: ResizeObserver }).__foresightResize;
      resize?.disconnect();
      (host as HTMLDivElement & { __foresightCleanup?: () => void }).__foresightCleanup?.();
      chart?.remove();
      host.replaceChildren();
    };
  }, [candles, chartLevels, chartMarkers, decimals, granularity, instrument]);

  const format = (value?: number | null) => value == null ? "—" : value.toFixed(decimals);
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#0c1916]">
      {levels && <div className="flex flex-wrap gap-2 border-b border-white/10 px-3 py-2 text-[11px]">
        <span className="rounded bg-[#a4ffcf]/10 px-2 py-1 text-[#89f6bf]">Entry {format(levels.entry)}</span>
        <span className="rounded bg-rose-400/10 px-2 py-1 text-rose-200">SL {format(levels.stopLoss)}</span>
        <span className="rounded bg-sky-400/10 px-2 py-1 text-sky-200">TP1 {format(levels.takeProfit1)}</span>
        <span className="rounded bg-violet-400/10 px-2 py-1 text-violet-200">TP2 {format(levels.takeProfit2)}</span>
        {tradeSummary && <span className="rounded bg-white/5 px-2 py-1 text-[#d9e8e1]">{tradeSummary.status}</span>}
        <span className="ml-auto text-[#71887f]">Live levels · TradingView Lightweight Charts</span>
      </div>}
      <div className="flex items-center justify-between border-b border-white/[.06] bg-white/[.015] px-3 py-1.5 text-[10px] text-[#8fa59b]">
        <span>Chart time</span><span className="font-mono text-[#c7d2cc]">{formatChartTime(cursorTime)}</span>
      </div>
      {tradeSummary?.closeReason && <div className="border-b border-white/10 bg-white/[.025] px-3 py-2 text-[11px] text-[#c7d2cc]">Close reason: <strong className="text-white">{tradeSummary.closeReason}</strong>{tradeSummary.closeNotes ? <span className="ml-2 text-[#8fa59b]">{tradeSummary.closeNotes}</span> : null}</div>}
      <div ref={container} className="h-[560px] w-full" />
      {!candles?.length && <div className="grid h-[560px] place-items-center text-sm text-[#71887f]">Connect OANDA to load the chart.</div>}
    </div>
  );
}
