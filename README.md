# FM-1 Loop Station

A loop station for the **M-VAVE FM-1** with a classic loop-pedal workflow (Boss-inspired).
The phone records through its microphone and does the loops, drums and effects; the FM-1 is the
controller, the second screen and the audio output.

**Open the app:** https://brotschuh.github.io/fm1-loopstation/ (Chrome on Android or on a computer)

The user interface is in German for now.

## Features

- **3 loop tracks** from the microphone: REC → overdub → play → overdub … as on a loop pedal, undo/redo,
  mute and clear per track. The first take sets the loop length and the tempo; later tracks become a
  multiple of it. When the rhythm is already running, recording starts and ends on the bar.
- **Drum track** with 16 steps: a real **rock kit** (Big Rusty Drums, CC0), an **analogue 808-style kit**
  and a **synthesised acoustic kit** (both generated in the app), 12 patterns, pads recorded into the
  pattern (overdub).
- **Effects:** tempo-synced delay, reverb, chorus, filter (low-pass / high-pass on one knob), bitcrusher,
  sample-rate reduction, stutter, reverse per track.
- **On the FM-1:** keys 1–16 show the steps of the selected drum sound (with a running light),
  keys 17–27 are the drum pads; the display shows the tracks, their state, the loop position and the
  values of the four knobs. Button lights: all buttons lit with the active ones blinking, or status only.

## Setup

1. **Firmware on the FM-1:** the loop station needs the control-surface firmware of
   [fm1-sampler](https://github.com/ferluht/fm1-sampler) by ferluht, built on M-VAVE's open firmware
   FM1 Open (GPL). Open its flash page `firmware/FM1-Sampler-Workbench.html` in Chrome on a computer,
   tab **Device update**, tick the backup box, **Connect device**, then **Force flash**.
   You can go back to the original firmware at any time with M-VAVE's updater M-UPGRADE.
2. **Phone:** connect the FM-1 to the phone with a USB-C cable, headphones or a speaker into the FM-1,
   open the app address above in Chrome, tap **Starten**, allow the microphone and MIDI.
   If the recording is silent or feeds back, choose the phone's own microphone in the settings
   (the FM-1 also shows up as an audio input).
3. **Computer (for testing):** the same in Chrome; in the settings choose the FM-1 as the output.

## Controls on the FM-1

| Button / knob | Function |
|---|---|
| REC | record → overdub → play → overdub … On the drum track: record the pads into the pattern |
| PLAY | start / stop everything |
| SCL | undo / redo the last take |
| HOME | mute / unmute the selected track |
| SAVE (hold) | clear the selected track |
| ARP | drums on / off |
| SELECT | choose the track (1, 2, 3, drums) |
| ALGORITHM | drum pattern |
| PRESETS | drum sound shown on the step keys |
| FX · ENV · EDIT · GLO · SEQ | pages Delay+Reverb · Filter+Bitcrush · Track · Mic · Drums; K1–K4 set the values |
| LFO | tap: chorus+stutter page, hold: stutter |
| Keys 1–16 | the steps of the selected drum sound |
| Keys 17–27 | drum pads |

On a computer without the FM-1: space = play, R = rec, Z = undo, 1–4 = track, hold S = stutter.

## Development

Plain JavaScript, no dependencies. `python3 build.py` builds one self-contained page
(`docs/index.html` for GitHub Pages, `dist/fm1-loopstation.html` to open locally).

- `src/engine.js` – looper, drum sequencer, bitcrusher, stutter (runs in an AudioWorklet)
- `src/drums.js` – the generated kits and the patterns; `src/rockkit.js` – the rock kit (made by `tools/make_rock_kit.py`)
- `src/fm1.js` – the USB MIDI protocol of the fm1-sampler firmware (its `PROTOCOL.md`)
- `src/app.js`, `src/index.html` – user interface, effect chain, FM-1 key mapping
- Tests: `node test/engine.test.js`; `node test/e2e.js` (Chrome + Playwright, with a software FM-1 in
  `test/fm1-sim.js` that decodes the commands the way the firmware does)

## Licenses and credits

- Code: GPL-3.0 (see `LICENSE`).
- Rock kit: **Big Rusty Drums** by Karoryfer Samples, CC0 1.0 (public domain),
  https://github.com/sfzinstruments/karoryfer.big-rusty-drums
- Firmware and protocol: **fm1-sampler** by ferluht, built on **FM1 Open** by M-VAVE.
- Not affiliated with M-VAVE or Roland/Boss. M-VAVE, FM-1 and Boss are trademarks of their owners.
