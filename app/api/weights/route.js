import { NextResponse } from "next/server";
import { getWeights, getWeightHistory } from "@/lib/store";
import { mergeWeights, DEFAULT_WEIGHTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stored, history] = await Promise.all([getWeights(), getWeightHistory()]);
    return NextResponse.json({
      current: mergeWeights(stored),
      default: DEFAULT_WEIGHTS,
      history,
    });
  } catch (err) {
    console.error("[api/weights] failed:", err);
    return NextResponse.json({ error: "Failed to load weights", detail: err.message }, { status: 500 });
  }
}
