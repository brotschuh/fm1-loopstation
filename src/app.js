// FM-1 Loop Station: the page (phone or computer). Engine in an AudioWorklet, effects as Web Audio nodes,
// the FM-1 as keys, knobs, LEDs and a second screen over USB MIDI.
{
const $ = s => document.querySelector(s);
const TRACK_NAMES = ['1', '2', '3', 'DR'];
const DLY_DIV = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];
const STUT_DIV = [4, 8, 16, 32];
const STATE_DE = { empty: 'LEER', rec: 'REC', dub: 'DUB', play: 'PLAY', stop: 'STOP' };

// ---- settings (remembered on this device) ---------------------------------------------
const DEF = { dlyMix: 0, dlyDiv: 2, dlyFb: 35, rev: 0, filt: 0, res: 10, bits: 16, down: 1, choMix: 0, choDepth: 50,
  stutDiv: 2, revSize: 50, bpm: 100, pat: 0, kit: 0, drumVol: 80, inGain: 100, mon: 100, lat: -1, master: 90,
  recToDub: 1, micId: '', outId: '', ledAll: 1, v: 2 };
let S = { ...DEF };
try { const o = JSON.parse(localStorage.getItem('fm1loop') || '{}'); if (o.v === 2) Object.assign(S, o); else Object.assign(S, o, { kit: 0, pat: 0, v: 2, ledAll: 1 }); } catch (e) { }
const voiceNames = () => KIT_VOICES[S.kit];
const save = () => { try { localStorage.setItem('fm1loop', JSON.stringify(S)); } catch (e) { } };

let ctx = null, node = null, st = null, kits = null, mic = null, micSrc = null;
let sel = 0, page = 'FX', voice = 0;
const fx = {};

// ---- pages: four parameters each, the same on the phone and on K1..K4 of the FM-1 ---------
const P = (id, label, min, max, step, fmt) => ({ id, label, min, max, step, fmt: fmt || (v => String(v)) });
const PAGES = {
  FX: { name: 'DELAY + HALL', btn: 2, p: [P('dlyMix', 'DELAY', 0, 100, 2), P('dlyDiv', 'ZEIT', 0, 5, 1, v => DLY_DIV[v][0]), P('dlyFb', 'FEEDBACK', 0, 90, 2), P('rev', 'HALL', 0, 100, 2)] },
  CRUSH: { name: 'FILTER + BITCRUSH', btn: 4, p: [P('filt', 'FILTER', -100, 100, 4, v => v === 0 ? 'AUS' : v < 0 ? 'TP ' + (-v) : 'HP ' + v), P('res', 'RESONANZ', 0, 100, 4), P('bits', 'BITCRUSH', 2, 16, 1, v => v >= 16 ? 'AUS' : v + ' BIT'), P('down', 'SAMPLERATE', 1, 32, 1, v => v === 1 ? 'AUS' : '1/' + v)] },
  MOD: { name: 'CHORUS + STUTTER', btn: 5, p: [P('choMix', 'CHORUS', 0, 100, 2), P('choDepth', 'TIEFE', 0, 100, 2), P('stutDiv', 'STUTTER', 0, 3, 1, v => '1/' + STUT_DIV[v]), P('revSize', 'HALLRAUM', 0, 100, 5)] },
  SPUR: { name: 'SPUR', btn: 6, p: [P('tVol', 'LAUTST.', 0, 100, 2), P('tPan', 'PANORAMA', -100, 100, 5, v => v === 0 ? 'MITTE' : (v < 0 ? 'L ' + (-v) : 'R ' + v)), P('tRev', 'RUECKW.', 0, 1, 1, v => v ? 'AN' : 'AUS'), P('recToDub', 'NACH REC', 0, 1, 1, v => v ? 'DUB' : 'PLAY')] },
  DRUMS: { name: 'DRUMS', btn: 11, p: [P('bpm', 'TEMPO', 50, 200, 1, v => Math.round(v) + ''), P('pat', 'MUSTER', 0, PATTERNS.length - 1, 1, v => PATTERNS[v].name), P('kit', 'KIT', 0, KITS.length - 1, 1, v => KITS[v].split(' ')[0]), P('drumVol', 'DRUM VOL', 0, 100, 2)] },
  MIKRO: { name: 'MIKRO + AUSGANG', btn: 7, p: [P('inGain', 'EINGANG', 0, 200, 5), P('mon', 'MITHOEREN', 0, 100, 5), P('lat', 'LATENZ', 0, 400, 2, v => v + 'ms'), P('ledAll', 'TASTENLICHT', 0, 1, 1, v => v ? 'IMMER AN' : 'STATUS')] },
};
const PAGE_KEYS = Object.keys(PAGES);

