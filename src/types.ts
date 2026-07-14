/** Video metadata extracted from YouTube page */
export interface VideoMeta {
  id: string;
  title: string;
  description: string;
  publishDate: string; // ISO date string, e.g. "2026-07-10"
}

/** Stage 1 result: trigger classification */
export interface TriggerResult {
  isFinance: boolean;
  tickers: string[]; // Tickers found in title/description
  reasoning?: string;
}

/** Single ticker result with price data */
export interface TickerResult {
  symbol: string;
  companyName: string;
  changePercent: number | null; // null when data unavailable
  publishPrice: number | null;
  latestPrice: number | null;
  publishDate: string;
  error?: string; // e.g. "No price data available"
}

/** Full pipeline result per video */
export interface ScanResult {
  videoId: string;
  tickers: TickerResult[];
  scannedAt: number;
  captionsAvailable: boolean;
}

/** Extension configuration stored in chrome.storage.local */
export interface ExtensionConfig {
  geminiApiKey?: string;
  alphaVantageKey?: string;
}

/** Message types for content <-> background communication */
export type ExtensionMessage =
  | { type: 'SET_BADGE'; count: number }
  | { type: 'SCAN' }
  | { type: 'SCAN_RESULT'; result: ScanResult }
  | { type: 'SCAN_ERROR'; error: string };
