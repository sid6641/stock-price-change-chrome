import type { ExtensionConfig } from '../types';

const CONFIG_KEY = 'ticker-tracker-config';

/** Read extension config from chrome.storage.local */
export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return (result[CONFIG_KEY] ?? {}) as ExtensionConfig;
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
