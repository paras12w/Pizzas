// Best-effort parser for raw pasted Discord alert text, e.g.:
//   "🟢 BUY QQQ 450C 8/15 @ 2.10 — momentum play off open"
//   "SPY 560P 8/16 — fading the gap up"
//
// This intentionally stays simple: it pulls out a ticker and a bullish/bearish
// direction. If it can't find a confident ticker, the caller should ask for
// one explicitly rather than guessing.

const BEARISH_HINTS = /\b(SELL|PUT|SHORT|BEARISH|FADE)\b/i;
const BULLISH_HINTS = /\b(BUY|CALL|LONG|BULLISH)\b/i;

export function parseAlertText(raw) {
  const text = raw.trim();
  if (!text) return null;

  const cashtag = text.match(/\$([A-Z]{1,5})\b/);
  const optionLeg = text.match(/\b([A-Z]{1,5})\s?\d+(\.\d+)?[CP]\b/); // e.g. QQQ 450C
  const capsWord = text.match(/\b([A-Z]{2,5})\b/);

  const ticker = cashtag?.[1] || optionLeg?.[1] || capsWord?.[1];
  if (!ticker) return null;

  let direction = "bullish";
  if (BEARISH_HINTS.test(text)) direction = "bearish";
  else if (BULLISH_HINTS.test(text)) direction = "bullish";
  else if (/\b\d+(\.\d+)?P\b/.test(text)) direction = "bearish";
  else if (/\b\d+(\.\d+)?C\b/.test(text)) direction = "bullish";

  return { ticker, direction, note: text.slice(0, 280) };
}
