import { NextRequest, NextResponse } from "next/server";
import { addAlert, getAlerts, getServers } from "@/lib/store";
import { scoreDiscordAlert, TRADE_THRESHOLD, sizePosition } from "@/lib/credibility";
import { Alert, Direction } from "@/lib/types";
import { maybeExecuteTrade } from "@/lib/paperTrade";

export async function GET() {
  return NextResponse.json(getAlerts().filter((a) => a.source === "discord"));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { serverId, ticker, direction, strike, expiry, entryPriceHint, note } = body as {
    serverId: string;
    ticker: string;
    direction: Direction;
    strike?: number;
    expiry?: string;
    entryPriceHint?: number;
    note?: string;
  };

  if (!serverId || !ticker || !direction) {
    return NextResponse.json({ error: "serverId, ticker, and direction are required" }, { status: 400 });
  }

  const server = getServers().find((s) => s.id === serverId);
  if (!server) {
    return NextResponse.json({ error: "unknown serverId" }, { status: 400 });
  }

  const { score, breakdown } = scoreDiscordAlert(server);

  const alert: Alert = {
    id: crypto.randomUUID(),
    source: "discord",
    sourceLabel: server.id,
    ticker: ticker.toUpperCase(),
    direction,
    strike,
    expiry,
    entryPriceHint,
    note,
    createdAt: new Date().toISOString(),
    credibilityScore: score,
    breakdown,
  };

  addAlert(alert);

  // Instant-log behavior: since this is your highest-trust source, the bot
  // evaluates immediately and takes the trade if it clears the threshold.
  let tradeResult = null;
  if (score >= TRADE_THRESHOLD) {
    tradeResult = await maybeExecuteTrade(alert);
  }

  return NextResponse.json({ alert, tradeResult, threshold: TRADE_THRESHOLD });
}
