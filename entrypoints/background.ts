// 🔥 DIAGNOSTIC BACKGROUND — full instrumentation
const M = '🔥 BG';

export default defineBackground(() => {
  console.log(M, 'ALIVE — Service worker started');

  // ─── Listen for messages FROM content scripts ────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(M, 'Received message:', request.type, 'from', sender.tab?.id ?? 'unknown');

    switch (request.type) {
      case 'SET_BADGE': {
        const count = (request as any).count ?? 0;
        const text = count > 0 ? String(count) : '';
        chrome.action.setBadgeText({ text, tabId: sender.tab?.id });
        chrome.action.setBadgeBackgroundColor({ color: '#4caf50', tabId: sender.tab?.id });
        console.log(M, `Badge set to "${text}"`);
        sendResponse({ received: true });
        break;
      }
      case 'SCAN_RESULT': {
        const result = (request as any).result;
        console.log(M, 'Scan result received:', result?.tickers?.length ?? 0, 'tickers');
        sendResponse({ received: true });
        break;
      }
      case 'SCAN_ERROR': {
        console.error(M, 'Scan error:', (request as any).error);
        sendResponse({ received: true });
        break;
      }
      case 'FETCH_TRANSCRIPT': {
        const videoId = (request as any).videoId;
        console.log(M, 'Fetching transcript for video', videoId);
        fetchTranscript(videoId)
          .then((transcript) => {
            sendResponse({ transcript });
          })
          .catch((err) => {
            console.error(M, 'Transcript fetch failed:', err.message);
            sendResponse({ transcript: null, error: err.message });
          });
        return true; // Keep channel open for async response
      }
      default:
        console.log(M, 'Unknown message type:', request.type);
        sendResponse({ received: true });
    }
  });

  // ─── Click handler — signal content script via storage ──────────────
  chrome.action.onClicked.addListener(async (tab) => {
    console.log(M, 'Icon clicked on tab', tab.id, tab.url);
    if (!tab.id || !tab.url?.includes('youtube.com/watch')) {
      console.log(M, 'Not a YouTube watch page — ignoring');
      return;
    }

    // Write a scan trigger to storage; content script listens via onChanged
    const key = 'tt-scan-trigger';
    await chrome.storage.local.set({ [key]: { tabId: tab.id, time: Date.now() } });
    console.log(M, 'Scan trigger written to storage');

    // Also try direct message as a fast path
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SCAN' });
      console.log(M, 'SCAN sent via tabs.sendMessage (fast path)');
    } catch {
      console.log(M, 'tabs.sendMessage fast path failed — content script will pick up via storage');
    }
  });

  // ─── Fetch transcript from youtubetranscript.com ─────────────────
  // Runs in the background to bypass CORS restrictions on content scripts.
  async function fetchTranscript(videoId: string): Promise<string | null> {
    const url = `https://youtubetranscript.com/?v=${videoId}&format=json`;
    console.log(M, 'Fetching transcript from youtubetranscript.com for', videoId);

    try {
      const response = await fetch(url);
      console.log(M, 'youtubetranscript.com response status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawText = await response.text();
      // Check if response is HTML (not JSON)
      if (rawText.trim().startsWith('<!')) {
        console.error(M, 'youtubetranscript.com returned HTML (video likely has no captions or service changed)');
        throw new Error('No transcript available for this video');
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        console.error(M, 'Response is not valid JSON:', rawText.slice(0, 200));
        throw new Error('Invalid response format');
      }

      if (!Array.isArray(data)) {
        console.error(M, 'Unexpected response format:', JSON.stringify(data).slice(0, 200));
        throw new Error('Unexpected response format');
      }

      const lines: string[] = [];
      for (const segment of data) {
        if (segment.text) {
          const clean = segment.text
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (clean) lines.push(clean);
        }
      }

      const text = lines.join(' ');
      const wordCount = text.split(/\s+/).length;
      console.log(M, `Transcript: ${wordCount} words from ${lines.length} segments`);
      if (wordCount < 5) return null;
      return text;
    } catch (err) {
      console.error(M, 'fetchTranscript error:', (err as Error).message);
      console.error(M, 'fetchTranscript stack:', (err as Error).stack?.slice(0, 300));
      throw err;
    }
  }
});


