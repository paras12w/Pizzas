// Stores manually-pasted Discord alerts so they survive across requests.
//
// Uses Vercel KV when it's configured (KV_REST_API_URL / KV_REST_API_TOKEN env
// vars present). If it isn't set up yet, falls back to an in-memory Map so the
// site still works immediately after first deploy — the only downside of the
// fallback is that alerts reset whenever the serverless function cold-starts.
// See README.md for the 2-minute Vercel KV setup.

const ALERT_TTL_MS = 24 * 60 * 60 * 1000; // alerts expire after 24h
const memoryStore = new Map();

function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getKv() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

const KEY = "signal-desk:discord-alerts";

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

  return alert;
}

export function isPersistent() {
  return kvConfigured();
}
