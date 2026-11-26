// FM-1 Loop Station: audio engine.
// Runs inside an AudioWorklet (one instance), and in Node for the tests.
// Mono loop tracks (the phone microphone), a 16-step drum machine, bitcrusher and stutter on the sum.

const NTRACKS = 3, NVOICES = 11, NSTEPS = 16;
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
        buf: new Float32Array(this.maxLen), undo: null, copied: null, copyNext: 0,
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
    this.pattern = new Uint8Array(NVOICES * NSTEPS);
    this.drumUndo = null; this.drumRedo = null;
    this.kits = [];           // kits[k][v] = Float32Array
    this.kit = 0;
    this.playing = [];        // {s: Float32Array, i, g}
    this.lastStep = -1; this.skip = new Uint8Array(NVOICES * NSTEPS);
    // fx on the sum
    this.bits = 16; this.down = 1; this.holdL = 0; this.holdR = 0; this.holdN = 0;
    this.ringLen = Math.floor(sr * 2); this.ringL = new Float32Array(this.ringLen); this.ringR = new Float32Array(this.ringLen); this.ringW = 0;
    this.stut = false; this.stutDiv = 16; this.stutStart = 0; this.stutLen = 0; this.stutK = 0;
    this.meterIn = 0; this.meterOut = 0;
    this.events = [];         // messages for the UI (finished recording etc.)
    this.dirty = true;
  }

  // ---- timing ------------------------------------------------------------------
  barLen() { return this.master > 0 ? this.master / this.masterBars : this.sr * 240 / this.bpm; }
  stepLen() { return this.barLen() / NSTEPS; }
  currentStep() { return Math.floor(mod(this.p, this.barLen()) / this.stepLen()) % NSTEPS; }

  // ---- commands from the UI ----------------------------------------------------
  // REC button on track i (Boss cycle: empty -> REC -> DUB (or PLAY) -> PLAY -> DUB ...)
  recButton(i) {
    const t = this.tracks[i];
    if (this.armed === i) { this.armed = -1; this.dirty = true; return; }   // second press while waiting: cancel
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
    const grid = this.master === 0 && this.drumOn;   // the rhythm is on: the loop starts on a bar line
    if (this.master === 0 && !grid) {
      if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; }
      // a running transport without a loop (drums off): the loop starts now
      this.beginRec(i, this.p);
      t.gridRec = false;
      return;
    }
    if (grid) {
      if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; }
      const bl = this.barLen();
      this.armed = i; this.armAt = Math.ceil(this.p / bl - 1e-9) * bl; this.armGrid = true;
      if (this.armAt - this.p < 1) this.armAt = this.p;
      return;
    }
    // a loop exists: record now, the length becomes a multiple of the loop
    if (!this.running) { this.running = true; this.p = 0; this.lastStep = -1; }
    this.beginRec(i, Math.floor(this.p / this.master) * this.master);
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
    const unit = this.master > 0 ? this.master : this.barLen();
    const k = Math.max(1, Math.round(n / unit));
    len = Math.round(k * unit);
    if (this.master === 0) {   // first loop on the drum grid
      this.masterBars = k; this.master = len;
      this.events.push({ t: 'loop', len, bars: k, bpm: this.bpm });
    }
    if (n >= len) this.setLen(i, len);
    else { t.recEnd = t.anchor + len; t.pendingLen = len; }   // keep recording to the end of the bar / loop
  }

  setLen(i, len) {
    const t = this.tracks[i];
    t.len = len; t.recEnd = -1;
    if (t.hi > len) { t.buf.fill(0, len, t.hi); t.hi = len; this.repeak(t); }
    t.undo = new Float32Array(len); t.copied = new Uint8Array(Math.ceil(len / CHUNK)); t.copied.fill(1); t.copyNext = 0;
    t.canUndo = false; t.canRedo = false;
    if (this.recToDub) this.startDub(i, true);
    else { t.state = 'play'; t.tail = this.latency; }
    this.dirty = true;
  }

  startDub(i, fromRec) {
    const t = this.tracks[i];
    if (t.len === 0) return;
    // snapshot for UNDO: copy-on-write, chunk by chunk, the rest in the background
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

  clear(i) {
    if (i === 3) { this.pattern.fill(0); this.dirty = true; return; }
    const t = this.tracks[i];
    if (this.armed === i) this.armed = -1;
    t.buf.fill(0, 0, Math.max(t.hi, t.len)); t.pk.fill(0); t.dk.fill(0); t.pkVer++;
    t.state = 'empty'; t.len = 0; t.hi = 0; t.recEnd = -1; t.tail = 0; t.undo = null; t.copied = null;
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
      this.running = true; this.p = 0; this.lastStep = -1;
    }
    this.dirty = true;
  }

  // ---- drums --------------------------------------------------------------------
  pad(v, vel = 1) {
    const s = this.kits[this.kit] && this.kits[this.kit][v];
    if (s) this.trigger(s, vel);
    if (this.drumRec && this.running) {
      const sl = this.stepLen();
      const pos = mod(this.p - this.latencyPad(), this.barLen());
      let st = Math.round(pos / sl) % NSTEPS;
      const idx = v * NSTEPS + st;
      if (!this.pattern[idx]) { this.pattern[idx] = 1; this.dirty = true; }
      // the step is about to play: don't sound it twice
      const cur = Math.floor(pos / sl) % NSTEPS;
      if (st !== cur) this.skip[idx] = 1;
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
  trigger(s, g) {
    if (this.playing.length > 24) this.playing.shift();
    this.playing.push({ s, i: 0, g });
  }

  // ---- parameters ---------------------------------------------------------------
  set(k, v) {
    switch (k) {
      case 'latency': this.latency = Math.max(0, Math.round(v * this.sr / 1000)); break;
      case 'bpm': if (this.master === 0) this.bpm = Math.min(200, Math.max(50, v)); break;
      case 'vol': this.tracks[v.i].vol = v.v; break;
      case 'pan': this.tracks[v.i].pan = v.v; break;
      case 'rev': this.tracks[v.i].rev = !!v.v; break;
      case 'stut':
        if (v && !this.stut && this.running) {
          this.stutLen = Math.max(64, Math.round(this.barLen() / this.stutDiv));
          this.stutStart = mod(this.ringW - this.stutLen, this.ringLen); this.stutK = 0; this.stut = true;
        } else if (!v) this.stut = false;
        break;
      case 'pattern': this.pattern.set(v); break;
      case 'step': this.pattern[v.v * NSTEPS + v.s] = v.on ? 1 : 0; break;
      case 'kits': this.kits = v; break;
      default: this[k] = v;
    }
    this.dirty = true;
  }

  // ---- audio ----------------------------------------------------------------------
  // input: Float32Array (mono mic) or null; outL/outR: Float32Array of the block
  process(input, outL, outR) {
    const n = outL.length, tr = this.tracks;
    let mIn = this.meterIn * 0.9, mOut = this.meterOut * 0.9;
    // background copy of undo snapshots (fast, native copies)
    for (const t of tr) if (t.copied && t.copyNext < t.copied.length) {
      for (let c = 0; c < 48 && t.copyNext < t.copied.length; c++, t.copyNext++) if (!t.copied[t.copyNext]) this.copyChunk(t, t.copyNext);
    }
    const bl = this.barLen(), sl = bl / NSTEPS, crushQ = this.bits < 16 ? Math.pow(2, this.bits - 1) : 0;
    for (let s = 0; s < n; s++) {
      const x = input ? input[s] * this.inGain : 0;
      const ax = x < 0 ? -x : x; if (ax > mIn) mIn = ax;
      let L = x * this.monitor, R = L;
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
            L += v * (t.pan > 0 ? 1 - t.pan : 1); R += v * (t.pan < 0 ? 1 + t.pan : 1);
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
        // drum sequencer
        if (this.drumOn) {
          const st = Math.floor(mod(this.p, bl) / sl) % NSTEPS;
          if (st !== this.lastStep) {
            this.lastStep = st;
            const kit = this.kits[this.kit];
            if (kit) for (let v = 0; v < NVOICES; v++) {
              const idx = v * NSTEPS + st;
              if (this.skip[idx]) { this.skip[idx] = 0; continue; }
              if (this.pattern[idx] && kit[v]) this.trigger(kit[v], 1);
            }
            this.dirty = true;
          }
        }
        this.p++;
      }
      // drum voices
      let d = 0;
      for (let k = this.playing.length - 1; k >= 0; k--) {
        const pv = this.playing[k];
        d += pv.s[pv.i++] * pv.g;
        if (pv.i >= pv.s.length) this.playing.splice(k, 1);
      }
      d *= this.drumVol; L += d; R += d;
      // bitcrusher (sample & hold + quantise)
      if (this.down > 1) {
        if (this.holdN <= 0) { this.holdL = L; this.holdR = R; this.holdN = this.down; }
        this.holdN--; L = this.holdL; R = this.holdR;
      }
      if (crushQ) { L = Math.round(L * crushQ) / crushQ; R = Math.round(R * crushQ) / crushQ; }
      // stutter: repeat the last slice of the output
      if (this.stut) {
        const k = this.stutK++ % this.stutLen;
        const j = (this.stutStart + k) % this.ringLen;
        const e = Math.min(k, this.stutLen - 1 - k, 64) / 64;   // short fades, no clicks
        L = this.ringL[j] * e; R = this.ringR[j] * e;
      } else {
        this.ringL[this.ringW] = L; this.ringR[this.ringW] = R; this.ringW = (this.ringW + 1) % this.ringLen;
      }
      outL[s] = L; outR[s] = R;
      const ao = L < 0 ? -L : L; if (ao > mOut) mOut = ao;
    }
    this.meterIn = mIn; this.meterOut = mOut;
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
      armed: this.armed, step: this.running && this.drumOn ? this.lastStep : -1,
      drumOn: this.drumOn, drumRec: this.drumRec, kit: this.kit,
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

if (typeof module !== 'undefined') module.exports = { LoopEngine, NTRACKS, NVOICES, NSTEPS };
