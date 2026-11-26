// Browser test: real Chrome, fake microphone (a tone), the software FM-1 of fm1-sim.js.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const page_ = path.resolve(__dirname, '../dist/ouroloops.html');
const sim = fs.readFileSync(path.join(__dirname, 'fm1-sim.js'), 'utf8');
const shots = path.resolve(__dirname, '../shots'); fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctxB = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, permissions: ['microphone'], locale: 'de-DE' });
  const page = await ctxB.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(sim);
  await page.goto('file://' + page_);
  await page.screenshot({ path: shots + '/0-intro.png' });
  await page.click('#start');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const fm1 = await page.textContent('#fm1');
  check(fm1.includes('verbunden'), 'FM-1 found by PING/PONG: ' + fm1);
  const S = () => page.evaluate(() => window.__fm1.st);
  let s = await S();
  check(JSON.stringify(s.scale) === '[7,0,3,0]', 'scale OFF sent to the FM-1: ' + JSON.stringify(s.scale));
  check(s.texts.includes('OUROLOOPS'), 'FM-1 screen drawn');

  // REC on the FM-1 -> recording, 2 s, REC again -> DUB, then PLAY state on REC
  await page.evaluate(() => window.__fm1.tap(13));
  await page.waitForTimeout(2000);
  let ts = await page.textContent('.track[data-i="0"] .ts');
  check(ts === 'REC', 'track 1 records after REC on the FM-1: ' + ts);
  let recLed = false;
  for (let i = 0; i < 8 && !recLed; i++) { recLed = await page.evaluate(() => window.__fm1.led(13)); await page.waitForTimeout(90); }
  check(recLed, 'REC LED on (blinking) while recording');
  await page.evaluate(() => window.__fm1.tap(13));
  await page.waitForTimeout(400);
  ts = await page.textContent('.track[data-i="0"] .ts');
  check(ts === 'DUB', 'REC again -> DUB (Boss): ' + ts);
  await page.evaluate(() => window.__fm1.tap(13));
  await page.waitForTimeout(300);
  ts = await page.textContent('.track[data-i="0"] .ts');
  check(ts === 'PLAY', 'REC again -> PLAY: ' + ts);
  const bpm = await page.textContent('#bpm');
  check(/BPM/.test(bpm) && !bpm.startsWith('–'), 'tempo from the loop: ' + bpm);
  let outLvl = 0;
  for (let i = 0; i < 20; i++) { outLvl = Math.max(outLvl, await page.evaluate(() => parseFloat(document.querySelector('#mOut').style.width))); await page.waitForTimeout(100); }
  check(outLvl > 0, 'something plays (output meter ' + outLvl + '%)');

  // SELECT encoder -> drums; ARP -> drums on; key 17 = kick pad; key 1 toggles step 1 of the kick
  await page.evaluate(() => { window.__fm1.enc(0, 1); window.__fm1.enc(0, 1); window.__fm1.enc(0, 1); });
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('.track.sel').dataset.i) === '3', 'SELECT turned to the drum track');
  await page.evaluate(() => window.__fm1.tap(10));
  await page.waitForTimeout(500);
  ts = await page.textContent('.track[data-i="3"] .ts');
  check(ts === 'AN', 'ARP switches the drums on: ' + ts);
  await page.evaluate(() => { window.__fm1.key(16); window.__fm1.key(16, false); });
  await page.evaluate(() => window.__fm1.key(2));
  await page.waitForTimeout(300);
  const step = await page.evaluate(() => document.querySelector('.row[data-r="0"] .st[data-s="2"]').classList.contains('on'));
  check(step, 'key 3 sets step 3 of the kick on the phone grid');
  check(await page.evaluate(() => window.__fm1.led(14 + 2)) !== undefined, 'key LEDs are sent');

  const lbl = await page.textContent('.row[data-r="2"] .pad');
  check(lbl === 'RIMSHOT', 'ROCK kit is the default, grid shows its voices: ' + lbl);
  // FX: SELECT scrolls the effects, FX again goes to the next one
  await page.evaluate(() => { window.__fm1.tap(2); window.__fm1.enc(0, 1); });
  await page.waitForTimeout(300);
  check((await page.textContent('#fxsubs .on')) === 'REVERB', 'SELECT on the FX page: ' + await page.textContent('#fxsubs .on'));
  await page.evaluate(() => window.__fm1.tap(2));
  await page.waitForTimeout(300);
  check((await page.textContent('#fxsubs .on')) === 'CHORUS', 'FX again: ' + await page.textContent('#fxsubs .on'));
  s = await S();
  check(s.texts.some(t => t.startsWith('DR CHORUS 3/4')), 'FM-1 shows the effect and its channel: ' + s.texts.filter(t => /CHORUS/.test(t)).join('|'));
  // effects are per track: turn up the chorus of the drums, then look at track 1
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__fm1.enc(2, 3); });   // K1 = chorus mix on the drums
  await page.waitForTimeout(300);
  const drumMix = await page.textContent('#params .prm b');
  await page.evaluate(() => { window.__fm1.tap(8); window.__fm1.enc(0, 1); window.__fm1.tap(2); });   // HOME, SELECT -> track 1, FX
  await page.waitForTimeout(400);
  const t1Mix = await page.textContent('#params .prm b');
  check(drumMix !== '0' && t1Mix === '0', 'effects per track: drums chorus ' + drumMix + ', track 1 chorus ' + t1Mix);
  check((await page.textContent('#fxFor')).includes('1'), 'the phone says which track: ' + await page.textContent('#fxFor'));
  // HOME held = mute track 1
  await page.evaluate(() => window.__fm1.button(8, true)); await page.waitForTimeout(700); await page.evaluate(() => window.__fm1.button(8, false));
  await page.waitForTimeout(300);
  check(await page.textContent('.track[data-i="0"] .ts') === 'STOP', 'HOME held mutes track 1: ' + await page.textContent('.track[data-i="0"] .ts'));
  await page.evaluate(() => { window.__fm1.button(8, true); }); await page.waitForTimeout(700); await page.evaluate(() => window.__fm1.button(8, false));
  await page.evaluate(() => { window.__fm1.tap(8); for (let i = 0; i < 3; i++) window.__fm1.enc(0, 1); });   // back to the drums for the next checks
  await page.waitForTimeout(300);
  // pages and knobs: ENV -> FILTER page, K1 turned
  await page.evaluate(() => window.__fm1.tap(4));
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__fm1.enc(2, -1); });
  await page.waitForTimeout(300);
  const filt = await page.textContent('#params .prm b');
  check(filt === 'TP 5', 'K1 on the FILTER page sets the filter in steps of 1: ' + filt);
  // hold LFO = stutter
  await page.evaluate(() => window.__fm1.button(5, true));
  await page.waitForTimeout(400);
  check(await page.evaluate(() => document.querySelector('#stut').classList.contains('on')), 'holding LFO = stutter');
  await page.evaluate(() => window.__fm1.button(5, false));

  // all four knob rows reach the screen (K4 used to go missing)
  await page.evaluate(() => { window.__fm1.st.texts.length = 0; window.__fm1.tap(7); });
  await page.waitForTimeout(1500);
  s = await S();
  check(s.texts.some(t => t.startsWith('4 LICHT')), 'K4 row drawn on the FM-1 (GLO page): ' + s.texts.filter(t => /^\d /.test(t)).join(' | '));
  check(s.dropped === 0, 'FM-1 dropped no frames: ' + s.dropped);
  check(s.glowLevel === 3 && (s.glow >> 13n & 1n) === 1n && (s.glow >> 2n & 1n) === 1n, 'buttons glow at level ' + s.glowLevel);
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__fm1.enc(5, 1); });
  await page.waitForTimeout(400);
  s = await S();
  check(s.glowLevel === 5, 'K4 on the MIKRO page sets the glow: ' + s.glowLevel);
  // language switch
  await page.selectOption('#selLang', 'en');
  await page.waitForTimeout(800);
  check(await page.textContent('#bClearAll') === 'Clear all', 'English UI: ' + await page.textContent('#bClearAll'));
  s = await S();
  check(s.texts.some(t => t.startsWith('MIC + OUTPUT')), 'English on the FM-1 screen');
  await page.selectOption('#selLang', 'de');
  // SEL switches the design (phone and FM-1 screen), EDIT is undo
  await page.evaluate(() => window.__fm1.tap(3));
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.documentElement.dataset.theme) === 'paper', 'SEL switches to the paper design');
  await page.screenshot({ path: shots + '/3-paper.png', fullPage: false });
  await page.evaluate(() => window.__fm1.tap(3));
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'SEL again: dark');
  // ---- saving -----------------------------------------------------------------------------
  const Save = require('../src/save.js');
  const NAME = /^Ouroloops_Session-1_\d{4}_\d{2}_\d{2}_\d{4}_/;
  const grab = async fn => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), fn()]); return { name: d.suggestedFilename(), data: new Uint8Array(fs.readFileSync(await d.path())) }; };
  await page.evaluate(() => { window.__fm1.st.texts.length = 0; window.__fm1.tap(9); });
  await page.waitForTimeout(600);
  s = await S();
  check(s.texts.some(t => t.startsWith('SAVE SESSION-1')), 'SAVE tap opens the save page on the FM-1: ' + s.texts.filter(t => t.startsWith('SAVE')).join(','));
  await page.evaluate(() => { window.__fm1.st.texts.length = 0; window.__fm1.tap(9); });
  await page.waitForTimeout(1200);
  s = await S();
  check(s.texts.some(t => t.includes('GESPEICHERT')), 'SAVE again saves, the FM-1 says GESPEICHERT');
  check((await page.$$eval('#projList option', o => o.map(x => x.textContent))).some(t => t.startsWith('Session 1')), 'project "Session 1" in the list');
  let f = await grab(() => page.click('#bMix'));
  check(NAME.test(f.name) && f.name.endsWith('_Mix-4x.wav'), 'mix file name: ' + f.name);
  let w = Save.unwav(f.data);
  check(w.channels.length === 2 && w.channels[0].length > w.sr * 2, 'mix is stereo, ' + (w.channels[0].length / w.sr).toFixed(1) + ' s');
  f = await grab(() => page.click('#bStemsFx'));
  let z = Save.unzip(f.data);
  check(f.name.endsWith('_Stems-fx-4x.zip') && z['Track1.wav'] && z['Drums.wav'], 'stems with FX: ' + f.name + ' ' + Object.keys(z).join(','));
  f = await grab(() => page.click('#bStemsDry'));
  z = Save.unzip(f.data);
  check(f.name.endsWith('_Stems-dry-4x.zip') && Save.unwav(z['Track1.wav']).channels.length === 1, 'dry stems, the loop mono as recorded: ' + Object.keys(z).join(','));
  await page.click('#bLive'); await page.waitForTimeout(1500);
  f = await grab(() => page.click('#bLive'));
  w = Save.unwav(f.data);
  const lsec = w.channels[0].length / w.sr;
  check(NAME.test(f.name) && f.name.endsWith('_Live.wav') && lsec > 1.2 && lsec < 2.5, 'live recording ' + f.name + ' ' + lsec.toFixed(2) + ' s');
  f = await grab(() => page.click('#bExportProj'));
  check(/^Session-1\.ouroloops$/.test(f.name), 'project file: ' + f.name);
  const proj = Save.readProjectFile(f.data);
  check(proj.snap.tracks[0].data && proj.snap.tracks[0].data.length === proj.snap.tracks[0].len, 'project file holds track 1 lossless (' + proj.snap.tracks[0].len + ' samples)');
  const projPath = shots + '/test.ouroloops'; fs.writeFileSync(projPath, f.data);

  // back to track 1 for the screenshot of the FM-1 screen
  await page.evaluate(() => { window.__fm1.enc(0, 1); window.__fm1.tap(2); });
  await page.waitForTimeout(800);
  s = await S();
  check(s.errors.length === 0, 'no protocol errors: ' + s.errors.slice(0, 3).join(' | '));
  check(s.maxFrame <= 300, 'largest frame ' + s.maxFrame + ' bytes');
  console.log('     frames sent', s.frames);
  const png = await page.evaluate(() => window.__fm1.canvas.toDataURL());
  fs.writeFileSync(shots + '/fm1-screen.png', Buffer.from(png.split(',')[1], 'base64'));
  await page.screenshot({ path: shots + '/1-phone.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + '/2-desktop.png', fullPage: false });
  // the session comes back after a reload, and a project file loads
  const len0 = await page.evaluate(() => document.querySelector('.track[data-i="0"] .ts').textContent);
  await page.reload(); await page.click('#start');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 }); await page.waitForTimeout(2000);
  const ts0 = await page.textContent('.track[data-i="0"] .ts');
  check(ts0 !== 'LEER' && ts0 !== '' , 'after a reload track 1 is back: ' + len0 + ' -> ' + ts0);
  await page.click('#bNewProj'); await page.waitForTimeout(800);
  check(await page.inputValue('#projName') === 'Session 2', 'new project: ' + await page.inputValue('#projName'));
  await page.setInputFiles('#fileProj', projPath); await page.waitForTimeout(1200);
  check(await page.inputValue('#projName') === 'Session 1' && (await page.textContent('.track[data-i="0"] .ts')) !== 'LEER', 'project file loads back');
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
