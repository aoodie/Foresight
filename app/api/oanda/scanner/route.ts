import { NextResponse } from "next/server";
import { getOandaToken } from "@/lib/oanda-secret";
import { fetchOandaCandles } from "@/lib/oanda-api";
import {
  analyseInstrument,
  combineTimeframes,
  timeframeProfiles,
  type ScannerResult,
  type TimeframeMode,
} from "@/lib/market-scanner";

const universe = [
  { instrument: "EUR_USD", label: "EUR / USD", assetClass: "forex" as const },
  { instrument: "GBP_USD", label: "GBP / USD", assetClass: "forex" as const },
  { instrument: "USD_JPY", label: "USD / JPY", assetClass: "forex" as const },
  { instrument: "USD_CHF", label: "USD / CHF", assetClass: "forex" as const },
  { instrument: "AUD_USD", label: "AUD / USD", assetClass: "forex" as const },
  { instrument: "NZD_USD", label: "NZD / USD", assetClass: "forex" as const },
  { instrument: "USD_CAD", label: "USD / CAD", assetClass: "forex" as const },
  { instrument: "EUR_GBP", label: "EUR / GBP", assetClass: "forex" as const },
  { instrument: "EUR_JPY", label: "EUR / JPY", assetClass: "forex" as const },
  { instrument: "GBP_JPY", label: "GBP / JPY", assetClass: "forex" as const },
  { instrument: "XAU_USD", label: "XAU / USD", assetClass: "metal" as const },
  { instrument: "US30_USD", label: "US30", assetClass: "index" as const },
];

export async function GET(request: Request) {
  const connection = await getOandaToken();
  if (!connection)
    return NextResponse.json(
      {
        connected: false,
        message: "Connect OANDA before running the daily scanner.",
      },
      { status: 503 },
    );

  const requestedMode = new URL(request.url).searchParams.get("mode");
  const mode: TimeframeMode =
    requestedMode === "scalping" || requestedMode === "swing"
      ? requestedMode
      : "intraday";
  const profile = timeframeProfiles[mode];
  const results: ScannerResult[] = [];
  const unavailable: Array<{ instrument: string; label: string }> = [];

  for (let index = 0; index < universe.length; index += 3) {
    const batch = universe.slice(index, index + 3);
    const scanned = await Promise.all(
      batch.map(async (market) => {
        try {
          const frameData = await Promise.all(
            profile.frames.map(
              async (granularity) =>
                [
                  granularity,
                  await fetchOandaCandles({
                    token: connection.token,
                    environment: connection.environment,
                    instrument: market.instrument,
                    granularity,
                    count: 80,
                  }),
                ] as const,
            ),
          );
          const analyses = Object.fromEntries(
            frameData.map(([granularity, data]) => [
              granularity,
              analyseInstrument({ ...market, candles: data.candles }),
            ]),
          );
          const candles = Object.fromEntries(
            frameData.map(([granularity, data]) => [granularity, data.candles]),
          );
          return combineTimeframes({ ...market, mode, analyses, candles });
        } catch {
          unavailable.push({
            instrument: market.instrument,
            label: market.label,
          });
          return null;
        }
      }),
    );
    results.push(
      ...scanned.filter((result): result is ScannerResult => Boolean(result)),
    );
  }

  results.sort((a, b) => b.score - a.score);
  return NextResponse.json({
    connected: true,
    environment: connection.environment,
    mode,
    timeframes: profile,
    generatedAt: new Date().toISOString(),
    results,
    unavailable,
  });
}
