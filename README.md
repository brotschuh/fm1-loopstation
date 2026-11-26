# Ouroloops

A looper for the **M-VAVE FM-1** with a classic loop-pedal workflow (Boss-inspired). The name: the Ouroboros, the snake that bites its own tail, and loops.
The phone records through its microphone and does the loops, drums and effects; the FM-1 is the
controller, the second screen and the audio output.

**Open the app:** https://brotschuh.github.io/ouroloops/ (Chrome on Android or on a computer)

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
  values of the four knobs. The buttons glow at an adjustable level, the active ones light fully.

## Setup

1. **Firmware on the FM-1:** open the flash page https://brotschuh.github.io/ouroloops/firmware/
   in Chrome on a computer, tab **Device update**, tick the backup box, **Connect device**, then
   **Start update** (or **Force flash** when coming from another firmware).
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
| PRESETS | drum pattern |
| ALGORITHM | drum sound shown on the step keys |
| FX · ENV · EDIT · GLO · SEQ | pages Delay+Reverb · Filter+Bitcrush · Track · Mic · Drums; K1–K4 set the values |
| LFO | tap: chorus+stutter page, hold: stutter |
| Keys 1–16 | the steps of the selected drum sound |
| Keys 17–27 | drum pads |

On a computer without the FM-1: space = play, R = rec, Z = undo, 1–4 = track, hold S = stutter.

## Firmware

`firmware/` is the control-surface firmware of [fm1-sampler](https://github.com/ferluht/fm1-sampler) by ferluht
(built on M-VAVE's open firmware FM1 Open V14, GPL-3.0 with the FM1 SDK linking exception) with these changes:

- **Dimmable button lights:** a new SysEx command `0x0B GLOW` (the 6-byte LED mask of `LED`, then a level 0–8).
  The chosen LEDs glow with a pulse of 0.25–4 µs at every scan tick (10 kHz, timed on TIMER4) in
  `app/board/fm1_input.h`; LEDs that are on stay fully lit.
- Splash screen "OUROLOOPS".
- `app/ctrl.c` is named `app/screen.c` again, so M-VAVE's own `sdk/Build.ps1` builds it with its flags.

The `firmware` workflow builds it on a Windows runner with JieLi's toolchain 2.5.3 and publishes the flash page
(`tools/make_flash_page.py`) to `docs/firmware/`. Host test of the control code:
`gcc -DFM1_HOST_TEST -Ifirmware/sdk/include -Ifirmware/app -Ifirmware/app/board -Ifirmware/app/synth -Ifirmware/sdk/config firmware/hosttest/ctrl_host.c`.

## Development

Plain JavaScript, no dependencies. `python3 build.py` builds one self-contained page
(`docs/index.html` for GitHub Pages, `dist/ouroloops.html` to open locally).

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
- Firmware and protocol: **fm1-sampler** by ferluht, built on **FM1 Open** by M-VAVE (GPL-3.0 with the FM1 SDK
  linking exception; the SDK binaries have their own terms, see `firmware/THIRD_PARTY.md`).
- Not affiliated with M-VAVE or Roland/Boss. M-VAVE and FM-1 are trademarks of their owners; BOSS and Loop Station are trademarks of Roland Corporation.
