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

export const TAKE_THRESHOLD = 72;

export const DEFAULT_WEIGHTS = {
  confidence: {
    redditStrength: 0.2,
    cashtagStrength: 0.14,
    mentionBreadth: 0.07,
    momentum: 0.18,
    volume: 0.16,
    rangePosition: 0.05,
    sentiment: 0.1,
    discord: 0.1,
  },
  benefit: {
    momentum: 0.3,
    volume: 0.22,
    rangePosition: 0.12,
    iv: 0.18,
    skew: 0.1,
    discord: 0.08,
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
 */
export function scoreTicker(redditEntry, yahooSnap, discordAlert, maxWeightedScore, weights) {
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
  const momentumStrength = saturate(Math.abs(momentum), 4.5); // ~4.5% move ≈ 76/100

  const volumeRatio = yahooSnap?.volumeRatio ?? 1;
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
  const sentimentStrength = clamp(Math.max(0, sentimentRaw * impliedDirection) * 100);

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
    { key: "discord", label: "Discord alert", pts: discordFreshness * w.confidence.discord, detail: discordAlert ? `${discordAlert.direction} alert, ${alertAgeHours < 1 ? "<1h" : `${Math.round(alertAgeHours)}h`} old` : "no alert logged" },
  ];
  const confidence = clamp(confidenceParts.reduce((sum, p) => sum + p.pts, 0));

  // --- Benefit: how favorable is the setup if taken? ---
  const ivComponent = saturate(yahooSnap?.impliedVolatility || 0, 0.55);
  const skewComponent = saturate(yahooSnap?.putCallRatio ? Math.abs(1 - yahooSnap.putCallRatio) : 0, 0.7);

  const benefitParts = [
    { key: "momentum", label: "Price momentum", pts: momentumStrength * w.benefit.momentum, detail: `${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}% move` },
    { key: "volume", label: "Volume conviction", pts: volumeConviction * w.benefit.volume, detail: volumeRatio ? `${volumeRatio.toFixed(2)}x average volume` : "no volume data" },
    { key: "rangePosition", label: "Day-range position", pts: rangePosition * w.benefit.rangePosition, detail: hasRange ? `${Math.round(rangePosition)}% toward today's ${momentum >= 0 ? "high" : "low"}` : "no range data" },
    { key: "iv", label: "Implied volatility", pts: ivComponent * w.benefit.iv, detail: yahooSnap?.impliedVolatility ? `${(yahooSnap.impliedVolatility * 100).toFixed(1)}% IV` : "no options data" },
    { key: "skew", label: "Put/call skew", pts: skewComponent * w.benefit.skew, detail: yahooSnap?.putCallRatio ? `${yahooSnap.putCallRatio.toFixed(2)} put/call ratio` : "no options data" },
    { key: "discord", label: "Discord alert", pts: discordFreshness * w.benefit.discord, detail: discordAlert ? `${discordAlert.direction} alert logged` : "no alert logged" },
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
