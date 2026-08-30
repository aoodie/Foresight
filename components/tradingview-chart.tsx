"use client";

import { useEffect, useRef } from "react";

const symbols: Record<string, string> = {
  EUR_USD: "OANDA:EURUSD",
  GBP_USD: "OANDA:GBPUSD",
  USD_JPY: "OANDA:USDJPY",
  USD_CHF: "OANDA:USDCHF",
  AUD_USD: "OANDA:AUDUSD",
  NZD_USD: "OANDA:NZDUSD",
  USD_CAD: "OANDA:USDCAD",
  EUR_GBP: "OANDA:EURGBP",
  EUR_JPY: "OANDA:EURJPY",
  GBP_JPY: "OANDA:GBPJPY",
  XAU_USD: "OANDA:XAUUSD",
  US30_USD: "OANDA:US30USD",
};

const intervals: Record<string, string> = {
  M5: "5",
  M15: "15",
  H1: "60",
  H4: "240",
};

export function TradingViewChart({
  instrument,
  granularity,
  levels,
}: {
  instrument: string;
  granularity: string;
  levels?: {
    entry?: number | null;
    stopLoss?: number | null;
    takeProfit1?: number | null;
    takeProfit2?: number | null;
  };
}) {
  const container = useRef<HTMLDivElement>(null);
  const symbol = symbols[instrument] ?? symbols.EUR_USD;

  useEffect(() => {
    const current = container.current;
    if (!current) return;
    current.replaceChildren();

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: intervals[granularity] ?? "60",
      timezone: "Etc/UTC",
      theme: "dark",
      backgroundColor: "rgba(12, 25, 22, 1)",
      gridColor: "rgba(255, 255, 255, 0.06)",
      style: "1",
      locale: "en",
      allow_symbol_change: true,
      calendar: false,
      details: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      save_image: false,
      studies: ["STD;EMA", "STD;RSI", "VWAP@tv-basicstudies"],
      support_host: "https://www.tradingview.com",
    });

    current.append(widget, script);
    return () => current.replaceChildren();
  }, [symbol, granularity]);

  const decimals = instrument.endsWith("JPY")
    ? 3
    : instrument === "XAU_USD"
      ? 2
      : instrument === "US30_USD"
        ? 1
        : 5;
  const format = (value?: number | null) =>
    value == null ? "—" : value.toFixed(decimals);
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#0c1916]">
      {levels && (
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-3 py-2 text-[11px]">
          <span className="rounded bg-[#a4ffcf]/10 px-2 py-1 text-[#89f6bf]">
            Entry {format(levels.entry)}
          </span>
          <span className="rounded bg-rose-400/10 px-2 py-1 text-rose-200">
            SL {format(levels.stopLoss)}
          </span>
          <span className="rounded bg-sky-400/10 px-2 py-1 text-sky-200">
            TP1 {format(levels.takeProfit1)}
          </span>
          <span className="rounded bg-violet-400/10 px-2 py-1 text-violet-200">
            TP2 {format(levels.takeProfit2)}
          </span>
          <span className="ml-auto text-[#71887f]">
            Plan levels · refresh with selected analysis
          </span>
        </div>
      )}
      <div className="h-[560px]">
        <div
          ref={container}
          className="tradingview-widget-container h-full w-full"
        />
      </div>
    </div>
  );
}
