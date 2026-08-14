// Best-effort parser for raw pasted Discord alert text, e.g.:
//   "🟢 BUY QQQ 450C 8/15 @ 2.10 — momentum play off open"
//   "SPY 560P 8/16 — fading the gap up"
//   "loading nvda calls, breakout incoming 🚀"
//
// Deliberately lenient — this hasn't been tested against real alert text
// yet, so it errs toward catching a real ticker/direction over being
// precise. If it can't find a confident ticker, the caller should ask for
// one explicitly rather than guessing at that part.
//
// Direction is resolved in priority tiers, most authoritative first:
//   1. Structured trade-action phrases ("opened a position", "closed our
//      position") — real alert-bot messages almost always front-load the
//      actual instruction this way, so these override everything else in
//      the message no matter where they appear.
//   2. Generic keyword hints, checked against the first sentence only.
//   3. The same generic hints, checked against the whole message.
//   4. Option-leg suffix (450C / 450P) as a last resort.
//
// Tiers 2+ exist because a message that recaps an older, unrelated trade
// ("we exited that one back in May...") can contain a keyword like "exit"
// that has nothing to do with the actual current instruction — checking
// the first sentence first, before falling back to a full-text scan,
// catches most of that without needing the phrase to be in the structured
// list.

const STRUCTURED_BULLISH = /\bopened a (?:new )?(?:long )?position\b(?!.{0,25}\bshort\b)|\bopened (?:a )?long\b|\bentered (?:a )?long\b|\bstarted a position\b|\badd(?:ing)? more\b|\bscaling in\b|\bbuying the dip\b/i;
const STRUCTURED_BEARISH = /\bopened a short\b|\bopened (?:a )?puts?\b|\bentered (?:a )?short\b|\bclosed (?:out )?(?:our |my |the )?position\b|\bclosed out\b|\bexited (?:our |my |the )?position\b|\btook profits? on\b|\bstopped out\b|\btrimm(?:ed|ing) (?:our |my |the )?position\b/i;

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

  const firstSentence = (text.split(/\n+/)[0] || text).split(/(?<=[.!?])\s+/)[0] || text;

  let direction = "bullish"; // casual alerts skew toward entries; default to the more common case
  if (STRUCTURED_BEARISH.test(text)) direction = "bearish";
  else if (STRUCTURED_BULLISH.test(text)) direction = "bullish";
  else if (BEARISH_HINTS.test(firstSentence) || BEARISH_EMOJI.test(firstSentence)) direction = "bearish";
  else if (BULLISH_HINTS.test(firstSentence) || BULLISH_EMOJI.test(firstSentence)) direction = "bullish";
  else if (BEARISH_HINTS.test(text) || BEARISH_EMOJI.test(text)) direction = "bearish";
  else if (BULLISH_HINTS.test(text) || BULLISH_EMOJI.test(text)) direction = "bullish";
  else if (/\b\d+(\.\d+)?P\b/i.test(text)) direction = "bearish";
  else if (/\b\d+(\.\d+)?C\b/i.test(text)) direction = "bullish";

  return { ticker, direction, note: text.slice(0, 280) };
}