function getP(id) {
  const t = st && sel < 3 ? st.tracks[sel] : null;
  if (id === 'tVol') return t ? Math.round(t.vol * 100) : 80;
  if (id === 'tPan') return t ? Math.round(t.pan * 100) : 0;
  if (id === 'tRev') return t && t.rev ? 1 : 0;
  if (id === 'bpm') return st ? Math.round(st.bpm) : S.bpm;
  return S[id];
}
function setP(id, v) {
  const p = Object.values(PAGES).flatMap(g => g.p).find(x => x.id === id);
  v = Math.max(p.min, Math.min(p.max, v));
  if (id === 'tVol' || id === 'tPan' || id === 'tRev') {
    if (sel > 2) return;
    const k = { tVol: 'vol', tPan: 'pan', tRev: 'rev' }[id];
    send({ t: 'set', k, v: { i: sel, v: id === 'tRev' ? v : v / 100 } });
    if (st) st.tracks[sel][k] = id === 'tRev' ? !!v : v / 100;
  } else {
    if (id === 'bpm' && st && st.master > 0) { toast('Tempo kommt vom Loop'); return; }
    S[id] = v; save(); applyParam(id);
  }
  renderParams(); drawParam(id);
}

// ---- audio --------------------------------------------------------------------------------
function send(m) { if (node) node.port.postMessage(m); }

function impulse(sec) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5); }
  return b;
}

async function startAudio() {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  const src = document.getElementById('worklet-src').textContent;
  // blob: works on a web server; a page opened as a file (origin null) needs a data: URL
  try { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))); }
  catch (e) { await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(src)); }
  node = new AudioWorkletNode(ctx, 'loop-engine', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit' });
  node.port.onmessage = m => onStatus(m.data);
  // effect chain: filter -> chorus -> (dry, delay, hall) -> master
  fx.filter = ctx.createBiquadFilter();
  fx.choDry = ctx.createGain(); fx.choWet = ctx.createGain(); fx.choDel = ctx.createDelay(0.1); fx.choDel.delayTime.value = 0.018;
  fx.lfo = ctx.createOscillator(); fx.lfo.frequency.value = 0.7; fx.lfoAmt = ctx.createGain(); fx.lfo.connect(fx.lfoAmt); fx.lfoAmt.connect(fx.choDel.delayTime); fx.lfo.start();
  fx.mix = ctx.createGain();
  fx.dSend = ctx.createGain(); fx.delay = ctx.createDelay(3); fx.dFb = ctx.createGain(); fx.dTone = ctx.createBiquadFilter(); fx.dTone.frequency.value = 4500;
  fx.rSend = ctx.createGain(); fx.conv = ctx.createConvolver();
  fx.master = ctx.createGain(); fx.lim = ctx.createDynamicsCompressor(); fx.lim.threshold.value = -3; fx.lim.ratio.value = 20; fx.lim.attack.value = 0.002; fx.lim.release.value = 0.1;
  node.connect(fx.filter);
  fx.filter.connect(fx.choDry); fx.filter.connect(fx.choDel); fx.choDel.connect(fx.choWet);
  fx.choDry.connect(fx.mix); fx.choWet.connect(fx.mix);
  fx.mix.connect(fx.master);
  fx.mix.connect(fx.dSend); fx.dSend.connect(fx.delay); fx.delay.connect(fx.dTone); fx.dTone.connect(fx.dFb); fx.dFb.connect(fx.delay); fx.dTone.connect(fx.master);
  fx.mix.connect(fx.rSend); fx.rSend.connect(fx.conv); fx.conv.connect(fx.master);
  fx.master.connect(fx.lim); fx.lim.connect(ctx.destination);
  if (S.lat < 0) S.lat = Math.round(((ctx.baseLatency || 0.01) + (ctx.outputLatency || 0.02)) * 1000 + 15);
  for (const k of Object.keys(DEF)) applyParam(k);
  // drums
  kits = [await decodeRock(), ...makeKits(ctx.sampleRate)];
  send({ t: 'set', k: 'kits', v: kits });
  send({ t: 'set', k: 'pattern', v: patternArray(S.pat) });
  await openMic();
  await listDevices();
  if (S.outId) setOutput(S.outId);
  try { await navigator.wakeLock.request('screen'); } catch (e) { }
}

