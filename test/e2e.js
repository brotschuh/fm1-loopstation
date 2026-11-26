// Browser test: real Chrome, fake microphone (a tone), the software FM-1 of fm1-sim.js.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const page_ = path.resolve(__dirname, '../dist/fm1-loopstation.html');
const sim = fs.readFileSync(path.join(__dirname, 'fm1-sim.js'), 'utf8');
const shots = path.resolve(__dirname, '../shots'); fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctxB = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, permissions: ['microphone'] });
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
  check(s.texts.includes('LOOP STATION'), 'FM-1 screen drawn');

  // REC on the FM-1 -> recording, 2 s, REC again -> DUB, then PLAY state on REC
  await page.evaluate(() => window.__fm1.tap(13));
  await page.waitForTimeout(2000);
  let ts = await page.textContent('.track[data-i="0"] .ts');
  check(ts === 'REC', 'track 1 records after REC on the FM-1: ' + ts);
  check(await page.evaluate(() => window.__fm1.led(13)), 'REC LED on while recording');
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
  // pages and knobs: ENV -> FILTER page, K1 turned
  await page.evaluate(() => window.__fm1.tap(4));
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__fm1.enc(2, -1); });
  await page.waitForTimeout(300);
  const filt = await page.textContent('#params .prm b');
  check(/^TP/.test(filt), 'K1 on the FILTER page sets the filter: ' + filt);
  // hold LFO = stutter
  await page.evaluate(() => window.__fm1.button(5, true));
  await page.waitForTimeout(400);
  check(await page.evaluate(() => document.querySelector('#stut').classList.contains('on')), 'holding LFO = stutter');
  await page.evaluate(() => window.__fm1.button(5, false));

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
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
