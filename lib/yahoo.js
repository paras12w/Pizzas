import YahooFinance from "yahoo-finance2";

// v4 of yahoo-finance2 is class-based — instantiate once and reuse.
const yahooFinance = new YahooFinance();

/**
 * Pulls price/volume momentum data plus a lightweight options-activity read
 * for a single ticker. Every field is defensive — Yahoo's unofficial API
 * occasionally omits fields or 404s on delisted/invalid symbols.
 */
export async function fetchTickerSnapshot(ticker) {
  const snapshot = {
    ticker,
    price: null,
    changePercent: null,
    volume: null,
    avgVolume: null,
    volumeRatio: null,
    dayLow: null,
    dayHigh: null,
    impliedVolatility: null,
    putCallRatio: null,
    // Wall Street's own consensus, e.g. "1.8 - Buy" (1 = Strong Buy, 5 =
    // Strong Sell). Comes back on the same quote() call we're already
    // making — no extra request.
    analystRating: null,
    // Multi-day trend structure for the "swing potential" read in
    // lib/scoring.js — also free on the same quote() call, no extra
    // request. Where a ticker sits relative to its own moving averages and
    // 52-week range says more about swing structure than a single day's
    // move does.
    fiftyDayAverage: null,
    twoHundredDayAverage: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    valid: false,
  };

  try {
    const quote = await yahooFinance.quote(ticker);
    if (!quote || quote.quoteType === "MUTUALFUND") return snapshot;

    snapshot.price = quote.regularMarketPrice ?? null;
    snapshot.changePercent = quote.regularMarketChangePercent ?? null;
    snapshot.volume = quote.regularMarketVolume ?? null;
    snapshot.avgVolume = quote.averageDailyVolume10Day ?? quote.averageDailyVolume3Month ?? null;
    snapshot.dayLow = quote.regularMarketDayLow ?? null;
    snapshot.dayHigh = quote.regularMarketDayHigh ?? null;
    snapshot.analystRating = quote.averageAnalystRating ?? null;
    snapshot.fiftyDayAverage = quote.fiftyDayAverage ?? null;
    snapshot.twoHundredDayAverage = quote.twoHundredDayAverage ?? null;
    snapshot.fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh ?? null;
    snapshot.fiftyTwoWeekLow = quote.fiftyTwoWeekLow ?? null;
    if (snapshot.volume && snapshot.avgVolume) {
      snapshot.volumeRatio = snapshot.volume / snapshot.avgVolume;
    }
    snapshot.valid = true;
  } catch (err) {
    console.error(`[yahoo] quote failed for ${ticker}:`, err.message);
    return snapshot;
  }

  // Options chain is best-effort — used for the "benefit" side of the score.
  try {
    const chain = await yahooFinance.options(ticker);
    const nearExpiry = chain?.options?.[0];
    if (nearExpiry) {
      const calls = nearExpiry.calls || [];
      const puts = nearExpiry.puts || [];
      const callVol = calls.reduce((s, c) => s + (c.volume || 0), 0);
      const putVol = puts.reduce((s, p) => s + (p.volume || 0), 0);
      if (callVol + putVol > 0) {
        snapshot.putCallRatio = putVol / Math.max(callVol, 1);
      }
      const ivs = calls.map((c) => c.impliedVolatility).filter((v) => typeof v === "number");
      if (ivs.length) {
        snapshot.impliedVolatility = ivs.reduce((a, b) => a + b, 0) / ivs.length;
      }
    }
  } catch (err) {
    // Options data is a bonus signal, not required — fail silently per-ticker.
  }

  return snapshot;
}

export async function fetchManySnapshots(tickers) {
  const results = await Promise.all(
    tickers.map((t) => fetchTickerSnapshot(t).catch(() => null))
  );
  return results.filter(Boolean);
}

/**
 * Most recent news headline for a ticker, for the "trade on new news"
 * catalyst read in lib/scoring.js — best-effort, one extra Yahoo request
 * per ticker checked, so the caller (app/api/scores/route.js) only calls
 * this for a bounded subset of the candidate pool rather than every
 * candidate, to avoid piling more load onto an already rate-limit-prone
 * free API.
 */
