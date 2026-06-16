// Guitar chord voicings data
// frets: [E2, A2, D3, G3, B3, E4] (low to high)
// -1 = muted (X), 0 = open, 1-12 = fret number
// fingers: 0=none(open), 1=index, 2=middle, 3=ring, 4=pinky, 5=barre
// barre: fret number if barre chord, else 0

export const CHORD_VOICINGS = {
  // ── Major chords
  "C":  [{ frets:[-1,3,2,0,1,0], fingers:[0,3,2,0,1,0], barre:0, label:"C" }],
  "C#": [{ frets:[-1,4,3,1,2,1], fingers:[0,4,3,1,2,1], barre:1, label:"C#/Db" },
         { frets:[9,11,11,10,9,9], fingers:[1,3,4,2,1,1], barre:9, label:"C# (9fr)" }],
  "Db": [{ frets:[-1,4,3,1,2,1], fingers:[0,4,3,1,2,1], barre:1, label:"Db/C#" }],
  "D":  [{ frets:[-1,-1,0,2,3,2], fingers:[0,0,0,1,3,2], barre:0, label:"D" }],
  "D#": [{ frets:[-1,-1,1,3,4,3], fingers:[0,0,1,2,4,3], barre:0, label:"D#/Eb" }],
  "Eb": [{ frets:[-1,-1,1,3,4,3], fingers:[0,0,1,2,4,3], barre:0, label:"Eb/D#" }],
  "E":  [{ frets:[0,2,2,1,0,0], fingers:[0,2,3,1,0,0], barre:0, label:"E" }],
  "F":  [{ frets:[1,3,3,2,1,1], fingers:[1,3,4,2,1,1], barre:1, label:"F" }],
  "F#": [{ frets:[2,4,4,3,2,2], fingers:[1,3,4,2,1,1], barre:2, label:"F#/Gb" }],
  "Gb": [{ frets:[2,4,4,3,2,2], fingers:[1,3,4,2,1,1], barre:2, label:"Gb/F#" }],
  "G":  [{ frets:[3,2,0,0,0,3], fingers:[2,1,0,0,0,3], barre:0, label:"G" },
         { frets:[3,2,0,0,3,3], fingers:[2,1,0,0,3,4], barre:0, label:"G (alt)" }],
  "G#": [{ frets:[4,6,6,5,4,4], fingers:[1,3,4,2,1,1], barre:4, label:"G#/Ab" }],
  "Ab": [{ frets:[4,6,6,5,4,4], fingers:[1,3,4,2,1,1], barre:4, label:"Ab/G#" }],
  "A":  [{ frets:[-1,0,2,2,2,0], fingers:[0,0,1,2,3,0], barre:0, label:"A" },
         { frets:[-1,0,2,2,2,0], fingers:[0,0,2,3,4,0], barre:0, label:"A (v2)" }],
  "A#": [{ frets:[-1,1,3,3,3,1], fingers:[0,1,2,3,4,1], barre:1, label:"A#/Bb" }],
  "Bb": [{ frets:[-1,1,3,3,3,1], fingers:[0,1,2,3,4,1], barre:1, label:"Bb/A#" }],
  "B":  [{ frets:[-1,2,4,4,4,2], fingers:[0,1,2,3,4,1], barre:2, label:"B" }],

  // ── Minor chords
  "Cm":  [{ frets:[-1,3,5,5,4,3], fingers:[0,1,3,4,2,1], barre:3, label:"Cm" }],
  "C#m": [{ frets:[-1,4,6,6,5,4], fingers:[0,1,3,4,2,1], barre:4, label:"C#m/Dbm" }],
  "Dbm": [{ frets:[-1,4,6,6,5,4], fingers:[0,1,3,4,2,1], barre:4, label:"Dbm" }],
  "Dm":  [{ frets:[-1,-1,0,2,3,1], fingers:[0,0,0,2,3,1], barre:0, label:"Dm" }],
  "D#m": [{ frets:[-1,-1,1,3,4,2], fingers:[0,0,1,3,4,2], barre:0, label:"D#m/Ebm" }],
  "Ebm": [{ frets:[-1,-1,1,3,4,2], fingers:[0,0,1,3,4,2], barre:0, label:"Ebm" }],
  "Em":  [{ frets:[0,2,2,0,0,0], fingers:[0,2,3,0,0,0], barre:0, label:"Em" }],
  "Fm":  [{ frets:[1,3,3,1,1,1], fingers:[1,3,4,1,1,1], barre:1, label:"Fm" }],
  "F#m": [{ frets:[2,4,4,2,2,2], fingers:[1,3,4,1,1,1], barre:2, label:"F#m/Gbm" }],
  "Gbm": [{ frets:[2,4,4,2,2,2], fingers:[1,3,4,1,1,1], barre:2, label:"Gbm" }],
  "Gm":  [{ frets:[3,5,5,3,3,3], fingers:[1,3,4,1,1,1], barre:3, label:"Gm" }],
  "G#m": [{ frets:[4,6,6,4,4,4], fingers:[1,3,4,1,1,1], barre:4, label:"G#m/Abm" }],
  "Abm": [{ frets:[4,6,6,4,4,4], fingers:[1,3,4,1,1,1], barre:4, label:"Abm" }],
  "Am":  [{ frets:[-1,0,2,2,1,0], fingers:[0,0,2,3,1,0], barre:0, label:"Am" }],
  "A#m": [{ frets:[-1,1,3,3,2,1], fingers:[0,1,3,4,2,1], barre:1, label:"A#m/Bbm" }],
  "Bbm": [{ frets:[-1,1,3,3,2,1], fingers:[0,1,3,4,2,1], barre:1, label:"Bbm" }],
  "Bm":  [{ frets:[-1,2,4,4,3,2], fingers:[0,1,3,4,2,1], barre:2, label:"Bm" }],

  // ── Dominant 7th
  "C7":  [{ frets:[-1,3,2,3,1,0], fingers:[0,3,2,4,1,0], barre:0, label:"C7" }],
  "D7":  [{ frets:[-1,-1,0,2,1,2], fingers:[0,0,0,2,1,3], barre:0, label:"D7" }],
  "E7":  [{ frets:[0,2,0,1,0,0], fingers:[0,2,0,1,0,0], barre:0, label:"E7" }],
  "F7":  [{ frets:[1,3,1,2,1,1], fingers:[1,3,1,2,1,1], barre:1, label:"F7" }],
  "G7":  [{ frets:[3,2,0,0,0,1], fingers:[3,2,0,0,0,1], barre:0, label:"G7" }],
  "A7":  [{ frets:[-1,0,2,0,2,0], fingers:[0,0,2,0,3,0], barre:0, label:"A7" }],
  "B7":  [{ frets:[-1,2,1,2,0,2], fingers:[0,2,1,3,0,4], barre:0, label:"B7" }],

  // ── Major 7th
  "Cmaj7": [{ frets:[-1,3,2,0,0,0], fingers:[0,3,2,0,0,0], barre:0, label:"Cmaj7" }],
  "Dmaj7": [{ frets:[-1,-1,0,2,2,2], fingers:[0,0,0,1,1,1], barre:0, label:"Dmaj7" }],
  "Emaj7": [{ frets:[0,2,1,1,0,0], fingers:[0,2,1,1,0,0], barre:0, label:"Emaj7" }],
  "Fmaj7": [{ frets:[-1,-1,3,2,1,0], fingers:[0,0,3,2,1,0], barre:0, label:"Fmaj7" }],
  "Gmaj7": [{ frets:[3,2,0,0,0,2], fingers:[2,1,0,0,0,3], barre:0, label:"Gmaj7" }],
  "Amaj7": [{ frets:[-1,0,2,1,2,0], fingers:[0,0,2,1,3,0], barre:0, label:"Amaj7" }],
  "Bmaj7": [{ frets:[-1,2,4,3,4,2], fingers:[0,1,3,2,4,1], barre:2, label:"Bmaj7" }],

  // ── Minor 7th
  "Cm7":  [{ frets:[-1,3,5,3,4,3], fingers:[0,1,3,1,2,1], barre:3, label:"Cm7" }],
  "Dm7":  [{ frets:[-1,-1,0,2,1,1], fingers:[0,0,0,3,1,2], barre:0, label:"Dm7" }],
  "Em7":  [{ frets:[0,2,0,0,0,0], fingers:[0,2,0,0,0,0], barre:0, label:"Em7" }],
  "Fm7":  [{ frets:[1,3,1,1,1,1], fingers:[1,3,1,1,1,1], barre:1, label:"Fm7" }],
  "Gm7":  [{ frets:[3,5,3,3,3,3], fingers:[1,3,1,1,1,1], barre:3, label:"Gm7" }],
  "Am7":  [{ frets:[-1,0,2,0,1,0], fingers:[0,0,2,0,1,0], barre:0, label:"Am7" }],
  "Bm7":  [{ frets:[-1,2,4,2,3,2], fingers:[0,1,3,1,2,1], barre:2, label:"Bm7" }],

  // ── sus2 / sus4
  "Csus2": [{ frets:[-1,3,0,0,1,3], fingers:[0,2,0,0,1,3], barre:0, label:"Csus2" }],
  "Dsus2": [{ frets:[-1,-1,0,2,3,0], fingers:[0,0,0,1,2,0], barre:0, label:"Dsus2" }],
  "Esus4": [{ frets:[0,2,2,2,0,0], fingers:[0,1,2,3,0,0], barre:0, label:"Esus4" }],
  "Asus2": [{ frets:[-1,0,2,2,0,0], fingers:[0,0,1,2,0,0], barre:0, label:"Asus2" }],
  "Asus4": [{ frets:[-1,0,2,2,3,0], fingers:[0,0,1,2,3,0], barre:0, label:"Asus4" }],
  "Dsus4": [{ frets:[-1,-1,0,2,3,3], fingers:[0,0,0,1,2,3], barre:0, label:"Dsus4" }],
  "Gsus4": [{ frets:[3,3,0,0,1,3], fingers:[2,3,0,0,1,4], barre:0, label:"Gsus4" }],

  // ── Dominant 7th (chromatic — barre shape, root on low E)
  // Pattern: [N, N+2, N, N+1, N, N] (E7 movable shape)
  "C#7":  [{ frets:[9,11,9,10,9,9],   fingers:[1,3,1,2,1,1], barre:9,  label:"C#7/Db7" }],
  "Db7":  [{ frets:[9,11,9,10,9,9],   fingers:[1,3,1,2,1,1], barre:9,  label:"Db7/C#7" }],
  "D#7":  [{ frets:[11,13,11,12,11,11], fingers:[1,3,1,2,1,1], barre:11, label:"D#7/Eb7" }],
  "Eb7":  [{ frets:[11,13,11,12,11,11], fingers:[1,3,1,2,1,1], barre:11, label:"Eb7/D#7" }],
  "F#7":  [{ frets:[2,4,2,3,2,2],    fingers:[1,3,1,2,1,1], barre:2,  label:"F#7/Gb7" }],
  "Gb7":  [{ frets:[2,4,2,3,2,2],    fingers:[1,3,1,2,1,1], barre:2,  label:"Gb7/F#7" }],
  "G#7":  [{ frets:[4,6,4,5,4,4],    fingers:[1,3,1,2,1,1], barre:4,  label:"G#7/Ab7" }],
  "Ab7":  [{ frets:[4,6,4,5,4,4],    fingers:[1,3,1,2,1,1], barre:4,  label:"Ab7/G#7" }],
  "A#7":  [{ frets:[6,8,6,7,6,6],    fingers:[1,3,1,2,1,1], barre:6,  label:"A#7/Bb7" }],
  "Bb7":  [{ frets:[6,8,6,7,6,6],    fingers:[1,3,1,2,1,1], barre:6,  label:"Bb7/A#7" }],

  // ── Minor 7th (chromatic — barre shape, root on low E)
  // Pattern: [N, N+2, N, N, N, N] (Em7 movable shape)
  "C#m7": [{ frets:[9,11,9,9,9,9],   fingers:[1,3,1,1,1,1], barre:9,  label:"C#m7/Dbm7" }],
  "Dbm7": [{ frets:[9,11,9,9,9,9],   fingers:[1,3,1,1,1,1], barre:9,  label:"Dbm7/C#m7" }],
  "D#m7": [{ frets:[11,13,11,11,11,11], fingers:[1,3,1,1,1,1], barre:11, label:"D#m7/Ebm7" }],
  "Ebm7": [{ frets:[11,13,11,11,11,11], fingers:[1,3,1,1,1,1], barre:11, label:"Ebm7/D#m7" }],
  "F#m7": [{ frets:[2,4,2,2,2,2],    fingers:[1,3,1,1,1,1], barre:2,  label:"F#m7/Gbm7" }],
  "Gbm7": [{ frets:[2,4,2,2,2,2],    fingers:[1,3,1,1,1,1], barre:2,  label:"Gbm7/F#m7" }],
  "G#m7": [{ frets:[4,6,4,4,4,4],    fingers:[1,3,1,1,1,1], barre:4,  label:"G#m7/Abm7" }],
  "Abm7": [{ frets:[4,6,4,4,4,4],    fingers:[1,3,1,1,1,1], barre:4,  label:"Abm7/G#m7" }],
  "A#m7": [{ frets:[6,8,6,6,6,6],    fingers:[1,3,1,1,1,1], barre:6,  label:"A#m7/Bbm7" }],
  "Bbm7": [{ frets:[6,8,6,6,6,6],    fingers:[1,3,1,1,1,1], barre:6,  label:"Bbm7/A#m7" }],

  // ── Diminished (movable shape: x N N+1 N+2 N+1 x, root on A string)
  "Bdim":  [{ frets:[-1,2,3,4,3,-1], fingers:[0,1,2,4,3,0], barre:0,  label:"Bdim" }],
  "Cdim":  [{ frets:[-1,3,4,5,4,-1], fingers:[0,1,2,4,3,0], barre:0,  label:"Cdim" }],
  "C#dim": [{ frets:[-1,4,5,6,5,-1], fingers:[0,1,2,4,3,0], barre:4,  label:"C#dim" }],
  "Dbdim": [{ frets:[-1,4,5,6,5,-1], fingers:[0,1,2,4,3,0], barre:4,  label:"Dbdim" }],
  "Ddim":  [{ frets:[-1,5,6,7,6,-1], fingers:[0,1,2,4,3,0], barre:5,  label:"Ddim" }],
  "D#dim": [{ frets:[-1,6,7,8,7,-1], fingers:[0,1,2,4,3,0], barre:6,  label:"D#dim" }],
  "Ebdim": [{ frets:[-1,6,7,8,7,-1], fingers:[0,1,2,4,3,0], barre:6,  label:"Ebdim" }],
  "Edim":  [{ frets:[-1,7,8,9,8,-1], fingers:[0,1,2,4,3,0], barre:7,  label:"Edim" }],
  "Fdim":  [{ frets:[-1,8,9,10,9,-1], fingers:[0,1,2,4,3,0], barre:8, label:"Fdim" }],
  "F#dim": [{ frets:[-1,9,10,11,10,-1], fingers:[0,1,2,4,3,0], barre:9, label:"F#dim" }],
  "Gbdim": [{ frets:[-1,9,10,11,10,-1], fingers:[0,1,2,4,3,0], barre:9, label:"Gbdim" }],
  "Gdim":  [{ frets:[-1,10,11,12,11,-1], fingers:[0,1,2,4,3,0], barre:10, label:"Gdim" }],
  "G#dim": [{ frets:[-1,11,12,13,12,-1], fingers:[0,1,2,4,3,0], barre:11, label:"G#dim" }],
  "Abdim": [{ frets:[-1,11,12,13,12,-1], fingers:[0,1,2,4,3,0], barre:11, label:"Abdim" }],
  "Adim":  [{ frets:[-1,0,1,2,1,-1], fingers:[0,0,1,3,2,0], barre:0, label:"Adim" }],
  "A#dim": [{ frets:[-1,1,2,3,2,-1], fingers:[0,1,2,4,3,0], barre:1,  label:"A#dim" }],
  "Bbdim": [{ frets:[-1,1,2,3,2,-1], fingers:[0,1,2,4,3,0], barre:1,  label:"Bbdim" }],
};

