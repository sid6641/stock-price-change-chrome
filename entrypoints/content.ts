// 🔥 MINIMAL SMOKE TEST — no imports
export default defineContentScript({
  matches: ['https://www.youtube.com/watch*'],
  main() {
    console.log('🔥🔥🔥 CONTENT SCRIPT IS ALIVE');
    console.log('🔥 URL:', window.location.href);
    console.log('🔥 Title:', document.title);
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

  const config = await getConfig();
  if (!config.geminiApiKey) {
    logger.warn(M, 'No Gemini API key configured — aborting');
    return;
  }

  try {
    const result = await classifyVideo(meta, config.geminiApiKey);

    if (!result.isFinance || result.tickers.length === 0) {
      logger.log(M, 'Not finance content or no tickers — clearing badge');
      chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 });
      return;
    }

    logger.log(M, `Finance content detected — setting badge to ${result.tickers.length}`);
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
  } catch (err) {
    logger.error(M, 'Stage 1 failed', err);
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 });
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
        chrome.runtime.sendMessage({ type: 'SCAN_RESULT', result: scanResult });
        logger.log(M, 'Scan complete — card rendered');
        scanInProgress = false;
        return;
      }

      logger.log(M, 'Transcript had no tickers — falling back to Stage 1');
    }

    // Fallback: show Stage 1 tickers if transcript didn't yield more
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
      logger.log(M, 'No tickers found at all — rendering empty card');
      renderResultsCard([]);
    }
  } catch (err) {
    logger.error(M, 'Stage 2 failed', err);
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
