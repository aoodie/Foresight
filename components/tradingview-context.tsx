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

function Widget({ source, config, label }: { source: string; config: Record<string, unknown>; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const configKey = JSON.stringify(config);

  useEffect(() => {
    const current = container.current;
    if (!current) return;
    current.replaceChildren();
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    const script = document.createElement("script");
    script.src = source;
    script.type = "text/javascript";
    script.async = true;
    script.text = configKey;
    current.append(widget, script);
    return () => current.replaceChildren();
  }, [source, configKey]);

  return <div ref={container} style={{ height: "720px", minHeight: "560px" }} className="tradingview-widget-container h-[720px] min-h-[560px] w-full bg-[#0c1916]" aria-label={label}/>;
}

export function EconomicCalendar() {
  return <Widget source="https://s3.tradingview.com/external-embedding/embed-widget-events.js" label="Economic calendar for scanner currencies" config={{ colorTheme: "dark", isTransparent: true, width: "100%", height: "100%", locale: "en", importanceFilter: "0,1", countryFilter: "us,eu,gb,jp,ch,ca,au,nz" }}/>;
}

export function PairNews({ instrument }: { instrument: string }) {
  return <Widget source="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" label="Market news for selected instrument" config={{ feedMode: "symbol", symbol: symbols[instrument] ?? symbols.EUR_USD, isTransparent: true, displayMode: "regular", width: "100%", height: "100%", colorTheme: "dark", locale: "en" }}/>;
}
