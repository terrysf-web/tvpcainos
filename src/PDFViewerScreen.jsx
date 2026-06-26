import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { C } from "./theme.js";
import {
  PARTS, VOCALIST_PART_IDS, INST_MODES, CUE_SECTIONS,
  getUserParts, isVocalistUser,
  isLeader, isFoh,
} from "./appUtils.js";
import { Icon, Btn, Modal, ConfirmModal } from "./ui.jsx";
import { getVoicings, getDiatonicChords, getEffectiveKey, CHORD_VOICINGS, getChordTones } from "./chordVoicings.js";
import { generateProgression, KEYS as IMPROV_KEYS, MOODS as IMPROV_MOODS } from "./improvChords.js";
import { HelpModal } from "./HelpModal.jsx";
import { db, storage } from "./firebase.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, setDoc, getDoc,
  query, orderBy, limit, serverTimestamp, where, deleteDoc, deleteField,
} from "firebase/firestore";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { detectChordsViaEdge, loadServiceSettings, saveWorshipRecording, loadWorshipRecording, deleteWorshipRecordingPart } from "./supabase.js";
import { openDrivePicker } from "./drivePicker.js";
import AIPanel from "./AIPanel.jsx";

/* ══════════════════════════════════════════════════════════════════
   RECORDING — IndexedDB helpers
══════════════════════════════════════════════════════════════════ */
const REC_DB_VER = 1;
function openRecDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("tvpc_recordings", REC_DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("recordings")) {
        const s = db.createObjectStore("recordings", { keyPath:"id", autoIncrement:true });
        s.createIndex("songId", "songId", { unique:false });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function saveRecToDB(blob, meta) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("recordings", "readwrite");
    const r  = tx.objectStore("recordings").add({ ...meta, blob, createdAt: Date.now() });
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e.target.error);
  });
}
async function getRecsFromDB(songId) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction("recordings", "readonly");
    const req = tx.objectStore("recordings").index("songId").getAll(songId);
    req.onsuccess = () => res((req.result || []).sort((a,b) => b.createdAt - a.createdAt));
    req.onerror   = e => rej(e.target.error);
  });
}
async function deleteRecFromDB(id) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("recordings", "readwrite");
    const r  = tx.objectStore("recordings").delete(id);
    r.onsuccess = res; r.onerror = e => rej(e.target.error);
  });
}
async function analyzeWithGemini(blob, apiKey, meta = {}) {
  const b64 = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result.split(",")[1]);
    fr.readAsDataURL(blob);
  });
  const { songTitle = "", key = "", bpm = "", pageNum = "", duration = 0, recMode = "general" } = meta;
  const songInfo = [
    songTitle && `곡명: ${songTitle}`,
    key       && `조성(Key): ${key}`,
    bpm       && `템포(BPM): ${bpm}`,
    pageNum   && `연습 페이지: ${pageNum}`,
    duration  && `녹음 길이: ${Math.floor(duration/60)}분 ${duration%60}초`,
  ].filter(Boolean).join(" | ");

  const NO_MD = "중요: 마크다운 기호(#, *, **, -) 절대 사용 금지. 이모지와 줄바꿈만 사용하세요.";
  const info = songInfo ? `곡 정보: ${songInfo}` : "";
  const ENDING = `마지막에 "→ 지금 당장 고쳐야 할 것:" 한 줄로 가장 중요한 것 하나만.\n한국어, 간결하게.`;

  let prompt;
  if (recMode === "vocal") {
    prompt = `교회 찬양팀 보컬 코치입니다. 아래 녹음을 꼼꼼히 분석해 주세요.
${info}
${NO_MD}

다섯 가지를 평가하세요:

🎵 음정 (Intonation)
${key ? `조성 ${key} 기준으로 ` : ""}음이탈이 발생하는 구체적 구간, 샤프(날카롭게 올라가는) 또는 플랫(처지는) 경향, 고음부(파사지오 이상) 안정성, 음이 흔들리는 비브라토 여부, 잘 된 부분과 아쉬운 부분을 각각 언급.

🥁 박자 & 리듬
${bpm ? `기준 BPM ${bpm} 대비 ` : ""}빠르거나 느린 경향, 박자가 흔들리거나 끌리는 구간, 쉼표 처리, 음절 타이밍이 반주와 맞는지.

🌬 호흡 & 지지
프레이즈 끝에서 호흡이 떨어지는지, 롱 노트를 끝까지 지지하는지, 호흡 소리가 마이크에 들어오는 구간, 프레이즈 나누는 위치가 자연스러운지.

🗣 발음 & 딕션
가사 전달이 명확한지, 자음(특히 ㄱ ㄷ ㅂ ㅅ)이 뭉개지는 구간, 모음의 일관성, 영어 가사가 있다면 발음 정확도.

🎙 음색 & 톤
두성과 흉성의 균형, 비음이 과하거나 부족한지, 소리가 목에 걸리는 구간, 전반적인 음색의 일관성과 안정성.

${ENDING}`;
  } else if (recMode === "piano") {
    prompt = `교회 찬양팀 피아노 코치입니다. 아래 녹음을 분석해 주세요.
${info}
${NO_MD}

세 가지를 평가하세요:

🎹 음정 & 터치
${key ? `조성 ${key} 기준으로 ` : ""}틀린 음, 보이싱의 적절함, 터치의 일관성 (너무 세거나 약한 부분).

🥁 박자
템포 안정성${bpm ? ` (기준 BPM ${bpm})` : ""}, 리듬이 끌리거나 밀리는 구간, 쉼표 처리.

🎵 표현
다이나믹(강약) 대비, 페달 사용, 왼손과 오른손 밸런스.

${ENDING}`;
  } else if (recMode === "guitar") {
    prompt = `교회 찬양팀 기타 코치입니다. 아래 녹음을 분석해 주세요.
${info}
${NO_MD}

세 가지를 평가하세요:

🎸 음정 & 코드
${key ? `조성 ${key} 기준으로 ` : ""}코드가 정확히 눌러지는지, 버징(buzzing) 발생 여부, 오픈 스트링 뮤트 처리.

🥁 박자 & 스트러밍
템포 안정성${bpm ? ` (기준 BPM ${bpm})` : ""}, 스트러밍/피킹 패턴의 정확도, 박자가 흔들리는 구간.

🔄 전환 & 표현
코드 전환 매끄러움, 다이나믹 조절, 반복적으로 실수하는 구간.

${ENDING}`;
  } else if (recMode === "drum") {
    prompt = `교회 찬양팀 드럼 코치입니다. 아래 녹음을 분석해 주세요.
${info}
${NO_MD}

세 가지를 평가하세요:

🥁 박자 & 그루브
자체 템포가 일정한지${bpm ? ` (기준 BPM ${bpm})` : ""}, 킥과 스네어 타이밍 정확도, 하이햇 일관성, 박자가 흔들리거나 끌리는 구간.

💥 다이나믹 & 필인
강약 대비가 되는지, 필인(fill-in)이 자연스럽게 연결되는지, 크래시 심벌 타이밍.

🎵 곡 구조 & 에너지
버스/코러스 전환에서 에너지 변화가 있는지, 곡의 흐름에 맞게 에너지를 조절하는지.

${ENDING}`;
  } else if (recMode === "bass") {
    prompt = `교회 찬양팀 베이스 코치입니다. 아래 녹음을 분석해 주세요.
${info}
${NO_MD}

세 가지를 평가하세요:

🎶 음정 & 노트 선택
${key ? `조성 ${key} 기준으로 ` : ""}베이스 라인이 코드에 맞는지, 틀린 음이나 어색한 노트, 루트 노트 중심인지 패싱 노트 활용하는지.

🥁 박자 & 타이밍
자체 템포가 일정한지${bpm ? ` (기준 BPM ${bpm})` : ""}, 박자가 끌리거나 밀리는 구간, 쉼표와 당김음 처리.

🔊 톤 & 테크닉
음의 길이(레가토/스타카토), 뮤트 처리, 전체적인 톤과 다이나믹.

${ENDING}`;
  } else if (recMode === "ensemble") {
    prompt = `교회 찬양팀 앙상블 코치입니다. 팀 전체가 함께 연주한 아래 녹음을 분석해 주세요.
${info}
${NO_MD}

아래 항목을 순서대로 평가하세요:

🥁 앙상블 타이밍 (가장 중요)
전체 박자가 함께 맞는지${bpm ? ` (기준 BPM ${bpm})` : ""}, 어떤 파트가 앞서거나 뒤처지는지, 끌리거나 밀리는 구간, 드럼과 베이스의 그루브가 단단히 잠겨있는지, 박자가 흔들리는 특정 구간.

🎚 전체 밸런스
어떤 악기나 보컬이 너무 크거나 작은지, 보컬이 악기에 묻히진 않는지, 전체 음량 균형.

🎵 블렌드 & 화음
악기와 보컬의 음색이 잘 어우러지는지, 코러스 화음이 깨끗한지, 불협화음이 발생하는 구간.

🌊 다이나믹 & 에너지
버스에서 코러스로 넘어갈 때 에너지가 살아나는지, 브릿지에서 긴장감이 있는지, 팀 전체의 다이나믹 대비가 느껴지는지.

🎙 보컬 & 반주 조화
보컬의 음정이 반주 코드와 맞는지, 보컬이 리듬을 리드하는지 반주에 끌려가는지.

💡 파트별 개선 우선순위
가장 시급한 파트 순서로 (보컬/피아노/기타/드럼/베이스), 각각 한 줄씩 구체적인 이유.

마지막에 "→ 팀 전체에 전달할 한 마디:" 한 줄로.
한국어, 간결하게.`;
  } else {
    prompt = `교회 찬양팀 악기 코치입니다. 아래 녹음을 분석해 주세요.
${info}
${NO_MD}

두 가지만 평가하세요:

🥁 박자
템포가 일정한지${bpm ? ` (기준 BPM ${bpm})` : ""}, 흔들리거나 끌리는 구간, 쉼표와 당김음 처리.

🎵 스킬
음의 연결, 다이나믹 조절, 코드/음 전환 매끄러움, 실수가 반복되는 부분.

${ENDING}`;
  }

  const body = JSON.stringify({
    contents:[{ parts:[
      { inlineData:{ mimeType: blob.type || "audio/webm", data:b64 } },
      { text: prompt },
    ]}],
    generationConfig:{ temperature:0.4, maxOutputTokens:2048 },
  });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method:"POST", headers:{"content-type":"application/json"}, body }
  );
  const d = await res.json();
  if (d.error) throw new Error(d.error.message || "Gemini 오류");
  return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/* ══════════════════════════════════════════════════════════════════
   HELP DATA
══════════════════════════════════════════════════════════════════ */

/* ── Chord transposition utilities (module-level) */
const SEMITONES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_SHARP  = {Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};
const DISPLAY_SHARP = {C:'C','C#':'C#',D:'D','D#':'D#',E:'E',F:'F','F#':'F#',G:'G','G#':'G#',A:'A','A#':'A#',B:'B'};
const DISPLAY_FLAT  = {C:'C','C#':'Db',D:'D','D#':'Eb',E:'E',F:'F','F#':'Gb',G:'G','G#':'Ab',A:'A','A#':'Bb',B:'B'};
// Circle of fifths: flat keys by semitone index (F=5, Bb=10, Eb=3, Ab=8, Db=1, Gb=6)
const FLAT_RESULT_IDX = new Set([1, 3, 5, 6, 8, 10]);
function useFlats(key, steps = 0) {
  if (!key) return false;
  const root = key.replace(/m$/, '').trim();
  // Use original key notation: 'b' in name (Bb,Db,Eb,Ab,Gb) or F → flat; '#' or natural → sharp
  // steps is intentionally ignored — notation follows the original sheet key signature
  return root === 'F' || root.includes('b');
}

function transposeNote(note, steps) {
  const n = FLAT_SHARP[note] || note;
  const i = SEMITONES.indexOf(n);
  if (i === -1) return note;
  return SEMITONES[((i + steps) % 12 + 12) % 12];
}

function transposeChord(chord, steps, flats = false) {
  if (!chord || steps === 0) return chord;
  const displayMap = flats ? DISPLAY_FLAT : DISPLAY_SHARP;
  // 슬래시 코드 처리 (예: E/G# → 앞뒤 각각 전조)
  if (chord.includes("/")) {
    const slash = chord.indexOf("/");
    const main = chord.slice(0, slash);
    const bass = chord.slice(slash + 1);
    return transposeChord(main, steps, flats) + "/" + transposeChord(bass, steps, flats);
  }
  // normalize flats to sharps, find root
  const c = chord.replace(/^(Db|Eb|Gb|Ab|Bb)/, m => FLAT_SHARP[m] || m);
  const twoChar = c.length > 1 && c[1] === '#';
  const root   = twoChar ? c.slice(0, 2) : c[0];
  const suffix = c.slice(root.length);
  // if root is not a valid note (e.g. "V", "I", section markers), leave unchanged
  if (SEMITONES.indexOf(FLAT_SHARP[root] || root) === -1) return chord;
  const newRoot = transposeNote(root, steps);
  return (displayMap[newRoot] || newRoot) + suffix;
}

function keyName(key, steps) {
  if (!key) return '?';
  const n = FLAT_SHARP[key] || key;
  const transposed = SEMITONES[((SEMITONES.indexOf(n) + steps) % 12 + 12) % 12];
  const displayMap = useFlats(key, steps) ? DISPLAY_FLAT : DISPLAY_SHARP;
  return displayMap[transposed] || transposed;
}

/* ── Capo recommendation: acoustic prefers G shape, electric prefers A shape */
// Returns { acoustic: {shape, capo}, electric: {shape, capo} }
function getCapoRec(key, steps = 0) {
  if (!key) return null;
  const n = FLAT_SHARP[key] || key;
  const rootIdx = SEMITONES.indexOf(n);
  if (rootIdx === -1) return null;
  const soundIdx = ((rootIdx + steps) % 12 + 12) % 12;
  const MAX = 7;
  function best(order) {
    for (const si of order) {
      const capo = (soundIdx - si + 12) % 12;
      if (capo <= MAX) return { shape: SEMITONES[si], capo };
    }
    return null;
  }
  return {
    acoustic: best([7, 2, 0, 9, 4]),  // G→D→C→A→E
    electric: best([9, 4, 2, 7, 0]),  // A→E→D→G→C
  };
}

/* ── Stamp palette definition (module-level) */
const STAMP_GROUPS = [
  { label:"악상", items:[
    { sym:"pp",  italic:true  },
    { sym:"p",   italic:true  },
    { sym:"mp",  italic:true  },
    { sym:"mf",  italic:true  },
    { sym:"f",   italic:true  },
    { sym:"ff",  italic:true  },
    { sym:"sfz", italic:true  },
    { sym:"fp",  italic:true  },
  ]},
  { label:"아티큘", items:[
    { sym:"·",   italic:false },
    { sym:"–",   italic:false },
    { sym:">",   italic:false },
    { sym:"^",   italic:false },
    { sym:"∪",   italic:false },
  ]},
  { label:"핑거링", items:[
    { sym:"1", italic:false },
    { sym:"2", italic:false },
    { sym:"3", italic:false },
    { sym:"4", italic:false },
    { sym:"5", italic:false },
  ]},
  { label:"악보", items:[
    { sym:"staff", italic:false },
    { sym:"𝄞",    italic:false },
    { sym:"𝄢",    italic:false },
  ]},
  { label:"음표", items:[
    { sym:"notehead", italic:false },
    { sym:"♩",  italic:false },
    { sym:"♪",  italic:false },
    { sym:"♫",  italic:false },
    { sym:"♬",  italic:false },
    { sym:"𝄽",  italic:false },
    { sym:"𝄾",  italic:false },
    { sym:"𝄿",  italic:false },
  ]},
  { label:"임시표", items:[
    { sym:"♭",  italic:false },
    { sym:"♮",  italic:false },
    { sym:"♯",  italic:false },
    { sym:"𝄪",  italic:false },
    { sym:"𝄫",  italic:false },
  ]},
  { label:"기타", items:[
    { sym:"✓", italic:false },
    { sym:"★", italic:false },
    { sym:"!", italic:false },
    { sym:"?", italic:false },
  ]},
];
const STAMPS = STAMP_GROUPS.flatMap(g => g.items);

// 모든 심볼: textBaseline:"middle" → 글리프 중앙 = 터치 지점 = 루페 십자선
function getStampBaseline(_sym) {
  return "middle";
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ── Canvas drawing utility (module-level, pure) */
function drawStrokes(canvas, strokes, cur = null, selectedIdx = -1) {
  if (!canvas || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const all = cur ? [...strokes, cur] : strokes;
  for (const s of all) {
    ctx.save();
    // ── Shape tools — need 2 points
    if (["slur","hairpin-cresc","hairpin-dim","line","rect","circle"].includes(s.tool)) {
      if (s.points && s.points.length >= 2) {
        const W = canvas.width, H = canvas.height;
        const p0 = s.points[0], p1 = s.points[1];
        const x0 = p0.x * W, y0 = p0.y * H;
        const x1 = p1.x * W, y1 = p1.y * H;
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.strokeStyle = s.color || "#e8383b";
        ctx.lineWidth = Math.max(1, (s.width || 1) * W / 900);
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (s.tool === "slur") {
          const dx = x1 - x0, dy = y1 - y0;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const curve = Math.min(len * 0.3, 40);
          const nx = -dy / len, ny = dx / len;
          const cpx = (x0+x1)/2 + nx * curve;
          const cpy = (y0+y1)/2 + ny * curve;
          ctx.beginPath(); ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(cpx, cpy, x1, y1); ctx.stroke();
        } else if (s.tool === "hairpin-cresc") {
          const spread = Math.max(8, Math.abs(x1-x0) * 0.18);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1 - spread);
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1 + spread); ctx.stroke();
        } else if (s.tool === "hairpin-dim") {
          const spread = Math.max(8, Math.abs(x1-x0) * 0.18);
          ctx.beginPath(); ctx.moveTo(x0, y0 - spread); ctx.lineTo(x1, y1);
          ctx.moveTo(x0, y0 + spread); ctx.lineTo(x1, y1); ctx.stroke();
        } else if (s.tool === "rect") {
          ctx.beginPath();
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else if (s.tool === "circle") {
          const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      }
      ctx.restore(); continue;
    }
    if (!s.points || s.points.length < 1) { ctx.restore(); continue; }
    if (s.tool === "text") {
      const pt = s.points[0];
      const px = pt.x * canvas.width;
      const py = pt.y * canvas.height;
      const sz = Math.max(5, (s.size || 14) * canvas.width / 450);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color || "#1c1c1e";
      ctx.font = `${s.bold ? "bold " : ""}${sz}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(s.text || "", px, py);
      ctx.restore(); continue;
    }
    if (s.tool === "stamp") {
      const pt = s.points[0];
      const px = pt.x * canvas.width;
      const py = pt.y * canvas.height;
      const sz = Math.max(7, (s.size || 10) * canvas.width / 450);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color || "#e8383b";
      if (s.symbol === "staff") {
        const lineGap = Math.max(2, sz * 0.32);
        const staffW = sz * 3.5;
        ctx.strokeStyle = s.color || "#222";
        ctx.lineWidth = Math.max(0.5, sz * 0.07);
        ctx.lineCap = "butt";
        for (let i = 0; i < 5; i++) {
          const ly = py - lineGap * 2 + i * lineGap;
          ctx.beginPath();
          ctx.moveTo(px - staffW / 2, ly);
          ctx.lineTo(px + staffW / 2, ly);
          ctx.stroke();
        }
      } else if (s.symbol === "notehead") {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-28 * Math.PI / 180);
        ctx.beginPath();
        ctx.ellipse(0, 0, sz * 0.17, sz * 0.12, 0, 0, Math.PI * 2);
        ctx.fillStyle = s.color || "#1c1c1e";
        ctx.fill();
        ctx.restore();
      } else {
        const family = s.italic
          ? '"Times New Roman", Georgia, serif'
          : 'system-ui, -apple-system, sans-serif';
        ctx.font = `${s.italic ? "italic " : ""}bold ${sz}px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const sym = s.symbol || "f";
        const textW = ctx.measureText(sym).width;
        const padX = sz * 0.28;
        const padY = sz * 0.18;
        const boxW = textW + padX * 2;
        const boxH = sz + padY * 2;
        const bx = px - boxW / 2;
        const by = py - boxH / 2;
        const rad = Math.max(2, sz * 0.22);
        if (s.bg) {
          ctx.shadowColor = "rgba(0,0,0,0.18)";
          ctx.shadowBlur = sz * 0.5;
          ctx.shadowOffsetY = sz * 0.1;
          ctx.fillStyle = "rgba(255,255,255,0.94)";
          roundedRect(ctx, bx, by, boxW, boxH, rad);
          ctx.fill();
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        }
        // text
        ctx.fillStyle = s.color || "#e8383b";
        ctx.fillText(sym, px, py);
      }
      ctx.restore();
      continue;
    }
    const isEraser     = s.tool === "eraser"     || s.eraser;
    const isHighlight  = s.tool === "highlighter";
    const isCover      = s.tool === "cover";
    const lw = Math.max(0.5, s.width * canvas.width / 900);
    if (isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle   = "rgba(0,0,0,1)";
      ctx.lineWidth   = Math.max(4, s.width * canvas.width / 90);
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
    } else if (isHighlight) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = s.color;
      ctx.fillStyle   = s.color;
      ctx.lineWidth   = Math.max(2, s.width * canvas.width / 150);
      ctx.lineCap     = "square";
      ctx.lineJoin    = "round";
    } else if (isCover) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle   = "#ffffff";
      ctx.lineWidth   = Math.max(6, s.width * canvas.width / 80);
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.fillStyle   = s.color;
      ctx.lineWidth   = lw;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
    }
    const pts = s.points.map(p => [p.x * canvas.width, p.y * canvas.height]);
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 팀필기가 있으면 우상단에 딱 한 번 표시
  const hasTeam = all.some(s => s.team && !s.eraser);
  if (hasTeam) {
    const mSz = Math.max(8, canvas.width * 0.022);
    ctx.save(); ctx.font = `${mSz}px system-ui`; ctx.textAlign = "right";
    ctx.textBaseline = "top"; ctx.globalAlpha = 0.4;
    ctx.fillText("👥", canvas.width - 4, 4); ctx.restore();
  }
  // Selection indicator
  if (selectedIdx >= 0 && selectedIdx < all.length && !cur) {
    const sel = all[selectedIdx];
    if ((sel.tool === "text" || sel.tool === "stamp") && sel.points?.[0]) {
      const pt = sel.points[0];
      const px = pt.x * canvas.width;
      const py = pt.y * canvas.height;
      ctx.save();
      ctx.strokeStyle = "#0a84ff";
      ctx.lineWidth = Math.max(1.5, canvas.width * 0.003);
      ctx.setLineDash([5, 3]);
      ctx.globalAlpha = 0.85;
      if (sel.tool === "stamp") {
        const sz = Math.max(7, (sel.size || 10) * canvas.width / 450);
        const hw = sz * 1.4, hh = sz * 0.9;
        roundedRect(ctx, px - hw, py - hh, hw * 2, hh * 2, Math.max(3, sz * 0.25));
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(18, canvas.width * 0.045), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

function drawPointerStrokes(canvas, strokes, live = null) {
  if (!canvas || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const all = live ? [...strokes, live] : strokes;
  for (const s of all) {
    const pts = (s.pts || []).map(p => [p.x * canvas.width, p.y * canvas.height]);
    if (pts.length < 1) continue;
    ctx.save();
    ctx.shadowColor = "rgba(231,76,60,0.6)";
    ctx.shadowBlur = 7;
    ctx.strokeStyle = "#e74c3c";
    ctx.fillStyle   = "#e74c3c";
    ctx.lineWidth   = Math.max(2, canvas.width / 160);
    ctx.lineCap  = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i+1][0]) / 2;
        const my = (pts[i][1] + pts[i+1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════════
   YOUTUBE HELPERS
══════════════════════════════════════════════════════════════════ */
function getYoutubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function mmssToSec(mmss) {
  if (!mmss) return 0;
  const parts = mmss.trim().split(":").map(Number);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  if (parts.length === 1) return parts[0] || 0;
  return 0;
}

function getYoutubeEmbed(url) {
  const id = getYoutubeId(url);
  if (!id) return null;
  const p = new URLSearchParams({ rel: '0', enablejsapi: '1' });
  const t = url.match(/[?&]t=(\d+)/);
  if (t) p.set('start', t[1]);
  const end = url.match(/[?&]end=(\d+)/);
  if (end) p.set('end', end[1]);
  return `https://www.youtube.com/embed/${id}?${p}`;
}

// 악보 캔버스에서 실제 콘텐츠 영역(여백 제외)의 픽셀 바운드를 반환
// 코드 라벨 겹침 해소: 같은 행(y 근사) 내에서 좌우로 밀어 최소 간격 확보
function resolveChordOverlaps(chords, containerW, containerH, fontSize) {
  if (chords.length < 2) return chords;
  const GAP     = 4;  // 라벨 간 최소 간격 px
  const charW   = fontSize * 0.62; // monospace 글자폭 추정
  const padX    = 8;  // padding 양쪽 합
  const labelH  = fontSize * 1.6;
  const rowThr  = labelH * 1.8; // 이 범위 내 y 차이 → 같은 행

  const items = chords.map(c => ({
    ...c,
    px: c.x * containerW,
    py: c.y * containerH,
    lw: c.chord.length * charW + padX,
  }));

  // y 기준 정렬 후 같은 행에서 x 기준 정렬
  items.sort((a, b) => (Math.abs(a.py - b.py) < rowThr ? a.px - b.px : a.py - b.py));

  // 최대 8 패스로 수렴
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i], b = items[i + 1];
      if (Math.abs(b.py - a.py) > rowThr) continue;
      const need = a.lw / 2 + b.lw / 2 + GAP;
      const dist = b.px - a.px;
      if (dist < need) {
        const push = (need - dist) / 2;
        a.px = Math.max(a.lw / 2, a.px - push);
        b.px = Math.min(containerW - b.lw / 2, b.px + push);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return items.map(c => ({ ...c, x: c.px / containerW, y: c.py / containerH }));
}

function detectContentBounds(pdfCanvas, drawCanvas) {
  if (!pdfCanvas || !pdfCanvas.width || !pdfCanvas.height) return null;
  const W = pdfCanvas.width, H = pdfCanvas.height;
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const ctx = tmp.getContext("2d");
  ctx.drawImage(pdfCanvas, 0, 0);
  if (drawCanvas && drawCanvas.width === W && drawCanvas.height === H)
    ctx.drawImage(drawCanvas, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data;
  const THR = 230; // 이 값보다 밝으면 여백으로 간주
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i+3] > 10 && (d[i] < THR || d[i+1] < THR || d[i+2] < THR)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1, W, H } : null;
}

/* 세션 전체에서 공유되는 PDF 문서 캐시 (재파싱 방지) */
const _pdfCache = {};

function RecordingsModal({ songId, songTitle, userGeminiKey, sharedGeminiKey, onClose }) {
  const [recs,     setRecs]     = useState([]);
  const [playing,  setPlaying]  = useState(null); // id of currently playing
  const [analyzing,setAnalyzing]= useState(null); // id being analyzed
  const audioRef = useRef(null);

  useEffect(() => {
    getRecsFromDB(songId).then(setRecs).catch(() => {});
  }, [songId]);

  const fmt = (sec) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
  const fmtDate = (ts) => new Date(ts).toLocaleDateString("ko-KR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  const fmtSize = (b) => b < 1024*1024 ? `${(b/1024).toFixed(0)}KB` : `${(b/1024/1024).toFixed(1)}MB`;

  const play = (rec) => {
    if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
    if (playing === rec.id) { setPlaying(null); return; }
    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
    audio.play();
    setPlaying(rec.id);
  };

  const exportRec = async (rec) => {
    const ext = (rec.blob.type || "").includes("mp4") ? "m4a" : "webm";
    const fname = `${songTitle}_${new Date(rec.createdAt).toLocaleDateString("ko-KR").replace(/\. /g,"-").replace(".","")}.${ext}`;
    const file = new File([rec.blob], fname, { type: rec.blob.type || "audio/webm" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fname }); return; } catch {}
    }
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const del = async (rec) => {
    if (playing === rec.id && audioRef.current) { audioRef.current.pause(); setPlaying(null); }
    await deleteRecFromDB(rec.id);
    setRecs(p => p.filter(r => r.id !== rec.id));
  };

  const analyze = async (rec) => {
    // 본인 키 → 공유 키 순서로 시도
    const keys = [userGeminiKey, sharedGeminiKey].filter(Boolean).filter((k,i,a) => a.indexOf(k)===i);
    if (!keys.length) { alert("AI 분석을 사용하려면 관리자에게 문의하세요 (Gemini API 키 미설정)"); return; }
    setAnalyzing(rec.id);
    let lastErr = null;
    for (const key of keys) {
      try {
        const result = await analyzeWithGemini(rec.blob, key, {
          songTitle: rec.songTitle, key: rec.key, bpm: rec.bpm,
          pageNum: rec.pageNum, duration: rec.duration, recMode: rec.recMode || "general",
        });
        const db = await openRecDB();
        await new Promise((res, rej) => {
          const tx = db.transaction("recordings", "readwrite");
          const store = tx.objectStore("recordings");
          const gr = store.get(rec.id);
          gr.onsuccess = () => {
            const pr = store.put({ ...gr.result, aiAnalysis: result });
            pr.onsuccess = res; pr.onerror = e => rej(e.target.error);
          };
          gr.onerror = e => rej(e.target.error);
        });
        setRecs(p => p.map(r => r.id === rec.id ? { ...r, aiAnalysis: result } : r));
        setAnalyzing(null);
        return;
      } catch(e) { lastErr = e; }
    }
    const msg = lastErr?.message || "알 수 없는 오류";
    const isKeyErr = /api key|invalid|unauthorized|permission/i.test(msg);
    alert(isKeyErr
      ? `AI 키 오류: 키가 유효하지 않습니다.\n내 정보 → AI 분석 키 설정에서 키를 확인하거나\n리더에게 공유 키 설정을 요청하세요.\n\n오류: ${msg}`
      : `AI 분석 실패: ${msg}`);
    setAnalyzing(null);
  };

  return (
    <Modal title={`녹음 — ${songTitle}`} onClose={onClose}>
      <div style={{ maxHeight:"65vh", overflowY:"auto" }}>
        {recs.length === 0 ? (
          <div style={{ textAlign:"center", color:C.dim, padding:"32px 0", fontSize:14 }}>
            아직 녹음이 없습니다
          </div>
        ) : recs.map(rec => (
          <div key={rec.id} style={{ borderRadius:10, border:`1px solid ${C.bdr}`,
            background:C.card, marginBottom:10, overflow:"hidden" }}>
            {/* 헤더 */}
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px" }}>
              <button onClick={() => play(rec)} style={{
                width:36, height:36, borderRadius:"50%", border:"none", cursor:"pointer",
                background: playing===rec.id ? C.red : C.acc,
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
              }}>
                <Icon n={playing===rec.id ? "stop" : "play"} size={14} color="#fff" />
              </button>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.txt }}>{fmtDate(rec.createdAt)}</div>
                <div style={{ fontSize:11, color:C.dim }}>
                  {(() => {
                    const m = rec.recMode || "other";
                    if (m === "vocal") return "🎤 보컬";
                    const inst = INST_MODES.find(i => i.id === m);
                    return inst ? `${inst.emoji} ${inst.label}` : "🎵 악기";
                  })()}
                  {" · "}{fmt(rec.duration || 0)} · {fmtSize(rec.size || 0)} · {rec.pageNum}페이지
                </div>
              </div>
              <button onClick={() => exportRec(rec)} title="파일 앱으로 저장" style={{
                width:32, height:32, borderRadius:8, border:`1px solid ${C.bdr}`,
                background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <Icon n="share" size={14} color={C.dim} />
              </button>
              <button onClick={() => del(rec)} title="삭제" style={{
                width:32, height:32, borderRadius:8, border:`1px solid ${C.red}44`,
                background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <Icon n="trash" size={14} color={C.red} />
              </button>
            </div>
            {/* AI 분석 */}
            <div style={{ borderTop:`1px solid ${C.bdr}`, padding:"8px 12px" }}>
              {rec.aiAnalysis ? (
                <div style={{ fontSize:12, color:C.txt, lineHeight:1.7, whiteSpace:"pre-wrap" }}>
                  {rec.aiAnalysis
                    .replace(/#{1,6}\s*/g, "")
                    .replace(/\*\*(.+?)\*\*/g, "$1")
                    .replace(/\*(.+?)\*/g, "$1")
                    .replace(/^[-•]\s+/gm, "")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim()}
                </div>
              ) : (
                <button onClick={() => analyze(rec)} disabled={analyzing === rec.id} style={{
                  padding:"6px 14px", borderRadius:8, border:`1px solid ${C.pur}55`,
                  background: analyzing===rec.id ? C.bdr : `${C.pur}15`,
                  color: analyzing===rec.id ? C.dim : C.pur,
                  fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                }}>
                  {analyzing===rec.id ? "AI 분석 중..." : "✨ AI 피드백 받기"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   WORSHIP RECORDINGS MODAL (팀 공유 예배 녹음 — 파트별)
══════════════════════════════════════════════════════════════════ */
function extractDriveId(url) {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : null;
}


function WorshipRecordingsModal({ songId, songTitle, user, svc, onClose }) {
  const leader = isLeader(user?.role);
  const myParts = getUserParts(user);
  // 리더/어드민은 전체 파트 접근, 일반 팀원은 "전체" 믹스 + 자기 파트만
  const canSeeAll = leader;
  const [firestoreRecs, setFirestoreRecs] = useState([]);
  const [supaDoc,      setSupaDoc]       = useState(null); // Supabase Storage 세션 문서
  const [refreshKey,   setRefreshKey]    = useState(0);
  const [partFilter,   setPartFilter]    = useState("전체");
  const [expandedId,   setExpandedId]    = useState(null);
  const [showAdd,      setShowAdd]       = useState(false);
  const [partLinks,    setPartLinks]     = useState({});
  const [addTitle,     setAddTitle]      = useState("");
  const [saving,       setSaving]        = useState(false);
  const [saveProgress, setSaveProgress]  = useState("");
  const [confirmDel,   setConfirmDel]    = useState(null); // rec to delete
  const [editingId,    setEditingId]     = useState(null);
  const [editData,     setEditData]      = useState({});
  const [bulkText,     setBulkText]      = useState("");

  const sessionDocId = `${songId}_${svc?.id || "nosvc"}`;

  // Firestore: 구형식 문서만 읽기 (신규는 Supabase Storage)
  useEffect(() => {
    const q = query(collection(db, "worshipRecordings"), where("songId", "==", songId));
    return onSnapshot(q, snap => {
      setFirestoreRecs(snap.docs
        .filter(d => !d.data()._session)
        .map(d => ({ id: d.id, ...d.data() }))
      );
    }, err => console.error("worshipRecordings 읽기 오류:", err));
  }, [songId]);

  // Supabase Storage: 신규 세션 문서 로드
  useEffect(() => {
    loadWorshipRecording(sessionDocId)
      .then(d => setSupaDoc(d || null))
      .catch(() => setSupaDoc(null));
  }, [sessionDocId, refreshKey]);

  // 합산 목록
  const recs = useMemo(() => {
    const supaRecs = [];
    if (supaDoc?.parts) {
      for (const [part, driveId] of Object.entries(supaDoc.parts)) {
        if (driveId) supaRecs.push({
          id: `supa:${sessionDocId}:${part}`, _supabase: true, _docId: sessionDocId,
          part, driveId,
          songId: supaDoc.songId, songTitle: supaDoc.songTitle,
          serviceId: supaDoc.serviceId, serviceTitle: supaDoc.serviceTitle,
          title: supaDoc.title, uploaderName: supaDoc.uploaderName,
          createdAt: supaDoc.updatedAt,
        });
      }
    }
    const all = [...firestoreRecs, ...supaRecs];
    all.sort((a, b) => {
      if (a._supabase && b._supabase) return PARTS.findIndex(p => p.id === a.part) - PARTS.findIndex(p => p.id === b.part);
      const ta = typeof a.createdAt === "string" ? new Date(a.createdAt).getTime() / 1000 : (a.createdAt?.seconds ?? 0);
      const tb = typeof b.createdAt === "string" ? new Date(b.createdAt).getTime() / 1000 : (b.createdAt?.seconds ?? 0);
      return tb - ta;
    });
    return all;
  }, [firestoreRecs, supaDoc, sessionDocId]);

  // 폼 열릴 때 기존 Supabase 링크 불러오기
  useEffect(() => {
    if (!showAdd) return;
    if (supaDoc?.parts) {
      const links = {};
      for (const [part, driveId] of Object.entries(supaDoc.parts)) {
        if (driveId) links[part] = `https://drive.google.com/file/d/${driveId}/view`;
      }
      setPartLinks(links);
      if (supaDoc.title) setAddTitle(supaDoc.title);
    }
  }, [showAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (rec) => {
    setConfirmDel(rec);
  };

  const _doDel = async (rec) => {
    setConfirmDel(null);
    if (expandedId === rec.id) setExpandedId(null);
    try {
      if (rec._supabase) {
        await deleteWorshipRecordingPart(rec._docId, rec.part);
        setRefreshKey(k => k + 1);
      } else if (rec._session) {
        await updateDoc(doc(db, "worshipRecordings", rec._docId), {
          [`parts.${rec.part}`]: deleteField(),
        });
      } else {
        if (rec.storagePath) { try { await deleteObject(storageRef(storage, rec.storagePath)); } catch {} }
        await deleteDoc(doc(db, "worshipRecordings", rec.id));
      }
    } catch (e) { alert("삭제 실패: " + (e.message || e)); }
  };

  const startEdit = (rec) => {
    setEditingId(rec.id);
    setExpandedId(null);
    setEditData({
      title: rec.title || "",
      url:   rec.driveId ? `https://drive.google.com/file/d/${rec.driveId}/view` : "",
      part:  rec.part || "전체",
    });
  };

  const saveEdit = async (rec) => {
    const newDriveId = extractDriveId(editData.url.trim());
    if (editData.url.trim() && !newDriveId) { alert("올바른 Google Drive 링크를 입력하세요."); return; }
    try {
      if (rec._supabase) {
        const current = (await loadWorshipRecording(rec._docId)) || { parts: {} };
        current.parts = current.parts || {};
        if (editData.part !== rec.part) delete current.parts[rec.part];
        current.parts[editData.part] = newDriveId || rec.driveId || null;
        if (editData.title.trim()) current.title = editData.title.trim();
        current.updatedAt = new Date().toISOString();
        await saveWorshipRecording(rec._docId, current);
        setRefreshKey(k => k + 1);
      } else if (rec._session) {
        const updates = { title: editData.title.trim() || null, [`parts.${editData.part}`]: newDriveId || rec.driveId || null };
        if (editData.part !== rec.part) updates[`parts.${rec.part}`] = deleteField();
        await updateDoc(doc(db, "worshipRecordings", rec._docId), updates);
      } else {
        await updateDoc(doc(db, "worshipRecordings", rec.id), {
          title: editData.title.trim() || null,
          driveId: newDriveId || rec.driveId || null,
          part: editData.part,
        });
      }
      setEditingId(null);
    } catch (e) { alert("수정 실패: " + (e.message || e)); }
  };

  // Supabase Storage 저장 (Firestore 쿼터 완전 우회)
  const saveAllLinks = async () => {
    const entries = PARTS
      .map(p => ({ part: p.id, url: (partLinks[p.id] || "").trim() }))
      .filter(e => e.url);
    if (!entries.length) return;
    const invalid = entries.filter(e => !extractDriveId(e.url));
    if (invalid.length) {
      alert(`올바르지 않은 링크:\n${invalid.map(e => e.part).join(", ")}\nGoogle Drive 공유 링크를 붙여넣으세요.`);
      return;
    }
    setSaving(true);
    setSaveProgress("저장 중...");
    try {
      const partsData = {};
      for (const { part, url } of entries) partsData[part] = extractDriveId(url);

      await saveWorshipRecording(sessionDocId, {
        songId:       songId || null,
        songTitle:    songTitle || null,
        serviceId:    svc?.id || null,
        serviceTitle: svc?.title || null,
        serviceDate:  svc?.date || null,
        title:        addTitle.trim() || null,
        uploaderName: user?.name || user?.email || "리더",
        uploaderUid:  user?.uid || null,
        updatedAt:    new Date().toISOString(),
        parts:        partsData,
      });
      if (svc?.id) updateDoc(doc(db, "services", svc.id), { hasRecordings: true }).catch(() => {});

      setPartLinks({}); setAddTitle(""); setShowAdd(false);
      setRefreshKey(k => k + 1);
    } catch (e) {
      alert(`저장 실패\n${e.message || e}`);
      console.error("worshipRecordings 저장 오류:", e);
    } finally {
      setSaving(false); setSaveProgress("");
    }
  };

  const applyBulkLinks = () => {
    const ids = [...bulkText.matchAll(/\/file\/d\/([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
    if (!ids.length) { alert("Drive 링크를 찾을 수 없습니다."); return; }
    const newLinks = {};
    ids.forEach((id, idx) => {
      if (idx < PARTS.length) newLinks[PARTS[idx].id] = `https://drive.google.com/file/d/${id}/view`;
    });
    setPartLinks(prev => ({ ...prev, ...newLinks }));
    setBulkText("");
  };

  const partInfo = (p) => PARTS.find(x => x.id === p) || { emoji: "🎵", label: p || "전체" };
  const fmtDate = (ts) => {
    if (!ts) return "";
    if (ts?.toDate) return ts.toDate().toLocaleDateString("ko-KR", { month:"short", day:"numeric" });
    try { return new Date(ts).toLocaleDateString("ko-KR", { month:"short", day:"numeric" }); }
    catch { return ""; }
  };

  // 보컬 여부 — "밴드" 파트 접근 불가
  const isVocalist = myParts.some(p => VOCALIST_PART_IDS.has(p));

  // 접근 가능한 파트: 리더는 전체, 일반 팀원은 "전체" + 자기 파트들
  const accessibleParts = canSeeAll
    ? PARTS.map(p => p.id)
    : ["전체", ...myParts].filter(Boolean);

  // 이 사용자가 볼 수 있는 녹음만 필터
  const accessibleRecs = recs.filter(r => {
    if (canSeeAll) return true;
    return r.part === "전체" || myParts.includes(r.part);
  });

  // 탭으로 필터
  const filteredRecs = partFilter === "전체"
    ? accessibleRecs
    : accessibleRecs.filter(r => r.part === partFilter);

  // 보여줄 탭 목록
  const visibleTabs = PARTS.filter(p => accessibleParts.includes(p.id));

  return (
    <>
    {confirmDel && (
      <ConfirmModal
        title="녹음 항목 삭제"
        message="이 항목을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다."
        confirmLabel="삭제"
        danger
        onConfirm={() => _doDel(confirmDel)}
        onClose={() => setConfirmDel(null)}
      />
    )}
    <Modal title={`예배 녹음 — ${songTitle}`} onClose={onClose} noBackdrop>
      {/* 파트 탭 — 접근 가능한 파트만 표시 */}
      <div style={{ display:"flex", overflowX:"auto", gap:5, marginBottom:10, paddingBottom:2 }}>
        {visibleTabs.map(p => {
          const count = p.id === "전체"
            ? accessibleRecs.length
            : accessibleRecs.filter(r => r.part === p.id).length;
          const isActive = partFilter === p.id;
          const isMine   = p.id !== "전체" && myParts.includes(p.id);
          return (
            <button key={p.id} onClick={() => setPartFilter(p.id)} style={{
              flexShrink:0, padding:"4px 10px", borderRadius:20,
              background: isActive ? C.pur : (isMine ? `${C.acc}20` : C.card),
              border:`1px solid ${isActive ? C.pur : (isMine ? C.acc+"55" : C.bdr)}`,
              color: isActive ? "#fff" : (isMine ? C.acc : C.dim),
              fontSize:12, fontWeight: isActive || isMine ? 700 : 500, cursor:"pointer",
              fontFamily:"inherit",
            }}>
              {p.emoji} {p.label}{count > 0 ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* 비리더: 접근 범위 안내 */}
      {!canSeeAll && myParts.length > 0 && (
        <div style={{ fontSize:11, color:C.dim, marginBottom:8,
          background:`${C.acc}10`, borderRadius:7, padding:"5px 9px",
          display:"flex", alignItems:"center", gap:5 }}>
          <span>🎵</span>
          <span>
            전체 믹스
            {myParts.map(p => <> · <strong key={p} style={{ color:C.acc }}>{p}</strong></>)}
            {" "}파트 녹음을 들을 수 있습니다
          </span>
        </div>
      )}

      <div style={{ maxHeight:"52vh", overflowY:"auto" }}>
        {filteredRecs.length === 0 ? (
          <div style={{ textAlign:"center", color:C.dim, padding:"28px 0", fontSize:14 }}>
            {partFilter !== "전체" ? `${partFilter} 파트 녹음이 없습니다` : "등록된 녹음이 없습니다"}
          </div>
        ) : filteredRecs.map(rec => {
          const pi = partInfo(rec.part);
          const isMine   = myParts.includes(rec.part);
          const isOpen   = expandedId === rec.id;
          const isEditing = editingId === rec.id;
          const embedSrc = rec.driveId
            ? `https://drive.google.com/file/d/${rec.driveId}/preview`
            : null;
          return (
            <div key={rec.id} style={{
              borderRadius:10, marginBottom:8, overflow:"hidden",
              background: isEditing ? `${C.pur}08` : (isMine ? `${C.acc}09` : C.card),
              border:`1px solid ${isEditing ? C.pur+"55" : (isMine ? C.acc+"44" : C.bdr)}`,
            }}>
              {/* 헤더 행 */}
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px" }}>
                {!isEditing && (
                  <button onClick={() => setExpandedId(isOpen ? null : rec.id)} style={{
                    width:38, height:38, borderRadius:"50%", border:"none", cursor:"pointer", flexShrink:0,
                    background: isOpen ? "#ff6b35" : C.grn,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    <Icon n={isOpen ? "stop" : "play"} size={14} color="#fff" />
                  </button>
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  {!isEditing ? (<>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                      <span style={{
                        fontSize:11, fontWeight:700, padding:"1px 7px", borderRadius:5,
                        background: isMine ? `${C.acc}20` : `${C.pur}15`,
                        color: isMine ? C.acc : C.pur,
                      }}>{pi.emoji} {pi.label}</span>
                      {rec.title && <span style={{ fontSize:12, fontWeight:600, color:C.txt,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{rec.title}</span>}
                      {rec.serviceTitle && !rec.title && (
                        <span style={{ fontSize:10, color:C.dim, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{rec.serviceTitle}</span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:C.dim }}>
                      {rec.uploaderName} · {fmtDate(rec.createdAt)}
                      {rec.driveId ? " · Google Drive" : ""}
                    </div>
                  </>) : (
                    /* ── 인라인 수정 폼 ── */
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {/* 파트 선택 */}
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {PARTS.map(p => (
                          <button key={p.id} onClick={() => setEditData(d => ({ ...d, part: p.id }))}
                            style={{
                              padding:"2px 8px", borderRadius:12, fontSize:11, fontWeight:700,
                              cursor:"pointer", fontFamily:"inherit",
                              background: editData.part === p.id ? C.pur : C.bg,
                              color:      editData.part === p.id ? "#fff" : C.dim,
                              border:`1px solid ${editData.part === p.id ? C.pur : C.bdr}`,
                            }}>
                            {p.emoji} {p.label}
                          </button>
                        ))}
                      </div>
                      {/* 제목 */}
                      <input
                        value={editData.title}
                        onChange={e => setEditData(d => ({ ...d, title: e.target.value }))}
                        placeholder="제목 (선택)"
                        style={{ width:"100%", boxSizing:"border-box", padding:"6px 8px",
                          borderRadius:7, border:`1px solid ${C.bdr}`, background:C.bg,
                          fontSize:12, color:C.txt, fontFamily:"inherit", outline:"none" }}
                      />
                      {/* Drive URL */}
                      <input
                        value={editData.url}
                        onChange={e => setEditData(d => ({ ...d, url: e.target.value }))}
                        placeholder="Google Drive 링크"
                        style={{ width:"100%", boxSizing:"border-box", padding:"6px 8px",
                          borderRadius:7, border:`1px solid ${C.bdr}`, background:C.bg,
                          fontSize:11, color:C.txt, fontFamily:"inherit", outline:"none" }}
                      />
                      {/* 저장/취소 */}
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={() => saveEdit(rec)} style={{
                          flex:1, padding:"7px", borderRadius:8, border:"none",
                          background:C.grn, color:"#fff", fontSize:12, fontWeight:700,
                          cursor:"pointer", fontFamily:"inherit",
                        }}>저장</button>
                        <button onClick={() => setEditingId(null)} style={{
                          padding:"7px 12px", borderRadius:8,
                          border:`1px solid ${C.bdr}`, background:C.card,
                          color:C.dim, fontSize:12, cursor:"pointer", fontFamily:"inherit",
                        }}>취소</button>
                      </div>
                    </div>
                  )}
                </div>
                {leader && !isEditing && (
                  <div style={{ display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>
                    <button onClick={() => startEdit(rec)} style={{
                      background:"none", border:`1px solid ${C.pur}44`, borderRadius:7,
                      cursor:"pointer", padding:"6px 8px",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <Icon n="pencil" size={13} color={C.pur} />
                    </button>
                    <button onClick={() => del(rec)} style={{
                      background:"none", border:`1px solid ${C.red}44`, borderRadius:7,
                      cursor:"pointer", padding:"6px 8px",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <Icon n="trash" size={13} color={C.red} />
                    </button>
                  </div>
                )}
              </div>
              {/* Google Drive 임베드 플레이어 */}
              {isOpen && !isEditing && embedSrc && (
                <div style={{ borderTop:`1px solid ${C.bdr}` }}>
                  <iframe
                    src={embedSrc}
                    width="100%"
                    height="80"
                    allow="autoplay"
                    style={{ display:"block", border:"none" }}
                    title={rec.title || songTitle}
                  />
                </div>
              )}
              {isOpen && !isEditing && !embedSrc && (
                <div style={{ padding:"8px 12px", borderTop:`1px solid ${C.bdr}`,
                  fontSize:12, color:C.dim }}>
                  재생 링크 없음
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 구글 드라이브 일괄 링크 추가 (리더만) */}
      {leader && (
        <div style={{ marginTop:12, borderTop:`1px solid ${C.bdr}`, paddingTop:12 }}>
          {!showAdd ? (
            <button onClick={() => setShowAdd(true)} style={{
              width:"100%", padding:"10px", borderRadius:10,
              border:`1.5px dashed ${C.grn}66`,
              background:`${C.grn}08`, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              fontSize:13, fontWeight:700, color:C.grn, fontFamily:"inherit",
            }}>
              <Icon n="plus" size={16} color={C.grn} />
              Google Drive 링크 일괄 등록
            </button>
          ) : (
            <div style={{ background:C.card, borderRadius:10, padding:12, border:`1px solid ${C.bdr}` }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.txt, marginBottom:4 }}>
                파트별 Google Drive 링크 붙여넣기
              </div>

              {/* ── Google Drive Picker */}
              <button onClick={async () => {
                try {
                  await openDrivePicker((docs) => {
                    const newLinks = {};
                    docs.forEach((doc, idx) => {
                      if (idx < PARTS.length) {
                        newLinks[PARTS[idx].id] = `https://drive.google.com/file/d/${doc.id}/view`;
                      }
                    });
                    setPartLinks(prev => ({ ...prev, ...newLinks }));
                  });
                } catch (e) { alert("Drive 오류: " + (e.message || e)); }
              }} style={{
                width:"100%", padding:"11px", borderRadius:10, marginBottom:12,
                background:"#1a73e8", border:"none", color:"#fff",
                fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
                <svg width="18" height="18" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                  <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                  <path d="m43.65 25 13.75-23.8c-1.35-.8-2.95-1.2-4.5-1.2h-18.5c-1.55 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                  <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.95 1.2 4.5 1.2h50.8c1.55 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                  <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                </svg>
                Google Drive에서 파일 선택
              </button>

              {/* ── 빠른 일괄 붙여넣기 */}
              <div style={{ background:`${C.acc}10`, borderRadius:8, padding:10,
                border:`1px solid ${C.acc}33`, marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.acc, marginBottom:4 }}>
                  ⚡ 한꺼번에 붙여넣기
                </div>
                <div style={{ fontSize:10, color:C.dim, marginBottom:6, lineHeight:1.6 }}>
                  Drive 링크 여러 개를 한꺼번에 붙여넣으면 아래 순서로 자동 배분됩니다:<br/>
                  {PARTS.map(p => p.label).join(" → ")}
                </div>
                <textarea
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                  placeholder={"링크 1 (전체)\n링크 2 (밴드)\n링크 3 (리드 보컬)\n..."}
                  rows={3}
                  style={{ width:"100%", boxSizing:"border-box", resize:"vertical",
                    padding:"7px 9px", borderRadius:7, border:`1px solid ${C.bdr}`,
                    background:C.bg, color:C.txt, fontSize:12,
                    fontFamily:"inherit", outline:"none", marginBottom:6 }}
                />
                <button onClick={applyBulkLinks} style={{
                  width:"100%", padding:"7px", borderRadius:8,
                  background:C.acc, border:"none", color:"#fff",
                  fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                }}>
                  자동 배분
                </button>
              </div>

              <div style={{ fontSize:11, color:C.dim, marginBottom:10 }}>
                또는 파트별로 직접 입력하세요. 없는 파트는 비워두세요.
              </div>
              <input
                placeholder="제목 (선택) — 예: 6월 7일 주일예배"
                value={addTitle}
                onChange={e => setAddTitle(e.target.value)}
                style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8,
                  border:`1px solid ${C.bdr}`, background:C.bg, fontSize:12, color:C.txt,
                  fontFamily:"inherit", outline:"none", marginBottom:10 }}
              />
              {PARTS.map(p => {
                const val = partLinks[p.id] || "";
                const ok  = val.trim() && !!extractDriveId(val.trim());
                const err = val.trim() && !ok;
                return (
                  <div key={p.id} style={{ marginBottom:7 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:3 }}>
                      {p.emoji} {p.label}
                    </div>
                    <input
                      placeholder="https://drive.google.com/file/d/..."
                      value={val}
                      onChange={e => setPartLinks(prev => ({ ...prev, [p.id]: e.target.value }))}
                      style={{
                        width:"100%", boxSizing:"border-box", padding:"7px 10px", borderRadius:8,
                        border:`1px solid ${ok ? C.grn+"88" : err ? C.red+"88" : C.bdr}`,
                        background: ok ? `${C.grn}06` : C.bg,
                        fontSize:12, color:C.txt, fontFamily:"inherit", outline:"none",
                      }}
                    />
                  </div>
                );
              })}
              {(() => {
                const filled = PARTS.filter(p => (partLinks[p.id] || "").trim()).length;
                return (
                  <div style={{ fontSize:11, color:C.dim, marginTop:8, marginBottom:10 }}>
                    {filled > 0 ? `${filled}개 파트 입력됨` : "링크를 하나 이상 입력하세요"}
                  </div>
                );
              })()}
              <div style={{ display:"flex", gap:8 }}>
                <button
                  onClick={saveAllLinks}
                  disabled={saving || !PARTS.some(p => (partLinks[p.id] || "").trim())}
                  style={{
                    flex:1, padding:"10px", borderRadius:9, border:"none",
                    background: saving || !PARTS.some(p => (partLinks[p.id] || "").trim()) ? C.bdr : C.grn,
                    color:"#fff", fontSize:13, fontWeight:700,
                    cursor: saving || !PARTS.some(p => (partLinks[p.id] || "").trim()) ? "default" : "pointer",
                    fontFamily:"inherit",
                  }}>
                  {saving ? (saveProgress || "저장 중...") : "전체 저장"}
                </button>
                <button onClick={() => { setShowAdd(false); setPartLinks({}); setAddTitle(""); }} style={{
                  padding:"10px 14px", borderRadius:9, border:`1px solid ${C.bdr}`,
                  background:"transparent", color:C.dim, fontSize:13, cursor:"pointer", fontFamily:"inherit",
                }}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
    </>
  );
}

/* 손글씨 패드 — 쓰는 동안 잉크 그대로 유지, 「변환」 버튼을 눌러야만 Gemini가 활자로 변환 */
function HandwritePad({ accent, apiKey, onText }) {
  const wrapRef    = useRef(null);
  const cvsRef     = useRef(null);
  const strokesRef = useRef([]);   // 획 목록 (CSS px 좌표)
  const curRef     = useRef(null); // 그리는 중인 획
  const [hasInk,        setHasInk]        = useState(false);
  const [busy,          setBusy]          = useState(false);
  const [err,           setErr]           = useState("");
  const [clearConfirm,  setClearConfirm]  = useState(false);

  useEffect(() => {
    const cvs = cvsRef.current, wrap = wrapRef.current;
    if (!cvs || !wrap) return;
    // 모달 레이아웃이 끝난 다음 프레임에 크기 측정 (너비 0 방지)
    const raf = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth || 320, h = 160;
      cvs.width = w * dpr; cvs.height = h * dpr;
      cvs.style.width = w + "px"; cvs.style.height = h + "px";
      const c = cvs.getContext("2d");
      c.scale(dpr, dpr);
      c.lineWidth = 2.5; c.lineCap = "round"; c.lineJoin = "round";
      c.strokeStyle = "#1a1a1a";
    });
    // 사파리가 펜 입력을 스크롤로 오인해 획을 끊는 것 방지 — non-passive로 차단
    const block = ev => ev.preventDefault();
    cvs.addEventListener("touchstart", block, { passive:false });
    cvs.addEventListener("touchmove",  block, { passive:false });
    return () => {
      cancelAnimationFrame(raf);
      cvs.removeEventListener("touchstart", block);
      cvs.removeEventListener("touchmove",  block);
    };
  }, []);

  const ctx = () => cvsRef.current.getContext("2d");
  const pos = e => {
    const r = cvsRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // 중간점 기반 곡선으로 한 획 그리기 — 부드러운 손글씨 라인
  const drawStroke = (c, pts) => {
    if (pts.length < 2) return;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2, my = (pts[i].y + pts[i+1].y) / 2;
      c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    c.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    c.stroke();
  };

  const down = e => {
    e.preventDefault();
    e.stopPropagation(); // 아래 악보 화면의 탭/스와이프 핸들러로 전파 차단
    // 손가락·손바닥 터치는 완전 무시 — 펜슬(또는 마우스)로만 필기
    if (e.pointerType === "touch") return;
    cvsRef.current.setPointerCapture?.(e.pointerId);
    curRef.current = [pos(e)];
  };
  const move = e => {
    e.stopPropagation();
    if (!curRef.current) return;
    if (e.pointerType === "touch") return;
    const pts = curRef.current;
    // 펜슬 240Hz 샘플 모두 수집 (코어레스드 이벤트) — 획이 각지거나 빠지는 것 방지
    const evs = e.getCoalescedEvents?.() || [e];
    evs.forEach(ev => pts.push(pos(ev)));
    // 마지막 몇 점만 다시 그려 실시간 미리보기
    const c = ctx();
    const tail = pts.slice(-Math.min(pts.length, evs.length + 2));
    c.beginPath();
    c.moveTo(tail[0].x, tail[0].y);
    tail.slice(1).forEach(p => c.lineTo(p.x, p.y));
    c.stroke();
  };
  const up = e => {
    e?.stopPropagation?.();
    if (!curRef.current) return;
    if (e && e.pointerType === "touch") return;
    if (curRef.current.length > 1) {
      strokesRef.current.push(curRef.current);
      setHasInk(true);
    }
    curRef.current = null;
    redraw(); // 곡선 보정으로 최종 렌더
  };

  const redraw = () => {
    const cvs = cvsRef.current, c = ctx();
    c.clearRect(0, 0, cvs.width, cvs.height);
    strokesRef.current.forEach(pts => drawStroke(c, pts));
  };
  const undo  = () => { strokesRef.current.pop(); redraw(); setHasInk(strokesRef.current.length > 0); };
  const clear = () => { strokesRef.current = []; redraw(); setHasInk(false); };

  const convert = async () => {
    if (!strokesRef.current.length || busy) return;
    if (!apiKey) { setErr("AI 키가 없습니다. 프로필 → AI 분석 키를 설정해 주세요."); return; }
    setBusy(true); setErr("");
    try {
      const cvs = cvsRef.current;
      const out = document.createElement("canvas");
      out.width = cvs.width; out.height = cvs.height;
      const oc = out.getContext("2d");
      oc.fillStyle = "#ffffff"; oc.fillRect(0, 0, out.width, out.height);
      oc.drawImage(cvs, 0, 0);
      const b64 = out.toDataURL("image/png").split(",")[1];
      const body = JSON.stringify({
        contents:[{ parts:[
          { inlineData:{ mimeType:"image/png", data:b64 } },
          { text:"이미지의 손글씨를 텍스트로 변환하세요. 한국어·영어가 섞여 있을 수 있습니다. 변환된 텍스트만 출력하고 설명이나 따옴표는 붙이지 마세요." },
        ]}],
        generationConfig:{ temperature:0, maxOutputTokens:512 },
      });
      // 혼잡(503)·쿼터(429) 시 다른 모델로 자동 전환 — 모델마다 서버 용량이 분리됨
      const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
      let text = "", lastMsg = "";
      for (const m of MODELS) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
            { method:"POST", headers:{ "content-type":"application/json" }, body }
          );
          const d = await res.json();
          if (d.error) {
            lastMsg = d.error.message || "Gemini 오류";
            const retryable = d.error.code === 503 || d.error.code === 429 ||
              /high demand|overload|exhausted|unavailable/i.test(lastMsg);
            if (retryable) continue; // 다음 모델로
            throw new Error(lastMsg);
          }
          text = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
          if (text) break;
          lastMsg = "글씨를 인식하지 못했어요.";
        } catch (e) {
          if (e instanceof TypeError) { lastMsg = "네트워크 오류"; continue; }
          throw e;
        }
      }
      if (!text) throw new Error(
        /high demand|overload|exhausted|unavailable|503|429/i.test(lastMsg)
          ? "AI 서버가 지금 혼잡해요. 글씨는 그대로 남아 있으니 잠시 후 「⬆ 변환」을 다시 눌러 주세요."
          : lastMsg || "변환 실패 — 다시 시도해 주세요."
      );
      onText(text);
      clear();
    } catch (e) {
      setErr(e.message); // 실패해도 잉크는 그대로 남아 있어 재시도 가능
    }
    setBusy(false);
  };

  const btnStyle = on => ({
    flex:1, padding:"9px 0", borderRadius:10, cursor: on ? "pointer" : "not-allowed",
    background:C.card, border:`1px solid ${C.bdr}`,
    fontFamily:"inherit", fontSize:13, fontWeight:700,
    color: on ? C.txt : C.dim, opacity: on ? 1 : 0.4,
  });

  return (
    <div ref={wrapRef} style={{ marginTop:8 }}>
      <canvas ref={cvsRef}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ width:"100%", height:160, display:"block", touchAction:"none",
          WebkitUserSelect:"none", userSelect:"none", WebkitTouchCallout:"none",
          background:`${accent}08`, border:`1.5px solid ${accent}44`, borderRadius:10 }} />
      {/* 메시지 줄 — 높이 고정: 내용이 바뀌어도 레이아웃이 절대 안 움직임 */}
      <div style={{ height:18, lineHeight:"18px", fontSize:11, textAlign:"center", marginTop:4,
        color: err ? C.red : C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {busy ? "변환 중..." : err ? err : "펜으로 쓰세요 — 다 쓴 후 「⬆ 변환」"}
      </div>
      {/* 버튼 1줄: 변환 */}
      <div style={{ display:"flex", gap:6, marginTop:8 }}>
        <button onClick={convert}
          style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:"pointer",
            background:accent, border:`1px solid ${accent}`,
            fontFamily:"inherit", fontSize:13, fontWeight:800, color:"#fff" }}>
          {busy ? "변환 중..." : "⬆ 변환"}
        </button>
      </div>
      {/* 버튼 2줄: 한 획 취소 + 지우기(확인) */}
      <div style={{ display:"flex", gap:6, marginTop:6 }}>
        <button onClick={() => { undo(); setClearConfirm(false); }} style={btnStyle(true)}>↶ 한 획 취소</button>
        {clearConfirm ? (
          <button
            onClick={() => { clear(); setClearConfirm(false); }}
            style={{ ...btnStyle(true), background:`${C.red}18`, border:`1px solid ${C.red}55`, color:C.red }}>
            정말 지우기?
          </button>
        ) : (
          <button onClick={() => setClearConfirm(true)} style={btnStyle(true)}>✕ 지우기</button>
        )}
      </div>
    </div>
  );
}

function PDFViewerScreen({ user, songs, services, annotations, teamAnnotations, onAddAnnotation, onDeleteAnnotation, nav, selectedSongId, selectedSvcId, selectedSvcSongIdx, backTo, pdfjsReady, sharedGeminiKey, songCues, sendCue, deleteCue, editCue, sheetLinkEnabled, sheetSyncTrigger }) {
  const song = songs.find(s => s.id === selectedSongId);
  const isLibraryMode = backTo === "library"; // 라이브러리에서 열린 경우: 예배 컨텍스트 없음
  const isLiteMode    = backTo === "lite";    // Lite 뷰어: 메뉴 없음, 전체화면 악보만

  // selectedSvcId 없을 때 가장 가까운 서비스로 폴백 (팀채팅용)
  const effectiveSvcId = (() => {
    if (selectedSvcId) return selectedSvcId;
    if (isLibraryMode) return null;
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const sorted = (services || []).filter(s => s?.date).sort((a, b) => a.date.localeCompare(b.date));
      return (sorted.find(s => s.date >= today) ?? sorted[sorted.length - 1])?.id ?? null;
    } catch { return null; }
  })();

  // ── 예배 곡 순서
  const svc      = (!isLibraryMode && selectedSvcId) ? services.find(s => s.id === selectedSvcId) : null;
  // 유효 곡만 포함 — 삭제된 ID 제외, 중복 ID(복사) 허용
  const svcSongs = svc
    ? (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean)
    : [];
  // filter(Boolean) shifts indices — track which raw svc.songIds indices survived
  const rawSvcIdxs = svc
    ? (svc.songIds || []).reduce((acc, id, ri) => {
        if (songs.find(s => s.id === id)) acc.push(ri);
        return acc;
      }, [])
    : [];
  // 전달된 인덱스 우선(복사 곡 정확한 위치), 없으면 findIndex fallback
  const songIdx  = (selectedSvcSongIdx >= 0 && selectedSvcSongIdx < svcSongs.length)
    ? selectedSvcSongIdx
    : svcSongs.findIndex(s => s?.id === selectedSongId);
  const goToSong = (idx) => {
    if (idx < 0 || idx >= svcSongs.length || !svcSongs[idx]) return;
    nav("pdfViewer", { songId: svcSongs[idx].id, svcSongIdx: idx, backTo });
  };

  // 파트 레이블 (결단·Closing만 표시)
  const PART_LABEL_COLORS = { "결단": "#e07a60", "Closing": "#34c759" };
  const curSongPart = svc?.partsEnabled && songIdx >= 0 ? (svc.songPartIds?.[rawSvcIdxs[songIdx] ?? songIdx] || null) : null;

  // ── PDF.js refs / state
  const canvas1Ref   = useRef(null);
  const canvas2Ref   = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef    = useRef(null);
  const imageRef     = useRef(null);  // 이미지 악보용
  const [numPages, setNumPages] = useState(0);
  const [pageNum,  setPageNum]  = useState(() => {
    const saved = parseInt(localStorage.getItem("tvpc_pageNum") || "0");
    const savedSong = localStorage.getItem("tvpc_selSongId");
    return (saved > 0 && savedSong === selectedSongId) ? saved : 1;
  });
  const [zoomMul,  setZoomMul]  = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panIntervalRef = useRef(null);
  const [loadErr,  setLoadErr]  = useState("");
  // pageNum 변경 시 localStorage 저장 (새로고침 복원용)
  useEffect(() => { try { localStorage.setItem("tvpc_pageNum", pageNum); } catch {} }, [pageNum]);
  const [cSize,    setCSize]    = useState({ w: 0, h: 0 });
  const [dualIdx,  setDualIdx]  = useState(Math.max(0, songIdx));
  const dualLeftPart  = svc?.partsEnabled ? (svc.songPartIds?.[rawSvcIdxs[dualIdx]     ?? dualIdx]       || null) : null;
  const dualRightPart = svc?.partsEnabled ? (svc.songPartIds?.[rawSvcIdxs[dualIdx + 1] ?? (dualIdx + 1)] || null) : null;
  const dualPdf1Ref = useRef(null);  // dual left song PDF doc
  const dualPdf2Ref = useRef(null);  // dual right song PDF doc
  const dualImg1Ref = useRef(null);  // dual left song image
  const dualImg2Ref = useRef(null);  // dual right song image
  const [dualKey,  setDualKey]  = useState(0); // bumped once when both PDFs are ready
  const preBitmapRef  = useRef({}); // songId → pre-rendered HTMLCanvasElement
  const preRenderBusy = useRef(new Set());
  const [dualToast, setDualToast] = useState("");
  const touchStartX    = useRef(null);
  const touchStartY    = useRef(null);
  const touchStartTime = useRef(null);
  const touchFired     = useRef(false);
  const pinchStartDist = useRef(null);
  const pinchStartZoom = useRef(1.0);
  const lastTapTime    = useRef(0);
  const toastTimer  = useRef(null);
  const penDownRef  = useRef(false); // 애플펜슬 터치 중 여부
  const dualFitModeRef   = useRef(false); // 듀얼 FIT 모드: 페이지 이동마다 자동 재적용
  const needsFitRef      = useRef(false); // 다음 렌더 후 FIT 실행 예약 (듀얼)
  const [tapNav,   setTapNav]   = useState(() => localStorage.getItem("tvpc_tapNav")   !== "0");
  const [swipeNav, setSwipeNav] = useState(() => localStorage.getItem("tvpc_swipeNav") !== "0");
  const singleFitModeRef = useRef(false); // 싱글 FIT 모드: 페이지 이동마다 자동 재적용
  const singleNeedsFitRef = useRef(false); // 다음 렌더 후 FIT 실행 예약 (싱글)

  // ── UI
  const [fitActive,     setFitActive]     = useState(false);
  const [dual,          setDual]          = useState(false);
  const [media,         setMedia]         = useState(false);
  const [ytRange,       setYtRange]       = useState({ start:"", end:"" }); // MM:SS
  const ytIframeRef = useRef(null);
  const [showChat,      setShowChat]      = useState(false);
  const [chatInput,     setChatInput]     = useState("");
  const [chatMsgs,      setChatMsgs]      = useState([]);
  const [chatToastKb,   setChatToastKb]   = useState(null); // { name, text }
  const chatToastKbTimer = useRef(null);
  const chatMsgsPrevRef  = useRef([]);
  const [chatLastSeen,  setChatLastSeen]  = useState(() => {
    try { return Number(localStorage.getItem("tvpc_chat_last_seen")) || 0; } catch { return 0; }
  });
  const [chatEditMode,  setChatEditMode]  = useState(false);
  const [chatPresets,   setChatPresets]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("tvpc_chat_presets") || "null") || ["볼륨 올려주세요","볼륨 낮춰주세요","준비됐습니다","잠깐요","확인했습니다"]; }
    catch { return ["볼륨 올려주세요","볼륨 낮춰주세요","준비됐습니다","잠깐요","확인했습니다"]; }
  });
  const [presetInput,   setPresetInput]   = useState("");
  const chatEndRef = useRef(null);
  const savePresets = (list) => { setChatPresets(list); try { localStorage.setItem("tvpc_chat_presets", JSON.stringify(list)); } catch {} };
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteInput,     setNoteInput]     = useState(false);
  const [noteShared,    setNoteShared]    = useState(false); // 팀 메모 여부
  const [showCueInput,  setShowCueInput]  = useState(false);
  const [cueTxt,        setCueTxt]        = useState("");
  const [cueScr,        setCueScr]        = useState("");
  const [cueSection,    setCueSection]    = useState("전체");
  const [cueEditId,     setCueEditId]     = useState(null);
  const [cueEditTxt,    setCueEditTxt]    = useState("");
  const [showPanicMenu, setShowPanicMenu] = useState(false);
  const [panicSent,     setPanicSent]     = useState(null); // 전송된 옵션 라벨
  const [noteTxt,       setNoteTxt]       = useState("");
  const [noteScr,       setNoteScr]       = useState("");
  const [noteInk,       setNoteInk]       = useState(true);  // true=손글씨 캔버스, false=타입
  const [cueInk,        setCueInk]        = useState(true);
  const [noteSongId,    setNoteSongId]    = useState(null); // dual 모드에서 노트 저장 대상 악보
  const [saving,        setSaving]        = useState(false);

  // ── Recording
  const [recording,    setRecording]    = useState(false);
  const [recSeconds,   setRecSeconds]   = useState(0);
  const [showRecModal, setShowRecModal] = useState(false);
  const [recCount,     setRecCount]     = useState(0);
  const [recMode,      setRecMode]      = useState(() => localStorage.getItem("tvpc_recMode") || "other"); // "vocal"|"piano"|"guitar"|"drum"|"bass"|"other"
  const [showInstPicker, setShowInstPicker] = useState(false);
  const recModeRef   = useRef(localStorage.getItem("tvpc_recMode") || "other");
  const mediaRecRef  = useRef(null);
  const recTimerRef  = useRef(null);
  const recChunksRef = useRef([]);
  const recSecondsRef = useRef(0);

  // ── 예배 연습 녹음 미니 플레이어 (서비스 레벨 practiceUrl)
  const [showWorshipPlayer,  setShowWorshipPlayer]  = useState(false);
  const [svcPracticeUrl,     setSvcPracticeUrl]     = useState(null);

  // ── Drawing / handwriting
  const [drawMode,  setDrawMode]  = useState(false);
  const [drawColor, setDrawColor] = useState("#e8383b");
  const [drawWidth, setDrawWidth] = useState(1);
  const [drawTool,  setDrawTool]  = useState("pen"); // "pen" | "highlighter" | "eraser" | "stamp"
  const [drawSaveErr, setDrawSaveErr] = useState("");

  // ── Text tool
  const [textInput, setTextInput] = useState(null); // { x, y, value, canvasNum }
  const [textDot,   setTextDot]   = useState(null); // { sx, sy } 화면 좌표 — 임시 인디케이터

  const [selAnnot,   setSelAnnot]   = useState(null); // { idx, canvasNum }
  const selAnnotRef  = useRef(null);
  const selDragRef   = useRef(null);
  const [stampPanel, setStampPanel] = useState(null); // { x, y } screen coords of selected stamp

  // ── 레이저 포인터 (리더 전용)
  const [pointerOn,          setPointerOn]          = useState(false);
  const [showPointerPanel,   setShowPointerPanel]   = useState(false);
  const [pointerParts,       setPointerParts]       = useState([]);
  const pointerCanvas1Ref    = useRef(null);
  const pointerCanvas2Ref    = useRef(null);
  const pointerStrokesRef    = useRef([]);   // 완성된 획들
  const pointerLiveRef       = useRef(null); // 그리는 중인 획
  const pointerDownRef       = useRef(false);
  const pointerCurPtsRef     = useRef([]);
  const pointerClearTimerRef = useRef(null);
  const pointerWriteTimerRef = useRef(null);
  const pointerPrevSheetLink  = useRef(false); // 포인터 켜기 전 sheetLink 상태 저장
  const pointerActiveSideRef  = useRef(1);     // 현재 그리는 쪽: 1=왼쪽, 2=오른쪽
  const pointerActiveSongRef  = useRef(null);  // 현재 그리는 쪽의 songId (interval 클로저용)

  // ── Stamp + loupe
  const [stampSymbol, setStampSymbol] = useState("f");
  const [stampItalic, setStampItalic] = useState(true);
  const [stampSize,        setStampSize]        = useState(6); // 3–40
  const [stampBg,          setStampBg]          = useState(false); // 흰 배경 여부
  const [showStampPalette, setShowStampPalette] = useState(false);
  const [loupePos, setLoupePos] = useState(null); // { x, y } viewport coords
  const loupeCanvasRef = useRef(null);
  const lastPt1Ref = useRef({ x: 0.5, y: 0.5 });
  const lastPt2Ref = useRef({ x: 0.5, y: 0.5 });

  // ── Shape tool (slur, hairpin, line)
  const [shapeTool, setShapeTool] = useState("slur");
  const shapeStart1Ref = useRef(null);
  const shapeStart2Ref = useRef(null);

  // ── Chord transposition
  const tmKey = user?.uid && selectedSongId ? `tvpc_tm_${user.uid}_${selectedSongId}` : null;
  const [transposeMode,  setTransposeMode]  = useState(false);
  const [chordMoveMode,  setChordMoveMode]  = useState(false); // 리더 전용: 코드 이동 모드
  const [transposeSteps,  setTransposeSteps]  = useState(0);  // single / dual left
  const [transposeSteps2, setTransposeSteps2] = useState(0);  // dual right
  const [capoFret,        setCapoFret]        = useState(0);  // 0=없음, 1~7 (기타/일렉기타만) — 싱글/듀얼 왼쪽
  const [capoFret2,       setCapoFret2]       = useState(0);  // 듀얼 오른쪽 전용
  const [showChordDict,   setShowChordDict]   = useState(""); // "" | "left" | "right"
  const [chordData,      setChordData]      = useState([]);   // [{chord,x,y}] — single / dual left
  const [chordData2,     setChordData2]     = useState([]);   // dual right
  const [chordFontScale, setChordFontScale] = useState(1.0);  // 0.4–2.0
  const [detectingChords, setDetectingChords] = useState(false);
  const [detectErr,      setDetectErr]      = useState("");
  const [dragChord,      setDragChord]      = useState(null); // {side,idx,pointerId}
  const [deletingChord,  setDeletingChord]  = useState(null); // {side,idx} long-press pending
  const [chordPickRoot,  setChordPickRoot]  = useState(""); // 스탬프 코드 피커: 선택된 루트음
  const longPressTimer   = useRef(null);
  const longPressOrigin  = useRef(null); // {x,y} to detect move
  const pointerDownTimeRef = useRef(0);

  // 코드 사전: 현재 곡의 코드 목록 (effectiveSteps 적용)
  const songChords = useMemo(() => {
    const effectiveSteps = transposeSteps - capoFret;
    const allChords = [
      ...chordData.map(d => d.chord),
      ...chordData2.map(d => d.chord),
    ];
    const seen = new Set();
    return allChords
      .map(c => transposeChord(c, effectiveSteps, useFlats(song?.key, effectiveSteps)))
      .filter(name => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map(name => ({ name, voicings: getVoicings(name) }));
  }, [chordData, chordData2, transposeSteps, capoFret, song?.key]);
  const didDragRef         = useRef(false);
  const chordDragCancelledRef = useRef(false); // swipe 감지 시 chord drag 즉시 취소용
  const lastTapRef         = useRef({ side: null, idx: null, time: 0 });
  const chordOverlay1Ref = useRef(null);
  const chordOverlay2Ref = useRef(null);
  const drawCanvas1Ref  = useRef(null);  // single mode + dual left
  const drawCanvas2Ref  = useRef(null);  // dual right
  const isDrawing1Ref   = useRef(false);
  const isDrawing2Ref   = useRef(false);
  const strokes1Ref     = useRef([]);
  const strokes2Ref     = useRef([]);
  const curStroke1Ref   = useRef(null);
  const curStroke2Ref   = useRef(null);
  const lastSideRef     = useRef(1);     // last drawn side for undo
  const drawModeRef     = useRef(false);
  const preClearRef1    = useRef(null);  // snapshot before 필기 삭제 (side 1)
  const preClearRef2    = useRef(null);  // snapshot before 필기 삭제 (side 2)
  const [clearConfirm,  setClearConfirm]  = useState(false); // 필기 삭제 확인 다이얼로그
  // ── Team drawing
  const teamDrawCanvas1Ref = useRef(null);
  const teamDrawCanvas2Ref = useRef(null);
  const teamStrokes1Ref    = useRef([]);
  const teamStrokes2Ref    = useRef([]);
  const preClearTeamRef1   = useRef(null);
  const preClearTeamRef2   = useRef(null);
  const [teamDrawMode, setTeamDrawMode] = useState(false);
  const [hasTeamStrokes, setHasTeamStrokes] = useState(false);
  const stampPressed1Ref   = useRef(false); // Apple Pencil hover guard
  const stampPressed2Ref   = useRef(false);

  // myNotes / teamNotes / effectiveNoteSongId computed after dualLeftSongId (see below)
  const leader    = isLeader(user.role);
  const worshipStarted = (() => {
    const svc = services?.find(s => s.id === selectedSvcId);
    if (!svc?.time?.includes(":") || !svc?.date) return false;
    const [h, m] = svc.time.split(":").map(Number);
    const dt = new Date(svc.date + "T00:00:00");
    dt.setHours(h, m, 0, 0);
    return Date.now() >= dt.getTime();
  })();

  // sheetSync 신호 도착 시 1페이지로 이동
  // 태블릿 가로모드 감지 시 자동 듀얼 ON
  useEffect(() => {
    if (isFoh(user) || sheetSyncTrigger === 0) return;
    const landscape  = window.matchMedia("(orientation: landscape)").matches;
    const wideScreen = Math.min(window.screen.width, window.screen.height) >= 768;
    const autoDual   = landscape && wideScreen;
    if (autoDual && !dual) setDual(true);
    if (dual || autoDual) setDualIdx(selectedSvcSongIdx);
    setPageNum(1);
    setPanOffset({ x: 0, y: 0 });
    setZoomMul(1.0);
  }, [sheetSyncTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // 결단 자동 전환 — 외부(App)에서 selectedSvcSongIdx가 바뀌면 듀얼 모드도 갱신
  const prevExternalSvcSongIdxRef = useRef(selectedSvcSongIdx);
  useEffect(() => {
    const prev = prevExternalSvcSongIdxRef.current;
    prevExternalSvcSongIdxRef.current = selectedSvcSongIdx;
    if (!dual || selectedSvcSongIdx < 0 || selectedSvcSongIdx === prev) return;
    setDualIdx(selectedSvcSongIdx);
    setPageNum(1);
    setPanOffset({ x: 0, y: 0 });
  }, [selectedSvcSongIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 화면 자동 잠금 방지 (Wake Lock) — PDF 뷰어 열린 동안 유지
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel = null;
    const acquire = async () => {
      try { sentinel = await navigator.wakeLock.request("screen"); } catch {}
    };
    acquire();
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
    };
  }, []);

  // ── 블루투스 리모컨 / 키보드 페이지 넘김
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        if (dual) setDualIdx(p => Math.min(p + 1, svcSongs.length - 2));
        else setPageNum(p => Math.min(p + 1, numPages || p + 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        if (dual) setDualIdx(p => Math.max(p - 1, 0));
        else setPageNum(p => Math.max(p - 1, 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dual, numPages, svcSongs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 악보 Sync 배너 ──
  const [syncBanner,    setSyncBanner]    = useState(false);
  const [syncOffBanner, setSyncOffBanner] = useState(false);
  const syncBannerTimer    = useRef(null);
  const syncOffBannerTimer = useRef(null);
  const prevSheetLinkRef = useRef(false);
  useEffect(() => {
    if (sheetLinkEnabled && !prevSheetLinkRef.current) {
      setSyncBanner(true);
      clearTimeout(syncBannerTimer.current);
      syncBannerTimer.current = setTimeout(() => setSyncBanner(false), 3000);
    }
    if (!sheetLinkEnabled && prevSheetLinkRef.current) {
      setSyncOffBanner(true);
      clearTimeout(syncOffBannerTimer.current);
      syncOffBannerTimer.current = setTimeout(() => setSyncOffBanner(false), 3000);
    }
    prevSheetLinkRef.current = sheetLinkEnabled;
  }, [sheetLinkEnabled]);

  // ── 메트로놈 상태 ──
  const [metroOn,        setMetroOn]        = useState(false);
  const [metroMuted,     setMetroMuted]     = useState(false);
  const [showMetroPanel,  setShowMetroPanel]  = useState(false);
  const [activeGroup,     setActiveGroup]     = useState(null); // 그룹 드롭다운
  const [showMobileHelp,  setShowMobileHelp]  = useState(false);
  const [showImprov,      setShowImprov]      = useState(false); // 즉흥 코드 생성기
  const [metroBeat,      setMetroBeat]      = useState(0);
  const [metroBpmEdit,   setMetroBpmEdit]   = useState(null);
  const [metroMsg,       setMetroMsg]       = useState("");
  const metroMsgTimer  = useRef(null);
  const metroCtxRef    = useRef(null);
  const metroTimerRef  = useRef(null);
  const metroBpmRef    = useRef(80);
  const prevTeamMetroOn = useRef(undefined);

  const showMetroMsg = (msg, ms = 3000) => {
    setMetroMsg(msg);
    clearTimeout(metroMsgTimer.current);
    metroMsgTimer.current = setTimeout(() => setMetroMsg(""), ms);
  };

  const startMetronome = (bpm) => {
    clearTimeout(metroTimerRef.current);
    try {
      if (!metroCtxRef.current || metroCtxRef.current.state === "closed") {
        metroCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = metroCtxRef.current;
      ctx.resume();
      // iOS silent buffer unlock
      const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const silentSrc = ctx.createBufferSource();
      silentSrc.buffer = silentBuf; silentSrc.connect(ctx.destination); silentSrc.start(0);
      let beat = 0;
      const interval = 60000 / bpm;
      setMetroBeat(0);
      const tick = () => {
        const isAccent = beat % 4 === 0;
        try {
          const osc = ctx.createOscillator(); const g = ctx.createGain();
          osc.connect(g); g.connect(ctx.destination);
          osc.frequency.value = isAccent ? 1500 : 1000;
          g.gain.setValueAtTime(isAccent ? 0.6 : 0.35, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
          osc.start(); osc.stop(ctx.currentTime + 0.07);
        } catch(e) {}
        setMetroBeat(beat); beat++;
        metroTimerRef.current = setTimeout(tick, interval);
      };
      tick();
    } catch(e) { console.error("metro:", e); }
  };

  const stopMetronome = () => clearTimeout(metroTimerRef.current);

  // 팀 메트로놈 Firestore 동기화
  const teamMetroOn = !leader && svc?.teamMetro?.on;

  useEffect(() => {
    if (leader) return;
    const tm = svc?.teamMetro;
    const prev = prevTeamMetroOn.current;
    prevTeamMetroOn.current = tm?.on;
    if (tm?.on) {
      setMetroOn(false);
      setMetroMuted(false);
      setShowMetroPanel(true);
      showMetroMsg(`🎼 팀 메트로놈 시작 — ${tm.bpm || 80} BPM\n탭하여 시작하세요`);
    } else if (tm?.on === false) {
      stopMetronome();
      setMetroOn(false);
      setShowMetroPanel(false);
      // 이전에 켜져 있었을 때만 종료 메시지 표시 (초기 마운트 시 방지)
      if (prev === true) showMetroMsg("🎼 팀 메트로놈 종료", 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.teamMetro?.on, leader]);

  useEffect(() => {
    const newBpm = svc?.teamMetro?.bpm;
    if (!newBpm || !svc?.teamMetro?.on) return;
    if (metroOn && !metroMuted) startMetronome(newBpm);
    setMetroBpmEdit(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.teamMetro?.bpm]);

  // ── 포인터 헬퍼
  const pointerWriteStrokes = (strokes, live = null) => {
    if (!svc?.id) return;
    const payload = {
      "teamPointer.strokes": strokes,
      "teamPointer.updatedAt": Date.now(),
      "teamPointer.songId": pointerActiveSongRef.current,
    };
    if (live !== undefined) payload["teamPointer.live"] = live;
    updateDoc(doc(db, "services", svc.id), payload).catch(() => {});
  };

  const schedulePointerClear = () => {
    clearTimeout(pointerClearTimerRef.current);
    pointerClearTimerRef.current = setTimeout(() => {
      pointerStrokesRef.current = [];
      pointerLiveRef.current = null;
      [pointerCanvas1Ref, pointerCanvas2Ref].forEach(r => {
        if (r.current) drawPointerStrokes(r.current, [], null);
      });
      if (svc?.id) updateDoc(doc(db, "services", svc.id), {
        "teamPointer.strokes": [], "teamPointer.live": null
      }).catch(() => {});
    }, 3000);
  };

  // Apple Pencil(pen)만 처리 — 손가락 터치는 무시해서 스와이프 네비게이션 유지
  const handlePointerPenDown = (e, canvasRef) => {
    if (!pointerOn || !canvasRef.current) return;
    if (e.pointerType !== "pen") return;
    e.preventDefault();
    const newSide = canvasRef === pointerCanvas2Ref ? 2 : 1;
    const newSongId = newSide === 2 ? (dualRightSongId || selectedSongId) : selectedSongId;
    // 사이드 전환 시 반대쪽 스트로크 clear (혼합 방지)
    if (newSide !== pointerActiveSideRef.current) {
      const prevCanvas = pointerActiveSideRef.current === 2 ? pointerCanvas2Ref : pointerCanvas1Ref;
      if (prevCanvas.current) drawPointerStrokes(prevCanvas.current, [], null);
      pointerStrokesRef.current = [];
    }
    pointerActiveSideRef.current = newSide;
    // 듀얼 오른쪽 사이드로 전환 시: useEffect는 selectedSongId(왼쪽)만 추적하므로 여기서 오른쪽 곡 sheetSync 처리
    if (newSide === 2 && newSongId && newSongId !== pointerActiveSongRef.current) {
      pointerActiveSongRef.current = newSongId;
      pointerStrokesRef.current = [];
      if (pointerCanvas1Ref.current) drawPointerStrokes(pointerCanvas1Ref.current, [], null);
      if (selectedSvcId && svc?.id) {
        const songIdx = svcSongs.findIndex(s => s?.id === newSongId);
        setDoc(doc(db, "liveStatus", "sheetSync"), {
          svcId: selectedSvcId, songId: newSongId,
          songIdx: songIdx >= 0 ? songIdx : 0,
          allowedParts: pointerParts.includes("밴드") ? null : pointerParts,
          pointerSync: true, linkEnabled: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        updateDoc(doc(db, "services", svc.id), {
          "teamPointer.songId": newSongId,
          "teamPointer.strokes": [], "teamPointer.live": null,
        }).catch(() => {});
      }
    } else if (newSide === 1) {
      pointerActiveSongRef.current = selectedSongId;
    }
    const pt = getCanvasPt(e, canvasRef.current);
    pointerCurPtsRef.current = [pt];
    pointerDownRef.current = true;
    clearTimeout(pointerClearTimerRef.current);
    clearInterval(pointerWriteTimerRef.current);
    pointerWriteTimerRef.current = setInterval(() => {
      if (pointerCurPtsRef.current.length > 0)
        pointerWriteStrokes(pointerStrokesRef.current, { pts: pointerCurPtsRef.current });
    }, 150);
  };

  const handlePointerPenMove = (e, canvasRef) => {
    if (e.pointerType !== "pen" || !pointerDownRef.current || !canvasRef.current) return;
    e.preventDefault();
    const pt = getCanvasPt(e, canvasRef.current);
    pointerCurPtsRef.current.push(pt);
    drawPointerStrokes(canvasRef.current, pointerStrokesRef.current, { pts: pointerCurPtsRef.current });
  };

  const handlePointerPenUp = (e, canvasRef) => {
    if (e.pointerType !== "pen" || !pointerDownRef.current) return;
    clearInterval(pointerWriteTimerRef.current);
    pointerDownRef.current = false;
    const pts = pointerCurPtsRef.current;
    pointerCurPtsRef.current = [];
    if (pts.length === 0) return;
    const stroke = { pts, ts: Date.now() };
    pointerStrokesRef.current = [...pointerStrokesRef.current, stroke].slice(-15);
    // 그린 쪽 캔버스에만 표시 (듀얼에서 반대쪽에 중복 표시 방지)
    const activeCanvas = pointerActiveSideRef.current === 2 ? pointerCanvas2Ref : pointerCanvas1Ref;
    if (activeCanvas.current) drawPointerStrokes(activeCanvas.current, pointerStrokesRef.current, null);
    // 듀얼에서 오른쪽에 그린 경우 dualRightSongId 사용
    const activeSongId = pointerActiveSideRef.current === 2 ? (dualRightSongId || selectedSongId) : selectedSongId;
    // songId + page를 매번 써서 팀원들이 리더 위치로 동기화
    if (svc?.id) updateDoc(doc(db, "services", svc.id), {
      "teamPointer.strokes": pointerStrokesRef.current,
      "teamPointer.live": null,
      "teamPointer.songId": activeSongId,
      "teamPointer.page": pageNum,
      "teamPointer.updatedAt": Date.now(),
    }).catch(() => {});
    schedulePointerClear();
  };

  // 팀원: svc.teamPointer 변경 시 악보/페이지 동기화 + 캔버스 렌더링
  useEffect(() => {
    if (leader || user?.role === "admin") return;
    const tp = svc?.teamPointer;
    if (!tp?.on) {
      pointerStrokesRef.current = [];
      [pointerCanvas1Ref, pointerCanvas2Ref].forEach(r => {
        if (r.current) drawPointerStrokes(r.current, [], null);
      });
      return;
    }
    // 곡 이동은 sheetSync가 담당 — teamPointer는 스트로크 + 페이지만 담당
    // 현재 보이는 곡이 포인터 곡과 다르면 아직 이동 중이므로 스트로크 렌더 건너뜀
    if (tp.songId) {
      const visibleSongs = dual ? [dualLeftSongId, dualRightSongId] : [selectedSongId];
      if (!visibleSongs.includes(tp.songId)) return;
    }
    // 페이지 동기화 (같은 곡 내)
    if (tp.page && tp.page !== pageNum) {
      setPageNum(tp.page);
      return;
    }
    // 스트로크 렌더링 — 듀얼 모드에서는 songId가 일치하는 쪽 캔버스에만 그림
    const strokes = tp.strokes || [];
    const live    = tp.live   || null;
    pointerStrokesRef.current = strokes;
    if (dual) {
      if (tp.songId === dualLeftSongId && pointerCanvas1Ref.current)
        drawPointerStrokes(pointerCanvas1Ref.current, strokes, live);
      else if (tp.songId === dualRightSongId && pointerCanvas2Ref.current)
        drawPointerStrokes(pointerCanvas2Ref.current, strokes, live);
    } else {
      if (pointerCanvas1Ref.current) drawPointerStrokes(pointerCanvas1Ref.current, strokes, live);
    }
  // selectedSongId 포함: nav() 후 re-render 시 스트로크 렌더링이 실행되도록
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.teamPointer?.strokes, svc?.teamPointer?.live, svc?.teamPointer?.on, svc?.teamPointer?.songId, svc?.teamPointer?.page, leader, selectedSongId]);

  // 포인터 켜진 동안 리더 악보 이동 → 즉시 sheetSync로 팀원 동기화
  // 듀얼 모드에서는 selectedSongId가 고정되므로 dualLeftSongId(dualIdx 연동)도 감시
  useEffect(() => {
    if (!pointerOn || (!leader && user?.role !== "admin")) return;
    // 듀얼 모드: dualLeftSongId(=svcSongs[dualIdx]?.id) 우선 사용
    const currentSongId = (dual && dualLeftSongId) ? dualLeftSongId : selectedSongId;
    if (!selectedSvcId || !currentSongId || !svc?.id) return;
    pointerActiveSongRef.current = currentSongId;
    pointerActiveSideRef.current = 1;
    pointerStrokesRef.current = [];
    [pointerCanvas1Ref, pointerCanvas2Ref].forEach(r => { if (r?.current) drawPointerStrokes(r.current, [], null); });
    const songIdx = svcSongs.findIndex(s => s?.id === currentSongId);
    setDoc(doc(db, "liveStatus", "sheetSync"), {
      svcId: selectedSvcId, songId: currentSongId,
      songIdx: songIdx >= 0 ? songIdx : 0,
      allowedParts: pointerParts.includes("밴드") ? null : pointerParts,
      pointerSync: true, linkEnabled: true,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    updateDoc(doc(db, "services", svc.id), {
      "teamPointer.songId": currentSongId,
      "teamPointer.strokes": [], "teamPointer.live": null,
    }).catch(() => {});
  // dualLeftSongId: dualIdx 바뀔 때마다 변경됨 → 듀얼 모드 곡 이동 감지
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualLeftSongId, selectedSongId, pointerOn]);

  // keep drawModeRef in sync for non-reactive listeners
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  // pan helpers
  const PAN_STEP = 70;
  const doPan = useCallback((dx, dy) => {
    setPanOffset(prev => {
      const maxX = cSize.w * Math.max(0, zoomMul - 1) / 2 + 40;
      const maxY = cSize.h * Math.max(0, zoomMul - 1) / 2 + 40;
      return {
        x: Math.max(-maxX, Math.min(maxX, prev.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, prev.y + dy)),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cSize.w, cSize.h, zoomMul]);

  const startPan = useCallback((dx, dy) => {
    doPan(dx, dy);
    clearInterval(panIntervalRef.current);
    panIntervalRef.current = setInterval(() => doPan(dx, dy), 80);
  }, [doPan]);

  const stopPan = useCallback(() => {
    clearInterval(panIntervalRef.current);
  }, []);

  // 듀얼 모드: 좌/우 캔버스 양쪽 분석 → 두 곡 모두 맞는 최솟값 비율 반환
  const dualFitRatio = useCallback(() => {
    const PAD = 16;
    const fw = Math.floor(cSize.w / 2) - 16;
    const fh = cSize.h - 16;
    let best = Infinity;
    for (const [pc, dc] of [
      [canvas1Ref.current, drawCanvas1Ref.current],
      [canvas2Ref.current, drawCanvas2Ref.current],
    ]) {
      const b = detectContentBounds(pc, dc);
      if (!b) continue;
      const r = Math.min(fw / (b.x1 - b.x0 + PAD * 2), fh / (b.y1 - b.y0 + PAD * 2));
      if (r < best) best = r;
    }
    return isFinite(best) ? best : null;
  }, [cSize]);

  const resetZoom = useCallback(() => {
    dualFitModeRef.current   = false;
    needsFitRef.current      = false;
    singleFitModeRef.current = false;
    singleNeedsFitRef.current = false;
    setFitActive(false);
    setZoomMul(1.0);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // 여백 자동 감지 → 악보 콘텐츠만 꽉 채우는 줌+패닝 적용 (토글)
  const autoFit = useCallback(() => {
    if (dual) {
      if (dualFitModeRef.current) {
        dualFitModeRef.current = false;
        needsFitRef.current    = false;
        setFitActive(false);
      } else {
        const ratio = dualFitRatio();
        if (ratio == null) return;
        const newZoom = Math.min(3.0, Math.max(0.5, parseFloat((zoomMul * ratio).toFixed(2))));
        dualFitModeRef.current = true;
        setFitActive(true);
        setZoomMul(newZoom);
        setPanOffset({ x: 0, y: 0 });
      }
    } else {
      if (singleFitModeRef.current) {
        singleFitModeRef.current  = false;
        singleNeedsFitRef.current = false;
        setFitActive(false);
      } else {
        const b = detectContentBounds(canvas1Ref.current, drawCanvas1Ref.current);
        if (!b) return;
        const PAD = 24;
        const cw = b.x1 - b.x0 + PAD * 2;
        const ch = b.y1 - b.y0 + PAD * 2;
        const ratio = Math.min((cSize.w - 16) / cw, (cSize.h - 16) / ch);
        const newZoom = Math.min(3.0, Math.max(0.5, parseFloat((zoomMul * ratio).toFixed(2))));
        const r = newZoom / zoomMul;
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        singleFitModeRef.current = true;
        setFitActive(true);
        setZoomMul(newZoom);
        setPanOffset({ x: r * (b.W / 2 - cx), y: r * (b.H / 2 - cy) });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dual, zoomMul, cSize, dualFitRatio]);

  const dualLeftSongId  = svcSongs[dualIdx]?.id     || null;
  const dualRightSongId = svcSongs[dualIdx + 1]?.id || null;
  const effectiveNoteSongId = dual ? (noteSongId || dualLeftSongId) : selectedSongId;
  const myNotes   = annotations[effectiveNoteSongId]     || [];
  const teamNotes = (teamAnnotations || {})[effectiveNoteSongId] || [];
  // 큐 노트는 듀얼 시 항상 왼쪽 악보 기준
  const cueSongId = dual ? (dualLeftSongId || selectedSongId) : selectedSongId;
  const cueSong   = songs.find(s => s.id === cueSongId) || song;

  // drawings stored under customSongs/drw_{uid}_{songId}_p{page}
  // — customSongs has "allow read, write: if isAuthed()" in live Firestore rules

  const loadDrawing = (songId, page, strokesRef2, dcRef) => {
    strokesRef2.current = [];
    const dc = dcRef.current;
    if (dc) dc.getContext("2d").clearRect(0, 0, dc.width, dc.height);
    if (!user?.uid || !songId) return;
    getDoc(doc(db, "customSongs", `drw_${user.uid}_${songId}_p${page}`))
      .then(snap => {
        if (snap.exists()) {
          strokesRef2.current = snap.data().strokes || [];
          const dc2 = dcRef.current;
          if (dc2 && dc2.width > 0) {
            drawStrokes(dc2, strokesRef2.current);
          } else if (dc2) {
            const tid = setInterval(() => {
              if (dc2.width > 0) {
                clearInterval(tid);
                dc2.getContext("2d").clearRect(0, 0, dc2.width, dc2.height);
                drawStrokes(dc2, strokesRef2.current);
              }
            }, 50);
            setTimeout(() => clearInterval(tid), 3000);
          }
        }
      }).catch(() => {});
  };

  const toTeamColor = strokes => strokes.map(s => ({ ...s, color: TEAM_COLOR }));

  const drawTeamStrokes = (tdcRef, strokes) => {
    const dc = tdcRef.current;
    if (!dc) return;
    dc.getContext("2d").clearRect(0, 0, dc.width, dc.height);
    if (strokes.length > 0) {
      if (dc.width > 0) {
        drawStrokes(dc, strokes);
      } else {
        // 캔버스 크기 잡힐 때까지 대기 후 재시도
        const tid = setInterval(() => {
          if (dc.width > 0) { clearInterval(tid); dc.getContext("2d").clearRect(0, 0, dc.width, dc.height); drawStrokes(dc, strokes); }
        }, 50);
        setTimeout(() => clearInterval(tid), 3000);
      }
    }
  };

  const loadTeamDrawing = (songId, page, tStrokesRef, tdcRef, drawingRef) => {
    tStrokesRef.current = [];
    const dc = tdcRef.current;
    if (dc) dc.getContext("2d").clearRect(0, 0, dc.width, dc.height);
    if (!songId) return () => {};
    const unsub = onSnapshot(
      doc(db, "customSongs", `drw_TEAM_${songId}_p${page}`),
      snap => {
        if (drawingRef?.current) return; // mid-stroke — skip to avoid flicker
        const strokes = toTeamColor(snap.exists() ? (snap.data().strokes || []) : []);
        tStrokesRef.current = strokes;
        setHasTeamStrokes(strokes.length > 0);
        drawTeamStrokes(tdcRef, strokes);
      },
      () => {}
    );
    return unsub;
  };

  // load strokes — single mode
  useEffect(() => {
    if (dual) return;
    loadDrawing(selectedSongId, pageNum, strokes1Ref, drawCanvas1Ref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSongId, pageNum, user?.uid, dual]);

  // load strokes — dual left
  useEffect(() => {
    if (!dual) return;
    loadDrawing(dualLeftSongId, svcSongs[dualIdx]?.pdfPage || 1, strokes1Ref, drawCanvas1Ref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualLeftSongId, user?.uid, dual]);

  // load strokes — dual right
  useEffect(() => {
    if (!dual) return;
    loadDrawing(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, strokes2Ref, drawCanvas2Ref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualRightSongId, user?.uid, dual]);

  // load team strokes — single (realtime)
  useEffect(() => {
    if (dual) return;
    const unsub = loadTeamDrawing(selectedSongId, pageNum, teamStrokes1Ref, teamDrawCanvas1Ref, isDrawing1Ref);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSongId, pageNum, dual]);

  // load team strokes — dual left (realtime)
  useEffect(() => {
    if (!dual) return;
    const unsub = loadTeamDrawing(dualLeftSongId, svcSongs[dualIdx]?.pdfPage || 1, teamStrokes1Ref, teamDrawCanvas1Ref, isDrawing1Ref);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualLeftSongId, dual]);

  // load team strokes — dual right (realtime)
  useEffect(() => {
    if (!dual) return;
    const unsub = loadTeamDrawing(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, teamStrokes2Ref, teamDrawCanvas2Ref, isDrawing2Ref);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualRightSongId, dual]);

  // Sync selAnnotRef with state
  useEffect(() => { selAnnotRef.current = selAnnot; }, [selAnnot]);

  // Clear selection when switching away from select tool or draw mode off
  useEffect(() => {
    if (drawTool !== "select") setSelAnnot(null);
    setStampPanel(null);
    setShowStampPalette(drawTool === "stamp");
  }, [drawTool]);

  // Clear selection on page/song change
  useEffect(() => { setSelAnnot(null); setStampPanel(null); }, [selectedSongId, pageNum, dualIdx]);

  // 스크롤/리사이즈 시 stampPanel 좌표 stale 방지 — 패널 닫기
  useEffect(() => {
    if (!stampPanel) return;
    const close = () => setStampPanel(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [stampPanel]);

  // 곡 변경 시 IndexedDB에서 녹음 카운트 로드
  useEffect(() => {
    if (!selectedSongId) return;
    getRecsFromDB(selectedSongId).then(recs => setRecCount(recs.length)).catch(() => {});
  }, [selectedSongId]);

  // 서비스 레벨 연습 녹음 URL 로드
  useEffect(() => {
    if (!svc?.id) { setSvcPracticeUrl(null); return; }
    loadServiceSettings(svc.id)
      .then(d => setSvcPracticeUrl(d?.practiceUrl || null))
      .catch(() => setSvcPracticeUrl(null));
  }, [svc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 악기 피커 외부 탭 시 닫기
  useEffect(() => {
    if (!showInstPicker) return;
    const close = (e) => {
      if (e.target.closest && e.target.closest("[data-inst-picker]")) return;
      setShowInstPicker(false);
    };
    const t = setTimeout(() => {
      document.addEventListener("pointerdown", close);
    }, 100);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", close); };
  }, [showInstPicker]);

  // 곡 변경 시 해당 곡의 전조 모드 복원 (개인별 localStorage)
  useEffect(() => {
    if (!tmKey) { setTransposeMode(false); return; }
    setTransposeMode(localStorage.getItem(tmKey) === "1");
  }, [tmKey]);

  // 곡 변경 시 YouTube 구간 복원
  useEffect(() => {
    if (!selectedSongId) { setYtRange({ start:"", end:"" }); return; }
    try {
      const saved = JSON.parse(localStorage.getItem(`tvpc_ytr_${selectedSongId}`) || "null");
      setYtRange(saved || { start:"", end:"" });
    } catch { setYtRange({ start:"", end:"" }); }
  }, [selectedSongId]);

  // 코드 이동 모드: 전조 끄거나 곡/페이지 이동 시 자동 리셋
  useEffect(() => { if (!transposeMode) setChordMoveMode(false); }, [transposeMode]);
  useEffect(() => { setChordMoveMode(false); }, [selectedSongId, pageNum, dualIdx]);

  // 팀 채팅 구독
  useEffect(() => {
    if (!effectiveSvcId) return;
    const q = query(collection(db, "liveChat", effectiveSvcId, "messages"), orderBy("createdAt"), limit(50));
    return onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setChatMsgs(msgs);
      if (chatMsgsPrevRef.current.length > 0) {
        const prevIds = new Set(chatMsgsPrevRef.current.map(m => m.id));
        const newMsgs = msgs.filter(m => !prevIds.has(m.id) && m.uid !== user?.uid);
        if (newMsgs.length > 0) {
          const last = newMsgs[newMsgs.length - 1];
          clearTimeout(chatToastKbTimer.current);
          setChatToastKb({ name: last.name?.split(" ")[0] || "FOH", text: last.text });
          chatToastKbTimer.current = setTimeout(() => setChatToastKb(null), 8000);
        }
      }
      chatMsgsPrevRef.current = msgs;
    });
  }, [effectiveSvcId]);
  useEffect(() => {
    if (showChat) {
      const now = Date.now();
      setChatLastSeen(now);
      try { localStorage.setItem("tvpc_chat_last_seen", String(now)); } catch {}
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior:"smooth" }), 60);
    }
  }, [chatMsgs.length, showChat]);

  const saveDrawing = useCallback(async (songId, page, strokes) => {
    if (!user?.uid || !songId) return;
    try {
      await setDoc(
        doc(db, "customSongs", `drw_${user.uid}_${songId}_p${page}`),
        { strokes, updatedAt: serverTimestamp() }
      );
      setDrawSaveErr("");
    } catch(e) {
      console.error("필기 저장 실패:", e);
      setDrawSaveErr("필기 저장 실패: " + (e.code === "permission-denied" ? "권한 없음" : e.message));
    }
  }, [user?.uid]);

  const saveTeamDrawing = useCallback(async (songId, page, strokes) => {
    if (!songId) return;
    try {
      await setDoc(
        doc(db, "customSongs", `drw_TEAM_${songId}_p${page}`),
        { strokes, updatedAt: serverTimestamp() }
      );
      setDrawSaveErr("");
    } catch(e) {
      console.error("팀 필기 저장 실패:", e);
      setDrawSaveErr("팀 필기 저장 실패: " + (e.code === "permission-denied" ? "권한 없음" : e.message));
    }
  }, []);

  // 컨테이너 크기 추적 (ResizeObserver)
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width >= 50 && rect.height >= 50) {
      setCSize({ w: rect.width, h: rect.height });
    }
    let timer;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width < 50 || height < 50) return;
      clearTimeout(timer);
      timer = setTimeout(() => setCSize({ w: width, h: height }), 120);
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);

  // 스와이프 중 브라우저 기본 스크롤 차단 (iOS Safari 포함)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e) => { if (drawModeRef.current || touchStartX.current !== null) e.preventDefault(); };
    el.addEventListener("touchmove", prevent, { passive: false });
    return () => el.removeEventListener("touchmove", prevent);
  }, []);

  // 애플펜슬 터치 추적 — 펜슬로 페이지 스와이프 방지
  useEffect(() => {
    const onDown = (e) => { if (e.pointerType === "pen") penDownRef.current = true; };
    const onUp   = (e) => { if (e.pointerType === "pen") penDownRef.current = false; };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup",   onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup",   onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // 코드 감지 결과 로드 — 싱글 모드
  useEffect(() => {
    setChordData([]); setDetectErr("");
    if (!user?.uid || !selectedSongId || dual) return;
    const sharedKey  = `chord_shared_${selectedSongId}_p${pageNum}`;
    const personalKey = `chord_${user.uid}_${selectedSongId}_p${pageNum}`;
    Promise.all([
      getDoc(doc(db, "customSongs", sharedKey)),
      getDoc(doc(db, "customSongs", personalKey)),
    ]).then(([shared, personal]) => {
      if (shared.exists()) {
        setChordData(shared.data().chords || []);
        setTransposeSteps(shared.data().transposeSteps ?? 0);
        if (shared.data().chordFontScale) setChordFontScale(shared.data().chordFontScale);
      } else if (personal.exists()) {
        setChordData(personal.data().chords || []);
        setTransposeSteps(personal.data().transposeSteps ?? 0);
        if (personal.data().chordFontScale) setChordFontScale(personal.data().chordFontScale);
        return;
      } else {
        setTransposeSteps(0); setChordFontScale(1.0); return;
      }
      // 멤버 개인 전조/크기 덮어쓰기
      if (personal.exists()) {
        if (personal.data().transposeSteps !== undefined) setTransposeSteps(personal.data().transposeSteps);
        if (personal.data().chordFontScale)               setChordFontScale(personal.data().chordFontScale);
      }
    }).catch(() => {});
  }, [pageNum, selectedSongId, user?.uid, dual]);

  // 코드 감지 결과 로드 — 듀얼 왼쪽
  useEffect(() => {
    setChordData([]);
    if (!user?.uid || !dualLeftSongId || !dual) return;
    const pg = svcSongs[dualIdx]?.pdfPage || 1;
    const sharedKey  = `chord_shared_${dualLeftSongId}_p${pg}`;
    const personalKey = `chord_${user.uid}_${dualLeftSongId}_p${pg}`;
    Promise.all([
      getDoc(doc(db, "customSongs", sharedKey)),
      getDoc(doc(db, "customSongs", personalKey)),
    ]).then(([shared, personal]) => {
      if (shared.exists()) {
        setChordData(shared.data().chords || []);
        setTransposeSteps(shared.data().transposeSteps ?? 0);
        if (shared.data().chordFontScale) setChordFontScale(shared.data().chordFontScale);
      } else if (personal.exists()) {
        setChordData(personal.data().chords || []);
        setTransposeSteps(personal.data().transposeSteps ?? 0);
        if (personal.data().chordFontScale) setChordFontScale(personal.data().chordFontScale);
        return;
      } else { setTransposeSteps(0); setChordFontScale(1.0); return; }
      if (personal.exists()) {
        if (personal.data().transposeSteps !== undefined) setTransposeSteps(personal.data().transposeSteps);
        if (personal.data().chordFontScale)               setChordFontScale(personal.data().chordFontScale);
      }
    }).catch(() => {});
  }, [dualLeftSongId, user?.uid, dual, dualIdx]);

  // 코드 감지 결과 로드 — 듀얼 오른쪽
  useEffect(() => {
    setChordData2([]);
    if (!user?.uid || !dualRightSongId || !dual) return;
    const pg = svcSongs[dualIdx + 1]?.pdfPage || 1;
    const sharedKey  = `chord_shared_${dualRightSongId}_p${pg}`;
    const personalKey = `chord_${user.uid}_${dualRightSongId}_p${pg}`;
    Promise.all([
      getDoc(doc(db, "customSongs", sharedKey)),
      getDoc(doc(db, "customSongs", personalKey)),
    ]).then(([shared, personal]) => {
      if (shared.exists()) {
        setChordData2(shared.data().chords || []);
        setTransposeSteps2(shared.data().transposeSteps ?? 0);
      } else if (personal.exists()) {
        setChordData2(personal.data().chords || []);
        setTransposeSteps2(personal.data().transposeSteps ?? 0);
        return;
      } else { setTransposeSteps2(0); return; }
      if (personal.exists() && personal.data().transposeSteps !== undefined)
        setTransposeSteps2(personal.data().transposeSteps);
    }).catch(() => {});
  }, [dualRightSongId, user?.uid, dual, dualIdx]);

  const detectChords = async (side = 1) => {
    const canvas = (side === 2 ? canvas2Ref : canvas1Ref).current;
    if (!canvas || !canvas.width) return;
    const setCD = side === 2 ? setChordData2 : setChordData;
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    const page   = dual
      ? (side === 2 ? (svcSongs[dualIdx + 1]?.pdfPage || 1) : (svcSongs[dualIdx]?.pdfPage || 1))
      : pageNum;
    setDetectingChords(true); setDetectErr(""); setCD([]);
    try {
      // 이미지 축소 (최대 1200px) + JPEG 압축
      const MAX_DIM = 2400;
      const ratio = Math.min(MAX_DIM / canvas.width, MAX_DIM / canvas.height, 1);
      const small = document.createElement("canvas");
      small.width  = Math.round(canvas.width  * ratio);
      small.height = Math.round(canvas.height * ratio);
      small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
      const imageData = small.toDataURL("image/jpeg", 0.95).split(",")[1];

      const raw = await detectChordsViaEdge(imageData, user?.geminiKey || sharedGeminiKey);
      const chords = raw.map((item) => ({
        chord: item.label,
        x: typeof item.cx === "number" ? item.cx : (typeof item.x === "number" ? item.x : 0.5),
        y: typeof item.cy === "number" ? item.cy : (typeof item.y === "number" ? item.y : 0.5),
        w: 0.02, h: 0.02,
      }));
      setCD(chords);
      if (chords.length === 0) {
        setDetectErr("코드를 찾지 못했습니다");
      } else if (user?.uid && songId) {
        const data = { chords, transposeSteps, updatedAt: serverTimestamp() };
        if (isLeader(user.role)) {
          // 리더: 팀 공유 + 악보 라이브러리에 저장
          setDoc(doc(db, "customSongs", `chord_shared_${songId}_p${page}`), data).catch(() => {});
          setDoc(doc(db, "songs", songId), { [`chords_p${page}`]: chords, [`transposeSteps_p${page}`]: transposeSteps }, { merge: true }).catch(() => {});
        }
        setDoc(doc(db, "customSongs", `chord_${user.uid}_${songId}_p${page}`), data).catch(() => {});
      }
    } catch(e) {
      setDetectErr("오류: " + e.message);
    } finally {
      setDetectingChords(false);
    }
  };

  const saveChordPositions = (chords, side = 1) => {
    if (!user?.uid) return;
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    const page   = dual
      ? (side === 2 ? (svcSongs[dualIdx + 1]?.pdfPage || 1) : (svcSongs[dualIdx]?.pdfPage || 1))
      : pageNum;
    if (!songId) return;
    const data = { chords, updatedAt: serverTimestamp() };
    if (isLeader(user.role)) {
      setDoc(doc(db, "customSongs", `chord_shared_${songId}_p${page}`), data, { merge: true }).catch(() => {});
      setDoc(doc(db, "songs", songId), { [`chords_p${page}`]: chords }, { merge: true }).catch(() => {});
    }
    setDoc(doc(db, "customSongs", `chord_${user.uid}_${songId}_p${page}`), data, { merge: true }).catch(() => {});
  };

  const saveChordFontScale = (scale) => {
    if (!user?.uid) return;
    const songId = dual ? dualLeftSongId : selectedSongId;
    const page   = dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum;
    if (!songId) return;
    const data = { chordFontScale: scale, updatedAt: serverTimestamp() };
    if (isLeader(user.role))
      setDoc(doc(db, "customSongs", `chord_shared_${songId}_p${page}`), data, { merge: true }).catch(() => {});
    setDoc(doc(db, "customSongs", `chord_${user.uid}_${songId}_p${page}`), data, { merge: true }).catch(() => {});
  };

  const deleteChord = (side, idx) => {
    const current = side === 2 ? chordData2 : chordData;
    const updated = current.filter((_, i) => i !== idx);
    (side === 2 ? setChordData2 : setChordData)(updated);
    saveChordPositions(updated, side);
  };

  const duplicateChord = (side, idx) => {
    const current = side === 2 ? chordData2 : chordData;
    const orig = current[idx];
    const copy = { ...orig, x: Math.min(0.97, orig.x + 0.06) };
    const updated = [...current, copy];
    (side === 2 ? setChordData2 : setChordData)(updated);
    saveChordPositions(updated, side);
  };

  const handleChordPointerDown = (e, side, idx) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    chordDragCancelledRef.current = false;
    setDragChord({ side, idx, pointerId: e.pointerId });
    longPressOrigin.current = { x: e.clientX, y: e.clientY };
    pointerDownTimeRef.current = Date.now();
    didDragRef.current = false;
    setDeletingChord({ side, idx });
    longPressTimer.current = setTimeout(() => {
      deleteChord(side, idx);
      setDragChord(null);
      setDeletingChord(null);
      longPressOrigin.current = null;
    }, 600);
  };

  const handleChordPointerMove = (e, side) => {
    if (longPressOrigin.current) {
      const dx = e.clientX - longPressOrigin.current.x;
      const dy = e.clientY - longPressOrigin.current.y;
      // 수평 스와이프 감지: drag 취소하고 페이지/곡 이동으로 전환
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        clearTimeout(longPressTimer.current);
        chordDragCancelledRef.current = true;
        setDragChord(null);
        setDeletingChord(null);
        longPressOrigin.current = null;
        didDragRef.current = false;
        triggerSwipe(dx); // 스와이프 방향 그대로 전달
        return;
      }
      // cancel long-press if pointer moved > 8px (non-swipe)
      if (dx * dx + dy * dy > 64) {
        clearTimeout(longPressTimer.current);
        setDeletingChord(null);
        longPressOrigin.current = null;
        didDragRef.current = true;
      }
    }
    if (chordDragCancelledRef.current) return; // state 업데이트 전에도 즉시 차단
    if (!dragChord || dragChord.side !== side) return;
    const ref = side === 2 ? chordOverlay2Ref : chordOverlay1Ref;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
    const setter = side === 2 ? setChordData2 : setChordData;
    setter(prev => prev.map((c, i) => i === dragChord.idx ? { ...c, x: nx, y: ny } : c));
  };

  const handleChordPointerUp = (side) => {
    clearTimeout(longPressTimer.current);
    setDeletingChord(null);
    longPressOrigin.current = null;
    if (!dragChord || dragChord.side !== side) return;

    const elapsed = Date.now() - pointerDownTimeRef.current;
    const wasTap = !didDragRef.current && elapsed < 350;
    if (wasTap) {
      const { idx } = dragChord;
      const now = Date.now();
      const last = lastTapRef.current;
      if (last.side === side && last.idx === idx && now - last.time < 500) {
        // double-tap → duplicate
        duplicateChord(side, idx);
        lastTapRef.current = { side: null, idx: null, time: 0 };
        setDragChord(null);
        return;
      }
      lastTapRef.current = { side, idx, time: now };
    }

    const chords = side === 2 ? chordData2 : chordData;
    saveChordPositions(chords, side);
    setDragChord(null);
  };

  const saveTransposeSteps = (newSteps) => {
    setTransposeSteps(newSteps);
    if (!user?.uid) return;
    const songId = dual ? dualLeftSongId : selectedSongId;
    const page   = dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum;
    if (!songId) return;
    setDoc(doc(db, "customSongs", `chord_${user.uid}_${songId}_p${page}`),
      { transposeSteps: newSteps, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  };

  const saveTransposeSteps2 = (newSteps) => {
    setTransposeSteps2(newSteps);
    if (!user?.uid || !dualRightSongId) return;
    const page = svcSongs[dualIdx + 1]?.pdfPage || 1;
    setDoc(doc(db, "customSongs", `chord_${user.uid}_${dualRightSongId}_p${page}`),
      { transposeSteps: newSteps, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  };

  // PDF 로드 (싱글 모드) — _pdfCache로 재파싱 없이 즉시 사용
  const prevSongIdRef = useRef(selectedSongId);
  useEffect(() => {
    if (dual) return;
    pdfDocRef.current = null;
    imageRef.current  = null;
    // 같은 곡의 새로고침: localStorage 저장 페이지 복원 / 곡 변경: pdfPage || 1
    const isSameSong = prevSongIdRef.current === selectedSongId;
    prevSongIdRef.current = selectedSongId;
    const savedPage = isSameSong ? parseInt(localStorage.getItem("tvpc_pageNum") || "0") : 0;
    setPageNum(savedPage > 0 ? savedPage : (song?.pdfPage || 1));
    setNumPages(0); setLoadErr("");
    if (!song?.pdfUrl || !pdfjsReady || !window.pdfjsLib) return;
    const url = song.pdfUrl;
    if (_pdfCache[url]) {
      pdfDocRef.current = _pdfCache[url];
      setNumPages(_pdfCache[url].numPages);
      return;
    }
    window.pdfjsLib.getDocument({ url }).promise
      .then(pdf => { _pdfCache[url] = pdf; pdfDocRef.current = pdf; setNumPages(pdf.numPages); })
      .catch(() => setLoadErr("PDF를 불러올 수 없습니다"));
  }, [song?.pdfUrl, pdfjsReady, selectedSongId, dual]);

  // 이미지 악보 로드 (싱글 모드, pdfUrl 없이 imageUrl만 있을 때)
  useEffect(() => {
    if (dual || song?.pdfUrl || !song?.imageUrl) return;
    imageRef.current = null;
    setNumPages(0); setLoadErr("");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => { imageRef.current = img; setNumPages(1); };
    img.onerror = () => setLoadErr("이미지를 불러올 수 없습니다");
    img.src = song.imageUrl;
  }, [song?.imageUrl, selectedSongId, dual, song?.pdfUrl]);

  // PDF 로드 (듀얼 모드) — Promise.all로 두 곡 동시 로드, 완료 후 한 번만 렌더 트리거
  const dualLeftUrl       = svcSongs[dualIdx]?.pdfUrl        || null;
  const dualRightUrl      = svcSongs[dualIdx + 1]?.pdfUrl    || null;
  const dualLeftPage      = svcSongs[dualIdx]?.pdfPage        || 1;
  const dualRightPage     = svcSongs[dualIdx + 1]?.pdfPage    || 1;
  const dualLeftImageUrl  = svcSongs[dualIdx]?.imageUrl       || null;
  const dualRightImageUrl = svcSongs[dualIdx + 1]?.imageUrl   || null;
  useEffect(() => {
    if (!dual) return;
    dualPdf1Ref.current = null;
    dualPdf2Ref.current = null;
    dualImg1Ref.current = null;
    dualImg2Ref.current = null;
    const loadPdf = (url) => {
      if (!url || !pdfjsReady || !window.pdfjsLib) return Promise.resolve(null);
      if (_pdfCache[url]) return Promise.resolve(_pdfCache[url]);
      return window.pdfjsLib.getDocument({ url }).promise
        .then(pdf => { _pdfCache[url] = pdf; return pdf; })
        .catch(() => null);
    };
    const loadImg = (url) => new Promise(resolve => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    Promise.all([
      loadPdf(dualLeftUrl), loadPdf(dualRightUrl),
      loadImg(dualLeftImageUrl), loadImg(dualRightImageUrl),
    ]).then(([p1, p2, i1, i2]) => {
      dualPdf1Ref.current = p1;
      dualPdf2Ref.current = p2;
      dualImg1Ref.current = i1;
      dualImg2Ref.current = i2;
      setDualKey(k => k + 1); // single render trigger after all are ready
    });
  }, [dual, dualIdx, dualLeftUrl, dualRightUrl, dualLeftImageUrl, dualRightImageUrl, pdfjsReady]);

  // cropBox를 적용해 캔버스에 렌더링하는 헬퍼
  const renderWithCrop = async (canvas, pdfDoc, pdfPageNum, cropBox, availW, availH) => {
    const page = await pdfDoc.getPage(pdfPageNum);
    const base = page.getViewport({ scale: 1 });
    const cb = (cropBox && (cropBox.left > 0.001 || cropBox.top > 0.001 || cropBox.right < 0.999 || cropBox.bottom < 0.999))
      ? cropBox : null;
    let sc, dW, dH;
    if (cb) {
      const cw = (cb.right - cb.left) * base.width;
      const ch = (cb.bottom - cb.top) * base.height;
      sc = Math.min(availW / cw, availH / ch) * zoomMul;
      dW = Math.round(cw * sc);
      dH = Math.round(ch * sc);
    } else {
      sc = Math.min(availW / base.width, availH / base.height) * zoomMul;
      dW = Math.round(base.width * sc);
      dH = Math.round(base.height * sc);
    }
    const vp = page.getViewport({ scale: sc });
    if (cb) {
      const off = document.createElement("canvas");
      off.width  = Math.round(vp.width);
      off.height = Math.round(vp.height);
      await page.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
      canvas.width  = dW;
      canvas.height = dH;
      canvas.getContext("2d").drawImage(off, cb.left * vp.width, cb.top * vp.height, dW, dH, 0, 0, dW, dH);
    } else {
      // 오프스크린 버퍼에 렌더 완료 후 한 번에 교체 → 깜빡임 제거
      const off = document.createElement("canvas");
      off.width  = Math.round(vp.width);
      off.height = Math.round(vp.height);
      await page.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
      canvas.width  = off.width;
      canvas.height = off.height;
      canvas.getContext("2d").drawImage(off, 0, 0);
    }
  };

  // 즉시 캔버스에 캐시된 비트맵 표시 (스와이프 순간 반응)
  const flashBitmap = (songId, cRef, dcRef) => {
    const bmp = preBitmapRef.current[songId];
    if (!bmp || !cRef.current) return false;
    cRef.current.width  = bmp.width;
    cRef.current.height = bmp.height;
    cRef.current.getContext("2d").drawImage(bmp, 0, 0); // GPU blit when bmp is ImageBitmap
    if (dcRef.current) {
      dcRef.current.width  = bmp.width;
      dcRef.current.height = bmp.height;
      dcRef.current.getContext("2d").clearRect(0, 0, bmp.width, bmp.height);
    }
    return true;
  };

  // Piascore-style slide: flash new bitmap → animate container from offset back to 0
  // direction: +1 = from right (next), -1 = from left (prev)
  const slideAnimate = (direction) => {
    const el = containerRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform  = `translateX(${direction * 42}px)`;
    el.style.opacity    = "0.82";
    el.getBoundingClientRect(); // force reflow so the browser registers initial state
    el.style.transition = "transform 170ms cubic-bezier(0.22,1,0.36,1), opacity 120ms ease-out";
    el.style.transform  = "translateX(0)";
    el.style.opacity    = "1";
  };

  // 인접 곡을 백그라운드에서 미리 렌더 → preBitmapRef 에 저장
  // slotW: 표시될 슬롯 너비 (single=cSize.w, dual=cSize.w/2)
  const preRenderSongToCache = async (targetSong, slotW = cSize.w) => {
    if (!targetSong || !cSize.w || !cSize.h) return;
    if (!targetSong.pdfUrl && !targetSong.imageUrl) return;
    const id = targetSong.id;
    if (preBitmapRef.current[id] || preRenderBusy.current.has(id)) return;
    preRenderBusy.current.add(id);
    try {
      const availW = slotW;
      const availH = cSize.h;
      const off    = document.createElement("canvas");
      if (targetSong.pdfUrl && pdfjsReady && window.pdfjsLib) {
        const url = targetSong.pdfUrl;
        let pdf = _pdfCache[url];
        if (!pdf) {
          pdf = await window.pdfjsLib.getDocument({ url }).promise;
          _pdfCache[url] = pdf;
        }
        const pageN = targetSong.pdfPage || 1;
        const page  = await pdf.getPage(pageN);
        const base  = page.getViewport({ scale: 1 });
        const cb    = targetSong.cropBox &&
          (targetSong.cropBox.left > 0.001 || targetSong.cropBox.top > 0.001 ||
           targetSong.cropBox.right < 0.999 || targetSong.cropBox.bottom < 0.999)
          ? targetSong.cropBox : null;
        let sc;
        if (cb) {
          const cw = (cb.right - cb.left) * base.width;
          const ch = (cb.bottom - cb.top) * base.height;
          sc = Math.min(availW / cw, availH / ch) * zoomMul;
          off.width  = Math.round(cw * sc);
          off.height = Math.round(ch * sc);
          const fullVp = page.getViewport({ scale: sc });
          const tmp = document.createElement("canvas");
          tmp.width  = Math.round(fullVp.width);
          tmp.height = Math.round(fullVp.height);
          await page.render({ canvasContext: tmp.getContext("2d"), viewport: fullVp }).promise;
          off.getContext("2d").drawImage(tmp, cb.left * fullVp.width, cb.top * fullVp.height, off.width, off.height, 0, 0, off.width, off.height);
        } else {
          sc = Math.min(availW / base.width, availH / base.height) * zoomMul;
          off.width  = Math.round(base.width  * sc);
          off.height = Math.round(base.height * sc);
          await page.render({ canvasContext: off.getContext("2d"), viewport: page.getViewport({ scale: sc }) }).promise;
        }
      } else if (targetSong.imageUrl) {
        const img = await new Promise(resolve => {
          const i = new Image(); i.crossOrigin = "anonymous";
          i.onload = () => resolve(i); i.onerror = () => resolve(null);
          i.src = targetSong.imageUrl;
        });
        if (!img) return;
        const cb = targetSong.cropBox &&
          (targetSong.cropBox.left > 0.001 || targetSong.cropBox.top > 0.001 ||
           targetSong.cropBox.right < 0.999 || targetSong.cropBox.bottom < 0.999)
          ? targetSong.cropBox : null;
        const srcX = cb ? cb.left  * img.width  : 0;
        const srcY = cb ? cb.top   * img.height : 0;
        const srcW = cb ? (cb.right  - cb.left)  * img.width  : img.width;
        const srcH = cb ? (cb.bottom - cb.top)   * img.height : img.height;
        const sc   = Math.min(availW / srcW, availH / srcH) * zoomMul;
        off.width  = Math.round(srcW * sc);
        off.height = Math.round(srcH * sc);
        off.getContext("2d").drawImage(img, srcX, srcY, srcW, srcH, 0, 0, off.width, off.height);
      }
      if (off.width > 0 && off.height > 0) {
        if (typeof createImageBitmap === "function") {
          // GPU-resident texture: drawImage(ImageBitmap) is a zero-copy GPU blit
          createImageBitmap(off).then(bmp => { preBitmapRef.current[id] = bmp; });
        } else {
          preBitmapRef.current[id] = off;
        }
      }
    } catch { /* ignore — 다음 기회에 다시 시도 */ }
    finally { preRenderBusy.current.delete(id); }
  };

  // 페이지 렌더링 — 컨테이너에 꼭 맞게 (Piascore 스타일: 패딩 없이 슬롯 꽉 채움)
  const renderPage = useCallback(async () => {
    if (!cSize.w || !cSize.h) return;
    const dualLeftCrop  = svcSongs[dualIdx]?.cropBox     || null;
    const dualRightCrop = svcSongs[dualIdx + 1]?.cropBox || null;
    try {
      if (dual) {
        // 듀얼: 좌우 두 곡 — 슬롯 크기 그대로 사용
        const halfW  = Math.floor(cSize.w / 2);
        const availH = cSize.h;
        const renderTo = async (ref, drawRef, strokesRef2, teamDrawRef, teamStrokesRef2, pdfDoc, imgObj, pdfPageNum = 1, cropBox = null) => {
          if (!ref.current) return;
          if (!pdfDoc && !imgObj) { ref.current.width = 0; ref.current.height = 0; return; }
          if (imgObj && !pdfDoc) {
            // image song — apply cropBox if present
            const hasCb = cropBox && (cropBox.left > 0.001 || cropBox.top > 0.001 || cropBox.right < 0.999 || cropBox.bottom < 0.999);
            const srcX  = hasCb ? cropBox.left  * imgObj.width  : 0;
            const srcY  = hasCb ? cropBox.top   * imgObj.height : 0;
            const srcW  = hasCb ? (cropBox.right - cropBox.left) * imgObj.width  : imgObj.width;
            const srcH  = hasCb ? (cropBox.bottom - cropBox.top) * imgObj.height : imgObj.height;
            const scale = Math.min(halfW / srcW, availH / srcH) * zoomMul;
            const dW = Math.round(srcW * scale);
            const dH = Math.round(srcH * scale);
            const off = document.createElement("canvas");
            off.width = dW; off.height = dH;
            off.getContext("2d").drawImage(imgObj, srcX, srcY, srcW, srcH, 0, 0, dW, dH);
            ref.current.width  = dW;
            ref.current.height = dH;
            ref.current.getContext("2d").drawImage(off, 0, 0);
          } else {
            await renderWithCrop(ref.current, pdfDoc, pdfPageNum, cropBox, halfW, availH);
          }
          if (drawRef.current) {
            drawRef.current.width  = ref.current.width;
            drawRef.current.height = ref.current.height;
            drawStrokes(drawRef.current, strokesRef2.current);
          }
          if (teamDrawRef.current) {
            teamDrawRef.current.width  = ref.current.width;
            teamDrawRef.current.height = ref.current.height;
            if (teamStrokesRef2.current.length > 0) drawStrokes(teamDrawRef.current, teamStrokesRef2.current);
          }
        };
        await renderTo(canvas1Ref, drawCanvas1Ref, strokes1Ref, teamDrawCanvas1Ref, teamStrokes1Ref, dualPdf1Ref.current, dualImg1Ref.current, dualLeftPage,  dualLeftCrop);
        await renderTo(canvas2Ref, drawCanvas2Ref, strokes2Ref, teamDrawCanvas2Ref, teamStrokes2Ref, dualPdf2Ref.current, dualImg2Ref.current, dualRightPage, dualRightCrop);
        // 듀얼 모드 포인터 캔버스 크기 동기화
        if (pointerCanvas1Ref.current && canvas1Ref.current?.width) {
          pointerCanvas1Ref.current.width  = canvas1Ref.current.width;
          pointerCanvas1Ref.current.height = canvas1Ref.current.height;
          if (pointerStrokesRef.current.length > 0) drawPointerStrokes(pointerCanvas1Ref.current, pointerStrokesRef.current, pointerLiveRef.current);
        }
        if (pointerCanvas2Ref.current && canvas2Ref.current?.width) {
          pointerCanvas2Ref.current.width  = canvas2Ref.current.width;
          pointerCanvas2Ref.current.height = canvas2Ref.current.height;
          if (pointerStrokesRef.current.length > 0) drawPointerStrokes(pointerCanvas2Ref.current, pointerStrokesRef.current, pointerLiveRef.current);
        }
        // 듀얼 FIT 모드: 새 곡 쌍이 렌더된 직후 좌/우 양쪽 분석 후 재적용
        if (needsFitRef.current) {
          needsFitRef.current = false;
          const PAD = 16;
          const fw = Math.floor(cSize.w / 2); // dual renders pad=0, so slot = full half width
          const fh = cSize.h;
          let best = Infinity;
          for (const [pc, dc] of [
            [canvas1Ref.current, drawCanvas1Ref.current],
            [canvas2Ref.current, drawCanvas2Ref.current],
          ]) {
            const b = detectContentBounds(pc, dc);
            if (!b) continue;
            const r = Math.min(fw / (b.x1 - b.x0 + PAD * 2), fh / (b.y1 - b.y0 + PAD * 2));
            if (r < best) best = r;
          }
          if (isFinite(best)) {
            const newZoom = Math.min(3.0, Math.max(0.5, parseFloat((zoomMul * best).toFixed(2))));
            if (Math.abs(newZoom - zoomMul) > 0.02) setZoomMul(newZoom);
          }
        }
      } else {
        // 싱글: 이미지 악보 렌더 (패딩 8px 유지 — FIT panOffset과 center 정렬 기준 맞춤)
        if (!pdfDocRef.current && imageRef.current && canvas1Ref.current) {
          const img    = imageRef.current;
          const availW = cSize.w - 16;
          const availH = cSize.h - 16;
          const cb     = song?.cropBox;
          const hasCb  = cb && (cb.left > 0.001 || cb.top > 0.001 || cb.right < 0.999 || cb.bottom < 0.999);
          let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;
          if (hasCb) { srcX = cb.left*img.width; srcY = cb.top*img.height; srcW = (cb.right-cb.left)*img.width; srcH = (cb.bottom-cb.top)*img.height; }
          const scale  = Math.min(availW / srcW, availH / srcH) * zoomMul;
          const dW = Math.round(srcW * scale);
          const dH = Math.round(srcH * scale);
          const off = document.createElement("canvas");
          off.width = dW; off.height = dH;
          off.getContext("2d").drawImage(img, srcX, srcY, srcW, srcH, 0, 0, dW, dH);
          const c = canvas1Ref.current;
          c.width = dW; c.height = dH;
          c.getContext("2d").drawImage(off, 0, 0);
          if (drawCanvas1Ref.current) {
            drawCanvas1Ref.current.width  = dW;
            drawCanvas1Ref.current.height = dH;
            drawStrokes(drawCanvas1Ref.current, strokes1Ref.current);
          }
          if (teamDrawCanvas1Ref.current) {
            teamDrawCanvas1Ref.current.width  = dW;
            teamDrawCanvas1Ref.current.height = dH;
            if (teamStrokes1Ref.current.length > 0) drawStrokes(teamDrawCanvas1Ref.current, teamStrokes1Ref.current);
          }
          return;
        }
        // 싱글: PDF 한 페이지 꽉 맞춤
        if (!pdfDocRef.current || !canvas1Ref.current) return;
        const availW = cSize.w - 16;
        const availH = cSize.h - 16;
        await renderWithCrop(canvas1Ref.current, pdfDocRef.current, pageNum, song?.cropBox || null, availW, availH);
        if (drawCanvas1Ref.current) {
          drawCanvas1Ref.current.width  = canvas1Ref.current.width;
          drawCanvas1Ref.current.height = canvas1Ref.current.height;
          drawStrokes(drawCanvas1Ref.current, strokes1Ref.current);
        }
        if (teamDrawCanvas1Ref.current) {
          teamDrawCanvas1Ref.current.width  = canvas1Ref.current.width;
          teamDrawCanvas1Ref.current.height = canvas1Ref.current.height;
          if (teamStrokes1Ref.current.length > 0) drawStrokes(teamDrawCanvas1Ref.current, teamStrokes1Ref.current);
        }
        if (pointerCanvas1Ref.current) {
          pointerCanvas1Ref.current.width  = canvas1Ref.current.width;
          pointerCanvas1Ref.current.height = canvas1Ref.current.height;
          if (pointerStrokesRef.current.length > 0) drawPointerStrokes(pointerCanvas1Ref.current, pointerStrokesRef.current, pointerLiveRef.current);
        }
        // 싱글 FIT 모드: 새 페이지/곡 렌더 직후 콘텐츠 자동 맞춤
        if (singleNeedsFitRef.current) {
          singleNeedsFitRef.current = false;
          const b = detectContentBounds(canvas1Ref.current, drawCanvas1Ref.current);
          if (b) {
            const PAD = 24;
            const cw = b.x1 - b.x0 + PAD * 2;
            const ch = b.y1 - b.y0 + PAD * 2;
            const ratio = Math.min((cSize.w - 16) / cw, (cSize.h - 16) / ch);
            const newZoom = Math.min(3.0, Math.max(0.5, parseFloat((zoomMul * ratio).toFixed(2))));
            if (Math.abs(newZoom - zoomMul) > 0.02) {
              const r = newZoom / zoomMul;
              const cx = (b.x0 + b.x1) / 2;
              const cy = (b.y0 + b.y1) / 2;
              setZoomMul(newZoom);
              setPanOffset({ x: r * (b.W / 2 - cx), y: r * (b.H / 2 - cy) });
            }
          }
        }
      }
    } catch(e) { console.error(e); }
  }, [pageNum, zoomMul, dual, numPages, cSize, dualKey, song]);

  useEffect(() => { renderPage(); }, [renderPage, numPages]);

  // 팀 스트로크 도착 시 캔버스에 즉시 재드로우
  useEffect(() => {
    if (!hasTeamStrokes) return;
    if (!dual) {
      drawTeamStrokes(teamDrawCanvas1Ref, teamStrokes1Ref.current);
    } else {
      drawTeamStrokes(teamDrawCanvas1Ref, teamStrokes1Ref.current);
      drawTeamStrokes(teamDrawCanvas2Ref, teamStrokes2Ref.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTeamStrokes, dual]);

  // 듀얼 FIT 모드: dualIdx 변경(새 곡 쌍으로 이동)시 다음 렌더 후 재적용 예약
  useEffect(() => {
    if (dual && dualFitModeRef.current) needsFitRef.current = true;
  }, [dualIdx, dual]);

  // 싱글 FIT 모드: 페이지/곡 변경 시 다음 렌더 후 자동 맞춤 예약
  useEffect(() => {
    if (!dual && singleFitModeRef.current) singleNeedsFitRef.current = true;
  }, [selectedSongId, pageNum, dual]);

  // 인접 곡 미리 렌더 (싱글 모드) — 현재 곡 렌더 완료 후 백그라운드 실행
  useEffect(() => {
    if (dual || !cSize.w || !cSize.h) return;
    const prev = svcSongs[songIdx - 1];
    const next = svcSongs[songIdx + 1];
    // single mode renders at cSize.w-16, pass that as slotW for consistent bitmaps
    if (prev) preRenderSongToCache(prev, cSize.w - 16);
    if (next) preRenderSongToCache(next, cSize.w - 16);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSongId, dual, cSize.w, cSize.h, zoomMul, pdfjsReady]);

  // 인접 곡 미리 렌더 (듀얼 모드) — 슬롯 너비 절반 전달
  useEffect(() => {
    if (!dual || !cSize.w || !cSize.h) return;
    const halfW = Math.floor(cSize.w / 2);
    [svcSongs[dualIdx - 1], svcSongs[dualIdx + 2], svcSongs[dualIdx + 3]]
      .filter(Boolean)
      .forEach(s => preRenderSongToCache(s, halfW));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualIdx, dual, cSize.w, cSize.h, zoomMul, pdfjsReady]);

  const showToast = useCallback((msg) => {
    setDualToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setDualToast(""), 1000);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      // 브라우저 기본값 사용 — Safari: audio/mp4, Chrome: audio/webm
      const mr = new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const actualType = mr.mimeType || "audio/webm";
        const blob = new Blob(recChunksRef.current, { type: actualType });
        const secs = recSecondsRef.current;
        await saveRecToDB(blob, {
          songId: selectedSongId, songTitle: song?.title || "알 수 없음",
          key: song?.key || "", bpm: song?.bpm || "",
          pageNum, duration: secs, size: blob.size,
          recMode: recModeRef.current,
        });
        setRecCount(p => p + 1);
        showToast("녹음이 저장되었습니다 🎙️");
      };
      mr.start(1000);
      mediaRecRef.current = mr;
      setRecording(true);
      setRecSeconds(0);
      recSecondsRef.current = 0;
      recTimerRef.current = setInterval(() => {
        recSecondsRef.current += 1;
        setRecSeconds(recSecondsRef.current);
      }, 1000);
    } catch(e) {
      const denied = e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError";
      showToast(denied
        ? "마이크 권한이 거부됨 — iPad 설정 > Safari > 마이크에서 허용해주세요"
        : "마이크를 사용할 수 없습니다: " + (e?.message || e));
    }
  };

  const stopRecording = () => {
    if (mediaRecRef.current?.state === "recording") {
      mediaRecRef.current.stop();
      mediaRecRef.current = null;
    }
    clearInterval(recTimerRef.current);
    setRecording(false);
  };

  const dualPrev = useCallback(() => {
    if (dualIdx <= 0) { showToast("첫번째 곡입니다"); return; }
    const l = svcSongs[dualIdx - 1];
    const r = svcSongs[dualIdx];
    if (l) flashBitmap(l.id, canvas1Ref, drawCanvas1Ref);
    if (r) flashBitmap(r.id, canvas2Ref, drawCanvas2Ref);
    slideAnimate(-1); // slides in from left
    setDualIdx(i => i - 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualIdx, svcSongs, showToast]);

  const dualNext = useCallback(() => {
    if (dualIdx >= svcSongs.length - 1) { showToast("마지막 곡입니다"); return; }
    const l = svcSongs[dualIdx + 1];
    const r = svcSongs[dualIdx + 2];
    if (l) flashBitmap(l.id, canvas1Ref, drawCanvas1Ref);
    if (r) flashBitmap(r.id, canvas2Ref, drawCanvas2Ref);
    slideAnimate(1); // slides in from right
    setDualIdx(i => i + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualIdx, svcSongs, showToast]);

  const handleTouchStart = (e) => {
    // 2손가락 핀치줌 — 필기 중에도 동작
    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      pinchStartDist.current = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      pinchStartZoom.current = zoomMul;
      touchStartX.current = null;
      return;
    }
    if (drawModeRef.current) return;
    if (penDownRef.current) return;
    if (e.touches.length > 1) { touchStartX.current = null; return; }
    if (zoomMul > 1.01) {
      // 확대 상태: 패닝 시작점 기록 (더블탭 판정용 시간도 포함)
      touchStartX.current    = e.touches[0].clientX;
      touchStartY.current    = e.touches[0].clientY;
      touchStartTime.current = Date.now();
      return;
    }
    touchStartX.current    = e.touches[0].clientX;
    touchStartY.current    = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    touchFired.current     = false;
  };

  const triggerSwipe = (delta) => {
    if (dual) {
      if (delta < 0) dualNext(); else dualPrev();
    } else if (svcSongs.length > 1 && songIdx >= 0) {
      // 서비스 모드: 곡 간 이동
      if (delta < 0) {
        if (songIdx >= svcSongs.length - 1) { showToast("마지막 곡입니다"); return; }
        const target = svcSongs[songIdx + 1];
        flashBitmap(target.id, canvas1Ref, drawCanvas1Ref);
        slideAnimate(1);
        nav("pdfViewer", { songId: target.id, svcSongIdx: songIdx + 1, backTo });
      } else {
        if (songIdx <= 0) { showToast("첫번째 곡입니다"); return; }
        const target = svcSongs[songIdx - 1];
        flashBitmap(target.id, canvas1Ref, drawCanvas1Ref);
        slideAnimate(-1);
        nav("pdfViewer", { songId: target.id, svcSongIdx: songIdx - 1, backTo });
      }
    } else if (numPages > 1) {
      // 라이브러리 모드 (또는 단일 곡): PDF 페이지 이동
      if (delta < 0) {
        if (pageNum >= numPages) { showToast("마지막 페이지입니다"); return; }
        slideAnimate(1);
        setPageNum(p => p + 1);
      } else {
        if (pageNum <= 1) { showToast("첫번째 페이지입니다"); return; }
        slideAnimate(-1);
        setPageNum(p => p - 1);
      }
    }
  };

  const handleTouchMove = (e) => {
    // 핀치줌 처리 — 필기 중에도 동작
    if (e.touches.length === 2 && pinchStartDist.current !== null) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const ratio = dist / pinchStartDist.current;
      const newZoom = Math.min(3.0, Math.max(1.0, +(pinchStartZoom.current * ratio).toFixed(2)));
      if (newZoom <= 1.0) setPanOffset({ x: 0, y: 0 });
      setZoomMul(newZoom);
      return;
    }
    // 확대 상태 1손가락 → 패닝
    if (zoomMul > 1.01 && e.touches.length === 1 && touchStartX.current !== null) {
      const dx = e.touches[0].clientX - touchStartX.current;
      const dy = e.touches[0].clientY - touchStartY.current;
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      const cont = containerRef.current;
      const cnv  = canvas1Ref.current;
      const maxX = cont && cnv ? Math.max(0, (cnv.offsetWidth  - cont.offsetWidth)  / 2) : 0;
      const maxY = cont && cnv ? Math.max(0, (cnv.offsetHeight - cont.offsetHeight) / 2) : 0;
      setPanOffset(prev => ({
        x: Math.max(-maxX, Math.min(maxX, prev.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, prev.y + dy)),
      }));
      return;
    }
    if (drawModeRef.current) return;
    if (!swipeNav) return;
    if (e.touches.length > 1) { touchStartX.current = null; return; }
    if (touchStartX.current === null || touchFired.current) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // 수평 방향이 수직보다 명확할 때만 반응
    if (Math.abs(dx) < 55 || Math.abs(dy) > Math.abs(dx) * 0.75) return;
    touchFired.current  = true;
    touchStartX.current = null;
    triggerSwipe(dx);
  };

  const handleTouchEnd = (e) => {
    // 핀치 종료
    if (pinchStartDist.current !== null) {
      pinchStartDist.current = null;
      touchStartX.current = null;
      touchFired.current = false;
      return;
    }
    if (drawModeRef.current) return;
    // 확대 상태: 더블탭 → 원래화면 복귀 / 아니면 패닝 종료
    if (zoomMul > 1.01) {
      const now = Date.now();
      const t = e.changedTouches[0];
      const elapsed = now - (touchStartTime.current || 0);
      if (elapsed < 250 && Math.abs(t.clientX - touchStartX.current) < 30
          && Math.abs(t.clientY - touchStartY.current) < 30
          && now - lastTapTime.current < 350) {
        setZoomMul(1.0);
        setPanOffset({ x: 0, y: 0 });
        lastTapTime.current = 0;
      } else {
        lastTapTime.current = now;
      }
      touchStartX.current = null;
      return;
    }
    // touchMove에서 이미 처리된 경우 스킵
    if (touchFired.current || touchStartX.current === null) {
      touchStartX.current = null;
      touchFired.current  = false;
      return;
    }
    const t = e.changedTouches[0];
    const dx      = t.clientX - touchStartX.current;
    const dy      = t.clientY - touchStartY.current;
    const elapsed = Date.now() - (touchStartTime.current || 0);
    const tapX    = t.clientX;
    touchStartX.current    = null;
    touchStartTime.current = null;
    touchFired.current     = false;

    if (swipeNav && Math.abs(dx) >= 55) { triggerSwipe(dx); return; }

    // 탭 존: 빠른 탭(< 250ms) + 거의 움직임 없음 → 좌/우 이동
    if (tapNav && elapsed < 250 && Math.abs(dx) < 30 && Math.abs(dy) < 30) {
      const w = window.innerWidth;
      if (tapX < w * 0.35)      triggerSwipe(1);   // 왼쪽 탭 → 이전
      else if (tapX > w * 0.65) triggerSwipe(-1);  // 오른쪽 탭 → 다음
    }
  };

  const saveNote = async () => {
    if (!noteTxt.trim() || saving) return;
    setSaving(true);
    await onAddAnnotation(effectiveNoteSongId, { text: noteTxt, page: pageNum, x: 0, y: 0, shared: noteShared });
    setNoteTxt(""); setNoteInput(false); setNoteShared(false); setSaving(false);
  };
  const deleteNote = id => onDeleteAnnotation(effectiveNoteSongId, id);

  // 선택된 텍스트/스탬프 삭제
  const selStrokesRef = (sel) => {
    if (!sel) return strokes1Ref;
    return sel.canvasNum === 1
      ? (sel.isTeam ? teamStrokes1Ref : strokes1Ref)
      : (sel.isTeam ? teamStrokes2Ref : strokes2Ref);
  };
  const selCanvasRef = (sel) => {
    if (!sel) return drawCanvas1Ref;
    return sel.canvasNum === 1
      ? (sel.isTeam ? teamDrawCanvas1Ref : drawCanvas1Ref)
      : (sel.isTeam ? teamDrawCanvas2Ref : drawCanvas2Ref);
  };
  const selSaveFn = (sel) => sel?.isTeam ? saveTeamDrawing : saveDrawing;
  const selSongId = (sel) => {
    if (!sel) return selectedSongId;
    return sel.canvasNum === 1 ? (dual ? dualLeftSongId : selectedSongId) : dualRightSongId;
  };
  const selPage = (sel) => sel?.canvasNum === 1
    ? (dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum)
    : (svcSongs[dualIdx + 1]?.pdfPage || 1);

  const deleteSelAnnot = async () => {
    const sel = selAnnotRef.current;
    if (!sel) return;
    const sRef = selStrokesRef(sel);
    const dc   = selCanvasRef(sel);
    const newStrokes = sRef.current.filter((_, i) => i !== sel.idx);
    sRef.current = newStrokes;
    drawStrokes(dc.current, newStrokes);
    await selSaveFn(sel)(selSongId(sel), selPage(sel), newStrokes);
    setSelAnnot(null);
  };

  // 선택된 텍스트/스탬프 크기 조절
  const resizeSelText = async (delta) => {
    const sel = selAnnotRef.current;
    if (!sel) return;
    const sRef = selStrokesRef(sel);
    const dc   = selCanvasRef(sel);
    const s = sRef.current[sel.idx];
    if (!s || (s.tool !== "text" && s.tool !== "stamp")) return;
    const cur = s.tool === "text" ? (s.size || 15) : (s.size || 12);
    const newSize = Math.max(4, Math.min(80, cur + delta));
    const next = sRef.current.map((st, i) =>
      i === sel.idx ? { ...st, size: newSize } : st
    );
    sRef.current = next;
    drawStrokes(dc.current, next, null, sel.idx);
    setSelAnnot({ ...sel });
    await selSaveFn(sel)(selSongId(sel), selPage(sel), next);
  };

  const recolorSelAnnot = async (color) => {
    const sel = selAnnotRef.current;
    if (!sel) return;
    const sRef = selStrokesRef(sel);
    const dc   = selCanvasRef(sel);
    const s = sRef.current[sel.idx];
    if (!s || (s.tool !== "text" && s.tool !== "stamp")) return;
    const next = sRef.current.map((st, i) => i === sel.idx ? { ...st, color } : st);
    sRef.current = next;
    drawStrokes(dc.current, next, null, sel.idx);
    setSelAnnot({ ...sel });
    await selSaveFn(sel)(selSongId(sel), selPage(sel), next);
  };

  // ── Text tool confirm
  const confirmText = useCallback(async () => {
    setTextDot(null);
    if (!textInput || !textInput.value.trim()) { setTextInput(null); return; }
    const isC1 = textInput.canvasNum === 1;
    const isTeam = teamDrawMode;
    const canvas = isC1
      ? (isTeam ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current)
      : (isTeam ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current);
    const strokesRef = isC1
      ? (isTeam ? teamStrokes1Ref : strokes1Ref)
      : (isTeam ? teamStrokes2Ref : strokes2Ref);
    const songId = isC1
      ? (dual ? dualLeftSongId : selectedSongId)
      : (dual ? dualRightSongId : selectedSongId);
    const page = isC1
      ? (dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum)
      : (dual ? (svcSongs[dualIdx + 1]?.pdfPage || 1) : pageNum);
    const textStroke = {
      tool: "text", text: textInput.value.trim(),
      color: activeColor, size: ({ 1: 8, 2: 15, 4: 28 })[drawWidth] || 15,
      points: [{ x: textInput.x, y: textInput.y }],
      ...(isTeam && { team: true }),
    };
    const next = [...strokesRef.current, textStroke];
    strokesRef.current = next;
    if (canvas) drawStrokes(canvas, next);
    await (isTeam ? saveTeamDrawing : saveDrawing)(songId, page, next);
    setTextInput(null);
  }, [textInput, drawColor, drawWidth, dual, dualLeftSongId, dualRightSongId, selectedSongId, pageNum, saveDrawing, saveTeamDrawing, teamDrawMode]);

  // ── Loupe update (stamp mode)
  const updateLoupe = useCallback((e, pdfCanvas, drawCanvas, sym, italic, color, size) => {
    const lc = loupeCanvasRef.current;
    if (!lc || !pdfCanvas || !pdfCanvas.width) return;
    const posRef = drawCanvas || pdfCanvas;
    const r = posRef.getBoundingClientRect();
    if (!r.width) return;
    const scX = pdfCanvas.width  / r.width;
    const scY = pdfCanvas.height / r.height;
    const cx = (e.clientX - r.left) * scX;
    const cy = (e.clientY - r.top)  * scY;
    const ZOOM = 4;                          // 더 큰 줌
    const LW = lc.width, LH = lc.height;
    const srcW = LW / ZOOM, srcH = LH / ZOOM;
    const ctx = lc.getContext("2d");
    ctx.clearRect(0, 0, LW, LH);
    ctx.drawImage(pdfCanvas, cx - srcW / 2, cy - srcH / 2, srcW, srcH, 0, 0, LW, LH);
    if (drawCanvas && drawCanvas.width) {
      ctx.drawImage(drawCanvas, cx - srcW / 2, cy - srcH / 2, srcW, srcH, 0, 0, LW, LH);
    }
    // 십자선 — 수평선만 강하게 (오선지 라인에 정렬하기 쉽게)
    ctx.strokeStyle = "rgba(220,40,40,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, LH / 2); ctx.lineTo(LW - 4, LH / 2);   // 수평 전체
    ctx.stroke();
    ctx.strokeStyle = "rgba(220,40,40,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LW / 2, LH / 2 - 8); ctx.lineTo(LW / 2, LH / 2 + 8); // 수직 짧게
    ctx.stroke();
    // 스탬프 미리보기 — drawStrokes와 동일한 baseline 적용
    if (sym) {
      const actualSz = Math.max(7, (size || 12) * pdfCanvas.width / 450);
      const sz = actualSz * ZOOM;
      ctx.globalAlpha = 0.88;
      if (sym === "notehead") {
        ctx.save();
        ctx.translate(LW / 2, LH / 2);
        ctx.rotate(-28 * Math.PI / 180);
        ctx.beginPath();
        ctx.ellipse(0, 0, sz * 0.17, sz * 0.12, 0, 0, Math.PI * 2);
        ctx.fillStyle = color || "#1c1c1e";
        ctx.fill();
        ctx.restore();
      } else {
        const baseline = getStampBaseline(sym);
        const family = italic ? '"Times New Roman", Georgia, serif' : 'system-ui, sans-serif';
        ctx.font = `${italic ? "italic " : ""}bold ${sz}px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = baseline;
        ctx.fillStyle = color || "#e8383b";
        ctx.fillText(sym, LW / 2, LH / 2);
      }
      ctx.globalAlpha = 1;
    }
  }, []);

  // ── Drawing pointer handlers
  const getCanvasPt = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const TEAM_COLOR = "#347C17";
  const activeColor = teamDrawMode ? TEAM_COLOR : drawColor;

  const makeStroke = () => ({ color: activeColor, width: drawWidth, tool: drawTool, points: [] });

  // ── Canvas 1 handlers (single mode + dual left)
  const handleDraw1Down = (e) => {
    if (e.pointerType === "touch" && !isLiteMode && !["text","stamp","select"].includes(drawTool)) return;
    const canvas = drawCanvas1Ref.current;
    if (!canvas) return;
    e.preventDefault(); e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    lastSideRef.current = 1;
    if (drawTool === "select") {
      const pt = getCanvasPt(e, canvas);
      const HIT = 0.07; // 7% of canvas CSS width ≈ 35–45px touch radius
      let bestIdx = -1, bestDist = HIT;
      const isTeam1 = teamDrawMode;
      const searchStrokes1 = isTeam1 ? teamStrokes1Ref : strokes1Ref;
      const renderCanvas1 = isTeam1 ? (teamDrawCanvas1Ref.current || canvas) : canvas;
      searchStrokes1.current.forEach((s, i) => {
        if (s.tool !== "text" && s.tool !== "stamp") return;
        const sp = s.points?.[0]; if (!sp) return;
        const d = Math.sqrt((sp.x - pt.x)**2 + (sp.y - pt.y)**2);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      if (bestIdx >= 0) {
        const s = searchStrokes1.current[bestIdx];
        const newSel = { idx: bestIdx, canvasNum: 1, isTeam: isTeam1 };
        setSelAnnot(newSel); selAnnotRef.current = newSel;
        selDragRef.current = { startX: pt.x, startY: pt.y, origX: s.points[0].x, origY: s.points[0].y };
        drawStrokes(renderCanvas1, searchStrokes1.current, null, bestIdx);
      } else {
        setSelAnnot(null); selAnnotRef.current = null;
        selDragRef.current = null;
        drawStrokes(renderCanvas1, searchStrokes1.current);
      }
      return;
    }
    if (drawTool === "text") {
      const pt = getCanvasPt(e, canvas);
      setTextDot({ sx: e.clientX, sy: e.clientY });
      setTextInput({ x: pt.x, y: pt.y, value: "", canvasNum: 1 });
      return;
    }
    if (drawTool === "stamp") {
      const pt = getCanvasPt(e, canvas);
      // Hit-test existing stamps — tap existing to select & show resize panel
      const sRef1s = teamDrawMode ? teamStrokes1Ref : strokes1Ref;
      let bestIdx1 = -1, bestDist1 = 0.05;
      sRef1s.current.forEach((s, i) => {
        if (s.tool !== "stamp") return;
        const sp = s.points?.[0]; if (!sp) return;
        const d = Math.sqrt((sp.x - pt.x)**2 + (sp.y - pt.y)**2);
        if (d < bestDist1) { bestDist1 = d; bestIdx1 = i; }
      });
      if (bestIdx1 >= 0) {
        const newSel = { idx: bestIdx1, canvasNum: 1, isTeam: teamDrawMode };
        setSelAnnot(newSel); selAnnotRef.current = newSel;
        const sp = sRef1s.current[bestIdx1].points[0];
        selDragRef.current = { startX: pt.x, startY: pt.y, origX: sp.x, origY: sp.y };
        const rect1s = canvas.getBoundingClientRect();
        setStampPanel({ x: rect1s.left + sp.x * rect1s.width, y: rect1s.top + sp.y * rect1s.height });
        const rc1s = teamDrawMode ? (teamDrawCanvas1Ref.current || canvas) : canvas;
        drawStrokes(rc1s, sRef1s.current, null, bestIdx1);
        return;
      }
      // No hit — place new stamp
      setStampPanel(null); selAnnotRef.current = null; selDragRef.current = null;
      stampPressed1Ref.current = true;
      lastPt1Ref.current = pt;
      updateLoupe(e, canvas1Ref.current, canvas, stampSymbol, stampItalic, drawColor, stampSize);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape") {
      const pt = getCanvasPt(e, canvas);
      shapeStart1Ref.current = pt;
      curStroke1Ref.current = { tool: shapeTool, points: [pt], color: activeColor, width: drawWidth };
      return;
    }
    isDrawing1Ref.current = true;
    curStroke1Ref.current = { ...makeStroke(), points: [getCanvasPt(e, canvas)] };
    { const rc = teamDrawMode && teamDrawCanvas1Ref.current ? teamDrawCanvas1Ref.current : canvas;
      drawStrokes(rc, teamDrawMode ? teamStrokes1Ref.current : strokes1Ref.current, curStroke1Ref.current); }
  };
  const handleDraw1Move = (e) => {
    if (e.pointerType === "touch" && !isLiteMode && drawTool !== "select" && !(drawTool === "stamp" && selDragRef.current)) return;
    const canvas = drawCanvas1Ref.current;
    if (!canvas) return;
    e.preventDefault();
    if (drawTool === "select" || (drawTool === "stamp" && selDragRef.current && selAnnotRef.current?.canvasNum === 1)) {
      if (!selDragRef.current || selAnnotRef.current?.canvasNum !== 1) return;
      const pt = getCanvasPt(e, canvas);
      const { startX, startY, origX, origY } = selDragRef.current;
      const newX = Math.max(0.01, Math.min(0.99, origX + (pt.x - startX)));
      const newY = Math.max(0.01, Math.min(0.99, origY + (pt.y - startY)));
      const idx = selAnnotRef.current.idx;
      const sRef1m = selAnnotRef.current.isTeam ? teamStrokes1Ref : strokes1Ref;
      const dc1m = selAnnotRef.current.isTeam ? (teamDrawCanvas1Ref.current || canvas) : canvas;
      sRef1m.current = sRef1m.current.map((s, i) =>
        i === idx ? { ...s, points: [{ x: newX, y: newY }] } : s
      );
      drawStrokes(dc1m, sRef1m.current, null, idx);
      if (drawTool === "stamp") {
        const rect1d = canvas.getBoundingClientRect();
        setStampPanel({ x: rect1d.left + newX * rect1d.width, y: rect1d.top + newY * rect1d.height });
      }
      return;
    }
    if (drawTool === "text") {
      if (!textInput) setTextDot({ sx: e.clientX, sy: e.clientY });
      return;
    }
    if (drawTool === "stamp") {
      if (!stampPressed1Ref.current && e.buttons === 0) return; // pencil hover - ignore
      lastPt1Ref.current = getCanvasPt(e, canvas);
      updateLoupe(e, canvas1Ref.current, canvas, stampSymbol, stampItalic, drawColor, stampSize);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape" && shapeStart1Ref.current) {
      const pt = getCanvasPt(e, canvas);
      curStroke1Ref.current = { tool: shapeTool, points: [shapeStart1Ref.current, pt], color: activeColor, width: drawWidth };
      { const rc = teamDrawMode && teamDrawCanvas1Ref.current ? teamDrawCanvas1Ref.current : canvas;
        drawStrokes(rc, teamDrawMode ? teamStrokes1Ref.current : strokes1Ref.current, curStroke1Ref.current); }
      return;
    }
    if (!isDrawing1Ref.current || !curStroke1Ref.current) return;
    curStroke1Ref.current.points.push(getCanvasPt(e, canvas));
    { const rc = teamDrawMode && teamDrawCanvas1Ref.current ? teamDrawCanvas1Ref.current : canvas;
      drawStrokes(rc, teamDrawMode ? teamStrokes1Ref.current : strokes1Ref.current, curStroke1Ref.current); }
  };
  const handleDraw1Up = async (e) => {
    if (drawTool === "select") {
      if (selDragRef.current && selAnnotRef.current?.canvasNum === 1) {
        selDragRef.current = null;
        const sRef1u = selAnnotRef.current.isTeam ? teamStrokes1Ref : strokes1Ref;
        const dc1u = selAnnotRef.current.isTeam ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current;
        const songId = dual ? dualLeftSongId : selectedSongId;
        await (selAnnotRef.current.isTeam ? saveTeamDrawing : saveDrawing)(songId, dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum, sRef1u.current);
        if (dc1u) drawStrokes(dc1u, sRef1u.current, null, selAnnotRef.current.idx);
      }
      return;
    }
    if (drawTool === "stamp") {
      setLoupePos(null);
      // If dragging an existing stamp — save position and keep panel
      if (selDragRef.current && selAnnotRef.current?.canvasNum === 1) {
        selDragRef.current = null;
        const sRefUp1 = selAnnotRef.current.isTeam ? teamStrokes1Ref : strokes1Ref;
        const dcUp1 = selAnnotRef.current.isTeam ? (teamDrawCanvas1Ref.current || drawCanvas1Ref.current) : drawCanvas1Ref.current;
        const songIdUp1 = dual ? dualLeftSongId : selectedSongId;
        await (selAnnotRef.current.isTeam ? saveTeamDrawing : saveDrawing)(songIdUp1, dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum, sRefUp1.current);
        if (dcUp1) drawStrokes(dcUp1, sRefUp1.current, null, selAnnotRef.current.idx);
        return;
      }
      if (!stampPressed1Ref.current) return; // hover exit or stamp-select tap — not a real placement
      stampPressed1Ref.current = false;
      setStampPanel(null);
      setSelAnnot(null); selAnnotRef.current = null;
      const canvas = teamDrawMode ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current;
      if (!canvas) return;
      const coordCanvas = drawCanvas1Ref.current || canvas;
      const pt = e ? getCanvasPt(e, coordCanvas) : lastPt1Ref.current;
      const stamp = { tool:"stamp", symbol:stampSymbol, italic:stampItalic,
        color:activeColor, size:stampSize, bg:stampBg, points:[pt], ...(teamDrawMode && { team: true }) };
      const sRef1 = teamDrawMode ? teamStrokes1Ref : strokes1Ref;
      const next = [...sRef1.current, stamp];
      sRef1.current = next;
      drawStrokes(canvas, next);
      const songId = dual ? dualLeftSongId : selectedSongId;
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(songId, dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum, next);
      return;
    }
    if (drawTool === "shape") {
      const shape = curStroke1Ref.current;
      curStroke1Ref.current = null;
      shapeStart1Ref.current = null;
      const sRef1 = teamDrawMode ? teamStrokes1Ref : strokes1Ref;
      if (!shape || shape.points.length < 2) {
        const canvas = teamDrawMode ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current;
        if (canvas) drawStrokes(canvas, sRef1.current);
        return;
      }
      const committedShape1 = teamDrawMode ? { ...shape, team: true } : shape;
      const next = [...sRef1.current, committedShape1];
      sRef1.current = next;
      const songId = dual ? dualLeftSongId : selectedSongId;
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(songId, dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum, next);
      const canvas = teamDrawMode ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current;
      if (canvas) drawStrokes(canvas, next);
      return;
    }
    if (!isDrawing1Ref.current || !curStroke1Ref.current) return;
    isDrawing1Ref.current = false;
    const stroke = curStroke1Ref.current;
    curStroke1Ref.current = null;
    const sRef1 = teamDrawMode ? teamStrokes1Ref : strokes1Ref;
    if (stroke.points.length > 0) {
      const committed1 = teamDrawMode ? { ...stroke, team: true } : stroke;
      const next = [...sRef1.current, committed1];
      sRef1.current = next;
      const songId = dual ? dualLeftSongId : selectedSongId;
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(songId, dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum, next);
    }
    { const canvas = teamDrawMode ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current;
      if (canvas) drawStrokes(canvas, sRef1.current); }
  };
  const handleDraw1Cancel = () => {
    setLoupePos(null);
    stampPressed1Ref.current = false;
    shapeStart1Ref.current = null;
    isDrawing1Ref.current = false; curStroke1Ref.current = null;
    selDragRef.current = null;
    const sel1 = selAnnotRef.current?.canvasNum === 1 ? selAnnotRef.current : null;
    const useTeam1 = sel1 ? !!sel1.isTeam : teamDrawMode;
    const canvas = useTeam1 ? (teamDrawCanvas1Ref.current || drawCanvas1Ref.current) : drawCanvas1Ref.current;
    const sRef1c = useTeam1 ? teamStrokes1Ref : strokes1Ref;
    const selIdx1 = sel1 ? sel1.idx : -1;
    if (canvas) drawStrokes(canvas, sRef1c.current, null, selIdx1);
  };

  // ── Canvas 2 handlers (dual right)
  const handleDraw2Down = (e) => {
    if (e.pointerType === "touch" && !["text","stamp","select"].includes(drawTool)) return;
    const canvas = drawCanvas2Ref.current;
    if (!canvas) return;
    e.preventDefault(); e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    lastSideRef.current = 2;
    if (drawTool === "select") {
      const pt = getCanvasPt(e, canvas);
      const HIT = 0.07;
      let bestIdx = -1, bestDist = HIT;
      const isTeam2 = teamDrawMode;
      const searchStrokes2 = isTeam2 ? teamStrokes2Ref : strokes2Ref;
      const renderCanvas2 = isTeam2 ? (teamDrawCanvas2Ref.current || canvas) : canvas;
      searchStrokes2.current.forEach((s, i) => {
        if (s.tool !== "text" && s.tool !== "stamp") return;
        const sp = s.points?.[0]; if (!sp) return;
        const d = Math.sqrt((sp.x - pt.x)**2 + (sp.y - pt.y)**2);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      if (bestIdx >= 0) {
        const s = searchStrokes2.current[bestIdx];
        const newSel = { idx: bestIdx, canvasNum: 2, isTeam: isTeam2 };
        setSelAnnot(newSel); selAnnotRef.current = newSel;
        selDragRef.current = { startX: pt.x, startY: pt.y, origX: s.points[0].x, origY: s.points[0].y };
        drawStrokes(renderCanvas2, searchStrokes2.current, null, bestIdx);
      } else {
        setSelAnnot(null); selAnnotRef.current = null;
        selDragRef.current = null;
        drawStrokes(renderCanvas2, searchStrokes2.current);
      }
      return;
    }
    if (drawTool === "text") {
      const pt = getCanvasPt(e, canvas);
      setTextDot({ sx: e.clientX, sy: e.clientY });
      setTextInput({ x: pt.x, y: pt.y, value: "", canvasNum: 2 });
      return;
    }
    if (drawTool === "stamp") {
      const pt = getCanvasPt(e, canvas);
      // Hit-test existing stamps on canvas 2
      const sRef2s = teamDrawMode ? teamStrokes2Ref : strokes2Ref;
      let bestIdx2 = -1, bestDist2 = 0.05;
      sRef2s.current.forEach((s, i) => {
        if (s.tool !== "stamp") return;
        const sp = s.points?.[0]; if (!sp) return;
        const d = Math.sqrt((sp.x - pt.x)**2 + (sp.y - pt.y)**2);
        if (d < bestDist2) { bestDist2 = d; bestIdx2 = i; }
      });
      if (bestIdx2 >= 0) {
        const newSel = { idx: bestIdx2, canvasNum: 2, isTeam: teamDrawMode };
        setSelAnnot(newSel); selAnnotRef.current = newSel;
        const sp = sRef2s.current[bestIdx2].points[0];
        selDragRef.current = { startX: pt.x, startY: pt.y, origX: sp.x, origY: sp.y };
        const rect2s = canvas.getBoundingClientRect();
        setStampPanel({ x: rect2s.left + sp.x * rect2s.width, y: rect2s.top + sp.y * rect2s.height });
        const rc2s = teamDrawMode ? (teamDrawCanvas2Ref.current || canvas) : canvas;
        drawStrokes(rc2s, sRef2s.current, null, bestIdx2);
        return;
      }
      // No hit — place new stamp
      setStampPanel(null); selAnnotRef.current = null; selDragRef.current = null;
      stampPressed2Ref.current = true;
      lastPt2Ref.current = pt;
      updateLoupe(e, canvas2Ref.current, canvas, stampSymbol, stampItalic, drawColor, stampSize);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape") {
      const pt = getCanvasPt(e, canvas);
      shapeStart2Ref.current = pt;
      curStroke2Ref.current = { tool: shapeTool, points: [pt], color: activeColor, width: drawWidth };
      return;
    }
    isDrawing2Ref.current = true;
    curStroke2Ref.current = { ...makeStroke(), points: [getCanvasPt(e, canvas)] };
    { const rc = teamDrawMode && teamDrawCanvas2Ref.current ? teamDrawCanvas2Ref.current : canvas;
      drawStrokes(rc, teamDrawMode ? teamStrokes2Ref.current : strokes2Ref.current, curStroke2Ref.current); }
  };
  const handleDraw2Move = (e) => {
    if (e.pointerType === "touch" && drawTool !== "select" && !(drawTool === "stamp" && selDragRef.current)) return;
    const canvas = drawCanvas2Ref.current;
    if (!canvas) return;
    e.preventDefault();
    if (drawTool === "select" || (drawTool === "stamp" && selDragRef.current && selAnnotRef.current?.canvasNum === 2)) {
      if (!selDragRef.current || selAnnotRef.current?.canvasNum !== 2) return;
      const pt = getCanvasPt(e, canvas);
      const { startX, startY, origX, origY } = selDragRef.current;
      const newX = Math.max(0.01, Math.min(0.99, origX + (pt.x - startX)));
      const newY = Math.max(0.01, Math.min(0.99, origY + (pt.y - startY)));
      const idx = selAnnotRef.current.idx;
      const sRef2m = selAnnotRef.current.isTeam ? teamStrokes2Ref : strokes2Ref;
      const dc2m = selAnnotRef.current.isTeam ? (teamDrawCanvas2Ref.current || canvas) : canvas;
      sRef2m.current = sRef2m.current.map((s, i) =>
        i === idx ? { ...s, points: [{ x: newX, y: newY }] } : s
      );
      drawStrokes(dc2m, sRef2m.current, null, idx);
      if (drawTool === "stamp") {
        const rect2d = canvas.getBoundingClientRect();
        setStampPanel({ x: rect2d.left + newX * rect2d.width, y: rect2d.top + newY * rect2d.height });
      }
      return;
    }
    if (drawTool === "text") {
      if (!textInput) setTextDot({ sx: e.clientX, sy: e.clientY });
      return;
    }
    if (drawTool === "stamp") {
      if (!stampPressed2Ref.current && e.buttons === 0) return; // pencil hover - ignore
      lastPt2Ref.current = getCanvasPt(e, canvas);
      updateLoupe(e, canvas2Ref.current, canvas, stampSymbol, stampItalic, drawColor, stampSize);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape" && shapeStart2Ref.current) {
      const pt = getCanvasPt(e, canvas);
      curStroke2Ref.current = { tool: shapeTool, points: [shapeStart2Ref.current, pt], color: activeColor, width: drawWidth };
      { const rc = teamDrawMode && teamDrawCanvas2Ref.current ? teamDrawCanvas2Ref.current : canvas;
        drawStrokes(rc, teamDrawMode ? teamStrokes2Ref.current : strokes2Ref.current, curStroke2Ref.current); }
      return;
    }
    if (!isDrawing2Ref.current || !curStroke2Ref.current) return;
    curStroke2Ref.current.points.push(getCanvasPt(e, canvas));
    { const rc = teamDrawMode && teamDrawCanvas2Ref.current ? teamDrawCanvas2Ref.current : canvas;
      drawStrokes(rc, teamDrawMode ? teamStrokes2Ref.current : strokes2Ref.current, curStroke2Ref.current); }
  };
  const handleDraw2Up = async (e) => {
    if (drawTool === "select") {
      if (selDragRef.current && selAnnotRef.current?.canvasNum === 2) {
        selDragRef.current = null;
        const sRef2u = selAnnotRef.current.isTeam ? teamStrokes2Ref : strokes2Ref;
        const dc2u = selAnnotRef.current.isTeam ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current;
        await (selAnnotRef.current.isTeam ? saveTeamDrawing : saveDrawing)(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, sRef2u.current);
        if (dc2u) drawStrokes(dc2u, sRef2u.current, null, selAnnotRef.current.idx);
      }
      return;
    }
    if (drawTool === "stamp") {
      setLoupePos(null);
      // If dragging an existing stamp — save position and keep panel
      if (selDragRef.current && selAnnotRef.current?.canvasNum === 2) {
        selDragRef.current = null;
        const sRefUp2 = selAnnotRef.current.isTeam ? teamStrokes2Ref : strokes2Ref;
        const dcUp2 = selAnnotRef.current.isTeam ? (teamDrawCanvas2Ref.current || drawCanvas2Ref.current) : drawCanvas2Ref.current;
        await (selAnnotRef.current.isTeam ? saveTeamDrawing : saveDrawing)(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, sRefUp2.current);
        if (dcUp2) drawStrokes(dcUp2, sRefUp2.current, null, selAnnotRef.current.idx);
        return;
      }
      if (!stampPressed2Ref.current) return; // hover exit or stamp-select tap — not a real placement
      stampPressed2Ref.current = false;
      setStampPanel(null);
      setSelAnnot(null); selAnnotRef.current = null;
      const canvas = teamDrawMode ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current;
      if (!canvas) return;
      const coordCanvas = drawCanvas2Ref.current || canvas;
      const pt = e ? getCanvasPt(e, coordCanvas) : lastPt2Ref.current;
      const stamp = { tool:"stamp", symbol:stampSymbol, italic:stampItalic,
        color:activeColor, size:stampSize, bg:stampBg, points:[pt], ...(teamDrawMode && { team: true }) };
      const sRef2 = teamDrawMode ? teamStrokes2Ref : strokes2Ref;
      const next = [...sRef2.current, stamp];
      sRef2.current = next;
      drawStrokes(canvas, next);
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, next);
      return;
    }
    if (drawTool === "shape") {
      const shape = curStroke2Ref.current;
      curStroke2Ref.current = null;
      shapeStart2Ref.current = null;
      const sRef2 = teamDrawMode ? teamStrokes2Ref : strokes2Ref;
      if (!shape || shape.points.length < 2) {
        const canvas = teamDrawMode ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current;
        if (canvas) drawStrokes(canvas, sRef2.current);
        return;
      }
      const committedShape2 = teamDrawMode ? { ...shape, team: true } : shape;
      const next = [...sRef2.current, committedShape2];
      sRef2.current = next;
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, next);
      const canvas = teamDrawMode ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current;
      if (canvas) drawStrokes(canvas, next);
      return;
    }
    if (!isDrawing2Ref.current || !curStroke2Ref.current) return;
    isDrawing2Ref.current = false;
    const stroke = curStroke2Ref.current;
    curStroke2Ref.current = null;
    const sRef2 = teamDrawMode ? teamStrokes2Ref : strokes2Ref;
    if (stroke.points.length > 0) {
      const committed2 = teamDrawMode ? { ...stroke, team: true } : stroke;
      const next = [...sRef2.current, committed2];
      sRef2.current = next;
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(dualRightSongId, svcSongs[dualIdx + 1]?.pdfPage || 1, next);
    }
    { const canvas = teamDrawMode ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current;
      if (canvas) drawStrokes(canvas, sRef2.current); }
  };
  const handleDraw2Cancel = () => {
    setLoupePos(null);
    stampPressed2Ref.current = false;
    shapeStart2Ref.current = null;
    isDrawing2Ref.current = false; curStroke2Ref.current = null;
    selDragRef.current = null;
    const sel2 = selAnnotRef.current?.canvasNum === 2 ? selAnnotRef.current : null;
    const useTeam2 = sel2 ? !!sel2.isTeam : teamDrawMode;
    const canvas = useTeam2 ? (teamDrawCanvas2Ref.current || drawCanvas2Ref.current) : drawCanvas2Ref.current;
    const sRef2c = useTeam2 ? teamStrokes2Ref : strokes2Ref;
    const selIdx2 = sel2 ? sel2.idx : -1;
    if (canvas) drawStrokes(canvas, sRef2c.current, null, selIdx2);
  };

  // ── Undo: acts on the last-drawn side
  const handleUndo = async () => {
    setSelAnnot(null);
    const side = lastSideRef.current;
    const isTeam = teamDrawMode;
    const sRef  = isTeam ? (side === 2 ? teamStrokes2Ref : teamStrokes1Ref)
                          : (side === 2 ? strokes2Ref     : strokes1Ref);
    const dcRef = isTeam ? (side === 2 ? teamDrawCanvas2Ref : teamDrawCanvas1Ref)
                          : (side === 2 ? drawCanvas2Ref     : drawCanvas1Ref);
    const pRef  = isTeam ? (side === 2 ? preClearTeamRef2 : preClearTeamRef1)
                          : (side === 2 ? preClearRef2     : preClearRef1);
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    const saveFn = isTeam ? saveTeamDrawing : saveDrawing;
    // 필기 삭제 직후라면 스냅샷 복원
    if (sRef.current.length === 0 && pRef.current !== null) {
      const restored = pRef.current;
      pRef.current = null;
      sRef.current = restored;
      await saveFn(songId, dual ? (side === 2 ? (svcSongs[dualIdx + 1]?.pdfPage || 1) : (svcSongs[dualIdx]?.pdfPage || 1)) : pageNum, restored);
      if (dcRef.current) drawStrokes(dcRef.current, restored);
      return;
    }
    if (sRef.current.length === 0) return;
    const next = sRef.current.slice(0, -1);
    sRef.current = next;
    await saveFn(songId, dual ? (side === 2 ? (svcSongs[dualIdx + 1]?.pdfPage || 1) : (svcSongs[dualIdx]?.pdfPage || 1)) : pageNum, next);
    if (dcRef.current) drawStrokes(dcRef.current, next);
  };

  const handleClearPage = () => setClearConfirm(true);

  const confirmClearPage = async () => {
    setClearConfirm(false);
    const side = lastSideRef.current;
    const isTeam = teamDrawMode;
    const sRef  = isTeam ? (side === 2 ? teamStrokes2Ref : teamStrokes1Ref)
                          : (side === 2 ? strokes2Ref     : strokes1Ref);
    const dcRef = isTeam ? (side === 2 ? teamDrawCanvas2Ref : teamDrawCanvas1Ref)
                          : (side === 2 ? drawCanvas2Ref     : drawCanvas1Ref);
    const pRef  = isTeam ? (side === 2 ? preClearTeamRef2 : preClearTeamRef1)
                          : (side === 2 ? preClearRef2     : preClearRef1);
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    const clearPage = side === 2
      ? (svcSongs[dualIdx + 1]?.pdfPage || 1)
      : (dual ? (svcSongs[dualIdx]?.pdfPage || 1) : pageNum);
    pRef.current = sRef.current;
    sRef.current = [];
    await (isTeam ? saveTeamDrawing : saveDrawing)(songId, clearPage, []);
    if (dcRef.current) dcRef.current.getContext("2d").clearRect(0, 0, dcRef.current.width, dcRef.current.height);
  };

  const downloadAnnotatedScore = async () => {
    const pdfCanvas = canvas1Ref.current;
    if (!pdfCanvas || !pdfCanvas.width) { showToast("악보가 아직 로드되지 않았습니다"); return; }

    const off = document.createElement("canvas");
    const ctx = off.getContext("2d");

    if (pdfDocRef.current) {
      // PDF: 3× 고해상도 재렌더링
      const EXPORT_SCALE = 3;
      const page = await pdfDocRef.current.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const cb   = song?.cropBox;
      const hasCb = cb && (cb.left > 0.001 || cb.top > 0.001 || cb.right < 0.999 || cb.bottom < 0.999);
      let dW, dH, sc;
      if (hasCb) {
        sc = EXPORT_SCALE * (base.width / ((cb.right - cb.left) * base.width) * 1);
        sc = EXPORT_SCALE;
        dW = Math.round((cb.right - cb.left) * base.width  * EXPORT_SCALE);
        dH = Math.round((cb.bottom - cb.top) * base.height * EXPORT_SCALE);
      } else {
        sc = EXPORT_SCALE;
        dW = Math.round(base.width  * sc);
        dH = Math.round(base.height * sc);
      }
      const vp = page.getViewport({ scale: sc });
      const tmp = document.createElement("canvas");
      tmp.width  = Math.round(vp.width);
      tmp.height = Math.round(vp.height);
      await page.render({ canvasContext: tmp.getContext("2d"), viewport: vp }).promise;
      off.width = dW; off.height = dH;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, dW, dH);
      if (hasCb) {
        ctx.drawImage(tmp, cb.left * vp.width, cb.top * vp.height, dW, dH, 0, 0, dW, dH);
      } else {
        ctx.drawImage(tmp, 0, 0);
      }
    } else if (imageRef.current) {
      // 이미지: 원본 해상도 사용
      const img  = imageRef.current;
      const cb   = song?.cropBox;
      const hasCb = cb && (cb.left > 0.001 || cb.top > 0.001 || cb.right < 0.999 || cb.bottom < 0.999);
      let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;
      if (hasCb) { srcX = cb.left*img.width; srcY = cb.top*img.height; srcW = (cb.right-cb.left)*img.width; srcH = (cb.bottom-cb.top)*img.height; }
      off.width = Math.round(srcW); off.height = Math.round(srcH);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, off.width, off.height);
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, off.width, off.height);
    } else {
      // 폴백: 화면 캔버스 그대로 복사
      off.width = pdfCanvas.width; off.height = pdfCanvas.height;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, off.width, off.height);
      ctx.drawImage(pdfCanvas, 0, 0);
    }

    // 필기 합성 — 스트로크를 최종 캔버스 크기에 맞춰 다시 그림
    const W = off.width, H = off.height;
    const drawTmp = document.createElement("canvas");
    drawTmp.width = W; drawTmp.height = H;
    if (teamStrokes1Ref.current?.length > 0) {
      drawStrokes(drawTmp, teamStrokes1Ref.current);
      ctx.drawImage(drawTmp, 0, 0);
    }
    if (strokes1Ref.current?.length > 0) {
      drawTmp.getContext("2d").clearRect(0, 0, W, H);
      drawStrokes(drawTmp, strokes1Ref.current);
      ctx.drawImage(drawTmp, 0, 0);
    }

    off.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${song?.title || "score"}_p${pageNum}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
  };

  // leader toggles download permission for members (per service)
  const toggleDownloadEnabled = async () => {
    if (!svc) return;
    try {
      await updateDoc(doc(db, "services", svc.id), { downloadEnabled: !svc.downloadEnabled });
    } catch(e) { console.error(e); }
  };

  const canDownload = isLibraryMode || leader || svc?.downloadEnabled;

  const tbNarrow = (cSize.w || window.innerWidth) < 600;
  const tbIconSz = tbNarrow ? 17 : 18;

  const toolBtn = (name, active, onClick, ttl) => (
    <button onClick={onClick} title={ttl} style={{
      background: active ? `${C.acc}33` : "transparent",
      border:`1px solid ${active ? C.acc : C.bdr}`,
      borderRadius:8, padding: tbNarrow ? 6 : 7, cursor:"pointer", display:"flex", alignItems:"center",
    }}>
      <Icon n={name} size={tbIconSz} color={active ? C.acc : C.dim} />
    </button>
  );

  /* ── 통일 툴바 버튼 (텍스트 레이블, height:28px 고정) ── */
  const tbBtn = (label, active, onClick, color) => {
    const c = color || C.acc;
    return (
      <button onClick={onClick} style={{
        height:28, display:"flex", alignItems:"center", justifyContent:"center",
        padding:"0 9px", borderRadius:7, cursor:"pointer", whiteSpace:"nowrap",
        flexShrink:0, fontFamily:"inherit", fontSize:11, fontWeight:700,
        letterSpacing:"0.03em", border:`1px solid ${active ? c : C.bdr}`,
        background: active ? `${c}22` : "transparent",
        color: active ? c : C.dim, transition:"all .12s",
      }}>{label}</button>
    );
  };
  const sqBtn = (label, active, onClick, color) => {
    const c = color || C.dim;
    return (
      <button onClick={onClick} style={{
        width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
        padding:0, borderRadius:7, cursor:"pointer", flexShrink:0, fontSize:13,
        border:`1px solid ${active ? c : C.bdr}`,
        background: active ? `${c}22` : "transparent",
        color: active ? c : C.dim, transition:"all .12s",
      }}>{label}</button>
    );
  };

  const navSongBtn = (label, icon, disabled, onClick) => (
    <button onClick={onClick} disabled={disabled} style={{
      background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
      padding:"7px 14px", cursor: disabled ? "not-allowed" : "pointer",
      display:"flex", alignItems:"center", gap:5,
      opacity: disabled ? 0.3 : 1, fontSize:12, fontFamily:"inherit",
      color:C.txt, fontWeight:600,
    }}>
      {icon === "prev" && <Icon n="prev" size={14} color={C.txt} />}
      {label}
      {icon === "next" && <Icon n="next" size={14} color={C.txt} />}
    </button>
  );

  if (!song) return (
    <div style={{ position:"fixed", inset:0, background:C.bg, display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:40 }}>🎵</div>
      <div style={{ fontSize:15, fontWeight:700, color:C.txt }}>악보를 찾을 수 없습니다</div>
      <button onClick={() => nav(backTo || "library")}
        style={{ padding:"10px 20px", borderRadius:10, background:C.acc, color:"#fff",
          border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:700 }}>
        ← 돌아가기
      </button>
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:C.bg, display:"flex",
      flexDirection:"column", overflow:"hidden" }}>

      {/* 상단 툴바 */}
      {!isLiteMode && <div style={{
        background:"linear-gradient(135deg,#0c1850 0%,#1c3c88 45%,#3878e0 100%)",
        flexShrink:0,
      }}>
        {/* iOS safe area spacer */}
        <div style={{ height:"env(safe-area-inset-top)", background:"transparent" }} />

        <div style={{
          height:52, display:"flex", alignItems:"center", gap:6,
          padding:"0 12px", overflow:"hidden",
        }}>
          <button onClick={() => nav(backTo || "library")}
            style={{ background:"none", border:"none", color:"rgba(255,255,255,0.9)", cursor:"pointer",
              padding:"4px 8px 4px 0", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
            <Icon n="back" size={18} color="rgba(255,255,255,0.9)" />
            <span style={{ fontSize:15, fontWeight:500, color:"rgba(255,255,255,0.9)" }}>Back</span>
          </button>
          {/* 메트로놈 버튼 — 항상 보이는 고정 위치 */}
          <button data-metro-panel onClick={() => setShowMetroPanel(p => !p)} title="메트로놈"
            style={{
              position:"relative", flexShrink:0, height:28,
              padding: tbNarrow ? "0 6px" : "0 8px",
              background: (showMetroPanel || metroOn) ? "#fff" : "rgba(255,255,255,0.12)",
              border:`1px solid ${(showMetroPanel || metroOn) ? "#fff" : "rgba(255,255,255,0.3)"}`,
              borderRadius:7, cursor:"pointer",
              display:"flex", alignItems:"center", gap:2,
              color:(showMetroPanel || metroOn) ? "#1c3c88" : "#fff",
              fontWeight:(showMetroPanel || metroOn) ? 800 : 700,
              fontSize: tbNarrow ? 10 : 11, fontFamily:"inherit",
            }}>
            메트로놈
            <span style={{ fontSize:7, lineHeight:1 }}>▾</span>
            {metroOn && (
              <span style={{
                position:"absolute", top:2, right:2,
                width:6, height:6, borderRadius:"50%",
                background: metroBeat % 4 === 0 ? "#1c3c88" : "rgba(28,60,136,0.4)",
                transition:"background 0.06s",
              }} />
            )}
          </button>

          {/* 악보 Sync 표시 — 비라이브러리 모드에서만 */}
          {!isLibraryMode && (
            tbNarrow ? (
              /* 세로모드: 점만 표시해서 공간 절약 */
              <span style={{
                width:8, height:8, borderRadius:"50%", flexShrink:0,
                background: sheetLinkEnabled ? C.grn : "rgba(255,255,255,0.35)",
                boxShadow: sheetLinkEnabled ? `0 0 5px ${C.grn}` : "none",
                transition:"background 0.3s, box-shadow 0.3s",
              }} />
            ) : (
              <div style={{
                display:"flex", alignItems:"center", gap:4, flexShrink:0,
                padding:"4px 9px", borderRadius:8,
                border:`1px solid ${sheetLinkEnabled ? C.grn : "rgba(255,255,255,0.3)"}`,
                background: sheetLinkEnabled ? `${C.grn}22` : "rgba(255,255,255,0.1)",
                transition:"background 0.3s, border-color 0.3s",
              }}>
                <span style={{
                  fontSize:11, fontWeight:700, letterSpacing:0.2,
                  color: sheetLinkEnabled ? C.grn : "rgba(255,255,255,0.85)",
                  transition:"color 0.3s",
                }}>악보 Sync</span>
                <span style={{
                  width:7, height:7, borderRadius:"50%", flexShrink:0,
                  background: sheetLinkEnabled ? C.grn : "rgba(255,255,255,0.35)",
                  boxShadow: sheetLinkEnabled ? `0 0 4px ${C.grn}` : "none",
                  transition:"background 0.3s, box-shadow 0.3s",
                }} />
              </div>
            )
          )}

          {/* 제목/키 — 항상 중앙 표시 (좁은 화면은 1줄로) */}
          <div style={{ flex:1, minWidth:0, textAlign:"center", overflow:"hidden" }}>
            <div style={{ fontWeight:800, fontSize:tbNarrow?12:15, overflow:"hidden",
              textOverflow:"ellipsis", whiteSpace:"nowrap", color:"#fff" }}>{song.title}</div>
            {!tbNarrow && (
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                Key {transposeMode && transposeSteps !== 0
                  ? `${song.key} → ${keyName(song.key, transposeSteps)}`
                  : song.key}
                {song.bpm ? ` · ♩${song.bpm}` : ""}
                {numPages > 0 ? ` · ${pageNum}/${numPages}p` : ""}
                {!isLibraryMode && svcSongs.length > 1 ? ` · 곡 ${songIdx+1}/${svcSongs.length}` : ""}
              </div>
            )}
          </div>

          {/* 그룹 버튼 */}
          {(() => {
            const unread = isLibraryMode ? 0 : chatMsgs.filter(m => m.uid !== user?.uid && (m.createdAt?.toMillis?.() ?? Date.now()) > chatLastSeen).length;
            const viewActive = dual || fitActive || zoomMul !== 1.0;
            const writeActive = drawMode || showNotePanel || (!isLibraryMode && showCueInput);
            const scoreActive = transposeMode || media;
            const teamActive = false; // 팀채팅은 직접 버튼으로 분리
            const recActive = recording || recCount > 0 || (!isLibraryMode && showWorshipPlayer);
            const mkGrp = (name, itemActive, color, badge, dot) => {
              const isOpen = activeGroup === name;
              const c = isOpen ? C.acc : (itemActive ? (color || C.acc) : C.dim);
              return (
                <button key={name}
                  onClick={() => setActiveGroup(g => g === name ? null : name)}
                  style={{
                    position:"relative", flexShrink:0, height:28,
                    padding: tbNarrow ? "0 6px" : "0 8px",
                    borderRadius:7, cursor:"pointer",
                    background:(isOpen || itemActive) ? "#fff" : "rgba(255,255,255,0.12)",
                    border:`1px solid ${(isOpen || itemActive) ? "#fff" : "rgba(255,255,255,0.3)"}`,
                    color:(isOpen || itemActive) ? "#1c3c88" : "#fff", fontWeight: (isOpen || itemActive) ? 800 : 700, fontSize: tbNarrow ? 10 : 11,
                    fontFamily:"inherit", display:"flex", alignItems:"center", gap:2,
                  }}>
                  {name}
                  <span style={{fontSize:7,lineHeight:1}}>▾</span>
                  {badge > 0 && (
                    <span style={{ position:"absolute", top:-4, right:-4,
                      minWidth:14, height:14, borderRadius:7, background:C.red,
                      fontSize:9, fontWeight:700, color:"#fff",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      padding:"0 3px", pointerEvents:"none", lineHeight:1,
                    }}>{badge > 9 ? "9+" : badge}</span>
                  )}
                  {dot && !badge && (
                    <span style={{ position:"absolute", top:3, right:3,
                      width:6, height:6, borderRadius:"50%",
                      background:C.grn, pointerEvents:"none",
                    }} />
                  )}
                </button>
              );
            };
            const dlActive = canDownload || (!isLibraryMode && leader && !!svc);
            return (
              <div className="pdf-toolbar-btns" style={{ display:"flex", gap:3, alignItems:"center", flexShrink:1, minWidth:0,
                overflowX:"auto", overflowY:"hidden", WebkitOverflowScrolling:"touch",
                scrollbarWidth:"none", msOverflowStyle:"none" }}>
                {mkGrp("보기", viewActive, C.acc, 0)}
                {mkGrp("필기", writeActive, drawMode ? C.pur : C.acc, 0)}
                {mkGrp("악보", scoreActive, transposeMode ? C.grn : C.acc, 0)}
                {!isLibraryMode && (getUserParts(user).some(p => ["키보드","피아노"].includes(p)) || isFoh(user)) && (() => {
                  const isOpen = activeGroup === "팀채팅";
                  return (
                    <button
                      onClick={() => { setShowChat(p => !p); setActiveGroup(null); }}
                      style={{
                        position:"relative", flexShrink:0, height:28,
                        padding: tbNarrow ? "0 6px" : "0 8px",
                        borderRadius:7, cursor:"pointer",
                        background: (isOpen || showChat) ? "#fff" : "rgba(255,255,255,0.12)",
                        border:`1px solid ${(isOpen || showChat) ? "#fff" : "rgba(255,255,255,0.3)"}`,
                        color:(isOpen || showChat) ? "#1c3c88" : "#fff", fontWeight: (isOpen || showChat) ? 800 : 700, fontSize: tbNarrow ? 10 : 11,
                        fontFamily:"inherit", display:"flex", alignItems:"center", gap:2,
                      }}>
                      팀채팅
                      {unread > 0 && !showChat && (
                        <span style={{ position:"absolute", top:-4, right:-4,
                          minWidth:14, height:14, borderRadius:7, background:C.red,
                          fontSize:9, fontWeight:700, color:"#fff",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          padding:"0 3px", pointerEvents:"none", lineHeight:1,
                        }}>{unread > 9 ? "9+" : unread}</span>
                      )}
                    </button>
                  );
                })()}
                {(getUserParts(user).some(p => ["키보드","피아노"].includes(p)) || isFoh(user) || user?.role === "admin") && (
                  <button
                    onClick={() => { setShowImprov(true); setActiveGroup(null); }}
                    title="즉흥 코드 생성"
                    style={{
                      flexShrink:0, height:28,
                      padding: tbNarrow ? "0 6px" : "0 8px",
                      borderRadius:7, cursor:"pointer",
                      background: showImprov ? "#fff" : "rgba(255,255,255,0.12)",
                      border:`1px solid ${showImprov ? "#fff" : "rgba(255,255,255,0.3)"}`,
                      color: showImprov ? "#1c3c88" : "#fff", fontWeight: showImprov ? 800 : 700,
                      fontSize: tbNarrow ? 10 : 11, fontFamily:"inherit",
                      display:"flex", alignItems:"center", gap:2,
                    }}>
                    🎹 코드
                  </button>
                )}
                {mkGrp("녹음", recActive, recording ? C.red : C.acc, 0, !isLibraryMode && !!svcPracticeUrl)}
                {dlActive && mkGrp("다운로드", false, C.acc, 0)}
                {(leader || user?.role === "admin") && !isLibraryMode && (
                  <button onClick={() => setShowPointerPanel(p => !p)} style={{
                    position:"relative", flexShrink:0, height:28,
                    padding: tbNarrow ? "0 6px" : "0 8px",
                    background:(showPointerPanel || pointerOn) ? "#fff" : "rgba(255,255,255,0.12)",
                    border:`1px solid ${(showPointerPanel || pointerOn) ? "#fff" : "rgba(255,255,255,0.3)"}`,
                    borderRadius:7, cursor:"pointer",
                    display:"flex", alignItems:"center", gap:3,
                    color:(showPointerPanel || pointerOn) ? "#c0392b" : "#fff",
                    fontWeight:(showPointerPanel || pointerOn) ? 800 : 700,
                    fontSize: tbNarrow ? 10 : 11, fontFamily:"inherit",
                  }}>
                    {pointerOn && <span style={{
                      width:7, height:7, borderRadius:"50%", flexShrink:0,
                      background:"#e74c3c", boxShadow:"0 0 6px #e74c3c",
                    }} />}
                    포인터 <span style={{ fontSize:7 }}>▾</span>
                  </button>
                )}
                <button onClick={() => setShowMobileHelp(true)} style={{
                  flexShrink:0, height:28, width:28,
                  borderRadius:7, cursor:"pointer",
                  background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.3)",
                  color:"#fff", fontWeight:700, fontSize:13, fontFamily:"inherit",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>?</button>
              </div>
            );
          })()}
        </div>
      </div>}

      {isLiteMode && (() => {
        const liteBtn = (onClick, children, active, right) => (
          <button onClick={onClick} style={{
            position:"fixed",
            bottom:"calc(env(safe-area-inset-bottom,0px) + 18px)",
            ...(right != null ? { right } : { left:"50%", transform:"translateX(-50%)" }),
            zIndex:200,
            background: active ? "rgba(107,93,231,0.88)" : "rgba(0,0,0,0.42)",
            color:"#fff",
            border: active ? "1.5px solid rgba(107,93,231,0.6)" : "none",
            borderRadius:24,
            padding:"10px 16px",
            fontSize:14,
            fontWeight:700,
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            gap:7,
            backdropFilter:"blur(8px)",
            WebkitBackdropFilter:"blur(8px)",
            letterSpacing:"-0.01em",
          }}>{children}</button>
        );
        return (<>
          {/* 홈 버튼 */}
          {liteBtn(() => { setDrawMode(false); nav("lite"); }, (<>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2 6.5L8 2L14 6.5V14H10V10H6V14H2V6.5Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
            </svg>홈
          </>), false, undefined)}

          {/* 펜 버튼 (드로잉 모드 토글) */}
          {liteBtn(() => {
            if (!drawMode) { setDrawMode(true); setDrawTool("pen"); setDrawWidth(2); setDrawColor("#1a6fe8"); }
            else { setDrawMode(false); }
          }, (<>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
            {drawMode ? "완료" : "필기"}
          </>), drawMode, 16)}

          {/* 지우개 버튼 — 필기 모드 ON일 때만 */}
          {drawMode && liteBtn(() => setDrawTool(t => t === "eraser" ? "pen" : "eraser"), (<>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M20 20H7L3 16l11-11 6 6-3.5 3.5" stroke="#fff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
              <path d="M6.5 17.5l4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {drawTool === "eraser" ? "펜" : "지우개"}
          </>), drawTool === "eraser", 88)}
        </>);
      })()}

      {/* 그룹 드롭다운 패널 */}
      {activeGroup && (
        <div style={{ flexShrink:0, background:C.surf, borderBottom:`1px solid ${C.bdr}`,
          padding:"8px 14px", display:"flex", alignItems:"center", justifyContent:"flex-end" }}>

          {/* 보기: 줌 · FIT · 페이지 · DUAL */}
          {activeGroup === "보기" && (
            <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
              {sqBtn("−", false, () => setZoomMul(z => Math.max(0.5, +(z-0.15).toFixed(2))))}
              <button onClick={resetZoom} style={{
                height:28, padding:"0 6px", borderRadius:7, cursor:"pointer", flexShrink:0,
                background: zoomMul!==1.0 ? `${C.acc}22` : "transparent",
                border: zoomMul!==1.0 ? `1px solid ${C.acc}` : "1px solid transparent",
                color: zoomMul!==1.0 ? C.acc : C.dim,
                fontWeight:700, fontSize:11, fontFamily:"inherit", minWidth:38, textAlign:"center",
              }}>{Math.round(zoomMul*100)}%</button>
              {sqBtn("+", false, () => setZoomMul(z => Math.min(3.0, +(z+0.15).toFixed(2))))}
              <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }}/>
              <button onClick={autoFit} style={{
                height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                background: fitActive ? `${C.acc}22` : "transparent",
                border:`1px solid ${fitActive ? C.acc : C.bdr}`,
                color: fitActive ? C.acc : C.dim,
                fontWeight:700, fontSize:11, fontFamily:"inherit",
              }}>FIT</button>
              {!dual && numPages > 1 && <>
                <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }}/>
                <button onClick={() => { if(pageNum>1){slideAnimate(-1);setPageNum(p=>p-1);} }}
                  disabled={pageNum<=1}
                  style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
                    padding:0, borderRadius:7, cursor:pageNum<=1?"not-allowed":"pointer",
                    border:`1px solid ${C.bdr}`, background:"transparent",
                    color:C.dim, fontSize:13, flexShrink:0, opacity:pageNum<=1?0.3:1 }}>◀</button>
                <span style={{ fontSize:11, fontWeight:700, color:C.dim,
                  minWidth:36, textAlign:"center", flexShrink:0 }}>{pageNum}/{numPages}p</span>
                <button onClick={() => { if(pageNum<numPages){slideAnimate(1);setPageNum(p=>p+1);} }}
                  disabled={pageNum>=numPages}
                  style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
                    padding:0, borderRadius:7, cursor:pageNum>=numPages?"not-allowed":"pointer",
                    border:`1px solid ${C.bdr}`, background:"transparent",
                    color:C.dim, fontSize:13, flexShrink:0, opacity:pageNum>=numPages?0.3:1 }}>▶</button>
              </>}
              {!isLibraryMode && <>
                <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }}/>
                <button onClick={() => setDual(p=>!p)} style={{
                  height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  background: dual ? `${C.pur}22` : "transparent",
                  border:`1px solid ${dual ? C.pur : C.bdr}`,
                  color: dual ? C.pur : C.dim,
                  fontWeight:700, fontSize:11, fontFamily:"inherit",
                }}>DUAL</button>
              </>}
            </div>
          )}

          {/* 필기: 필기 · 메모 · 큐노트 */}
          {activeGroup === "필기" && (
            <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
              <button onClick={() => { setDrawMode(p=>!p); if(!drawMode) setDrawTool("pen"); }} style={{
                height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                background: drawMode ? `${C.pur}22` : "transparent",
                border:`1px solid ${drawMode ? C.pur : C.bdr}`,
                color: drawMode ? C.pur : C.dim,
                fontWeight:700, fontSize:11, fontFamily:"inherit",
              }}>필기</button>
              <button onClick={() => setShowNotePanel(p=>!p)} style={{
                height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                background: showNotePanel ? `${C.acc}22` : "transparent",
                border:`1px solid ${showNotePanel ? C.acc : C.bdr}`,
                color: showNotePanel ? C.acc : C.dim,
                fontWeight:700, fontSize:11, fontFamily:"inherit",
              }}>메모</button>
              {!isLibraryMode && (
                <button onClick={() => setShowCueInput(p=>!p)} style={{
                  height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  background: showCueInput ? "#ff6f0022" : "transparent",
                  border:`1px solid ${showCueInput ? "#ff6f00" : C.bdr}`,
                  color: showCueInput ? "#e65c00" : C.dim,
                  fontWeight:700, fontSize:11, fontFamily:"inherit",
                }}>큐노트</button>
              )}
            </div>
          )}

          {/* 다운로드: 악보 PDF · 멤버 허용 */}
          {activeGroup === "다운로드" && (
            <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
              {canDownload && (
                <button onClick={downloadAnnotatedScore} style={{
                  height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  background:"transparent", border:`1px solid ${C.bdr}`,
                  color:C.dim, fontWeight:700, fontSize:11, fontFamily:"inherit",
                }}>악보 PDF</button>
              )}
              {!isLibraryMode && leader && svc && (
                <button onClick={toggleDownloadEnabled} style={{
                  height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  background: svc.downloadEnabled ? `${C.grn}22` : "transparent",
                  border:`1px solid ${svc.downloadEnabled ? C.grn : C.bdr}`,
                  color: svc.downloadEnabled ? C.grn : C.dim,
                  fontWeight:700, fontSize:11, fontFamily:"inherit",
                }}>{svc.downloadEnabled ? "멤버 허용 ON" : "멤버 허용 OFF"}</button>
              )}
            </div>
          )}

          {/* 악보: 전조 · MEDIA */}
          {activeGroup === "악보" && (
            <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
              <button onClick={() => {
                const next = !transposeMode;
                setTransposeMode(next);
                if(tmKey) localStorage.setItem(tmKey, next?"1":"0");
                if(!next){setTransposeSteps(0);setDetectErr("");}
              }} style={{
                height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                background: transposeMode ? `${C.grn}22` : "transparent",
                border:`1px solid ${transposeMode ? C.grn : C.bdr}`,
                color: transposeMode ? C.grn : C.dim,
                fontWeight:700, fontSize:11, fontFamily:"inherit",
              }}>
                {transposeMode && (transposeSteps!==0 || capoFret>0)
                  ? `${song.key}→${keyName(song.key, transposeSteps-capoFret)}${capoFret>0?` C${capoFret}`:""}`
                  : "전조"}
              </button>
              <button onClick={() => { if(dual){showToast("싱글 모드에서만 사용 가능합니다");return;} setMedia(p=>!p); }}
                style={{
                  height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  background: media ? `${C.acc}22` : "transparent",
                  border:`1px solid ${media ? C.acc : C.bdr}`,
                  color: media ? C.acc : C.dim,
                  fontWeight:700, fontSize:11, fontFamily:"inherit",
                  display:"flex", alignItems:"center", gap:4,
                }}>
                MEDIA
                {!!getYoutubeId(song?.youtubeUrl) && (
                  <span style={{ fontSize:8, fontWeight:800, borderRadius:3, padding:"1px 3px",
                    background: media ? `${C.acc}33` : `${C.red}22`,
                    color: media ? C.acc : C.red }}>YT</span>
                )}
              </button>
            </div>
          )}

          {/* 녹음: 악기선택 · 녹음버튼 · 재생 · 연습듣기 */}
          {activeGroup === "녹음" && (
            <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
              {/* 보컬 */}
              {(() => {
                const setMode = (id) => { setRecMode(id); recModeRef.current=id; localStorage.setItem("tvpc_recMode",id); };
                const allModes = [{ id:"vocal", emoji:"🎤", label:"보컬" }, ...INST_MODES.filter(m => !m.leaderOnly || leader)];
                return allModes.map(m => {
                  const sel = recMode === m.id;
                  const c = m.id === "vocal" ? C.pur : C.grn;
                  return (
                    <button key={m.id} onClick={() => setMode(m.id)} disabled={recording} style={{
                      height:28, padding:"0 8px", borderRadius:7, cursor: recording ? "not-allowed" : "pointer",
                      flexShrink:0, display:"flex", alignItems:"center", gap:4,
                      background: sel ? `${c}22` : "transparent",
                      border:`1px solid ${sel ? c : C.bdr}`,
                      color: sel ? c : C.dim,
                      fontWeight:700, fontSize:11, fontFamily:"inherit",
                      opacity: recording ? 0.5 : 1,
                    }}>
                      <span style={{ fontSize:14, lineHeight:1 }}>{m.emoji}</span>
                      {m.label}
                    </button>
                  );
                });
              })()}
              <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }}/>
              {recording ? (
                <button onClick={stopRecording} style={{
                  height:28, display:"flex", alignItems:"center", gap:5,
                  padding:"0 9px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  border:`1px solid ${C.red}`, background:`${C.red}15`,
                  color:C.red, fontWeight:700, fontSize:11, fontFamily:"inherit",
                  fontVariantNumeric:"tabular-nums",
                }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:C.red, animation:"pulse 1s infinite" }}/>
                  {`${Math.floor(recSeconds/60)}:${String(recSeconds%60).padStart(2,"0")}`}
                </button>
              ) : (
                <button onClick={startRecording} style={{
                  position:"relative", height:28,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0, fontSize:11,
                  border:`1px solid ${C.bdr}`, background:"transparent", color:C.dim,
                  fontWeight:700, fontFamily:"inherit",
                }}>
                  녹음
                  {recCount > 0 && <span style={{
                    position:"absolute", top:1, right:1,
                    background:C.acc, color:"#fff", borderRadius:"50%",
                    fontSize:7, fontWeight:800, width:11, height:11,
                    display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
                  }}>{recCount}</span>}
                </button>
              )}
              {recCount > 0 && !recording && sqBtn("재생", false, () => setShowRecModal(true))}
              {!isLibraryMode && svcPracticeUrl && <>
                <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }}/>
                <button onClick={() => setShowWorshipPlayer(p=>!p)} style={{
                  position:"relative",
                  height:28, padding:"0 8px", borderRadius:7, cursor:"pointer", flexShrink:0,
                  background: showWorshipPlayer ? `${C.grn}22` : "transparent",
                  border:`1px solid ${showWorshipPlayer ? C.grn : C.bdr}`,
                  color: showWorshipPlayer ? C.grn : C.dim,
                  fontWeight:700, fontSize:11, fontFamily:"inherit",
                }}>연습듣기
                  {!showWorshipPlayer && (
                    <span style={{ position:"absolute", top:3, right:3,
                      width:6, height:6, borderRadius:"50%", background:C.grn, pointerEvents:"none",
                    }} />
                  )}
                </button>
              </>}
            </div>
          )}
        </div>
      )}


      {/* 필기 서브툴바 */}
      {drawMode && !isLiteMode && (
        <div style={{ flexShrink:0, background:`${C.pur}0a`, borderBottom:`1px solid ${C.bdr}`, position:"relative" }}>
          {/* 필기 서브툴바 — 단일 스크롤 행 */}
          <div style={{ display:"flex", alignItems:"center", gap:4, padding:"0 10px", height:44,
            overflowX:"auto", background: drawTool === "select" && selAnnot ? `${C.pur}0e` : "transparent", justifyContent:"flex-end" }}>
            {/* 도구 버튼 — 텍스트 */}
            {[
              { id:"pen",         label:"펜"    },
              { id:"eraser",      label:"지우개" },
              { id:"highlighter", label:"마커"  },
              { id:"cover",       label:"커버"  },
              { id:"text",        label:"글자"  },
              { id:"stamp",       label:"스탬프" },
              { id:"shape",       label:"기호"  },
            ].map(t => (
              <button key={t.id} onClick={() => {
                if (t.id === "stamp" && drawTool === "stamp") {
                  setShowStampPalette(p => !p);
                } else {
                  setDrawTool(t.id);
                }
              }} style={{
                height:34, padding:"0 10px", flexShrink:0,
                background: drawTool === t.id ? `${C.pur}22` : "transparent",
                border:`1px solid ${drawTool === t.id ? C.pur : C.bdr}`,
                borderRadius:7, cursor:"pointer",
                color: drawTool === t.id ? C.pur : C.dim,
                fontSize:12, fontWeight:700, fontFamily:"inherit", whiteSpace:"nowrap",
              }}>{t.label}</button>
            ))}
            {/* 스탬프 모드 — 현재 심볼 표시 & 팔레트 토글 */}
            {drawTool === "stamp" && (
              <button onClick={() => setShowStampPalette(p => !p)} style={{
                height:34, padding:"0 9px", flexShrink:0, display:"flex", alignItems:"center", gap:5,
                background: showStampPalette ? `${C.pur}18` : C.card,
                border:`1.5px solid ${showStampPalette ? C.pur : C.bdr}`,
                borderRadius:7, cursor:"pointer",
              }}>
                <span style={{
                  fontSize:14, fontWeight:700,
                  color: stampItalic ? C.pur : C.txt,
                  fontStyle: stampItalic ? "italic" : "normal",
                  fontFamily: stampItalic ? '"Times New Roman", Georgia, serif' : "inherit",
                  minWidth:18, textAlign:"center",
                }}>{stampSymbol}</span>
                <span style={{ fontSize:10, color:C.dim, fontWeight:600 }}>{stampSize}</span>
              </button>
            )}
            {/* 팀필기 — 아이콘 + 텍스트 */}
            {leader && drawTool !== "select" && (
              <button onClick={() => setTeamDrawMode(p => !p)} style={{
                height:34, padding:"0 10px", flexShrink:0,
                display:"flex", alignItems:"center", gap:4,
                background: teamDrawMode ? `${C.acc}22` : "transparent",
                border:`1px solid ${teamDrawMode ? C.acc : C.bdr}`,
                borderRadius:7, cursor:"pointer",
                color: teamDrawMode ? C.acc : C.dim,
                fontSize:12, fontWeight:700, fontFamily:"inherit",
              }}>
                <span style={{ fontSize:14, lineHeight:1 }}>👥</span>
                팀필기
              </button>
            )}
            <div style={{ width:1, height:20, background:C.bdr, flexShrink:0, marginLeft:2 }} />
            {/* 컨텍스트 영역: 선택 모드 액션 or 색상·굵기·실행취소 */}
            {drawTool === "select" ? (
              selAnnot ? (
                <>
                  <span style={{ fontSize:11, color: selAnnot.isTeam ? C.acc : C.pur,
                    fontWeight:700, flexShrink:0, whiteSpace:"nowrap" }}>
                    {selAnnot.isTeam ? "👥 팀선택" : "✓ 선택됨"}
                  </span>
                  {(() => {
                    const sRef = selStrokesRef(selAnnot);
                    const s = sRef.current[selAnnot.idx];
                    if (!s || (s.tool !== "text" && s.tool !== "stamp")) return null;
                    const curSz = s.tool === "text" ? (s.size || 15) : (s.size || 12);
                    const curClr = s.color || "#e8383b";
                    return (
                      <>
                        <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
                        <button onClick={() => resizeSelText(-4)} style={{
                          background:C.card, border:`1px solid ${C.bdr}`,
                          borderRadius:8, padding:"5px 10px", cursor:"pointer", flexShrink:0,
                          fontSize:14, fontWeight:700, color:C.txt, fontFamily:"inherit",
                        }}>A-</button>
                        <span style={{ fontSize:13, fontWeight:700, color:C.pur,
                          minWidth:24, textAlign:"center", flexShrink:0 }}>{curSz}</span>
                        <button onClick={() => resizeSelText(4)} style={{
                          background:C.card, border:`1px solid ${C.bdr}`,
                          borderRadius:8, padding:"5px 10px", cursor:"pointer", flexShrink:0,
                          fontSize:14, fontWeight:700, color:C.txt, fontFamily:"inherit",
                        }}>A+</button>
                        <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
                        {["#e8383b","#1a73e8","#1c1c1e","#34c759","#e8a93e","#9b59b6"].map(clr => (
                          <button key={clr} onClick={() => recolorSelAnnot(clr)} style={{
                            width:20, height:20, borderRadius:"50%", background:clr, padding:0,
                            border: curClr === clr ? "2.5px solid #fff" : "2px solid transparent",
                            outline: curClr === clr ? `2px solid ${clr}` : "none",
                            cursor:"pointer", flexShrink:0,
                          }} />
                        ))}
                      </>
                    );
                  })()}
                  <div style={{ flex:1 }} />
                  <button onClick={deleteSelAnnot} style={{
                    display:"flex", alignItems:"center", gap:5,
                    padding:"6px 12px", background:C.red, border:"none",
                    borderRadius:8, cursor:"pointer", flexShrink:0,
                  }}>
                    <Icon n="trash" size={14} color="#fff" />
                    <span style={{ fontSize:12, fontWeight:700, color:"#fff", fontFamily:"inherit" }}>삭제</span>
                  </button>
                  <button onClick={() => {
                    setSelAnnot(null);
                    drawStrokes(drawCanvas1Ref.current, strokes1Ref.current);
                    drawStrokes(drawCanvas2Ref.current, strokes2Ref.current);
                    if (teamDrawCanvas1Ref.current) drawStrokes(teamDrawCanvas1Ref.current, teamStrokes1Ref.current);
                    if (teamDrawCanvas2Ref.current) drawStrokes(teamDrawCanvas2Ref.current, teamStrokes2Ref.current);
                  }} style={{
                    display:"flex", alignItems:"center", gap:5,
                    padding:"6px 10px", background:C.surf, border:`1px solid ${C.bdr}`,
                    borderRadius:8, cursor:"pointer", flexShrink:0,
                  }}>
                    <Icon n="xmark" size={14} color={C.dim} />
                    <span style={{ fontSize:12, fontWeight:600, color:C.dim, fontFamily:"inherit" }}>해제</span>
                  </button>
                </>
              ) : (
                <span style={{ fontSize:11, color:C.dim, fontStyle:"italic", flexShrink:0 }}>
                  텍스트 · 스탬프를 탭하여 선택
                </span>
              )
            ) : (
              <>
                {/* 색상 */}
                {teamDrawMode ? (
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                    <div style={{ width:22, height:22, borderRadius:"50%", background:TEAM_COLOR,
                      border:"3px solid #fff", outline:`2px solid ${TEAM_COLOR}`, flexShrink:0 }} />
                    <span style={{ fontSize:11, color:TEAM_COLOR, fontWeight:700, flexShrink:0 }}>팀필기 고정색</span>
                  </div>
                ) : drawTool === "cover" ? (
                  <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                    <div style={{ width:22, height:22, borderRadius:"50%", background:"#ffffff",
                      border:"3px solid #bbb", outline:"2px solid #aaa", flexShrink:0 }} />
                  </div>
                ) : (drawTool === "highlighter"
                  ? ["#ffe034","#7dff6b","#5df4ff","#ff7de9","#ffac30"]
                  : ["#e8383b","#1a73e8","#1c1c1e","#34c759","#e8a93e"]
                ).map(clr => (
                  <button key={clr} onClick={() => setDrawColor(clr)} style={{
                    width:22, height:22, borderRadius:"50%", background:clr,
                    border: drawColor === clr && drawTool !== "eraser" ? "3px solid #fff" : "2px solid transparent",
                    outline: drawColor === clr && drawTool !== "eraser" ? `2px solid ${clr}` : "none",
                    cursor:"pointer", flexShrink:0, padding:0,
                    opacity: drawTool === "eraser" ? 0.35 : 1,
                  }} />
                ))}
                <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
                {/* 굵기 S M L */}
                <div style={{ display:"flex", flexShrink:0, border:`1px solid ${C.bdr}`, borderRadius:7, overflow:"hidden" }}>
                  {[["S",1],["M",2],["L",4]].map(([lbl,w], i) => (
                    <button key={w} onClick={() => setDrawWidth(w)} style={{
                      height:34, padding:"0 10px", flexShrink:0,
                      background: drawWidth === w ? `${C.pur}22` : "transparent",
                      border:"none",
                      borderLeft: i > 0 ? `1px solid ${C.bdr}` : "none",
                      cursor:"pointer",
                      color: drawWidth === w ? C.pur : C.dim,
                      fontSize: lbl==="S" ? 9 : lbl==="M" ? 12 : 15,
                      fontWeight:800, fontFamily:"inherit",
                    }}>{lbl}</button>
                  ))}
                </div>
                <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
                {/* 되돌리기 + 전체삭제 */}
                <button onClick={handleUndo} style={{
                  height:34, padding:"0 10px", flexShrink:0,
                  background:"transparent", border:`1px solid ${C.bdr}`,
                  borderRadius:7, cursor:"pointer",
                  color:C.dim, fontSize:12, fontWeight:700, fontFamily:"inherit", whiteSpace:"nowrap",
                }}>되돌리기</button>
                <button onClick={handleClearPage} style={{
                  height:34, padding:"0 10px", flexShrink:0,
                  background:"transparent", border:`1px solid ${C.red}44`,
                  borderRadius:7, cursor:"pointer",
                  color:C.red, fontSize:12, fontWeight:700, fontFamily:"inherit", whiteSpace:"nowrap",
                }}>전체삭제</button>
                {drawSaveErr && (
                  <span style={{ fontSize:10, color:C.red, marginLeft:4, flexShrink:0 }}>⚠ {drawSaveErr}</span>
                )}
              </>
            )}
          </div>
          {/* 스탬프 팔레트 — 심볼 선택 후 자동 닫힘 */}
          {drawTool === "stamp" && showStampPalette && (
            <div style={{
              position:"absolute", top:"100%", right:10, zIndex:500,
              background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}`,
              boxShadow:"0 8px 32px rgba(0,0,0,0.5)",
              padding:"8px 10px", display:"flex", flexDirection:"column", gap:3,
            }}>
              {/* 크기 조절 + 배경 토글 */}
              <div style={{ display:"flex", alignItems:"center", gap:4, paddingBottom:6,
                borderBottom:`1px solid ${C.bdr}`, marginBottom:2 }}>
                <span style={{ fontSize:9, color:C.dim, fontWeight:700, width:32,
                  textAlign:"right", flexShrink:0 }}>크기</span>
                <button onClick={() => setStampSize(s => Math.max(3, s - 2))} style={{
                  width:28, height:28, borderRadius:7, border:`1px solid ${C.bdr}`,
                  background:"transparent", cursor:"pointer", fontSize:16,
                  color:C.txt, display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"inherit", flexShrink:0,
                }}>−</button>
                <span style={{ fontSize:13, fontWeight:700, color:C.pur,
                  minWidth:28, textAlign:"center", flexShrink:0 }}>{stampSize}</span>
                <button onClick={() => setStampSize(s => Math.min(40, s + 2))} style={{
                  width:28, height:28, borderRadius:7, border:`1px solid ${C.bdr}`,
                  background:"transparent", cursor:"pointer", fontSize:16,
                  color:C.txt, display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"inherit", flexShrink:0,
                }}>+</button>
                <div style={{ width:1, height:18, background:C.bdr, flexShrink:0, margin:"0 2px" }} />
                <button onClick={() => setStampBg(p => !p)} style={{
                  height:28, padding:"0 8px", borderRadius:7, flexShrink:0,
                  border:`1px solid ${stampBg ? C.acc : C.bdr}`,
                  background: stampBg ? `${C.acc}22` : "transparent",
                  cursor:"pointer", fontSize:11, fontWeight:700,
                  color: stampBg ? C.acc : C.dim, fontFamily:"inherit",
                }}>배경</button>
              </div>
              {STAMP_GROUPS.map(group => (
                <div key={group.label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontSize:9, color:C.dim, fontWeight:700, width:32, textAlign:"right",
                    flexShrink:0, letterSpacing:"0.04em" }}>{group.label}</span>
                  {group.items.map(st => (
                    <button key={st.sym}
                      onClick={() => { setStampSymbol(st.sym); setStampItalic(st.italic); setShowStampPalette(false); }}
                      style={{
                        width:38, height:32,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background: stampSymbol === st.sym ? `${C.acc}22` : "transparent",
                        border:`1px solid ${stampSymbol === st.sym ? C.acc : C.bdr}`,
                        borderRadius:6, cursor:"pointer", padding:0, flexShrink:0,
                      }}>
                      {st.sym === "staff" ? (
                        <svg width="24" height="14" viewBox="0 0 24 14" style={{ display:"block" }}>
                          {[0,1,2,3,4].map(i => (
                            <line key={i} x1="1" y1={1+i*3} x2="23" y2={1+i*3}
                              stroke={stampSymbol === "staff" ? C.acc : C.dim} strokeWidth="1" />
                          ))}
                        </svg>
                      ) : st.sym === "notehead" ? (
                        <svg width="9" height="7" viewBox="0 0 9 7" style={{ display:"block" }}>
                          <ellipse cx="4.5" cy="3.5" rx="4.0" ry="2.8"
                            fill={stampSymbol === "notehead" ? C.acc : C.txt}
                            transform="rotate(-28 4.5 3.5)" />
                        </svg>
                      ) : (
                        <span style={{
                          fontSize:13, fontWeight:700,
                          color: stampSymbol === st.sym ? C.acc : C.txt,
                          fontStyle: st.italic ? "italic" : "normal",
                          fontFamily: st.italic ? '"Times New Roman", Georgia, serif' : "inherit",
                          lineHeight:1,
                        }}>{st.sym}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
              {/* 코드 섹션 — 현재 곡 키 기반 다이아토닉 코드 */}
              {song?.key && (() => {
                const effSteps = transposeSteps - capoFret;
                const diatonic = getDiatonicChords(song.key, effSteps);
                if (!diatonic.length) return null;
                return (
                  <>
                    <div style={{ height:1, background:C.bdr, margin:"2px 0" }} />
                    <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
                      <span style={{ fontSize:9, color:C.pur, fontWeight:700, width:32,
                        textAlign:"right", flexShrink:0 }}>코드</span>
                      {diatonic.map(({ name }) => (
                        <button key={name}
                          onClick={() => { setStampSymbol(name); setStampItalic(false); setShowStampPalette(false); }}
                          style={{
                            height:28, padding:"0 6px", minWidth:36,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            background: stampSymbol === name ? `${C.pur}22` : "transparent",
                            border:`1px solid ${stampSymbol === name ? C.pur : C.bdr}`,
                            borderRadius:6, cursor:"pointer", flexShrink:0,
                          }}>
                          <span style={{ fontSize:11, fontWeight:700,
                            color: stampSymbol === name ? C.pur : C.txt }}>{name}</span>
                        </button>
                      ))}
                      {/* 커스텀 코드 2단계 피커 */}
                      {!chordPickRoot ? (
                        // 1단계: 루트음 선택
                        ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"].map(root => (
                          <button key={root} onClick={() => setChordPickRoot(root)} style={{
                            height:28, padding:"0 7px", minWidth:30,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            background:"transparent", border:`1px solid ${C.bdr}`,
                            borderRadius:6, cursor:"pointer", flexShrink:0, fontSize:11, fontWeight:700, color:C.dim,
                          }}>{root}</button>
                        ))
                      ) : (
                        // 2단계: 코드 질감 선택
                        <>
                          <button onClick={() => setChordPickRoot("")} style={{
                            height:28, padding:"0 6px", display:"flex", alignItems:"center", gap:3,
                            background:`${C.pur}22`, border:`1px solid ${C.pur}`, borderRadius:6,
                            cursor:"pointer", flexShrink:0, fontSize:11, fontWeight:800, color:C.pur,
                          }}>← {chordPickRoot}</button>
                          {Object.keys(CHORD_VOICINGS)
                            .filter(k => {
                              const sharp = {"Eb":"D#","Ab":"G#","Bb":"A#","C#":"C#","F#":"F#","Db":"C#","Gb":"F#"};
                              const r = sharp[chordPickRoot] || chordPickRoot;
                              return k === chordPickRoot || k.startsWith(chordPickRoot) || k === r || k.startsWith(r);
                            })
                            .map(name => (
                              <button key={name} onClick={() => { setStampSymbol(name); setStampItalic(false); setChordPickRoot(""); setShowStampPalette(false); }} style={{
                                height:28, padding:"0 7px",
                                display:"flex", alignItems:"center", justifyContent:"center",
                                background: stampSymbol === name ? `${C.pur}22` : "transparent",
                                border:`1px solid ${stampSymbol === name ? C.pur : C.bdr}`,
                                borderRadius:6, cursor:"pointer", flexShrink:0, fontSize:11, fontWeight:700,
                                color: stampSymbol === name ? C.pur : C.txt,
                              }}>{name}</button>
                            ))
                          }
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          {/* 도형 도구 서브팔레트 — 플로팅 오버레이 */}
          {drawTool === "shape" && (
            <div style={{
              position:"absolute", top:"100%", right:10, zIndex:500,
              background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}`,
              boxShadow:"0 8px 32px rgba(0,0,0,0.5)",
              padding:"8px 12px", display:"flex", flexDirection:"column", gap:4,
            }}>
              {[
                { id:"slur",         icon:"slur",   label:"슬러"      },
                { id:"hairpin-cresc",icon:"cresc",  label:"크레센도"   },
                { id:"hairpin-dim",  icon:"dim",    label:"디크레센도"  },
                { id:"line",         icon:"line",   label:"직선"      },
                { id:"rect",         icon:"rect",   label:"박스"      },
                { id:"circle",       icon:"circle", label:"원형"      },
              ].map(s => (
                <button key={s.id} onClick={() => setShapeTool(s.id)} style={{
                  display:"flex", alignItems:"center", gap:8, padding:"5px 10px",
                  background: shapeTool === s.id ? `${C.pur}22` : "transparent",
                  border:`1px solid ${shapeTool === s.id ? C.pur : C.bdr}`,
                  borderRadius:7, cursor:"pointer",
                  fontSize:11, color: shapeTool === s.id ? C.pur : C.dim, fontFamily:"inherit", fontWeight:700,
                }}>
                  <Icon n={s.icon} size={15} color={shapeTool === s.id ? C.pur : C.dim} />
                  {s.label}
                </button>
              ))}
              <span style={{ fontSize:9, color:C.dim, textAlign:"center" }}>드래그로 그리기</span>
            </div>
          )}
        </div>
      )}

      {/* 전조 서브툴바 */}
      {transposeMode && (
        <div style={{
          display:"flex", alignItems:"flex-end", gap:8, flexWrap:"wrap",
          padding:"6px 14px", minHeight:50, flexShrink:0,
          background:`${C.grn}0a`, borderBottom:`1px solid ${C.bdr}`,
          overflowX:"auto",
        }}>
          {(() => {
            const btnSt = { width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
              background:"transparent", cursor:"pointer", fontWeight:700, fontSize:14, display:"flex",
              alignItems:"center", justifyContent:"center", fontFamily:"inherit", flexShrink:0 };
            const colGrp = { display:"flex", flexDirection:"column", alignItems:"center", gap:2, flexShrink:0 };
            const lbl = { fontSize:9, fontWeight:800, letterSpacing:"0.02em" };
            const divH = <div style={{ width:1, height:30, background:C.bdr, flexShrink:0, marginBottom:2 }} />;
            const isGuitar = getUserParts(user).includes("기타") || getUserParts(user).includes("일렉기타");
            const showCapo = isGuitar || user?.role === "admin";
            const showDict = ["기타","일렉기타","베이스","키보드","피아노"].some(p => getUserParts(user).includes(p)) || leader;

            // 싱글 모드 UI 한 섹션 — 듀얼/싱글 공통 사용
            const renderSection = (songKey, steps, saveFn, capoVal, setCapo, chords, detectFn, side) => {
              const rec = showCapo && songKey ? getCapoRec(songKey, steps) : null;
              const isAdmin = user?.role === "admin";
              const recItems = rec ? [
                ...((isAdmin || getUserParts(user).includes("기타")) && rec.acoustic ? [{ name:"기타", shape:rec.acoustic.shape, capo:rec.acoustic.capo }] : []),
                ...((isAdmin || getUserParts(user).includes("일렉기타")) && rec.electric ? [{ name:"일렉", shape:rec.electric.shape, capo:rec.electric.capo }] : []),
              ] : [];
              return (
                <>
                  <div style={colGrp}>
                    <span style={{ ...lbl, color:C.dim }}>원키</span>
                    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                      <button onClick={() => saveFn(Math.max(-6, steps - 1))} style={{ ...btnSt, color:C.txt }}>−</button>
                      <span style={{ fontSize:14, fontWeight:800, color:C.txt, minWidth:22, textAlign:"center" }}>{songKey || "?"}</span>
                      <button onClick={() => saveFn(Math.min(6, steps + 1))} style={{ ...btnSt, color:C.txt }}>+</button>
                    </div>
                  </div>
                  {divH}
                  <div style={colGrp}>
                    <span style={{ ...lbl, color:C.grn }}>서비스 키 ✓</span>
                    <div style={{ padding:"3px 12px", borderRadius:7, border:`1.5px solid ${C.grn}`,
                      background:`${C.grn}22`, color:C.grn, fontWeight:800, fontSize:14, textAlign:"center" }}>
                      {keyName(songKey, steps)}
                    </div>
                  </div>
                  {leader && chords.length === 0 && (
                    <button onClick={detectFn} disabled={detectingChords} style={{
                      background: detectingChords ? `${C.grn}44` : C.grn, border:"none", borderRadius:7,
                      padding:"5px 12px", cursor: detectingChords ? "not-allowed" : "pointer",
                      fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
                    }}>{detectingChords ? "⏳ 감지 중..." : "🎵 코드 감지 (AI)"}</button>
                  )}
                  {showCapo && (
                    <>
                      {divH}
                      <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                        <span style={{ fontSize:10, fontWeight:800, color:C.acc }}>🎸 카포</span>
                        <div style={{ display:"flex", gap:3 }}>
                          {[0,1,2,3,4,5,6,7].map(f => (
                            <button key={f} onClick={() => setCapo(f)} style={{
                              width:28, height:28, borderRadius:7,
                              border:`1.5px solid ${capoVal===f ? C.acc : C.bdr}`,
                              background: capoVal===f ? C.acc : "transparent",
                              color: capoVal===f ? "#fff" : C.txt,
                              fontSize:12, fontWeight:700, cursor:"pointer",
                              display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit",
                            }}>{f===0 ? "X" : f}</button>
                          ))}
                        </div>
                      </div>
                      {recItems.length > 0 && (
                        <div style={colGrp}>
                          <span style={{ ...lbl, color:C.acc }}>추천</span>
                          <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                            {recItems.map(item => (
                              <span key={item.name} style={{ fontSize:12, fontWeight:800, color:C.pur, whiteSpace:"nowrap" }}>{item.name} {item.shape}+{item.capo}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {showDict && (
                    <>
                      {divH}
                      <button onClick={() => setShowChordDict(side || "left")} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:7, border:`1.5px solid ${C.pur}55`, background:`${C.pur}11`, color:C.pur, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>🎵 코드사전</button>
                    </>
                  )}
                </>
              );
            };

            const utilBar = (mLeft) => (
              <div style={{ marginLeft: mLeft ? "auto" : 0, display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                {leader && (chordData.length > 0 || chordData2.length > 0) && (
                  <button onClick={() => setChordMoveMode(m => !m)} style={{ border:`1px solid ${chordMoveMode ? C.grn : C.bdr}`, borderRadius:6, background: chordMoveMode ? `${C.grn}22` : "transparent", padding:"3px 8px", cursor:"pointer", fontSize:10, color: chordMoveMode ? C.grn : C.dim, fontFamily:"inherit", flexShrink:0 }}>
                    {chordMoveMode ? "✋ 이동 ON" : "코드 이동"}
                  </button>
                )}
                {chordMoveMode && (chordData.length > 0 || chordData2.length > 0) && <span style={{ fontSize:9, color:C.dim, whiteSpace:"nowrap" }}>더블탭: 복사 · 꾹: 삭제</span>}
                <button onClick={() => { const v = Math.max(0.4, Math.round((chordFontScale - 0.2) * 10) / 10); setChordFontScale(v); saveChordFontScale(v); }} disabled={chordFontScale <= 0.4} style={{ ...btnSt, width:28, height:28, fontSize:12, color: chordFontScale <= 0.4 ? C.bdr : C.txt }}>A−</button>
                <button onClick={() => { const v = Math.min(2.0, Math.round((chordFontScale + 0.2) * 10) / 10); setChordFontScale(v); saveChordFontScale(v); }} disabled={chordFontScale >= 2.0} style={{ ...btnSt, width:28, height:28, fontSize:12, color: chordFontScale >= 2.0 ? C.bdr : C.txt }}>A+</button>
                <div style={{ width:1, height:20, background:C.bdr }} />
                {leader && <button onClick={() => { setTransposeSteps(0); setTransposeSteps2(0); setCapoFret(0); setCapoFret2(0); setChordData([]); setChordData2([]); setDetectErr(""); setChordFontScale(1.0); }} style={{ background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, color:C.dim, fontFamily:"inherit" }}>초기화</button>}
              </div>
            );

            if (dual) {
              const rSong = songs?.find(s => s.id === dualRightSongId);
              const rKey = rSong?.key || song?.key;
              return (
                <>
                  {renderSection(song?.key, transposeSteps, saveTransposeSteps, capoFret, setCapoFret, chordData, () => detectChords(1), "left")}
                  <div style={{ width:2, height:36, background:C.bdr, flexShrink:0, borderRadius:1, marginBottom:2 }} />
                  {renderSection(rKey, transposeSteps2, saveTransposeSteps2, capoFret2, setCapoFret2, chordData2, () => detectChords(2), "right")}
                  {detectErr && <span style={{ fontSize:11, color:C.red, flexShrink:0 }}>⚠ {detectErr}</span>}
                  {utilBar(true)}
                </>
              );
            }

            /* 싱글 모드 */
            return (
              <>
                {renderSection(song?.key, transposeSteps, saveTransposeSteps, capoFret, setCapoFret, chordData, () => detectChords(1))}
                {detectErr && <span style={{ fontSize:11, color:C.red, flexShrink:0 }}>⚠ {detectErr}</span>}
                {utilBar(true)}
              </>
            );
          })()}
        </div>
      )}

      {/* 코드 사전 모달 */}
      {showChordDict && (() => {
        const isRight = showChordDict === "right" && dual;
        const rSongForDict = isRight ? songs?.find(s => s.id === dualRightSongId) : null;
        const dictKey = isRight ? (rSongForDict?.key || song?.key) : song?.key;
        const dictSteps = isRight ? transposeSteps2 : transposeSteps;
        const dictCapo = isRight ? capoFret2 : capoFret;
        const effSteps = dictSteps - dictCapo;
        const sideChords = isRight ? chordData2 : chordData;
        const seen = new Set();
        const dictSongChords = sideChords
          .map(d => transposeChord(d.chord, effSteps, useFlats(dictKey, effSteps)))
          .filter(name => { if (!name || seen.has(name)) return false; seen.add(name); return true; })
          .map(name => ({ name, voicings: getVoicings(name) }));
        return (
          <ChordDictModal
            onClose={() => setShowChordDict("")}
            songChords={dictSongChords}
            songKey={dictKey}
            effectiveSteps={effSteps}
            userParts={getUserParts(user)}
            C={C}
          />
        );
      })()}

      {/* 돋보기 루프 (스탬프 모드 / 애플펜슬) */}
      <canvas ref={loupeCanvasRef} width={160} height={160}
        style={{
          position:"fixed",
          left: loupePos ? loupePos.x - 80 : -9999,
          top:  loupePos ? loupePos.y - 190 : -9999,
          width:160, height:160,
          borderRadius:"50%",
          border:"3px solid rgba(255,255,255,0.85)",
          boxShadow:"0 4px 24px rgba(0,0,0,0.55)",
          pointerEvents:"none",
          zIndex:1000,
          display: loupePos ? "block" : "none",
        }}
      />

      {/* 스탬프 선택 플로팅 패널 */}
      {stampPanel && selAnnot && (() => {
        const selSt = selStrokesRef(selAnnot).current[selAnnot.idx];
        if (!selSt || selSt.tool !== "stamp") return null;
        const curSz = selSt.size || 12;
        const clr = selSt.color || "#e8383b";
        return (
          <div style={{
            position:"fixed",
            left: stampPanel.x,
            top: stampPanel.y,
            transform: "translate(-50%, calc(-100% - 14px))",
            background:"#fff",
            border:`1.5px solid ${clr}`,
            borderRadius:14,
            padding:"6px 10px",
            display:"flex", alignItems:"center", gap:8,
            boxShadow:"0 4px 20px rgba(0,0,0,0.18), 0 1px 6px rgba(0,0,0,0.10)",
            zIndex:1500,
            touchAction:"none",
          }}>
            <button onPointerDown={e => { e.stopPropagation(); resizeSelText(-3); }} style={{
              width:32, height:32, borderRadius:8, border:`1px solid ${C.bdr}`,
              background:C.surf, cursor:"pointer", fontSize:16, fontWeight:700,
              color:C.txt, display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"inherit",
            }}>−</button>
            <span style={{ fontSize:12, fontWeight:700, color:clr, minWidth:20, textAlign:"center" }}>{curSz}</span>
            <button onPointerDown={e => { e.stopPropagation(); resizeSelText(3); }} style={{
              width:32, height:32, borderRadius:8, border:`1px solid ${C.bdr}`,
              background:C.surf, cursor:"pointer", fontSize:16, fontWeight:700,
              color:C.txt, display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"inherit",
            }}>+</button>
            <div style={{ width:1, height:22, background:C.bdr, flexShrink:0 }} />
            <button onPointerDown={e => { e.stopPropagation(); deleteSelAnnot(); setStampPanel(null); }} style={{
              width:32, height:32, borderRadius:8, border:"none",
              background:`${C.red}18`, cursor:"pointer", fontSize:15,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>🗑</button>
            <button onPointerDown={e => {
              e.stopPropagation();
              setStampPanel(null); setSelAnnot(null); selAnnotRef.current = null;
              const dc1 = drawCanvas1Ref.current, dc2 = drawCanvas2Ref.current;
              if (dc1) drawStrokes(dc1, strokes1Ref.current);
              if (dc2) drawStrokes(dc2, strokes2Ref.current);
            }} style={{
              width:28, height:28, borderRadius:7, border:`1px solid ${C.bdr}`,
              background:"transparent", cursor:"pointer", fontSize:13, color:C.dim,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>✕</button>
          </div>
        );
      })()}

      {/* 텍스트 입력 오버레이 */}
      {textDot && (
        <div style={{
          position:"fixed",
          left: textDot.sx - 10, top: textDot.sy - 10,
          width:20, height:20, borderRadius:"50%",
          background:"rgba(255,214,0,0.9)",
          boxShadow:"0 0 0 2px rgba(255,214,0,0.35), 0 1px 5px rgba(0,0,0,0.25)",
          display:"flex", alignItems:"center", justifyContent:"center",
          pointerEvents:"none", zIndex:1210,
          transition:"left 0.04s, top 0.04s",
        }}>
          <span style={{ fontSize:9, fontWeight:900, color:"rgba(0,0,0,0.75)", lineHeight:1, userSelect:"none" }}>T</span>
        </div>
      )}

      {textInput && (
        <div style={{
          position:"fixed", inset:0, zIndex:1100,
          display:"flex", alignItems:"center", justifyContent:"center",
          background:"rgba(0,0,0,0.45)",
        }} onClick={() => { setTextDot(null); setTextInput(null); }}>
          <div style={{
            background:C.surf, borderRadius:16, padding:"18px 18px 14px",
            border:`1px solid ${C.bdr}`, boxShadow:"0 12px 40px rgba(0,0,0,0.5)",
            width:280, display:"flex", flexDirection:"column", gap:10,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight:700, fontSize:14, color:C.txt }}>텍스트 입력</div>
            <input
              autoFocus
              value={textInput.value}
              onChange={e => setTextInput(p => ({ ...p, value: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") confirmText(); if (e.key === "Escape") setTextInput(null); }}
              placeholder="악보에 넣을 텍스트"
              style={{
                width:"100%", fontSize:15, padding:"9px 12px",
                border:`1.5px solid ${C.bdr}`, borderRadius:10, outline:"none",
                background:C.bg, color:C.txt, fontFamily:"inherit",
                boxSizing:"border-box",
              }}
            />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => { setTextDot(null); setTextInput(null); }} style={{
                flex:1, padding:"9px 0", borderRadius:10, border:`1px solid ${C.bdr}`,
                background:"transparent", cursor:"pointer", fontSize:13,
                color:C.dim, fontFamily:"inherit", fontWeight:600,
              }}>취소</button>
              <button onClick={confirmText} style={{
                flex:2, padding:"9px 0", borderRadius:10, border:"none",
                background:C.pur, cursor:"pointer", fontSize:13,
                color:"#fff", fontFamily:"inherit", fontWeight:700,
              }}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* D-패드 (싱글 모드, 쓰기 모드, 줌인 시에만 표시) */}
      {zoomMul > 1.0 && drawMode && !dual && (
        <div style={{
          position:"fixed", right:14, top:"50%", transform:"translateY(-50%)",
          zIndex:700, display:"flex", flexDirection:"column", alignItems:"center", gap:4,
          background:"rgba(20,20,35,0.72)", borderRadius:18, padding:"10px 8px",
          backdropFilter:"blur(6px)", border:`1px solid rgba(255,255,255,0.1)`,
          boxShadow:"0 4px 24px rgba(0,0,0,0.5)",
          userSelect:"none",
        }}>
          {/* 위 */}
          <button
            onPointerDown={() => startPan(0, PAN_STEP)} onPointerUp={stopPan} onPointerLeave={stopPan}
            style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:9,
              width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center",
              cursor:"pointer", touchAction:"none" }}>
            <Icon n="chevU" size={20} color="#fff" />
          </button>
          {/* 가운데 행: ← 100% → */}
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <button
              onPointerDown={() => startPan(PAN_STEP, 0)} onPointerUp={stopPan} onPointerLeave={stopPan}
              style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:9,
                width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", touchAction:"none" }}>
              <Icon n="chevL" size={20} color="#fff" />
            </button>
            {/* 100% 리셋 버튼 (탭 → 줌·패드 모두 초기화) */}
            <button onClick={resetZoom}
              style={{ background:C.acc, border:"none", borderRadius:10,
                width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", flexDirection:"column", gap:1, touchAction:"none" }}>
              <span style={{ fontSize:9, fontWeight:800, color:"#111", lineHeight:1 }}>
                {Math.round(zoomMul * 100)}%
              </span>
              <span style={{ fontSize:7, color:"#333", lineHeight:1 }}>RESET</span>
            </button>
            <button
              onPointerDown={() => startPan(-PAN_STEP, 0)} onPointerUp={stopPan} onPointerLeave={stopPan}
              style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:9,
                width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", touchAction:"none" }}>
              <Icon n="chevR2" size={20} color="#fff" />
            </button>
          </div>
          {/* 아래 */}
          <button
            onPointerDown={() => startPan(0, -PAN_STEP)} onPointerUp={stopPan} onPointerLeave={stopPan}
            style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:9,
              width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center",
              cursor:"pointer", touchAction:"none" }}>
            <Icon n="chevD" size={20} color="#fff" />
          </button>
        </div>
      )}

      {/* 악기 피커 — overflow 컨테이너 밖에서 fixed로 렌더 */}
      {showInstPicker && (
        <div data-inst-picker style={{
          position:"fixed",
          top:"calc(env(safe-area-inset-top) + 58px)",
          right:12,
          background:C.surf, border:`1px solid ${C.bdr}`,
          borderRadius:12, boxShadow:"0 4px 20px rgba(0,0,0,.25)",
          padding:"6px 4px", zIndex:9999, display:"flex", gap:4,
        }}>
          {INST_MODES.filter(m => !m.leaderOnly || leader).map(m => (
            <button data-inst-picker key={m.id} onClick={() => {
              const setMode = (id) => { setRecMode(id); recModeRef.current = id; localStorage.setItem("tvpc_recMode", id); };
              setMode(m.id);
              localStorage.setItem("tvpc_lastInst", m.id);
              setShowInstPicker(false);
            }} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:2,
              padding:"8px 10px", borderRadius:9, cursor:"pointer",
              background: recMode === m.id ? `${C.grn}22` : "transparent",
              border:`1px solid ${recMode === m.id ? C.grn : "transparent"}`,
            }}>
              <span style={{ fontSize:20 }}>{m.emoji}</span>
              <span style={{ fontSize:10, fontWeight:700, color: recMode === m.id ? C.grn : C.dim, fontFamily:"inherit", whiteSpace:"nowrap" }}>{m.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 콘텐츠 */}
      <div style={{ flex:1, overflow:"hidden", display:"flex" }}>
        {/* PDF 캔버스 영역 */}
        <div ref={containerRef} style={{ flex:1, overflow:"hidden", display:"flex",
          position:"relative", background:C.bg, touchAction:"none", userSelect:"none", WebkitUserSelect:"none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}>

          {/* 로딩 중 표시 — numPages=0이고 컨텐츠 있을 때 */}
          {!dual && !loadErr && numPages === 0 && (song?.pdfUrl || song?.imageUrl) && (
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
              justifyContent:"center", zIndex:10, pointerEvents:"none" }}>
              <div style={{ color:C.dim, fontSize:14 }}>불러오는 중...</div>
            </div>
          )}

          {dual ? (
            // ── 듀얼 모드: Piascore 스타일 — 패딩 없이 슬롯 상단부터 꽉 채움
            <>
              {/* 왼쪽 곡 */}
              <div style={{ width:"50%", height:"100%", display:"flex",
                alignItems:"flex-start", justifyContent:"center",
                borderRight:`1px solid ${C.bdr}`, overflow:"hidden",
                background:"#fff" }}>
                {(svcSongs[dualIdx]?.pdfUrl || svcSongs[dualIdx]?.imageUrl)
                  ? <div style={{ position:"relative", display:"inline-block", lineHeight:0 }}>
                      <canvas ref={canvas1Ref} width={0} height={0} style={{ display:"block" }} />
                      <canvas ref={teamDrawCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4, pointerEvents:"none",
                      }} />
                      <canvas ref={pointerCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4, pointerEvents:"none",
                      }} />
                      <canvas ref={drawCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4, touchAction:"none",
                        cursor: drawMode ? (drawTool === "eraser" ? "cell" : drawTool === "select" ? "default" : "crosshair") : "default",
                        pointerEvents: drawMode ? "auto" : "none",
                      }}
                        onPointerDown={handleDraw1Down}
                        onPointerMove={handleDraw1Move}
                        onPointerUp={handleDraw1Up}
                        onPointerCancel={handleDraw1Cancel}
                        onPointerLeave={() => {
                          if (drawTool === "text" && !textInput) setTextDot(null);
                          if (drawTool === "stamp") { stampPressed1Ref.current = false; setLoupePos(null); }
                        }}
                      />
                      {/* 포인터 입력 오버레이 (리더 전용) */}
                      {(leader || user?.role === "admin") && pointerOn && (
                        <canvas style={{
                          position:"absolute", top:0, left:0, width:"100%", height:"100%",
                          borderRadius:4, touchAction:"auto", pointerEvents:"auto",
                          cursor:"crosshair",
                        }}
                          onPointerDown={e => handlePointerPenDown(e, pointerCanvas1Ref)}
                          onPointerMove={e => handlePointerPenMove(e, pointerCanvas1Ref)}
                          onPointerUp={e => handlePointerPenUp(e, pointerCanvas1Ref)}
                          onPointerCancel={e => handlePointerPenUp(e, pointerCanvas1Ref)}
                        />
                      )}
                      {transposeMode && chordData.length > 0 && (() => {
                        const cw = canvas1Ref.current?.offsetWidth  || 400;
                        const fs = Math.round(Math.max(8, Math.min(14, cw / 50)) * chordFontScale);
                        const canMove = leader && chordMoveMode;
                        const effectiveSteps = transposeSteps - capoFret;
                        return (
                          <div ref={chordOverlay1Ref}
                            style={{ position:"absolute", inset:0, pointerEvents:"none" }}
                            onPointerMove={canMove ? e => handleChordPointerMove(e, 1) : undefined}
                            onPointerUp={canMove ? () => handleChordPointerUp(1) : undefined}>
                            {chordData.map((item, i) => {
                              const isPendingDel = deletingChord?.side===1 && deletingChord?.idx===i;
                              return (
                              <span key={i} style={{
                                position:"absolute",
                                left:`${item.x * 100}%`, top:`${item.y * 100}%`,
                                transform:"translate(-50%,-50%)",
                                background: isPendingDel ? "rgba(220,50,50,0.95)" : effectiveSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                color: isPendingDel ? "#fff" : effectiveSteps === 0 ? "#fff" : "#111",
                                borderRadius:3, padding:"1px 4px",
                                fontSize:fs, fontWeight:800, lineHeight:1.5,
                                whiteSpace:"nowrap", fontFamily:"monospace",
                                boxShadow: canMove ? "0 1px 8px rgba(0,0,0,.45)" : "0 1px 4px rgba(0,0,0,.3)",
                                pointerEvents: canMove ? "auto" : "none", touchAction:"none",
                                cursor: canMove ? (dragChord?.side===1 && dragChord?.idx===i ? "grabbing" : "grab") : "default",
                                userSelect:"none",
                                transition:"background 0.15s",
                                outline: canMove ? "1.5px dashed rgba(255,255,255,0.6)" : "none",
                              }}
                                onPointerDown={canMove ? e => handleChordPointerDown(e, 1, i) : undefined}
                                onTouchStart={canMove ? e => e.stopPropagation() : undefined}>
                                {transposeChord(item.chord, effectiveSteps, useFlats(song.key, effectiveSteps))}
                              </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  : <div style={{ textAlign:"center", color:C.dim }}>
                      <div style={{ fontSize:32, marginBottom:8 }}>🎼</div>
                      <div style={{ fontWeight:600, fontSize:13 }}>{svcSongs[dualIdx]?.title || ""}</div>
                      <div style={{ fontSize:11, marginTop:4 }}>PDF 없음</div>
                    </div>
                }
              </div>
              {/* 오른쪽 곡 */}
              <div style={{ width:"50%", height:"100%", display:"flex",
                alignItems:"flex-start", justifyContent:"center",
                overflow:"hidden", background:"#fff" }}>
                {svcSongs[dualIdx + 1]
                  ? (svcSongs[dualIdx + 1].pdfUrl || svcSongs[dualIdx + 1].imageUrl)
                    ? <div style={{ position:"relative", display:"inline-block", lineHeight:0 }}>
                        <canvas ref={canvas2Ref} width={0} height={0} style={{ display:"block" }} />
                        <canvas ref={teamDrawCanvas2Ref} style={{
                          position:"absolute", top:0, left:0, width:"100%", height:"100%",
                          borderRadius:4, pointerEvents:"none",
                        }} />
                        <canvas ref={pointerCanvas2Ref} style={{
                          position:"absolute", top:0, left:0, width:"100%", height:"100%",
                          borderRadius:4, pointerEvents:"none",
                        }} />
                        <canvas ref={drawCanvas2Ref} style={{
                          position:"absolute", top:0, left:0, width:"100%", height:"100%",
                          borderRadius:4, touchAction:"none",
                          cursor: drawMode ? (drawTool === "eraser" ? "cell" : drawTool === "select" ? "default" : "crosshair") : "default",
                          pointerEvents: drawMode ? "auto" : "none",
                        }}
                          onPointerDown={handleDraw2Down}
                          onPointerMove={handleDraw2Move}
                          onPointerUp={handleDraw2Up}
                          onPointerCancel={handleDraw2Cancel}
                          onPointerLeave={() => {
                            if (drawTool === "text" && !textInput) setTextDot(null);
                            if (drawTool === "stamp") { stampPressed2Ref.current = false; setLoupePos(null); }
                          }}
                        />
                        {/* 포인터 입력 오버레이 (리더/어드민 전용) — 오른쪽 */}
                        {(leader || user?.role === "admin") && pointerOn && (
                          <canvas style={{
                            position:"absolute", top:0, left:0, width:"100%", height:"100%",
                            borderRadius:4, touchAction:"auto", pointerEvents:"auto",
                            cursor:"crosshair",
                          }}
                            onPointerDown={e => handlePointerPenDown(e, pointerCanvas2Ref)}
                            onPointerMove={e => handlePointerPenMove(e, pointerCanvas2Ref)}
                            onPointerUp={e => handlePointerPenUp(e, pointerCanvas2Ref)}
                            onPointerCancel={e => handlePointerPenUp(e, pointerCanvas2Ref)}
                          />
                        )}
                        {transposeMode && chordData2.length > 0 && (() => {
                          const cw = canvas2Ref.current?.offsetWidth  || 400;
                          const fs = Math.round(Math.max(8, Math.min(14, cw / 50)) * chordFontScale);
                          const canMove = leader && chordMoveMode;
                          return (
                            <div ref={chordOverlay2Ref}
                              style={{ position:"absolute", inset:0, pointerEvents:"none" }}
                              onPointerMove={canMove ? e => handleChordPointerMove(e, 2) : undefined}
                              onPointerUp={canMove ? () => handleChordPointerUp(2) : undefined}>
                              {chordData2.map((item, i) => {
                                const isPendingDel = deletingChord?.side===2 && deletingChord?.idx===i;
                                return (
                                <span key={i} style={{
                                  position:"absolute",
                                  left:`${item.x * 100}%`, top:`${item.y * 100}%`,
                                  transform:"translate(-50%,-50%)",
                                  background: isPendingDel ? "rgba(220,50,50,0.95)" : (transposeSteps2 - capoFret2) === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                  color: isPendingDel ? "#fff" : (transposeSteps2 - capoFret2) === 0 ? "#fff" : "#111",
                                  borderRadius:3, padding:"1px 4px",
                                  fontSize:fs, fontWeight:800, lineHeight:1.5,
                                  whiteSpace:"nowrap", fontFamily:"monospace",
                                  boxShadow: canMove ? "0 1px 8px rgba(0,0,0,.45)" : "0 1px 4px rgba(0,0,0,.3)",
                                  pointerEvents: canMove ? "auto" : "none", touchAction:"none",
                                  cursor: canMove ? (dragChord?.side===2 && dragChord?.idx===i ? "grabbing" : "grab") : "default",
                                  userSelect:"none",
                                  transition:"background 0.15s",
                                  outline: canMove ? "1.5px dashed rgba(255,255,255,0.6)" : "none",
                                }}
                                  onPointerDown={canMove ? e => handleChordPointerDown(e, 2, i) : undefined}
                                  onTouchStart={canMove ? e => e.stopPropagation() : undefined}>
                                  {transposeChord(item.chord, transposeSteps2 - capoFret2, useFlats(songs?.find(s => s.id === dualRightSongId)?.key || song?.key, transposeSteps2 - capoFret2))}
                                </span>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    : <div style={{ textAlign:"center", color:C.dim }}>
                        <div style={{ fontSize:32, marginBottom:8 }}>🎼</div>
                        <div style={{ fontWeight:600, fontSize:13 }}>{svcSongs[dualIdx + 1].title}</div>
                        <div style={{ fontSize:11, marginTop:4 }}>PDF 없음</div>
                      </div>
                  : <div style={{ textAlign:"center", color:C.dim }}>
                      <div style={{ fontSize:36, marginBottom:8 }}>🏁</div>
                      <div style={{ fontSize:13 }}>마지막 곡</div>
                    </div>
                }
              </div>
            </>
          ) : (
            // ── 싱글 모드 (panOffset transform으로 D-패드 이동)
            <div style={{ width:"100%", height:"100%", display:"flex",
              alignItems:"center", justifyContent:"center", padding:8,
              transform: panOffset.x !== 0 || panOffset.y !== 0
                ? `translate(${panOffset.x}px,${panOffset.y}px)` : undefined,
              willChange: panOffset.x !== 0 || panOffset.y !== 0 ? "transform" : undefined,
            }}>
              {(song.pdfUrl || song.imageUrl) ? (
                loadErr
                  ? <div style={{ color:C.red, fontSize:13 }}>{loadErr}</div>
                  : <div style={{ position:"relative", display:"inline-block", lineHeight:0, flexShrink:0 }}>
                      <canvas ref={canvas1Ref} width={0} height={0} style={{ display:"block",
                        borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
                      <canvas ref={teamDrawCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4, pointerEvents:"none",
                      }} />
                      <canvas ref={pointerCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4, pointerEvents:"none",
                      }} />
                      <canvas ref={drawCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4,
                        cursor: drawMode ? (drawTool === "eraser" ? "cell" : drawTool === "select" ? "default" : "crosshair") : "default",
                        touchAction:"none",
                        pointerEvents: drawMode ? "auto" : "none",
                      }}
                        onPointerDown={handleDraw1Down}
                        onPointerMove={handleDraw1Move}
                        onPointerUp={handleDraw1Up}
                        onPointerCancel={handleDraw1Cancel}
                        onPointerLeave={() => {
                          if (drawTool === "text" && !textInput) setTextDot(null);
                          if (drawTool === "stamp") { stampPressed1Ref.current = false; setLoupePos(null); }
                        }}
                      />
                      {(leader || user?.role === "admin") && pointerOn && (
                        <canvas style={{
                          position:"absolute", top:0, left:0, width:"100%", height:"100%",
                          borderRadius:4, touchAction:"auto", pointerEvents:"auto",
                          cursor:"crosshair",
                        }}
                          onPointerDown={e => handlePointerPenDown(e, pointerCanvas1Ref)}
                          onPointerMove={e => handlePointerPenMove(e, pointerCanvas1Ref)}
                          onPointerUp={e => handlePointerPenUp(e, pointerCanvas1Ref)}
                          onPointerCancel={e => handlePointerPenUp(e, pointerCanvas1Ref)}
                        />
                      )}
                      {/* 전조 코드 오버레이 */}
                      {transposeMode && chordData.length > 0 && (() => {
                        const cw = canvas1Ref.current?.offsetWidth  || 600;
                        const fs = Math.round(Math.max(10, Math.min(16, cw / 50)) * chordFontScale);
                        const canMove = leader && chordMoveMode;
                        const effectiveSteps = transposeSteps - capoFret;
                        return (
                          <div ref={chordOverlay1Ref}
                            style={{ position:"absolute", inset:0, pointerEvents:"none", borderRadius:4 }}
                            onPointerMove={canMove ? e => handleChordPointerMove(e, 1) : undefined}
                            onPointerUp={canMove ? () => handleChordPointerUp(1) : undefined}
                          >
                            {chordData.map((item, i) => {
                              const isPendingDel = deletingChord?.side===1 && deletingChord?.idx===i;
                              return (
                              <span key={i} style={{
                                position:"absolute",
                                left:`${item.x * 100}%`,
                                top:`${item.y * 100}%`,
                                transform:"translate(-50%, -50%)",
                                background: isPendingDel ? "rgba(220,50,50,0.95)" : effectiveSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                color: isPendingDel ? "#fff" : effectiveSteps === 0 ? "#fff" : "#111",
                                borderRadius:3, padding:"2px 6px",
                                fontSize:fs, fontWeight:800, lineHeight:1.5,
                                whiteSpace:"nowrap", fontFamily:"monospace",
                                boxShadow: canMove ? "0 1px 8px rgba(0,0,0,.45)" : "0 1px 4px rgba(0,0,0,.3)",
                                pointerEvents: canMove ? "auto" : "none", touchAction:"none",
                                cursor: canMove ? (dragChord?.side===1 && dragChord?.idx===i ? "grabbing" : "grab") : "default",
                                userSelect:"none",
                                transition:"background 0.15s",
                                outline: canMove ? "1.5px dashed rgba(255,255,255,0.6)" : "none",
                              }}
                                onPointerDown={canMove ? e => handleChordPointerDown(e, 1, i) : undefined}
                                onTouchStart={canMove ? e => e.stopPropagation() : undefined}
                              >
                                {transposeChord(item.chord, effectiveSteps, useFlats(song.key, effectiveSteps))}
                              </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                  justifyContent:"center", color:C.dim, textAlign:"center", padding:40 }}>
                  <div style={{
                    width:84, height:84, borderRadius:18,
                    background:`linear-gradient(135deg, ${C.acc}22, ${C.pur}22)`,
                    border:`1px solid ${C.bdr}`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:38, marginBottom:16,
                  }}>🎼</div>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:6 }}>{song.title}</div>
                  <div style={{ fontSize:13 }}>PDF 또는 이미지 악보가 없습니다</div>
                </div>
              )}
            </div>
          )}

          {/* 파트 레이블 (결단·Closing만 표시) */}
          {!dual && curSongPart && PART_LABEL_COLORS[curSongPart] && (
            <div style={{
              position:"absolute", top:10, left:10, zIndex:30, pointerEvents:"none",
              background: PART_LABEL_COLORS[curSongPart] + "cc",
              color:"#fff", fontSize:14, fontWeight:800,
              padding:"5px 14px", borderRadius:14,
              letterSpacing:"0.04em",
            }}>{curSongPart}</div>
          )}
          {dual && dualLeftPart && PART_LABEL_COLORS[dualLeftPart] && (
            <div style={{
              position:"absolute", top:10, left:10, zIndex:30, pointerEvents:"none",
              background: PART_LABEL_COLORS[dualLeftPart] + "cc",
              color:"#fff", fontSize:14, fontWeight:800,
              padding:"5px 14px", borderRadius:14, letterSpacing:"0.04em",
            }}>{dualLeftPart}</div>
          )}
          {dual && dualRightPart && PART_LABEL_COLORS[dualRightPart] && (
            <div style={{
              position:"absolute", top:10, left:"calc(50% + 10px)", zIndex:30, pointerEvents:"none",
              background: PART_LABEL_COLORS[dualRightPart] + "cc",
              color:"#fff", fontSize:14, fontWeight:800,
              padding:"5px 14px", borderRadius:14, letterSpacing:"0.04em",
            }}>{dualRightPart}</div>
          )}

          {/* 토스트 메시지 (싱글/듀얼 공통) */}
          {dualToast && (
            <div style={{
              position:"absolute", top:16, left:"50%",
              transform:"translateX(-50%)",
              background:"rgba(40,40,44,0.55)",
              backdropFilter:"blur(10px)",
              WebkitBackdropFilter:"blur(10px)",
              color:"#ffffff",
              padding:"7px 18px", borderRadius:20, fontSize:13,
              fontWeight:600, zIndex:50, pointerEvents:"none",
              whiteSpace:"nowrap", letterSpacing:"0.01em",
            }}>
              {dualToast}
            </div>
          )}
        </div>

        {/* AI 패널 (MEDIA 모드, 듀얼 아닐 때만) */}
        {media && !dual && (
          <div style={{ width:320, flexShrink:0, overflow:"hidden",
            borderLeft:`1px solid ${C.bdr}`, background:C.surf,
            display:"flex", flexDirection:"column" }}>
            {/* YouTube 플레이어 */}
            {getYoutubeId(song?.youtubeUrl) && (() => {
              const startSec = mmssToSec(ytRange.start);
              const endSec   = mmssToSec(ytRange.end);
              const baseEmbed = getYoutubeEmbed(song.youtubeUrl);
              const src = baseEmbed
                + (startSec ? `&start=${startSec}` : "")
                + (endSec   ? `&end=${endSec}`     : "");
              const hasRange = !!(ytRange.start || ytRange.end);
              return (
                <div style={{ flexShrink:0 }}>
                  {/* 구간 설정 — 영상 위 */}
                  <div style={{ padding:"6px 10px 7px", borderBottom:`1px solid ${C.bdr}` }}>
                    <div style={{ fontSize:10, color:C.dim, marginBottom:4, fontWeight:600 }}>재생 구간 (MM:SS)</div>
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <input value={ytRange.start} onChange={e => setYtRange(r => ({ ...r, start: e.target.value }))}
                        placeholder="시작" maxLength={7}
                        style={{ flex:1, fontSize:12, padding:"4px 6px", borderRadius:6, border:`1px solid ${C.bdr}`,
                          background:C.card, color:C.txt, fontFamily:"monospace", textAlign:"center" }} />
                      <span style={{ fontSize:11, color:C.dim, flexShrink:0 }}>~</span>
                      <input value={ytRange.end} onChange={e => setYtRange(r => ({ ...r, end: e.target.value }))}
                        placeholder="종료" maxLength={7}
                        style={{ flex:1, fontSize:12, padding:"4px 6px", borderRadius:6, border:`1px solid ${C.bdr}`,
                          background:C.card, color:C.txt, fontFamily:"monospace", textAlign:"center" }} />
                      <button onClick={() => {
                        if (selectedSongId) localStorage.setItem(`tvpc_ytr_${selectedSongId}`, JSON.stringify(ytRange));
                      }} style={{ fontSize:11, padding:"4px 8px", borderRadius:6, cursor:"pointer", flexShrink:0,
                        background:`${C.grn}22`, border:`1px solid ${C.grn}55`, color:C.grn, fontWeight:700, fontFamily:"inherit" }}>
                        저장
                      </button>
                      {hasRange && (
                        <button onClick={() => {
                          const reset = { start:"", end:"" };
                          setYtRange(reset);
                          if (selectedSongId) localStorage.removeItem(`tvpc_ytr_${selectedSongId}`);
                        }} style={{ fontSize:11, padding:"4px 8px", borderRadius:6, cursor:"pointer", flexShrink:0,
                          background:`${C.red}22`, border:`1px solid ${C.red}55`, color:C.red, fontWeight:700, fontFamily:"inherit" }}>
                        초기화
                        </button>
                      )}
                    </div>
                  </div>
                  <iframe
                    key={src}
                    ref={ytIframeRef}
                    src={src}
                    style={{ width:"100%", aspectRatio:"16/9", border:"none", display:"block" }}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                    title="YouTube"
                  />
                </div>
              );
            })()}
            <div style={{ flex:1, overflow:"auto" }}>
              <AIPanel song={song} user={user} pdfCanvasRef={canvas1Ref} />
            </div>
          </div>
        )}

        {/* 메모 패널 */}
        {showNotePanel && (
          <div style={{ width:270, flexShrink:0, background:C.surf, borderLeft:`1px solid ${C.bdr}`,
            display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"12px 16px 10px", flexShrink:0, borderBottom:`1px solid ${C.bdr}` }}>
              <div style={{ fontWeight:700 }}>메모</div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => { setNoteInput(true); setShowNotePanel(false); }}
                  style={{ background:C.acc, border:"none", borderRadius:6, padding:"4px 10px",
                    cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                  <Icon n="plus" size={13} color="#111" />
                  <span style={{ fontSize:11, fontWeight:700, color:"#111" }}>추가</span>
                </button>
                <button onClick={() => setShowNotePanel(false)}
                  style={{ background:"none", border:"none", cursor:"pointer", color:C.dim, display:"flex" }}>
                  <Icon n="xmark" size={18} />
                </button>
              </div>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:16 }}>
              {dual && dualLeftSongId && dualRightSongId && (
                <div style={{ display:"flex", gap:5, marginBottom:12 }}>
                  {[
                    { id: dualLeftSongId,  label: `⬅ ${svcSongs[dualIdx]?.title || "왼쪽"}` },
                    { id: dualRightSongId, label: `➡ ${svcSongs[dualIdx+1]?.title || "오른쪽"}` },
                  ].map(o => (
                    <button key={o.id} onClick={() => setNoteSongId(o.id)}
                      style={{ flex:1, padding:"5px 4px", borderRadius:7, cursor:"pointer",
                        fontFamily:"inherit", fontSize:11, fontWeight:700,
                        background: effectiveNoteSongId === o.id ? C.acc : C.card,
                        color: effectiveNoteSongId === o.id ? "#111" : C.dim,
                        border: `1.5px solid ${effectiveNoteSongId === o.id ? C.acc : C.bdr}`,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {/* 팀 메모 */}
              <div style={{ fontSize:11, fontWeight:800, color:C.acc, letterSpacing:"0.05em", marginBottom:6 }}>👥 팀 메모</div>
              {teamNotes.length === 0
                ? <div style={{ color:C.dim, fontSize:12, marginBottom:14, padding:"6px 0" }}>팀 메모가 없습니다</div>
                : teamNotes.map(n => (
                  <div key={n.id} style={{ background:`${C.acc}0d`, borderRadius:10, padding:"10px 12px",
                    marginBottom:8, border:`1px solid ${C.acc}33` }}>
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                      <div style={{ flex:1 }}>
                        {n.page > 0 && <span style={{ fontSize:10, color:C.acc, fontWeight:700 }}>p.{n.page} </span>}
                        <span style={{ fontSize:13, lineHeight:1.5 }}>{n.text}</span>
                      </div>
                      {n.userId === user.uid && <button onClick={() => deleteNote(n.id)}
                        style={{ background:"none", border:"none", cursor:"pointer", padding:2, display:"flex" }}>
                        <Icon n="trash" size={14} color={C.red} />
                      </button>}
                    </div>
                  </div>
                ))
              }
              {/* 개인 메모 */}
              <div style={{ fontSize:11, fontWeight:800, color:C.pur, letterSpacing:"0.05em", margin:"10px 0 6px" }}>🔒 내 메모</div>
              {myNotes.length === 0
                ? <div style={{ color:C.dim, fontSize:12, padding:"6px 0" }}>개인 메모가 없습니다</div>
                : myNotes.map(n => (
                  <div key={n.id} style={{ background:C.card, borderRadius:10, padding:"10px 12px",
                    marginBottom:8, border:`1px solid ${C.bdr}` }}>
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                      <div style={{ flex:1 }}>
                        {n.page > 0 && <span style={{ fontSize:10, color:C.pur, fontWeight:700 }}>p.{n.page} </span>}
                        <span style={{ fontSize:13, lineHeight:1.5 }}>{n.text}</span>
                      </div>
                      <button onClick={() => deleteNote(n.id)}
                        style={{ background:"none", border:"none", cursor:"pointer", padding:2, display:"flex" }}>
                        <Icon n="trash" size={14} color={C.red} />
                      </button>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* 큐 입력 패널 */}
        {showCueInput && !isLibraryMode && (
          <div style={{ width:320, flexShrink:0, background:C.surf, borderLeft:`2px solid #ff6f0044`,
            display:"flex", flexDirection:"column", overflow:"hidden" }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onPointerMove={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
            onTouchEnd={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div style={{ padding:"14px 16px 8px", borderBottom:`1px solid ${C.bdr}`, flexShrink:0,
              display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>🎯 큐 노트</div>
                <div style={{ fontSize:11, color:"#e65c00", marginTop:2 }}>{cueSong?.title}</div>
                <div style={{ fontSize:10, color:C.dim, marginTop:1 }}>FOH에게 전달하는 요청 / 알림{dual ? " (왼쪽 악보 기준)" : ""}</div>
              </div>
              <button onClick={() => { setShowCueInput(false); setCueTxt(""); setCueScr(""); }}
                style={{ flexShrink:0, background:"transparent", border:`1px solid ${C.bdr}`,
                  borderRadius:8, padding:"3px 8px", cursor:"pointer", color:C.dim, fontSize:13,
                  fontFamily:"inherit", fontWeight:700 }}>✕</button>
            </div>
            {/* 스크롤 가능 콘텐츠 */}
            <div style={{ flex:1, overflowY:"auto", padding:"10px 16px", display:"flex", flexDirection:"column", gap:0 }}>
            <div style={{ width:"100%" }}>
              {/* 기존 큐 목록 */}
              {(songCues?.[cueSongId] || []).length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
                  {(songCues[cueSongId]).map(cue => {
                    const isOwn = !!(user?.uid && cue.userId && cue.userId === user.uid);
                    const isEditing = cueEditId === cue.id;
                    return (
                      <div key={cue.id} style={{ padding:"8px 10px", borderRadius:8,
                        background: isOwn ? "#ff6f0018" : "#ff6f0008",
                        border:`1px solid ${isOwn ? "#ff6f0055" : "#ff6f0025"}` }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                          <span style={{ fontSize:11, fontWeight:800, color:"#e65c00" }}>{cue.userPart || cue.userName}</span>
                          {isOwn && !isEditing && (
                            <div style={{ display:"flex", gap:5 }}>
                              <button onClick={() => { setCueEditId(cue.id); setCueEditTxt(cue.text); }}
                                style={{ fontSize:11, fontWeight:700, color:"#5c4000",
                                  background:"#ffe082", border:"1px solid #ffca28",
                                  borderRadius:6, padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>
                                ✏️ 수정
                              </button>
                              <button onClick={async () => { await deleteCue?.(cue.id); }}
                                style={{ fontSize:11, fontWeight:700, color:"#b71c1c",
                                  background:"#ffebee", border:"1px solid #ef9a9a",
                                  borderRadius:6, padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>
                                🗑️ 삭제
                              </button>
                            </div>
                          )}
                        </div>
                        {isEditing ? (
                          <div>
                            <textarea value={cueEditTxt} onChange={e => setCueEditTxt(e.target.value)}
                              autoFocus
                              style={{ width:"100%", fontSize:13, color:C.txt,
                                background:C.card, border:`1px solid #ff6f0055`, borderRadius:6,
                                padding:"6px 8px", resize:"none", height:72,
                                fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
                            <div style={{ display:"flex", gap:6, marginTop:5 }}>
                              <button onClick={async () => { await editCue?.(cue.id, cueEditTxt); setCueEditId(null); }}
                                style={{ flex:1, fontSize:12, fontWeight:700, background:"#e65c00", color:"#fff",
                                  border:"none", borderRadius:7, padding:"6px 0", cursor:"pointer", fontFamily:"inherit" }}>
                                저장
                              </button>
                              <button onClick={() => setCueEditId(null)}
                                style={{ flex:1, fontSize:12, fontWeight:700, background:C.card, color:C.dim,
                                  border:`1px solid ${C.bdr}`, borderRadius:7, padding:"6px 0", cursor:"pointer", fontFamily:"inherit" }}>
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize:12, color:C.txt }}>{cue.text}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* 섹션 선택 */}
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8, marginTop:4 }}>
                {CUE_SECTIONS.map(sec => (
                  <button key={sec} onClick={() => setCueSection(sec)}
                    style={{ padding:"4px 10px", borderRadius:20, cursor:"pointer",
                      fontFamily:"inherit", fontSize:11, fontWeight:700,
                      background: cueSection === sec ? "#ff6f00" : C.card,
                      color: cueSection === sec ? "#fff" : C.dim,
                      border:`1.5px solid ${cueSection === sec ? "#ff6f00" : C.bdr}` }}>
                    {sec}
                  </button>
                ))}
              </div>
              {/* 글자 표시/편집 영역 — 변환 후 직접 수정 가능 */}
              <textarea
                value={cueTxt}
                onChange={e => setCueTxt(e.target.value)}
                placeholder="작성된 내용이 여기 표시됩니다"
                style={{ width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`, borderRadius:10,
                  padding:"10px 14px", minHeight:44, fontSize:14, color:C.txt,
                  lineHeight:1.6, resize:"none", outline:"none",
                  fontFamily:"inherit", boxSizing:"border-box" }}
              />
              {/* 입력 모드: 손글씨(캔버스) / 타입 */}
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                {[{ v:true, label:"✍️ 필기" }, { v:false, label:"⌨️ 타입" }].map(o => (
                  <button key={o.label} onClick={() => setCueInk(o.v)}
                    style={{ flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
                      fontFamily:"inherit", fontSize:12, fontWeight:700,
                      background: cueInk === o.v ? "#ff6f00" : C.card,
                      color: cueInk === o.v ? "#fff" : C.dim,
                      border:`1.5px solid ${cueInk === o.v ? "#ff6f00" : C.bdr}` }}>
                    {o.label}
                  </button>
                ))}
              </div>
              {cueInk ? (
                <HandwritePad accent="#ff6f00" apiKey={user?.geminiKey || sharedGeminiKey}
                  onText={t => setCueTxt(p => (p + (p ? " " : "") + t).trim())} />
              ) : (
              <>
              <textarea
                value={cueScr}
                onChange={e => {
                  const v = e.target.value;
                  setCueScr(v);
                }}
                placeholder="여기에 타입하세요"
                autoFocus
                style={{ width:"100%", background:`#ff6f0008`, border:`1.5px solid #ff6f0044`,
                  color:C.txt, padding:"10px 14px", borderRadius:10,
                  fontSize:14, outline:"none", fontFamily:"inherit",
                  resize:"none", height:120, marginTop:8 }}
              />
              <div style={{ display:"flex", gap:6, marginTop:8 }}>
                <button onClick={() => { if (cueScr.trim()) { setCueTxt(p => (p + (p ? " " : "") + cueScr.trim()).trim()); setCueScr(""); } }}
                  disabled={!cueScr.trim()}
                  style={{ flex:1.3, padding:"9px 0", borderRadius:10, cursor: cueScr.trim() ? "pointer" : "not-allowed",
                    background: cueScr.trim() ? "#ff6f00" : C.card, border:`1px solid ${cueScr.trim() ? "#ff6f00" : C.bdr}`,
                    fontFamily:"inherit", fontSize:13, fontWeight:800,
                    color: cueScr.trim() ? "#fff" : C.dim, opacity: cueScr.trim() ? 1 : 0.4 }}>
                  ⬆ 올리기
                </button>
                <button onClick={() => setCueTxt(p => p + " ")}
                  style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:"pointer",
                    background:C.card, border:`1px solid ${C.bdr}`,
                    fontFamily:"inherit", fontSize:13, fontWeight:700, color:C.txt }}>
                  ␣ 스페이스
                </button>
                <button onClick={() => { setCueScr(""); setCueTxt(p => p.slice(0,-1)); }}
                  disabled={!cueTxt && !cueScr}
                  style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:(cueTxt||cueScr) ? "pointer":"not-allowed",
                    background:C.card, border:`1px solid ${C.bdr}`,
                    fontFamily:"inherit", fontSize:13, fontWeight:700,
                    color:(cueTxt||cueScr) ? C.txt : C.dim, opacity:(cueTxt||cueScr) ? 1 : 0.4 }}>
                  ⌫ 지우기
                </button>
                <button onClick={() => { setCueScr(""); setCueTxt(""); }}
                  disabled={!cueTxt && !cueScr}
                  style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:(cueTxt||cueScr) ? "pointer":"not-allowed",
                    background:(cueTxt||cueScr) ? `${C.red}18` : C.card,
                    border:`1px solid ${(cueTxt||cueScr) ? C.red+"55" : C.bdr}`,
                    fontFamily:"inherit", fontSize:13, fontWeight:700,
                    color:(cueTxt||cueScr) ? C.red : C.dim, opacity:(cueTxt||cueScr) ? 1 : 0.4 }}>
                  ✕ 전체 삭제
                </button>
              </div>
              </>
              )}
            </div>{/* /스크롤 콘텐츠 inner */}
            </div>{/* /스크롤 콘텐츠 */}
            {/* 하단 전송 버튼 */}
            <div style={{ padding:"10px 16px", borderTop:`1px solid ${C.bdr}`, flexShrink:0 }}>
              <Btn label="전송" variant="primary"
                onClick={() => {
                  const final = (cueTxt + (cueScr.trim() ? (cueTxt ? " " : "") + cueScr.trim() : "")).trim();
                  if (final) { sendCue?.(selectedSvcId, cueSongId, final, { section: cueSection }); setCueTxt(""); setCueScr(""); setCueSection("전체"); setShowCueInput(false); }
                }}
                full disabled={!cueTxt.trim() && !cueScr.trim()} />
            </div>
          </div>
        )}
      </div>

      {/* 메모 입력 */}
      {noteInput && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:20 }}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onPointerMove={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}>
          <div style={{ background:C.surf, borderRadius:16, padding:20,
            width:"100%", maxWidth:400, border:`1px solid ${C.bdr}` }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>메모 추가 (p.{pageNum})</div>
            {dual && dualLeftSongId && dualRightSongId && (
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:C.dim, marginBottom:5 }}>어느 악보에 저장할까요?</div>
                <div style={{ display:"flex", gap:6 }}>
                  {[
                    { id: dualLeftSongId,  label: `⬅ ${svcSongs[dualIdx]?.title || "왼쪽"}` },
                    { id: dualRightSongId, label: `➡ ${svcSongs[dualIdx+1]?.title || "오른쪽"}` },
                  ].map(o => (
                    <button key={o.id} onClick={() => setNoteSongId(o.id)}
                      style={{ flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
                        fontFamily:"inherit", fontSize:12, fontWeight:700,
                        background: effectiveNoteSongId === o.id ? C.acc : C.card,
                        color: effectiveNoteSongId === o.id ? "#111" : C.dim,
                        border: `1.5px solid ${effectiveNoteSongId === o.id ? C.acc : C.bdr}` }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {leader && (
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                {[{ v:false, label:"🔒 개인 메모" }, { v:true, label:"👥 팀 메모" }].map(o => (
                  <button key={String(o.v)} onClick={() => setNoteShared(o.v)}
                    style={{ flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
                      fontFamily:"inherit", fontSize:12, fontWeight:700,
                      background: noteShared === o.v ? (o.v ? C.acc : C.pur) : C.card,
                      color: noteShared === o.v ? (o.v ? "#111" : "#fff") : C.dim,
                      border: `1.5px solid ${noteShared === o.v ? (o.v ? C.acc : C.pur) : C.bdr}` }}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {/* 글자 표시 영역 */}
            <div style={{ background:C.card, border:`1.5px solid ${C.bdr}`, borderRadius:10,
              padding:"10px 14px", minHeight:60, fontSize:14, color:C.txt,
              lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
              {noteTxt || <span style={{ color:C.dim, fontSize:13 }}>작성된 내용이 여기 표시됩니다</span>}
            </div>
            {/* 입력 모드: 손글씨(캔버스) / 타입 */}
            <div style={{ display:"flex", gap:6, marginTop:10 }}>
              {[{ v:true, label:"✍️ 필기" }, { v:false, label:"⌨️ 타입" }].map(o => (
                <button key={o.label} onClick={() => setNoteInk(o.v)}
                  style={{ flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
                    fontFamily:"inherit", fontSize:12, fontWeight:700,
                    background: noteInk === o.v ? C.pur : C.card,
                    color: noteInk === o.v ? "#fff" : C.dim,
                    border:`1.5px solid ${noteInk === o.v ? C.pur : C.bdr}` }}>
                  {o.label}
                </button>
              ))}
            </div>
            {noteInk ? (
              <HandwritePad accent={C.pur} apiKey={user?.geminiKey || sharedGeminiKey}
                onText={t => setNoteTxt(p => (p + (p ? " " : "") + t).trim())} />
            ) : (
            <>
            <textarea value={noteScr}
              onChange={e => setNoteScr(e.target.value)}
              placeholder="여기에 타입하세요" autoFocus
              style={{ width:"100%", background:`${C.pur}08`, border:`1.5px solid ${C.pur}44`,
                color:C.txt, padding:"10px 14px", borderRadius:10,
                fontSize:14, outline:"none", fontFamily:"inherit",
                resize:"none", height:120, marginTop:8 }} />
            <div style={{ display:"flex", gap:6, marginTop:8 }}>
              <button onClick={() => { if (noteScr.trim()) { setNoteTxt(p => (p + (p ? " " : "") + noteScr.trim()).trim()); setNoteScr(""); } }}
                disabled={!noteScr.trim()}
                style={{ flex:1.3, padding:"9px 0", borderRadius:10, cursor: noteScr.trim() ? "pointer" : "not-allowed",
                  background: noteScr.trim() ? C.pur : C.card, border:`1px solid ${noteScr.trim() ? C.pur : C.bdr}`,
                  fontFamily:"inherit", fontSize:13, fontWeight:800,
                  color: noteScr.trim() ? "#fff" : C.dim, opacity: noteScr.trim() ? 1 : 0.4 }}>
                ⬆ 올리기
              </button>
              <button onClick={() => setNoteTxt(p => p + " ")}
                style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:"pointer",
                  background:C.card, border:`1px solid ${C.bdr}`,
                  fontFamily:"inherit", fontSize:13, fontWeight:700, color:C.txt }}>
                ␣ 스페이스
              </button>
              <button onClick={() => { setNoteScr(""); setNoteTxt(p => p.slice(0,-1)); }}
                disabled={!noteTxt && !noteScr}
                style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:(noteTxt||noteScr) ? "pointer":"not-allowed",
                  background:C.card, border:`1px solid ${C.bdr}`,
                  fontFamily:"inherit", fontSize:13, fontWeight:700,
                  color:(noteTxt||noteScr) ? C.txt : C.dim, opacity:(noteTxt||noteScr) ? 1 : 0.4 }}>
                ⌫ 지우기
              </button>
              <button onClick={() => { setNoteScr(""); setNoteTxt(""); }}
                disabled={!noteTxt && !noteScr}
                style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:(noteTxt||noteScr) ? "pointer":"not-allowed",
                  background:(noteTxt||noteScr) ? `${C.red}18` : C.card,
                  border:`1px solid ${(noteTxt||noteScr) ? C.red+"55" : C.bdr}`,
                  fontFamily:"inherit", fontSize:13, fontWeight:700,
                  color:(noteTxt||noteScr) ? C.red : C.dim, opacity:(noteTxt||noteScr) ? 1 : 0.4 }}>
                ✕ 전체 삭제
              </button>
            </div>
            </>
            )}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <Btn label="취소" variant="ghost" onClick={() => { setNoteInput(false); setNoteTxt(""); setNoteScr(""); setNoteShared(false); setNoteSongId(null); }} full />
              <Btn label={saving ? "저장 중..." : "저장"} variant="primary"
                onClick={async () => {
                  const final = (noteTxt + (noteScr.trim() ? (noteTxt ? " " : "") + noteScr.trim() : "")).trim();
                  if (!final || saving) return;
                  setSaving(true);
                  await onAddAnnotation(effectiveNoteSongId, { text: final, page: pageNum, x: 0, y: 0, shared: noteShared });
                  setNoteTxt(""); setNoteScr(""); setNoteInput(false); setNoteShared(false); setSaving(false);
                }}
                full disabled={saving || (!noteTxt.trim() && !noteScr.trim())} />
            </div>
          </div>
        </div>
      )}

      {/* 필기 삭제 확인 다이얼로그 */}
      {clearConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:20 }}>
          <div style={{ background:C.surf, borderRadius:16, padding:24,
            width:"100%", maxWidth:320, border:`1px solid ${C.bdr}`, textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🗑️</div>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:8 }}>필기 삭제</div>
            <div style={{ fontSize:13, color:C.dim, marginBottom:20, lineHeight:1.6 }}>
              이 페이지의 모든 필기를 삭제합니다.<br />
              삭제 후 실행 취소(↺)로 복원할 수 있습니다.
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setClearConfirm(false)}
                style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer",
                  background:C.card, border:`1px solid ${C.bdr}`,
                  fontFamily:"inherit", fontSize:14, fontWeight:600, color:C.dim }}>
                취소
              </button>
              <button onClick={confirmClearPage}
                style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer",
                  background:C.red, border:"none",
                  fontFamily:"inherit", fontSize:14, fontWeight:700, color:"#fff" }}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOH → 키보드 수신 토스트 */}
      {chatToastKb && !isLibraryMode && (
        <div onClick={() => { setShowChat(true); setChatToastKb(null); clearTimeout(chatToastKbTimer.current); }}
          style={{
            position:"fixed", bottom:90, left:"50%", transform:"translateX(-50%)",
            zIndex:9500, display:"flex", alignItems:"center", gap:14,
            background:"#1d4ed8", color:"#fff",
            borderRadius:18, padding:"18px 24px",
            boxShadow:"0 8px 32px rgba(0,0,0,0.45)",
            cursor:"pointer", maxWidth:420, width:"calc(100% - 32px)",
            animation:"fohMsgIn 0.3s ease",
          }}>
          <span style={{ fontSize:32, flexShrink:0 }}>💬</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, opacity:0.85, marginBottom:4 }}>{chatToastKb.name}</div>
            <div style={{ fontSize:20, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{chatToastKb.text}</div>
          </div>
          <button onClick={e => { e.stopPropagation(); setChatToastKb(null); clearTimeout(chatToastKbTimer.current); }}
            style={{ background:"none", border:"none", color:"rgba(255,255,255,0.7)", fontSize:22, cursor:"pointer", padding:"0 4px", flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* 팀 채팅 패널 */}
      {showChat && !isLibraryMode && effectiveSvcId && (getUserParts(user).some(p => ["키보드","피아노"].includes(p)) || isFoh(user)) && (() => {
        const sendMsg = async (text) => {
          if (!text?.trim()) return;
          await addDoc(collection(db, "liveChat", effectiveSvcId, "messages"), {
            text: text.trim(), uid: user.uid,
            name: user.name || user.email, role: user.role,
            type:"chat", createdAt: serverTimestamp(),
          });
          setChatInput("");
        };
        return (
          <div style={{
            position:"fixed", bottom:"calc(env(safe-area-inset-bottom) + 68px)", right:12,
            width:270, maxHeight:420, zIndex:3100,
            background:C.surf, border:`1px solid ${C.bdr}`,
            borderRadius:14, display:"flex", flexDirection:"column",
            boxShadow:"0 4px 24px rgba(0,0,0,0.18)", overflow:"hidden",
          }}>
            {/* 헤더 */}
            <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.bdr}`,
              display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ fontSize:12, fontWeight:800, color:C.txt }}>💬 팀 채팅</span>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <button onClick={() => { setChatEditMode(p => !p); setPresetInput(""); }} style={{
                  fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer",
                  padding:"2px 7px", borderRadius:6, border:`1px solid ${chatEditMode ? C.acc+"66" : C.bdr}`,
                  background: chatEditMode ? `${C.acc}18` : "transparent",
                  color: chatEditMode ? C.acc : C.dim,
                }}>{chatEditMode ? "완료" : "편집"}</button>
                <button onClick={() => { setShowChat(false); setChatEditMode(false); }} style={{
                  background:"none", border:"none", cursor:"pointer", color:C.dim, fontSize:16, lineHeight:1 }}>✕</button>
              </div>
            </div>

            {chatEditMode ? (
              /* ── 편집 모드 ── */
              <div style={{ flex:1, overflowY:"auto", padding:"10px 12px", display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.dim, letterSpacing:"0.05em" }}>빠른 메시지 편집</div>
                {chatPresets.map((p, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ flex:1, fontSize:13, color:C.txt }}>{p}</span>
                    <button onClick={() => savePresets(chatPresets.filter((_,j) => j !== i))} style={{
                      background:"none", border:"none", cursor:"pointer",
                      color:"rgba(200,80,80,0.6)", fontSize:16, lineHeight:1, padding:"2px 4px",
                    }}>×</button>
                  </div>
                ))}
                <div style={{ display:"flex", gap:6, marginTop:4 }}>
                  <input value={presetInput} onChange={e => setPresetInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && presetInput.trim()) {
                        savePresets([...chatPresets, presetInput.trim()]);
                        setPresetInput("");
                      }
                    }}
                    placeholder="새 메시지 추가..."
                    style={{ flex:1, padding:"6px 9px", borderRadius:8,
                      border:`1px solid ${C.bdr}`, fontSize:12, outline:"none",
                      fontFamily:"inherit", color:C.txt, background:C.bg }} />
                  <button onClick={() => {
                    if (!presetInput.trim()) return;
                    savePresets([...chatPresets, presetInput.trim()]);
                    setPresetInput("");
                  }} style={{ padding:"0 10px", borderRadius:8, border:"none",
                    background:C.acc, color:"#fff", fontSize:12, fontWeight:700,
                    cursor:"pointer", fontFamily:"inherit" }}>+</button>
                </div>
              </div>
            ) : (
              <>
                {/* 메시지 내역 */}
                <div style={{ flex:1, overflowY:"auto", padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
                  {chatMsgs.length === 0
                    ? <div style={{ fontSize:11, color:C.dim, textAlign:"center", padding:"14px 0" }}>메시지 없음</div>
                    : chatMsgs.map(m => (
                      <div key={m.id} style={{ display:"flex", flexDirection:"column",
                        alignItems: m.uid === user?.uid ? "flex-end" : "flex-start" }}>
                        <div style={{ fontSize:9, color:C.dim, marginBottom:1 }}>{m.name?.split(" ")[0]}</div>
                        <div style={{
                          maxWidth:"82%", padding:"5px 9px", borderRadius:10, fontSize:12, lineHeight:1.4,
                          background: m.uid === user?.uid ? C.acc : C.card,
                          color: m.uid === user?.uid ? "#fff" : C.txt,
                          border: m.uid === user?.uid ? "none" : `1px solid ${C.bdr}`,
                        }}>{m.text}</div>
                      </div>
                    ))
                  }
                  <div ref={chatEndRef} />
                </div>

                {/* 빠른 메시지 버튼 */}
                {chatPresets.length > 0 && (
                  <div style={{ padding:"6px 8px", borderTop:`1px solid ${C.bdr}`,
                    display:"flex", flexWrap:"wrap", gap:5, flexShrink:0 }}>
                    {chatPresets.map((p, i) => (
                      <button type="button" key={i} onPointerDown={e => { e.stopPropagation(); sendMsg(p); }} style={{
                        padding:"8px 12px", borderRadius:16, minHeight:36,
                        border:`1.5px solid ${C.acc}55`, background:`${C.acc}12`,
                        fontSize:12, fontWeight:700, color:C.acc,
                        cursor:"pointer", fontFamily:"inherit",
                        touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
                        userSelect:"none", WebkitUserSelect:"none",
                      }}>{p}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {showMobileHelp && <HelpModal onClose={() => setShowMobileHelp(false)} />}

      {/* 레이저 포인터 파트 선택 드롭다운 */}
      {showPointerPanel && (leader || user?.role === "admin") && !isLibraryMode && (() => {
        const POINTER_PARTS = PARTS.filter(p => ["밴드","보컬그룹","기타","베이스","드럼","키보드","일렉기타","FOH"].includes(p.id));
        const togglePart = (pid) => {
          setPointerParts(prev => {
            if (prev.includes(pid)) return prev.filter(x => x !== pid);
            // 밴드 선택 시 개별 모두 해제, 개별 선택 시 밴드 해제
            if (pid === "밴드") return ["밴드"];
            return [...prev.filter(x => x !== "밴드"), pid];
          });
        };
        const startPointer = () => {
          if (pointerParts.length === 0) return;
          setPointerOn(true);
          setShowPointerPanel(false);
          pointerStrokesRef.current = [];
          pointerActiveSideRef.current = 1;
          pointerActiveSongRef.current = selectedSongId;
          [pointerCanvas1Ref, pointerCanvas2Ref].forEach(r => { if (r.current) drawPointerStrokes(r.current, [], null); });
          if (svc?.id) updateDoc(doc(db, "services", svc.id), {
            "teamPointer.on": true,
            "teamPointer.parts": pointerParts,
            "teamPointer.songId": selectedSongId,
            "teamPointer.strokes": [], "teamPointer.live": null,
          }).catch(() => {});
          // FOH 악보 동기화 비활성화 (포인터가 악보 이동을 제어)
          pointerPrevSheetLink.current = sheetLinkEnabled;
          if (sheetLinkEnabled) {
            updateDoc(doc(db, "liveStatus", "sheetLink"), { enabled: false }).catch(() => {});
          }
          // 기존 sheetSync 채널로 팀원들을 현재 악보로 즉시 이동
          // pointerSync:true → App.jsx에서 allowedPartsRef 무시하고 포인터 파트만 적용
          if (selectedSvcId && selectedSongId) {
            const songIdx = svcSongs.findIndex(s => s?.id === selectedSongId);
            setDoc(doc(db, "liveStatus", "sheetSync"), {
              svcId: selectedSvcId,
              songId: selectedSongId,
              songIdx: songIdx >= 0 ? songIdx : 0,
              allowedParts: pointerParts.includes("밴드") ? null : pointerParts,
              pointerSync: true,
              linkEnabled: true,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        };
        return (
          <div style={{
            position:"fixed", zIndex:9999,
            top:"calc(env(safe-area-inset-top) + 56px)", right:12,
            background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:16,
            width:248, overflow:"hidden",
            boxShadow:"0 8px 32px rgba(0,0,0,.18)",
          }}>
            <div style={{ padding:"12px 16px 8px", borderBottom:`1px solid ${C.bdr}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.txt }}>🎯 레이저 포인터</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>파트 선택 후 시작 (복수 선택 가능)</div>
            </div>
            {POINTER_PARTS.map(p => {
              const selected = pointerParts.includes(p.id);
              return (
                <div key={p.id} onClick={() => togglePart(p.id)} style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"10px 16px", cursor:"pointer",
                  background: selected ? "#eef2ff" : "transparent",
                  borderBottom:`1px solid ${C.bdr}`,
                }}>
                  <span style={{ fontSize:14 }}>{p.emoji}</span>
                  <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.txt }}>{p.label}</span>
                  <span style={{
                    width:20, height:20, borderRadius:5, flexShrink:0,
                    border:`2px solid ${selected ? "#1c3c88" : C.bdr}`,
                    background: selected ? "#1c3c88" : "transparent",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:"#fff", fontSize:12, fontWeight:700,
                  }}>{selected ? "✓" : ""}</span>
                </div>
              );
            })}
            <div style={{ padding:"10px 12px", display:"flex", gap:8, borderTop:`1px solid ${C.bdr}` }}>
              {pointerOn && (
                <button onClick={() => {
                  setPointerOn(false); setPointerParts([]); setShowPointerPanel(false);
                  pointerStrokesRef.current = [];
                  [pointerCanvas1Ref, pointerCanvas2Ref].forEach(r => { if (r.current) drawPointerStrokes(r.current, [], null); });
                  if (svc?.id) updateDoc(doc(db, "services", svc.id), { "teamPointer.on": false, "teamPointer.strokes": [], "teamPointer.live": null }).catch(() => {});
                  // 포인터 끄면 FOH 악보 동기화 원래 상태로 복원
                  if (pointerPrevSheetLink.current) {
                    updateDoc(doc(db, "liveStatus", "sheetLink"), { enabled: true }).catch(() => {});
                  }
                }} style={{
                  flex:1, padding:"8px 0", borderRadius:8, border:`1px solid ${C.bdr}`,
                  background:"transparent", color:C.red, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit",
                }}>끄기</button>
              )}
              <button onClick={startPointer} disabled={pointerParts.length === 0} style={{
                flex:2, padding:"8px 0", borderRadius:8, border:"none",
                background: pointerParts.length > 0 ? "#1c3c88" : C.bdr,
                color:"#fff", fontWeight:700, fontSize:13, cursor: pointerParts.length > 0 ? "pointer" : "default", fontFamily:"inherit",
              }}>
                {pointerOn ? "재설정" : "포인터 시작"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* 팀원 — 포인터 활성 배너 */}
      {!leader && user?.role !== "admin" && svc?.teamPointer?.on && (
        <div style={{
          position:"fixed", top:"calc(env(safe-area-inset-top) + 60px)",
          left:"50%", transform:"translateX(-50%)",
          background:"rgba(28,60,136,0.88)", color:"#fff",
          padding:"5px 14px", borderRadius:20,
          fontSize:11, fontWeight:700, zIndex:500, pointerEvents:"none",
          whiteSpace:"nowrap",
        }}>
          🎯 리더 포인터 활성
        </div>
      )}
      {showImprov && <ImprovChordScreen onClose={() => setShowImprov(false)} C={C} />}
      {showRecModal && (
        <RecordingsModal
          songId={selectedSongId}
          songTitle={song?.title || ""}
          userGeminiKey={user?.geminiKey}
          sharedGeminiKey={sharedGeminiKey}
          onClose={() => setShowRecModal(false)}
        />
      )}

      {/* ── 예배 연습 녹음 미니 플레이어 (좌하단 플로팅 위젯) ── */}
      {showWorshipPlayer && svcPracticeUrl && (() => {
        const fileId = svcPracticeUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] || null;
        const embedSrc = fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null;
        return (
          <div style={{
            position:"fixed",
            bottom:`calc(env(safe-area-inset-bottom, 0px) + 2px)`,
            left:12,
            width:272,
            zIndex:3000,
            background:C.surf,
            border:`1px solid ${C.bdr}`,
            borderRadius:14,
            boxShadow:"0 4px 20px rgba(0,0,0,0.25)",
            overflow:"hidden",
          }}>
            {/* 헤더 */}
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"6px 10px 5px",
              background:C.surf,
              borderBottom:`1px solid ${C.bdr}`,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:13 }}>🎧</span>
                <div style={{ fontSize:11, fontWeight:800, color:C.txt, lineHeight:1.2 }}>
                  예배 연습 녹음
                  <div style={{ fontSize:9, color:C.dim, fontWeight:400 }}>{svc?.title}</div>
                </div>
              </div>
              <button onClick={() => setShowWorshipPlayer(false)} style={{
                background:"none", border:"none", cursor:"pointer",
                color:C.dim, fontSize:16, padding:"0 2px", lineHeight:1,
              }}>✕</button>
            </div>
            {/* Google Drive 오디오 플레이어 */}
            {embedSrc
              ? <iframe key={embedSrc} src={embedSrc} width="272" height="80"
                  allow="autoplay" style={{ display:"block", border:"none" }}
                  title="예배 연습 녹음" />
              : <div style={{ padding:"10px", textAlign:"center" }}>
                  <a href={svcPracticeUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color:C.grn, fontWeight:700, fontSize:13 }}>
                    🔗 녹음 파일 열기
                  </a>
                </div>
            }
          </div>
        );
      })()}

      {/* 메트로놈 패널 */}
      {showMetroPanel && (() => {
        const song = songs.find(s => s.id === selectedSongId);
        const effectiveBpm = parseInt(
          (teamMetroOn ? svc?.teamMetro?.bpm : null) ?? metroBpmEdit ?? song?.bpm
        ) || 80;
        const isActive = metroOn && !metroMuted;
        const adj = (delta) => {
          const next = Math.max(40, Math.min(240, effectiveBpm + delta));
          setMetroBpmEdit(next);
          if (isActive) startMetronome(next);
          if (teamMetroOn && svc) {
            updateDoc(doc(db, "services", svc.id), { "teamMetro.bpm": next }).catch(() => {});
          }
        };
        const beats = [0,1,2,3];
        return (
          <div data-metro-panel style={{
            position:"fixed", zIndex:9999,
            top:"calc(env(safe-area-inset-top) + 58px)", right:12,
            background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:16,
            padding:"16px 18px", width:230,
            boxShadow:"0 8px 32px rgba(0,0,0,.18)",
          }}>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span>🎵 메트로놈</span>
              {teamMetroOn && <span style={{ fontSize:10, color:C.acc, fontWeight:700 }}>팀 싱크</span>}
              <button onClick={() => setShowMetroPanel(false)} style={{ background:"none", border:"none", cursor:"pointer", color:C.dim, padding:0 }}>✕</button>
            </div>

            {/* 박자 표시 */}
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:12 }}>
              {beats.map(b => (
                <div key={b} style={{
                  width:32, height:32, borderRadius:8,
                  background: metroOn && metroBeat % 4 === b
                    ? (b === 0 ? C.acc : C.pur)
                    : C.bdr,
                  transition:"background 0.05s",
                }} />
              ))}
            </div>

            {/* BPM */}
            <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center", marginBottom:12 }}>
              <button onClick={() => adj(-5)} style={{ width:32, height:32, borderRadius:8, border:`1px solid ${C.bdr}`, background:C.card, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <div style={{ minWidth:60, textAlign:"center" }}>
                <div style={{ fontWeight:800, fontSize:22, fontVariantNumeric:"tabular-nums" }}>{effectiveBpm}</div>
                <div style={{ fontSize:10, color:C.dim }}>BPM</div>
              </div>
              <button onClick={() => adj(+5)} style={{ width:32, height:32, borderRadius:8, border:`1px solid ${C.bdr}`, background:C.card, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>＋</button>
            </div>

            {/* 시작/정지 */}
            {teamMetroOn ? (
              <button onClick={() => {
                if (metroOn) { stopMetronome(); setMetroOn(false); }
                else { startMetronome(effectiveBpm); setMetroOn(true); }
              }} style={{
                width:"100%", padding:"10px 0", borderRadius:10,
                background: metroOn ? `${C.red}22` : `${C.acc}22`,
                border:`1px solid ${metroOn ? C.red : C.acc}`,
                color: metroOn ? C.red : C.acc,
                fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit",
              }}>
                {metroOn ? "⏹ 끄기" : "▶ 팀 참여"}
              </button>
            ) : (
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => {
                  if (metroOn) { stopMetronome(); setMetroOn(false); }
                  else { startMetronome(effectiveBpm); setMetroOn(true); }
                }} style={{
                  flex:1, padding:"10px 0", borderRadius:10,
                  background: metroOn ? `${C.red}22` : `${C.acc}22`,
                  border:`1px solid ${metroOn ? C.red : C.acc}`,
                  color: metroOn ? C.red : C.acc,
                  fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit",
                }}>
                  {metroOn ? "⏹ 정지" : "▶ 시작"}
                </button>
                {leader && (
                  <button onClick={() => {
                    const on = !(svc?.teamMetro?.on);
                    const bpm = effectiveBpm;
                    updateDoc(doc(db, "services", svc.id), { "teamMetro": { on, bpm } }).catch(() => {});
                    if (!on) { stopMetronome(); setMetroOn(false); }
                  }} style={{
                    padding:"10px 12px", borderRadius:10,
                    background: svc?.teamMetro?.on ? `${C.pur}22` : "transparent",
                    border:`1px solid ${svc?.teamMetro?.on ? C.pur : C.bdr}`,
                    color: svc?.teamMetro?.on ? C.pur : C.dim,
                    fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap",
                  }}>
                    {svc?.teamMetro?.on ? "팀↑끄기" : "팀 시작"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* 팀 메트로놈 알림 배너 */}
      {metroMsg && (
        <div style={{
          position:"fixed", top:"calc(env(safe-area-inset-top) + 62px)",
          left:"50%", transform:"translateX(-50%)",
          background:C.acc, color:"#fff",
          padding:"10px 22px", borderRadius:20,
          fontSize:14, fontWeight:700,
          zIndex:99999, pointerEvents:"none",
          whiteSpace:"pre", textAlign:"center",
          boxShadow:"0 4px 16px rgba(0,0,0,.3)", lineHeight:1.5,
        }}>{metroMsg}</div>
      )}

      {/* 패닉 버튼 — 예배 시작 후, 라이브러리 제외, FOH/어드민 제외 */}
      {!isLibraryMode && !isFoh(user) && worshipStarted && (
        <div style={{ position:"fixed", bottom:"calc(env(safe-area-inset-bottom) + 58px)", left:8, zIndex:9990 }}>
          {/* 옵션 목록 */}
          {showPanicMenu && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8, marginBottom:10 }}>
              {[
                { emoji:"🔊", label:"볼륨↑" },
                { emoji:"🔉", label:"볼륨↓" },
                { emoji:"🔇", label:"MUTE ON" },
                { emoji:"🔊", label:"MUTE OFF" },
                { emoji:"⚠️", label:"소리문제" },
                { emoji:"📄", label:"악보 ↑" },
                { emoji:"📄", label:"악보 ↓" },
              ].map(opt => (
                <button key={opt.label} onClick={async () => {
                  setShowPanicMenu(false);
                  setPanicSent(opt.label);
                  setTimeout(() => setPanicSent(null), 2500);
                  await sendCue?.(selectedSvcId, selectedSongId, `${opt.emoji} ${opt.label}`, { panic: true });
                }} style={{
                  display:"flex", alignItems:"center", gap:8,
                  padding:"9px 16px", borderRadius:20,
                  background:"#ff3b30", color:"#fff",
                  border:"none", cursor:"pointer",
                  fontSize:14, fontWeight:700,
                  boxShadow:"0 3px 12px rgba(255,59,48,.45)",
                  whiteSpace:"nowrap",
                }}>
                  <span>{opt.emoji}</span><span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
          {/* FAB 본체 */}
          <button onClick={() => setShowPanicMenu(p => !p)} style={{
            width:44, height:44, borderRadius:"50%",
            background: panicSent ? C.grn : (showPanicMenu ? "#c0392b" : "#ff3b30"),
            border:"none", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:19, color:"#fff",
            boxShadow:"0 4px 16px rgba(255,59,48,.5)",
            transition:"background 0.2s",
            opacity: 0.85,
          }}>
            {panicSent ? "✓" : "🎚"}
          </button>
        </div>
      )}
      {/* 패닉 메뉴 열릴 때 바깥 탭으로 닫기 */}
      {showPanicMenu && (
        <div onClick={() => setShowPanicMenu(false)}
          style={{ position:"fixed", inset:0, zIndex:9989 }} />
      )}

      {/* FOH 악보 Sync 시작 배너 */}
      {syncBanner && (
        <div style={{
          position:"fixed", top:"calc(env(safe-area-inset-top) + 62px)",
          left:"50%", transform:"translateX(-50%)",
          background:C.grn, color:"#fff",
          padding:"10px 22px", borderRadius:20,
          fontSize:14, fontWeight:700,
          zIndex:99998, pointerEvents:"none",
          boxShadow:"0 4px 16px rgba(0,0,0,.25)",
        }}>🔗 FOH 악보 동기화 시작</div>
      )}
      {/* FOH 악보 Sync 종료 배너 */}
      {syncOffBanner && (
        <div style={{
          position:"fixed", top:"calc(env(safe-area-inset-top) + 62px)",
          left:"50%", transform:"translateX(-50%)",
          background:"rgba(255,152,0,0.92)", color:"#fff",
          padding:"10px 22px", borderRadius:20,
          fontSize:14, fontWeight:700,
          zIndex:99998, pointerEvents:"none",
          boxShadow:"0 4px 16px rgba(0,0,0,.25)",
        }}>🔗 FOH 악보 동기화 종료</div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════
   FRET DIAGRAM (코드 운지 SVG)
══════════════════════════════════════════════════════════════════ */
function FretDiagram({ voicing }) {
  if (!voicing) return null;
  const { frets, barre } = voicing;
  const strX = [14, 24, 34, 44, 54, 64];
  // All 5 horizontal lines: nut + 4 fret wires → 4 boxes
  const allLines = [22, 36, 50, 64, 78];
  const nonMuted = frets.filter(f => f > 0);
  const minFret = nonMuted.length > 0 ? Math.min(...nonMuted) : 1;
  const maxFret = nonMuted.length > 0 ? Math.max(...nonMuted) : 1;
  const startFret = (barre > 0) ? barre : (minFret <= 4 ? 1 : minFret);
  const isNut = startFret === 1;
  const C_txt = "#1c1c1e";
  const C_dim = "#8e8e93";
  const C_bdr = "#d1d1d6";

  function dotY(fretNum) {
    const idx = fretNum - startFret; // 0-indexed box
    if (idx < 0 || idx >= 4) return null;
    return (allLines[idx] + allLines[idx + 1]) / 2;
  }

  return (
    <svg width={78} height={90} viewBox="0 0 78 90" style={{ display:"block" }}>
      {/* X / O markers above nut */}
      {frets.map((f, i) => {
        if (f === -1) return (
          <text key={i} x={strX[i]} y={14} textAnchor="middle" fontSize={10} fontWeight="700" fill={C_dim}>×</text>
        );
        if (f === 0) return (
          <text key={i} x={strX[i]} y={14} textAnchor="middle" fontSize={10} fill={C_dim}>○</text>
        );
        return null;
      })}

      {/* Nut (thick if open, thin if barre position) */}
      {isNut
        ? <rect x={strX[0] - 2} y={allLines[0] - 4} width={strX[5] - strX[0] + 4} height={4} fill={C_txt} rx={1} />
        : <line x1={strX[0]} y1={allLines[0]} x2={strX[5]} y2={allLines[0]} stroke={C_bdr} strokeWidth={1.5} />
      }

      {/* Fret wires */}
      {allLines.slice(1).map((y, i) => (
        <line key={i} x1={strX[0]} y1={y} x2={strX[5]} y2={y} stroke={C_bdr} strokeWidth={1} />
      ))}

      {/* String lines */}
      {strX.map((x, i) => (
        <line key={i} x1={x} y1={allLines[0]} x2={x} y2={allLines[4]} stroke={C_bdr} strokeWidth={1} />
      ))}

      {/* Barre bar */}
      {barre > 0 && (() => {
        const by = dotY(barre);
        if (by === null) return null;
        return <rect x={strX[0] + 1} y={by - 6} width={strX[5] - strX[0] - 2} height={12} rx={6} fill={C_txt} opacity={0.85} />;
      })()}

      {/* Finger dots */}
      {frets.map((f, i) => {
        if (f <= 0) return null;
        if (barre > 0 && f === barre) return null; // covered by barre bar
        const cy = dotY(f);
        if (cy === null) return null;
        return <circle key={i} cx={strX[i]} cy={cy} r={5.5} fill={C_txt} />;
      })}

      {/* Fret number (shown when not starting from fret 1) */}
      {!isNut && (
        <text x={strX[5] + 5} y={allLines[0] + 10} fontSize={8} fill={C_dim}>{startFret}fr</text>
      )}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PIANO CHORD DIAGRAM
══════════════════════════════════════════════════════════════════ */
function PianoChordDiagram({ chordName, C }) {
  const { root, tones } = getChordTones(chordName);
  const W = 12, WH = 52, BW = 8, BH = 32;
  const OCT_W = 7 * W; // 84px per octave
  const OCTAVES = 2;
  const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
  // Black key left-edge x within one octave
  const BLACK_KEYS = [
    { note:1, x:8 }, { note:3, x:20 },
    { note:6, x:44 }, { note:8, x:56 }, { note:10, x:68 },
  ];
  const svgW = OCTAVES * OCT_W;

  return (
    <svg width={svgW} height={WH} viewBox={`0 0 ${svgW} ${WH}`} style={{ display:"block" }}>
      {Array.from({ length: OCTAVES }).map((_, oct) => {
        const ox = oct * OCT_W;
        return (
          <g key={oct}>
            {WHITE_NOTES.map((note, wi) => {
              const isRoot = note === root;
              const isTone = tones.includes(note);
              const x = ox + wi * W;
              return (
                <g key={note}>
                  <rect x={x} y={0} width={W - 1} height={WH}
                    fill={isRoot ? C.pur : isTone ? `${C.pur}28` : "#fff"}
                    stroke="#d1d1d6" strokeWidth={0.5} rx={1} />
                  {isTone && (
                    <circle cx={x + (W-1)/2} cy={WH - 9} r={4}
                      fill={isRoot ? "#fff" : C.pur} />
                  )}
                </g>
              );
            })}
            {BLACK_KEYS.map(({ note, x: bx }) => {
              const isRoot = note === root;
              const isTone = tones.includes(note);
              const x = ox + bx;
              return (
                <g key={note}>
                  <rect x={x} y={0} width={BW} height={BH}
                    fill={isRoot ? C.pur : isTone ? `${C.pur}99` : "#222"} rx={1} />
                  {isTone && (
                    <circle cx={x + BW/2} cy={BH - 7} r={3.5}
                      fill={isRoot ? "#fff" : "rgba(255,255,255,0.85)"} />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════
   IMPROV CHORD GENERATOR — 예배 전 즉흥 연주용 코드 진행 생성기
══════════════════════════════════════════════════════════════════ */

// Web Audio 헬퍼 (컴포넌트 밖 — 렌더마다 재생성 방지)
function _noteToFreq(label) {
  const m = label.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return null;
  const [, note, octStr] = m;
  const idx = { C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,A:9,"A#":10,Bb:10,B:11 }[note];
  if (idx == null) return null;
  return 440 * Math.pow(2, ((parseInt(octStr)+1)*12 + idx - 69) / 12);
}
function _playNote(ctx, freq, t0, dur) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.22, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function ImprovChordScreen({ onClose, C }) {
  const [key,  setKey]  = useState("C");
  const [mode, setMode] = useState("major");
  const [mood, setMood] = useState("calm");
  const [result,      setResult]      = useState(null);
  const [playingBar,  setPlayingBar]  = useState(null);
  const [isPlayingAll,setIsPlayingAll]= useState(false);
  const audioCtxRef = useRef(null);
  const playAllRef  = useRef(false);

  // 저장된 진행
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tvpc_improv_saved") || "[]"); }
    catch { return []; }
  });
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName,      setSaveName]      = useState("");
  const [activeTab,     setActiveTab]     = useState("generate");
  const [libFilter,     setLibFilter]     = useState("all");

  // 가로/세로 감지
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== "undefined" && window.innerWidth > window.innerHeight
  );
  useEffect(() => {
    const fn = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const playBar = useCallback(async (bar, isArp, bpm) => {
    if (!audioCtxRef.current)
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();
    const now = ctx.currentTime;
    const dur = 60 / bpm * 4;
    const notes = [...bar.lhLabels, ...bar.rhLabels]
      .map(n => _noteToFreq(n.label)).filter(Boolean);
    notes.forEach((freq, i) => _playNote(ctx, freq, isArp ? now + i*0.11 : now, dur - 0.15));
    return dur;
  }, []);

  const handlePlayBar = useCallback(async (bar, idx) => {
    if (!result) return;
    const dur = await playBar(bar, mood === "calm", result.bpm);
    setPlayingBar(idx);
    setTimeout(() => setPlayingBar(p => p === idx ? null : p), dur * 1000);
  }, [mood, playBar, result]);

  const stopAll = useCallback(() => {
    playAllRef.current = false;
    setIsPlayingAll(false);
    setPlayingBar(null);
  }, []);

  const handlePlayAll = useCallback(async () => {
    if (isPlayingAll || !result) return;
    setIsPlayingAll(true);
    playAllRef.current = true;
    const isArp = mood === "calm";
    for (let i = 0; i < result.bars.length; i++) {
      if (!playAllRef.current) break;
      setPlayingBar(i);
      const dur = await playBar(result.bars[i], isArp, result.bpm);
      await new Promise(r => setTimeout(r, dur * 1000));
    }
    setPlayingBar(null);
    setIsPlayingAll(false);
    playAllRef.current = false;
  }, [isPlayingAll, mood, playBar, result]);

  const handleGen = () => {
    stopAll();
    setResult(generateProgression(key, mode, mood, result?.patternIdx ?? -1));
  };

  const _persistSaved = (list) => {
    setSaved(list);
    try { localStorage.setItem("tvpc_improv_saved", JSON.stringify(list)); } catch {}
  };
  const handleSave = () => {
    if (!result) return;
    setSaveName(`${result.keyEng} · ${result.moodLabel}`);
    setShowSaveInput(true);
  };
  const confirmSave = () => {
    const name = saveName.trim() || `${result.keyEng} · ${result.moodLabel}`;
    _persistSaved([{ id: Date.now(), name, result }, ...saved].slice(0, 50));
    setShowSaveInput(false);
  };
  const deleteSaved = (id) => _persistSaved(saved.filter(s => s.id !== id));
  const loadSaved = (item) => {
    stopAll();
    setKey(item.result.key);
    setMode(item.result.mode);
    setMood(item.result.mood);
    setResult(item.result);
    setShowSaveInput(false);
  };

  const fl = { fontSize:10, fontWeight:700, color:C.dim, letterSpacing:0.8,
    textTransform:"uppercase", marginBottom:6 };

  // ── 공통 스타일
  const chipSt = (role) => ({
    background: role==="bass" ? `${C.pur}33` : role==="tension" ? C.pur : `${C.dim}22`,
    color: role==="tension" ? "#fff" : role==="bass" ? C.pur : C.txt,
    borderRadius:6, padding: isLandscape ? "3px 7px" : "4px 9px",
    fontSize: isLandscape ? 11 : 13, fontWeight:800,
  });

  // ── 라이브러리 JSX
  const filteredSaved = libFilter === "all" ? saved : saved.filter(s => s.result?.mood === libFilter);
  const libraryJSX = (
    <div style={{ display:"flex", flexDirection:"column", gap:12, padding:16 }}>
      {/* 분위기 필터 */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {[{ id:"all", label:"전체", emoji:"🎼" }, ...IMPROV_MOODS].map(m => (
          <button key={m.id} onClick={() => setLibFilter(m.id)} style={{
            padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:700,
            cursor:"pointer", fontFamily:"inherit",
            background: libFilter === m.id ? C.pur : `${C.dim}18`,
            color: libFilter === m.id ? "#fff" : C.dim,
            border:`1.5px solid ${libFilter === m.id ? C.pur : "transparent"}`,
          }}>{m.emoji} {m.label}</button>
        ))}
      </div>
      {/* 카드 그리드 */}
      {filteredSaved.length === 0 ? (
        <div style={{ padding:"40px 0", textAlign:"center", color:C.dim, fontSize:12, fontWeight:600 }}>
          {saved.length === 0 ? "저장된 코드 진행이 없어요\n생성 탭에서 진행을 저장해보세요 💾" : "해당 분위기의 저장 항목이 없어요"}
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {filteredSaved.map(s => {
            const moodMeta = IMPROV_MOODS.find(m => m.id === s.result?.mood);
            const savedDate = new Date(s.id);
            const dateStr = `${savedDate.getMonth()+1}/${savedDate.getDate()}`;
            return (
              <div key={s.id} style={{
                background:C.surf, border:`1.5px solid ${C.bdr}`,
                borderRadius:14, padding:12, display:"flex", flexDirection:"column", gap:8,
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:900, color:C.txt,
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</div>
                    <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>
                      {s.result?.keyEng} · {dateStr}
                    </div>
                  </div>
                  <button onClick={() => deleteSaved(s.id)} style={{
                    background:"none", border:"none", cursor:"pointer",
                    fontSize:14, color:C.dim, padding:"0 0 0 6px", lineHeight:1, flexShrink:0,
                  }}>×</button>
                </div>
                {moodMeta && (
                  <span style={{ fontSize:9, fontWeight:700, color:C.pur,
                    background:`${C.pur}18`, border:`1px solid ${C.pur}33`,
                    borderRadius:20, padding:"2px 8px", alignSelf:"flex-start" }}>
                    {moodMeta.emoji} {moodMeta.label}
                  </span>
                )}
                <button onClick={() => { loadSaved(s); setActiveTab("generate"); }} style={{
                  width:"100%", padding:"7px 0", borderRadius:9,
                  background:`${C.pur}18`, border:`1px solid ${C.pur}44`,
                  color:C.pur, fontSize:11, fontWeight:800,
                  cursor:"pointer", fontFamily:"inherit",
                }}>불러오기 →</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── 선택 패널 JSX
  const selectorJSX = (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={fl}>조성</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4 }}>
          {IMPROV_KEYS.map(k => (
            <button key={k} onClick={() => setKey(k)} style={{
              padding:"8px 0", borderRadius:8, fontSize:14, fontWeight:800,
              cursor:"pointer", fontFamily:"inherit",
              background: key===k ? C.pur : `${C.dim}18`,
              color: key===k ? "#fff" : C.txt,
              border:`1px solid ${key===k ? C.pur : "transparent"}`,
            }}>{k}</button>
          ))}
        </div>
      </div>
      <div>
        <div style={fl}>장·단조</div>
        <div style={{ display:"flex", gap:6 }}>
          {[["major","장조 (Major)"],["minor","단조 (Minor)"]].map(([m,lbl]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex:1, padding:"8px 0", borderRadius:9, fontSize:12, fontWeight:700,
              cursor:"pointer", fontFamily:"inherit",
              background: mode===m ? `${C.pur}18` : "transparent",
              color: mode===m ? C.pur : C.dim,
              border:`1.5px solid ${mode===m ? C.pur : C.bdr}`,
            }}>{lbl}</button>
          ))}
        </div>
      </div>
      <div>
        <div style={fl}>분위기</div>
        <div style={{ display:"flex", gap:6 }}>
          {IMPROV_MOODS.map(m => (
            <button key={m.id} onClick={() => setMood(m.id)} style={{
              flex:1, padding:"8px 4px", borderRadius:10, cursor:"pointer",
              fontFamily:"inherit", display:"flex", flexDirection:"column",
              alignItems:"center", gap:3, fontSize:11, fontWeight:700,
              background: mood===m.id ? `${C.pur}18` : `${C.dim}18`,
              color: mood===m.id ? C.pur : C.dim,
              border:`1.5px solid ${mood===m.id ? C.pur : "transparent"}`,
            }}>
              <span style={{ fontSize:18 }}>{m.emoji}</span>{m.label}
            </button>
          ))}
        </div>
      </div>
      <button onClick={handleGen} style={{
        width:"100%", padding:13, borderRadius:12, background:C.pur, color:"#fff",
        fontSize:14, fontWeight:900, border:"none", cursor:"pointer", fontFamily:"inherit",
      }}>{result ? "🔀 다시 생성" : "✨ 코드 생성"}</button>
    </div>
  );

  // ── 결과 패널 JSX
  const resultJSX = result && (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* 메타 + 전체재생 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:900, color:C.pur }}>{result.keyEng}</div>
          <div style={{ fontSize:10, color:C.dim }}>♩= {result.bpm} · {result.direction}</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:10, fontWeight:700, color:C.pur,
            background:`${C.pur}18`, border:`1px solid ${C.pur}44`,
            borderRadius:20, padding:"3px 10px" }}>{result.moodEmoji} {result.moodLabel}</span>
          {isPlayingAll ? (
            <button onClick={stopAll} style={{
              padding:"5px 14px", borderRadius:20, border:`1px solid ${C.red}`,
              background:`${C.red}18`, color:C.red,
              fontSize:11, fontWeight:800, cursor:"pointer", fontFamily:"inherit",
            }}>■ 정지</button>
          ) : (
            <button onClick={handlePlayAll} style={{
              padding:"5px 14px", borderRadius:20, border:`1px solid ${C.pur}`,
              background:`${C.pur}18`, color:C.pur,
              fontSize:11, fontWeight:800, cursor:"pointer", fontFamily:"inherit",
            }}>▶ 전체 재생</button>
          )}
          {showSaveInput ? (
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              <input value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") setShowSaveInput(false); }}
                autoFocus
                style={{ padding:"4px 9px", borderRadius:8, border:`1px solid ${C.pur}`,
                  background:C.bg, color:C.txt, fontSize:11, fontFamily:"inherit",
                  outline:"none", width:130 }} />
              <button onClick={confirmSave} style={{
                padding:"4px 10px", borderRadius:8, border:"none",
                background:C.pur, color:"#fff", fontSize:11, fontWeight:700,
                cursor:"pointer", fontFamily:"inherit" }}>저장</button>
              <button onClick={() => setShowSaveInput(false)} style={{
                background:"none", border:"none", cursor:"pointer",
                fontSize:15, color:C.dim, padding:"0 2px", lineHeight:1 }}>✕</button>
            </div>
          ) : (
            <button onClick={handleSave} style={{
              padding:"5px 11px", borderRadius:20, border:`1px solid ${C.grn}55`,
              background:`${C.grn}12`, color:C.grn,
              fontSize:11, fontWeight:800, cursor:"pointer", fontFamily:"inherit",
            }}>💾</button>
          )}
        </div>
      </div>

      {/* 마디 카드: 가로=2×2, 세로=1열 */}
      <div style={{
        display:"grid",
        gridTemplateColumns: isLandscape ? "1fr 1fr" : "1fr",
        gap:8,
      }}>
        {result.bars.map((b, i) => {
          const isNow = playingBar === i;
          const sec = i < 4 ? "A" : "B";
          const barInSec = i < 4 ? i + 1 : i - 3;
          return (
            <div key={i} style={{
              background: isNow ? `${C.pur}12` : C.surf,
              border:`1.5px solid ${isNow ? C.pur : C.bdr}`,
              borderRadius:14, padding: isLandscape ? 10 : 12,
              transition:"border-color 0.15s, background 0.15s",
            }}>
              {/* 코드 이름 행 */}
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <span style={{ display:"flex", alignItems:"center", gap:3 }}>
                  <span style={{ fontSize:8, fontWeight:800, borderRadius:3, padding:"1px 5px",
                    background: sec === "A" ? `${C.pur}22` : `${C.grn}22`,
                    color: sec === "A" ? C.pur : C.grn,
                  }}>{sec}</span>
                  <span style={{ fontSize:9, fontWeight:700, color: isNow ? C.pur : C.dim }}>{barInSec}마디</span>
                </span>
                <span style={{ fontSize: isLandscape ? 20 : 24, fontWeight:900, color:C.txt, letterSpacing:-0.5 }}>{b.name}</span>
                <span style={{ marginLeft:"auto", fontSize:9, color:C.dim, fontWeight:600 }}>{b.beats}</span>
                <button onClick={() => handlePlayBar(b, i)} style={{
                  width:28, height:28, borderRadius:14, border:"none", cursor:"pointer",
                  background: isNow ? C.pur : `${C.pur}22`,
                  color: isNow ? "#fff" : C.pur, flexShrink:0,
                  fontSize:12, fontFamily:"inherit",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>{isNow ? "♪" : "▶"}</button>
              </div>
              {/* 보이싱 */}
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:9, fontWeight:800, color:C.dim, width:38, flexShrink:0 }}>왼손 L</span>
                  <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                    {b.lhLabels.map((n,j) => <span key={j} style={chipSt(n.role)}>{n.label}</span>)}
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:9, fontWeight:800, color:C.dim, width:38, flexShrink:0 }}>오른손 R</span>
                  <div style={{ display:"flex", gap:3, flexWrap:"wrap", alignItems:"center" }}>
                    {b.rhLabels.map((n,j) => <span key={j} style={chipSt(n.role)}>{n.label}</span>)}
                    {b.resolveLabel && (<><span style={{ fontSize:10, color:C.dim }}>→</span><span style={chipSt(b.resolveLabel.role)}>{b.resolveLabel.label}</span></>)}
                  </div>
                </div>
              </div>
              {/* 미니 건반: 세로모드만 */}
              {!isLandscape && (
                <div style={{ marginTop:8, overflowX:"auto" }}>
                  <PianoChordDiagram chordName={b.diagramName} C={C} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 범례 + 힌트 */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
        {[["베이스",`${C.pur}33`],["코드톤",`${C.dim}22`],["텐션",C.pur]].map(([t,bg]) => (
          <div key={t} style={{ display:"flex", alignItems:"center", gap:4,
            fontSize:9, color:C.dim, fontWeight:600 }}>
            <span style={{ width:9, height:9, borderRadius:2, background:bg }} />{t}
          </div>
        ))}
        <div style={{ width:1, height:12, background:C.bdr, margin:"0 2px" }} />
        {result.hints.map((h,i) => (
          <span key={i} style={{ background:C.surf, border:`1px solid ${C.bdr}`,
            borderRadius:20, padding:"3px 9px", fontSize:9, color:C.dim, fontWeight:600 }}>{h}</span>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:6000, background:C.bg,
      display:"flex", flexDirection:"column",
      paddingTop:"env(safe-area-inset-top)", paddingBottom:"env(safe-area-inset-bottom)",
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:10,
        padding:"10px 16px", borderBottom:`1px solid ${C.bdr}`, background:C.surf }}>
        <div style={{ fontSize:14, fontWeight:900, color:C.txt }}>🎹 즉흥 코드 생성</div>
        <div style={{ fontSize:10, color:C.dim, fontWeight:600 }}>예배 전 잔잔한 연주용</div>
        <button onClick={onClose} style={{
          marginLeft:"auto", width:30, height:30, borderRadius:15,
          background:`${C.dim}22`, border:"none", color:C.txt,
          fontSize:15, cursor:"pointer", fontFamily:"inherit",
        }}>✕</button>
      </div>

      {/* 탭 바 */}
      <div style={{ flexShrink:0, display:"flex", borderBottom:`1px solid ${C.bdr}`, background:C.surf }}>
        {[
          { id:"generate", label:"🎹 생성" },
          { id:"library",  label:`📂 라이브러리${saved.length > 0 ? ` (${saved.length})` : ""}` },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex:1, padding:"9px 0", background:"none", border:"none", cursor:"pointer",
            fontFamily:"inherit", fontSize:12, fontWeight:700,
            color: activeTab === tab.id ? C.pur : C.dim,
            borderBottom:`2px solid ${activeTab === tab.id ? C.pur : "transparent"}`,
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "library" ? (
        <div style={{ flex:1, overflowY:"auto" }}>
          {libraryJSX}
        </div>
      ) : isLandscape ? (
        /* ── 가로모드: 좌=선택 | 우=결과 */
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
          <div style={{ width:300, flexShrink:0, overflowY:"auto",
            padding:14, borderRight:`1px solid ${C.bdr}`, background:C.bg }}>
            {selectorJSX}
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:14 }}>
            {result
              ? resultJSX
              : <div style={{ height:"100%", display:"flex", alignItems:"center",
                  justifyContent:"center", color:C.dim, fontSize:12, fontWeight:600 }}>
                  ← 조성과 분위기를 선택하고 생성하세요
                </div>
            }
          </div>
        </div>
      ) : (
        /* ── 세로모드: 단일 스크롤 */
        <div style={{ flex:1, overflowY:"auto", padding:16,
          display:"flex", flexDirection:"column", gap:16 }}>
          {selectorJSX}
          {result && (
            <>
              <div style={{ height:1, background:C.bdr }} />
              {resultJSX}
            </>
          )}
        </div>
      )}

      {/* 하단: 악보로 돌아가기 */}
      <div style={{ flexShrink:0, padding:"10px 16px", borderTop:`1px solid ${C.bdr}`, background:C.surf }}>
        <button onClick={onClose} style={{
          width:"100%", padding:11, borderRadius:11, background:"transparent",
          border:`1.5px solid ${C.pur}`, color:C.pur, fontSize:13, fontWeight:800,
          cursor:"pointer", fontFamily:"inherit",
        }}>← 악보로 돌아가기</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   BASS FRET DIAGRAM
══════════════════════════════════════════════════════════════════ */
function BassFretDiagram({ chordName }) {
  const { root, tones } = getChordTones(chordName);
  const fifth = tones[2] ?? -1;
  // Bass strings low→high: E=4, A=9, D=2, G=7
  const STRINGS = [4, 9, 2, 7];
  const STR_LABELS = ["E","A","D","G"];
  const strX = [14, 26, 38, 50];
  const allLines = [22, 36, 50, 64, 78]; // nut + 4 fret wires
  const C_txt = "#1c1c1e", C_dim = "#8e8e93", C_bdr = "#d1d1d6", C_pur = "#6b5de7";

  // Collect dots: root and 5th on frets 0-4
  const dots = [];
  STRINGS.forEach((openNote, si) => {
    for (let f = 0; f <= 4; f++) {
      const note = (openNote + f) % 12;
      const isRoot = note === root;
      const is5th = note === fifth && fifth !== root;
      if (!isRoot && !is5th) continue;
      const cy = f === 0
        ? null // open string → show O above
        : (allLines[f - 1] + allLines[f]) / 2;
      dots.push({ si, f, isRoot, is5th, cy });
    }
  });

  return (
    <svg width={64} height={90} viewBox="0 0 64 90" style={{ display:"block" }}>
      {/* String labels */}
      {STR_LABELS.map((label, i) => (
        <text key={i} x={strX[i]} y={10} textAnchor="middle" fontSize={8} fill={C_dim}>{label}</text>
      ))}
      {/* Open string markers */}
      {dots.filter(d => d.f === 0).map((d, i) => (
        <text key={i} x={strX[d.si]} y={19}
          textAnchor="middle" fontSize={10} fontWeight="700"
          fill={d.isRoot ? C_pur : C_txt}>
          {d.isRoot ? "●" : "○"}
        </text>
      ))}
      {/* Nut */}
      <rect x={strX[0]-2} y={allLines[0]-3} width={strX[3]-strX[0]+4} height={3} fill={C_txt} rx={1} />
      {/* Fret wires */}
      {allLines.slice(1).map((y, i) => (
        <line key={i} x1={strX[0]} y1={y} x2={strX[3]} y2={y} stroke={C_bdr} strokeWidth={1} />
      ))}
      {/* String lines */}
      {strX.map((x, i) => (
        <line key={i} x1={x} y1={allLines[0]} x2={x} y2={allLines[4]} stroke={C_bdr} strokeWidth={1} />
      ))}
      {/* Fretted dots */}
      {dots.filter(d => d.f > 0).map((d, i) => (
        <g key={i}>
          <circle cx={strX[d.si]} cy={d.cy} r={6}
            fill={d.isRoot ? C_txt : "transparent"}
            stroke={C_txt} strokeWidth={1.5} />
          <text x={strX[d.si]} y={d.cy + 3.5} textAnchor="middle"
            fontSize={6.5} fontWeight="700"
            fill={d.isRoot ? "#fff" : C_txt}>
            {d.isRoot ? "R" : "5"}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════
   WHAT'S NEW MODAL
══════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   CHORD DICTIONARY MODAL
══════════════════════════════════════════════════════════════════ */
function ChordDictModal({ onClose, songChords, songKey, effectiveSteps, userParts, C }) {
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ x: 20, y: 100 });
  const dragRef = useRef(null);

  const defaultTab = (() => {
    if (!userParts) return "guitar";
    if (userParts.includes("베이스")) return "bass";
    if (userParts.some(p => ["키보드","피아노"].includes(p))) return "keyboard";
    return "guitar";
  })();
  const [tab, setTab] = useState(defaultTab);

  const searchTrimmed = search.trim();
  const searchVoicings = searchTrimmed
    ? getVoicings(searchTrimmed) || getVoicings(searchTrimmed[0].toUpperCase() + searchTrimmed.slice(1))
    : null;

  const effectiveKey = songKey ? getEffectiveKey(songKey, effectiveSteps) : null;
  const diatonicChords = songKey ? getDiatonicChords(songKey, effectiveSteps) : [];
  const hasAiChords = songChords && songChords.length > 0;

  const PANEL_W = 300;
  const TABS = [
    { id:"guitar",   label:"🎸 기타" },
    { id:"bass",     label:"🎵 베이스" },
    { id:"keyboard", label:"🎹 키보드" },
  ];

  // ── Drag handling
  const onDragDown = (e) => {
    if (e.target.closest("button") || e.target.closest("input")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onDragMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.px;
    const dy = e.clientY - dragRef.current.py;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - PANEL_W, dragRef.current.ox + dx)),
      y: Math.max(0, Math.min(window.innerHeight - 80, dragRef.current.oy + dy)),
    });
  };
  const onDragUp = () => { dragRef.current = null; };

  function ChordCard({ name, voicings, sub }) {
    const cardBase = {
      background:C.bg, borderRadius:10, padding:"8px 6px",
      display:"flex", flexDirection:"column", alignItems:"center", gap:3,
    };
    if (tab === "bass") return (
      <div style={cardBase}>
        {sub && <div style={{ fontSize:8, color:C.pur, fontWeight:700 }}>{sub}</div>}
        <div style={{ fontSize:12, fontWeight:800, color:C.txt }}>{name}</div>
        <BassFretDiagram chordName={name} />
      </div>
    );
    if (tab === "keyboard") return (
      <div style={{ ...cardBase, padding:"8px 4px" }}>
        {sub && <div style={{ fontSize:8, color:C.pur, fontWeight:700 }}>{sub}</div>}
        <div style={{ fontSize:12, fontWeight:800, color:C.txt }}>{name}</div>
        <PianoChordDiagram chordName={name} C={C} />
      </div>
    );
    return voicings ? (
      <div style={cardBase}>
        {sub && <div style={{ fontSize:8, color:C.pur, fontWeight:700 }}>{sub}</div>}
        <div style={{ fontSize:12, fontWeight:800, color:C.txt }}>{name}</div>
        <FretDiagram voicing={voicings[0]} />
        {voicings.length > 1 && <div style={{ fontSize:8, color:C.dim }}>+{voicings.length - 1}개</div>}
      </div>
    ) : (
      <div style={{ ...cardBase, minWidth:60, opacity:0.5 }}>
        {sub && <div style={{ fontSize:8, color:C.pur, fontWeight:700 }}>{sub}</div>}
        <div style={{ fontSize:12, fontWeight:800, color:C.txt }}>{name}</div>
        <div style={{ fontSize:8, color:C.dim, marginTop:3 }}>정보없음</div>
      </div>
    );
  }

  return (
    <div style={{
      position:"fixed",
      left: pos.x, top: pos.y,
      width: PANEL_W,
      maxHeight: "70vh",
      zIndex: 3000,
      background: C.surf,
      borderRadius: 16,
      boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
      display: "flex", flexDirection: "column",
      userSelect: "none",
    }}>
      {/* Drag handle / Header */}
      <div
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"10px 12px 8px", flexShrink:0,
          borderBottom:`1px solid ${C.bdr}`,
          cursor:"grab", touchAction:"none",
        }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:9, color:C.dim, letterSpacing:2 }}>⠿⠿</span>
          <div style={{ fontSize:13, fontWeight:800, color:C.txt }}>🎵 코드 사전</div>
          {effectiveKey && (
            <div style={{
              fontSize:10, fontWeight:700, color:C.pur,
              background:`${C.pur}15`, borderRadius:5, padding:"1px 6px",
            }}>Key {effectiveKey}</div>
          )}
        </div>
        <button onClick={onClose} style={{
          background:"transparent", border:"none", fontSize:18,
          color:C.dim, cursor:"pointer", lineHeight:1, padding:"0 2px",
        }}>×</button>
      </div>

      {/* Tabs */}
      <div style={{
        display:"flex", gap:4, padding:"6px 10px", flexShrink:0,
        borderBottom:`1px solid ${C.bdr}`,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:1, padding:"5px 4px", borderRadius:16,
            border:`1.5px solid ${tab === t.id ? C.pur : C.bdr}`,
            background: tab === t.id ? C.pur : "transparent",
            color: tab === t.id ? "#fff" : C.dim,
            fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding:"7px 10px 5px", flexShrink:0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="코드 검색 (예: Am, G7, F#m)"
          style={{
            width:"100%", padding:"7px 10px", borderRadius:8,
            border:`1.5px solid ${C.bdr}`, fontSize:12,
            fontFamily:"inherit", outline:"none", boxSizing:"border-box",
            background:C.bg, color:C.txt,
          }}
        />
      </div>

      {/* Content */}
      <div style={{ overflowY:"auto", padding:"4px 10px 16px", flex:1 }}>
        {search.trim() ? (
          <div>
            <div style={{ fontSize:10, color:C.dim, fontWeight:700, marginBottom:8 }}>
              "{searchTrimmed}" 검색 결과
            </div>
            {tab === "guitar" ? (
              searchVoicings ? (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {searchVoicings.map((v, i) => (
                    <div key={i} style={{
                      background:C.bg, borderRadius:10, padding:"10px 8px",
                      display:"flex", flexDirection:"column", alignItems:"center", gap:5,
                    }}>
                      <div style={{ fontSize:12, fontWeight:800, color:C.txt }}>{v.label}</div>
                      <FretDiagram voicing={v} />
                    </div>
                  ))}
                </div>
              ) : <div style={{ fontSize:12, color:C.dim, padding:"16px 0" }}>코드 정보 없음</div>
            ) : (
              <ChordCard name={searchTrimmed} voicings={null} />
            )}
          </div>
        ) : (
          <>
            {diatonicChords.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, color:C.dim, fontWeight:700, marginBottom:7 }}>
                  {effectiveKey} 장조 다이아토닉
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {diatonicChords.map(({ name, roman, voicings }, i) => (
                    <ChordCard key={i} name={name} voicings={voicings} sub={roman} />
                  ))}
                </div>
              </div>
            )}
            {hasAiChords && (
              <div>
                <div style={{ fontSize:10, color:C.dim, fontWeight:700, marginBottom:7 }}>
                  감지된 코드
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {songChords.map(({ name, voicings }, i) => (
                    <ChordCard key={i} name={name} voicings={voicings} />
                  ))}
                </div>
              </div>
            )}
            {!diatonicChords.length && !hasAiChords && (
              <div style={{ fontSize:12, color:C.dim, padding:"20px 0", textAlign:"center" }}>
                코드를 검색하거나<br/>곡에 Key가 설정되면<br/>자동으로 표시됩니다.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════ */

export default PDFViewerScreen;
