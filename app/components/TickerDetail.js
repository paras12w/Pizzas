"use client";

import { useEffect, useState } from "react";
import { TAKE_THRESHOLD } from "@/lib/scoring";
import { formatDuration, formatPct, formatScore } from "@/lib/format";
import { Meter, ReasonList, Sparkline, TickerDecal } from "./ui";

export default function TickerDetail({ ticker, entry, botPosition, onClose }) {
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

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-8 sm:px-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-md border border-[var(--hairline)] bg-[var(--panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
          <div className="flex items-center gap-3">
            <TickerDecal ticker={ticker} size={36} />
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
                <span className="font-mono-board text-[var(--ink)]">{formatScore(entry.confidence)}</span>
              </div>
              <Meter value={entry.confidence} tone="amber" />
              <div className="mt-3">
                <ReasonList title="Why this confidence score" reasons={entry.reasons?.confidence} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
                <span>Benefit</span>
                <span className="font-mono-board text-[var(--ink)]">{formatScore(entry.benefit)}</span>
              </div>
              <Meter value={entry.benefit} tone={entry.direction === "bearish" ? "bear" : "bull"} />
              <div className="mt-3">
                <ReasonList title="Why this benefit score" reasons={entry.reasons?.benefit} />
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-[var(--hairline)] px-4 py-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-2">Bot A position</div>
          {botPosition ? (
            <div className="font-mono-board text-xs text-[var(--ink)]">
              {botPosition.status === "open" ? (
                <>
                  <span className="text-[var(--amber)]">Open</span> · ${botPosition.sizeUsd?.toFixed(2)} ({botPosition.sizePct}% of bankroll) at entry ${botPosition.entryPrice?.toFixed(2)} ·
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
              No Bot A position on this ticker — confidence hasn&apos;t crossed {TAKE_THRESHOLD} yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
