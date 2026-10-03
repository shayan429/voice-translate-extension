(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SoundsLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Short synthesized tones — no audio files. Four distinct cues:
  // listening started, translation finished, text inserted, error.
  const CUES = {
    listening: [{ f: 523, d: 0.09 }, { f: 784, d: 0.12 }],
    translated: [{ f: 659, d: 0.09 }],
    inserted: [{ f: 880, d: 0.06 }],
    error: [{ f: 330, d: 0.12 }, { f: 262, d: 0.18 }],
  };

  // `getPrefs()` returns { soundsOn, soundVolume } at play time, so a change
  // in settings takes effect immediately without recreating anything.
  function createSounds(getPrefs, AudioCtor) {
    let ctx = null;

    function context() {
      if (ctx) return ctx;
      const Ctor = AudioCtor || (typeof AudioContext !== "undefined" ? AudioContext : null);
      if (!Ctor) return null;
      try {
        ctx = new Ctor();
      } catch (err) {
        ctx = null;
      }
      return ctx;
    }

    function play(cue) {
      const prefs = getPrefs();
      if (!prefs.soundsOn) return false;
      const notes = CUES[cue];
      const c = context();
      if (!notes || !c) return false;
      if (c.state === "suspended" && c.resume) c.resume().catch(() => {});
      const volume = Math.max(0, Math.min(1, Number(prefs.soundVolume)));
      if (volume === 0) return false;
      let t = c.currentTime;
      for (const { f, d } of notes) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        // Soft attack and release so it clicks gently instead of popping.
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25 * volume + 0.0001, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + d + 0.02);
        t += d * 0.9;
      }
      return true;
    }

    return { play, CUES };
  }

  return { createSounds, CUES };
});