const SHARP_NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// Major key diatonic chord degrees: offset (semitones), suffix, Roman numeral label
const DIATONIC_MAJOR = [
  { offset:0,  suffix:"",    roman:"I" },
  { offset:2,  suffix:"m",   roman:"ii" },
  { offset:4,  suffix:"m",   roman:"iii" },
  { offset:5,  suffix:"",    roman:"IV" },
  { offset:7,  suffix:"",    roman:"V" },
  { offset:9,  suffix:"m",   roman:"vi" },
  { offset:11, suffix:"dim", roman:"vii°" },
];

// Flat key semitone indices: F(5) Bb(10) Eb(3) Ab(8) Db(1) Gb(6) — matches App.jsx FLAT_RESULT_IDX
const FLAT_KEY_IDX = new Set([1, 3, 5, 6, 8, 10]);
// Sharp→Flat display map
const SHARP_TO_FLAT_DISPLAY = { "C#":"Db", "D#":"Eb", "F#":"Gb", "G#":"Ab", "A#":"Bb" };

// Get effective key name with correct #/b notation based on circle of fifths
export function getEffectiveKey(key, steps = 0) {
  const idx = SHARP_NOTES.indexOf(key);
  if (idx === -1) return key;
  const effIdx = ((idx + steps) % 12 + 12) % 12;
  const sharp = SHARP_NOTES[effIdx];
  return FLAT_KEY_IDX.has(effIdx) ? (SHARP_TO_FLAT_DISPLAY[sharp] || sharp) : sharp;
}

