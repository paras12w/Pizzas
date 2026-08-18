// Turns raw reddit + yahoo + discord signals into two 0-100 point scores per ticker:
//
//   confidence  — how likely the bot is to actually take this trade
//                 (signal agreement + strength across sources)
//   benefit     — how favorable the trade looks if taken
//                 (expected-move size, volume conviction, options leverage)
//
// The bot "takes" a trade once confidence crosses TAKE_THRESHOLD.
//
// Every component below is a *continuous* curve (tanh/sqrt/exp), not a
// stepped bonus, so two tickers only tie when their underlying signals are
// genuinely identical.
//
// Weights are passed in rather than hardcoded so lib/calibration.js can
// nudge them over time based on which signals actually correlated with
// winning paper trades — DEFAULT_WEIGHTS below is just the starting point.

import { sentimentForText } from "./reddit";

export const TAKE_THRESHOLD = 35;

// Any ticker with a live Discord alert gets confidence floored here — an
// alert means "take this trade," so it always clears both bots' thresholds
// (Bot A: 35, Bot B: 22), not just a partial nudge toward them.
export const ALERT_MIN_CONFIDENCE = 78;

// A setup favorable enough to justify leveraged options exposure instead of
// plain shares for a candidate that wasn't already tagged by a Discord
// alert — checked against `benefit` (how good the setup looks), not
// `confidence` (how much signal agrees it'll happen), since benefit is the
// axis that actually measures "how much upside is here if this plays out."
// Also requires a resolvable options chain (real IV data), which in
// practice mostly means index ETFs and large caps — see SWING_TICKERS in
// app/api/scores/route.js.
export const ORGANIC_OPTION_BENEFIT_THRESHOLD = 55;

// Broad-market index ETFs — diversification means these structurally never
// swing anywhere near as hard, in percentage terms, as an individual stock
// on a given day. Used to give momentum a tighter saturation curve for
// exactly these tickers (see momentumHalfPoint below) so a genuinely big
// day for an index (which looks nothing like a meme-stock-sized move) isn't
// scored as if it were a non-event. Also used by app/api/scores/route.js
// to prioritize these in the anchor pool and always check their news.
export const SWING_TICKERS = ["SPY", "QQQ", "DIA", "IWM"];

// Quality gates — a ticker failing any of these gets excluded from scoring
// entirely (never ranked, never traded), not just down-weighted. All three
// exist because intraday data can look like strong signal while actually
// being noise or manipulation:
//   - Penny stocks: a tiny absolute price move reads as a huge % swing, and
//     the price itself is easily nudged by a handful of orders.
//   - Thin liquidity: a "3x average volume" reading means little if average
//     volume is 50k shares — a few bots or one whale can fake that signal.
//   - Extreme moves: Yahoo's free API doesn't cleanly expose trading halts,
//     so a halt-resume gap shows up as an ordinary-looking huge momentum
//     number. Above EXTREME_MOVE_PCT, a move is more likely a halt gap or
//     data glitch than a genuinely tradeable signal.
export const MIN_TRADABLE_PRICE = 3;
export const MIN_AVG_VOLUME = 500000;
export const EXTREME_MOVE_PCT = 75;

// Rebalanced to make room for `structure` (multi-day trend/swing read),
// `news` (fresh-headline catalyst read), and `swingTiming` (RSI-based entry
// timing, see below) — every other weight below was scaled down
// proportionally from its old value rather than picked fresh, so the
// *relative* importance of the original signals to each other is
// unchanged, just their share of the total now that there are more
// components splitting it.
export const DEFAULT_WEIGHTS = {
  confidence: {
    redditStrength: 0.1368,
    cashtagStrength: 0.0988,
    mentionBreadth: 0.0456,
    momentum: 0.1292,
    volume: 0.114,
    rangePosition: 0.038,
    sentiment: 0.0684,
    analystRating: 0.0608,
    discord: 0.0684,
    structure: 0.114,
    news: 0.076,
    swingTiming: 0.05,
  },
  benefit: {
    momentum: 0.2049,
    volume: 0.1466,
    rangePosition: 0.0808,
    iv: 0.125,
    skew: 0.0658,
    analystRating: 0.0583,
    discord: 0.0517,
    structure: 0.141,
    news: 0.0658,
    swingTiming: 0.06,
  },
};

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Smooth 0→100 ramp that keeps differentiating large inputs instead of
// hard-clipping at a cap — `halfPoint` is the input value that lands at
// ~76/100.
function saturate(value, halfPoint) {
  if (!value || value <= 0) return 0;
  return clamp(100 * Math.tanh(value / halfPoint));
}

