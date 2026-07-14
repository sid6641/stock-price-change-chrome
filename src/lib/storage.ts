import type { ExtensionConfig } from '../types';

const CONFIG_KEY = 'ticker-tracker-config';

/**
 * Read extension config from chrome.storage.local.
 * Falls back to VITE_* env vars (from .env) if storage is empty,
 * so development works without configuring the options page.
 */
export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const stored = (result[CONFIG_KEY] ?? {}) as ExtensionConfig;

  // Fall back to env vars for any missing keys
  return {
    geminiApiKey: stored.geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY || undefined,
    alphaVantageKey: stored.alphaVantageKey || import.meta.env.VITE_ALPHA_VANTAGE_KEY || undefined,
  };
}

/** Write extension config to chrome.storage.local */
export async function setConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

/** Check if required API keys are configured */
export async function isConfigured(): Promise<boolean> {
  const config = await getConfig();
  return !!(config.geminiApiKey && config.alphaVantageKey);
}
