// Pure formatting/utility helpers shared across pages and components.

export function timeAgo(iso) {
  if (!iso) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function formatPct(n) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function formatScore(n) {
  if (n == null) return "—";
  return n.toFixed(1);
}

export function formatUsd(n) {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Deterministic hue (0-359) for a ticker symbol, used to give each ticker a
// consistent little splash of color across the site without needing to fetch
// real company logos (another external dependency that can get blocked, same
// as Reddit/Yahoo have been).
export function tickerHue(ticker) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) % 360;
  }
  return hash < 0 ? hash + 360 : hash;
}
