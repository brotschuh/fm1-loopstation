// German is the source language; EN maps German text to English. T() translates a whole string,
// TV() a displayed value that may start with a word (TP 20, AUS ...).
const EN = {
  // intro and static page
  'Drei Loop-Spuren aus dem Mikrofon, eine Drum-Spur mit echtem Rock-Kit und 808-Kit, Effekte. Bedient wird am FM-1 wie an einem Loop-Pedal, das Handy ist der grosse Bildschirm.':
    'Three loop tracks from the microphone, a drum track with a real rock kit and an 808 kit, effects. You play it on the FM-1 like a loop pedal; the phone is the big screen.',
  'FM-1 mit der Loop-Station-Firmware per USB-C anschliessen.': 'Connect the FM-1 (with the loop station firmware) by USB-C.',
  'Kopfhoerer oder Box ans FM-1.': 'Headphones or a speaker into the FM-1.',
  'Starten tippen und Mikrofon und MIDI erlauben.': 'Tap Start and allow the microphone and MIDI.',
  'Dieser Browser kann nicht mit dem FM-1 sprechen. Bitte die Seite in Google Chrome oder Microsoft Edge oeffnen.': 'This browser cannot talk to the FM-1. Please open the page in Google Chrome or Microsoft Edge.',
  'Starten': 'Start', 'Startet …': 'Starting …', 'Fehler: ': 'Error: ',
  'SPUR STUMM': 'MUTE TRACK', 'SPUR AN': 'UNMUTE TRACK', 'LOESCHEN (halten)': 'CLEAR (hold)',
  'Alles loeschen': 'Clear all', 'Wirklich alles loeschen?': 'Really clear everything?',
  'Mikro': 'Mic', 'Ausgang': 'Output',
  'FM-1 nicht gefunden: Ist die Loop-Station-Firmware drauf und kein anderes Programm (Editor, M-UPGRADE) offen?':
    'FM-1 not found: is the loop station firmware on it, and no other program (editor, M-UPGRADE) open?',
  'Nochmal suchen': 'Search again',
  'EFFEKTE · die vier Regler K1–K4 am FM-1': 'EFFECTS · the four knobs K1–K4 on the FM-1',
  'STUTTER (halten)': 'STUTTER (hold)',
  'DRUMS · Tasten 1–16 = Schritte, Tasten 17–27 = Pads': 'DRUMS · keys 1–16 = steps, keys 17–27 = pads',
  'EINSTELLUNGEN': 'SETTINGS', 'Sprache': 'Language', 'Mikrofon': 'Microphone',
  'Ausgang (am Computer: das FM-1 waehlen)': 'Output (on a computer: choose the FM-1)', 'Standard': 'Default',
  'BEDIENUNG AM FM-1': 'CONTROLS ON THE FM-1',
  'Aufnahme → Overdub → Wiedergabe → Overdub … (wie am Loop-Pedal). Auf der Drum-Spur: Pads ins Muster einspielen.':
    'Record → overdub → play → overdub … (as on a loop pedal). On the drum track: record the pads into the pattern.',
  'Alles starten / stoppen': 'Start / stop everything',
  'Undo / Redo der letzten Aufnahme': 'Undo / redo the last take',
  'Gewaehlte Spur stumm / an': 'Mute / unmute the selected track',
  'SAVE halten': 'Hold SAVE', 'Gewaehlte Spur loeschen': 'Clear the selected track',
  'Drums an / aus': 'Drums on / off', 'Spur waehlen (1, 2, 3, Drums)': 'Choose the track (1, 2, 3, drums)',
  'Drum-Muster waehlen': 'Choose the drum pattern', 'Drum-Instrument fuer die Schritt-Tasten waehlen': 'Choose the drum sound shown on the step keys',
  'Seiten DELAY+HALL · FILTER+BITCRUSH · SPUR · MIKRO · DRUMS. K1–K4 stellen die vier Werte. Bitcrusher: ENV, dann K3 (Bits) und K4 (Samplerate).':
    'Pages DELAY+REVERB · FILTER+BITCRUSH · TRACK · MIC · DRUMS. K1–K4 set the four values. Bitcrusher: ENV, then K3 (bits) and K4 (sample rate).',
  'Tippen: Seite CHORUS+STUTTER. Halten: Stutter': 'Tap: page CHORUS+STUTTER. Hold: stutter',
  'Tasten 1–16': 'Keys 1–16', 'Tasten 17–27': 'Keys 17–27',
  'Die 16 Schritte des gewaehlten Drum-Instruments (leuchtet = Schlag)': 'The 16 steps of the selected drum sound (lit = hit)',
  'Drum-Pads: Kick, Snare, Rimshot/Clap, Hat zu, Hat auf, 3 Toms, Sidestick/Rim, Ride/Cowbell, Crash/Becken':
    'Drum pads: kick, snare, rimshot/clap, closed hat, open hat, 3 toms, sidestick/rim, ride/cowbell, crash/cymbal',
  'Tastenlicht': 'Button lights',
  'Seite MIKRO (GLO), K4: Grundhelligkeit der Tasten von AUS bis 8; die aktive Taste leuchtet voll (braucht die Loop-Station-Firmware).':
    'Page MIC (GLO), K4: base brightness of the buttons from OFF to 8; the active button is fully lit (needs the loop station firmware).',
  'Am Computer ohne FM-1: Leertaste = Play, R = Rec, Z = Undo, 1–4 = Spur, S halten = Stutter.':
    'On a computer without the FM-1: space = play, R = rec, Z = undo, 1–4 = track, hold S = stutter.',
  'ROCK-Kit: Big Rusty Drums von Karoryfer Samples, CC0 (gemeinfrei).': 'ROCK kit: Big Rusty Drums by Karoryfer Samples, CC0 (public domain).',
  // states and buttons
  'LEER': 'EMPTY', 'WARTET AUF TAKT': 'WAITING FOR BAR', 'REC BIS TAKTENDE': 'REC TO BAR END', 'AUFNAHME': 'RECORDING',
  'AN': 'ON', 'AUS': 'OFF', 'SPUR': 'TRACK', 'ABBRECHEN': 'CANCEL', 'DRUM-REC AUS': 'DRUM-REC OFF',
  'DRUMS AN': 'DRUMS ON', 'DRUMS AUS': 'DRUMS OFF', 'WARTE': 'WAIT', 'BEREIT': 'READY', 'Takt': 'bar', 'Takte': 'bars',
  'FM-1 verbunden': 'FM-1 connected', 'FM-1 nicht gefunden': 'FM-1 not found', 'kein MIDI-Geraet': 'no MIDI device',
  // pages and parameters
  'DELAY + HALL': 'DELAY + REVERB', 'FILTER + BITCRUSH': 'FILTER + BITCRUSH', 'CHORUS + STUTTER': 'CHORUS + STUTTER',
  'MIKRO + AUSGANG': 'MIC + OUTPUT', 'MIKRO': 'MIC', 'ZEIT': 'TIME', 'HALL': 'REVERB', 'RESONANZ': 'RESONANCE', 'TIEFE': 'DEPTH',
  'HALLRAUM': 'ROOM SIZE', 'LAUTST.': 'VOLUME', 'RUECKW.': 'REVERSE', 'NACH REC': 'AFTER REC', 'MUSTER': 'PATTERN',
  'EINGANG': 'INPUT', 'MITHOEREN': 'MONITOR', 'LATENZ': 'LATENCY', 'TASTENLICHT': 'BTN LIGHT', 'MITTE': 'CENTER',
  'IMMER AN': 'ALWAYS', 'TP': 'LP', 'LICHT': 'LIGHT', 'RAUM': 'ROOM', 'FEEDBK': 'FEEDBK', 'RUECKW': 'REVERSE', 'N.REC': 'AFTER',
  // kits, voices, patterns
  'ROCK (ECHT)': 'ROCK (REAL)', 'SYNTH AKUSTIK': 'SYNTH ACOUSTIC', 'SYNTH': 'SYNTH',
  'HAT ZU': 'HAT CLOSED', 'HAT AUF': 'HAT OPEN', 'TOM TIEF': 'TOM LOW', 'TOM MITTE': 'TOM MID', 'TOM HOCH': 'TOM HIGH', 'BECKEN': 'CYMBAL',
  'BALLADE': 'BALLAD', 'Drums: keine Wellenform': 'Drums: no waveform',
  // messages
  'Tempo kommt vom Loop': 'The tempo comes from the loop', 'Ausgang nicht verfuegbar': 'Output not available',
  'Kein Mikrofon: ': 'No microphone: ', 'geloescht': 'cleared', 'Drum-Muster geloescht': 'Drum pattern cleared',
  'SAVE halten = Spur loeschen': 'Hold SAVE = clear track', 'Halten = loeschen': 'Hold = clear', 'Muster': 'Pattern',
};
let LANG = 'de';
const T = s => (LANG === 'en' && EN[s] !== undefined ? EN[s] : s);
const TV = s => { s = String(s); if (LANG !== 'en') return s; if (EN[s] !== undefined) return EN[s]; const i = s.indexOf(' '); return i > 0 && EN[s.slice(0, i)] !== undefined ? EN[s.slice(0, i)] + s.slice(i) : s; };
