import { NextRequest, NextResponse } from "next/server";
import { computeBotLikelihood } from "@/lib/redditBotFilter";
import { scoreRedditSignal, TRADE_THRESHOLD } from "@/lib/credibility";
import { addAlert } from "@/lib/store";
import { Alert, RedditPostSignal } from "@/lib/types";

// Reddit's official API requires an app (client_id/secret) registered at
// reddit.com/prefs/apps, using the "script" app type for a personal-use
// project like this. Set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET /
// REDDIT_USERNAME / REDDIT_PASSWORD in your .env.local - see README.

const TICKER_REGEX = /\$?\b[A-Z]{2,5}\b/g;
const COMMON_WORDS_TO_IGNORE = new Set([
  "THE", "FOR", "AND", "YOU", "ARE", "ALL", "CEO", "IPO", "USA", "USD", "ATH",
  "DD", "IMO", "TLDR", "EOD", "AH", "PM", "WSB",
]);

async function getRedditToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error("Reddit API credentials not configured - see README.md");
  }

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "signal-desk/0.1 by yourusername",
    },
    body: `grant_type=password&username=${username}&password=${password}`,
  });
  const data = await res.json();
  return data.access_token as string;
}

export async function GET(req: NextRequest) {
  const subreddit = req.nextUrl.searchParams.get("subreddit") ?? "wallstreetbets";
  const limit = req.nextUrl.searchParams.get("limit") ?? "25";

  try {
    const token = await getRedditToken();

    const postsRes = await fetch(
      `https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "signal-desk/0.1 by yourusername",
        },
      }
    );
    const postsData = await postsRes.json();
    const posts = postsData.data?.children ?? [];

    const signals: RedditPostSignal[] = [];

    for (const p of posts) {
      const post = p.data;
      const tickers = extractTickers(post.title + " " + (post.selftext ?? ""));
      if (tickers.length === 0) continue;

      // Fetch author info for bot scoring (rate-limit friendly: one call per post)
      let authorAgeDays = 30;
      let linkKarma = 100;
      let commentKarma = 100;
      let hasVerifiedEmail = true;
      try {
        const authorRes = await fetch(`https://oauth.reddit.com/user/${post.author}/about`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "signal-desk/0.1 by yourusername",
          },
        });
        const authorData = await authorRes.json();
        const a = authorData.data;
        authorAgeDays = (Date.now() / 1000 - a.created_utc) / 86400;
        linkKarma = a.link_karma ?? 0;
        commentKarma = a.comment_karma ?? 0;
        hasVerifiedEmail = a.has_verified_email ?? false;
      } catch {
        // fall back to defaults above if author lookup fails
      }

      const botLikelihood = computeBotLikelihood({
        accountAgeDays: authorAgeDays,
        linkKarma,
        commentKarma,
        hasVerifiedEmail,
        recentPostTimestamps: [], // extend: fetch author's recent posts for velocity check
        duplicateTickerMentionsAcrossSubs: 0, // extend: cross-reference against a recent-posts cache
      });

      for (const ticker of tickers) {
        const signal: RedditPostSignal = {
          id: post.id,
          subreddit,
          ticker,
          title: post.title,
          author: post.author,
          accountAgeDays: Math.round(authorAgeDays),
          authorKarma: linkKarma + commentKarma,
          score: post.score,
          numComments: post.num_comments,
          createdAt: new Date(post.created_utc * 1000).toISOString(),
          botLikelihood,
          url: `https://reddit.com${post.permalink}`,
        };
        signals.push(signal);

        const { score, breakdown } = scoreRedditSignal(signal);
        const alert: Alert = {
          id: crypto.randomUUID(),
          source: "reddit",
          sourceLabel: `r/${subreddit}`,
          ticker,
          direction: "long", // Reddit sentiment signals default to long bias
          note: post.title,
          createdAt: signal.createdAt,
          credibilityScore: score,
          breakdown,
        };
        addAlert(alert);
      }
    }

    return NextResponse.json({ signals, threshold: TRADE_THRESHOLD });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reddit fetch failed" },
      { status: 500 }
    );
  }
}

function extractTickers(text: string): string[] {
  const matches = text.match(TICKER_REGEX) ?? [];
  const cleaned = matches
    .map((m) => m.replace("$", ""))
    .filter((m) => !COMMON_WORDS_TO_IGNORE.has(m));
  return Array.from(new Set(cleaned));
}
