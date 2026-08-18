import { NextResponse } from "next/server";
import { discoverTrendingTickers, fetchTickerMentions } from "@/lib/reddit";
import { fetchManySnapshots, fetchMarketMovers, fetchManyNews } from "@/lib/yahoo";
import { scoreTicker, rankTopN, mergeWeights, SWING_TICKERS } from "@/lib/scoring";
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
  getTrackedTickers,
  saveTrackedTickers,
} from "@/lib/store";
import { runBot, BOT_CONFIGS } from "@/lib/bot";
import { shouldRecalibrate, recalibrateWeights } from "@/lib/calibration";
import { notifyDiscord } from "@/lib/discord-notify";
import { sendNotificationEmail } from "@/lib/email-notify";

export const dynamic = "force-dynamic"; // never statically cache this route

// Widened from 22: the quality gates in lib/scoring.js (penny stocks, thin
// liquidity, anomalous moves) exclude some fraction of candidates *after*
// this pool is assembled, on top of the usual Yahoo-unresolvable losses —
// without enough raw headroom here, both losses compound and a list can
// come up short of 9 even when Reddit/Yahoo are both working fine. This
// does mean more Yahoo requests per cycle (2 per candidate); if you start
// seeing "ERROR" flashes at the 15s refresh rate, this is the first thing
// to dial back.
const TICKER_CAP = 30;
const TRACKED_RETENTION_MS = 3 * 60 * 1000; // keep a recently-seen candidate in the pool for 3 minutes

// Slots reserved exclusively for ANCHOR_TICKERS (see below), carved out of
// TICKER_CAP rather than added on top of it — total Yahoo requests per
// cycle stay capped at TICKER_CAP either way. Reddit/tracked/movers are
// capped to DISCOVERY_CAP *raw tickers fetched*, regardless of how many of
// those actually survive Yahoo resolution or the quality gates — without
// this split, a discovery cycle that returns 30 low-quality tickers (thin
// Reddit chatter, stale tracked entries, an unresolvable symbol) fills the
// whole pool with candidates that mostly get dropped later, and the anchor
// backfill below never gets a chance to run at all since "room left" was
// computed as zero. Reserving the room up front guarantees it survives
// regardless of how much upstream garbage there is.
const ANCHOR_RESERVE = 15;
const DISCOVERY_CAP = TICKER_CAP - ANCHOR_RESERVE;

// Last-resort floor under the whole discovery pipeline: Reddit's public JSON
// endpoints get blocked outright from a lot of cloud IPs (Vercel's
// included, see README), and Yahoo's screener endpoint is its own flaky
// unofficial API that can come back thin or empty on a given cycle. When
// both underdeliver, there's nothing upstream reorganizing candidates can
// do — the pool itself is just short of 9-per-direction. These are
// mega-cap, always-liquid names chosen specifically so they always resolve
// via a plain Yahoo quote and always clear MIN_TRADABLE_PRICE /
// MIN_AVG_VOLUME on their own, and span enough names that on any real
// trading day some are up and some are down — so they backfill whichever
// direction (or both) actually came up short, not just pad the total count.
// Added last, after Reddit/tracked/movers have already claimed their slots,
// so on a day those sources are working fine this contributes nothing.
// SWING_TICKERS (imported above) are the deepest, most liquid options
// chains that exist, which is exactly what makes them good swing-options
// candidates (tight spreads, real IV/skew data, no single-company
// earnings-gap risk). Placed first in the anchor priority order below so
// they're the anchor tier's first claim on its reserved slots, and
// exempted from the "anchors skip news lookups" rule (see newsEligible
// below) — a fixed, cheap set of 4, not the whole anchor list.
// Deliberately wider than what ANCHOR_RESERVE actually uses per cycle
// (see BACKFILL_MAX below) — a pool this size, spanning tech, finance,
// healthcare, consumer, energy, and industrials, means whichever direction
// the market favors on a given day, there's still a deep enough bench in
// the *other* direction for the backfill pass to draw from.
const ANCHOR_TICKERS = [
  ...SWING_TICKERS,
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO",
  "JPM", "BAC", "WFC", "XOM", "CVX", "DIS", "KO", "PEP", "WMT", "HD",
  "UNH", "JNJ", "PG", "V", "MA", "INTC", "CSCO", "ORCL", "CRM", "ADBE",
  "PYPL", "QCOM", "TXN", "IBM", "GE", "CAT", "BA", "MCD", "NKE", "SBUX",
  "LOW", "TGT", "COST", "ABT", "PFE", "MRK", "LLY", "T", "VZ", "CMCSA",
  "GS", "MS", "C", "SCHW", "SPGI",
];

