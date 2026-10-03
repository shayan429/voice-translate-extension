const LANGUAGES = [
  { name: "Arabic", code: "ar", speech: "ar-SA" },
  { name: "Bengali", code: "bn", speech: "bn-BD" },
  { name: "Chinese (Simplified)", code: "zh-CN", speech: "zh-CN" },
  { name: "Chinese (Traditional)", code: "zh-TW", speech: "zh-TW" },
  { name: "Czech", code: "cs", speech: "cs-CZ" },
  { name: "Danish", code: "da", speech: "da-DK" },
  { name: "Dutch", code: "nl", speech: "nl-NL" },
  { name: "English", code: "en", speech: "en-US" },
  { name: "Farsi / Persian", code: "fa", speech: "fa-IR" },
  { name: "Filipino", code: "tl", speech: "fil-PH" },
  { name: "Finnish", code: "fi", speech: "fi-FI" },
  { name: "French", code: "fr", speech: "fr-FR" },
  { name: "German", code: "de", speech: "de-DE" },
  { name: "Greek", code: "el", speech: "el-GR" },
  { name: "Gujarati", code: "gu", speech: "gu-IN" },
  { name: "Hebrew", code: "he", speech: "he-IL" },
  { name: "Hindi", code: "hi", speech: "hi-IN" },
  { name: "Hungarian", code: "hu", speech: "hu-HU" },
  { name: "Indonesian", code: "id", speech: "id-ID" },
  { name: "Italian", code: "it", speech: "it-IT" },
  { name: "Japanese", code: "ja", speech: "ja-JP" },
  { name: "Korean", code: "ko", speech: "ko-KR" },
  { name: "Malay", code: "ms", speech: "ms-MY" },
  { name: "Norwegian", code: "no", speech: "nb-NO" },
  { name: "Pashto", code: "ps", speech: "ps-AF" },
  { name: "Polish", code: "pl", speech: "pl-PL" },
  { name: "Portuguese", code: "pt", speech: "pt-PT" },
  { name: "Punjabi", code: "pa", speech: "pa-IN" },
  { name: "Romanian", code: "ro", speech: "ro-RO" },
  { name: "Russian", code: "ru", speech: "ru-RU" },
  { name: "Spanish", code: "es", speech: "es-ES" },
  { name: "Swahili", code: "sw", speech: "sw-KE" },
  { name: "Swedish", code: "sv", speech: "sv-SE" },
  { name: "Tamil", code: "ta", speech: "ta-IN" },
  { name: "Thai", code: "th", speech: "th-TH" },
  { name: "Turkish", code: "tr", speech: "tr-TR" },
  { name: "Ukrainian", code: "uk", speech: "uk-UA" },
  { name: "Urdu", code: "ur", speech: "ur-PK" },
  { name: "Vietnamese", code: "vi", speech: "vi-VN" },
];

const ERROR_MESSAGES = {
  "not-allowed": "Microphone blocked. Click the lock icon in the address bar, allow the mic, then tap the mic button again.",
  "service-not-allowed": "Speech service unavailable — check your internet connection.",
  "audio-capture": "No microphone found. Check it's connected and try again.",
  network: "Network error — check your internet connection.",
};

// Sites known to use custom, non-standard editing surfaces where direct
// DOM typing frequently doesn't work. We can't guarantee success here —
// only the site's real API can — so we warn instead of overpromising.
const CUSTOM_EDITOR_HOSTS = ["docs.google.com", "sheets.google.com", "slides.google.com"];

// Every new behavior is off (or neutral) by default, so with untouched
// settings the panel behaves exactly as it did before these options existed.
const DEFAULT_PREFS = {
  continuous: true,
  insertAtCursor: false,
  autoSubmit: false,
  lockField: false,
  pauseOnTabSwitch: false,
  pushToTalk: false,
  pttKey: "F9",
  silenceMs: 0,
  minConfidence: 0,
  autoPunct: false,
  voiceCommands: false,
  glossary: "",
  soundsOn: false,
  soundVolume: 0.5,
  playbackRate: 1,
  clearAfterInsert: false,
  savedPairs: [],
};
const MAX_SAVED_PAIRS = 10;

const sourceLangSelect = document.getElementById("sourceLang");
const targetLangSelect = document.getElementById("targetLang");
const swapBtn = document.getElementById("swapBtn");
const micBtn = document.getElementById("micBtn");
const pttBtn = document.getElementById("pttBtn");
const cancelBtn = document.getElementById("cancelBtn");
const statusEl = document.getElementById("status");
const pageHintEl = document.getElementById("pageHint");
const autoTypeToggle = document.getElementById("autoTypeToggle");
const conversationModeToggle = document.getElementById("conversationModeToggle");
const originalTextEl = document.getElementById("originalText");
const translatedTextEl = document.getElementById("translatedText"); // hidden on purpose — see sidepanel.html
const speakBtn = document.getElementById("speakBtn");
const copyBtn = document.getElementById("copyBtn");
const insertBtn = document.getElementById("insertBtn");
const clearBtn = document.getElementById("clearBtn");
const permissionHintEl = document.getElementById("permissionHint");
const permissionHintTextEl = document.getElementById("permissionHintText");
const grantPermissionBtn = document.getElementById("grantPermissionBtn");
const openMicSettingsBtn = document.getElementById("openMicSettingsBtn");
const errorActionEl = document.getElementById("errorAction");
const errorActionTextEl = document.getElementById("errorActionText");
const errorActionBtn = document.getElementById("errorActionBtn");
const pairSelect = document.getElementById("pairSelect");
const savePairBtn = document.getElementById("savePairBtn");
const deletePairBtn = document.getElementById("deletePairBtn");
const downloadTranscriptBtn = document.getElementById("downloadTranscriptBtn");
const shortcutsBtn = document.getElementById("shortcutsBtn");
const statsLineEl = document.getElementById("statsLine");
const resetStatsBtn = document.getElementById("resetStatsBtn");

let prefs = { ...DEFAULT_PREFS };
let glossaryEntries = [];

const sounds = SoundsLib.createSounds(() => prefs);
const stats = StatsLib.createStats(chrome.storage.local);

function populateLanguages() {
  for (const lang of LANGUAGES) {
    const opt1 = document.createElement("option");
    opt1.value = lang.code;
    opt1.dataset.speech = lang.speech;
    opt1.textContent = lang.name;
    sourceLangSelect.appendChild(opt1);
    targetLangSelect.appendChild(opt1.cloneNode(true));
  }
}

