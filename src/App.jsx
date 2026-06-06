import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { auth, db, messagingPromise, firebaseConfigObj } from "./firebase.js";
import { getToken, onMessage } from "firebase/messaging";
import { uploadPdf, sendFcmPush, detectChordsViaEdge, uploadImage } from "./supabase.js";
import AIPanel from "./AIPanel.jsx";
import {
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, getDoc, getDocs, setDoc, serverTimestamp, arrayUnion, limit, increment, documentId,
} from "firebase/firestore";

/* ── App version ── */
const APP_VERSION = "3.257";

/* ── Kakao SDK ── */
const KAKAO_JS_KEY = "36693cbaae62398d925e37d550fc74a5";

/* ══════════════════════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════════════════════ */
const C = {
  bg:    "#f2f2f7",
  surf:  "#ffffff",
  card:  "#f8f8fb",
  bdr:   "#e5e5ea",
  acc:   "#e8a93e",
  pur:   "#6b5de7",
  grn:   "#34c759",
  txt:   "#1c1c1e",
  dim:   "#8e8e93",
  red:   "#ff3b30",
};

const KEY_CLR = {
  C:"#45b87a", D:"#60b4e0", E:"#e07a60", F:"#a060e0",
  G:"#60e0a0", A:"#e8a93e", B:"#7b6af5",
};
const keyColor = (k) => KEY_CLR[k ? k[0].toUpperCase() : "C"] || C.acc;

const isLeader = (role) => role === "leader" || role === "admin";
const isBroadcast = (role) => role === "broadcast" || isLeader(role);

const fmtTime = (ts) => {
  if (!ts?.toDate) return "방금";
  const diff = Date.now() - ts.toDate().getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
};

/* ══════════════════════════════════════════════════════════════════
   SVG ICONS
══════════════════════════════════════════════════════════════════ */
const P = {
  home:    "M3 12L12 3l9 9M5 10v9h4v-5h6v5h4v-9",
  music:   "M9 18V5l12-2v13M6 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0M18 16a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  bell:    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  user:    "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  plus:    "M12 5v14M5 12h14",
  xmark:   "M18 6L6 18M6 6l12 12",
  send:    "M22 2L11 13M22 2L15 22l-4-9-9-4z",
  upload:  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  chevR:   "M9 18l6-6-6-6",
  check:   "M20 6L9 17l-5-5",
  search:  "M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z",
  logout:  "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  pen:     "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  note:    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  dual:    "M3 3h7v18H3zM14 3h7v18h-7z",
  sideR:   "M3 3h18v18H3zM14 3v18",
  zoomIn:  "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM11 8v6M8 11h6",
  zoomOut: "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM8 11h6",
  fitCrop: "M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4",
  prev:    "M15 18l-6-6 6-6",
  next:    "M9 18l6-6-6-6",
  back:    "M19 12H5M12 5l-7 7 7 7",
  refresh: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5",
  chevU:   "M18 15l-6-6-6 6",
  chevD:   "M6 9l6 6 6-6",
  chevL:   "M15 18l-6-6 6-6",
  chevR2:  "M9 18l6-6-6-6",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  tag:     "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  textT:   "M4 6h16M12 6v13M8 19h8",
  eraser:  "M20 20H7L3 16 13 6l8 8-2.5 2.5M9 15l2 2",
  cover:   "M4 8h16v8H4z M8 8V5.5h8V8",
  undo:    "M3 10h13a4 4 0 0 1 0 8H9M3 10l4-4M3 10l4 4",
  download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  highlight:"M3 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17 3 20zM16 5l3 3M15 7l-8 8",
  stamp:   "M9 2h6v3H9zM7 5h10v2H7zM3 7h18v11H3zM2 21h20",
  slur:    "M4 17 Q12 7 20 17",
  cursor:  "M4 4l7 18 3-7 7-3L4 4z",
  cresc:   "M4 12 L20 7 M4 12 L20 17",
  dim:     "M4 7 L20 12 M4 17 L20 12",
  line:    "M4 12 L20 12",
  rect:    "M3 5h18v14H3z",
  circle:  "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
  help:    "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  play:    "M5 3l14 9-14 9V3z",
  pause:   "M6 4h4v16H6zM14 4h4v16h-4z",
  antenna: "M12 9A3 3 0 0 0 12 15M12 9A3 3 0 0 1 12 15M12 6A6 6 0 0 0 12 18M12 6A6 6 0 0 1 12 18M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4",
  megaphone:"M3 11v2a1 1 0 0 0 1 1h2l5 4V7l-5 4H4a1 1 0 0 0-1 1zM19 12a7 7 0 0 0-3-5.83M15.54 16.46A5 5 0 0 0 17 12a5 5 0 0 0-1.46-3.54",
  stop:    "M6 6h12v12H6z",
  mic:     "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8",
  share:   "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  repeat:  "M17 2l4 4-4 4M21 6H7a4 4 0 0 0 0 8h1M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 0-8h-1",
  users:   "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
};

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
async function analyzeWithGemini(blob, apiKey) {
  const b64 = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result.split(",")[1]);
    fr.readAsDataURL(blob);
  });
  const body = JSON.stringify({ contents:[{ parts:[
    { inlineData:{ mimeType: blob.type || "audio/webm", data:b64 } },
    { text:"이 음악 연습 녹음을 분석해주세요. 박자 일관성, 음정 정확도, 다이나믹 표현, 전반적인 완성도를 중심으로 한국어로 구체적이고 건설적인 피드백을 3-5개 항목으로 작성해주세요." },
  ]}]});
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
const HELP_ITEMS = [
  // ㄱ
  { icon:"search",    name:"검색",              eng:"Search",        ini:"ㄱ", desc:"악보 제목 또는 아티스트 이름으로 악보를 검색합니다." },
  { icon:"send",      name:"공유",              eng:"Share",         ini:"ㄱ", desc:"카카오톡으로 예배 악보 목록을 공유합니다. 처음 공유 시 \"예배 악보가 등록 되었어요. 연습을 준비해 주세요!\", 두 번째부터는 \"예배 악보가 업데이트 되었어요.\" 메시지가 포함됩니다. 공유 횟수가 버튼 배지에 표시됩니다." },
  { icon:"pen",       name:"그리기(펜)",        eng:"Draw / Pen",    ini:"ㄱ", desc:"악보 위에 자유곡선으로 필기합니다. 색상과 굵기를 선택할 수 있습니다. ⚠️ 그리기 모드가 켜져 있는 동안에는 손가락 스와이프로 페이지를 넘길 수 없습니다." },
  // ㄴ
  { icon:"back",      name:"나가기",            eng:"Back",          ini:"ㄴ", desc:"이전 화면으로 돌아갑니다." },
  // ㄷ
  { icon:"next",      name:"다음 페이지",       eng:"Next Page",     ini:"ㄷ", desc:"악보의 다음 페이지로 이동합니다. ⚠️ 그리기·형광펜·도형 등 쓰기 모드가 켜진 상태에서는 이 버튼 외 스와이프 페이지 이동은 불가합니다." },
  { icon:"xmark",     name:"닫기",              eng:"Close",         ini:"ㄷ", desc:"현재 화면이나 모달을 닫습니다." },
  { icon:"help",      name:"도움말",            eng:"Help",          ini:"ㄷ", desc:"각 기능의 아이콘·이름·설명을 확인합니다. 오른쪽 하단 ? 버튼으로 열 수 있으며 악보 보기 화면에서도 사용 가능합니다. 한글 자음 탭 또는 영문 알파벳 탭으로 분류하거나 검색창에서 기능을 찾을 수 있습니다." },
  { icon:"dual",      name:"두 화면(Dual)",     eng:"Dual View",     ini:"ㄷ", desc:"두 악보를 화면 좌우에 나란히 표시합니다. 예배 중 두 곡을 동시에 볼 때 유용합니다. ⚠️ 두 화면 모드에서는 ① 미디어 패널(유튜브·AI 분석) 사용 불가, ② 각 악보의 1페이지만 표시, ③ 스와이프가 페이지 이동 대신 곡 전환으로 동작합니다. 코드 감지·전조는 전조 툴바에서 왼쪽/오른쪽 각각 사용 가능합니다." },
  { icon:"dim",       name:"디미누엔도",        eng:"Diminuendo",    ini:"ㄷ", desc:"악보에 디미누엔도(점점 여리게 >) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅁ
  { icon:"note",      name:"메모 목록",         eng:"Memo / Notes",  ini:"ㅁ", desc:"악보에 추가된 메모 패널을 엽니다. 팀 전체가 보는 공유 메모(👥)와 나만 보는 개인 메모(🔒)를 함께 확인하고, 페이지 번호를 탭하면 해당 페이지로 바로 이동합니다." },
  // ㅅ
  { icon:"rect",      name:"사각형",            eng:"Rectangle",     ini:"ㅅ", desc:"악보 위에 사각형 도형을 그립니다. 시작점 터치 후 끝점까지 드래그하세요. ⚠️ 도형 그리기 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"sideR",     name:"미디어 패널",       eng:"Media Panel",   ini:"ㅅ", desc:"화면 오른쪽에 미디어 패널을 펼칩니다. 유튜브 영상 재생과 AI 악보 분석을 제공합니다. ⚠️ 두 화면(Dual) 모드에서는 사용할 수 없습니다. 두 화면 모드에서 코드 감지는 미디어 패널 없이 전조(🎵) 버튼에서 직접 실행합니다." },
  { icon:"trash",     name:"삭제",              eng:"Delete",        ini:"ㅅ", desc:"선택한 악보, 예배, 또는 항목을 삭제합니다. 삭제 후 복구할 수 없습니다." },
  { icon:"line",      name:"선",                eng:"Line",          ini:"ㅅ", desc:"악보 위에 직선을 그립니다. 시작점 터치 후 끝점까지 드래그하세요. ⚠️ 도형 그리기 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"slur",      name:"슬러",              eng:"Slur",          ini:"ㅅ", desc:"악보에 슬러(연결선 ⌢) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"stamp",     name:"스탬프",            eng:"Stamp",         ini:"ㅅ", desc:"악상기호(pp · f · sfz), 음표, 아티큘레이션 등을 악보 위에 찍습니다. 루페(돋보기)로 정확한 위치를 확인하며 배치할 수 있습니다. ⚠️ 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"undo",      name:"실행 취소",         eng:"Undo",          ini:"ㅅ", desc:"가장 마지막에 그린 필기 또는 도형을 취소합니다. 현재 페이지의 필기에만 적용됩니다." },
  // ㅇ
  { icon:"music",     name:"악보 라이브러리",   eng:"Library",       ini:"ㅇ", desc:"전체 악보 목록을 관리합니다. 리더는 PDF 업로드·편집·삭제가 가능하고, 일반 팀원은 열람만 할 수 있습니다." },
  { icon:"bell",      name:"알림",              eng:"Notifications", ini:"ㅇ", desc:"리더 또는 어드민이 보낸 알림 목록을 확인합니다. 알림은 번호순(최신이 맨 위)으로 표시되며 예배 일자·타입·내용이 함께 표시됩니다.\n\n어드민이 보낸 알림은 빨간색으로 강조되며 '어드민' 배지가 붙어 리더 알림(보라색)과 구별됩니다.\n\n읽지 않은 알림 수가 하단 탭 배지에 표시되고, 앱을 열 때 읽지 않은 알림이 있으면 팝업으로 먼저 안내합니다. 항목을 탭하면 읽음 처리됩니다." },
  { icon:"bell",      name:"알림 보내기",       eng:"Send Notification", ini:"ㅇ", desc:"예배 상세 화면의 종(🔔) 버튼으로 팀원 전체에게 알림을 보냅니다. (리더·어드민 전용) 알림 타입(예배 악보·참고·공지)을 선택하고 내용을 입력한 뒤 전송합니다. 같은 예배에 여러 번 보낼 수 있으며 전송 횟수가 종 버튼 배지에 표시됩니다. FCM 푸시를 통해 앱이 닫힌 팀원에게도 알림이 전달됩니다.\n\n어드민이 보낸 알림은 수신자 화면에서 빨간 테마로 표시됩니다." },
  { icon:"upload",    name:"업로드",            eng:"Upload",        ini:"ㅇ", desc:"PDF 형식의 악보 파일을 업로드합니다. 리더 권한이 있어야 합니다." },
  { icon:"home",      name:"예배",              eng:"Services",      ini:"ㅇ", desc:"예배 목록과 예배 모드를 관리합니다. 예배별 악보 세트를 구성하고 순서를 변경할 수 있습니다." },
  { icon:"circle",    name:"원",                eng:"Circle",        ini:"ㅇ", desc:"악보 위에 원 도형을 그립니다. 시작점 터치 후 드래그하세요. ⚠️ 도형 그리기 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"prev",      name:"이전 페이지",       eng:"Prev Page",     ini:"ㅇ", desc:"악보의 이전 페이지로 이동합니다. ⚠️ 쓰기 모드(그리기·도형·스탬프 등)가 켜진 상태에서는 스와이프 이동이 불가하지만 이 버튼은 동작합니다." },
  // ㅈ
  { icon:"refresh",   name:"전조",              eng:"Transpose",     ini:"ㅈ", desc:"AI가 감지한 코드를 반음 단위로 올리거나 내립니다. +는 반음 올리기, -는 반음 내리기, 0은 원위치입니다. 전조 설정은 내 계정에만 저장되며 다른 팀원 화면에는 보이지 않습니다.\n\n전조 버튼을 껐다 켜도 코드는 유지됩니다.\n\n⚠️ 권한 안내:\n• 멤버: 전조 +/− 사용만 가능\n• 리더·어드민: 코드 감지, 코드 위치 조정, 초기화까지 가능\n\n초기화 버튼(리더·어드민 전용)을 누르면 전조값·코드·크기가 모두 초기화되고 코드 감지 버튼이 다시 나타납니다." },
  { icon:"fitCrop",   name:"자동 맞춤(FIT)",    eng:"Auto Fit",      ini:"ㅈ", desc:"악보 여백을 자동으로 분석해 화면에 꽉 차게 맞춥니다. 다시 누르면 원래 크기로 돌아옵니다. 두 화면 모드에서도 좌우 각각 동작합니다." },
  { icon:"zoomIn",    name:"줌인",              eng:"Zoom In",       ini:"ㅈ", desc:"악보를 확대합니다. 핀치 제스처로도 확대할 수 있습니다. 줌인 상태에서는 화면 오른쪽에 방향 D-패드가 나타나 악보를 상하좌우로 이동할 수 있습니다." },
  { icon:"zoomOut",   name:"줌아웃",            eng:"Zoom Out",      ini:"ㅈ", desc:"악보를 축소합니다. 가운데 % 버튼을 누르면 원래 100% 크기로 즉시 돌아옵니다." },
  { icon:"eraser",    name:"지우개",            eng:"Eraser",        ini:"ㅈ", desc:"필기한 내용을 부분적으로 지웁니다. 하단 슬라이더로 지우개 크기를 조절할 수 있습니다. ⚠️ 지우개 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅊ
  { icon:"plus",      name:"추가",              eng:"Add",           ini:"ㅊ", desc:"새 악보, 예배, 또는 항목을 추가합니다." },
  // ㅋ
  { icon:"music",     name:"코드 감지(AI)",     eng:"Chord Detect",  ini:"ㅋ", desc:"AI(Gemini 또는 Groq)가 악보 이미지에서 코드 기호를 자동 인식합니다. ⚠️ 리더·어드민 전용 기능입니다.\n\n싱글 모드에서는 미디어 패널에서, 두 화면(Dual) 모드에서는 전조 서브툴바에서 왼쪽·오른쪽 각각 실행합니다. API 키가 없으면 서버 키를 우선 사용합니다.\n\n한 번 감지된 코드는 전조 버튼을 켤 때마다 표시됩니다. 전조 버튼을 끄면 숨겨지지만 데이터는 유지됩니다. 초기화 버튼을 누르면 코드가 모두 지워지고 감지 버튼이 다시 활성화됩니다.\n\n코드 라벨 조작(리더·어드민 전용): 드래그로 위치 이동 | 더블탭으로 복사 | 꾹 누르기(0.6초)로 삭제.\n\n전조 +/−는 모든 역할이 개인별로 사용 가능하며 내 계정에만 저장됩니다. 리더가 코드를 감지하거나 위치를 조정하면 팀 전체에 공유되고 악보 라이브러리에도 저장됩니다.\n\n코드 크기(A−/A+)도 저장되어 다음에 열면 그대로 유지됩니다. V·I·II 같은 섹션 마커는 전조되지 않고 그대로 유지됩니다." },
  { icon:"cresc",     name:"크레센도",          eng:"Crescendo",     ini:"ㅋ", desc:"악보에 크레센도(점점 세게 <) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅌ
  { icon:"textT",     name:"텍스트",            eng:"Text",          ini:"ㅌ", desc:"악보 위에 텍스트를 입력합니다. 텍스트 모드가 켜지면 노란색 원형 커서(T)가 손가락 위치를 실시간으로 표시해 입력 위치를 잡는 데 도움을 줍니다. 원하는 위치를 탭하면 입력창이 열리고 커서가 사라집니다. ⚠️ 텍스트 입력 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅍ
  { icon:"user",      name:"프로필",            eng:"Profile",       ini:"ㅍ", desc:"사용자 정보, AI API 키(Gemini/Groq), 알림 설정을 관리합니다. API 키를 등록하면 코드 감지 기능을 우선 사용합니다." },
  // ㅎ
  { icon:"highlight", name:"형광펜",            eng:"Highlight",     ini:"ㅎ", desc:"악보 위에 반투명 형광펜으로 중요 부분을 강조합니다. ⚠️ 형광펜 모드가 켜진 동안에는 손가락 스와이프로 페이지를 넘길 수 없습니다." },
  { icon:"check",     name:"확인",              eng:"Check / Select",ini:"ㅎ", desc:"선택 또는 확인 동작을 수행합니다." },
];

function HelpModal({ onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("전체");
  const KO_TABS = ["전체","ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const EN_TABS = [...new Set(HELP_ITEMS.map(h => h.eng[0].toUpperCase()))].sort();
  const koAvail = new Set(HELP_ITEMS.map(h => h.ini));
  const isEng = t => /^[A-Z]$/.test(t);
  const filtered = HELP_ITEMS.filter(h => {
    const q = query.toLowerCase();
    const matchQ = !q || h.name.includes(q) || h.eng.toLowerCase().includes(q) || h.desc.includes(q);
    const matchC = active === "전체"
      || (isEng(active) ? h.eng[0].toUpperCase() === active : h.ini === active);
    return matchQ && matchC;
  });
  const Tab = ({ c }) => {
    const hasItems = c === "전체" || (isEng(c) ? true : koAvail.has(c));
    return (
      <button key={c} onClick={() => { setActive(c); setQuery(""); }}
        disabled={!hasItems}
        style={{ padding:"4px 9px", borderRadius:14, border:"none", cursor: hasItems ? "pointer" : "default",
          flexShrink:0, fontSize:13, fontWeight:600,
          background: active === c ? C.pur : C.card,
          color: active === c ? "#fff" : hasItems ? C.txt : C.bdr,
          opacity: hasItems ? 1 : 0.4,
        }}>{c}</button>
    );
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:2000, display:"flex", flexDirection:"column" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:C.surf, display:"flex", flexDirection:"column",
        height:"100%", maxWidth:560, width:"100%", margin:"0 auto",
        paddingTop:"env(safe-area-inset-top)" }}>
        <div style={{ padding:"16px 16px 12px", borderBottom:`1px solid ${C.bdr}`,
          display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <div style={{ flex:1, fontWeight:700, fontSize:18 }}>도움말</div>
          <button onClick={onClose} style={{
            background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
            cursor:"pointer", padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center",
            minWidth:40, minHeight:40,
          }}>
            <Icon n="xmark" size={22} color={C.dim} />
          </button>
        </div>
        <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.bdr}`, flexShrink:0 }}>
          <div style={{ background:C.card, borderRadius:10, padding:"8px 12px",
            display:"flex", gap:8, alignItems:"center", border:`1px solid ${C.bdr}` }}>
            <Icon n="search" size={15} color={C.dim} />
            <input value={query} onChange={e => { setQuery(e.target.value); setActive("전체"); }}
              placeholder="기능 검색 (한글 또는 영문)..."
              style={{ border:"none", background:"none", flex:1, fontSize:14, color:C.txt, outline:"none" }} />
            {query && <button onClick={() => setQuery("")} style={{ background:"none", border:"none", cursor:"pointer", padding:0 }}>
              <Icon n="xmark" size={14} color={C.dim} />
            </button>}
          </div>
        </div>
        {/* 한글 자음 탭 */}
        <div style={{ display:"flex", overflowX:"auto", padding:"6px 12px 4px", gap:4, flexShrink:0 }}>
          {KO_TABS.map(c => <Tab key={c} c={c} />)}
        </div>
        {/* 영문 알파벳 탭 */}
        <div style={{ display:"flex", overflowX:"auto", padding:"4px 12px 6px", gap:4,
          borderBottom:`1px solid ${C.bdr}`, flexShrink:0 }}>
          {EN_TABS.map(c => <Tab key={c} c={c} />)}
        </div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {filtered.length === 0
            ? <div style={{ textAlign:"center", color:C.dim, padding:40, fontSize:14 }}>검색 결과가 없습니다</div>
            : filtered.map((item, i) => (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12,
                padding:"12px 16px", borderBottom:`1px solid ${C.bdr}` }}>
                <div style={{ width:38, height:38, borderRadius:10, background:`${C.pur}18`,
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                  <Icon n={item.icon} size={18} color={C.pur} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:3 }}>
                    <span style={{ fontWeight:700, fontSize:14, color:C.txt }}>{item.name}</span>
                    <span style={{ fontSize:11, color:C.dim, background:C.card, padding:"1px 6px", borderRadius:6 }}>{item.eng}</span>
                    <span style={{ fontSize:11, color:C.pur, marginLeft:"auto", fontWeight:600 }}>{item.ini}</span>
                  </div>
                  <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))
          }
        </div>
        <div style={{ padding:"12px 16px", paddingBottom:"calc(16px + env(safe-area-inset-bottom))",
          borderTop:`1px solid ${C.bdr}`, flexShrink:0,
          display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ flex:1, fontSize:12, color:C.dim }}>총 {filtered.length}개 기능</span>
          <button onClick={onClose} style={{
            background:C.pur, border:"none", borderRadius:12, cursor:"pointer",
            padding:"12px 32px", display:"flex", alignItems:"center", gap:8,
            boxShadow:"0 2px 10px rgba(107,93,231,0.35)",
          }}>
            <Icon n="xmark" size={18} color="#fff" />
            <span style={{ color:"#fff", fontWeight:700, fontSize:15, fontFamily:"inherit" }}>닫기</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Icon({ n, size = 20, color = C.txt, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display:"block", flexShrink:0 }}>
      <path d={P[n] || ""} stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Chord transposition utilities (module-level) */
const SEMITONES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_SHARP  = {Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};
const DISPLAY_KEY = {C:'C','C#':'Db',D:'D','D#':'Eb',E:'E',F:'F','F#':'Gb',G:'G','G#':'Ab',A:'A','A#':'Bb',B:'B'};

function transposeNote(note, steps) {
  const n = FLAT_SHARP[note] || note;
  const i = SEMITONES.indexOf(n);
  if (i === -1) return note;
  return SEMITONES[((i + steps) % 12 + 12) % 12];
}

function transposeChord(chord, steps) {
  if (!chord || steps === 0) return chord;
  // 슬래시 코드 처리 (예: E/G# → 앞뒤 각각 전조)
  if (chord.includes("/")) {
    const slash = chord.indexOf("/");
    const main = chord.slice(0, slash);
    const bass = chord.slice(slash + 1);
    return transposeChord(main, steps) + "/" + transposeChord(bass, steps);
  }
  // normalize flats to sharps, find root
  const c = chord.replace(/^(Db|Eb|Gb|Ab|Bb)/, m => FLAT_SHARP[m] || m);
  const twoChar = c.length > 1 && c[1] === '#';
  const root   = twoChar ? c.slice(0, 2) : c[0];
  const suffix = c.slice(root.length);
  // if root is not a valid note (e.g. "V", "I", section markers), leave unchanged
  if (SEMITONES.indexOf(FLAT_SHARP[root] || root) === -1) return chord;
  const newRoot = transposeNote(root, steps);
  // use flat display for common keys
  return (DISPLAY_KEY[newRoot] || newRoot) + suffix;
}

function keyName(key, steps) {
  if (!key) return '?';
  const n = FLAT_SHARP[key] || key;
  const transposed = SEMITONES[((SEMITONES.indexOf(n) + steps) % 12 + 12) % 12];
  return DISPLAY_KEY[transposed] || transposed;
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
      if (s.team && s.points?.[0]) {
        const mSz = Math.max(3, canvas.width * 0.0075);
        ctx.save(); ctx.font = `${mSz}px system-ui`; ctx.textAlign = "left";
        ctx.textBaseline = "bottom"; ctx.globalAlpha = 0.65;
        ctx.fillText("👥", s.points[0].x * canvas.width, s.points[0].y * canvas.height - 2);
        ctx.restore();
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
      if (s.team) {
        const mSz = Math.max(3, canvas.width * 0.0075);
        ctx.save(); ctx.font = `${mSz}px system-ui`; ctx.textAlign = "left";
        ctx.textBaseline = "bottom"; ctx.globalAlpha = 0.65;
        ctx.fillText("👥", px, py - sz * 0.55); ctx.restore();
      }
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
        ctx.ellipse(0, 0, sz * 0.5, sz * 0.36, 0, 0, Math.PI * 2);
        ctx.fillStyle = s.color || "#1c1c1e";
        ctx.fill();
        ctx.restore();
      } else {
        const family = s.italic
          ? '"Times New Roman", Georgia, serif'
          : 'system-ui, -apple-system, sans-serif';
        ctx.font = `${s.italic ? "italic " : ""}bold ${sz}px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = getStampBaseline(s.symbol);
        ctx.fillText(s.symbol || "f", px, py);
      }
      ctx.restore();
      if (s.team) {
        const mSz = Math.max(3, canvas.width * 0.0075);
        ctx.save(); ctx.font = `${mSz}px system-ui`; ctx.textAlign = "left";
        ctx.textBaseline = "bottom"; ctx.globalAlpha = 0.65;
        ctx.fillText("👥", px - mSz * 0.3, py - sz * 0.55); ctx.restore();
      }
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
    if (s.team && pts.length > 0 && !isEraser && !isCover) {
      const mSz = Math.max(3, canvas.width * 0.0075);
      ctx.save(); ctx.font = `${mSz}px system-ui`; ctx.textAlign = "left";
      ctx.textBaseline = "bottom"; ctx.globalAlpha = 0.65;
      ctx.fillText("👥", pts[0][0], pts[0][1] - 2); ctx.restore();
    }
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
      ctx.beginPath();
      ctx.arc(px, py, Math.max(18, canvas.width * 0.045), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   PRIMITIVE COMPONENTS
══════════════════════════════════════════════════════════════════ */
function Btn({ label, icon, onClick, variant="primary", disabled=false, full=false, sm=false, style:extra={} }) {
  const V = {
    primary: { bg:C.acc,         txt:"#111", bdr:"none"                   },
    outline: { bg:"transparent", txt:C.acc,  bdr:`1.5px solid ${C.acc}`   },
    ghost:   { bg:"transparent", txt:C.dim,  bdr:`1.5px solid ${C.bdr}`   },
    danger:  { bg:C.red,         txt:"#fff", bdr:"none"                   },
    purple:  { bg:C.pur,         txt:"#fff", bdr:"none"                   },
    green:   { bg:C.grn,         txt:"#fff", bdr:"none"                   },
  };
  const v = V[variant] || V.primary;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        display:"flex", alignItems:"center", justifyContent:"center", gap:6,
        padding: sm ? "6px 14px" : "10px 20px",
        background:v.bg, color:v.txt, border:v.bdr,
        borderRadius:10, fontWeight:600, fontSize: sm ? 13 : 14,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        width: full ? "100%" : "auto",
        fontFamily:"inherit", letterSpacing:"-0.01em",
        transition:"opacity .15s",
        ...extra,
      }}>
      {icon && <Icon n={icon} size={sm?14:16} color={v.txt} />}
      {label}
    </button>
  );
}

function Badge({ label, color = C.acc }) {
  return (
    <span style={{
      background:`${color}22`, color, border:`1px solid ${color}44`,
      padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700,
      letterSpacing:"0.02em", display:"inline-block",
    }}>{label}</span>
  );
}

function KeyBadge({ k }) {
  return <Badge label={`Key ${k}`} color={keyColor(k)} />;
}

function Input({ label, value, onChange, type="text", placeholder="", autoFocus=false }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && (
        <div style={{ fontSize:11, color:C.dim, marginBottom:5, fontWeight:700,
          letterSpacing:"0.06em", textTransform:"uppercase" }}>
          {label}
        </div>
      )}
      <input type={type} value={value} placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
        onChange={e => onChange(e.target.value)}
        style={{
          width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
          color:C.txt, padding:"10px 14px", borderRadius:10,
          fontSize:14, outline:"none", fontFamily:"inherit",
        }}
      />
    </div>
  );
}

function Divider() {
  return <div style={{ height:1, background:C.bdr, margin:"14px 0" }} />;
}

/* ══════════════════════════════════════════════════════════════════
   MODAL
══════════════════════════════════════════════════════════════════ */
function Modal({ title, onClose, children, noBackdrop = false }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.45)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:900, backdropFilter:"blur(4px)",
      padding:"16px 16px calc(16px + env(safe-area-inset-bottom)) 16px",
    }}
      onClick={noBackdrop ? undefined : (e => { if (e.target === e.currentTarget) onClose(); })}>
      <div className="wSlideUp modal-sheet" style={{
        background:C.surf, borderRadius:20,
        width:"100%", maxWidth:480,
        overflow:"auto", padding:"24px 20px 28px",
        border:`1px solid ${C.bdr}`,
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:17, letterSpacing:"-0.02em" }}>{title}</div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", padding:4, cursor:"pointer", color:C.dim, display:"flex" }}>
            <Icon n="xmark" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   YOUTUBE HELPERS
══════════════════════════════════════════════════════════════════ */
function getYoutubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ══════════════════════════════════════════════════════════════════
   LOGIN SCREEN
══════════════════════════════════════════════════════════════════ */
const googleProvider = new GoogleAuthProvider();

function LoginScreen({ loginErr = "", onClearErr, blockedUser = null }) {
  const [err,          setErr]          = useState("");
  const [loading,      setLoading]      = useState(false);
  const [showReqForm,  setShowReqForm]  = useState(false);
  const [reqName,      setReqName]      = useState("");
  const [reqPart,      setReqPart]      = useState("");
  const [reqMsg,       setReqMsg]       = useState("");
  const [reqSending,   setReqSending]   = useState(false);
  const [reqDone,      setReqDone]      = useState(false);
  const [reqErr,       setReqErr]       = useState("");

  // blockedUser 바뀌면 이름 자동 채우기
  useEffect(() => {
    if (blockedUser?.name) setReqName(blockedUser.name);
  }, [blockedUser]);

  const loginWithGoogle = async () => {
    setLoading(true);
    setErr("");
    onClearErr?.();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/cancelled-popup-request") {
        signInWithRedirect(auth, googleProvider);
      } else {
        setErr("Google 로그인에 실패했습니다. 다시 시도해주세요.");
        setLoading(false);
      }
    }
  };

  const submitRequest = async () => {
    if (!blockedUser?.email || !reqName.trim()) return;
    setReqSending(true);
    setReqErr("");
    try {
      await setDoc(doc(db, "accessRequests", blockedUser.email), {
        email: blockedUser.email,
        name:  reqName.trim(),
        part:  reqPart.trim(),
        message: reqMsg.trim(),
        requestedAt: serverTimestamp(),
        status: "pending",
      });
      setReqDone(true);
    } catch (e) {
      setReqErr("신청 실패: " + e.message);
    } finally {
      setReqSending(false);
    }
  };

  const isNotAllowed = loginErr === "not_allowed";

  // ── 신청 완료 화면
  if (reqDone) return (
    <div style={{
      minHeight:"100vh", background:C.bg,
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:24,
    }}>
      <div className="wFadeIn" style={{
        background:C.surf, borderRadius:20, padding:"36px 24px",
        width:"100%", maxWidth:380, border:`1px solid ${C.bdr}`,
        textAlign:"center",
      }}>
        <div style={{
          width:64, height:64, borderRadius:"50%",
          background:`${C.grn}22`, border:`1px solid ${C.grn}44`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:28, margin:"0 auto 16px",
        }}>✓</div>
        <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>신청이 접수되었습니다</div>
        <div style={{ fontSize:13, color:C.dim, lineHeight:1.8, marginBottom:24 }}>
          관리자가 승인하면 로그인할 수 있습니다.<br/>승인까지 잠시 기다려주세요.
        </div>
        <button onClick={() => { setReqDone(false); setShowReqForm(false); onClearErr?.(); }} style={{
          padding:"11px 28px", borderRadius:10, border:`1px solid ${C.bdr}`,
          background:"transparent", color:C.dim, fontSize:14,
          cursor:"pointer", fontFamily:"inherit",
        }}>확인</button>
      </div>
    </div>
  );

  // ── 신청 폼 화면
  if (showReqForm && isNotAllowed) return (
    <div style={{
      minHeight:"100vh", background:C.bg,
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:24,
    }}>
      <div className="wFadeIn" style={{
        background:C.surf, borderRadius:20, padding:"28px 24px",
        width:"100%", maxWidth:380, border:`1px solid ${C.bdr}`,
      }}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:4, display:"flex", alignItems:"center", gap:8 }}>
          <span>🙋</span> 액세스 신청
        </div>
        <div style={{ fontSize:13, color:C.dim, marginBottom:20, lineHeight:1.6 }}>
          찬양팀 관리자에게 액세스 요청을 보냅니다.<br/>승인 후 로그인이 가능합니다.
        </div>

        {/* 이메일 (읽기전용) */}
        <div style={{ fontSize:12, fontWeight:600, color:C.dim, marginBottom:6, letterSpacing:".03em" }}>
          Google 계정 이메일
        </div>
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
          padding:"10px 12px", marginBottom:14,
        }}>
          <div style={{
            width:20, height:20, borderRadius:"50%", background:C.bdr,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:10, fontWeight:700, color:C.dim, flexShrink:0,
          }}>G</div>
          <span style={{ fontSize:13, color:C.dim, flex:1 }}>{blockedUser?.email}</span>
          <span style={{ fontSize:10, color:`${C.dim}77` }}>자동입력</span>
        </div>

        {/* 이름 */}
        <div style={{ fontSize:12, fontWeight:600, color:C.dim, marginBottom:6, letterSpacing:".03em" }}>
          이름 (팀 내 호칭) <span style={{ color:C.red, fontSize:10 }}>*</span>
        </div>
        <input value={reqName} onChange={e => setReqName(e.target.value)}
          placeholder="예: 홍길동"
          style={{
            width:"100%", boxSizing:"border-box",
            background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
            padding:"10px 12px", color:C.txt, fontSize:14,
            outline:"none", fontFamily:"inherit", marginBottom:14,
          }} />

        {/* 파트 */}
        <div style={{ fontSize:12, fontWeight:600, color:C.dim, marginBottom:6, letterSpacing:".03em" }}>
          소속 파트 <span style={{ color:`${C.dim}88`, fontWeight:400 }}>(선택)</span>
        </div>
        <input value={reqPart} onChange={e => setReqPart(e.target.value)}
          placeholder="예: 보컬, 기타, 건반..."
          style={{
            width:"100%", boxSizing:"border-box",
            background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
            padding:"10px 12px", color:C.txt, fontSize:14,
            outline:"none", fontFamily:"inherit", marginBottom:14,
          }} />

        {/* 메시지 */}
        <div style={{ fontSize:12, fontWeight:600, color:C.dim, marginBottom:6, letterSpacing:".03em" }}>
          신청 메시지 <span style={{ color:`${C.dim}88`, fontWeight:400 }}>(선택)</span>
        </div>
        <textarea value={reqMsg} onChange={e => setReqMsg(e.target.value)}
          placeholder="관리자에게 전하고 싶은 말을 입력해주세요"
          rows={3}
          style={{
            width:"100%", boxSizing:"border-box", resize:"none",
            background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
            padding:"10px 12px", color:C.txt, fontSize:14, lineHeight:1.5,
            outline:"none", fontFamily:"inherit", marginBottom:16,
          }} />

        {reqErr && (
          <div style={{
            marginBottom:12, padding:"8px 12px", borderRadius:8,
            background:`${C.red}11`, border:`1px solid ${C.red}33`,
            color:C.red, fontSize:12,
          }}>{reqErr}</div>
        )}

        <button onClick={submitRequest}
          disabled={reqSending || !reqName.trim()}
          style={{
            width:"100%", padding:"14px 0", borderRadius:12, border:"none",
            background: (!reqName.trim() || reqSending) ? C.bdr : C.acc,
            color: (!reqName.trim() || reqSending) ? C.dim : "#111",
            fontSize:15, fontWeight:700, cursor: reqName.trim() && !reqSending ? "pointer" : "default",
            fontFamily:"inherit", marginBottom:10, transition:"all .15s",
          }}>
          {reqSending ? "전송 중..." : "신청 보내기"}
        </button>
        <button onClick={() => setShowReqForm(false)} style={{
          width:"100%", padding:"11px 0", borderRadius:12,
          background:"transparent", border:`1px solid ${C.bdr}`,
          color:C.dim, fontSize:14, cursor:"pointer", fontFamily:"inherit",
        }}>← 로그인으로 돌아가기</button>
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight:"100vh", background:C.bg,
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:24,
    }}>
      <div className="wFadeIn" style={{ textAlign:"center", marginBottom:40 }}>
        <div style={{
          width:76, height:76,
          background:`linear-gradient(135deg, ${C.acc}, ${C.pur})`,
          borderRadius:22, margin:"0 auto 16px",
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:`0 0 40px ${C.acc}44`,
        }}>
          <span style={{ fontSize:36 }}>🎵</span>
        </div>
        <div style={{ fontWeight:800, fontSize:22, letterSpacing:"-0.03em" }}>TVPC Worship</div>
        <div style={{ fontSize:13, color:C.dim, marginTop:4 }}>예배 악보 & 연습 앱</div>
      </div>

      <div className="wFadeIn" style={{
        background:C.surf, borderRadius:20, padding:"28px 24px",
        width:"100%", maxWidth:380, border:`1px solid ${C.bdr}`,
      }}>
        <button onClick={loginWithGoogle} disabled={loading} style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
          gap:10, padding:"14px 0", borderRadius:12,
          background:"#fff", border:"1.5px solid #dadce0", cursor:"pointer",
          fontFamily:"inherit", fontSize:15, fontWeight:600, color:"#3c4043",
          opacity: loading ? 0.7 : 1,
          boxShadow:"0 2px 8px rgba(0,0,0,.08)",
        }}>
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
            <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/>
            <path fill="#FBBC05" d="M24 46c5.5 0 10.5-1.9 14.3-5l-6.6-5.4C29.6 37.3 27 38 24 38c-6 0-11.1-4-12.9-9.5l-7 5.4C7.5 41.8 15.2 46 24 46z"/>
            <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.8 2.7-2.5 4.9-4.8 6.4l6.6 5.4C41.4 37.3 44.5 31.3 44.5 24c0-1.3-.2-2.7-.5-4z"/>
          </svg>
          {loading ? "로그인 중..." : "Google로 로그인"}
        </button>
        {(err || loginErr) && (
          <div style={{ marginTop:14 }}>
            <div style={{
              padding:"10px 14px", borderRadius:10,
              background:`${C.red}11`, border:`1px solid ${C.red}33`,
              color:C.red, fontSize:13, textAlign:"center", lineHeight:1.6,
              marginBottom: isNotAllowed ? 10 : 0,
            }}>
              {isNotAllowed
                ? "등록되지 않은 이메일입니다. 관리자에게 문의하거나 액세스를 신청하세요."
                : (err || loginErr)}
            </div>
            {isNotAllowed && (
              <button onClick={() => setShowReqForm(true)} style={{
                width:"100%", padding:"11px 0", borderRadius:10,
                background:`${C.acc}15`, border:`1px solid ${C.acc}44`,
                color:C.acc, fontSize:14, fontWeight:600,
                cursor:"pointer", fontFamily:"inherit",
              }}>→ 액세스 신청하기</button>
            )}
          </div>
        )}
        <div style={{ fontSize:12, color:C.dim, textAlign:"center", marginTop:20, lineHeight:1.8 }}>
          관리자가 등록한 구글 계정으로만<br />
          로그인할 수 있습니다
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CREATE / EDIT SERVICE MODAL
══════════════════════════════════════════════════════════════════ */
const SERVICE_TYPES = ["주일 2부", "주일 1부", "금요 예배", "특별 예배", "새벽 예배", "직접 입력"];

