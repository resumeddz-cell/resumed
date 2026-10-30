// All Pomodoro sounds are synthesised live with the Web Audio API (no audio files, nothing to
// download or license): background music (piano, violin, guitar, rain) and the end-of-session alarm.
let ctx = null;
export function getCtx() {
  if (!ctx) {
    const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!C) return null;
    try { ctx = new C(); } catch { return null; }
  }
  return ctx;
}
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  return c;
}
export const audioRunning = () => !!(ctx && ctx.state === 'running');

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function impulse(c, seconds = 3.2, decay = 2.6) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

// =========================================================================== alarm
// Three loud bell strikes followed by a classic "beep-beep-beep-beep" alarm clock (about 9 s).
let alarm = null;          // { at, end, nodes }
function bell(c, out, t, f0, amp, nodes) {
  [[1, 1, 3.4], [2.0, 0.55, 2.4], [2.76, 0.42, 1.8], [5.4, 0.22, 1.0], [8.93, 0.12, 0.55]].forEach(([r, a, dur]) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'sine'; o.frequency.value = f0 * r;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * a, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05); nodes.push(o, g);
  });
}
function beeps(c, out, t, amp, nodes) {
  for (let i = 0; i < 4; i++) {
    const s = t + i * 0.14; const o = c.createOscillator(); const g = c.createGain();
    o.type = 'square'; o.frequency.value = 2093;
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(amp, s + 0.006);
    g.gain.setValueAtTime(amp, s + 0.07); g.gain.linearRampToValueAtTime(0, s + 0.08);
    o.connect(g); g.connect(out); o.start(s); o.stop(s + 0.09); nodes.push(o, g);
  }
}
export function scheduleAlarm(at, { short = false } = {}) {
  const c = getCtx(); if (!c) return null;
  stopAlarm();
  const nodes = [];
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 12; comp.knee.value = 2; comp.attack.value = 0.002; comp.release.value = 0.2;
  const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 6000;
  const bus = c.createGain(); bus.gain.value = 1.0;
  bus.connect(tone); tone.connect(comp); comp.connect(c.destination); nodes.push(bus, tone, comp);
  const strikes = short ? 1 : 3;
  for (let i = 0; i < strikes; i++) bell(c, bus, at + i * 1.1, 1046.5, 0.9, nodes);
  const b0 = at + strikes * 1.1 + 0.1; const groups = short ? 1 : 6;
  for (let i = 0; i < groups; i++) beeps(c, bus, b0 + i, 0.32, nodes);
  alarm = { at, end: b0 + groups, nodes };
  return alarm;
}
export const scheduledAlarm = () => alarm;
export function playAlarm(opts) {
  const c = unlockAudio(); if (!c) return null;
  return scheduleAlarm(c.currentTime + 0.05, opts);
}
export function stopAlarm() {
  if (!alarm) return;
  alarm.nodes.forEach((n) => { try { if (n.stop) n.stop(); } catch { /* not started */ } try { n.disconnect(); } catch { /* ignore */ } });
  alarm = null;
}

// =========================================================================== background music
export const MUSIC = [
  { id: 'none', label: 'None' },
  { id: 'piano', label: 'Piano' },
  { id: 'violin', label: 'Violin' },
  { id: 'guitar', label: 'Guitar' },
  { id: 'rain', label: 'Rain' },
];
const LEVEL = { piano: 0.55, violin: 1.0, guitar: 0.7, rain: 0.9 };

// calm progressions (Am – F – C – G, then Am – Em – F – G), MIDI note numbers
const PROGS = [
  [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]],
  [[45, 57, 60, 64], [40, 55, 59, 64], [41, 57, 60, 65], [43, 55, 59, 62]],
];
const PENTA = [69, 72, 74, 76, 79, 81];            // A minor pentatonic, upper register

function chordAt(bar) { return PROGS[Math.floor(bar / 4) % 2][bar % 4]; }

