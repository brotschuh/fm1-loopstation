// Ouroloops: the page (phone or computer). Engine in an AudioWorklet, effects as Web Audio nodes,
// the FM-1 as keys, knobs, LEDs and a second screen over USB MIDI.
{
const $ = s => document.querySelector(s);
const TRACK_NAMES = ['1', '2', '3', 'DR'];
const DLY_DIV = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];
const STUT_DIV = [4, 8, 16, 32];
const LFO_DIV = [['1/16', 0.25], ['1/8', 0.5], ['1/4', 1], ['1/2', 2], ['1 T', 4], ['2 T', 8], ['4 T', 16]];   // beats
const LFO_TGT = ['AUS', 'LAUTST.', 'FILTER', 'PAN'], LFO_SHAPE = ['SINUS', 'DREIECK', 'RECHTECK', 'SAEGE', 'ZUFALL'];
const STATE_DE = { empty: 'LEER', rec: 'REC', dub: 'DUB', play: 'PLAY', stop: 'STOP' };

// ---- settings (remembered on this device) ---------------------------------------------
const DEF = { dlyMix: 0, dlyDiv: 2, dlyFb: 35, dlyTone: 60, rev: 0, revDamp: 40, revPre: 10, choRate: 30, fxSel: 0, filt: 0, res: 10, bits: 16, down: 1, choMix: 0, choDepth: 50,
  stutDiv: 2, revSize: 50, lfoTgt: 0, lfoRate: 2, lfoDepth: 50, lfoShape: 0, bpm: 100, drumLen: 16, pat: 0, kit: 0, drumVol: 80, inGain: 100, mon: 0, lat: -1, master: 90,
  recToDub: 1, micId: '', outId: '', glow: 3, lang: '', theme: 'dark', saveAct: 0, saveLoops: 4, projId: '', projName: '', v: 4 };
// kept by a reset: the device, its look and its connections, not the sound
const KEEP = ['lang', 'theme', 'micId', 'outId', 'glow', 'lat'];
let S = { ...DEF };
try {
  const o = JSON.parse(localStorage.getItem('fm1loop') || '{}');
  if (o.v === 4) Object.assign(S, o);
  else for (const k of KEEP) if (o[k] !== undefined) S[k] = o[k];   // the update to v4 starts with everything off
} catch (e) { }
const voiceNames = () => KIT_VOICES[S.kit];
// effects are per channel: tracks 1-3 and the drums (index 3), each with its own settings
const FX_IDS = ['dlyMix', 'dlyDiv', 'dlyFb', 'dlyTone', 'rev', 'revSize', 'revDamp', 'revPre', 'choMix', 'choDepth', 'choRate', 'bits', 'down', 'filt', 'res', 'lfoTgt', 'lfoRate', 'lfoDepth', 'lfoShape'];
// per drum sound (the 11 of a kit): length (gate, %), pitch (semitones), level (%)
const freshSnd = () => ({ gate: Array(11).fill(100), tune: Array(11).fill(0), level: Array(11).fill(100) });
if (!S.dsnd || !Array.isArray(S.dsnd.gate)) S.dsnd = freshSnd();
if (!Array.isArray(S.tfx) || S.tfx.length !== 4) S.tfx = [0, 1, 2, 3].map(() => Object.fromEntries(FX_IDS.map(k => [k, S[k] !== undefined ? S[k] : DEF[k]])));
for (const t of S.tfx) for (const k of FX_IDS) if (t[k] === undefined) t[k] = DEF[k];
try { if (JSON.parse(localStorage.getItem('fm1loop') || '{}').v !== 4) localStorage.setItem('fm1loop', JSON.stringify(S)); } catch (e) { }
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
  FILTER: { name: 'FILTER', p: [P('filt', 'FILTER', -100, 100, 1, v => v === 0 ? 'AUS' : v < 0 ? 'TP ' + (-v) : 'HP ' + v), P('res', 'RESONANZ', 0, 100, 1, null, 'RESO')] },
  STUTTER: { name: 'STUTTER', p: [P('stutDiv', 'LAENGE', 0, 3, 1, v => '1/' + STUT_DIV[v])] },   // all tracks; FX held = stutter
};
const FX_KEYS = Object.keys(FX_SUB);
const SAVE_ACTS = ['SPEICHERN', 'LADEN', 'NEU', 'NEU+FX', 'LIVE', 'MIX', 'STEMS DRY', 'STEMS FX'];
let projList = [];
const PAGES = {
  FX: { btn: 2, get name() { return chName() + ' ' + FX_SUB[FX_KEYS[S.fxSel]].name + ' ' + (S.fxSel + 1) + '/' + FX_KEYS.length; }, get p() { return FX_SUB[FX_KEYS[S.fxSel]].p; } },
  LFO: { get name() { return chName() + ' LFO'; }, btn: 5, p: [P('lfoTgt', 'ZIEL', 0, 3, 1, v => LFO_TGT[v]), P('lfoRate', 'TEMPO', 0, 6, 1, v => LFO_DIV[v][0], 'RATE'),
    P('lfoDepth', 'STAERKE', 0, 100, 1), P('lfoShape', 'FORM', 0, 4, 1, v => LFO_SHAPE[v])] },
  ENV: { get name() { return 'DRUM: ' + T(voiceNames()[voice]); }, btn: 4, p: [P('dGate', 'GATE (LAENGE)', 5, 100, 1, v => v >= 100 ? 'VOLL' : v + '%', 'GATE'),
    P('dTune', 'TONHOEHE', -12, 12, 1, v => (v > 0 ? '+' : '') + v + (LANG === 'en' ? ' ST' : ' HT'), 'TON'), P('dLevel', 'LAUTST.', 0, 100, 1)] },
  SPUR: { name: 'SPUREN', btn: 8, p: [P('tVol', 'LAUTST.', 0, 100, 1), P('tPan', 'PANORAMA', -100, 100, 2, v => v === 0 ? 'MITTE' : (v < 0 ? 'L ' + (-v) : 'R ' + v), 'PAN'), P('tRev', 'RUECKW.', 0, 1, 1, v => v ? 'AN' : 'AUS', 'RUECKW'), P('recToDub', 'NACH REC', 0, 1, 1, v => v ? 'DUB' : 'PLAY', 'N.REC')] },
  DRUMS: { get name() { return 'DRUMS ' + T(KITS[S.kit]).split(' ')[0] + ' ' + stepPageName(); }, btn: 11, p: [P('drumVol', 'LAUTST.', 0, 100, 1),
    P('bpm', 'BPM (GLOBAL)', 50, 200, 1, v => Math.round(v) + '', 'BPM'), P('drumLen', 'SCHRITTE', 1, 64, 1)] },
  SAVE: { btn: 9, get name() { return 'SAVE ' + Save.safe(S.projName).toUpperCase(); },
    p: [P('saveAct', 'AKTION', 0, SAVE_ACTS.length - 1, 1, v => SAVE_ACTS[v]), P('saveLoops', 'LOOPS', 1, 16, 1, v => v + 'X'),
      P('saveProj', 'PROJEKT', 0, 99, 1, v => (projList[v] ? Save.safe(projList[v].name).toUpperCase() : '-'))] },
  MIKRO: { name: 'MIKRO + AUSGANG', btn: 7, p: [P('inGain', 'EINGANG', 0, 200, 2), P('mon', 'MITHOEREN', 0, 100, 2, null, 'MONITOR'), P('lat', 'LATENZ', 0, 400, 1, v => v + 'ms'), P('glow', 'TASTENLICHT', 0, 8, 1, v => v ? String(v) : 'AUS', 'LICHT')] },
};
function chName() { return sel < 3 ? 'S' + (sel + 1) : 'DR'; }
const ALL_PARAMS = [...Object.values(FX_SUB).flatMap(g => g.p), ...Object.keys(PAGES).filter(k => k !== 'FX').flatMap(k => PAGES[k].p),
  P('kit', 'KIT', 0, KITS.length - 1, 1, v => T(KITS[v])), P('pat', 'MUSTER', 0, PATTERNS.length - 1, 1, v => T(PATTERNS[v].name))];   // chosen with SELECT / PRESETS and on the screen
