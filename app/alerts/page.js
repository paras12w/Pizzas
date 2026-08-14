"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { TickerDecal } from "../components/ui";

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
      <header className="mb-8 border-b border-[var(--hairline)] pb-4">
        <h1 className="font-mono-board text-2xl font-black tracking-tight text-[var(--amber)]">ALERT LOG</h1>
        <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
          Every Discord alert ever submitted, most recent first — not just the ones still live-scoring on the board.
        </p>
      </header>

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
