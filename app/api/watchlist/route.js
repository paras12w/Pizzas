import { NextResponse } from "next/server";
import { getWatchlist, saveWatchlist, getAlerts, getWeights } from "@/lib/store";
import { fetchTickerMentions } from "@/lib/reddit";
import { fetchManySnapshots } from "@/lib/yahoo";
import { scoreTicker, mergeWeights } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tickers, alerts, storedWeights] = await Promise.all([
      getWatchlist(),
      getAlerts(),
      getWeights(),
    ]);

    if (tickers.length === 0) {
      return NextResponse.json({ tickers: [], entries: [] });
    }

    const weights = mergeWeights(storedWeights);
    const [mentions, snapshots] = await Promise.all([
      Promise.all(tickers.map((t) => fetchTickerMentions(t))),
      fetchManySnapshots(tickers),
    ]);
    const snapshotByTicker = new Map(snapshots.map((s) => [s.ticker, s]));
    const alertByTicker = new Map(alerts.map((a) => [a.ticker, a]));
    const maxWeightedScore = Math.max(...mentions.map((m) => m.weightedScore || 0), 1);

    const entries = tickers.map((ticker, i) =>
      scoreTicker(
        { ticker, subs: [], cashtagMentions: 0, ...mentions[i] },
        snapshotByTicker.get(ticker),
        alertByTicker.get(ticker) || null,
        maxWeightedScore,
        weights
      )
    );

    return NextResponse.json({ tickers, entries });
  } catch (err) {
    console.error("[api/watchlist] failed:", err);
    return NextResponse.json({ error: "Failed to load watchlist", detail: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action === "remove" ? "remove" : "add";
  const ticker = (body.ticker || "").toString().trim().toUpperCase();

  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a valid ticker symbol (1-5 letters)." }, { status: 400 });
  }

  const current = await getWatchlist();
  const next = action === "remove" ? current.filter((t) => t !== ticker) : [...current, ticker];
  const saved = await saveWatchlist(next);
  return NextResponse.json({ tickers: saved });
}
