# PRD: YouTube Ticker Tracker

## Overview

A Chrome extension that automatically detects stock tickers mentioned in YouTube finance videos and displays their price change percentage since the video was published — all without leaving the YouTube page. Uses Gemini AI for content classification and ticker extraction, and Alpha Vantage for stock price data.

## Problem Statement

Finance YouTube watchers hear stock tickers mentioned in videos but have no convenient way to see how those stocks have performed since the video was published. Manually looking up tickers is friction that breaks the viewing flow. This extension solves that by automatically detecting tickers mentioned in finance videos and showing their price change % right below the YouTube player.

## Goals & Non-Goals

**Goals:**
- Automatically detect when a YouTube video is finance-related and surface stock tickers
- Show stock price change % since the video's publish date for each detected ticker
- Deliver the entire experience within YouTube's UI — no tab switching
- Work with zero configuration after installation and API key setup
- Cost under $0.50/month in API usage for personal use

**Non-Goals:**
- Portfolio tracking or watchlists
- Real-time price alerts or push notifications
- Trading / brokerage integration
- Historical price charts or advanced analytics
- Multi-browser support (Chrome-only for MVP)
- Multi-language support (English finance content only)
- Chrome Web Store distribution (manual install via developer mode)

## User Personas

| Persona | Description | Needs |
|---------|-------------|-------|
| Finance YouTube watcher | Watches daily finance/stock analysis videos on YouTube | See stock performance without leaving the video. Quickly know which tickers moved significantly. |
| Retail investor | Uses YouTube for stock research and analysis | Get a snapshot of ticker performance since the video's thesis was presented. Validate or question the video's claims immediately. |
| Casual viewer | Occasionally watches finance content | Extension stays out of the way — no badge, no UI unless relevant. When it activates, the info is useful and unobtrusive. |

## User Stories

1. As a finance YouTube watcher, I want the extension to **automatically detect tickers** so I don't have to take notes while watching.
2. As a finance YouTube watcher, I want to see **price change % since the video was published** so I know how the stock performed after the analysis.
3. As a finance YouTube watcher, I want the results **displayed below the video player** so I can see them in my natural viewing flow.
4. As a retail investor, I want **green/red indicators** so I can quickly scan which tickers went up or down.
5. As a casual viewer, I want the extension to **stay hidden on non-finance videos** so I'm not distracted by irrelevant badges.
6. As any user, I want to **configure my Gemini and Alpha Vantage API keys** so the extension works with my own accounts.
7. As any user, I want the extension to **show "data unavailable" gracefully** when a ticker isn't found in Alpha Vantage, rather than breaking or showing errors.
8. As any user, I want the **extension badge to show a count** of detected tickers so I know something is available before clicking.
9. As a privacy-conscious user, I want the extension to **only send YouTube video content** (title, description, transcript) to Gemini — nothing else.

## Flows

### Flow 1: Full Detection & Display (Happy Path)

1. User navigates to `youtube.com/watch?v=XXXXX` — a finance analysis video
2. Content script detects the YouTube watch page and extracts video title + description
3. Content script sends title + description to Gemini with prompt: *"Is this finance content? Extract any stock ticker symbols mentioned."*
4. Gemini responds with classification + initial tickers (from title/desc)
5. **If non-finance**: clean exit — no badge, no further action
6. **If finance + tickers found**: extension badge updates to show ticker count (e.g., `3`)
7. User sees badge and clicks the extension icon
8. Content script extracts the video transcript from the YouTube page DOM
9. Content script sends full transcript to Gemini with prompt: *"Extract all unique stock ticker symbols from this transcript"*
10. Gemini returns a deduplicated list of ticker symbols
11. For each ticker, content script calls Alpha Vantage `TIME_SERIES_DAILY` (adjusted close)
12. Calculate % change: `(latest_close - publish_date_close) / publish_date_close * 100`
13. Render a card below the video player showing:
    - Ticker symbol (e.g., `NVDA`)
    - Company name (e.g., "NVIDIA Corporation")
    - % change (green `+5.2%` or red `-2.1%`)
    - Date range (e.g., "Since Jul 10, 2026")
14. User sees the results and can reference them while watching

### Flow 2: No Finance Content

1. User navigates to a cooking tutorial or music video
2. Content script sends title + description to Gemini
3. Gemini responds: non-finance
4. No badge shown. No further action. Extension is invisible.

### Flow 3: Ticker Not Found in Alpha Vantage

1. Gemini extracts ticker `XYZ` from a transcript
2. Alpha Vantage returns no data (unknown symbol, penny stock, delisted)
3. Card shows: `XYZ — No price data available`
4. Other tickers render normally — partial success is fine

### Flow 4: Transcript Unavailable

1. User clicks badge to trigger full scan
2. Content script attempts to extract transcript from DOM
3. Transcript element not found (video has no captions, or DOM structure changed)
4. Show inline message in card area: *"Transcript not available for this video"*
5. Still display any tickers found in title/description from Stage 1

## Acceptance Criteria

### Feature: Finance Content Detection
- [ ] Given a YouTube video with finance-related title/description, when the page loads, the content script sends title+desc to Gemini
- [ ] Given a non-finance video, when the page loads, Gemini returns non-finance and no badge is shown
- [ ] Given a finance video with tickers in title/desc, when Gemini responds, the badge displays the correct count

### Feature: Ticker Extraction (Transcript Scan)
- [ ] Given a finance video with a transcript, when the user clicks the extension badge, the transcript is extracted and sent to Gemini
- [ ] Given Gemini returns a list of tickers, each ticker is displayed in the results card
- [ ] Given Gemini returns duplicate tickers, duplicates are removed before display
- [ ] Given a video with no transcript, a "transcript unavailable" message is shown

### Feature: Stock Price Display
- [ ] Given a ticker symbol and the video's publish date, Alpha Vantage is called to get historical prices
- [ ] Given Alpha Vantage returns data, the % change from publish date close to latest close is calculated correctly
- [ ] Given a positive change, the value is displayed in green with a `+` prefix
- [ ] Given a negative change, the value is displayed in red with a `-` prefix
- [ ] Given Alpha Vantage has no data for a ticker, "No price data available" is shown

### Feature: Badge & Click Flow
- [ ] Given tickers are detected, the extension badge shows the count
- [ ] Given no tickers are detected, no badge is shown
- [ ] Given the badge is visible, clicking the extension icon triggers the transcript scan

### Feature: UI Card
- [ ] Given ticker data is ready, a card is rendered below the YouTube video player
- [ ] Given ticker data, each ticker shows: symbol, company name, % change, date range
- [ ] Given ticker data, green/red coloring uses text labels too (not color-only)
- [ ] Given the card is rendered, it can be dismissed by the user
- [ ] Given the user navigates away, the card is cleaned up

### Feature: API Key Configuration
- [ ] Given the extension is installed, an options page allows entering Gemini and Alpha Vantage API keys
- [ ] Given invalid API keys, the extension shows a clear error message
- [ ] Given API keys are configured, they persist across browser restarts

## Open Questions

- Should the card show individual ticker cards or a compact table? (Start with compact list, expand if needed.)
- Should ticker symbols be clickable (linking to Google Finance or similar)? (Nice-to-have, defer.)
- What Gemini system prompt minimizes false positives on ambiguous words like "IT" or "AI"? (Tune during implementation.)
- Should we cache Alpha Vantage responses across sessions (e.g., daily values cached for 24h)? (Yes, implement in Phase 2.)
- Extension icon design — default or custom? (Start with a simple custom icon.)