export async function fetchTickerNews(ticker) {
  try {
    const result = await yahooFinance.search(ticker, { newsCount: 3, quotesCount: 0 });
    const article = (result?.news || [])[0];
    if (!article?.providerPublishTime) return null;
    return {
      title: article.title || "",
      publishedAt: new Date(article.providerPublishTime).getTime(),
    };
  } catch (err) {
    return null;
  }
}

export async function fetchManyNews(tickers) {
  const entries = await Promise.all(
    tickers.map(async (t) => [t, await fetchTickerNews(t)])
  );
  return new Map(entries.filter(([, news]) => news));
}

/**
 * Live market-mover tickers (most active + today's top gainers + today's top
 * losers) straight from Yahoo. Used as a supplemental candidate source since
 * Reddit's public JSON endpoints frequently get blocked from cloud/serverless
 * IP ranges (Vercel's included) regardless of User-Agent, *and* because
 * Reddit's own content skews bullish (moon/rocket posts vastly outnumber
 * short theses) — without day_losers here, the board's Sell list would
 * almost always come up short even when Reddit is working fine.
 */
// Returned as separate lists (not one flat array) so the caller can budget
// slots between them explicitly — giving one direction unlimited first claim
// on a shared cap starves the other (learned that the hard way: losers-first
// filled Sell but then starved Buy of gainers).
export async function fetchMarketMovers(count = 15) {
  const dedupe = (result) => Array.from(new Set((result?.quotes || []).map((q) => q.symbol).filter(Boolean)));
  try {
    const [actives, gainers, losers] = await Promise.all([
      yahooFinance.screener({ scrIds: "most_actives", count }).catch(() => null),
      yahooFinance.screener({ scrIds: "day_gainers", count }).catch(() => null),
      yahooFinance.screener({ scrIds: "day_losers", count }).catch(() => null),
    ]);
    return { losers: dedupe(losers), actives: dedupe(actives), gainers: dedupe(gainers) };
  } catch (err) {
    console.error("[yahoo] market movers failed:", err.message);
    return { losers: [], actives: [], gainers: [] };
  }
}

// Standard 14-period RSI off a closing-price series — 0 (relentlessly
// selling) to 100 (relentlessly buying). Used to time swing entries: not
// "is this trending" (lib/scoring.js's `structure` component already
// covers that with moving averages), but "is this a good moment to open a
// NEW position" — buying into an already-overbought move or shorting an
// already-oversold one is chasing, not a swing entry.
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Short-swing entry timing for a ticker, via daily-close RSI(14) over the
 * last ~40 calendar days. Deliberately its own function (not folded into
 * fetchTickerSnapshot) since it's an extra Yahoo request only worth paying
 * for a small, bounded set of tickers — see SWING_TICKERS in
 * lib/scoring.js and its use in app/api/scores/route.js.
 */
export async function fetchSwingTiming(ticker) {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 40 * 24 * 60 * 60 * 1000);
  try {
    const result = await yahooFinance.chart(ticker, { period1, period2, interval: "1d" });
    const closes = (result?.quotes || []).map((q) => q.close).filter((c) => c != null);
    return { rsi: computeRSI(closes) };
  } catch (err) {
    return { rsi: null };
  }
}

export async function fetchManySwingTiming(tickers) {
  const entries = await Promise.all(tickers.map(async (t) => [t, await fetchSwingTiming(t)]));
  return new Map(entries);
}

/**
 * Intraday candles for the ticker-detail chart — last 5 trading days at
 * 15-minute resolution, which is the tightest interval Yahoo's chart
 * endpoint reliably serves that far back without an API key.
 */
export async function fetchTickerHistory(ticker) {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 5 * 24 * 60 * 60 * 1000);

  try {
    const result = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval: "15m",
    });
    const candles = (result?.quotes || [])
      .filter((q) => q.close != null)
      .map((q) => ({ date: q.date, close: q.close }));
    return { ticker, candles };
  } catch (err) {
    console.error(`[yahoo] history failed for ${ticker}:`, err.message);
    return { ticker, candles: [] };
  }
}