function applyParam(k) {
  if (!ctx) return;
  const v = S[k], now = ctx.currentTime, set = (prm, x) => prm.setTargetAtTime(x, now, 0.02);
  const beat = () => 60 / (st ? st.bpm : S.bpm);
  switch (k) {
    case 'dlyMix': set(fx.dSend.gain, v / 100 * 0.8); break;
    case 'dlyDiv': case 'bpm': set(fx.delay.delayTime, Math.min(2.9, beat() * DLY_DIV[S.dlyDiv][1])); if (k === 'bpm') send({ t: 'set', k: 'bpm', v }); break;
    case 'dlyFb': set(fx.dFb.gain, v / 100); break;
    case 'rev': set(fx.rSend.gain, v / 100 * 0.9); break;
    case 'revSize': fx.conv.buffer = impulse(0.4 + v / 100 * 4); break;
    case 'filt': case 'res': {
      const f = S.filt, q = 0.7 + S.res / 100 * 14;
      if (f <= 0) { fx.filter.type = 'lowpass'; set(fx.filter.frequency, f === 0 ? 22000 : 20000 * Math.pow(2, f / 100 * 9)); }
      else { fx.filter.type = 'highpass'; set(fx.filter.frequency, 20 * Math.pow(2, f / 100 * 9)); }
      set(fx.filter.Q, f === 0 ? 0.7 : q); break;
    }
    case 'bits': send({ t: 'set', k: 'bits', v }); break;
    case 'down': send({ t: 'set', k: 'down', v }); break;
    case 'choMix': set(fx.choWet.gain, v / 100); set(fx.choDry.gain, 1 - v / 200); break;
    case 'choDepth': set(fx.lfoAmt.gain, 0.0005 + v / 100 * 0.006); break;
    case 'stutDiv': send({ t: 'set', k: 'stutDiv', v: STUT_DIV[v] }); break;
    case 'pat': send({ t: 'set', k: 'pattern', v: patternArray(v) }); break;
    case 'kit': send({ t: 'set', k: 'kit', v }); $('#grid').innerHTML = ''; renderGrid(); break;
    case 'ledAll': lastLed = -1n; updateLeds(); break;
    case 'drumVol': send({ t: 'set', k: 'drumVol', v: v / 100 }); break;
    case 'inGain': send({ t: 'set', k: 'inGain', v: v / 100 }); break;
    case 'mon': send({ t: 'set', k: 'monitor', v: v / 100 }); break;
    case 'lat': send({ t: 'set', k: 'latency', v }); break;
    case 'master': set(fx.master.gain, Math.pow(v / 100, 2) * 1.2); break;
    case 'recToDub': send({ t: 'set', k: 'recToDub', v: !!v }); break;
  }
}

async function decodeRock() {
  const out = [];
  for (const b64 of ROCK_KIT.flac) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const buf = await ctx.decodeAudioData(u.buffer);
    out.push(buf.getChannelData(0).slice());
  }
  return out;
}

