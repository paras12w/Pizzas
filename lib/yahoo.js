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
    impliedVolatility: null,
    putCallRatio: null,
    valid: false,
  };

  try {
    const quote = await yahooFinance.quote(ticker);
    if (!quote || quote.quoteType === "MUTUALFUND") return snapshot;

    snapshot.price = quote.regularMarketPrice ?? null;
    snapshot.changePercent = quote.regularMarketChangePercent ?? null;
    snapshot.volume = quote.regularMarketVolume ?? null;
    snapshot.avgVolume = quote.averageDailyVolume10Day ?? quote.averageDailyVolume3Month ?? null;
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
