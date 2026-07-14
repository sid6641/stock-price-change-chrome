import { defineConfig } from 'wxt';
import { resolve } from 'path';

export default defineConfig({
  extensionApi: 'chrome',
  modules: [],
  outDir: 'output',
  vite: () => ({
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
  }),
  manifest: {
    name: 'YouTube Ticker Tracker',
    version: '0.1.0',
    description: 'Detects stock tickers in YouTube finance videos and shows price changes since publish date.',
    permissions: ['storage', 'scripting', 'tabs'],
    host_permissions: ['https://www.youtube.com/*', 'https://youtubetranscript.com/*'],
    action: {
      default_title: 'Ticker Tracker',
    },
  },
});
