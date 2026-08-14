import { Alert, DiscordServerConfig, RedditPostSignal } from "./types";

/**
 * Scores a Discord alert. Since these come from paid servers you already
 * trust, the base weight starts high and is adjusted by that server's
 * actual historical hit rate (tracked in store.ts as trades resolve).
 */
export function scoreDiscordAlert(server: DiscordServerConfig): {
  score: number;
  breakdown: Record<string, number>;
} {
  // Prior: servers with few resolved trades lean toward a neutral 0.6
  // rather than being fully trusted on hit rate alone (avoids overreacting
  // to a tiny sample size, e.g. 2-for-2).
  const sampleWeight = Math.min(server.totalCalls / 20, 1); // ramps up to full trust at 20 resolved trades
  const trackRecordScore = sampleWeight * server.hitRate + (1 - sampleWeight) * 0.6;

  const baseTrust = 0.75; // these are paid, curated servers - start trusted
  const score = clamp01(baseTrust * 0.4 + trackRecordScore * 0.6);

  return {
    score,
    breakdown: {
      baseTrust,
      trackRecordScore: round(trackRecordScore),
      sampleSize: server.totalCalls,
    },
  };
}

/**
 * Scores a Reddit post as a signal, factoring out likely bot/spam noise.
 * botLikelihood should already be computed (see lib/redditBotFilter.ts).
 */
export function scoreRedditSignal(post: RedditPostSignal): {
  score: number;
  breakdown: Record<string, number>;
} {
  const trustFactor = 1 - post.botLikelihood;

  // Engagement score: log-scaled so a viral post doesn't totally dominate,
  // but genuine engagement still counts for something.
  const engagement = clamp01(Math.log10(Math.max(post.score, 1) + 1) / 3);

  const recencyHours = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency = clamp01(1 - recencyHours / 72); // decays to 0 over 3 days

  const score = clamp01(trustFactor * 0.6 + engagement * 0.25 + recency * 0.15);

  return {
    score,
    breakdown: {
      trustFactor: round(trustFactor),
      engagement: round(engagement),
      recency: round(recency),
      botLikelihood: round(post.botLikelihood),
    },
  };
}

/**
 * Scores a Yahoo-derived technical/analyst signal (volume spike, analyst
 * upgrade, etc). Kept simple - extend with real thresholds as you tune it.
 */
export function scoreYahooSignal(params: {
  volumeRatio: number; // current volume / avg volume
  analystUpgrade: boolean;
}): { score: number; breakdown: Record<string, number> } {
  const volumeScore = clamp01((params.volumeRatio - 1) / 3); // 4x avg volume = max score
  const analystScore = params.analystUpgrade ? 1 : 0;
  const score = clamp01(volumeScore * 0.6 + analystScore * 0.4);

  return {
    score,
    breakdown: {
      volumeScore: round(volumeScore),
      analystScore,
    },
  };
}

/**
 * Corroboration boost: when multiple independent sources flag the same
 * ticker within a short window, bump the combined confidence up.
 */
export function combineSignalsForTicker(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return scores[0];

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const corroborationBoost = clamp01((scores.length - 1) * 0.08); // up to +0.08 per extra source
  return clamp01(avg + corroborationBoost);
}

/** Threshold above which the paper trading bot will take a position. */
export const TRADE_THRESHOLD = 0.72;

/** Position sizing tiers, scaled by confidence score. */
export function sizePosition(score: number, cashBalance: number): number {
  const maxRisk = cashBalance * 0.15; // never risk more than 15% of cash on one trade
  if (score >= 0.9) return round2(maxRisk);
  if (score >= 0.8) return round2(maxRisk * 0.66);
  if (score >= TRADE_THRESHOLD) return round2(maxRisk * 0.4);
  return 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
