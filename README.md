# Voice Translate & Dictate

Speak in one language, see it transcribed live, get an instant translation, hear it spoken back, and have it typed automatically into whatever text field you're using — including fields inside iframes.

Defaults to Urdu → English; 39 languages are built in.

## Install (unpacked)

1. Unzip this folder somewhere permanent (don't delete it later — Chrome loads the extension from these files).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `voice-translate-extension` folder.
5. Click the extension icon in your toolbar — it opens a side panel.

If you're updating from an earlier version, unzip over the old folder (or delete it and unzip fresh), then click the reload icon on the extension's card in `chrome://extensions`.

## How to use

1. Pick the language you'll **speak in** and the language to **translate to**.
2. Click into the text field on the webpage where you want the translation to land.
3. Tap the mic and start talking.
4. Your speech appears under "You said" (gray italic = still being recognized). The translation happens in the background and, if "Auto-type" is on, gets typed straight into that field as you go — it isn't shown in the panel itself.
5. **Speak** reads the translation aloud. **Copy** copies it. **Insert into page** types the full translation on demand. **Clear** resets both boxes.
6. ⇄ swaps the two languages. Your choices are remembered next time you open the panel.

## About the "Read and change all your data on all websites" permission

Starting with this version, the extension asks for access to all sites (not just the translation API) because it now automatically re-injects itself into every tab you already have open whenever it's installed or reloaded — so you no longer need to manually refresh each tab after an update. This is the standard permission Chrome requires for that; the extension only actually uses it to place its own script on the page, the same script described in "How it works" below.

## About the Chrome New Tab Page and other internal pages

Pages like the New Tab Page, `chrome://settings`, and the Chrome Web Store run on special internal Chrome addresses (`chrome://...`), not real websites. **No browser extension — including this one — is allowed to type into these pages.** This is a Chrome platform restriction that applies to every extension equally; it isn't something an extension can work around. If you're testing and it doesn't type in, check the address bar first — if it doesn't show a real `https://` URL, that's why. Open an actual website (Google Search results page, Gmail, WhatsApp Web, etc.) instead.

## About Google Docs, Sheets, and Slides

These don't use a normal text field — Google draws the page itself with its own rendering engine and captures typing through a hidden internal input that isn't part of the visible document. Because of that, **no browser extension can reliably type into them through standard DOM methods**, including this one. This version tries harder (see below), and may work for short insertions, but it isn't guaranteed and could stop working entirely if Google changes its internals — that's true of any extension using this approach, not a limitation specific to this one.

When you're on one of these sites, the panel shows a heads-up, and if a direct type attempt fails, **the translation is copied to your clipboard automatically** — just paste with Ctrl+V (Cmd+V on Mac). That always works.

If you want guaranteed, first-class Google Docs support, the real fix is connecting to Google's official Docs API with your own Google account (OAuth). That's a separate, bigger feature — happy to build it if you want it.

## What's new in 1.3.0

Everything below is off by default unless noted, so the extension behaves as before until you turn something on (open **⚙ Settings** in the side panel).

- **39 languages** (including Tamil and Gujarati) and a **Conversation mode** that swaps languages after each turn.
- **Keyboard shortcuts** (change them at `chrome://extensions/shortcuts`): Alt+Shift+V start/stop listening, Alt+Shift+S start/stop and press Enter, plus undo last, repeat last and cancel.
- **Push-to-talk:** a Hold to talk button or a key you choose (F9, Pause, Right Ctrl and more) listens only while held.
- **Safer typing:** refuses password/payment fields; optionally type at the cursor, stick to one field, pause if you switch tabs, or press Enter afterwards; undo removes only what was typed; duplicate phrases are never typed twice.
- **More reliable:** cancel in-flight translation (Esc), offline queue, one-click retry, one mic session at a time, mic permission pre-check, clean-up when the panel closes.
- **Extras:** voice commands (English), auto punctuation, custom word list, silence timeout, noise filter, sounds, speaking speed, saved language pairs, local counts-only stats, transcript download, and a red toolbar icon while listening.

## What's new in 1.3.2

- Push-to-talk: pressing again right after letting go no longer cuts off the last phrase of the previous turn (the panel now waits for Chrome to finish it), and a failed connection to Google's speech service while you're online now explains the likely causes (firewall, VPN, proxy, antivirus).

## What's new in 1.3.1

- **Offline / on-device mode.** With no internet the extension now switches to Chrome's on-device speech recognition and translation, if the language has them and the packs are downloaded (Settings → Offline → "Download offline packs", needs internet once). Chrome supports this for some languages only (e.g. English, Hindi, Spanish, Arabic); **Urdu is not supported on-device by Chrome**, so Urdu needs a connection and the panel says so instead of failing silently.
- If Google's online speech service can't be reached, it falls back to on-device speech when available, and otherwise stops with a clear message instead of retrying forever (which is what made push-to-talk switch off by itself when offline).

## What was new in 1.2

- **Works across iframes.** A lot of real editors (embedded comment boxes, chat widgets, form builders) live inside a nested iframe, not the page's main frame. Each frame now reports when one of its fields is focused, so typing gets routed to the exact frame holding the cursor.
- **Never leaves you empty-handed.** If direct typing fails for any reason, the translation is copied to your clipboard automatically with a clear "paste with Ctrl+V" message.
- **More reliable listening.** Chrome's speech engine stops on its own after a pause — the extension restarts it automatically with a short, increasing delay, and rebuilds the recognizer if a restart fails.
- **Correct ordering.** Speech chunks are translated one at a time in a queue, so fast talking can't cause pieces to land out of order, with automatic retry (up to 3 times) on connection hiccups.

## How it works

- **Dictation** uses Chrome's built-in Web Speech API (`SpeechRecognition`) — the same engine behind Chrome's native dictation.
- **Translation** uses a free, unofficial Google Translate endpoint (no API key needed). Fine for personal use, but unauthenticated and could change or rate-limit without notice.
- **Text-to-speech** uses your browser's built-in voices (`speechSynthesis`).
- **Typing into pages** is done by a content script (`content.js`) running in every frame of the page, coordinated by the background script so the right frame is targeted.

## Notes & limitations

- Requires Chrome (or another Chromium browser) and an internet connection.
- The first time you use the mic, Chrome will ask for microphone permission — allow it.
- Not every language is recognized equally well; less common languages may be less accurate.
- Auto-typing won't reach `chrome://` pages, the Chrome Web Store, or canvas-based editors in general (Docs/Sheets/Slides being the most common example) — the clipboard fallback covers these.
- For heavy or production use, replace `translateText()` in `sidepanel.js` with Google Cloud Translation API or another paid provider with an official key and controlled rate limits.

## Adding more languages

Edit the `LANGUAGES` array at the top of `sidepanel.js`. Each entry needs:
- `name` — shown in the dropdown
- `code` — the Google Translate language code
- `speech` — the BCP-47 speech recognition code (e.g. `en-US`, `ur-PK`)
