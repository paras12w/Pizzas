// Paper-trading bots.
//
// Runs on every /api/scores refresh alongside the scoring pass. Doesn't
// place real orders anywhere — simulates rules-based trading against the
// same live prices the board already shows, starting from a $10,000
// simulated cash balance each.
//
// Two independently configured bots run side by side:
//   - Bot A: the featured bot shown on the main board. Standard threshold,
//     conservative sizing.
//   - Bot B: an experimental variant (looser entry threshold, tighter exit,
//     more aggressive sizing) kept on its own tab so it doesn't compete for
//     attention with Bot A until it's actually proven itself.
//
// Position sizing scales with how strong the entry's *underlying* confidence
// was (before any Discord-alert floor — see rawConfidence in
// lib/scoring.js), from minSizePct (weak/at-threshold conviction) up to
// maxSizePct (maxed-out conviction) of whatever the bankroll is *at the
// moment the position opens* — so a string of wins compounds into bigger
// size, and a drawdown sizes down. An alert always gets the trade taken
// (see ALERT_MIN_CONFIDENCE in lib/scoring.js), but a weak alert still sizes
// small — the floor guarantees entry, not size. Options-tagged alerts size
// at half of whatever that would otherwise be: we track P&L against the
// *underlying's* price move, not the option's actual premium, and a given
// underlying move swings an option's value far more than the same dollar
// amount of shares would.
//
// Exit rules, checked every cycle, first one to trigger wins:
//   1. Stop-loss: price-based, closes once a position moves stopLossPct
//      against entry — a hard risk limit independent of what the score
//      thinks is happening.
//   2. Take-profit: closes once a favorable move hits takeProfitPct,
//      locking in the win instead of riding it back down.
//   3. Falls off its list entirely (no live score to act on).
//   4. Confidence decays below exitThreshold.
//   5. Max hold time reached.

import { getBotPositions, saveBotPositions, getNotificationSettings } from "./store";
import { notifyDiscord } from "./discord-notify";
import { sendNotificationEmail } from "./email-notify";

export const BOT_CONFIGS = {
  a: {
    id: "a",
    name: "Bot A",
    takeThreshold: 72,
    exitThreshold: 45,
    maxHoldMs: 6 * 60 * 60 * 1000, // 6h
    minSizePct: 0.05,
    maxSizePct: 0.15,
    stopLossPct: 8, // exit if the position moves 8% against entry, any other exit condition aside
    takeProfitPct: 15, // exit once favorable move hits 15%, locking in the win instead of riding it back down
  },
  b: {
    id: "b",
    name: "Bot B",
    takeThreshold: 60, // enters looser setups Bot A would skip
    exitThreshold: 38,
    maxHoldMs: 3 * 60 * 60 * 1000, // shorter leash — 3h
    minSizePct: 0.03,
    maxSizePct: 0.15,
    stopLossPct: 12, // wider stop to match its looser, more aggressive entries
    takeProfitPct: 25,
  },
};

const STARTING_CASH = 10000;
const MAX_CLOSED_HISTORY = 60;

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function pnlPercent(entryPrice, currentPrice, direction) {
  if (!entryPrice || !currentPrice) return 0;
  const move = ((currentPrice - entryPrice) / entryPrice) * 100;
  return direction === "bearish" ? -move : move;
}

const OPTION_SIZE_DAMPENER = 0.5;
// Sizing floor for a ticker that barely had any underlying signal at all
// before a Discord alert forced entry — smaller than minSizePct, which is
// reserved for a ticker that was already right at the take threshold on
// its own merits.
const ALERT_RESCUE_MIN_PCT = 0.02;

function sizingPct(confidence, config, instrument) {
  let pct;
  if (confidence >= config.takeThreshold) {
    const span = Math.max(1, 100 - config.takeThreshold);
    const t = clamp01((confidence - config.takeThreshold) / span);
    pct = config.minSizePct + t * (config.maxSizePct - config.minSizePct);
  } else {
    // Only reachable when a Discord alert floored the *entry* decision
    // (see ALERT_MIN_CONFIDENCE in lib/scoring.js) but sizing is based on
    // the ticker's real underlying score, which came in under threshold.
    // Scales continuously from ALERT_RESCUE_MIN_PCT up to minSizePct as the
    // raw score approaches the threshold, instead of clamping everything
    // below it to the same minimum — a ticker that was 90% of the way to
    // qualifying sizes meaningfully bigger than one that barely registered,
    // even though neither would have been taken without the alert.
    const t = clamp01(confidence / config.takeThreshold);
    pct = ALERT_RESCUE_MIN_PCT + t * (config.minSizePct - ALERT_RESCUE_MIN_PCT);
  }
  return instrument === "option" ? pct * OPTION_SIZE_DAMPENER : pct;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object[]} scoredTickers  output of scoreTicker() for every candidate this cycle
 * @param {"a"|"b"} botId
 * @returns {{ cash: number, equity: number, open: object[], closed: object[] }}
 */
