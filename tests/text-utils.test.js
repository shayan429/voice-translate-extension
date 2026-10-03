const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGlossary, applyGlossary, addPunctuation } = require("../lib/text-utils.js");

test("parseGlossary reads 'heard => correct' lines and skips junk", () => {
  const entries = parseGlossary("shayan => Shayan\nno arrow here\n => nothing\nempty =>\nkarachi -> Karachi\n  spaced   →   Spaced  ");
  assert.deepEqual(entries, [
    { from: "shayan", to: "Shayan" },
    { from: "karachi", to: "Karachi" },
    { from: "spaced", to: "Spaced" },
  ]);
});

test("parseGlossary tolerates empty and non-string input", () => {
  assert.deepEqual(parseGlossary(""), []);
  assert.deepEqual(parseGlossary(undefined), []);
  assert.deepEqual(parseGlossary(null), []);
});

test("applyGlossary replaces whole words only, case-insensitively", () => {
  const entries = [{ from: "ali", to: "Ali" }];
  assert.equal(applyGlossary("call ali now", entries), "call Ali now");
  assert.equal(applyGlossary("quality of ali's work", entries), "quality of Ali's work");
  assert.equal(applyGlossary("the quality is good", entries), "the quality is good");
  assert.equal(applyGlossary("ALI said hi", entries), "Ali said hi");
});

test("applyGlossary works for non-Latin scripts and special characters", () => {
  assert.equal(applyGlossary("میرا نام علی ہے", [{ from: "علی", to: "عَلی" }]), "میرا نام عَلی ہے");
  assert.equal(applyGlossary("price is c++ today", [{ from: "c++", to: "C++" }]), "price is C++ today");
});

test("applyGlossary leaves text alone with no entries", () => {
  assert.equal(applyGlossary("hello", []), "hello");
  assert.equal(applyGlossary("hello", null), "hello");
  assert.equal(applyGlossary("", [{ from: "a", to: "b" }]), "");
});

test("applyGlossary treats replacement text literally (no $ patterns)", () => {
  assert.equal(applyGlossary("cost x", [{ from: "x", to: "$&$1" }]), "cost $&$1");
});

test("addPunctuation adds a full stop, or a question mark for English questions", () => {
  assert.equal(addPunctuation("hello there", "en"), "hello there.");
  assert.equal(addPunctuation("how are you", "en-US"), "how are you?");
  assert.equal(addPunctuation("where is the station", "en"), "where is the station?");
});

test("addPunctuation never doubles existing punctuation", () => {
  assert.equal(addPunctuation("already done.", "en"), "already done.");
  assert.equal(addPunctuation("really?", "en"), "really?");
  assert.equal(addPunctuation("wow!", "en"), "wow!");
  assert.equal(addPunctuation("کیا حال ہے؟", "ur"), "کیا حال ہے؟");
});

test("addPunctuation uses the target language's own full stop", () => {
  assert.equal(addPunctuation("こんにちは", "ja"), "こんにちは。");
  assert.equal(addPunctuation("आप कैसे हैं", "hi"), "आप कैसे हैं।");
  assert.equal(addPunctuation("آپ کیسے ہیں", "ur"), "آپ کیسے ہیں۔");
  assert.equal(addPunctuation("bonjour", "fr"), "bonjour.");
});

test("addPunctuation does not guess question marks outside English", () => {
  assert.equal(addPunctuation("comment allez vous", "fr"), "comment allez vous.");
});

test("addPunctuation handles empty input", () => {
  assert.equal(addPunctuation("", "en"), "");
  assert.equal(addPunctuation("   ", "en"), "");
});
