# Requirements Brief: YouTube Ticker Tracker

## Problem Statement

Finance YouTube watchers hear stock tickers mentioned in videos but have no convenient way to see how those stocks have performed since the video was published. Manually looking up tickers is friction that breaks the viewing flow. This extension solves that by automatically detecting tickers mentioned in finance videos and showing their price change % right below the YouTube player.

## Success Criteria

- Finance video detected → tickers extracted → price changes displayed **without the user leaving YouTube**
- Tickers appear as a clean inline card below the video player, showing symbol + % change since publish date
- Non-finance videos are ignored (zero false positives, no badge clutter)
- Full round-trip from page load to results in under 5 seconds
- Works with zero configuration — install and go

## Scope

**In (MVP):**
- YouTube page detection (content script activates on `youtube.com/watch*`)
- Smart trigger: Gemini classifies video as finance/non-finance via title + description
- Badge counter: extension badge shows number of detected tickers
- Click-to-scan: user clicks extension icon → Gemini extracts tickers from full transcript
- Stock price lookup: Alpha Vantage `TIME_SERIES_DAILY` for historical data
- Price change display: card below video player showing symbol → price change since publish date
- Gemini API integration — single model handles both trigger and extraction
- Alpha Vantage integration — free tier (5 calls/min, 500/day)
- YouTube transcript extraction via page DOM (no extra API key)
- Configurable API keys via extension options page

**Out (explicitly deferred):**
- Portfolio tracking or watchlists
- Real-time price alerts or push notifications
- Trading / brokerage integration
- Historical price charts or advanced analytics
- Multi-browser support (Chrome-only for MVP)
- Multi-language support (English finance content only)
- Caching layer beyond basic in-memory

**MVP Definition:**
Content script + Gemini trigger → badge counter → user clicks → transcript scan → Alpha Vantage lookup → price card below player. That's the complete slice.

## Timeline & Constraints

- **Team**: Solo project, personal use
- **Timeline**: No hard deadline — build iteratively
- **API Constraints**: Alpha Vantage free tier = 5 requests/min, 500/day. Gemini free tier generous enough for 50 videos/day (~$0.01-0.02/month)
- **Distribution**: Manual install via developer mode (not Chrome Web Store for MVP)
- **Budget**: $0 — all services have free tiers sufficient for personal use

## Users

| Persona | Goal | Key Flow |
|---------|------|----------|
| Finance YouTube watcher | Wants to see stock performance without leaving the video | Open video → see ticker badge → click → view price changes below player |
| Retail investor | Researches stocks via YouTube analysis videos | Watch video → see tickers → decide which to research further |
| Casual viewer | Watches occasional finance content | Extension handles itself — no interaction needed if not interested |

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Extension framework | WXT | Modern build tool, manifest generation, HMR, multi-browser builds |
| Language | TypeScript | Type safety, better DX for async API orchestration |
| Trigger AI | Gemini 2.5-flash via API | Single model for trigger + extraction, ~$0.0001/call |
| Ticker extraction | Gemini 2.5-flash (same call chain) | Full transcript analysis for max accuracy |
| Stock data | Alpha Vantage REST API | Free tier, `TIME_SERIES_DAILY` endpoint, no credit card |
| Transcript source | YouTube page DOM scrape | No extra API key needed — parse from page elements |
| Storage | `chrome.storage.local` | Extension-native persistence for settings + cache |
| UI | Vanilla DOM manipulation | Lightweight, no framework overhead for a single card |

### Architecture Flow

```
YouTube page loads (youtube.com/watch*)
  │
  ▼
Content script fires
  │
  ▼
Stage 1 (auto): Send title + description to Gemini
  ├─ "Is this finance content? What tickers in title/desc?"
  │
  ├─ Non-finance → do nothing, clean exit
  └─ Tickers found → set badge count → listen for click
       │
       ▼
Stage 2 (on click): Extract transcript from YouTube DOM
       │
       ▼
       Send full transcript to Gemini
       ├─ "Extract all stock ticker symbols from this transcript"
       │
       ▼
       Deduplicate tickers
       │
       ▼
       For each ticker: call Alpha Vantage TIME_SERIES_DAILY
       │  Calculate % change: publish date → latest close
       │
       ▼
       Render card below video player
       ├─ Ticker symbol + name
       ├─ % change (green/red)
       ├─ Date range: (since video publish)
       └─ Simple inline layout, no charts
```

## Non-Functionals

- **Performance**: Card must render within 2s of user clicking badge. Page load must not be noticeably slower (trigger check is async, non-blocking).
- **Reliability**: Gracefully handle missing transcripts, failed API calls, or tickers not found in Alpha Vantage. Show "no data" rather than breaking the UI.
- **API Efficiency**: Cache ticker results within a single page session. Don't re-scan same transcript on repeat clicks.
- **Security**: API keys stored in `chrome.storage.local` (extension sandboxed storage). No external network calls not initiated by user action (beyond page load classification).
- **Privacy**: Only send page content (title, description, transcript) to Gemini. No browsing history, no other tabs, no personal data.
- **Accessibility**: Card must be keyboard-navigable and use proper ARIA labels. Color alone mustn't convey information (add text indicators like "up" / "down").

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| YouTube DOM changes break transcript extraction | Medium | High | Isolate extraction to a single module with clear parsing logic. Fail gracefully with "transcript unavailable" message. Monitor and fix as needed. |
| Gemini API incorrectly classifies non-finance video as finance | Low | Low | False positives on badge are low-impact (user ignores it). Title+desc check is conservative — only trigger on clear finance signals. |
| Ticker detection ambiguity ("IT", "AI", "GO" as stock symbols) | Medium | Medium | Gemini prompt must specify context-aware detection. Cross-reference tickers against Alpha Vantage response. If no data, assume false positive. |
| Alpha Vantage rate limits (5/min, 500/day) | High | Medium | Cache aggressively within session. Batch lookups if possible. Add exponential backoff on 429s. For personal 50 vid/day usage, limits are comfortable. |
| Alpha Vantage API reliability (known to be flaky) | Medium | Medium | Implement retry with backoff. Show "price data unavailable" rather than failing entirely. Consider adding alternative data source as future enhancement. |
| YouTube TOS — scraping transcript from DOM | Low | Low | We're reading visible page content (what user sees), not bypassing any auth or paywall. Same as using browser's reader mode. |

## Open Questions

- Should the card show individual ticker cards or a compact table? (Design decision for implementation phase — can start compact and expand)
- How to handle penny stocks / OTC tickers that Alpha Vantage may not cover?
- Should ticker symbols auto-link to a search or chart page? (User can click through to Google Finance?)
- Extension icon design — what should the badge look like? (Default `📈` or custom?)
- Gemini system prompt — what specific instructions to minimize false positives on ambiguous words?
- Should we cache Alpha Vantage responses across sessions (e.g., daily values cached for 24h via `chrome.storage.local`)?

---

*Brief prepared by the Director. Captain approved architecture: Gemini end-to-end for trigger + extraction, Alpha Vantage for stock data. Ready for spec phase.*