// If either direction still comes up short of 9 after the normal pool is
// scored, a second targeted pass draws from whatever ANCHOR_TICKERS didn't
// already make it into the pool — capped since it's an extra, conditional
// round of Yahoo requests, only spent when there's an actual shortfall.
const BACKFILL_MAX = 20;

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
    const [redditCandidates, alerts, storedWeights, prevBoard, notifSettings, tracked] = await Promise.all([
      discoverTrendingTickers(),
      getAlerts(),
      getWeights(),
      getPrevBoard(),
      getNotificationSettings(),
      getTrackedTickers(),
    ]);
    const weights = mergeWeights(storedWeights);

    // Take the top ~11 reddit candidates by weighted mentions, then make sure
    // every ticker with a live Discord alert is included even if Reddit hasn't
    // picked it up yet. Kept modest both because the client polls every 15s
    // (each candidate costs 2 Yahoo requests) and to leave room below for
    // movers and tracked tickers — Reddit's own content skews bullish, so
    // giving it the whole pool starves the Sell side regardless of anything
    // else done downstream.
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

    let allTickers = [...redditEntryByTicker.keys()];
    const seen = new Set(allTickers);
    function addUpTo(candidates, budget) {
      let added = 0;
      for (const ticker of candidates) {
        if (added >= budget) break;
        if (seen.has(ticker)) continue;
        seen.add(ticker);
        allTickers.push(ticker);
        added++;
      }
    }

    // Recently-seen tickers (discovered on a previous cycle, still within the
    // retention window) get folded back in next, ahead of fresh movers —
    // this is what actually keeps both lists near-full cycle to cycle: a
    // rough discovery cycle for one direction doesn't visibly shrink that
    // list, since it's smoothed over the retention window instead of
    // whiplashing every 15 seconds. Always re-scored with live data below,
    // never frozen — this only carries the ticker symbol forward, not a
    // stale score.
    const now = Date.now();
    const recentlyTracked = Object.entries(tracked)
      .filter(([, lastSeenAt]) => now - lastSeenAt < TRACKED_RETENTION_MS)
      .sort((a, b) => b[1] - a[1])
      .map(([ticker]) => ticker);
    addUpTo(recentlyTracked, Math.max(0, DISCOVERY_CAP - allTickers.length));

    // Yahoo's own live movers fill whatever's left, split explicitly between
    // directions instead of one flat priority list — an earlier version let
    // day_losers claim the whole remaining budget first, which fixed the
    // Sell list but then starved Buy of gainers entirely.
    const movers = await fetchMarketMovers(15);
    const moverBudget = Math.max(0, DISCOVERY_CAP - allTickers.length);
    addUpTo(movers.losers, Math.ceil(moverBudget / 2));
    addUpTo([...movers.actives, ...movers.gainers], Math.max(0, DISCOVERY_CAP - allTickers.length));

    // Anchor pool always gets its full reserved room (see ANCHOR_RESERVE
    // above) — discovery above was capped to DISCOVERY_CAP specifically so
    // this can't be crowded out by a pool full of low-quality tickers.
    const beforeAnchors = allTickers.length;
    addUpTo(ANCHOR_TICKERS, Math.max(0, TICKER_CAP - allTickers.length));

    // News lookups (see fetchTickerNews in lib/yahoo.js) are one extra
    // Yahoo request per ticker, so only checked for the discovery tier
    // (Reddit buzz, tracked, movers) — real candidates news-driven "hype"
    // actually matters for — plus the swing ETFs specifically (see
    // SWING_TICKERS above), a fixed, cheap set of 4. The rest of the anchor
    // filler is skipped since it exists purely as a reliability floor and
    // doesn't need its own catalyst read.
    const swingAnchors = allTickers.slice(beforeAnchors).filter((t) => SWING_TICKERS.includes(t));
    const newsEligible = [...allTickers.slice(0, beforeAnchors), ...swingAnchors];
    const newsByTicker = await fetchManyNews(newsEligible);

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
          weights,
          newsByTicker.get(ticker) || null
        )
      )
      // Drop tickers Yahoo couldn't resolve at all — usually not real symbols
      // picked up from noisy reddit text — and anything that failed a
      // quality gate (penny stock, thin liquidity, or an anomalous move
      // that's more likely a halt gap / data glitch than real signal). This
      // applies even to Discord-alerted tickers on purpose: pump-and-dump
      // alert groups specifically target penny stocks, so exempting alerts
      // from the gate would defeat the point of having it.
      .filter((s) => (s.sources.yahoo || s.sources.discord) && s.tradeable);

    // Two independent boards instead of one: bullish candidates ranked as
    // "buys," bearish candidates ranked as "sells" — same scoring math, just
    // split by direction so a bearish mover with strong conviction shows up
    // as a good short/put candidate instead of just falling off a single
    // combined list.
    let buyCandidates = scored.filter((s) => s.direction === "bullish");
    let sellCandidates = scored.filter((s) => s.direction === "bearish");

    // Direction isn't known until a ticker is actually scored, so the pool
    // assembled above can't *guarantee* 9-per-direction up front — a broad
    // market day genuinely can produce far more decliners than advancers
    // (or vice versa) among the exact tickers this cycle happened to pull
    // in. Rather than accept whichever split the initial pool landed on,
    // draw more from the unused rest of ANCHOR_TICKERS and keep only
    // whichever direction is still short.
    const usedTickers = new Set(allTickers);
    async function backfillDirection(direction, list) {
      if (list.length >= 9) return list;
      const pool = ANCHOR_TICKERS.filter((t) => !usedTickers.has(t)).slice(0, BACKFILL_MAX);
      if (!pool.length) return list;
      pool.forEach((t) => usedTickers.add(t));
      const extraSnapshots = await fetchManySnapshots(pool);
      const extraScored = extraSnapshots
        .map((snap) =>
          scoreTicker(null, snap, alertByTicker.get(snap.ticker) || null, maxWeightedScore, weights, null)
        )
        .filter((s) => s.sources.yahoo && s.tradeable && s.direction === direction);
      scored.push(...extraScored);
      return [...list, ...extraScored];
    }
    buyCandidates = await backfillDirection("bullish", buyCandidates);
    sellCandidates = await backfillDirection("bearish", sellCandidates);

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

    // Refresh the tracked-ticker pool: anything that actually resolved this
    // cycle stays candidate-eligible for the retention window even if not
    // freshly rediscovered next cycle. See lib/store.js for why.
    const nextTracked = { ...tracked };
    for (const s of scored) nextTracked[s.ticker] = now;
    await saveTrackedTickers(nextTracked);

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
