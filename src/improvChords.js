// 즉흥 코드 진행 생성기 (알고리즘 방식)
// 예배 전 광고시간 잔잔한 키보드 즉흥 연주용 — 키/장단조/분위기 입력 → 코드 진행 + 상세 보이싱

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// 플랫 표기를 선호하는 조성 (제공되는 자연음 + 흔한 조성)
const FLAT_MAJOR_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb"]);
const FLAT_MINOR_KEYS = new Set(["C", "D", "F", "G", "Bb", "Eb", "Ab"]);

function rootPc(name) {
  let n = name;
  const map = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
  if (map[n]) n = map[n];
  return SHARP_NOTES.indexOf(n);
}

function useFlats(keyName, isMinor) {
  return isMinor ? FLAT_MINOR_KEYS.has(keyName) : FLAT_MAJOR_KEYS.has(keyName);
}

function noteName(pc, flats) {
  return (flats ? FLAT_NOTES : SHARP_NOTES)[((pc % 12) + 12) % 12];
}

// 음이름 + 옥타브 (예: E4)
function pitchLabel(pc, oct, flats) {
  return noteName(pc, flats) + oct;
}

// ── 다이아토닉: 각 음계 도수의 반음 오프셋 + 기본 성질
// quality: "maj" | "min" | "dim"
const DEGREE_MAJOR = {
  1: { off: 0,  q: "maj" }, 2: { off: 2,  q: "min" }, 3: { off: 4,  q: "min" },
  4: { off: 5,  q: "maj" }, 5: { off: 7,  q: "maj" }, 6: { off: 9,  q: "min" },
  7: { off: 11, q: "dim" },
};
const DEGREE_MINOR = {
  1: { off: 0,  q: "min" }, 2: { off: 2,  q: "dim" }, 3: { off: 3,  q: "maj" },
  4: { off: 5,  q: "min" }, 5: { off: 7,  q: "min" }, 6: { off: 8,  q: "maj" },
  7: { off: 10, q: "maj" },
};

// ── 분위기별 진행 패턴 (8마디 = A구간 4마디 + B구간 4마디)
const PROGRESSIONS = {
  major: {
    calm: [
      [1, 6, 4, 5,  1, 4, 2, 5],   // A: 기본순환   B: 서브도미넌트 II 경유
      [1, 5, 6, 4,  2, 5, 1, 4],   // A: 팝 루프    B: II-V-I 해결
      [4, 1, 5, 6,  4, 5, 1, 1],   // A: IV시작     B: 으뜸 완전종지
      [6, 4, 1, 5,  6, 2, 4, 5],   // A: vi시작     B: II 경유 발전
    ],
    adoration: [
      [1, 4, 6, 5,  1, 6, 2, 5],   // A: 경배기본   B: II-V 긴장
      [2, 5, 1, 4,  1, 4, 5, 1],   // A: II-V-I     B: 완전종지
      [1, 3, 4, 5,  1, 4, 2, 5],   // A: III색채    B: 서브도미넌트
      [1, 4, 1, 5,  6, 4, 2, 5],   // A: 단순       B: vi→II 빌드업
    ],
    praise: [
      [1, 5, 6, 4,  4, 5, 1, 1],   // A: 에너지     B: 으뜸 완전해결
      [4, 1, 5, 6,  1, 4, 5, 1],   // A: IV드라이브 B: 강한종지
      [1, 4, 5, 4,  1, 5, 6, 5],   // A: 파워       B: 긴장유지
      [5, 6, 4, 1,  4, 5, 1, 1],   // A: V시작(강)  B: 완전종지
    ],
  },
  minor: {
    calm: [
      [1, 6, 3, 7,  1, 4, 6, 5],   // A: 자연단음계 B: IV 추가
      [1, 4, 6, 5,  1, 3, 7, 1],   // A: 기본단조   B: i로 해결
      [1, 3, 7, 6,  4, 5, 1, 1],   // A: III색채    B: 종지
      [6, 7, 1, 1,  4, 5, 1, 6],   // A: VI시작     B: 순환
    ],
    adoration: [
      [1, 4, 5, 1,  6, 7, 1, 5],   // A: 단순i-IV   B: VI→V 발전
      [1, 6, 7, 1,  4, 5, 1, 1],   // A: 순환       B: 완전종지
      [1, 4, 7, 3,  6, 7, 1, 1],   // A: VII색채    B: 해결
      [1, 5, 6, 3,  4, 5, 1, 1],   // A: 빌드업     B: 강한종지
    ],
    praise: [
      [1, 7, 6, 7,  1, 5, 4, 5],   // A: 드라이브   B: 파워
      [1, 5, 6, 3,  4, 5, 1, 1],   // A: 에너지     B: 해결
      [6, 7, 1, 5,  4, 5, 1, 1],   // A: VI시작     B: 종지
      [1, 4, 5, 6,  7, 1, 4, 5],   // A: 발전       B: V로 마무리
    ],
  },
};

