import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'chrome',
  modules: [],
  manifest: {
    name: 'YouTube Ticker Tracker',
    version: '0.1.0',
    description: 'Detects stock tickers in YouTube finance videos and shows price changes since publish date.',
    permissions: ['storage'],
    host_permissions: ['https://www.youtube.com/*'],
    action: {
      default_title: 'Ticker Tracker',
    },
  },
});
