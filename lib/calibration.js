// Turns Bot A's actual paper-trading results into scoring-weight updates —
// this is the "backtesting feeds the scoring system" loop.
//
// Every closed trade carries a snapshot of the weighted point contribution
// each scoring component made at entry (lib/bot.js's entryComponentPoints).
// Periodically, once enough new closed trades have accumulated, this
// correlates each component's contribution against the trade's eventual
// P&L: components that tended to be high on winners and low on losers get
// nudged up; components with no relationship (or an inverse one) get nudged
// down. Nudges are capped per pass and weights are renormalized to keep
// summing to ~1, so this drifts the formula gradually instead of
// overreacting to a lucky or unlucky streak.

const MIN_SAMPLE = 15; // don't trust correlations from fewer trades than this
const RECALIBRATION_STEP = 10; // re-run again once this many *new* trades land
const NUDGE_CAP = 0.15; // max ±15% relative change to any single weight per pass

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return 0;
  return num / Math.sqrt(denomX * denomY);
}

/**
 * @param {number} usableCount  closed trades that have an entryComponentPoints snapshot
 * @param {number} lastSampleSize  sampleSize recorded on the most recent weight-history entry
 */
export function shouldRecalibrate(usableCount, lastSampleSize) {
  if (usableCount < MIN_SAMPLE) return false;
  return usableCount - (lastSampleSize || 0) >= RECALIBRATION_STEP;
}

/**
 * @param {object[]} closedTrades  Bot A's closed positions (must have entryComponentPoints + pnlPercent)
 * @param {object} currentWeights  merged { confidence: {...}, benefit: {...} } weights currently in use
 * @returns {{ weights: object, changes: object[], sampleSize: number } | null}
 */
export function recalibrateWeights(closedTrades, currentWeights) {
  const usable = closedTrades.filter((t) => t.entryComponentPoints && typeof t.pnlPercent === "number");
  if (usable.length < MIN_SAMPLE) return null;

  const outcomes = usable.map((t) => t.pnlPercent);
  const nextWeights = { confidence: { ...currentWeights.confidence }, benefit: { ...currentWeights.benefit } };
  const changes = [];

  for (const scoreType of ["confidence", "benefit"]) {
    const keys = Object.keys(currentWeights[scoreType]);
    const correlations = {};
    for (const key of keys) {
      const xs = usable.map((t) => t.entryComponentPoints?.[scoreType]?.[key] || 0);
      const corr = pearson(xs, outcomes);
      correlations[key] = Number.isFinite(corr) ? corr : 0;
    }

    const adjusted = {};
    for (const key of keys) {
      const factor = 1 + clamp(correlations[key], -NUDGE_CAP, NUDGE_CAP);
      adjusted[key] = Math.max(0.01, currentWeights[scoreType][key] * factor);
    }

    const sum = Object.values(adjusted).reduce((s, v) => s + v, 0) || 1;
    for (const key of keys) {
      const before = Math.round(currentWeights[scoreType][key] * 1000) / 1000;
      const after = Math.round((adjusted[key] / sum) * 1000) / 1000;
      nextWeights[scoreType][key] = after;
      if (Math.abs(after - before) >= 0.005) {
        changes.push({
          scoreType,
          key,
          before,
          after,
          correlation: Math.round(correlations[key] * 100) / 100,
        });
      }
    }
  }

  return { weights: nextWeights, changes, sampleSize: usable.length };
}
