"use client";

import { useEffect, useRef, useState } from "react";
import { TAKE_THRESHOLD } from "@/lib/scoring";

const REFRESH_MS = 60 * 1000; // 1 minute

function timeAgo(iso) {
  if (!iso) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatPct(n) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function Meter({ value, tone }) {
  const color = tone === "amber" ? "var(--amber)" : tone === "bull" ? "var(--bull)" : "var(--bear)";
  return (
    <div className="h-1.5 w-full rounded-full bg-black/40 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${value}%`, background: color }}
      />
    </div>
  );
}

function ReasonList({ title, reasons }) {
  if (!reasons?.length) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">{title}</div>
        <div className="text-xs text-[var(--ink-dim)] font-mono-board">No strong contributing signals.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">{title}</div>
      <ul className="space-y-1">
        {reasons.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--ink)]">{r.label}</span>
            <span className="font-mono-board text-[var(--ink-dim)] whitespace-nowrap">
              {r.detail} · <span style={{ color: "var(--amber)" }}>+{r.points}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sparkline({ candles }) {
  if (!candles?.length) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-[var(--ink-dim)] font-mono-board">
        No chart data available.
      </div>
    );
  }

  const w = 600;
  const h = 128;
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const points = candles.map((c, i) => {
    const x = (i / Math.max(1, candles.length - 1)) * w;
    const y = h - ((c.close - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const rising = closes[closes.length - 1] >= closes[0];
  const lineColor = rising ? "var(--bull)" : "var(--bear)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
      <polyline points={points.join(" ")} fill="none" stroke={lineColor} strokeWidth="2" />
    </svg>
  );
}

function TickerDetail({ ticker, entry, botPosition, onClose }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/history?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setHistory(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-8 sm:px-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-md border border-[var(--hairline)] bg-[var(--panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
          <div>
            <div className="font-mono-board text-xl font-bold" style={{ color: "var(--amber)" }}>
              {ticker}
            </div>
            {entry?.price != null && (
              <div className="font-mono-board text-xs text-[var(--ink-dim)]">
                ${entry.price.toFixed(2)}{" "}
                <span style={{ color: entry.changePercent >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {formatPct(entry.changePercent)}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-sm border border-[var(--hairline)] px-2 py-1 text-xs text-[var(--ink-dim)] hover:text-[var(--amber)]"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4">
          {loading && <div className="py-8 text-center text-xs text-[var(--ink-dim)] font-mono-board">Loading chart…</div>}
          {error && <div className="py-4 text-center text-xs text-[var(--bear)] font-mono-board">{error}</div>}
          {!loading && !error && <Sparkline candles={history?.candles} />}
        </div>

        {entry && (
          <div className="grid grid-cols-1 gap-4 border-t border-[var(--hairline)] px-4 py-4 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
                <span>Confidence</span>
                <span className="font-mono-board text-[var(--ink)]">{entry.confidence}</span>
              </div>
              <Meter value={entry.confidence} tone="amber" />
              <div className="mt-3">
                <ReasonList title="Why this confidence score" reasons={entry.reasons?.confidence} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
                <span>Benefit</span>
                <span className="font-mono-board text-[var(--ink)]">{entry.benefit}</span>
              </div>
              <Meter value={entry.benefit} tone={entry.direction === "bearish" ? "bear" : "bull"} />
              <div className="mt-3">
                <ReasonList title="Why this benefit score" reasons={entry.reasons?.benefit} />
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-[var(--hairline)] px-4 py-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-2">Trading bot</div>
          {botPosition ? (
            <div className="font-mono-board text-xs text-[var(--ink)]">
              {botPosition.status === "open" ? (
                <>
                  <span className="text-[var(--amber)]">Open position</span> · entered ${botPosition.entryPrice?.toFixed(2)} ·
                  {" "}
                  <span style={{ color: botPosition.unrealizedPercent >= 0 ? "var(--bull)" : "var(--bear)" }}>
                    {formatPct(botPosition.unrealizedPercent)} unrealized
                  </span>{" "}
                  · held {formatDuration(Date.now() - botPosition.openedAt)}
                </>
              ) : (
                <>
                  <span className="text-[var(--ink-dim)]">Closed</span> · entered ${botPosition.entryPrice?.toFixed(2)}, exited $
                  {botPosition.exitPrice?.toFixed(2)} ·{" "}
                  <span style={{ color: botPosition.pnlPercent >= 0 ? "var(--bull)" : "var(--bear)" }}>
                    {formatPct(botPosition.pnlPercent)}
                  </span>{" "}
                  · {botPosition.exitReason}
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-[var(--ink-dim)] font-mono-board">
              No bot position on this ticker — confidence hasn&apos;t crossed {TAKE_THRESHOLD} yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardRow({ entry, onSelect }) {
  const dirColor = entry.direction === "bearish" ? "var(--bear)" : "var(--bull)";
  const chg = entry.changePercent;
  return (
    <button
      onClick={() => onSelect(entry.ticker)}
      className="flip-in grid w-full grid-cols-[3rem_5rem_1fr_1fr_5.5rem_4rem] items-center gap-3 sm:gap-4 border-b border-[var(--hairline)] px-3 sm:px-4 py-3 text-left transition-colors hover:bg-[var(--panel-2)]"
    >
      <div className="font-mono-board text-2xl font-bold" style={{ color: "var(--amber)" }}>
        {String(entry.rank).padStart(2, "0")}
      </div>

      <div>
        <div className="font-mono-board text-lg font-bold tracking-wide">{entry.ticker}</div>
        {entry.price != null && (
          <div className="font-mono-board text-[11px] text-[var(--ink-dim)]">
            ${entry.price.toFixed(2)}{" "}
            {chg != null && (
              <span style={{ color: dirColor }}>
                {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
          <span>Confidence</span>
          <span className="font-mono-board text-[var(--ink)]">{entry.confidence}</span>
        </div>
        <Meter value={entry.confidence} tone="amber" />
      </div>

      <div>
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
          <span>Benefit</span>
          <span className="font-mono-board text-[var(--ink)]">{entry.benefit}</span>
        </div>
        <Meter value={entry.benefit} tone={entry.direction === "bearish" ? "bear" : "bull"} />
      </div>

      <div>
        {entry.taken ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--amber)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-black">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
            Taken
          </span>
        ) : (
          <span className="inline-block rounded-sm border border-[var(--hairline)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--ink-dim)]">
            Watching
          </span>
        )}
      </div>

      <div className="flex gap-1 font-mono-board text-[10px] text-[var(--ink-dim)]">
        <span title="Reddit" className={entry.sources.reddit ? "text-[var(--amber)]" : "opacity-25"}>R</span>
        <span title="Yahoo Finance" className={entry.sources.yahoo ? "text-[var(--amber)]" : "opacity-25"}>Y</span>
        <span title="Discord alert" className={entry.sources.discord ? "text-[var(--amber)]" : "opacity-25"}>D</span>
      </div>
    </button>
  );
}

function BotPanel({ bot }) {
  const open = bot?.open || [];
  const closed = bot?.closed || [];

  return (
    <section className="mt-10 rounded-md border border-[var(--hairline)] bg-[var(--panel)]">
      <div className="border-b border-[var(--hairline)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--ink-dim)]">
        Paper-Trading Bot
      </div>

      <div className="px-4 py-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">
          Open positions ({open.length})
        </div>
        {open.length === 0 ? (
          <div className="text-xs text-[var(--ink-dim)] font-mono-board">No open positions right now.</div>
        ) : (
          <div className="space-y-2">
            {open.map((p) => (
              <div key={p.ticker} className="flex items-center justify-between font-mono-board text-xs">
                <span className="font-bold" style={{ color: "var(--amber)" }}>{p.ticker}</span>
                <span className="text-[var(--ink-dim)]">{p.direction}</span>
                <span className="text-[var(--ink-dim)]">${p.entryPrice?.toFixed(2)} → ${p.lastPrice?.toFixed(2)}</span>
                <span style={{ color: p.unrealizedPercent >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {formatPct(p.unrealizedPercent)}
                </span>
                <span className="text-[var(--ink-dim)]">{formatDuration(Date.now() - p.openedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div className="border-t border-[var(--hairline)] px-4 py-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">
            Recent closed trades
          </div>
          <div className="space-y-2">
            {closed.slice(0, 8).map((p) => (
              <div key={`${p.ticker}-${p.closedAt}`} className="flex items-center justify-between font-mono-board text-xs">
                <span className="font-bold text-[var(--ink)]">{p.ticker}</span>
                <span className="text-[var(--ink-dim)]">{p.direction}</span>
                <span style={{ color: p.pnlPercent >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {formatPct(p.pnlPercent)}
                </span>
                <span className="text-[var(--ink-dim)]">{p.exitReason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function Page() {
  const [board, setBoard] = useState([]);
  const [bot, setBot] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [persistent, setPersistent] = useState(true);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [errorMsg, setErrorMsg] = useState("");
  const [, setNowTick] = useState(Date.now());
  const [selectedTicker, setSelectedTicker] = useState(null);

  const [alertText, setAlertText] = useState("");
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [alertStatus, setAlertStatus] = useState(null); // { ok, message }
  const [submitting, setSubmitting] = useState(false);

  const pollRef = useRef(null);

  async function loadBoard() {
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load board");
      setBoard(data.board || []);
      setBot(data.bot || null);
      setUpdatedAt(data.updatedAt);
      setPersistent(data.persistent);
      setStatus("ok");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    loadBoard();
    pollRef.current = setInterval(loadBoard, REFRESH_MS);
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      clearInterval(pollRef.current);
      clearInterval(tick);
    };
  }, []);

  async function submitAlert(e) {
    e.preventDefault();
    if (!alertText.trim()) return;
    setSubmitting(true);
    setAlertStatus(null);
    try {
      const res = await fetch("/api/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: alertText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save that alert.");
      setAlertStatus({ ok: true, message: `Logged ${data.saved.ticker} (${data.saved.direction}). Board updates on next refresh.` });
      setAlertText("");
      loadBoard();
    } catch (err) {
      setAlertStatus({ ok: false, message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedEntry = board.find((b) => b.ticker === selectedTicker) || null;
  const selectedBotPosition = selectedTicker
    ? (bot?.open || []).map((p) => ({ ...p, status: "open" })).find((p) => p.ticker === selectedTicker) ||
      (bot?.closed || []).map((p) => ({ ...p, status: "closed" })).find((p) => p.ticker === selectedTicker) ||
      null
    : null;

  return (
    <main className="mx-auto max-w-4xl px-3 sm:px-6 py-8 sm:py-12">
      <header className="mb-8 flex items-end justify-between border-b border-[var(--hairline)] pb-4">
        <div>
          <h1 className="font-mono-board text-2xl sm:text-3xl font-black tracking-tight text-[var(--amber)]">
            SIGNAL&nbsp;DESK
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
            Live-ranked trade candidates · Reddit + Yahoo Finance + Discord alerts
          </p>
        </div>
        <div className="text-right font-mono-board text-[11px] text-[var(--ink-dim)]">
          <div className="flex items-center justify-end gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${status === "ok" ? "live-dot bg-[var(--bull)]" : status === "error" ? "bg-[var(--bear)]" : "bg-[var(--ink-dim)]"}`} />
            {status === "ok" ? "LIVE" : status === "error" ? "ERROR" : "LOADING"}
          </div>
          <div>{updatedAt ? timeAgo(updatedAt) : ""}</div>
        </div>
      </header>

      {status === "error" && (
        <div className="mb-6 rounded-sm border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-4 py-3 text-sm text-[var(--bear)]">
          Board failed to update: {errorMsg}
        </div>
      )}

      {!persistent && status === "ok" && (
        <div className="mb-6 rounded-sm border border-[var(--amber)]/30 bg-[var(--amber)]/5 px-4 py-3 text-xs text-[var(--ink-dim)]">
          Discord alert storage isn&apos;t persistent yet — set up Vercel KV (see README) so alerts and bot positions survive server restarts.
        </div>
      )}

      <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] overflow-hidden">
        <div className="grid grid-cols-[3rem_5rem_1fr_1fr_5.5rem_4rem] gap-3 sm:gap-4 border-b border-[var(--hairline)] bg-[var(--panel-2)] px-3 sm:px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">
          <div>Rank</div>
          <div>Ticker</div>
          <div>Confidence</div>
          <div>Benefit</div>
          <div>Status</div>
          <div>Src</div>
        </div>

        {status === "loading" && (
          <div className="px-4 py-10 text-center text-sm text-[var(--ink-dim)] font-mono-board">
            Scanning Reddit + Yahoo Finance…
          </div>
        )}

        {status === "ok" && board.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-[var(--ink-dim)] font-mono-board">
            No candidates found this cycle. Board refreshes automatically.
          </div>
        )}

        {board.map((entry) => (
          <BoardRow key={entry.ticker} entry={entry} onSelect={setSelectedTicker} />
        ))}
      </section>

      <p className="mt-3 text-[11px] text-[var(--ink-dim)] font-mono-board">
        Board always shows the current top 9 candidates, ranked best-to-worst — even on a slow day. Bot opens a
        paper position once confidence crosses {TAKE_THRESHOLD}. Click a ticker for its chart and score breakdown.
        Refreshes every minute.
      </p>

      <BotPanel bot={bot} />

      <section className="mt-10 rounded-md border border-[var(--hairline)] bg-[var(--panel)]">
        <button
          onClick={() => setAlertPanelOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-xs uppercase tracking-widest text-[var(--ink-dim)] hover:text-[var(--amber)] transition-colors"
        >
          <span>Log a Discord Alert</span>
          <span className="font-mono-board">{alertPanelOpen ? "−" : "+"}</span>
        </button>

        {alertPanelOpen && (
          <form onSubmit={submitAlert} className="border-t border-[var(--hairline)] px-4 py-4">
            <textarea
              value={alertText}
              onChange={(e) => setAlertText(e.target.value)}
              placeholder="Paste the alert exactly as posted, e.g. &ldquo;BUY QQQ 450C 8/15 @ 2.10 — momentum off open&rdquo;"
              rows={3}
              className="w-full resize-none rounded-sm border border-[var(--hairline)] bg-black/30 px-3 py-2 text-sm font-mono-board text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--amber)]"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !alertText.trim()}
                className="rounded-sm bg-[var(--amber)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
              >
                {submitting ? "Logging…" : "Log Alert"}
              </button>
              {alertStatus && (
                <span className={`text-xs ${alertStatus.ok ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                  {alertStatus.message}
                </span>
              )}
            </div>
          </form>
        )}
      </section>

      {selectedTicker && (
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