function ServiceTitleField({ value, onChange }) {
  const isCustom = !SERVICE_TYPES.slice(0, -1).includes(value);
  const [type, setType] = useState(isCustom ? "직접 입력" : value);

  const handleType = (v) => {
    setType(v);
    if (v !== "직접 입력") onChange(v);
    else onChange("");
  };

  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:11, color:C.dim, marginBottom:5, fontWeight:700,
        letterSpacing:"0.06em", textTransform:"uppercase" }}>예배 제목</div>
      <select value={type} onChange={e => handleType(e.target.value)} style={{
        width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
        color:C.txt, padding:"10px 14px", borderRadius:10,
        fontSize:14, fontFamily:"inherit", outline:"none", marginBottom: type === "직접 입력" ? 8 : 0,
      }}>
        {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {type === "직접 입력" && (
        <input value={value} onChange={e => onChange(e.target.value)}
          placeholder="예배 제목 직접 입력"
          autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
          style={{
            width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
            color:C.txt, padding:"10px 14px", borderRadius:10,
            fontSize:14, outline:"none", fontFamily:"inherit",
          }}
        />
      )}
    </div>
  );
}

const SVC_TIME_PRESETS = [
  { label:"주일 2부", time:"11:00" },
  { label:"주일 1부", time:"09:00" },
  { label:"금요 예배", time:"20:00" },
];

function TimeSelector({ time, setTime, showCustom, setShowCustom }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
        textTransform:"uppercase", marginBottom:8 }}>시간</div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: showCustom ? 8 : 0 }}>
        {SVC_TIME_PRESETS.map(p => (
          <button key={p.label} onClick={() => { setTime(p.time); setShowCustom(false); }}
            style={{
              padding:"6px 14px", borderRadius:8, border:"none", cursor:"pointer",
              fontSize:13, fontFamily:"inherit",
              background: !showCustom && time === p.time ? C.acc : C.card,
              color:      !showCustom && time === p.time ? "#111" : C.dim,
              fontWeight: !showCustom && time === p.time ? 700 : 400,
            }}>{p.label}</button>
        ))}
        <button onClick={() => setShowCustom(true)}
          style={{
            padding:"6px 14px", borderRadius:8, cursor:"pointer", fontFamily:"inherit",
            border:`1px solid ${showCustom ? C.pur : C.bdr}`, fontSize:13,
            background: showCustom ? `${C.pur}22` : "transparent",
            color:      showCustom ? C.pur : C.dim,
            fontWeight: showCustom ? 700 : 400,
          }}>직접 입력</button>
      </div>
      {showCustom && (
        <input type="time" value={time} onChange={e => setTime(e.target.value)}
          style={{
            width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
            color:C.txt, padding:"9px 12px", borderRadius:10,
            fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box",
          }} />
      )}
    </div>
  );
}

function CreateServiceModal({ songs, onClose, onCreate }) {
  const [title,      setTitle]      = useState("주일 2부");
  const [date,       setDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [time,       setTime]       = useState("11:00");  // 주일 2부 기본값
  const [showCustom, setShowCustom] = useState(false);
  const [selected,   setSelected]   = useState([]);
  const [saving,     setSaving]     = useState(false);

  const toggle = id =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const handleCreate = async () => {
    if (!title || !selected.length) return;
    setSaving(true);
    await onCreate({ title, date, time, songIds: selected });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="새 예배 일정 만들기" onClose={onClose}>
      <ServiceTitleField value={title} onChange={setTitle} />
      <Input label="날짜" value={date} onChange={setDate} type="date" />
      <TimeSelector time={time} setTime={setTime} showCustom={showCustom} setShowCustom={setShowCustom} />

      <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
        textTransform:"uppercase", marginBottom:8 }}>
        곡 선택 · {selected.length}곡
      </div>
      <div style={{ maxHeight:220, overflowY:"auto", marginBottom:16 }}>
        {songs.length === 0 && (
          <div style={{ textAlign:"center", padding:"20px 0", color:C.dim, fontSize:13 }}>
            먼저 악보 라이브러리에서 곡을 추가해주세요
          </div>
        )}
        {songs.map(s => {
          const sel = selected.includes(s.id);
          return (
            <div key={s.id} onClick={() => toggle(s.id)} style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
              borderRadius:10, cursor:"pointer", marginBottom:4,
              background: sel ? `${C.acc}1a` : C.card,
              border:`1.5px solid ${sel ? C.acc : C.bdr}`,
            }}>
              <div style={{
                width:20, height:20, borderRadius:5, flexShrink:0,
                border:`2px solid ${sel ? C.acc : C.bdr}`,
                background: sel ? C.acc : "transparent",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                {sel && <Icon n="check" size={11} color="#111" sw={3} />}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600, fontSize:14 }}>{s.title}</div>
                <div style={{ fontSize:12, color:C.dim }}>{s.artist} · Key {s.key}</div>
              </div>
            </div>
          );
        })}
      </div>
      <Btn label={saving ? "저장 중..." : "예배 만들기"} icon="check"
        onClick={handleCreate} full disabled={saving || !title || !selected.length} />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   EDIT SERVICE MODAL
══════════════════════════════════════════════════════════════════ */
function EditServiceModal({ svc, onClose, onSave }) {
  const [title,      setTitle]      = useState(svc.title || "주일 2부");
  const [date,       setDate]       = useState(svc.date  || "");
  const [time,       setTime]       = useState(svc.time  || "");
  const [showCustom, setShowCustom] = useState(!SVC_TIME_PRESETS.some(p => p.time === (svc.time || "")));
  const [saving,     setSaving]     = useState(false);

  const handleSave = async () => {
    if (!title) return;
    setSaving(true);
    await onSave(svc.id, { title, date, time });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="예배 정보 수정" onClose={onClose}>
      <ServiceTitleField value={title} onChange={setTitle} />
      <Input label="날짜" value={date} onChange={setDate} type="date" />
      <TimeSelector time={time} setTime={setTime} showCustom={showCustom} setShowCustom={setShowCustom} />
      <Btn label={saving ? "저장 중..." : "저장"} icon="check"
        onClick={handleSave} full disabled={saving || !title} />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ADD SONG MODAL
══════════════════════════════════════════════════════════════════ */
function AddSongModal({ onClose, onAdd }) {
  const [title,        setTitle]        = useState("");
  const [artist,       setArtist]       = useState("");
  const [key,          setKey]          = useState("C");
  const [bpm,          setBpm]          = useState("80");
  const [timeSig,      setTimeSig]      = useState("4/4");
  const [youtubeUrl,   setYoutubeUrl]   = useState("");
  const [pdfFile,      setPdfFile]      = useState(null);
  const [imgFile,      setImgFile]      = useState(null);
  const [imgPreview,   setImgPreview]   = useState(null);  // blob URL for paste preview
  const [saving,       setSaving]       = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [splitMode,    setSplitMode]    = useState(false);
  const [splitEntries, setSplitEntries] = useState([]);
  const [savingPage,   setSavingPage]   = useState("");
  const [cropBox,      setCropBox]      = useState(null);
  const [showCrop,     setShowCrop]     = useState(false);
  const fileRef    = useRef(null);
  const imgFileRef = useRef(null);
  const imgPasteRef = useRef(null);
  const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  const applyImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImgFile(file);
    setImgPreview(URL.createObjectURL(file));
  };

  const handleFileSelect = async (file) => {
    setPdfFile(file);
    setImgFile(null); setImgPreview(null); // PDF 선택 시 이미지 초기화
    setSplitMode(false);
    setPdfPageCount(0);
    setSplitEntries([]);
    setCropBox(null);
    if (!file) return;
    if (!window.pdfjsLib) {
      await new Promise(resolve => {
        const existing = document.querySelector('script[src*="pdf.min.js"]');
        if (existing) {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', resolve, { once: true });
        } else {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          s.onload = () => {
            if (window.pdfjsLib) {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            }
            resolve();
          };
          s.onerror = resolve;
          document.head.appendChild(s);
        }
      });
    }
    if (!window.pdfjsLib) return;
    try {
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      const n = pdf.numPages;
      setPdfPageCount(n);
    } catch { /* ignore */ }
  };

  const enableSplit = () => {
    setSplitMode(true);
    setSplitEntries(
      Array.from({ length: pdfPageCount }, (_, i) => ({
        title: title ? `${title} (${i + 1})` : `페이지 ${i + 1}`,
        artist, key, bpm, selected: true,
      }))
    );
  };

  const updateEntry = (idx, field, val) =>
    setSplitEntries(p => p.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  const handleAdd = async () => {
    if (splitMode) {
      if (splitEntries.some(e => !e.title.trim())) return;
    } else {
      if (!title.trim()) return;
    }
    setSaving(true);
    try {
      if (splitMode && pdfPageCount > 1) {
        const toSave = splitEntries
          .map((e, i) => ({ ...e, pageNum: i + 1 }))
          .filter(e => e.selected);
        setSavingPage(`1/${toSave.length}`);
        const first = toSave[0];
        const firstRef = await onAdd({
          title: first.title, artist: first.artist,
          key: first.key, bpm: Number(first.bpm) || 80, pdfPage: first.pageNum,
        });
        let sharedUrl = null;
        if (pdfFile && firstRef?.id) {
          sharedUrl = await uploadPdf(pdfFile, firstRef.id);
          const extra = { pdfUrl: sharedUrl };
          if (cropBox) extra.cropBox = cropBox;
          await updateDoc(doc(db, "songs", firstRef.id), extra);
        }
        for (let i = 1; i < toSave.length; i++) {
          const e = toSave[i];
          setSavingPage(`${i + 1}/${toSave.length}`);
          const ref = await onAdd({
            title: e.title, artist: e.artist,
            key: e.key, bpm: Number(e.bpm) || 80, pdfPage: e.pageNum,
          });
          if (sharedUrl && ref?.id) {
            const extra = { pdfUrl: sharedUrl };
            if (cropBox) extra.cropBox = cropBox;
            await updateDoc(doc(db, "songs", ref.id), extra);
          }
        }
      } else {
        const docRef = await onAdd({ title, artist, key, bpm: Number(bpm) || 80, timeSig: timeSig || "4/4", youtubeUrl: youtubeUrl.trim() || "" });
        if (pdfFile && docRef?.id) {
          const url = await uploadPdf(pdfFile, docRef.id);
          const extra = { pdfUrl: url };
          if (cropBox) extra.cropBox = cropBox;
          await updateDoc(doc(db, "songs", docRef.id), extra);
        } else if (imgFile && docRef?.id) {
          const url = await uploadImage(imgFile, docRef.id);
          await updateDoc(doc(db, "songs", docRef.id), { imageUrl: url });
        }
      }
      onClose();
    } catch(e) {
      console.error(e);
      alert("오류: " + e.message);
      setSaving(false);
      setSavingPage("");
    }
  };

  const selectedEntries = splitEntries.filter(e => e.selected);
  const canAdd = splitMode
    ? selectedEntries.length > 0 && selectedEntries.every(e => e.title.trim())
    : !!title.trim();

  return (
    <><Modal title="새 곡 추가" onClose={onClose} noBackdrop>
      {!splitMode && (
        <>
          <Input label="곡 제목"  value={title}  onChange={setTitle}
            placeholder="예) 주님 이름 찬양" autoFocus />
          <Input label="아티스트" value={artist} onChange={setArtist}
            placeholder="예) Hillsong Worship" />
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:8 }}>키</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {KEYS.map(k => (
                <button key={k} onClick={() => setKey(k)} style={{
                  padding:"5px 10px", borderRadius:7, border:"none", cursor:"pointer", fontSize:13,
                  background: key===k ? keyColor(k) : C.card,
                  color:       key===k ? "#111"       : C.dim,
                  fontWeight:  key===k ? 700          : 400,
                  fontFamily:"inherit",
                }}>{k}</button>
              ))}
            </div>
          </div>
          <Input label="BPM" value={bpm} onChange={setBpm} type="number" placeholder="80" />
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:8 }}>박자</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {["4/4","3/4","6/8","2/4","12/8"].map(t => (
                <button key={t} onClick={() => setTimeSig(t)} style={{
                  padding:"5px 12px", borderRadius:7, border:"none", cursor:"pointer",
                  fontSize:13, fontFamily:"inherit",
                  background: timeSig===t ? C.pur : C.card,
                  color:      timeSig===t ? "#fff" : C.dim,
                  fontWeight: timeSig===t ? 700   : 400,
                }}>{t}</button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* YouTube URL */}
      {!splitMode && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
            textTransform:"uppercase", marginBottom:8 }}>YouTube 링크 (선택)</div>
          <input
            value={youtubeUrl}
            onChange={e => setYoutubeUrl(e.target.value)}
            placeholder="https://youtu.be/..."
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
            style={{
              width:"100%", background:C.card, border:`1.5px solid ${getYoutubeId(youtubeUrl) ? C.grn : C.bdr}`,
              color:C.txt, padding:"9px 12px", borderRadius:10,
              fontSize:13, outline:"none", fontFamily:"inherit", boxSizing:"border-box",
            }}
          />
          {getYoutubeId(youtubeUrl) && (
            <div style={{ fontSize:11, color:C.grn, marginTop:4 }}>
              ✓ 유효한 YouTube 링크
            </div>
          )}
        </div>
      )}

      {/* PDF 업로드 */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:8 }}>악보 PDF (선택)</div>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf"
          style={{ display:"none" }}
          onChange={e => { handleFileSelect(e.target.files[0] || null); e.target.value = ""; }} />
        {pdfFile ? (
          <>
            <div style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
              background:`${C.grn}12`, border:`1.5px solid ${C.grn}55`, borderRadius:10, marginBottom:6,
            }}>
              <span style={{ fontSize:20 }}>📄</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:C.grn, fontWeight:600,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {pdfFile.name}
                </div>
                <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                  {pdfPageCount > 0 ? `${pdfPageCount}페이지` : ""}
                  {cropBox && <span style={{ color:C.acc, marginLeft:6, fontWeight:700 }}>✓ 크롭 설정됨</span>}
                </div>
              </div>
              <button onClick={() => setShowCrop(true)}
                title="크롭 설정"
                style={{ display:"flex", alignItems:"center", justifyContent:"center",
                  width:30, height:30, borderRadius:8, cursor:"pointer", border:"none",
                  background: cropBox ? `${C.acc}22` : `${C.pur}15`,
                  color: cropBox ? C.acc : C.pur }}>
                <Icon n="fitCrop" size={15} color={cropBox ? C.acc : C.pur} />
              </button>
              <button onClick={() => { setPdfFile(null); setSplitMode(false); setPdfPageCount(0); setCropBox(null); }}
                style={{ background:"none", border:"none", cursor:"pointer", padding:2, display:"flex" }}>
                <Icon n="xmark" size={16} color={C.dim} />
              </button>
            </div>
          </>
        ) : (
          <button onClick={() => fileRef.current.click()} style={{
            width:"100%", padding:"16px", borderRadius:12, cursor:"pointer",
            border:`2px dashed ${C.bdr}`, background:C.card,
            fontFamily:"inherit", fontSize:14, fontWeight:600, color:C.dim,
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          }}>
            <Icon n="upload" size={18} color={C.dim} />
            PDF 파일 선택
          </button>
        )}
      </div>

      {/* 이미지 업로드 — PDF 없을 때만 표시 */}
      {!pdfFile && !splitMode && (
        <>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ flex:1, height:1, background:C.bdr }} />
            <span style={{ fontSize:11, color:C.dim }}>또는</span>
            <div style={{ flex:1, height:1, background:C.bdr }} />
          </div>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:8 }}>악보 이미지 (선택)</div>
            <input ref={imgFileRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e => { applyImageFile(e.target.files?.[0]); e.target.value = ""; }} />
            {imgFile ? (
              <>
                <div style={{ marginBottom:8, borderRadius:10, overflow:"hidden",
                  border:`1px solid ${C.bdr}`, lineHeight:0 }}>
                  <img src={imgPreview} alt="preview"
                    style={{ width:"100%", maxHeight:160, objectFit:"contain",
                      background:C.surf, display:"block" }} />
                </div>
                <div style={{
                  display:"flex", alignItems:"center", gap:10, padding:"8px 14px",
                  background:`${C.acc}12`, border:`1.5px solid ${C.acc}55`, borderRadius:10,
                }}>
                  <span style={{ fontSize:18 }}>🖼️</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, color:C.acc, fontWeight:600,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {imgFile.name}
                    </div>
                  </div>
                  <button onClick={() => { setImgFile(null); setImgPreview(null); }}
                    style={{ background:"none", border:"none", cursor:"pointer", padding:2, display:"flex" }}>
                    <Icon n="xmark" size={16} color={C.dim} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                  <button onClick={() => imgPasteRef.current?.focus()} style={{
                    flex:1, padding:"12px 0", borderRadius:10, cursor:"pointer",
                    background:C.pur, border:"none", fontFamily:"inherit",
                    fontSize:13, fontWeight:700, color:"#fff",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  }}>📋 붙여넣기</button>
                  <label style={{
                    flex:1, padding:"12px 0", borderRadius:10, cursor:"pointer",
                    background:"transparent", border:`1.5px solid ${C.bdr}`,
                    fontFamily:"inherit", fontSize:13, fontWeight:700, color:C.dim,
                    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  }}>📁 파일 선택
                    <input type="file" accept="image/*" style={{ display:"none" }}
                      onChange={e => { applyImageFile(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <div ref={imgPasteRef} contentEditable suppressContentEditableWarning
                  onPaste={e => {
                    e.preventDefault();
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const item of Array.from(items)) {
                      if (item.type.startsWith("image/")) { applyImageFile(item.getAsFile()); break; }
                    }
                  }}
                  style={{ minHeight:44, borderRadius:8, border:`1.5px dashed ${C.acc}66`,
                    padding:"10px 12px", fontSize:12, color:C.dim, outline:"none",
                    background:C.surf, textAlign:"center", lineHeight:1.5 }}>
                  여기서 커서 위치 후 붙여넣기 (Ctrl+V / 꾹 누르기)
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* 분할 저장 옵션 */}
      {pdfPageCount > 1 && !splitMode && (
        <button onClick={enableSplit} style={{
          width:"100%", padding:"10px", borderRadius:10, marginBottom:12, cursor:"pointer",
          border:`1.5px solid ${C.pur}66`, background:`${C.pur}0e`,
          fontFamily:"inherit", fontSize:13, fontWeight:700, color:C.pur,
          display:"flex", alignItems:"center", justifyContent:"center", gap:6,
        }}>
          ✂️ PDF {pdfPageCount}페이지를 {pdfPageCount}개 곡으로 분할 저장
        </button>
      )}

      {/* 분할 모드: 페이지별 제목 입력 */}
      {splitMode && (
        <div style={{ marginBottom:14 }}>
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8,
          }}>
            <div style={{ fontSize:11, color:C.pur, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase" }}>
              분할 저장 — {selectedEntries.length}/{pdfPageCount} 선택
            </div>
            <div style={{ display:"flex", gap:5 }}>
              <button onClick={() => setSplitEntries(p => p.map(e => ({ ...e, selected: true })))} style={{
                background:"transparent", border:`1px solid ${C.pur}66`, borderRadius:6,
                padding:"2px 8px", cursor:"pointer", fontSize:11, color:C.pur, fontFamily:"inherit",
              }}>전체선택</button>
              <button onClick={() => setSplitMode(false)} style={{
                background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6,
                padding:"2px 8px", cursor:"pointer", fontSize:11, color:C.dim, fontFamily:"inherit",
              }}>취소</button>
            </div>
          </div>
          <div style={{ maxHeight:280, overflowY:"auto", display:"flex", flexDirection:"column", gap:8 }}>
            {splitEntries.map((e, i) => (
              <div key={i} style={{
                background: e.selected ? C.card : C.bg,
                borderRadius:10, padding:"10px 12px",
                border:`1px solid ${e.selected ? C.bdr : C.bdr + "55"}`,
                opacity: e.selected ? 1 : 0.5,
              }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                  <div style={{ fontSize:11, color:C.dim, fontWeight:700 }}>
                    페이지 {i + 1}
                  </div>
                  <button onClick={() => updateEntry(i, "selected", !e.selected)} style={{
                    background: e.selected ? `${C.grn}20` : C.card,
                    border:`1px solid ${e.selected ? C.grn : C.bdr}`,
                    borderRadius:6, padding:"2px 10px", cursor:"pointer",
                    fontSize:11, color: e.selected ? C.grn : C.dim, fontFamily:"inherit", fontWeight:600,
                  }}>
                    {e.selected ? "✓ 포함" : "제외"}
                  </button>
                </div>
                <input
                  value={e.title}
                  onChange={ev => updateEntry(i, "title", ev.target.value)}
                  placeholder={`곡 제목 (페이지 ${i + 1})`}
                  autoComplete="off" autoCorrect="off" spellCheck="false"
                  style={{
                    width:"100%", boxSizing:"border-box",
                    background:C.surf, border:`1px solid ${C.bdr}`,
                    color:C.txt, padding:"7px 10px", borderRadius:8,
                    fontSize:13, outline:"none", fontFamily:"inherit", marginBottom:6,
                  }}
                />
                <div style={{ display:"flex", gap:6 }}>
                  <input
                    value={e.artist}
                    onChange={ev => updateEntry(i, "artist", ev.target.value)}
                    placeholder="아티스트"
                    autoComplete="off" autoCorrect="off" spellCheck="false"
                    style={{
                      flex:1, background:C.surf, border:`1px solid ${C.bdr}`,
                      color:C.txt, padding:"6px 8px", borderRadius:7,
                      fontSize:12, outline:"none", fontFamily:"inherit",
                    }}
                  />
                  <select value={e.key} onChange={ev => updateEntry(i, "key", ev.target.value)}
                    style={{
                      background:C.surf, border:`1px solid ${C.bdr}`,
                      color:C.txt, padding:"6px 8px", borderRadius:7,
                      fontSize:12, fontFamily:"inherit", outline:"none",
                    }}>
                    {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input
                    value={e.bpm}
                    onChange={ev => updateEntry(i, "bpm", ev.target.value)}
                    placeholder="BPM"
                    type="number"
                    style={{
                      width:60, background:C.surf, border:`1px solid ${C.bdr}`,
                      color:C.txt, padding:"6px 8px", borderRadius:7,
                      fontSize:12, outline:"none", fontFamily:"inherit",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {saving && (
        <div style={{ fontSize:12, color:C.dim, marginBottom:12, textAlign:"center" }}>
          {savingPage ? `📤 저장 중... (${savingPage})` : pdfFile ? "📤 PDF 업로드 중..." : imgFile ? "📤 이미지 업로드 중..." : "저장 중..."}
        </div>
      )}

      <Btn
        label={saving ? (savingPage ? `저장 중... ${savingPage}` : "추가 중...") : (splitMode ? `${selectedEntries.length}개 곡 추가하기` : "추가하기")}
        icon="plus" onClick={handleAdd} full disabled={saving || !canAdd}
      />
    </Modal>
    {showCrop && (
      <CropModal
        pdfFile={pdfFile}
        initialCrop={cropBox}
        onClose={() => setShowCrop(false)}
        onConfirm={box => { setCropBox(box); setShowCrop(false); }}
      />
    )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CROP MODAL
══════════════════════════════════════════════════════════════════ */
function CropModal({ pdfFile, pdfUrl, imageUrl, onClose, onConfirm, initialCrop = null }) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const dragRef      = useRef(null);
  const [cropBox,   setCropBox]   = useState(initialCrop || { left:0.02, top:0.02, right:0.98, bottom:0.98 });
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const renderPdf = async (arrayBuf) => {
      if (!window.pdfjsLib) { setRendering(false); return; }
      try {
        const pdf  = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const page = await pdf.getPage(1);
        const vp0  = page.getViewport({ scale: 1 });
        const maxW = Math.min(window.innerWidth - 48, 460);
        const sc   = maxW / vp0.width;
        const vp   = page.getViewport({ scale: sc });
        if (cancelled || !canvasRef.current) return;
        canvasRef.current.width  = vp.width;
        canvasRef.current.height = vp.height;
        await page.render({ canvasContext: canvasRef.current.getContext("2d"), viewport: vp }).promise;
      } catch(e) { console.error(e); }
      finally { if (!cancelled) setRendering(false); }
    };
    const renderImg = (url) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled || !canvasRef.current) return;
        const maxW = Math.min(window.innerWidth - 48, 460);
        const sc   = maxW / img.width;
        const dW   = Math.round(img.width  * sc);
        const dH   = Math.round(img.height * sc);
        canvasRef.current.width  = dW;
        canvasRef.current.height = dH;
        canvasRef.current.getContext("2d").drawImage(img, 0, 0, dW, dH);
        if (!cancelled) setRendering(false);
      };
      img.onerror = () => { if (!cancelled) setRendering(false); };
      img.src = url;
    };
    if (imageUrl) {
      renderImg(imageUrl);
    } else if (pdfFile) {
      pdfFile.arrayBuffer().then(buf => { if (!cancelled) renderPdf(buf); });
    } else if (pdfUrl) {
      fetch(pdfUrl).then(r => r.arrayBuffer()).then(buf => { if (!cancelled) renderPdf(buf); }).catch(() => setRendering(false));
    } else {
      setRendering(false);
    }
    return () => { cancelled = true; };
  }, [pdfFile, pdfUrl, imageUrl]);

  const autoDetect = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    const W = canvas.width, H = canvas.height;
    const d = canvas.getContext("2d").getImageData(0, 0, W, H).data;
    const THR = 230;
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i+3] > 10 && (d[i] < THR || d[i+1] < THR || d[i+2] < THR)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x0 < x1 && y0 < y1) {
      const p = 0.008;
      setCropBox({ left: Math.max(0, x0/W - p), top: Math.max(0, y0/H - p), right: Math.min(1, x1/W + p), bottom: Math.min(1, y1/H + p) });
    }
  };

  const startDrag = (e, handle) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startBox: { ...cropBox } };
  };
  const moveDrag = (e) => {
    if (!dragRef.current || !containerRef.current) return;
    const { handle, startX, startY, startBox } = dragRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - startX) / rect.width;
    const dy = (e.clientY - startY) / rect.height;
    const b = { ...startBox };
    const MIN = 0.05;
    if (handle.includes("l")) b.left   = Math.max(0, Math.min(startBox.right  - MIN, startBox.left   + dx));
    if (handle.includes("r")) b.right  = Math.min(1, Math.max(startBox.left   + MIN, startBox.right  + dx));
    if (handle.includes("t")) b.top    = Math.max(0, Math.min(startBox.bottom - MIN, startBox.top    + dy));
    if (handle.includes("b")) b.bottom = Math.min(1, Math.max(startBox.top    + MIN, startBox.bottom + dy));
    setCropBox(b);
  };
  const endDrag = () => { dragRef.current = null; };

  const cb = cropBox;
  const handles = [
    { id:"tl", x:cb.left,                   y:cb.top,                    cur:"nw-resize" },
    { id:"tr", x:cb.right,                  y:cb.top,                    cur:"ne-resize" },
    { id:"bl", x:cb.left,                   y:cb.bottom,                 cur:"sw-resize" },
    { id:"br", x:cb.right,                  y:cb.bottom,                 cur:"se-resize" },
    { id:"tm", x:(cb.left+cb.right)/2,      y:cb.top,                    cur:"n-resize"  },
    { id:"bm", x:(cb.left+cb.right)/2,      y:cb.bottom,                 cur:"s-resize"  },
    { id:"lm", x:cb.left,                   y:(cb.top+cb.bottom)/2,      cur:"w-resize"  },
    { id:"rm", x:cb.right,                  y:(cb.top+cb.bottom)/2,      cur:"e-resize"  },
  ];

  const hasCrop = cb.left > 0.005 || cb.top > 0.005 || cb.right < 0.995 || cb.bottom < 0.995;

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.92)",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      zIndex:1000, padding:16, gap:10,
    }}>
      {/* 툴바 */}
      <div style={{ display:"flex", alignItems:"center", gap:8, width:"100%", maxWidth:520, flexShrink:0 }}>
        <div style={{ flex:1, color:"#fff", fontWeight:700, fontSize:15 }}>✂️ 악보 크롭</div>
        <button onClick={autoDetect} disabled={rendering}
          style={{ padding:"7px 13px", borderRadius:8, border:"none", cursor:rendering?"default":"pointer",
            background:C.pur, color:"#fff", fontSize:13, fontWeight:700, fontFamily:"inherit", opacity:rendering?.5:1 }}>
          자동 감지
        </button>
        <button onClick={() => setCropBox({ left:0, top:0, right:1, bottom:1 })}
          style={{ padding:"7px 11px", borderRadius:8, border:"1px solid rgba(255,255,255,.3)",
            background:"transparent", color:"#ccc", fontSize:12, fontFamily:"inherit", cursor:"pointer" }}>
          초기화
        </button>
        <button onClick={() => onConfirm(hasCrop ? cropBox : null)}
          style={{ padding:"7px 16px", borderRadius:8, border:"none", cursor:"pointer",
            background:C.acc, color:"#111", fontSize:13, fontWeight:700, fontFamily:"inherit" }}>
          적용
        </button>
        <button onClick={onClose}
          style={{ background:"none", border:"none", cursor:"pointer", color:"#fff", padding:"4px", display:"flex" }}>
          <Icon n="xmark" size={20} color="#fff" />
        </button>
      </div>

      {/* 캔버스 + 오버레이 */}
      <div ref={containerRef} style={{ position:"relative", display:"inline-block", userSelect:"none", touchAction:"none", maxWidth:"100%", flexShrink:1 }}>
        {rendering && (
          <div style={{ width:280, height:180, display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,.5)", fontSize:14 }}>
            렌더링 중...
          </div>
        )}
        <canvas ref={canvasRef} style={{ display:rendering?"none":"block", maxWidth:"100%", maxHeight:"calc(100dvh - 160px)" }} />
        {!rendering && <>
          <div style={{ position:"absolute", inset:0, top:0, height:`${cb.top*100}%`, background:"rgba(0,0,0,.55)", pointerEvents:"none" }} />
          <div style={{ position:"absolute", inset:0, top:`${cb.bottom*100}%`, background:"rgba(0,0,0,.55)", pointerEvents:"none" }} />
          <div style={{ position:"absolute", left:0, top:`${cb.top*100}%`, width:`${cb.left*100}%`, height:`${(cb.bottom-cb.top)*100}%`, background:"rgba(0,0,0,.55)", pointerEvents:"none" }} />
          <div style={{ position:"absolute", right:0, top:`${cb.top*100}%`, width:`${(1-cb.right)*100}%`, height:`${(cb.bottom-cb.top)*100}%`, background:"rgba(0,0,0,.55)", pointerEvents:"none" }} />
          <div style={{ position:"absolute", left:`${cb.left*100}%`, top:`${cb.top*100}%`, width:`${(cb.right-cb.left)*100}%`, height:`${(cb.bottom-cb.top)*100}%`, border:`2px solid ${C.acc}`, boxSizing:"border-box", pointerEvents:"none" }} />
          {handles.map(h => (
            <div key={h.id}
              onPointerDown={e => startDrag(e, h.id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              style={{ position:"absolute", left:`${h.x*100}%`, top:`${h.y*100}%`, width:14, height:14,
                background:C.acc, border:"2px solid #fff", borderRadius:3, transform:"translate(-50%,-50%)",
                cursor:h.cur, touchAction:"none", zIndex:2 }} />
          ))}
        </>}
      </div>

      <div style={{ color:"rgba(255,255,255,.45)", fontSize:12, textAlign:"center", flexShrink:0 }}>
        핸들을 드래그하여 크롭 영역 조정 · "자동 감지"로 여백 자동 제거
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SERVICES SCREEN
══════════════════════════════════════════════════════════════════ */
function ServicesScreen({ user, services, songs, notifs, createService, nav, teamAnnotations }) {
  const [showCreate,   setShowCreate]   = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const unread = notifs.filter(n => !n.read).length;

  const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("ko-KR",
    { month:"long", day:"numeric", weekday:"short" });

  const today    = new Date().toISOString().slice(0, 10);
  const upcoming = services.filter(s => s.date >= today);
  // 지난 예배: 최신순 정렬
  const past     = services.filter(s => s.date < today)
    .slice().sort((a, b) => b.date.localeCompare(a.date));
  const pastShown = pastExpanded ? past : past.slice(0, 3);

  const SvcCard = ({ svc, past, first }) => {
    const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    const borderStyle = past
      ? `1px solid ${C.bdr}`
      : first
        ? `2px solid ${C.acc}`
        : `1px solid ${C.bdr}`;
    const shadowStyle = past
      ? "0 1px 4px rgba(0,0,0,.06)"
      : first
        ? `0 4px 18px ${C.acc}55`
        : "0 1px 4px rgba(0,0,0,.06)";
    return (
      <div className="wFadeIn"
        onClick={() => nav("svcDetail", { svcId: svc.id })}
        style={{
          background: C.surf,
          borderRadius:14, padding:"16px",
          marginBottom:10,
          border: borderStyle,
          cursor:"pointer",
          boxShadow: shadowStyle,
        }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight: first ? 800 : 700, fontSize: first ? 17 : 16 }}>{fmtDate(svc.date)}</div>
            <div style={{ color: first ? C.acc : C.dim, fontSize:13, marginTop:3, fontWeight: first ? 600 : 400 }}>
              {svc.title}{svc.time ? ` · ${svc.time}` : ""}
            </div>
          </div>
          {svc.notified && (
            <span style={{ fontSize:11, color:C.dim, marginLeft:8, marginTop:2 }}>✓ 알림완료</span>
          )}
        </div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
          {svcSongs.map((s, i) => (
            <span key={s.id} style={{
              fontSize:12, background:C.bg, border:`1px solid ${C.bdr}`,
              borderRadius:6, padding:"3px 8px", color:C.txt,
              display:"flex", alignItems:"center", gap:4,
            }}>
              <span style={{ color:C.dim, fontSize:11 }}>{i+1}.</span>
              {s.title}
              <span style={{
                background:`${keyColor(s.key)}22`, color:keyColor(s.key),
                borderRadius:4, padding:"0 4px", fontSize:10, fontWeight:700,
              }}>Key {s.key}</span>
            </span>
          ))}
        </div>
        {(() => {
          const totalMemos = svcSongs.reduce((acc, s) => acc + ((teamAnnotations || {})[s.id]?.length || 0), 0);
          return (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:C.dim }}>{svcSongs.length}곡 선택됨</span>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {totalMemos > 0 && (
                  <span style={{
                    background:"#e5393518", color:"#e53935",
                    border:"1px solid #e5393540",
                    borderRadius:5, padding:"1px 6px", fontSize:11, fontWeight:700,
                    display:"flex", alignItems:"center", gap:3,
                  }}>
                    <Icon n="users" size={10} color="#e53935" sw={2.5} />
                    팀메모 {totalMemos}개
                  </span>
                )}
                <Icon n="chevR" size={16} color={C.dim} />
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div style={{ height:"100%", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* 헤더 */}
      <div style={{ background:C.surf, padding:"20px 20px 16px", flexShrink:0,
        paddingTop:"calc(20px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:12, color:C.dim, marginBottom:2 }}>TVPC Worship</div>
          <div style={{ fontWeight:800, fontSize:20 }}>예배 일정</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {isLeader(user.role) && (
            <button onClick={() => setShowCreate(true)} title="새 예배 만들기" style={{
              width:36, height:36, borderRadius:9, cursor:"pointer",
              background:`${C.acc}18`, border:`1px solid ${C.acc}66`,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
            }}>
              <Icon n="plus" size={18} color={C.acc} />
            </button>
          )}
          <button onClick={() => nav("notifications")} title="알림" style={{
            width:36, height:36, borderRadius:9, cursor:"pointer", position:"relative",
            background:C.card, border:`1px solid ${unread > 0 ? C.acc : C.bdr}`,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>
            <Icon n="bell" size={18} color={unread > 0 ? C.acc : C.dim} />
            {unread > 0 && (
              <span style={{
                position:"absolute", top:-5, right:-5,
                minWidth:15, height:15, padding:"0 3px",
                background:C.red, borderRadius:8, border:`2px solid ${C.surf}`,
                fontSize:9, fontWeight:700, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                lineHeight:1, boxSizing:"border-box",
              }}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:16, paddingBottom:90 }}>
        {/* 다가오는 예배 */}
        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:10 }}>다가오는 예배</div>
            {upcoming.map((svc, i) => <SvcCard key={svc.id} svc={svc} past={false} first={i === 0} />)}
          </>
        )}

        {/* 지난 예배 아카이브 */}
        {past.length > 0 && (
          <>
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              margin:`${upcoming.length > 0 ? "28px" : "16px"} 0 10px`,
            }}>
              <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
                textTransform:"uppercase", display:"flex", alignItems:"center", gap:6 }}>
                지난 예배
                <span style={{
                  background:C.bg, border:`1px solid ${C.bdr}`,
                  borderRadius:10, padding:"1px 7px",
                  fontSize:10, fontWeight:700, color:C.dim,
                }}>{past.length}개</span>
              </div>
              {past.length > 3 && (
                <button onClick={() => setPastExpanded(p => !p)} style={{
                  background:"transparent", border:`1px solid ${C.bdr}`,
                  borderRadius:7, padding:"3px 10px", cursor:"pointer",
                  fontSize:11, color:C.dim, fontFamily:"inherit", fontWeight:600,
                }}>
                  {pastExpanded ? "접기" : `전체 보기`}
                </button>
              )}
            </div>
            {pastShown.map(svc => (
              <div key={svc.id} style={{ opacity:0.75 }}>
                <SvcCard svc={svc} past={true} />
              </div>
            ))}
            {!pastExpanded && past.length > 3 && (
              <button onClick={() => setPastExpanded(true)} style={{
                width:"100%", padding:"10px 0", borderRadius:10, marginTop:2,
                background:"transparent", border:`1px dashed ${C.bdr}`,
                cursor:"pointer", fontSize:12, color:C.dim, fontFamily:"inherit",
              }}>
                지난 예배 {past.length - 3}개 더 보기
              </button>
            )}
          </>
        )}

        {services.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
            <div style={{ fontSize:48, marginBottom:16 }}>📋</div>
            <div style={{ fontWeight:600, marginBottom:6 }}>등록된 예배 일정이 없습니다</div>
            <div style={{ fontSize:13 }}>위 버튼을 눌러 첫 예배를 만들어보세요</div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateServiceModal songs={songs} onClose={() => setShowCreate(false)}
          onCreate={createService} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SERVICE DETAIL SCREEN
══════════════════════════════════════════════════════════════════ */
const QUICK_KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function SongPickerModal({ songs, currentIds, onClose, onSave, addSong, user }) {
  const [selected,     setSelected]     = useState([...currentIds]);
  const [query,        setQuery]        = useState("");
  const [showQuick,    setShowQuick]    = useState(false);
  const [quickTitle,   setQuickTitle]   = useState("");
  const [quickKey,     setQuickKey]     = useState("C");
  const [quickImage,   setQuickImage]   = useState(null);   // File
  const [quickPreview, setQuickPreview] = useState(null);   // blob URL
  const [quickSaving,  setQuickSaving]  = useState(false);
  const [quickErr,     setQuickErr]     = useState("");
  const pasteAreaRef = useRef(null); // unused but kept for safety

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(query.toLowerCase())
  );
  const toggle = id => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const applyImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setQuickImage(file);
    setQuickPreview(URL.createObjectURL(file));
    setQuickErr("");
    if (!quickTitle) setQuickTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 40));
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        applyImageFile(item.getAsFile());
        break;
      }
    }
  };

  const handleQuickAdd = async () => {
    if (!quickTitle.trim()) { setQuickErr("곡 제목을 입력하세요"); return; }
    if (!quickImage)        { setQuickErr("이미지를 붙여넣거나 선택하세요"); return; }
    setQuickSaving(true); setQuickErr("");
    try {
      const docRef = await addSong({ title: quickTitle.trim(), key: quickKey, artist: "", bpm: 80, timeSig: "4/4" });
      const { updateDoc, doc } = await import("firebase/firestore");
      const { db: _db } = await import("./firebase.js");
      const imageUrl = await uploadImage(quickImage, docRef.id);
      await updateDoc(doc(_db, "songs", docRef.id), { imageUrl });
      setSelected(p => [...p, docRef.id]);
      setShowQuick(false);
      setQuickTitle(""); setQuickKey("C"); setQuickImage(null); setQuickPreview(null);
    } catch(e) {
      setQuickErr("추가 실패: " + e.message);
    } finally {
      setQuickSaving(false);
    }
  };

  // 📋 버튼 클릭 → 붙여넣기 영역에 포커스 후 paste 실행
  const handleClipboardBtn = () => {
    if (pasteAreaRef.current) {
      pasteAreaRef.current.focus();
      try { document.execCommand("paste"); } catch { /* ignore */ }
    }
  };

  return (
    <Modal title={`곡 선택 (${selected.length}곡)`} onClose={onClose}>
      {/* 빠른 추가 (이미지) 토글 */}
      <button onClick={() => { setShowQuick(p => !p); setQuickErr(""); }}
        style={{
          width:"100%", marginBottom:10, padding:"8px 12px",
          background: showQuick ? `${C.acc}22` : C.card,
          border:`1.5px solid ${showQuick ? C.acc : C.bdr}`,
          borderRadius:10, cursor:"pointer", fontFamily:"inherit",
          display:"flex", alignItems:"center", gap:8,
          color: showQuick ? C.acc : C.dim, fontWeight:700, fontSize:13,
        }}>
        <span style={{ fontSize:16 }}>🖼️</span>
        이미지로 빠른 추가
        <span style={{ marginLeft:"auto", fontSize:11, opacity:0.7 }}>
          {showQuick ? "▲ 닫기" : "▼ 열기"}
        </span>
      </button>

      {showQuick && (
        <div style={{ background:C.card, borderRadius:12, padding:14, marginBottom:12,
          border:`1.5px solid ${C.acc}44` }}>

          {/* 이미지 미리보기 */}
          {quickPreview && (
            <div style={{ marginBottom:10, borderRadius:10, overflow:"hidden",
              border:`1px solid ${C.bdr}`, lineHeight:0 }}>
              <img src={quickPreview} alt="preview"
                style={{ width:"100%", maxHeight:160, objectFit:"contain",
                  background:C.surf, display:"block" }} />
            </div>
          )}

          {/* 버튼 2개: 붙여넣기 + 파일선택 */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <button onClick={handleClipboardBtn}
              style={{
                flex:1, padding:"12px 0", borderRadius:10, cursor:"pointer",
                background: C.pur, border:"none",
                fontFamily:"inherit", fontSize:13, fontWeight:700, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center", gap:6,
              }}>
              📋 붙여넣기
            </button>
            <label style={{
              flex:1, padding:"12px 0", borderRadius:10, cursor:"pointer",
              background:"transparent", border:`1.5px solid ${C.bdr}`,
              fontFamily:"inherit", fontSize:13, fontWeight:700, color:C.dim,
              display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            }}>
              📁 파일 선택
              <input type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => applyImageFile(e.target.files?.[0])} />
            </label>
          </div>

          {/* 붙여넣기 영역 — 여기서 커서 위치 후 붙여넣기 버튼 클릭 */}
          <div
            ref={pasteAreaRef}
            contentEditable
            suppressContentEditableWarning
            onPaste={e => {
              e.preventDefault();
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of Array.from(items)) {
                if (item.type.startsWith("image/")) {
                  applyImageFile(item.getAsFile());
                  break;
                }
              }
            }}
            style={{
              minHeight:44, borderRadius:8, border:`1.5px dashed ${C.acc}66`,
              padding:"10px 12px", fontSize:12, color:C.dim, outline:"none",
              marginBottom:10, background:C.surf, textAlign:"center",
              lineHeight:1.5,
            }}>
            여기서 커서 위치 후 붙여넣기 버튼 클릭 (또는 Ctrl+V / 꾹 누르기)
          </div>

          <input value={quickTitle} onChange={e => setQuickTitle(e.target.value)}
            placeholder="곡 제목 *"
            style={{
              width:"100%", background:C.surf, border:`1.5px solid ${C.bdr}`,
              color:C.txt, padding:"8px 12px", borderRadius:8,
              fontSize:13, outline:"none", fontFamily:"inherit",
              marginBottom:8, boxSizing:"border-box",
            }} />
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:12, color:C.dim, flexShrink:0 }}>Key</span>
            <select value={quickKey} onChange={e => setQuickKey(e.target.value)}
              style={{
                background:C.surf, border:`1.5px solid ${C.bdr}`, color:C.txt,
                padding:"6px 10px", borderRadius:8, fontSize:13, fontFamily:"inherit",
                outline:"none", cursor:"pointer",
              }}>
              {QUICK_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {quickErr && <div style={{ fontSize:12, color:C.red, marginBottom:8 }}>{quickErr}</div>}
          <button onClick={handleQuickAdd} disabled={quickSaving}
            style={{
              width:"100%", padding:"9px 0", borderRadius:9,
              background: quickSaving ? `${C.acc}66` : C.acc,
              border:"none", cursor: quickSaving ? "not-allowed" : "pointer",
              fontFamily:"inherit", fontSize:13, fontWeight:700, color:"#111",
            }}>
            {quickSaving ? "추가 중..." : "🎵 라이브러리에 추가 후 선택"}
          </button>
        </div>
      )}

      <input value={query} onChange={e => setQuery(e.target.value)}
        placeholder="곡명, 아티스트 검색..."
        style={{
          width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
          color:C.txt, padding:"9px 14px", borderRadius:10,
          fontSize:14, outline:"none", fontFamily:"inherit", marginBottom:12,
        }} />
      <div style={{ maxHeight:300, overflowY:"auto", marginBottom:14 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"30px 0", color:C.dim, fontSize:13 }}>
            {query ? "검색 결과 없음" : "악보 라이브러리에 곡이 없습니다"}
          </div>
        )}
        {filtered.map(s => {
          const sel = selected.includes(s.id);
          return (
            <div key={s.id} onClick={() => toggle(s.id)} style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
              borderRadius:10, cursor:"pointer", marginBottom:4,
              background: sel ? `${C.acc}18` : C.card,
              border:`1.5px solid ${sel ? C.acc : C.bdr}`,
            }}>
              <div style={{
                width:22, height:22, borderRadius:6, flexShrink:0,
                border:`2px solid ${sel ? C.acc : C.bdr}`,
                background: sel ? C.acc : "transparent",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                {sel && <Icon n="check" size={12} color="#fff" sw={3} />}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:14, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.title}</div>
                <div style={{ fontSize:12, color:C.dim, marginTop:1 }}>
                  {s.artist} · Key {s.key}{s.bpm ? ` · ♩${s.bpm}` : ""}
                  {s.pdfUrl ? " · 📄 PDF" : s.imageUrl ? " · 🖼️ 이미지" : ""}
                </div>
              </div>
              <KeyBadge k={s.key} />
            </div>
          );
        })}
      </div>
      <Btn label={`${selected.length}곡 저장`} icon="check"
        onClick={() => onSave(selected)} full disabled={selected.length === 0} />
    </Modal>
  );
}


