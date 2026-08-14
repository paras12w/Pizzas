import { NextRequest, NextResponse } from "next/server";
import { scanForVolumeSpikes, getAnalystSignal } from "@/lib/yahoo";
import { scoreYahooSignal, TRADE_THRESHOLD } from "@/lib/credibility";
import { addAlert } from "@/lib/store";
import { Alert } from "@/lib/types";

// Watchlist to scan. Point this at whatever universe you care about -
// could later be sourced from tickers mentioned in recent Discord/Reddit
// alerts instead of a fixed list.
const DEFAULT_WATCHLIST = ["AAPL", "TSLA", "NVDA", "AMD", "SOFI", "PLTR", "SPY", "QQQ"];

export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get("tickers");
  const tickers = tickersParam ? tickersParam.split(",").map((t) => t.trim().toUpperCase()) : DEFAULT_WATCHLIST;

  const spikes = await scanForVolumeSpikes(tickers);
  const results = [];

  for (const spike of spikes) {
    const analyst = await getAnalystSignal(spike.ticker);
    const { score, breakdown } = scoreYahooSignal({
      volumeRatio: spike.volumeRatio,
      analystUpgrade: analyst.analystUpgrade,
    });

    results.push({ ...spike, ...analyst, credibilityScore: score, breakdown });

    if (score >= 0.4) {
      // Log everything above a low noise floor as an alert, even if it
      // won't clear the trade threshold - useful for the dashboard feed.
      const alert: Alert = {
        id: crypto.randomUUID(),
        source: "yahoo",
        sourceLabel: "yahoo-scan",
        ticker: spike.ticker,
        direction: "long",
        entryPriceHint: spike.price,
        note: `Volume ${spike.volumeRatio.toFixed(2)}x avg${analyst.analystUpgrade ? ", analyst buy-leaning" : ""}`,
        createdAt: new Date().toISOString(),
        credibilityScore: score,
        breakdown,
      };
      await addAlert(alert);
    }
  }

  return NextResponse.json({ results, threshold: TRADE_THRESHOLD });
}
