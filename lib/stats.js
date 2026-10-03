(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StatsLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Counts only. Nothing spoken or translated is ever recorded here, and
  // nothing leaves the browser: the data lives in chrome.storage.local.
  const KEY = "stats";

  function emptyStats() {
    return { since: Date.now(), counts: {} };
  }

  // `storage` needs get(key) -> Promise<object> and set(object) -> Promise.
  function createStats(storage, flushDelayMs = 400) {
    let data = null;
    let timer = null;

    async function load() {
      if (data) return data;
      try {
        const stored = await storage.get(KEY);
        data = stored && stored[KEY] && stored[KEY].counts ? stored[KEY] : emptyStats();
      } catch (err) {
        data = emptyStats();
      }
      return data;
    }

    function scheduleFlush() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        storage.set({ [KEY]: data }).catch(() => {});
      }, flushDelayMs);
    }

    async function inc(name, amount = 1) {
      const d = await load();
      d.counts[name] = (d.counts[name] || 0) + amount;
      scheduleFlush();
    }

    async function get(name) {
      const d = await load();
      return d.counts[name] || 0;
    }

    async function summary() {
      const d = await load();
      return { since: d.since, counts: { ...d.counts } };
    }

    async function reset() {
      data = emptyStats();
      clearTimeout(timer);
      await storage.set({ [KEY]: data }).catch(() => {});
    }

    return { inc, get, summary, reset };
  }

  return { createStats };
});
