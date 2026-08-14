import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import { Alert, DiscordServerConfig, Portfolio, Trade } from "./types";

// Serverless-safe storage: reads/writes JSON blobs to Upstash Redis (REST-based,
// so it works fine from serverless/edge functions) when credentials are set.
// Falls back to flat-file JSON in ./data when they're not, so `npm run dev`
// still works with zero setup locally. Set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN (see .env.example) before deploying to Vercel or
// any other platform with a read-only/ephemeral filesystem.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const DATA_DIR = path.join(process.cwd(), "data");

function ensureFile(file: string, fallback: unknown) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(full)) fs.writeFileSync(full, JSON.stringify(fallback, null, 2));
  return full;
}

function readFileJSON<T>(file: string, fallback: T): T {
  const full = ensureFile(file, fallback);
  try {
    return JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeFileJSON<T>(file: string, data: T) {
  const full = ensureFile(file, data);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

async function readKey<T>(key: string, fallback: T): Promise<T> {
  if (redis) {
    const value = await redis.get<T>(key);
    return value ?? fallback;
  }
  return readFileJSON<T>(`${key}.json`, fallback);
}

async function writeKey<T>(key: string, data: T): Promise<void> {
  if (redis) {
    await redis.set(key, data);
    return;
  }
  writeFileJSON(`${key}.json`, data);
}

// --- Discord server configs (your two paid servers, tracked for hit rate) ---

const SERVERS_KEY = "discord-servers";

const DEFAULT_SERVERS: DiscordServerConfig[] = [
  { id: "server-a", name: "Discord Server A", hitRate: 0.6, totalCalls: 0, wins: 0 },
  { id: "server-b", name: "Discord Server B", hitRate: 0.6, totalCalls: 0, wins: 0 },
];

export async function getServers(): Promise<DiscordServerConfig[]> {
  return readKey(SERVERS_KEY, DEFAULT_SERVERS);
}

export async function updateServer(id: string, patch: Partial<DiscordServerConfig>) {
  const servers = await getServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return;
  servers[idx] = { ...servers[idx], ...patch };
  await writeKey(SERVERS_KEY, servers);
}

// --- Alerts (every signal that came in, from any source) ---

const ALERTS_KEY = "alerts";

export async function getAlerts(): Promise<Alert[]> {
  return readKey<Alert[]>(ALERTS_KEY, []);
}

export async function addAlert(alert: Alert) {
  const alerts = await getAlerts();
  alerts.unshift(alert);
  await writeKey(ALERTS_KEY, alerts);
}

// --- Portfolio (the paper trading bot's state) ---

const PORTFOLIO_KEY = "portfolio";

const DEFAULT_PORTFOLIO: Portfolio = {
  startingBalance: 10000,
  cashBalance: 10000,
  trades: [],
};

export async function getPortfolio(): Promise<Portfolio> {
  return readKey(PORTFOLIO_KEY, DEFAULT_PORTFOLIO);
}

export async function savePortfolio(p: Portfolio) {
  await writeKey(PORTFOLIO_KEY, p);
}

export async function addTrade(trade: Trade) {
  const p = await getPortfolio();
  p.trades.unshift(trade);
  p.cashBalance -= trade.positionSize;
  await savePortfolio(p);
}

export async function closeTrade(tradeId: string, exitPrice: number) {
  const p = await getPortfolio();
  const t = p.trades.find((tr) => tr.id === tradeId);
  if (!t || t.status === "closed") return;

  t.exitPrice = exitPrice;
  t.exitTime = new Date().toISOString();
  t.status = "closed";

  if (t.direction === "call" || t.direction === "put") {
    const contracts = t.contracts ?? 0;
    const move = t.direction === "call" ? exitPrice - t.entryPrice : t.entryPrice - exitPrice;
    t.pnl = move * contracts * 100;
  } else {
    const shares = t.shares ?? 0;
    const move = t.direction === "long" ? exitPrice - t.entryPrice : t.entryPrice - exitPrice;
    t.pnl = move * shares;
  }

  p.cashBalance += t.positionSize + t.pnl;
  await savePortfolio(p);

  // Feed the outcome back into the source server's hit rate
  if (t.sourceLabel.startsWith("server-")) {
    const servers = await getServers();
    const server = servers.find((s) => s.id === t.sourceLabel);
    if (server) {
      const won = (t.pnl ?? 0) > 0;
      const totalCalls = server.totalCalls + 1;
      const wins = server.wins + (won ? 1 : 0);
      await updateServer(server.id, {
        totalCalls,
        wins,
        hitRate: wins / totalCalls,
      });
    }
  }
}
