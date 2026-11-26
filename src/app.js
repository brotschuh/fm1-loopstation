// Ouroloops: the page (phone or computer). Engine in an AudioWorklet, effects as Web Audio nodes,
// the FM-1 as keys, knobs, LEDs and a second screen over USB MIDI.
{
const $ = s => document.querySelector(s);
const TRACK_NAMES = ['1', '2', '3', 'DR'];
const DLY_DIV = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];
const STUT_DIV = [4, 8, 16, 32];
const STATE_DE = { empty: 'LEER', rec: 'REC', dub: 'DUB', play: 'PLAY', stop: 'STOP' };

// ---- settings (remembered on this device) ---------------------------------------------
const DEF = { dlyMix: 0, dlyDiv: 2, dlyFb: 35, dlyTone: 60, rev: 0, revDamp: 40, revPre: 10, choRate: 30, fxSel: 0, filt: 0, res: 10, bits: 16, down: 1, choMix: 0, choDepth: 50,
  stutDiv: 2, revSize: 50, bpm: 100, pat: 0, kit: 0, drumVol: 80, inGain: 100, mon: 0, lat: -1, master: 90,
  recToDub: 1, micId: '', outId: '', glow: 3, lang: '', theme: 'dark', v: 3 };
let S = { ...DEF };
try { const o = JSON.parse(localStorage.getItem('fm1loop') || '{}'); if (o.v === 3) Object.assign(S, o); else Object.assign(S, o, { mon: 0, v: 3 }, o.v === 2 ? {} : { kit: 0, pat: 0 }); } catch (e) { }
const voiceNames = () => KIT_VOICES[S.kit];
// effects are per channel: tracks 1-3 and the drums (index 3), each with its own settings
const FX_IDS = ['dlyMix', 'dlyDiv', 'dlyFb', 'dlyTone', 'rev', 'revSize', 'revDamp', 'revPre', 'choMix', 'choDepth', 'choRate', 'bits', 'down', 'filt', 'res'];
if (!Array.isArray(S.tfx) || S.tfx.length !== 4) S.tfx = [0, 1, 2, 3].map(() => Object.fromEntries(FX_IDS.map(k => [k, S[k] !== undefined ? S[k] : DEF[k]])));
for (const t of S.tfx) for (const k of FX_IDS) if (t[k] === undefined) t[k] = DEF[k];
LANG = S.lang || ((navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en');
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-t]').forEach(el => { if (!el.dataset.k) el.dataset.k = el.textContent.trim(); el.textContent = T(el.dataset.k); });
  $('#selLang').value = LANG;
  $('#selPat').innerHTML = PATTERNS.map((p, i) => `<option value="${i}">${esc(T(p.name))}</option>`).join('');
  $('#selKit').innerHTML = KITS.map((k, i) => `<option value="${i}">${esc(T(k))}</option>`).join('');
  $('#grid').innerHTML = ''; renderGrid(); renderParams(); lastSig = ''; if (st) { renderTracks(); drawScreen(); }
}
function setLang(l) { LANG = l; S.lang = l; save(); applyLang(); }
const save = () => { try { localStorage.setItem('fm1loop', JSON.stringify(S)); } catch (e) { } };

let ctx = null, node = null, st = null, kits = null, mic = null, micSrc = null;
let sel = 0, page = 'SPUR', voice = 0;   // on the FX page SELECT chooses the effect, elsewhere the track
const fx = {};

