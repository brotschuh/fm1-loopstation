# FM-1 Loop Station

Eine Loop-Station für das **M-VAVE FM-1**, bedient wie ein klassisches Loop-Pedal (inspiriert von Boss).
Das Handy nimmt über sein Mikrofon auf, rechnet Loops, Drums und Effekte; das FM-1 ist Bedienfeld,
zweiter Bildschirm und Tonausgang.

**App öffnen:** https://brotschuh.github.io/fm1-loopstation/ (Chrome auf Android oder am Computer)

*A loop station for the M-VAVE FM-1 with a classic loop-pedal workflow: three loop tracks from the phone
microphone, a drum track (a real CC0 rock kit and an analogue kit), effects. The FM-1 is the controller,
the second screen and the audio output; the phone does the sound. German UI.*

## Was sie kann

- **3 Loop-Spuren** aus dem Mikrofon: REC → Overdub → Wiedergabe → Overdub … wie am Pedal, Undo/Redo,
  Spuren stumm schalten, löschen. Die erste Aufnahme legt Länge und Tempo fest, spätere Spuren werden ein
  Vielfaches davon. Läuft der Rhythmus schon, beginnt und endet die Aufnahme auf dem Takt.
- **Drum-Spur** mit 16 Schritten: echtes **Rock-Kit** (Big Rusty Drums, CC0), **Analog 808** und
  **Synth-Akustik** (beide in der App erzeugt), 12 Muster, Pads einspielen (Overdub ins Muster).
- **Effekte:** Delay (im Tempo), Hall, Chorus, Filter (Tief-/Hochpass auf einem Regler), Bitcrusher,
  Samplerate-Reduktion, Stutter, Rückwärts pro Spur.
- **Am FM-1:** die Tasten 1–16 zeigen die Schritte des gewählten Drum-Instruments (mit Lauflicht),
  die Tasten 17–27 sind die Pads; Display mit Spuren, Status, Fortschritt und den vier Reglerwerten.

## Einrichten

1. **Firmware aufs FM-1:** Die Loop Station braucht die Steuer-Firmware von
   [fm1-sampler](https://github.com/ferluht/fm1-sampler) (ferluht, auf Basis von M-VAVEs offener Firmware
   FM1 Open, GPL). Deren Flash-Seite `firmware/FM1-Sampler-Workbench.html` in Chrome am Computer öffnen,
   Reiter **Device update**, Backup-Häkchen, **Connect device**, dann **Force flash**.
   Zurück zur Original-Firmware jederzeit mit M-VAVEs Updater M-UPGRADE.
2. **Handy:** FM-1 per USB-C ans Handy, Kopfhörer oder Box ans FM-1, die App-Adresse oben in Chrome öffnen,
   **Starten**, Mikrofon und MIDI erlauben.
3. **Computer (zum Testen):** genauso in Chrome; unter Einstellungen als Ausgang das FM-1 wählen.

## Bedienung am FM-1

| Taste / Regler | Funktion |
|---|---|
| REC | Aufnahme → Overdub → Wiedergabe → Overdub … Auf der Drum-Spur: Pads ins Muster einspielen |
| PLAY | alles starten / stoppen |
| SCL | Undo / Redo der letzten Aufnahme |
| HOME | gewählte Spur stumm / an |
| SAVE (halten) | gewählte Spur löschen |
| ARP | Drums an / aus |
| SELECT | Spur wählen (1, 2, 3, Drums) |
| ALGORITHM | Drum-Muster |
| PRESETS | Drum-Instrument für die Schritt-Tasten |
| FX · ENV · EDIT · GLO · SEQ | Seiten Delay+Hall · Filter+Bitcrush · Spur · Mikro · Drums; K1–K4 stellen die Werte |
| LFO | tippen: Chorus+Stutter, halten: Stutter |
| Tasten 1–16 | Schritte des gewählten Drum-Instruments |
| Tasten 17–27 | Drum-Pads |

## Entwickeln

Alles ist reines JavaScript ohne Abhängigkeiten. `python3 build.py` baut daraus eine einzige Seite
(`docs/index.html` für GitHub Pages, `dist/fm1-loopstation.html` zum lokalen Öffnen).

- `src/engine.js` – Looper, Drum-Sequencer, Bitcrusher, Stutter (läuft im AudioWorklet)
- `src/drums.js` – die erzeugten Kits und die Muster; `src/rockkit.js` – das Rock-Kit (von `tools/make_rock_kit.py`)
- `src/fm1.js` – das USB-MIDI-Protokoll der fm1-sampler-Firmware (`PROTOCOL.md` dort)
- `src/app.js`, `src/index.html` – Oberfläche, Effekte, Tastenbelegung
- Tests: `node test/engine.test.js`; `node test/e2e.js` (Chrome + Playwright, mit einem nachgebauten FM-1
  in `test/fm1-sim.js`, das die Befehle wie die Firmware auswertet)

## Lizenzen und Dank

- Code: GPL-3.0 (siehe `LICENSE`).
- Rock-Kit: **Big Rusty Drums** von Karoryfer Samples, CC0 1.0 (gemeinfrei),
  https://github.com/sfzinstruments/karoryfer.big-rusty-drums
- Firmware und Protokoll: **fm1-sampler** von ferluht, aufgebaut auf **FM1 Open** von M-VAVE.
- Nicht verbunden mit M-VAVE oder Roland/Boss. M-VAVE, FM-1 und Boss sind Marken ihrer Inhaber.
