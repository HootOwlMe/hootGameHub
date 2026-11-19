/* ============================================================
 * audio.js — tiny synthesized sound engine (no asset files)
 *
 * All effects are generated with WebAudio oscillators + a noise
 * buffer. The AudioContext is created lazily on the first user
 * gesture (browser autoplay policy). Mute state persists in
 * localStorage.
 * ============================================================ */

'use strict';

/* ---------- background music ------------------------------------
 * A tiny procedural chiptune loop (C–Am–F–G, 112 BPM) scheduled with a
 * lookahead timer — no audio files, fully self-contained and original. */
var MUSIC_BPM = 100;
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
// bass roots + fifths per bar (MIDI)
var BASS_ROOTS  = [48, 45, 41, 43]; // C3 A2 F2 G2
var BASS_FIFTHS = [55, 52, 48, 50]; // G3 E3 C3 D3
// lead line per bar on an 8-eighth grid: [gridIndex, midi] — C pentatonic
var LEAD_LINE = [
  [[0, 60], [2, 64], [4, 67], [6, 69]], // C : C E G A
  [[0, 64], [2, 60], [4, 64], [6, 67]], // Am: E C E G
  [[0, 65], [2, 69], [4, 72], [6, 69]], // F : F A C' A
  [[0, 67], [2, 64], [4, 62], [6, 60]]  // G : G E D C (resolves into the loop)
];