function pianoNote(c, out, t, midi, vel) {
  const f = mtof(midi); const B = 0.00035;
  const len = 3.2 * (220 / f) ** 0.35;
  for (let n = 1; n <= 6; n++) {
    const fn = f * n * Math.sqrt(1 + B * n * n); if (fn > 9000) break;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'sine'; o.frequency.value = fn;
    const a = vel / n ** 1.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.006, len / (n * 1.6));
    o.connect(g); g.connect(out); o.start(t); o.stop(t + len * 2);
  }
}

const ksCache = new Map();
function pluckBuffer(c, midi) {
  const key = `${c.sampleRate}:${midi}`;
  if (ksCache.has(key)) return ksCache.get(key);
  const sr = c.sampleRate; const len = Math.floor(sr * 2.6); const N = Math.max(2, Math.round(sr / mtof(midi)));
  const buf = c.createBuffer(1, len, sr); const y = buf.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = 0.6 * prev + 0.4 * w; y[i] = prev; }   // softened pick
  const damp = 0.4985 + 0.0013 * Math.min(1, 220 / mtof(midi));
  for (let i = N; i < len; i++) y[i] = damp * (y[i - N] + y[i - N - 1 < 0 ? 0 : i - N - 1]);
  ksCache.set(key, buf); return buf;
}
function guitarNote(c, out, t, midi, vel) {
  const s = c.createBufferSource(); s.buffer = pluckBuffer(c, midi);
  const g = c.createGain(); g.gain.value = vel;
  s.connect(g); g.connect(out); s.start(t); s.stop(t + 2.6);
}

function bowedNote(c, out, t, midi, dur, vel) {
  const f = mtof(midi);
  const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(4200, f * 7); lp.Q.value = 0.6;
  const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 520; body.gain.value = 5; body.Q.value = 1.2;
  const lfo = c.createOscillator(); lfo.frequency.value = rand(5.1, 5.8);
  const depth = c.createGain(); depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(7, t + Math.min(1.2, dur * 0.5));   // cents
  lfo.connect(depth);
  [-4, 0, 5].forEach((cents) => {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
    depth.connect(o.detune); o.connect(lp); o.start(t); o.stop(t + dur + 1.2);
  });
  lp.connect(body); body.connect(g); g.connect(out);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.7);
  g.gain.setValueAtTime(vel, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur + 1);
  lfo.start(t); lfo.stop(t + dur + 1.2);
}

function noiseBuffer(c, seconds) {
  const len = Math.floor(c.sampleRate * seconds); const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {           // pink-ish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
  }
  return buf;
}