const MOOD_META = {
  calm:      { label: "잔잔함", emoji: "🕊️", bpm: 66, dir: "잔잔하게",
               hints: ["아르페지오 ↑", "소프트 페달", "레가토", "천천히 반복"] },
  adoration: { label: "경배",   emoji: "🙏", bpm: 73, dir: "깊이있게",
               hints: ["블록 코드", "서스테인 페달", "왼손 옥타브", "점점 크게"] },
  praise:    { label: "찬양",   emoji: "🔥", bpm: 84, dir: "경쾌하게",
               hints: ["리드미컬하게", "8분음표 컴핑", "밝게", "반복 가능"] },
};

// 오른손 보이싱: 음정 묶음을 오름차순으로 옥타브 배치 (octave 3부터)
function voiceUp(pcs, startOct = 3) {
  const out = [];
  let prevAbs = -1;
  for (const pc of pcs) {
    let oct = startOct;
    let abs = oct * 12 + pc;
    while (abs <= prevAbs) { oct++; abs += 12; }
    out.push({ pc, oct });
    prevAbs = abs;
  }
  return out;
}

// 한 코드에 대한 이름 + 보이싱 생성
function buildChord(degree, mode, rootName, mood, flats) {
  const table = mode === "minor" ? DEGREE_MINOR : DEGREE_MAJOR;
  const deg = table[degree];
  const cRootPc = (rootPc(rootName) + deg.off) % 12;
  const cRootName = noteName(cRootPc, flats);
  const isDominantSlot = degree === 5;

  // 3화음 기본 음정
  const triad = deg.q === "maj" ? [0, 4, 7] : deg.q === "min" ? [0, 3, 7] : [0, 3, 6];

  let suffix = "";
  let rhPcs = triad.map(i => (cRootPc + i) % 12);
  let tensionPc = null;   // 강조할 텐션 음
  let resolveTo = null;   // sus 해결음 (pc)

  if (mood === "calm") {
    // add9 색채
    const ninth = (cRootPc + 2) % 12;
    if (deg.q === "maj")      suffix = "add9";
    else if (deg.q === "min") suffix = "m(add9)";
    else                      suffix = "dim";
    if (deg.q !== "dim") { rhPcs = [...triad.map(i => (cRootPc + i) % 12), ninth]; tensionPc = ninth; }
  } else if (mood === "adoration") {
    if (deg.q === "dim") {
      suffix = "m7♭5";
      rhPcs = [0, 3, 6, 10].map(i => (cRootPc + i) % 12);
    } else if (isDominantSlot) {
      // 도미넌트 7
      suffix = "7";
      rhPcs = [0, 4, 7, 10].map(i => (cRootPc + i) % 12);
      tensionPc = (cRootPc + 10) % 12;
    } else if (deg.q === "maj") {
      suffix = "maj7";
      rhPcs = [0, 4, 7, 11].map(i => (cRootPc + i) % 12);
      tensionPc = (cRootPc + 11) % 12;
    } else {
      suffix = "m7";
      rhPcs = [0, 3, 7, 10].map(i => (cRootPc + i) % 12);
      tensionPc = (cRootPc + 10) % 12;
    }
  } else { // praise
    if (isDominantSlot && deg.q !== "dim") {
      // sus4 → 3도 해결
      suffix = "sus4→";
      const fourth = (cRootPc + 5) % 12;
      const fifth = (cRootPc + 7) % 12;
      rhPcs = [cRootPc, fourth, fifth];
      tensionPc = fourth;
      resolveTo = (cRootPc + 4) % 12; // 장3도로 해결
    } else {
      suffix = deg.q === "min" ? "m" : deg.q === "dim" ? "dim" : "";
    }
  }

  const name = cRootName + suffix;

  // 왼손 베이스 (옥타브 2)
  const lh = [{ ...{ pc: cRootPc, oct: 2 }, role: "bass" }];

  // 오른손 보이싱
  const voiced = voiceUp(rhPcs, 3);
  const rh = voiced.map(({ pc, oct }) => ({
    pc, oct,
    role: pc === tensionPc ? "tension" : "tone",
  }));

  let resolveNote = null;
  if (resolveTo != null) {
    // 텐션 음과 같은 옥타브 부근에서 해결음 표시
    const tNote = rh.find(n => n.role === "tension");
    const oct = tNote ? tNote.oct : 4;
    resolveNote = { pc: resolveTo, oct, role: "tone" };
  }

  return {
    name,
    lhLabels: lh.map(n => ({ label: pitchLabel(n.pc, n.oct, flats), role: n.role })),
    rhLabels: rh.map(n => ({ label: pitchLabel(n.pc, n.oct, flats), role: n.role })),
    resolveLabel: resolveNote ? { label: pitchLabel(resolveNote.pc, resolveNote.oct, flats), role: "tone" } : null,
    // 미니건반용: getChordTones가 인식하는 접미사로 정규화
    diagramName: cRootName + ({
      "add9": "add9", "m(add9)": "m", "maj7": "maj7", "m7": "m7",
      "7": "7", "sus4→": "sus4", "m7♭5": "dim", "m": "m", "dim": "dim", "": "",
    }[suffix] ?? ""),
    beats: resolveTo != null ? "1·2 / 3·4" : "1·2·3·4",
  };
}

