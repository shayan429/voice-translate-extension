chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

  // Whenever the extension is installed or reloaded/updated, the content
  // script normally only reaches tabs opened *after* that point — any tab
  // that was already open keeps running with no script (or an old one)
  // until it's manually refreshed. To avoid needing that manual refresh,
  // push the current content.js into every already-open http(s) tab right
  // now.
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/i.test(tab.url || "")) continue; // skip chrome://, the Web Store, etc. — injection isn't allowed there anyway
      chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] })
        .catch(() => {
          // A handful of pages (Chrome Web Store, some sites with strict
          // policies) refuse injection outright — nothing to do but skip.
        });
    }
  } catch (err) {
    console.error("Couldn't re-inject content script into open tabs:", err);
  }
});

// Every frame's content script reports when an editable element inside it
// gains focus. We remember the most recent (tabId -> frameId) so the side
// panel can target the exact frame that actually holds the cursor, not just
// the page's top-level document.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "editableFocused" && sender.tab?.id != null) {
    chrome.storage.session.set({ [`frame_${sender.tab.id}`]: sender.frameId ?? 0 });
    return false;
  }

  if (message?.type === "getInsertFrame" && message.tabId != null) {
    const key = `frame_${message.tabId}`;
    chrome.storage.session.get(key).then((data) => {
      sendResponse({ frameId: data[key] ?? 0 });
    });
    return true; // keep the message channel open for the async response
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`frame_${tabId}`);
});

// A full page navigation invalidates every frame on the old page, so the
// last-focused frameId we stored for this tab no longer means anything —
// drop it so the panel falls back to the page's top frame until a new
// field is focused.
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (details.frameId === 0) {
    chrome.storage.session.remove(`frame_${details.tabId}`);
  }
});
