import { NextResponse } from "next/server";
import { discoverTrendingTickers, fetchTickerMentions } from "@/lib/reddit";
import { fetchManySnapshots, fetchMarketMovers } from "@/lib/yahoo";
import { scoreTicker, rankTopN, mergeWeights } from "@/lib/scoring";
import {
  getAlerts,
  isPersistent,
  getWeights,
  saveWeights,
  getWeightHistory,
  appendWeightHistory,
  getPrevBoard,
  savePrevBoard,
  getNotificationSettings,
} from "@/lib/store";
import { runBot, BOT_CONFIGS } from "@/lib/bot";
import { shouldRecalibrate, recalibrateWeights } from "@/lib/calibration";
import { notifyDiscord } from "@/lib/discord-notify";
import { sendNotificationEmail } from "@/lib/email-notify";

export const dynamic = "force-dynamic"; // never statically cache this route

function attachTrend(entry, prevBoard, listKey) {
  const prevConfidence = prevBoard?.scores?.[entry.ticker];
  const confDelta = prevConfidence != null ? Math.round((entry.confidence - prevConfidence) * 10) / 10 : null;
  const trend = confDelta == null ? null : { delta: confDelta, direction: confDelta > 0.4 ? "up" : confDelta < -0.4 ? "down" : "flat" };

  const prevRank = prevBoard?.ranks?.[listKey]?.[entry.ticker];
  const rankDelta = prevRank != null ? prevRank - entry.rank : null; // positive = moved up (better rank)
  const rankTrend =
    prevRank == null
      ? null
      : { delta: rankDelta, direction: rankDelta > 0 ? "up" : rankDelta < 0 ? "down" : "flat", isNew: false };

  const wasPresent = prevBoard?.tickers?.[listKey]?.includes(entry.ticker);
  const isNewEntrant = !wasPresent;

  return { ...entry, trend, rankTrend, isNewEntrant };
}

export async function GET() {
  try {
    const [redditCandidates, alerts, storedWeights, prevBoard, notifSettings] = await Promise.all([
      discoverTrendingTickers(),
      getAlerts(),
      getWeights(),
      getPrevBoard(),
      getNotificationSettings(),
    ]);
    const weights = mergeWeights(storedWeights);

    // Take the top ~11 reddit candidates by weighted mentions, then make sure
    // every ticker with a live Discord alert is included even if Reddit hasn't
    // picked it up yet. Kept modest (rather than 20+) both because the client
    // polls every 15s (each candidate costs 2 Yahoo requests) and — deliberately
    // capped so that even in the worst case, the 20-ticker pool below always
    // has a full 9 slots left for Yahoo's day_losers movers, which is what
    // actually fills the Sell list. Reddit's own content skews bullish, so
    // giving it more room than that starves Sell candidates no matter how the
    // merge is ordered.
    const topReddit = redditCandidates.slice(0, 11);
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

    // Always blend in Yahoo's own live movers (actives + gainers + losers),
    // not just when Reddit comes up short. Two independent reasons: Reddit's
    // public JSON endpoints frequently block cloud/serverless IPs outright
    // (Vercel included) regardless of User-Agent, and — separately — Reddit's
    // own content skews bullish (moon/rocket posts vastly outnumber short
    // theses), so relying on Reddit alone starves the Sell list even on
    // cycles where Reddit works fine. Reddit-sourced tickers stay first in
    // line since they're pushed into the array before movers are merged in.
    let allTickers = [...redditEntryByTicker.keys()];
    const movers = await fetchMarketMovers(15);
    const existing = new Set(allTickers);
    for (const ticker of movers) {
      if (!existing.has(ticker)) {
        existing.add(ticker);
        allTickers.push(ticker);
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

    // Two independent boards instead of one: bullish candidates ranked as
    // "buys," bearish candidates ranked as "sells" — same scoring math, just
    // split by direction so a bearish mover with strong conviction shows up
    // as a good short/put candidate instead of just falling off a single
    // combined list.
    const buyCandidates = scored.filter((s) => s.direction === "bullish");
    const sellCandidates = scored.filter((s) => s.direction === "bearish");
    const boardBuy = rankTopN(buyCandidates, 9).map((e) => attachTrend(e, prevBoard, "buy"));
    const boardSell = rankTopN(sellCandidates, 9).map((e) => attachTrend(e, prevBoard, "sell"));

    const [botA, botB] = await Promise.all([
      runBot(scored, "a"),
      runBot(scored, "b"),
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

    // Notify on brand-new entrants to either top-9 list (not on every score
    // wiggle — just when the list itself changes) if the previous cycle
    // actually had data to compare against.
    if (prevBoard?.at) {
      const newBuys = boardBuy.filter((e) => e.isNewEntrant).map((e) => e.ticker);
      const newSells = boardSell.filter((e) => e.isNewEntrant).map((e) => e.ticker);
      if (newBuys.length || newSells.length) {
        const parts = [];
        if (newBuys.length) parts.push(`Buy list: ${newBuys.join(", ")}`);
        if (newSells.length) parts.push(`Sell list: ${newSells.join(", ")}`);
        const message = `Leaderboard update — ${parts.join(" · ")}`;
        notifyDiscord(message);
        if (notifSettings.enabled && notifSettings.email) {
          sendNotificationEmail(notifSettings.email, "Signal Desk — leaderboard update", message);
        }
      }
    }

    await savePrevBoard({
      scores: Object.fromEntries(scored.map((s) => [s.ticker, s.confidence])),
      ranks: {
        buy: Object.fromEntries(boardBuy.map((e) => [e.ticker, e.rank])),
        sell: Object.fromEntries(boardSell.map((e) => [e.ticker, e.rank])),
      },
      tickers: {
        buy: boardBuy.map((e) => e.ticker),
        sell: boardSell.map((e) => e.ticker),
      },
    });

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      persistent: isPersistent(),
      boardBuy,
      boardSell,
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
