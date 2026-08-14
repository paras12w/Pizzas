import yahooFinance from "yahoo-finance2";

export async function getQuote(ticker: string) {
  const quote = await yahooFinance.quote(ticker);
  return {
    price: quote.regularMarketPrice ?? 0,
    volume: quote.regularMarketVolume ?? 0,
    avgVolume: quote.averageDailyVolume3Month ?? quote.regularMarketVolume ?? 1,
    dayHigh: quote.regularMarketDayHigh,
    dayLow: quote.regularMarketDayLow,
  };
}

export async function getAnalystSignal(ticker: string) {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ["recommendationTrend", "financialData"],
    });
    const trend = result.recommendationTrend?.trend?.[0];
    const financialData = result.financialData;

    // Crude "upgrade" heuristic: current buy-leaning recs outweigh sells
    const buyLeaning = (trend?.strongBuy ?? 0) + (trend?.buy ?? 0);
    const sellLeaning = (trend?.sell ?? 0) + (trend?.strongSell ?? 0);

    return {
      analystUpgrade: buyLeaning > sellLeaning * 1.5,
      targetMeanPrice: financialData?.targetMeanPrice ?? null,
      recommendationKey: financialData?.recommendationKey ?? null,
    };
  } catch {
    return { analystUpgrade: false, targetMeanPrice: null, recommendationKey: null };
  }
}

export async function scanForVolumeSpikes(tickers: string[]) {
  const results = [];
  for (const t of tickers) {
    try {
      const q = await getQuote(t);
      const ratio = q.avgVolume > 0 ? q.volume / q.avgVolume : 1;
      results.push({ ticker: t, ...q, volumeRatio: ratio });
    } catch {
      // skip tickers that fail to fetch (delisted, typo, rate limit, etc)
    }
  }
  return results;
}
