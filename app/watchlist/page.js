"use client";

import { useEffect, useState } from "react";
import { formatPct, formatScore } from "@/lib/format";
import { Meter, TickerDecal } from "../components/ui";
import TickerDetail from "../components/TickerDetail";

export default function WatchlistPage() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [botA, setBotA] = useState(null);

  async function load() {
    try {
      const [wl, scores] = await Promise.all([
        fetch("/api/watchlist", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/scores", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (wl.error) throw new Error(wl.error);
      setEntries(wl.entries || []);
      if (scores && !scores.error) setBotA(scores.botA || null);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  async function addTicker(e) {
    e.preventDefault();
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", ticker }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add that ticker.");
      setInput("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeTicker(ticker) {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", ticker }),
    });
    await load();
  }

  const selectedEntry = entries.find((e) => e.ticker === selectedTicker) || null;
  const selectedBotPosition = selectedTicker
    ? (botA?.open || []).map((p) => ({ ...p, status: "open" })).find((p) => p.ticker === selectedTicker) ||
      (botA?.closed || []).map((p) => ({ ...p, status: "closed" })).find((p) => p.ticker === selectedTicker) ||
      null
    : null;

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-6 py-8 sm:py-12">
      <header className="mb-8 border-b border-[var(--hairline)] pb-4">
        <h1 className="font-mono-board text-2xl font-black tracking-tight text-[var(--amber)]">WATCHLIST</h1>
        <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
          Pin tickers to always track their live score, even when they don&apos;t crack the organic top 9.
        </p>
      </header>

      <form onSubmit={addTicker} className="mb-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a ticker, e.g. NVDA"
          className="flex-1 rounded-sm border border-[var(--hairline)] bg-black/30 px-3 py-2 text-sm font-mono-board uppercase text-[var(--ink)] placeholder:normal-case placeholder:text-[var(--ink-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--amber)]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-sm bg-[var(--amber)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
        >
          Add
        </button>
      </form>
      {error && <div className="mb-4 text-xs text-[var(--bear)]">{error}</div>}

      {status === "loading" && <div className="text-sm text-[var(--ink-dim)] font-mono-board">Loading…</div>}
      {status === "error" && <div className="text-sm text-[var(--bear)] font-mono-board">Failed to load watchlist.</div>}

      {status === "ok" && entries.length === 0 && (
        <div className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] px-4 py-10 text-center text-sm text-[var(--ink-dim)] font-mono-board">
          Nothing pinned yet.
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] overflow-hidden">
          {entries.map((entry) => (
            <div key={entry.ticker} className="flex items-center gap-3 border-b border-[var(--hairline)] px-4 py-3 last:border-b-0">
              <button onClick={() => setSelectedTicker(entry.ticker)} className="flex flex-1 items-center gap-3 text-left">
                <TickerDecal ticker={entry.ticker} size={28} />
                <div className="w-20">
                  <div className="font-mono-board font-bold">{entry.ticker}</div>
                  {entry.price != null && (
                    <div className="font-mono-board text-[11px] text-[var(--ink-dim)]">
                      ${entry.price.toFixed(2)} {formatPct(entry.changePercent)}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">
                    <span>Confidence</span>
                    <span className="font-mono-board text-[var(--ink)]">{formatScore(entry.confidence)}</span>
                  </div>
                  <Meter value={entry.confidence} tone="amber" />
                </div>
              </button>
              <button
                onClick={() => removeTicker(entry.ticker)}
                className="rounded-sm border border-[var(--hairline)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--ink-dim)] hover:text-[var(--bear)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedTicker && selectedEntry && (
        <TickerDetail
          ticker={selectedTicker}
          entry={selectedEntry}
          botPosition={selectedBotPosition}
          onClose={() => setSelectedTicker(null)}
        />
      )}
    </main>
  );
}