function setSelectValue(select, code) {
  if (Array.from(select.options).some((o) => o.value === code)) {
    select.value = code;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function langName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name || code;
}

function speechCodeFor(code) {
  return LANGUAGES.find((l) => l.code === code)?.speech || code;
}

/* ---------- Settings / preferences ---------- */

async function loadSettings() {
  const data = await chrome.storage.local.get(["sourceLang", "targetLang", "autoType", "conversationMode", "prefs"]);
  setSelectValue(sourceLangSelect, data.sourceLang || "ur");
  setSelectValue(targetLangSelect, data.targetLang || "en");
  autoTypeToggle.checked = data.autoType !== false;
  conversationModeToggle.checked = data.conversationMode === true;
  prefs = { ...DEFAULT_PREFS, ...(data.prefs || {}) };
  if (!Array.isArray(prefs.savedPairs)) prefs.savedPairs = [];
  glossaryEntries = TextUtils.parseGlossary(prefs.glossary);
  applyPrefsToControls();
  syncPttUi();
  updateIdleHint();
  renderPairs();
  refreshStats();
}

function saveSettings() {
  chrome.storage.local.set({
    sourceLang: sourceLangSelect.value,
    targetLang: targetLangSelect.value,
    autoType: autoTypeToggle.checked,
    conversationMode: conversationModeToggle.checked,
  });
}

function savePrefs() {
  chrome.storage.local.set({ prefs });
}

function prefControls() {
  return Array.from(document.querySelectorAll("[data-pref]"));
}

function applyPrefsToControls() {
  for (const el of prefControls()) {
    const value = prefs[el.dataset.pref];
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  }
}

// Keys offered for push-to-talk. Only keys that don't type text and don't
// double as common shortcuts are listed, since the key is captured while held.
const PTT_KEY_LABELS = {
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F6: "F6", F8: "F8", F9: "F9", F10: "F10",
  Pause: "Pause", ScrollLock: "Scroll Lock", Insert: "Insert", PrintScreen: "Print Screen", ContextMenu: "Menu key",
  ControlRight: "Right Ctrl", ShiftRight: "Right Shift", AltRight: "Right Alt",
};
const PTT_MODIFIER_DELAY_MS = 200;
let pttModifierTimer = null;

// Modifier keys are also part of shortcuts (Ctrl+C...), so they only start
// push-to-talk if held alone for a moment; another key pressed with them cancels it.
function isModifierPttKey() {
  return /^(Control|Shift|Alt)(Left|Right)$/.test(prefs.pttKey);
}

function pttKeyLabel() {
  return PTT_KEY_LABELS[prefs.pttKey] || prefs.pttKey;
}

function isPttKey(e) {
  return e.code === prefs.pttKey || e.key === prefs.pttKey;
}

// Shows the dedicated "Hold to talk" button only while push-to-talk is on.
function syncPttUi() {
  pttBtn.hidden = !prefs.pushToTalk;
  pttBtn.textContent = `🎙 Hold to talk (${pttKeyLabel()})`;
}

// Tells the person how to talk when push-to-talk changes what the mic button does.
function updateIdleHint() {
  if (isListening || isBusy()) return;
  setStatus(prefs.pushToTalk ? `Hold the mic button or ${pttKeyLabel()} and speak.` : "Tap the mic and start speaking.");
}

function onPrefControlChange(el) {
  const key = el.dataset.pref;
  if (el.type === "checkbox") prefs[key] = el.checked;
  else if (el.dataset.type === "number") prefs[key] = Number(el.value);
  else prefs[key] = el.value;
  if (key === "glossary") glossaryEntries = TextUtils.parseGlossary(prefs.glossary);
  if (key === "pushToTalk" && el.checked && isListening && !pttActive) {
    // Switching to push-to-talk while the mic is open: close it so the
    // person starts from "listens only while held".
    endListeningTurn();
  }
  if (key === "pushToTalk" || key === "pttKey") {
    syncPttUi();
    updateIdleHint();
  }
  savePrefs();
}

for (const el of prefControls()) {
  el.addEventListener(el.tagName === "TEXTAREA" || el.type === "range" ? "input" : "change", () => onPrefControlChange(el));
}

/* ---------- Saved language pairs ---------- */

function renderPairs() {
  while (pairSelect.options.length > 1) pairSelect.remove(1);
  prefs.savedPairs.forEach((pair, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${langName(pair.src)} → ${langName(pair.tgt)}`;
    pairSelect.appendChild(opt);
  });
}

savePairBtn.addEventListener("click", () => {
  const pair = { src: sourceLangSelect.value, tgt: targetLangSelect.value };
  if (prefs.savedPairs.some((p) => p.src === pair.src && p.tgt === pair.tgt)) {
    setStatus("That language pair is already saved.");
    return;
  }
  prefs.savedPairs = [...prefs.savedPairs, pair].slice(-MAX_SAVED_PAIRS);
  savePrefs();
  renderPairs();
  setStatus("Language pair saved.");
});

deletePairBtn.addEventListener("click", () => {
  const i = Number(pairSelect.value);
  if (pairSelect.value === "" || !prefs.savedPairs[i]) return;
  prefs.savedPairs = prefs.savedPairs.filter((_, idx) => idx !== i);
  savePrefs();
  renderPairs();
});

pairSelect.addEventListener("change", () => {
  const pair = prefs.savedPairs[Number(pairSelect.value)];
  if (pairSelect.value === "" || !pair) return;
  if (isListening) {
    setStatus("Stop listening before switching language pairs.");
    pairSelect.value = "";
    return;
  }
  setSelectValue(sourceLangSelect, pair.src);
  setSelectValue(targetLangSelect, pair.tgt);
  saveSettings();
});

/* ---------- Local stats (counts only, never text) ---------- */

async function refreshStats() {
  try {
    const { counts, since } = await stats.summary();
    const n = (k) => counts[k] || 0;
    statsLineEl.textContent =
      `Since ${new Date(since).toLocaleDateString()}: ${n("sessions")} sessions · ${n("phrases")} phrases · ` +
      `${n("inserted")} typed · ${n("errors")} errors. Counts stay on this device.`;
  } catch (err) {
    statsLineEl.textContent = "";
  }
}

function countStat(name) {
  stats.inc(name).then(refreshStats).catch(() => {});
}

resetStatsBtn.addEventListener("click", async () => {
  await stats.reset();
  refreshStats();
});

/* ---------- Page hint ---------- */

async function updatePageHint() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || "";
    const isInternalPage = /^(chrome|chrome-extension|chrome-search|devtools|edge|about):/i.test(url) || url === "";
    const isCustomEditor = CUSTOM_EDITOR_HOSTS.some((host) => url.includes(host));

    if (isInternalPage) {
      pageHintEl.style.display = "block";
      pageHintEl.textContent =
        "This is a browser-internal page (like the New Tab Page or a settings page), so no extension — including this one — is allowed to type into it. Open a real website first.";
    } else if (isCustomEditor) {
      pageHintEl.style.display = "block";
      pageHintEl.textContent =
        "This site uses a custom editor, so direct auto-typing may not reach the document. If it doesn't, the translation is copied automatically — paste with Ctrl+V.";
    } else {
      pageHintEl.style.display = "none";
      pageHintEl.textContent = "";
    }
  } catch (err) {
    pageHintEl.style.display = "none";
  }
}

/* ---------- Mic state, error recovery ---------- */

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionActive = false;
let isListening = false;
let starting = false;
let restartTimer = null;
let silenceTimer = null;
let settleFallbackTimer = null;
let consecutiveErrors = 0;
let finalTranscript = "";
let autoTypeWarned = false;
let finalizedTranslation = "";
let interimGen = 0;
let interimTimer = null;
let lastInterimSource = "";
let sessionHadOutput = false;
let micState = "idle";
let lastReportedListening = false;

// "idle" | "listening" | "processing" | "finished" | "error" — drives a
// subtle style on the mic button and mirrors into the toolbar icon.
function setMicState(state) {
  micState = state;
  micBtn.dataset.state = state;
  micBtn.classList.toggle("listening", state === "listening");
  pttBtn.classList.toggle("held", state === "listening");
  micBtn.setAttribute("aria-pressed", state === "listening" ? "true" : "false");
  reportListening(state === "listening");
}

function reportListening(on) {
  if (on === lastReportedListening) return;
  lastReportedListening = on;
  try {
    chrome.runtime.sendMessage({ type: "listeningState", value: on }).catch(() => {});
  } catch (err) {
    /* background not reachable — the toolbar indicator is cosmetic */
  }
}

function refreshIdleState() {
  if (isListening) return setMicState("listening");
  if (isBusy()) return setMicState("processing");
  if (micState === "error") return;
  setMicState(sessionHadOutput ? "finished" : "idle");
}

let errorActionHandler = null;

function showErrorAction(text, label, handler) {
  errorActionTextEl.textContent = text;
  errorActionBtn.textContent = label;
  errorActionHandler = handler;
  errorActionEl.hidden = false;
}

function hideErrorAction() {
  errorActionEl.hidden = true;
  errorActionHandler = null;
}

errorActionBtn.addEventListener("click", () => {
  const handler = errorActionHandler;
  hideErrorAction();
  if (handler) handler();
});

function reportError(message, action) {
  setStatus(message);
  setMicState("error");
  sounds.play("error");
  countStat("errors");
  if (action) showErrorAction(action.text, action.label, action.run);
}

function showMicBlocked(text) {
  permissionHintTextEl.textContent =
    text || "Chrome can't show the microphone prompt inside this side panel.";
  permissionHintEl.style.display = "block";
}

// Checks the microphone permission up front, so a blocked mic gets a clear
// explanation and a direct link instead of a silent failure after the tap.
async function microphoneBlocked() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state === "denied";
  } catch (err) {
    return false; // can't tell — just try to start
  }
}

openMicSettingsBtn.addEventListener("click", () => {
  const site = encodeURIComponent(`chrome-extension://${chrome.runtime.id}`);
  chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${site}` }).catch(() => {});
});

grantPermissionBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
});

/* ---------- Sessions, pipeline ids, field lock ---------- */

// Wire-level ordering number sent to the content script with every insert,
// so it can tell which of two racing network replies is actually newest.
// Seeded from the clock (not 0) so that if the side panel is closed and
// reopened while the same page stays alive, the fresh counter starts above
// anything the page's content script remembers from the previous session —
// a plain reset-to-0 counter would collide with that and get every new
// insert wrongly rejected as stale.
let genCounter = Date.now();
function nextGen() {
  return ++genCounter;
}

let sessionId = "";
let phraseCounter = 0;
let sessionLangs = { src: "ur", tgt: "en" }; // fixed when listening starts, so a conversation-mode swap can't re-route late results
let sessionTypedCount = 0;
let startTabId = null;
let lockInfo = null; // { tabId, frameId, token } while "stick to the field" is active
let lockPromise = Promise.resolve();
let submitOnce = false;
let pendingSubmit = false;
let pttActive = false;
let pttReleasedEarly = false; // key let go while the mic was still starting
const processedPids = new Set();
const sessionLog = []; // in memory only — built into a file only when "Download transcript" is pressed

function newPid() {
  return `${sessionId}-${++phraseCounter}`;
}

async function acquireLock() {
  lockInfo = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    let frameId = 0;
    try {
      frameId = (await chrome.runtime.sendMessage({ type: "getInsertFrame", tabId: tab.id }))?.frameId ?? 0;
    } catch (err) {
      /* top frame */
    }
    const result = await sendToFrameWithFallback(tab.id, frameId, { type: "lockTarget" });
    if (result.ok && result.token) {
      lockInfo = { tabId: tab.id, frameId: result.frameId ?? frameId, token: result.token };
    } else if (result.reason === "protected") {
      setStatus("That looks like a password or payment field — nothing will be typed there.");
    }
  } catch (err) {
    lockInfo = null;
  }
}

async function releaseLock() {
  const info = lockInfo;
  lockInfo = null;
  if (!info) return;
  try {
    await chrome.tabs.sendMessage(info.tabId, { type: "unlockTarget" }, { frameId: info.frameId });
  } catch (err) {
    /* page is gone — the lock went with it */
  }
}

/* ---------- Rendering ---------- */

function renderOriginal(final, interim) {
  originalTextEl.textContent = final;
  if (interim) {
    const span = document.createElement("span");
    span.className = "interim";
    span.textContent = interim;
    originalTextEl.appendChild(span);
  }
  originalTextEl.scrollTop = originalTextEl.scrollHeight;
}

function renderTranslated(liveText) {
  translatedTextEl.textContent = finalizedTranslation;
  if (liveText) {
    const span = document.createElement("span");
    span.className = "interim";
    span.textContent = (finalizedTranslation ? " " : "") + liveText;
    translatedTextEl.appendChild(span);
  }
  translatedTextEl.scrollTop = translatedTextEl.scrollHeight;
}

function clearPanelText() {
  finalTranscript = "";
  finalizedTranslation = "";
  originalTextEl.textContent = "";
  translatedTextEl.textContent = "";
}

/* ---------- Busy tracking and cancel ---------- */

const translationQueue = [];
const offlineQueue = [];
const failedItems = [];
let processingQueue = false;
let currentItem = null; // the item the queue is working on right now
let interimInFlight = 0;
let interimAbort = null;

function isBusy() {
  return translationQueue.length > 0 || processingQueue || interimInFlight > 0;
}

function updateBusyUi() {
  cancelBtn.hidden = !isBusy();
  if (!isListening) refreshIdleState();
}

function cancelAll() {
  if (!isBusy() && offlineQueue.length === 0) return;
  for (const item of translationQueue) {
    item.cancelled = true;
    if (item.controller) item.controller.abort();
  }
  translationQueue.length = 0;
  if (currentItem) {
    currentItem.cancelled = true;
    if (currentItem.controller) currentItem.controller.abort();
  }
  offlineQueue.length = 0;
  failedItems.length = 0;
  if (interimAbort) interimAbort.abort();
  interimGen++;
  clearTimeout(interimTimer);
  lastInterimSource = "";
  hideErrorAction();
  // Take back the still-unfinished live text typed into the page.
  pageMessage({ type: "discardLiveText" }).catch(() => {});
  setStatus("Cancelled.");
  countStat("cancelled");
  updateBusyUi();
}

cancelBtn.addEventListener("click", cancelAll);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isBusy()) cancelAll();
});

/* ---------- Speech recognition ---------- */

// Translates the still-changing interim guess so the page shows a live,
// continuously-updating translation instead of waiting for a pause — this
// fires periodically *while you're still talking*, not just once you stop.
// Best-effort: if a call fails or lands late, the finalized translation
// still lands correctly once the phrase completes, so failures here are
// silent.
let interimLastFireTime = 0;
const INTERIM_MIN_INTERVAL_MS = 200;

function scheduleInterimTranslate(text, bailGen) {
  clearTimeout(interimTimer);
  if (!text || !navigator.onLine) return;
  // Assigned now, at the moment this interim result is decided — before
  // the debounce wait and before the translate network call — so it
  // reflects true chronological order no matter which reply lands first.
  const wireGen = nextGen();
  const fire = async () => {
    interimLastFireTime = Date.now();
    const controller = new AbortController();
    interimAbort = controller;
    interimInFlight++;
    updateBusyUi();
    try {
      let translated = await translateText(text, sessionLangs.src, sessionLangs.tgt, controller.signal);
      if (bailGen !== interimGen || !isListening) return; // superseded by a final result, a cancel, or a newer interim
      translated = TextUtils.applyGlossary(translated, glossaryEntries);
      renderTranslated(translated);
      if (autoTypeToggle.checked) {
        const result = await sendLiveInsertToPage(translated, wireGen);
        if (!result.ok && !autoTypeWarned) {
          autoTypeWarned = true;
          setStatus(explainInsertFailure(result));
        }
      }
    } catch (err) {
      /* best-effort — the final translation will still be typed */
    } finally {
      interimInFlight = Math.max(0, interimInFlight - 1);
      updateBusyUi();
    }
  };
  const elapsed = Date.now() - interimLastFireTime;
  if (elapsed >= INTERIM_MIN_INTERVAL_MS) {
    fire();
  } else {
    interimTimer = setTimeout(fire, INTERIM_MIN_INTERVAL_MS - elapsed);
  }
}

function createRecognition() {
  const r = new SpeechRecognitionCtor();
  r.continuous = prefs.continuous !== false;
  r.interimResults = true;
  r.lang = speechCodeFor(sessionLangs.src);
  // Chrome's speech engine can return several competing guesses per
  // phrase, each with its own confidence score. Asking for more than one
  // and picking the highest-confidence guess (instead of always the
  // first) genuinely improves accuracy — this was previously left at the
  // default of 1, silently discarding better matches Chrome already had.
  r.maxAlternatives = 5;

  // Picks the best-scoring alternative out of everything Chrome offered
  // for this phrase, instead of just alternative [0].
  function bestAlternative(result) {
    let best = result[0];
    for (let i = 1; i < result.length; i++) {
      if ((result[i].confidence || 0) > (best.confidence || 0)) best = result[i];
    }
    return best;
  }

  r.onresult = (event) => {
    if (r !== recognition) return; // a replaced session's late event
    consecutiveErrors = 0;
    let interim = "";
    let hadFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const alt = bestAlternative(event.results[i]);
      const transcript = alt.transcript;
      if (event.results[i].isFinal) {
        // Background noise / mic bumps often surface as a single stray
        // character with no real content — skip those instead of typing
        // garbage into the page.
        const trimmed = transcript.trim();
        if (trimmed.length < 2) continue;
        // Optional noise filter: drop finals the engine itself is unsure of.
        // A confidence of 0 means "not reported", so it is never filtered.
        if (prefs.minConfidence > 0 && alt.confidence > 0 && alt.confidence < prefs.minConfidence) continue;
        hadFinal = true;
        const command = prefs.voiceCommands ? VoiceCommands.parseVoiceCommand(trimmed, sessionLangs.src) : null;
        if (command) {
          enqueueCommand(command);
          continue;
        }
        const corrected = TextUtils.applyGlossary(trimmed, glossaryEntries);
        finalTranscript += corrected + " ";
        enqueueTranslation(corrected);
      } else {
        interim += transcript;
      }
    }
    renderOriginal(finalTranscript, interim);
    if (hadFinal) {
      // A final result supersedes any in-flight interim guess for this phrase.
      interimGen++;
      clearTimeout(interimTimer);
      clearTimeout(silenceTimer);
      lastInterimSource = "";
    } else if (interim.trim() && interim !== lastInterimSource) {
      lastInterimSource = interim;
      // Don't type a half-heard voice command into the page.
      if (!(prefs.voiceCommands && VoiceCommands.isCommandPrefix(interim, sessionLangs.src))) {
        scheduleInterimTranslate(TextUtils.applyGlossary(interim.trim(), glossaryEntries), interimGen);
      }
      armSilenceTimer();
    }
  };

  r.onstart = () => {
    if (r !== recognition) return;
    recognitionActive = true;
    // A session actually started, so the origin already has mic permission —
    // hide the "grant permission" hint if it was showing from a prior attempt.
    permissionHintEl.style.display = "none";
  };

  r.onerror = (event) => {
    if (r !== recognition) return;
    if (event.error === "no-speech" || event.error === "aborted") return;
    consecutiveErrors++;
    const message = ERROR_MESSAGES[event.error] || `Mic error: ${event.error}`;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      // Chrome side panels can't display the mic permission prompt, so a
      // "not-allowed" here on first use almost always means the prompt was
      // never actually shown to the person, not that they clicked Block.
      // Point them at a real tab where the prompt can appear.
      showMicBlocked();
      reportError(message);
    } else if (event.error === "audio-capture") {
      reportError(message, { text: "Plug in or enable a microphone.", label: "Try again", run: () => startListening() });
    } else if (event.error === "network") {
      reportError(message, { text: "The speech service couldn't be reached.", label: "Try again", run: () => startListening() });
    } else {
      reportError(message);
    }
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      stopListening({ keepError: true });
    }
  };

  r.onend = () => {
    if (r !== recognition) return;
    recognitionActive = false;
    if (!isListening) {
      settle();
      return;
    }
    if (prefs.continuous === false) {
      // One phrase per tap: the engine finished its turn, so wrap it up like a tap on the mic.
      endListeningTurn();
      return;
    }
    clearTimeout(restartTimer);
    const delay = Math.min(1500, 200 * 2 ** Math.min(consecutiveErrors, 3));
    restartTimer = setTimeout(restartRecognition, delay);
  };

  return r;
}

// "Wait after I stop talking" — only ever *shorter* than Chrome's own pause
// detection: stop() makes the engine finalize what it has right now, and
// the normal onend path then restarts listening.
function armSilenceTimer() {
  clearTimeout(silenceTimer);
  if (!prefs.silenceMs || !isListening) return;
  silenceTimer = setTimeout(() => {
    if (!isListening || !recognition) return;
    try {
      recognition.stop();
    } catch (err) {
      /* already stopping */
    }
  }, prefs.silenceMs);
}

function restartRecognition() {
  if (!isListening) return;
  try {
    recognition.start();
    setStatus("Listening…");
  } catch (err) {
    try {
      recognition = createRecognition();
      recognition.start();
      setStatus("Listening…");
    } catch (err2) {
      reportError("Mic stopped unexpectedly — tap the mic to restart.");
      stopListening({ keepError: true });
    }
  }
}

// Throws away a recognition object so none of its late events can act on the
// panel — used before starting a new one and when the panel closes.
function discardRecognition() {
  const old = recognition;
  recognition = null;
  recognitionActive = false;
  if (!old) return;
  old.onresult = old.onstart = old.onerror = old.onend = null;
  try {
    old.abort();
  } catch (err) {
    /* already stopped */
  }
}

async function startListening() {
  if (isListening || starting) return; // never run two mic sessions at once
  if (!SpeechRecognitionCtor) {
    setStatus("Speech recognition isn't supported in this browser.");
    return;
  }
  starting = true;
  try {
    if (await microphoneBlocked()) {
      showMicBlocked("The microphone is blocked for this extension in Chrome.");
      reportError("Microphone blocked. Allow it in Chrome's microphone settings, then tap the mic again.");
      return;
    }
    discardRecognition();
    sessionId = Date.now().toString(36);
    phraseCounter = 0;
    sessionTypedCount = 0;
    pendingSubmit = false;
    sessionHadOutput = false;
    sessionLangs = { src: sourceLangSelect.value, tgt: targetLangSelect.value };
    finalTranscript = "";
    consecutiveErrors = 0;
    autoTypeWarned = false;
    finalizedTranslation = "";
    interimGen++;
    clearTimeout(interimTimer);
    clearTimeout(settleFallbackTimer);
    lastInterimSource = "";
    interimLastFireTime = 0;
    permissionHintEl.style.display = "none";
    hideErrorAction();
    originalTextEl.textContent = "";
    translatedTextEl.textContent = "";
    recognition = createRecognition();
    isListening = true;
    setMicState("listening");
    setStatus("Listening…");
    updatePageHint();
    try {
      recognition.start();
      sounds.play("listening");
      countStat("sessions");
    } catch (err) {
      isListening = false;
      discardRecognition();
      reportError("Couldn't start the mic. Tap again to retry.");
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      startTabId = tab?.id ?? null;
    } catch (err) {
      startTabId = null;
    }
    lockInfo = null;
    lockPromise = prefs.lockField ? acquireLock() : Promise.resolve();
  } finally {
    starting = false;
  }
  if (pttReleasedEarly) {
    pttReleasedEarly = false;
    if (isListening && pttActive) {
      pttActive = false;
      endListeningTurn();
    }
  }
}

// Stops the microphone. `keepError` leaves an error state showing instead of
// replacing it with a plain "Stopped.".
function stopListening(options = {}) {
  isListening = false;
  clearTimeout(restartTimer);
  clearTimeout(silenceTimer);
  if (!options.keepError) setStatus("Stopped.");
  if (recognition) {
    try {
      recognition.stop();
    } catch (err) {
      /* already stopped */
    }
  }
  // If the engine never reports its end, don't wait forever to wrap up.
  clearTimeout(settleFallbackTimer);
  settleFallbackTimer = setTimeout(() => {
    recognitionActive = false;
    settle();
  }, 2500);
  if (micState === "listening") setMicState("idle");
  refreshIdleState();
}

// A person ended their turn (mic tap, push-to-talk release, voice command).
function endListeningTurn() {
  const hadSpeech = finalTranscript.trim().length > 0;
  pendingSubmit = prefs.autoSubmit || submitOnce;
  submitOnce = false;
  stopListening();
  // Conversation mode: whoever just spoke ended their turn, so swap
  // languages now — the pair is ready for the other person to reply on the
  // next tap. Skipped if nothing was actually said, so an accidental
  // start/stop tap doesn't swap anything.
  if (conversationModeToggle.checked && hadSpeech) {
    swapLanguages();
    setStatus("Swapped for the reply — tap the mic when ready.");
  }
}

// Runs once nothing is listening, translating or ending any more: presses
// Enter if asked to, releases the field lock and settles the mic state.
let settling = false;
async function settle() {
  if (settling || isListening || recognitionActive || isBusy()) return;
  settling = true;
  try {
    clearTimeout(settleFallbackTimer);
    if (pendingSubmit) {
      pendingSubmit = false;
      if (sessionTypedCount > 0 && autoTypeToggle.checked) {
        const result = await pageMessage({ type: "submitEnter" });
        if (result.ok) setStatus("Typed and pressed Enter.");
      }
    }
    await releaseLock();
    refreshIdleState();
  } finally {
    settling = false;
  }
}

micBtn.addEventListener("click", (e) => {
  // Push-to-talk mode: the button is hold-to-talk (handled by the pointer
  // events below), so a mouse click must not also toggle. Keyboard activation
  // (Enter/Space, detail 0) still toggles so the button stays usable without a mouse.
  if (prefs.pushToTalk && e.detail > 0) return;
  pttActive = false;
  if (isListening) {
    endListeningTurn();
  } else {
    startListening();
  }
});

/* ---------- Translation (ordered queue with retry) ---------- */

function enqueueTranslation(text, resume) {
  if (!text) return;
  // Assigned now, when the final speech result is decided — before it
  // even enters the queue — so its wire order is locked in regardless of
  // how long translation or queueing takes afterward.
  const item = {
    kind: "translate",
    pid: resume?.pid || newPid(),
    gen: nextGen(),
    text,
    src: resume?.src || sessionLangs.src,
    tgt: resume?.tgt || sessionLangs.tgt,
    controller: new AbortController(),
    cancelled: false,
  };
  // Kick the network request off right away instead of waiting for a turn
  // in the queue. If you speak several sentences quickly, their translate
  // calls now run concurrently over the network instead of strictly one
  // after another — that was pure serialized waiting with no accuracy
  // benefit. Results are still *applied* in the queue's original FIFO
  // order below, so text always lands on the page in the order you spoke
  // it, even if a later sentence's network reply happens to arrive first.
  item.promise = translateWithRetry(text, item.src, item.tgt, 3, item.controller.signal);
  item.promise.catch(() => {}); // handled when the queue reaches this item
  translationQueue.push(item);
  processQueue();
  updateBusyUi();
}

// Voice commands ride the same queue so they run in the order spoken —
// "delete last word" never races ahead of the phrase before it.
function enqueueCommand(name) {
  translationQueue.push({ kind: "command", name, promise: Promise.resolve(), cancelled: false });
  processQueue();
  updateBusyUi();
}

async function runCommand(name) {
  if (name === "stopListening") {
    if (isListening) endListeningTurn();
    return;
  }
  if (name === "clearText") {
    await pageMessage({ type: "undoAll", sid: sessionId });
    clearPanelText();
    setStatus("Cleared.");
  } else if (name === "deleteLastWord") {
    const result = await pageMessage({ type: "deleteLastWord" });
    setStatus(result.ok ? "Deleted the last word." : "Nothing of mine to delete there.");
  } else if (name === "newLine") {
    const result = await pageMessage({ type: "newLine", sid: sessionId });
    if (!result.ok) setStatus("This field can't take a new line.");
  }
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  updateBusyUi();
  while (translationQueue.length) {
    const item = translationQueue.shift();
    currentItem = item;
    if (item.cancelled) continue;
    if (item.kind === "command") {
      try {
        await runCommand(item.name);
      } catch (err) {
        /* a failed command must not block the queue */
      }
      continue;
    }
    try {
      const translated = await item.promise;
      if (item.cancelled) continue;
      await appendTranslation(item, translated);
    } catch (err) {
      if (item.cancelled) continue;
      handleTranslationFailure(item, err);
    }
  }
  currentItem = null;
  processingQueue = false;
  updateBusyUi();
  maybeClearAfterInsert();
  settle();
}

function handleTranslationFailure(item, err) {
  if (err && err.offline) {
    // Keep what was said and translate it once the connection is back.
    offlineQueue.push({ pid: item.pid, text: item.text, src: item.src, tgt: item.tgt });
    setStatus(`You're offline — ${offlineQueue.length} phrase(s) saved. They'll be translated when you're back online.`);
    countStat("offlineQueued");
    return;
  }
  failedItems.push({ pid: item.pid, text: item.text, src: item.src, tgt: item.tgt });
  reportError("Translation failed — check your connection.", {
    text: `${failedItems.length} phrase(s) weren't translated.`,
    label: "Retry translation",
    run: retryFailed,
  });
}

function retryFailed() {
  const items = failedItems.splice(0);
  for (const it of items) enqueueTranslation(it.text, it);
  if (items.length) setStatus("Retrying…");
}

function resumeOfflineQueue() {
  if (!offlineQueue.length) return;
  const items = offlineQueue.splice(0);
  setStatus("Back online — translating saved phrases…");
  for (const it of items) enqueueTranslation(it.text, it);
}

window.addEventListener("online", resumeOfflineQueue);
window.addEventListener("offline", () => {
  if (isListening) setStatus("You're offline — what you say is kept and translated when you're back.");
});

// A hung (not erroring, just very slow) request would otherwise have no
// upper bound on how long it blocks — fetch has no built-in timeout. This
// caps a single attempt at 8s so a stuck request fails fast into a retry
// instead of stalling the whole queue behind it indefinitely.
const TRANSLATE_TIMEOUT_MS = 8000;

async function translateText(text, source, target, signal) {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx` +
    `&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("Translation request failed");
    const data = await res.json();
    return data[0].map((chunk) => chunk[0]).join("");
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function translateWithRetry(text, source, target, attempts = 3, signal) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (signal && signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (!navigator.onLine) {
      const offlineErr = new Error("offline");
      offlineErr.offline = true;
      throw offlineErr;
    }
    try {
      return await translateText(text, source, target, signal);
    } catch (err) {
      lastErr = err;
      if (signal && signal.aborted) throw err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  if (!navigator.onLine) lastErr.offline = true;
  throw lastErr;
}

async function appendTranslation(item, translatedRaw) {
  // The same phrase must never be typed twice (e.g. a retry racing the
  // original), so each phrase id is accepted once.
  if (processedPids.has(item.pid)) return;
  processedPids.add(item.pid);

  let translated = TextUtils.applyGlossary(translatedRaw, glossaryEntries);
  if (prefs.autoPunct) translated = TextUtils.addPunctuation(translated, item.tgt);

  interimGen++; // this final result supersedes any interim guess in flight
  clearTimeout(interimTimer);
  finalizedTranslation += (finalizedTranslation ? " " : "") + translated;
  renderTranslated("");
  sessionHadOutput = true;
  sessionLog.push({ at: new Date(), from: item.src, to: item.tgt, original: item.text, translated });
  countStat("phrases");
  sounds.play("translated");
  if (isListening) setStatus("Listening…");

  rememberLastTranslation(translated);

  if (autoTypeToggle.checked) {
    // Replace the live (interim) guess currently typed in the page with the
    // authoritative final translation, then lock it in so the next
    // sentence you speak is appended after it instead of overwriting it.
    const result = await sendLiveInsertToPage(translated + " ", item.gen, item.pid);
    if (result.ok) {
      // Only commit if this insert actually landed — if it was dropped as
      // stale (a newer result already won), committing here would wipe
      // out liveState for text that's still legitimately in progress.
      if (result.applied !== false) {
        await commitLiveInsertion(item.gen, item.pid);
        sessionTypedCount++;
        countStat("inserted");
        sounds.play("inserted");
      }
    } else if (!autoTypeWarned) {
      autoTypeWarned = true;
      setStatus(explainInsertFailure(result));
    }
  }
}

// Kept in browser-session storage only (gone when Chrome closes) so the
// "repeat last" shortcut can type it again. Skipped when the person asked
// for typed text not to be kept around.
function rememberLastTranslation(text) {
  try {
    if (prefs.clearAfterInsert) {
      chrome.storage.session.remove("lastTranslation");
    } else {
      chrome.storage.session.set({ lastTranslation: { text, ts: Date.now() } });
    }
  } catch (err) {
    /* optional convenience */
  }
}

function maybeClearAfterInsert() {
  if (!prefs.clearAfterInsert || isBusy() || sessionTypedCount === 0) return;
  clearPanelText();
}

function explainInsertFailure(result) {
  switch (result && result.reason) {
    case "protected":
      return "That looks like a password or payment field, so nothing is typed there. Use Copy if you really need the text.";
    case "paused":
      return "Typing paused because you switched tabs. Switch back to continue, or use Copy.";
    default:
      return "Couldn't auto-type here. Use Copy + Ctrl+V, or click into a text field on the page.";
  }
}

/* ---------- Insert into page (frame-aware) ---------- */

async function getActiveTabAndFrame() {
  if (lockInfo) return { tabId: lockInfo.tabId, frameId: lockInfo.frameId };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { tabId: null, frameId: 0 };
  let frameId = 0;
  try {
    const frameInfo = await chrome.runtime.sendMessage({ type: "getInsertFrame", tabId: tab.id });
    frameId = frameInfo?.frameId ?? 0;
  } catch (err) {
    /* fall back to top frame */
  }
  return { tabId: tab.id, frameId };
}

// Sends a message to the page's field, honouring the locked field and the
// "pause if I switch tabs" option.
async function pageMessage(message) {
  await lockPromise;
  const { tabId, frameId } = await getActiveTabAndFrame();
  if (!tabId) return { ok: false, reason: "no-tab" };
  if (prefs.pauseOnTabSwitch && !lockInfo && isListening && startTabId != null && tabId !== startTabId) {
    return { ok: false, applied: false, reason: "paused" };
  }
  const withLock = lockInfo ? { ...message, lockToken: lockInfo.token } : message;
  return sendToFrameWithFallback(tabId, frameId, withLock);
}

async function sendInsertToPage(text, gen) {
  return pageMessage({ type: "insertText", text, gen, sid: sessionId || undefined });
}

// Types the still-changing interim translation in place, replacing the
// previous live guess rather than appending a new one each time.
async function sendLiveInsertToPage(text, gen, pid) {
  return pageMessage({
    type: "insertLiveText",
    text,
    gen,
    pid,
    sid: sessionId,
    mode: prefs.insertAtCursor ? "cursor" : "end",
  });
}

// Sends to the frame we last saw the cursor in. If that frame is stale
// (e.g. the tab navigated since focus was last recorded, so the frameId no
// longer exists) the send throws — in that case we retry once against the
// page's top-level frame instead of just giving up.
async function sendToFrameWithFallback(tabId, frameId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
    return response ? { ...response, frameId } : { ok: false, reason: "no-response" };
  } catch (err) {
    if (frameId === 0) return { ok: false, reason: "no-content-script" };
    try {
      const response = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      return response ? { ...response, frameId: 0 } : { ok: false, reason: "no-response" };
    } catch (err2) {
      return { ok: false, reason: "no-content-script" };
    }
  }
}

// Locks in the currently-typed live text so the next phrase's live updates
// start fresh instead of deleting what's already been finalized.
async function commitLiveInsertion(gen, pid) {
  try {
    await pageMessage({ type: "commitLiveText", gen, pid, sid: sessionId });
  } catch (err) {
    /* best-effort */
  }
}

insertBtn.addEventListener("click", async () => {
  const text = translatedTextEl.textContent.trim();
  if (!text) return;
  // A deliberate manual insert is its own decided event too — giving it a
  // generation number stops any straggling live/final message from a
  // previous phrase overwriting it if it lands slightly afterward.
  const result = await sendInsertToPage(text, nextGen());
  if (result.ok) {
    setStatus("Inserted into page.");
    sounds.play("inserted");
    return;
  }
  if (result.reason === "protected") {
    setStatus(explainInsertFailure(result));
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Couldn't type directly here — copied instead. Paste with Ctrl+V (Cmd+V on Mac).");
  } catch (err) {
    setStatus("Click into a text field on the page, then try again.");
  }
});

/* ---------- Other controls ---------- */

function swapLanguages() {
  const s = sourceLangSelect.value;
  const t = targetLangSelect.value;
  setSelectValue(sourceLangSelect, t);
  setSelectValue(targetLangSelect, s);
  saveSettings();
}

swapBtn.addEventListener("click", swapLanguages);

sourceLangSelect.addEventListener("change", saveSettings);
targetLangSelect.addEventListener("change", saveSettings);
autoTypeToggle.addEventListener("change", () => {
  autoTypeWarned = false;
  saveSettings();
});
conversationModeToggle.addEventListener("change", saveSettings);

speakBtn.addEventListener("click", () => {
  const text = translatedTextEl.textContent.trim();
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = targetLangSelect.selectedOptions[0].dataset.speech;
  utterance.rate = prefs.playbackRate || 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
});

copyBtn.addEventListener("click", async () => {
  const text = translatedTextEl.textContent.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus("Copied to clipboard.");
});

clearBtn.addEventListener("click", () => {
  clearPanelText();
  interimGen++;
  clearTimeout(interimTimer);
  lastInterimSource = "";
  for (const item of translationQueue) {
    item.cancelled = true;
    if (item.controller) item.controller.abort();
  }
  translationQueue.length = 0;
  updateBusyUi();
  setStatus("Cleared.");
});

downloadTranscriptBtn.addEventListener("click", () => {
  if (!sessionLog.length) {
    setStatus("Nothing to download yet — the transcript only covers this panel session.");
    return;
  }
  const lines = ["Voice Translate & Dictate — transcript", `Saved ${new Date().toLocaleString()}`, ""];
  for (const entry of sessionLog) {
    lines.push(`[${entry.at.toLocaleTimeString()}] ${langName(entry.from)} → ${langName(entry.to)}`);
    lines.push(`  Said:       ${entry.original}`);
    lines.push(`  Translated: ${entry.translated}`);
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  a.href = url;
  a.download = `voice-translate-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

shortcutsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(() => {});
});

/* ---------- Keyboard shortcuts and push-to-talk ---------- */

function handlePanelCommand(name, payload) {
  if (name === "toggle-listening") {
    pttActive = false;
    if (isListening) endListeningTurn();
    else startListening();
  } else if (name === "toggle-listening-submit") {
    pttActive = false;
    submitOnce = true;
    if (isListening) endListeningTurn();
    else startListening();
  } else if (name === "cancel-processing") {
    cancelAll();
  }
}

// Hold to talk: press starts listening, release ends the turn. A mic that
// was already running when the key went down is left alone.
function pttDown() {
  if (starting) return;
  if (isListening) {
    // The mic was already on (started by a click or a shortcut). Take it
    // over, so letting go of the key ends it instead of leaving it stuck on.
    if (!pttActive) pttActive = true;
    return;
  }
  pttActive = true;
  pttReleasedEarly = false;
  startListening();
}

function pttUp() {
  if (!pttActive) return;
  if (starting) {
    pttReleasedEarly = true;
  } else if (isListening) {
    pttActive = false;
    endListeningTurn();
  } else {
    pttActive = false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "panelCommand") {
    handlePanelCommand(message.name);
  } else if (message?.type === "ptt") {
    // Sent by the page's content script, which sees the key while the page has focus.
    if (!prefs.pushToTalk) return false;
    if (message.down) pttDown();
    else pttUp();
  }
  return false;
});

// The same key also works while the panel itself has focus.
document.addEventListener("keydown", (e) => {
  if (!prefs.pushToTalk) return;
  if (!isPttKey(e)) {
    // Another key with a held modifier means a shortcut, not push-to-talk.
    if (pttModifierTimer) {
      clearTimeout(pttModifierTimer);
      pttModifierTimer = null;
    } else if (pttActive && isModifierPttKey()) {
      pttUp();
    }
    return;
  }
  if (e.repeat) return;
  if (isModifierPttKey()) {
    if (!pttModifierTimer) {
      pttModifierTimer = setTimeout(() => {
        pttModifierTimer = null;
        pttDown();
      }, PTT_MODIFIER_DELAY_MS);
    }
    return;
  }
  e.preventDefault();
  pttDown();
});
document.addEventListener("keyup", (e) => {
  if (!prefs.pushToTalk || !isPttKey(e)) return;
  if (pttModifierTimer) {
    clearTimeout(pttModifierTimer);
    pttModifierTimer = null;
    return;
  }
  if (!isModifierPttKey()) e.preventDefault();
  pttUp();
});
window.addEventListener("blur", pttUp);

// The mic button and the "Hold to talk" button are both hold-to-talk while
// push-to-talk is on.
function attachHoldToTalk(btn) {
  btn.addEventListener("pointerdown", (e) => {
    if (!prefs.pushToTalk || e.button !== 0) return;
    if (isListening && !pttActive) {
      // Already listening from before: a press switches it off, otherwise
      // push-to-talk mode would give no way to stop it.
      endListeningTurn();
      return;
    }
    try {
      btn.setPointerCapture(e.pointerId); // so releasing outside the button still counts
    } catch (err) {
      /* capture is a nicety */
    }
    pttDown();
  });
  btn.addEventListener("pointerup", () => {
    if (prefs.pushToTalk) pttUp();
  });
  btn.addEventListener("pointercancel", () => {
    if (prefs.pushToTalk) pttUp();
  });
}
attachHoldToTalk(micBtn);
attachHoldToTalk(pttBtn);

// Keyboard users can hold Space or Enter on the focused "Hold to talk" button.
pttBtn.addEventListener("keydown", (e) => {
  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
    e.preventDefault();
    pttDown();
  }
});
pttBtn.addEventListener("keyup", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    pttUp();
  }
});

// A shortcut pressed while the panel was closed opened it; pick up what it asked for.
async function consumePendingCommand() {
  try {
    const data = await chrome.storage.session.get("pendingCommand");
    const pending = data.pendingCommand;
    if (!pending) return;
    await chrome.storage.session.remove("pendingCommand");
    if (Date.now() - pending.ts < 10000) handlePanelCommand(pending.name);
  } catch (err) {
    /* nothing pending */
  }
}

/* ---------- Cleanup when the panel closes ---------- */

window.addEventListener("pagehide", () => {
  isListening = false;
  clearTimeout(restartTimer);
  clearTimeout(silenceTimer);
  clearTimeout(interimTimer);
  discardRecognition();
  try {
    speechSynthesis.cancel();
  } catch (err) {
    /* nothing speaking */
  }
  reportListening(false);
  if (lockInfo) {
    chrome.tabs.sendMessage(lockInfo.tabId, { type: "unlockTarget" }, { frameId: lockInfo.frameId }).catch(() => {});
  }
});

populateLanguages();
loadSettings().then(consumePendingCommand);
updatePageHint();
setMicState("idle");
