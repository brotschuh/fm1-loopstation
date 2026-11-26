// One effect chain (filter -> chorus -> dry + delay + reverb) on any AudioContext, live or offline,
// so an export sounds like what you heard. The bitcrusher is not here: it runs in the engine (live)
// or on the samples before the chain (export, FXChain.crush).
const FXChain = (() => {
  const DLY_DIV = [0.25, 0.5, 0.75, 1, 1.5, 2];   // beats: 1/16, 1/8, 1/8., 1/4, 1/4., 1/2

  function impulse(ctx, sec) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * sec)), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5); }
    return b;
  }

  function make(ctx, dest) {
    const f = {};
    f.input = ctx.createGain();
    f.filter = ctx.createBiquadFilter();
    f.choDry = ctx.createGain(); f.choWet = ctx.createGain(); f.choDel = ctx.createDelay(0.1); f.choDel.delayTime.value = 0.018;
    f.lfo = ctx.createOscillator(); f.lfoAmt = ctx.createGain(); f.lfo.connect(f.lfoAmt); f.lfoAmt.connect(f.choDel.delayTime); f.lfo.start();
    f.mix = ctx.createGain();
    f.dSend = ctx.createGain(); f.delay = ctx.createDelay(3); f.dFb = ctx.createGain(); f.dTone = ctx.createBiquadFilter();
    f.rSend = ctx.createGain(); f.conv = ctx.createConvolver(); f.rPre = ctx.createDelay(0.2); f.rDamp = ctx.createBiquadFilter();
    f.input.connect(f.filter);
    f.filter.connect(f.choDry); f.filter.connect(f.choDel); f.choDel.connect(f.choWet);
    f.choDry.connect(f.mix); f.choWet.connect(f.mix);
    f.mix.connect(dest);
    f.mix.connect(f.dSend); f.dSend.connect(f.delay); f.delay.connect(f.dTone); f.dTone.connect(f.dFb); f.dFb.connect(f.delay); f.dTone.connect(dest);
    f.mix.connect(f.rSend); f.rSend.connect(f.rPre); f.rPre.connect(f.conv); f.conv.connect(f.rDamp); f.rDamp.connect(dest);
    return f;
  }

  // one setting k of the chain f from the settings S2 (the per-track values), bpm for the delay time
  function set(ctx, f, k, S2, bpm, instant) {
    const v = S2[k], now = ctx.currentTime;
    const put = (prm, x) => { if (instant) prm.value = x; else prm.setTargetAtTime(x, now, 0.02); };
    switch (k) {
      case 'dlyMix': put(f.dSend.gain, v / 100 * 0.8); break;
      case 'dlyDiv': put(f.delay.delayTime, Math.min(2.9, 60 / bpm * DLY_DIV[v])); break;
      case 'dlyFb': put(f.dFb.gain, v / 100); break;
      case 'dlyTone': put(f.dTone.frequency, 800 * Math.pow(2, v / 100 * 4)); break;
      case 'rev': put(f.rSend.gain, v / 100 * 0.9); break;
      case 'revSize': f.conv.buffer = impulse(ctx, 0.4 + v / 100 * 4); break;
      case 'revDamp': put(f.rDamp.frequency, 18000 * Math.pow(2, -v / 100 * 3.2)); break;
      case 'revPre': put(f.rPre.delayTime, v / 1000); break;
      case 'choMix': put(f.choWet.gain, v / 100); put(f.choDry.gain, 1 - v / 200); break;
      case 'choDepth': put(f.lfoAmt.gain, 0.0005 + v / 100 * 0.006); break;
      case 'choRate': put(f.lfo.frequency, 0.1 + v / 100 * 4.9); break;
      case 'filt': case 'res': {
        const fl = S2.filt, q = 0.7 + S2.res / 100 * 14;
        if (fl <= 0) { f.filter.type = 'lowpass'; put(f.filter.frequency, fl === 0 ? 22000 : 20000 * Math.pow(2, fl / 100 * 9)); }
        else { f.filter.type = 'highpass'; put(f.filter.frequency, 20 * Math.pow(2, fl / 100 * 9)); }
        put(f.filter.Q, fl === 0 ? 0.7 : q); break;
      }
    }
  }
  const KEYS = ['dlyMix', 'dlyDiv', 'dlyFb', 'dlyTone', 'rev', 'revSize', 'revDamp', 'revPre', 'choMix', 'choDepth', 'choRate', 'filt'];
  function setAll(ctx, f, S2, bpm, instant) { for (const k of KEYS) set(ctx, f, k, S2, bpm, instant); }

  // the engine's bitcrusher on a block of samples (sample & hold, then quantise), in place
  function crush(arrs, bits, down) {
    if (bits >= 16 && down <= 1) return;
    const q = bits < 16 ? Math.pow(2, bits - 1) : 0;
    for (const a of arrs) {
      let hold = 0, left = 0;
      for (let i = 0; i < a.length; i++) {
        if (down > 1) { if (left <= 0) { hold = a[i]; left = down; } left--; a[i] = hold; }
        if (q) a[i] = Math.round(a[i] * q) / q;
      }
    }
  }

  function master(ctx, dest, gain) {
    const g = ctx.createGain(), lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    g.gain.value = gain; g.connect(lim); lim.connect(dest);
    return { input: g, gain: g, lim };
  }

  return { make, set, setAll, crush, master, impulse };
})();

if (typeof module !== 'undefined') module.exports = FXChain;
