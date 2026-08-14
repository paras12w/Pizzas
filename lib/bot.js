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
// Position sizing scales with how strong the entry confidence was, from
// minSizePct (right at the threshold) up to maxSizePct (confidence maxed at
// 100) of whatever the bankroll is *at the moment the position opens* — so
// a string of wins compounds into bigger size, and a drawdown sizes down.

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
    maxSizePct: 0.2,
  },
  b: {
    id: "b",
    name: "Bot B",
    takeThreshold: 60, // enters looser setups Bot A would skip
    exitThreshold: 38,
    maxHoldMs: 3 * 60 * 60 * 1000, // shorter leash — 3h
    minSizePct: 0.03,
    maxSizePct: 0.3, // sizes up harder on high-conviction entries
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

function sizingPct(confidence, config) {
  const span = Math.max(1, 100 - config.takeThreshold);
  const t = clamp01((confidence - config.takeThreshold) / span);
  return config.minSizePct + t * (config.maxSizePct - config.minSizePct);
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

    const droppedOff = !live;
    const decayed = confidence < config.exitThreshold;
    const timedOut = heldMs > config.maxHoldMs;

    if (droppedOff || decayed || timedOut) {
      const pnlPct = pnlPercent(pos.entryPrice, currentPrice, pos.direction);
      const pnlUsd = pos.sizeUsd * (pnlPct / 100);
      cash += pos.sizeUsd + pnlUsd;
      const exitReason = droppedOff ? "fell off board" : decayed ? "confidence decayed" : "max hold reached";

      newlyClosed.push({
        ...pos,
        exitPrice: currentPrice,
        closedAt: now,
        pnlPercent: round2(pnlPct),
        pnlUsd: round2(pnlUsd),
        exitReason,
      });

      notify(
        `**${config.name}** closed ${pos.ticker} (${pos.direction}) — ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% ($${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)}), ${exitReason}`
      );
    } else {
      const pnlPct = pnlPercent(pos.entryPrice, currentPrice, pos.direction);
      stillOpen.push({
        ...pos,
        lastPrice: currentPrice,
        confidence,
        unrealizedPercent: round2(pnlPct),
        unrealizedUsd: round2(pos.sizeUsd * (pnlPct / 100)),
      });
    }
  }

  const openTickers = new Set(stillOpen.map((p) => p.ticker));
  for (const s of scoredTickers) {
    if (s.confidence >= config.takeThreshold && s.price != null && !openTickers.has(s.ticker)) {
      const pct = sizingPct(s.confidence, config);
      const sizeUsd = round2(cash * pct);
      if (sizeUsd < 10) continue; // bankroll too depleted to size a meaningful position

      cash -= sizeUsd;
      stillOpen.push({
        ticker: s.ticker,
        direction: s.direction,
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
        `**${config.name}** opened ${s.ticker} (${s.direction}) — confidence ${s.confidence}, sized $${sizeUsd.toFixed(2)} (${(pct * 100).toFixed(1)}% of bankroll)`
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
