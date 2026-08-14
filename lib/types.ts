export type SourceType = "discord" | "reddit" | "yahoo";

export type Direction = "long" | "short" | "call" | "put";

export interface DiscordServerConfig {
  id: string;
  name: string; // your label for the paid server, e.g. "Server A - Options Flow"
  hitRate: number; // 0-1, updated as trades resolve. Start at a reasonable prior.
  totalCalls: number;
  wins: number;
}

export interface Alert {
  id: string;
  source: SourceType;
  sourceLabel: string; // which discord server, or "reddit", or "yahoo-scan"
  ticker: string;
  direction: Direction;
  strike?: number; // for options
  expiry?: string; // ISO date, for options
  entryPriceHint?: number; // price mentioned in the alert, if any
  note?: string;
  createdAt: string;
  credibilityScore: number; // 0-1, computed at ingestion time
  breakdown: Record<string, number>; // component scores for transparency
}

export interface Trade {
  id: string;
  alertId: string;
  ticker: string;
  direction: Direction;
  strike?: number;
  expiry?: string;
  entryPrice: number;
  entryTime: string;
  exitPrice?: number;
  exitTime?: string;
  contracts?: number; // for options
  shares?: number; // for long/short equity
  positionSize: number; // dollar amount allocated
  status: "open" | "closed";
  pnl?: number;
  credibilityScore: number;
  sourceLabel: string;
  reasoning: string[];
}

export interface Portfolio {
  startingBalance: number;
  cashBalance: number;
  trades: Trade[];
}

export interface RedditPostSignal {
  id: string;
  subreddit: string;
  ticker: string;
  title: string;
  author: string;
  accountAgeDays: number;
  authorKarma: number;
  score: number;
  numComments: number;
  createdAt: string;
  botLikelihood: number; // 0-1, higher = more likely spam/bot
  url: string;
}
