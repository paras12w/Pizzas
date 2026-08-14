"use client";

import { formatScore } from "@/lib/format";
import { Meter, TickerDecal, TrendBadge } from "./ui";

export default function BoardRow({ entry, onSelect }) {
  const dirColor = entry.direction === "bearish" ? "var(--bear)" : "var(--bull)";
  const chg = entry.changePercent;
  const isTop = entry.rank === 1;

  return (
    <button
      onClick={() => onSelect(entry.ticker)}
      className={`flip-in grid w-full grid-cols-[3rem_5.5rem_1fr_1fr_5.5rem_4rem] items-center gap-3 sm:gap-4 border-b border-[var(--hairline)] px-3 sm:px-4 py-3 text-left transition-colors hover:bg-[var(--panel-2)] ${isTop ? "bg-[var(--amber)]/[0.05]" : ""}`}
      style={{ borderLeft: `3px solid ${dirColor}66` }}
    >
      <div
        className="font-mono-board text-2xl font-bold"
        style={{
          color: isTop ? "var(--amber)" : entry.rank <= 3 ? "var(--amber)" : "var(--ink-dim)",
          opacity: isTop ? 1 : entry.rank <= 3 ? 0.85 : 0.6,
          textShadow: isTop ? "0 0 14px rgba(242,169,59,0.5)" : "none",
        }}
      >
        {String(entry.rank).padStart(2, "0")}
      </div>

      <div className="flex items-center gap-2">
        <TickerDecal ticker={entry.ticker} size={26} />
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
      </div>

      <div>
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
          <span>Confidence</span>
          <span className="font-mono-board text-[var(--ink)] flex items-center gap-1.5">
            {formatScore(entry.confidence)}
            <span className="text-[10px]"><TrendBadge trend={entry.trend} /></span>
          </span>
        </div>
        <Meter value={entry.confidence} tone="amber" />
      </div>

      <div>
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-[var(--ink-dim)] mb-1">
          <span>Benefit</span>
          <span className="font-mono-board text-[var(--ink)]">{formatScore(entry.benefit)}</span>
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
