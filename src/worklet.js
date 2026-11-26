// AudioWorklet wrapper around LoopEngine (engine.js is prepended to this file when the page is built)
class LoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.e = new LoopEngine(sampleRate);
    this.n = 0;
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
    }
    this.port.postMessage(e.status());
  }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0].length ? inputs[0][0] : null;
    const o = outputs[0];
    this.e.process(inp, o[0], o[1] || o[0]);
    if (++this.n % 10 === 0) this.port.postMessage(this.e.status());
    return true;
  }
}
registerProcessor('loop-engine', LoopProcessor);
