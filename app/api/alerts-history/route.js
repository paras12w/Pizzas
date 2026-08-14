import { NextResponse } from "next/server";
import { getAlertHistory } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const history = await getAlertHistory();
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[api/alerts-history] failed:", err);
    return NextResponse.json({ error: "Failed to load alert history", detail: err.message }, { status: 500 });
  }
}
