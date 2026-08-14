import { NextRequest, NextResponse } from "next/server";
import { getPortfolio, closeTrade } from "@/lib/store";
import { getQuote } from "@/lib/yahoo";

export async function GET() {
  const portfolio = getPortfolio();

  const totalPnl = portfolio.trades
    .filter((t) => t.status === "closed")
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  const closed = portfolio.trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closed.length > 0 ? wins / closed.length : 0;

  const currentBalance = portfolio.cashBalance + portfolio.trades
    .filter((t) => t.status === "open")
    .reduce((sum, t) => sum + t.positionSize, 0);

  return NextResponse.json({
    ...portfolio,
    currentBalance,
    totalPnl,
    winRate,
    openCount: portfolio.trades.filter((t) => t.status === "open").length,
    closedCount: closed.length,
  });
}

// Close an open trade at current market price (or a manually supplied price)
export async function POST(req: NextRequest) {
  const { tradeId, exitPrice } = await req.json();
  if (!tradeId) return NextResponse.json({ error: "tradeId required" }, { status: 400 });

  let price = exitPrice;
  if (!price) {
    const portfolio = getPortfolio();
    const trade = portfolio.trades.find((t) => t.id === tradeId);
    if (!trade) return NextResponse.json({ error: "trade not found" }, { status: 404 });
    const quote = await getQuote(trade.ticker);
    price = quote.price;
  }

  closeTrade(tradeId, price);
  return NextResponse.json({ ok: true });
}
