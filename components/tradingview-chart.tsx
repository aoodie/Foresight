"use client";

import { useEffect, useRef } from "react";

const symbols: Record<string, string> = {
  EUR_USD: "OANDA:EURUSD",
  GBP_USD: "OANDA:GBPUSD",
  USD_JPY: "OANDA:USDJPY",
  XAU_USD: "OANDA:XAUUSD",
};

const intervals: Record<string, string> = {
  M15: "15",
  H1: "60",
  H4: "240",
};

export function TradingViewChart({ instrument, granularity }: { instrument: string; granularity: string }) {
  const container = useRef<HTMLDivElement>(null);
  const symbol = symbols[instrument] ?? symbols.EUR_USD;

  useEffect(() => {
    const current = container.current;
    if (!current) return;
    current.replaceChildren();

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
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
      studies: ["STD;EMA", "STD;RSI"],
      support_host: "https://www.tradingview.com",
    });

    current.append(widget, script);
    return () => current.replaceChildren();
  }, [symbol, granularity]);

  return (
    <div className="h-[560px] overflow-hidden rounded-xl border border-white/5 bg-[#0c1916]">
      <div ref={container} className="tradingview-widget-container h-full w-full" />
    </div>
  );
}
