// Drum sounds, synthesised here (no samples from anywhere): an analogue kit in the style of the classic
// drum machines (808-like) and an acoustic-like kit. Plus the factory patterns.

// kit 0 = ROCK: real recordings (rockkit.js), kits 1 and 2 are synthesised below
const KITS = ['ROCK (ECHT)', 'ANALOG 808', 'SYNTH AKUSTIK'];
const KIT_VOICES = [
  ['KICK', 'SNARE', 'RIMSHOT', 'HAT ZU', 'HAT AUF', 'TOM TIEF', 'TOM MITTE', 'TOM HOCH', 'SIDESTICK', 'RIDE', 'CRASH'],
  ['KICK', 'SNARE', 'CLAP', 'HAT ZU', 'HAT AUF', 'TOM TIEF', 'TOM MITTE', 'TOM HOCH', 'RIM', 'COWBELL', 'BECKEN'],
  ['KICK', 'SNARE', 'CLAP', 'HAT ZU', 'HAT AUF', 'TOM TIEF', 'TOM MITTE', 'TOM HOCH', 'RIM', 'COWBELL', 'BECKEN'],
];
const VOICES = KIT_VOICES[1];

function makeRng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 * 2 - 1; }; }

// RBJ biquad, used offline
function biquad(type, f, q, sr) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  let b0, b1, b2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = a; b1 = 0; b2 = -a; }   // band pass
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

function render(sec, sr, fn) {
  const n = Math.floor(sec * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / sr, i);
  // short fade-out, then normalise to a common level
  const f = Math.min(n, Math.floor(0.005 * sr));
  for (let i = 0; i < f; i++) out[n - 1 - i] *= i / f;
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  if (pk > 0) for (let i = 0; i < n; i++) out[i] *= 0.9 / pk;
  return out;
}

const env = (t, d) => Math.exp(-t / d);
const sat = x => Math.tanh(x);

// a sine whose phase follows a falling pitch
function sweep(f0, f1, tau) {
  let ph = 0, last = 0;
  return (t) => { const f = f1 + (f0 - f1) * Math.exp(-t / tau); ph += 2 * Math.PI * f * (t - last); last = t; return Math.sin(ph); };
}

// six square waves at inharmonic ratios: the metallic noise of analogue hats, cowbells and cymbals
function metal(freqs) {
  const ph = freqs.map(() => Math.random());
  let last = 0;
  return (t) => { let s = 0; const dt = t - last; last = t; for (let k = 0; k < freqs.length; k++) { ph[k] = (ph[k] + freqs[k] * dt) % 1; s += ph[k] < 0.5 ? 1 : -1; } return s / freqs.length; };
}

function kit808(sr) {
  const r = makeRng(808), M = [205.3, 304.4, 369.6, 522.7, 540, 800];
  return [
    (() => { const o = sweep(160, 48, 0.035); return render(0.9, sr, t => o(t) * env(t, 0.32) + (t < 0.002 ? 0.6 : 0)); })(),
    (() => { const a = sweep(240, 180, 0.03), b = sweep(400, 330, 0.03), h = biquad('hp', 1500, 0.7, sr);
      return render(0.35, sr, t => (0.6 * a(t) + 0.3 * b(t)) * env(t, 0.06) + 0.7 * h(r()) * env(t, 0.09)); })(),
    (() => { const bp = biquad('bp', 1100, 1.2, sr);
      return render(0.4, sr, t => { const burst = t < 0.03 ? env(t % 0.01, 0.003) : 0; return bp(r()) * (burst * 0.9 + env(Math.max(0, t - 0.03), 0.12) * (t >= 0.03 ? 1 : 0)) * 2; }); })(),
    (() => { const m = metal(M), h = biquad('hp', 7000, 0.8, sr), b = biquad('bp', 10000, 0.7, sr); return render(0.12, sr, t => b(h(m(t))) * env(t, 0.025)); })(),
    (() => { const m = metal(M), h = biquad('hp', 7000, 0.8, sr), b = biquad('bp', 10000, 0.7, sr); return render(0.7, sr, t => b(h(m(t))) * env(t, 0.22)); })(),
    (() => { const o = sweep(110, 82, 0.08); return render(0.6, sr, t => o(t) * env(t, 0.2)); })(),
    (() => { const o = sweep(160, 122, 0.08); return render(0.5, sr, t => o(t) * env(t, 0.17)); })(),
    (() => { const o = sweep(230, 175, 0.08); return render(0.45, sr, t => o(t) * env(t, 0.15)); })(),
    (() => { const b = biquad('bp', 1700, 3, sr); let ph = 0; return render(0.06, sr, t => b(Math.sin(2 * Math.PI * 1700 * t) + 0.5 * r()) * env(t, 0.008)); })(),
    (() => { const m = metal([540, 800]), b = biquad('bp', 900, 2, sr); return render(0.5, sr, t => b(m(t)) * (0.6 * env(t, 0.02) + 0.4 * env(t, 0.18))); })(),
    (() => { const m = metal(M), h = biquad('hp', 5000, 0.7, sr), n = biquad('hp', 6000, 0.7, sr); return render(1.6, sr, t => (h(m(t)) * 0.7 + 0.3 * n(r())) * env(t, 0.5)); })(),
  ];
}

