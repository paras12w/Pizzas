// Sends notification emails via Resend's HTTP API (https://resend.com) —
// picked because it's a single fetch call, no SDK, generous free tier.
//
// Entirely optional, same pattern as lib/discord-notify.js: set
// RESEND_API_KEY in your Vercel project's env vars (Resend dashboard →
// API Keys) to turn this on. Until then, it's a silent no-op — there's no
// way to create the account/key for you. Toggle notifications on/off (and
// set the destination email) from the bell icon on the board.

const FROM = process.env.RESEND_FROM_EMAIL || "Signal Desk <onboarding@resend.dev>";

export async function sendNotificationEmail(to, subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
  } catch (err) {
    console.error("[email-notify] send failed:", err.message);
  }
}
