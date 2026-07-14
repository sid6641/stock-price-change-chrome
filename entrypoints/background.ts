import type { ExtensionMessage } from '../src/types';

export default defineBackground(() => {
  // ─── Badge Management ──────────────────────────────────────

  chrome.runtime.onMessage.addListener(
    (msg: ExtensionMessage, sender) => {
      if (msg.type === 'SET_BADGE') {
        const tabId = sender.tab?.id;
        if (!tabId) return;

        const text = msg.count > 0 ? String(msg.count) : '';
        chrome.action.setBadgeText({ text, tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#4caf50', tabId });
      }
    },
  );

  // ─── Click Handler ─────────────────────────────────────────

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id && tab.url?.includes('youtube.com/watch')) {
      chrome.tabs.sendMessage(tab.id, { type: 'SCAN' } satisfies ExtensionMessage);
    }
  });
});

