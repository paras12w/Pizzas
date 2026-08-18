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
       (55), conservative sizing (5%–20% of current bankroll based on
       confidence strength), 6h max hold.
     - **Bot B** (`/bot-b`, kept separate): looser entry threshold (42),
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
recomputes while someone has the page open. To let the bots keep opening
and closing positions unattended (so a trade started while nobody's
watching has actually played out by the time you check back), this repo
ships `.github/workflows/keep-bots-trading.yml` — a free GitHub Actions
job that pings `/api/scores` every 10 minutes. It defaults to the deployed
URL baked into the workflow; if that domain ever changes (e.g. moving off
a preview URL onto a stable alias or custom domain), set a repo variable
named `SITE_URL` (Settings → Secrets and variables → Actions → Variables)
to override it — no file edit needed. Note this only runs while the
workflow is enabled on GitHub (public repos get unlimited free Actions
minutes; private repos get a monthly quota) — Vercel's free Hobby plan
still caps its own built-in Cron to once a day, which is why this pings
from GitHub instead.

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
3. **(Recommended — effectively required if you enable the keep-alive
   workflow in step 6)** For alerts, bot positions, watchlist, notification
   settings, and calibrated weights to persist across requests instead of
   resetting on cold starts: in your Vercel project → **Storage** tab →
   **Browse Storage**. The standalone "KV" product is retired, so instead
   pick **Upstash** under "Marketplace Database Providers" (not Neon —
   that's Postgres, the wrong kind of database for this) and create a
   **Redis** database through it. Connect it to this project when prompted,
   then redeploy (Deployments tab → ⋯ on the latest deployment → Redeploy).
   Check **Settings → Environment Variables** afterward — this app accepts
   either `KV_REST_API_URL`/`KV_REST_API_TOKEN` or
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, whichever the
   integration named them, so it should pick them up automatically either
   way. The "storage isn't persistent" banner on the board goes away once
   this is done and the app redeploys.
4. **(Optional)** For Discord push notifications when a bot opens/closes a
   position: create a webhook on a Discord channel (Channel Settings →
   Integrations → Webhooks) and set `DISCORD_WEBHOOK_URL` in your Vercel
   project's env vars to that URL.
5. **(Optional)** For email notifications: sign up at resend.com (free
   tier), create an API key, and set `RESEND_API_KEY` in your Vercel
   project's env vars. Until this is set, the notification toggle still
   saves your preference but nothing actually sends.
6. **(Recommended, requires step 3's persistent storage to actually work)**
   For the bots to keep opening/closing trades in the background even with
   nobody on the page: this repo already includes
   `.github/workflows/keep-bots-trading.yml`, which pings `/api/scores`
   every 10 minutes via GitHub Actions — nothing to install, it runs as
   soon as the workflow file is on GitHub's default branch (check the
   **Actions** tab to confirm it's enabled; GitHub disables new workflows
   on forks/imports by default until you click "I understand my workflows,
   go ahead and enable them"). Without step 3's Redis storage, each ping
   likely lands on a fresh serverless instance with reset in-memory state,
   so positions won't actually accumulate between pings.

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
- **Take threshold:** `TAKE_THRESHOLD` in `lib/scoring.js` (currently 55,
  used for the board's "Taken" badge and Bot A's default)
- **Alert confidence floor:** `ALERT_MIN_CONFIDENCE` in `lib/scoring.js` (currently 78)
- **Quality gates (penny stocks, thin liquidity, anomalous moves):**
  `MIN_TRADABLE_PRICE`, `MIN_AVG_VOLUME`, `EXTREME_MOVE_PCT` in
  `lib/scoring.js` — a ticker failing any of these is excluded from scoring
  entirely (never ranked, never traded), even if it has a Discord alert.
- **Bot configs (threshold, exit, stop-loss, take-profit, sizing, max hold):**
  `BOT_CONFIGS` in `lib/bot.js` — `maxSizePct` is capped at 15% for both
  bots; position sizing is based on a ticker's `rawConfidence` (its score
  *before* any Discord-alert floor is applied), so an alert always gets a
  trade taken but sizes it by how strong the underlying signal actually was,
  not the floor value.
- **Alert-rescue sizing floor:** `ALERT_RESCUE_MIN_PCT` in `lib/bot.js`
  (currently 2%) — the size an alert-driven trade gets when the ticker had
  essentially no underlying signal on its own.
- **Options sizing dampener:** `OPTION_SIZE_DAMPENER` in `lib/bot.js`
  (currently 0.5×) — applied when a Discord alert's `instrument` is
  detected as an option (leg like `450C`, or words like "calls"/"puts"/
  "strike") rather than a plain stock mention, since we track P&L against
  the underlying's price, not the option's actual premium, and options
  swing far more per dollar than the same size in shares would.
- **Calibration sensitivity:** `MIN_SAMPLE`, `RECALIBRATION_STEP`, `NUDGE_CAP`
  in `lib/calibration.js`
- **Refresh interval:** `REFRESH_MS` in `app/page.js` (currently 15s)
- **Candidate pool size:** `TICKER_CAP` in `app/api/scores/route.js`
  (currently 30) — raising this gives the quality gates above more raw
  candidates to filter down from before a list comes up short, at the cost
  of more Yahoo requests per cycle.
- **Reset test data:** the "Reset test data" button on `/alerts` clears all
  logged alerts and resets both bots to a clean $10,000 — useful after
  testing, not something to hit mid-session with real trades open.
