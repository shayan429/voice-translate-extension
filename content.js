(function () {
  let lastEditable = null;

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT" && /^(text|search|email|url|tel|number)$/i.test(el.type || "text")) {
      return true;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  document.addEventListener(
    "focusin",
    (e) => {
      if (isEditable(e.target)) {
        lastEditable = e.target;
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

  // Tracks the trailing chunk of text we typed that's still "in progress"
  // (an interim, not-yet-final translation) so the next live update can
  // delete just that chunk and retype it, instead of appending duplicates.
  let liveState = null; // { el, length }

  function replaceLive(el, text) {
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
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      liveState = { el, length: text.length };
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
      liveState = { el, length: text.length };
      return true;
    }
    return false;
  }

  function commitLive(el) {
    if (liveState && liveState.el === el) liveState = null;
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

  function insertInto(el, text) {
    // Manual "Insert into page" appends a fixed block; any prior "live"
    // in-progress chunk is no longer at the end after this, so forget it —
    // otherwise the next live update would delete the wrong text.
    commitLive(el);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.focus();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + text + el.value.slice(end);
      setNativeValue(el, newValue);
      const pos = start + text.length;
      el.selectionStart = el.selectionEnd = pos;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
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
      return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "insertText") {
      const target = lastEditable && document.contains(lastEditable) ? lastEditable : document.activeElement;
      if (isEditable(target)) {
        const applied = acceptGen(target, message.gen);
        // A stale, superseded insert isn't a real failure — a newer one
        // already won, so report ok so the panel doesn't show a false
        // "couldn't auto-type here" warning over a race it already handled.
        const ok = applied ? insertInto(target, message.text) : true;
        sendResponse({ ok, applied });
      } else {
        sendResponse({ ok: false, applied: false, reason: "no-target" });
      }
    }
    if (message?.type === "insertLiveText") {
      const target = lastEditable && document.contains(lastEditable) ? lastEditable : document.activeElement;
      if (isEditable(target)) {
        const applied = acceptGen(target, message.gen);
        const ok = applied ? replaceLive(target, message.text) : true;
        sendResponse({ ok, applied });
      } else {
        sendResponse({ ok: false, applied: false, reason: "no-target" });
      }
    }
    if (message?.type === "commitLiveText") {
      const target = lastEditable && document.contains(lastEditable) ? lastEditable : document.activeElement;
      // Only let a commit through if it's at least as new as the last
      // thing actually applied — a stale commit trailing behind a newer
      // insert must not erase liveState for text that hasn't landed yet.
      if (acceptGen(target, message.gen)) {
        commitLive(target);
      }
      sendResponse({ ok: true });
    }
    if (message?.type === "ping") {
      const target = lastEditable && document.contains(lastEditable) ? lastEditable : document.activeElement;
      sendResponse({ hasTarget: isEditable(target) });
    }
    return true;
  });
})();
