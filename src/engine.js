// Ouroloops: audio engine.
// Runs inside an AudioWorklet (one instance), and in Node for the tests.
// Mono loop tracks (the phone microphone), a drum machine (1-64 sixteenth steps), bitcrusher and stutter.

const NTRACKS = 3, NVOICES = 11, NSTEPS = 16, NOUT = 5;
const MAXSTEPS = 64, VSTRIDE = MAXSTEPS;   // pattern[v * 64 + step]; a step is always a sixteenth, drumLen of them loop
const CHUNK = 4096;   // copy-on-write granularity of the undo snapshot
const PKB = 1024;     // samples per peak bin of the waveform overview

function mod(a, n) { const r = a % n; return r < 0 ? r + n : r; }

class LoopEngine {
  constructor(sr, opts = {}) {
    this.sr = sr;
    this.maxLen = Math.floor(sr * (opts.maxSeconds || 90));
    this.tracks = [];
    for (let i = 0; i < NTRACKS; i++) {
      this.tracks.push({
        buf: new Float32Array(this.maxLen), undo: null, undoB: null, canUndoB: false, press: '', copied: null, copyNext: 0,
        len: 0, hi: 0, anchor: 0, state: 'empty', recEnd: -1, tail: 0,
        vol: 0.8, pan: 0, rev: false, canUndo: false, canRedo: false, peak: 0,
        pk: new Float32Array(Math.ceil(this.maxLen / PKB)),   // waveform overview: max |sample| per bin
        dk: new Float32Array(Math.ceil(this.maxLen / PKB)),   // the same for the newest overdub layer
        pkVer: 0,
      });
    }
    this.master = 0;          // length of the first loop (samples); 0 = no loop yet
    this.masterBars = 1;
    this.p = 0;               // transport position (samples since PLAY)
    this.running = false;
    this.latency = Math.round(0.03 * sr);
    this.recToDub = true;     // Boss default: REC -> DUB
    this.monitor = 1; this.inGain = 1;
    this.armed = -1; this.armAt = 0; this.armGrid = false;
    // drums
    this.bpm = 100; this.drumOn = false; this.drumVol = 0.8; this.drumRec = false;
    this.pattern = new Uint8Array(NVOICES * VSTRIDE);
    this.drumLen = 16;   // steps the pattern loops over (steps beyond keep their beats, unplayed)
    // per drum sound: length (gate, % of the sample), pitch (semitones), level (0..1)
    this.gate = new Float32Array(NVOICES).fill(100); this.tune = new Float32Array(NVOICES); this.level = new Float32Array(NVOICES).fill(1);
    this.drumUndo = null; this.drumRedo = null;
    this.kits = [];           // kits[k][v] = Float32Array
    this.kit = 0;
    this.playing = [];        // {s: Float32Array, i (position, may be fractional), r (rate), g, end}
    this.lastStep = -1; this.skip = new Uint8Array(NVOICES * VSTRIDE);
    // metronome: only in the output, never in a recording (the loops record the microphone only)
    this.clickOn = false; this.clickVol = 0.5; this.lastBeat = -1;
    this.monCh = 4;   // the output the microphone monitor goes to: a track (its effects) or 4 (dry)
    const blip = (f, n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (n / 5)); return a; };
    this.clickHi = blip(2000, Math.round(sr * 0.03)); this.clickLo = blip(1200, Math.round(sr * 0.025));
    // outputs: 0..2 the loop tracks, 3 the drums, 4 the microphone monitor and the click (no effects)
    // bitcrusher per channel 0..3; stutter on all of them together
    this.bits = [16, 16, 16, 16]; this.down = [1, 1, 1, 1];
    this.holdL = new Float32Array(4); this.holdR = new Float32Array(4); this.holdN = new Int32Array(4);
    this.ringLen = Math.floor(sr * 2); this.ringW = 0;
    this.ringL = []; this.ringR = [];
    for (let c = 0; c < NOUT; c++) { this.ringL.push(new Float32Array(this.ringLen)); this.ringR.push(new Float32Array(this.ringLen)); }
    this.clicks = [];
    this.oL = new Float64Array(NOUT); this.oR = new Float64Array(NOUT);
    this.stut = false; this.stutDiv = 16; this.stutStart = 0; this.stutLen = 0; this.stutK = 0;
    this.meterIn = 0; this.meterOut = 0;
    this.events = [];         // messages for the UI (finished recording etc.)
    this.dirty = true;
  }

  // ---- timing ------------------------------------------------------------------
  barLen() { return this.master > 0 ? this.master / this.masterBars : this.sr * 240 / this.bpm; }
  stepLen() { return this.barLen() / NSTEPS; }
  // the drum step at position p (the pattern loops over drumLen sixteenths from the start)
  stepAt(p) { const sl = this.stepLen(); return Math.min(this.drumLen - 1, Math.floor(mod(p, sl * this.drumLen) / sl)); }
  currentStep() { return this.stepAt(this.p); }

  // ---- commands from the UI ----------------------------------------------------
  // REC button on track i (Boss cycle: empty -> REC -> DUB (or PLAY) -> PLAY -> DUB ...)
  recButton(i) {
    const t = this.tracks[i];
    if (this.armed === i) { this.armed = -1; this.dirty = true; return; }   // second press while waiting: cancel
    t.press = t.state;   // what this press did, for REC hold (= undo)
    switch (t.state) {
      case 'empty': this.startRec(i); break;
      case 'rec': this.finishRecPress(i); break;
      case 'dub': this.endDub(i); break;
      case 'play': case 'stop':
        if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; }
        this.startDub(i); break;
    }
    this.dirty = true;
  }

  startRec(i) {
    const t = this.tracks[i];
    const grid = this.master === 0 && (this.drumOn || this.clickOn);   // rhythm or click on: the loop starts on a bar line
    if (this.master === 0 && !grid) {
      if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; }
      // a running transport without a loop (drums off): the loop starts now
      this.beginRec(i, this.p);
      t.gridRec = false;
      return;
    }
    if (grid) {
      const bl = this.barLen();
      if (!this.running) {   // from standstill: one bar to count in
        this.running = true; this.p = 0; this.lastStep = -1; this.lastBeat = -1;
        this.armed = i; this.armAt = Math.round(bl); this.armGrid = true;
        return;
      }
      this.armed = i; this.armAt = Math.ceil(this.p / bl - 1e-9) * bl; this.armGrid = true;
      if (this.armAt - this.p < 1) this.armAt = this.p;
      return;
    }
    // a loop exists: record now from the start of this bar; the length becomes a whole-bar part
    // of the loop (1, 2 bars of a 4-bar loop) or a multiple of it
    if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; }
    const bl = this.barLen();
    this.beginRec(i, Math.floor(this.p / bl + 1e-9) * bl);
    t.gridRec = false;
  }

  beginRec(i, anchor) {
    const t = this.tracks[i];
    if (t.hi > 0) t.buf.fill(0, 0, t.hi);
    t.anchor = Math.round(anchor); t.state = 'rec'; t.len = 0; t.hi = 0; t.recEnd = -1; t.tail = 0;
    t.pk.fill(0); t.dk.fill(0); t.pkVer++;
    t.canUndo = false; t.canRedo = false; t.undo = null; t.copied = null;
    this.dirty = true;
  }

  finishRecPress(i) {
    const t = this.tracks[i];
    if (t.recEnd >= 0) return;   // already closing on the next bar
    const n = this.p - t.anchor;
    let len;
    if (this.master === 0 && !t.gridRec) {
      len = Math.max(Math.round(0.25 * this.sr), n);
      this.master = len;
      // a tempo for the drums: 1, 2, 4 ... bars so that it lands between 70 and 140 BPM
      let bars = 1;
      while (240 * bars * this.sr / len < 70 && bars < 16) bars *= 2;
      this.masterBars = bars;
      this.bpm = 240 * bars * this.sr / len;
      this.setLen(i, len);
      this.events.push({ t: 'loop', len, bars, bpm: this.bpm });
      return;
    }
    if (this.master === 0) {   // first loop on the drum grid
      const bl = this.barLen(), k = Math.max(1, Math.round(n / bl));
      len = Math.round(k * bl);
      this.masterBars = k; this.master = len;
      this.events.push({ t: 'loop', len, bars: k, bpm: this.bpm });
    } else len = this.fitLen(n);
    if (n >= len) this.setLen(i, len);
    else { t.recEnd = t.anchor + len; t.pendingLen = len; }   // keep recording to the end of the bar / loop
  }

  // the allowed length nearest to n: whole-bar divisions of the loop (1, 2 of 4 bars) or multiples of it
  fitLen(n) {
    const M = this.master, B = this.masterBars, cand = [];
    for (let d = 1; d < B; d++) if (B % d === 0) cand.push(M * d / B);
    for (let k = 1; k * M <= this.maxLen; k++) cand.push(k * M);
    let best = cand[0];
    for (const c of cand) if (Math.abs(Math.log(c / Math.max(1, n))) < Math.abs(Math.log(best / Math.max(1, n)))) best = c;
    return Math.round(best);
  }

  setLen(i, len) {
    const t = this.tracks[i];
    t.len = len; t.recEnd = -1;
    if (t.hi > len) { t.buf.fill(0, len, t.hi); t.hi = len; this.repeak(t); }
    t.undo = new Float32Array(len); t.undoB = new Float32Array(len); t.canUndoB = false;
    t.copied = new Uint8Array(Math.ceil(len / CHUNK)); t.copied.fill(1); t.copyNext = 0;
    t.canUndo = false; t.canRedo = false;
    if (this.recToDub) this.startDub(i, true);
    else { t.state = 'play'; t.tail = this.latency; }
    this.dirty = true;
  }

  startDub(i, fromRec) {
    const t = this.tracks[i];
    if (t.len === 0) return;
    // snapshot for UNDO: copy-on-write, chunk by chunk, the rest in the background.
    // The one before stays in undoB, so a held REC can cancel this new layer and undo the last one.
    this.ensureSnapshot(t);
    const keep = t.undo; t.undo = t.undoB; t.undoB = keep; t.canUndoB = t.canUndo && !t.canRedo;
    t.copied.fill(0); t.copyNext = 0; t.canUndo = true; t.canRedo = false;
    if (!fromRec) { t.dk.fill(0); t.pkVer++; }
    t.state = 'dub'; t.tail = 0; this.dirty = true;
  }

  endDub(i) {
    const t = this.tracks[i];
    t.state = 'play'; t.tail = this.latency; this.dirty = true;
  }

  ensureSnapshot(t) {
    if (!t.copied) return;
    const n = t.copied.length;
    for (let c = 0; c < n; c++) if (!t.copied[c]) this.copyChunk(t, c);
  }
  copyChunk(t, c) {
    const a = c * CHUNK, b = Math.min(t.len, a + CHUNK);
    t.undo.set(t.buf.subarray(a, b), a); t.copied[c] = 1;
  }

  undoButton(i) {
    if (i === 3) return this.drumUndoButton();
    const t = this.tracks[i];
    if (t.state === 'rec' || this.armed === i) { this.clear(i); return; }   // undo while recording the first take = cancel it
    if (!t.canUndo && !t.canRedo) return;
    this.ensureSnapshot(t);
    if (t.state === 'dub') t.state = 'play';
    const tmp = t.buf.slice(0, t.len); t.buf.set(t.undo); t.undo = tmp;
    t.dk.fill(0); this.repeak(t);
    const u = t.canUndo; t.canUndo = t.canRedo; t.canRedo = u;
    t.tail = 0; this.dirty = true;
  }

  // REC held: undo what the press before it led to (Boss: hold REC/DUB/PLAY = undo)
  recHold(i) {
    const t = this.tracks[i], did = t.press; t.press = '';
    if (did === 'empty' || did === 'rec' || t.state === 'rec' || this.armed === i) { this.clear(i); return; }   // a new take: cancel it
    if (did === 'play' || did === 'stop') {
      // the press started a new layer: drop it (back to undoB's partner), then undo the layer before
      if (t.state === 'dub') {
        this.ensureSnapshot(t); t.buf.set(t.undo); t.state = 'play'; t.tail = 0;
        const x = t.undo; t.undo = t.undoB; t.undoB = x; t.copied.fill(1); t.copyNext = t.copied.length;
        t.canUndo = t.canUndoB; t.canRedo = false; t.canUndoB = false;
        t.dk.fill(0); this.repeak(t);
      }
      if (t.canUndo) this.undoButton(i);
      this.dirty = true; return;
    }
    this.undoButton(i);   // the press ended a layer: undo it
  }

  clear(i) {
    if (i === 3) { this.pattern.fill(0); this.dirty = true; return; }
    const t = this.tracks[i];
    if (this.armed === i) this.armed = -1;
    t.buf.fill(0, 0, Math.max(t.hi, t.len)); t.pk.fill(0); t.dk.fill(0); t.pkVer++;
    t.state = 'empty'; t.len = 0; t.hi = 0; t.recEnd = -1; t.tail = 0; t.undo = null; t.undoB = null; t.canUndoB = false; t.copied = null;
    t.canUndo = t.canRedo = false;
    if (this.tracks.every(x => x.state === 'empty')) { this.master = 0; this.masterBars = 1; }
    this.dirty = true;
  }

  repeak(t) {
    const n = Math.max(t.len, t.hi), pk = t.pk; pk.fill(0);
    const buf = t.buf;
    for (let i = 0; i < n; i++) { const a = buf[i] < 0 ? -buf[i] : buf[i]; const b = (i / PKB) | 0; if (a > pk[b]) pk[b] = a; }
    t.pkVer++;
  }

  // waveform of track i in `bins` columns over its loop (or over what is recorded so far)
  overview(i, bins) {
    const t = this.tracks[i];
    const span = t.len || (this.master && t.state === 'rec' ? Math.max(this.master, t.hi) : t.hi);
    const out = new Float32Array(bins), dub = new Float32Array(bins);
    if (!span) return { pk: out, dk: dub, span: 0 };
    const nb = Math.ceil(span / PKB);
    for (let c = 0; c < bins; c++) {
      const a = Math.floor(c * nb / bins), b = Math.max(a + 1, Math.floor((c + 1) * nb / bins));
      let m = 0, d = 0;
      for (let k = a; k < b; k++) { if (t.pk[k] > m) m = t.pk[k]; if (t.dk[k] > d) d = t.dk[k]; }
      out[t.rev ? bins - 1 - c : c] = m; dub[t.rev ? bins - 1 - c : c] = d;
    }
    return { pk: out, dk: dub, span };
  }

  // ---- projects -------------------------------------------------------------------
  // a copy of everything needed to save the session (the loops dry, as recorded)
  snapshot() {
    return {
      master: this.master, masterBars: this.masterBars, bpm: this.bpm, drumOn: this.drumOn, kit: this.kit,
      pattern: Array.from(this.pattern), drumLen: this.drumLen,
      gate: Array.from(this.gate), tune: Array.from(this.tune), level: Array.from(this.level),
      tracks: this.tracks.map(t => ({
        len: t.len, offset: t.len ? mod(t.anchor, t.len) : 0, vol: t.vol, pan: t.pan, rev: t.rev, muted: t.state === 'stop',
        data: t.len ? t.buf.slice(0, t.len) : null,
      })),
    };
  }
  // load a saved session: transport stopped, every track with audio ready to play
  load(p) {
    this.running = false; this.p = 0; this.armed = -1; this.stut = false; this.drumRec = false;
    this.playing.length = 0; this.clicks.length = 0;
    for (let i = 0; i < NTRACKS; i++) {
      const t = this.tracks[i], s = p.tracks[i] || {};
      t.buf.fill(0, 0, Math.max(t.hi, t.len));
      const n = s.data ? Math.min(s.data.length, this.maxLen) : 0;
      if (n) t.buf.set(s.data.subarray(0, n));
      t.len = n; t.hi = n; t.anchor = n ? (s.offset || 0) % n : 0; t.recEnd = -1; t.tail = 0;
      t.vol = s.vol !== undefined ? s.vol : 0.8; t.pan = s.pan || 0; t.rev = !!s.rev;
      t.state = n ? (s.muted ? 'stop' : 'play') : 'empty';
      t.undo = n ? new Float32Array(n) : null; t.undoB = n ? new Float32Array(n) : null; t.canUndoB = false; t.copied = n ? new Uint8Array(Math.ceil(n / CHUNK)).fill(1) : null; t.copyNext = 0;
      t.canUndo = t.canRedo = false; t.dk.fill(0); this.repeak(t);
    }
    this.master = p.master || 0; this.masterBars = p.masterBars || 1; this.bpm = p.bpm || this.bpm;
    this.drumLen = p.drumLen || 16;
    if (p.pattern) {
      this.pattern.fill(0);
      if (p.pattern.length === NVOICES * VSTRIDE) this.pattern.set(p.pattern);
      else for (let v = 0; v < NVOICES; v++) for (let s = 0; s < MAXSTEPS; s++) this.pattern[v * VSTRIDE + s] = p.pattern[v * NSTEPS + s % NSTEPS] || 0;   // older projects: 16 steps
    }
    for (const k of ['gate', 'tune', 'level']) if (p[k]) this[k].set(p[k]);
    if (p.drumOn !== undefined) this.drumOn = !!p.drumOn;
    if (p.kit !== undefined) this.kit = p.kit;
    this.dirty = true;
  }

  clearAll() { for (let i = 0; i < NTRACKS; i++) this.clear(i); this.master = 0; this.masterBars = 1; this.running = false; this.p = 0; }

  trackStop(i) {
    if (i === 3) { this.drumOn = !this.drumOn; this.dirty = true; return; }
    const t = this.tracks[i];
    if (t.state === 'play' || t.state === 'dub') t.state = 'stop';
    else if (t.state === 'stop') t.state = 'play';
    this.dirty = true;
  }

  playButton() {
    if (this.running) {
      // STOP: a recording is closed first (Boss does the same)
      this.tracks.forEach((t, i) => {
        if (t.state === 'rec') { this.finishRecPress(i); if (t.state === 'rec') { const L = t.pendingLen; t.recEnd = -1; this.setLen(i, L); } }
        if (t.state === 'dub') t.state = 'play';
      });
      this.armed = -1; this.running = false; this.stut = false;
    } else {
      this.running = true; this.p = 0; this.lastStep = -1; this.lastBeat = -1;
    }
    this.dirty = true;
  }

  // ---- drums --------------------------------------------------------------------
  pad(v, vel = 1) {
    const s = this.kits[this.kit] && this.kits[this.kit][v];
    if (s) this.triggerVoice(v, s, vel);
    if (this.drumRec && this.running) {
      const sl = this.stepLen(), p = this.p - this.latencyPad();
      const near = this.stepAt(p + sl / 2), idx = v * VSTRIDE + near;   // the nearest step
      if (!this.pattern[idx]) { this.pattern[idx] = 1; this.dirty = true; }
      if (near !== this.stepAt(p)) this.skip[idx] = 1;   // the step is about to play: don't sound it twice
    }
  }
  latencyPad() { return 0; }   // the pads arrive over MIDI with ~1 ms; nothing to take back
  drumRecButton() {
    this.drumRec = !this.drumRec;
    if (this.drumRec) { this.drumUndo = this.pattern.slice(); this.drumRedo = null; if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; } this.drumOn = true; }
    this.dirty = true;
  }
  drumUndoButton() {
    if (this.drumUndo) { const cur = this.pattern.slice(); this.pattern.set(this.drumUndo); this.drumRedo = cur; this.drumUndo = null; }
    else if (this.drumRedo) { const cur = this.pattern.slice(); this.pattern.set(this.drumRedo); this.drumUndo = cur; this.drumRedo = null; }
    this.dirty = true;
  }
  trigger(s, g) { this.triggerVoice(-1, s, g); }
  // a drum sound with its length (gate), pitch and level
  triggerVoice(v, s, g) {
    if (this.playing.length > 24) this.playing.shift();
    const r = v >= 0 ? Math.pow(2, this.tune[v] / 12) : 1;
    const lvl = v >= 0 ? this.level[v] : 1, gate = v >= 0 ? this.gate[v] : 100;
    const len = s.length / r, end = gate >= 100 ? len : Math.max(this.sr * 0.01, len * gate / 100);
    this.playing.push({ s, i: 0, r, g: g * lvl, end, fade: Math.round(this.sr * 0.006) });
  }
  // a 16-step preset (11 x 16), repeated over all 64 steps (so a longer pattern keeps the groove)
  setPreset(a) {
    for (let v = 0; v < NVOICES; v++) for (let s = 0; s < MAXSTEPS; s++) this.pattern[v * VSTRIDE + s] = a[v * NSTEPS + s % NSTEPS] ? 1 : 0;
  }

  // ---- parameters ---------------------------------------------------------------
  set(k, v) {
    switch (k) {
      case 'latency': this.latency = Math.max(0, Math.round(v * this.sr / 1000)); break;
      case 'bpm': if (this.master === 0) this.bpm = Math.min(200, Math.max(50, v)); break;
      case 'vol': this.tracks[v.i].vol = v.v; break;
      case 'pan': this.tracks[v.i].pan = v.v; break;
      case 'rev': this.tracks[v.i].rev = !!v.v; break;
      case 'bits': case 'down':   // { i: channel 0..3, v } or a number for all of them
        if (typeof v === 'number') this[k].fill(v); else this[k][v.i] = v.v;
        break;
      case 'stut':
        if (v && !this.stut && this.running) {
          this.stutLen = Math.max(64, Math.round(this.barLen() / this.stutDiv));
          this.stutStart = mod(this.ringW - this.stutLen, this.ringLen); this.stutK = 0; this.stut = true;
        } else if (!v) this.stut = false;
        break;
      case 'pattern': this.pattern.set(v); break;
      case 'preset': this.setPreset(v); break;
      case 'step': this.pattern[v.v * VSTRIDE + v.s] = v.on ? 1 : 0; break;
      case 'drumLen': this.drumLen = Math.max(1, Math.min(MAXSTEPS, Math.round(v))); break;
      case 'gate': case 'tune': case 'level': this[k][v.v] = v.x; break;   // { v: sound, x }
      case 'kits': this.kits = v; break;
      default: this[k] = v;
    }
    this.dirty = true;
  }

  // ---- audio ----------------------------------------------------------------------
  // input: Float32Array (mono mic) or null; outs: NOUT pairs [L, R] of Float32Array (the block)
  processMulti(input, outs) {
    const n = outs[0][0].length, tr = this.tracks, oL = this.oL, oR = this.oR;
    let mIn = this.meterIn * 0.9, mOut = this.meterOut * 0.9;
    // background copy of undo snapshots (fast, native copies)
    for (const t of tr) if (t.copied && t.copyNext < t.copied.length) {
      for (let c = 0; c < 48 && t.copyNext < t.copied.length; c++, t.copyNext++) if (!t.copied[t.copyNext]) this.copyChunk(t, t.copyNext);
    }
    const bl = this.barLen();
    const crushQ = this.bits.map(b => (b < 16 ? Math.pow(2, b - 1) : 0));
    for (let s = 0; s < n; s++) {
      oL.fill(0); oR.fill(0);
      const x = input ? input[s] * this.inGain : 0;
      const ax = x < 0 ? -x : x; if (ax > mIn) mIn = ax;
      oL[this.monCh] = oR[this.monCh] = x * this.monitor;   // monitor through the selected track's effects
      if (this.running) {
        if (this.armed >= 0 && this.p >= this.armAt) {
          const i = this.armed; this.armed = -1;
          this.beginRec(i, this.armAt); tr[i].gridRec = true;
        }
        for (let i = 0; i < NTRACKS; i++) {
          const t = tr[i];
          if (t.state === 'rec') {
            const w = this.p - t.anchor - this.latency;
            if (w >= 0 && w < this.maxLen) {
              t.buf[w] += x; if (w + 1 > t.hi) t.hi = w + 1;
              const a = t.buf[w] < 0 ? -t.buf[w] : t.buf[w], b = (w / PKB) | 0; if (a > t.pk[b]) { t.pk[b] = a; t.pkDirty = 1; }
            }
            if (t.recEnd >= 0 && this.p >= t.recEnd + this.latency) { this.setLen(i, t.pendingLen); }
            else if (this.p - t.anchor >= this.maxLen) { this.finishRecPress(i); if (t.state === 'rec') this.setLen(i, Math.min(t.pendingLen, this.maxLen)); }
            continue;
          }
          if (t.len === 0) continue;
          const idx = mod(this.p - t.anchor, t.len);
          if (t.state === 'play' || t.state === 'dub') {
            const v = t.buf[t.rev ? t.len - 1 - idx : idx] * t.vol;
            oL[i] += v * (t.pan > 0 ? 1 - t.pan : 1); oR[i] += v * (t.pan < 0 ? 1 + t.pan : 1);
            const av = v < 0 ? -v : v; if (av > t.peak) t.peak = av;
          }
          if (t.state === 'dub' || t.tail > 0) {
            let w = mod(this.p - t.anchor - this.latency, t.len);
            if (t.rev) w = t.len - 1 - w;
            if (t.copied) { const c = (w / CHUNK) | 0; if (!t.copied[c]) this.copyChunk(t, c); }
            t.buf[w] += x;
            if (w + 1 > t.hi) t.hi = w + 1;
            const a = t.buf[w] < 0 ? -t.buf[w] : t.buf[w], b = (w / PKB) | 0; if (a > t.pk[b]) { t.pk[b] = a; t.pkDirty = 1; }
            const ax = x < 0 ? -x : x; if (t.state === 'dub' && ax > t.dk[b]) { t.dk[b] = ax; t.pkDirty = 1; }
            if (t.tail > 0) t.tail--;
          }
        }
        // metronome
        if (this.clickOn) {
          const bt = Math.floor(mod(this.p, bl) / (bl / 4)) % 4;
          if (bt !== this.lastBeat) { this.lastBeat = bt; this.clicks.push({ s: bt === 0 ? this.clickHi : this.clickLo, i: 0, g: this.clickVol }); }
        }
        // drum sequencer
        if (this.drumOn) {
          const st = this.stepAt(this.p);
          if (st !== this.lastStep) {
            this.lastStep = st;
            const kit = this.kits[this.kit];
            if (kit) for (let v = 0; v < NVOICES; v++) {
              const idx = v * VSTRIDE + st;
              if (this.skip[idx]) { this.skip[idx] = 0; continue; }
              if (this.pattern[idx] && kit[v]) this.triggerVoice(v, kit[v], 1);
            }
            this.dirty = true;
          }
        }
        this.p++;
      }
      // drum voices -> channel 3, click -> channel 4
      let d = 0;
      for (let k = this.playing.length - 1; k >= 0; k--) {
        const pv = this.playing[k], pos = pv.i * pv.r, j = pos | 0;
        if (j + 1 >= pv.s.length || pv.i >= pv.end) { this.playing.splice(k, 1); continue; }
        let x = pv.r === 1 ? pv.s[j] : pv.s[j] + (pv.s[j + 1] - pv.s[j]) * (pos - j);   // pitched: linear interpolation
        const left = pv.end - pv.i; if (left < pv.fade) x *= left / pv.fade;              // gate: a short fade, no click
        d += x * pv.g; pv.i++;
      }
      d *= this.drumVol; oL[3] += d; oR[3] += d;
      for (let k = this.clicks.length - 1; k >= 0; k--) {
        const pv = this.clicks[k], c = pv.s[pv.i++] * pv.g;
        oL[4] += c; oR[4] += c;
        if (pv.i >= pv.s.length) this.clicks.splice(k, 1);
      }
      // bitcrusher per channel (sample & hold + quantise)
      for (let c = 0; c < 4; c++) {
        if (this.down[c] > 1) {
          if (this.holdN[c] <= 0) { this.holdL[c] = oL[c]; this.holdR[c] = oR[c]; this.holdN[c] = this.down[c]; }
          this.holdN[c]--; oL[c] = this.holdL[c]; oR[c] = this.holdR[c];
        }
        const q = crushQ[c];
        if (q) { oL[c] = Math.round(oL[c] * q) / q; oR[c] = Math.round(oR[c] * q) / q; }
      }
      // stutter: every channel repeats its last slice
      if (this.stut) {
        const k = this.stutK++ % this.stutLen;
        const j = (this.stutStart + k) % this.ringLen;
        const e = Math.min(k, this.stutLen - 1 - k, 64) / 64;   // short fades, no clicks
        for (let c = 0; c < NOUT; c++) { oL[c] = this.ringL[c][j] * e; oR[c] = this.ringR[c][j] * e; }
      } else {
        for (let c = 0; c < NOUT; c++) { this.ringL[c][this.ringW] = oL[c]; this.ringR[c][this.ringW] = oR[c]; }
        this.ringW = (this.ringW + 1) % this.ringLen;
      }
      let sum = 0;
      for (let c = 0; c < NOUT; c++) { outs[c][0][s] = oL[c]; outs[c][1][s] = oR[c]; sum += oL[c]; }
      const ao = sum < 0 ? -sum : sum; if (ao > mOut) mOut = ao;
    }
    this.meterIn = mIn; this.meterOut = mOut;
  }

  // everything summed into one stereo pair (tests and simple hosts)
  process(input, outL, outR) {
    const n = outL.length;
    if (!this.scratch || this.scratch[0][0].length !== n) this.scratch = Array.from({ length: NOUT }, () => [new Float32Array(n), new Float32Array(n)]);
    this.processMulti(input, this.scratch);
    for (let s = 0; s < n; s++) { let l = 0, r = 0; for (let c = 0; c < NOUT; c++) { l += this.scratch[c][0][s]; r += this.scratch[c][1][s]; } outL[s] = l; outR[s] = r; }
  }

  status(waveFor = -1, bins = 0) {
    let wave = null;
    if (waveFor >= 0 && waveFor < NTRACKS) {
      const t = this.tracks[waveFor];
      if (t.pkDirty || t.pkVer !== this.waveVer || waveFor !== this.waveTrack) {
        t.pkDirty = 0; this.waveVer = t.pkVer; this.waveTrack = waveFor;
        wave = { i: waveFor, ...this.overview(waveFor, bins) };
      }
    }
    return {
      wave,
      running: this.running, p: this.p, master: this.master, bars: this.masterBars, bpm: this.bpm,
      armed: this.armed, step: this.running && this.drumOn ? this.lastStep : -1, drumLen: this.drumLen,
      gate: Array.from(this.gate), tune: Array.from(this.tune), level: Array.from(this.level),
      drumOn: this.drumOn, drumRec: this.drumRec, kit: this.kit, clickOn: this.clickOn,
      canDrumUndo: !!this.drumUndo, canDrumRedo: !!this.drumRedo,
      pattern: Array.from(this.pattern), latency: Math.round(this.latency * 1000 / this.sr),
      meterIn: this.meterIn, meterOut: this.meterOut,
      tracks: this.tracks.map(t => {
        const o = { state: t.state, len: t.len, rec: t.state === 'rec' ? Math.max(0, this.p - t.anchor) : 0, vol: t.vol, pan: t.pan, rev: t.rev,
          canUndo: t.canUndo, canRedo: t.canRedo, peak: t.peak,
          pos: t.len ? mod(this.p - t.anchor, t.len) / t.len : 0, pending: t.recEnd >= 0 };
        t.peak *= 0.5; return o;
      }),
      events: this.events.splice(0),
    };
  }
}

if (typeof module !== 'undefined') module.exports = { LoopEngine, NTRACKS, NVOICES, NSTEPS, NOUT, MAXSTEPS, VSTRIDE };
