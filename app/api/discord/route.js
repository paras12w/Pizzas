import { NextResponse } from "next/server";
import { addAlert, getAlerts, isPersistent } from "@/lib/store";
import { parseAlertText } from "@/lib/discord-parse";

export const dynamic = "force-dynamic";

export async function GET() {
  const alerts = await getAlerts();
  return NextResponse.json({ alerts, persistent: isPersistent() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const raw = (body.raw || "").toString();

  if (!raw.trim()) {
    return NextResponse.json({ error: "Paste an alert first." }, { status: 400 });
  }

  const parsed = parseAlertText(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "Couldn't find a ticker in that text — try including a $TICKER or an option leg like QQQ 450C." },
      { status: 422 }
    );
  }

  const saved = await addAlert(parsed);
  return NextResponse.json({ saved, persistent: isPersistent() });
}
