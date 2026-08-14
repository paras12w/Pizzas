import { NextResponse } from "next/server";
import { resetTradingState } from "@/lib/store";

export const dynamic = "force-dynamic";

// Clears live/historical Discord alerts and resets both bots to a clean
// $10,000 start. No auth on this — same posture as every other write route
// on this site (it's a public, single-operator hobby dashboard with no
// login system at all) — but it's a POST fired from a confirm-gated button
// on /alerts, not something that gets hit by accident.
export async function POST() {
  try {
    await resetTradingState();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/reset] failed:", err);
    return NextResponse.json({ error: "Failed to reset", detail: err.message }, { status: 500 });
  }
}