async function openMic() {
  if (mic) mic.getTracks().forEach(t => t.stop());
  if (micSrc) micSrc.disconnect();
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  if (S.micId) audio.deviceId = { exact: S.micId };
  try { mic = await navigator.mediaDevices.getUserMedia({ audio }); }
  catch (e) {
    if (S.micId) { S.micId = ''; return openMic(); }
    toast('Kein Mikrofon: ' + e.message); return;
  }
  // the FM-1 is also an audio input (its own output): never record that, it would feed back
  const label = mic.getAudioTracks()[0].label || '';
  const FM1RE = /fm-?1|felucca|sampler|m-?vave|usb/i;   // on a phone the FM-1 often shows up as just "USB audio"
  if (!S.micId && FM1RE.test(label)) {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && !FM1RE.test(d.label) && d.deviceId !== 'default');
    if (devs.length) { S.micId = devs[0].deviceId; return openMic(); }
  }
  micSrc = ctx.createMediaStreamSource(mic);
  micSrc.connect(node);
  $('#micName').textContent = label || 'Mikrofon';
}

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const mics = devs.filter(d => d.kind === 'audioinput'), outs = devs.filter(d => d.kind === 'audiooutput');
  $('#selMic').innerHTML = mics.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Mikrofon')}</option>`).join('');
  const curMic = mic && mic.getAudioTracks()[0].getSettings().deviceId;
  if (curMic) $('#selMic').value = curMic;
  if (ctx.setSinkId && outs.length) {
    $('#outRow').hidden = false;
    $('#selOut').innerHTML = '<option value="">Standard</option>' + outs.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Ausgang')}</option>`).join('');
    // on a computer: play through the FM-1 if it is there
    if (!S.outId) { const f = outs.find(d => /fm-?1|felucca|sampler|m-?vave/i.test(d.label)); if (f) { S.outId = f.deviceId; setOutput(f.deviceId); } }
    $('#selOut').value = S.outId;
  }
}
async function setOutput(id) { try { await ctx.setSinkId(id); S.outId = id; save(); } catch (e) { toast('Ausgang nicht verfuegbar'); } }

// ---- engine status -> UI, FM-1 screen and LEDs ------------------------------------------------
let lastSig = '', lastLed = -1n, lastProg = 0, lastPat = '';
function onStatus(s) {
  const prev = st; st = s;
  for (const ev of s.events) if (ev.t === 'loop') { toast(`Loop: ${ev.bars} Takt${ev.bars > 1 ? 'e' : ''}, ${Math.round(ev.bpm)} BPM`); applyParam('dlyDiv'); }
  const sig = JSON.stringify([s.tracks.map(t => [t.state, t.pending, t.canUndo, t.canRedo]), s.running, s.armed, s.drumOn, s.drumRec, sel, page, Math.round(s.bpm), s.master > 0]);
  if (sig !== lastSig) { lastSig = sig; renderTracks(); drawScreen(); renderParams(); }
  const pat = s.pattern.join('');
  if (pat !== lastPat) { lastPat = pat; renderGrid(); }
  updateMeters();
  updateLeds();
  const now = performance.now();
  if (now - lastProg > 140) { lastProg = now; drawProgress(); }
  if (!prev || prev.step !== s.step) markStep(s.step);
}

// ---- FM-1 ------------------------------------------------------------------------------------
const link = new FM1.Link();
const C = { bg: 0, fg: FM1.rgb(235, 235, 235), dim: FM1.rgb(110, 110, 110), dark: FM1.rgb(40, 40, 40), accent: FM1.rgb(255, 150, 0),
  rec: FM1.rgb(255, 30, 30), dub: FM1.rgb(255, 150, 0), play: FM1.rgb(30, 210, 70), stop: FM1.rgb(20, 90, 40), drum: FM1.rgb(40, 130, 255) };
