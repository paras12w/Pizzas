import { Alert, Trade } from "./types";
import { getPortfolio, addTrade } from "./store";
import { sizePosition } from "./credibility";
import { getQuote } from "./yahoo";

/**
 * Given an alert that's cleared the trade threshold, pulls a live price
 * and logs a simulated position sized by confidence tier.
 */
export async function maybeExecuteTrade(alert: Alert): Promise<Trade | null> {
  const portfolio = await getPortfolio();
  const positionSize = sizePosition(alert.credibilityScore, portfolio.cashBalance);
  if (positionSize <= 0) return null;
  if (positionSize > portfolio.cashBalance) return null; // out of cash, skip

  let entryPrice: number;
  try {
    const quote = await getQuote(alert.ticker);
    entryPrice = alert.entryPriceHint ?? quote.price;
  } catch {
    entryPrice = alert.entryPriceHint ?? 0;
  }
  if (!entryPrice) return null;

  const isOption = alert.direction === "call" || alert.direction === "put";

  const trade: Trade = {
    id: crypto.randomUUID(),
    alertId: alert.id,
    ticker: alert.ticker,
    direction: alert.direction,
    strike: alert.strike,
    expiry: alert.expiry,
    entryPrice,
    entryTime: new Date().toISOString(),
    positionSize,
    contracts: isOption ? Math.max(1, Math.floor(positionSize / (entryPrice * 100))) : undefined,
    shares: !isOption ? Math.max(1, Math.floor(positionSize / entryPrice)) : undefined,
    status: "open",
    credibilityScore: alert.credibilityScore,
    sourceLabel: alert.sourceLabel,
    reasoning: buildReasoning(alert),
  };

  await addTrade(trade);
  return trade;
}

function buildReasoning(alert: Alert): string[] {
  const lines: string[] = [];
  lines.push(`Source: ${alert.sourceLabel} (${alert.source})`);
  lines.push(`Combined credibility score: ${(alert.credibilityScore * 100).toFixed(1)}%`);
  for (const [key, value] of Object.entries(alert.breakdown)) {
    lines.push(`  - ${key}: ${value}`);
  }
  if (alert.note) lines.push(`Note: ${alert.note}`);
  return lines;
}
