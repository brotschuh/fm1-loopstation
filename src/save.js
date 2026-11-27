// Saving: WAV and ZIP files, projects in the browser (IndexedDB), the save folder on a computer,
// file names, and the offline render of mixes and stems.
const Save = (() => {
  // ---- names ------------------------------------------------------------------------------
  const pad = n => String(n).padStart(2, '0');
  function stamp(d = new Date()) { return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
  function safe(name) { return String(name || 'Session').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'Session'; }
  function fileName(project, kind, ext) { return `Ouroloops_${safe(project)}_${stamp()}_${kind}.${ext}`; }

  // ---- WAV ----------------------------------------------------------------------------------
  // channels: Float32Array[]; bits 16 (PCM) or 32 (float, lossless for projects)
  function wav(channels, sr, bits = 16) {
    const nc = channels.length, n = channels[0].length, bps = bits / 8, data = n * nc * bps;
    const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true);
    str(36, 'data'); v.setUint32(40, data, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      const x = channels[c][i];
      if (bits === 32) { v.setFloat32(o, x, true); o += 4; }
      else { const y = Math.max(-1, Math.min(1, x)); v.setInt16(o, y < 0 ? y * 32768 : y * 32767, true); o += 2; }
    }
    return new Uint8Array(buf);
  }
  // our own WAVs back (projects): returns { sr, channels }
  function unwav(u8) {
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 12, fmt = null, sr = 48000, nc = 1, bits = 16;
    while (o + 8 <= u8.length) {
      const id = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]), size = v.getUint32(o + 4, true);
      if (id === 'fmt ') { fmt = v.getUint16(o + 8, true); nc = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
      if (id === 'data') {
        const bps = bits / 8, n = Math.floor(size / (bps * nc)), ch = Array.from({ length: nc }, () => new Float32Array(n));
        let p = o + 8;
        for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
          ch[c][i] = fmt === 3 ? v.getFloat32(p, true) : v.getInt16(p, true) / 32768; p += bps;
        }
        return { sr, channels: ch };
      }
      o += 8 + size + (size & 1);
    }
    throw new Error('no audio in the file');
  }

  // ---- ZIP (stored, no compression: audio does not compress anyway) ------------------------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cs = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cs, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  function unzip(u8) {
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(), files = {};
    let o = 0;
    while (o + 30 <= u8.length && v.getUint32(o, true) === 0x04034b50) {
      const size = v.getUint32(o + 18, true), nl = v.getUint16(o + 26, true), el = v.getUint16(o + 28, true);
      const name = dec.decode(u8.subarray(o + 30, o + 30 + nl));
      files[name] = u8.subarray(o + 30 + nl + el, o + 30 + nl + el + size);
      o += 30 + nl + el + size;
    }
    return files;
  }

  // ---- projects in the browser (IndexedDB) --------------------------------------------------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('ouroloops', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => { const t = d.transaction(store, mode), q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
  }
  const putProject = p => tx('projects', 'readwrite', s => s.put(p));
  const getProject = id => tx('projects', 'readonly', s => s.get(id));
  const delProject = id => tx('projects', 'readwrite', s => s.delete(id));
  async function listProjects() {
    const all = await tx('projects', 'readonly', s => s.getAll());
    return (all || []).map(p => ({ id: p.id, name: p.name, updated: p.updated, auto: !!p.auto })).sort((a, b) => b.updated - a.updated);
  }
  const kvGet = k => tx('kv', 'readonly', s => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));

  // a project as one file: project.json + the loops as 32-bit float WAV (lossless)
  function projectFile(p) {
    const files = [{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify({ ...p, snap: { ...p.snap, tracks: p.snap.tracks.map(t => ({ ...t, data: null })) } }, null, 1)) }];
    p.snap.tracks.forEach((t, i) => { if (t.data) files.push({ name: `Track${i + 1}.wav`, data: wav([t.data], p.sr, 32) }); });
    return zip(files);
  }
  function readProjectFile(u8) {
    const f = unzip(u8);
    if (!f['project.json']) throw new Error('not an Ouroloops project');
    const p = JSON.parse(new TextDecoder().decode(f['project.json']));
    p.snap.tracks.forEach((t, i) => { const w = f[`Track${i + 1}.wav`]; t.data = w ? unwav(w).channels[0] : null; });
    return p;
  }

  // ---- writing files: the chosen folder (computer), else a download ------------------------
  let dir = null;
  async function restoreFolder() { try { dir = (await kvGet('dir')) || null; } catch (e) { dir = null; } return dir; }
  async function chooseFolder() {
    if (!window.showDirectoryPicker) return null;
    dir = await window.showDirectoryPicker({ id: 'ouroloops', mode: 'readwrite' });
    await kvSet('dir', dir);
    return dir;
  }
  const canChooseFolder = () => !!window.showDirectoryPicker;
  const folderName = () => (dir ? dir.name : '');
  async function write(name, bytes, sub) {
    if (dir) {
      try {
        if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted' || (await dir.requestPermission({ mode: 'readwrite' })) === 'granted') {
          const d = sub ? await dir.getDirectoryHandle(safe(sub), { create: true }) : dir;
          const fh = await d.getFileHandle(name, { create: true }), w = await fh.createWritable();
          await w.write(bytes); await w.close();
          return { where: dir.name + (sub ? '/' + safe(sub) : ''), name };
        }
      } catch (e) { /* no permission (e.g. pressed on the FM-1, not on the screen): fall back to a download */ }
    }
    const url = URL.createObjectURL(new Blob([bytes])), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { where: 'Downloads', name };
  }

  // ---- offline render -----------------------------------------------------------------------
  // snap: the engine snapshot; S: { tfx[4], drumVol, master }; kits; opts: { loops, fx: bool, stems: bool }
  // returns { mix: [L, R] } or { stems: [{ name, channels }] }
  async function render(snap, S, kits, sr, opts) {
    const loops = Math.max(1, opts.loops || 1);
    const bar = snap.master > 0 ? snap.master / snap.masterBars : sr * 240 / snap.bpm;
    const unit = snap.master > 0 ? Math.max(snap.master, ...snap.tracks.map(t => t.len)) : bar;
    const body = Math.round(unit * loops), tail = opts.fx ? Math.round(sr * 4) : 0, n = body + tail;
    // the sources: tracks looped from the transport start (with their offsets), and the drums
    const src = snap.tracks.map((t, i) => {
      if (!t.data || t.muted) return null;
      const L = new Float32Array(n), R = new Float32Array(n), d = t.data, len = t.len;
      const gl = opts.fx ? t.vol * (t.pan > 0 ? 1 - t.pan : 1) : 1, gr = opts.fx ? t.vol * (t.pan < 0 ? 1 + t.pan : 1) : 1;
      for (let p = 0; p < body; p++) { let k = ((p - t.offset) % len + len) % len; if (t.rev) k = len - 1 - k; L[p] = d[k] * gl; R[p] = d[k] * gr; }
      return { name: `Track${i + 1}`, ch: i, L, R };
    });
    if (snap.drumOn && kits[snap.kit]) {
      // the same drum machine as the engine: bars x steps, and per sound its length, pitch and level
      const D = new Float32Array(n), kit = kits[snap.kit], g = opts.fx ? S.drumVol : 1;
      const dlen = snap.drumLen || 16, old = snap.pattern.length === 11 * 16;
      const step = bar / 16, sr_ = sr, fade = Math.round(sr_ * 0.006);
      for (let s = 0; s * step < body; s++) {
        const at = Math.round(s * step), st = s % dlen;
        for (let v = 0; v < 11; v++) {
          const on = old ? snap.pattern[v * 16 + st % 16] : snap.pattern[v * 64 + st];
          if (!on || !kit[v]) continue;
          const smp = kit[v], r = Math.pow(2, (snap.tune ? snap.tune[v] : 0) / 12), lvl = snap.level ? snap.level[v] : 1;
          const gate = snap.gate ? snap.gate[v] : 100, len = smp.length / r;
          const end = gate >= 100 ? len : Math.max(sr_ * 0.01, len * gate / 100);
          for (let i = 0; i < end && at + i < n; i++) {
            const pos = i * r, j = pos | 0; if (j + 1 >= smp.length) break;
            let x = smp[j] + (smp[j + 1] - smp[j]) * (pos - j);
            if (end - i < fade) x *= (end - i) / fade;
            D[at + i] += x * g * lvl;
          }
        }
      }
      src.push({ name: 'Drums', ch: 3, L: D, R: D.slice() });
    }
    const used = src.filter(Boolean);
    if (!opts.fx) {   // dry: the recordings as they are, mono loops and the drums
      return { stems: used.map(s => ({ name: s.name, channels: s.ch === 3 ? [s.L, s.R] : [s.L] })) };
    }
    const one = async list => {
      const oc = new OfflineAudioContext(2, n, sr), m = FXChain.master(oc, oc.destination, opts.stems ? 1 : Math.pow(S.master / 100, 2) * 1.2);
      for (const s of list) {
        const set = S.tfx[s.ch];
        FXChain.crush([s.L, s.R], set.bits, set.down);
        const b = oc.createBuffer(2, n, sr); b.copyToChannel(s.L, 0); b.copyToChannel(s.R, 1);
        const node = oc.createBufferSource(); node.buffer = b;
        const f = FXChain.make(oc, m.input); FXChain.setAll(oc, f, set, snap.bpm, true);
        FXChain.tick(oc, f, set, snap.bpm, n / sr + 1);
        node.connect(f.input); node.start();
      }
      const out = await oc.startRendering();
      return trim([out.getChannelData(0), out.getChannelData(1)], body);
    };
    if (opts.stems) { const stems = []; for (const s of used) stems.push({ name: s.name, channels: await one([s]) }); return { stems }; }
    return { mix: await one(used) };
  }
  // cut the silent end of the tail (never into the loops themselves)
  function trim(ch, min) {
    let end = ch[0].length;
    while (end > min && Math.abs(ch[0][end - 1]) < 3e-4 && Math.abs(ch[1][end - 1]) < 3e-4) end--;
    return ch.map(c => c.slice(0, end));
  }

  return { stamp, safe, fileName, wav, unwav, zip, unzip, putProject, getProject, delProject, listProjects, projectFile, readProjectFile,
    restoreFolder, chooseFolder, canChooseFolder, folderName, write, render, kvGet, kvSet };
})();

if (typeof module !== 'undefined') module.exports = Save;
