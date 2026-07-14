# Key Decisions

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | **Gemini end-to-end** (trigger + extraction) | Option A/F heuristic-only rejected as unreliable. Option C (smart trigger + heuristics) evolved into full Gemini pipeline after cost analysis showed negligible expense (~$0.01-0.02/month for 50 vids/day) | 2026-07-14 |
| 2 | **Alpha Vantage** for stock price data | Free tier (5 calls/min, 500/day) sufficient for personal use. No credit card required. | 2026-07-14 |
| 3 | **Trigger mechanism**: Auto-scan title/desc on page load → badge count → user click triggers full transcript scan | Best UX balance: zero-effort badge, user controls when to do the heavy scan | 2026-07-14 |
| 4 | **Transcript source**: YouTube page DOM scrape | No extra API key needed vs YouTube Data API. Sufficient for single-video access. | 2026-07-14 |
| 5 | **WXT + TypeScript** for extension build | Most modern extension framework. Manifest generation, HMR, multi-browser support built in. | 2026-07-14 |
| 6 | **UI placement**: Below YouTube video player | Least intrusive, follows YouTube's own patterns for extension content | 2026-07-14 |
| 7 | **Theme**: Match YouTube native dark theme | Clean, unobtrusive, feels like a native YouTube feature | 2026-07-14 |
