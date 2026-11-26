// FM-1 link: the FM1-DAW protocol v1 of the fm1-sampler firmware (USB MIDI SysEx), see its PROTOCOL.md.
// FM-1 -> phone: keys (ch1 notes), buttons (ch2 notes 0..13), encoders (ch1 CC 16..22, 64 +/- delta), SysEx events.
// Phone -> FM-1: LEDs, drawing on the 240x240 screen, the scale setting.

const FM1 = (() => {
  const HDR = [0xf0, 0x7d, 0x44, 0x41, 0x57, 0x01];
  const CMD = { LED: 1, CLEAR: 2, RECT: 3, TEXT: 4, PING: 5, SCALE: 6, BATCH: 10, GLOW: 11 };
  const BTN = { OCTM: 0, OCTP: 1, FX: 2, SCL: 3, ENV: 4, LFO: 5, EDIT: 6, GLO: 7, HOME: 8, SAVE: 9, ARP: 10, SEQ: 11, PLAY: 12, REC: 13 };
  const KEY_BASE = 53, NKEYS = 27, MAX_FRAME = 280;

  const n14 = v => { v = Math.max(0, Math.min(16383, Math.round(v))); return [v >> 7 & 127, v & 127]; };
  const rgb = (r, g, b) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
  const col = c => [c >> 14 & 3, c >> 7 & 127, c & 127];
  const ascii = s => Array.from(String(s)).map(ch => { const c = ch.charCodeAt(0); return c >= 32 && c < 127 ? c : 63; });

  // one drawing command -> [cmd, ...payload]
  const op = {
    clear: c => [CMD.CLEAR, ...col(c)],
    rect: (x, y, w, h, c) => [CMD.RECT, ...n14(x), ...n14(y), ...n14(w), ...n14(h), ...col(c)],
    text: (x, y, s, fg, bg, t) => [CMD.TEXT, ...n14(x), ...n14(y), s, ...col(fg), ...col(bg), ...ascii(t)],
  };

  // pack drawing commands into as few BATCH frames as fit (<= 300 bytes each)
  function frames(ops) {
    const out = []; let cur = [];
    const flush = () => { if (cur.length) out.push([...HDR, CMD.BATCH, ...cur, 0xf7]); cur = []; };
    for (const o of ops) {
      const item = [...n14(o.length), ...o];
      if (HDR.length + 1 + cur.length + item.length + 1 > MAX_FRAME) flush();
      cur.push(...item);
    }
    flush();
    return out;
  }
  const ledFrame = mask => { const b = []; for (let i = 0; i < 6; i++) b.push(Number((mask >> BigInt(7 * i)) & 127n)); return [...HDR, CMD.LED, ...b, 0xf7]; };
  // which LEDs glow and how bright (0 = off .. 8): needs the Ouroloops firmware, older firmware ignores it
  const glowFrame = (mask, level) => { const b = []; for (let i = 0; i < 6; i++) b.push(Number((mask >> BigInt(7 * i)) & 127n)); return [...HDR, CMD.GLOW, ...b, level & 127, 0xf7]; };
  const scaleFrame = () => [...HDR, CMD.SCALE, 7, 0, 3, 0, 0xf7];   // scale OFF: plain keyboard, key k = note 53 + k
  const pingFrame = id => [...HDR, CMD.PING, ...n14(id), 0xf7];

  class Link {
    constructor() {
      this.access = null; this.out = null; this.inp = null; this.q = []; this.timer = null;
      this.onKey = null; this.onButton = null; this.onEncoder = null; this.onRedraw = null; this.onState = null;
      this.connected = false; this.name = ''; this.dropped = -1; this.pinger = 0; this.onDropped = null; this.pace = 28;
    }
    async open() {
      if (!navigator.requestMIDIAccess) throw new Error('Dieser Browser kann kein Web MIDI (Chrome oder Edge nehmen).');
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => this.find();
      await this.find();
    }
    // find the FM-1: every input listens, every output gets a PING; the one that answers PONG is it
    async find() {
      if (this.connected && this.out && this.out.state === 'connected') return;
      this.connected = false;
      const outs = [...this.access.outputs.values()], ins = [...this.access.inputs.values()];
      let found = null;
      const id = 1000 + Math.floor(Math.random() * 1000);
      const wait = new Promise(res => {
        const done = setTimeout(() => res(null), 700);
        ins.forEach(i => i.onmidimessage = ev => {
          const d = ev.data;
          if (d[0] === 0xf0 && d[6] === 0x40 && ((d[7] << 7) | d[8]) === id) { clearTimeout(done); res(i); }
        });
      });
      outs.forEach(o => { try { o.send(pingFrame(id)); } catch (e) { } });
      const inp = await wait;
      if (inp) {
        // the output with the most similar name
        const nm = s => s.toLowerCase().replace(/(in|out|input|output|midi)/g, '').trim();
        found = outs.find(o => nm(o.name) === nm(inp.name)) || outs.find(o => /fm|sampler|felucca|m-vave/i.test(o.name)) || outs[0];
        ins.forEach(i => { if (i !== inp) i.onmidimessage = null; });
        this.inp = inp; this.out = found; this.name = inp.name;
        inp.onmidimessage = ev => this.recv(ev.data);
        this.connected = true; this.dropped = -1;
        this.send(scaleFrame());
        clearInterval(this.pinger);
        this.pinger = setInterval(() => { if (this.connected) this.send(pingFrame(1), 'ping'); }, 1500);
      } else {
        ins.forEach(i => i.onmidimessage = null);
        this.inp = this.out = null;
      }
      this.onState && this.onState(this.connected, this.name, outs.map(o => o.name));
    }
    recv(d) {
      const st = d[0] & 0xf0, ch = d[0] & 0x0f;
      if (d[0] === 0xf0) {
        if (d[6] === 0x42 && this.onRedraw) this.onRedraw();
        if (d[6] === 0x40 && d.length >= 30) {   // PONG: did the FM-1 drop frames since the last one?
          const v = o => ((d[o] & 15) << 28 | d[o + 1] << 21 | d[o + 2] << 14 | d[o + 3] << 7 | d[o + 4]) >>> 0;
          const dropped = v(24);
          if (this.dropped >= 0 && dropped > this.dropped && this.onDropped) this.onDropped(dropped - this.dropped);
          this.dropped = dropped;
        }
        return;
      }
      if (st === 0x90 || st === 0x80) {
        const on = st === 0x90 && d[2] > 0;
        if (ch === 0) { const k = d[1] - KEY_BASE; if (k >= 0 && k < NKEYS && this.onKey) this.onKey(k, on); }
        else if (ch === 1 && this.onButton) this.onButton(d[1], on);
      } else if (st === 0xb0 && ch === 0 && d[1] >= 16 && d[1] <= 22 && this.onEncoder) {
        const delta = d[2] - 64; if (delta) this.onEncoder(d[1] - 16, delta);
      }
    }
    // paced sending: the FM-1 queues only 4 frames and works them off in its control loop; 28 ms apart keeps it safe
    send(frame, key) {
      if (!this.connected) return;
      if (key) { const i = this.q.findIndex(f => f.key === key); if (i >= 0) { this.q[i].frame = frame; return; } }
      this.q.push({ frame, key });
      if (!this.timer) this.pump();
    }
    pump() {
      const f = this.q.shift();
      if (!f) { this.timer = null; return; }
      try { this.out.send(f.frame); } catch (e) { this.connected = false; this.q = []; this.timer = null; this.find(); return; }
      this.timer = setTimeout(() => this.pump(), this.pace);
    }
    // a drawing replaces its own older frames still waiting (all of them, so the order stays right);
    // a whole screen also makes every other drawing still waiting useless
    draw(ops, key) {
      if (!this.connected) return;
      if (key === 'screen') this.q = this.q.filter(f => f.key === 'led' || f.key === 'ping');
      else if (key) this.q = this.q.filter(f => !(f.key && f.key.startsWith(key + '#')));
      frames(ops).forEach((f, i) => { this.q.push({ frame: f, key: key ? key + '#' + i : null }); });
      if (!this.timer) this.pump();
    }
    leds(mask) { this.send(ledFrame(mask), 'led'); }
    glow(mask, level) { this.send(glowFrame(mask, level), 'glow'); }
    backlog() { return this.q.length; }
  }

  return { Link, op, frames, ledFrame, rgb, BTN, NKEYS, n14, col };
})();

if (typeof module !== 'undefined') module.exports = FM1;
