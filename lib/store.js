// Central persistence layer. Uses Vercel KV when it's configured
// (KV_REST_API_URL / KV_REST_API_TOKEN env vars present); falls back to
// in-memory storage so the site still works immediately after first deploy
// — the only downside of the fallback is that state resets whenever the
// serverless function cold-starts. See README.md for the Vercel KV setup.

const ALERT_TTL_MS = 24 * 60 * 60 * 1000; // live-scoring alerts expire after 24h
const ALERT_HISTORY_MAX = 300;
const WEIGHT_HISTORY_MAX = 100;
const WATCHLIST_MAX = 40;

const STARTING_CASH = 10000;

const memoryStore = new Map(); // live (24h) alerts, keyed by ticker
let memoryAlertHistory = []; // permanent alert log
let memoryWeights = null;
let memoryWeightHistory = [];
let memoryWatchlist = [];
let memoryPrevScores = { at: null, scores: {}, ranks: { buy: {}, sell: {} }, tickers: { buy: [], sell: [] } };
let memoryNotificationSettings = { email: "", enabled: false };
const memoryBotBooks = new Map(); // botId -> { cash, open: [], closed: [] }

function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getKv() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

const KEY = "signal-desk:discord-alerts";
const ALERT_HISTORY_KEY = "signal-desk:alert-history";
const WEIGHTS_KEY = "signal-desk:weights";
const WEIGHT_HISTORY_KEY = "signal-desk:weight-history";
const WATCHLIST_KEY = "signal-desk:watchlist";
const NOTIFICATIONS_KEY = "signal-desk:notifications";
const PREV_SCORES_KEY = "signal-desk:prev-scores";
const botKey = (botId) => `signal-desk:bot-positions:${botId}`;

export function isPersistent() {
  return kvConfigured();
}

// --- Live (24h) Discord alerts, used to enrich scoring ---

export async function getAlerts() {
  const now = Date.now();
  let alerts = [];

  if (kvConfigured()) {
    const kv = await getKv();
    alerts = (await kv.get(KEY)) || [];
  } else {
    alerts = Array.from(memoryStore.values());
  }

  return alerts.filter((a) => now - a.postedAt < ALERT_TTL_MS);
}

export async function addAlert({ ticker, direction, note }) {
  const alert = {
    ticker: ticker.toUpperCase(),
    direction: direction || "bullish",
    note: note || "",
    postedAt: Date.now(),
  };

  if (kvConfigured()) {
    const kv = await getKv();
    const existing = (await kv.get(KEY)) || [];
    const filtered = existing.filter((a) => a.ticker !== alert.ticker);
    const next = [alert, ...filtered].slice(0, 50);
    await kv.set(KEY, next);
  } else {
    memoryStore.set(alert.ticker, alert);
  }

  await logAlertHistory(alert);
  return alert;
}

// --- Permanent alert log (every alert ever submitted, not just the live set) ---

export async function getAlertHistory() {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(ALERT_HISTORY_KEY)) || [];
  }
  return memoryAlertHistory;
}

export async function logAlertHistory(alert) {
  const entry = { ...alert, loggedAt: Date.now() };
  if (kvConfigured()) {
    const kv = await getKv();
    const existing = (await kv.get(ALERT_HISTORY_KEY)) || [];
    const next = [entry, ...existing].slice(0, ALERT_HISTORY_MAX);
    await kv.set(ALERT_HISTORY_KEY, next);
  } else {
    memoryAlertHistory = [entry, ...memoryAlertHistory].slice(0, ALERT_HISTORY_MAX);
  }
}

// --- Per-bot position books: { cash, open: Position[], closed: Position[] } ---
// Each bot starts with $10,000 simulated cash. See lib/bot.js for Position shape.

function freshBook() {
  return { cash: STARTING_CASH, open: [], closed: [] };
}

export async function getBotPositions(botId) {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(botKey(botId))) || freshBook();
  }
  if (!memoryBotBooks.has(botId)) memoryBotBooks.set(botId, freshBook());
  return memoryBotBooks.get(botId);
}

export async function saveBotPositions(botId, book) {
  if (kvConfigured()) {
    const kv = await getKv();
    await kv.set(botKey(botId), book);
  } else {
    memoryBotBooks.set(botId, book);
  }
}

// --- Dynamic scoring weights + calibration history ---

export async function getWeights() {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(WEIGHTS_KEY)) || null;
  }
  return memoryWeights;
}

export async function saveWeights(weights) {
  if (kvConfigured()) {
    const kv = await getKv();
    await kv.set(WEIGHTS_KEY, weights);
  } else {
    memoryWeights = weights;
  }
}

export async function getWeightHistory() {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(WEIGHT_HISTORY_KEY)) || [];
  }
  return memoryWeightHistory;
}

export async function appendWeightHistory(entry) {
  if (kvConfigured()) {
    const kv = await getKv();
    const existing = (await kv.get(WEIGHT_HISTORY_KEY)) || [];
    const next = [entry, ...existing].slice(0, WEIGHT_HISTORY_MAX);
    await kv.set(WEIGHT_HISTORY_KEY, next);
  } else {
    memoryWeightHistory = [entry, ...memoryWeightHistory].slice(0, WEIGHT_HISTORY_MAX);
  }
}

// --- Watchlist: shared pinned-ticker list (no per-user auth on this site) ---

export async function getWatchlist() {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(WATCHLIST_KEY)) || [];
  }
  return memoryWatchlist;
}

export async function saveWatchlist(tickers) {
  const next = Array.from(new Set(tickers.map((t) => t.toUpperCase()))).slice(0, WATCHLIST_MAX);
  if (kvConfigured()) {
    const kv = await getKv();
    await kv.set(WATCHLIST_KEY, next);
  } else {
    memoryWatchlist = next;
  }
  return next;
}

// --- Previous cycle's board state, for trend arrows + rank movement +
// "new entrant" detection (used both for the UI and for notifications) ---

const EMPTY_PREV_BOARD = { at: null, scores: {}, ranks: { buy: {}, sell: {} }, tickers: { buy: [], sell: [] } };

export async function getPrevBoard() {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(PREV_SCORES_KEY)) || EMPTY_PREV_BOARD;
  }
  return memoryPrevScores;
}

export async function savePrevBoard(state) {
  const entry = { at: Date.now(), ...state };
  if (kvConfigured()) {
    const kv = await getKv();
    await kv.set(PREV_SCORES_KEY, entry);
  } else {
    memoryPrevScores = entry;
  }
}

// --- Notification settings: one shared subscriber (no per-user auth on
// this site), togglable independent of whether an email is set ---

export async function getNotificationSettings() {
  if (kvConfigured()) {
    const kv = await getKv();
    return (await kv.get(NOTIFICATIONS_KEY)) || { email: "", enabled: false };
  }
  return memoryNotificationSettings;
}

export async function saveNotificationSettings(settings) {
  const next = { email: (settings.email || "").trim(), enabled: !!settings.enabled };
  if (kvConfigured()) {
    const kv = await getKv();
    await kv.set(NOTIFICATIONS_KEY, next);
  } else {
    memoryNotificationSettings = next;
  }
  return next;
}