// Diminishing-returns ramp for count-like signals (mentions, cashtags) —
// `halfPoint` is roughly the count that reaches ~63% of the ceiling.
function diminishing(count, halfPoint, ceiling = 100) {
  if (!count || count <= 0) return 0;
  return clamp(ceiling * (1 - Math.exp(-count / halfPoint)), 0, ceiling);
}

// Fraction of the regular trading day (9:30am–4:00pm ET) elapsed right now,
// clamped to a 0.05 floor so the ratio below doesn't blow up seconds after
// the open. Outside regular hours, returns 1 (falls back to comparing
// against the plain full-day average — this adjustment specifically targets
// the regular-session case).
function marketDayFraction() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const minutesNow = hour * 60 + minute;
    const openMin = 9 * 60 + 30;
    const closeMin = 16 * 60;
    if (minutesNow < openMin || minutesNow > closeMin) return 1;
    return clamp((minutesNow - openMin) / (closeMin - openMin), 0.05, 1);
  } catch {
    return 1;
  }
}

// Volume compared against how much of an average day *should* have traded
// by this point, not the full daily average — without this, a completely
// ordinary 9:35am reads as "3x average volume" purely from the math (only a
// few minutes have elapsed vs. a full-day baseline), which is exactly the
// kind of false-conviction signal bots/manipulators can exploit early in
// the session.
function timeAdjustedVolumeRatio(volume, avgVolume, fallbackRatio) {
  if (volume == null || !avgVolume) return fallbackRatio ?? 1;
  const expectedSoFar = avgVolume * marketDayFraction();
  if (!expectedSoFar) return fallbackRatio ?? 1;
  return volume / expectedSoFar;
}

export function mergeWeights(weights) {
  return {
    confidence: { ...DEFAULT_WEIGHTS.confidence, ...(weights?.confidence || {}) },
    benefit: { ...DEFAULT_WEIGHTS.benefit, ...(weights?.benefit || {}) },
  };
}

/**
 * @param {object} redditEntry  from lib/reddit.js discoverTrendingTickers (or synthesized)
 * @param {object} yahooSnap    from lib/yahoo.js fetchTickerSnapshot
 * @param {object|null} discordAlert  { direction, note, postedAt } if one exists for this ticker
 * @param {number} maxWeightedScore  highest reddit weightedScore among today's candidates, for normalization
 * @param {object} [weights]  optional override for DEFAULT_WEIGHTS, e.g. from lib/calibration.js
 * @param {object|null} [newsEntry]  { title, publishedAt } from lib/yahoo.js fetchTickerNews, if looked up
 */
