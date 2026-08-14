# Pizzas Sheckles

Public, non-interactive live scoreboard: ranks the top 9 **buy** candidates and
top 9 **sell** candidates right now by scanning Reddit, Yahoo Finance
(including analyst ratings), and any Discord alerts you log — no account, no
login, no manual running required once it's deployed.

## Pages

- **Board** (`/`) — the live top-9 Buy and top-9 Sell leaderboards side by
  side, the Discord alert form, and Bot A's open positions + trade history.
- **Performance** (`/performance`) — a combined equity-curve chart plus win
  rate and P&L stats for both bots, reconstructed from their full
  closed-trade history.
- **Alert Log** (`/alerts`) — every Discord alert ever submitted, not just
  the ones still live-scoring.
- **Weights** (`/weights`) — the scoring formula's current weights vs. their
  defaults, and a log of every automatic recalibration.
- **Watchlist** (`/watchlist`) — pin tickers to always track their score
  even when they don't crack the organic top 9.
- **Bot B** (`/bot-b`) — the experimental bot variant, kept off the main
  board on purpose (see below).

## How it works

- **`GET /api/scores`** does the actual work on every call:
  1. Pulls hot posts from r/wallstreetbets, r/stocks, r/options, r/StockMarket
     via Reddit's public JSON endpoints (`reddit.com/r/<sub>/hot.json`) — **no
     Reddit developer app / OAuth needed**, just a descriptive User-Agent.
     Falls back to Yahoo's own live "most active" / "day gainers" movers if
     Reddit doesn't yield enough candidates (it blocks a lot of cloud IPs
     outright, Vercel's included).
  2. Extracts `$TICKER` cashtags (high confidence) and bare all-caps words
     (lower confidence, stopword-filtered) from post titles/bodies, weighted
     by upvotes + comments, plus a cheap keyword-density **sentiment** read
     (bullish vs. bearish language) per ticker — mentions alone don't move
     the score, what people are actually saying about the ticker does.
  3. Pulls live price, % change, volume, today's high/low, and Wall Street's
     **analyst consensus rating** (e.g. "1.8 - Buy") from Yahoo Finance
     (`yahoo-finance2`, free, no key) for every candidate, plus a best-effort
     read of the nearest options chain for IV / put-call skew.
  4. Folds in any Discord alerts you've logged (see below) — any ticker with
     a live alert has its confidence floored high enough to guarantee both
     bots take the trade, not just nudged toward it.
  5. Scores each candidate on two 0–100 axes — **Confidence** (how much the
     signals agree the bot would take this trade) and **Benefit** (how
     favorable the setup looks if taken) — via continuous curves (not
     stepped bonuses), so small signal differences produce small score
     differences instead of clustering candidates onto round numbers.
     Candidates are split by direction into **two separate top-9 lists** —
     Buy (bullish) and Sell (bearish) — each always showing its best 9,
     ranked, even on a slow day.
  6. Runs **two** paper-trading bots (`lib/bot.js`) against those scores,
     each starting from a simulated **$10,000** cash balance, and each
     willing to take both Buy and Sell candidates:
     - **Bot A** (featured, shown on the main board): standard threshold
       (72), conservative sizing (5%–20% of current bankroll based on
       confidence strength), 6h max hold.
     - **Bot B** (`/bot-b`, kept separate): looser entry threshold (60),
       more aggressive sizing (3%–30%), tighter 3h leash. It's the "B" side
       of an A/B test — not a claim it's better, that's what Performance is
       for.
     Both size positions by confidence (stronger entries get bigger size),
     track mark-to-market equity every refresh, and close on confidence
     decay, falling off the board, or max hold. Every open/close can push a
     notification (see below).
  7. **Weight calibration** (`lib/calibration.js`): once Bot A has 15+ closed
     trades, correlates each scoring component's entry-time contribution
     against actual P&L and nudges the live weights (capped ±15% per pass,
     renormalized) — components that predicted winners get weighted up,
     noise gets weighted down. Runs again every 10 new trades. See `/weights`
     for the live formula and a full history of what changed and why.
  8. Tracks each ticker's rank on its list cycle-to-cycle, so the board shows
     when something climbs, fades, or is brand new to a list — not just a
     static score.
- The board page polls `/api/scores` every 15 seconds. Click any ticker to
  open its detail view: an intraday price chart plus a plain-English
  breakdown of exactly which signals (and how many points each) produced its
  Confidence and Benefit scores, along with Bot A's position on it if any.

