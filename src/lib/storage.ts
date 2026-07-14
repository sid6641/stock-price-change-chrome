import { logger } from './logger';
import type { ExtensionConfig } from '../types';

const CONFIG_KEY = 'ticker-tracker-config';

const M = 'Storage';

/**
 * Read extension config from chrome.storage.local.
 * Falls back to VITE_* env vars (from .env) if storage is empty,
 * so development works without configuring the options page.
 */
export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const stored = (result[CONFIG_KEY] ?? {}) as ExtensionConfig;

  const gemFromStorage = stored.geminiApiKey;
  const avFromStorage = stored.alphaVantageKey;
  const gemFromEnv = import.meta.env.VITE_GEMINI_API_KEY;
  const avFromEnv = import.meta.env.VITE_ALPHA_VANTAGE_KEY;

  const geminiKey = gemFromStorage || gemFromEnv || undefined;
  const alphaVantageKey = avFromStorage || avFromEnv || undefined;

  logger.log(M, 'Config resolved', {
    gemini: geminiKey ? `${geminiKey.slice(0, 8)}...` : '❌ MISSING',
    alphaVantage: alphaVantageKey ? `${alphaVantageKey.slice(0, 6)}...` : '❌ MISSING',
    source: gemFromStorage ? 'chrome.storage' : '.env',
  });

  return { geminiApiKey: geminiKey, alphaVantageKey };
}

/** Write extension config to chrome.storage.local */
export async function setConfig(config: ExtensionConfig): Promise<void> {
  logger.log(M, 'Saving config', {
    gemini: config.geminiApiKey ? 'set' : 'cleared',
    alphaVantage: config.alphaVantageKey ? 'set' : 'cleared',
  });
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

/** Check if required API keys are configured */
export async function isConfigured(): Promise<boolean> {
  const config = await getConfig();
  const ok = !!(config.geminiApiKey && config.alphaVantageKey);
  logger.log(M, 'isConfigured', ok ? '✅' : '❌ — missing keys');
  return ok;
}
