// 🔥 DIAGNOSTIC BACKGROUND — full instrumentation
const M = '🔥 BG';

export default defineBackground(() => {
  console.log(M, 'ALIVE — Service worker started');
  console.log(M, 'Runtime ID:', chrome.runtime.id);
  console.log(M, 'Manifest:',
    JSON.stringify({
      version: chrome.runtime.getManifest().version,
      permissions: chrome.runtime.getManifest().permissions,
      host_permissions: chrome.runtime.getManifest().host_permissions,
      content_scripts: chrome.runtime.getManifest().content_scripts,
    })
  );

  // Log all installed content scripts
  chrome.scripting.getRegisteredContentScripts().then(scripts => {
    console.log(M, 'Registered content scripts:', JSON.stringify(scripts));
  }).catch(err => {
    console.log(M, 'getRegisteredContentScripts error:', err.message);
  });

  // Listen for tab updates to detect YouTube navigation
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url?.includes('youtube.com/watch')) {
      console.log(M, `Tab ${tabId} loading YouTube:`, tab.url);
    }
    if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com/watch')) {
      console.log(M, `Tab ${tabId} COMPLETE YouTube:`, tab.url);
      // Try programmatic injection as fallback
      injectContentScript(tabId);
    }
  });

  // Click handler — try programmatic injection
  chrome.action.onClicked.addListener(async (tab) => {
    console.log(M, 'Icon clicked on tab', tab.id, tab.url);
    if (!tab.id || !tab.url?.includes('youtube.com/watch')) {
      console.log(M, 'Not a YouTube watch page — ignoring');
      return;
    }
    await injectContentScript(tab.id);
  });
});

async function injectContentScript(tabId: number) {
  console.log(M, `Attempting programmatic injection into tab ${tabId}`);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
    console.log(M, `Injection result:`, JSON.stringify(results));
  } catch (err) {
    console.error(M, `Injection FAILED:`, err.message);
    console.error(M, `Full error:`, JSON.stringify(err));
  }
}