const WEB_TABS = ['FX', 'LFO', 'SPUR', 'DRUMS'];   // MIKRO: in the settings, ENV: its own DRUM-SOUND window
let webTab = 'FX';   // the page the FX window on the screen shows (the FM-1 may be on another one)
// the pattern: up to 64 sixteenths, drumLen of them loop; the 16 step keys show one page of 16 (OCT- / OCT+)
let stepPage = 0;
const nPages = () => Math.ceil(S.drumLen / 16);
function pageStep(k) { const s = stepPage * 16 + k; return s < S.drumLen ? s : -1; }   // key k -> step, or -1 beyond the length
function stepPageName() { const a = stepPage * 16 + 1; return a + '-' + Math.min(S.drumLen, a + 15); }
function setStepPage(n) { stepPage = Math.max(0, Math.min(nPages() - 1, n)); $('#grid').innerHTML = ''; renderGrid(); updateLeds(); lastSig = ''; drawScreen(); }
function setFx(i) { S.fxSel = (i + FX_KEYS.length) % FX_KEYS.length; save(); setPage('FX'); }
const PAGE_KEYS = Object.keys(PAGES);

function getP(id) {
  const t = st && sel < 3 ? st.tracks[sel] : null;
  if (id === 'tVol') return t ? Math.round(t.vol * 100) : 80;
  if (id === 'tPan') return t ? Math.round(t.pan * 100) : 0;
  if (id === 'tRev') return t && t.rev ? 1 : 0;
  if (id === 'bpm') return st ? Math.round(st.bpm) : S.bpm;
  if (id === 'saveProj') return S.saveProj || 0;
  if (id === 'dGate') return S.dsnd.gate[voice];
  if (id === 'dTune') return S.dsnd.tune[voice];
  if (id === 'dLevel') return S.dsnd.level[voice];
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
    if (id === 'bpm' && st && st.master > 0) { toast(T('Tempo ist durch die Aufnahme festgelegt (vor der ersten Aufnahme einstellen)')); return; }
    if (id === 'dGate' || id === 'dTune' || id === 'dLevel') {
      const k = { dGate: 'gate', dTune: 'tune', dLevel: 'level' }[id];
      S.dsnd[k][voice] = v; save(); changed = true;
      send({ t: 'set', k, v: { v: voice, x: k === 'level' ? v / 100 : v } });
      renderParams(); drawParam(id); return;
    }
    if (id === 'saveProj') v = Math.min(v, Math.max(0, projList.length - 1));
    if (FX_IDS.includes(id)) { S.tfx[sel][id] = v; save(); applyFx(sel, id); changed = true; }
    else { S[id] = v; save(); applyParam(id); }
  }
  renderParams(); drawParam(id);
}

// ---- audio --------------------------------------------------------------------------------
function send(m) { if (node) node.port.postMessage(m); }


