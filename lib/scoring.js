// Turns raw reddit + yahoo + discord signals into two 0-100 point scores per ticker:
//
//   confidence  — how likely the bot is to actually take this trade
//                 (signal agreement + strength across sources)
//   benefit     — how favorable the trade looks if taken
//                 (expected-move size, volume conviction, options leverage)
//
// The bot "takes" a trade once confidence crosses TAKE_THRESHOLD, mirroring
// the paper-trading bot's 72% cutoff.

export const TAKE_THRESHOLD = 72;

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function normalize(value, max) {
  if (!value || value <= 0) return 0;
  return clamp((value / max) * 100);
}

/**
 * @param {object} redditEntry  from lib/reddit.js discoverTrendingTickers (or synthesized)
 * @param {object} yahooSnap    from lib/yahoo.js fetchTickerSnapshot
 * @param {object|null} discordAlert  { direction, note, postedAt } if one exists for this ticker
 * @param {number} maxWeightedScore  highest reddit weightedScore among today's candidates, for normalization
 */
export function scoreTicker(redditEntry, yahooSnap, discordAlert, maxWeightedScore) {
  const redditStrength = normalize(redditEntry?.weightedScore || 0, maxWeightedScore || 1);
  const cashtagBonus = clamp((redditEntry?.cashtagMentions || 0) * 8, 0, 20);

  const momentum = yahooSnap?.changePercent ?? 0;
  const momentumStrength = clamp(Math.abs(momentum) * 8); // ~12.5% move = maxed out

  const volumeRatio = yahooSnap?.volumeRatio ?? 1;
  const volumeConviction = clamp((volumeRatio - 1) * 40); // 2x avg volume = ~40pts, 3.5x = maxed

  const discordBoost = discordAlert ? 18 : 0;

  // --- Confidence: are multiple independent sources agreeing? ---
  let confidence =
    redditStrength * 0.3 +
    cashtagBonus * 0.5 +
    momentumStrength * 0.25 +
    volumeConviction * 0.25 +
    discordBoost;
  confidence = clamp(confidence);

  // --- Benefit: how favorable is the setup if taken? ---
  const ivComponent = yahooSnap?.impliedVolatility
    ? clamp(yahooSnap.impliedVolatility * 100)
    : 0;
  const skewComponent = yahooSnap?.putCallRatio
    ? clamp(Math.abs(1 - yahooSnap.putCallRatio) * 60)
    : 0;

  let benefit =
    momentumStrength * 0.35 +
    volumeConviction * 0.25 +
    ivComponent * 0.2 +
    skewComponent * 0.1 +
    (discordAlert ? 10 : 0);
  benefit = clamp(benefit);

  const overall = confidence * 0.6 + benefit * 0.4;

  return {
    ticker: redditEntry?.ticker || yahooSnap?.ticker,
    confidence: Math.round(confidence),
    benefit: Math.round(benefit),
    overall: Math.round(overall),
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
  };
}

/**
 * Ranks a full candidate list and returns the top 9.
 */
export function rankTop9(scoredTickers) {
  return [...scoredTickers]
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
