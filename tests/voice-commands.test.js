const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVoiceCommand, supportsVoiceCommands, isCommandPrefix } = require("../lib/voice-commands.js");

test("recognizes each command, ignoring case and punctuation", () => {
  assert.equal(parseVoiceCommand("Clear text.", "en-US"), "clearText");
  assert.equal(parseVoiceCommand("delete last word", "en"), "deleteLastWord");
  assert.equal(parseVoiceCommand("New line!", "en"), "newLine");
  assert.equal(parseVoiceCommand("newline", "en"), "newLine");
  assert.equal(parseVoiceCommand("  Stop   listening  ", "en"), "stopListening");
});

test("only matches when the whole phrase is the command", () => {
  assert.equal(parseVoiceCommand("please clear text for me", "en"), null);
  assert.equal(parseVoiceCommand("I said stop listening to the radio", "en"), null);
  assert.equal(parseVoiceCommand("clear", "en"), null);
  assert.equal(parseVoiceCommand("hello world", "en"), null);
  assert.equal(parseVoiceCommand("", "en"), null);
});

test("languages without a command table never trigger commands", () => {
  assert.equal(parseVoiceCommand("clear text", "ur-PK"), null);
  assert.equal(supportsVoiceCommands("ur"), false);
  assert.equal(supportsVoiceCommands("en-GB"), true);
});

test("isCommandPrefix flags interim guesses that may become a command", () => {
  assert.equal(isCommandPrefix("stop", "en"), true);
  assert.equal(isCommandPrefix("stop lis", "en"), true);
  assert.equal(isCommandPrefix("new", "en"), true);
  assert.equal(isCommandPrefix("hello there", "en"), false);
  assert.equal(isCommandPrefix("", "en"), false);
  assert.equal(isCommandPrefix("stop", "ur"), false);
});