// 메인 생성 함수
// key: "C"~"B" (자연음), mode: "major"|"minor", mood: "calm"|"adoration"|"praise"
// avoid: 직전 진행 패턴(중복 방지용 인덱스)
export function generateProgression(key, mode, mood, avoidIdx = -1) {
  const flats = useFlats(key, mode === "minor");
  const list = PROGRESSIONS[mode][mood];
  let idx = Math.floor(Math.random() * list.length);
  if (list.length > 1 && idx === avoidIdx) idx = (idx + 1) % list.length;
  const degrees = list[idx];

  const bars = degrees.map((d, i) => ({ bar: i + 1, ...buildChord(d, mode, key, mood, flats) }));
  const meta = MOOD_META[mood];
  const keyLabel = noteName(rootPc(key), flats) + (mode === "minor" ? "단조" : "장조");

  return {
    key,
    mode,
    mood,
    keyLabel,
    keyEng: noteName(rootPc(key), flats) + (mode === "minor" ? " Minor" : " Major"),
    moodLabel: meta.label,
    moodEmoji: meta.emoji,
    bpm: meta.bpm,
    direction: meta.dir,
    hints: meta.hints,
    bars,
    patternIdx: idx,
  };
}

export const KEYS = ["C", "D", "Eb", "E", "F", "G", "Ab", "A", "Bb", "B"];
export const MOODS = [
  { id: "calm",      label: "잔잔함", emoji: "🕊️" },
  { id: "adoration", label: "경배",   emoji: "🙏" },
  { id: "praise",    label: "찬양",   emoji: "🔥" },
];