function kitAcoustic(sr) {
  const r = makeRng(1965);
  const shell = (f0, f1, d, noise) => { const o = sweep(f0, f1, 0.03), lp = biquad('lp', 3000, 0.7, sr);
    return render(d * 4, sr, t => sat(1.4 * o(t)) * env(t, d) + noise * lp(r()) * env(t, 0.02)); };
  return [
    (() => { const o = sweep(130, 55, 0.02), lp = biquad('lp', 4000, 0.7, sr);
      return render(0.5, sr, t => sat(1.8 * o(t)) * env(t, 0.13) + 0.5 * lp(r()) * env(t, 0.004)); })(),
    (() => { const a = sweep(260, 190, 0.02), bp = biquad('bp', 3500, 0.5, sr), lp = biquad('lp', 9000, 0.7, sr);
      return render(0.45, sr, t => 0.5 * a(t) * env(t, 0.05) + 0.9 * lp(bp(r()) * 2) * env(t, 0.13)); })(),
    (() => { const bp = biquad('bp', 1400, 0.9, sr);
      return render(0.35, sr, t => bp(r()) * ((t < 0.025 ? env(t % 0.008, 0.002) : 0) + (t >= 0.025 ? env(t - 0.025, 0.09) : 0)) * 2); })(),
    (() => { const h = biquad('hp', 8000, 0.7, sr), b = biquad('bp', 11000, 0.6, sr); return render(0.1, sr, t => b(h(r())) * env(t, 0.018)); })(),
    (() => { const h = biquad('hp', 6500, 0.7, sr), b = biquad('bp', 9500, 0.5, sr); return render(0.9, sr, t => b(h(r())) * env(t, 0.28)); })(),
    shell(105, 80, 0.16, 0.3),
    shell(150, 115, 0.14, 0.3),
    shell(210, 165, 0.12, 0.3),
    (() => { const b = biquad('bp', 2200, 4, sr), c = biquad('bp', 500, 3, sr); return render(0.08, sr, t => (b(r()) * 2 + c(r())) * env(t, 0.012)); })(),
    (() => { const m = metal([587, 845]), b = biquad('bp', 1000, 1.5, sr); return render(0.5, sr, t => b(m(t)) * (0.5 * env(t, 0.015) + 0.5 * env(t, 0.15))); })(),
    (() => { const h = biquad('hp', 3500, 0.7, sr), m = metal([310, 427, 589, 763, 1031, 1407]), h2 = biquad('hp', 4000, 0.7, sr);
      return render(2.2, sr, t => (0.7 * h(r()) + 0.4 * h2(m(t))) * env(t, 0.7)); })(),
  ];
}

function makeKits(sr) { return [kit808(sr), kitAcoustic(sr)]; }

// factory patterns: one string of 16 steps per voice ('x' = hit)
const PATTERNS = [
  { name: 'ROCK', v: { 0: 'x.......x.x.....', 1: '....x.......x...', 3: 'x.x.x.x.x.x.x.x.' } },
  { name: 'ROCK RIDE', v: { 0: 'x.......x.x.....', 1: '....x.......x...', 9: 'x.x.x.x.x.x.x.x.', 10: 'x...............' } },
  { name: 'BALLADE', v: { 0: 'x.........x.....', 1: '....x.......x...', 3: 'x.x.x.x.x.x.x.x.' } },
  { name: 'SHUFFLE', v: { 0: 'x.....x.x.......', 1: '....x.......x...', 3: 'x..x.xx..x.xx..x' } },
  { name: 'POP', v: { 0: 'x.....x...x.....', 1: '....x.......x...', 3: 'xxxxxxxxxxxxxxxx' } },
  { name: 'HIPHOP', v: { 0: 'x......x..x.....', 1: '....x.......x...', 3: 'x.x.x.x.x.x.x.x.', 4: '..............x.' } },
  { name: 'HOUSE', v: { 0: 'x...x...x...x...', 2: '....x.......x...', 3: 'x.x.x.x.x.x.x.x.', 4: '..x...x...x...x.' } },
  { name: 'FUNK', v: { 0: 'x..x..x...x..x..', 1: '....x..x.x..x...', 3: 'x.xxx.xxx.xxx.xx' } },
  { name: 'TRAP', v: { 0: 'x......x.x......', 1: '........x.......', 3: 'x.x.xxx.x.x.xxxx', 9: '..........x.....' } },
  { name: 'BOSSA', v: { 0: 'x..xx..xx..xx..x', 8: 'x..x..x...x..x..', 3: 'x.x.x.x.x.x.x.x.' } },
  { name: 'DISCO', v: { 0: 'x...x...x...x...', 1: '....x.......x...', 4: '..x...x...x...x.', 3: 'x...x...x...x...' } },
  { name: 'LEER', v: {} },
];
function patternArray(i) {
  const a = new Uint8Array(VOICES.length * 16), p = PATTERNS[i].v;
  for (const k in p) for (let s = 0; s < 16; s++) a[k * 16 + s] = (p[k] || '')[s] === 'x' ? 1 : 0;
  return a;
}

if (typeof module !== 'undefined') module.exports = { VOICES, KIT_VOICES, KITS, PATTERNS, makeKits, patternArray };
