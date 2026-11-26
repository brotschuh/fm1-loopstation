#!/usr/bin/env python3
"""Builds the ROCK kit from Big Rusty Drums by Karoryfer Samples (CC0 1.0, public domain).
Close mic + overhead mixed to mono, trimmed, faded, normalised, encoded as FLAC and written as a JS file
(base64) that the page decodes with decodeAudioData."""
import subprocess, numpy as np, base64, pathlib, json, sys

SRC = pathlib.Path('/root/src/brd/Samples')
OUT = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'rockkit.js'
SR = 44100
# voice order = the engine's 11 voices; (files with gains), max length in s
KIT = [
    ('KICK',      [('kick_24/kick/kick/k_vl12_rr1', 1.0), ('kick_24/kick/oh/k_vl12_rr1', 0.5)], 0.9),
    ('SNARE',     [('snare_14/center/top/sn_center_vl9_rr1', 1.0), ('snare_14/center/btm/sn_center_vl9_rr1', 0.35), ('snare_14/center/oh/sn_center_vl9_rr1', 0.6)], 0.9),
    ('RIMSHOT',   [('snare_14/rimshot/top/sn_rims_vl5_rr1', 1.0), ('snare_14/rimshot/oh/sn_rims_vl5_rr1', 0.6)], 1.0),
    ('HAT ZU',    [('hihat_14/cl/cl/ht_cl_vl5_rr1', 1.0), ('hihat_14/cl/oh/ht_cl_vl5_rr1', 0.5)], 0.35),
    ('HAT AUF',   [('hihat_14/open/cl/ht_open_vl5_rr1', 1.0), ('hihat_14/open/oh/ht_open_vl5_rr1', 0.5)], 1.4),
    ('TOM TIEF',  [('tom_18/center/cl/t18_vl7_rr1', 1.0), ('tom_18/center/oh/t18_vl7_rr1', 0.5)], 1.4),
    ('TOM MITTE', [('tom_15/center/cl/t15_vl6_rr1', 1.0), ('tom_15/center/oh/t15_vl6_rr1', 0.5)], 1.2),
    ('TOM HOCH',  [('tom_14/center/cl/t14_vl5_rr1', 1.0), ('tom_14/center/oh/t14_vl5_rr1', 0.5)], 1.1),
    ('SIDESTICK', [('snare_14/sidestick/top/sn_ss_vl3_rr1', 1.0), ('snare_14/sidestick/oh/sn_ss_vl3_rr1', 0.5)], 0.4),
    ('RIDE',      [('ride_22/rd/cl/rd_vl8_rr1', 0.8), ('ride_22/rd/oh/rd_vl8_rr1', 0.8)], 2.0),
    ('CRASH',     [('crash_17/cr/cl/cr_vl4_rr1', 0.7), ('crash_17/cr/oh/cr_vl4_rr1', 0.9)], 2.6),
]
# loudness per voice relative to the loudest (a kit that sits together without mixing)
LEVEL = {'KICK': 0.95, 'SNARE': 0.9, 'RIMSHOT': 0.9, 'HAT ZU': 0.45, 'HAT AUF': 0.5, 'TOM TIEF': 0.8, 'TOM MITTE': 0.8,
         'TOM HOCH': 0.8, 'SIDESTICK': 0.6, 'RIDE': 0.5, 'CRASH': 0.6}

def load(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(SRC / (p + '.flac')), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype='<f4').astype(np.float64)

names, blobs = [], []
for name, files, maxlen in KIT:
    parts = [load(f) * g for f, g in files]
    n = max(len(x) for x in parts)
    mix = np.zeros(n)
    for x in parts: mix[:len(x)] += x
    # start: drop silence before the hit (keep 1 ms)
    start = max(0, int(np.argmax(np.abs(mix) > 0.02 * np.abs(mix).max())) - 44)
    mix = mix[start:start + int(maxlen * SR)]
    # end: where it falls under -54 dB, plus a fade
    env = np.abs(mix); thr = env.max() * 10 ** (-54 / 20)
    last = len(mix) - int(np.argmax(env[::-1] > thr))
    mix = mix[:min(len(mix), last + 200)]
    f = min(len(mix) // 3, int(0.08 * SR))
    mix[-f:] *= np.linspace(1, 0, f) ** 2
    mix *= LEVEL[name] * 0.97 / np.abs(mix).max()
    pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes()
    flac = subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'flac', '-compression_level', '12', '-f', 'flac', '-'],
                          input=pcm, capture_output=True, check=True).stdout
    names.append(name); blobs.append(base64.b64encode(flac).decode())
    print(f'{name:10s} {len(mix) / SR:5.2f} s  {len(flac) // 1024:4d} KB')

js = ('// ROCK kit: Big Rusty Drums by Karoryfer Samples, CC0 1.0 (public domain), https://github.com/sfzinstruments/karoryfer.big-rusty-drums\n'
      '// Close mic + overhead mixed to mono by tools/make_rock_kit.py. FLAC, base64.\n'
      f'const ROCK_KIT = {{ names: {json.dumps(names)}, flac: {json.dumps(blobs)} }};\n'
      "if (typeof module !== 'undefined') module.exports = { ROCK_KIT };\n")
OUT.write_text(js)
print('wrote', OUT, len(js) // 1024, 'KB')
