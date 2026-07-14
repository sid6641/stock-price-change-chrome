# Technical Spec: YouTube Ticker Tracker — Chrome Extension

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Browser                           │
│                                                                 │
│  ┌────────────────────┐      ┌──────────────────────────────┐   │
│  │  youtube.com/watch  │      │  Service Worker (background) │   │
│  │                     │      │                              │   │
│  │  ┌───────────────┐  │      │  ┌────────────────────────┐ │   │
│  │  │ Content Script │──┼──────┼──┤ chrome.action badge    │ │   │
│  │  │ (injected)     │  │      │  │ onClicked listener     │ │   │
│  │  │               │  │      │  │ message router         │ │   │
│  │  │ - Gemini x2   │  │      │  └────────────────────────┘ │   │
│  │  │ - Alpha Van.  │  │      └──────────────────────────────┘   │
│  │  │ - DOM parse   │  │                                         │
│  │  │ - UI render   │  │      ┌──────────────────────────────┐   │
│  │  └───────────────┘  │      │  Options Page                │   │
│  └────────────────────┘      │  - Gemini API key             │   │
│                               │  - Alpha Vantage API key      │   │
│                               └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
  ┌──────────────┐          ┌──────────────────┐
  │  Gemini API  │          │  Alpha Vantage   │
  │  (trigger +  │          │  (stock prices)  │
  │  extraction) │          │                  │
  └──────────────┘          └──────────────────┘
```

**Three extension entry points, one coherent pipeline.**

| Entry Point | Role | Runs In |
|-------------|------|---------|
| `entrypoints/content.ts` | Page interaction, Gemini calls, Alpha Vantage, UI rendering | YouTube page (isolated world) |
| `entrypoints/background.ts` | Badge management, click routing, message broker | Service worker (background) |
| `entrypoints/options.html` + `.ts` | API key configuration | Extension options page |

## Tech Stack

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| Extension framework | WXT | latest | Manifest generation, HMR, TypeScript-first, multi-browser builds |
| Language | TypeScript | 5.x | Type safety across async API orchestration |
| Build tool | Vite (via WXT) | 6.x | Fast bundling, HMR, tree-shaking |
| Content AI | Gemini | gemini-2.5-flash | Fast, cheap, single model for both trigger and extraction |
| Stock data | Alpha Vantage REST | free tier | 5 calls/min, 500/day, no credit card needed |
| Storage | `chrome.storage.local` | MV3 | API keys, cross-session cache, no sync needed |
| UI | Vanilla DOM API | — | No framework overhead for a single card |

## Data Flow — End to End

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FULL PIPELINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PAGE LOAD                                                                  │
│  ─────────                                                                  │
│  1. content.ts detects youtube.com/watch* match                            │
│  2. Extracts video {id, title, description, publishDate} from DOM          │
│  3. Reads API keys from chrome.storage.local                                │
│  4. Calls Gemini with title + description → {is_finance, tickers[]}        │
│  5. If !is_finance → exit (invisible)                                      │
│  6. If tickers found → sendMessage({type: 'SET_BADGE', count}) to bg       │
│  7. background.ts sets chrome.action.setBadgeText({text: String(count)})   │
│                                                                             │
│  BADGE CLICK                                                                │
│  ───────────                                                                │
│  8. User clicks extension icon                                              │
│  9. background.ts onClicked fires → sendMessage({type: 'SCAN'}) to tab     │
│  10. content.ts receives SCAN message                                       │
│  11. Extracts transcript from YouTube page DOM                              │
│  12. Calls Gemini with title + full transcript → {tickers[]}               │
│  13. Deduplicates tickers from Stage 1 + Stage 2                            │
│  14. For each ticker (with rate limiting):                                  │
│        a. Call Alpha Vantage TIME_SERIES_DAILY                              │
│        b. Look up close price on publish date                               │
│        c. Look up latest close price                                        │
│        d. Calculate % change                                                │
│  15. Renders results card below video player                                │
│  16. Cache results for this video session (in-memory Map<videoId, Result>)  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
stock-price-change-chrome/
├── wxt.config.ts                  # WXT configuration
├── package.json                   # Dependencies + scripts
├── tsconfig.json                  # TypeScript config
├── public/
│   └── icon.png                   # Extension icon (128x128)
├── entrypoints/
│   ├── background.ts              # Service worker
│   ├── content.ts                 # Content script (main pipeline)
│   └── options.html               # Options page
│       └── options.ts
└── src/
    ├── lib/
    │   ├── gemini.ts              # Gemini API client
    │   ├── alphavantage.ts        # Alpha Vantage client
    │   ├── youtube.ts             # YouTube page helpers
    │   ├── ui.ts                  # Card rendering engine
    │   └── storage.ts             # chrome.storage abstraction
    └── types.ts                   # Shared TypeScript types
```

