// Engine tests: run with `node test/engine.test.js`
const assert = require('assert');
const { LoopEngine } = require('../src/engine.js');
const { makeKits, patternArray, VOICES } = require('../src/drums.js');

const SR = 48000, B = 128;
let failures = 0;
function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n     ', e.message); } }

// run the engine for `sec` seconds feeding input from fn(globalSampleIndex)
function run(e, sec, fn = () => 0, collect) {
  const n = Math.round(sec * SR / B);
  const L = new Float32Array(B), R = new Float32Array(B), inp = new Float32Array(B);
  for (let b = 0; b < n; b++) {
    for (let i = 0; i < B; i++) inp[i] = fn(e._clock + i);
    e.process(inp, L, R);
    if (collect) collect.push(...L);
    e._clock += B;
  }
}
function mk(opts) { const e = new LoopEngine(SR, opts); e._clock = 0; e.latency = 0; return e; }

test('first loop: REC then REC sets the loop length and goes to DUB (Boss)', () => {
  const e = mk();
  e.recButton(0);
  assert.equal(e.tracks[0].state, 'rec');
  run(e, 2.0, () => 0.5);
  e.recButton(0);
  const t = e.tracks[0];
  assert.equal(t.state, 'dub');
  assert.ok(Math.abs(t.len - 2.0 * SR) <= B, 'len ' + t.len);
  assert.equal(e.master, t.len);
  // 2 s loop = 1 bar of 120 BPM
  assert.ok(Math.abs(e.bpm - 120) < 0.5, 'bpm ' + e.bpm);
});

test('REC->PLAY mode and playback returns the recording', () => {
  const e = mk(); e.recToDub = false; e.monitor = 0;
  e.recButton(0);
  run(e, 1.0, i => (i % 100) / 100);   // a ramp
  e.recButton(0);
  assert.equal(e.tracks[0].state, 'play');
  const out = []; run(e, 1.0, () => 0, out);
  // the loop played back: same values as recorded (vol 0.8)
  let err = 0; for (let i = 1000; i < 2000; i++) err = Math.max(err, Math.abs(out[i] - e.tracks[0].buf[i] * 0.8));
  assert.ok(err < 1e-6, 'err ' + err);
  assert.ok(Math.abs(out[1050] - ((1050 % 100) / 100) * 0.8) < 1e-6);
});

test('overdub adds, UNDO removes the overdub, REDO brings it back', () => {
  const e = mk(); e.recToDub = false;
  e.recButton(0); run(e, 1.0, () => 0.1); e.recButton(0);
  run(e, 0.5);
  e.recButton(0); assert.equal(e.tracks[0].state, 'dub');
  run(e, 1.0, () => 0.2);           // one full pass of overdub
  e.recButton(0); assert.equal(e.tracks[0].state, 'play');
  run(e, 0.2);
  const t = e.tracks[0];
  assert.ok(Math.abs(t.buf[5000] - 0.3) < 1e-5, 'after dub ' + t.buf[5000]);
  e.undoButton(0);
  assert.ok(Math.abs(t.buf[5000] - 0.1) < 1e-5, 'after undo ' + t.buf[5000]);
  assert.ok(t.canRedo && !t.canUndo);
  e.undoButton(0);
  assert.ok(Math.abs(t.buf[5000] - 0.3) < 1e-5, 'after redo ' + t.buf[5000]);
});

test('second track becomes a multiple of the first loop', () => {
  const e = mk(); e.recToDub = false;
  e.recButton(0); run(e, 1.0, () => 0.1); e.recButton(0);
  const M = e.master;
  run(e, 0.3);
  e.recButton(1); run(e, 1.9, () => 0.1); e.recButton(1);   // ~2.2 loops after the anchor -> rounds to 2
  const t = e.tracks[1];
  assert.ok(t.len === 2 * M || t.state === 'rec', 'len ' + t.len + ' master ' + M);
  run(e, 1.0);
  assert.equal(t.len, 2 * M);
  assert.equal(t.state, 'play');
});

test('with the rhythm on, the first loop waits for the bar and is a whole number of bars', () => {
  const e = mk(); e.recToDub = false;
  e.kits = makeKits(SR); e.pattern.set(patternArray(0)); e.drumOn = true; e.bpm = 120;   // bar = 2 s
  e.playButton(); run(e, 0.5);
  e.recButton(0);
  assert.equal(e.armed, 0);
  run(e, 1.6);                       // armed until the bar at 2.0 s
  assert.equal(e.tracks[0].state, 'rec');
  assert.equal(e.tracks[0].anchor, 2 * SR);
  run(e, 3.0);                        // now at 5.1 s: 1.55 bars recorded
  e.recButton(0);                    // rounds to 2 bars: keeps recording to 6.0 s
  assert.equal(e.master, 4 * SR);
  run(e, 1.0);
  assert.equal(e.tracks[0].state, 'play');
  assert.equal(e.tracks[0].len, 4 * SR);
});

