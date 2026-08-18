"use client";

import { TAKE_THRESHOLD, ALERT_MIN_CONFIDENCE, MIN_TRADABLE_PRICE, MIN_AVG_VOLUME, EXTREME_MOVE_PCT } from "@/lib/scoring";
import { BOT_CONFIGS } from "@/lib/bot";

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono-board text-[10px] font-bold text-black"
        style={{ background: "var(--amber)" }}
      >
        {n}
      </div>
      <div>
        <div className="text-xs font-bold text-[var(--ink)]">{title}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink-dim)]">{children}</p>
      </div>
    </div>
  );
}

// Every number here is pulled straight from the live config (or passed in
// from the poller that actually uses it), not hand-typed, so this can't
// silently drift out of sync with what Bot A actually does.
export default function HowItWorks({ refreshSeconds }) {
  const a = BOT_CONFIGS.a;
  const b = BOT_CONFIGS.b;
  const holdHours = Math.round(a.maxHoldMs / 3600000);

  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)]">
      <div className="border-b border-[var(--hairline)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--ink-dim)]">
        How This Works
      </div>
      <div className="space-y-4 px-4 py-4">
        <Step n="1" title="Discovery">
          Scans Reddit (r/wallstreetbets + friends) for ticker mentions, tone, and hype, plus Yahoo&apos;s live
          movers, analyst ratings, multi-day trend structure (price vs. its 50/200-day averages and 52-week range),
          and the most recent news headline, every {refreshSeconds}s.
        </Step>
        <Step n="2" title="Filters">
          Anything under ${MIN_TRADABLE_PRICE} (penny-stock risk), under {Math.round(MIN_AVG_VOLUME / 1000)}K avg
          volume (thin liquidity), or moving more than {EXTREME_MOVE_PCT}% (likely a halt gap or bad data) gets
          excluded before scoring — even if it came with a Discord alert.
        </Step>
        <Step n="3" title="Scoring">
          Each surviving ticker gets a Confidence score (0–100, how much the signals agree) and a Benefit score
          (0–100, how favorable the setup looks). Bullish ones rank on Buy, bearish ones on Sell.
        </Step>
        <Step n="4" title="Entry">
          Bot A opens a position once Confidence crosses <strong className="text-[var(--ink)]">{TAKE_THRESHOLD}</strong>.
          Any logged Discord alert always clears that (floored to {ALERT_MIN_CONFIDENCE}). Size scales{" "}
          {Math.round(a.minSizePct * 100)}–{Math.round(a.maxSizePct * 100)}% of current bankroll with how strong the
          entry was.
        </Step>
        <Step n="5" title="Exit">
          Closes on a <strong className="text-[var(--ink)]">{a.stopLossPct}% stop-loss</strong>, a{" "}
          <strong className="text-[var(--ink)]">{a.takeProfitPct}% take-profit</strong>, the ticker falling off its
          list, confidence decaying below {a.exitThreshold}, or a {holdHours}h max hold — whichever comes first.
        </Step>
      </div>
      <div className="border-t border-[var(--hairline)] px-4 py-2 text-[10px] text-[var(--ink-dim)]">
        Bot B runs the same playbook with looser entry ({b.takeThreshold}), a wider stop/target, and bigger sizing —{" "}
        <span className="text-[var(--ink-dim)]">see the Bot B tab.</span>
      </div>
    </section>
  );
}
