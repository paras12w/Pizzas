"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

const LABELS = {
  redditStrength: "Reddit mention strength",
  cashtagStrength: "Cashtag density",
  mentionBreadth: "Mention breadth",
  momentum: "Price momentum",
  volume: "Volume conviction",
  rangePosition: "Day-range position",
  sentiment: "Reddit sentiment",
  discord: "Discord alert",
  iv: "Implied volatility",
  skew: "Put/call skew",
};

function WeightBar({ label, value, defaultValue }) {
  const pct = Math.round(value * 1000) / 10;
  const defaultPct = Math.round(defaultValue * 1000) / 10;
  const moved = Math.abs(pct - defaultPct) >= 0.2;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-[var(--ink)]">{label}</span>
        <span className="font-mono-board text-[var(--ink-dim)]">
          {pct}% {moved && <span style={{ color: pct > defaultPct ? "var(--bull)" : "var(--bear)" }}>({pct > defaultPct ? "+" : ""}{Math.round((pct - defaultPct) * 10) / 10} vs default)</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
        <div className="h-full rounded-full bg-[var(--amber)] transition-all duration-700" style={{ width: `${Math.min(100, pct * 3)}%` }} />
      </div>
    </div>
  );
}

export default function WeightsPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/weights", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
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
        <h1 className="font-mono-board text-2xl font-black tracking-tight text-[var(--amber)]">SCORING WEIGHTS</h1>
        <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
          What each signal contributes to Confidence/Benefit right now, and how it&apos;s drifted from the hand-picked
          defaults. Once Bot A has 15+ closed trades, weights recalibrate automatically — components that correlated
          with winners get nudged up, everything else gets nudged down.
        </p>
      </header>

      {status === "loading" && <div className="text-sm text-[var(--ink-dim)] font-mono-board">Loading…</div>}
      {status === "error" && <div className="text-sm text-[var(--bear)] font-mono-board">Failed to load weights.</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] p-4">
              <div className="mb-3 text-xs uppercase tracking-widest text-[var(--ink-dim)]">Confidence</div>
              <div className="space-y-3">
                {Object.entries(data.current.confidence).map(([key, value]) => (
                  <WeightBar key={key} label={LABELS[key] || key} value={value} defaultValue={data.default.confidence[key]} />
                ))}
              </div>
            </section>
            <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] p-4">
              <div className="mb-3 text-xs uppercase tracking-widest text-[var(--ink-dim)]">Benefit</div>
              <div className="space-y-3">
                {Object.entries(data.current.benefit).map(([key, value]) => (
                  <WeightBar key={key} label={LABELS[key] || key} value={value} defaultValue={data.default.benefit[key]} />
                ))}
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-md border border-[var(--hairline)] bg-[var(--panel)]">
            <div className="border-b border-[var(--hairline)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--ink-dim)]">
              Recalibration history
            </div>
            {data.history.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--ink-dim)] font-mono-board">
                No recalibrations yet — needs 15+ of Bot A&apos;s closed trades before the first pass runs.
              </div>
            ) : (
              <div className="divide-y divide-[var(--hairline)]">
                {data.history.map((h, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-mono-board text-[var(--ink-dim)]">{timeAgo(new Date(h.at).toISOString())}</span>
                      <span className="text-[var(--ink-dim)]">sample: {h.sampleSize} trades</span>
                    </div>
                    <ul className="space-y-1">
                      {h.changes.map((c, j) => (
                        <li key={j} className="flex items-center justify-between font-mono-board text-xs">
                          <span>{LABELS[c.key] || c.key} <span className="text-[var(--ink-dim)]">({c.scoreType})</span></span>
                          <span>
                            {Math.round(c.before * 1000) / 10}% → {Math.round(c.after * 1000) / 10}%{" "}
                            <span className="text-[var(--ink-dim)]">(r={c.correlation})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
