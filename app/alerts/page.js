"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { TickerDecal } from "../components/ui";

function ResetButton() {
  const [armed, setArmed] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | done | error

  async function fire() {
    setStatus("working");
    try {
      const res = await fetch("/api/admin/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed.");
      setStatus("done");
      setArmed(false);
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return <div className="text-xs text-[var(--bull)]">Reset complete — alerts cleared, both bots back to a clean $10,000.</div>;
  }

  return (
    <div className="flex items-center gap-2">
      {armed ? (
        <>
          <button
            onClick={fire}
            disabled={status === "working"}
            className="rounded-sm bg-[var(--bear)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
          >
            {status === "working" ? "Resetting…" : "Confirm reset"}
          </button>
          <button onClick={() => setArmed(false)} className="text-xs text-[var(--ink-dim)] hover:text-[var(--ink)]">
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setArmed(true)}
          className="rounded-sm border border-[var(--bear)]/50 px-3 py-1.5 text-xs uppercase tracking-wider text-[var(--bear)] hover:bg-[var(--bear)]/10"
        >
          Reset test data
        </button>
      )}
      {status === "error" && <span className="text-xs text-[var(--bear)]">Failed — try again.</span>}
    </div>
  );
}

export default function AlertsPage() {
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/alerts-history", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setHistory(json.history || []);
        setStatus("ok");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-6 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--hairline)] pb-4">
        <div>
          <h1 className="font-mono-board text-2xl font-black tracking-tight text-[var(--amber)]">ALERT LOG</h1>
          <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
            Every Discord alert ever submitted, most recent first — not just the ones still live-scoring on the board.
          </p>
        </div>
        <ResetButton />
      </header>
      <p className="-mt-4 mb-8 text-[11px] text-[var(--ink-dim)]">
        Reset clears every logged alert (live + history) and resets Bot A and Bot B to a clean $10,000 — use this
        after testing, not mid-session with real trades open.
      </p>

      {status === "loading" && <div className="text-sm text-[var(--ink-dim)] font-mono-board">Loading…</div>}
      {status === "error" && <div className="text-sm text-[var(--bear)] font-mono-board">Failed to load alert history.</div>}

      {status === "ok" && history.length === 0 && (
        <div className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] px-4 py-10 text-center text-sm text-[var(--ink-dim)] font-mono-board">
          No alerts logged yet.
        </div>
      )}

      {status === "ok" && history.length > 0 && (
        <div className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] overflow-hidden">
          {history.map((a, i) => (
            <div key={`${a.ticker}-${a.postedAt}-${i}`} className="flex items-start gap-3 border-b border-[var(--hairline)] px-4 py-3 last:border-b-0">
              <TickerDecal ticker={a.ticker} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-mono-board text-sm">
                  <span className="font-bold">{a.ticker}</span>
                  <span style={{ color: a.direction === "bearish" ? "var(--bear)" : "var(--bull)" }} className="text-xs uppercase">
                    {a.direction}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--ink-dim)]">{timeAgo(new Date(a.postedAt).toISOString())}</span>
                </div>
                {a.note && <div className="mt-1 truncate text-xs text-[var(--ink-dim)]">{a.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