test('drum steps fire on the 16th grid and pads overdub into the pattern', () => {
  const e = mk(); e.kits = makeKits(SR); e.bpm = 120; e.drumOn = true;
  e.pattern.fill(0);
  e.drumRecButton();                 // also starts the transport
  assert.ok(e.running && e.drumRec);
  run(e, 0.5 + 0.01);                // step 4 starts at 0.5 s (16th = 0.125 s)
  e.pad(1);                          // snare on step 4
  assert.equal(e.pattern[1 * 16 + 4], 1);
  run(e, 0.06);
  e.pad(0);                          // at ~0.57 s: nearest step is 5 (0.625 s)
  assert.equal(e.pattern[0 * 16 + 5], 1);
  e.drumUndoButton();
  assert.equal(e.pattern[1 * 16 + 4], 0);
});

test('drum kits: all voices are finite and normalised', () => {
  const kits = makeKits(SR);
  assert.equal(kits.length, 2);
  for (const k of kits) {
    assert.equal(k.length, VOICES.length);
    for (const s of k) {
      let pk = 0; for (const x of s) { assert.ok(Number.isFinite(x)); pk = Math.max(pk, Math.abs(x)); }
      assert.ok(pk > 0.85 && pk <= 0.9001, 'peak ' + pk);
    }
  }
});

test('stutter repeats a slice, bitcrusher quantises', () => {
  const e = mk(); e.monitor = 1; e.bpm = 120;
  e.playButton();
  const out = [];
  run(e, 0.5, i => Math.sin(i / 10));
  e.set('stut', true);
  run(e, 0.5, i => Math.sin(i / 10), out);
  const len = e.stutLen;
  assert.equal(len, 2 * SR / 16);
  for (let k = 200; k < 400; k++) assert.ok(Math.abs(out[k] - out[k + len]) < 1e-6);
  e.set('stut', false);
  e.bits = 3; const o2 = []; run(e, 0.05, i => Math.sin(i / 10), o2);
  const levels = new Set(o2.map(x => Math.round(x * 1000)));
  assert.ok(levels.size <= 9, 'levels ' + levels.size);
});

test('latency compensation: what you play along lands where you heard it', () => {
  const e = mk(); e.recToDub = false; e.latency = 1440;   // 30 ms
  e.recButton(0);
  // an impulse that "arrives" 30 ms late for a hit meant at 0.5 s
  run(e, 1.0, i => (i === 24000 + 1440 ? 1 : 0));
  run(e, 0.05);
  e.recButton(0);
  const t = e.tracks[0];
  assert.ok(Math.abs(t.buf[24000] - 1) < 1e-6, 'value at 0.5 s: ' + t.buf[24000]);
});

test('STOP during the first take closes it; PLAY restarts from the top', () => {
  const e = mk();
  e.recButton(0); run(e, 1.0, () => 0.1);
  e.playButton();
  assert.equal(e.running, false);
  assert.equal(e.tracks[0].state, 'play');
  e.playButton();
  assert.equal(e.p, 0);
});

test('CLEAR of every track removes the loop length', () => {
  const e = mk(); e.recButton(0); run(e, 1); e.recButton(0);
  e.clear(0);
  assert.equal(e.master, 0);
  assert.equal(e.tracks[0].state, 'empty');
});

test('waveform overview follows the recording and marks the overdub layer', () => {
  const e = mk(); e.recToDub = false;
  e.recButton(0); run(e, 1.0, i => (i < 24000 ? 0.5 : 0)); e.recButton(0);
  let ov = e.overview(0, 10);
  assert.ok(ov.pk[0] > 0.45 && ov.pk[9] < 0.01, 'first half loud, second silent');
  e.recButton(0); run(e, 1.0, i => 0.3); e.recButton(0);
  ov = e.overview(0, 10);
  assert.ok(ov.dk[9] > 0.25 && ov.pk[9] > 0.25, 'overdub shows in the silent half');
  e.undoButton(0);
  ov = e.overview(0, 10);
  assert.ok(ov.pk[9] < 0.01 && ov.dk[9] === 0, 'undo takes the overdub out of the picture');
});

if (failures) { console.log(failures + ' failed'); process.exit(1); } else console.log('all passed');
