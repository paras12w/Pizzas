import fs from "fs";
import path from "path";
import { Alert, DiscordServerConfig, Portfolio, Trade } from "./types";

// NOTE: This is a flat-file JSON store meant to get you running locally fast.
// It works fine for a single-user demo but will NOT survive serverless
// deployments (e.g. Vercel) cleanly since the filesystem there is ephemeral
// and not shared across instances. Before deploying for real, swap the
// read/write calls below for a real database (Supabase/Postgres is the
// natural fit and keeps almost the same function signatures).

const DATA_DIR = path.join(process.cwd(), "data");

function ensureFile(file: string, fallback: unknown) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(full)) fs.writeFileSync(full, JSON.stringify(fallback, null, 2));
  return full;
}

function readJSON<T>(file: string, fallback: T): T {
  const full = ensureFile(file, fallback);
  try {
    return JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJSON<T>(file: string, data: T) {
  const full = ensureFile(file, data);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

// --- Discord server configs (your two paid servers, tracked for hit rate) ---

const SERVERS_FILE = "discord-servers.json";

const DEFAULT_SERVERS: DiscordServerConfig[] = [
  { id: "server-a", name: "Discord Server A", hitRate: 0.6, totalCalls: 0, wins: 0 },
  { id: "server-b", name: "Discord Server B", hitRate: 0.6, totalCalls: 0, wins: 0 },
];

export function getServers(): DiscordServerConfig[] {
  return readJSON(SERVERS_FILE, DEFAULT_SERVERS);
}

export function updateServer(id: string, patch: Partial<DiscordServerConfig>) {
  const servers = getServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return;
  servers[idx] = { ...servers[idx], ...patch };
  writeJSON(SERVERS_FILE, servers);
}

// --- Alerts (every signal that came in, from any source) ---

const ALERTS_FILE = "alerts.json";

export function getAlerts(): Alert[] {
  return readJSON<Alert[]>(ALERTS_FILE, []);
}

export function addAlert(alert: Alert) {
  const alerts = getAlerts();
  alerts.unshift(alert);
  writeJSON(ALERTS_FILE, alerts);
}

// --- Portfolio (the paper trading bot's state) ---

const PORTFOLIO_FILE = "portfolio.json";

const DEFAULT_PORTFOLIO: Portfolio = {
  startingBalance: 10000,
  cashBalance: 10000,
  trades: [],
};

export function getPortfolio(): Portfolio {
  return readJSON(PORTFOLIO_FILE, DEFAULT_PORTFOLIO);
}

export function savePortfolio(p: Portfolio) {
  writeJSON(PORTFOLIO_FILE, p);
}

export function addTrade(trade: Trade) {
  const p = getPortfolio();
  p.trades.unshift(trade);
  p.cashBalance -= trade.positionSize;
  savePortfolio(p);
}

export function closeTrade(tradeId: string, exitPrice: number) {
  const p = getPortfolio();
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
  savePortfolio(p);

  // Feed the outcome back into the source server's hit rate
  if (t.sourceLabel.startsWith("server-")) {
    const servers = getServers();
    const server = servers.find((s) => s.id === t.sourceLabel);
    if (server) {
      const won = (t.pnl ?? 0) > 0;
      const totalCalls = server.totalCalls + 1;
      const wins = server.wins + (won ? 1 : 0);
      updateServer(server.id, {
        totalCalls,
        wins,
        hitRate: wins / totalCalls,
      });
    }
  }
}
