(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TextUtils = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TERMINAL = /[.!?…。！？؟۔।]["')\]»”]*$/;
  const ENGLISH_QUESTION_START =
    /^(who|what|when|where|why|how|which|whose|whom|is|are|am|was|were|do|does|did|can|could|will|would|shall|should|may|might|have|has|had)\b/i;
  const FULL_STOP_BY_LANG = { ja: "。", zh: "。", hi: "।", ur: "۔" };

  function baseLang(lang) {
    return String(lang || "").toLowerCase().split("-")[0];
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // One entry per line: "heard => correct". Lines without an arrow, or with
  // an empty side, are ignored so a half-typed line never breaks dictation.
  function parseGlossary(raw) {
    const entries = [];
    for (const line of String(raw || "").split(/\r?\n/)) {
      const m = line.match(/^(.*?)\s*(?:=>|->|→)\s*(.*)$/);
      if (!m) continue;
      const from = m[1].trim();
      const to = m[2].trim();
      if (!from || !to) continue;
      entries.push({ from, to });
    }
    return entries;
  }

  // Replaces whole words only (so "ali" never matches inside "quality"),
  // case-insensitively, in any script.
  function applyGlossary(text, entries) {
    if (!text || !entries || !entries.length) return text;
    let out = text;
    for (const { from, to } of entries) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(from)}(?![\\p{L}\\p{N}_])`, "giu");
      out = out.replace(re, () => to);
    }
    return out;
  }

  // Best-effort ending punctuation for newly finished phrases. Question
  // marks are only guessed for English; other languages just get their
  // usual full stop.
  function addPunctuation(text, lang) {
    const trimmed = String(text || "").trim();
    if (!trimmed || TERMINAL.test(trimmed)) return trimmed;
    const base = baseLang(lang);
    if (base === "en" && ENGLISH_QUESTION_START.test(trimmed)) return trimmed + "?";
    return trimmed + (FULL_STOP_BY_LANG[base] || ".");
  }

  return { parseGlossary, applyGlossary, addPunctuation, baseLang };
});
