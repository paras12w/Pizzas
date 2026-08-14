"use client";

import { useState } from "react";

const SERVERS = [
  { id: "server-a", name: "Discord Server A" },
  { id: "server-b", name: "Discord Server B" },
];

export default function AlertForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [serverId, setServerId] = useState(SERVERS[0].id);
  const [ticker, setTicker] = useState("");
  const [direction, setDirection] = useState("call");
  const [strike, setStrike] = useState("");
  const [expiry, setExpiry] = useState("");
  const [entryPriceHint, setEntryPriceHint] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<null | string>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/discord-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId,
          ticker: ticker.toUpperCase(),
          direction,
          strike: strike ? Number(strike) : undefined,
          expiry: expiry || undefined,
          entryPriceHint: entryPriceHint ? Number(entryPriceHint) : undefined,
          note: note || undefined,
        }),
      });
      const data = await res.json();
      if (data.tradeResult) {
        setStatus(`LOGGED — bot took the trade @ $${data.tradeResult.entryPrice}`);
      } else if (data.alert) {
        setStatus(
          `LOGGED — score ${(data.alert.credibilityScore * 100).toFixed(0)}% did not clear ${(data.threshold * 100).toFixed(0)}% threshold, no trade taken`
        );
      } else {
        setStatus(data.error ?? "error");
      }
      setTicker("");
      setStrike("");
      setExpiry("");
      setEntryPriceHint("");
      setNote("");
      onSubmitted();
    } catch (err) {
      setStatus("failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-line bg-panel p-4 space-y-3">
      <div className="text-amber text-xs tracking-widest uppercase mb-2">◆ log discord alert</div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-paper/60 flex flex-col gap-1">
          server
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber"
          >
            {SERVERS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-paper/60 flex flex-col gap-1">
          direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber"
          >
            <option value="call">call</option>
            <option value="put">put</option>
            <option value="long">long (equity)</option>
            <option value="short">short (equity)</option>
          </select>
        </label>

        <label className="text-xs text-paper/60 flex flex-col gap-1">
          ticker
          <input
            required
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="SOFI"
            className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber uppercase"
          />
        </label>

        <label className="text-xs text-paper/60 flex flex-col gap-1">
          entry price hint (optional)
          <input
            value={entryPriceHint}
            onChange={(e) => setEntryPriceHint(e.target.value)}
            placeholder="leave blank = live price"
            className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber"
          />
        </label>

        {(direction === "call" || direction === "put") && (
          <>
            <label className="text-xs text-paper/60 flex flex-col gap-1">
              strike
              <input
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                placeholder="185"
                className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber"
              />
            </label>
            <label className="text-xs text-paper/60 flex flex-col gap-1">
              expiry
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber"
              />
            </label>
          </>
        )}
      </div>

      <label className="text-xs text-paper/60 flex flex-col gap-1">
        note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="paste the alert text if useful"
          className="bg-ink border border-line text-paper px-2 py-1.5 text-sm focus:outline-none focus:border-amber"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="bg-amber text-ink font-semibold text-sm px-4 py-2 hover:bg-amberDim transition-colors disabled:opacity-50"
      >
        {submitting ? "logging..." : "log alert →"}
      </button>

      {status && <div className="text-xs text-green pt-1">{status}</div>}
    </form>
  );
}
