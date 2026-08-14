// Best-effort parser for raw pasted Discord alert text, e.g.:
//   "🟢 BUY QQQ 450C 8/15 @ 2.10 — momentum play off open"
//   "SPY 560P 8/16 — fading the gap up"
//   "loading nvda calls, breakout incoming 🚀"
//
// Deliberately lenient — this hasn't been tested against real alert text
// yet, so it errs toward catching a real ticker/direction over being
// precise. If it can't find a confident ticker, the caller should ask for
// one explicitly rather than guessing at that part.

const BULLISH_HINTS = /\b(BUY|CALLS?|LONG|BULLISH|BULL|MOON(?:ING)?|ROCKET(?:ING)?|SQUEEZE|BREAKOUT|ADDING|LOADING|ACCUMULAT(?:E|ING)|SEND ?IT|UPGRADE|RIPPING|PUMPING|ENTRY)\b/i;
const BEARISH_HINTS = /\b(SELL|PUTS?|SHORT(?:ING)?|BEARISH|BEAR|DUMP(?:ING)?|TANK(?:ING)?|DRILL(?:ING)?|FADE|FADING|TRIM(?:MING)?|CRASH(?:ING)?|BAGHOLDER|DOWNGRADE|EXIT(?:ING)?|CLOSING)\b/i;
const BULLISH_EMOJI = /[🟢🚀📈💚⬆️]/;
const BEARISH_EMOJI = /[🔴📉🩸💔⬇️]/;

export function parseAlertText(raw) {
  const text = raw.trim();
  if (!text) return null;

  // $TICKER and option-leg (e.g. "QQQ 450C") patterns are unambiguous
  // enough to accept case-insensitively. The bare-caps fallback stays
  // strict-caps-only — that's the one place casing is actually load-bearing
  // for telling a ticker apart from an ordinary word.
  const cashtag = text.match(/\$([A-Za-z]{1,5})\b/);
  const optionLeg = text.match(/\b([A-Za-z]{1,5})\s?\d+(\.\d+)?[CP]\b/i);
  const capsWord = text.match(/\b([A-Z]{2,5})\b/);

  const ticker = (cashtag?.[1] || optionLeg?.[1] || capsWord?.[1] || "").toUpperCase();
  if (!ticker) return null;

  let direction = "bullish"; // casual alerts skew toward entries; default to the more common case
  if (BEARISH_HINTS.test(text) || BEARISH_EMOJI.test(text)) direction = "bearish";
  else if (BULLISH_HINTS.test(text) || BULLISH_EMOJI.test(text)) direction = "bullish";
  else if (/\b\d+(\.\d+)?P\b/i.test(text)) direction = "bearish";
  else if (/\b\d+(\.\d+)?C\b/i.test(text)) direction = "bullish";

  return { ticker, direction, note: text.slice(0, 280) };
}
