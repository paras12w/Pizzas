// Paper-trading bot.
//
// Runs on every /api/scores refresh alongside the scoring pass. It doesn't
// place real orders anywhere — it simulates a simple rules-based trader
// against the same live prices the board already shows, so "Taken" means
// something: an actual (paper) position gets opened, tracked, and closed.
//
// Rules:
//   - Opens a new position the moment a ticker's confidence crosses
//     TAKE_THRESHOLD and the bot doesn't already hold that ticker.
//   - Closes a position when confidence decays below EXIT_THRESHOLD, the
//     ticker falls off the scored candidate list entirely, or the position
//     has been held longer than MAX_HOLD_MS.
//   - P&L is simulated as the % move in the underlying since entry, sign-
//     flipped for bearish positions (mirrors buying calls vs. puts).

import { getBotPositions, saveBotPositions } from "./store";
import { TAKE_THRESHOLD } from "./scoring";

const EXIT_THRESHOLD = 45;
const MAX_HOLD_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_CLOSED_HISTORY = 25;

function pnlPercent(entryPrice, currentPrice, direction) {
  if (!entryPrice || !currentPrice) return 0;
  const move = ((currentPrice - entryPrice) / entryPrice) * 100;
  return direction === "bearish" ? -move : move;
}

/**
 * @param {object[]} scoredTickers  output of scoreTicker() for every candidate this cycle
 * @returns {{ open: object[], closed: object[] }}
 */
export async function runBot(scoredTickers) {
  const book = await getBotPositions();
  const byTicker = new Map(scoredTickers.map((s) => [s.ticker, s]));
  const now = Date.now();

  const stillOpen = [];
  const newlyClosed = [];

  for (const pos of book.open) {
    const live = byTicker.get(pos.ticker);
    const currentPrice = live?.price ?? pos.lastPrice ?? pos.entryPrice;
    const confidence = live?.confidence ?? 0;
    const heldMs = now - pos.openedAt;

    const droppedOff = !live;
    const decayed = confidence < EXIT_THRESHOLD;
    const timedOut = heldMs > MAX_HOLD_MS;

    if (droppedOff || decayed || timedOut) {
      newlyClosed.push({
        ...pos,
        exitPrice: currentPrice,
        closedAt: now,
        pnlPercent: Math.round(pnlPercent(pos.entryPrice, currentPrice, pos.direction) * 100) / 100,
        exitReason: droppedOff ? "fell off board" : decayed ? "confidence decayed" : "max hold reached",
      });
    } else {
      stillOpen.push({
        ...pos,
        lastPrice: currentPrice,
        confidence,
        unrealizedPercent: Math.round(pnlPercent(pos.entryPrice, currentPrice, pos.direction) * 100) / 100,
      });
    }
  }

  const openTickers = new Set(stillOpen.map((p) => p.ticker));
  for (const s of scoredTickers) {
    if (s.taken && s.price != null && !openTickers.has(s.ticker)) {
      stillOpen.push({
        ticker: s.ticker,
        direction: s.direction,
        entryPrice: s.price,
        entryConfidence: s.confidence,
        openedAt: now,
        lastPrice: s.price,
        confidence: s.confidence,
        unrealizedPercent: 0,
      });
      openTickers.add(s.ticker);
    }
  }

  const closed = [...newlyClosed, ...book.closed].slice(0, MAX_CLOSED_HISTORY);
  const next = { open: stillOpen, closed };
  await saveBotPositions(next);
  return next;
}
