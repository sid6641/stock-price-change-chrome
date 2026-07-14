import type { TickerResult } from '../types';

const BASE_URL = 'https://www.alphavantage.co/query';

// ─── In-Memory Cache ───────────────────────────────────────────

interface CacheEntry {
  data: Record<string, { close: number }>;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch historical daily data for a ticker and calculate % change
 * from the video's publish date to the latest close.
 *
 * Rate limit: 5 calls/minute. Caller is responsible for spacing.
 */
export async function getTickerData(
  symbol: string,
  publishDate: string,
  apiKey: string,
): Promise<TickerResult> {
  const normalizedSymbol = symbol.toUpperCase().trim();
  const timeSeries = await fetchTimeSeries(normalizedSymbol, apiKey);
  const dates = Object.keys(timeSeries).sort();

  if (dates.length === 0) {
    return {
      symbol: normalizedSymbol,
      companyName: '',
      changePercent: null,
      publishPrice: null,
      latestPrice: null,
      publishDate,
      error: 'No price data available',
    };
  }

  const latestDate = dates[dates.length - 1];
  const latestClose = parseFloat(timeSeries[latestDate].close);

  // Find the closest trading day on or before the publish date
  const publishClose = findClosestPrice(timeSeries, publishDate);

  if (publishClose === null) {
    return {
      symbol: normalizedSymbol,
      companyName: '',
      changePercent: null,
      publishPrice: null,
      latestPrice: latestClose,
      publishDate,
      error: 'Publish date outside available data range',
    };
  }

  const changePercent = ((latestClose - publishClose) / publishClose) * 100;

  return {
    symbol: normalizedSymbol,
    companyName: normalizedSymbol, // Alpha Vantage free tier doesn't include company name in daily endpoint
    changePercent: Math.round(changePercent * 100) / 100,
    publishPrice: Math.round(publishClose * 100) / 100,
    latestPrice: Math.round(latestClose * 100) / 100,
    publishDate,
  };
}

// ─── API Call ──────────────────────────────────────────────────

async function fetchTimeSeries(
  symbol: string,
  apiKey: string,
): Promise<Record<string, { close: number }>> {
  // Check cache
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Alpha Vantage error (${response.status})`);
  }

  const data = await response.json();

  // Check for API error responses
  if (data['Error Message']) {
    throw new Error(data['Error Message']);
  }
  if (data['Note']) {
    // Rate limit message
    throw new Error(`Rate limited: ${data['Note']}`);
  }

  const timeSeries = data['Time Series (Daily)'];
  if (!timeSeries) {
    throw new Error(`No data for symbol: ${symbol}`);
  }

  // Parse and cache
  const parsed: Record<string, { close: number }> = {};
  for (const [dateStr, values] of Object.entries(timeSeries)) {
    const entry = values as Record<string, string>;
    parsed[dateStr] = { close: parseFloat(entry['4. close']) };
  }

  cache.set(symbol, { data: parsed, cachedAt: Date.now() });
  return parsed;
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Find the close price for the closest trading day on or before the given date.
 */
function findClosestPrice(
  timeSeries: Record<string, { close: number }>,
  targetDate: string,
): number | null {
  const dates = Object.keys(timeSeries).sort();

  // Exact match
  if (timeSeries[targetDate]) {
    return timeSeries[targetDate].close;
  }

  // Find closest date before target
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= targetDate) {
      return timeSeries[dates[i]].close;
    }
  }

  return null;
}
