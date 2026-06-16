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
};

// Get voicings for a chord name (handles enharmonic equivalents)
export function getVoicings(chordName) {
  if (!chordName) return null;
  // Try exact match first
  if (CHORD_VOICINGS[chordName]) return CHORD_VOICINGS[chordName];
  // Try stripping extra info (e.g. "G/B" → "G")
  const base = chordName.split("/")[0].trim();
  if (CHORD_VOICINGS[base]) return CHORD_VOICINGS[base];
  return null;
}

// Parse chord name to root + suffix
export function parseChord(name) {
  if (!name) return null;
  const m = name.match(/^([A-G][#b]?)(.*)/);
  if (!m) return null;
  return { root: m[1], suffix: m[2] || "" };
}
