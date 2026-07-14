/**
 * SideChat background service worker.
 *
 * Manifest-declared content scripts are only injected when a page performs a
 * real navigation load. On browser startup, Chrome restores tabs WITHOUT
 * re-injecting declarative content scripts, so an already-open claude.ai /
 * chatgpt.com tab has no SideChat UI until the user manually refreshes.
 *
 * Here we re-inject into already-loaded matching tabs on startup and on
 * install/update, so the UI appears without a manual refresh. content.js
 * guards against running twice, so double-injection is harmless.
 */

const HOSTS = ['https://claude.ai/*', 'https://chatgpt.com/*'];

async function injectExistingTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: HOSTS });
  } catch (e) {
    return;
  }

  for (const tab of tabs) {
    // Skip tabs still discarded/unloaded — they inject declaratively on their
    // own real load once the user activates them.
    if (!tab.id || tab.discarded || tab.status === 'unloaded') continue;

    chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles.css']
    }).catch(() => {});

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).catch(() => {});
  }
}

chrome.runtime.onStartup.addListener(injectExistingTabs);
chrome.runtime.onInstalled.addListener(injectExistingTabs);
