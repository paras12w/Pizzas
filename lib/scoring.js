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
// stepped bonus. The old version had pieces like `cashtagBonus =
// clamp(mentions * 8, 0, 20)`, which only ever produces {0, 8, 16, 20} — so
// dozens of tickers collapse onto identical scores. Curves like
// `diminishing()` and `saturate()` below produce a distinct output for every
// distinct input, so two tickers only tie when their underlying signals are
// genuinely identical.

export const TAKE_THRESHOLD = 72;

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

/**
 * @param {object} redditEntry  from lib/reddit.js discoverTrendingTickers (or synthesized)
 * @param {object} yahooSnap    from lib/yahoo.js fetchTickerSnapshot
 * @param {object|null} discordAlert  { direction, note, postedAt } if one exists for this ticker
 * @param {number} maxWeightedScore  highest reddit weightedScore among today's candidates, for normalization
 */
export function scoreTicker(redditEntry, yahooSnap, discordAlert, maxWeightedScore) {
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
  const momentumStrength = saturate(Math.abs(momentum), 4.5); // ~4.5% move ≈ 76/100

  const volumeRatio = yahooSnap?.volumeRatio ?? 1;
  const volumeConviction = saturate(Math.max(0, volumeRatio - 1), 1.4);

  // Where today's price sits within today's high/low range, oriented toward
  // whichever direction momentum implies — a ticker pinned near its high on
  // a green day (or its low on a red day) reads as more committed than one
  // drifting back toward the middle of its range.
  let rangePosition = 0;
  const hasRange = yahooSnap?.dayHigh != null && yahooSnap?.dayLow != null && yahooSnap.dayHigh > yahooSnap.dayLow && yahooSnap.price != null;
  if (hasRange) {
    const pos = (yahooSnap.price - yahooSnap.dayLow) / (yahooSnap.dayHigh - yahooSnap.dayLow);
    rangePosition = clamp((momentum >= 0 ? pos : 1 - pos) * 100);
  }

  const alertAgeHours = discordAlert ? (Date.now() - discordAlert.postedAt) / 3.6e6 : null;
  const discordFreshness = discordAlert ? clamp(100 - alertAgeHours * 3.2, 15, 100) : 0;

  // --- Confidence: are multiple independent sources agreeing? ---
  const confidenceParts = [
    { label: "Reddit mention strength", pts: redditStrength * 0.22, detail: `weighted score ${Math.round(weightedScore)} (${mentions} mentions)` },
    { label: "Cashtag density", pts: cashtagStrength * 0.16, detail: `${cashtags} "$${redditEntry?.ticker || ""}" cashtag${cashtags === 1 ? "" : "s"}` },
    { label: "Mention breadth", pts: mentionBreadth * 0.08, detail: `${mentions} mentions across ${subCount || 0} sub${subCount === 1 ? "" : "s"}` },
    { label: "Price momentum", pts: momentumStrength * 0.2, detail: `${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}% today` },
    { label: "Volume conviction", pts: volumeConviction * 0.18, detail: volumeRatio ? `${volumeRatio.toFixed(2)}x average volume` : "no volume data" },
    { label: "Day-range position", pts: rangePosition * 0.06, detail: hasRange ? `${Math.round(rangePosition)}% toward today's ${momentum >= 0 ? "high" : "low"}` : "no range data" },
    { label: "Discord alert", pts: discordFreshness * 0.1, detail: discordAlert ? `${discordAlert.direction} alert, ${alertAgeHours < 1 ? "<1h" : `${Math.round(alertAgeHours)}h`} old` : "no alert logged" },
  ];
  const confidence = clamp(confidenceParts.reduce((sum, p) => sum + p.pts, 0));

  // --- Benefit: how favorable is the setup if taken? ---
  const ivComponent = saturate(yahooSnap?.impliedVolatility || 0, 0.55);
  const skewComponent = saturate(yahooSnap?.putCallRatio ? Math.abs(1 - yahooSnap.putCallRatio) : 0, 0.7);

  const benefitParts = [
    { label: "Price momentum", pts: momentumStrength * 0.3, detail: `${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}% move` },
    { label: "Volume conviction", pts: volumeConviction * 0.22, detail: volumeRatio ? `${volumeRatio.toFixed(2)}x average volume` : "no volume data" },
    { label: "Day-range position", pts: rangePosition * 0.12, detail: hasRange ? `${Math.round(rangePosition)}% toward today's ${momentum >= 0 ? "high" : "low"}` : "no range data" },
    { label: "Implied volatility", pts: ivComponent * 0.18, detail: yahooSnap?.impliedVolatility ? `${(yahooSnap.impliedVolatility * 100).toFixed(1)}% IV` : "no options data" },
    { label: "Put/call skew", pts: skewComponent * 0.1, detail: yahooSnap?.putCallRatio ? `${yahooSnap.putCallRatio.toFixed(2)} put/call ratio` : "no options data" },
    { label: "Discord alert", pts: discordFreshness * 0.08, detail: discordAlert ? `${discordAlert.direction} alert logged` : "no alert logged" },
  ];
  const benefit = clamp(benefitParts.reduce((sum, p) => sum + p.pts, 0));

  const overall = confidence * 0.6 + benefit * 0.4;

  const toReasons = (parts) =>
    parts
      .filter((p) => p.pts > 0.3)
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 4)
      .map((p) => ({ label: p.label, detail: p.detail, points: round1(p.pts) }));

  return {
    ticker: redditEntry?.ticker || yahooSnap?.ticker,
    confidence: round1(confidence),
    benefit: round1(benefit),
    overall: round1(overall),
    taken: confidence >= TAKE_THRESHOLD,
    direction: discordAlert?.direction || (momentum >= 0 ? "bullish" : "bearish"),
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
  };
}

/**
 * Ranks a full candidate list and returns the top 9 by overall score,
 * regardless of whether any of them clear the "taken" threshold — this is a
 * "best of what's out there" board, not a pass/fail filter.
 */
export function rankTop9(scoredTickers) {
  return [...scoredTickers]
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
