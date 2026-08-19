const LANGUAGES = [
  { name: "Arabic", code: "ar", speech: "ar-SA" },
  { name: "Bengali", code: "bn", speech: "bn-BD" },
  { name: "Chinese (Simplified)", code: "zh-CN", speech: "zh-CN" },
  { name: "Chinese (Traditional)", code: "zh-TW", speech: "zh-TW" },
  { name: "English", code: "en", speech: "en-US" },
  { name: "Farsi / Persian", code: "fa", speech: "fa-IR" },
  { name: "French", code: "fr", speech: "fr-FR" },
  { name: "German", code: "de", speech: "de-DE" },
  { name: "Hindi", code: "hi", speech: "hi-IN" },
  { name: "Italian", code: "it", speech: "it-IT" },
  { name: "Japanese", code: "ja", speech: "ja-JP" },
  { name: "Korean", code: "ko", speech: "ko-KR" },
  { name: "Pashto", code: "ps", speech: "ps-AF" },
  { name: "Portuguese", code: "pt", speech: "pt-PT" },
  { name: "Punjabi", code: "pa", speech: "pa-IN" },
  { name: "Russian", code: "ru", speech: "ru-RU" },
  { name: "Spanish", code: "es", speech: "es-ES" },
  { name: "Turkish", code: "tr", speech: "tr-TR" },
  { name: "Urdu", code: "ur", speech: "ur-PK" },
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

const sourceLangSelect = document.getElementById("sourceLang");
const targetLangSelect = document.getElementById("targetLang");
const swapBtn = document.getElementById("swapBtn");
const micBtn = document.getElementById("micBtn");
const statusEl = document.getElementById("status");
const pageHintEl = document.getElementById("pageHint");
const autoTypeToggle = document.getElementById("autoTypeToggle");
const originalTextEl = document.getElementById("originalText");
const translatedTextEl = document.getElementById("translatedText");
const speakBtn = document.getElementById("speakBtn");
const copyBtn = document.getElementById("copyBtn");
const insertBtn = document.getElementById("insertBtn");
const clearBtn = document.getElementById("clearBtn");
const permissionHintEl = document.getElementById("permissionHint");
const grantPermissionBtn = document.getElementById("grantPermissionBtn");

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

async function loadSettings() {
  const data = await chrome.storage.local.get(["sourceLang", "targetLang", "autoType"]);
  setSelectValue(sourceLangSelect, data.sourceLang || "ur");
  setSelectValue(targetLangSelect, data.targetLang || "en");
  autoTypeToggle.checked = data.autoType !== false;
}

function saveSettings() {
  chrome.storage.local.set({
    sourceLang: sourceLangSelect.value,
    targetLang: targetLangSelect.value,
    autoType: autoTypeToggle.checked,
  });
}

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

/* ---------- Speech recognition ---------- */

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let restartTimer = null;
let consecutiveErrors = 0;
let finalTranscript = "";
let autoTypeWarned = false;
let finalizedTranslation = "";
let interimGen = 0;
let interimTimer = null;
let lastInterimSource = "";

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
  if (!text) return;
  // Assigned now, at the moment this interim result is decided — before
  // the debounce wait and before the translate network call — so it
  // reflects true chronological order no matter which reply lands first.
  const wireGen = nextGen();
  const fire = async () => {
    interimLastFireTime = Date.now();
    try {
      const translated = await translateText(text, sourceLangSelect.value, targetLangSelect.value);
      if (bailGen !== interimGen || !isListening) return; // superseded by a final result or a newer interim
      renderTranslated(translated);
      if (autoTypeToggle.checked) {
        const result = await sendLiveInsertToPage(translated, wireGen);
        if (!result.ok && !autoTypeWarned) {
          autoTypeWarned = true;
          setStatus("Couldn't auto-type here. Use Copy + Ctrl+V, or click into a text field on the page.");
        }
      }
    } catch (err) {
      /* best-effort — the final translation will still be typed */
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
  r.continuous = true;
  r.interimResults = true;
  r.lang = sourceLangSelect.selectedOptions[0].dataset.speech;
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
        hadFinal = true;
        finalTranscript += transcript + " ";
        enqueueTranslation(trimmed);
      } else {
        interim += transcript;
      }
    }
    renderOriginal(finalTranscript, interim);
    if (hadFinal) {
      // A final result supersedes any in-flight interim guess for this phrase.
      interimGen++;
      clearTimeout(interimTimer);
      lastInterimSource = "";
    } else if (interim.trim() && interim !== lastInterimSource) {
      lastInterimSource = interim;
      scheduleInterimTranslate(interim.trim(), interimGen);
    }
  };

  r.onstart = () => {
    // A session actually started, so the origin already has mic permission —
    // hide the "grant permission" hint if it was showing from a prior attempt.
    permissionHintEl.style.display = "none";
  };

  r.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    consecutiveErrors++;
    setStatus(ERROR_MESSAGES[event.error] || `Mic error: ${event.error}`);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      // Chrome side panels can't display the mic permission prompt, so a
      // "not-allowed" here on first use almost always means the prompt was
      // never actually shown to the person, not that they clicked Block.
      // Point them at a real tab where the prompt can appear.
      permissionHintEl.style.display = "block";
    }
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      stopListening();
    }
  };

  r.onend = () => {
    if (!isListening) return;
    clearTimeout(restartTimer);
    const delay = Math.min(1500, 200 * 2 ** Math.min(consecutiveErrors, 3));
    restartTimer = setTimeout(restartRecognition, delay);
  };

  return r;
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
      setStatus("Mic stopped unexpectedly — tap the mic to restart.");
      stopListening();
    }
  }
}

