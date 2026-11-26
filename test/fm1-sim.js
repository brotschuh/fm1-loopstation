// A software FM-1 for the browser tests: answers PING, decodes the drawing commands exactly as the firmware's
// ctrl.c does (n14, color, BATCH, 300-byte frames), draws them on a 240x240 canvas, keeps the 41 LEDs,
// and lets the test press keys, buttons and turn encoders.
window.__fm1 = (() => {
  const W = 240, cv = document.createElement('canvas'); cv.width = W; cv.height = W; cv.id = 'fm1screen';
  const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  const n14 = p => (p[0] & 127) << 7 | (p[1] & 127);
  const color = p => ((p[0] & 3) << 14) | ((p[1] & 127) << 7) | (p[2] & 127);
  const css = c => `rgb(${(c >> 11 & 31) * 255 / 31 | 0},${(c >> 5 & 63) * 255 / 63 | 0},${(c & 31) * 255 / 31 | 0})`;
  const st = { frames: 0, maxFrame: 0, bad: 0, leds: 0n, texts: [], errors: [], dropped: 0, tick: 20 };
  // like the firmware: 4 frames queued, worked off in the control loop every st.tick ms; a full queue drops
  const q = [];
  setInterval(() => { while (q.length) { const [c, p] = q.shift(); cmd(c, p); } }, 20);
  function fill(x, y, w, h, c) { if (!w || !h || x + w > W || y + h > W) { st.errors.push(`rect out of screen ${x},${y},${w},${h}`); return; } g.fillStyle = css(c); g.fillRect(x, y, w, h); }
  function cmd(c, p) {
    switch (c) {
      case 1: { let m = 0n; for (let i = 0; i < 6; i++) m |= BigInt(p[i] & 127) << BigInt(7 * i); st.leds = m; break; }
      case 2: fill(0, 0, W, W, color(p)); break;
      case 3: fill(n14(p), n14(p.slice(2)), n14(p.slice(4)), n14(p.slice(6)), color(p.slice(8))); break;
      case 4: {
        let x = n14(p), y = n14(p.slice(2)); const s = p[4], fg = color(p.slice(5)), bg = color(p.slice(8));
        const t = String.fromCharCode(...p.slice(11));
        if (x + t.length * 6 * s > W || y + 8 * s > W) st.errors.push(`text off screen "${t}" at ${x},${y} s${s}`);
        g.fillStyle = css(bg); g.fillRect(x, y, Math.min(W - x, t.length * 6 * s), 8 * s);
        g.fillStyle = css(fg); g.font = `${8 * s}px monospace`; g.textBaseline = 'top';
        for (let i = 0; i < t.length; i++) g.fillText(t[i], x + i * 6 * s, y);
        st.texts.push(t); if (st.texts.length > 400) st.texts.splice(0, 200);
        break;
      }
      case 6: st.scale = Array.from(p.slice(0, 4)); break;
      case 10: { let i = 0; while (i + 3 <= p.length) { const l = n14(p.slice(i)); if (l < 1 || i + 2 + l > p.length) { st.errors.push('bad batch'); break; } cmd(p[i + 2], p.slice(i + 3, i + 3 + l - 1)); i += 2 + l; } break; }
    }
  }
  let inputPort = null;
  const reply = bytes => inputPort && inputPort.onmidimessage && inputPort.onmidimessage({ data: new Uint8Array(bytes) });
  const out = {
    name: 'FM-1 SAMPLER', state: 'connected', send(d) {
      d = Array.from(d);
      if (d[0] !== 0xf0) return;
      st.frames++; st.maxFrame = Math.max(st.maxFrame, d.length);
      if (d.length > 300) { st.errors.push('frame > 300 bytes: ' + d.length); return; }
      if (d[1] !== 0x7d || d[2] !== 68 || d[3] !== 65 || d[4] !== 87) return;
      const c = d[6], p = d.slice(7, d.length - 1);
      const put32 = v => [v >>> 28 & 15, v >>> 21 & 127, v >>> 14 & 127, v >>> 7 & 127, v & 127];
      if (c === 5) { reply([0xf0, 0x7d, 68, 65, 87, 1, 0x40, p[0], p[1], ...put32(0), ...put32(st.frames), ...put32(0), ...put32(st.dropped), 0xf7]); return; }
      if (q.length >= 4) { st.dropped++; return; }
      q.push([c, p]);
    },
  };
  inputPort = { name: 'FM-1 SAMPLER', state: 'connected', onmidimessage: null };
  const other = { name: 'Microsoft GS Wavetable Synth', state: 'connected', send() { } };
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['i', inputPort]]), outputs: new Map([['o1', other], ['o', out]]), onstatechange: null });
  return {
    canvas: cv, st,
    key(k, on = true) { reply([on ? 0x90 : 0x80, 53 + k, on ? 100 : 0]); },
    button(b, on = true) { reply([on ? 0x91 : 0x81, b, on ? 100 : 0]); },
    tap(b) { this.button(b, true); this.button(b, false); },
    enc(e, d) { reply([0xb0, 16 + e, 64 + d]); },
    led(k) { return !!(st.leds >> BigInt(k) & 1n); },
  };
})();
