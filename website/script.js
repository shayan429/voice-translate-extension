const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

navLinks.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// --- Install flow -----------------------------------------------------
// EXTENSION_ID is the real Item ID assigned by the Chrome Web Store
// dashboard on upload (the Web Store rejects a manifest with a "key"
// field, so this is not self-chosen — it only applies once installed
// from the Store, not to a locally loaded unpacked copy).
const EXTENSION_ID = 'nbdmpdimfockdijnabkijncponkpadfc';

// The listing is submitted and pending review — this URL won't resolve
// publicly until Google approves it, but wiring it up now means nothing
// else needs to change once it goes live.
const CHROME_WEBSTORE_URL = 'https://chromewebstore.google.com/detail/nbdmpdimfockdijnabkijncponkpadfc';

function detectBrowser() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'chrome';
  return 'unsupported';
}

// Asks the extension itself whether it's installed, using the secure
// externally_connectable channel declared in manifest.json — no permissions
// are granted to the page, and the extension only replies to origins it
// explicitly allow-lists.
function pingExtension(timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!window.chrome?.runtime?.sendMessage) {
      resolve(false);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: 'ping' }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(!chrome.runtime.lastError && !!response?.installed);
      });
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
}

function openExtensionPanel() {
  if (!window.chrome?.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(EXTENSION_ID, { type: 'openPanel' }, () => void chrome.runtime.lastError);
  } catch (e) {
    /* extension not installed or messaging blocked — nothing to do */
  }
}

function initInstallFlow() {
  const installButtons = document.querySelectorAll('[data-install-btn]');
  const notes = document.querySelectorAll('[data-install-note]');
  const openButtons = document.querySelectorAll('[data-open-btn]');
  const devInstall = document.querySelector('[data-dev-install]');
  if (!installButtons.length) return;

  const browser = detectBrowser();

  function revealDevInstall(evt) {
    if (!devInstall) return;
    evt.preventDefault();
    devInstall.open = true;
    devInstall.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderNotInstalled() {
    installButtons.forEach((btn) => {
      btn.classList.remove('btn-installed', 'btn-disabled');
      btn.removeAttribute('aria-disabled');
      btn.removeEventListener('click', revealDevInstall);

      const compact = btn.hasAttribute('data-compact');

      if (browser === 'unsupported') {
        btn.textContent = compact ? 'Unsupported' : 'Browser not supported';
        btn.classList.add('btn-disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('href');
        return;
      }

      if (compact) {
        btn.textContent = browser === 'edge' ? 'Install (Edge)' : 'Install';
      } else {
        btn.textContent = browser === 'edge' ? 'Install for Edge' : 'Install Voice Translate';
      }

      if (CHROME_WEBSTORE_URL) {
        btn.setAttribute('href', CHROME_WEBSTORE_URL);
        btn.setAttribute('target', '_blank');
        btn.setAttribute('rel', 'noopener');
      } else {
        btn.setAttribute('href', '#install');
        btn.removeAttribute('target');
        btn.addEventListener('click', revealDevInstall);
      }
    });

    notes.forEach((note) => {
      if (browser === 'unsupported') {
        note.textContent = 'Voice Translate currently supports Chrome and Microsoft Edge (or other Chromium-based browsers).';
      } else if (!CHROME_WEBSTORE_URL) {
        note.textContent = 'Not on the Chrome Web Store yet — use Developer installation below for now.';
      } else {
        note.textContent = '';
      }
    });

    openButtons.forEach((btn) => {
      btn.hidden = true;
    });
  }

  function renderInstalled() {
    installButtons.forEach((btn) => {
      btn.textContent = btn.hasAttribute('data-compact') ? '✓ Installed' : '✓ Voice Translate Installed';
      btn.classList.add('btn-installed');
      btn.classList.remove('btn-disabled');
      btn.setAttribute('aria-disabled', 'true');
      btn.removeAttribute('href');
      btn.removeEventListener('click', revealDevInstall);
    });
    notes.forEach((note) => {
      note.textContent = '';
    });
    openButtons.forEach((btn) => {
      btn.hidden = false;
    });
  }

  renderNotInstalled();

  pingExtension().then((installed) => {
    if (installed) renderInstalled();
  });

  openButtons.forEach((btn) => {
    btn.addEventListener('click', (evt) => {
      evt.preventDefault();
      openExtensionPanel();
    });
  });
}

initInstallFlow();