// ---- pages: four parameters each, the same on the phone and on K1..K4 of the FM-1 ---------
const P = (id, label, min, max, step, fmt, short) => ({ id, label, min, max, step, fmt: fmt || (v => String(v)), short: short || label });
// FX: one effect at a time, chosen with SELECT (or FX again), each with up to four knobs
const FX_SUB = {
  DELAY: { name: 'DELAY', p: [P('dlyMix', 'MIX', 0, 100, 1), P('dlyDiv', 'ZEIT', 0, 5, 1, v => DLY_DIV[v][0]), P('dlyFb', 'FEEDBACK', 0, 90, 1, null, 'FEEDBK'), P('dlyTone', 'KLANG', 0, 100, 1)] },
  REVERB: { name: 'REVERB', p: [P('rev', 'MIX', 0, 100, 1), P('revSize', 'RAUM', 0, 100, 2), P('revDamp', 'DAEMPFUNG', 0, 100, 1, null, 'DAEMPF'), P('revPre', 'PRE-DELAY', 0, 100, 1, v => v + 'ms', 'PRE')] },
  CHORUS: { name: 'CHORUS', p: [P('choMix', 'MIX', 0, 100, 1), P('choDepth', 'TIEFE', 0, 100, 1), P('choRate', 'TEMPO', 0, 100, 1, v => (0.1 + v / 100 * 4.9).toFixed(1) + 'HZ', 'RATE')] },
  BITCRUSH: { name: 'BITCRUSH', p: [P('bits', 'BITS', 2, 16, 1, v => v >= 16 ? 'AUS' : v + ' BIT'), P('down', 'SAMPLERATE', 1, 32, 1, v => v === 1 ? 'AUS' : '1/' + v, 'RATE')] },
};
const FX_KEYS = Object.keys(FX_SUB);
const PAGES = {
  FX: { btn: 2, get name() { return chName() + ' ' + FX_SUB[FX_KEYS[S.fxSel]].name + ' ' + (S.fxSel + 1) + '/' + FX_KEYS.length; }, get p() { return FX_SUB[FX_KEYS[S.fxSel]].p; } },
  FILTER: { get name() { return chName() + ' FILTER'; }, btn: 4, p: [P('filt', 'FILTER', -100, 100, 1, v => v === 0 ? 'AUS' : v < 0 ? 'TP ' + (-v) : 'HP ' + v), P('res', 'RESONANZ', 0, 100, 1, null, 'RESO')] },
  STUTTER: { name: 'STUTTER', btn: 5, p: [P('stutDiv', 'LAENGE', 0, 3, 1, v => '1/' + STUT_DIV[v])] },
  SPUR: { name: 'SPUREN', btn: 8, p: [P('tVol', 'LAUTST.', 0, 100, 1), P('tPan', 'PANORAMA', -100, 100, 2, v => v === 0 ? 'MITTE' : (v < 0 ? 'L ' + (-v) : 'R ' + v), 'PAN'), P('tRev', 'RUECKW.', 0, 1, 1, v => v ? 'AN' : 'AUS', 'RUECKW'), P('recToDub', 'NACH REC', 0, 1, 1, v => v ? 'DUB' : 'PLAY', 'N.REC')] },
  DRUMS: { name: 'DRUMS', btn: 11, p: [P('bpm', 'TEMPO', 50, 200, 1, v => Math.round(v) + ''), P('pat', 'MUSTER', 0, PATTERNS.length - 1, 1, v => T(PATTERNS[v].name)), P('kit', 'KIT', 0, KITS.length - 1, 1, v => T(KITS[v]).split(' ')[0]), P('drumVol', 'DRUM VOL', 0, 100, 1, null, 'DRUMS')] },
  MIKRO: { name: 'MIKRO + AUSGANG', btn: 7, p: [P('inGain', 'EINGANG', 0, 200, 2), P('mon', 'MITHOEREN', 0, 100, 2, null, 'MONITOR'), P('lat', 'LATENZ', 0, 400, 1, v => v + 'ms'), P('glow', 'TASTENLICHT', 0, 8, 1, v => v ? String(v) : 'AUS', 'LICHT')] },
};
function chName() { return sel < 3 ? 'S' + (sel + 1) : 'DR'; }
const ALL_PARAMS = [...Object.values(FX_SUB).flatMap(g => g.p), ...Object.keys(PAGES).filter(k => k !== 'FX').flatMap(k => PAGES[k].p)];
const WEB_TABS = ['FX', 'FILTER', 'STUTTER', 'SPUR', 'DRUMS'];   // MIKRO lives in the settings on the phone
function setFx(i) { S.fxSel = (i + FX_KEYS.length) % FX_KEYS.length; save(); setPage('FX'); }
const PAGE_KEYS = Object.keys(PAGES);

