import { NextResponse } from "next/server";
import { discoverTrendingTickers, fetchTickerMentions } from "@/lib/reddit";
import { fetchManySnapshots } from "@/lib/yahoo";
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

    // Take the top ~20 reddit candidates by weighted mentions, then make sure
    // every ticker with a live Discord alert is included even if Reddit hasn't
    // picked it up yet.
    const topReddit = redditCandidates.slice(0, 20);
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

    const candidates = [...topReddit, ...backfilled];
    const maxWeightedScore = Math.max(...candidates.map((c) => c.weightedScore || 0), 1);

    const snapshots = await fetchManySnapshots(candidates.map((c) => c.ticker));
    const snapshotByTicker = new Map(snapshots.map((s) => [s.ticker, s]));
    const alertByTicker = new Map(alerts.map((a) => [a.ticker, a]));

    const scored = candidates
      .map((c) =>
        scoreTicker(
          c,
          snapshotByTicker.get(c.ticker),
          alertByTicker.get(c.ticker) || null,
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
