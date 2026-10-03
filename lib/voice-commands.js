(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceCommands = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Commands are matched against the *recognized* (source-language) speech,
  // and only when the whole phrase is the command — so a sentence that merely
  // contains "clear text" is never treated as one. English only for now;
  // add another language by adding a table here.
  const COMMANDS = {
    en: {
      "clear text": "clearText",
      "clear all text": "clearText",
      "delete last word": "deleteLastWord",
      "delete the last word": "deleteLastWord",
      "new line": "newLine",
      "newline": "newLine",
      "stop listening": "stopListening",
      "stop dictation": "stopListening",
    },
  };

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[.,!?;:"“”'’]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tableFor(lang) {
    return COMMANDS[String(lang || "").toLowerCase().split("-")[0]] || null;
  }

  function supportsVoiceCommands(lang) {
    return !!tableFor(lang);
  }

  function parseVoiceCommand(transcript, lang) {
    const table = tableFor(lang);
    if (!table) return null;
    return table[normalize(transcript)] || null;
  }

  // True while an interim guess could still turn into a command ("stop",
  // "stop lis"…), so the panel doesn't type it into the page first.
  function isCommandPrefix(text, lang) {
    const table = tableFor(lang);
    if (!table) return false;
    const n = normalize(text);
    if (!n) return false;
    return Object.keys(table).some((phrase) => phrase.startsWith(n));
  }

  return { parseVoiceCommand, supportsVoiceCommands, isCommandPrefix, normalize };
});
