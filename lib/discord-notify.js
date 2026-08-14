// Pushes bot open/close events out to a Discord channel via webhook, so you
// don't have to keep the tab open to know when something happened.
//
// Entirely optional: set DISCORD_WEBHOOK_URL in your Vercel project's env
// vars (Project Settings → Environments) to a webhook URL from a Discord
// channel's Integrations settings. Until that's set, this is a silent no-op
// — there's no way to create the webhook for you, since it lives inside your
// Discord server.

export async function notifyDiscord(message) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (err) {
    console.error("[discord-notify] webhook post failed:", err.message);
  }
}
