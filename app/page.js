"use client";

import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";
import BoardRow from "./components/BoardRow";
import AlertPanel from "./components/AlertPanel";
import BotPanel from "./components/BotPanel";
import TickerDetail from "./components/TickerDetail";
import NotificationBell from "./components/NotificationBell";
import HowItWorks from "./components/HowItWorks";

// Polls fast (was 5min, then 1min) per request — kept the candidate pool
// modest in app/api/scores/route.js to stay under Yahoo's informal rate
// limits at this cadence. If you start seeing "ERROR" flashes, back this off
// first.
const REFRESH_MS = 15 * 1000;

const MIN_VIEWERS = 45;
const MAX_VIEWERS = 56;

// Ambient "who's watching" flourish — not a real visitor count, just a
// slow-drifting number in a fixed band so the board doesn't feel static.
function useActiveViewers() {
  const [count, setCount] = useState(() => MIN_VIEWERS + Math.floor(Math.random() * (MAX_VIEWERS - MIN_VIEWERS + 1)));

  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    function tick() {
      const delay = 3000 + Math.random() * 4000;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setCount((c) => {
          const step = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.2 ? 2 : 1);
          return Math.max(MIN_VIEWERS, Math.min(MAX_VIEWERS, c + step));
        });
        tick();
      }, delay);
    }
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return count;
}

function BoardList({ title, pillLabel, pillColor, entries, status, onSelect }) {
  return (
    <div>
      <div className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] bg-[var(--panel-2)] px-3 py-2">
          <span
            className="rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black"
            style={{ background: pillColor }}
          >
            {pillLabel}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">{title}</span>
        </div>

        {status === "loading" && (
          <div className="px-4 py-10 text-center text-xs text-[var(--ink-dim)] font-mono-board">Scanning…</div>
        )}

        {status === "ok" && entries.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-[var(--ink-dim)] font-mono-board">
            No {pillLabel.toLowerCase()} candidates this cycle.
          </div>
        )}

        {entries.map((entry) => (
          <BoardRow key={entry.ticker} entry={entry} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [boardBuy, setBoardBuy] = useState([]);
  const [boardSell, setBoardSell] = useState([]);
  const [botA, setBotA] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [persistent, setPersistent] = useState(true);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [errorMsg, setErrorMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [, setNowTick] = useState(Date.now());
  const [selectedTicker, setSelectedTicker] = useState(null);
  const viewers = useActiveViewers();

  const [alertText, setAlertText] = useState("");
  const [alertStatus, setAlertStatus] = useState(null); // { ok, message }
  const [submitting, setSubmitting] = useState(false);

  const pollRef = useRef(null);
  const isFetchingRef = useRef(false);

  async function loadBoard({ background = false } = {}) {
    if (isFetchingRef.current) return; // don't overlap requests at a 15s cadence
    isFetchingRef.current = true;
    if (background) setRefreshing(true);
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load board");
      setBoardBuy(data.boardBuy || []);
      setBoardSell(data.boardSell || []);
      setBotA(data.botA || null);
      setUpdatedAt(data.updatedAt);
      setPersistent(data.persistent);
      setStatus("ok");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    } finally {
      isFetchingRef.current = false;
      if (background) setRefreshing(false);
    }
  }

  useEffect(() => {
    loadBoard();
    pollRef.current = setInterval(() => loadBoard({ background: true }), REFRESH_MS);
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

  const board = [...boardBuy, ...boardSell];
  const selectedEntry = board.find((b) => b.ticker === selectedTicker) || null;
  const selectedBotPosition = selectedTicker
    ? (botA?.open || []).map((p) => ({ ...p, status: "open" })).find((p) => p.ticker === selectedTicker) ||
      (botA?.closed || []).map((p) => ({ ...p, status: "closed" })).find((p) => p.ticker === selectedTicker) ||
      null
    : null;

  return (
    <main className="mx-auto max-w-7xl px-3 sm:px-6 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--hairline)] pb-4">
        <div>
          <h1 className="font-mono-board text-2xl sm:text-3xl font-black tracking-tight text-[var(--amber)]">
            PIZZAS&nbsp;SHECKLES
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
            Pizza money, ranked live · Reddit + Yahoo Finance + analyst ratings + Discord alerts
          </p>
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right font-mono-board text-[11px] text-[var(--ink-dim)]">
            <div className="flex items-center justify-end gap-1.5">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--ink-dim)]" />
              {viewers} watching
            </div>
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${status === "ok" ? "live-dot bg-[var(--bull)]" : status === "error" ? "bg-[var(--bear)]" : "bg-[var(--ink-dim)]"}`} />
              {status === "ok" ? (refreshing ? "REFRESHING" : "LIVE") : status === "error" ? "ERROR" : "LOADING"}
            </div>
            <div>{updatedAt ? timeAgo(updatedAt) : ""}</div>
          </div>
          <NotificationBell />
        </div>
      </header>

      {status === "error" && (
        <div className="mb-6 rounded-sm border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-4 py-3 text-sm text-[var(--bear)]">
          Board failed to update: {errorMsg}
        </div>
      )}

      {!persistent && status === "ok" && (
        <div className="mb-6 rounded-sm border border-[var(--amber)]/30 bg-[var(--amber)]/5 px-4 py-3 text-xs text-[var(--ink-dim)]">
          Storage isn&apos;t persistent yet — set up Vercel KV (see README) so alerts, bot positions, and weights
          survive server restarts.
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BoardList
              title="Top 9 candidates"
              pillLabel="Buy"
              pillColor="var(--bull)"
              entries={boardBuy}
              status={status}
              onSelect={setSelectedTicker}
            />
            <BoardList
              title="Top 9 candidates"
              pillLabel="Sell"
              pillColor="var(--bear)"
              entries={boardSell}
              status={status}
              onSelect={setSelectedTicker}
            />
          </div>

          <p className="mt-3 text-[11px] text-[var(--ink-dim)] font-mono-board">
            Each list always shows the current top 9 by direction, ranked best-to-worst — even on a slow day. Click a
            ticker for its chart and score breakdown. Refreshes every {REFRESH_MS / 1000}s — how it all works is
            explained in the panel to the right.
          </p>
        </section>

        <div className="flex flex-col gap-6">
          <AlertPanel
            alertText={alertText}
            setAlertText={setAlertText}
            onSubmit={submitAlert}
            submitting={submitting}
            alertStatus={alertStatus}
          />
          <BotPanel title="Bot A — Paper Trading" book={botA} />
          <HowItWorks refreshSeconds={REFRESH_MS / 1000} />
        </div>
      </div>

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