function tileColor(i) {
  if (i === 3) return st.drumRec ? C.rec : st.drumOn ? C.drum : C.dark;
  if (st.armed === i) return C.rec;
  const t = st.tracks[i]; return { empty: C.dark, rec: C.rec, dub: C.dub, play: C.play, stop: C.stop }[t.state];
}
function bigWord() {
  if (sel === 3) return st.drumRec ? 'D-REC' : st.drumOn ? (st.running ? 'DRUMS' : 'BEREIT') : 'AUS';
  if (st.armed === sel) return 'WARTE';
  const t = st.tracks[sel];
  if (t.state === 'empty') return st.running ? 'REC?' : 'LEER';
  return STATE_DE[t.state];
}
function drawScreen() {
  if (!link.connected || !st) return;
  const o = FM1.op, ops = [o.clear(C.bg)];
  ops.push(o.text(6, 6, 2, C.accent, C.bg, 'LOOP STATION'));
  ops.push(o.text(168, 6, 2, C.fg, C.bg, String(Math.round(st.bpm)).padStart(3) + (st.master > 0 ? '*' : ' ')));
  for (let i = 0; i < 4; i++) {
    const x = 6 + i * 58, y = 30, c = tileColor(i);
    if (i === sel) ops.push(o.rect(x - 3, y - 3, 56, 62, C.fg));
    ops.push(o.rect(x, y, 50, 56, c));
    const lbl = TRACK_NAMES[i];
    ops.push(o.text(x + 25 - lbl.length * 9, y + 16, 3, c === C.dark ? C.dim : C.bg, c, lbl));
  }
  const w = bigWord();
  ops.push(o.text(Math.max(0, 120 - w.length * 12), 100, 4, C.fg, C.bg, w));
  ops.push(o.rect(6, 142, 228, 10, C.dark));
  const pg = PAGES[page];
  ops.push(o.text(6, 160, 2, C.accent, C.bg, pg.name.slice(0, 19)));
  link.draw(ops, 'screen');
  pg.p.forEach(p => drawParam(p.id));
  drawProgress(true);
}
function drawParam(id) {
  if (!link.connected || !st) return;
  const pg = PAGES[page], i = pg.p.findIndex(p => p.id === id);
  if (i < 0) return;
  const p = pg.p[i], x = 6 + (i % 2) * 118, y = 182 + Math.floor(i / 2) * 29, o = FM1.op;
  const val = p.fmt(getP(id)).slice(0, 9).padEnd(9);
  link.draw([o.text(x, y, 1, C.dim, C.bg, ('K' + (i + 1) + ' ' + p.label).padEnd(19)), o.text(x, y + 10, 2, C.fg, C.bg, val)], 'p' + id);
}
function drawProgress(force) {
  if (!link.connected || !st || (link.backlog() > 3 && !force)) return;
  let f = 0, c = C.play;
  const t = sel < 3 ? st.tracks[sel] : null;
  if (t && t.state === 'rec') { f = st.master ? (t.rec % st.master) / st.master : Math.min(1, t.rec / (ctx.sampleRate * 8)); c = C.rec; }
  else if (t && t.len) { f = t.pos; c = t.state === 'dub' ? C.dub : C.play; }
  else if (sel === 3 && st.step >= 0) { f = (st.step + 1) / 16; c = C.drum; }
  const w = Math.round(f * 228), o = FM1.op;
  link.draw([o.rect(6, 142, Math.max(1, w), 10, c), o.rect(6 + w, 142, Math.max(1, 228 - w), 10, C.dark)], 'prog');
}
const USED_BTNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
function updateLeds() {
  if (!link.connected || !st) return;
  let m = 0n; const bit = k => { m |= 1n << BigInt(k); };
  const t = sel < 3 ? st.tracks[sel] : null;
  const recOn = (t && (t.state === 'rec' || t.state === 'dub')) || (sel === 3 && st.drumRec) || st.armed === sel;
  if (S.ledAll) {
    // every button lit, so it can be found in daylight; what is active blinks
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const b of USED_BTNS) bit(b);
    const off = k => { m &= ~(1n << BigInt(k)); };
    if (recOn && blink) off(FM1.BTN.REC);
    if (st.running && st.step >= 0 ? st.step % 4 === 0 : (st.running && blink)) off(FM1.BTN.PLAY);
    if (st.drumOn && !blink) off(FM1.BTN.ARP);
  } else {
    if (recOn) bit(FM1.BTN.REC);
    if (st.running) bit(FM1.BTN.PLAY);
    if (st.drumOn) bit(FM1.BTN.ARP);
    if (t && (t.canUndo || t.canRedo)) bit(FM1.BTN.SCL);
    bit(PAGES[page].btn);
  }
  for (let k = 0; k < 16; k++) { let on = !!st.pattern[voice * 16 + k]; if (k === st.step) on = !on; if (on) bit(14 + k); }
  bit(14 + 16 + voice);
  if (m !== lastLed) { lastLed = m; link.leds(m); }
}

