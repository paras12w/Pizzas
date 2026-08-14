# Signal Desk

Credibility-weighted stock signal aggregator with a paper trading bot.
Combines manually-logged Discord alerts, Reddit sentiment (bot-filtered),
and Yahoo Finance data into a single scored feed, and simulates trades
when a signal clears a confidence threshold.

## What's actually built

- **Discord intake** — manual entry form (instant log). No bot automation
  since you're a server member, not an admin — see the note on that below.
- **Reddit ingestion** — via Reddit's official API (OAuth), extracts ticker
  mentions from post titles, scores each poster's bot/spam likelihood using
  account age, karma, and posting patterns.
- **Yahoo Finance scan** — volume spike detection + analyst rating lean,
  via the unofficial `yahoo-finance2` package.
- **Credibility engine** (`lib/credibility.ts`) — per-source scoring:
  - Discord: weighted by that server's actual resolved-trade hit rate
  - Reddit: trust factor (1 - bot likelihood) + engagement + recency
  - Yahoo: volume ratio + analyst lean
  - Corroboration boost when multiple sources flag the same ticker
- **Paper trading bot** (`lib/paperTrade.ts`) — $10,000 starting balance,
  position size scaled by confidence tier, full reasoning logged per trade
  for transparency.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Reddit credentials (optional, see below)
npm run dev
```

Open http://localhost:3000.

## Reddit API credentials

Reddit ingestion needs an app registered at https://www.reddit.com/prefs/apps
(choose "script" type). Add to `.env.local`:

```
REDDIT_CLIENT_ID=xxx
REDDIT_CLIENT_SECRET=xxx
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
```

Without these, the "scan r/wallstreetbets" button will just show an error —
everything else still works.

## Important limitations to know about

**Storage** is Upstash Redis (`lib/store.ts`) when `UPSTASH_REDIS_REST_URL`
and `UPSTASH_REDIS_REST_TOKEN` are set — REST-based, so it works fine from
serverless functions (Vercel included). Without those env vars it falls
back to flat-file JSON in `data/*.json`, which is fine for local dev but
**will not work** on Vercel or other serverless platforms, since their
filesystem is read-only/ephemeral per invocation. Get free Upstash Redis
credentials at https://console.upstash.com (or attach the Upstash
integration from the Vercel Marketplace) and set the two env vars before
deploying.

**Discord is manual, not automated.** Since you're a member (not admin) of
the paid servers, there's no legitimate way to auto-ingest messages without
either (a) the server owner adding a read-only bot, or (b) automating your
own user account, which violates Discord's ToS and risks your account/access.
The form is fast (a few fields, one submit) but it's you typing, not a bot
listening. If you can get the server owner to add a bot with read access to
the alert channel, that's the real automation path — happy to build that
Gateway listener if/when that becomes possible.

**No Instagram/TikTok scraping**, by design — both explicitly prohibit it
in their ToS. If you want that data, licensed providers (Bright Data, Apify)
sell it as an API rather than requiring scraping.

**Yahoo Finance is unofficial.** `yahoo-finance2` scrapes/uses undocumented
endpoints that Yahoo could change or restrict at any time. Fine for a demo,
but don't build anything mission-critical on it long-term — a paid provider
(Alpha Vantage, Financial Modeling Prep, Polygon.io) is the durable choice
if this grows.

**Credibility scoring is a starting point, not gospel.** The weights in
`lib/credibility.ts` (e.g. `baseTrust = 0.75` for Discord, the 0.6/0.25/0.15
split for Reddit) are reasonable defaults, not tuned on real data yet.
As trades resolve and you get a real track record per source, revisit these.

## Project structure

```
app/
  page.tsx                 dashboard
  api/discord-alerts/      manual alert intake + instant trade execution
  api/reddit/              reddit scan endpoint
  api/yahoo/                yahoo finance scan endpoint
  api/portfolio/           bot state, closing trades
lib/
  types.ts                 shared types
  store.ts                 flat-file storage (swap for real DB later)
  credibility.ts           the scoring engine
  redditBotFilter.ts        bot/spam heuristics
  paperTrade.ts             trade execution logic
  yahoo.ts                  yahoo finance helpers
components/                 dashboard UI pieces
```

## Natural next steps

1. Add an options-chain data source (Tradier sandbox is free) for real
   premium/IV data instead of using stock price as a stand-in for options P&L
2. Tune credibility weights once you have real resolved trades to backtest against
3. Add a public-facing read-only view of the trade ledger (strip the intake
   form) if you want this to double as a credibility showcase for others
