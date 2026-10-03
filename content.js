(function () {
  let lastEditable = null;
  // Set when the panel asks to pin the field that was active as dictation
  // started: { el, token }. Inserts that carry the matching token go to this
  // exact field even if focus has since moved (e.g. into the side panel).
  let lock = null;

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT" && /^(text|search|email|url|tel|number)$/i.test(el.type || "text")) {
      return true;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  // Password and payment fields must never receive dictated text, no matter
  // how they're marked up: the field type, the standard autofill hints, or
  // the usual card/bank field names.
  const PROTECTED_AUTOCOMPLETE = /(^|\s)(cc-[a-z-]+|current-password|new-password|one-time-code)(\s|$)/i;
  const PROTECTED_NAME =
    /(card[-_ ]?num|cardnumber|cc[-_ ]?(num|number|exp|csc|cvc|cvv)|cvv|cvc|security[-_ ]?code|iban|routing[-_ ]?num|ssn|social[-_ ]?security|passw(or)?d|passcode)/i;

  function isProtectedField(el) {
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return false;
    if (el.tagName === "INPUT" && String(el.type || "").toLowerCase() === "password") return true;
    if (PROTECTED_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "")) return true;
    return PROTECTED_NAME.test(`${el.name || ""} ${el.id || ""}`);
  }

  // The focused element, looking inside open shadow roots — modern web apps
  // often wrap their real <input> in custom elements, which makes
  // document.activeElement report the wrapper instead.
  function deepActiveElement() {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  document.addEventListener(
    "focusin",
    (e) => {
      // composedPath()[0] is the real target even inside an open shadow
      // tree, where e.target would be retargeted to the outer host.
      const target = typeof e.composedPath === "function" ? e.composedPath()[0] : e.target;
      // A protected field is remembered too, so dictation aimed at it is
      // refused (with an explanation) instead of silently landing in
      // whichever field happened to be focused before.
      if (isEditable(target) || isProtectedField(target)) {
        lastEditable = target;
        // Let the background know this frame currently holds the cursor,
        // so text can be routed here even if this is a nested iframe
        // (common for embedded editors, and for the hidden input-capture
        // element some rich text apps like Google Docs use).
        chrome.runtime.sendMessage({ type: "editableFocused" }).catch(() => {});
      }
    },
    true
  );

  // React (and most modern frameworks) override the `value` setter on the
  // element *instance* to track changes. Assigning el.value = x directly
  // hits that override and gets silently reverted on the next render — the
  // field looks like nothing happened. Going through the real setter on the
  // prototype bypasses that override so the framework sees a genuine change.
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fireInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sameText(a, b) {
    return a.replace(/ /g, " ") === b.replace(/ /g, " ");
  }

  // Tracks the trailing chunk of text we typed that's still "in progress"
  // (an interim, not-yet-final translation) so the next live update can
  // delete just that chunk and retype it, instead of appending duplicates.
  // { el, length, text, start?, mode: "end" | "cursor", sid }
  let liveState = null;

  // Every phrase this script finished typing, newest last, so the most
  // recent one can be undone without touching anything typed by hand.
  const MAX_HISTORY = 50;
  const history = [];

  function pushHistory(entry) {
    if (!entry.text || !entry.text.trim()) return;
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
  }

  // Phrase ids already locked in, so a message delivered twice (slow page,
  // retried request) can never type the same phrase twice.
  const committedPids = new Set();
  function rememberPid(pid) {
    if (!pid) return;
    committedPids.add(pid);
    if (committedPids.size > 200) committedPids.delete(committedPids.values().next().value);
  }

  // Selects backwards over `text` ending at the caret, and reports whether
  // the selection now matches it exactly. Used to find (and replace) the
  // chunk we typed last time without trusting the caret to be unmoved.
  function extendBackwardOver(sel, text) {
    if (!sel.isCollapsed) return sameText(sel.toString(), text);
    for (let i = 0; i < text.length + 2 && sel.toString().length < text.length; i++) {
      sel.modify("extend", "backward", "character");
    }
    return sameText(sel.toString(), text);
  }

  function replaceLive(el, text, mode, sid) {
    if (mode === "cursor") return replaceLiveAtCursor(el, text, sid);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.focus();
      // Always anchor to the true end of the current value, not
      // el.selectionEnd — sites with their own autocomplete/predictions
      // (Google search, etc.) move the cursor and rewrite the value on
      // their own, so trusting selectionEnd drifts out of sync with what
      // we actually typed and leaves duplicated leftovers behind.
      const end = el.value.length;
      const liveLen = liveState && liveState.el === el ? liveState.length : 0;
      const start = Math.max(0, end - liveLen);
      const newValue = el.value.slice(0, start) + text + el.value.slice(end);
      setNativeValue(el, newValue);
      const pos = start + text.length;
      el.selectionStart = el.selectionEnd = pos;
      fireInputEvents(el);
      liveState = { el, length: text.length, text, start, mode: "end", sid };
      return true;
    }
    if (el.isContentEditable) {
      el.focus();
      const sel = window.getSelection();
      if (!sel) return false;
      // Always collapse to the true end of this element's content first,
      // rather than trusting whatever selection is currently sitting there
      // — the same drift problem as above can happen in rich editors too.
      const endRange = document.createRange();
      endRange.selectNodeContents(el);
      endRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(endRange);
      const liveLen = liveState && liveState.el === el ? liveState.length : 0;
      // Extend the (collapsed) selection backward over the chunk we typed
      // last time, so the upcoming insertText call replaces it in place
      // instead of appending after it.
      for (let i = 0; i < liveLen && sel.rangeCount; i++) {
        sel.modify("extend", "backward", "character");
      }
      typeIntoSelection(sel, text);
      liveState = { el, length: text.length, text, mode: "end", sid };
      return true;
    }
    return false;
  }

  function typeIntoSelection(sel, text) {
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch (err) {
      inserted = false;
    }
    if (!inserted) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // Opt-in "insert at cursor" mode: types where the caret is (replacing any
  // selected text) instead of always at the end, and keeps updating that
  // same spot while the phrase is still being refined.
  function replaceLiveAtCursor(el, text, sid) {
    const prev = liveState && liveState.el === el && liveState.mode === "cursor" ? liveState : null;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.focus();
      let start;
      let end;
      if (prev && el.value.slice(prev.start, prev.start + prev.length) === prev.text) {
        start = prev.start;
        end = prev.start + prev.length;
      } else {
        start = el.selectionStart ?? el.value.length;
        end = el.selectionEnd ?? start;
      }
      setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end));
      el.selectionStart = el.selectionEnd = start + text.length;
      fireInputEvents(el);
      liveState = { el, mode: "cursor", start, length: text.length, text, sid };
      return true;
    }
    if (el.isContentEditable) {
      el.focus();
      const sel = window.getSelection();
      if (!sel) return false;
      if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      if (prev && !extendBackwardOver(sel, prev.text)) {
        // The caret moved since last time, so the previous chunk is final
        // text now — start a fresh insertion at the caret instead.
        sel.collapseToEnd();
      }
      typeIntoSelection(sel, text);
      liveState = { el, mode: "cursor", length: text.length, text, sid };
      return true;
    }
    return false;
  }

  // Removes the in-progress chunk from the page (used when a result is
  // cancelled or turned out to be a voice command). Only deletes if the
  // chunk is verifiably still there, so it can't eat anything else.
  function discardLive(el) {
    if (!liveState || liveState.el !== el) return false;
    const state = liveState;
    liveState = null;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = state.mode === "cursor" ? state.start : Math.max(0, el.value.length - state.length);
      if (el.value.slice(start, start + state.length) !== state.text) return false;
      el.focus();
      setNativeValue(el, el.value.slice(0, start) + el.value.slice(start + state.length));
      el.selectionStart = el.selectionEnd = start;
      fireInputEvents(el);
      return true;
    }
    if (el.isContentEditable) {
      el.focus();
      const sel = window.getSelection();
      if (!sel) return false;
      if (state.mode === "end") {
        const endRange = document.createRange();
        endRange.selectNodeContents(el);
        endRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(endRange);
      }
      if (!extendBackwardOver(sel, state.text)) {
        sel.collapseToEnd();
        return false;
      }
      let done = false;
      try {
        done = document.execCommand("delete");
      } catch (err) {
        done = false;
      }
      if (!done) sel.deleteFromDocument();
      return true;
    }
    return false;
  }

  function commitLive(el, record = true, pid) {
    if (liveState && liveState.el === el) {
      if (record) {
        pushHistory({ el, text: liveState.text, start: liveState.start, sid: liveState.sid });
      }
      liveState = null;
    }
    rememberPid(pid);
  }

  // Guards against out-of-order delivery: the side panel assigns each
  // insert a generation number at the moment the underlying speech result
  // is *decided* (before any network/translate delay), so whichever
  // message reaches us with the highest number is always the most recent
  // one, regardless of which network reply actually lands first. Keyed
  // per-element (not globally) via WeakMap so it never leaks and never
  // needs manual cleanup as elements come and go.
  const lastAppliedGen = new WeakMap();

  function acceptGen(el, gen) {
    if (gen === undefined || gen === null) return true; // no ordering info supplied — always apply
    const last = lastAppliedGen.get(el);
    if (last !== undefined && gen < last) return false; // a newer result already landed — drop this stale one
    lastAppliedGen.set(el, gen);
    return true;
  }

  function insertInto(el, text, sid) {
    // Manual "Insert into page" appends a fixed block; any prior "live"
    // in-progress chunk is no longer at the end after this, so forget it —
    // otherwise the next live update would delete the wrong text.
    commitLive(el, false);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.focus();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + text + el.value.slice(end);
      setNativeValue(el, newValue);
      const pos = start + text.length;
      el.selectionStart = el.selectionEnd = pos;
      fireInputEvents(el);
      pushHistory({ el, text, start, sid });
      return true;
    }
    if (el.isContentEditable) {
      el.focus();
      const sel = window.getSelection();
      if (sel && (!sel.rangeCount || !el.contains(sel.anchorNode))) {
        // Make sure we have a cursor inside this element before inserting,
        // otherwise execCommand can silently no-op or insert elsewhere.
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      // Most rich-text chat boxes (WhatsApp Web, Messenger, Discord, Slack,
      // X, Gmail, etc.) run on editor frameworks that rebuild the DOM from
      // their own internal state. Manually splicing a text node in bypasses
      // that state, so it gets wiped on the framework's next render.
      // execCommand performs a real native text insertion that these
      // frameworks are built to observe, so it's the one method that
      // reliably survives their re-render.
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch (err) {
        inserted = false;
      }
      if (!inserted) {
        // Fallback for the rare case execCommand is unavailable/blocked.
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: text, inputType: "insertText" }));
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      }
      pushHistory({ el, text, sid });
      return true;
    }
    return false;
  }

  /* ---------- Undo / edit helpers ---------- */

  function findTextRange(el, text) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let found = null;
    let node;
    // Keep the *last* match in the field: the phrase being undone is the
    // newest text, so an identical earlier phrase is never the one removed.
    while ((node = walker.nextNode())) {
      const i = node.data.lastIndexOf(text);
      if (i >= 0) found = { node, i };
    }
    if (!found) return null;
    const range = document.createRange();
    range.setStart(found.node, found.i);
    range.setEnd(found.node, found.i + text.length);
    return range;
  }

  // Removes `text` from the field only if it's still there verbatim — if the
  // person has edited it since, nothing is touched.
  function removeTextFromField(el, text, startHint) {
    if (!text || !el.isConnected) return false;
    const trimmed = text.replace(/\s+$/, "");
    // Rich-text editors often turn a space into a non-breaking space (a
    // trailing one especially), so try the exact text and its nbsp forms
    // *before* the trimmed ones — otherwise undo would leave the space behind.
    const variants = [
      text,
      text.replace(/ $/, " "),
      text.replace(/ /g, " "),
      trimmed,
      trimmed.replace(/ /g, " "),
    ].filter((v, i, all) => v && all.indexOf(v) === i);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const value = el.value;
      let idx = -1;
      let used = text;
      if (startHint !== undefined && startHint !== null) {
        for (const v of variants) {
          if (value.slice(startHint, startHint + v.length) === v) {
            idx = startHint;
            used = v;
            break;
          }
        }
      }
      if (idx < 0) {
        for (const v of variants) {
          const i = value.lastIndexOf(v);
          if (i >= 0) {
            idx = i;
            used = v;
            break;
          }
        }
      }
      if (idx < 0) return false;
      el.focus();
      setNativeValue(el, value.slice(0, idx) + value.slice(idx + used.length));
      el.selectionStart = el.selectionEnd = idx;
      fireInputEvents(el);
      return true;
    }
    if (el.isContentEditable) {
      for (const v of variants) {
        const range = findTextRange(el, v);
        if (!range) continue;
        el.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        let done = false;
        try {
          done = document.execCommand("delete");
        } catch (err) {
          done = false;
        }
        if (!done) {
          range.deleteContents();
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
        }
        return true;
      }
    }
    return false;
  }

  function undoLast() {
    // A pending live chunk is not "committed" history yet; if there is one
    // it's the newest text, so undo that first.
    if (liveState && liveState.el.isConnected && discardLive(liveState.el)) {
      return { ok: true, removed: true };
    }
    const entry = history.pop();
    if (!entry) return { ok: false, reason: "nothing-to-undo" };
    if (!entry.el.isConnected) return { ok: false, reason: "field-gone" };
    const removed = removeTextFromField(entry.el, entry.text, entry.start);
    return removed ? { ok: true, removed: true } : { ok: false, reason: "text-changed" };
  }

  // "Clear text" voice command: removes what this dictation session typed,
  // newest first, stopping at the first phrase from an older session.
  function undoAll(sid) {
    let count = 0;
    if (liveState && liveState.el.isConnected && (sid === undefined || liveState.sid === sid) && discardLive(liveState.el)) {
      count++;
    }
    while (history.length) {
      const entry = history[history.length - 1];
      if (sid !== undefined && entry.sid !== sid) break;
      history.pop();
      if (entry.el.isConnected && removeTextFromField(entry.el, entry.text, entry.start)) count++;
    }
    return { ok: true, count };
  }

  // "Delete last word" voice command, limited to the newest phrase this
  // script typed so it can never reach into text written by hand.
  function deleteLastWord() {
    const entry = history[history.length - 1];
    if (!entry || !entry.el.isConnected) return { ok: false, reason: "nothing-to-undo" };
    const trimmed = entry.text.replace(/\s+$/, "");
    const idx = trimmed.search(/\S+$/);
    if (idx < 0) return { ok: false, reason: "nothing-to-undo" };
    const tail = entry.text.slice(idx);
    const tailStart = entry.start !== undefined && entry.start !== null ? entry.start + idx : undefined;
    if (!removeTextFromField(entry.el, tail, tailStart)) return { ok: false, reason: "text-changed" };
    entry.text = entry.text.slice(0, idx);
    if (!entry.text.trim()) history.pop();
    return { ok: true };
  }

  function insertNewLine(el) {
    if (el.tagName === "TEXTAREA") return insertInto(el, "\n");
    if (el.isContentEditable) {
      el.focus();
      try {
        return document.execCommand("insertLineBreak");
      } catch (err) {
        return false;
      }
    }
    return false; // single-line inputs have no line break to insert
  }

  // Optional "press Enter" after dictation. Synthetic key events can't
  // trigger a browser's native form submit, so after the key events (which
  // most search boxes and chat inputs listen for) a plain form submit is
  // attempted for inputs inside a <form> if nothing handled the Enter key.
  function submitEnter(el) {
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    el.focus();
    const notHandled = el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    if (notHandled && el.tagName === "INPUT" && el.form) {
      try {
        el.form.requestSubmit();
      } catch (err) {
        /* form can't be submitted programmatically — the key events were the best we could do */
      }
    }
    return true;
  }

  /* ---------- Target resolution ---------- */

  function resolveTarget(message) {
    if (message && message.lockToken && lock && lock.token === message.lockToken && lock.el.isConnected) {
      return lock.el;
    }
    if (lastEditable && lastEditable.isConnected) return lastEditable;
    return deepActiveElement();
  }

  // Resolves the field for a message, or answers it right away if there is
  // nothing safe to type into. Returns null when it already responded.
  function targetOrRespond(message, sendResponse) {
    const target = resolveTarget(message);
    if (target && isProtectedField(target)) {
      sendResponse({ ok: false, applied: false, reason: "protected" });
      return null;
    }
    if (!isEditable(target)) {
      sendResponse({ ok: false, applied: false, reason: "no-target" });
      return null;
    }
    return target;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message?.type;
    if (type === "insertText") {
      const target = targetOrRespond(message, sendResponse);
      if (target) {
        const applied = acceptGen(target, message.gen);
        // A stale, superseded insert isn't a real failure — a newer one
        // already won, so report ok so the panel doesn't show a false
        // "couldn't auto-type here" warning over a race it already handled.
        const ok = applied ? insertInto(target, message.text, message.sid) : true;
        sendResponse({ ok, applied });
      }
    } else if (type === "insertLiveText") {
      if (message.pid && committedPids.has(message.pid)) {
        // Already typed and locked in — a repeat delivery must not type it again.
        sendResponse({ ok: true, applied: false, duplicate: true });
        return true;
      }
      const target = targetOrRespond(message, sendResponse);
      if (target) {
        const applied = acceptGen(target, message.gen);
        const ok = applied ? replaceLive(target, message.text, message.mode, message.sid) : true;
        sendResponse({ ok, applied });
      }
    } else if (type === "commitLiveText") {
      const target = resolveTarget(message);
      // Only let a commit through if it's at least as new as the last
      // thing actually applied — a stale commit trailing behind a newer
      // insert must not erase liveState for text that hasn't landed yet.
      if (target && acceptGen(target, message.gen)) {
        commitLive(target, true, message.pid);
      }
      sendResponse({ ok: true });
    } else if (type === "discardLiveText") {
      const target = resolveTarget(message);
      sendResponse({ ok: true, removed: target ? discardLive(target) : false });
    } else if (type === "lockTarget") {
      const target = lastEditable && lastEditable.isConnected ? lastEditable : deepActiveElement();
      if (isEditable(target) && !isProtectedField(target)) {
        lock = { el: target, token: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
        sendResponse({ ok: true, token: lock.token });
      } else {
        lock = null;
        sendResponse({ ok: false, reason: isProtectedField(target) ? "protected" : "no-target" });
      }
    } else if (type === "unlockTarget") {
      lock = null;
      sendResponse({ ok: true });
    } else if (type === "undoLast") {
      sendResponse(undoLast());
    } else if (type === "undoAll") {
      sendResponse(undoAll(message.sid));
    } else if (type === "deleteLastWord") {
      sendResponse(deleteLastWord());
    } else if (type === "newLine") {
      const target = targetOrRespond(message, sendResponse);
      if (target) sendResponse({ ok: insertNewLine(target) });
    } else if (type === "submitEnter") {
      const target = targetOrRespond(message, sendResponse);
      if (target) sendResponse({ ok: submitEnter(target) });
    } else if (type === "ping") {
      const target = resolveTarget(message);
      sendResponse({ hasTarget: isEditable(target) && !isProtectedField(target) });
    }
    return true;
  });

  /* ---------- Optional push-to-talk key ---------- */

  // Chrome's own extension shortcuts only report a key *press*, never the
  // release, so hold-to-talk has to listen for the key here in the page. It
  // only works while this page has focus, and only when the user turned it on.
  let ptt = { enabled: false, key: "F9" };
  let pttHeld = false;

  function applyPttPrefs(prefs) {
    ptt = { enabled: !!(prefs && prefs.pushToTalk), key: (prefs && prefs.pttKey) || "F9" };
    if (!ptt.enabled && pttHeld) releasePtt();
  }

  function releasePtt() {
    if (!pttHeld) return;
    pttHeld = false;
    chrome.runtime.sendMessage({ type: "ptt", down: false }).catch(() => {});
  }

  try {
    chrome.storage.local.get("prefs").then((data) => applyPttPrefs(data && data.prefs)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.prefs) applyPttPrefs(changes.prefs.newValue);
    });
  } catch (err) {
    /* storage unavailable — push-to-talk simply stays off */
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!ptt.enabled || e.key !== ptt.key) return;
      e.preventDefault();
      if (e.repeat || pttHeld) return;
      pttHeld = true;
      chrome.runtime.sendMessage({ type: "ptt", down: true }).catch(() => {});
    },
    true
  );
  document.addEventListener(
    "keyup",
    (e) => {
      if (!ptt.enabled || e.key !== ptt.key) return;
      e.preventDefault();
      releasePtt();
    },
    true
  );
  // Losing focus while the key is down would otherwise leave the mic open.
  window.addEventListener("blur", releasePtt);
})();