function startListening() {
  if (!SpeechRecognitionCtor) {
    setStatus("Speech recognition isn't supported in this browser.");
    return;
  }
  finalTranscript = "";
  consecutiveErrors = 0;
  autoTypeWarned = false;
  finalizedTranslation = "";
  interimGen++;
  clearTimeout(interimTimer);
  lastInterimSource = "";
  interimLastFireTime = 0;
  permissionHintEl.style.display = "none";
  originalTextEl.textContent = "";
  translatedTextEl.textContent = "";
  recognition = createRecognition();
  isListening = true;
  micBtn.classList.add("listening");
  micBtn.setAttribute("aria-pressed", "true");
  setStatus("Listening…");
  updatePageHint();
  try {
    recognition.start();
  } catch (err) {
    setStatus("Couldn't start the mic. Tap again to retry.");
    isListening = false;
    micBtn.classList.remove("listening");
    micBtn.setAttribute("aria-pressed", "false");
  }
}

function stopListening() {
  isListening = false;
  clearTimeout(restartTimer);
  micBtn.classList.remove("listening");
  micBtn.setAttribute("aria-pressed", "false");
  if (recognition) {
    try {
      recognition.stop();
    } catch (err) {
      /* already stopped */
    }
  }
  setStatus("Stopped.");
}

micBtn.addEventListener("click", () => {
  if (isListening) stopListening();
  else startListening();
});

grantPermissionBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
});

/* ---------- Translation (ordered queue with retry) ---------- */

const translationQueue = [];
let processingQueue = false;

function enqueueTranslation(text) {
  if (!text) return;
  // Assigned now, when the final speech result is decided — before it
  // even enters the queue — so its wire order is locked in regardless of
  // how long translation or queueing takes afterward.
  const gen = nextGen();
  // Kick the network request off right away instead of waiting for a turn
  // in the queue. If you speak several sentences quickly, their translate
  // calls now run concurrently over the network instead of strictly one
  // after another — that was pure serialized waiting with no accuracy
  // benefit. Results are still *applied* in the queue's original FIFO
  // order below, so text always lands on the page in the order you spoke
  // it, even if a later sentence's network reply happens to arrive first.
  const promise = translateWithRetry(text, sourceLangSelect.value, targetLangSelect.value);
  translationQueue.push({ gen, promise });
  processQueue();
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (translationQueue.length) {
    const { gen, promise } = translationQueue.shift();
    try {
      const translated = await promise;
      await appendTranslation(translated, gen);
    } catch (err) {
      setStatus("Translation failed — check your connection.");
    }
  }
  processingQueue = false;
}

