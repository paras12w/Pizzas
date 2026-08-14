"use client";

import { formatDuration, formatPct, formatUsd } from "@/lib/format";
import { TickerDecal } from "./ui";

export default function BotPanel({ title = "Paper-Trading Bot", book }) {
  const open = book?.open || [];
  const closed = book?.closed || [];
  const cash = book?.cash;
  const equity = book?.equity;

  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
        <div className="text-xs uppercase tracking-widest text-[var(--ink-dim)]">{title}</div>
        {equity != null && (
          <div className="font-mono-board text-xs text-[var(--ink)]">
            {formatUsd(equity)} <span className="text-[var(--ink-dim)]">equity</span>
          </div>
        )}
      </div>

      {cash != null && (
        <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-2 font-mono-board text-[11px] text-[var(--ink-dim)]">
          <span>Cash: {formatUsd(cash)}</span>
          <span style={{ color: equity >= 10000 ? "var(--bull)" : "var(--bear)" }}>
            {equity != null ? formatPct(((equity - 10000) / 10000) * 100) : "—"} all-time
          </span>
        </div>
      )}

      <div className="px-4 py-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">
          Open positions ({open.length})
        </div>
        {open.length === 0 ? (
          <div className="text-xs text-[var(--ink-dim)] font-mono-board">No open positions right now.</div>
        ) : (
          <div className="space-y-2">
            {open.map((p) => (
              <div key={p.ticker} className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-board text-xs">
                <TickerDecal ticker={p.ticker} size={18} />
                <span className="font-bold" style={{ color: "var(--amber)" }}>{p.ticker}</span>
                {p.instrument === "option" && (
                  <span className="rounded-sm border border-[var(--hairline)] px-1 text-[9px] text-[var(--ink-dim)]">OPT</span>
                )}
                <span className="text-[var(--ink-dim)]">{p.direction}</span>
                <span className="text-[var(--ink-dim)]">{formatUsd(p.sizeUsd)} ({p.sizePct}%)</span>
                <span style={{ color: p.unrealizedPercent >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {formatPct(p.unrealizedPercent)}
                </span>
                <span className="text-[var(--ink-dim)]">{formatDuration(Date.now() - p.openedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--hairline)] px-4 py-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">
          Trade history
        </div>
        {closed.length === 0 ? (
          <div className="text-xs text-[var(--ink-dim)] font-mono-board">No closed trades yet.</div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {closed.map((p) => (
              <div key={`${p.ticker}-${p.closedAt}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-board text-xs">
                <TickerDecal ticker={p.ticker} size={18} />
                <span className="font-bold text-[var(--ink)]">{p.ticker}</span>
                {p.instrument === "option" && (
                  <span className="rounded-sm border border-[var(--hairline)] px-1 text-[9px] text-[var(--ink-dim)]">OPT</span>
                )}
                <span className="text-[var(--ink-dim)]">{p.direction}</span>
                <span style={{ color: (p.pnlUsd || 0) >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {formatUsd(p.pnlUsd)} ({formatPct(p.pnlPercent)})
                </span>
                <span className="text-[var(--ink-dim)]">{p.exitReason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