let held = {};
link.onKey = (k, on) => {
  if (!st) return;
  if (k >= 16) {                       // keys 17..27: the drum pads (and they pick the voice for the step view)
    if (!on) return;
    voice = k - 16; send({ t: 'pad', v: voice }); flashPad(voice); renderGrid(); return;
  }
  if (!on) return;                     // keys 1..16: the 16 steps of the selected drum voice
  const idx = voice * 16 + k, v = st.pattern[idx] ? 0 : 1;
  st.pattern[idx] = v; send({ t: 'set', k: 'step', v: { v: voice, s: k, on: v } }); renderGrid(); updateLeds();
};
link.onButton = (b, on) => {
  const B = FM1.BTN;
  if (on) held[b] = performance.now();
  const dur = on ? 0 : performance.now() - (held[b] || 0);
  switch (b) {
    case B.REC: if (on) recPress(); break;
    case B.PLAY: if (on) send({ t: 'play' }); break;
    case B.SCL: if (on) send({ t: 'undo', i: sel }); break;
    case B.HOME: if (on) send({ t: 'stop', i: sel }); break;
    case B.ARP: if (on) toggleDrums(); break;
    case B.SAVE:
      if (on) held.saveTimer = setTimeout(() => { clearSel(); held.saveTimer = 0; }, 800);
      else if (held.saveTimer) { clearTimeout(held.saveTimer); toast('SAVE halten = Spur loeschen'); }
      break;
    case B.LFO:
      if (on) held.stutTimer = setTimeout(() => { held.stutTimer = 0; stutter(true); }, 220);
      else if (held.stutTimer) { clearTimeout(held.stutTimer); setPage('MOD'); } else stutter(false);
      break;
    default: {
      const pk = PAGE_KEYS.find(k => PAGES[k].btn === b);
      if (pk && on) setPage(pk);
    }
  }
};
link.onEncoder = (e, d) => {
  if (e === 0) { select((sel + (d > 0 ? 1 : 3)) % 4); return; }
  if (e === 1) { setP('pat', (S.pat + (d > 0 ? 1 : PATTERNS.length - 1)) % PATTERNS.length); toast('Muster: ' + PATTERNS[S.pat].name); return; }
  if (e === 6) { voice = (voice + (d > 0 ? 1 : 10)) % 11; renderGrid(); updateLeds(); toast('Drum: ' + voiceNames()[voice]); return; }
  const p = PAGES[page].p[e - 2]; if (!p) return;
  const acc = Math.abs(d) > 2 ? 3 : 1;
  setP(p.id, getP(p.id) + Math.sign(d) * p.step * acc);
};
link.onRedraw = () => { lastLed = -1n; drawScreen(); updateLeds(); };
link.onState = (ok, name, outs) => {
  $('#fm1').textContent = ok ? 'FM-1 verbunden' : (outs.length ? 'FM-1 nicht gefunden' : 'kein MIDI-Geraet');
  $('#fm1').className = 'chip ' + (ok ? 'ok' : 'bad');
  $('#fm1hint').hidden = ok;
  if (ok) { lastLed = -1n; setTimeout(drawScreen, 100); }
};

// ---- actions ---------------------------------------------------------------------------------
function recPress() { if (sel === 3) send({ t: 'drumRec' }); else send({ t: 'rec', i: sel }); }
function toggleDrums() { send({ t: 'stop', i: 3 }); }
function clearSel() { send({ t: 'clear', i: sel }); toast(sel === 3 ? 'Drum-Muster geloescht' : 'Spur ' + (sel + 1) + ' geloescht'); }
function stutter(on) { send({ t: 'set', k: 'stut', v: on }); $('#stut').classList.toggle('on', on); }
function select(i) { sel = i; lastSig = ''; renderTracks(); renderParams(); drawScreen(); updateLeds(); }
function setPage(k) { page = k; renderParams(); drawScreen(); updateLeds(); }

// ---- phone UI --------------------------------------------------------------------------------
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