// A hung (not erroring, just very slow) request would otherwise have no
// upper bound on how long it blocks — fetch has no built-in timeout. This
// caps a single attempt at 8s so a stuck request fails fast into a retry
// instead of stalling the whole queue behind it indefinitely.
const TRANSLATE_TIMEOUT_MS = 8000;

async function translateText(text, source, target) {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx` +
    `&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("Translation request failed");
    const data = await res.json();
    return data[0].map((chunk) => chunk[0]).join("");
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithRetry(text, source, target, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await translateText(text, source, target);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function appendTranslation(translated, gen) {
  interimGen++; // this final result supersedes any interim guess in flight
  clearTimeout(interimTimer);
  finalizedTranslation += (finalizedTranslation ? " " : "") + translated;
  renderTranslated("");
  if (isListening) setStatus("Listening…");

  if (autoTypeToggle.checked) {
    // Replace the live (interim) guess currently typed in the page with the
    // authoritative final translation, then lock it in so the next
    // sentence you speak is appended after it instead of overwriting it.
    const result = await sendLiveInsertToPage(translated + " ", gen);
    if (result.ok) {
      // Only commit if this insert actually landed — if it was dropped as
      // stale (a newer result already won), committing here would wipe
      // out liveState for text that's still legitimately in progress.
      if (result.applied !== false) {
        await commitLiveInsertion(gen);
      }
    } else if (!autoTypeWarned) {
      autoTypeWarned = true;
      setStatus("Couldn't auto-type here. Use Copy + Ctrl+V, or click into a text field on the page.");
    }
  }
}

/* ---------- Insert into page (frame-aware) ---------- */

async function getActiveTabAndFrame() {
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

async function sendInsertToPage(text, gen) {
  const { tabId, frameId } = await getActiveTabAndFrame();
  if (!tabId) return { ok: false, reason: "no-tab" };
  return sendToFrameWithFallback(tabId, frameId, { type: "insertText", text, gen });
}

// Types the still-changing interim translation in place, replacing the
// previous live guess rather than appending a new one each time.
async function sendLiveInsertToPage(text, gen) {
  const { tabId, frameId } = await getActiveTabAndFrame();
  if (!tabId) return { ok: false, reason: "no-tab" };
  return sendToFrameWithFallback(tabId, frameId, { type: "insertLiveText", text, gen });
}

// Sends to the frame we last saw the cursor in. If that frame is stale
// (e.g. the tab navigated since focus was last recorded, so the frameId no
// longer exists) the send throws — in that case we retry once against the
// page's top-level frame instead of just giving up.
async function sendToFrameWithFallback(tabId, frameId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
    return response || { ok: false, reason: "no-response" };
  } catch (err) {
    if (frameId === 0) return { ok: false, reason: "no-content-script" };
    try {
      const response = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      return response || { ok: false, reason: "no-response" };
    } catch (err2) {
      return { ok: false, reason: "no-content-script" };
    }
  }
}

// Locks in the currently-typed live text so the next phrase's live updates
// start fresh instead of deleting what's already been finalized.
async function commitLiveInsertion(gen) {
  try {
    const { tabId, frameId } = await getActiveTabAndFrame();
    if (!tabId) return;
    await chrome.tabs.sendMessage(tabId, { type: "commitLiveText", gen }, { frameId });
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

swapBtn.addEventListener("click", () => {
  const s = sourceLangSelect.value;
  const t = targetLangSelect.value;
  setSelectValue(sourceLangSelect, t);
  setSelectValue(targetLangSelect, s);
  saveSettings();
});

sourceLangSelect.addEventListener("change", saveSettings);
targetLangSelect.addEventListener("change", saveSettings);
autoTypeToggle.addEventListener("change", () => {
  autoTypeWarned = false;
  saveSettings();
});

speakBtn.addEventListener("click", () => {
  const text = translatedTextEl.textContent.trim();
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = targetLangSelect.selectedOptions[0].dataset.speech;
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
  finalTranscript = "";
  finalizedTranslation = "";
  interimGen++;
  clearTimeout(interimTimer);
  lastInterimSource = "";
  translationQueue.length = 0;
  originalTextEl.textContent = "";
  translatedTextEl.textContent = "";
  setStatus("Cleared.");
});

populateLanguages();
loadSettings();
updatePageHint();