async function startAudio() {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  const src = document.getElementById('worklet-src').textContent;
  // blob: works on a web server; a page opened as a file (origin null) needs a data: URL
  try { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))); }
  catch (e) { await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(src)); }
  node = new AudioWorkletNode(ctx, 'loop-engine', { numberOfInputs: 1, numberOfOutputs: 5, outputChannelCount: [2, 2, 2, 2, 2], channelCount: 1, channelCountMode: 'explicit' });
  node.port.onmessage = m => onStatus(m.data);
  const m = FXChain.master(ctx, ctx.destination, 1); fx.master = m.gain; fx.lim = m.lim;
  // per channel (tracks 1-3, drums) its own chain; the bitcrusher runs in the engine
  fx.ch = [0, 1, 2, 3].map(c => { const f = FXChain.make(ctx, fx.master); node.connect(f.input, c); return f; });
  node.connect(fx.master, 4);
  fx.tap = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  fx.tap.port.onmessage = m => { live.chunks.push(m.data); live.n += m.data.L.length; };
  const silent = ctx.createGain(); silent.gain.value = 0;
  fx.lim.connect(fx.tap); fx.tap.connect(silent); silent.connect(ctx.destination);   // microphone monitor and click: no effects
  if (S.lat < 0) S.lat = Math.round(((ctx.baseLatency || 0.01) + (ctx.outputLatency || 0.02)) * 1000 + 15);
  for (const k of Object.keys(DEF)) if (!FX_IDS.includes(k)) applyParam(k);
  for (let c = 0; c < 4; c++) for (const k of FX_IDS) applyFx(c, k);
  // drums
  kits = [await decodeRock(), ...makeKits(ctx.sampleRate)];
  send({ t: 'set', k: 'kits', v: kits });
  applyParam('dsnd');
  await openMic();
  await listDevices();
  if (S.outId) setOutput(S.outId);
  try { await navigator.wakeLock.request('screen'); } catch (e) { }
}

function applyFx(c, k) {
  if (!ctx) return;
  if (k === 'bits' || k === 'down') { send({ t: 'set', k, v: { i: c, v: S.tfx[c][k] } }); return; }
  FXChain.set(ctx, fx.ch[c], k, S.tfx[c], st ? st.bpm : S.bpm);
}
// the random LFO shape: new values, scheduled a little ahead
setInterval(() => { if (ctx && fx.ch) for (let c = 0; c < 4; c++) FXChain.tick(ctx, fx.ch[c], S.tfx[c], st ? st.bpm : S.bpm); }, 250);

