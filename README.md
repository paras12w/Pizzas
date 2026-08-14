# Signal Desk

Public, non-interactive live scoreboard: ranks the top 9 trade candidates right
now by scanning Reddit, Yahoo Finance, and any Discord alerts you log — no
account, no login, no manual running required once it's deployed.

## How it works

- **`GET /api/scores`** does the actual work on every call:
  1. Pulls hot posts from r/wallstreetbets, r/stocks, r/options, r/StockMarket
     via Reddit's public JSON endpoints (`reddit.com/r/<sub>/hot.json`) — **no
     Reddit developer app / OAuth needed**, just a descriptive User-Agent.
  2. Extracts `$TICKER` cashtags (high confidence) and bare all-caps words
     (lower confidence, stopword-filtered) from post titles/bodies, weighted
     by upvotes + comments.
  3. Pulls live price, % change, and volume from Yahoo Finance
     (`yahoo-finance2`, also free, no key) for every candidate, plus a
     best-effort read of the nearest options chain for IV / put-call skew.
  4. Folds in any Discord alerts you've logged (see below).
  5. Scores each candidate on two 0–100 axes — **Confidence** (how much the
     signals agree the bot would take this trade) and **Benefit** (how
     favorable the setup looks if taken) — and returns the top 9 by a
     blended overall score. A ticker is marked **Taken** once Confidence
     crosses 72, mirroring your paper-trading bot's threshold.
- The page (`app/page.js`) polls that route every 5 minutes and re-renders.
  Nothing on the page is clickable except the "Log a Discord Alert" panel —
  everything else is read-only display.

**Important nuance on "standalone":** the scoring only runs when
`/api/scores` is hit. With just client polling, that means it only
recomputes while someone has the page open. That's normal and fine for a
public dashboard. If you want it to keep updating even with zero visitors
(e.g. for logging "Taken" trades to a persistent list later), you'd add a
scheduled job — Vercel's free Hobby plan caps its built-in Cron to once a
day, so once-a-day is fine for free; for anything more frequent you'd
either upgrade to Vercel Pro or use a free external pinger (e.g.
cron-job.org) hitting your `/api/scores` URL every few minutes.

## The one input: logging a Discord alert

Open "Log a Discord Alert" on the page and paste the alert text as-is, e.g.:

```
BUY QQQ 450C 8/15 @ 2.10 — momentum off open
```

It extracts the ticker and bullish/bearish direction automatically and folds
it into that ticker's score (with a confidence + benefit boost) on the next
refresh. No structured form fields required.

## Deploying

1. Push this folder to a new GitHub repo.
2. Import it into Vercel (vercel.com → New Project → your repo). No env
   vars are required for the site to work.
3. **(Recommended)** For Discord alerts to persist across requests instead
   of resetting on cold starts: in your Vercel project → Storage → Create
   → KV. Once created, Vercel auto-populates `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` for you — no manual copying needed, just redeploy.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000. Reddit/Yahoo calls happen from your own machine
in dev, so you'll see live data locally too.

## Tuning

- **Watchlist / subreddits scanned:** `lib/reddit.js` → `SUBREDDITS`
- **Scoring weights:** `lib/scoring.js` — confidence and benefit are each
  built from a weighted sum of signals; adjust the multipliers there.
- **Take threshold:** `TAKE_THRESHOLD` in `lib/scoring.js` (currently 72).
- **Refresh interval:** `REFRESH_MS` in `app/page.js` (currently 5 min).
