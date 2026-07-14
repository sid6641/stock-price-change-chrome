import { getVideoMeta, extractTranscript } from '../src/lib/youtube';
import { classifyVideo, extractTickers, extractTickersFromDescription } from '../src/lib/gemini';
import { getTickerData } from '../src/lib/alphavantage';
import { getConfig } from '../src/lib/storage';
import { renderResultsCard, removeResultsCard, renderScanButton, removeScanButton } from '../src/lib/ui';
import { logger } from '../src/lib/logger';
import type { TickerResult, ScanResult } from '../src/types';

const M = '[CONTENT]';

// ─── Module-level state (shared across re-evaluations) ────────

let currentVideoId: string = '';
let scanInProgress = false;
const tickerCache = new Map<string, TickerResult[]>();

/** Send message to background script, silently ignoring if not connected. */
function bgSend(msg: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // background not ready yet
  }
}

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*'],
  main() {
    // ─── Guard against duplicate injection ───────────────────────────
    if ((window as any).__TT_CONTENT_LOADED__) {
      console.log('🔥 Content script already loaded — skipping duplicate');
      return;
    }
    (window as any).__TT_CONTENT_LOADED__ = true;

    console.log('🔥🔥🔥 CONTENT SCRIPT IS ALIVE');
    console.log('🔥 URL:', window.location.href);
    console.log('🔥 Title:', document.title);

    // ─── Listen for SCAN trigger via direct messages ──────────────────

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.type === 'SCAN') {
        logger.log(M, 'Received SCAN via runtime.onMessage');
        runExtractionFlow().catch((err) => {
          logger.error(M, 'Error handling SCAN message', err);
        });
      }
      sendResponse({ received: true });
    });

    // ─── Listen for SCAN trigger via storage (most reliable) ─────────

    chrome.storage.onChanged.addListener((changes) => {
      if (changes['tt-scan-trigger']) {
        logger.log(M, 'Received SCAN via storage.onChanged');
        runExtractionFlow().catch((err) => {
          logger.error(M, 'Error handling storage SCAN', err);
        });
      }
    });

    // ─── Auto-trigger Stage 1 on page load ──────────────────────────────

    runTriggerFlow().catch((err) => {
      logger.error(M, 'Error in auto-trigger', err);
    });
  },
});

// ─── Stage 1: Trigger Flow ─────────────────────────────────────

async function runTriggerFlow(): Promise<void> {
  logger.log(M, '=== Stage 1: Trigger Flow ===');
  const meta = getVideoMeta();
  if (!meta) {
    logger.warn(M, 'Could not extract video metadata — aborting');
    return;
  }

  currentVideoId = meta.id;
  removeResultsCard();
  removeScanButton();

  const config = await getConfig();
  if (!config.geminiApiKey) {
    logger.warn(M, 'No Gemini API key configured — aborting');
    return;
  }

  try {
    const result = await classifyVideo(meta, config.geminiApiKey);

    if (!result.isFinance) {
      logger.log(M, 'Not finance content — clearing badge');
      bgSend({ type: 'SET_BADGE', count: 0 });
      removeScanButton();
      return;
    }

    // Finance content detected
    logger.log(M, `Finance content detected — ${result.tickers.length} tickers from title/description`);

    // Cache the Stage 1 result for later use (may be empty)
    tickerCache.set(meta.id, result.tickers.map((symbol) => ({
      symbol,
      companyName: '',
      changePercent: null,
      publishPrice: null,
      latestPrice: null,
      publishDate: meta.publishDate,
    })));

    // Only show badge and scan button if Stage 1 actually found tickers.
    // Without tickers from Stage 1 AND no transcript (Stage 2), there's nothing to show.
    if (result.tickers.length > 0) {
      bgSend({ type: 'SET_BADGE', count: result.tickers.length });

      renderScanButton(() => {
        runExtractionFlow().finally(() => {
          removeScanButton();
        });
      });
    } else {
      // No tickers from title alone — still try Stage 2 (transcript extraction),
      // but don't show a misleading badge. Run silently in background.
      logger.log(M, 'No tickers from Stage 1 — running Stage 2 silently');
      bgSend({ type: 'SET_BADGE', count: 0 });
      runExtractionFlow().catch((err) => {
        logger.error(M, 'Error in silent Stage 2', err);
      });
    }
  } catch (err) {
    logger.error(M, 'Stage 1 failed', err);
    bgSend({ type: 'SET_BADGE', count: 0 });
  }
}

