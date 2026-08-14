import { NextResponse } from "next/server";
import { discoverTrendingTickers, fetchTickerMentions } from "@/lib/reddit";
import { fetchManySnapshots, fetchMarketMovers } from "@/lib/yahoo";
import { scoreTicker, rankTop9, mergeWeights } from "@/lib/scoring";
import { getAlerts, isPersistent, getWeights, saveWeights, getWeightHistory, appendWeightHistory, getPrevScores, savePrevScores } from "@/lib/store";
import { runBot, BOT_CONFIGS } from "@/lib/bot";
import { shouldRecalibrate, recalibrateWeights } from "@/lib/calibration";

export const dynamic = "force-dynamic"; // never statically cache this route

export async function GET() {
  try {
    const [redditCandidates, alerts, storedWeights, prevScores] = await Promise.all([
      discoverTrendingTickers(),
      getAlerts(),
      getWeights(),
      getPrevScores(),
    ]);
    const weights = mergeWeights(storedWeights);

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
          maxWeightedScore,
          weights
        )
      )
      // Drop tickers Yahoo couldn't resolve at all — usually not real symbols
      // picked up from noisy reddit text.
      .filter((s) => s.sources.yahoo || s.sources.discord);

    // Trend: how each ticker's confidence moved since the previous cycle, so
    // the board can show "rising" vs "fading" instead of just a static number.
    const prevMap = prevScores?.scores || {};
    const scoredWithTrend = scored.map((s) => {
      const prev = prevMap[s.ticker];
      const delta = prev != null ? Math.round((s.confidence - prev) * 10) / 10 : null;
      return { ...s, trend: delta == null ? null : { delta, direction: delta > 0.4 ? "up" : delta < -0.4 ? "down" : "flat" } };
    });
    await savePrevScores(Object.fromEntries(scored.map((s) => [s.ticker, s.confidence])));

    const top9 = rankTop9(scoredWithTrend);
    const [botA, botB] = await Promise.all([
      runBot(scoredWithTrend, "a"),
      runBot(scoredWithTrend, "b"),
    ]);

    // Weight calibration: once Bot A has traded enough, correlate each
    // scoring component's entry-time contribution against actual P&L and
    // nudge the live weights. See lib/calibration.js.
    const usableClosed = botA.closed.filter((t) => t.entryComponentPoints);
    const weightHistory = await getWeightHistory();
    const lastSampleSize = weightHistory[0]?.sampleSize || 0;
    if (shouldRecalibrate(usableClosed.length, lastSampleSize)) {
      const result = recalibrateWeights(usableClosed, weights);
      if (result && result.changes.length > 0) {
        await saveWeights(result.weights);
        await appendWeightHistory({
          at: Date.now(),
          sampleSize: result.sampleSize,
          changes: result.changes,
        });
      }
    }

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      persistent: isPersistent(),
      board: top9,
      botA,
      botB,
      botConfigs: BOT_CONFIGS,
    });
  } catch (err) {
    console.error("[api/scores] failed:", err);
    return NextResponse.json(
      { error: "Failed to compute scoreboard", detail: err.message },
      { status: 500 }
    );
  }
}