function getP(id) {
  const t = st && sel < 3 ? st.tracks[sel] : null;
  if (id === 'tVol') return t ? Math.round(t.vol * 100) : 80;
  if (id === 'tPan') return t ? Math.round(t.pan * 100) : 0;
  if (id === 'tRev') return t && t.rev ? 1 : 0;
  if (id === 'bpm') return st ? Math.round(st.bpm) : S.bpm;
  if (FX_IDS.includes(id)) return S.tfx[sel][id];
  return S[id];
}
function setP(id, v) {
  const p = ALL_PARAMS.find(x => x.id === id);
  v = Math.max(p.min, Math.min(p.max, v));
  if (id === 'tVol' || id === 'tPan' || id === 'tRev') {
    if (sel > 2) return;
    const k = { tVol: 'vol', tPan: 'pan', tRev: 'rev' }[id];
    send({ t: 'set', k, v: { i: sel, v: id === 'tRev' ? v : v / 100 } });
    if (st) st.tracks[sel][k] = id === 'tRev' ? !!v : v / 100;
  } else {
    if (id === 'bpm' && st && st.master > 0) { toast(T('Tempo kommt vom Loop')); return; }
    if (FX_IDS.includes(id)) { S.tfx[sel][id] = v; save(); applyFx(sel, id); }
    else { S[id] = v; save(); applyParam(id); }
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
  node = new AudioWorkletNode(ctx, 'loop-engine', { numberOfInputs: 1, numberOfOutputs: 5, outputChannelCount: [2, 2, 2, 2, 2], channelCount: 1, channelCountMode: 'explicit' });
  node.port.onmessage = m => onStatus(m.data);
  fx.master = ctx.createGain(); fx.lim = ctx.createDynamicsCompressor(); fx.lim.threshold.value = -3; fx.lim.ratio.value = 20; fx.lim.attack.value = 0.002; fx.lim.release.value = 0.1;
  fx.master.connect(fx.lim); fx.lim.connect(ctx.destination);
  // per channel: filter -> chorus -> (dry, delay, reverb) -> master; the bitcrusher runs in the engine
  fx.ch = [0, 1, 2, 3].map(c => {
    const f = {};
    f.filter = ctx.createBiquadFilter();
    f.choDry = ctx.createGain(); f.choWet = ctx.createGain(); f.choDel = ctx.createDelay(0.1); f.choDel.delayTime.value = 0.018;
    f.lfo = ctx.createOscillator(); f.lfoAmt = ctx.createGain(); f.lfo.connect(f.lfoAmt); f.lfoAmt.connect(f.choDel.delayTime); f.lfo.start();
    f.mix = ctx.createGain();
    f.dSend = ctx.createGain(); f.delay = ctx.createDelay(3); f.dFb = ctx.createGain(); f.dTone = ctx.createBiquadFilter();
    f.rSend = ctx.createGain(); f.conv = ctx.createConvolver(); f.rPre = ctx.createDelay(0.2); f.rDamp = ctx.createBiquadFilter();
    node.connect(f.filter, c);
    f.filter.connect(f.choDry); f.filter.connect(f.choDel); f.choDel.connect(f.choWet);
    f.choDry.connect(f.mix); f.choWet.connect(f.mix);
    f.mix.connect(fx.master);
    f.mix.connect(f.dSend); f.dSend.connect(f.delay); f.delay.connect(f.dTone); f.dTone.connect(f.dFb); f.dFb.connect(f.delay); f.dTone.connect(fx.master);
    f.mix.connect(f.rSend); f.rSend.connect(f.rPre); f.rPre.connect(f.conv); f.conv.connect(f.rDamp); f.rDamp.connect(fx.master);
    return f;
  });
  node.connect(fx.master, 4);   // microphone monitor and click: no effects
  if (S.lat < 0) S.lat = Math.round(((ctx.baseLatency || 0.01) + (ctx.outputLatency || 0.02)) * 1000 + 15);
  for (const k of Object.keys(DEF)) if (!FX_IDS.includes(k)) applyParam(k);
  for (let c = 0; c < 4; c++) for (const k of FX_IDS) applyFx(c, k);
  // drums
  kits = [await decodeRock(), ...makeKits(ctx.sampleRate)];
  send({ t: 'set', k: 'kits', v: kits });
  send({ t: 'set', k: 'pattern', v: patternArray(S.pat) });
  await openMic();
  await listDevices();
  if (S.outId) setOutput(S.outId);
  try { await navigator.wakeLock.request('screen'); } catch (e) { }
}

function applyFx(c, k) {
  if (!ctx) return;
  const f = fx.ch[c], S2 = S.tfx[c], v = S2[k], now = ctx.currentTime, set = (prm, x) => prm.setTargetAtTime(x, now, 0.02);
  const beat = 60 / (st ? st.bpm : S.bpm);
  switch (k) {
    case 'dlyMix': set(f.dSend.gain, v / 100 * 0.8); break;
    case 'dlyDiv': set(f.delay.delayTime, Math.min(2.9, beat * DLY_DIV[v][1])); break;
    case 'dlyFb': set(f.dFb.gain, v / 100); break;
    case 'dlyTone': set(f.dTone.frequency, 800 * Math.pow(2, v / 100 * 4)); break;
    case 'rev': set(f.rSend.gain, v / 100 * 0.9); break;
    case 'revSize': f.conv.buffer = impulse(0.4 + v / 100 * 4); break;
    case 'revDamp': set(f.rDamp.frequency, 18000 * Math.pow(2, -v / 100 * 3.2)); break;
    case 'revPre': set(f.rPre.delayTime, v / 1000); break;
    case 'choMix': set(f.choWet.gain, v / 100); set(f.choDry.gain, 1 - v / 200); break;
    case 'choDepth': set(f.lfoAmt.gain, 0.0005 + v / 100 * 0.006); break;
    case 'choRate': set(f.lfo.frequency, 0.1 + v / 100 * 4.9); break;
    case 'bits': send({ t: 'set', k: 'bits', v: { i: c, v } }); break;
    case 'down': send({ t: 'set', k: 'down', v: { i: c, v } }); break;
    case 'filt': case 'res': {
      const fl = S2.filt, q = 0.7 + S2.res / 100 * 14;
      if (fl <= 0) { f.filter.type = 'lowpass'; set(f.filter.frequency, fl === 0 ? 22000 : 20000 * Math.pow(2, fl / 100 * 9)); }
      else { f.filter.type = 'highpass'; set(f.filter.frequency, 20 * Math.pow(2, fl / 100 * 9)); }
      set(f.filter.Q, fl === 0 ? 0.7 : q); break;
    }
  }
}

function applyParam(k) {
  if (!ctx) return;
  const v = S[k], now = ctx.currentTime, set = (prm, x) => prm.setTargetAtTime(x, now, 0.02);
  const beat = () => 60 / (st ? st.bpm : S.bpm);
  switch (k) {
    case 'bpm': for (let c = 0; c < 4; c++) applyFx(c, 'dlyDiv'); send({ t: 'set', k: 'bpm', v }); break;
    case 'stutDiv': send({ t: 'set', k: 'stutDiv', v: STUT_DIV[v] }); break;
    case 'pat': send({ t: 'set', k: 'pattern', v: patternArray(v) }); break;
    case 'kit': send({ t: 'set', k: 'kit', v }); $('#grid').innerHTML = ''; renderGrid(); break;
    case 'glow': sendGlow(); break;
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
    toast(T('Kein Mikrofon: ') + e.message); return;
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
    $('#selOut').innerHTML = '<option value="">' + T('Standard') + '</option>' + outs.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Ausgang')}</option>`).join('');
    // on a computer: play through the FM-1 if it is there
    if (!S.outId) { const f = outs.find(d => /fm-?1|felucca|sampler|m-?vave/i.test(d.label)); if (f) { S.outId = f.deviceId; setOutput(f.deviceId); } }
    $('#selOut').value = S.outId;
  }
}
async function setOutput(id) { try { await ctx.setSinkId(id); S.outId = id; save(); } catch (e) { toast(T('Ausgang nicht verfuegbar')); } }

// ---- engine status -> UI, FM-1 screen and LEDs ------------------------------------------------
let lastSig = '', lastLed = -1n, lastProg = 0, lastPat = '';
function onStatus(s) {
  const prev = st; st = s;
  if (s.wave) { wave = s.wave; fmWaveDirty = true; }
  for (const ev of s.events) if (ev.t === 'loop') { toast(`Loop: ${ev.bars} ${T(ev.bars > 1 ? 'Takte' : 'Takt')}, ${Math.round(ev.bpm)} BPM`); for (let c = 0; c < 4; c++) applyFx(c, 'dlyDiv'); }
  const sig = JSON.stringify([s.tracks.map(t => [t.state, t.pending, t.canUndo, t.canRedo]), s.running, s.armed, s.drumOn, s.drumRec, s.clickOn, sel, page, Math.round(s.bpm), s.master > 0]);
  if (sig !== lastSig) { lastSig = sig; renderTracks(); drawScreen(); renderParams(); }
  const pat = s.pattern.join('');
  if (pat !== lastPat) { lastPat = pat; renderGrid(); }
  updateMeters();
  updateLeds();
  const now = performance.now();
  if (now - lastProg > 140) { lastProg = now; drawProgress(); drawFmWave(); }
  drawWave();
  if (!prev || prev.step !== s.step) markStep(s.step);
}

// ---- FM-1 ------------------------------------------------------------------------------------
const link = new FM1.Link();
// the designs, on the phone (CSS, data-theme) and on the FM-1 screen (these colours); SEL switches
const FM_THEMES = {
  dark: { bg: 0, fg: FM1.rgb(235, 235, 235), dim: FM1.rgb(160, 160, 160), dark: FM1.rgb(40, 40, 40), accent: FM1.rgb(255, 150, 0),
    rec: FM1.rgb(255, 30, 30), dub: FM1.rgb(255, 150, 0), play: FM1.rgb(30, 210, 70), stop: FM1.rgb(20, 90, 40), drum: FM1.rgb(40, 130, 255) },
  paper: { bg: FM1.rgb(239, 230, 212), fg: FM1.rgb(43, 36, 32), dim: FM1.rgb(122, 110, 98), dark: FM1.rgb(216, 203, 179), accent: FM1.rgb(184, 67, 47),
    rec: FM1.rgb(184, 67, 47), dub: FM1.rgb(201, 138, 27), play: FM1.rgb(91, 122, 46), stop: FM1.rgb(138, 154, 106), drum: FM1.rgb(47, 111, 143) },
};
const THEMES = Object.keys(FM_THEMES);
const C = { ...FM_THEMES.dark };
function applyTheme() {
  if (!FM_THEMES[S.theme]) S.theme = 'dark';
  Object.assign(C, FM_THEMES[S.theme]);
  document.documentElement.dataset.theme = S.theme;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  lastSig = ''; if (st) { renderTracks(); drawScreen(); }
}
function nextTheme() { S.theme = THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length]; save(); applyTheme(); }
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
// FM-1 screen, 240 x 240: header, four track tiles, the state, a thin loop line, the page and its four knobs
const Y = { tiles: 28, tileH: 50, word: 84, wave: 110, waveH: 10, line: 123, page: 129, rows: 150, rowH: 42 };
function drawScreen() {
  if (!link.connected || !st) return;
  // no clear (that flashed black): every region is painted over, the texts are opaque cells
  const o = FM1.op, ops = [o.rect(0, 0, 240, 4, C.bg), o.rect(150, 4, 24, 16, C.bg), o.rect(0, Y.tiles - 6, 240, Y.tileH + 10, C.bg)];
  ops.push(o.text(6, 4, 2, C.accent, C.bg, 'OUROLOOPS'));
  ops.push(o.text(174, 4, 2, C.fg, C.bg, String(Math.round(st.bpm)).padStart(3) + ' '));
  for (let i = 0; i < 4; i++) {
    const x = 6 + i * 58, y = Y.tiles, c = tileColor(i);
    if (i === sel) ops.push(o.rect(x - 3, y - 3, 56, Y.tileH + 6, C.fg));
    ops.push(o.rect(x, y, 50, Y.tileH, c));
    const lbl = TRACK_NAMES[i];
    ops.push(o.text(x + 25 - lbl.length * 9, y + 13, 3, c === C.dark ? C.dim : C.bg, c, lbl));
  }
  const w = T(bigWord()).slice(0, 13);
  ops.push(o.rect(0, Y.word - 2, 240, 26, C.bg));
  ops.push(o.text(Math.max(0, 120 - w.length * 9), Y.word, 3, C.fg, C.bg, w));
  ops.push(o.rect(6, Y.line, 228, 2, C.dark));
  ops.push(...waveOps());
  const pg = PAGES[page];
  ops.push(o.text(6, Y.page, 2, C.accent, C.bg, T(pg.name).slice(0, 19).padEnd(19)));
  ops.push(o.rect(0, Y.rows - 4, 240, 240 - Y.rows + 4, C.bg));
  pg.p.forEach((p, i) => ops.push(...paramOps(p, i)));
  link.draw(ops, 'screen');
  drawProgress(true);
}
// one knob in the 2 x 2 grid: "1 DELAY" over its value, both 2x (12 x 16 px a character)
function paramOps(p, i) {
  const o = FM1.op, x = 6 + (i % 2) * 118, y = Y.rows + Math.floor(i / 2) * Y.rowH;
  const label = ((i + 1) + ' ' + T(p.short).slice(0, 7)).padEnd(9);
  const val = TV(p.fmt(getP(p.id))).slice(0, 9).padEnd(9);
  return [o.text(x, y, 2, C.dim, C.bg, label), o.text(x, y + 18, 2, C.fg, C.bg, val)];
}
function drawParam(id) {
  if (!link.connected || !st) return;
  const pg = PAGES[page], i = pg.p.findIndex(p => p.id === id);
  if (i >= 0) link.draw(paramOps(pg.p[i], i), 'p' + id);
}
function drawProgress(force) {
  if (!link.connected || !st || (link.backlog() > 2 && !force)) return;
  let f = 0, c = C.play;
  const t = sel < 3 ? st.tracks[sel] : null;
  if (t && t.state === 'rec') { f = st.master ? (t.rec % st.master) / st.master : Math.min(1, t.rec / (ctx.sampleRate * 8)); c = C.rec; }
  else if (t && t.len) { f = t.pos; c = t.state === 'dub' ? C.dub : C.play; }
  else if (sel === 3 && st.step >= 0) { f = (st.step + 1) / 16; c = C.drum; }
  const w = Math.round(f * 228), o = FM1.op;
  link.draw([o.rect(6, Y.line, Math.max(1, w), 2, c), o.rect(6 + w, Y.line, Math.max(1, 228 - w), 2, C.dark)], 'prog');
}
// waveform strip on the FM-1: 114 columns of 2 px, the newest overdub in orange
let wave = null, fmWaveAt = 0, fmWaveDirty = false;
function waveCols(n) {
  if (!wave || !wave.span || sel > 2 || wave.i !== sel) return null;
  const src = wave.pk, dub = wave.dk, m = Math.max(0.2, ...src), cols = [];
  for (let c = 0; c < n; c++) {
    const a = Math.floor(c * src.length / n), b = Math.max(a + 1, Math.floor((c + 1) * src.length / n));
    let p = 0, d = 0; for (let k = a; k < b; k++) { if (src[k] > p) p = src[k]; if (dub[k] > d) d = dub[k]; }
    cols.push({ h: Math.min(1, p / m), dub: d > p * 0.5 && d > 0.01 });
  }
  return cols;
}
function waveOps() {
  const o = FM1.op, ops = [o.rect(6, Y.wave, 228, Y.waveH, C.bg)], cols = waveCols(114);
  if (!cols) return ops;
  const t = st.tracks[sel], base = t.state === 'rec' ? C.rec : C.play;
  cols.forEach((c, i) => {
    const h = Math.max(c.h > 0.02 ? 2 : 0, Math.round(c.h * Y.waveH / 2) * 2);
    if (h) ops.push(o.rect(6 + i * 2, Y.wave + (Y.waveH - h) / 2, 2, h, c.dub ? C.dub : base));
  });
  return ops;
}
function drawFmWave(force) {
  if (!link.connected || !st || !fmWaveDirty) return;
  const now = performance.now();
  if (!force && (now - fmWaveAt < 1500 || link.backlog() > 1)) return;
  fmWaveAt = now; fmWaveDirty = false;
  link.draw(waveOps(), 'wave');
}