function renderTracks() {
  if (!st) return;
  const cards = [0, 1, 2, 3].map(i => {
    let state, cls;
    if (i === 3) { state = st.drumRec ? 'AUFNAHME' : st.drumOn ? 'AN' : 'AUS'; cls = st.drumRec ? 'rec' : st.drumOn ? 'drum' : 'empty'; }
    else { const t = st.tracks[i]; cls = st.armed === i ? 'rec armed' : t.state; state = st.armed === i ? 'WARTET AUF TAKT' : t.pending ? 'REC BIS TAKTENDE' : STATE_DE[t.state]; }
    const t = st.tracks[i];
    const len = i < 3 && t.len ? (t.len / ctx.sampleRate).toFixed(1) + ' s' : i === 3 ? KITS[S.kit] : '';
    return `<button class="track ${cls} ${i === sel ? 'sel' : ''}" data-i="${i}">
      <span class="tn">${i === 3 ? 'DRUMS' : 'SPUR ' + (i + 1)}</span><span class="ts">${state}</span>
      <span class="tl">${esc(len)}</span><span class="bar"><i id="pb${i}"></i></span><span class="lv"><i id="lv${i}"></i></span></button>`;
  }).join('');
  $('#tracks').innerHTML = cards;
  const t = sel < 3 ? st.tracks[sel] : null;
  const r = $('#bRec');
  const label = sel === 3 ? (st.drumRec ? 'DRUM-REC AUS' : 'DRUM-REC') :
    st.armed === sel ? 'ABBRECHEN' : { empty: 'REC', rec: st.master || !S.recToDub ? 'STOP REC' : 'REC → DUB', dub: 'DUB → PLAY', play: 'DUB', stop: 'DUB' }[t.state];
  r.textContent = label;
  r.className = 'big rec ' + (sel === 3 ? (st.drumRec ? 'on' : '') : (t.state === 'rec' || t.state === 'dub' || st.armed === sel ? 'on' : ''));
  $('#bPlay').textContent = st.running ? 'STOP' : 'PLAY';
  $('#bPlay').classList.toggle('on', st.running);
  $('#bUndo').textContent = sel === 3 ? (st.canDrumRedo ? 'REDO' : 'UNDO') : (t.canRedo ? 'REDO' : 'UNDO');
  $('#bUndo').disabled = sel === 3 ? !(st.canDrumUndo || st.canDrumRedo) : !(t.canUndo || t.canRedo || t.state === 'rec' || st.armed === sel);
  $('#bStop').textContent = sel === 3 ? (st.drumOn ? 'DRUMS AUS' : 'DRUMS AN') : (t.state === 'stop' ? 'SPUR AN' : 'SPUR STUMM');
  $('#bpm').textContent = Math.round(st.bpm) + ' BPM' + (st.master ? ' · ' + st.bars + ' Takt' + (st.bars > 1 ? 'e' : '') : '');
}

function updateMeters() {
  const lv = x => Math.min(100, Math.round(Math.sqrt(x) * 100)) + '%';
  $('#mIn').style.width = lv(st.meterIn); $('#mOut').style.width = lv(st.meterOut);
  $('#mIn').classList.toggle('clip', st.meterIn > 0.98);
  st.tracks.forEach((t, i) => {
    const pb = $('#pb' + i), l = $('#lv' + i);
    if (pb) pb.style.width = (t.state === 'rec' ? (st.master ? (t.rec % st.master) / st.master : Math.min(1, t.rec / (ctx.sampleRate * 8))) : t.pos) * 100 + '%';
    if (l) l.style.width = lv(t.peak);
  });
  const pb = $('#pb3'); if (pb) pb.style.width = st.step >= 0 ? (st.step + 1) / 16 * 100 + '%' : '0%';
}

function renderParams() {
  $('#pages').innerHTML = PAGE_KEYS.map(k => `<button data-p="${k}" class="${k === page ? 'on' : ''}">${k}</button>`).join('');
  const pg = PAGES[page];
  $('#params').innerHTML = pg.p.map((p, i) => {
    const disabled = (p.id.startsWith('t') && p.id !== 'tVol' ? sel > 2 : false) || (p.id === 'tVol' && sel > 2) || (p.id === 'bpm' && st && st.master > 0);
    return `<label class="prm"><span>K${i + 1} ${esc(p.label)}</span><b>${esc(p.fmt(getP(p.id)))}</b>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${getP(p.id)}" data-id="${p.id}" ${disabled ? 'disabled' : ''}></label>`;
  }).join('');
}

function renderGrid() {
  const g = $('#grid');
  if (!g.firstChild) {
    g.innerHTML = voiceNames().map((v, r) => `<div class="row" data-r="${r}"><button class="pad" data-v="${r}">${esc(v)}</button>${
      Array.from({ length: 16 }, (_, s) => `<button class="st ${s % 4 === 0 ? 'q' : ''}" data-v="${r}" data-s="${s}"></button>`).join('')}</div>`).join('');
  }
  const pat = st ? st.pattern : patternArray(S.pat);
  g.querySelectorAll('.st').forEach(b => b.classList.toggle('on', !!pat[b.dataset.v * 16 + +b.dataset.s]));
  g.querySelectorAll('.row').forEach(r => r.classList.toggle('cur', +r.dataset.r === voice));
  $('#selPat').value = S.pat; $('#selKit').value = S.kit;
}
let lastMark = -1;
function markStep(s) {
  const g = $('#grid');
  if (lastMark >= 0) g.querySelectorAll(`.st[data-s="${lastMark}"]`).forEach(b => b.classList.remove('now'));
  if (s >= 0) g.querySelectorAll(`.st[data-s="${s}"]`).forEach(b => b.classList.add('now'));
  lastMark = s;
}
function flashPad(v) { const b = document.querySelector(`.pad[data-v="${v}"]`); if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); } }