function ServiceDetailScreen({ user, services, songs, annotations, teamAnnotations, userMap, notifs, nav, selectedSvcId, onUpdateService, addSong }) {
  const svc = services.find(s => s.id === selectedSvcId);
  const [showPicker,     setShowPicker]     = useState(false);
  const [showEdit,       setShowEdit]       = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifType,      setNotifType]      = useState("예배 악보");
  const [notifContent,   setNotifContent]   = useState("");
  const [notifSending,   setNotifSending]   = useState(false);
  const [drag, setDrag]           = useState(null);
  const [dropIdx, setDropIdx]     = useState(null);
  const cardRefs = useRef([]);
  const [svcLyricsModal,  setSvcLyricsModal]  = useState(null); // { song, text }
  const [svcLyricsSaving, setSvcLyricsSaving] = useState(false);

  if (!svc) return null;

  // Map from svc.songIds — keep raw index (i) for duplicate support
  const entries = (svc.songIds || []).map((id, i) => ({ id, song: songs.find(s => s.id === id) || null, i }));
  const totalCount = entries.filter(e => e.song).length;
  // valid-only list — index here = what PDFViewerScreen uses for navigation
  const validEntries = entries.filter(e => e.song);

  const leader = isLeader(user.role);
  const svcNotifCount = (notifs || []).filter(n => n.serviceId === svc.id).length;

  const saveSvcLyrics = async () => {
    setSvcLyricsSaving(true);
    await updateDoc(doc(db, "songs", svcLyricsModal.song.id), { lyrics: svcLyricsModal.text });
    setSvcLyricsSaving(false);
    setSvcLyricsModal(null);
  };

  const downloadSvcProFile = () => {
    const title = svcLyricsModal.song.title;
    const body = `Title: ${title}.pro\n\n${svcLyricsModal.text.trim()}`;
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\\\/:*?"<>|]/g, "_")}.pro`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendNotif = async () => {
    if (!notifContent.trim()) return;
    setNotifSending(true);
    const typeLabel = notifType;
    const title = `[${typeLabel}] ${svc.title}`;
    const body  = notifContent.trim();
    await addDoc(collection(db, "notifications"), {
      type: typeLabel, content: body,
      title, body,
      createdAt: serverTimestamp(), readBy: [], serviceId: svc.id,
      serviceDate: svc.date || "", serviceTitle: svc.title || "",
      senderRole: user.role || "leader",
    });
    sendFcmPush(title, body);
    setNotifContent("");
    setNotifType("예배 악보");
    setNotifSending(false);
    setShowNotifModal(false);
  };

  const shareToKakao = () => {
    const songLines = entries
      .filter(e => e.song)
      .map((e, idx) => `${idx + 1}. ${e.song.title}`)
      .join("\n");
    const sep = "─".repeat(9);
    const isFirst = !(svc.shareCount > 0);
    const footer = isFirst
      ? "예배 악보가 등록 되었어요. 연습을 준비해 주세요!"
      : "예배 악보가 업데이트 되었어요.";
    const text = `📋 ${svc.title}\n\n📅 ${svc.date}${svc.time ? " · " + svc.time : ""}\n${sep}\n${songLines}\n${sep}\n${footer}\n\n🎵 Ainos 앱에서 확인하세요`;
    const doCount = () => updateDoc(doc(db, "services", svc.id), { shareCount: increment(1) }).catch(() => {});

    if (window.Kakao?.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: "text",
        text,
        link: { mobileWebUrl: window.location.origin, webUrl: window.location.origin },
      });
      doCount();
    } else {
      navigator.clipboard?.writeText(text)
        .then(() => { alert("메시지가 복사됐습니다. 카카오톡에 붙여넣기 해주세요."); doCount(); })
        .catch(() => alert("클립보드 복사에 실패했습니다."));
    }
  };

  const [memoBlockModal, setMemoBlockModal] = useState(null); // { song, notes }

  const removeSong = async (idx) => {
    const song = entries[idx]?.song;
    if (song) {
      const addedAt = (svc.songAddedAt || {})[song.id];
      const allTeamNotes = (teamAnnotations || {})[song.id] || [];
      const relevantNotes = addedAt
        ? allTeamNotes.filter(n => {
            const created = n.createdAt?.toDate?.() || (n.createdAt ? new Date(n.createdAt) : null);
            return created && created >= new Date(addedAt);
          })
        : allTeamNotes;
      if (relevantNotes.length > 0) {
        setMemoBlockModal({ song, notes: relevantNotes });
        return;
      }
    }
    const newIds = (svc.songIds || []).filter((_, i) => i !== idx);
    const newAddedAt = { ...(svc.songAddedAt || {}) };
    if (song) delete newAddedAt[song.id];
    await updateDoc(doc(db, "services", svc.id), { songIds: newIds, songAddedAt: newAddedAt });
  };

  const duplicateSong = async (idx) => {
    const ids = [...(svc.songIds || [])];
    ids.splice(idx + 1, 0, ids[idx]); // insert copy right after
    await updateDoc(doc(db, "services", svc.id), { songIds: ids });
  };

  const reorder = async (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const ids = [...(svc.songIds || [])];
    const [item] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, item);
    await updateDoc(doc(db, "services", svc.id), { songIds: ids });
  };

  const saveSongs = async (ids) => {
    const prevIds = svc.songIds || [];
    const prevAddedAt = svc.songAddedAt || {};
    const now = new Date().toISOString();
    const newAddedAt = { ...prevAddedAt };
    ids.forEach(id => {
      if (!prevIds.includes(id)) newAddedAt[id] = now;
    });
    // clean up removed songs
    Object.keys(newAddedAt).forEach(id => {
      if (!ids.includes(id)) delete newAddedAt[id];
    });
    await updateDoc(doc(db, "services", svc.id), { songIds: ids, songAddedAt: newAddedAt });
    setShowPicker(false);
  };

  // ── Drag handlers
  const onHandleDown = (e, idx) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ fromIdx: idx, startY: e.clientY, curY: e.clientY });
    setDropIdx(idx);
  };
  const onHandleMove = (e) => {
    if (!drag) return;
    const curY = e.clientY;
    setDrag(d => ({ ...d, curY }));
    // Find drop position from card midpoints
    let di = entries.length - 1;
    for (let i = 0; i < entries.length; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (curY < rect.top + rect.height / 2) { di = i; break; }
    }
    setDropIdx(di);
  };
  const onHandleUp = async () => {
    if (drag && dropIdx !== null) await reorder(drag.fromIdx, dropIdx);
    setDrag(null); setDropIdx(null);
  };

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.bg, overflow:"hidden" }}>
      {/* 헤더 — 고정 */}
      <div style={{ flexShrink:0, background:C.surf, padding:"18px 16px",
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={() => nav("services")}
          style={{ background:"none", border:"none", color:C.acc, cursor:"pointer",
            padding:4, display:"flex", alignItems:"center", gap:4 }}>
          <Icon n="back" size={18} color={C.acc} />
        </button>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:17 }}>
            {new Date(svc.date + "T00:00:00").toLocaleDateString("ko-KR",
              { month:"long", day:"numeric", weekday:"short" })}
          </div>
          <div style={{ fontSize:12, color:C.dim, marginTop:1 }}>
            {svc.title}{svc.time ? ` · ${svc.time}` : ""}
          </div>
        </div>
        {leader && (
          <button onClick={() => setShowPicker(true)} title="곡 추가" style={{
            width:36, height:36, borderRadius:9, cursor:"pointer",
            background:`${C.acc}18`, border:`1px solid ${C.acc}66`,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>
            <Icon n="plus" size={18} color={C.acc} />
          </button>
        )}
        {leader && (
          <button onClick={() => setShowEdit(true)} title="예배 수정" style={{
            width:36, height:36, borderRadius:9, cursor:"pointer",
            background:C.card, border:`1px solid ${C.bdr}`,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>
            <Icon n="pen" size={18} color={C.dim} />
          </button>
        )}
        {leader && (
          <button onClick={shareToKakao} title="카카오톡 공유" style={{
            width:36, height:36, borderRadius:9, cursor:"pointer", position:"relative",
            background:"#FEE500", border:`1px solid #FEE500`,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>
            <Icon n="send" size={18} color="#3C1E1E" />
            {svc.shareCount > 0 && (
              <span style={{
                position:"absolute", top:-5, right:-5,
                minWidth:15, height:15, padding:"0 3px",
                background:C.red, borderRadius:8, border:"2px solid #FEE500",
                fontSize:9, fontWeight:700, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                lineHeight:1, boxSizing:"border-box",
              }}>
                {svc.shareCount}
              </span>
            )}
          </button>
        )}
        {leader && (
          <button onClick={() => setShowNotifModal(true)} title="팀 알림 보내기" style={{
            width:36, height:36, borderRadius:9, cursor:"pointer", position:"relative",
            background:C.pur, border:`1px solid ${C.pur}`,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>
            <Icon n="bell" size={18} color="#fff" />
            {svcNotifCount > 0 && (
              <span style={{
                position:"absolute", top:-5, right:-5,
                minWidth:15, height:15, padding:"0 3px",
                background:C.acc, borderRadius:8, border:`2px solid ${C.pur}`,
                fontSize:9, fontWeight:700, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                lineHeight:1, boxSizing:"border-box",
              }}>
                {svcNotifCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* 스크롤 영역 */}
      <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>

      <div style={{ padding:16, paddingBottom:90 }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:10 }}>
          예배 곡 순서 · {totalCount}곡
          {leader && <span style={{ fontSize:10, color:C.dim, fontWeight:500,
            marginLeft:6, textTransform:"none" }}>≡ 드래그로 순서 변경</span>}
        </div>

        {totalCount === 0 && (
          <div style={{ textAlign:"center", padding:"40px 0", color:C.dim }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🎵</div>
            <div style={{ fontWeight:600, marginBottom:4 }}>곡이 없습니다</div>
            <div style={{ fontSize:13 }}>헤더의 "라이브러리에서 곡 추가" 버튼으로 추가하세요</div>
          </div>
        )}

        {entries.map(({ id, song, i }) => {
          if (!song) return null;
          const teamNotes = (teamAnnotations || {})[song.id] || [];
          const isDragging = drag?.fromIdx === i;
          const dy = isDragging ? drag.curY - drag.startY : 0;
          const isDropTarget = !isDragging && dropIdx === i && drag !== null;
          // visible order index (among found songs only)
          const visIdx = entries.slice(0, i + 1).filter(e => e.song).length;
          return (
            <div key={`${id}_${i}`} ref={el => cardRefs.current[i] = el}
              style={{ position:"relative" }}>
              {/* Drop indicator line */}
              {isDropTarget && (
                <div style={{
                  height:3, borderRadius:2, background:C.acc,
                  margin:"0 0 4px", transition:"none",
                }} />
              )}
              <div className="wFadeIn" style={{
                background:C.surf, borderRadius:14, padding:"14px 16px",
                marginBottom:8, border:`1px solid ${isDragging ? C.acc : C.bdr}`,
                boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,.18)" : "0 1px 4px rgba(0,0,0,.05)",
                transform: isDragging ? `translateY(${dy}px)` : "none",
                transition: isDragging ? "none" : "transform 0.15s",
                opacity: isDragging ? 0.88 : 1,
                zIndex: isDragging ? 20 : 1,
                position:"relative",
                touchAction:"none",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  {/* 드래그 핸들 + 번호 (리더만) */}
                  {leader ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                      gap:2, flexShrink:0 }}>
                      <div
                        onPointerDown={e => onHandleDown(e, i)}
                        onPointerMove={onHandleMove}
                        onPointerUp={onHandleUp}
                        onPointerCancel={onHandleUp}
                        style={{
                          cursor:"grab", touchAction:"none", userSelect:"none",
                          fontSize:16, color:C.dim, lineHeight:1,
                          padding:"4px 6px", borderRadius:6,
                          background: isDragging ? `${C.acc}18` : "transparent",
                        }}>≡</div>
                      <div style={{
                        width:26, height:22, borderRadius:7,
                        background:`linear-gradient(135deg, ${C.acc}33, ${C.pur}22)`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontWeight:800, fontSize:12, color:C.acc,
                      }}>{visIdx}</div>
                    </div>
                  ) : (
                    <div style={{
                      width:34, height:34, borderRadius:10, flexShrink:0,
                      background:`linear-gradient(135deg, ${C.acc}33, ${C.pur}22)`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontWeight:800, fontSize:15, color:C.acc,
                    }}>{visIdx}</div>
                  )}

                  {/* 곡 정보 */}
                  <div style={{ flex:1, minWidth:0, cursor:"pointer" }}
                    onClick={() => !drag && nav("pdfViewer", {
                      songId: song.id,
                      svcSongIdx: validEntries.findIndex(e => e.i === i),
                      backTo: "svcDetail",
                    })}>
                    <div style={{ fontWeight:700, fontSize:15, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{song.title}</div>
                    <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>
                      {song.artist}{song.bpm ? ` · ♩${song.bpm}` : ""}
                    </div>
                    <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap", alignItems:"center" }}>
                      <KeyBadge k={song.key} />
                      {song.pdfUrl && <Badge label={song.pdfPage > 1 ? `PDF · 페이지${song.pdfPage}` : "PDF"} color={C.grn} />}
                      {!song.pdfUrl && song.imageUrl && <Badge label="🖼️ 이미지" color={C.acc} />}
                      {leader && (
                        <button onClick={e => { e.stopPropagation(); setSvcLyricsModal({ song, text: song.lyrics || "" }); }}
                          style={{ background: song.lyrics ? `${C.grn}22` : `${C.pur}12`,
                            border:`1px solid ${song.lyrics ? C.grn+"55" : C.pur+"33"}`,
                            borderRadius:5, cursor:"pointer", padding:"1px 7px",
                            fontSize:10, fontWeight:700,
                            color: song.lyrics ? C.grn : C.dim, fontFamily:"inherit",
                            display:"flex", alignItems:"center", gap:3 }}>
                          {song.lyrics ? "✓ 가사입력 완료" : "📝 가사"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 복사·삭제 (리더만) */}
                  {leader && (
                    <div style={{ display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>
                      <button onClick={() => duplicateSong(i)} style={{
                        background:`${C.pur}15`, border:`1px solid ${C.pur}44`,
                        borderRadius:7, cursor:"pointer", padding:"4px 8px",
                        fontSize:11, fontWeight:700, color:C.pur, fontFamily:"inherit",
                      }}>복사</button>
                      <button onClick={() => removeSong(i)} style={{
                        background:"none", border:"none", cursor:"pointer",
                        padding:4, display:"flex", justifyContent:"center",
                      }}>
                        <Icon n="xmark" size={16} color={C.dim} />
                      </button>
                    </div>
                  )}
                </div>

                {/* 팀 메모 전체 */}
                {teamNotes.length > 0 && (
                  <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:6 }}>
                    {teamNotes.map((m, mi) => {
                      const authorName = m.authorName || (userMap || {})[m.userId] || "팀원";
                      return (
                        <div key={mi} style={{
                          padding:"7px 10px", borderRadius:8,
                          background:"#e5393510", border:"1px solid #e5393530",
                        }}>
                          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                            <Icon n="users" size={10} color="#e53935" sw={2.5} />
                            <span style={{ fontSize:11, fontWeight:700, color:"#e53935" }}>{authorName}</span>
                          </div>
                          <div style={{ fontSize:12, color:C.txt, lineHeight:1.5 }}>{m.text}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 팀메모 차단 모달 ───────────────────────────────────────── */}
      {memoBlockModal && (
        <Modal title="악보를 삭제할 수 없습니다" onClose={() => setMemoBlockModal(null)}>
          <div style={{ padding:"0 4px 8px" }}>
            <div style={{ fontSize:13, color:C.txt, marginBottom:14, lineHeight:1.6 }}>
              <strong style={{ color:C.red }}>"{memoBlockModal.song.title}"</strong>에 작성된 팀 메모가 있습니다.
              메모 작성자가 먼저 메모를 삭제해야 이 악보를 예배에서 제거할 수 있습니다.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
              {[...new Map(memoBlockModal.notes.map(n => [n.userId, n])).values()].map(n => {
                const name = n.authorName || (userMap || {})[n.userId] || "팀원";
                const count = memoBlockModal.notes.filter(m => m.userId === n.userId).length;
                return (
                  <div key={n.userId} style={{
                    display:"flex", alignItems:"center", gap:8,
                    padding:"8px 12px", borderRadius:8,
                    background:"#e5393510", border:"1px solid #e5393530",
                  }}>
                    <Icon n="users" size={13} color="#e53935" sw={2.5} />
                    <span style={{ fontSize:13, fontWeight:700, color:"#e53935", flex:1 }}>{name}</span>
                    <span style={{ fontSize:12, color:C.dim }}>메모 {count}개</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize:12, color:C.dim, lineHeight:1.6, padding:"8px 10px",
              background:C.bg, borderRadius:8, border:`1px solid ${C.bdr}` }}>
              💡 악보를 열고 메모 패널에서 본인 메모를 삭제한 후 다시 시도하세요.
            </div>
          </div>
        </Modal>
      )}

      {/* 가사 편집 + .pro 다운로드 모달 (서비스 화면) */}
      {svcLyricsModal && (
        <Modal title={`가사 — ${svcLyricsModal.song.title}`} onClose={() => setSvcLyricsModal(null)}>
          <div style={{ padding:"0 4px 8px" }}>
            <div style={{ fontSize:11, color:C.dim, marginBottom:8, lineHeight:1.5 }}>
              절/단락을 빈 줄로 구분하세요. 각 단락이 ProPresenter 슬라이드 한 장이 됩니다.
            </div>
            <textarea
              value={svcLyricsModal.text}
              onChange={e => setSvcLyricsModal(prev => ({ ...prev, text: e.target.value }))}
              placeholder={"첫째 줄 가사\n둘째 줄 가사\n\n두 번째 절 첫째 줄\n두 번째 절 둘째 줄"}
              style={{ width:"100%", height:280, boxSizing:"border-box",
                background:C.bg, border:`1px solid ${C.bdr}`, borderRadius:8,
                padding:"10px 12px", fontSize:13, color:C.txt, resize:"vertical",
                fontFamily:"inherit", lineHeight:1.8, outline:"none" }}
            />
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <button onClick={downloadSvcProFile}
                style={{ flex:1, padding:"10px 0", borderRadius:9, cursor:"pointer",
                  background:`${C.grn}22`, border:`1px solid ${C.grn}55`,
                  color:C.grn, fontSize:13, fontWeight:700, fontFamily:"inherit",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                <Icon n="download" size={14} color={C.grn} />
                .pro 다운로드
              </button>
              <button onClick={saveSvcLyrics} disabled={svcLyricsSaving}
                style={{ flex:1, padding:"10px 0", borderRadius:9, cursor:"pointer",
                  background: svcLyricsSaving ? C.bdr : C.acc,
                  border:`1px solid ${svcLyricsSaving ? C.bdr : C.acc}`,
                  color:"#fff", fontSize:13, fontWeight:700, fontFamily:"inherit" }}>
                {svcLyricsSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      </div>{/* /스크롤 영역 */}

      {showPicker && (
        <SongPickerModal songs={songs} currentIds={svc.songIds || []}
          onClose={() => setShowPicker(false)} onSave={saveSongs}
          addSong={addSong} user={user} />
      )}
      {showEdit && (
        <EditServiceModal svc={svc} onClose={() => setShowEdit(false)} onSave={onUpdateService} />
      )}
      {showNotifModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:2000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}
          onClick={e => { if (e.target === e.currentTarget) setShowNotifModal(false); }}>
          <div style={{ background:C.surf, borderRadius:16, padding:20,
            width:"100%", maxWidth:440 }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
              <div style={{ flex:1, fontWeight:700, fontSize:16 }}>알림 보내기</div>
              <button onClick={() => setShowNotifModal(false)}
                style={{ background:"none", border:"none", cursor:"pointer", padding:6 }}>
                <Icon n="xmark" size={20} color={C.dim} />
              </button>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.dim, fontWeight:600, marginBottom:6 }}>알림 타입</div>
              <select value={notifType} onChange={e => setNotifType(e.target.value)}
                style={{ width:"100%", padding:"10px 12px", borderRadius:10,
                  border:`1px solid ${C.bdr}`, background:C.card, fontSize:14,
                  color:C.txt, fontFamily:"inherit", outline:"none" }}>
                <option>예배 악보</option>
                <option>참고</option>
                <option>공지</option>
              </select>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, color:C.dim, fontWeight:600, marginBottom:6 }}>알림 내용</div>
              <textarea value={notifContent} onChange={e => setNotifContent(e.target.value)}
                placeholder="팀원에게 전달할 내용을 입력하세요..."
                rows={4}
                style={{ width:"100%", padding:"10px 12px", borderRadius:10,
                  border:`1px solid ${C.bdr}`, background:C.card, fontSize:14,
                  color:C.txt, fontFamily:"inherit", outline:"none", resize:"none",
                  boxSizing:"border-box" }} />
            </div>
            <button onClick={sendNotif} disabled={notifSending || !notifContent.trim()}
              style={{ width:"100%", padding:"13px 0", borderRadius:12,
                background: (!notifContent.trim() || notifSending) ? C.bdr : C.pur,
                border:"none", color:"#fff", fontWeight:700, fontSize:15,
                cursor: (!notifContent.trim() || notifSending) ? "default" : "pointer",
                fontFamily:"inherit" }}>
              {notifSending ? "전송 중..." : "알림 보내기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PDF PAGE PICKER MODAL  (편집 중 멀티페이지 PDF에서 페이지 선택)
══════════════════════════════════════════════════════════════════ */
function PdfPagePickerModal({ file, songTitle, onConfirm, onClose }) {
  const [thumbnails, setThumbnails] = useState([]); // data URLs
  const [selected,   setSelected]   = useState(1);
  const [rendering,  setRendering]  = useState(true);
  const [numPages,   setNumPages]   = useState(0);

  useEffect(() => {
    if (!file || !window.pdfjsLib) return;
    let cancelled = false;
    (async () => {
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      const n = pdf.numPages;
      if (!cancelled) setNumPages(n);
      const thumbs = [];
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const vp   = page.getViewport({ scale: 0.35 });
        const cvs  = document.createElement("canvas");
        cvs.width  = vp.width;
        cvs.height = vp.height;
        await page.render({ canvasContext: cvs.getContext("2d"), viewport: vp }).promise;
        thumbs.push(cvs.toDataURL("image/jpeg", 0.7));
        if (!cancelled) setThumbnails([...thumbs]);
      }
      if (!cancelled) setRendering(false);
    })().catch(e => { console.error(e); if (!cancelled) setRendering(false); });
    return () => { cancelled = true; };
  }, [file]);

  return (
    <Modal title="페이지 선택" onClose={onClose}>
      <div style={{ fontSize:13, color:C.dim, marginBottom:12, lineHeight:1.6 }}>
        <strong>"{songTitle}"</strong>에 사용할 페이지를 선택하세요.
        {numPages > 0 && <span style={{ marginLeft:6, color:C.dim }}>({numPages}페이지)</span>}
      </div>

      {rendering && thumbnails.length === 0 ? (
        <div style={{ textAlign:"center", padding:"30px 0", color:C.dim, fontSize:13 }}>
          미리보기 생성 중...
        </div>
      ) : (
        <div style={{
          display:"flex", flexDirection:"column",
          gap:10, maxHeight:420, overflowY:"auto",
          padding:"4px 2px",
        }}>
          {thumbnails.map((src, i) => {
            const pg = i + 1;
            const isSelected = selected === pg;
            return (
              <div key={i} onClick={() => setSelected(pg)} style={{
                display:"flex", alignItems:"center", gap:12,
                borderRadius:12, cursor:"pointer", padding:"10px 12px",
                border:`2px solid ${isSelected ? C.acc : C.bdr}`,
                background: isSelected ? `${C.acc}0d` : C.card,
                transition:"all .15s",
              }}>
                {/* 썸네일 */}
                <div style={{
                  flexShrink:0, width:60,
                  borderRadius:6, overflow:"hidden",
                  border:`1px solid ${C.bdr}`,
                  boxShadow:"0 2px 6px rgba(0,0,0,.12)",
                }}>
                  <img src={src} alt={`p.${pg}`} style={{ width:"100%", display:"block" }} />
                </div>
                {/* 페이지 번호 */}
                <div style={{ flex:1 }}>
                  <div style={{
                    fontSize:14, fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? C.acc : C.txt,
                  }}>페이지 {pg}</div>
                  {isSelected && (
                    <div style={{ fontSize:11, color:C.acc, marginTop:2 }}>✓ 선택됨</div>
                  )}
                </div>
                {/* 라디오 */}
                <div style={{
                  width:20, height:20, borderRadius:"50%", flexShrink:0,
                  border:`2px solid ${isSelected ? C.acc : C.bdr}`,
                  background: isSelected ? C.acc : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  {isSelected && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                </div>
              </div>
            );
          })}
          {/* 렌더링 중 플레이스홀더 */}
          {rendering && Array.from({ length: numPages - thumbnails.length }, (_, i) => (
            <div key={`ph-${i}`} style={{
              display:"flex", alignItems:"center", gap:12,
              borderRadius:12, padding:"10px 12px",
              border:`2px solid ${C.bdr}`, background:C.card, opacity:0.5,
            }}>
              <div style={{
                flexShrink:0, width:60, aspectRatio:"0.7",
                borderRadius:6, background:C.bdr,
              }} />
              <div style={{ fontSize:14, color:C.dim }}>
                페이지 {thumbnails.length + i + 1}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <Btn label="취소" variant="ghost" full onClick={onClose} />
        <Btn
          label={selected ? `페이지 ${selected} 사용` : "선택하세요"}
          full
          disabled={!selected || rendering}
          onClick={() => onConfirm(selected)}
        />
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SONG LIBRARY SCREEN
══════════════════════════════════════════════════════════════════ */
function SongLibraryScreen({ user, songs, addSong, nav, teamAnnotations, annotations, userMap, songDrawings }) {
  const [query,      setQuery]      = useState("");
  const [showAdd,    setShowAdd]    = useState(false);
  const [uploading,     setUploading]     = useState(null);
  const [confirmDel,    setConfirmDel]    = useState(null);
  const [editSong,      setEditSong]      = useState(null);
  const [editForm,      setEditForm]      = useState({});
  const [pagePicker,    setPagePicker]    = useState(null);
  const [cropSong,      setCropSong]      = useState(null); // { id, pdfUrl, imageUrl, cropBox }
  const [imgUploading,  setImgUploading]  = useState(null);
  const [consonant,     setConsonant]     = useState("");
  const [memoReplaceModal, setMemoReplaceModal] = useState(null); // { song, othersNotes, ownNotes, pendingUpload }
  const [lyricsModal,  setLyricsModal]  = useState(null); // { song, text }
  const [lyricsSaving, setLyricsSaving] = useState(false);

  const checkMemoBeforeReplace = (song) => {
    const teamNotes = (teamAnnotations || {})[song.id] || [];
    const personalNotes = (annotations || {})[song.id] || [];
    const draws = (songDrawings || {})[song.id] || {};
    const drawAuthors = [];
    if (draws.my)     drawAuthors.push({ userId: user.uid, authorName: "나",        _type: "draw" });
    if (draws.team)   drawAuthors.push({ userId: "TEAM",   authorName: "팀 필기",   _type: "draw" });
    if (draws.others) drawAuthors.push({ userId: "OTHERS", authorName: "팀원 필기", _type: "draw" });
    const allNotes = [...teamNotes, ...personalNotes];
    const combined = [...allNotes, ...drawAuthors];
    if (combined.length > 0) {
      const authorSet = [...new Map(combined.map(n => [n.userId, n])).values()];
      setMemoReplaceModal({ song, authorSet, allNotes: combined });
      return true;
    }
    return false;
  };

  const CONSONANTS = ["ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ","A"];

  const getConsonant = (title) => {
    if (!title) return "#";
    const ch = title[0];
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const INITIALS = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
      const GROUPS   = {"ㄲ":"ㄱ","ㄸ":"ㄷ","ㅃ":"ㅂ","ㅆ":"ㅅ","ㅉ":"ㅈ"};
      const init = INITIALS[Math.floor((code - 0xAC00) / (21 * 28))];
      return GROUPS[init] || init;
    }
    if (/[A-Za-z]/.test(ch)) return "A";
    return "#";
  };

  const filtered = songs
    .filter(s => {
      const q = query.toLowerCase();
      const matchQ = !q ||
        s.title.toLowerCase().includes(q) ||
        (s.artist || "").toLowerCase().includes(q) ||
        (s.key || "").toLowerCase().includes(q);
      const matchC = !consonant || getConsonant(s.title) === consonant;
      return matchQ && matchC;
    })
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));

  const handleUpload = async (e, songId) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    await proceedUpload(songId, file);
  };

  const proceedUpload = async (songId, file) => {
    // 멀티페이지 PDF이면 페이지 선택 모달
    if (window.pdfjsLib) {
      try {
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        if (pdf.numPages > 1) {
          setPagePicker({ songId, file });
          return;
        }
      } catch { /* pdfjsLib 오류 → 그냥 업로드 */ }
    }
    await doUpload(songId, file, 1);
  };

  const doUpload = async (songId, file, pageNum) => {
    setUploading(songId);
    try {
      const url = await uploadPdf(file, songId);
      await updateDoc(doc(db, "songs", songId), { pdfUrl: url, pdfPage: pageNum });
    } catch (err) {
      alert("업로드 실패: " + err.message);
    } finally {
      setUploading(null);
    }
  };

  const handleImgUpload = async (e, songId) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setImgUploading(songId);
    try {
      const url = await uploadImage(file, songId);
      await updateDoc(doc(db, "songs", songId), { imageUrl: url });
    } catch (err) {
      alert("이미지 업로드 실패: " + err.message);
    } finally {
      setImgUploading(null);
    }
  };

  const saveLyrics = async () => {
    setLyricsSaving(true);
    await updateDoc(doc(db, "songs", lyricsModal.song.id), { lyrics: lyricsModal.text });
    setLyricsSaving(false);
    setLyricsModal(null);
  };

  const downloadProFile = () => {
    const title = lyricsModal.song.title;
    const body = `Title: ${title}.pro\n\n${lyricsModal.text.trim()}`;
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\\\/:*?"<>|]/g, "_")}.pro`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveEdit = async () => {
    if (!editSong) return;
    await updateDoc(doc(db, "songs", editSong.id), {
      title:      editForm.title.trim(),
      artist:     editForm.artist.trim(),
      key:        editForm.key.trim(),
      bpm:        Number(editForm.bpm) || 0,
      timeSig:    editForm.timeSig?.trim() || "4/4",
      youtubeUrl: editForm.youtubeUrl?.trim() || "",
    });
    setEditSong(null);
  };

  return (
    <div style={{ height:"100%", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* 고정 헤더 */}
      <div style={{ background:C.surf, flexShrink:0,
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ padding:"0 16px 10px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>악보 라이브러리</div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {isLeader(user.role) && (
              <button onClick={() => setShowAdd(true)} title="곡 추가" style={{
                width:36, height:36, borderRadius:9, cursor:"pointer",
                background:`${C.acc}18`, border:`1px solid ${C.acc}66`,
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
              }}>
                <Icon n="plus" size={18} color={C.acc} />
              </button>
            )}
          </div>
        </div>
        <div style={{ padding:"0 16px 12px", position:"relative" }}>
          <div style={{ position:"absolute", left:28, top:"50%", transform:"translateY(-50%)" }}>
            <Icon n="search" size={16} color={C.dim} />
          </div>
          <input value={query} onChange={e => { setQuery(e.target.value); setConsonant(""); }}
            placeholder="곡명, 아티스트, 키 검색..."
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
            style={{
              width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
              color:C.txt, padding:"9px 14px 9px 38px", borderRadius:10,
              fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box",
            }} />
        </div>
      </div>

      {/* 리스트 + 자음 인덱스 */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", position:"relative" }}>
        {/* 곡 목록 (스크롤) */}
        <div style={{ flex:1, overflowY:"auto", padding:"12px 52px 90px 16px" }}>
          {filtered.length === 0 && (
            <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🎵</div>
              <div>{query || consonant ? "검색 결과가 없습니다" : "등록된 곡이 없습니다"}</div>
            </div>
          )}
          {filtered.map(song => (
            <div key={song.id} className="wFadeIn" style={{
              background:C.card, borderRadius:14, padding:"13px 16px",
              marginBottom:8, border:`1px solid ${C.bdr}`,
              display:"flex", alignItems:"center", gap:12,
            }}>
              <div style={{
                width:46, height:46, borderRadius:11, flexShrink:0,
                background: song.pdfUrl
                  ? `linear-gradient(135deg, ${C.grn}33, ${C.grn}15)`
                  : song.imageUrl
                  ? `linear-gradient(135deg, ${C.acc}33, ${C.acc}15)`
                  : `linear-gradient(135deg, ${keyColor(song.key)}44, ${C.pur}44)`,
                border:`1px solid ${song.pdfUrl ? C.grn+"44" : song.imageUrl ? C.acc+"44" : keyColor(song.key)+"44"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:22,
              }}>{song.pdfUrl ? "📄" : song.imageUrl ? "🖼️" : "🎵"}</div>

              <div style={{ flex:1, minWidth:0, cursor:"pointer" }}
                onClick={() => nav("pdfViewer", { songId: song.id, svcId: null, backTo: "library" })}>
                <div style={{ fontWeight:700, fontSize:14, letterSpacing:"-0.01em",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {song.title}
                </div>
                <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>{song.artist}</div>
                <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                  <KeyBadge k={song.key} />
                  <Badge label={`♩ ${song.bpm}`} color={C.dim} />
                  {song.pdfUrl && <Badge label={song.pdfPage > 1 ? `PDF · 페이지${song.pdfPage}` : "PDF"} color={C.grn} />}
                  {song.imageUrl && !song.pdfUrl && <Badge label="이미지" color={C.acc} />}
                  {(() => {
                    const tNotes = (teamAnnotations || {})[song.id] || [];
                    const pNotes = (annotations || {})[song.id] || [];
                    const all = [...tNotes, ...pNotes];
                    const draws = (songDrawings || {})[song.id] || {};
                    if (!all.length && !draws.my && !draws.team && !draws.others) return null;
                    const authorMap = new Map();
                    [...tNotes, ...pNotes].forEach(n => {
                      const name = n.userId === user.uid ? "나" : (n.authorName || (userMap||{})[n.userId] || "팀원");
                      const entry = authorMap.get(n.userId) || { name, cnt: 0 };
                      entry.cnt++;
                      authorMap.set(n.userId, entry);
                    });
                    const parts = [];
                    authorMap.forEach(({ name, cnt }) => parts.push(`${name} 메모 ${cnt}개`));
                    if (draws.my) parts.push("내 필기");
                    if (draws.team) parts.push("팀 필기");
                    if (draws.others) parts.push("팀원 필기");
                    return (
                      <span style={{
                        display:"flex", alignItems:"center", gap:3,
                        background:"#e5393514", border:"1px solid #e5393535",
                        borderRadius:5, padding:"1px 6px", fontSize:10, fontWeight:700, color:"#e53935",
                      }}>
                        <Icon n="users" size={9} color="#e53935" sw={2.5} />
                        {parts.join(" · ")}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {isLeader(user.role) && (
                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  {(uploading === song.id || imgUploading === song.id) ? (
                    <div style={{ fontSize:11, color:C.acc, padding:"0 6px" }}>업로드 중...</div>
                  ) : (
                    <>
                      <button onClick={() => { setEditSong(song); setEditForm({ title: song.title, artist: song.artist || "", key: song.key || "", bpm: song.bpm || "", timeSig: song.timeSig || "4/4", youtubeUrl: song.youtubeUrl || "" }); }}
                        title="편집"
                        style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          width:34, height:34, borderRadius:9, cursor:"pointer",
                          background:`${C.acc}22`, border:`1px solid ${C.acc}55` }}>
                        <Icon n="pen" size={14} color={C.acc} />
                      </button>
                      <button onClick={() => setLyricsModal({ song, text: song.lyrics || "" })}
                        title={song.lyrics ? "가사입력 완료 — 클릭하여 편집" : "가사 편집 / .pro 다운로드"}
                        style={{ display:"flex", alignItems:"center", gap:4,
                          height:34, borderRadius:9, cursor:"pointer",
                          padding: song.lyrics ? "0 10px" : "0",
                          width: song.lyrics ? "auto" : 34,
                          justifyContent:"center",
                          background: song.lyrics ? `${C.grn}22` : `${C.pur}12`,
                          border:`1px solid ${song.lyrics ? C.grn+"66" : C.pur+"33"}` }}>
                        <Icon n="note" size={14} color={song.lyrics ? C.grn : C.dim} />
                        {song.lyrics && <span style={{ fontSize:11, fontWeight:700, color:C.grn, fontFamily:"inherit", whiteSpace:"nowrap" }}>가사입력 완료</span>}
                      </button>
                      {(song.pdfUrl || song.imageUrl) && (
                        <button onClick={() => setCropSong({ id: song.id, pdfUrl: song.pdfUrl || null, imageUrl: song.imageUrl || null, cropBox: song.cropBox || null })}
                          title="크롭 설정"
                          style={{ display:"flex", alignItems:"center", justifyContent:"center",
                            width:34, height:34, borderRadius:9, cursor:"pointer",
                            background: song.cropBox ? `${C.acc}22` : `${C.pur}12`,
                            border:`1px solid ${song.cropBox ? C.acc+"55" : C.pur+"33"}` }}>
                          <Icon n="fitCrop" size={14} color={song.cropBox ? C.acc : C.pur} />
                        </button>
                      )}
                      {/* PDF 업로드 — 클릭 시 메모 체크 후 파일 선택창 열기 */}
                      <input type="file" accept=".pdf,application/pdf"
                        style={{ display:"none" }} id={`up-${song.id}`}
                        onChange={e => handleUpload(e, song.id)} />
                      <button
                        onClick={() => {
                          if (!checkMemoBeforeReplace(song)) {
                            document.getElementById(`up-${song.id}`)?.click();
                          }
                        }}
                        title={song.pdfUrl ? "PDF 교체" : "PDF 업로드"}
                        style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          width:34, height:34, borderRadius:9, cursor:"pointer",
                          background: song.pdfUrl ? `${C.grn}22` : C.surf,
                          border:`1px solid ${song.pdfUrl ? C.grn : C.bdr}` }}>
                        <Icon n="upload" size={14} color={song.pdfUrl ? C.grn : C.dim} />
                      </button>
                      {/* 이미지 업로드 — 클릭 시 메모 체크 후 파일 선택창 열기 */}
                      <input type="file" accept="image/*"
                        style={{ display:"none" }} id={`img-${song.id}`}
                        onChange={e => handleImgUpload(e, song.id)} />
                      <button
                        onClick={() => {
                          if (!checkMemoBeforeReplace(song)) {
                            document.getElementById(`img-${song.id}`)?.click();
                          }
                        }}
                        title={song.imageUrl ? "이미지 교체" : "이미지 업로드"}
                        style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          width:34, height:34, borderRadius:9, cursor:"pointer",
                          background: song.imageUrl ? `${C.acc}22` : C.surf,
                          border:`1px solid ${song.imageUrl ? C.acc+"55" : C.bdr}` }}>
                        <span style={{ fontSize:14 }}>🖼️</span>
                      </button>
                      <button onClick={() => setConfirmDel(song.id)}
                        title="곡 삭제"
                        style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          width:34, height:34, borderRadius:9, cursor:"pointer",
                          background:`${C.red}11`, border:`1px solid ${C.red}33` }}>
                        <Icon n="trash" size={14} color={C.red} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 자음 인덱스 */}
        <div style={{
          position:"absolute", right:0, top:0, bottom:0, width:44,
          display:"flex", flexDirection:"column", alignItems:"center",
          justifyContent:"flex-start", gap:5, paddingTop:16,
        }}>
          <button onClick={() => setConsonant("")}
            style={{ fontSize:11, fontWeight:700, padding:"3px 0", border:"none",
              background: !consonant ? C.acc : "transparent",
              color: !consonant ? "#fff" : C.dim,
              borderRadius:5, cursor:"pointer", fontFamily:"inherit", width:34 }}>전체</button>
          {CONSONANTS.map(c => (
            <button key={c} onClick={() => setConsonant(prev => prev === c ? "" : c)}
              style={{ fontSize:13, fontWeight:700, padding:"3px 0", border:"none",
                background: consonant === c ? C.acc : "transparent",
                color: consonant === c ? "#fff" : C.dim,
                borderRadius:5, cursor:"pointer", fontFamily:"inherit", width:34 }}>{c}</button>
          ))}
        </div>
      </div>

      {/* 편집 모달 */}
      {editSong && (
        <Modal title="곡 정보 편집" onClose={() => setEditSong(null)}>
          {[
            { label:"곡명", key:"title", placeholder:"곡명" },
            { label:"아티스트", key:"artist", placeholder:"아티스트" },
            { label:"키 (Key)", key:"key", placeholder:"C, D, E, F, G, A, B..." },
            { label:"BPM", key:"bpm", placeholder:"120", type:"number" },
            { label:"박자", key:"timeSig", placeholder:"4/4, 3/4, 6/8..." },
            { label:"YouTube 링크", key:"youtubeUrl", placeholder:"https://youtu.be/..." },
          ].map(f => (
            <div key={f.key} style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.dim, marginBottom:4 }}>{f.label}</div>
              <input
                type={f.type || "text"}
                value={editForm[f.key] ?? ""}
                onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                style={{
                  width:"100%", background:C.card,
                  border:`1.5px solid ${f.key === "youtubeUrl" && getYoutubeId(editForm.youtubeUrl) ? C.grn : C.bdr}`,
                  color:C.txt, padding:"9px 12px", borderRadius:10,
                  fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box",
                }}
              />
              {f.key === "youtubeUrl" && getYoutubeId(editForm.youtubeUrl) && (
                <div style={{ fontSize:11, color:C.grn, marginTop:3 }}>✓ 유효한 YouTube 링크</div>
              )}
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:4 }}>
            <Btn label="취소" variant="ghost" full onClick={() => setEditSong(null)} />
            <Btn label="저장" full onClick={saveEdit} />
          </div>
        </Modal>
      )}

      {showAdd && (
        <AddSongModal onClose={() => setShowAdd(false)} onAdd={addSong} />
      )}

      {pagePicker && (
        <PdfPagePickerModal
          file={pagePicker.file}
          songTitle={songs.find(s => s.id === pagePicker.songId)?.title || ""}
          onClose={() => setPagePicker(null)}
          onConfirm={async (pageNum) => {
            const { songId, file } = pagePicker;
            setPagePicker(null);
            await doUpload(songId, file, pageNum);
          }}
        />
      )}

      {confirmDel && (() => {
        const s = songs.find(x => x.id === confirmDel);
        return (
          <Modal title="곡 삭제" onClose={() => setConfirmDel(null)}>
            <div style={{ fontSize:14, color:C.txt, marginBottom:20, lineHeight:1.7 }}>
              <strong>"{s?.title}"</strong>을(를) 라이브러리에서 삭제합니다.<br />
              <span style={{ fontSize:12, color:C.dim }}>예배 일정에서도 제거됩니다.</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <Btn label="취소" variant="ghost" full onClick={() => setConfirmDel(null)} />
              <Btn label="삭제" variant="danger" full onClick={async () => {
                await deleteDoc(doc(db, "songs", confirmDel));
                setConfirmDel(null);
              }} />
            </div>
          </Modal>
        );
      })()}

      {cropSong && (
        <CropModal
          pdfUrl={cropSong.pdfUrl}
          imageUrl={cropSong.imageUrl}
          initialCrop={cropSong.cropBox}
          onClose={() => setCropSong(null)}
          onConfirm={async (box) => {
            const songId = cropSong.id;
            setCropSong(null);
            await updateDoc(doc(db, "songs", songId), { cropBox: box || null });
          }}
        />
      )}

      {/* ── 악보 교체 메모 경고 모달 */}
      {memoReplaceModal && (() => {
        const { song, authorSet, allNotes, pendingUpload } = memoReplaceModal;
        return (
          <Modal title="악보를 교체할 수 없습니다" onClose={() => setMemoReplaceModal(null)}>
            <div style={{ padding:"0 4px 8px" }}>
              <div style={{ fontSize:13, color:C.txt, marginBottom:14, lineHeight:1.6 }}>
                <strong style={{ color:C.red }}>"{song.title}"</strong>에 메모 또는 필기가 있습니다.
                악보가 바뀌면 위치가 맞지 않아 사용할 수 없습니다.
                먼저 삭제한 후 교체하세요.
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                {authorSet.map(n => {
                  const name = n.authorName || (userMap || {})[n.userId] || "팀원";
                  const isMe = n.userId === user.uid;
                  const isDraw = n._type === "draw";
                  const memoCnt = allNotes.filter(m => m.userId === n.userId && !m._type).length;
                  return (
                    <div key={n.userId} style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"8px 12px", borderRadius:8,
                      background:"#e5393510", border:"1px solid #e5393530",
                    }}>
                      <Icon n="users" size={13} color="#e53935" sw={2.5} />
                      <span style={{ fontSize:13, fontWeight:700, color:"#e53935", flex:1 }}>
                        {isMe ? "나" : name}
                      </span>
                      <span style={{ fontSize:12, color:C.dim }}>
                        {isDraw ? (n.userId === "TEAM" ? "팀 필기" : "필기") : `메모 ${memoCnt}개`}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize:12, color:C.dim, lineHeight:1.6, padding:"8px 10px",
                background:C.bg, borderRadius:8, border:`1px solid ${C.bdr}` }}>
                💡 악보를 열어 메모/필기를 삭제하거나, 새 악보를 추가하세요.
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* 가사 편집 + .pro 다운로드 모달 */}
      {lyricsModal && (
        <Modal title={`가사 — ${lyricsModal.song.title}`} onClose={() => setLyricsModal(null)}>
          <div style={{ padding:"0 4px 8px" }}>
            <div style={{ fontSize:11, color:C.dim, marginBottom:8, lineHeight:1.5 }}>
              절/단락을 빈 줄로 구분해서 입력하세요. 각 단락이 ProPresenter 슬라이드 한 장이 됩니다.
            </div>
            <textarea
              value={lyricsModal.text}
              onChange={e => setLyricsModal(prev => ({ ...prev, text: e.target.value }))}
              placeholder={"첫째 줄 가사\n둘째 줄 가사\n\n두 번째 절 첫째 줄\n두 번째 절 둘째 줄"}
              style={{ width:"100%", height:280, boxSizing:"border-box",
                background:C.bg, border:`1px solid ${C.bdr}`, borderRadius:8,
                padding:"10px 12px", fontSize:13, color:C.txt, resize:"vertical",
                fontFamily:"inherit", lineHeight:1.8, outline:"none" }}
            />
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <button onClick={downloadProFile}
                style={{ flex:1, padding:"10px 0", borderRadius:9, cursor:"pointer",
                  background:`${C.grn}22`, border:`1px solid ${C.grn}55`,
                  color:C.grn, fontSize:13, fontWeight:700, fontFamily:"inherit",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                <Icon n="download" size={14} color={C.grn} />
                .pro 다운로드
              </button>
              <button onClick={saveLyrics} disabled={lyricsSaving}
                style={{ flex:1, padding:"10px 0", borderRadius:9, cursor:"pointer",
                  background: lyricsSaving ? C.bdr : C.acc,
                  border:`1px solid ${lyricsSaving ? C.bdr : C.acc}`,
                  color:"#fff", fontSize:13, fontWeight:700, fontFamily:"inherit" }}>
                {lyricsSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PDF VIEWER SCREEN
══════════════════════════════════════════════════════════════════ */

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

function RecordingsModal({ songId, songTitle, userGeminiKey, onClose }) {
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
    const key = userGeminiKey;
    if (!key) { alert("프로필에서 Gemini/Groq API 키를 먼저 설정해주세요"); return; }
    setAnalyzing(rec.id);
    try {
      const result = await analyzeWithGemini(rec.blob, key);
      await (async () => {
        const db = await openRecDB();
        await new Promise((res, rej) => {
          const tx = db.transaction("recordings", "readwrite");
          const store = tx.objectStore("recordings");
          const gr = store.get(rec.id);
          gr.onsuccess = () => {
            const updated = { ...gr.result, aiAnalysis: result };
            const pr = store.put(updated);
            pr.onsuccess = res; pr.onerror = e => rej(e.target.error);
          };
          gr.onerror = e => rej(e.target.error);
        });
      })();
      setRecs(p => p.map(r => r.id === rec.id ? { ...r, aiAnalysis: result } : r));
    } catch(e) {
      alert("AI 분석 실패: " + e.message);
    }
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
                <div style={{ fontSize:11, color:C.dim }}>{fmt(rec.duration || 0)} · {fmtSize(rec.size || 0)} · {rec.pageNum}페이지</div>
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
                  {rec.aiAnalysis}
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

function PDFViewerScreen({ user, songs, services, annotations, teamAnnotations, onAddAnnotation, onDeleteAnnotation, nav, selectedSongId, selectedSvcId, selectedSvcSongIdx, backTo, pdfjsReady, sharedGeminiKey }) {
  const song = songs.find(s => s.id === selectedSongId);
  const isLibraryMode = backTo === "library"; // 라이브러리에서 열린 경우: 예배 컨텍스트 없음

  // ── 예배 곡 순서
  const svc      = (!isLibraryMode && selectedSvcId) ? services.find(s => s.id === selectedSvcId) : null;
  // 유효 곡만 포함 — 삭제된 ID 제외, 중복 ID(복사) 허용
  const svcSongs = svc
    ? (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean)
    : [];
  // 전달된 인덱스 우선(복사 곡 정확한 위치), 없으면 findIndex fallback
  const songIdx  = (selectedSvcSongIdx >= 0 && selectedSvcSongIdx < svcSongs.length)
    ? selectedSvcSongIdx
    : svcSongs.findIndex(s => s?.id === selectedSongId);
  const goToSong = (idx) => {
    if (idx < 0 || idx >= svcSongs.length || !svcSongs[idx]) return;
    nav("pdfViewer", { songId: svcSongs[idx].id, svcSongIdx: idx, backTo });
  };

  // ── PDF.js refs / state
  const canvas1Ref   = useRef(null);
  const canvas2Ref   = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef    = useRef(null);
  const imageRef     = useRef(null);  // 이미지 악보용
  const [numPages, setNumPages] = useState(0);
  const [pageNum,  setPageNum]  = useState(1);
  const [zoomMul,  setZoomMul]  = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panIntervalRef = useRef(null);
  const [loadErr,  setLoadErr]  = useState("");
  const [cSize,    setCSize]    = useState({ w: 0, h: 0 });
  const [dualIdx,  setDualIdx]  = useState(Math.max(0, songIdx));
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
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteInput,     setNoteInput]     = useState(false);
  const [noteShared,    setNoteShared]    = useState(false); // 팀 메모 여부
  const [noteTxt,       setNoteTxt]       = useState("");
  const [saving,        setSaving]        = useState(false);

  // ── Recording
  const [recording,    setRecording]    = useState(false);
  const [recSeconds,   setRecSeconds]   = useState(0);
  const [showRecModal, setShowRecModal] = useState(false);
  const [recCount,     setRecCount]     = useState(0);
  const mediaRecRef  = useRef(null);
  const recTimerRef  = useRef(null);
  const recChunksRef = useRef([]);
  const recSecondsRef = useRef(0);

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

  // ── Stamp + loupe
  const [stampSymbol, setStampSymbol] = useState("f");
  const [stampItalic, setStampItalic] = useState(true);
  const [stampSize,   setStampSize]   = useState(12); // 6–40
  const [loupePos, setLoupePos] = useState(null); // { x, y } viewport coords
  const loupeCanvasRef = useRef(null);
  const lastPt1Ref = useRef({ x: 0.5, y: 0.5 });
  const lastPt2Ref = useRef({ x: 0.5, y: 0.5 });

  // ── Shape tool (slur, hairpin, line)
  const [shapeTool, setShapeTool] = useState("slur");
  const shapeStart1Ref = useRef(null);
  const shapeStart2Ref = useRef(null);

  // ── Chord transposition
  const [transposeMode,  setTransposeMode]  = useState(false);
  const [chordMoveMode,  setChordMoveMode]  = useState(false); // 리더 전용: 코드 이동 모드
  const [transposeSteps,  setTransposeSteps]  = useState(0);  // single / dual left
  const [transposeSteps2, setTransposeSteps2] = useState(0);  // dual right
  const [chordData,      setChordData]      = useState([]);   // [{chord,x,y}] — single / dual left
  const [chordData2,     setChordData2]     = useState([]);   // dual right
  const [chordFontScale, setChordFontScale] = useState(1.0);  // 0.4–2.0
  const [detectingChords, setDetectingChords] = useState(false);
  const [detectErr,      setDetectErr]      = useState("");
  const [dragChord,      setDragChord]      = useState(null); // {side,idx,pointerId}
  const [deletingChord,  setDeletingChord]  = useState(null); // {side,idx} long-press pending
  const longPressTimer   = useRef(null);
  const longPressOrigin  = useRef(null); // {x,y} to detect move
  const pointerDownTimeRef = useRef(0);
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
  const stampPressed1Ref   = useRef(false); // Apple Pencil hover guard
  const stampPressed2Ref   = useRef(false);

  const myNotes   = annotations[selectedSongId]     || [];
  const teamNotes = (teamAnnotations || {})[selectedSongId] || [];
  const leader    = isLeader(user.role);

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
          if (dc2 && dc2.width > 0) drawStrokes(dc2, strokesRef2.current);
        }
      }).catch(() => {});
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
        const strokes = snap.exists() ? (snap.data().strokes || []) : [];
        tStrokesRef.current = strokes;
        const dc2 = tdcRef.current;
        if (dc2 && dc2.width > 0) {
          dc2.getContext("2d").clearRect(0, 0, dc2.width, dc2.height);
          if (strokes.length > 0) drawStrokes(dc2, strokes);
        }
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
    loadDrawing(dualLeftSongId, 1, strokes1Ref, drawCanvas1Ref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualLeftSongId, user?.uid, dual]);

  // load strokes — dual right
  useEffect(() => {
    if (!dual) return;
    loadDrawing(dualRightSongId, 1, strokes2Ref, drawCanvas2Ref);
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
    const unsub = loadTeamDrawing(dualLeftSongId, 1, teamStrokes1Ref, teamDrawCanvas1Ref, isDrawing1Ref);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualLeftSongId, dual]);

  // load team strokes — dual right (realtime)
  useEffect(() => {
    if (!dual) return;
    const unsub = loadTeamDrawing(dualRightSongId, 1, teamStrokes2Ref, teamDrawCanvas2Ref, isDrawing2Ref);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualRightSongId, dual]);

  // Sync selAnnotRef with state
  useEffect(() => { selAnnotRef.current = selAnnot; }, [selAnnot]);

  // Clear selection when switching away from select tool or draw mode off
  useEffect(() => {
    if (drawTool !== "select") setSelAnnot(null);
  }, [drawTool]);

  // Clear selection on page/song change
  useEffect(() => { setSelAnnot(null); }, [selectedSongId, pageNum, dualIdx]);

  // 코드 이동 모드: 전조 끄거나 곡/페이지 이동 시 자동 리셋
  useEffect(() => { if (!transposeMode) setChordMoveMode(false); }, [transposeMode]);
  useEffect(() => { setChordMoveMode(false); }, [selectedSongId, pageNum, dualIdx]);

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
    const ro = new ResizeObserver(([e]) =>
      setCSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(containerRef.current);
    return () => ro.disconnect();
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

      const raw = await detectChordsViaEdge(imageData, user?.geminiKey);
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
  useEffect(() => {
    if (dual) return;
    pdfDocRef.current = null;
    imageRef.current  = null;
    setPageNum(song?.pdfPage || 1); setNumPages(0); setLoadErr("");
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
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/webm",
        "",
      ].find(t => t === "" || MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const actualType = mr.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recChunksRef.current, { type: actualType });
        const secs = recSecondsRef.current;
        await saveRecToDB(blob, {
          songId: selectedSongId, songTitle: song?.title || "알 수 없음",
          pageNum, duration: secs, size: blob.size,
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
    if (drawModeRef.current) return;
    if (penDownRef.current) return;
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
    if (drawModeRef.current) return;
    if (!swipeNav) return;
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
    if (drawModeRef.current) return;
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
    await onAddAnnotation(selectedSongId, { text: noteTxt, page: pageNum, x: 0, y: 0, shared: noteShared });
    setNoteTxt(""); setNoteInput(false); setNoteShared(false); setSaving(false);
  };
  const deleteNote = id => onDeleteAnnotation(selectedSongId, id);

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
  const selPage = (sel) => sel?.canvasNum === 1 ? (dual ? 1 : pageNum) : 1;

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
    const page = isC1 ? (dual ? 1 : pageNum) : (dual ? 2 : pageNum);
    const textStroke = {
      tool: "text", text: textInput.value.trim(),
      color: drawColor, size: ({ 1: 8, 2: 15, 4: 28 })[drawWidth] || 15,
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
        ctx.ellipse(0, 0, sz * 0.5, sz * 0.36, 0, 0, Math.PI * 2);
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

  const makeStroke = () => ({ color: drawColor, width: drawWidth, tool: drawTool, points: [] });

  // ── Canvas 1 handlers (single mode + dual left)
  const handleDraw1Down = (e) => {
    if (e.pointerType === "touch" && !["text","stamp","select"].includes(drawTool)) return;
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
      stampPressed1Ref.current = true;
      const pt = getCanvasPt(e, canvas);
      lastPt1Ref.current = pt;
      updateLoupe(e, canvas1Ref.current, canvas, stampSymbol, stampItalic, drawColor, stampSize);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape") {
      const pt = getCanvasPt(e, canvas);
      shapeStart1Ref.current = pt;
      curStroke1Ref.current = { tool: shapeTool, points: [pt], color: drawColor, width: drawWidth };
      return;
    }
    isDrawing1Ref.current = true;
    curStroke1Ref.current = { ...makeStroke(), points: [getCanvasPt(e, canvas)] };
    { const rc = teamDrawMode && teamDrawCanvas1Ref.current ? teamDrawCanvas1Ref.current : canvas;
      drawStrokes(rc, teamDrawMode ? teamStrokes1Ref.current : strokes1Ref.current, curStroke1Ref.current); }
  };
  const handleDraw1Move = (e) => {
    if (e.pointerType === "touch" && drawTool !== "select") return;
    const canvas = drawCanvas1Ref.current;
    if (!canvas) return;
    e.preventDefault();
    if (drawTool === "select") {
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
      curStroke1Ref.current = { tool: shapeTool, points: [shapeStart1Ref.current, pt], color: drawColor, width: drawWidth };
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
        await (selAnnotRef.current.isTeam ? saveTeamDrawing : saveDrawing)(songId, dual ? 1 : pageNum, sRef1u.current);
        if (dc1u) drawStrokes(dc1u, sRef1u.current, null, selAnnotRef.current.idx);
      }
      return;
    }
    if (drawTool === "stamp") {
      setLoupePos(null);
      if (!stampPressed1Ref.current) return; // hover exit — not a real tap
      stampPressed1Ref.current = false;
      const canvas = teamDrawMode ? teamDrawCanvas1Ref.current : drawCanvas1Ref.current;
      if (!canvas) return;
      const coordCanvas = drawCanvas1Ref.current || canvas;
      const pt = e ? getCanvasPt(e, coordCanvas) : lastPt1Ref.current;
      const stamp = { tool:"stamp", symbol:stampSymbol, italic:stampItalic,
        color:drawColor, size:stampSize, points:[pt], ...(teamDrawMode && { team: true }) };
      const sRef1 = teamDrawMode ? teamStrokes1Ref : strokes1Ref;
      const next = [...sRef1.current, stamp];
      sRef1.current = next;
      drawStrokes(canvas, next);
      const songId = dual ? dualLeftSongId : selectedSongId;
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(songId, dual ? 1 : pageNum, next);
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
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(songId, dual ? 1 : pageNum, next);
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
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(songId, dual ? 1 : pageNum, next);
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
      stampPressed2Ref.current = true;
      const pt = getCanvasPt(e, canvas);
      lastPt2Ref.current = pt;
      updateLoupe(e, canvas2Ref.current, canvas, stampSymbol, stampItalic, drawColor, stampSize);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape") {
      const pt = getCanvasPt(e, canvas);
      shapeStart2Ref.current = pt;
      curStroke2Ref.current = { tool: shapeTool, points: [pt], color: drawColor, width: drawWidth };
      return;
    }
    isDrawing2Ref.current = true;
    curStroke2Ref.current = { ...makeStroke(), points: [getCanvasPt(e, canvas)] };
    { const rc = teamDrawMode && teamDrawCanvas2Ref.current ? teamDrawCanvas2Ref.current : canvas;
      drawStrokes(rc, teamDrawMode ? teamStrokes2Ref.current : strokes2Ref.current, curStroke2Ref.current); }
  };
  const handleDraw2Move = (e) => {
    if (e.pointerType === "touch" && drawTool !== "select") return;
    const canvas = drawCanvas2Ref.current;
    if (!canvas) return;
    e.preventDefault();
    if (drawTool === "select") {
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
      curStroke2Ref.current = { tool: shapeTool, points: [shapeStart2Ref.current, pt], color: drawColor, width: drawWidth };
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
        await (selAnnotRef.current.isTeam ? saveTeamDrawing : saveDrawing)(dualRightSongId, 1, sRef2u.current);
        if (dc2u) drawStrokes(dc2u, sRef2u.current, null, selAnnotRef.current.idx);
      }
      return;
    }
    if (drawTool === "stamp") {
      setLoupePos(null);
      if (!stampPressed2Ref.current) return; // hover exit — not a real tap
      stampPressed2Ref.current = false;
      const canvas = teamDrawMode ? teamDrawCanvas2Ref.current : drawCanvas2Ref.current;
      if (!canvas) return;
      const coordCanvas = drawCanvas2Ref.current || canvas;
      const pt = e ? getCanvasPt(e, coordCanvas) : lastPt2Ref.current;
      const stamp = { tool:"stamp", symbol:stampSymbol, italic:stampItalic,
        color:drawColor, size:stampSize, points:[pt], ...(teamDrawMode && { team: true }) };
      const sRef2 = teamDrawMode ? teamStrokes2Ref : strokes2Ref;
      const next = [...sRef2.current, stamp];
      sRef2.current = next;
      drawStrokes(canvas, next);
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(dualRightSongId, 1, next);
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
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(dualRightSongId, 1, next);
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
      await (teamDrawMode ? saveTeamDrawing : saveDrawing)(dualRightSongId, 1, next);
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
      await saveFn(songId, dual ? 1 : pageNum, restored);
      if (dcRef.current) drawStrokes(dcRef.current, restored);
      return;
    }
    if (sRef.current.length === 0) return;
    const next = sRef.current.slice(0, -1);
    sRef.current = next;
    await saveFn(songId, dual ? 1 : pageNum, next);
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
    pRef.current = sRef.current;
    sRef.current = [];
    await (isTeam ? saveTeamDrawing : saveDrawing)(songId, dual ? 1 : pageNum, []);
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

  if (!song) return null;

  return (
    <div style={{ position:"fixed", inset:0, background:C.bg, display:"flex",
      flexDirection:"column", overflow:"hidden" }}>

      {/* 상단 툴바 */}
      <div style={{
        background:C.surf, borderBottom:`1px solid ${C.bdr}`,
        flexShrink:0, boxShadow:"0 1px 0 rgba(0,0,0,.06)",
      }}>
        {/* iOS safe area spacer */}
        <div style={{ height:"env(safe-area-inset-top)", background:C.surf }} />

        <div style={{
          height:52, display:"flex", alignItems:"center", gap:6,
          padding:"0 12px",
        }}>
          <button onClick={() => nav(backTo || "library")}
            style={{ background:"none", border:"none", color:C.acc, cursor:"pointer",
              padding:"4px 8px 4px 0", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
            <Icon n="back" size={18} color={C.acc} />
            <span style={{ fontSize:15, fontWeight:500, color:C.acc }}>Back</span>
          </button>

          <div style={{ flex:1, minWidth:0, textAlign:"center" }}>
            <div style={{ fontWeight:700, fontSize:15, overflow:"hidden",
              textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{song.title}</div>
            <div style={{ fontSize:11, color:C.dim }}>
              Key {transposeMode && transposeSteps !== 0
                ? `${song.key} → ${keyName(song.key, transposeSteps)}`
                : song.key}
              {song.bpm ? ` · ♩${song.bpm}` : ""}
              {numPages > 0 ? ` · ${pageNum}/${numPages}p` : ""}
              {!isLibraryMode && svcSongs.length > 1 ? ` · 곡 ${songIdx + 1}/${svcSongs.length}` : ""}
            </div>
          </div>

          {/* 오른쪽 버튼 그룹 — 600px 기준으로 폰/태블릿 레이아웃 분기 */}
          {(() => {
            const narrow = tbNarrow;
            const gap = narrow ? 3 : 4;
            const iconSz = tbIconSz;
            const pad = narrow ? 6 : 7;
            const sep = <div style={{ width:1, height:18, background:C.bdr, margin: narrow ? "0 1px" : "0 2px" }} />;
            return (
              <div className="toolbar-scroll" style={{
                display:"flex", alignItems:"center", overflowX:"auto",
                flexShrink:1, minWidth:0,
              }}>
                <div style={{ display:"flex", gap, alignItems:"center", flexShrink:0, paddingRight:4 }}>
                  {/* 줌 컨트롤 */}
                  <button onClick={() => setZoomMul(z => Math.max(0.5, +(z - 0.15).toFixed(2)))}
                    style={{ background:"none", border:"none", cursor:"pointer", padding:pad, display:"flex", borderRadius:8 }}>
                    <Icon n="zoomOut" size={iconSz} color={C.dim} />
                  </button>
                  <button onClick={resetZoom} style={{
                    background: zoomMul !== 1.0 ? `${C.acc}22` : "none",
                    border: zoomMul !== 1.0 ? `1px solid ${C.acc}` : "1px solid transparent",
                    borderRadius:6, cursor:"pointer", padding: narrow ? "2px 5px" : "2px 6px",
                    fontSize: narrow ? 10 : 11, color: zoomMul !== 1.0 ? C.acc : C.dim,
                    fontWeight:700, fontFamily:"inherit", minWidth: narrow ? 32 : 36,
                  }}>
                    {Math.round(zoomMul * 100)}%
                  </button>
                  <button onClick={() => setZoomMul(z => Math.min(3.0, +(z + 0.15).toFixed(2)))}
                    style={{ background:"none", border:"none", cursor:"pointer", padding:pad, display:"flex", borderRadius:8 }}>
                    <Icon n="zoomIn" size={iconSz} color={C.dim} />
                  </button>
                  {/* 페이지 이동 — numPages > 1 이고 싱글 모드일 때 */}
                  {!dual && numPages > 1 && <>
                    <button onClick={() => { if (pageNum > 1) { slideAnimate(-1); setPageNum(p => p - 1); } }}
                      disabled={pageNum <= 1}
                      title="이전 페이지"
                      style={{ background:"none", border:"none", cursor: pageNum <= 1 ? "not-allowed" : "pointer",
                        padding:pad, display:"flex", borderRadius:8, opacity: pageNum <= 1 ? 0.3 : 1 }}>
                      <Icon n="prev" size={iconSz} color={C.dim} />
                    </button>
                    <button onClick={() => { if (pageNum < numPages) { slideAnimate(1); setPageNum(p => p + 1); } }}
                      disabled={pageNum >= numPages}
                      title="다음 페이지"
                      style={{ background:"none", border:"none", cursor: pageNum >= numPages ? "not-allowed" : "pointer",
                        padding:pad, display:"flex", borderRadius:8, opacity: pageNum >= numPages ? 0.3 : 1 }}>
                      <Icon n="next" size={iconSz} color={C.dim} />
                    </button>
                    {sep}
                  </>}
                  {/* 녹음 버튼 — 항상 보이도록 FIT 앞에 배치 */}
                  {recording ? (
                    <button onClick={stopRecording} style={{
                      display:"flex", alignItems:"center", gap:4,
                      padding: narrow ? "5px 8px" : "5px 10px",
                      background:`${C.red}22`, border:`1px solid ${C.red}`,
                      borderRadius:8, cursor:"pointer", flexShrink:0,
                    }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:C.red,
                        animation:"pulse 1s infinite" }} />
                      <span style={{ fontSize:11, fontWeight:700, color:C.red, fontFamily:"inherit",
                        fontVariantNumeric:"tabular-nums" }}>
                        {`${Math.floor(recSeconds/60)}:${String(recSeconds%60).padStart(2,"0")}`}
                      </span>
                    </button>
                  ) : (
                    <button onClick={startRecording} title="녹음 시작" style={{
                      position:"relative",
                      background:"transparent", border:`1px solid ${C.bdr}`,
                      borderRadius:8, padding: narrow ? 6 : 7, cursor:"pointer",
                      display:"flex", alignItems:"center",
                    }}>
                      <Icon n="mic" size={tbIconSz} color={C.dim} />
                      {recCount > 0 && (
                        <span style={{
                          position:"absolute", top:2, right:2,
                          background:C.acc, color:"#fff", borderRadius:"50%",
                          fontSize:8, fontWeight:800, width:13, height:13,
                          display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
                        }}>{recCount}</span>
                      )}
                    </button>
                  )}
                  {/* 녹음 목록 (저장된 녹음이 있을 때만 표시) */}
                  {recCount > 0 && !recording && (
                    <button onClick={() => setShowRecModal(true)} title="녹음 목록" style={{
                      background:"transparent", border:`1px solid ${C.bdr}`,
                      borderRadius:8, padding: narrow ? 6 : 7, cursor:"pointer",
                      display:"flex", alignItems:"center",
                    }}>
                      <Icon n="play" size={tbIconSz} color={C.dim} />
                    </button>
                  )}
                  {sep}
                  {/* FIT */}
                  <button onClick={autoFit} title="여백 자동 제거 후 악보 꽉 채우기 (토글)"
                    style={{ display:"flex", alignItems:"center", gap: narrow ? 3 : 4,
                      padding: narrow ? "4px 7px" : "4px 8px", borderRadius:7, cursor:"pointer",
                      background: fitActive ? C.acc : C.card,
                      border:`1px solid ${fitActive ? C.acc : C.bdr}`,
                      color: fitActive ? "#fff" : C.txt,
                      fontWeight:700, fontSize: narrow ? 10 : 11, fontFamily:"inherit",
                      letterSpacing:"0.04em", transition:"all .15s" }}>
                    <Icon n="fitCrop" size={iconSz} color={fitActive ? "#fff" : C.txt} />
                    FIT
                  </button>
                  {sep}
                  {toolBtn("pen",  drawMode,      () => { setDrawMode(p => !p); setDrawTool("pen"); }, "필기 모드")}
                  {toolBtn("note", showNotePanel, () => setShowNotePanel(p => !p), "메모 목록")}
                  {/* 다운로드: 라이브러리·리더는 항상, 멤버는 리더가 허용 시만 */}
                  {canDownload && toolBtn("download", false, downloadAnnotatedScore, "악보 다운로드")}
                  {/* 리더: 멤버 다운로드 허용 토글 (서비스 모드만) */}
                  {!isLibraryMode && leader && svc && (
                    <button onClick={toggleDownloadEnabled} title="멤버 다운로드 허용" style={{
                      display:"flex", flexDirection:"column", alignItems:"center", gap:1,
                      padding: narrow ? "4px 6px" : "4px 7px",
                      background: svc.downloadEnabled ? `${C.grn}22` : "transparent",
                      border:`1px solid ${svc.downloadEnabled ? C.grn : C.bdr}`,
                      borderRadius:8, cursor:"pointer", flexShrink:0,
                    }}>
                      <Icon n="download" size={tbIconSz} color={svc.downloadEnabled ? C.grn : C.dim} />
                      <span style={{ fontSize:9, fontWeight:700, lineHeight:1,
                        color: svc.downloadEnabled ? C.grn : C.dim, fontFamily:"inherit", whiteSpace:"nowrap" }}>
                        {svc.downloadEnabled ? "↓허용중" : "↓멤버"}
                      </span>
                    </button>
                  )}
                  {!isLibraryMode && sep}
                  {/* DUAL — 라이브러리 모드에서는 숨김 (svcSongs 없음) */}
                  {!isLibraryMode && (narrow ? (
                    <button onClick={() => setDual(p => !p)} title="듀얼 모드" style={{
                      background: dual ? `${C.pur}33` : "transparent",
                      border:`1px solid ${dual ? C.pur : C.bdr}`,
                      borderRadius:8, padding:pad, cursor:"pointer", display:"flex", alignItems:"center",
                      transition:"all .15s",
                    }}>
                      <Icon n="dual" size={iconSz} color={dual ? C.pur : C.dim} />
                    </button>
                  ) : (
                    <button onClick={() => setDual(p => !p)} style={{
                      display:"flex", alignItems:"center", gap:5,
                      padding:"5px 10px", borderRadius:8, cursor:"pointer",
                      background: dual ? C.pur : C.card,
                      border:`1px solid ${dual ? C.pur : C.bdr}`,
                      color: dual ? "#fff" : C.dim,
                      fontWeight:700, fontSize:11, fontFamily:"inherit",
                      letterSpacing:"0.06em", transition:"all .15s",
                    }}>
                      <Icon n="dual" size={12} color={dual ? "#fff" : C.dim} />
                      DUAL
                    </button>
                  ))}
                  {/* MEDIA */}
                  {narrow ? (
                    <button onClick={() => {
                      if (dual) { showToast("싱글 모드에서만 사용 가능합니다"); return; }
                      setMedia(p => !p);
                    }} title="미디어 패널" style={{
                      position:"relative",
                      background: media ? `${C.acc}33` : "transparent",
                      border:`1px solid ${media ? C.acc : C.bdr}`,
                      borderRadius:8, padding:pad, cursor:"pointer", display:"flex", alignItems:"center",
                      transition:"all .15s",
                    }}>
                      <Icon n="sideR" size={iconSz} color={media ? C.acc : C.dim} />
                      {getYoutubeId(song?.youtubeUrl) && (
                        <span style={{
                          position:"absolute", top:2, right:2, lineHeight:1,
                          fontSize:7, fontWeight:800, borderRadius:3, padding:"1px 2px",
                          background: media ? C.acc : `${C.red}33`,
                          color: media ? "#fff" : C.red,
                        }}>YT</span>
                      )}
                    </button>
                  ) : (
                    <button onClick={() => {
                      if (dual) { showToast("싱글 모드에서만 사용 가능합니다"); return; }
                      setMedia(p => !p);
                    }} style={{
                      display:"flex", alignItems:"center", gap:5,
                      padding:"5px 10px", borderRadius:8, cursor:"pointer",
                      background: media ? C.acc : C.card,
                      border:`1px solid ${media ? C.acc : C.bdr}`,
                      color: media ? "#fff" : C.dim,
                      fontWeight:700, fontSize:11, fontFamily:"inherit",
                      letterSpacing:"0.06em", transition:"all .15s",
                    }}>
                      <Icon n="sideR" size={12} color={media ? "#fff" : C.dim} />
                      MEDIA
                      {getYoutubeId(song?.youtubeUrl) && (
                        <span style={{
                          fontSize:9, background: media ? "rgba(255,255,255,0.3)" : `${C.red}33`,
                          color: media ? "#fff" : C.red,
                          borderRadius:4, padding:"1px 4px", fontWeight:800,
                        }}>YT</span>
                      )}
                    </button>
                  )}
                  {/* 전조 — 모든 역할 사용 가능 */}
                  {narrow ? (
                    <button onClick={() => {
                      setTransposeMode(p => !p);
                      if (transposeMode) { setTransposeSteps(0); setDetectErr(""); }
                    }} title="전조" style={{
                      position:"relative",
                      background: transposeMode ? `${C.grn}33` : "transparent",
                      border:`1px solid ${transposeMode ? C.grn : C.bdr}`,
                      borderRadius:8, padding:pad, cursor:"pointer", display:"flex", alignItems:"center",
                      transition:"all .15s",
                    }}>
                      <Icon n="music" size={iconSz} color={transposeMode ? C.grn : C.dim} />
                      {transposeMode && transposeSteps !== 0 && (
                        <span style={{
                          position:"absolute", top:2, right:2, lineHeight:1,
                          fontSize:7, fontWeight:800, borderRadius:3, padding:"1px 2px",
                          background:C.grn, color:"#fff",
                        }}>{transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}</span>
                      )}
                    </button>
                  ) : (
                    <button onClick={() => {
                      setTransposeMode(p => !p);
                      if (transposeMode) { setTransposeSteps(0); setDetectErr(""); }
                    }} style={{
                      display:"flex", alignItems:"center", gap:5,
                      padding:"5px 10px", borderRadius:8, cursor:"pointer",
                      background: transposeMode ? C.grn : C.card,
                      border:`1px solid ${transposeMode ? C.grn : C.bdr}`,
                      color: transposeMode ? "#fff" : C.dim,
                      fontWeight:700, fontSize:11, fontFamily:"inherit",
                      letterSpacing:"0.06em", transition:"all .15s",
                    }}>
                      {transposeMode && transposeSteps !== 0
                        ? `${song.key}→${keyName(song.key, transposeSteps)}`
                        : "전조"}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 필기 서브툴바 */}
      {drawMode && (
        <div style={{ flexShrink:0, background:`${C.pur}0a`, borderBottom:`1px solid ${C.bdr}`, position:"relative" }}>
          {/* 필기 서브툴바 — 단일 스크롤 행 */}
          <div style={{ display:"flex", alignItems:"center", gap:5, padding:"0 10px", height:44,
            overflowX:"auto", background: drawTool === "select" && selAnnot ? `${C.pur}0e` : "transparent" }}>
            {/* 도구 버튼 (아이콘만) */}
            {[
              { id:"select",      icon:"cursor",    title:"선택"   },
              { id:"pen",         icon:"pen",       title:"펜"     },
              { id:"highlighter", icon:"highlight", title:"마커"   },
              { id:"cover",       icon:"cover",     title:"커버"   },
              { id:"eraser",      icon:"eraser",    title:"지우개"  },
              { id:"text",        icon:"textT",     title:"텍스트"  },
              { id:"stamp",       icon:"stamp",     title:"스탬프"  },
              { id:"shape",       icon:"slur",      title:"도형"   },
            ].map(t => (
              <button key={t.id} onClick={() => setDrawTool(t.id)} title={t.title} style={{
                width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                background: drawTool === t.id ? `${C.pur}22` : "transparent",
                border:`1px solid ${drawTool === t.id ? C.pur : C.bdr}`,
                borderRadius:7, cursor:"pointer", flexShrink:0,
              }}>
                <Icon n={t.icon} size={16} color={drawTool === t.id ? C.pur : C.dim} />
              </button>
            ))}
            {/* 팀필기 토글 */}
            {leader && drawTool !== "select" && (
              <button onClick={() => setTeamDrawMode(p => !p)} title="팀 필기" style={{
                width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                background: teamDrawMode ? `${C.acc}22` : "transparent",
                border:`1px solid ${teamDrawMode ? C.acc : C.bdr}`,
                borderRadius:7, cursor:"pointer", flexShrink:0,
              }}>
                <span style={{ fontSize:14, lineHeight:1 }}>👥</span>
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
                {drawTool === "cover" ? (
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
                {/* 굵기 */}
                {[1, 2, 4].map(w => (
                  <button key={w} onClick={() => setDrawWidth(w)} style={{
                    width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
                    background: drawWidth === w ? `${C.pur}22` : "transparent",
                    border:`1px solid ${drawWidth === w ? C.pur : C.bdr}`,
                    borderRadius:6, cursor:"pointer", flexShrink:0,
                  }}>
                    {(drawTool === "stamp" || drawTool === "shape") ? (
                      stampSymbol === "notehead" ? (
                        <svg width={w===1?8:w===2?11:15} height={w===1?6:w===2?8:11}
                          viewBox="0 0 15 11" style={{ display:"block" }}>
                          <ellipse cx="7.5" cy="5.5" rx="6.5" ry="4.5"
                            fill={drawColor} transform="rotate(-28 7.5 5.5)" />
                        </svg>
                      ) : (
                        <span style={{ fontSize: w === 1 ? 9 : w === 2 ? 12 : 16, color:drawColor, fontWeight:700,
                          fontStyle: drawTool === "stamp" && stampItalic ? "italic" : "normal", lineHeight:1 }}>
                          {drawTool === "stamp" ? stampSymbol : w === 1 ? "S" : w === 2 ? "M" : "L"}
                        </span>
                      )
                    ) : (
                      <div style={{
                        width: (drawTool === "highlighter" || drawTool === "cover") ? w * 2 + 1 : w + 2,
                        height: (drawTool === "highlighter" || drawTool === "cover") ? Math.max(6, w) : w + 2,
                        borderRadius: (drawTool === "highlighter" || drawTool === "cover") ? 2 : "50%",
                        background: drawTool === "eraser" ? C.dim : drawTool === "cover" ? "#ccc" : drawColor,
                        outline: drawTool === "cover" ? "1px solid #999" : "none",
                        opacity: drawTool === "eraser" ? 0.4 : 0.8,
                      }} />
                    )}
                  </button>
                ))}
                <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
                {/* 실행취소 + 필기삭제 */}
                <button onClick={handleUndo} title="실행취소" style={{
                  width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                  background:"transparent", border:`1px solid ${C.bdr}`,
                  borderRadius:7, cursor:"pointer", flexShrink:0,
                }}>
                  <Icon n="undo" size={16} color={C.dim} />
                </button>
                <button onClick={handleClearPage} title="필기 전체 삭제" style={{
                  width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                  background:"transparent", border:`1px solid ${C.red}44`,
                  borderRadius:7, cursor:"pointer", flexShrink:0,
                }}>
                  <Icon n="trash" size={16} color={C.red} />
                </button>
                {drawSaveErr && (
                  <span style={{ fontSize:10, color:C.red, marginLeft:4, flexShrink:0 }}>⚠ {drawSaveErr}</span>
                )}
              </>
            )}
          </div>
          {/* 스탬프 팔레트 — 플로팅 오버레이 (악보 공간 유지) */}
          {drawTool === "stamp" && (
            <div style={{
              position:"absolute", top:"100%", right:10, zIndex:500,
              background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}`,
              boxShadow:"0 8px 32px rgba(0,0,0,0.5)",
              padding:"8px 10px", display:"flex", flexDirection:"column", gap:3,
            }}>
              {/* 크기 조절 */}
              <div style={{ display:"flex", alignItems:"center", gap:4, paddingBottom:6,
                borderBottom:`1px solid ${C.bdr}`, marginBottom:2 }}>
                <span style={{ fontSize:9, color:C.dim, fontWeight:700, width:32,
                  textAlign:"right", flexShrink:0 }}>크기</span>
                <button onClick={() => setStampSize(s => Math.max(6, s - 2))} style={{
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
              </div>
              {STAMP_GROUPS.map(group => (
                <div key={group.label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontSize:9, color:C.dim, fontWeight:700, width:32, textAlign:"right",
                    flexShrink:0, letterSpacing:"0.04em" }}>{group.label}</span>
                  {group.items.map(st => (
                    <button key={st.sym}
                      onClick={() => { setStampSymbol(st.sym); setStampItalic(st.italic); }}
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
                        <svg width="13" height="10" viewBox="0 0 13 10" style={{ display:"block" }}>
                          <ellipse cx="6.5" cy="5.5" rx="5.5" ry="3.8"
                            fill={stampSymbol === "notehead" ? C.acc : C.txt}
                            transform="rotate(-28 6.5 5.5)" />
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
          display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
          padding:"0 14px", minHeight:46, flexShrink:0,
          background:`${C.grn}0a`, borderBottom:`1px solid ${C.bdr}`,
          overflowX:"auto",
        }}>
          {dual ? (
            /* 듀얼: 왼쪽 [−][값][+] | 감지버튼 | 오른쪽 [−][값][+] [초기화] */
            <>
              {/* 왼쪽 전조 */}
              <span style={{ fontSize:10, color:C.dim, fontWeight:700, flexShrink:0 }}>왼쪽</span>
              <button onClick={() => saveTransposeSteps(Math.max(-6, transposeSteps - 1))}
                style={{ width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
                  background:"transparent", cursor:"pointer", fontWeight:700, fontSize:14, display:"flex",
                  alignItems:"center", justifyContent:"center", color:C.txt, flexShrink:0 }}>−</button>
              <span style={{ fontSize:12, fontWeight:800, color: transposeSteps === 0 ? C.dim : C.grn,
                minWidth:38, textAlign:"center", flexShrink:0 }}>
                {transposeSteps === 0 ? "원본" : `${transposeSteps > 0 ? "+" : ""}${transposeSteps}`}
              </span>
              <button onClick={() => saveTransposeSteps(Math.min(6, transposeSteps + 1))}
                style={{ width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
                  background:"transparent", cursor:"pointer", fontWeight:700, fontSize:14, display:"flex",
                  alignItems:"center", justifyContent:"center", color:C.txt, flexShrink:0 }}>+</button>
              <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
              {/* 감지 버튼 — 리더 전용 */}
              {leader
                ? (chordData.length === 0
                  ? <button onClick={() => detectChords(1)} disabled={detectingChords} style={{
                      background: detectingChords ? `${C.grn}44` : C.grn, border:"none", borderRadius:7,
                      padding:"5px 10px", cursor: detectingChords ? "not-allowed" : "pointer",
                      fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
                    }}>{detectingChords ? "⏳" : "🎵"} 왼쪽</button>
                  : <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓ 왼쪽 {chordData.length}개</span>)
                : chordData.length > 0 && <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓ 왼쪽 {chordData.length}개</span>
              }
              {leader
                ? (chordData2.length === 0
                  ? <button onClick={() => detectChords(2)} disabled={detectingChords} style={{
                      background: detectingChords ? `${C.grn}44` : C.grn, border:"none", borderRadius:7,
                      padding:"5px 10px", cursor: detectingChords ? "not-allowed" : "pointer",
                      fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
                    }}>{detectingChords ? "⏳" : "🎵"} 오른쪽</button>
                  : <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓ 오른쪽 {chordData2.length}개</span>)
                : chordData2.length > 0 && <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓ 오른쪽 {chordData2.length}개</span>
              }
              {detectErr && <span style={{ fontSize:11, color:C.red, flexShrink:0 }}>⚠ {detectErr}</span>}
              {/* 오른쪽 전조 + 초기화 */}
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                {leader && (chordData.length > 0 || chordData2.length > 0) && (
                  <button onClick={() => setChordMoveMode(m => !m)}
                    style={{ border:`1px solid ${chordMoveMode ? C.grn : C.bdr}`, borderRadius:6,
                      background: chordMoveMode ? `${C.grn}22` : "transparent",
                      padding:"3px 8px", cursor:"pointer", fontSize:10,
                      color: chordMoveMode ? C.grn : C.dim, fontFamily:"inherit", flexShrink:0 }}>
                    {chordMoveMode ? "✋ 이동 ON" : "코드 이동"}
                  </button>
                )}
                {chordMoveMode && (chordData.length > 0 || chordData2.length > 0) && (
                  <span style={{ fontSize:9, color:C.dim, whiteSpace:"nowrap" }}>더블탭: 복사 · 꾹: 삭제</span>
                )}
                <span style={{ fontSize:10, color:C.dim, fontWeight:700 }}>오른쪽</span>
                <button onClick={() => saveTransposeSteps2(Math.max(-6, transposeSteps2 - 1))}
                  style={{ width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor:"pointer", fontWeight:700, fontSize:14, display:"flex",
                    alignItems:"center", justifyContent:"center", color:C.txt }}>−</button>
                <span style={{ fontSize:12, fontWeight:800, color: transposeSteps2 === 0 ? C.dim : C.grn,
                  minWidth:38, textAlign:"center" }}>
                  {transposeSteps2 === 0 ? "원본" : `${transposeSteps2 > 0 ? "+" : ""}${transposeSteps2}`}
                </span>
                <button onClick={() => saveTransposeSteps2(Math.min(6, transposeSteps2 + 1))}
                  style={{ width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor:"pointer", fontWeight:700, fontSize:14, display:"flex",
                    alignItems:"center", justifyContent:"center", color:C.txt }}>+</button>
                <div style={{ width:1, height:20, background:C.bdr }} />
                <button onClick={() => { const v = Math.max(0.4, Math.round((chordFontScale - 0.2) * 10) / 10); setChordFontScale(v); saveChordFontScale(v); }}
                  disabled={chordFontScale <= 0.4}
                  style={{ width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor: chordFontScale <= 0.4 ? "default" : "pointer",
                    fontWeight:700, fontSize:11, display:"flex", alignItems:"center", justifyContent:"center",
                    color: chordFontScale <= 0.4 ? C.bdr : C.txt }}>A−</button>
                <button onClick={() => { const v = Math.min(2.0, Math.round((chordFontScale + 0.2) * 10) / 10); setChordFontScale(v); saveChordFontScale(v); }}
                  disabled={chordFontScale >= 2.0}
                  style={{ width:26, height:26, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor: chordFontScale >= 2.0 ? "default" : "pointer",
                    fontWeight:700, fontSize:11, display:"flex", alignItems:"center", justifyContent:"center",
                    color: chordFontScale >= 2.0 ? C.bdr : C.txt }}>A+</button>
                <div style={{ width:1, height:20, background:C.bdr }} />
                {leader && (
                  <button onClick={() => { setTransposeSteps(0); setTransposeSteps2(0); setChordData([]); setChordData2([]); setDetectErr(""); setChordFontScale(1.0); }}
                    style={{ background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6,
                      padding:"4px 10px", cursor:"pointer", fontSize:11, color:C.dim, fontFamily:"inherit" }}>
                    초기화
                  </button>
                )}
              </div>
            </>
          ) : (
            /* 싱글: 기존 레이아웃 */
            <>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                <button onClick={() => saveTransposeSteps(Math.max(-6, transposeSteps - 1))}
                  style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor:"pointer", fontWeight:700, fontSize:15, display:"flex",
                    alignItems:"center", justifyContent:"center", color:C.txt }}>−</button>
                <div style={{ textAlign:"center", minWidth:60 }}>
                  <div style={{ fontSize:12, fontWeight:800, color: transposeSteps === 0 ? C.dim : C.grn }}>
                    {transposeSteps === 0 ? "원본" : `${transposeSteps > 0 ? "+" : ""}${transposeSteps} 반음`}
                  </div>
                </div>
                <button onClick={() => saveTransposeSteps(Math.min(6, transposeSteps + 1))}
                  style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor:"pointer", fontWeight:700, fontSize:15, display:"flex",
                    alignItems:"center", justifyContent:"center", color:C.txt }}>+</button>
              </div>
              <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
              {leader
                ? (chordData.length === 0
                  ? <button onClick={() => detectChords(1)} disabled={detectingChords} style={{
                      background: detectingChords ? `${C.grn}44` : C.grn, border:"none", borderRadius:7,
                      padding:"5px 12px", cursor: detectingChords ? "not-allowed" : "pointer",
                      fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
                    }}>{detectingChords ? "⏳ 감지 중..." : "🎵 코드 감지 (AI)"}</button>
                  : <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓ {chordData.length}개 감지됨</span>)
                : chordData.length > 0 && <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓ {chordData.length}개 감지됨</span>
              }
              {detectErr && <span style={{ fontSize:11, color:C.red, flexShrink:0 }}>⚠ {detectErr}</span>}
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                {leader && chordData.length > 0 && (
                  <button onClick={() => setChordMoveMode(m => !m)}
                    style={{ border:`1px solid ${chordMoveMode ? C.grn : C.bdr}`, borderRadius:6,
                      background: chordMoveMode ? `${C.grn}22` : "transparent",
                      padding:"3px 8px", cursor:"pointer", fontSize:10,
                      color: chordMoveMode ? C.grn : C.dim, fontFamily:"inherit", flexShrink:0 }}>
                    {chordMoveMode ? "✋ 이동 ON" : "코드 이동"}
                  </button>
                )}
                {chordMoveMode && chordData.length > 0 && (
                  <span style={{ fontSize:9, color:C.dim, whiteSpace:"nowrap" }}>더블탭: 복사 · 꾹: 삭제</span>
                )}
                <button onClick={() => { const v = Math.max(0.4, Math.round((chordFontScale - 0.2) * 10) / 10); setChordFontScale(v); saveChordFontScale(v); }}
                  disabled={chordFontScale <= 0.4}
                  style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor: chordFontScale <= 0.4 ? "default" : "pointer",
                    fontWeight:700, fontSize:12, display:"flex", alignItems:"center", justifyContent:"center",
                    color: chordFontScale <= 0.4 ? C.bdr : C.txt }}>A−</button>
                <span style={{ fontSize:10, color:C.dim, minWidth:28, textAlign:"center" }}>
                  {chordFontScale === 1.0 ? "크기" : `×${chordFontScale.toFixed(1)}`}
                </span>
                <button onClick={() => { const v = Math.min(2.0, Math.round((chordFontScale + 0.2) * 10) / 10); setChordFontScale(v); saveChordFontScale(v); }}
                  disabled={chordFontScale >= 2.0}
                  style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.bdr}`,
                    background:"transparent", cursor: chordFontScale >= 2.0 ? "default" : "pointer",
                    fontWeight:700, fontSize:12, display:"flex", alignItems:"center", justifyContent:"center",
                    color: chordFontScale >= 2.0 ? C.bdr : C.txt }}>A+</button>
                <div style={{ width:1, height:20, background:C.bdr }} />
                {leader && (
                  <button onClick={() => { setTransposeSteps(0); setTransposeSteps2(0); setChordData([]); setChordData2([]); setDetectErr(""); setChordFontScale(1.0); }}
                    style={{ background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6,
                      padding:"4px 10px", cursor:"pointer", fontSize:11, color:C.dim, fontFamily:"inherit" }}>
                    초기화
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

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

      {/* 콘텐츠 */}
      <div style={{ flex:1, overflow:"hidden", display:"flex" }}>
        {/* PDF 캔버스 영역 */}
        <div ref={containerRef} style={{ flex:1, overflow:"hidden", display:"flex",
          position:"relative", background:C.bg, touchAction:"none", userSelect:"none", WebkitUserSelect:"none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}>

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
                      <canvas ref={canvas1Ref} style={{ display:"block" }} />
                      <canvas ref={teamDrawCanvas1Ref} style={{
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
                      {transposeMode && chordData.length > 0 && (() => {
                        const cw = canvas1Ref.current?.offsetWidth  || 400;
                        const fs = Math.round(Math.max(8, Math.min(14, cw / 50)) * chordFontScale);
                        const canMove = leader && chordMoveMode;
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
                                background: isPendingDel ? "rgba(220,50,50,0.95)" : transposeSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                color: isPendingDel ? "#fff" : transposeSteps === 0 ? "#fff" : "#111",
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
                                {transposeChord(item.chord, transposeSteps)}
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
                        <canvas ref={canvas2Ref} style={{ display:"block" }} />
                        <canvas ref={teamDrawCanvas2Ref} style={{
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
                                  background: isPendingDel ? "rgba(220,50,50,0.95)" : transposeSteps2 === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                  color: isPendingDel ? "#fff" : transposeSteps2 === 0 ? "#fff" : "#111",
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
                                  {transposeChord(item.chord, transposeSteps2)}
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
                      <canvas ref={canvas1Ref} style={{ display:"block",
                        borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
                      <canvas ref={teamDrawCanvas1Ref} style={{
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
                      {/* 전조 코드 오버레이 */}
                      {transposeMode && chordData.length > 0 && (() => {
                        const cw = canvas1Ref.current?.offsetWidth  || 600;
                        const fs = Math.round(Math.max(10, Math.min(16, cw / 50)) * chordFontScale);
                        const canMove = leader && chordMoveMode;
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
                                background: isPendingDel ? "rgba(220,50,50,0.95)" : transposeSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                color: isPendingDel ? "#fff" : transposeSteps === 0 ? "#fff" : "#111",
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
                                {transposeChord(item.chord, transposeSteps)}
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
            {getYoutubeId(song?.youtubeUrl) && (
              <div style={{ flexShrink:0 }}>
                <iframe
                  src={`https://www.youtube.com/embed/${getYoutubeId(song.youtubeUrl)}?rel=0`}
                  style={{ width:"100%", aspectRatio:"16/9", border:"none", display:"block" }}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  title="YouTube"
                />
                <div style={{ fontSize:11, color:C.dim, padding:"4px 10px 6px",
                  borderBottom:`1px solid ${C.bdr}` }}>
                  🎵 {song.title}
                </div>
              </div>
            )}
            <div style={{ flex:1, overflow:"auto" }}>
              <AIPanel song={song} user={user} pdfCanvasRef={canvas1Ref} />
            </div>
          </div>
        )}
      </div>

      {/* 메모 입력 */}
      {noteInput && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:20 }}>
          <div style={{ background:C.surf, borderRadius:16, padding:20,
            width:"100%", maxWidth:400, border:`1px solid ${C.bdr}` }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>메모 추가 (p.{pageNum})</div>
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
            <textarea value={noteTxt} onChange={e => setNoteTxt(e.target.value)}
              placeholder={noteShared ? "팀 전체에 공유할 메모..." : "나만 보이는 메모..."} autoFocus
              style={{ width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
                color:C.txt, padding:"10px 14px", borderRadius:10,
                fontSize:14, outline:"none", fontFamily:"inherit",
                resize:"vertical", minHeight:80 }} />
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <Btn label="취소" variant="ghost" onClick={() => { setNoteInput(false); setNoteTxt(""); setNoteShared(false); }} full />
              <Btn label={saving ? "저장 중..." : "저장"} variant="primary" onClick={saveNote} full disabled={saving} />
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

      {/* 메모 패널 */}
      {showNotePanel && (
        <div style={{ position:"absolute", right:0, top:"calc(env(safe-area-inset-top) + 52px)", bottom:0,
          width:270, background:C.surf, borderLeft:`1px solid ${C.bdr}`,
          zIndex:100, overflowY:"auto", padding:16 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
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
      )}
      {showRecModal && (
        <RecordingsModal
          songId={selectedSongId}
          songTitle={song?.title || ""}
          userGeminiKey={user?.geminiKey || sharedGeminiKey}
          onClose={() => setShowRecModal(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   NOTIFICATIONS SCREEN
══════════════════════════════════════════════════════════════════ */
function NotificationsScreen({ notifs, services, markNotifRead, markAllNotifRead, user, nav }) {
  const [perm,        setPerm]        = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [tab,         setTab]         = useState("service"); // "service" | "admin"
  const [showCompose, setShowCompose] = useState(false);
  const [compType,    setCompType]    = useState("공지");
  const [compContent, setCompContent] = useState("");
  const [compTitle,   setCompTitle]   = useState("");
  const [sending,     setSending]     = useState(false);

  const isAdmin = user?.role === "admin";

  const serviceNotifs = notifs.filter(n => !n.category || n.category === "service");
  const adminNotifs   = notifs.filter(n => n.category === "admin");
  const activeNotifs  = tab === "service" ? serviceNotifs : adminNotifs;

  const serviceUnread = serviceNotifs.filter(n => !n.read).length;
  const adminUnread   = adminNotifs.filter(n => !n.read).length;

  const requestPerm = () => Notification.requestPermission().then(p => setPerm(p));

  const sendAdminNotif = async () => {
    if (!compContent.trim()) return;
    setSending(true);
    try {
      await addDoc(collection(db, "notifications"), {
        category:   "admin",
        notifType:  compType,
        type:       compType,
        title:      compTitle.trim() || compType,
        content:    compContent.trim(),
        body:       compContent.trim(),
        createdAt:  serverTimestamp(),
        readBy:     [],
        senderRole: "admin",
      });
      setCompContent(""); setCompTitle(""); setCompType("공지");
      setShowCompose(false);
    } finally {
      setSending(false);
    }
  };

  const tabStyle = (active) => ({
    flex:1, padding:"10px 0", border:"none", cursor:"pointer",
    fontFamily:"inherit", fontWeight: active ? 700 : 500,
    fontSize:14, background:"none",
    color: active ? C.acc : C.dim,
    borderBottom: active ? `2px solid ${C.acc}` : "2px solid transparent",
    transition:"color 0.15s, border-color 0.15s",
    position:"relative",
  });

  return (
    <div style={{ height:"100%", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* header */}
      <div style={{ background:C.surf, flexShrink:0,
        paddingTop:"env(safe-area-inset-top)",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ padding:"18px 16px 0",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>알림</div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {isAdmin && tab === "admin" && (
              <button onClick={() => setShowCompose(true)}
                style={{ background:C.red, border:"none", borderRadius:8, color:"#fff",
                  fontSize:12, fontWeight:700, padding:"6px 12px", cursor:"pointer",
                  fontFamily:"inherit", display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:16, lineHeight:1 }}>+</span> 공지 작성
              </button>
            )}
            <button onClick={markAllNotifRead}
              style={{ background:"none", border:"none", color:C.acc, fontSize:13,
                cursor:"pointer", fontWeight:600, fontFamily:"inherit" }}>
              모두 읽음
            </button>
          </div>
        </div>
        {/* tabs */}
        <div style={{ display:"flex", paddingTop:4 }}>
          <button style={tabStyle(tab === "service")} onClick={() => setTab("service")}>
            예배 악보
            {serviceUnread > 0 && (
              <span style={{ position:"absolute", top:6, right:"calc(50% - 32px)",
                background:C.acc, color:"#fff", borderRadius:"50%",
                width:16, height:16, fontSize:10, fontWeight:700,
                display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                {serviceUnread}
              </span>
            )}
          </button>
          <button style={tabStyle(tab === "admin")} onClick={() => setTab("admin")}>
            공지·참고
            {adminUnread > 0 && (
              <span style={{ position:"absolute", top:6, right:"calc(50% - 28px)",
                background:C.red, color:"#fff", borderRadius:"50%",
                width:16, height:16, fontSize:10, fontWeight:700,
                display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                {adminUnread}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* list */}
      <div style={{ flex:1, overflowY:"auto", padding:16, paddingBottom:90 }}>
        {/* 알림 권한 배너 */}
        {perm === "default" && (
          <div style={{ marginBottom:12, padding:"12px 14px", borderRadius:12,
            background:`${C.acc}18`, border:`1px solid ${C.acc}44`,
            display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:20 }}>🔔</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:13, color:C.txt }}>브라우저 알림 허용</div>
              <div style={{ fontSize:12, color:C.dim }}>새 알림을 팝업으로 받으려면 허용해주세요</div>
            </div>
            <button onClick={requestPerm} style={{
              background:C.acc, border:"none", borderRadius:8, color:"#fff",
              fontSize:12, fontWeight:700, padding:"6px 12px", cursor:"pointer", fontFamily:"inherit",
            }}>허용</button>
          </div>
        )}
        {perm === "denied" && (
          <div style={{ marginBottom:12, padding:"10px 14px", borderRadius:12,
            background:`${C.red}10`, border:`1px solid ${C.red}33`,
            fontSize:12, color:C.dim }}>
            🚫 알림이 차단됨 — 브라우저 설정에서 이 사이트 알림을 허용해주세요
          </div>
        )}
        {perm === "granted" && (
          <div style={{ marginBottom:12, padding:"8px 14px", borderRadius:10,
            background:`${C.grn}10`, border:`1px solid ${C.grn}33`,
            fontSize:12, color:C.grn, fontWeight:600 }}>
            ✓ 브라우저 알림 활성화됨
          </div>
        )}

        {activeNotifs.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
            <div style={{ fontSize:36, marginBottom:12 }}>{tab === "admin" ? "📢" : "🔔"}</div>
            {tab === "admin" ? "공지·참고 알림이 없습니다" : "새로운 알림이 없습니다"}
          </div>
        )}

        {activeNotifs.map((n, idx) => {
          const num = activeNotifs.length - idx;
          const isAdminNotif = n.category === "admin";
          const notifType    = n.notifType || n.type || "";
          const typeClr      = notifType === "공지" ? C.red : (notifType === "참고" ? C.acc : C.pur);
          const themeClr     = isAdminNotif ? typeClr : C.pur;
          const svcDate  = n.serviceDate || (services || []).find(s => s.id === n.serviceId)?.date || "";
          const svcTitle = n.serviceTitle || (services || []).find(s => s.id === n.serviceId)?.title || "";
          return (
            <div key={n.id} className="wFadeIn"
              onClick={() => {
                markNotifRead(n.id);
                if (!isAdminNotif && n.serviceId) nav("svcDetail", { svcId: n.serviceId });
              }}
              style={{
                background: n.read ? C.card : `${themeClr}18`,
                border:`1px solid ${n.read ? C.bdr : `${themeClr}44`}`,
                borderRadius:12, padding:"14px 16px", marginBottom:8, cursor:"pointer",
                display:"flex", alignItems:"flex-start", gap:10,
              }}>
              <div style={{
                width:38, height:38, borderRadius:10, flexShrink:0,
                background: n.read ? C.surf : `${themeClr}33`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontWeight:700, fontSize:14, color: n.read ? C.dim : themeClr,
              }}>
                {isAdminNotif ? (notifType === "공지" ? "📢" : "📌") : num}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2, flexWrap:"wrap" }}>
                  {isAdminNotif && notifType && (
                    <span style={{ fontSize:10, fontWeight:800, color: typeClr,
                      background:`${typeClr}18`, border:`1px solid ${typeClr}44`,
                      borderRadius:4, padding:"1px 6px", letterSpacing:"0.04em" }}>{notifType}</span>
                  )}
                  <span style={{ fontWeight:700, fontSize:14 }}>
                    {isAdminNotif
                      ? (n.title && n.title !== notifType ? n.title : "")
                      : `${n.type ? `[${n.type}]` : ""} ${svcTitle || n.title?.replace(/^\[.*?\]\s*/, "") || ""}`
                    }
                  </span>
                </div>
                {!isAdminNotif && svcDate && (
                  <div style={{ fontSize:11, color:C.acc, fontWeight:600, marginBottom:3 }}>📅 {svcDate}</div>
                )}
                <div style={{ fontSize:13, color:C.dim, lineHeight:1.5 }}>{n.content || n.body}</div>
                <div style={{ fontSize:11, color:C.dim, marginTop:5 }}>{n.time}</div>
              </div>
              {!n.read && (
                <div style={{ width:8, height:8, borderRadius:"50%",
                  background:themeClr, flexShrink:0, marginTop:6 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* admin compose modal */}
      {showCompose && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:3000,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowCompose(false); }}>
          <div style={{ background:C.surf, borderRadius:"20px 20px 0 0", padding:20,
            paddingBottom:"calc(20px + env(safe-area-inset-bottom))",
            width:"100%", maxWidth:540 }}>
            <div style={{ fontWeight:700, fontSize:17, marginBottom:16, color:C.txt }}>공지·참고 작성</div>

            {/* type selector */}
            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              {["공지","참고"].map(t => (
                <button key={t} onClick={() => setCompType(t)}
                  style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none",
                    fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer",
                    background: compType === t
                      ? (t === "공지" ? C.red : C.acc)
                      : C.bg,
                    color: compType === t ? "#fff" : C.dim,
                    transition:"background 0.15s, color 0.15s",
                  }}>{t}</button>
              ))}
            </div>

            {/* optional title */}
            <input
              placeholder="제목 (선택사항)"
              value={compTitle}
              onChange={e => setCompTitle(e.target.value)}
              style={{ width:"100%", boxSizing:"border-box",
                padding:"11px 14px", borderRadius:10,
                border:`1px solid ${C.bdr}`, background:C.bg,
                fontFamily:"inherit", fontSize:14, color:C.txt,
                marginBottom:10, outline:"none" }}
            />

            {/* content */}
            <textarea
              placeholder="내용을 입력하세요..."
              value={compContent}
              onChange={e => setCompContent(e.target.value)}
              rows={4}
              style={{ width:"100%", boxSizing:"border-box",
                padding:"11px 14px", borderRadius:10,
                border:`1px solid ${C.bdr}`, background:C.bg,
                fontFamily:"inherit", fontSize:14, color:C.txt,
                resize:"none", outline:"none", marginBottom:14 }}
            />

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowCompose(false)}
                style={{ flex:1, padding:"12px 0", borderRadius:10, border:"none",
                  background:C.bg, color:C.dim, fontFamily:"inherit",
                  fontWeight:600, fontSize:14, cursor:"pointer" }}>
                취소
              </button>
              <button onClick={sendAdminNotif} disabled={sending || !compContent.trim()}
                style={{ flex:2, padding:"12px 0", borderRadius:10, border:"none",
                  background: compType === "공지" ? C.red : C.acc,
                  color:"#fff", fontFamily:"inherit", fontWeight:700,
                  fontSize:14, cursor: sending ? "wait" : "pointer",
                  opacity: (!compContent.trim() || sending) ? 0.6 : 1,
                  transition:"opacity 0.15s" }}>
                {sending ? "전송 중..." : "전송"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TEAM MANAGEMENT MODAL
══════════════════════════════════════════════════════════════════ */
function TeamManagementModal({ currentUserId, onClose }) {
  const [members,        setMembers]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(null);
  const [editPart,       setEditPart]       = useState(null);
  const [partVal,        setPartVal]        = useState("");
  const [allowedEmails,  setAllowedEmails]  = useState([]); // [{email, role, part}]
  const [emailInput,     setEmailInput]     = useState("");
  const [newRole,        setNewRole]        = useState("member");
  const [newPart,        setNewPart]        = useState("");
  const [addingEmail,    setAddingEmail]    = useState(false);
  const [emailErr,       setEmailErr]       = useState("");
  const [accessRequests, setAccessRequests] = useState([]); // [{email, name, part, message, ...}]
  const [approvingReq,   setApprovingReq]   = useState(null);

  useEffect(() => {
    // 팀원 목록 (1회)
    getDocs(collection(db, "users"))
      .then(snap => {
        const sorted = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
        setMembers(sorted);
        setLoading(false);
      })
      .catch(e => { console.error("팀원 로드 실패:", e); setLoading(false); });

    // 허용 이메일 — 실시간
    const unsub = onSnapshot(collection(db, "allowedEmails"),
      snap => setAllowedEmails(snap.docs.map(d => ({ email: d.id, ...d.data() }))),
      e => console.error("allowedEmails 실패:", e)
    );

    // 액세스 신청 대기 — 실시간
    const unsubReq = onSnapshot(
      query(collection(db, "accessRequests"), where("status", "==", "pending")),
      snap => setAccessRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => console.error("accessRequests 실패:", e)
    );

    return () => { unsub(); unsubReq(); };
  }, []);

  const approveRequest = async (req) => {
    setApprovingReq(req.email);
    try {
      const autoRole = (req.part || "").trim() === "방송" ? "broadcast" : "member";
      await setDoc(doc(db, "allowedEmails", req.email), {
        addedAt: serverTimestamp(),
        role: autoRole,
        part: req.part || "",
      });
      await deleteDoc(doc(db, "accessRequests", req.email));
    } catch (e) {
      setEmailErr("승인 실패: " + e.message);
    } finally {
      setApprovingReq(null);
    }
  };

  const rejectRequest = async (email) => {
    try {
      await deleteDoc(doc(db, "accessRequests", email));
    } catch (e) {
      setEmailErr("거절 실패: " + e.message);
    }
  };

  const addEmail = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || allowedEmails.some(e => e.email === email)) return;
    setAddingEmail(true);
    setEmailErr("");
    try {
      await setDoc(doc(db, "allowedEmails", email), {
        addedAt: serverTimestamp(),
        role: newRole,
        part: newPart.trim(),
      });
      setEmailInput("");
      setNewRole("member");
      setNewPart("");
    } catch (e) {
      setEmailErr("추가 실패: " + (e.code === "permission-denied" ? "권한이 없습니다" : e.message));
    } finally {
      setAddingEmail(false);
    }
  };

  const removeEmail = async (email) => {
    try {
      await deleteDoc(doc(db, "allowedEmails", email));
    } catch (e) {
      setEmailErr("삭제 실패: " + e.message);
    }
  };

  const changeRole = async (uid, newRole) => {
    setSaving(uid + newRole);
    await updateDoc(doc(db, "users", uid), { role: newRole });
    setMembers(p => p.map(u => u.id === uid ? { ...u, role: newRole } : u));
    setSaving(null);
  };

  const savePart = async (uid) => {
    const updates = { part: partVal };
    const member = members.find(u => u.id === uid);
    if (partVal.trim() === "방송" && member?.role === "member") updates.role = "broadcast";
    await updateDoc(doc(db, "users", uid), updates);
    setMembers(p => p.map(u => u.id === uid ? { ...u, ...updates } : u));
    setEditPart(null);
  };

  const ROLES = [["member","멤버"], ["leader","리더"], ["broadcast","방송팀"], ["admin","어드민"]];
  const roleColor = (r) => r === "admin" ? C.red : r === "leader" ? C.acc : r === "broadcast" ? "#ff9f0a" : C.grn;

  return (
    <Modal title={`팀원 관리 · ${members.length}명`} onClose={onClose}>

      {/* ── 액세스 신청 대기 */}
      {accessRequests.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            fontSize:11, fontWeight:700, color:C.dim,
            letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:10,
          }}>
            액세스 신청 대기
            <span style={{
              background:"#ff9f0a", color:"#000",
              fontSize:10, fontWeight:800, borderRadius:10,
              padding:"1px 7px",
            }}>{accessRequests.length}</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {accessRequests.map(req => (
              <div key={req.email} style={{
                background:C.card, borderRadius:12, padding:"12px 14px",
                border:`1px solid #ff9f0a44`,
              }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                  <div style={{
                    width:36, height:36, borderRadius:9, flexShrink:0,
                    background:`linear-gradient(135deg, #ff9f0a33, ${C.pur}22)`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontWeight:800, fontSize:14, color:"#ff9f0a",
                  }}>{(req.name || "?")[0]}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>{req.name}</div>
                    <div style={{ fontSize:11, color:C.dim, marginTop:1,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {req.email}
                    </div>
                    {req.part && (
                      <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>파트: {req.part}</div>
                    )}
                    {req.message && (
                      <div style={{ fontSize:12, color:`${C.dim}cc`, marginTop:4,
                        fontStyle:"italic", lineHeight:1.5 }}>
                        "{req.message}"
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, marginTop:10 }}>
                  <button onClick={() => approveRequest(req)}
                    disabled={approvingReq === req.email}
                    style={{
                      flex:1, padding:"7px 0", borderRadius:8, border:"none",
                      background:`${C.grn}22`, color:C.grn,
                      fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                      opacity: approvingReq === req.email ? 0.5 : 1,
                    }}>
                    {approvingReq === req.email ? "처리 중..." : "✓ 승인"}
                  </button>
                  <button onClick={() => rejectRequest(req.email)} style={{
                    flex:1, padding:"7px 0", borderRadius:8, border:"none",
                    background:`${C.red}11`, color:C.red,
                    fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                  }}>✕ 거절</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:"center", padding:"30px 0", color:C.dim, fontSize:13 }}>불러오는 중...</div>
      ) : members.length === 0 ? (
        <div style={{ textAlign:"center", padding:"30px 0", color:C.dim, fontSize:13 }}>팀원이 없습니다</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {members.map(m => (
            <div key={m.id} style={{
              background:C.card, borderRadius:12, padding:"12px 14px",
              border:`1px solid ${m.id === currentUserId ? C.acc : C.bdr}`,
            }}>
              {/* 이름·이메일·파트 */}
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <div style={{
                  width:36, height:36, borderRadius:9, flexShrink:0,
                  background:`linear-gradient(135deg, ${roleColor(m.role)}33, ${C.pur}22)`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontWeight:800, fontSize:14, color:roleColor(m.role),
                }}>{(m.name || "?")[0]}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, display:"flex", alignItems:"center", gap:6 }}>
                    {m.name}
                    {m.id === currentUserId && (
                      <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>(나)</span>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:C.dim, marginTop:1,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {m.email}
                  </div>
                </div>
                <Badge
                  label={m.role === "admin" ? "어드민" : m.role === "leader" ? "리더" : m.role === "broadcast" ? "방송팀" : "멤버"}
                  color={roleColor(m.role)} />
              </div>

              {/* 파트 편집 */}
              {editPart === m.id ? (
                <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                  <input
                    value={partVal}
                    onChange={e => setPartVal(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && savePart(m.id)}
                    placeholder="예) 건반, 기타, 드럼"
                    autoFocus
                    style={{
                      flex:1, background:C.surf, border:`1.5px solid ${C.acc}`,
                      color:C.txt, padding:"6px 10px", borderRadius:8,
                      fontSize:12, outline:"none", fontFamily:"inherit",
                    }}
                  />
                  <button onClick={() => savePart(m.id)} style={{
                    background:C.acc, border:"none", borderRadius:8,
                    padding:"6px 12px", cursor:"pointer",
                    fontSize:12, fontWeight:700, color:"#111", fontFamily:"inherit",
                  }}>저장</button>
                  <button onClick={() => setEditPart(null)} style={{
                    background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:8,
                    padding:"6px 10px", cursor:"pointer",
                    fontSize:12, color:C.dim, fontFamily:"inherit",
                  }}>취소</button>
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                  <span style={{ fontSize:12, color:C.dim, flex:1 }}>
                    {m.part || <span style={{ color:`${C.dim}88` }}>파트 미설정</span>}
                  </span>
                  <button onClick={() => { setEditPart(m.id); setPartVal(m.part || ""); }} style={{
                    background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6,
                    padding:"3px 8px", cursor:"pointer",
                    fontSize:11, color:C.dim, fontFamily:"inherit",
                  }}>파트 수정</button>
                </div>
              )}

              {/* 역할 변경 (자기 자신 제외) */}
              {m.id !== currentUserId && (
                <div style={{ display:"flex", gap:5 }}>
                  {ROLES.map(([r, label]) => (
                    <button key={r}
                      onClick={() => changeRole(m.id, r)}
                      disabled={saving === m.id + r || m.role === r}
                      style={{
                        flex:1, padding:"5px 0", borderRadius:7, border:"none",
                        cursor: m.role === r ? "default" : "pointer",
                        fontFamily:"inherit", fontWeight:600, fontSize:11,
                        background: m.role === r ? `${roleColor(r)}22` : C.surf,
                        color:       m.role === r ? roleColor(r)         : C.dim,
                        border: `1px solid ${m.role === r ? roleColor(r) + "55" : C.bdr}`,
                        opacity: saving === m.id + r ? 0.5 : 1,
                        transition:"all .15s",
                      }}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 허용 이메일 목록 */}
      <div style={{ marginTop:20 }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:10 }}>
          로그인 허용 이메일
        </div>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, lineHeight:1.6 }}>
          등록된 Gmail만 로그인 가능합니다. 새 팀원이 처음 로그인하기 전에 여기서 먼저 추가하세요.
        </div>

        {/* 이메일 추가 입력 */}
        <div style={{
          background:C.card, border:`1.5px solid ${C.bdr}`,
          borderRadius:10, padding:"12px 12px 10px", marginBottom:10,
          display:"flex", flexDirection:"column", gap:8,
        }}>
          <input
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addEmail()}
            placeholder="example@gmail.com"
            style={{
              background:C.surf, border:`1px solid ${C.bdr}`,
              color:C.txt, padding:"8px 10px", borderRadius:8,
              fontSize:12, outline:"none", fontFamily:"inherit", width:"100%", boxSizing:"border-box",
            }}
          />
          {/* 권한 선택 */}
          <div style={{ display:"flex", gap:5 }}>
            {[["member","멤버",C.grn],["leader","리더",C.acc],["admin","어드민",C.red]].map(([r, label, clr]) => (
              <button key={r} onClick={() => setNewRole(r)} style={{
                flex:1, padding:"5px 0", borderRadius:7, cursor:"pointer",
                fontFamily:"inherit", fontWeight:600, fontSize:11,
                border: `1px solid ${newRole === r ? clr + "99" : C.bdr}`,
                background: newRole === r ? clr + "22" : C.surf,
                color: newRole === r ? clr : C.dim,
                transition:"all .15s",
              }}>{label}</button>
            ))}
          </div>
          {/* 파트 입력 */}
          <div style={{ display:"flex", gap:6 }}>
            <input
              value={newPart}
              onChange={e => setNewPart(e.target.value)}
              placeholder="파트 (예: 건반, 기타, 드럼)"
              style={{
                flex:1, background:C.surf, border:`1px solid ${C.bdr}`,
                color:C.txt, padding:"7px 10px", borderRadius:8,
                fontSize:12, outline:"none", fontFamily:"inherit",
              }}
            />
            <button onClick={addEmail} disabled={addingEmail || !emailInput.trim()} style={{
              background:C.acc, border:"none", borderRadius:8,
              padding:"7px 16px", cursor:"pointer",
              fontSize:12, fontWeight:700, color:"#111", fontFamily:"inherit",
              opacity: addingEmail || !emailInput.trim() ? 0.5 : 1,
              flexShrink:0,
            }}>추가</button>
          </div>
        </div>
        {emailErr && (
          <div style={{ fontSize:12, color:C.red, marginBottom:8,
            background:`${C.red}11`, padding:"7px 10px", borderRadius:8 }}>
            {emailErr}
          </div>
        )}

        {/* 허용된 이메일 목록 */}
        {allowedEmails.length === 0 ? (
          <div style={{
            padding:"14px", borderRadius:8, textAlign:"center",
            background:C.card, border:`1px dashed ${C.bdr}`,
            fontSize:12, color:`${C.dim}88`,
          }}>
            허용된 이메일이 없습니다 (부트스트랩 모드 — 누구나 로그인 가능)
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {allowedEmails.map(item => {
              const clr = item.role === "admin" ? C.red : item.role === "leader" ? C.acc : C.grn;
              const roleLabel = item.role === "admin" ? "어드민" : item.role === "leader" ? "리더" : "멤버";
              return (
                <div key={item.email} style={{
                  display:"flex", alignItems:"center", gap:8,
                  padding:"8px 10px", borderRadius:8,
                  background:C.card, border:`1px solid ${C.bdr}`,
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, color:C.txt,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {item.email}
                    </div>
                    {item.part && (
                      <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{item.part}</div>
                    )}
                  </div>
                  <span style={{
                    fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:5,
                    background:`${clr}22`, color:clr, flexShrink:0,
                  }}>{roleLabel}</span>
                  <button onClick={() => removeEmail(item.email)} style={{
                    background:"transparent", border:"none", cursor:"pointer",
                    padding:4, display:"flex", flexShrink:0,
                  }}>
                    <Icon n="xmark" size={14} color={C.dim} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PROFILE SCREEN
══════════════════════════════════════════════════════════════════ */
function ProfileScreen({ user, onLogout, onRoleUpdate }) {
  const [showTeam,    setShowTeam]    = useState(false);
  const [claiming,    setClaiming]    = useState(false);
  const [noLeader,    setNoLeader]    = useState(false);
  const [showInfo,    setShowInfo]    = useState(false);
  const [showHelp,    setShowHelp]    = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showApiKey,      setShowApiKey]      = useState(false);
  const [apiKeyInput,     setApiKeyInput]     = useState(user?.geminiKey || "");
  const [apiKeySaving,    setApiKeySaving]    = useState(false);
  const [apiKeyErr,       setApiKeyErr]       = useState("");
  const [apiKeyTesting,   setApiKeyTesting]   = useState(false);
  const [apiKeyOk,        setApiKeyOk]        = useState(false);
  const [showSharedKey,   setShowSharedKey]   = useState(false);
  const [sharedKeyInput,  setSharedKeyInput]  = useState("");
  const [sharedKeySaving, setSharedKeySaving] = useState(false);

  const testApiKey = async () => {
    const k = apiKeyInput.trim();
    if (!k) return;
    setApiKeyTesting(true); setApiKeyErr(""); setApiKeyOk(false);
    try {
      if (k.startsWith("gsk_")) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${k}` },
          body: JSON.stringify({ model:"meta-llama/llama-4-scout-17b-16e-instruct", messages:[{ role:"user", content:"Hi" }], max_tokens:1 }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error.message || "오류");
      } else {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k}`,
          { method:"POST", headers:{"content-type":"application/json"},
            body: JSON.stringify({ contents:[{ parts:[{ text:"Hi" }] }] }) }
        );
        const d = await res.json();
        if (d.error) throw new Error(d.error.message || "오류");
      }
      setApiKeyOk(true);
    } catch(e) {
      setApiKeyErr("키 오류: " + e.message);
    } finally {
      setApiKeyTesting(false);
    }
  };

  const saveApiKey = async () => {
    setApiKeySaving(true); setApiKeyErr("");
    try {
      await setDoc(doc(db, "users", user.uid), { geminiKey: apiKeyInput.trim() }, { merge: true });
      setShowApiKey(false);
    } catch(e) {
      setApiKeyErr("저장 실패: " + e.message);
    } finally {
      setApiKeySaving(false);
    }
  };

  useEffect(() => {
    if (isLeader(user.role)) return;
    getDocs(query(collection(db, "users"), where("role", "in", ["leader", "admin"]), limit(1)))
      .then(snap => setNoLeader(snap.empty));
  }, [user.role]);

  const claimLeader = async () => {
    setClaiming(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { role: "admin" });
      onRoleUpdate();
    } catch {
      setClaiming(false);
    }
  };

  return (
    <div style={{ height:"100%", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* 헤더 */}
      <div style={{ background:C.surf, padding:"18px 20px", flexShrink:0,
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>내 정보</div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:20, paddingBottom:90 }}>

      {/* 내 프로필 카드 */}
      <div style={{ background:C.surf, borderRadius:16, padding:20,
        marginBottom:12, border:`1px solid ${C.bdr}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{
            width:54, height:54, borderRadius:14,
            background:`linear-gradient(135deg, ${C.acc}, ${C.pur})`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:22, fontWeight:800, color:"#111", flexShrink:0,
          }}>{(user.name || "?")[0]}</div>
          <div>
            <div style={{ fontWeight:700, fontSize:16 }}>{user.name}</div>
            <div style={{ fontSize:13, color:C.dim, marginTop:2 }}>{user.email}</div>
            <div style={{ marginTop:8, display:"flex", gap:6, alignItems:"center" }}>
              <Badge
                label={user.role === "admin" ? "어드민" : user.role === "leader" ? "리더" : "멤버"}
                color={user.role === "admin" ? C.red : user.role === "leader" ? C.acc : C.grn} />
              {user.part && <span style={{ fontSize:12, color:C.dim }}>{user.part}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 리더 권한 설정 (리더가 없을 때만 표시) */}
      {user.role !== "leader" && noLeader && (
        <div style={{
          background:`${C.acc}11`, border:`1px solid ${C.acc}44`,
          borderRadius:14, padding:16, marginBottom:12,
        }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>리더 권한 설정</div>
          <div style={{ fontSize:13, color:C.dim, marginBottom:12 }}>
            예배 일정 생성·관리, 악보 업로드, 팀원 관리 기능이 활성화됩니다.
          </div>
          <Btn label={claiming ? "설정 중..." : "이 계정을 리더로 설정"} icon="plus"
            onClick={claimLeader} disabled={claiming} full />
        </div>
      )}

      {/* 팀 관리 (어드민만) */}
      {user.role === "admin" && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
            textTransform:"uppercase", marginBottom:10 }}>팀 관리</div>
          <Btn label="팀원 관리" icon="user" onClick={() => setShowTeam(true)}
            full variant="outline" />
        </div>
      )}

      {/* 악보 넘기기 설정 */}
      {(() => {
        const [tapOn,   setTapOn]   = useState(() => localStorage.getItem("tvpc_tapNav")   !== "0");
        const [swipeOn, setSwipeOn] = useState(() => localStorage.getItem("tvpc_swipeNav") !== "0");
        const toggle = (key, val, setter) => {
          if (!val && key === "tvpc_tapNav"   && !swipeOn) return;
          if (!val && key === "tvpc_swipeNav" && !tapOn)   return;
          localStorage.setItem(key, val ? "1" : "0");
          setter(val);
        };
        const Row = ({ label, desc, on, onToggle }) => (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"12px 16px", borderBottom:`1px solid ${C.bdr}` }}>
            <div>
              <div style={{ fontSize:14, color:C.txt }}>{label}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{desc}</div>
            </div>
            <button onClick={onToggle} style={{
              width:44, height:26, borderRadius:13, border:"none", cursor:"pointer",
              background: on ? C.grn : C.bdr, position:"relative", flexShrink:0,
              transition:"background 0.2s",
            }}>
              <div style={{
                position:"absolute", top:3, left: on ? 21 : 3,
                width:20, height:20, borderRadius:"50%", background:"#fff",
                transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
              }} />
            </button>
          </div>
        );
        return (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:8 }}>악보 넘기기</div>
            <div style={{ background:C.card, borderRadius:12, overflow:"hidden", border:`1px solid ${C.bdr}` }}>
              <Row label="탭 이동" desc="화면 좌/우 탭으로 페이지 넘기기"
                on={tapOn}   onToggle={() => toggle("tvpc_tapNav",   !tapOn,   setTapOn)} />
              <Row label="스와이프 이동" desc="손가락 좌/우 드래그로 페이지 넘기기"
                on={swipeOn} onToggle={() => toggle("tvpc_swipeNav", !swipeOn, setSwipeOn)} />
            </div>
          </div>
        );
      })()}

      <div style={{ background:C.card, borderRadius:12, overflow:"hidden",
        border:`1px solid ${C.bdr}`, marginBottom:16 }}>
        {[
          { label:`앱 정보 (v${APP_VERSION})`, action: () => setShowInfo(true) },
          { label: user?.geminiKey ? "AI 코드 감지 키 (설정됨 ✓)" : "AI 코드 감지 키 설정", action: () => { setApiKeyInput(user?.geminiKey || ""); setShowApiKey(true); } },
          ...(isLeader(user?.role) ? [{ label:"🔑 공유 AI 키 설정 (멤버용)", action: async () => { const d = await getDoc(doc(db,"settings","app")); setSharedKeyInput(d.exists() ? (d.data().sharedGeminiKey||"") : ""); setShowSharedKey(true); } }] : []),
          { label:"도움말",         action: () => setShowHelp(true) },
          { label:"문의하기",       action: () => setShowContact(true) },
        ].map((item, i, arr) => (
          <div key={i} onClick={item.action} style={{
            padding:"14px 16px",
            borderBottom: i < arr.length - 1 ? `1px solid ${C.bdr}` : "none",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            cursor:"pointer",
          }}>
            <span style={{ fontSize:14 }}>{item.label}</span>
            <Icon n="chevR" size={15} color={C.dim} />
          </div>
        ))}
      </div>

      <Btn label="로그아웃" icon="logout" onClick={onLogout} variant="ghost" full />

      {showTeam && <TeamManagementModal currentUserId={user.uid} onClose={() => setShowTeam(false)} />}

      {/* Gemini API 키 설정 */}
      {showApiKey && (
        <Modal title="AI 코드 감지 키 설정" onClose={() => setShowApiKey(false)}>
          <div style={{ padding:"4px 0 8px" }}>
            <div style={{ fontSize:13, color:C.dim, marginBottom:12, lineHeight:1.6 }}>
              AI 키를 설정하면 코드 감지를 사용할 수 있습니다.<br />
              <span style={{ color:C.acc, fontWeight:700 }}>Groq 추천 (완전 무료)</span> — <span style={{ color:C.acc }}>console.groq.com</span> 에서 가입 후 API Keys 생성 → <code style={{ fontSize:11 }}>gsk_...</code> 형식<br />
              <span style={{ color:C.dim }}>Gemini: aistudio.google.com → <code style={{ fontSize:11 }}>AIzaSy...</code> 형식</span>
            </div>
            {user?.geminiKey && (
              <div style={{ fontSize:11, color:C.dim, marginBottom:8, fontFamily:"monospace",
                background:C.surf, borderRadius:6, padding:"6px 10px" }}>
                저장된 키: {user.geminiKey.slice(0,8)}••••{user.geminiKey.slice(-4)}
              </div>
            )}
            <input
              value={apiKeyInput}
              onChange={e => { setApiKeyInput(e.target.value); setApiKeyOk(false); setApiKeyErr(""); }}
              placeholder="gsk_... 또는 AIzaSy..."
              style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                border:`1px solid ${apiKeyOk ? C.grn : apiKeyErr ? C.red : C.bdr}`,
                background:C.surf, color:C.txt, fontSize:13, fontFamily:"monospace",
                boxSizing:"border-box", marginBottom:8, outline:"none" }}
            />
            {apiKeyOk && <div style={{ fontSize:11, color:C.grn, marginBottom:8 }}>✓ 키 정상 작동 확인됨</div>}
            {apiKeyErr && <div style={{ fontSize:11, color:C.red, marginBottom:8 }}>{apiKeyErr}</div>}
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <button onClick={testApiKey} disabled={apiKeyTesting || !apiKeyInput.trim()}
                style={{ padding:"8px 14px", borderRadius:8, border:`1px solid ${C.bdr}`,
                  background:"transparent", color:C.dim, fontSize:12, cursor:"pointer",
                  fontFamily:"inherit", opacity: apiKeyTesting || !apiKeyInput.trim() ? 0.5 : 1 }}>
                {apiKeyTesting ? "테스트 중..." : "키 테스트"}
              </button>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <Btn label={apiKeySaving ? "저장 중..." : "저장"} onClick={saveApiKey}
                disabled={apiKeySaving || !apiKeyInput.trim()} full />
              {user?.geminiKey && (
                <button onClick={async () => {
                  await updateDoc(doc(db, "users", user.uid), { geminiKey: "" });
                  setApiKeyInput("");
                  setShowApiKey(false);
                }} style={{ padding:"10px 16px", borderRadius:8, border:`1px solid ${C.bdr}`,
                  background:"transparent", color:C.red, fontSize:13, cursor:"pointer",
                  fontFamily:"inherit", whiteSpace:"nowrap" }}>삭제</button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 앱 정보 */}
      {showInfo && (
        <Modal title="앱 정보" onClose={() => setShowInfo(false)}>
          <div style={{ textAlign:"center", padding:"8px 0 16px" }}>
            <img src="/icon-192.png" width={64} height={64}
              style={{ borderRadius:16, marginBottom:12 }} alt="Ainos" />
            <div style={{ fontWeight:800, fontSize:18, marginBottom:4 }}>TVPC Worship</div>
            <div style={{ fontSize:13, color:C.dim, marginBottom:16 }}>버전 {APP_VERSION}</div>
            <div style={{ fontSize:12, color:C.dim, lineHeight:1.8, textAlign:"left" }}>
              찬양팀 악보 관리 및 예배 준비를 위한 앱입니다.<br />
              악보 업로드, 필기, 코드 전조, 예배 일정 관리 등<br />
              찬양팀에 필요한 기능을 제공합니다.
            </div>
          </div>
          <Btn label="확인" full onClick={() => setShowInfo(false)} />
        </Modal>
      )}

      {/* 공유 Gemini 키 설정 (admin/leader) */}
      {showSharedKey && (
        <Modal title="🔑 공유 AI 키 설정" onClose={() => setShowSharedKey(false)}>
          <div style={{ fontSize:13, color:C.dim, marginBottom:12, lineHeight:1.6 }}>
            여기서 설정한 키는 본인 키가 없는 모든 멤버에게 자동으로 적용됩니다.
          </div>
          <input
            value={sharedKeyInput}
            onChange={e => setSharedKeyInput(e.target.value)}
            placeholder="AIza..."
            style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:`1px solid ${C.bdr}`,
              fontSize:13, fontFamily:"monospace", boxSizing:"border-box", marginBottom:12 }}
          />
          <div style={{ display:"flex", gap:8 }}>
            <Btn label={sharedKeySaving ? "저장 중…" : "저장"} full onClick={async () => {
              setSharedKeySaving(true);
              await setDoc(doc(db,"settings","app"), { sharedGeminiKey: sharedKeyInput.trim() }, { merge:true });
              setSharedKeySaving(false);
              setShowSharedKey(false);
            }} />
            {sharedKeyInput && (
              <Btn label="삭제" full onClick={async () => {
                await setDoc(doc(db,"settings","app"), { sharedGeminiKey:"" }, { merge:true });
                setShowSharedKey(false);
              }} />
            )}
          </div>
        </Modal>
      )}

      {/* 도움말 */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* 문의하기 */}
      {showContact && (
        <Modal title="문의하기" onClose={() => setShowContact(false)}>
          <div style={{ textAlign:"center", padding:"8px 0 20px" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✉️</div>
            <div style={{ fontSize:14, color:C.dim, marginBottom:16, lineHeight:1.7 }}>
              앱 사용 중 문의사항이나 오류가 있으면<br />아래 이메일로 연락해 주세요.
            </div>
            <div style={{ background:C.card, borderRadius:10, padding:"12px 16px",
              border:`1px solid ${C.bdr}`, fontSize:15, fontWeight:700, letterSpacing:"0.01em" }}>
              terrysf@gmail.com
            </div>
          </div>
          <Btn label="이메일 보내기" full onClick={() => window.location.href = "mailto:terrysf@gmail.com"} />
        </Modal>
      )}
      </div>  {/* scrollable */}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   LIVE SCREEN
══════════════════════════════════════════════════════════════════ */
const LIVE_TEAMS = [
  { id:"audio",    label:"음향팀",  icon:"🎚️" },
  { id:"video",    label:"영상팀",  icon:"📹" },
  { id:"subtitle", label:"자막팀",  icon:"🅣"  },
  { id:"lighting", label:"조명팀",  icon:"💡" },
];

const QUICK_CUES = [
  { id:"next",   label:"다음 곡",   color:"#5856D6" },
  { id:"prev",   label:"이전 곡",   color:"#34C759" },
  { id:"hold",   label:"HOLD",     color:"#FF9500" },
  { id:"repeat", label:"반복",     color:"#1A73E8" },
  { id:"end",    label:"예배 종료", color:"#FF3B30" },
];

const QUICK_MSGS = [
  { label:"준비 완료",     color:"#34C759", emoji:"✅" },
  { label:"다음 곡 준비",  color:"#5856D6", emoji:"▶️" },
  { label:"볼륨 조금 올림", color:"#FF9500", emoji:"🔊" },
  { label:"볼륨 조금 내림", color:"#FF9500", emoji:"🔉" },
  { label:"영상 2번 준비",  color:"#1A73E8", emoji:"📹" },
  { label:"마이크 ON",     color:"#34C759", emoji:"🎤" },
  { label:"마이크 OFF",    color:"#8E8E93", emoji:"🔇" },
  { label:"문제 있음",     color:"#FF3B30", emoji:"⚠️" },
];

const YT_API_KEY    = "AIzaSyAovkFPiwtvsAc66ihHjSdwdkLOqkoXgDo";
const YT_CHANNEL_ID = "UCZrRfMxUpuVv7e4JqlesJ1w";

function LiveScreen({ user, services, songs, nav, anyLiveActive }) {
  const leader = isLeader(user.role);
  const [liveTab,       setLiveTab]       = useState("live");
  const [selSvcId,      setSelSvcId]      = useState(null);
  const [session,       setSession]       = useState(null);
  const [cues,          setCues]          = useState({});
  const [elapsed,       setElapsed]       = useState(0);
  const [showSvcPicker, setShowSvcPicker] = useState(false);
  const [chatMessages,  setChatMessages]  = useState([]);
  const [chatInput,     setChatInput]     = useState("");
  const [announcMsg,    setAnnouncMsg]    = useState("");
  const [showAnnounce,  setShowAnnounce]  = useState(false);
  const [songDuration,  setSongDuration]  = useState(() => {
    try { return parseInt(localStorage.getItem("tvpc_songDuration") || "240", 10); } catch { return 240; }
  });
  const [ppConfig,      setPpConfig]      = useState(() => {
    try { return JSON.parse(localStorage.getItem("tvpc_ppConfig") || "{}"); } catch { return {}; }
  });
  const [ppConnected,    setPpConnected]    = useState(false);
  const [ppChecking,     setPpChecking]     = useState(false);
  const [ppPresentation, setPpPresentation] = useState(null);
  const [isDesktop,      setIsDesktop]      = useState(() => window.innerWidth >= 900);
  const [ytLive,         setYtLive]         = useState(null);
  const timerRef      = useRef(null);
  const chatEndRef    = useRef(null);
  const ppLastSyncRef = useRef(null);

  useEffect(() => {
    const h = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const recentServices = useMemo(() => {
    const today = new Date().toISOString().slice(0,10);
    const cutoff = new Date(Date.now() - 21 * 86400000).toISOString().slice(0,10);
    return [...services]
      .filter(s => s.date >= cutoff)
      .sort((a,b) => {
        // 오늘 이후 예배(다음 예배)를 앞으로, 그 중 가장 가까운 날짜 우선
        const aFuture = a.date >= today;
        const bFuture = b.date >= today;
        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;
        return aFuture
          ? a.date.localeCompare(b.date)   // 미래: 가장 가까운 날 먼저
          : b.date.localeCompare(a.date);  // 과거: 가장 최근 먼저
      })
      .slice(0, 8);
  }, [services]);

  useEffect(() => {
    if (!selSvcId && recentServices.length > 0) setSelSvcId(recentServices[0].id);
  }, [recentServices, selSvcId]);

  useEffect(() => {
    if (!selSvcId) return;
    return onSnapshot(doc(db, "liveSession", selSvcId), snap =>
      setSession(snap.exists() ? snap.data() : null)
    );
  }, [selSvcId]);

  useEffect(() => {
    if (!selSvcId) return;
    return onSnapshot(doc(db, "liveCues", selSvcId), snap =>
      setCues(snap.exists() ? (snap.data().teams || {}) : {})
    );
  }, [selSvcId]);

  useEffect(() => {
    if (!selSvcId) return;
    const q = query(
      collection(db, "liveChat", selSvcId, "messages"),
      orderBy("createdAt", "asc"),
      limit(100)
    );
    return onSnapshot(q, snap =>
      setChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [selSvcId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (session?.timerRunning) {
      const tick = () => {
        const base = session.timerElapsed || 0;
        const startedAt = session.timerStartedAt?.toDate?.()?.getTime() || Date.now();
        setElapsed(Math.floor(base + (Date.now() - startedAt) / 1000));
      };
      tick();
      timerRef.current = setInterval(tick, 500);
    } else {
      setElapsed(Math.floor(session?.timerElapsed || 0));
    }
    return () => clearInterval(timerRef.current);
  }, [session?.timerRunning, session?.timerStartedAt, session?.timerElapsed]);

  const selSvc     = services.find(s => s.id === selSvcId);
  const svcSongs   = useMemo(() =>
    (selSvc?.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean),
    [selSvc, songs]
  );
  const activeIdx  = session?.activeSongIdx ?? 0;
  const currentSong = svcSongs[activeIdx];
  const nextSong   = svcSongs[activeIdx + 1];
  const fmtSec  = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const fmtHHMM = (d) => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  const progress = Math.min(1, songDuration > 0 ? elapsed / songDuration : 0);
  const nextExpected = fmtHHMM(new Date(Date.now() + Math.max(0, songDuration - elapsed) * 1000));

  const ppAllSlides = useMemo(() => {
    if (!ppPresentation?.groups) return [];
    const result = [];
    for (const group of ppPresentation.groups) {
      for (const slide of (group.slides || [])) {
        const lines = (slide.text || "").split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) result.push(lines.join("\n"));
      }
    }
    return result;
  }, [ppPresentation]);

  const setActiveIdx = async (idx) => {
    if (!selSvcId) return;
    await setDoc(doc(db, "liveSession", selSvcId), {
      activeSongIdx: idx, timerElapsed: 0,
      timerRunning: false, timerStartedAt: null,
      updatedAt: serverTimestamp(), updatedBy: user.uid,
    }, { merge: true });
  };

  const toggleTimer = async () => {
    if (!selSvcId) return;
    const ref = doc(db, "liveSession", selSvcId);
    if (session?.timerRunning) {
      const base = session.timerElapsed || 0;
      const startedAt = session.timerStartedAt?.toDate?.()?.getTime() || Date.now();
      await setDoc(ref, {
        timerRunning: false,
        timerElapsed: base + (Date.now() - startedAt) / 1000,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } else {
      await setDoc(ref, {
        timerRunning: true, timerStartedAt: serverTimestamp(),
        timerElapsed: session?.timerElapsed || 0,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  };

  const resetTimer = async () => {
    if (!selSvcId) return;
    await setDoc(doc(db, "liveSession", selSvcId), {
      timerRunning: false, timerElapsed: 0, timerStartedAt: null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const sendCue = async (teamId, msg, status) => {
    if (!selSvcId) return;
    await setDoc(doc(db, "liveCues", selSvcId), {
      teams: { [teamId]: {
        status, msg, updatedAt: serverTimestamp(),
        updatedBy: user.uid, updatedByName: user.name || user.email,
      }}
    }, { merge: true });
  };

  const roleLbl = (r) => ({leader:"리더",broadcast:"방송팀",admin:"어드민",member:"멤버"})[r] || "";
  const avatarColor = (uid) => {
    const cols = ["#5856D6","#34C759","#1A73E8","#FF9500","#AF52DE","#32ADE6","#FF6B6B"];
    let h = 0;
    for (let i = 0; i < (uid||"").length; i++) h = (h * 31 + uid.charCodeAt(i)) & 0xFFFFFF;
    return cols[Math.abs(h) % cols.length];
  };

  const sendChat = async (text) => {
    if (!selSvcId || !text.trim()) return;
    await addDoc(collection(db, "liveChat", selSvcId, "messages"), {
      text: text.trim(), createdAt: serverTimestamp(),
      uid: user.uid, name: user.name || user.email,
      role: user.role, type: "chat",
    });
  };

  const sendAnnounce = async () => {
    if (!selSvcId || !announcMsg.trim()) return;
    await addDoc(collection(db, "liveChat", selSvcId, "messages"), {
      text: announcMsg.trim(), createdAt: serverTimestamp(),
      uid: user.uid, name: user.name || user.email,
      role: user.role, type: "announce",
    });
    setAnnouncMsg(""); setShowAnnounce(false); setLiveTab("chat");
  };

  const ChatMsg = ({ msg }) => {
    const isOwn = msg.uid === user.uid;
    const col   = avatarColor(msg.uid);
    const parts = [roleLbl(msg.role), msg.name].filter(Boolean);
    const displayName = parts.join(" ");
    const timeStr = msg.createdAt?.toDate
      ? new Date(msg.createdAt.toDate()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})
      : "";
    return (
      <div style={{ display:"flex", gap:10, padding:"10px 0",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0,
          background: col, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon n="user" size={16} color="#fff" />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:3 }}>
            <span style={{ fontSize:13, fontWeight:700, color: isOwn ? C.pur : C.txt }}>
              {displayName}
            </span>
            <span style={{ fontSize:11, color:C.dim, flexShrink:0, marginLeft:8 }}>{timeStr}</span>
          </div>
          {msg.type === "announce" ? (
            <div style={{ fontSize:13, color:C.pur, fontWeight:600 }}>📣 {msg.text}</div>
          ) : (
            <div style={{ fontSize:13, color:C.txt, lineHeight:1.4 }}>{msg.text}</div>
          )}
        </div>
        {isOwn && (
          <Icon n="check" size={13} color={C.dim} />
        )}
      </div>
    );
  };

  const ppBase  = ppConfig.ip ? `https://${ppConfig.ip}:${ppConfig.proxyPort || "1027"}` : null;
  const ppFetch = useCallback(async (path, method = "GET") => {
    if (!ppBase) return null;
    try {
      const res = await fetch(`${ppBase}${path}`, { method });
      return res.ok ? await res.json().catch(() => ({})) : null;
    } catch { return null; }
  }, [ppBase]);

  const ppConnect = async () => {
    setPpChecking(true);
    const data = await ppFetch("/v1/presentation/active");
    setPpConnected(!!data);
    setPpChecking(false);
    localStorage.setItem("tvpc_ppConfig", JSON.stringify(ppConfig));
  };

  // Auto-connect on mount if config already saved
  useEffect(() => {
    if (ppConfig.ip) ppConnect();
  }, []); // eslint-disable-line

  // Poll ProPresenter for current presentation every 2s
  useEffect(() => {
    if (!ppConnected) { setPpPresentation(null); return; }
    const poll = async () => {
      const data = await ppFetch("/v1/presentation/active");
      if (data?.presentation) setPpPresentation(data.presentation);
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [ppConnected, ppFetch]);



  // Auto-sync active song when PP presentation changes
  useEffect(() => {
    if (!ppPresentation?.id?.name || !svcSongs.length || !selSvcId) return;
    const ppName = ppPresentation.id.name.toLowerCase().trim();
    if (ppName === ppLastSyncRef.current) return;
    const idx = svcSongs.findIndex(s => {
      const t = s.title.toLowerCase().trim();
      return ppName.includes(t) || t.includes(ppName) || t === ppName;
    });
    if (idx !== -1 && idx !== activeIdx) {
      ppLastSyncRef.current = ppName;
      setActiveIdx(idx);
    }
  }, [ppPresentation, svcSongs, selSvcId]);

  // YouTube live status polling
  useEffect(() => {
    const fetchYt = async () => {
      try {
        const searchRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=id,snippet&channelId=${YT_CHANNEL_ID}&eventType=live&type=video&key=${YT_API_KEY}`
        );
        const searchData = await searchRes.json();
        if (searchData.items?.length > 0) {
          const item = searchData.items[0];
          const videoId = item.id.videoId;
          const title   = item.snippet.title;
          const thumb   = item.snippet.thumbnails?.medium?.url;
          const detailRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${YT_API_KEY}`
          );
          const detailData = await detailRes.json();
          const viewers = detailData.items?.[0]?.liveStreamingDetails?.concurrentViewers ?? null;
          setYtLive({ title, viewers, videoId, thumb });
        } else {
          setYtLive(null);
        }
      } catch (e) {
        console.error("YT fetch error", e);
      }
    };
    fetchYt();
    const id = setInterval(fetchYt, 30000);
    return () => clearInterval(id);
  }, []);

  const statusColor = (st) =>
    st === "ready" ? C.grn : st === "done" ? C.acc : st === "issue" ? C.red : C.bdr;

  const tabStyle = (active) => ({
    flex:1, padding:"10px 0", background:"none", border:"none",
    borderBottom: `2px solid ${active ? C.acc : "transparent"}`,
    color: active ? C.acc : C.dim, fontSize:12, fontWeight: active ? 700 : 500,
    cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap",
  });
  const cueBtn = (active, col) => ({
    padding:"5px 11px", background: active ? col : `${col}18`,
    border:`1px solid ${col}`, borderRadius:7, cursor:"pointer",
    fontSize:11, fontWeight:700, color: active ? "#fff" : col, fontFamily:"inherit",
  });

  /* ────────────────────────── DESKTOP LAYOUT ────────────────────────── */
  if (isDesktop) {
    const dTabStyle = (active) => ({
      padding:"14px 20px", background:"none", border:"none",
      borderBottom:`2px solid ${active ? C.pur : "transparent"}`,
      color: active ? C.pur : C.dim, fontSize:13, fontWeight: active ? 700 : 500,
      cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap",
    });
    const teamColor = { audio:"#34C759", video:"#1A73E8", subtitle:"#5856D6", lighting:"#FF9500" };
    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.bg, overflow:"hidden" }}>

        {/* ─ Desktop Header ─ */}
        <div style={{ background:C.surf, borderBottom:`1px solid ${C.bdr}`, flexShrink:0 }}>
          {/* Safe-area spacer */}
          <div style={{ height:"env(safe-area-inset-top)" }} />
          <div style={{ height:52, display:"flex", alignItems:"center", padding:"0 20px", gap:14 }}>
          <button onClick={() => setShowSvcPicker(p => !p)} style={{
            display:"flex", alignItems:"center", gap:8, background:"none", border:"none",
            cursor:"pointer", padding:0, fontFamily:"inherit", minWidth:0,
          }}>
            <span style={{ fontSize:16, fontWeight:800, color:C.txt, letterSpacing:"-0.02em",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:300 }}>
              {selSvc
                ? `${new Date(selSvc.date+"T00:00:00").toLocaleDateString("ko-KR",{month:"numeric",day:"numeric",weekday:"short"})} ${selSvc.title||""}`
                : "예배 선택"}
            </span>
            {session?.timerRunning && (
              <span style={{ fontSize:11, color:"#fff", background:C.red,
                borderRadius:6, padding:"2px 8px", fontWeight:700, flexShrink:0 }}>LIVE</span>
            )}
            {selSvc?.time && (
              <span style={{ fontSize:13, color:C.dim, flexShrink:0 }}>{selSvc.time}</span>
            )}
            <Icon n="chevD" size={11} color={C.dim} />
          </button>
          <div style={{ width:1, height:20, background:C.bdr }} />
          {showSvcPicker && (
            <div onClick={() => setShowSvcPicker(false)} style={{ position:"fixed", inset:0, zIndex:200 }}>
              <div onClick={e => e.stopPropagation()} style={{
                position:"absolute", top:60, left:200, zIndex:201,
                background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:12,
                boxShadow:"0 6px 24px rgba(0,0,0,0.15)", minWidth:260, overflow:"hidden",
              }}>
                {recentServices.map(s => (
                  <button key={s.id} onClick={() => { setSelSvcId(s.id); setShowSvcPicker(false); }} style={{
                    width:"100%", display:"block", padding:"11px 16px", background: s.id===selSvcId ? `${C.pur}10` : "none",
                    border:"none", borderBottom:`1px solid ${C.bdr}`, cursor:"pointer", textAlign:"left",
                  }}>
                    <span style={{ fontSize:13, color:C.txt, fontWeight: s.id===selSvcId ? 700 : 500, fontFamily:"inherit" }}>
                      {new Date(s.date+"T00:00:00").toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})} {s.title}
                      {s.time ? ` · ${s.time}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ flex:1 }} />
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background: ppConnected ? C.grn : C.bdr }} />
            <span style={{ fontSize:12, color: ppConnected ? C.grn : C.dim, fontWeight:600 }}>
              ProPresenter {ppConnected ? "연결됨" : "연결 안됨"}
            </span>
          </div>
          <div style={{ width:1, height:20, background:C.bdr }} />
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:32, height:32, borderRadius:"50%", background:`${C.pur}20`,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Icon n="user" size={16} color={C.pur} />
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:C.txt }}>{user.name || user.email}</div>
              <div style={{ fontSize:10, color:C.dim }}>
                {user.role === "admin" ? "어드민" : user.role === "leader" ? "리더" : user.role === "broadcast" ? "방송팀" : "멤버"}
              </div>
            </div>
          </div>
          </div>{/* end inner 52px row */}
        </div>{/* end header */}

        {/* ─ Desktop Body ─ */}
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

          {/* ── Left Sidebar ── */}
          <div style={{ width:280, borderRight:`1px solid ${C.bdr}`, display:"flex",
            flexDirection:"column", background:C.surf, flexShrink:0 }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.bdr}` }}>
              <button onClick={() => nav("services")} style={{
                display:"flex", alignItems:"center", gap:6, background:"none", border:"none",
                cursor:"pointer", color:C.dim, fontSize:12, fontFamily:"inherit", padding:0,
              }}>
                <Icon n="back" size={13} color={C.dim} /> 예배 일정으로
              </button>
              {selSvc && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:C.txt }}>
                    {new Date(selSvc.date+"T00:00:00").toLocaleDateString("ko-KR",{month:"numeric",day:"numeric",weekday:"short"})}
                    {selSvc.time ? ` · ${selSvc.time}` : ""}
                  </div>
                  <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>{selSvc.title}</div>
                  <div style={{ display:"flex", gap:6, marginTop:8 }}>
                    <span style={{ fontSize:10, color:C.pur, background:`${C.pur}15`,
                      borderRadius:5, padding:"2px 8px", fontWeight:600 }}>
                      {svcSongs.length}곡 선택됨
                    </span>
                    {session?.timerRunning && (
                      <span style={{ fontSize:10, color:C.red, background:`${C.red}15`,
                        borderRadius:5, padding:"2px 8px", fontWeight:700 }}>진행 중</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div style={{ flex:1, overflowY:"auto" }}>
              {svcSongs.map((s, i) => (
                <button key={i} onClick={() => leader && setActiveIdx(i)} style={{
                  width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 16px",
                  background: i===activeIdx ? `${C.pur}12` : "none",
                  border:"none", borderBottom:`1px solid ${C.bdr}`,
                  cursor: leader ? "pointer" : "default", textAlign:"left",
                }}>
                  <div style={{
                    width:26, height:26, borderRadius:"50%", flexShrink:0,
                    background: i===activeIdx ? C.pur : C.bdr,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:11, fontWeight:700, color: i===activeIdx ? "#fff" : C.dim,
                  }}>{i+1}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: i===activeIdx ? 700 : 500,
                      color: i===activeIdx ? C.pur : C.txt,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {s.title}
                    </div>
                    {s.artist && <div style={{ fontSize:10, color:C.dim, marginTop:1 }}>{s.artist}</div>}
                  </div>
                  {s.key && (
                    <span style={{ fontSize:10, fontWeight:700, color:"#fff",
                      background: keyColor(s.key), borderRadius:5, padding:"1px 6px", flexShrink:0 }}>
                      {s.key}
                    </span>
                  )}
                  {i===activeIdx && (
                    <div style={{ width:6, height:6, borderRadius:"50%", background:C.pur, flexShrink:0 }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Center ── */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {/* Tabs */}
            <div style={{ borderBottom:`1px solid ${C.bdr}`, display:"flex", background:C.surf,
              padding:"0 4px", flexShrink:0 }}>
              {[["live","LIVE 모드"],["team","팀 상태"],["settings","설정"]].map(([id,label]) => (
                <button key={id} style={dTabStyle(liveTab===id)} onClick={() => setLiveTab(id)}>{label}</button>
              ))}
            </div>

            <div style={{ flex:1, overflowY:"auto", padding:20, display:"flex", flexDirection:"column", gap:16 }}>

              {/* ══ LIVE 모드 ══ */}
              {liveTab === "live" && (<>

                {/* 현재 진행 */}
                <div style={{ background:C.surf, borderRadius:16, border:`1px solid ${C.bdr}`,
                  overflow:"hidden", boxShadow:"0 1px 6px rgba(0,0,0,0.06)" }}>
                  <div style={{ padding:"14px 20px", borderBottom:`1px solid ${C.bdr}`,
                    display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontSize:12, fontWeight:700, color:C.dim, letterSpacing:"0.04em" }}>현재 진행</span>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      {ppPresentation?.id?.name && (
                        <span style={{ fontSize:11, color:C.grn, background:`${C.grn}15`,
                          borderRadius:6, padding:"2px 10px", fontWeight:600 }}>
                          ▶ {ppPresentation.id.name}
                        </span>
                      )}
                      {session?.timerRunning
                        ? <span style={{ fontSize:11, color:"#fff", background:C.red, borderRadius:6, padding:"2px 10px", fontWeight:700 }}>진행 중</span>
                        : elapsed > 0 ? <span style={{ fontSize:11, color:C.dim, background:C.bdr, borderRadius:6, padding:"2px 10px", fontWeight:600 }}>일시정지</span>
                        : null}
                    </div>
                  </div>
                  {currentSong ? (
                    <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:20 }}>
                      <div style={{ width:52, height:52, borderRadius:"50%", flexShrink:0,
                        background:C.pur, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <Icon n="music" size={22} color="#fff" />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:20, fontWeight:800, color:C.txt,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {currentSong.title}
                        </div>
                        {currentSong.artist && (
                          <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>{currentSong.artist}</div>
                        )}
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
                          <div style={{ flex:1, height:5, background:C.bdr, borderRadius:3, overflow:"hidden" }}>
                            <div style={{
                              width:`${progress*100}%`, height:"100%", borderRadius:3,
                              background: progress > 0.9 ? C.red : C.pur, transition:"width 0.5s linear",
                            }} />
                          </div>
                          <span style={{ fontSize:11, color:C.dim, flexShrink:0 }}>
                            {fmtSec(elapsed)} / {fmtSec(songDuration)}
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontSize:44, fontWeight:900, color:C.pur,
                          letterSpacing:"-0.03em", lineHeight:1 }}>{fmtSec(elapsed)}</div>
                        <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>진행 시간</div>
                      </div>
                      {leader && (
                        <div style={{ display:"flex", flexDirection:"column", gap:8, flexShrink:0 }}>
                          <button onClick={() => activeIdx < svcSongs.length-1 && setActiveIdx(activeIdx+1)}
                            disabled={activeIdx >= svcSongs.length-1} style={{
                            padding:"10px 22px", background:C.pur, border:"none", borderRadius:10,
                            cursor: activeIdx >= svcSongs.length-1 ? "not-allowed" : "pointer",
                            opacity: activeIdx >= svcSongs.length-1 ? 0.35 : 1,
                            color:"#fff", fontSize:13, fontWeight:700, fontFamily:"inherit",
                          }}>다음 곡</button>
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={toggleTimer} style={{
                              flex:1, padding:"8px 0", background: session?.timerRunning ? C.red : C.grn,
                              border:"none", borderRadius:8, cursor:"pointer",
                              color:"#fff", fontSize:12, fontWeight:700, fontFamily:"inherit",
                            }}>
                              {session?.timerRunning ? "일시정지" : elapsed > 0 ? "계속" : "시작"}
                            </button>
                            <button onClick={resetTimer} style={{
                              padding:"8px 10px", background:C.bg, border:`1px solid ${C.bdr}`,
                              borderRadius:8, cursor:"pointer", fontFamily:"inherit",
                            }}>
                              <Icon n="refresh" size={14} color={C.dim} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding:24, color:C.dim, fontSize:13, textAlign:"center" }}>
                      예배를 선택하면 곡 목록이 표시됩니다
                    </div>
                  )}
                </div>

                {/* PP 슬라이드 목록 */}
                {ppConnected && ppAllSlides.length > 0 && (
                  <div style={{ background:"#12121f", borderRadius:16, overflow:"hidden",
                    border:`1px solid rgba(255,255,255,0.08)`, boxShadow:"0 2px 12px rgba(0,0,0,0.18)" }}>
                    <div style={{ padding:"8px 16px", borderBottom:"1px solid rgba(255,255,255,0.08)",
                      display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.4)",
                        letterSpacing:"0.1em" }}>SLIDES</span>
                      {ppPresentation?.id?.name && (
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", flex:1,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {ppPresentation.id.name}
                        </span>
                      )}
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)" }}>{ppAllSlides.length}장</span>
                    </div>
                    <div style={{ maxHeight:220, overflowY:"auto", padding:"8px 0" }}>
                      {ppAllSlides.map((text, i) => (
                        <div key={i} style={{ padding:"6px 16px", display:"flex", gap:10, alignItems:"flex-start",
                          borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                          <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", flexShrink:0,
                            minWidth:18, paddingTop:2 }}>{i+1}</span>
                          <span style={{ fontSize:12, color:"rgba(255,255,255,0.75)", lineHeight:1.6,
                            whiteSpace:"pre-line" }}>{text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 다음 순서 */}
                {nextSong && (
                  <div style={{ background:C.surf, borderRadius:14, padding:"12px 20px",
                    border:`1px solid ${C.bdr}`, display:"flex", alignItems:"center", gap:14 }}>
                    <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0,
                      background:`${C.pur}15`, border:`1.5px solid ${C.pur}30`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:14, fontWeight:700, color:C.pur }}>
                      {activeIdx + 2}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, color:C.dim, marginBottom:2 }}>다음 순서</div>
                      <div style={{ fontSize:15, fontWeight:700, color:C.txt,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {nextSong.title}
                      </div>
                      <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                        예상 시작: {nextExpected}
                      </div>
                    </div>
                    {nextSong.key && (
                      <span style={{ fontSize:11, fontWeight:700, color:"#fff",
                        background: keyColor(nextSong.key), borderRadius:6, padding:"3px 10px", flexShrink:0 }}>
                        {nextSong.key}
                      </span>
                    )}
                  </div>
                )}

                {/* 팀 상황 / CUE — horizontal */}
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:10,
                    letterSpacing:"0.05em", textTransform:"uppercase" }}>팀 상황 / CUE</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
                    {LIVE_TEAMS.map(team => {
                      const cue = cues[team.id];
                      const col = teamColor[team.id] || C.acc;
                      const stCol = cue?.status==="ready" ? C.grn : cue?.status==="done" ? C.acc : cue?.status==="issue" ? C.red : C.bdr;
                      return (
                        <div key={team.id} style={{ background:C.surf, borderRadius:14, padding:"12px 14px",
                          border:`1.5px solid ${stCol === C.bdr ? C.bdr : stCol + "60"}` }}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <span style={{ fontSize:17 }}>{team.icon}</span>
                              <span style={{ fontSize:13, fontWeight:700, color:C.txt }}>{team.label}</span>
                            </div>
                            <div style={{ width:8, height:8, borderRadius:"50%", background:stCol }} />
                          </div>
                          <div style={{ marginTop:6 }}>
                            <span style={{ fontSize:10, fontWeight:700, color:"#fff", borderRadius:6,
                              padding:"2px 8px", background: stCol === C.bdr ? C.dim : stCol }}>
                              {cue?.status==="ready" ? "준비완료" : cue?.status==="done" ? "완료" : cue?.status==="issue" ? "문제있음" : "대기중"}
                            </span>
                          </div>
                          {cue?.updatedAt?.toDate && (
                            <div style={{ fontSize:10, color:C.dim, marginTop:3 }}>
                              {new Date(cue.updatedAt.toDate()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* YouTube 라이브 */}
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:10,
                    letterSpacing:"0.05em", textTransform:"uppercase" }}>YouTube 라이브</div>
                  <div style={{ background:C.surf, borderRadius:14, border:`1.5px solid ${ytLive ? "#FF000040" : C.bdr}`,
                    overflow:"hidden" }}>
                    {ytLive ? (<>
                      <div style={{ padding:"10px 14px", display:"flex", alignItems:"center",
                        justifyContent:"space-between", borderBottom:`1px solid ${C.bdr}` }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"#FF0000",
                            borderRadius:5, padding:"2px 7px", letterSpacing:"0.05em" }}>● LIVE</span>
                          {ytLive.viewers !== null && (
                            <span style={{ fontSize:11, color:C.dim }}>👥 {Number(ytLive.viewers).toLocaleString()}명 시청 중</span>
                          )}
                        </div>
                        <a href={`https://www.youtube.com/watch?v=${ytLive.videoId}`} target="_blank" rel="noreferrer"
                          style={{ fontSize:11, color:C.acc, textDecoration:"none" }}>새 탭 →</a>
                      </div>
                      <div style={{ fontSize:13, fontWeight:600, color:C.txt, padding:"8px 14px 6px",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {ytLive.title}
                      </div>
                      <div style={{ position:"relative", paddingBottom:"56.25%", height:0, overflow:"hidden" }}>
                        <iframe
                          src={`https://www.youtube.com/embed/${ytLive.videoId}?autoplay=0&rel=0`}
                          style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", border:"none" }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    </>) : (
                      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px" }}>
                        <div style={{ width:36, height:36, borderRadius:"50%", background:`${C.dim}20`,
                          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span style={{ fontSize:18 }}>📺</span>
                        </div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:C.dim }}>현재 라이브 방송 없음</div>
                          <a href="https://www.youtube.com/@tri-valley/streams" target="_blank" rel="noreferrer"
                            style={{ fontSize:11, color:C.acc, textDecoration:"none" }}>채널 바로가기 →</a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>)}

              {/* ══ 팀 상태 ══ */}
              {liveTab === "team" && LIVE_TEAMS.map(team => {
                const cue = cues[team.id];
                const stCol = cue?.status==="ready" ? C.grn : cue?.status==="done" ? C.acc : cue?.status==="issue" ? C.red : C.bdr;
                return (
                  <div key={team.id} style={{ background:C.surf, borderRadius:14, padding:16,
                    border:`1.5px solid ${stCol}` }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:20 }}>{team.icon}</span>
                        <span style={{ fontSize:15, fontWeight:700, color:C.txt }}>{team.label}</span>
                      </div>
                      <span style={{ fontSize:11, color:"#fff", borderRadius:7, padding:"3px 10px", fontWeight:700,
                        background: stCol === C.bdr ? C.dim : stCol }}>
                        {cue?.status==="ready"?"준비완료":cue?.status==="done"?"완료":cue?.status==="issue"?"문제있음":"대기중"}
                      </span>
                    </div>
                    {cue && <>
                      <div style={{ fontSize:13, color:C.txt }}>{cue.msg}</div>
                      <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>
                        {cue.updatedByName} · {cue.updatedAt?.toDate
                          ? new Date(cue.updatedAt.toDate()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}) : ""}
                      </div>
                    </>}
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      {cue?.status ? (
                        <button onClick={() => sendCue(team.id, "대기 중", null)} style={{
                          padding:"7px 18px", borderRadius:8, fontSize:12, fontWeight:700,
                          cursor:"pointer", border:"none", color:"#fff", fontFamily:"inherit",
                          background: cue.status==="ready" ? C.grn : cue.status==="done" ? C.acc : C.red,
                        }}>
                          {cue.status==="ready" ? "✓ 준비완료" : cue.status==="done" ? "✓ 완료" : "⚠ 문제있음"}
                        </button>
                      ) : (
                        [["ready","준비완료",C.grn],["done","완료",C.acc],["issue","문제있음",C.red]].map(([st,lbl,col]) => (
                          <button key={st} onClick={() => sendCue(team.id, lbl, st)} style={{
                            padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer",
                            background:`${col}18`, border:`1px solid ${col}`, color:col, fontFamily:"inherit",
                          }}>{lbl}</button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ══ 설정 ══ */}
              {liveTab === "settings" && (<>
                <div style={{ background:C.surf, borderRadius:14, padding:18, border:`1px solid ${C.bdr}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                    <Icon n="antenna" size={16} color={C.acc} />
                    <span style={{ fontSize:14, fontWeight:700, color:C.txt }}>ProPresenter 연결</span>
                    <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:4 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background: ppConnected ? C.grn : C.bdr }} />
                      <span style={{ fontSize:11, color: ppConnected ? C.grn : C.dim }}>
                        {ppConnected ? "연결됨" : "연결 안됨"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                    {[["Mac IP (교회 WiFi)","ip","192.168.1.21"],["프록시 포트","proxyPort","1027"]].map(([label,key,ph]) => (
                      <div key={key}>
                        <div style={{ fontSize:11, color:C.dim, marginBottom:4 }}>{label}</div>
                        <input value={ppConfig[key]||""} onChange={e => setPpConfig(p => ({...p,[key]:e.target.value}))}
                          placeholder={ph} style={{ width:"100%", padding:"9px 12px", border:`1px solid ${C.bdr}`,
                            borderRadius:9, background:C.bg, color:C.txt, fontSize:13,
                            fontFamily:"inherit", boxSizing:"border-box" }} />
                      </div>
                    ))}
                  </div>
                  <button onClick={ppConnect} style={{
                    padding:"10px 24px", background: ppConnected ? C.grn : C.acc, border:"none", borderRadius:10,
                    cursor:"pointer", color:"#111", fontSize:13, fontWeight:700, fontFamily:"inherit",
                    marginBottom:12,
                  }}>{ppChecking?"연결 중...":ppConnected?"✓ 연결됨 (재테스트)":"연결 테스트"}</button>
                </div>
                <div style={{ background:C.surf, borderRadius:14, padding:18, border:`1px solid ${C.bdr}` }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.txt, marginBottom:10 }}>기본 곡 시간</div>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                    <input type="number" value={songDuration}
                      onChange={e => { const v=Math.max(30,parseInt(e.target.value)||240); setSongDuration(v); localStorage.setItem("tvpc_songDuration",String(v)); }}
                      min={30} max={1200} step={30} style={{ width:100, padding:"9px 12px", border:`1px solid ${C.bdr}`,
                        borderRadius:9, background:C.bg, color:C.txt, fontSize:13, fontFamily:"inherit" }} />
                    <span style={{ fontSize:13, color:C.dim }}>초 ({Math.floor(songDuration/60)}분 {songDuration%60}초)</span>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    {[[120,"2분"],[180,"3분"],[240,"4분"],[300,"5분"],[360,"6분"]].map(([s,l]) => (
                      <button key={s} onClick={() => { setSongDuration(s); localStorage.setItem("tvpc_songDuration",String(s)); }} style={{
                        padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                        background: songDuration===s ? C.acc : C.bg, border:`1px solid ${songDuration===s ? C.acc : C.bdr}`,
                        color: songDuration===s ? "#111" : C.dim, fontFamily:"inherit",
                      }}>{l}</button>
                    ))}
                  </div>
                </div>
              </>)}

            </div>
          </div>

          {/* ── Right Chat Panel ── */}
          <div style={{ width:320, borderLeft:`1px solid ${C.bdr}`, display:"flex",
            flexDirection:"column", background:C.surf, flexShrink:0 }}>
            {/* Chat header */}
            <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.bdr}`, flexShrink:0,
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:14, fontWeight:700, color:C.txt }}>팀 채팅</span>
              {chatMessages.length > 0 && (
                <span style={{ fontSize:11, color:C.dim }}>{chatMessages.length}개의 메시지</span>
              )}
            </div>
            {/* Messages */}
            <div style={{ flex:1, overflowY:"auto", padding:"10px 14px",
              display:"flex", flexDirection:"column", gap:8 }}>
              {chatMessages.length === 0 ? (
                <div style={{ color:C.dim, fontSize:13, textAlign:"center", marginTop:40 }}>
                  채팅 메시지가 없습니다
                </div>
              ) : chatMessages.map(msg => (
                <ChatMsg key={msg.id} msg={msg} />
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* Input */}
            <div style={{ borderTop:`1px solid ${C.bdr}`, padding:"10px 12px", flexShrink:0 }}>
              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter"&&!e.shiftKey) { sendChat(chatInput); setChatInput(""); }}}
                  placeholder="메시지 입력..." style={{
                    flex:1, padding:"9px 12px", border:`1px solid ${C.bdr}`,
                    borderRadius:9, background:C.bg, color:C.txt,
                    fontSize:13, fontFamily:"inherit", outline:"none",
                  }} />
                <button onClick={() => { sendChat(chatInput); setChatInput(""); }} style={{
                  padding:"9px 14px", background:C.pur, border:"none", borderRadius:9,
                  cursor:"pointer", fontFamily:"inherit",
                }}>
                  <Icon n="send" size={15} color="#fff" />
                </button>
              </div>
              {/* Quick messages */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:11, fontWeight:700, color:C.dim }}>빠른 메시지 / CUE</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
                {QUICK_MSGS.map(qm => (
                  <button key={qm.label} onClick={() => sendChat(qm.label)} style={{
                    padding:"6px 4px", borderRadius:8, fontSize:11, fontWeight:600,
                    background:`${qm.color}12`, border:`1px solid ${qm.color}50`,
                    color:qm.color, cursor:"pointer", fontFamily:"inherit",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:3,
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                  }}>
                    <span style={{ fontSize:12 }}>{qm.emoji}</span>
                    <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{qm.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  /* ────────────────────────── MOBILE LAYOUT ────────────────────────── */
  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.bg,
      paddingBottom:"calc(90px + env(safe-area-inset-bottom))" }}>

      {/* ── Header */}
      <div style={{ padding:"calc(12px + env(safe-area-inset-top)) 16px 0",
        background:C.surf, borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <button onClick={() => setShowSvcPicker(p => !p)} style={{
            display:"flex", alignItems:"center", gap:6, background:"none",
            border:"none", cursor:"pointer", padding:0, minWidth:0,
          }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:16, fontWeight:800, color:C.txt, textAlign:"left",
                fontFamily:"inherit", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:220 }}>
                {selSvc
                  ? `${new Date(selSvc.date+"T00:00:00").toLocaleDateString("ko-KR",{month:"numeric",day:"numeric",weekday:"short"})} ${selSvc.title||""}`
                  : "예배 선택"}
              </div>
              <div style={{ fontSize:10, color:C.dim, textAlign:"left" }}>탭하여 예배 변경</div>
            </div>
            <Icon n="chevD" size={12} color={C.dim} />
          </button>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            {session?.timerRunning && (
              <span style={{ fontSize:10, color:"#fff", background:C.red,
                borderRadius:6, padding:"2px 8px", fontWeight:700, letterSpacing:"0.06em" }}>● LIVE</span>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: ppConnected ? C.grn : C.bdr }} />
              <span style={{ fontSize:10, color: ppConnected ? C.grn : C.dim }}>PP</span>
            </div>
          </div>
        </div>

        {showSvcPicker && (
          <div onClick={() => setShowSvcPicker(false)} style={{ position:"fixed", inset:0, zIndex:150 }}>
            <div onClick={e => e.stopPropagation()} style={{
              position:"absolute", top:"calc(env(safe-area-inset-top) + 60px)", left:16, zIndex:151,
              background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:12,
              boxShadow:"0 6px 24px rgba(0,0,0,0.18)", minWidth:240, overflow:"hidden",
            }}>
              {recentServices.length === 0
                ? <div style={{ padding:14, fontSize:12, color:C.dim }}>최근 예배가 없습니다</div>
                : recentServices.map(s => (
                  <button key={s.id} onClick={() => { setSelSvcId(s.id); setShowSvcPicker(false); }} style={{
                    width:"100%", display:"block", padding:"11px 14px",
                    background: s.id===selSvcId ? `${C.acc}18` : "none",
                    border:"none", borderBottom:`1px solid ${C.bdr}`, cursor:"pointer", textAlign:"left",
                  }}>
                    <span style={{ fontSize:13, color:C.txt, fontWeight: s.id===selSvcId ? 700 : 500, fontFamily:"inherit" }}>
                      {new Date(s.date+"T00:00:00").toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})} {s.title}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        <div style={{ display:"flex" }}>
          {[["live","LIVE 모드"],["team","팀 상태"],["chat","채팅"],["settings","설정"]].map(([id,label]) => (
            <button key={id} style={tabStyle(liveTab===id)} onClick={() => setLiveTab(id)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Body */}
      <div style={{ flex:1, overflowY:"auto", padding:14, display:"flex", flexDirection:"column", gap:12 }}>

        {/* ════ LIVE 모드 ════ */}
        {liveTab === "live" && (<>

          {/* 현재 진행 card */}
          <div style={{ background:C.surf, borderRadius:16, border:`1px solid ${C.bdr}`,
            overflow:"hidden", boxShadow:"0 2px 10px rgba(0,0,0,0.06)" }}>
            <div style={{ padding:"14px 16px 0" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ fontSize:11, fontWeight:700, color:C.dim, letterSpacing:"0.04em" }}>현재 진행</span>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  {ppPresentation?.id?.name && (
                    <span style={{ fontSize:10, color:C.grn, background:`${C.grn}15`,
                      borderRadius:6, padding:"2px 8px", fontWeight:600,
                      maxWidth:130, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                      title={ppPresentation.id.name}>
                      ▶ {ppPresentation.id.name}
                    </span>
                  )}
                  {session?.timerRunning ? (
                    <span style={{ fontSize:10, color:"#fff", background:C.red,
                      borderRadius:6, padding:"2px 8px", fontWeight:700 }}>진행 중</span>
                  ) : elapsed > 0 ? (
                    <span style={{ fontSize:10, color:C.dim, background:C.bdr,
                      borderRadius:6, padding:"2px 8px", fontWeight:600 }}>일시정지</span>
                  ) : null}
                </div>
              </div>
              {currentSong ? (
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <div style={{ width:44, height:44, borderRadius:"50%", flexShrink:0,
                    background:"#6b5de7", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Icon n="music" size={20} color="#fff" />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:16, fontWeight:800, color:C.txt,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {currentSong.title}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:3 }}>
                      {currentSong.key && (
                        <span style={{ fontSize:10, fontWeight:700, color:"#fff",
                          background: keyColor(currentSong.key), borderRadius:5, padding:"1px 7px" }}>
                          {currentSong.key}
                        </span>
                      )}
                      {currentSong.artist && (
                        <span style={{ fontSize:11, color:C.dim }}>{currentSong.artist}</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color:C.dim, fontSize:13, textAlign:"center", padding:"16px 0" }}>
                  예배를 선택하면 곡 목록이 표시됩니다
                </div>
              )}
            </div>

            {currentSong && (<>
              <div style={{ padding:"0 16px", marginBottom:4 }}>
                <div style={{ height:4, background:C.bdr, borderRadius:2, overflow:"hidden" }}>
                  <div style={{
                    width:`${progress * 100}%`, height:"100%", borderRadius:2,
                    background: progress > 0.9 ? C.red : C.acc,
                    transition:"width 0.5s linear",
                  }} />
                </div>
              </div>
              <div style={{ padding:"2px 16px 14px", display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <span style={{ fontSize:42, fontWeight:900, color:C.acc, letterSpacing:"-0.03em", lineHeight:1 }}>
                  {fmtSec(elapsed)}
                </span>
                <span style={{ fontSize:12, color:C.dim }}>/ {fmtSec(songDuration)}</span>
              </div>
              {leader && (
                <div style={{ borderTop:`1px solid ${C.bdr}`, padding:"10px 12px",
                  display:"flex", gap:8, alignItems:"center" }}>
                  <button onClick={toggleTimer} style={{
                    flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                    padding:"11px 0", background: session?.timerRunning ? C.red : C.grn,
                    border:"none", borderRadius:10, cursor:"pointer",
                    color:"#fff", fontSize:13, fontWeight:700, fontFamily:"inherit",
                  }}>
                    <Icon n={session?.timerRunning ? "pause" : "play"} size={14} color="#fff" />
                    {session?.timerRunning ? "일시정지" : elapsed > 0 ? "계속" : "시작"}
                  </button>
                  <button onClick={resetTimer} style={{
                    width:48, height:44, display:"flex", alignItems:"center", justifyContent:"center",
                    background:C.bg, border:`1px solid ${C.bdr}`, borderRadius:10,
                    cursor:"pointer", fontFamily:"inherit",
                  }}>
                    <Icon n="refresh" size={16} color={C.dim} />
                  </button>
                  <button
                    onClick={() => activeIdx < svcSongs.length - 1 && setActiveIdx(activeIdx + 1)}
                    disabled={activeIdx >= svcSongs.length - 1}
                    style={{
                      flex:1, padding:"11px 0", background:C.acc, border:"none", borderRadius:10,
                      cursor: activeIdx >= svcSongs.length-1 ? "not-allowed" : "pointer",
                      opacity: activeIdx >= svcSongs.length-1 ? 0.35 : 1,
                      color:"#111", fontSize:13, fontWeight:700, fontFamily:"inherit",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:4,
                    }}>
                    다음 곡 <Icon n="next" size={13} color="#111" />
                  </button>
                </div>
              )}
            </>)}
          </div>

          {/* PP 슬라이드 목록 (mobile) */}
          {ppConnected && ppAllSlides.length > 0 && (
            <div style={{ background:"#12121f", borderRadius:16, overflow:"hidden",
              border:`1px solid rgba(255,255,255,0.08)`, boxShadow:"0 2px 10px rgba(0,0,0,0.18)" }}>
              <div style={{ padding:"7px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)",
                display:"flex", alignItems:"center", gap:7 }}>
                <span style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.4)",
                  letterSpacing:"0.1em" }}>SLIDES</span>
                {ppPresentation?.id?.name && (
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", flex:1,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {ppPresentation.id.name}
                  </span>
                )}
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)" }}>{ppAllSlides.length}장</span>
              </div>
              <div style={{ maxHeight:200, overflowY:"auto", padding:"6px 0" }}>
                {ppAllSlides.map((text, i) => (
                  <div key={i} style={{ padding:"5px 14px", display:"flex", gap:9, alignItems:"flex-start",
                    borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", flexShrink:0,
                      minWidth:16, paddingTop:2 }}>{i+1}</span>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,0.75)", lineHeight:1.6,
                      whiteSpace:"pre-line" }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 다음 순서 */}
          {nextSong && (
            <div style={{ background:C.surf, borderRadius:14, padding:"12px 14px",
              border:`1px solid ${C.bdr}`, display:"flex", alignItems:"center", gap:12 }}>
              <div style={{
                width:32, height:32, borderRadius:"50%", flexShrink:0,
                background:`${C.pur}18`, border:`1.5px solid ${C.pur}40`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:13, fontWeight:700, color:C.pur,
              }}>{activeIdx + 2}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, color:C.dim, marginBottom:1 }}>다음 순서</div>
                <div style={{ fontSize:14, fontWeight:700, color:C.txt,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {nextSong.title}
                </div>
              </div>
              {nextSong.key && (
                <span style={{ fontSize:10, fontWeight:700, color:"#fff",
                  background: keyColor(nextSong.key), borderRadius:5, padding:"2px 7px", flexShrink:0 }}>
                  {nextSong.key}
                </span>
              )}
            </div>
          )}

          {/* 팀 상황 2×2 grid */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:8,
              letterSpacing:"0.05em", textTransform:"uppercase" }}>팀 상황 / CUE</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {LIVE_TEAMS.map(team => {
                const cue = cues[team.id];
                const stCol = statusColor(cue?.status);
                return (
                  <div key={team.id} style={{
                    background:C.surf, borderRadius:12, padding:"10px 12px",
                    border:`1.5px solid ${stCol === C.bdr ? C.bdr : stCol + "55"}`,
                    display:"flex", alignItems:"center", gap:8,
                  }}>
                    <span style={{ fontSize:16 }}>{team.icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:C.txt }}>{team.label}</div>
                      <div style={{ fontSize:10, fontWeight:600, marginTop:1,
                        color: stCol === C.bdr ? C.dim : stCol }}>
                        {cue?.status === "ready" ? "준비완료" : cue?.status === "done" ? "완료" : cue?.status === "issue" ? "⚠️ 문제" : "대기중"}
                      </div>
                    </div>
                    <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:stCol }} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* YouTube 라이브 */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:8,
              letterSpacing:"0.05em", textTransform:"uppercase" }}>YouTube 라이브</div>
            <div style={{ background:C.surf, borderRadius:12, border:`1.5px solid ${ytLive ? "#FF000040" : C.bdr}`,
              overflow:"hidden" }}>
              {ytLive ? (<>
                <div style={{ padding:"8px 12px", display:"flex", alignItems:"center",
                  justifyContent:"space-between", borderBottom:`1px solid ${C.bdr}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"#FF0000",
                      borderRadius:5, padding:"2px 7px" }}>● LIVE</span>
                    {ytLive.viewers !== null && (
                      <span style={{ fontSize:11, color:C.dim }}>👥 {Number(ytLive.viewers).toLocaleString()}명</span>
                    )}
                  </div>
                  <a href={`https://www.youtube.com/watch?v=${ytLive.videoId}`} target="_blank" rel="noreferrer"
                    style={{ fontSize:11, color:C.acc, textDecoration:"none" }}>새 탭 →</a>
                </div>
                <div style={{ fontSize:12, fontWeight:600, color:C.txt, padding:"6px 12px 4px",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {ytLive.title}
                </div>
                <div style={{ position:"relative", paddingBottom:"56.25%", height:0, overflow:"hidden" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${ytLive.videoId}?autoplay=0&rel=0`}
                    style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", border:"none" }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </>) : (
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px" }}>
                  <span style={{ fontSize:18 }}>📺</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:C.dim }}>현재 라이브 방송 없음</div>
                    <a href="https://www.youtube.com/@tri-valley/streams" target="_blank" rel="noreferrer"
                      style={{ fontSize:11, color:C.acc, textDecoration:"none" }}>채널 바로가기 →</a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ════ 팀 상태 ════ */}
        {liveTab === "team" && LIVE_TEAMS.map(team => {
          const cue = cues[team.id];
          const stCol = statusColor(cue?.status);
          return (
            <div key={team.id} style={{ background:C.surf, borderRadius:14, padding:14,
              border:`1.5px solid ${stCol === C.bdr ? C.bdr : stCol}` }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:18 }}>{team.icon}</span>
                  <span style={{ fontSize:14, fontWeight:700, color:C.txt }}>{team.label}</span>
                </div>
                <span style={{ fontSize:10, color:"#fff", borderRadius:6, padding:"2px 9px", fontWeight:700,
                  background: stCol === C.bdr ? C.dim : stCol }}>
                  {cue?.status==="ready" ? "준비완료" : cue?.status==="done" ? "완료" : cue?.status==="issue" ? "문제있음" : "대기중"}
                </span>
              </div>
              {cue ? (<>
                <div style={{ fontSize:13, color:C.txt, marginBottom:3 }}>{cue.msg}</div>
                <div style={{ fontSize:11, color:C.dim }}>
                  {cue.updatedByName} · {cue.updatedAt?.toDate
                    ? new Date(cue.updatedAt.toDate()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})
                    : ""}
                </div>
              </>) : (
                <div style={{ fontSize:12, color:C.dim }}>대기 중...</div>
              )}
              <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                {cue?.status ? (
                  <button onClick={() => sendCue(team.id, "대기 중", null)} style={{
                    padding:"7px 18px", borderRadius:8, fontSize:12, fontWeight:700,
                    cursor:"pointer", border:"none", color:"#fff", fontFamily:"inherit",
                    background: cue.status==="ready" ? C.grn : cue.status==="done" ? C.acc : C.red,
                  }}>
                    {cue.status==="ready" ? "✓ 준비완료" : cue.status==="done" ? "✓ 완료" : "⚠ 문제있음"}
                  </button>
                ) : (
                  [["ready","준비완료",C.grn],["done","완료",C.acc],["issue","문제있음",C.red]].map(([st,lbl,col]) => (
                    <button key={st} onClick={() => sendCue(team.id, lbl, st)}
                      style={cueBtn(false, col)}>{lbl}</button>
                  ))
                )}
              </div>
            </div>
          );
        })}

        {/* ════ 채팅 ════ */}
        {liveTab === "chat" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:2 }}>
              {QUICK_CUES.map(qc => (
                <button key={qc.id} onClick={() => sendChat(`📣 ${qc.label}`)} style={{
                  flexShrink:0, padding:"7px 14px",
                  background:`${qc.color}18`, border:`1.5px solid ${qc.color}60`,
                  borderRadius:20, cursor:"pointer", fontFamily:"inherit",
                  fontSize:12, fontWeight:700, color:qc.color, whiteSpace:"nowrap",
                }}>{qc.label}</button>
              ))}
            </div>
            <div style={{ background:C.surf, borderRadius:14, border:`1px solid ${C.bdr}`,
              padding:12, overflowY:"auto", minHeight:200, maxHeight:360,
              display:"flex", flexDirection:"column", gap:6 }}>
              {chatMessages.length === 0 ? (
                <div style={{ color:C.dim, fontSize:13, textAlign:"center", margin:"auto" }}>
                  채팅 메시지가 없습니다
                </div>
              ) : chatMessages.map(msg => (
                <ChatMsg key={msg.id} msg={msg} />
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { sendChat(chatInput); setChatInput(""); }}}
                placeholder="메시지 입력..." style={{
                  flex:1, padding:"11px 14px", border:`1px solid ${C.bdr}`,
                  borderRadius:10, background:C.surf, color:C.txt,
                  fontSize:13, fontFamily:"inherit", outline:"none",
                }} />
              <button onClick={() => { sendChat(chatInput); setChatInput(""); }} style={{
                padding:"11px 16px", background:C.acc, border:"none", borderRadius:10,
                cursor:"pointer", fontFamily:"inherit",
              }}>
                <Icon n="send" size={16} color="#111" />
              </button>
            </div>
          </div>
        )}

        {/* ════ 설정 ════ */}
        {liveTab === "settings" && (<>
          <div style={{ background:C.surf, borderRadius:14, padding:16, border:`1px solid ${C.bdr}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
              <div style={{ width:32, height:32, borderRadius:8, background:`${C.acc}18`,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Icon n="antenna" size={16} color={C.acc} />
              </div>
              <span style={{ fontSize:14, fontWeight:700, color:C.txt }}>ProPresenter 연결</span>
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:4 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background: ppConnected ? C.grn : C.bdr }} />
                <span style={{ fontSize:11, color: ppConnected ? C.grn : C.dim }}>
                  {ppConnected ? "연결됨" : "연결 안됨"}
                </span>
              </div>
            </div>
            {[["Mac IP (교회 WiFi)","ip","192.168.1.21"],["프록시 포트","proxyPort","1027"]].map(([label,key,ph]) => (
              <div key={key} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:C.dim, marginBottom:4 }}>{label}</div>
                <input value={ppConfig[key] || ""} onChange={e => setPpConfig(p => ({...p,[key]:e.target.value}))}
                  placeholder={ph} style={{
                    width:"100%", padding:"9px 12px", border:`1px solid ${C.bdr}`,
                    borderRadius:9, background:C.bg, color:C.txt, fontSize:13,
                    fontFamily:"inherit", boxSizing:"border-box",
                  }} />
              </div>
            ))}
            <button onClick={ppConnect} style={{
              width:"100%", padding:"11px 0", marginTop:4,
              background: ppConnected ? C.grn : C.acc, border:"none", borderRadius:10,
              cursor:"pointer", color:"#111", fontSize:13, fontWeight:700, fontFamily:"inherit",
            }}>
              {ppChecking ? "연결 중..." : ppConnected ? "✓ 연결됨 (재테스트)" : "연결 테스트"}
            </button>
          </div>

          <div style={{ background:C.surf, borderRadius:14, padding:16, border:`1px solid ${C.bdr}` }}>
            <div style={{ fontSize:14, fontWeight:700, color:C.txt, marginBottom:4 }}>기본 곡 시간</div>
            <div style={{ fontSize:11, color:C.dim, marginBottom:10 }}>진행 바 계산에 사용됩니다</div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <input type="number" value={songDuration}
                onChange={e => {
                  const v = Math.max(30, parseInt(e.target.value) || 240);
                  setSongDuration(v);
                  localStorage.setItem("tvpc_songDuration", String(v));
                }}
                min={30} max={1200} step={30} style={{
                  flex:1, padding:"9px 12px", border:`1px solid ${C.bdr}`,
                  borderRadius:9, background:C.bg, color:C.txt, fontSize:13,
                  fontFamily:"inherit", boxSizing:"border-box",
                }} />
              <span style={{ fontSize:12, color:C.dim, whiteSpace:"nowrap" }}>
                초 ({Math.floor(songDuration/60)}분 {songDuration%60}초)
              </span>
            </div>
            <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
              {[[120,"2분"],[180,"3분"],[240,"4분"],[300,"5분"],[360,"6분"]].map(([s,l]) => (
                <button key={s} onClick={() => { setSongDuration(s); localStorage.setItem("tvpc_songDuration",String(s)); }} style={{
                  padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600,
                  background: songDuration===s ? C.acc : C.bg,
                  border:`1px solid ${songDuration===s ? C.acc : C.bdr}`,
                  color: songDuration===s ? "#111" : C.dim,
                  cursor:"pointer", fontFamily:"inherit",
                }}>{l}</button>
              ))}
            </div>
          </div>

          {/* 라이브 ON/OFF (방송팀 탭 활성화) */}
          {leader && (
            <div style={{ background:C.surf, borderRadius:14, padding:16, border:`1px solid ${C.bdr}` }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.txt, marginBottom:4 }}>방송팀 라이브 접속</div>
              <div style={{ fontSize:11, color:C.dim, marginBottom:12 }}>
                ON으로 설정하면 방송팀(broadcast) 역할 팀원에게 LIVE 탭이 표시됩니다.
              </div>
              <button onClick={async () => {
                await setDoc(doc(db, "liveStatus", "global"),
                  { active: !anyLiveActive, updatedAt: serverTimestamp(), updatedBy: user.uid },
                  { merge: true });
              }}
                style={{ width:"100%", padding:"11px 0", borderRadius:10, cursor:"pointer",
                  fontFamily:"inherit", fontSize:13, fontWeight:700, border:"none",
                  background: anyLiveActive ? C.red : C.grn,
                  color: "#fff" }}>
                {anyLiveActive ? "🔴 LIVE 종료 (방송팀 탭 숨김)" : "🟢 LIVE 시작 (방송팀 탭 표시)"}
              </button>
            </div>
          )}

          <div style={{ background:`${C.acc}0a`, borderRadius:12, padding:"12px 14px",
            border:`1px solid ${C.acc}30` }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.acc, marginBottom:6 }}>처음 한 번만 — 기기별 인증서 수락</div>
            <div style={{ fontSize:11, color:C.dim, lineHeight:1.8 }}>
              <b>1.</b> 이 기기 브라우저에서 아래 주소 열기:<br/>
              <code style={{ background:C.surf, padding:"2px 6px", borderRadius:4, fontSize:10 }}>
                https://192.168.1.21:1027/v1/doc/index.html
              </code><br/>
              <b>2.</b> "안전하지 않음" 경고 → 고급 → 계속 진행<br/>
              <b>3.</b> 위로 돌아와서 연결 테스트
            </div>
          </div>
        </>)}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   BOTTOM NAV
══════════════════════════════════════════════════════════════════ */
function BottomNav({ view, nav, unread, user, anyLiveActive }) {
  const tabs = [
    { id:"services",      icon:"home",       label:"예배"   },
    { id:"library",       icon:"music",      label:"악보"   },
    ...(user?.role === "admin" || (isBroadcast(user?.role) && anyLiveActive)
      ? [{ id:"live", icon:"antenna", label:"LIVE" }] : []),
    { id:"notifications", icon:"bell",       label:"알림"   },
    { id:"profile",       icon:"user",       label:"프로필" },
  ];
  return (
    <div style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:640,
      background:C.surf, borderTop:`1px solid ${C.bdr}`,
      display:"flex", alignItems:"center",
      padding:"8px 0",
      paddingBottom:"calc(14px + env(safe-area-inset-bottom))",
      zIndex:500,
    }}>
      {tabs.map(t => {
        const active = view === t.id;
        return (
          <button key={t.id} onClick={() => nav(t.id)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0" }}>
            <div style={{ position:"relative" }}>
              <div style={{
                width:44, height:44, borderRadius:12,
                background: active ? C.pur : `${C.pur}18`,
                display:"flex", alignItems:"center", justifyContent:"center",
                transition:"background .15s",
              }}>
                <Icon n={t.icon} size={22} color={active ? "#fff" : `${C.pur}88`} />
              </div>
              {t.id === "notifications" && unread > 0 && (
                <span style={{
                  position:"absolute", top:-4, right:-6,
                  minWidth:16, height:16, padding:"0 4px",
                  background:C.red, borderRadius:8, border:`2px solid ${C.surf}`,
                  fontSize:10, fontWeight:700, color:"#fff",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  lineHeight:1, boxSizing:"border-box",
                }}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <span style={{ fontSize:10, fontWeight: active ? 700 : 400,
              color: active ? C.pur : C.dim, letterSpacing:"0.01em" }}>
              {t.label}
            </span>
          </button>
        );
      })}
      <button onClick={() => { localStorage.setItem("tvpc_view", view); window.location.reload(); }}
        style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2,
          background:"none", border:"none", cursor:"pointer", padding:"2px 8px", flexShrink:0 }}>
        <div style={{ width:44, height:44, borderRadius:12, background:`${C.pur}18`,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon n="refresh" size={20} color={`${C.pur}88`} />
        </div>
        <span style={{ fontSize:9, color:C.dim, letterSpacing:"0.02em" }}>v{APP_VERSION}</span>
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [user,        setUser]        = useState(undefined); // undefined = loading
  const [loginErr,        setLoginErr]        = useState("");
  const [loginBlockedUser,setLoginBlockedUser] = useState(null); // { email, name } 미등록 로그인 시도
  const [view,        setView]        = useState(() => {
    const saved = localStorage.getItem("tvpc_view") || "services";
    // pdfViewer/svcDetail는 selSongId/selSvcId가 필요한데 새로고침 시 사라지므로 services로 복원
    return (saved === "pdfViewer" || saved === "svcDetail") ? "services" : saved;
  });
  const [songs,       setSongs]       = useState([]);
  const [services,    setServices]    = useState([]);
  const [notifs,      setNotifs]      = useState([]);
  const [annotations,     setAnnotations]     = useState({}); // 개인 메모
  const [teamAnnotations, setTeamAnnotations] = useState({}); // 팀 공유 메모
  const [userMap,         setUserMap]         = useState({}); // uid -> displayName
  const [songDrawings,    setSongDrawings]    = useState({}); // songId -> { my: bool, team: bool }
  const [anyLiveActive,   setAnyLiveActive]   = useState(false); // 방송팀 라이브탭 표시 여부
  const [selSvcId,      setSelSvcId]      = useState(null);
  const [selSongId,     setSelSongId]     = useState(null);
  const [selSvcSongIdx, setSelSvcSongIdx] = useState(-1); // 서비스 내 곡 인덱스 (복사 곡 대응)
  const [backTo,        setBackTo]        = useState("library");
  const [pdfjsReady,    setPdfjsReady]    = useState(false);
  const [showHelp,      setShowHelp]      = useState(false);
  const [notifPopup,    setNotifPopup]    = useState(null); // {unreadCount, latest}
  const notifPopupShownRef = useRef(false);
  const [sharedGeminiKey, setSharedGeminiKey] = useState("");

  // ── Kakao SDK 초기화
  useEffect(() => {
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init(KAKAO_JS_KEY);
    }
  }, []);

  // ── 공유 Gemini 키 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "app"), d => {
      setSharedGeminiKey(d.exists() ? (d.data().sharedGeminiKey || "") : "");
    });
    return unsub;
  }, []);

  // (removed: --app-h resize listener — app root is now position:fixed so no resize jumps)



  // ── Handle Google redirect result
  useEffect(() => {
    getRedirectResult(auth).catch(e => console.error("redirect result error:", e));
  }, []);

  // ── Firebase Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const uRef = doc(db, "users", firebaseUser.uid);
          const snap = await getDoc(uRef);
          if (!snap.exists()) {
            // 허용 목록 체크: 기존 어드민/리더 없으면 첫 가입(부트스트랩) → 허용
            const anyAdmin = await getDocs(
              query(collection(db, "users"), where("role", "in", ["leader", "admin"]), limit(1))
            );
            let allowed = null;
            if (!anyAdmin.empty) {
              // 어드민이 이미 있으면 허용 목록 확인
              const allowedSnap = await getDoc(doc(db, "allowedEmails", firebaseUser.email));
              if (!allowedSnap.exists()) {
                setLoginBlockedUser({ email: firebaseUser.email, name: firebaseUser.displayName || "" });
                await signOut(auth);
                setLoginErr("not_allowed");
                return;
              }
              allowed = allowedSnap;
            }
            const presetRole = anyAdmin.empty ? "admin" : (allowed?.data()?.role || "member");
            const presetPart = allowed?.data()?.part || "";
            await setDoc(uRef, {
              name:  firebaseUser.displayName || firebaseUser.email,
              email: firebaseUser.email,
              role:  presetRole,
              part:  presetPart,
            });
          }
          // 실제 유저 데이터는 아래 onSnapshot 리스너가 담당
          setUser(u => u ?? {
            uid:   firebaseUser.uid,
            email: firebaseUser.email,
            name:  firebaseUser.displayName || firebaseUser.email,
            role:  "member",
            part:  "",
          });
        } catch {
          setUser({
            uid:   firebaseUser.uid,
            email: firebaseUser.email,
            name:  firebaseUser.displayName || firebaseUser.email,
            role:  "member",
            part:  "",
          });
        }
      } else {
        setUser(null);
      }
    });
  }, []);

  // ── 유저 문서 실시간 리스너 (role 변경 즉시 반영)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(doc(db, "users", user.uid), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setUser(u => ({
          ...u,
          name: d.name || u.name,
          role: d.role || "member",
          part: d.part || "",
          geminiKey: d.geminiKey || "",
        }));
      }
    });
  }, [user?.uid]);

  // ── Firestore: songs (real-time, auth-gated)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "songs"), orderBy("title")),
      snap => setSongs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [user?.uid]);

  // ── Firestore: services (real-time, auth-gated)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "services"), orderBy("date")),
      snap => setServices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [user?.uid]);

  // ── FCM 권한 요청 + 토큰 등록 + 포그라운드 메시지 핸들러
  useEffect(() => {
    if (!user?.uid) return;
    let unsubMsg = null;
    messagingPromise.then(m => {
      if (!m) return;
      // 권한 요청
      Notification.requestPermission().then(perm => {
        if (perm !== "granted") return;
        // 서비스 워커 등록 후 FCM 토큰 획득
        navigator.serviceWorker?.register("/firebase-messaging-sw.js")
          .then(reg => getToken(m, {
            vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || "Pk5FUSGxYoTCY40-i_PliaICVLUOBxFTS_3ALuWJV5o",
            serviceWorkerRegistration: reg,
          }))
          .then(token => {
            if (token) {
              setDoc(doc(db, "fcmTokens", user.uid), {
                token, uid: user.uid, updatedAt: serverTimestamp(),
              }, { merge: true }).catch(() => {});
            }
          })
          .catch(() => {});
      });
      // 앱이 포그라운드일 때 FCM 메시지 수신
      unsubMsg = onMessage(m, payload => {
        const title = payload.notification?.title || "TVPC Worship";
        const body  = payload.notification?.body  || "";
        if (Notification.permission === "granted") {
          new Notification(title, { body, icon: "/icon-192.png" });
        }
      });
    });
    return () => { if (unsubMsg) unsubMsg(); };
  }, [user?.uid]);

  // ── Firestore: notifications (per user, real-time) + 새 알림 브라우저 팝업
  const knownNotifIdsRef = useRef(null);
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "notifications"), orderBy("createdAt", "desc")),
      snap => {
        const docs = snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, read: (data.readBy || []).includes(user.uid), time: fmtTime(data.createdAt) };
        });
        // 새로 도착한 읽지 않은 알림 → 브라우저 팝업
        if (knownNotifIdsRef.current !== null && Notification.permission === "granted") {
          docs.filter(n => !n.read && !knownNotifIdsRef.current.has(n.id))
            .forEach(n => new Notification(n.title || "TVPC Worship", {
              body: n.body || "", icon: "/icon-192.png", tag: n.id,
            }));
        }
        knownNotifIdsRef.current = new Set(docs.map(d => d.id));
        setNotifs(docs);
        // 앱 시작 시 읽지 않은 알림 팝업 (최초 1회)
        if (!notifPopupShownRef.current) {
          notifPopupShownRef.current = true;
          const unread = docs.filter(n => !n.read);
          if (unread.length > 0) {
            // newest unread (docs are desc, so first unread)
            const latest = unread[0];
            setNotifPopup({ unreadCount: unread.length, latest });
          }
        }
      }
    );
  }, [user?.uid]);

  // ── Firestore: 개인 메모 (본인만)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "annotations"), where("userId", "==", user.uid), where("shared", "==", false)),
      snap => {
        const byId = {};
        snap.docs.forEach(d => {
          const data = d.data();
          if (!byId[data.songId]) byId[data.songId] = [];
          byId[data.songId].push({ id: d.id, ...data });
        });
        setAnnotations(byId);
      }
    );
  }, [user?.uid]);

  // ── Firestore: 팀 공유 메모 (전체)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "annotations"), where("shared", "==", true)),
      snap => {
        const byId = {};
        snap.docs.forEach(d => {
          const data = d.data();
          if (!byId[data.songId]) byId[data.songId] = [];
          byId[data.songId].push({ id: d.id, ...data });
        });
        setTeamAnnotations(byId);
      }
    );
  }, [user?.uid]);


  // ── Firestore: 유저 이름 맵 (uid -> displayName)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(collection(db, "users"), snap => {
      const m = {};
      snap.docs.forEach(d => { m[d.id] = d.data().displayName || d.data().name || d.data().email || ""; });
      setUserMap(m);
    });
  }, [user?.uid]);

  // ── Firestore: 드로잉 있는 곡 맵 (개인 + 팀)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "customSongs"),
        where(documentId(), ">=", `drw_`),
        where(documentId(), "<=", `drw_`)),
      snap => {
        const m = {};
        snap.docs.forEach(d => {
          if (!(d.data().strokes || []).length) return;
          const id = d.id;
          const teamMatch = id.match(/^drw_TEAM_(.+)_p(\d+)$/);
          if (teamMatch) {
            const sid = teamMatch[1];
            const pg = Number(teamMatch[2]);
            const prev = m[sid] || {};
            m[sid] = { ...prev, team: true, teamPages: [...(prev.teamPages || []), pg] };
            return;
          }
          const myMatch = id.match(/^drw_[^_]+_(.+)_p(\d+)$/);
          if (myMatch) {
            const sid = myMatch[1];
            const pg = Number(myMatch[2]);
            const uid = id.split("_")[1];
            const prev = m[sid] || {};
            if (uid === user.uid) m[sid] = { ...prev, my: true, myPages: [...(prev.myPages || []), pg] };
            else m[sid] = { ...prev, others: true };
          }
        });
        setSongDrawings(m);
      }
    );
  }, [user?.uid]);

  // ── Firestore: 라이브 상태 (방송팀 탭 표시용)
  useEffect(() => {
    return onSnapshot(doc(db, "liveStatus", "global"), snap => {
      setAnyLiveActive(snap.exists() && snap.data().active === true);
    });
  }, []);

  // ── PDF.js 로더
  useEffect(() => {
    if (window.pdfjsLib) { setPdfjsReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        setPdfjsReady(true);
      }
    };
    document.head.appendChild(s);
  }, []);

  // ── Global styles
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { height: 100%; overflow: hidden; }
      body { font-family: 'Noto Sans KR', -apple-system, sans-serif;
             background: ${C.bg}; color: ${C.txt}; -webkit-tap-highlight-color: transparent; }
      ::-webkit-scrollbar { width: 4px; height: 4px; }
      ::-webkit-scrollbar-thumb { background: #c8cfe0; border-radius: 2px; }
      .toolbar-scroll::-webkit-scrollbar { display: none; }
      input, textarea { font-family: inherit; }
      .wFadeIn  { animation: wFadeIn  .22s ease; }
      .wSlideUp { animation: wSlideUp .28s cubic-bezier(.16,1,.3,1); }
      @keyframes wFadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes wSlideUp { from { opacity:0; transform:translateY(32px);} to { opacity:1; transform:translateY(0); } }
      .h-screen { height: 100vh; height: var(--app-h, 100dvh); }
      .modal-sheet { max-height: 90vh; max-height: 90dvh; }
      .rec-pulse { animation: rec-pulse 1s ease-in-out infinite; }
      @keyframes rec-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    `;
    document.head.appendChild(el);
    return () => { try { document.head.removeChild(el); } catch(_) {} };
  }, []);

  // ── CRUD helpers
  const addSong = async (data) => {
    const docRef = await addDoc(collection(db, "songs"), {
      ...data,
      pdfUrl: null,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
    return docRef;
  };

  const createService = async (data) => {
    await addDoc(collection(db, "services"), {
      ...data,
      notified: false,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  };

  const updateService = async (svcId, data) => {
    await updateDoc(doc(db, "services", svcId), data);
  };

  const addAnnotation = async (songId, noteData) => {
    await addDoc(collection(db, "annotations"), {
      ...noteData,
      songId,
      userId: user.uid,
      authorName: user.displayName || user.email || "",
      shared: noteData.shared ?? false,
      createdAt: serverTimestamp(),
    });
  };

  const deleteAnnotation = async (_songId, noteId) => {
    await deleteDoc(doc(db, "annotations", noteId));
  };

  const markNotifRead = async (id) => {
    setNotifs(p => p.map(n => n.id === id ? { ...n, read: true } : n));
    await updateDoc(doc(db, "notifications", id), { readBy: arrayUnion(user.uid) });
  };

  const markAllNotifRead = async () => {
    const unread = notifs.filter(n => !n.read);
    setNotifs(p => p.map(n => ({ ...n, read: true })));
    await Promise.all(
      unread.map(n => updateDoc(doc(db, "notifications", n.id), { readBy: arrayUnion(user.uid) }))
    );
  };

  // ── KakaoTalk 인앱 브라우저 감지 → 외부 브라우저 유도
  const ua = navigator.userAgent || "";
  const isKakao   = /KAKAOTALK/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  if (isKakao) {
    const currentUrl = window.location.href;
    const openExternal = () => {
      if (isAndroid) {
        // Android: Chrome Intent URI로 강제 오픈
        window.location.href =
          `intent://${currentUrl.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
      } else {
        // iOS: safari- 스킴으로 Safari 강제 오픈
        window.location.href = currentUrl.replace(/^https/, "safari-https").replace(/^http:/, "safari-http:");
      }
    };
    return (
      <div style={{ minHeight:"100vh", background:C.bg, display:"flex",
        flexDirection:"column", alignItems:"center", justifyContent:"center",
        padding:32, fontFamily:"'Noto Sans KR', -apple-system, sans-serif" }}>
        <div style={{ fontSize:48, marginBottom:20 }}>🌐</div>
        <div style={{ fontWeight:800, fontSize:20, color:C.txt, marginBottom:8, textAlign:"center" }}>
          외부 브라우저에서 열어주세요
        </div>
        <div style={{ fontSize:14, color:C.dim, textAlign:"center", lineHeight:1.7, marginBottom:28 }}>
          카카오톡 인앱 브라우저에서는<br />
          일부 기능이 정상 동작하지 않습니다.<br />
          Safari 또는 Chrome으로 열어 사용해주세요.
        </div>
        <button onClick={openExternal} style={{
          background: C.acc, border:"none", borderRadius:12, color:"#fff",
          fontWeight:700, fontSize:15, padding:"13px 28px", cursor:"pointer",
          fontFamily:"inherit", marginBottom:16 }}>
          외부 브라우저로 열기
        </button>
        {!isAndroid && (
          <div style={{ fontSize:12, color:C.dim, textAlign:"center", lineHeight:1.8 }}>
            버튼이 작동하지 않으면<br />
            우측 하단 <b>···</b> → <b>Safari로 열기</b>를 탭해주세요
          </div>
        )}
      </div>
    );
  }

  // ── Loading screen
  if (user === undefined) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{
        width:60, height:60,
        background:`linear-gradient(135deg, ${C.acc}, ${C.pur})`,
        borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:28, boxShadow:`0 0 30px ${C.acc}44`,
      }}>🎵</div>
      <div style={{ color:C.dim, fontSize:13 }}>불러오는 중...</div>
    </div>
  );

  if (!user) return <LoginScreen loginErr={loginErr} blockedUser={loginBlockedUser}
    onClearErr={() => { setLoginErr(""); setLoginBlockedUser(null); }} />;

  const nav = (newView, params = {}) => {
    if (params.svcId       !== undefined) setSelSvcId(params.svcId);
    if (params.songId      !== undefined) setSelSongId(params.songId);
    if (params.svcSongIdx  !== undefined) setSelSvcSongIdx(params.svcSongIdx);
    if (params.backTo      !== undefined) setBackTo(params.backTo);
    setView(newView);
    localStorage.setItem("tvpc_view", newView);
  };

  const unread = notifs.filter(n => !n.read).length;

  const shared = {
    user, songs, services, notifs, annotations, teamAnnotations, userMap, songDrawings,
    addSong, createService, updateService,
    onAddAnnotation: addAnnotation,
    onDeleteAnnotation: deleteAnnotation,
    markNotifRead, markAllNotifRead,
    nav,
  };

  return (
    <div style={{ width:"100%", height:"100%", background:C.bg }}>
      {view === "services"      && <ServicesScreen      {...shared} />}
      {view === "svcDetail"     && <ServiceDetailScreen {...shared} selectedSvcId={selSvcId} onUpdateService={updateService} />}
      {view === "library"       && <SongLibraryScreen   {...shared} />}
      {view === "pdfViewer"     && (
        <PDFViewerScreen {...shared} selectedSongId={selSongId}
          selectedSvcId={selSvcId} selectedSvcSongIdx={selSvcSongIdx}
          backTo={backTo} pdfjsReady={pdfjsReady} sharedGeminiKey={sharedGeminiKey} />
      )}
      {view === "notifications" && (
        <NotificationsScreen
          notifs={notifs}
          services={services}
          markNotifRead={markNotifRead}
          markAllNotifRead={markAllNotifRead}
          user={user}
          nav={nav}
        />
      )}
      {view === "live" && (user?.role === "admin" || (isBroadcast(user?.role) && anyLiveActive)) && (
        <LiveScreen user={user} services={services} songs={songs} nav={nav} anyLiveActive={anyLiveActive} />
      )}
      {view === "profile" && (
        <ProfileScreen user={user} onLogout={() => signOut(auth)}
          onRoleUpdate={() => setUser(u => ({ ...u, role: "leader" }))} />
      )}

      {view !== "pdfViewer" && (
        <BottomNav view={view} nav={nav} unread={unread} user={user} anyLiveActive={anyLiveActive} />
      )}

      <button onClick={() => setShowHelp(true)}
        style={{
          position:"fixed",
          bottom: view === "pdfViewer"
            ? "calc(20px + env(safe-area-inset-bottom))"
            : "calc(88px + env(safe-area-inset-bottom))",
          right:16,
          width:40, height:40, borderRadius:"50%",
          background:C.pur, border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:"0 2px 10px rgba(107,93,231,0.45)",
          zIndex:1500, opacity: view === "pdfViewer" ? 0.7 : 1,
        }}>
        <span style={{ color:"#fff", fontWeight:700, fontSize:18, lineHeight:1 }}>?</span>
      </button>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {notifPopup && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:3000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div style={{ background:C.surf, borderRadius:20, padding:24, maxWidth:340, width:"100%",
            boxShadow:"0 8px 32px rgba(0,0,0,0.25)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <div style={{ width:44, height:44, borderRadius:12, background:`${C.pur}20`,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Icon n="bell" size={22} color={C.pur} />
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:16, color:C.txt }}>읽지 않은 알림</div>
                <div style={{ fontSize:13, color:C.dim }}>{notifPopup.unreadCount}개의 새 알림이 있습니다</div>
              </div>
            </div>
            <div style={{ background:C.card, borderRadius:12, padding:"12px 14px", marginBottom:20,
              border:`1px solid ${C.bdr}` }}>
              <div style={{ fontWeight:700, fontSize:14, color:C.txt, marginBottom:4 }}>
                {notifPopup.latest.type ? `[${notifPopup.latest.type}]` : ""} {notifPopup.latest.title?.replace(/^\[.*?\]\s*/, "") || ""}
              </div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.5 }}>
                {notifPopup.latest.content || notifPopup.latest.body}
              </div>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setNotifPopup(null)}
                style={{ flex:1, padding:"11px 0", borderRadius:10, border:`1px solid ${C.bdr}`,
                  background:C.card, color:C.txt, fontWeight:600, fontSize:14,
                  cursor:"pointer", fontFamily:"inherit" }}>
                닫기
              </button>
              <button onClick={() => {
                setNotifPopup(null);
                const n = notifPopup.latest;
                markNotifRead(n.id);
                if ((!n.category || n.category === "service") && n.serviceId) {
                  nav("svcDetail", { svcId: n.serviceId });
                } else {
                  nav("notifications");
                }
              }}
                style={{ flex:2, padding:"11px 0", borderRadius:10, border:"none",
                  background:C.pur, color:"#fff", fontWeight:700, fontSize:14,
                  cursor:"pointer", fontFamily:"inherit" }}>
                알림 보기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
