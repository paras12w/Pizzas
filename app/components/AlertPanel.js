"use client";

export default function AlertPanel({ alertText, setAlertText, onSubmit, submitting, alertStatus }) {
  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--panel)]">
      <div className="border-b border-[var(--hairline)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--ink-dim)]">
        Log a Discord Alert
      </div>
      <form onSubmit={onSubmit} className="px-4 py-4">
        <textarea
          value={alertText}
          onChange={(e) => setAlertText(e.target.value)}
          placeholder='Paste the alert exactly as posted, e.g. "BUY QQQ 450C 8/15 @ 2.10 — momentum off open"'
          rows={4}
          className="w-full resize-none rounded-sm border border-[var(--hairline)] bg-black/30 px-3 py-2 text-sm font-mono-board text-[var(--ink)] placeholder:text-[var(--ink-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--amber)]"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !alertText.trim()}
            className="rounded-sm bg-[var(--amber)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
          >
            {submitting ? "Logging…" : "Log Alert"}
          </button>
        </div>
        {alertStatus && (
          <div className={`mt-2 text-xs ${alertStatus.ok ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
            {alertStatus.message}
          </div>
        )}
      </form>
    </section>
  );
}
