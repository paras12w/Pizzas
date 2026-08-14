"use client";

import { useEffect, useState, useCallback } from "react";
import AlertForm from "@/components/AlertForm";
import PortfolioHeader from "@/components/PortfolioHeader";
import TradeLedger from "@/components/TradeLedger";
import SignalFeed from "@/components/SignalFeed";
import { Alert, Trade } from "@/lib/types";

export default function Home() {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [threshold, setThreshold] = useState(0.72);
  const [scanning, setScanning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [pRes, aRes] = await Promise.all([fetch("/api/portfolio"), fetch("/api/discord-alerts")]);
    const p = await pRes.json();
    const a = await aRes.json();
    setPortfolio(p);
    setAlerts(a);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function closeTrade(id: string) {
    await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeId: id }),
    });
    refresh();
  }

  async function runYahooScan() {
    setScanning("yahoo");
    try {
      const res = await fetch("/api/yahoo");
      const data = await res.json();
      if (data.threshold) setThreshold(data.threshold);
      refresh();
    } finally {
      setScanning(null);
    }
  }

  async function runRedditScan() {
    setScanning("reddit");
    try {
      const res = await fetch("/api/reddit?subreddit=wallstreetbets&limit=15");
      const data = await res.json();
      if (data.error) alert(`Reddit scan: ${data.error}`);
      refresh();
    } finally {
      setScanning(null);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <header className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold text-amber tracking-tight">
          SIGNAL DESK <span className="cursor-blink text-amber">_</span>
        </h1>
        <p className="text-paper/50 text-sm mt-1">
          credibility-weighted signal aggregation · discord + reddit + yahoo finance · paper trading demo
        </p>
      </header>

      <PortfolioHeader data={portfolio} />

      <div className="grid md:grid-cols-2 gap-6">
        <AlertForm onSubmitted={refresh} />

        <div className="border border-line bg-panel p-4 space-y-3">
          <div className="text-amber text-xs tracking-widest uppercase mb-1">◆ run a scan</div>
          <p className="text-xs text-paper/50">
            pulls fresh signals from secondary sources and logs any that clear the noise floor. trades fire automatically
            if a signal clears the {(threshold * 100).toFixed(0)}% threshold.
          </p>
          <div className="flex gap-3">
            <button
              onClick={runYahooScan}
              disabled={scanning !== null}
              className="border border-green text-green text-sm px-4 py-2 hover:bg-green/10 disabled:opacity-50"
            >
              {scanning === "yahoo" ? "scanning..." : "scan yahoo finance"}
            </button>
            <button
              onClick={runRedditScan}
              disabled={scanning !== null}
              className="border border-red text-red text-sm px-4 py-2 hover:bg-red/10 disabled:opacity-50"
            >
              {scanning === "reddit" ? "scanning..." : "scan r/wallstreetbets"}
            </button>
          </div>
          <p className="text-[10px] text-paper/30 pt-2">
            reddit scan requires REDDIT_CLIENT_ID / SECRET / USERNAME / PASSWORD in .env.local — see README
          </p>
        </div>
      </div>

      <SignalFeed alerts={alerts} threshold={threshold} />

      <TradeLedger trades={portfolio?.trades ?? []} onClose={closeTrade} />
    </main>
  );
}