// waveform on the phone: the selected track, mirrored, with the play position
function drawWave() {
  const cv = $('#wave'); if (!cv || !st) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), col = v => css.getPropertyValue(v).trim();
  g.fillStyle = col('--line'); g.fillRect(0, H / 2, W, 1);
  const t = sel < 3 ? st.tracks[sel] : null;
  const label = $('#waveLabel');
  if (!t) { label.textContent = T('Drums: keine Wellenform'); return; }
  const n = Math.max(40, Math.floor(W / 3)), cols = waveCols(n);
  label.textContent = cols ? T('SPUR') + ' ' + (sel + 1) + ' · ' + (wave.span / ctx.sampleRate).toFixed(1) + ' s' : T('SPUR') + ' ' + (sel + 1) + ' · ' + T('LEER');
  if (!cols) return;
  const base = col(t.state === 'rec' ? '--rec' : t.state === 'stop' ? '--dim' : '--play'), bw = W / n;
  cols.forEach((c, i) => {
    const h = c.h * (H - 8); if (h < 1.5) return;
    g.fillStyle = c.dub ? col('--dub') : base;
    g.fillRect(i * bw + 0.5, (H - h) / 2, Math.max(1, bw - 1), h);
  });
  const f = t.state === 'rec' ? (st.master ? (t.rec % st.master) / st.master : 1) : t.pos;
  g.fillStyle = col('--now'); g.fillRect(Math.min(W - 2, f * W), 0, 2, H);
}
const USED_BTNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
// every button we use glows at the level of K4 on the MIKRO page; what is active lights fully (the firmware
// lights a glowing LED fully when it is also on in the LED frame)
function sendGlow() {
  if (!link.connected) return;
  let m = 0n; for (const b of USED_BTNS) m |= 1n << BigInt(b);
  link.glow(m, S.glow);
}
function updateLeds() {
  if (!link.connected || !st) return;
  let m = 0n; const bit = k => { m |= 1n << BigInt(k); };
  const t = sel < 3 ? st.tracks[sel] : null;
  const recOn = (t && (t.state === 'rec' || t.state === 'dub')) || (sel === 3 && st.drumRec) || st.armed === sel;
  const blink = Math.floor(performance.now() / 250) % 2 === 0;
  if (recOn && (blink || (t && t.state === 'dub'))) bit(FM1.BTN.REC);   // recording blinks, overdub stays lit
  if (st.running) bit(FM1.BTN.PLAY);
  if (st.drumOn) bit(FM1.BTN.ARP);
  bit(PAGES[page].btn);
  for (let k = 0; k < 16; k++) { let on = !!st.pattern[voice * 16 + k]; if (k === st.step) on = !on; if (on) bit(14 + k); }
  bit(14 + 16 + voice);
  if (m !== lastLed) { lastLed = m; link.leds(m); }
}