// ─── Stage 2: Extraction Flow ──────────────────────────────────

async function runExtractionFlow(): Promise<void> {
  if (scanInProgress) {
    logger.log(M, 'Scan already in progress — ignoring duplicate click');
    return;
  }
  scanInProgress = true;

  logger.log(M, '=== Stage 2: Extraction Flow ===');

  try {
    const meta = getVideoMeta();
    if (!meta || meta.id !== currentVideoId) {
      logger.warn(M, 'Video meta mismatch or missing — aborting');
      scanInProgress = false;
      return;
    }

    const config = await getConfig();
    if (!config.geminiApiKey || !config.alphaVantageKey) {
      logger.warn(M, 'Missing API keys — aborting scan');
      scanInProgress = false;
      return;
    }

    // Extract transcript
    const transcript = await extractTranscript();
    const captionsAvailable = transcript !== null;
    logger.log(M, 'Captions available:', captionsAvailable);

    if (transcript) {
      // Extract tickers from full transcript via Gemini
      const tickers = await extractTickers(meta, transcript, config.geminiApiKey);

      if (tickers.length > 0) {
        logger.log(M, `Looking up prices for ${tickers.length} tickers`);
        const results = await lookupTickerPrices(tickers, meta.publishDate, config.alphaVantageKey);

        const scanResult: ScanResult = {
          videoId: meta.id,
          tickers: results,
          scannedAt: Date.now(),
          captionsAvailable,
        };

        tickerCache.set(meta.id, results);
        renderResultsCard(results);
        bgSend({ type: 'SCAN_RESULT', result: scanResult });
        logger.log(M, 'Scan complete — card rendered');
        scanInProgress = false;
        return;
      }

      logger.log(M, 'Transcript had no tickers — falling back to Stage 1');
    } else {
      // No transcript available — try extracting tickers from the
      // video description (which has now fully loaded since Stage 1).
      logger.log(M, 'No transcript — trying description-based extraction');
      const descTickers = await extractTickersFromDescription(meta, config.geminiApiKey);

      if (descTickers.length > 0) {
        logger.log(M, `Description-based extraction found ${descTickers.length} tickers`);
        const results = await lookupTickerPrices(descTickers, meta.publishDate, config.alphaVantageKey);

        const scanResult: ScanResult = {
          videoId: meta.id,
          tickers: results,
          scannedAt: Date.now(),
          captionsAvailable,
        };

        tickerCache.set(meta.id, results);
        renderResultsCard(results);
        bgSend({ type: 'SCAN_RESULT', result: scanResult });
        logger.log(M, 'Description-based scan complete — card rendered');
        scanInProgress = false;
        return;
      }
    }

    // Fallback: show Stage 1 tickers if transcript/description didn't yield more
    const cached = tickerCache.get(meta.id) ?? [];
    if (cached.length > 0) {
      logger.log(M, `Using ${cached.length} cached Stage 1 tickers`);
      const results = await lookupTickerPrices(
        cached.map((t) => t.symbol),
        meta.publishDate,
        config.alphaVantageKey,
      );
      renderResultsCard(results);
    } else {
      // No tickers from any source — nothing to show.
      // Don't render an empty card; just stay quiet.
      logger.log(M, 'No tickers found at all — nothing to render');
    }
  } catch (err) {
    logger.error(M, 'Stage 2 failed', err);
    bgSend({
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
  logger.log(M, `Starting price lookup for ${symbols.length} symbols`);

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    logger.log(M, `Price lookup [${i + 1}/${symbols.length}]: ${symbol}`);

    try {
      const data = await getTickerData(symbol, publishDate, apiKey);
      results.push(data);
    } catch (err) {
      logger.error(M, `Lookup failed for ${symbol}`, err);
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
    if (i < symbols.length - 1) {
      logger.log(M, `Waiting 12s before next Alpha Vantage call (rate limit)`);
      await delay(12000);
    }
  }

  const successCount = results.filter((r) => r.changePercent !== null).length;
  logger.log(M, `Price lookup complete: ${successCount}/${symbols.length} succeeded`);
  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
