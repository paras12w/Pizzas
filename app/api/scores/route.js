import { NextResponse } from "next/server";
import { discoverTrendingTickers, fetchTickerMentions } from "@/lib/reddit";
import { fetchManySnapshots, fetchMarketMovers } from "@/lib/yahoo";
import { scoreTicker, rankTop9 } from "@/lib/scoring";
import { getAlerts, isPersistent } from "@/lib/store";
import { runBot } from "@/lib/bot";

export const dynamic = "force-dynamic"; // never statically cache this route

export async function GET() {
  try {
    const [redditCandidates, alerts] = await Promise.all([
      discoverTrendingTickers(),
      getAlerts(),
    ]);

    // Take the top ~15 reddit candidates by weighted mentions, then make sure
    // every ticker with a live Discord alert is included even if Reddit hasn't
    // picked it up yet. Kept modest (rather than 20+) because the client now
    // polls every 15s — each candidate costs 2 Yahoo requests (quote +
    // options), and a smaller, tighter pool keeps that well under Yahoo's
    // informal rate limits.
    const topReddit = redditCandidates.slice(0, 15);
    const redditTickerSet = new Set(topReddit.map((r) => r.ticker));

    const alertOnlyTickers = alerts
      .map((a) => a.ticker)
      .filter((t) => !redditTickerSet.has(t));

    // Backfill reddit signal for alert-only tickers so they aren't scored at zero.
    const backfilled = await Promise.all(
      alertOnlyTickers.map(async (ticker) => {
        const mentions = await fetchTickerMentions(ticker);
        return { ticker, subs: [], cashtagMentions: 0, ...mentions };
      })
    );

    const redditEntryByTicker = new Map(
      [...topReddit, ...backfilled].map((c) => [c.ticker, c])
    );

    // Reddit's public JSON endpoints frequently block cloud/serverless IPs
    // outright (Vercel included), independent of User-Agent, which can leave
    // redditEntryByTicker empty on a given deploy. When that happens, backfill
    // with Yahoo's own live movers so the board is never empty just because
    // Reddit refused this request.
    let allTickers = [...redditEntryByTicker.keys()];
    if (allTickers.length < 9) {
      const movers = await fetchMarketMovers(15);
      const existing = new Set(allTickers);
      for (const ticker of movers) {
        if (!existing.has(ticker)) {
          existing.add(ticker);
          allTickers.push(ticker);
        }
      }
    }
    allTickers = allTickers.slice(0, 20);

    const maxWeightedScore = Math.max(
      ...[...redditEntryByTicker.values()].map((c) => c.weightedScore || 0),
      1
    );

    const snapshots = await fetchManySnapshots(allTickers);
    const snapshotByTicker = new Map(snapshots.map((s) => [s.ticker, s]));
    const alertByTicker = new Map(alerts.map((a) => [a.ticker, a]));

    const scored = allTickers
      .map((ticker) =>
        scoreTicker(
          redditEntryByTicker.get(ticker) || null,
          snapshotByTicker.get(ticker),
          alertByTicker.get(ticker) || null,
          maxWeightedScore
        )
      )
      // Drop tickers Yahoo couldn't resolve at all — usually not real symbols
      // picked up from noisy reddit text.
      .filter((s) => s.sources.yahoo || s.sources.discord);

    const top9 = rankTop9(scored);
    const bot = await runBot(scored);

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      persistent: isPersistent(),
      board: top9,
      bot,
    });
  } catch (err) {
    console.error("[api/scores] failed:", err);
    return NextResponse.json(
      { error: "Failed to compute scoreboard", detail: err.message },
      { status: 500 }
    );
  }
}
