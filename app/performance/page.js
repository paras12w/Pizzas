"use client";

import { useEffect, useState } from "react";
import { formatPct, formatUsd, timeAgo } from "@/lib/format";
import { Sparkline } from "../components/ui";

function StatTile({ label, value, tone }) {
  const color = tone === "bull" ? "var(--bull)" : tone === "bear" ? "var(--bear)" : "var(--ink)";
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">{label}</div>
      <div className="mt-1 font-mono-board text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function BotSummary({ label, data }) {
  if (!data) return null;
  const { stats } = data;
  const allTimePct = stats.equity != null ? ((stats.equity - stats.startingCash) / stats.startingCash) * 100 : null;

  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono-board text-sm font-bold text-[var(--amber)]">{label}</div>
        <div className="font-mono-board text-sm text-[var(--ink)]">{formatUsd(stats.equity)}</div>
      </div>

      <div className="mb-4">
        <Sparkline candles={stats.equityCurve.map((e) => ({ close: e.equity }))} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="All-time" value={formatPct(allTimePct)} tone={allTimePct >= 0 ? "bull" : "bear"} />
        <StatTile label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} />
        <StatTile label="Closed trades" value={stats.closedCount} />
        <StatTile label="Open positions" value={stats.openCount} />
        <StatTile label="Avg win" value={formatUsd(stats.avgWinUsd)} tone="bull" />
        <StatTile label="Avg loss" value={formatUsd(stats.avgLossUsd)} tone="bear" />
        <StatTile label="Realized P&L" value={formatUsd(stats.totalRealizedUsd)} tone={stats.totalRealizedUsd >= 0 ? "bull" : "bear"} />
        <StatTile label="Unrealized P&L" value={formatUsd(stats.openUnrealizedUsd)} tone={stats.openUnrealizedUsd >= 0 ? "bull" : "bear"} />
      </div>

      {(stats.bestTrade || stats.worstTrade) && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {stats.bestTrade && (
            <div className="rounded-sm border border-[var(--hairline)] px-3 py-2 font-mono-board text-xs">
              <span className="text-[var(--ink-dim)]">Best: </span>
              <span className="font-bold">{stats.bestTrade.ticker}</span>{" "}
              <span style={{ color: "var(--bull)" }}>{formatUsd(stats.bestTrade.pnlUsd)}</span>
            </div>
          )}
          {stats.worstTrade && (
            <div className="rounded-sm border border-[var(--hairline)] px-3 py-2 font-mono-board text-xs">
              <span className="text-[var(--ink-dim)]">Worst: </span>
              <span className="font-bold">{stats.worstTrade.ticker}</span>{" "}
              <span style={{ color: "var(--bear)" }}>{formatUsd(stats.worstTrade.pnlUsd)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function PerformancePage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/performance", { cache: "no-store" })
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return;
          if (json.error) throw new Error(json.error);
          setData(json);
          setUpdatedAt(new Date().toISOString());
          setStatus("ok");
        })
        .catch(() => !cancelled && setStatus("error"));
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-3 sm:px-6 py-8 sm:py-12">
      <header className="mb-8 border-b border-[var(--hairline)] pb-4">
        <h1 className="font-mono-board text-2xl font-black tracking-tight text-[var(--amber)]">PERFORMANCE</h1>
        <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
          Both bots start from a simulated $10,000 bankroll. Equity curve replays realized P&amp;L trade-by-trade —
          {" "}{updatedAt ? timeAgo(updatedAt) : ""}
        </p>
      </header>

      {status === "loading" && <div className="text-sm text-[var(--ink-dim)] font-mono-board">Loading…</div>}
      {status === "error" && <div className="text-sm text-[var(--bear)] font-mono-board">Failed to load performance data.</div>}

      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BotSummary label="Bot A (featured)" data={data.a} />
          <BotSummary label="Bot B (experimental)" data={data.b} />
        </div>
      )}
    </main>
  );
}