var SFX = {
  ctx: null,
  master: null,
  _noiseBuf: null,
  soundMode: 0, // 0 = all on · 1 = music muted only · 2 = everything muted
  musicGain: null,
  mus: { playing: false, timer: null, bar: 0, nextTime: 0, eighth: 0 },

  /** Must be called from a user gesture at least once. Safe to call often. */
  ensure: function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.soundMode === 2 ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // dedicated bus for background music so it can be muted while SFX plays
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = (this.soundMode === 1 || this.soundMode === 2) ? 0 : 1;
    this.musicGain.connect(this.master);

    // 1 second of white noise, reused by every effect
    var len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = this._noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },

  /** Cycle all-on → music-only muted → fully muted. Returns the new mode. */
  cycleSound: function () {
    this.soundMode = (this.soundMode + 1) % 3;
    this.applySound();
    return this.soundMode;
  },

  /** Push soundMode to the gain nodes and persist it. */
  applySound: function () {
    var m = this.soundMode;
    if (this.master) this.master.gain.value = m === 2 ? 0 : 0.5;
    if (this.musicGain) this.musicGain.gain.value = (m === 1 || m === 2) ? 0 : 1;
    try { localStorage.setItem('suika-sound', String(m)); } catch (e) {}
  },

  loadSoundPref: function () {
    var v;
    try { v = parseInt(localStorage.getItem('suika-sound'), 10); } catch (e) { v = NaN; }
    this.soundMode = (v === 1 || v === 2) ? v : 0;
  },

  /** Re-arm audio whenever the page wakes up.
   *  Mobile browsers (iOS Safari in particular) SUSPEND the AudioContext when
   *  the app loses focus — e.g. switching to Discord — and it stays silent on
   *  return until something calls resume(). ensure() does exactly that, so we
   *  hook the standard wake events: visibilitychange, window focus, pageshow
   *  (bfcache restore is common on mobile), plus a capture-phase pointerdown
   *  as a last resort for OSes that only honour resume() inside a user gesture. */
  bindAutoResume: function () {
    if (this._autoBound) return;
    this._autoBound = true;
    var self = this;
    var wake = function () { self.ensure(); };
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) wake();
    });
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('pointerdown', wake, true);
  },

  /* ---------- primitives ------------------------------------ */

  /** Simple enveloped oscillator blip.
   *  NOTE: does not skip when muted — the master gain silences it, which
   *  keeps scheduled music continuous across mute/unmute. */
  tone: function (freq, dur, type, vol, glideTo, delay, dest) {
    if (!this.ctx) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.25 : vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(dest || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },

  /** Filtered noise burst (thuds / pops). filterType: 'lowpass' | 'highpass'. */
  noise: function (dur, vol, filterFreq, delay, filterType, dest) {
    if (!this.ctx || !this._noiseBuf) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    var f = this.ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.value = filterFreq == null ? 900 : filterFreq;
    var g = this.ctx.createGain();
    // Short attack ramp: an instantaneous step from silence to full amplitude
    // IS a click transient — on mobile it comes through as a "pop", most
    // audibly on the highpassed hi-hats. Ramp in over ~4 ms so the onset stays
    // crisp but clean (same trick tone() uses for its 8 ms attack).
    var peak = vol == null ? 0.3 : vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.004, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest || this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  },

  /* ---------- game effects ---------------------------------- */

  /** Fruit dropped into the well — soft click. */
  spawn: function () {
    this.tone(640, 0.07, 'sine', 0.12, 380);
  },

  /** Merge pop — pitch rises with the tier of the RESULT fruit. */
  merge: function (resultTier) {
    var base = 240 * Math.pow(1.16, resultTier); // ~semitone-ish steps up
    this.tone(base * 1.5, 0.16, 'triangle', 0.38, base);
    this.tone(base / 2, 0.14, 'sine', 0.16);
    this.noise(0.05, 0.12, 1600 + resultTier * 180);
  },

  /** Big impact thud; intensity in [0,1]. */
  thud: function (intensity) {
    if (intensity <= 0.02) return;
    var v = Math.min(1, intensity);
    this.noise(0.09, 0.3 * v, 220);
    this.tone(85, 0.09, 'sine', 0.25 * v, 48);
  },

  /** Invalid drop attempt — short buzz. */
  denied: function () {
    this.tone(150, 0.12, 'square', 0.1, 95);
  },

  /** Game over — descending three-note sigh. */
  gameOver: function () {
    var notes = [392, 311, 262]; // G4, Eb4, E4-ish downward
    for (var i = 0; i < notes.length; i++) {
      this.tone(notes[i], 0.3, 'triangle', 0.22, null, i * 0.18);
    }
    this.noise(0.4, 0.1, 150, 0.1);
  },

  /** Restart pressed — short bright C-E-G blip (independent of the music loop). */
  restartJingle: function () {
    this.tone(523.25, 0.09, 'triangle', 0.2);
    this.tone(659.25, 0.09, 'triangle', 0.2, null, 0.08);
    this.tone(784, 0.14, 'triangle', 0.22, null, 0.16);
  },

  /** Watermelon born — little fanfare + low rumble. */
  fanfare: function () {
    var chords = [[523.25, 659.25, 784], [659.25, 830.6, 1046.5]]; // C major up an interval
    for (var c = 0; c < chords.length; c++) {
      for (var n = 0; n < chords[c].length; n++) {
        this.tone(chords[c][n], 0.32, 'triangle', 0.16, null, c * 0.14 + n * 0.015);
      }
    }
    this.tone(70, 0.5, 'sine', 0.3, 50);
    this.noise(0.5, 0.12, 120);
  },

  /* ---------- looping background music --------------------------- */

  /** Start the chiptune loop (needs ensure() from a user gesture first).
   *  If it is already playing, does NOTHING — restarts must not touch the
   *  running loop, or ~1 s of already-scheduled notes would overlap. */
  startMusic: function () {
    if (this.mus.playing) return;
    this.stopMusic();
    if (!this.ctx) return;
    var m = this.mus;
    m.playing = true;
    m.eighth = 60 / MUSIC_BPM / 2; // seconds per eighth note
    m.bar = 0;
    m.nextTime = this.ctx.currentTime + 0.12;
    var self = this;
    this._schedMusic();
    m.timer = setInterval(function () { self._schedMusic(); }, 90);
  },

  stopMusic: function () {
    var m = this.mus;
    if (m && m.timer) { clearInterval(m.timer); m.timer = null; }
    m.playing = false;
  },

  /** Lookahead scheduler — keeps ~0.45s of bars queued on the audio clock. */
  _schedMusic: function () {
    var m = this.mus, ctx = this.ctx;
    if (!m || !m.playing || !ctx) return;
    while (m.nextTime < ctx.currentTime + 0.45) {
      this._playBar(m.bar % LEAD_LINE.length, m.nextTime);
      m.nextTime += m.eighth * 8; // one 4/4 bar
      m.bar++;
    }
  },

  /** One filtered oscillator note at an absolute audio-clock time. */
  _mnote: function (freq, tAbs, dur, type, vol) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, tAbs);
    f.type = 'lowpass';
    f.frequency.value = 2400; // softens the square lead
    f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, tAbs);
    g.gain.linearRampToValueAtTime(vol, tAbs + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, tAbs + dur);
    osc.connect(f).connect(g).connect(this.musicGain || this.master);
    osc.start(tAbs);
    osc.stop(tAbs + dur + 0.05);
  },

  /** Schedule one bar (bass + lead + light drums) starting at tAbs. */
  _playBar: function (barIdx, tAbs) {
    var e8 = this.mus.eighth;
    var now = this.ctx.currentTime;
    var i;

    // bass: root on beat 1, fifth on beat 3
    this._mnote(midiHz(BASS_ROOTS[barIdx]), tAbs, e8 * 3.5, 'triangle', 0.11);
    this._mnote(midiHz(BASS_FIFTHS[barIdx]), tAbs + e8 * 4, e8 * 3.5, 'triangle', 0.09);

    // lead line (pentatonic)
    var line = LEAD_LINE[barIdx];
    for (i = 0; i < line.length; i++) {
      this._mnote(midiHz(line[i][1]), tAbs + line[i][0] * e8, e8 * 1.7, 'square', 0.045);
    }

    // drums: kick on beats 1 & 3, hats on every eighth (all on the music bus)
    this.tone(120, 0.11, 'sine', 0.16, 42, tAbs - now, this.musicGain);
    this.tone(120, 0.11, 'sine', 0.13, 42, tAbs + e8 * 4 - now, this.musicGain);
    for (i = 0; i < 8; i++) {
      this.noise(0.035, i % 2 ? 0.05 : 0.032, 7000, tAbs + i * e8 - now, 'highpass', this.musicGain);
    }
  }
};
