"use client";

import { tickerHue } from "@/lib/format";

export function Meter({ value, tone }) {
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

export function ReasonList({ title, reasons }) {
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

export function Sparkline({ candles }) {
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

// Small colored "decal" badge next to a ticker symbol — a deterministic hue
// per ticker (not a real company logo) purely so the board reads as more
// than a monochrome list.
export function TickerDecal({ ticker, size = 28 }) {
  const hue = tickerHue(ticker || "");
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md font-mono-board font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue}, 60%, 22%)`,
        color: `hsl(${hue}, 85%, 72%)`,
        border: `1px solid hsl(${hue}, 60%, 35%)`,
      }}
    >
      {(ticker || "?").slice(0, 2)}
    </div>
  );
}

// Up/down/flat indicator comparing this cycle's confidence to last cycle's —
// entry.trend is { delta, direction } from app/api/scores, or null on the
// first cycle after a cold start (nothing to compare against yet).
export function TrendBadge({ trend }) {
  if (!trend) return <span className="text-[var(--ink-dim)] opacity-40">·</span>;
  if (trend.direction === "up") {
    return <span style={{ color: "var(--bull)" }}>▲ {trend.delta.toFixed(1)}</span>;
  }
  if (trend.direction === "down") {
    return <span style={{ color: "var(--bear)" }}>▼ {Math.abs(trend.delta).toFixed(1)}</span>;
  }
  return <span className="text-[var(--ink-dim)]">flat</span>;
}
