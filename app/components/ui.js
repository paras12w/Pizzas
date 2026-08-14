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

// Literal list-position movement — entry.rankTrend is { delta, direction }
// (delta = spots moved, positive = climbed the list) from app/api/scores.
// Shows "NEW" for a ticker that wasn't on this list last cycle at all,
// since there's no prior rank to compare against yet.
export function RankMoveBadge({ rankTrend, isNewEntrant }) {
  if (isNewEntrant) {
    return (
      <span className="rounded-sm bg-[var(--amber)]/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--amber)]">
        New
      </span>
    );
  }
  if (!rankTrend || rankTrend.direction === "flat") {
    return <span className="text-[var(--ink-dim)] opacity-50">–</span>;
  }
  if (rankTrend.direction === "up") {
    return <span style={{ color: "var(--bull)" }}>▲{rankTrend.delta}</span>;
  }
  return <span style={{ color: "var(--bear)" }}>▼{Math.abs(rankTrend.delta)}</span>;
}

// Two overlaid equity curves on one chart, with a dashed break-even
// reference line at the shared starting balance.
export function DualLineChart({ seriesA, seriesB, labelA, labelB, colorA = "var(--amber)", colorB = "var(--bull)", baseline }) {
  const hasData = (seriesA?.length || 0) > 1 || (seriesB?.length || 0) > 1;
  if (!hasData) {
    return (
      <div className="flex h-56 items-center justify-center text-xs text-[var(--ink-dim)] font-mono-board">
        Not enough closed trades yet to chart.
      </div>
    );
  }

  const w = 700;
  const h = 220;
  const pad = 12;
  const allValues = [...(seriesA || []), ...(seriesB || []), baseline].filter((v) => v != null);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const y = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
  const toPoints = (series) =>
    (series || [])
      .map((v, i) => {
        const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
        return `${x.toFixed(1)},${y(v).toFixed(1)}`;
      })
      .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full" preserveAspectRatio="none">
        {baseline != null && (
          <line x1={pad} y1={y(baseline)} x2={w - pad} y2={y(baseline)} stroke="var(--hairline)" strokeDasharray="4 4" strokeWidth="1" />
        )}
        <polyline points={toPoints(seriesA)} fill="none" stroke={colorA} strokeWidth="2.5" />
        <polyline points={toPoints(seriesB)} fill="none" stroke={colorB} strokeWidth="2.5" />
      </svg>
      <div className="mt-2 flex items-center justify-center gap-6 text-[11px] font-mono-board">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorA }} /> {labelA}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorB }} /> {labelB}
        </span>
      </div>
    </div>
  );
}
