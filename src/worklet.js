// AudioWorklet wrapper around LoopEngine (engine.js is prepended to this file when the page is built)
class LoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.e = new LoopEngine(sampleRate);
    this.n = 0; this.waveFor = -1; this.bins = 400;
    this.port.onmessage = m => this.cmd(m.data);
  }
  cmd(m) {
    const e = this.e;
    switch (m.t) {
      case 'rec': e.recButton(m.i); break;
      case 'play': e.playButton(); break;
      case 'stop': e.trackStop(m.i); break;
      case 'undo': e.undoButton(m.i); break;
      case 'clear': e.clear(m.i); break;
      case 'clearAll': e.clearAll(); break;
      case 'pad': e.pad(m.v, m.g || 1); break;
      case 'drumRec': e.drumRecButton(); break;
      case 'set': e.set(m.k, m.v); break;
      case 'wave': this.waveFor = m.i; this.bins = m.bins || 400; e.waveVer = -1; break;
      case 'snapshot': {   // reply on its own, with the audio transferred (no copy on the way)
        const snap = e.snapshot();
        this.port.postMessage({ t: 'snapshot', id: m.id, snap }, snap.tracks.filter(x => x.data).map(x => x.data.buffer));
        return;
      }
      case 'load': e.load(m.p); e.waveVer = -1; break;
    }
    this.port.postMessage(e.status(this.waveFor, this.bins));
  }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0].length ? inputs[0][0] : null;
    this.e.processMulti(inp, outputs.map(o => [o[0], o[1] || o[0]]));
    if (++this.n % 10 === 0) this.port.postMessage(this.e.status(this.n % 40 === 0 ? this.waveFor : -1, this.bins));
    return true;
  }
}
registerProcessor('loop-engine', LoopProcessor);

// Live recording: a tap on the master output; while on, it hands the samples to the page in chunks
class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.on = false; this.n = 0; this.L = new Float32Array(128 * 64); this.R = new Float32Array(128 * 64);
    this.port.onmessage = m => { this.on = !!m.data.on; if (!this.on) this.flush(); };
  }
  flush() { if (this.n) { const L = this.L.slice(0, this.n), R = this.R.slice(0, this.n); this.port.postMessage({ L, R }, [L.buffer, R.buffer]); this.n = 0; } }
  process(inputs) {
    const i = inputs[0];
    if (this.on && i && i.length) {
      const l = i[0], r = i[1] || i[0];
      this.L.set(l, this.n); this.R.set(r, this.n); this.n += l.length;
      if (this.n + 128 > this.L.length) this.flush();
    }
    return true;
  }
}
registerProcessor('tap', TapProcessor);
