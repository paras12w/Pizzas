"use client";

import { Trade } from "@/lib/types";
import { useState } from "react";

export default function TradeLedger({ trades, onClose }: { trades: Trade[]; onClose: (id: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (trades.length === 0) {
    return (
      <div className="border border-line bg-panel p-4 text-paper/40 text-sm">
        no trades yet — log a discord alert or run a reddit/yahoo scan above threshold to see the bot act
      </div>
    );
  }

  return (
    <div className="border border-line bg-panel">
      <div className="text-amber text-xs tracking-widest uppercase p-4 pb-2">◆ trade ledger</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-paper/40 text-[10px] uppercase tracking-wider border-y border-line">
            <th className="text-left px-4 py-2">ticker</th>
            <th className="text-left px-2 py-2">dir</th>
            <th className="text-left px-2 py-2">entry</th>
            <th className="text-left px-2 py-2">size</th>
            <th className="text-left px-2 py-2">score</th>
            <th className="text-left px-2 py-2">source</th>
            <th className="text-left px-2 py-2">status</th>
            <th className="text-left px-2 py-2">p&l</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <>
              <tr
                key={t.id}
                className="border-b border-line/50 hover:bg-ink/50 cursor-pointer"
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              >
                <td className="px-4 py-2 font-semibold">{t.ticker}</td>
                <td className="px-2 py-2 uppercase text-paper/70">{t.direction}</td>
                <td className="px-2 py-2">${t.entryPrice.toFixed(2)}</td>
                <td className="px-2 py-2">${t.positionSize.toFixed(0)}</td>
                <td className="px-2 py-2 text-amber">{(t.credibilityScore * 100).toFixed(0)}%</td>
                <td className="px-2 py-2 text-paper/60 text-xs">{t.sourceLabel}</td>
                <td className="px-2 py-2">
                  {t.status === "open" ? (
                    <span className="text-amber">open</span>
                  ) : (
                    <span className="text-paper/50">closed</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {t.pnl !== undefined ? (
                    <span className={t.pnl >= 0 ? "text-green" : "text-red"}>
                      {t.pnl >= 0 ? "+" : ""}
                      {t.pnl.toFixed(2)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2">
                  {t.status === "open" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(t.id);
                      }}
                      className="text-xs text-red border border-red/40 px-2 py-1 hover:bg-red/10"
                    >
                      close
                    </button>
                  )}
                </td>
              </tr>
              {expanded === t.id && (
                <tr className="bg-ink/60">
                  <td colSpan={9} className="px-4 py-3 text-xs text-paper/60">
                    <div className="font-semibold text-paper/80 mb-1">why the bot took this trade:</div>
                    {t.reasoning.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
