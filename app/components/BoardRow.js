"use client";

import { formatScore } from "@/lib/format";
import { Meter, TickerDecal, RankMoveBadge } from "./ui";

export default function BoardRow({ entry, onSelect }) {
  const dirColor = entry.direction === "bearish" ? "var(--bear)" : "var(--bull)";
  const chg = entry.changePercent;
  const isTop = entry.rank === 1;

  return (
    <button
      onClick={() => onSelect(entry.ticker)}
      className={`flip-in flex w-full flex-col gap-1.5 border-b border-[var(--hairline)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-2)] ${isTop ? "bg-[var(--amber)]/[0.05]" : ""}`}
      style={{ borderLeft: `3px solid ${dirColor}66` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-5 shrink-0 font-mono-board text-sm font-bold"
          style={{
            color: entry.rank <= 3 ? "var(--amber)" : "var(--ink-dim)",
            opacity: isTop ? 1 : entry.rank <= 3 ? 0.85 : 0.6,
            textShadow: isTop ? "0 0 10px rgba(242,169,59,0.5)" : "none",
          }}
        >
          {String(entry.rank).padStart(2, "0")}
        </span>

        <TickerDecal ticker={entry.ticker} size={22} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono-board text-sm font-bold tracking-wide">{entry.ticker}</span>
            {entry.taken && (
              <span
                className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber)]"
                title="Taken by Bot A"
              />
            )}
          </div>
          {entry.price != null && (
            <div className="font-mono-board text-[10px] text-[var(--ink-dim)]">
              ${entry.price.toFixed(2)}{" "}
              {chg != null && (
                <span style={{ color: dirColor }}>
                  {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 font-mono-board text-[11px]">
          <RankMoveBadge rankTrend={entry.rankTrend} isNewEntrant={entry.isNewEntrant} />
        </div>
      </div>

      <div className="flex items-center gap-3 pl-7">
        <div className="flex-1">
          <div className="mb-0.5 flex justify-between text-[9px] uppercase tracking-widest text-[var(--ink-dim)]">
            <span>Conf</span>
            <span className="font-mono-board text-[var(--ink)]">{formatScore(entry.confidence)}</span>
          </div>
          <Meter value={entry.confidence} tone="amber" />
        </div>
        <div className="flex-1">
          <div className="mb-0.5 flex justify-between text-[9px] uppercase tracking-widest text-[var(--ink-dim)]">
            <span>Ben</span>
            <span className="font-mono-board text-[var(--ink)]">{formatScore(entry.benefit)}</span>
          </div>
          <Meter value={entry.benefit} tone={entry.direction === "bearish" ? "bear" : "bull"} />
        </div>
      </div>
    </button>
  );
}
