import { NextResponse } from "next/server";
import { getNotificationSettings, saveNotificationSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getNotificationSettings();
  return NextResponse.json({
    ...settings,
    // Lets the UI explain *why* toggling on won't actually send anything yet.
    emailConfigured: !!process.env.RESEND_API_KEY,
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").toString().trim();

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  const saved = await saveNotificationSettings({ email, enabled: !!body.enabled });
  return NextResponse.json({ ...saved, emailConfigured: !!process.env.RESEND_API_KEY });
}
