"use client";

import { useEffect, useState } from "react";
import BotPanel from "../components/BotPanel";

export default function BotBPage() {
  const [botB, setBotB] = useState(null);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/scores", { cache: "no-store" })
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return;
          if (json.error) throw new Error(json.error);
          setBotB(json.botB || null);
          setConfig(json.botConfigs?.b || null);
          setStatus("ok");
        })
        .catch(() => !cancelled && setStatus("error"));
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-3 sm:px-6 py-8 sm:py-12">
      <header className="mb-8 border-b border-[var(--hairline)] pb-4">
        <h1 className="font-mono-board text-2xl font-black tracking-tight text-[var(--amber)]">BOT B</h1>
        <p className="mt-1 text-xs sm:text-sm text-[var(--ink-dim)]">
          Experimental variant, kept off the main board on purpose — this is the &ldquo;B&rdquo; side of an A/B test, not (yet)
          a claim that it&apos;s better. Compare its results against Bot A on the Performance tab.
        </p>
        {config && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono-board text-[11px] text-[var(--ink-dim)]">
            <span>Take threshold: {config.takeThreshold}</span>
            <span>Exit threshold: {config.exitThreshold}</span>
            <span>Max hold: {Math.round(config.maxHoldMs / 3600000)}h</span>
            <span>Sizing: {Math.round(config.minSizePct * 100)}%–{Math.round(config.maxSizePct * 100)}%</span>
          </div>
        )}
      </header>

      {status === "loading" && <div className="text-sm text-[var(--ink-dim)] font-mono-board">Loading…</div>}
      {status === "error" && <div className="text-sm text-[var(--bear)] font-mono-board">Failed to load Bot B.</div>}

      {botB && <BotPanel title="Bot B — Experimental" book={botB} />}
    </main>
  );
}