function applyParam(k) {
  if (!ctx) return;
  const v = S[k], now = ctx.currentTime, set = (prm, x) => prm.setTargetAtTime(x, now, 0.02);
  const beat = () => 60 / (st ? st.bpm : S.bpm);
  switch (k) {
    case 'bpm': for (let c = 0; c < 4; c++) { applyFx(c, 'dlyDiv'); applyFx(c, 'lfoRate'); } send({ t: 'set', k: 'bpm', v }); break;
    case 'drumLen': send({ t: 'set', k, v }); stepPage = Math.min(stepPage, nPages() - 1); $('#grid').innerHTML = ''; renderGrid(); updateLeds(); break;
    case 'dsnd': for (let i = 0; i < 11; i++) for (const q of ['gate', 'tune', 'level']) send({ t: 'set', k: q, v: { v: i, x: q === 'level' ? S.dsnd[q][i] / 100 : S.dsnd[q][i] } }); break;
    case 'stutDiv': send({ t: 'set', k: 'stutDiv', v: STUT_DIV[v] }); break;
    case 'pat': send({ t: 'set', k: 'preset', v: patternArray(v) }); break;
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
let painted = '', lastSig = '', lastLed = -1n, lastProg = 0, lastPat = '';
function onStatus(s) {
  if (s.t === 'snapshot') { if (snapWait) { snapWait(s.snap); snapWait = null; } return; }
  const prev = st; st = s;
  if (prev && (s.master !== prev.master || s.tracks.some((t, i) => t.state !== prev.tracks[i].state && (t.state === 'play' || t.state === 'dub')))) changed = true;
  if (s.wave) { wave = s.wave; fmWaveDirty = true; }
  for (const ev of s.events) if (ev.t === 'loop') { toast(`Loop: ${ev.bars} ${T(ev.bars > 1 ? 'Takte' : 'Takt')}, ${Math.round(ev.bpm)} BPM`); for (let c = 0; c < 4; c++) applyFx(c, 'dlyDiv'); }
  const sig = JSON.stringify([s.tracks.map(t => [t.state, t.pending, t.canUndo, t.canRedo, t.len]), s.running, s.armed, s.drumOn, s.drumRec, s.clickOn, sel, page, Math.round(s.bpm), s.master > 0, s.drumLen]);
  if (sig !== lastSig) { lastSig = sig; renderTracks(); drawScreen(); renderParams(); }
  const pat = s.pattern.join('');
  if (pat !== lastPat) { if (lastPat) changed = true; lastPat = pat; renderGrid(); fmWaveDirty = true; }
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
let fmMsg = '', fmMsgUntil = 0;
function fmSay(m) { fmMsg = m; fmMsgUntil = performance.now() + 2500; lastSig = ''; drawScreen(); setTimeout(() => { lastSig = ''; drawScreen(); }, 2600); }
function bigWord() {
  if (fmMsg && performance.now() < fmMsgUntil) return fmMsg;
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
  const o = FM1.op, ops = [];
  // once per connection and design: the whole screen in the background colour (the gaps between the
  // regions and what the splash left there); after that only the regions, so nothing flashes
  if (painted !== link.session + S.theme) { ops.push(o.rect(0, 0, 240, 240, C.bg)); painted = link.session + S.theme; }
  ops.push(o.rect(0, 0, 240, 4, C.bg), o.rect(150, 4, 24, 16, C.bg), o.rect(0, Y.tiles - 6, 240, Y.tileH + 10, C.bg));
  ops.push(o.text(6, 4, 2, C.accent, C.bg, 'OUROLOOPS'));
  ops.push(o.text(174, 4, 2, C.fg, C.bg, String(Math.round(st.bpm)).padStart(3) + ' '));
  ops.push(o.text(120, 4, 2, C.rec, C.bg, live.on ? 'LIVE' : '    '));
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
  const val = TV(p.fmt(getP(p.id))).slice(0, 9).padEnd(9);
  if (link.features & 1) {   // our firmware: the label in 12 px above the value in 16 px
    const label = ('K' + (i + 1) + ' ' + T(p.short)).slice(0, 12).padEnd(12);
    return [o.text(x, y, 1.5, C.dim, C.bg, label), o.text(x, y + 15, 2, C.fg, C.bg, val)];
  }
  const label = ('K' + (i + 1) + ' ' + T(p.short).slice(0, 6)).padEnd(9);
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
  else if (sel === 3 && st.step >= 0) { f = (st.step + 1) / st.drumLen; c = C.drum; }
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
// DR selected: the selected drum sound over the whole pattern instead of a waveform
function drumStripOps() {
  const o = FM1.op, ops = [o.rect(6, Y.wave, 228, Y.waveH, C.bg)], n = st.drumLen, w = 228 / n;
  for (let i = 0; i < n; i++) {
    const on = st.pattern[voice * 64 + i];
    const x = 6 + Math.floor(i * w), cw = Math.max(1, Math.floor((i + 1) * w) - Math.floor(i * w) - (w >= 3 ? 1 : 0));
    ops.push(on ? o.rect(x, Y.wave, cw, Y.waveH, C.drum) : o.rect(x, Y.wave + Y.waveH / 2 - 1, cw, 2, C.dark));
  }
  return ops;
}
function waveOps() {
  if (sel === 3 && st) return drumStripOps();
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
  if (!t) {   // DR: a small read-only view of the whole drum pattern, with the play position
    const n = st.drumLen, cw = W / n, rh = (H - 22) / 11;
    label.textContent = 'DRUMS · ' + n + ' ' + T('Schritte');
    g.clearRect(0, 0, W, H);
    for (let v = 0; v < 11; v++) for (let i = 0; i < n; i++) {
      if (!st.pattern[v * 64 + i]) continue;
      g.fillStyle = v === voice ? col('--drum') : col('--dim');
      g.fillRect(i * cw + 0.5, 20 + v * rh + 0.5, Math.max(1, cw - 1), Math.max(1, rh - 1));
    }
    g.fillStyle = col('--line');
    for (let b = 16; b < n; b += 16) g.fillRect(b * cw, 18, 1, H - 18);   // bar lines
    if (st.step >= 0) { g.globalAlpha = 0.28; g.fillStyle = col('--now'); g.fillRect(st.step * cw, 18, Math.max(2, cw), H - 18); g.globalAlpha = 1; }
    return;
  }
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
const USED_BTNS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
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
  for (let k = 0; k < 16; k++) { const g = pageStep(k); if (g < 0) continue; let on = !!st.pattern[voice * 64 + g]; if (g === st.step) on = !on; if (on) bit(14 + k); }
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
  if (!on) return;                     // keys 1..16: the steps of the selected drum voice on the current page
  const g = pageStep(k); if (g < 0) return;
  const idx = voice * 64 + g, v = st.pattern[idx] ? 0 : 1;
  st.pattern[idx] = v; send({ t: 'set', k: 'step', v: { v: voice, s: g, on: v } }); renderGrid(); updateLeds(); fmWaveDirty = true; drawFmWave(true);
};
function reveal(id) {
  const el = document.getElementById(id); if (!el) return;
  const r = el.getBoundingClientRect(), h = innerHeight;
  if (r.top < 60 || r.top > h * 0.5) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
// ARP (10) jumps nowhere; GLO (7) goes to the settings, where the MIKRO knobs are too
const BTN_SECTION = { 0: 'secDrums', 1: 'secDrums', 9: 'secSave', 2: 'secFx', 4: 'secSound', 5: 'secFx', 6: 'secHelp', 7: 'secSettings', 11: 'secDrums', 12: 'secTracks', 13: 'secTracks', 8: 'secTracks' };
link.onButton = (b, on) => {
  const B = FM1.BTN;
  if (on && BTN_SECTION[b]) reveal(sel === 3 && (b === 12 || b === 13) ? 'secDrums' : BTN_SECTION[b]);
  if (on) held[b] = performance.now();
  const dur = on ? 0 : performance.now() - (held[b] || 0);
  switch (b) {
    case B.REC:   // press: record / overdub / play (as always); held 1 s: undo (Boss: hold REC/DUB/PLAY)
      if (on) { recPress(); held.recTimer = setTimeout(() => { held.recTimer = 0; recHold(); }, 1000); }
      else if (held.recTimer) { clearTimeout(held.recTimer); held.recTimer = 0; }
      break;
    case B.PLAY:   // press: start / stop; held 2 s: clear everything (Boss: hold STOP)
      if (on) { send({ t: 'play' }); held.playTimer = setTimeout(() => { held.playTimer = 0; send({ t: 'clearAll' }); toast(T('Alles geloescht')); fmSay(T('GELOESCHT')); }, 2000); }
      else if (held.playTimer) { clearTimeout(held.playTimer); held.playTimer = 0; }
      break;
    case B.OCTM: if (on) { setStepPage(stepPage - 1); toast('DRUMS ' + stepPageName()); } break;   // the step keys: previous / next page
    case B.OCTP: if (on) { setStepPage(stepPage + 1); toast('DRUMS ' + stepPageName()); } break;
    case B.SCL: if (on) nextTheme(); break;   // SEL: the design (a hidden feature)
    case B.HOME:   // tap: the main page (SELECT chooses the track), hold: mute / unmute the track
      if (on) held.homeTimer = setTimeout(() => { held.homeTimer = 0; send({ t: 'stop', i: sel }); }, 500);
      else if (held.homeTimer) { clearTimeout(held.homeTimer); held.homeTimer = 0; setPage('SPUR'); }
      break;
    case B.EDIT: if (on) { reveal('secHelp'); fmSay(T('LEGENDE')); } break;   // the legend (what every key does)
    case B.ARP:   // tap: drums on / off, hold: click on / off
      if (on) held.arpTimer = setTimeout(() => { held.arpTimer = 0; toggleClick(); }, 450);
      else if (held.arpTimer) { clearTimeout(held.arpTimer); held.arpTimer = 0; toggleDrums(); }
      break;
    case B.SAVE:   // tap: the save page, on it: do what K1 says; hold: clear the track
      if (on) held.saveTimer = setTimeout(() => { clearSel(); held.saveTimer = 0; }, 800);
      else if (held.saveTimer) { clearTimeout(held.saveTimer); held.saveTimer = 0; if (page === 'SAVE') saveAction(); else { ensureProject().then(() => { setPage('SAVE'); lastSig = ''; drawScreen(); }); } }
      break;
    case B.FX:   // tap: the FX page (on it: the next effect); held: stutter while held
      if (on) held.stutTimer = setTimeout(() => { held.stutTimer = 0; stutter(true); }, 220);
      else if (held.stutTimer) { clearTimeout(held.stutTimer); held.stutTimer = 0; if (page === 'FX') setFx(S.fxSel + 1); else setPage('FX'); }
      else stutter(false);
      break;
    default: {
      const pk = PAGE_KEYS.find(k => PAGES[k].btn === b);
      if (pk && on) setPage(pk);
    }
  }
};
link.onEncoder = (e, d) => {
  // knobs never move the screen to another window (only the buttons do)
  if (e === 0 && page === 'FX') { setFx(S.fxSel + (d > 0 ? 1 : -1)); return; }
  if (e === 0 && (page === 'DRUMS' || page === 'ENV')) { setP('kit', (S.kit + (d > 0 ? 1 : KITS.length - 1)) % KITS.length); lastSig = ''; drawScreen(); toast('Kit: ' + T(KITS[S.kit])); return; }
  if (e === 0) { select((sel + (d > 0 ? 1 : 3)) % 4); reveal('secTracks'); return; }
  if (e === 6) { setP('pat', (S.pat + (d > 0 ? 1 : PATTERNS.length - 1)) % PATTERNS.length); toast(T('Muster') + ': ' + T(PATTERNS[S.pat].name)); return; }
  if (e === 1) { setVoice((voice + (d > 0 ? 1 : 10)) % 11); toast('Drum: ' + T(voiceNames()[voice])); return; }
  const p = PAGES[page].p[e - 2]; if (!p) return;
  const acc = Math.abs(d) > 2 ? 3 : 1;
  setP(p.id, getP(p.id) + Math.sign(d) * p.step * acc);
};
link.onOct = dir => link.onButton(dir > 0 ? FM1.BTN.OCTP : FM1.BTN.OCTM, true);   // OCT comes as an octave report (see fm1.js)
link.onRedraw = () => { lastLed = -1n; drawScreen(); updateLeds(); sendGlow(); };
let dropFixAt = 0;
link.onFeatures = () => { lastSig = ''; if (st) drawScreen(); };
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

// ---- saving ----------------------------------------------------------------------------------
let snapWait = null, changed = false;
function getSnap() { return new Promise(res => { snapWait = res; send({ t: 'snapshot', id: Date.now() }); }); }
function settingsOf() { return { tfx: S.tfx, drumVol: S.drumVol, pat: S.pat, kit: S.kit, master: S.master, recToDub: S.recToDub, clickOn: !!(st && st.clickOn), dsnd: S.dsnd }; }
async function refreshProjects() {
  try { projList = await Save.listProjects(); } catch (e) { projList = []; }
  const i = projList.findIndex(p => p.id === S.projId); if (i >= 0 && !S.saveProj) S.saveProj = i;
  renderSave(); if (page === 'SAVE') drawScreen();
}
function newId() { return 'p' + Date.now().toString(36); }
async function ensureProject() {
  if (S.projId) return;
  await refreshProjects();
  S.projId = newId(); S.projName = 'Session ' + (projList.length + 1); save();
}
async function saveProject(auto) {
  await ensureProject();
  const snap = await getSnap(), old = await Save.getProject(S.projId).catch(() => null);
  await Save.putProject({ id: S.projId, name: S.projName, created: old ? old.created : Date.now(), updated: Date.now(), auto: !!auto, sr: ctx.sampleRate, snap, settings: settingsOf() });
  changed = false; await refreshProjects();
  if (!auto) { toast(T('Projekt gespeichert') + ': ' + S.projName); fmSay(T('GESPEICHERT')); }
}
async function loadProject(id) {
  const p = await Save.getProject(id); if (!p) return;
  if (changed && S.projId && S.projId !== id) await saveProject(true);
  applyProject(p);
  toast(T('Projekt geladen') + ': ' + p.name); fmSay(T('GELADEN'));
}
function applyProject(p) {
  S.projId = p.id; S.projName = p.name;
  const g = p.settings || {};
  if (g.tfx) S.tfx = g.tfx;
  for (const k of ['drumVol', 'pat', 'kit', 'master', 'recToDub', 'dsnd']) if (g[k] !== undefined) S[k] = g[k];
  for (const t of S.tfx) for (const k of FX_IDS) if (t[k] === undefined) t[k] = DEF[k];
  S.drumLen = p.snap.drumLen || 16; stepPage = 0;
  if (p.snap.gate) S.dsnd = { gate: p.snap.gate, tune: p.snap.tune, level: p.snap.level.map(x => Math.round(x * 100)) };
  save();
  const snap = p.snap, transfer = snap.tracks.filter(t => t.data).map(t => t.data.buffer);
  node.port.postMessage({ t: 'load', p: snap }, transfer);
  for (let c = 0; c < 4; c++) for (const k of FX_IDS) applyFx(c, k);
  for (const k of ['drumVol', 'master', 'recToDub']) applyParam(k);
  send({ t: 'set', k: 'clickOn', v: !!g.clickOn });
  $('#grid').innerHTML = ''; renderGrid(); renderParams(); changed = false; refreshProjects();
}
// back to the start values (effects off); the device settings (KEEP) and the loops stay
function freshFx() { return [0, 1, 2, 3].map(() => Object.fromEntries(FX_IDS.map(k => [k, DEF[k]]))); }
function resetSettings(fxOnly) {
  if (!fxOnly) for (const k of Object.keys(DEF)) if (!KEEP.includes(k) && !['projId', 'projName', 'v', 'bpm'].includes(k)) S[k] = DEF[k];
  S.tfx = freshFx(); if (!fxOnly) S.dsnd = freshSnd(); save();
  if (ctx) { for (let c = 0; c < 4; c++) for (const k of FX_IDS) applyFx(c, k); if (!fxOnly) { for (const k of Object.keys(DEF)) if (!FX_IDS.includes(k)) applyParam(k); applyParam('dsnd'); } }
  $('#grid').innerHTML = ''; renderGrid(); renderParams(); lastSig = ''; if (st) drawScreen(); changed = true;
}
async function newProject(keepFx) {
  if (changed && S.projId) await saveProject(true);
  send({ t: 'clearAll' });
  if (!keepFx) resetSettings(true);
  await refreshProjects();
  S.projId = newId(); S.projName = 'Session ' + (projList.length + 1); changed = false; save();
  renderSave(); toast(T('Neues Projekt') + ': ' + S.projName); fmSay(T('NEU'));
}
async function exportProject() {
  await saveProject(true);
  const p = await Save.getProject(S.projId);
  const r = await Save.write(`${Save.safe(p.name)}.ouroloops`, Save.projectFile(p), p.name);
  toast(T('Gespeichert in') + ' ' + r.where);
}
async function importProject(file) {
  try {
    const p = Save.readProjectFile(new Uint8Array(await file.arrayBuffer()));
    p.id = newId(); p.updated = Date.now();
    await Save.putProject(p); applyProject(p); toast(T('Projekt geladen') + ': ' + p.name);
  } catch (e) { toast(T('Datei nicht lesbar') + ': ' + e.message); }
}
async function exportAudio(kind) {
  await ensureProject();
  const snap = await getSnap();
  if (!snap.tracks.some(t => t.data) && !snap.drumOn) { toast(T('Nichts zum Exportieren')); return; }
  fmSay(T('RECHNET')); toast(T('Rechnet …'));
  const loops = S.saveLoops, kits_ = kits, sr = ctx.sampleRate, set = { tfx: S.tfx, drumVol: S.drumVol / 100, master: S.master };
  const tag = kind === 'mix' ? `Mix-${loops}x` : kind === 'dry' ? `Stems-dry-${loops}x` : `Stems-fx-${loops}x`;
  const out = await Save.render(snap, set, kits_, sr, { loops, fx: kind !== 'dry', stems: kind !== 'mix' });
  let r;
  if (kind === 'mix') r = await Save.write(Save.fileName(S.projName, tag, 'wav'), Save.wav(out.mix, sr, 16), S.projName);
  else r = await Save.write(Save.fileName(S.projName, tag, 'zip'), Save.zip(out.stems.map(x => ({ name: x.name + '.wav', data: Save.wav(x.channels, sr, 16) }))), S.projName);
  toast(T('Gespeichert in') + ' ' + r.where + ': ' + r.name); fmSay(T('GESPEICHERT'));
}
// live recording of everything that comes out
const live = { on: false, chunks: [], n: 0, t0: 0 };
function liveToggle() {
  if (!fx.tap) return;
  if (!live.on) {
    live.on = true; live.chunks = []; live.n = 0; live.t0 = performance.now();
    fx.tap.port.postMessage({ on: true }); toast(T('Live-Mitschnitt laeuft')); fmSay('LIVE REC');
  } else {
    live.on = false; fx.tap.port.postMessage({ on: false });
    setTimeout(async () => {
      const L = new Float32Array(live.n), R = new Float32Array(live.n); let o = 0;
      for (const c of live.chunks) { L.set(c.L, o); R.set(c.R, o); o += c.L.length; }
      live.chunks = [];
      await ensureProject();
      const r = await Save.write(Save.fileName(S.projName, 'Live', 'wav'), Save.wav([L, R], ctx.sampleRate, 16), S.projName);
      toast(T('Gespeichert in') + ' ' + r.where + ': ' + r.name); fmSay(T('GESPEICHERT'));
    }, 150);
  }
  lastSig = ''; renderSave(); drawScreen();
}
function saveAction() {
  const a = SAVE_ACTS[S.saveAct];
  if (a === 'SPEICHERN') saveProject(false);
  else if (a === 'LADEN') { const p = projList[S.saveProj || 0]; if (p) loadProject(p.id); }
  else if (a === 'NEU') newProject(false);
  else if (a === 'NEU+FX') newProject(true);
  else if (a === 'LIVE') liveToggle();
  else if (a === 'MIX') exportAudio('mix');
  else if (a === 'STEMS DRY') exportAudio('dry');
  else exportAudio('fx');
}
function renderSave() {
  if (!$('#projName')) return;
  if (document.activeElement !== $('#projName')) $('#projName').value = S.projName || '';
  $('#projList').innerHTML = projList.length ? projList.map(p => `<option value="${esc(p.id)}" ${p.id === S.projId ? 'selected' : ''}>${esc(p.name)} · ${new Date(p.updated).toLocaleString()}</option>`).join('') : `<option value="">${esc(T('noch keine Projekte'))}</option>`;
  $('#bLive').classList.toggle('on', live.on);
  $('#bLive').textContent = live.on ? T('Mitschnitt stoppen') : T('Live-Mitschnitt starten');
  $('#selLoops').value = S.saveLoops;
  $('#folderRow').hidden = !Save.canChooseFolder();
  $('#folderName').textContent = Save.folderName() || T('noch keiner (Download-Ordner)');
}
setInterval(() => { if (live.on) { const s = Math.floor((performance.now() - live.t0) / 1000); $('#liveTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); } else $('#liveTime').textContent = ''; }, 500);
// autosave once a minute when something changed
setInterval(() => { if (node && changed && st && (st.master > 0 || st.drumOn)) saveProject(true).catch(() => { }); }, 60000);

// ---- actions ---------------------------------------------------------------------------------
function recPress() { if (sel === 3) send({ t: 'drumRec' }); else send({ t: 'rec', i: sel }); }
function recHold() { send(sel === 3 ? { t: 'undo', i: 3 } : { t: 'recHold', i: sel }); toast('UNDO'); }
function toggleDrums() { send({ t: 'stop', i: 3 }); }
function toggleClick() { const on = !(st && st.clickOn); send({ t: 'set', k: 'clickOn', v: on }); toast(T(on ? 'Klick an' : 'Klick aus')); }
function clearSel() { send({ t: 'clear', i: sel }); toast(sel === 3 ? T('Drum-Muster geloescht') : T('SPUR') + ' ' + (sel + 1) + ' ' + T('geloescht')); }
function stutter(on) { send({ t: 'set', k: 'stut', v: on }); $('#stut').classList.toggle('on', on); }
function select(i) { sel = i; lastSig = ''; wave = null; send({ t: 'wave', i: i < 3 ? i : -1, bins: 400 }); renderTracks(); renderParams(); drawScreen(); updateLeds(); }
function setPage(k) { page = k; if (WEB_TABS.includes(k)) webTab = k; renderParams(); drawScreen(); updateLeds(); }
function setVoice(v) { voice = v; renderGrid(); updateLeds(); renderParams(); fmWaveDirty = true; drawFmWave(true); lastSig = ''; drawScreen(); }

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
    const bars = i < 3 && t.len && st.master ? t.len / (st.master / st.bars) : i === 3 && st.drumLen % 16 === 0 ? st.drumLen / 16 : 0;
    const barTxt = bars ? (Math.abs(bars - Math.round(bars)) < 0.01 ? Math.round(bars) : bars.toFixed(1)) + ' ' + T(bars > 1 ? 'Takte' : 'Takt') : i === 3 ? st.drumLen + ' ' + T('Schritte') : '';
    return `<button class="track ${cls} ${i === sel ? 'sel' : ''}" data-i="${i}">
      <span class="tn">${i === 3 ? 'DRUMS' : T('SPUR') + ' ' + (i + 1)}</span><span class="ts">${state}</span>
      <span class="tl">${esc(len)}</span><span class="tl">${esc(barTxt)}</span><span class="bar"><i id="pb${i}"></i></span><span class="lv"><i id="lv${i}"></i></span></button>`;
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
  const hint = h => `<small>${esc(T(h))}</small>`;
  $('#bUndo').innerHTML = (sel === 3 ? (st.canDrumRedo ? 'REDO' : 'UNDO') : (t.canRedo ? 'REDO' : 'UNDO')) + hint('REC halten');
  $('#bUndo').disabled = sel === 3 ? !(st.canDrumUndo || st.canDrumRedo) : !(t.canUndo || t.canRedo || t.state === 'rec' || st.armed === sel);
  $('#bStop').innerHTML = esc(T(sel === 3 ? (st.drumOn ? 'DRUMS AUS' : 'DRUMS AN') : (t.state === 'stop' ? 'SPUR AN' : 'SPUR STUMM'))) + hint(sel === 3 ? 'ARP tippen' : 'HOME halten');
  $('#bClick').classList.toggle('on', !!st.clickOn);
  $('#bpm').textContent = Math.round(st.bpm) + ' BPM' + (st.master ? ' · ' + st.bars + ' ' + T(st.bars > 1 ? 'Takte' : 'Takt') : '');
}

function updateMeters() {
  const lv = x => Math.min(100, Math.round(Math.sqrt(x) * 100)) + '%';
  $('#mIn').style.width = lv(st.meterIn); $('#mIn2').style.width = lv(st.meterIn); $('#mOut').style.width = lv(st.meterOut);
  $('#mIn').classList.toggle('clip', st.meterIn > 0.98);
  st.tracks.forEach((t, i) => {
    const pb = $('#pb' + i), l = $('#lv' + i);
    if (pb) pb.style.width = (t.state === 'rec' ? (st.master ? (t.rec % st.master) / st.master : Math.min(1, t.rec / (ctx.sampleRate * 8))) : t.pos) * 100 + '%';
    if (l) l.style.width = lv(t.peak);
  });
  const pb = $('#pb3'); if (pb) pb.style.width = st.step >= 0 ? (st.step + 1) / st.drumLen * 100 + '%' : '0%';
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
  $('#sndParams').innerHTML = paramsHtml(PAGES.ENV);
  $('#sndVoices').innerHTML = voiceNames().map((n, i) => `<button data-v="${i}" class="${i === voice ? 'on' : ''}">${esc(T(n))}</button>`).join('');
  $('#pages').innerHTML = WEB_TABS.map(k => `<button data-p="${k}" class="${k === webTab ? 'on' : ''}">${T(k)}</button>`).join('');
  $('#fxsubs').hidden = webTab !== 'FX'; $('#stut').hidden = webTab === 'DRUMS';
  $('#fxsubs').innerHTML = FX_KEYS.map((k, i) => `<button data-fx="${i}" class="${i === S.fxSel ? 'on' : ''}">${k}</button>`).join('');
  $('#fxFor').textContent = webTab === 'DRUMS' ? '' : T('fuer') + ' ' + (sel < 3 ? T('SPUR') + ' ' + (sel + 1) : 'DRUMS');
  const pg = PAGES[webTab];
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
      Array.from({ length: 16 }, (_, k) => { const s = stepPage * 16 + k, out = s >= S.drumLen;
        return `<button class="st ${k % 4 === 0 ? 'q' : ''} ${out ? 'out' : ''}" data-v="${r}" data-s="${s}" ${out ? 'disabled' : ''}></button>`; }).join('')}</div>`).join('');
    $('#stepPage').textContent = stepPageName();
    $('#bPgPrev').disabled = stepPage <= 0; $('#bPgNext').disabled = stepPage >= nPages() - 1;
    $('#lenVal').textContent = S.drumLen;
  }
  const pat = st ? st.pattern : [];
  g.querySelectorAll('.st').forEach(b => b.classList.toggle('on', !b.disabled && !!pat[b.dataset.v * 64 + +b.dataset.s]));
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
applyLang(); applyTheme(); renderSave();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
// Firefox and Safari cannot talk to the FM-1 (no Web MIDI with SysEx): say so before anything else
if (!navigator.requestMIDIAccess) $('#browserWarn').hidden = false;
$('#bLang').onclick = () => setLang(LANG === 'de' ? 'en' : 'de');
$('#selLang').onchange = e => setLang(e.target.value);

$('#start').onclick = async () => {
  $('#start').disabled = true; $('#start').textContent = T('Startet …');
  try {
    await startAudio();
    send({ t: 'wave', i: sel, bins: 400 });
    await Save.restoreFolder(); await refreshProjects();
    if (S.projId) { const p = await Save.getProject(S.projId).catch(() => null); if (p) applyProject(p); else S.projId = ''; }
    await ensureProject(); renderSave();
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
  else { const s = +b.dataset.s, idx = voice * 64 + s, v = st.pattern[idx] ? 0 : 1; st.pattern[idx] = v; send({ t: 'set', k: 'step', v: { v: voice, s, on: v } }); fmWaveDirty = true; }
  renderGrid(); updateLeds();
};
$('#selPat').onchange = e => setP('pat', +e.target.value);
$('#bPgPrev').onclick = () => setStepPage(stepPage - 1);
$('#bLenDown').onclick = () => setP('drumLen', S.drumLen - 1);
$('#bLenUp').onclick = () => setP('drumLen', S.drumLen + 1);
$('#sndVoices').onclick = e => { const b = e.target.closest('button'); if (b) setVoice(+b.dataset.v); };
$('#sndParams').oninput = e => { const i = e.target.closest('input'); if (i) setP(i.dataset.id, +i.value); };
$('#bPgNext').onclick = () => setStepPage(stepPage + 1);
$('#selKit').onchange = e => setP('kit', +e.target.value);
$('#projName').onchange = e => { S.projName = e.target.value.trim() || S.projName; save(); changed = true; if (S.projId) saveProject(true); };
$('#bSaveProj').onclick = () => saveProject(false);
$('#bNewProj').onclick = () => { $('#newAsk').hidden = !$('#newAsk').hidden; };
$('#bNewOff').onclick = () => { $('#newAsk').hidden = true; newProject(false); };
$('#bNewKeep').onclick = () => { $('#newAsk').hidden = true; newProject(true); };
$('#bReset').onclick = () => {
  const b = $('#bReset');
  if (!b.dataset.arm) { b.dataset.arm = 1; b.textContent = T('Wirklich zuruecksetzen?'); setTimeout(() => { delete b.dataset.arm; b.textContent = T('Alles zuruecksetzen'); }, 3000); return; }
  delete b.dataset.arm; b.textContent = T('Alles zuruecksetzen'); resetSettings(false); toast(T('Alles zurueckgesetzt, Effekte aus'));
};
$('#bLoadProj').onclick = () => { const id = $('#projList').value; if (id) loadProject(id); };
$('#bDelProj').onclick = async () => {
  const b = $('#bDelProj'), id = $('#projList').value; if (!id) return;
  if (!b.dataset.arm) { b.dataset.arm = 1; b.textContent = T('Wirklich loeschen?'); setTimeout(() => { delete b.dataset.arm; b.textContent = T('Loeschen'); }, 3000); return; }
  delete b.dataset.arm; b.textContent = T('Loeschen');
  await Save.delProject(id); if (id === S.projId) { S.projId = ''; save(); } refreshProjects(); toast(T('Projekt geloescht'));
};
$('#bExportProj').onclick = () => exportProject();
$('#fileProj').onchange = e => { const f = e.target.files[0]; if (f) importProject(f); e.target.value = ''; };
$('#bLive').onclick = () => liveToggle();
$('#selLoops').onchange = e => { S.saveLoops = +e.target.value; save(); renderParams(); };
$('#bMix').onclick = () => exportAudio('mix');
$('#bStemsDry').onclick = () => exportAudio('dry');
$('#bStemsFx').onclick = () => exportAudio('fx');
$('#bFolder').onclick = async () => { try { await Save.chooseFolder(); renderSave(); toast(T('Speicherort') + ': ' + Save.folderName()); } catch (e) { } };
$('#selLoops').innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">${i + 1}x</option>`).join('');
$('#selMic').onchange = e => { S.micId = e.target.value; save(); openMic(); };
$('#selOut').onchange = e => setOutput(e.target.value);
$('#bClearAll').onclick = () => { const b = $('#bClearAll'), t = $('#bClearAllT'); if (b.dataset.arm) { send({ t: 'clearAll' }); delete b.dataset.arm; t.textContent = T('Alles loeschen'); } else { b.dataset.arm = 1; t.textContent = T('Wirklich alles loeschen?'); setTimeout(() => { delete b.dataset.arm; t.textContent = T('Alles loeschen'); }, 3000); } };
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
