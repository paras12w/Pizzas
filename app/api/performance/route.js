import { NextResponse } from "next/server";
import { getBotPositions } from "@/lib/store";
import { BOT_CONFIGS } from "@/lib/bot";

export const dynamic = "force-dynamic";

const STARTING_CASH = 10000;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeStats(book) {
  const closed = book.closed || [];
  const wins = closed.filter((t) => (t.pnlUsd || 0) > 0);
  const losses = closed.filter((t) => (t.pnlUsd || 0) <= 0);
  const totalRealized = closed.reduce((s, t) => s + (t.pnlUsd || 0), 0);
  const openUnrealized = (book.open || []).reduce((s, p) => s + (p.unrealizedUsd || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlUsd, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnlUsd, 0) / losses.length : 0;

  // Equity curve reconstructed by replaying closed trades oldest-first.
  const chronological = [...closed].sort((a, b) => a.closedAt - b.closedAt);
  let running = STARTING_CASH;
  const equityCurve = [{ at: null, equity: STARTING_CASH }];
  for (const t of chronological) {
    running += t.pnlUsd || 0;
    equityCurve.push({ at: t.closedAt, equity: round2(running) });
  }

  return {
    startingCash: STARTING_CASH,
    cash: book.cash,
    equity: book.equity,
    openCount: (book.open || []).length,
    closedCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closed.length ? Math.round((wins.length / closed.length) * 1000) / 10 : null,
    totalRealizedUsd: round2(totalRealized),
    openUnrealizedUsd: round2(openUnrealized),
    avgWinUsd: round2(avgWin),
    avgLossUsd: round2(avgLoss),
    bestTrade: closed.length ? closed.reduce((a, b) => (b.pnlUsd > a.pnlUsd ? b : a)) : null,
    worstTrade: closed.length ? closed.reduce((a, b) => (b.pnlUsd < a.pnlUsd ? b : a)) : null,
    equityCurve,
  };
}

export async function GET() {
  try {
    const [bookA, bookB] = await Promise.all([getBotPositions("a"), getBotPositions("b")]);
    return NextResponse.json({
      a: { config: BOT_CONFIGS.a, stats: computeStats(bookA) },
      b: { config: BOT_CONFIGS.b, stats: computeStats(bookB) },
    });
  } catch (err) {
    console.error("[api/performance] failed:", err);
    return NextResponse.json({ error: "Failed to load performance", detail: err.message }, { status: 500 });
  }
}
