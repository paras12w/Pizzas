"use client";

import { useEffect, useState } from "react";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/notifications", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setEmail(data.email || "");
        setEnabled(!!data.enabled);
        setEmailConfigured(!!data.emailConfigured);
      })
      .catch(() => {});
  }, []);

  async function save(next) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setEmail(data.email);
      setEnabled(data.enabled);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-sm border border-[var(--hairline)] px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
          enabled ? "text-[var(--amber)]" : "text-[var(--ink-dim)]"
        } hover:text-[var(--amber)]`}
      >
        <span>{enabled ? "🔔" : "🔕"}</span> Notify
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-md border border-[var(--hairline)] bg-[var(--panel)] p-4 shadow-lg">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--ink-dim)]">Email notifications</div>
          <p className="mb-3 text-[11px] text-[var(--ink-dim)]">
            Get emailed when a bot opens/closes a trade, or a ticker breaks into a top-9 list.
          </p>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-sm border border-[var(--hairline)] bg-black/30 px-2 py-1.5 text-xs font-mono-board text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--amber)]"
          />
          <label className="mt-3 flex items-center justify-between text-xs">
            <span className="text-[var(--ink)]">Enabled</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--amber)]"
            />
          </label>
          {error && <div className="mt-2 text-xs text-[var(--bear)]">{error}</div>}
          <button
            onClick={() => save({ email, enabled })}
            disabled={saving}
            className="mt-3 w-full rounded-sm bg-[var(--amber)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {!emailConfigured && (
            <div className="mt-2 text-[10px] text-[var(--ink-dim)]">
              Emails aren&apos;t wired up on this deploy yet (no <code>RESEND_API_KEY</code>) — this saves your
              preference, but nothing sends until that&apos;s set.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