export function scoreTicker(redditEntry, yahooSnap, discordAlert, maxWeightedScore, weights, newsEntry) {
  const w = mergeWeights(weights);

  const mentions = redditEntry?.mentions || 0;
  const cashtags = redditEntry?.cashtagMentions || 0;
  const weightedScore = redditEntry?.weightedScore || 0;
  const subCount = (redditEntry?.subs || []).length;

  // Reddit strength blends "how big relative to today's loudest candidate"
  // (sqrt to keep mid-tier candidates spread out instead of bunched near 0)
  // with an absolute log-ish floor, so a ticker doesn't need to beat today's
  // single loudest post to register meaningfully.
  const relStrength = weightedScore > 0 ? clamp(Math.sqrt(weightedScore / Math.max(maxWeightedScore, 1)) * 100) : 0;
  const absStrength = diminishing(weightedScore, 400);
  const redditStrength = clamp(relStrength * 0.6 + absStrength * 0.4);

  const mentionBreadth = diminishing(mentions, 5);
  const cashtagStrength = diminishing(cashtags, 2.2);

  const momentum = yahooSnap?.changePercent ?? 0;
  const ticker = redditEntry?.ticker || yahooSnap?.ticker;
  // Index ETFs get a much tighter saturation point — a 4.5% bar (tuned for
  // individual stocks) would almost never saturate for something as
  // diversified as SPY/QQQ, structurally locking them out of a good
  // momentum score even on a genuinely strong day for an index.
  const momentumHalfPoint = SWING_TICKERS.includes(ticker) ? 1.6 : 4.5; // ~76/100 at that % move
  const momentumStrength = saturate(Math.abs(momentum), momentumHalfPoint);

  const volumeRatio = timeAdjustedVolumeRatio(yahooSnap?.volume, yahooSnap?.avgVolume, yahooSnap?.volumeRatio);
  const volumeConviction = saturate(Math.max(0, volumeRatio - 1), 1.4);

  // Where today's price sits within today's high/low range, oriented toward
  // whichever direction momentum implies.
  let rangePosition = 0;
  const hasRange = yahooSnap?.dayHigh != null && yahooSnap?.dayLow != null && yahooSnap.dayHigh > yahooSnap.dayLow && yahooSnap.price != null;
  if (hasRange) {
    const pos = (yahooSnap.price - yahooSnap.dayLow) / (yahooSnap.dayHigh - yahooSnap.dayLow);
    rangePosition = clamp((momentum >= 0 ? pos : 1 - pos) * 100);
  }

  // Reddit's language tone (bull/bear keyword density), only counted when it
  // actually agrees with the direction the price is already moving — random
  // or contradicting chatter contributes nothing rather than noise.
  const sentimentRaw = redditEntry?.sentiment || 0; // -1..1
  const impliedDirection = momentum >= 0 ? 1 : -1;
  const direction = discordAlert?.direction || (momentum >= 0 ? "bullish" : "bearish");
  const sentimentStrength = clamp(Math.max(0, sentimentRaw * impliedDirection) * 100);

  // Wall Street's own consensus (e.g. "1.8 - Buy") — 1 = Strong Buy, 5 =
  // Strong Sell, 3 = Hold. Converted to the same -1..1 signal shape as
  // sentiment, then only counted when it agrees with momentum's direction,
  // same reasoning as sentiment above: analysts bullish while price is
  // actually selling off isn't a reason to be *more* confident in a long.
  const analystNum = yahooSnap?.analystRating ? parseFloat(yahooSnap.analystRating) : null;
  const analystSignal = analystNum != null && !Number.isNaN(analystNum) ? clamp((3 - analystNum) / 2, -1, 1) : 0;
  const analystStrength = clamp(Math.max(0, analystSignal * impliedDirection) * 100);

  // "Swing structure" — how much the multi-day trend backs this move, not
  // just today's candle. Two reads, averaged:
  //   - trend stack: is price above/below its 50-day average, and is the
  //     50-day above/below the 200-day, in the direction momentum implies —
  //     a golden-cross-shaped stack (price > 50dma > 200dma) is a real
  //     uptrend structure, not just a green day inside a downtrend.
  //   - 52-week positioning: how close price sits to its 52-week high (for
  //     a bullish move — breakout/continuation potential) or 52-week low
  //     (for a bearish move — breakdown/continuation potential), same
  //     orientation logic as rangePosition above but on the yearly range
  //     instead of today's.
  // Missing data (some tickers lack a full year of history) folds to 0 for
  // that half rather than penalizing — consistent with every other
  // best-effort component here.
  let trendStack = 0;
  if (yahooSnap?.price != null && yahooSnap?.fiftyDayAverage && yahooSnap?.twoHundredDayAverage) {
    const aboveFifty = yahooSnap.price > yahooSnap.fiftyDayAverage;
    const fiftyAboveTwoHundred = yahooSnap.fiftyDayAverage > yahooSnap.twoHundredDayAverage;
    const bullishStack = (aboveFifty ? 1 : 0) + (fiftyAboveTwoHundred ? 1 : 0);
    const stackScore = impliedDirection > 0 ? bullishStack : 2 - bullishStack;
    trendStack = (stackScore / 2) * 100;
  }
  let yearRangePosition = 0;
  const hasYearRange =
    yahooSnap?.fiftyTwoWeekHigh != null && yahooSnap?.fiftyTwoWeekLow != null && yahooSnap.fiftyTwoWeekHigh > yahooSnap.fiftyTwoWeekLow && yahooSnap?.price != null;
  if (hasYearRange) {
    const pos = (yahooSnap.price - yahooSnap.fiftyTwoWeekLow) / (yahooSnap.fiftyTwoWeekHigh - yahooSnap.fiftyTwoWeekLow);
    yearRangePosition = clamp((impliedDirection > 0 ? pos : 1 - pos) * 100);
  }
  const structureInputs = (yahooSnap?.fiftyDayAverage ? 1 : 0) + (hasYearRange ? 1 : 0);
  const structureStrength = structureInputs > 0 ? (trendStack + yearRangePosition) / (structureInputs === 2 ? 2 : structureInputs) : 0;

  // "Swing entry timing" — daily-close RSI(14), only populated for a small
  // bounded set of tickers (see fetchSwingTiming in lib/yahoo.js and its
  // use in app/api/scores/route.js — checking it for every candidate would
  // be another Yahoo request per ticker on top of everything else).
  // `structure` above answers "is this trending"; this answers "is right
  // now a good moment to open a NEW position in that trend" — chasing an
  // already-overbought move (or shorting an already-oversold one) is
  // exactly what a swing trader wants to avoid, versus catching it on a
  // pullback. Peaks at a moderate, oriented RSI of 35 (pulled back but not
  // capitulating) and tapers off toward either extreme.
  const rsi = yahooSnap?.rsi ?? null;
  let swingTimingStrength = 0;
  if (rsi != null) {
    const orientedRsi = impliedDirection > 0 ? rsi : 100 - rsi;
    swingTimingStrength = clamp(100 - Math.abs(orientedRsi - 35) * 2);
  }

  // "News catalyst" — a fresh headline (checked for a bounded subset of
  // candidates by the caller, see fetchManyNews in lib/yahoo.js) decayed by
  // age, same freshness shape as the Discord alert below. A headline whose
  // own bull/bear tone contradicts the direction momentum implies
  // contributes nothing (same gating as sentiment/analystRating above); a
  // tone-neutral headline (earnings date, product news with no clear
  // bull/bear language) still counts for partial credit — a real catalyst
  // exists even when its language doesn't editorialize.
  const newsAgeHours = newsEntry ? (Date.now() - newsEntry.publishedAt) / 3.6e6 : null;
  const newsFreshness = newsEntry ? clamp(100 - newsAgeHours * 1.2, 0, 100) : 0;
  const newsSentimentRaw = newsEntry ? sentimentForText(newsEntry.title) : 0;
  const newsAgreement = newsSentimentRaw === 0 ? 0.6 : newsSentimentRaw * impliedDirection > 0 ? 1 : 0;
  const newsStrength = newsFreshness * newsAgreement;

  const alertAgeHours = discordAlert ? (Date.now() - discordAlert.postedAt) / 3.6e6 : null;
  const discordFreshness = discordAlert ? clamp(100 - alertAgeHours * 3.2, 15, 100) : 0;

  // --- Confidence: are multiple independent sources agreeing? ---
  const confidenceParts = [
    { key: "redditStrength", label: "Reddit mention strength", pts: redditStrength * w.confidence.redditStrength, detail: `weighted score ${Math.round(weightedScore)} (${mentions} mentions)` },
    { key: "cashtagStrength", label: "Cashtag density", pts: cashtagStrength * w.confidence.cashtagStrength, detail: `${cashtags} "$${redditEntry?.ticker || ""}" cashtag${cashtags === 1 ? "" : "s"}` },
    { key: "mentionBreadth", label: "Mention breadth", pts: mentionBreadth * w.confidence.mentionBreadth, detail: `${mentions} mentions across ${subCount || 0} sub${subCount === 1 ? "" : "s"}` },
    { key: "momentum", label: "Price momentum", pts: momentumStrength * w.confidence.momentum, detail: `${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}% today` },
    { key: "volume", label: "Volume conviction", pts: volumeConviction * w.confidence.volume, detail: volumeRatio ? `${volumeRatio.toFixed(2)}x average volume` : "no volume data" },
    { key: "rangePosition", label: "Day-range position", pts: rangePosition * w.confidence.rangePosition, detail: hasRange ? `${Math.round(rangePosition)}% toward today's ${momentum >= 0 ? "high" : "low"}` : "no range data" },
    { key: "sentiment", label: "Reddit sentiment", pts: sentimentStrength * w.confidence.sentiment, detail: sentimentRaw !== 0 ? `${sentimentRaw > 0 ? "bullish" : "bearish"} tone, ${Math.round(Math.abs(sentimentRaw) * 100)}% net` : "no clear tone" },
    { key: "analystRating", label: "Analyst rating", pts: analystStrength * w.confidence.analystRating, detail: yahooSnap?.analystRating ? yahooSnap.analystRating : "no analyst coverage" },
    { key: "structure", label: "Swing structure", pts: structureStrength * w.confidence.structure, detail: structureInputs > 0 ? `${Math.round(structureStrength)}% trend/range alignment` : "no trend history" },
    { key: "swingTiming", label: "Swing entry timing", pts: swingTimingStrength * w.confidence.swingTiming, detail: rsi != null ? `RSI ${Math.round(rsi)}` : "no RSI data" },
    { key: "news", label: "News catalyst", pts: newsStrength * w.confidence.news, detail: newsEntry ? `"${newsEntry.title.slice(0, 60)}${newsEntry.title.length > 60 ? "…" : ""}" (${newsAgeHours < 1 ? "<1h" : `${Math.round(newsAgeHours)}h`} old)` : "no recent news" },
    { key: "discord", label: "Discord alert", pts: discordFreshness * w.confidence.discord, detail: discordAlert ? `${discordAlert.direction} alert, ${alertAgeHours < 1 ? "<1h" : `${Math.round(alertAgeHours)}h`} old` : "no alert logged" },
  ];
  let confidence = clamp(confidenceParts.reduce((sum, p) => sum + p.pts, 0));
  // Kept pre-floor so position sizing (in lib/bot.js) reflects the ticker's
  // actual underlying strength, not the artificial floor value below — an
  // alert on a ticker that was barely registering shouldn't size the same
  // as one that was already near the threshold on its own merits. Every
  // alert-floored trade sharing the exact same rawConfidence-less
  // `confidence` was exactly the earlier sizing bug.
  const rawConfidence = confidence;

  // A logged alert means "take this trade" — floor confidence so it always
  // clears both bots' thresholds instead of just nudging toward them. Only
  // raises, never lowers: a ticker that already scored higher on its own
  // merits keeps that score.
  if (discordAlert && confidence < ALERT_MIN_CONFIDENCE) {
    const bump = ALERT_MIN_CONFIDENCE - confidence;
    confidenceParts.push({
      key: "alertFloor",
      label: "Alert override",
      pts: bump,
      detail: `alerts always clear the take threshold`,
    });
    confidence = ALERT_MIN_CONFIDENCE;
  }

  // --- Benefit: how favorable is the setup if taken? ---
  const ivComponent = saturate(yahooSnap?.impliedVolatility || 0, 0.55);
  const skewComponent = saturate(yahooSnap?.putCallRatio ? Math.abs(1 - yahooSnap.putCallRatio) : 0, 0.7);

  const benefitParts = [
    { key: "momentum", label: "Price momentum", pts: momentumStrength * w.benefit.momentum, detail: `${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}% move` },
    { key: "volume", label: "Volume conviction", pts: volumeConviction * w.benefit.volume, detail: volumeRatio ? `${volumeRatio.toFixed(2)}x average volume` : "no volume data" },
    { key: "rangePosition", label: "Day-range position", pts: rangePosition * w.benefit.rangePosition, detail: hasRange ? `${Math.round(rangePosition)}% toward today's ${momentum >= 0 ? "high" : "low"}` : "no range data" },
    { key: "iv", label: "Implied volatility", pts: ivComponent * w.benefit.iv, detail: yahooSnap?.impliedVolatility ? `${(yahooSnap.impliedVolatility * 100).toFixed(1)}% IV` : "no options data" },
    { key: "skew", label: "Put/call skew", pts: skewComponent * w.benefit.skew, detail: yahooSnap?.putCallRatio ? `${yahooSnap.putCallRatio.toFixed(2)} put/call ratio` : "no options data" },
    { key: "structure", label: "Swing structure", pts: structureStrength * w.benefit.structure, detail: structureInputs > 0 ? `${Math.round(structureStrength)}% trend/range alignment` : "no trend history" },
    { key: "swingTiming", label: "Swing entry timing", pts: swingTimingStrength * w.benefit.swingTiming, detail: rsi != null ? `RSI ${Math.round(rsi)}` : "no RSI data" },
    { key: "news", label: "News catalyst", pts: newsStrength * w.benefit.news, detail: newsEntry ? `fresh headline, ${newsAgeHours < 1 ? "<1h" : `${Math.round(newsAgeHours)}h`} old` : "no recent news" },
    { key: "discord", label: "Discord alert", pts: discordFreshness * w.benefit.discord, detail: discordAlert ? `${discordAlert.direction} alert logged` : "no alert logged" },
  ];
  const benefit = clamp(benefitParts.reduce((sum, p) => sum + p.pts, 0));

  const overall = confidence * 0.6 + benefit * 0.4;

  // Instrument selection. There's no shorting available (see the hard
  // bearish rule below), so a Discord alert's explicit instrument choice
  // only ever gets consulted for a bullish trade — otherwise, two paths to
  // trading as an option instead of plain shares:
  //   - SWING_TICKERS (SPY, QQQ, ...) always trade as options when they
  //     trade at all, given a resolvable chain — the entire reason to
  //     trade an index ETF instead of a stock is the leverage, since the
  //     index itself moves far too slowly in percentage terms for plain
  //     shares to be worth holding (see momentumHalfPoint above).
  //   - Anything else needs a setup favorable enough to clear
  //     ORGANIC_OPTION_BENEFIT_THRESHOLD first — leveraged exposure on a
  //     setup with real conviction, not a marginal one.
  const hasOptionsChain = yahooSnap?.impliedVolatility != null;
  const organicOption = hasOptionsChain && (SWING_TICKERS.includes(ticker) || benefit >= ORGANIC_OPTION_BENEFIT_THRESHOLD);
  // Hard rule, no override: there's no short-selling available, so every
  // bearish trade is a put or it isn't taken at all — never a plain short
  // position, regardless of what a Discord alert says or how marginal the
  // setup is.
  const instrument = direction === "bearish" ? "option" : discordAlert?.instrument || (organicOption ? "option" : "stock");

  // Quality gates — computed after scoring (so the reasoning above stays
  // simple) but applied by the caller to exclude the ticker entirely, not
  // just dampen it. A high score built on penny-stock noise, thin liquidity,
  // or a halt-gap anomaly isn't a "slightly less confident" version of a
  // real signal — it's not a real signal.
  const untradeableReasons = [];
  if (yahooSnap?.price != null && yahooSnap.price < MIN_TRADABLE_PRICE) {
    untradeableReasons.push(`price $${yahooSnap.price.toFixed(2)} below $${MIN_TRADABLE_PRICE} penny-stock floor`);
  }
  if (yahooSnap?.avgVolume != null && yahooSnap.avgVolume < MIN_AVG_VOLUME) {
    untradeableReasons.push(`avg volume ${Math.round(yahooSnap.avgVolume / 1000)}K below ${Math.round(MIN_AVG_VOLUME / 1000)}K liquidity floor`);
  }
  if (Math.abs(momentum) > EXTREME_MOVE_PCT) {
    untradeableReasons.push(`${momentum.toFixed(0)}% move exceeds ${EXTREME_MOVE_PCT}% sanity threshold (likely halt/data anomaly)`);
  }
  if (direction === "bearish" && !hasOptionsChain) {
    untradeableReasons.push("bearish move but no resolvable options chain — no way to short without one (puts are the only bearish instrument available)");
  }

  const toReasons = (parts) =>
    parts
      .filter((p) => p.pts > 0.3)
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 4)
      .map((p) => ({ label: p.label, detail: p.detail, points: round1(p.pts) }));

  return {
    ticker: redditEntry?.ticker || yahooSnap?.ticker,
    tradeable: untradeableReasons.length === 0,
    untradeableReasons,
    confidence: round1(confidence),
    rawConfidence: round1(rawConfidence),
    benefit: round1(benefit),
    overall: round1(overall),
    taken: confidence >= TAKE_THRESHOLD,
    direction,
    instrument,
    sources: {
      reddit: !!redditEntry,
      yahoo: !!yahooSnap?.valid,
      discord: !!discordAlert,
    },
    subs: redditEntry?.subs || [],
    price: yahooSnap?.price ?? null,
    changePercent: yahooSnap?.changePercent ?? null,
    reasons: {
      confidence: toReasons(confidenceParts),
      benefit: toReasons(benefitParts),
    },
    // Raw per-component point contributions (pre-rounding), keyed for
    // lib/calibration.js to correlate against trade outcomes later. Not
    // rendered directly in the UI.
    componentPoints: {
      confidence: Object.fromEntries(confidenceParts.map((p) => [p.key, p.pts])),
      benefit: Object.fromEntries(benefitParts.map((p) => [p.key, p.pts])),
    },
  };
}

/**
 * Ranks a candidate list and returns the top N by overall score, regardless
 * of whether any of them clear the "taken" threshold — this is a "best of
 * what's out there" board, not a pass/fail filter.
 */
export function rankTopN(scoredTickers, n = 9) {
  return [...scoredTickers]
    .sort((a, b) => b.overall - a.overall)
    .slice(0, n)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

export function rankTop9(scoredTickers) {
  return rankTopN(scoredTickers, 9);
}