**Important nuance on "standalone":** the scoring only runs when
`/api/scores` is hit. With just client polling, that means it only
recomputes while someone has the page open. That's normal and fine for a
public dashboard. If you want it to keep updating even with zero visitors
(e.g. so the bots keep managing open positions unattended), you'd add a
scheduled job — Vercel's free Hobby plan caps its built-in Cron to once a
day; for anything more frequent you'd either upgrade to Vercel Pro or use a
free external pinger (e.g. cron-job.org) hitting `/api/scores`.

**On polling speed:** 15s is fast enough that each candidate's 2 Yahoo
requests (quote + options) add up quickly — the candidate pool is
deliberately capped (20 tickers) to stay under Yahoo's informal rate
limits. If you see "ERROR" flashes on the board, that's the most likely
cause; back off `REFRESH_MS` in `app/page.js` first.

## The one input: logging a Discord alert

Open "Log a Discord Alert" on the board and paste the alert text as-is, e.g.:

```
BUY QQQ 450C 8/15 @ 2.10 — momentum off open
```

The parser (`lib/discord-parse.js`) is intentionally lenient — it recognizes
a wide range of casual phrasing and emoji (🟢🚀 = bullish, 🔴📉 = bearish) since
it's meant to catch a real alert over being strict about wording. It extracts
the ticker and bullish/bearish direction automatically, floors that ticker's
confidence high enough that both bots take the trade, and folds it into the
score on the next refresh. It's also permanently recorded in the Alert Log.
No structured form fields required.

## Notifications

Click the 🔔 button on the board to set an email address and toggle
notifications on/off. When enabled, you'll get emailed when a bot opens or
closes a trade, or when a ticker breaks into either top-9 list for the first
time. Discord gets the same events pushed to a webhook if configured (see
below) — both are optional and independent of each other.

## Deploying

1. Push this folder to a new GitHub repo.
2. Import it into Vercel (vercel.com → New Project → your repo). No env
   vars are required for the site to work.
3. **(Recommended)** For alerts, bot positions, watchlist, notification
   settings, and calibrated weights to persist across requests instead of
   resetting on cold starts: in your Vercel project → **Storage** tab →
   **Create Database** → **KV**. Connect it to this project when prompted,
   then redeploy (Deployments tab → ⋯ on the latest deployment → Redeploy).
   Vercel auto-populates `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you —
   no manual copying needed. The "storage isn't persistent" banner on the
   board goes away once this is done and the app redeploys.
4. **(Optional)** For Discord push notifications when a bot opens/closes a
   position: create a webhook on a Discord channel (Channel Settings →
   Integrations → Webhooks) and set `DISCORD_WEBHOOK_URL` in your Vercel
   project's env vars to that URL.
5. **(Optional)** For email notifications: sign up at resend.com (free
   tier), create an API key, and set `RESEND_API_KEY` in your Vercel
   project's env vars. Until this is set, the notification toggle still
   saves your preference but nothing actually sends.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000. Reddit/Yahoo calls happen from your own machine
in dev, so you'll see live data locally too.

## Tuning

- **Subreddits scanned:** `lib/reddit.js` → `SUBREDDITS`
- **Sentiment keyword lists:** `lib/reddit.js` → `BULLISH_WORDS` / `BEARISH_WORDS`
- **Discord alert keyword lists:** `lib/discord-parse.js` → `BULLISH_HINTS` / `BEARISH_HINTS`
- **Scoring weights:** `lib/scoring.js` → `DEFAULT_WEIGHTS` (the live,
  possibly-calibrated weights are visible on `/weights`)
- **Take threshold:** `TAKE_THRESHOLD` in `lib/scoring.js` (currently 72,
  used for the board's "Taken" badge and Bot A's default)
- **Alert confidence floor:** `ALERT_MIN_CONFIDENCE` in `lib/scoring.js` (currently 78)
- **Bot configs (threshold, exit, sizing, max hold):** `BOT_CONFIGS` in `lib/bot.js`
- **Calibration sensitivity:** `MIN_SAMPLE`, `RECALIBRATION_STEP`, `NUDGE_CAP`
  in `lib/calibration.js`
- **Refresh interval:** `REFRESH_MS` in `app/page.js` (currently 15s)
