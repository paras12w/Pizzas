"use client";

import { Alert } from "@/lib/types";

const SOURCE_COLORS: Record<string, string> = {
  discord: "text-amber",
  reddit: "text-red",
  yahoo: "text-green",
};

export default function SignalFeed({ alerts, threshold }: { alerts: Alert[]; threshold: number }) {
  return (
    <div className="border border-line bg-panel">
      <div className="text-amber text-xs tracking-widest uppercase p-4 pb-2 flex justify-between items-center">
        <span>◆ signal feed</span>
        <span className="text-paper/40 text-[10px] normal-case">trade threshold: {(threshold * 100).toFixed(0)}%</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y divide-line/50">
        {alerts.length === 0 && <div className="p-4 text-paper/40 text-sm">no signals yet</div>}
        {alerts.map((a) => (
          <div key={a.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <span className={`text-[10px] uppercase w-14 ${SOURCE_COLORS[a.source] ?? "text-paper"}`}>
                {a.source}
              </span>
              <span className="font-semibold">{a.ticker}</span>
              <span className="text-paper/50 uppercase text-xs">{a.direction}</span>
              {a.note && <span className="text-paper/40 text-xs truncate max-w-[240px]">{a.note}</span>}
            </div>
            <span
              className={
                a.credibilityScore >= threshold ? "text-green font-semibold" : "text-paper/50"
              }
            >
              {(a.credibilityScore * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
