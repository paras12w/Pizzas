import { NextResponse } from "next/server";
import { fetchTickerHistory } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const ticker = new URL(request.url).searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker query param required" }, { status: 400 });
  }

  try {
    const history = await fetchTickerHistory(ticker.toUpperCase());
    return NextResponse.json(history);
  } catch (err) {
    console.error("[api/history] failed:", err);
    return NextResponse.json(
      { error: "Failed to load price history", detail: err.message },
      { status: 500 }
    );
  }
}