// Returns 7 diatonic chords using correct #/b notation for the key
// key: original song key (sharp notation, e.g. "G"), steps: effectiveSteps (transposeSteps - capoFret)
export function getDiatonicChords(key, steps = 0) {
  const rootIdx = SHARP_NOTES.indexOf(key);
  if (rootIdx === -1) return [];
  const effIdx = ((rootIdx + steps) % 12 + 12) % 12;
  const isFlat = FLAT_KEY_IDX.has(effIdx);
  return DIATONIC_MAJOR.map(({ offset, suffix, roman }) => {
    const noteIdx = (effIdx + offset) % 12;
    const sharpRoot = SHARP_NOTES[noteIdx];
    const root = (isFlat && SHARP_TO_FLAT_DISPLAY[sharpRoot]) ? SHARP_TO_FLAT_DISPLAY[sharpRoot] : sharpRoot;
    const name = root + suffix;
    return { name, roman, voicings: getVoicings(name) };
  });
}

// Transpose a key name by semitone steps (returns sharp notation)
export function transposeKey(key, steps) {
  const idx = SHARP_NOTES.indexOf(key);
  if (idx === -1) return key;
  return SHARP_NOTES[((idx + steps) % 12 + 12) % 12];
}

// Flat ↔ Sharp enharmonic mapping (both directions)
const FLAT_TO_SHARP = { Cb:"B", Db:"C#", Eb:"D#", Fb:"E", Gb:"F#", Ab:"G#", Bb:"A#" };
const SHARP_TO_FLAT = { "C#":"Db", "D#":"Eb", "F#":"Gb", "G#":"Ab", "A#":"Bb" };