## Key Design Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Gemini model | `gemini-2.5-flash` | Fast (~1-2s), cheap, good accuracy. Flash models are optimized for speed/cost. | `gemini-2.0-pro` (slower, more expensive, overkill for this) |
| Transcript source | YouTube page DOM (`ytInitialPlayerResponse`) | No extra API key. No OAuth. No quota. The caption data is already embedded in the page. | YouTube Data API v3 captions endpoint (needs API key + caption ID lookup) |
| Cache strategy | In-memory `Map<videoId, Result>` | Simplest. Survives navigation within SPA. Cleared on page unload. Sufficient for single-session use. | `chrome.storage.local` (persists across sessions, but data is ephemeral anyway) |
| Rate limiting | Simple queue with `setTimeout` delay | Alpha Vantage is 5 calls/min. A 12s delay between calls is plenty. No need for complex token bucket. | Token bucket algorithm, external queue library |
| UI rendering | Vanilla DOM (`document.createElement`) | The card is ~20 DOM nodes. No framework justified. | React via WXT (overkill for one card), Lit (another dep to maintain) |
| API key storage | `chrome.storage.local` | Sandboxed to extension, survives restarts, no sync (user doesn't want API keys roaming). | `chrome.storage.sync` (roams with Chrome sync — not appropriate for secrets) |

## Integration Points

### Gemini API

**Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`

**Call 1 — Trigger** (auto on page load):

```typescript
// Request
{
  contents: [{
    role: "user",
    parts: [{
      text: `You are a financial content classifier. Analyze this YouTube video.

Title: "${title}"
Description: "${description}"

Identify if this video discusses stock market, investing, trading, or specific companies/equities.

Respond with JSON only:
{"is_finance": boolean, "tickers": string[], "reasoning": "brief explanation"}`
    }]
  }],
  generationConfig: {
    temperature: 0.1,        // Low temp for deterministic classification
    maxOutputTokens: 200     // Short response
  }
}
```

**Call 2 — Extraction** (on badge click):

```typescript
// Request
{
  contents: [{
    role: "user",
    parts: [{
      text: `You are a stock ticker extraction assistant. Extract ALL stock ticker symbols mentioned in this YouTube video transcript.

Title: "${title}"
Transcript: "${transcript}"

Rules:
- Include NYSE and NASDAQ listed tickers only
- Exclude non-equity tickers (crypto, ETFs, indices like SPX/NDX)
- Exclude common words that happen to be tickers (IT, AI, GO, etc.) unless context clearly indicates they're stocks
- No duplicates

Respond with JSON only:
{"tickers": string[], "total_found": number}`
    }]
  }],
  generationConfig: {
    temperature: 0.1,
    maxOutputTokens: 1024
  }
}
```

### Alpha Vantage API

**Endpoint**: `https://www.alphavantage.co/query`

**Time Series Daily** (for % change calculation):

```
GET /query?function=TIME_SERIES_DAILY&symbol=NVDA&outputsize=compact&apikey=${KEY}
```

**Response shape**:
```json
{
  "Meta Data": { "2. Symbol": "NVDA", "3. Last Refreshed": "2026-07-14" },
  "Time Series (Daily)": {
    "2026-07-14": { "4. close": "142.50" },
    "2026-07-13": { "4. close": "140.20" },
    ...
  }
}
```

**% Change Calculation:**
```
publishDateClose  = findClosestDate(data, videoPublishDate)
latestClose       = data[latest_date].close
changePercent     = ((latestClose - publishDateClose) / publishDateClose) * 100
```

**Rate Limiting**: 5 calls/minute, 500 calls/day.
- Queue ticker lookups with 12s spacing between calls
- Cache results in-memory per session
- Optional: cache to `chrome.storage.local` with 24h TTL for cross-session reuse

## Data Model

### `src/types.ts`

```typescript
/** Video metadata extracted from YouTube page */
interface VideoMeta {
  id: string;              // YouTube video ID (e.g., "dQw4w9WgXcQ")
  title: string;           // Video title
  description: string;     // Video description
  publishDate: string;     // ISO date string (e.g., "2026-07-10")
}

/** Stage 1 result: trigger classification */
interface TriggerResult {
  isFinance: boolean;
  tickers: string[];       // Tickers found in title/description
  reasoning?: string;
}

/** Single ticker result with price data */
interface TickerResult {
  symbol: string;          // e.g., "NVDA"
  companyName: string;     // e.g., "NVIDIA Corporation"
  changePercent: number;   // e.g., 5.2
  publishPrice: number;    // Close price on publish date
  latestPrice: number;     // Latest close price
  publishDate: string;     // Date used for comparison
  error?: string;          // e.g., "No price data available"
}

/** Full pipeline result per video */
interface ScanResult {
  videoId: string;
  tickers: TickerResult[];
  scannedAt: number;       // timestamp
  captionsAvailable: boolean;
}

/** Extension configuration */
interface ExtensionConfig {
  geminiApiKey?: string;
  alphaVantageKey?: string;
}
```

## Implementation Notes

### 1. YouTube Transcript Extraction

Access the transcript data embedded in YouTube's page source. YouTube stores initial data in a global variable:

```typescript
// Extract from <script> tag containing ytInitialPlayerResponse
function extractCaptionUrl(): string | null {
  const script = document.querySelector('script#ytd-page-data') 
    ?? Array.from(document.querySelectorAll('script'))
         .find(s => s.textContent?.includes('ytInitialPlayerResponse'));
  
  if (!script?.textContent) return null;
  
  // Parse the JSON from: var ytInitialPlayerResponse = {...};
  const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
  if (!match) return null;
  
  try {
    const data = JSON.parse(match[1]);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) return null;
    
    // Prefer English, fallback to first available
    const eng = tracks.find((t: any) => t.languageCode === 'en');
    return (eng ?? tracks[0]).baseUrl;
  } catch { return null; }
}
```

Then fetch the caption URL (returns XML/SRT) and parse the text content.

**Fallback**: If `ytInitialPlayerResponse` isn't available, look for the transcript panel elements in the DOM (YouTube renders them when the user opens the transcript panel). For the MVP, we just need the embedded data approach — it covers the vast majority of finance videos.

### 2. Gemini Module (`src/lib/gemini.ts`)

Single module, two exported functions:

```typescript
export async function classifyVideo(meta: VideoMeta, apiKey: string): Promise<TriggerResult>
export async function extractTickers(meta: VideoMeta, transcript: string, apiKey: string): Promise<string[]>
```

Both use the same underlying `callGemini(prompt, apiKey, maxTokens)` helper.

**Error handling**: 
- Network errors → return `{ isFinance: false, tickers: [] }` (fail silent)
- API errors (bad key, quota) → return typed error, surface to user
- Parse errors (non-JSON response) → retry once with stricter prompt

### 3. Alpha Vantage Module (`src/lib/alphavantage.ts`)

```typescript
export async function getTickerData(
  symbol: string, 
  publishDate: string, 
  apiKey: string
): Promise<{ closePrice: number; changePercent: number } | { error: string }>
```

**Behavior**:
- If the publish date is a weekend/holiday, find the closest trading day **before** the publish date
- Cache: Check in-memory cache first, then `chrome.storage.local` (24h TTL)
- Rate limit: Queue requests with 12s gaps
- Error: Return `{ error: "No data" }` — never throw

### 4. UI Module (`src/lib/ui.ts`)

Renders a card below YouTube's `#below` element.

```typescript
export function renderResultsCard(container: HTMLElement, results: TickerResult[]): void
export function removeResultsCard(): void
```

**Card structure**:
```html
<div id="ticker-tracker-card" style="...">
  <div class="tt-header">
    <span>📈 Ticker Performance</span>
    <span class="tt-date">Since Jul 10, 2026</span>
    <button class="tt-close">✕</button>
  </div>
  <div class="tt-list">
    <div class="tt-row" data-symbol="NVDA">
      <span class="tt-symbol">NVDA</span>
      <span class="tt-name">NVIDIA Corporation</span>
      <span class="tt-change tt-up">▲ +5.2%</span>
    </div>
    ...
  </div>
</div>
```

**Insertion**: Use `MutationObserver` to wait for YouTube's `#below` element, then insert as the first child. YouTube uses an SPA, so re-run on navigation.

**Styling**: Inline styles (no CSS files needed for MVP). Match YouTube's dark theme colors:
- Background: `#0f0f0f`
- Card background: `#212121`
- Text: `#f1f1f1`
- Green: `#4caf50` + text "Up"
- Red: `#ef5350` + text "Down"

### 5. Content Script (`entrypoints/content.ts`)

Main pipeline orchestrator. Split into clear phases:

```
onYouTubePage()
  → getVideoMeta()              # Extract title, desc, publish date from DOM
  → getConfig()                  # Read API keys from storage
  → classifyVideo(meta, key)     # Stage 1: Gemini trigger
  → if isFinance → setBadge()
  → listen for SCAN message      # Wait for user click
  → onScan():
      → extractTranscript()      # Parse from ytInitialPlayerResponse
      → extractTickers(meta, transcript, key)  # Stage 2: Gemini extraction
      → deduplicate()
      → batchAlphaVantage(tickers, publishDate)
      → renderResultsCard()
```

**SPA Navigation**: YouTube uses client-side routing. Re-run `onYouTubePage()` on URL changes detected via `yt-navigate-finish` event or `popstate`.

### 6. Background Service Worker (`entrypoints/background.ts`)

```typescript
// Badge management
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'SET_BADGE') {
    const count = msg.count > 0 ? String(msg.count) : '';
    chrome.action.setBadgeText({ text: count, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
  }
});

// Click triggers scan message to content script
chrome.action.onClicked.addListener((tab) => {
  if (tab.id && tab.url?.includes('youtube.com/watch')) {
    chrome.tabs.sendMessage(tab.id, { type: 'SCAN' });
  }
});
```

### 7. Options Page (`entrypoints/options.html` + `.ts`)

Simple HTML form:
- Gemini API key input (password field)
- Alpha Vantage API key input (password field)
- Save button → writes to `chrome.storage.local`
- Test buttons → quick API connectivity check

## Implementation Order

| Step | Module | What | Depends On |
|------|--------|------|------------|
| 1 | Scaffold | `wxt init`, install deps, configure `wxt.config.ts` | Nothing |
| 2 | `src/types.ts` | Shared types | Nothing |
| 3 | `src/lib/storage.ts` | `getConfig()`, `setConfig()` — chrome.storage wrapper | types |
| 4 | `src/lib/youtube.ts` | `getVideoMeta()`, `extractTranscript()` | types |
| 5 | `src/lib/gemini.ts` | `classifyVideo()`, `extractTickers()` | types |
| 6 | `entrypoints/content.ts` | Trigger flow (Stage 1) — detect, classify, set badge | storage, youtube, gemini |
| 7 | `entrypoints/background.ts` | Badge management, click routing | types |
| 8 | `src/lib/alphavantage.ts` | `getTickerData()` with rate limiting + caching | types |
| 9 | `src/lib/ui.ts` | Card rendering, styling, cleanup | types |
| 10 | `entrypoints/content.ts` | Full pipeline (Stage 2) — transcript scan, lookup, render | All above |
| 11 | `entrypoints/options.html` | API key configuration page | storage |
| 12 | Polish | Error states, loading states, cache, edge cases | All above |

## Testing Strategy

| Type | Scope | Tool | Key Tests |
|------|-------|------|-----------|
| Unit | Pure functions (`src/lib/`) | Vitest | `classifyVideo` prompt construction, `getTickerData` response parsing, % change calculation, transcript XML parsing |
| Integration | Alpha Vantage API | Vitest + fetch mock | Mocked API responses, rate limiting behavior, error handling |
| Integration | Gemini API | Vitest + fetch mock | Prompt templates, response parsing, JSON extraction from markdown fences |
| E2E | Full pipeline | Manual + browser dev tools | Real YouTube pages, real API calls, UI rendering verification |

**Unit tests to write (MVP):**
- Prompt template produces correct string
- % change calculation: positive, negative, zero
- Date matching: trading day before publish date
- Caption XML parsing
- Ticker deduplication
- Rate limiter queue behavior

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Video has no captions/transcript | Show "Transcript not available". Show Stage 1 tickers only. |
| Alpha Vantage returns a 429 (rate limit) | Exponential backoff, max 3 retries. Skip ticker with "Rate limited" message. |
| Gemini returns invalid JSON | Retry once. On second failure, show error message. |
| User navigates to a new video (SPA) | Clear previous card, re-run Stage 1. |
| User has no API keys configured | Show "Configure API keys in extension settings" card. |
| Ticker not found in Alpha Vantage | Show `XYZ — No data available`. Continue with other tickers. |
| Video publish date is a weekend | Use the previous Friday's close. |
| More than 5 tickers detected | Batch Alpha Vantage calls with 12s spacing. Show results as they arrive. |
| Extension icon clicked twice | If scan is in progress, ignore second click. Show loading state. |

## Security & Privacy

- **API keys**: Stored in `chrome.storage.local` (extension-sandboxed). Never logged or exposed to page scripts.
- **Content script isolation**: Runs in isolated world. Cannot be accessed by YouTube page scripts.
- **Data sent to Gemini**: Only video title, description, and transcript. No browsing history, no other tabs, no personal data.
- **No external tracking**: Zero analytics, zero telemetry, zero third-party scripts.
- **Permissions**: Minimum required set — only `storage`, `youtube.com` host permission, and `sidePanel` (if needed).

## Manifest (auto-generated by WXT)

```json
{
  "manifest_version": 3,
  "name": "YouTube Ticker Tracker",
  "version": "0.1.0",
  "description": "Detects stock tickers in YouTube finance videos and shows price changes.",
  "permissions": ["storage"],
  "host_permissions": ["https://www.youtube.com/*"],
  "content_scripts": [{
    "matches": ["https://www.youtube.com/watch*"],
    "js": ["content.js"]
  }],
  "background": {
    "service_worker": "background.js"
  },
  "options_page": "options.html",
  "action": {
    "default_icon": "icon.png",
    "default_title": "Ticker Tracker"
  }
}
```
