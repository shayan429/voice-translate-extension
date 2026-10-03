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

  if (message?.type === "listeningState") {
    setListeningIndicator(!!message.value);
    return false;
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

// Lets the landing page (see externally_connectable in manifest.json) detect
// whether this extension is installed, and ask it to open the side panel,
// without granting the page any extra permissions.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  if (message?.type === "openPanel" && sender.tab?.windowId != null) {
    chrome.sidePanel
      .open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // keep the message channel open for the async response
  }

  return false;
});

// Send first-time installs back to the landing page so the "Install" button
// there can flip to "Installed" without the user having to do anything.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "https://shayan429.github.io/voice-translate-extension/?installed=1" });
  }
});

/* ---------- Toolbar icon: visible "listening" indicator ---------- */

const DEFAULT_ICONS = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };

// Draws the normal icon with a red tint, so listening is visible at a glance
// without any change to the side panel itself.
async function tintedIconData() {
  const sources = { 16: "icons/icon16.png", 32: "icons/icon48.png", 48: "icons/icon48.png" };
  const imageData = {};
  for (const [size, file] of Object.entries(sources)) {
    const blob = await (await fetch(chrome.runtime.getURL(file))).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(Number(size), Number(size));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, Number(size), Number(size));
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(229, 72, 79, 0.6)";
    ctx.fillRect(0, 0, Number(size), Number(size));
    imageData[size] = ctx.getImageData(0, 0, Number(size), Number(size));
  }
  return imageData;
}

let listeningNow = false;

async function setListeningIndicator(on) {
  listeningNow = on;
  try {
    if (on) {
      await chrome.action.setIcon({ imageData: await tintedIconData() });
      await chrome.action.setBadgeBackgroundColor({ color: "#e5484f" });
      await chrome.action.setBadgeText({ text: "●" });
      await chrome.action.setTitle({ title: "Listening… (click to open Voice Translator)" });
    } else {
      await chrome.action.setIcon({ path: DEFAULT_ICONS });
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "Open Voice Translator" });
    }
  } catch (err) {
    console.error("Couldn't update the toolbar icon:", err);
  }
}

// Brief confirmation on the toolbar badge for shortcuts that act without
// the panel (undo / repeat), then back to whatever state it was in.
async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: listeningNow ? "●" : "" }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: "#e5484f" }).catch(() => {});
    }, 1500);
  } catch (err) {
    /* badge is cosmetic */
  }
}

/* ---------- Keyboard shortcuts ---------- */

// Sends a message to the frame that last held the cursor in the active tab,
// falling back to the page's top frame — the same routing the side panel uses.
async function sendToActiveFrame(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, reason: "no-tab" };
  let frameId = 0;
  try {
    const key = `frame_${tab.id}`;
    const data = await chrome.storage.session.get(key);
    frameId = data[key] ?? 0;
  } catch (err) {
    /* fall back to the top frame */
  }
  try {
    return (await chrome.tabs.sendMessage(tab.id, message, { frameId })) || { ok: false, reason: "no-response" };
  } catch (err) {
    if (frameId === 0) return { ok: false, reason: "no-content-script" };
    try {
      return (await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 })) || { ok: false, reason: "no-response" };
    } catch (err2) {
      return { ok: false, reason: "no-content-script" };
    }
  }
}

// Commands that need the side panel (microphone, translation) are handed to
// it; if it isn't open yet it's opened and the command is picked up on load.
async function sendPanelCommand(name, windowId) {
  await chrome.storage.session.set({ pendingCommand: { name, ts: Date.now() } });
  try {
    await chrome.runtime.sendMessage({ type: "panelCommand", name });
    await chrome.storage.session.remove("pendingCommand");
  } catch (err) {
    // Nobody is listening, so the panel is closed — open it.
    try {
      const winId = windowId ?? (await chrome.windows.getCurrent()).id;
      await chrome.sidePanel.open({ windowId: winId });
    } catch (openErr) {
      await flashBadge("!", "#e5484f");
    }
  }
}

async function handleCommand(command, tab) {
  if (command === "undo-last") {
    const result = await sendToActiveFrame({ type: "undoLast" });
    await flashBadge(result.ok ? "↶" : "–", result.ok ? "#10b981" : "#9a9db3");
    return;
  }
  if (command === "repeat-last") {
    const data = await chrome.storage.session.get("lastTranslation");
    const last = data.lastTranslation;
    if (!last?.text) {
      await flashBadge("–", "#9a9db3");
      return;
    }
    const result = await sendToActiveFrame({ type: "insertText", text: last.text });
    await flashBadge(result.ok ? "✓" : "!", result.ok ? "#10b981" : "#e5484f");
    return;
  }
  if (command === "toggle-listening" || command === "toggle-listening-submit" || command === "cancel-processing") {
    await sendPanelCommand(command, tab?.windowId);
  }
}

chrome.commands.onCommand.addListener(handleCommand);