// Get voicings for a chord name — handles slash chords + enharmonic equivalents
export function getVoicings(chordName) {
  if (!chordName) return null;

  function tryLookup(name) {
    if (CHORD_VOICINGS[name]) return CHORD_VOICINGS[name];
    // Strip slash bass (e.g. "G/B" → "G")
    const base = name.split("/")[0].trim();
    if (CHORD_VOICINGS[base]) return CHORD_VOICINGS[base];
    return null;
  }

  // Direct lookup
  let found = tryLookup(chordName);
  if (found) return found;

  // Parse root + suffix, try enharmonic root
  const m = chordName.match(/^([A-G][#b]?)(.*)/);
  if (!m) return null;
  const [, root, suffix] = m;

  // Try flat → sharp
  if (FLAT_TO_SHARP[root]) {
    found = tryLookup(FLAT_TO_SHARP[root] + suffix);
    if (found) return found;
  }
  // Try sharp → flat
  if (SHARP_TO_FLAT[root]) {
    found = tryLookup(SHARP_TO_FLAT[root] + suffix);
    if (found) return found;
  }

  return null;
}

// Parse chord name to root + suffix
export function parseChord(name) {
  if (!name) return null;
  const m = name.match(/^([A-G][#b]?)(.*)/);
  if (!m) return null;
  return { root: m[1], suffix: m[2] || "" };
}

// Chord interval patterns (semitones from root)
const CHORD_INTERVALS = {
  "":     [0, 4, 7],
  "m":    [0, 3, 7],
  "7":    [0, 4, 7, 10],
  "maj7": [0, 4, 7, 11],
  "M7":   [0, 4, 7, 11],
  "m7":   [0, 3, 7, 10],
  "dim":  [0, 3, 6],
  "dim7": [0, 3, 6, 9],
  "aug":  [0, 4, 8],
  "sus2": [0, 2, 7],
  "sus4": [0, 5, 7],
  "add9": [0, 4, 7, 2],
  "9":    [0, 4, 7, 10, 2],
  "m9":   [0, 3, 7, 10, 2],
  "6":    [0, 4, 7, 9],
  "m6":   [0, 3, 7, 9],
};

// Returns { root: 0-11, tones: [0-11, ...] } for a chord name
export function getChordTones(chordName) {
  if (!chordName) return { root: -1, tones: [] };
  const base = chordName.split("/")[0].trim();
  const m = base.match(/^([A-G][#b]?)(.*)/);
  if (!m) return { root: -1, tones: [] };
  let [, root, suffix] = m;
  if (FLAT_TO_SHARP[root]) root = FLAT_TO_SHARP[root];
  const rootIdx = SHARP_NOTES.indexOf(root);
  if (rootIdx === -1) return { root: -1, tones: [] };
  const intervals = CHORD_INTERVALS[suffix] || CHORD_INTERVALS[""];
  return { root: rootIdx, tones: intervals.map(i => (rootIdx + i) % 12) };
}