let amb = null;       // current background sound
function createAmbient(c, kind, volume) {
  const out = c.createGain(); out.gain.value = 0;
  out.gain.setTargetAtTime(volume * LEVEL[kind], c.currentTime, 0.8);
  out.connect(c.destination);
  const verb = c.createConvolver(); verb.buffer = impulse(c, kind === 'violin' ? 4 : 3);
  const wet = c.createGain(); wet.gain.value = kind === 'violin' ? 0.55 : kind === 'rain' ? 0 : 0.35;
  const dry = c.createGain(); dry.gain.value = 1;
  const bus = c.createGain(); bus.connect(dry); bus.connect(verb); verb.connect(wet); dry.connect(out); wet.connect(out);
  const loops = [];
  const state = { kind, out, timer: null, next: c.currentTime + 0.15, bar: 0, stopped: false };

  if (kind === 'rain') {
    const nb = noiseBuffer(c, 6);
    const layer = (type, freq, q, gain) => {
      const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.loopStart = rand(0, 2);
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      s.connect(f); f.connect(g); g.connect(bus); s.start(c.currentTime, rand(0, 5)); loops.push(s);
      return g;
    };
    layer('lowpass', 900, 0.4, 0.9);                // steady downpour
    const hiss = layer('highpass', 2600, 0.5, 0.25); // drizzle on leaves, slowly breathing
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 0.1;
    lfo.connect(lg); lg.connect(hiss.gain); lfo.start(); loops.push(lfo);
  }

  const schedule = () => {
    if (state.stopped) return;
    const horizon = c.currentTime + 3;
    while (state.next < horizon) {
      const t = state.next; const bar = state.bar;
      if (kind === 'rain') {
        // single drops on the window: short filtered clicks
        for (let i = 0; i < 14; i++) {
          const s = c.createBufferSource(); s.buffer = dropBuffer(c);
          const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rand(1800, 6000); f.Q.value = rand(2, 6);
          const g = c.createGain(); g.gain.value = rand(0.05, 0.22);
          s.connect(f); f.connect(g); g.connect(bus); s.start(t + Math.random());
        }
        state.next += 1;
      } else if (kind === 'piano') {
        const beat = 60 / 64; const ch = chordAt(bar);
        pianoNote(c, bus, t, ch[0], 0.32);
        const arp = [1, 2, 3, 2, 1, 2, 3, 2];
        arp.forEach((k, i) => pianoNote(c, bus, t + i * beat / 2 + rand(0, 0.015), ch[k] + 12, rand(0.11, 0.17)));
        if (Math.random() < 0.7) pianoNote(c, bus, t + pick([0, 2, 2.5]) * beat, pick(PENTA), rand(0.16, 0.22));
        if (Math.random() < 0.4) pianoNote(c, bus, t + 3 * beat, pick(PENTA), rand(0.12, 0.18));
        state.next += 4 * beat; state.bar++;
      } else if (kind === 'guitar') {
        const beat = 60 / 70; const ch = chordAt(bar);
        const bass = ch[0] < 40 ? ch[0] + 12 : ch[0];
        guitarNote(c, bus, t, bass, 0.55); guitarNote(c, bus, t + 2 * beat, bass + 7, 0.42);
        [1, 2, 3, 2, 1, 2, 3, 2].forEach((k, i) => guitarNote(c, bus, t + i * beat / 2 + 0.01 + rand(0, 0.012), ch[k], i % 2 ? 0.3 : 0.38));
        state.next += 4 * beat; state.bar++;
      } else if (kind === 'violin') {
        const dur = 4.4; const ch = chordAt(bar);
        bowedNote(c, bus, t, ch[0] + 12, dur, 0.06);                      // low voice holds the root
        const tones = [ch[1] + 12, ch[2] + 12, ch[3] + 12].filter((m) => m >= 67 && m <= 84);
        const top = tones.length ? pick(tones) : ch[2] + 12;
        if (Math.random() < 0.5) { bowedNote(c, bus, t, top, dur / 2 - 0.1, 0.05); bowedNote(c, bus, t + dur / 2, pick(PENTA), dur / 2, 0.05); }
        else bowedNote(c, bus, t, top, dur, 0.05);
        state.next += dur; state.bar++;
      }
    }
  };
  schedule();
  state.timer = setInterval(schedule, 250);
  state.setVolume = (v) => out.gain.setTargetAtTime(v * LEVEL[kind], c.currentTime, 0.2);
  state.stop = () => {
    state.stopped = true; clearInterval(state.timer);
    out.gain.cancelScheduledValues(c.currentTime); out.gain.setTargetAtTime(0, c.currentTime, 0.35);
    setTimeout(() => { loops.forEach((s) => { try { s.stop(); } catch { /* ignore */ } }); try { out.disconnect(); } catch { /* ignore */ } }, 2500);
  };
  return state;
}
let dropBuf = null;
function dropBuffer(c) {
  if (dropBuf && dropBuf.sampleRate === c.sampleRate) return dropBuf;
  const len = Math.floor(c.sampleRate * 0.025); dropBuf = c.createBuffer(1, len, c.sampleRate);
  const d = dropBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  return dropBuf;
}

// kind: 'none' | 'piano' | 'violin' | 'guitar' | 'rain'; volume 0..1
export function setAmbient(kind, volume = 0.6) {
  const c = getCtx(); if (!c) return;
  if (amb && amb.kind === kind) { amb.setVolume(volume); return; }
  if (amb) { amb.stop(); amb = null; }
  if (!kind || kind === 'none' || !LEVEL[kind]) return;
  amb = createAmbient(c, kind, volume);
}
export const ambientKind = () => (amb ? amb.kind : 'none');
