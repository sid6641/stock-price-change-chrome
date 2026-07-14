import { logger } from './logger';
import type { TickerResult } from '../types';

const BASE_URL = 'https://www.alphavantage.co/query';
const M = 'AlphaVantage';

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
  logger.log(M, `Looking up ${normalizedSymbol}`);
  const timeSeries = await fetchTimeSeries(normalizedSymbol, apiKey);
  const dates = Object.keys(timeSeries).sort();

  if (dates.length === 0) {
    logger.warn(M, `No data for ${normalizedSymbol}`);
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
  logger.log(M, `${normalizedSymbol}: latest ${latestDate} close = ${latestClose}`);

  // Find the closest trading day on or before the publish date
  const publishClose = findClosestPrice(timeSeries, publishDate);

  if (publishClose === null) {
    logger.warn(M, `No price near publish date ${publishDate} for ${normalizedSymbol}`);
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

  logger.log(M, `${normalizedSymbol}: publish ${publishDate} close = ${publishClose}`);
  const changePercent = ((latestClose - publishClose) / publishClose) * 100;
  logger.log(M, `${normalizedSymbol}: change = ${changePercent.toFixed(2)}%`);

  return {
    symbol: normalizedSymbol,
    companyName: normalizedSymbol,
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
    logger.log(M, `Cache HIT for ${symbol} (age: ${Math.round((Date.now() - cached.cachedAt) / 1000)}s)`);
    return cached.data;
  }

  logger.log(M, `Cache MISS for ${symbol} — fetching from API`);
  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${apiKey}`;

  const start = performance.now();
  const response = await fetch(url);
  const elapsed = Math.round(performance.now() - start);

  if (!response.ok) {
    logger.error(M, `API error (${response.status}) after ${elapsed}ms`);
    throw new Error(`Alpha Vantage error (${response.status})`);
  }

  const data = await response.json();
  logger.log(M, `API responded in ${elapsed}ms`);

  // Check for API error responses
  if (data['Error Message']) {
    logger.error(M, `API error for ${symbol}`, data['Error Message']);
    throw new Error(data['Error Message']);
  }
  if (data['Note']) {
    logger.warn(M, `Rate limited for ${symbol}`, data['Note'].slice(0, 100));
    throw new Error(`Rate limited: ${data['Note']}`);
  }

  const timeSeries = data['Time Series (Daily)'];
  if (!timeSeries) {
    logger.error(M, `No Time Series (Daily) in response for ${symbol}`);
    throw new Error(`No data for symbol: ${symbol}`);
  }

  // Parse and cache
  const parsed: Record<string, { close: number }> = {};
  for (const [dateStr, values] of Object.entries(timeSeries)) {
    const entry = values as Record<string, string>;
    parsed[dateStr] = { close: parseFloat(entry['4. close']) };
  }

  const dateCount = Object.keys(parsed).length;
  cache.set(symbol, { data: parsed, cachedAt: Date.now() });
  logger.log(M, `Cached ${dateCount} days of data for ${symbol}`);
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
