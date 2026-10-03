const test = require("node:test");
const assert = require("node:assert/strict");
const { createStats } = require("../lib/stats.js");

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => Object.assign(store, obj),
  };
}

test("counts increments and persists after the flush delay", async () => {
  const storage = fakeStorage();
  const stats = createStats(storage, 5);
  await stats.inc("translationsOk");
  await stats.inc("translationsOk");
  await stats.inc("translationsFailed");
  assert.equal(await stats.get("translationsOk"), 2);
  assert.equal(await stats.get("translationsFailed"), 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(storage.store.stats.counts.translationsOk, 2);
});

test("only counters are stored — no text of any kind", async () => {
  const storage = fakeStorage();
  const stats = createStats(storage, 5);
  await stats.inc("translationsOk");
  await new Promise((r) => setTimeout(r, 30));
  const json = JSON.stringify(storage.store.stats);
  assert.deepEqual(Object.keys(storage.store.stats).sort(), ["counts", "since"]);
  assert.ok(Object.values(storage.store.stats.counts).every((n) => typeof n === "number"), json);
});

test("loads previously saved counts", async () => {
  const storage = fakeStorage({ stats: { since: 1, counts: { translationsOk: 7 } } });
  const stats = createStats(storage, 5);
  await stats.inc("translationsOk");
  assert.equal(await stats.get("translationsOk"), 8);
});

test("reset clears counts", async () => {
  const storage = fakeStorage();
  const stats = createStats(storage, 5);
  await stats.inc("translationsOk", 3);
  await stats.reset();
  assert.equal(await stats.get("translationsOk"), 0);
  assert.deepEqual(storage.store.stats.counts, {});
});

test("survives a storage that throws", async () => {
  const stats = createStats({ get: async () => { throw new Error("nope"); }, set: async () => { throw new Error("nope"); } }, 5);
  await stats.inc("translationsOk");
  assert.equal(await stats.get("translationsOk"), 1);
  await new Promise((r) => setTimeout(r, 30));
});
