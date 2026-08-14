/**
 * Heuristic bot/spam likelihood scorer for Reddit accounts posting stock
 * signals. None of these signals are individually definitive - combined,
 * they filter out the obvious "new account spamming a ticker" pattern.
 * Sophisticated bots can still get through; treat this as noise reduction,
 * not a guarantee.
 */

export interface RedditAuthorSignals {
  accountAgeDays: number;
  linkKarma: number;
  commentKarma: number;
  hasVerifiedEmail: boolean;
  recentPostTimestamps: number[]; // unix ms, this author's last N posts
  duplicateTickerMentionsAcrossSubs: number; // same pitch posted elsewhere recently
}

export function computeBotLikelihood(signals: RedditAuthorSignals): number {
  let risk = 0;

  // New accounts are the single strongest signal
  if (signals.accountAgeDays < 7) risk += 0.35;
  else if (signals.accountAgeDays < 30) risk += 0.2;
  else if (signals.accountAgeDays < 90) risk += 0.08;

  // Very low or suspiciously low karma
  const totalKarma = signals.linkKarma + signals.commentKarma;
  if (totalKarma < 50) risk += 0.2;
  else if (totalKarma < 500) risk += 0.08;

  // Comment/post ratio - real users tend to comment more than they post;
  // pure-posting accounts skew promotional
  const ratio = signals.commentKarma / Math.max(signals.linkKarma, 1);
  if (ratio < 0.1) risk += 0.15;

  // Posting velocity - inhumanly regular intervals between posts
  if (signals.recentPostTimestamps.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < signals.recentPostTimestamps.length; i++) {
      gaps.push(signals.recentPostTimestamps[i - 1] - signals.recentPostTimestamps[i]);
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, b) => a + (b - meanGap) ** 2, 0) / gaps.length;
    const stddev = Math.sqrt(variance);
    const coefficientOfVariation = stddev / Math.max(meanGap, 1);
    if (coefficientOfVariation < 0.15) risk += 0.15; // suspiciously consistent timing
  }

  // Same pitch copy-pasted across multiple subreddits recently = classic pump pattern
  if (signals.duplicateTickerMentionsAcrossSubs >= 3) risk += 0.25;
  else if (signals.duplicateTickerMentionsAcrossSubs >= 1) risk += 0.1;

  // Unverified email is weak on its own, small nudge only
  if (!signals.hasVerifiedEmail) risk += 0.05;

  return Math.max(0, Math.min(1, risk));
}