export async function runBot(scoredTickers, botId) {
  const config = BOT_CONFIGS[botId];
  const [book, notifSettings] = await Promise.all([getBotPositions(botId), getNotificationSettings()]);
  const byTicker = new Map(scoredTickers.map((s) => [s.ticker, s]));
  const now = Date.now();

  function notify(message) {
    notifyDiscord(message);
    if (notifSettings.enabled && notifSettings.email) {
      sendNotificationEmail(notifSettings.email, `Signal Desk — ${config.name}`, message);
    }
  }

  let cash = book.cash ?? STARTING_CASH;
  const stillOpen = [];
  const newlyClosed = [];

  for (const pos of book.open) {
    const live = byTicker.get(pos.ticker);
    const currentPrice = live?.price ?? pos.lastPrice ?? pos.entryPrice;
    const confidence = live?.confidence ?? 0;
    const heldMs = now - pos.openedAt;
    const pnlPctSoFar = pnlPercent(pos.entryPrice, currentPrice, pos.direction);

    const stoppedOut = pnlPctSoFar <= -config.stopLossPct;
    const tookProfit = pnlPctSoFar >= config.takeProfitPct;
    const droppedOff = !live;
    const decayed = confidence < config.exitThreshold;
    const timedOut = heldMs > config.maxHoldMs;

    // Price-based risk limits are checked first — a hard stop-loss or a
    // profit target should win over a "confidence still looks fine"
    // read, since confidence is a forecast and price is what actually
    // happened.
    if (stoppedOut || tookProfit || droppedOff || decayed || timedOut) {
      const pnlUsd = pos.sizeUsd * (pnlPctSoFar / 100);
      cash += pos.sizeUsd + pnlUsd;
      const exitReason = stoppedOut
        ? "stop-loss hit"
        : tookProfit
          ? "take-profit hit"
          : droppedOff
            ? "fell off board"
            : decayed
              ? "confidence decayed"
              : "max hold reached";

      newlyClosed.push({
        ...pos,
        exitPrice: currentPrice,
        closedAt: now,
        pnlPercent: round2(pnlPctSoFar),
        pnlUsd: round2(pnlUsd),
        exitReason,
      });

      notify(
        `**${config.name}** closed ${pos.ticker} (${pos.direction}) — ${pnlPctSoFar >= 0 ? "+" : ""}${pnlPctSoFar.toFixed(2)}% ($${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)}), ${exitReason}`
      );
    } else {
      stillOpen.push({
        ...pos,
        lastPrice: currentPrice,
        confidence,
        unrealizedPercent: round2(pnlPctSoFar),
        unrealizedUsd: round2(pos.sizeUsd * (pnlPctSoFar / 100)),
      });
    }
  }

  const openTickers = new Set(stillOpen.map((p) => p.ticker));
  for (const s of scoredTickers) {
    // s.tradeable is already filtered upstream in app/api/scores/route.js
    // (penny stocks, thin liquidity, anomalous moves) — checked again here
    // as a second layer, since this is the function actually risking money.
    if (s.tradeable !== false && s.confidence >= config.takeThreshold && s.price != null && !openTickers.has(s.ticker)) {
      // Sized off rawConfidence (pre-alert-floor) so an alert on a ticker
      // that was barely registering sizes small, while one that was already
      // near the threshold on its own merits sizes normally — the floor on
      // s.confidence guarantees the trade gets *taken*, not what size it
      // gets taken at.
      const pct = sizingPct(s.rawConfidence ?? s.confidence, config, s.instrument);
      const sizeUsd = round2(cash * pct);
      if (sizeUsd < 10) continue; // bankroll too depleted to size a meaningful position

      cash -= sizeUsd;
      stillOpen.push({
        ticker: s.ticker,
        direction: s.direction,
        instrument: s.instrument || "stock",
        entryPrice: s.price,
        entryConfidence: s.confidence,
        sizeUsd,
        sizePct: Math.round(pct * 1000) / 10,
        openedAt: now,
        lastPrice: s.price,
        confidence: s.confidence,
        unrealizedPercent: 0,
        unrealizedUsd: 0,
        // Snapshot of exactly which signals drove entry, for lib/calibration.js
        // to correlate against the eventual outcome once this trade closes.
        entryReasons: s.reasons,
        entryComponentPoints: s.componentPoints,
      });
      openTickers.add(s.ticker);

      notify(
        `**${config.name}** opened ${s.ticker} (${s.direction}${s.instrument === "option" ? ", option" : ""}) — confidence ${s.confidence}, sized $${sizeUsd.toFixed(2)} (${(pct * 100).toFixed(1)}% of bankroll)`
      );
    }
  }

  const closed = [...newlyClosed, ...book.closed].slice(0, MAX_CLOSED_HISTORY);
  const openValue = stillOpen.reduce((sum, p) => sum + p.sizeUsd + (p.unrealizedUsd || 0), 0);
  const equity = round2(cash + openValue);

  const next = { cash: round2(cash), open: stillOpen, closed, equity };
  await saveBotPositions(botId, next);
  return next;
}