// ---- wiring --------------------------------------------------------------------------------
$('#selPat').innerHTML = PATTERNS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
$('#selKit').innerHTML = KITS.map((k, i) => `<option value="${i}">${k}</option>`).join('');
renderGrid(); renderParams();

$('#start').onclick = async () => {
  $('#start').disabled = true; $('#start').textContent = 'Startet …';
  try {
    await startAudio();
    $('#intro').hidden = true; $('#app').hidden = false;
    try { await link.open(); } catch (e) { $('#fm1').textContent = e.message; }
  } catch (e) { $('#start').disabled = false; $('#start').textContent = 'Starten'; $('#err').textContent = 'Fehler: ' + e.message; }
};
$('#tracks').onclick = e => { const b = e.target.closest('.track'); if (b) select(+b.dataset.i); };
$('#bRec').onclick = recPress;
$('#bPlay').onclick = () => send({ t: 'play' });
$('#bUndo').onclick = () => send({ t: 'undo', i: sel });
$('#bStop').onclick = () => send({ t: 'stop', i: sel });
let clrT = 0;
$('#bClear').onpointerdown = () => { $('#bClear').classList.add('arm'); clrT = setTimeout(() => { clearSel(); clrT = 0; $('#bClear').classList.remove('arm'); }, 800); };
$('#bClear').onpointerup = $('#bClear').onpointerleave = () => { if (clrT) { clearTimeout(clrT); toast('Halten = loeschen'); } clrT = 0; $('#bClear').classList.remove('arm'); };
$('#stut').onpointerdown = e => { e.preventDefault(); stutter(true); };
$('#stut').onpointerup = $('#stut').onpointerleave = $('#stut').onpointercancel = () => stutter(false);
$('#pages').onclick = e => { const b = e.target.closest('button'); if (b) setPage(b.dataset.p); };
$('#params').oninput = e => { const i = e.target.closest('input'); if (i) setP(i.dataset.id, +i.value); };
$('#grid').onpointerdown = e => {
  const b = e.target.closest('button'); if (!b || !st) return;
  voice = +b.dataset.v;
  if (b.classList.contains('pad')) { send({ t: 'pad', v: voice }); flashPad(voice); }
  else { const s = +b.dataset.s, idx = voice * 16 + s, v = st.pattern[idx] ? 0 : 1; st.pattern[idx] = v; send({ t: 'set', k: 'step', v: { v: voice, s, on: v } }); }
  renderGrid(); updateLeds();
};
$('#selPat').onchange = e => setP('pat', +e.target.value);
$('#selKit').onchange = e => setP('kit', +e.target.value);
$('#selMic').onchange = e => { S.micId = e.target.value; save(); openMic(); };
$('#selOut').onchange = e => setOutput(e.target.value);
$('#bClearAll').onclick = () => { if ($('#bClearAll').dataset.arm) { send({ t: 'clearAll' }); delete $('#bClearAll').dataset.arm; $('#bClearAll').textContent = 'Alles loeschen'; } else { $('#bClearAll').dataset.arm = 1; $('#bClearAll').textContent = 'Wirklich alles loeschen?'; setTimeout(() => { delete $('#bClearAll').dataset.arm; $('#bClearAll').textContent = 'Alles loeschen'; }, 3000); } };
$('#bFull').onclick = () => { const d = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen()).catch(() => { }); };
$('#bRetry').onclick = () => link.access ? link.find() : link.open().catch(e => toast(e.message));

// computer keyboard (for testing without the FM-1)
document.addEventListener('keydown', e => {
  if (!node || e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); send({ t: 'play' }); }
  else if (k === 'r') recPress();
  else if (k === 'z') send({ t: 'undo', i: sel });
  else if (k >= '1' && k <= '4') select(+k - 1);
  else if (k === 's') stutter(true);
});
document.addEventListener('keyup', e => { if (e.key.toLowerCase() === 's') stutter(false); });
}
