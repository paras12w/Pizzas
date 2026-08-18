// Reddit signal source.
//
// Uses Reddit's public read-only JSON endpoints (https://www.reddit.com/r/<sub>/hot.json).
// No OAuth app / client id / secret is required for this — Reddit allows unauthenticated
// GET access to public subreddit listings as long as you send a real User-Agent string.
// This is rate limited (roughly ~60 requests/min per IP, enforced loosely), which is why
// we only hit a handful of subreddits per refresh and cache the result in the caller.

const SUBREDDITS = ["wallstreetbets", "stocks", "options", "StockMarket"];

// Words that look like cashtags/tickers but are common false positives.
const STOPWORDS = new Set([
  "THE", "FOR", "AND", "ARE", "YOU", "ALL", "NOW", "NEW", "CEO", "IPO",
  "USD", "USA", "ATH", "ATM", "OTM", "ITM", "DD", "PT", "EPS", "IMO",
  "LOL", "YOLO", "FOMO", "TLDR", "IV", "ER", "SEC", "FED", "GDP", "API",
]);

// Cheap keyword-density sentiment — not NLP, just enough to tell "$NVDA to
// the moon, loading calls" from "$NVDA is toast, dumping puts" instead of
// scoring both identically just because they both mention the ticker.
const BULLISH_WORDS = [
  "moon", "calls", "long", "buy", "breakout", "squeeze", "bullish",
  "upgrade", "beat", "rip", "rocket", "gains", "pump", "higher", "upside",
  "bull", "green", "melt up",
];
const BEARISH_WORDS = [
  "puts", "short", "dump", "crash", "bearish", "downgrade", "miss",
  "tank", "sell", "drilling", "lower", "downside", "bagholder", "rug",
  "bear", "red", "bloodbath",
];

// Exported for lib/scoring.js to reuse against news headlines, same
// bull/bear keyword approach, not a separate word list to keep in sync.
export function sentimentForText(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let bull = 0;
  let bear = 0;
  for (const w of BULLISH_WORDS) if (lower.includes(w)) bull += 1;
  for (const w of BEARISH_WORDS) if (lower.includes(w)) bear += 1;
  if (bull + bear === 0) return 0;
  return (bull - bear) / (bull + bear); // -1 (bearish) .. +1 (bullish)
}

async function fetchSubredditPosts(sub, limit = 40) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: {
        // Reddit blocks requests without a descriptive UA far more aggressively.
        "User-Agent": "signal-desk/1.0 (personal trade-signal dashboard)",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data?.children?.map((c) => c.data) ?? [];
  } catch (err) {
    console.error(`[reddit] failed to fetch r/${sub}:`, err.message);
    return [];
  }
}

function extractTickers(text) {
  if (!text) return [];
  const found = [];

  // $TICKER cashtags — highest confidence signal.
  const cashtags = text.match(/\$[A-Z]{1,5}\b/g) || [];
  for (const tag of cashtags) found.push(tag.slice(1));

  // Bare all-caps words 2-5 letters, filtered against a stopword list.
  // Lower confidence, so these are weighted less in scoring.
  const bare = text.match(/\b[A-Z]{2,5}\b/g) || [];
  for (const word of bare) {
    if (!STOPWORDS.has(word)) found.push(word);
  }
  return found;
}

/**
 * Scans hot posts across a set of subreddits and returns a mention-weighted
 * map of ticker -> { mentions, cashtagMentions, score, comments, subs }
 */
export async function discoverTrendingTickers() {
  const tally = new Map();

  const results = await Promise.all(
    SUBREDDITS.map((sub) => fetchSubredditPosts(sub))
  );

  results.forEach((posts, i) => {
    const sub = SUBREDDITS[i];
    for (const post of posts) {
      const title = post.title || "";
      const body = post.selftext || "";
      const cashtags = new Set(
        (title.match(/\$[A-Z]{1,5}\b/g) || [])
          .concat(body.match(/\$[A-Z]{1,5}\b/g) || [])
          .map((t) => t.slice(1))
      );
      const allTickers = new Set(extractTickers(title).concat(extractTickers(body)));
      const postWeight = (post.ups || 0) + (post.num_comments || 0) * 2;
      const postSentiment = sentimentForText(`${title} ${body}`);

      for (const ticker of allTickers) {
        if (!tally.has(ticker)) {
          tally.set(ticker, {
            ticker,
            mentions: 0,
            cashtagMentions: 0,
            weightedScore: 0,
            comments: 0,
            subs: new Set(),
            sentimentSum: 0,
            sentimentWeight: 0,
          });
        }
        const entry = tally.get(ticker);
        entry.mentions += 1;
        if (cashtags.has(ticker)) entry.cashtagMentions += 1;
        entry.weightedScore += postWeight;
        entry.comments += post.num_comments || 0;
        entry.subs.add(sub);
        if (postSentiment !== 0) {
          const w = Math.max(1, postWeight);
          entry.sentimentSum += postSentiment * w;
          entry.sentimentWeight += w;
        }
      }
    }
  });

  return Array.from(tally.values())
    .map((e) => ({
      ...e,
      subs: Array.from(e.subs),
      sentiment: e.sentimentWeight > 0 ? e.sentimentSum / e.sentimentWeight : 0,
    }))
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

/**
 * Fetches recent mention/sentiment signal for one specific ticker, used to
 * enrich a ticker that came from a Discord alert but wasn't already trending.
 */
export async function fetchTickerMentions(ticker) {
  try {
    const res = await fetch(
      `https://www.reddit.com/search.json?q=%24${ticker}&sort=new&limit=15&t=day`,
      {
        headers: { "User-Agent": "signal-desk/1.0 (personal trade-signal dashboard)" },
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) return { mentions: 0, weightedScore: 0, sentiment: 0 };
    const json = await res.json();
    const posts = json?.data?.children?.map((c) => c.data) ?? [];
    const weightedScore = posts.reduce(
      (sum, p) => sum + (p.ups || 0) + (p.num_comments || 0) * 2,
      0
    );

    let sentimentSum = 0;
    let sentimentWeight = 0;
    for (const p of posts) {
      const s = sentimentForText(`${p.title || ""} ${p.selftext || ""}`);
      if (s === 0) continue;
      const w = Math.max(1, (p.ups || 0) + (p.num_comments || 0) * 2);
      sentimentSum += s * w;
      sentimentWeight += w;
    }

    return {
      mentions: posts.length,
      weightedScore,
      sentiment: sentimentWeight > 0 ? sentimentSum / sentimentWeight : 0,
    };
  } catch (err) {
    console.error(`[reddit] mention lookup failed for ${ticker}:`, err.message);
    return { mentions: 0, weightedScore: 0, sentiment: 0 };
  }
}
