import { getVideoMeta, extractTranscript, onYouTubeNavigation } from '../src/lib/youtube';
import { classifyVideo, extractTickers } from '../src/lib/gemini';
import { getConfig } from '../src/lib/storage';
import { getTickerData } from '../src/lib/alphavantage';
import { renderResultsCard, removeResultsCard } from '../src/lib/ui';
import type { ExtensionMessage, TickerResult, ScanResult } from '../src/types';

// ─── State ─────────────────────────────────────────────────────

let currentVideoId: string | null = null;
let scanInProgress = false;
const tickerCache = new Map<string, TickerResult[]>();

// ─── Entry Point ───────────────────────────────────────────────

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*'],
  main() {
    // Run on initial load
    runTriggerFlow();

    // Re-run on SPA navigation
    const cleanup = onYouTubeNavigation(() => {
      runTriggerFlow();
    });

    // Listen for SCAN message from background
    chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
      if (msg.type === 'SCAN') {
        runExtractionFlow();
      }
    });

    // Cleanup on unload
    window.addEventListener('beforeunload', cleanup);
  },
});

// ─── Stage 1: Trigger Flow ─────────────────────────────────────

async function runTriggerFlow(): Promise<void> {
  const meta = getVideoMeta();
  if (!meta) return;

  currentVideoId = meta.id;
  removeResultsCard();

  const config = await getConfig();
  if (!config.geminiApiKey) return; // Not configured yet

  try {
    const result = await classifyVideo(meta, config.geminiApiKey);

    if (!result.isFinance || result.tickers.length === 0) {
      // Not finance content — clean up
      chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 });
      return;
    }

    // Finance content with tickers — set badge
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: result.tickers.length });

    // Cache the Stage 1 result for later use
    tickerCache.set(meta.id, result.tickers.map((symbol) => ({
      symbol,
      companyName: '',
      changePercent: null,
      publishPrice: null,
      latestPrice: null,
      publishDate: meta.publishDate,
    })));
  } catch {
    // Gemini call failed — silently exit (no badge)
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 });
  }
}

// ─── Stage 2: Extraction Flow ──────────────────────────────────

async function runExtractionFlow(): Promise<void> {
  if (scanInProgress) return;
  scanInProgress = true;

  try {
    const meta = getVideoMeta();
    if (!meta || meta.id !== currentVideoId) {
      scanInProgress = false;
      return;
    }

    const config = await getConfig();
    if (!config.geminiApiKey || !config.alphaVantageKey) {
      scanInProgress = false;
      return;
    }

    // Extract transcript
    const transcript = await extractTranscript();
    const captionsAvailable = transcript !== null;

    if (transcript) {
      // Extract tickers from full transcript via Gemini
      const tickers = await extractTickers(meta, transcript, config.geminiApiKey);

      if (tickers.length > 0) {
        // Look up price data for each ticker
        const results = await lookupTickerPrices(tickers, meta.publishDate, config.alphaVantageKey);

        const scanResult: ScanResult = {
          videoId: meta.id,
          tickers: results,
          scannedAt: Date.now(),
          captionsAvailable,
        };

        tickerCache.set(meta.id, results);
        renderResultsCard(results);
        chrome.runtime.sendMessage({ type: 'SCAN_RESULT', result: scanResult });
        scanInProgress = false;
        return;
      }
    }

    // Fallback: show Stage 1 tickers if transcript didn't yield more
    const cached = tickerCache.get(meta.id) ?? [];
    if (cached.length > 0) {
      const results = await lookupTickerPrices(
        cached.map((t) => t.symbol),
        meta.publishDate,
        config.alphaVantageKey,
      );
      renderResultsCard(results);
    } else {
      // No tickers found at all
      renderResultsCard([]);
    }
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'SCAN_ERROR',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  } finally {
    scanInProgress = false;
  }
}

// ─── Price Lookup ──────────────────────────────────────────────

async function lookupTickerPrices(
  symbols: string[],
  publishDate: string,
  apiKey: string,
): Promise<TickerResult[]> {
  const results: TickerResult[] = [];

  for (const symbol of symbols) {
    try {
      const data = await getTickerData(symbol, publishDate, apiKey);
      results.push(data);
    } catch {
      results.push({
        symbol: symbol.toUpperCase(),
        companyName: '',
        changePercent: null,
        publishPrice: null,
        latestPrice: null,
        publishDate,
        error: 'Lookup failed',
      });
    }

    // Rate limit: 12s spacing between Alpha Vantage calls (5/min free tier)
    if (symbols.length > 1) {
      await delay(12000);
    }
  }

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
