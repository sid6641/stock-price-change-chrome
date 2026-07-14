import { logger } from '../src/lib/logger';
import type { ExtensionMessage } from '../src/types';

const M = 'Background';

export default defineBackground(() => {
  logger.log(M, 'Service worker started');

  // ─── Badge Management ──────────────────────────────────────

  chrome.runtime.onMessage.addListener(
    (msg: ExtensionMessage, sender) => {
      if (msg.type === 'SET_BADGE') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          logger.warn(M, 'SET_BADGE: no tab ID');
          return;
        }

        const text = msg.count > 0 ? String(msg.count) : '';
        logger.log(M, `Setting badge to "${text}" on tab ${tabId}`);
        chrome.action.setBadgeText({ text, tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#4caf50', tabId });
      }
    },
  );

  // ─── Click Handler ─────────────────────────────────────────

  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !tab.url?.includes('youtube.com/watch')) {
      logger.log(M, 'Click ignored — not a YouTube watch page');
      return;
    }

    logger.log(M, `Icon clicked on tab ${tab.id} — sending SCAN message`);

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SCAN' } satisfies ExtensionMessage);
    } catch {
      logger.warn(M, 'Content script not ready on tab — will retry on next click');
    }
  });
});