let held = {};
link.onKey = (k, on) => {
  if (!st) return;
  if (on) reveal('secDrums');
  if (k >= 16) {                       // keys 17..27: the drum pads (and they pick the voice for the step view)
    if (!on) return;
    voice = k - 16; send({ t: 'pad', v: voice }); flashPad(voice); renderGrid(); return;
  }
  if (!on) return;                     // keys 1..16: the 16 steps of the selected drum voice
  const idx = voice * 16 + k, v = st.pattern[idx] ? 0 : 1;
  st.pattern[idx] = v; send({ t: 'set', k: 'step', v: { v: voice, s: k, on: v } }); renderGrid(); updateLeds();
};
function reveal(id) {
  const el = document.getElementById(id); if (!el) return;
  const r = el.getBoundingClientRect(), h = innerHeight;
  if (r.top < 60 || r.top > h * 0.5) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
// ARP (10) jumps nowhere; GLO (7) goes to the settings, where the MIKRO knobs are too
const BTN_SECTION = { 2: 'secFx', 4: 'secFx', 5: 'secFx', 6: 'secTracks', 7: 'secSettings', 11: 'secDrums', 12: 'secTracks', 13: 'secTracks', 8: 'secTracks', 9: 'secTracks' };
link.onButton = (b, on) => {
  const B = FM1.BTN;
  if (on && BTN_SECTION[b]) reveal(sel === 3 && (b === 12 || b === 13) ? 'secDrums' : BTN_SECTION[b]);
  if (on) held[b] = performance.now();
  const dur = on ? 0 : performance.now() - (held[b] || 0);
  switch (b) {
    case B.REC: if (on) recPress(); break;
    case B.PLAY: if (on) send({ t: 'play' }); break;
    case B.SCL: if (on) nextTheme(); break;   // SEL: the design (a hidden feature)
    case B.HOME:   // tap: the main page (SELECT chooses the track), hold: mute / unmute the track
      if (on) held.homeTimer = setTimeout(() => { held.homeTimer = 0; send({ t: 'stop', i: sel }); }, 500);
      else if (held.homeTimer) { clearTimeout(held.homeTimer); held.homeTimer = 0; setPage('SPUR'); }
      break;
    case B.EDIT: if (on) send({ t: 'undo', i: sel }); break;   // undo / redo
    case B.ARP:   // tap: drums on / off, hold: click on / off
      if (on) held.arpTimer = setTimeout(() => { held.arpTimer = 0; toggleClick(); }, 450);
      else if (held.arpTimer) { clearTimeout(held.arpTimer); held.arpTimer = 0; toggleDrums(); }
      break;
    case B.SAVE:
      if (on) held.saveTimer = setTimeout(() => { clearSel(); held.saveTimer = 0; }, 800);
      else if (held.saveTimer) { clearTimeout(held.saveTimer); toast(T('SAVE halten = Spur loeschen')); }
      break;
    case B.LFO:
      if (on) held.stutTimer = setTimeout(() => { held.stutTimer = 0; stutter(true); }, 220);
      else if (held.stutTimer) { clearTimeout(held.stutTimer); setPage('STUTTER'); } else stutter(false);
      break;
    default: {
      const pk = PAGE_KEYS.find(k => PAGES[k].btn === b);
      if (pk && on) { if (pk === 'FX' && page === 'FX') setFx(S.fxSel + 1); else setPage(pk); }
    }
  }
};
link.onEncoder = (e, d) => {
  if (e === 0 && page === 'FX') { setFx(S.fxSel + (d > 0 ? 1 : -1)); reveal('secFx'); return; }
  if (e === 0) { select((sel + (d > 0 ? 1 : 3)) % 4); reveal('secTracks'); return; }
  if (e === 1 || e === 6) reveal('secDrums'); else reveal(page === 'MIKRO' ? 'secSettings' : 'secFx');
  if (e === 6) { setP('pat', (S.pat + (d > 0 ? 1 : PATTERNS.length - 1)) % PATTERNS.length); toast(T('Muster') + ': ' + T(PATTERNS[S.pat].name)); return; }
  if (e === 1) { voice = (voice + (d > 0 ? 1 : 10)) % 11; renderGrid(); updateLeds(); toast('Drum: ' + T(voiceNames()[voice])); return; }
  const p = PAGES[page].p[e - 2]; if (!p) return;
  const acc = Math.abs(d) > 2 ? 3 : 1;
  setP(p.id, getP(p.id) + Math.sign(d) * p.step * acc);
};
link.onRedraw = () => { lastLed = -1n; drawScreen(); updateLeds(); sendGlow(); };
let dropFixAt = 0;
link.onDropped = () => {   // the FM-1 lost frames: slow down, and draw it all again (not more often than every 4 s)
  link.pace = Math.min(60, link.pace + 8);
  const now = performance.now(); if (now - dropFixAt < 4000) return; dropFixAt = now;
  lastLed = -1n; drawScreen(); updateLeds();
};
link.onState = (ok, name, outs) => {
  if (ok) setTimeout(sendGlow, 150);
  $('#fm1').textContent = T(ok ? 'FM-1 verbunden' : (outs.length ? 'FM-1 nicht gefunden' : 'kein MIDI-Geraet'));
  $('#fm1').className = 'chip ' + (ok ? 'ok' : 'bad');
  $('#fm1hint').hidden = ok;
  if (ok) { lastLed = -1n; setTimeout(drawScreen, 100); }
};

// ---- actions ---------------------------------------------------------------------------------
function recPress() { if (sel === 3) send({ t: 'drumRec' }); else send({ t: 'rec', i: sel }); }
function toggleDrums() { send({ t: 'stop', i: 3 }); }
function toggleClick() { const on = !(st && st.clickOn); send({ t: 'set', k: 'clickOn', v: on }); toast(T(on ? 'Klick an' : 'Klick aus')); }
function clearSel() { send({ t: 'clear', i: sel }); toast(sel === 3 ? T('Drum-Muster geloescht') : T('SPUR') + ' ' + (sel + 1) + ' ' + T('geloescht')); }
function stutter(on) { send({ t: 'set', k: 'stut', v: on }); $('#stut').classList.toggle('on', on); }
function select(i) { sel = i; lastSig = ''; wave = null; send({ t: 'wave', i: i < 3 ? i : -1, bins: 400 }); renderTracks(); renderParams(); drawScreen(); updateLeds(); }
function setPage(k) { page = k; renderParams(); drawScreen(); updateLeds(); }

// ---- phone UI --------------------------------------------------------------------------------
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

function renderTracks() {
  if (!st) return;
  const cards = [0, 1, 2, 3].map(i => {
    let state, cls;
    if (i === 3) { state = T(st.drumRec ? 'AUFNAHME' : st.drumOn ? 'AN' : 'AUS'); cls = st.drumRec ? 'rec' : st.drumOn ? 'drum' : 'empty'; }
    else { const t = st.tracks[i]; cls = st.armed === i ? 'rec armed' : t.state; state = T(st.armed === i ? 'WARTET AUF TAKT' : t.pending ? 'REC BIS TAKTENDE' : STATE_DE[t.state]); }
    const t = st.tracks[i];
    const len = i < 3 && t.len ? (t.len / ctx.sampleRate).toFixed(1) + ' s' : i === 3 ? T(KITS[S.kit]) : '';
    return `<button class="track ${cls} ${i === sel ? 'sel' : ''}" data-i="${i}">
      <span class="tn">${i === 3 ? 'DRUMS' : T('SPUR') + ' ' + (i + 1)}</span><span class="ts">${state}</span>
      <span class="tl">${esc(len)}</span><span class="bar"><i id="pb${i}"></i></span><span class="lv"><i id="lv${i}"></i></span></button>`;
  }).join('');
  $('#tracks').innerHTML = cards;
  const t = sel < 3 ? st.tracks[sel] : null;
  const r = $('#bRec');
  const label = sel === 3 ? (st.drumRec ? 'DRUM-REC AUS' : 'DRUM-REC') :
    st.armed === sel ? 'ABBRECHEN' : { empty: 'REC', rec: st.master || !S.recToDub ? 'STOP REC' : 'REC → DUB', dub: 'DUB → PLAY', play: 'DUB', stop: 'DUB' }[t.state];
  r.textContent = T(label);
  r.className = 'big rec ' + (sel === 3 ? (st.drumRec ? 'on' : '') : (t.state === 'rec' || t.state === 'dub' || st.armed === sel ? 'on' : ''));
  $('#bPlay').textContent = st.running ? 'STOP' : 'PLAY';
  $('#bPlay').classList.toggle('on', st.running);
  $('#bUndo').textContent = sel === 3 ? (st.canDrumRedo ? 'REDO' : 'UNDO') : (t.canRedo ? 'REDO' : 'UNDO');
  $('#bUndo').disabled = sel === 3 ? !(st.canDrumUndo || st.canDrumRedo) : !(t.canUndo || t.canRedo || t.state === 'rec' || st.armed === sel);
  $('#bStop').textContent = T(sel === 3 ? (st.drumOn ? 'DRUMS AUS' : 'DRUMS AN') : (t.state === 'stop' ? 'SPUR AN' : 'SPUR STUMM'));
  $('#bClick').classList.toggle('on', !!st.clickOn);
  $('#bpm').textContent = Math.round(st.bpm) + ' BPM' + (st.master ? ' · ' + st.bars + ' ' + T(st.bars > 1 ? 'Takte' : 'Takt') : '');
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

function paramsHtml(pg) {
  return pg.p.map((p, i) => {
    const disabled = (p.id.startsWith('t') && sel > 2) || (p.id === 'bpm' && st && st.master > 0);
    return `<label class="prm"><span>K${i + 1} ${esc(T(p.label))}</span><b>${esc(TV(p.fmt(getP(p.id))))}</b>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${getP(p.id)}" data-id="${p.id}" ${disabled ? 'disabled' : ''}></label>`;
  }).join('');
}
function renderParams() {
  $('#setParams').innerHTML = paramsHtml(PAGES.MIKRO);
  $('#pages').innerHTML = WEB_TABS.map(k => `<button data-p="${k}" class="${k === page ? 'on' : ''}">${T(k)}</button>`).join('');
  $('#fxsubs').hidden = page !== 'FX';
  $('#fxsubs').innerHTML = FX_KEYS.map((k, i) => `<button data-fx="${i}" class="${i === S.fxSel ? 'on' : ''}">${k}</button>`).join('');
  $('#fxFor').textContent = T('fuer') + ' ' + (sel < 3 ? T('SPUR') + ' ' + (sel + 1) : 'DRUMS');
  const pg = PAGES[page];
  $('#params').innerHTML = pg.p.map((p, i) => {
    const disabled = (p.id.startsWith('t') && p.id !== 'tVol' ? sel > 2 : false) || (p.id === 'tVol' && sel > 2) || (p.id === 'bpm' && st && st.master > 0);
    return `<label class="prm"><span>K${i + 1} ${esc(T(p.label))}</span><b>${esc(TV(p.fmt(getP(p.id))))}</b>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${getP(p.id)}" data-id="${p.id}" ${disabled ? 'disabled' : ''}></label>`;
  }).join('');
}

function renderGrid() {
  const g = $('#grid');
  if (!g.firstChild) {
    g.innerHTML = voiceNames().map((v, r) => `<div class="row" data-r="${r}"><button class="pad" data-v="${r}">${esc(T(v))}</button>${
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
applyLang(); applyTheme();
// Firefox and Safari cannot talk to the FM-1 (no Web MIDI with SysEx): say so before anything else
if (!navigator.requestMIDIAccess) $('#browserWarn').hidden = false;
$('#bLang').onclick = () => setLang(LANG === 'de' ? 'en' : 'de');
$('#selLang').onchange = e => setLang(e.target.value);

$('#start').onclick = async () => {
  $('#start').disabled = true; $('#start').textContent = T('Startet …');
  try {
    await startAudio();
    send({ t: 'wave', i: sel, bins: 400 });
    $('#intro').hidden = true; $('#app').hidden = false;
    try { await link.open(); } catch (e) { $('#fm1').textContent = e.message; }
  } catch (e) { $('#start').disabled = false; $('#start').textContent = T('Starten'); $('#err').textContent = T('Fehler: ') + e.message; }
};
$('#tracks').onclick = e => { const b = e.target.closest('.track'); if (b) select(+b.dataset.i); };
$('#bRec').onclick = recPress;
$('#bPlay').onclick = () => send({ t: 'play' });
$('#bUndo').onclick = () => send({ t: 'undo', i: sel });
$('#bStop').onclick = () => send({ t: 'stop', i: sel });
$('#bClick').onclick = toggleClick;
let clrT = 0;
$('#bClear').onpointerdown = () => { $('#bClear').classList.add('arm'); clrT = setTimeout(() => { clearSel(); clrT = 0; $('#bClear').classList.remove('arm'); }, 800); };
$('#bClear').onpointerup = $('#bClear').onpointerleave = () => { if (clrT) { clearTimeout(clrT); toast(T('Halten = loeschen')); } clrT = 0; $('#bClear').classList.remove('arm'); };
$('#stut').onpointerdown = e => { e.preventDefault(); stutter(true); };
$('#stut').onpointerup = $('#stut').onpointerleave = $('#stut').onpointercancel = () => stutter(false);
$('#pages').onclick = e => { const b = e.target.closest('button'); if (b) setPage(b.dataset.p); };
$('#fxsubs').onclick = e => { const b = e.target.closest('button'); if (b) setFx(+b.dataset.fx); };
$('#params').oninput = $('#setParams').oninput = e => { const i = e.target.closest('input'); if (i) setP(i.dataset.id, +i.value); };
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
$('#bClearAll').onclick = () => { if ($('#bClearAll').dataset.arm) { send({ t: 'clearAll' }); delete $('#bClearAll').dataset.arm; $('#bClearAll').textContent = T('Alles loeschen'); } else { $('#bClearAll').dataset.arm = 1; $('#bClearAll').textContent = T('Wirklich alles loeschen?'); setTimeout(() => { delete $('#bClearAll').dataset.arm; $('#bClearAll').textContent = T('Alles loeschen'); }, 3000); } };
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
  else if (k === 'k') toggleClick();
});
document.addEventListener('keyup', e => { if (e.key.toLowerCase() === 's') stutter(false); });
}
