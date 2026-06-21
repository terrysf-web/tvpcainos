import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, Component } from "react";
import { C, KEY_CLR, DARK_KEY, keyColor, darkKeyColor } from "./theme.js";
import { Icon, Btn, Badge, KeyBadge, Input, Divider, Modal, ConfirmModal } from "./ui.jsx";
import { getVoicings, getDiatonicChords, getEffectiveKey, getChordTones, CHORD_VOICINGS } from "./chordVoicings.js";
import { auth, db, storage, messagingPromise, firebaseConfigObj } from "./firebase.js";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { getToken, onMessage } from "firebase/messaging";
import { uploadPdf, sendFcmPush, detectChordsViaEdge, uploadImage, saveWorshipRecording, loadWorshipRecording, deleteWorshipRecordingPart, saveServiceSettings, loadServiceSettings, listWorshipRecordingServiceIds } from "./supabase.js";
import { openDrivePicker } from "./drivePicker.js";
import AIPanel from "./AIPanel.jsx";
import {
  PARTS, VOCALIST_PART_IDS, SHEET_SYNC_INST_PARTS, DEFAULT_SHEET_PARTS,
  GROUP_PART_IDS, CUE_SECTIONS, INST_MODES,
  getUserParts, isVocalistUser, getUserDisplayPart,
  isLeader, isBroadcast, isFoh,
} from "./appUtils.js";
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
  query, orderBy, where, getDoc, getDocs, setDoc, serverTimestamp, arrayUnion, arrayRemove, limit, increment, documentId, writeBatch, deleteField,
} from "firebase/firestore";

const PDFViewerScreen = lazy(() => import("./PDFViewerScreen.jsx"));
const LiveScreen      = lazy(() => import("./LiveScreen.jsx"));

/* ── App version ── */
const APP_VERSION = "3.691";

function getYoutubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ── PP7 Binary Generator ────────────────────────────────────────────────────
 * Patches the lyric RTF blocks in the template file with new lyrics text.
 * Template: /templates/pp7-lyric-template.pro (12 slides, field-13 at root)
 * ─────────────────────────────────────────────────────────────────────────── */
function _pp7ReadVarint(buf, pos) {
  let result = 0, shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= (b & 0x7F) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  return { value: result, end: pos };
}
function _pp7WriteVarint(val) {
  const bytes = [];
  while (true) {
    const b = val & 0x7F; val >>>= 7;
    bytes.push(val ? b | 0x80 : b);
    if (!val) break;
  }
  return bytes;
}

// Recursively find the lyric RTF block (fcharset129 + HelveticaNeue) within a
// protobuf message, collecting ancestor {lenPos, lenVal} pairs along the way.
function _pp7FindLyricRTF(buf, start, end, ancestors) {
  let pos = start;
  while (pos < end) {
    try {
      const tagR = _pp7ReadVarint(buf, pos);
      const wt = tagR.value & 7;
      pos = tagR.end;
      if ((tagR.value >> 3) === 0) { pos++; continue; }
      if (wt === 0) { pos = _pp7ReadVarint(buf, pos).end; }
      else if (wt === 1) { pos += 8; }
      else if (wt === 2) {
        const lenR = _pp7ReadVarint(buf, pos);
        const lenPos = pos, length = lenR.value, contentPos = lenR.end;
        pos = contentPos + length;
        if (pos > buf.length) break;
        // Detect lyric RTF: starts with {\rtf1 and has both fcharset129 and HelveticaNeue
        if (buf[contentPos] === 0x7B && buf[contentPos+1] === 0x5C &&
            buf[contentPos+2] === 0x72 && buf[contentPos+3] === 0x74) {
          const preview = new TextDecoder('latin-1').decode(buf.slice(contentPos, Math.min(contentPos+300, pos)));
          if (preview.includes('fcharset129') || preview.includes('HelveticaNeue') || preview.includes('Batang')) {
            return { contentPos, contentLen: length,
                     ancestors: [...ancestors, { lenPos, lenVal: length }] };
          }
        } else {
          // Recurse
          const r = _pp7FindLyricRTF(buf, contentPos, pos,
                                     [...ancestors, { lenPos, lenVal: length }]);
          if (r) return r;
        }
      } else if (wt === 5) { pos += 4; }
      else break;
    } catch { break; }
  }
  return null;
}

// Build a Unicode→EUC-KR byte-pair lookup table using TextDecoder
let _eucKRMap = null;
function _getEUCKRMap() {
  if (_eucKRMap) return _eucKRMap;
  _eucKRMap = {};
  try {
    const dec = new TextDecoder('euc-kr', { fatal: false });
    for (let b1 = 0xA1; b1 <= 0xFE; b1++) {
      for (let b2 = 0xA1; b2 <= 0xFE; b2++) {
        const ch = dec.decode(new Uint8Array([b1, b2]));
        if (ch && ch !== '�' && ch.length === 1) _eucKRMap[ch] = [b1, b2];
      }
    }
  } catch {}
  return _eucKRMap;
}

// Encode a single text line to RTF-safe ASCII (EUC-KR hex escapes for Korean)
function _pp7EncodeRTFLine(text, eucMap) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 128) {
      out += (ch === '{' || ch === '}' || ch === '\\') ? '\\' + ch : ch;
    } else if (eucMap[ch]) {
      const [b1, b2] = eucMap[ch];
      out += `\\'${b1.toString(16).padStart(2,'0')}\\'${b2.toString(16).padStart(2,'0')}`;
    } else {
      out += `\\uc0\\u${code} `;
    }
  }
  return out;
}

// Generate the full RTF string for one lyric stanza
function _pp7GenerateLyricRTF(lyricsText) {
  const eucMap = _getEUCKRMap();
  const HDR =
    '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2822\n' +
    '\\cocoatextscaling0\\cocoaplatform0' +
    '{\\fonttbl\\f0\\fnil\\fcharset129 AppleSDGothicNeo-Bold;' +
    '\\f1\\fnil\\fcharset0 HelveticaNeue-Bold;}\n' +
    '{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n' +
    '{\\*\\expandedcolortbl;;\\cssrgb\\c100000\\c100000\\c100000;}\n' +
    '\\deftab1680\n' +
    '\\pard\\pardeftab1680\\slleading200\\pardirnatural\\qc\\partightenfactor0\n\n';
  if (!lyricsText || !lyricsText.trim()) return HDR + '}';
  const lines = lyricsText.trim().split('\n').map(l => l.trim()).filter(Boolean);
  let rtf = HDR;
  lines.forEach((line, i) => {
    const enc = _pp7EncodeRTFLine(line, eucMap);
    rtf += i === 0 ? `\\f0\\b\\fs140 \\cf2 \\up0 ${enc}\n` : `\\f1  \n\\f0 ${enc}\n`;
  });
  return rtf + '}';
}

// Main: fetch template, patch 12 lyric slides with stanzas, update title
async function _generatePP7Binary(title, lyricsText) {
  const resp = await fetch('/templates/pp7-lyric-template.pro');
  if (!resp.ok) throw new Error('PP7 템플릿 로드 실패');
  let buf = new Uint8Array(await resp.arrayBuffer());

  const stanzas = lyricsText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);

  // Find all 12 slides (field-13) at root level
  const slides = [];
  let pos = 0;
  while (pos < buf.length) {
    try {
      const tagR = _pp7ReadVarint(buf, pos);
      const fn = tagR.value >> 3, wt = tagR.value & 7;
      if (fn === 0) { pos++; continue; }
      pos = tagR.end;
      if (wt === 0) { pos = _pp7ReadVarint(buf, pos).end; }
      else if (wt === 1) { pos += 8; }
      else if (wt === 2) {
        const lenR = _pp7ReadVarint(buf, pos);
        if (fn === 13) slides.push({ lenPos: pos, lenVal: lenR.value, cs: lenR.end });
        pos = lenR.end + lenR.value;
      } else if (wt === 5) { pos += 4; } else break;
    } catch { pos++; }
  }

  // Collect patches for each slide (process in reverse to preserve offsets)
  const patches = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const rtfInfo = _pp7FindLyricRTF(buf, s.cs, s.cs + s.lenVal,
                                      [{ lenPos: s.lenPos, lenVal: s.lenVal }]);
    if (!rtfInfo) continue;
    const newRTF = _pp7GenerateLyricRTF(i < stanzas.length ? stanzas[i] : '');
    const newBytes = new TextEncoder().encode(newRTF);
    patches.push({ contentPos: rtfInfo.contentPos, contentLen: rtfInfo.contentLen,
                   newBytes, ancestors: rtfInfo.ancestors });
  }

  // Apply patches from end to start
  patches.sort((a, b) => b.contentPos - a.contentPos);
  for (const patch of patches) {
    const delta = patch.newBytes.length - patch.contentLen;
    const newBuf = new Uint8Array(buf.length + delta);
    newBuf.set(buf.slice(0, patch.contentPos));
    newBuf.set(patch.newBytes, patch.contentPos);
    newBuf.set(buf.slice(patch.contentPos + patch.contentLen),
               patch.contentPos + patch.newBytes.length);
    // Update all ancestor length varints (all are before contentPos, so positions unchanged)
    for (const anc of patch.ancestors) {
      const nv = _pp7WriteVarint(anc.lenVal + delta);
      for (let k = 0; k < nv.length; k++) newBuf[anc.lenPos + k] = nv[k];
    }
    buf = newBuf;
  }

  // Update title (field 3 at root, tag=0x1a at some early offset)
  // Scan root-level fields to find field 3
  pos = 0;
  while (pos < buf.length) {
    try {
      const tagR = _pp7ReadVarint(buf, pos);
      const fn = tagR.value >> 3, wt = tagR.value & 7;
      if (fn === 0) { pos++; continue; }
      if (wt === 2) {
        const lenR = _pp7ReadVarint(buf, pos + (tagR.end - pos));
        if (fn === 3) {
          // Found title field
          const lenPos = tagR.end;
          const oldLen = lenR.value;
          const contentPos = lenR.end;
          const newTitleBytes = new TextEncoder().encode(title);
          const delta = newTitleBytes.length - oldLen;
          const newBuf = new Uint8Array(buf.length + delta);
          newBuf.set(buf.slice(0, contentPos));
          newBuf.set(newTitleBytes, contentPos);
          newBuf.set(buf.slice(contentPos + oldLen), contentPos + newTitleBytes.length);
          const nv = _pp7WriteVarint(newTitleBytes.length);
          for (let k = 0; k < nv.length; k++) newBuf[lenPos + k] = nv[k];
          buf = newBuf;
          break;
        }
        pos = lenR.end + lenR.value;
      } else if (wt === 0) { pos = _pp7ReadVarint(buf, tagR.end).end; }
      else if (wt === 1) { pos = tagR.end + 8; }
      else if (wt === 5) { pos = tagR.end + 4; }
      else break;
    } catch { pos++; }
  }

  return buf;
}
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;


/* ── Kakao SDK ── */
const KAKAO_JS_KEY = "36693cbaae62398d925e37d550fc74a5";

/* ══════════════════════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════════════════════ */


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
  { icon:"help",      name:"도움말",            eng:"Help",          ini:"ㄷ", desc:"각 기능의 아이콘·이름·설명을 확인합니다. 악보 뷰어에서는 상단 ⋯ 더보기 버튼 → 도움말로, 그 외 화면에서는 내 정보 → 도움말로 열 수 있습니다. 한글 자음 탭 또는 영문 알파벳 탭으로 분류하거나 검색창에서 기능을 찾을 수 있습니다." },
  { icon:"note",      name:"더보기 메뉴 (⋯)",   eng:"More Menu",     ini:"ㄷ", desc:"폰 화면에서 악보 뷰어 상단 ⋯ 버튼을 탭하면 보조 기능 패널이 펼쳐집니다. 필기·메모·녹음·재생·FIT·다운로드·DUAL·미디어·전조·도움말이 포함되어 있습니다. 기능을 선택하면 패널이 자동으로 닫힙니다. 태블릿(아이패드)에서는 기존 상단 툴바에 모든 버튼이 표시됩니다." },
  { icon:"dual",      name:"두 화면(Dual)",     eng:"Dual View",     ini:"ㄷ", desc:"두 악보를 화면 좌우에 나란히 표시합니다. 예배 중 두 곡을 동시에 볼 때 유용합니다. ⚠️ 두 화면 모드에서는 ① 미디어 패널(유튜브·AI 분석) 사용 불가, ② 각 악보의 1페이지만 표시, ③ 스와이프가 페이지 이동 대신 곡 전환으로 동작합니다. 코드 감지·전조는 전조 툴바에서 왼쪽/오른쪽 각각 사용 가능합니다." },
  { icon:"dim",       name:"디미누엔도",        eng:"Diminuendo",    ini:"ㄷ", desc:"악보에 디미누엔도(점점 여리게 >) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㄹ
  { icon:"pen",       name:"내 필기 배지",      eng:"My Annotation Badge", ini:"ㄴ", desc:"악보 카드에 보라색 ✏ '내 필기' 배지가 표시되면 해당 악보에 내가 필기한 내용이 있습니다. 배지를 탭하면 바로 악보 뷰어로 이동합니다. 내 필기는 나만 볼 수 있습니다." },
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
  { icon:"home",      name:"예배",              eng:"Services",      ini:"ㅇ", desc:"예배 목록과 예배 모드를 관리합니다. 예배별 악보 세트를 구성하고 순서를 변경할 수 있습니다. 다가오는 예배는 풀 카드로 강조 표시되고, 지난 예배는 날짜·제목·곡수만 표시하는 미니 리스트로 접혀 있습니다. 3개 이상이면 '더 보기' 버튼으로 펼칩니다." },
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
  { icon:"user",      name:"파트 선택",         eng:"Part Select",   ini:"ㅍ", desc:"내 정보 화면에서 파트를 복수로 선택할 수 있습니다. 표준 파트(밴드·보컬·기타·드럼 등)는 버튼으로 바로 선택·해제하고, 드롭다운으로 추가 파트를 선택합니다. 기존에 직접 입력한 파트는 태그(×)로 표시되어 개별 삭제할 수 있습니다. 어드민 팀원 관리에서도 동일한 방식으로 멤버 파트를 수정할 수 있습니다." },
  { icon:"user",      name:"프로필",            eng:"Profile",       ini:"ㅍ", desc:"사용자 정보, AI API 키(Gemini/Groq), 알림 설정을 관리합니다. API 키를 등록하면 코드 감지 기능을 우선 사용합니다. 리더·어드민은 공유 AI 키도 설정할 수 있습니다." },
  // ㅎ
  { icon:"pen",       name:"팀 필기",           eng:"Team Annotation",ini:"ㅌ", desc:"리더·어드민이 팀 전체를 위해 남기는 필기입니다. 항상 초록색(#347C17)으로 표시되어 개인 필기와 구분됩니다. 악보 뷰어 상단에 '이 페이지에 팀필기가 있습니다' 배너가 표시되고, 악보 카드에도 초록색 '팀 필기' 배지가 붙습니다. 필기 모드에서 👥 버튼을 켜면 팀 필기 모드로 전환됩니다." },
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

/* ══════════════════════════════════════════════════════════════════
   CHORD SYNC — 데이터 & 컴포넌트
══════════════════════════════════════════════════════════════════ */
const GUITAR_CHORDS = {
  "C":     [-1, 3, 2, 0, 1, 0],
  "D":     [-1,-1, 0, 2, 3, 2],
  "E":     [ 0, 2, 2, 1, 0, 0],
  "F":     [ 1, 3, 3, 2, 1, 1],
  "G":     [ 3, 2, 0, 0, 0, 3],
  "A":     [-1, 0, 2, 2, 2, 0],
  "B":     [-1, 2, 4, 4, 4, 2],
  "Am":    [-1, 0, 2, 2, 1, 0],
  "Bm":    [-1, 2, 4, 4, 3, 2],
  "Cm":    [-1, 3, 5, 5, 4, 3],
  "Dm":    [-1,-1, 0, 2, 3, 1],
  "Em":    [ 0, 2, 2, 0, 0, 0],
  "Fm":    [ 1, 3, 3, 1, 1, 1],
  "Gm":    [ 3, 5, 5, 3, 3, 3],
  "F#m":   [ 2, 4, 4, 2, 2, 2],
  "G#m":   [ 4, 6, 6, 5, 4, 4],
  "C#m":   [-1, 4, 6, 6, 5, 4],
  "Bb":    [ 1, 1, 3, 3, 3, 1],
  "Eb":    [ 3, 3, 5, 5, 4, 3],
  "A7":    [-1, 0, 2, 0, 2, 0],
  "D7":    [-1,-1, 0, 2, 1, 2],
  "E7":    [ 0, 2, 0, 1, 0, 0],
  "G7":    [ 3, 2, 0, 0, 0, 1],
  "B7":    [-1, 2, 1, 2, 0, 2],
  "Dsus4": [-1,-1, 0, 2, 3, 3],
  "Dsus2": [-1,-1, 0, 2, 3, 0],
  "Asus4": [-1, 0, 2, 2, 3, 0],
  "Asus2": [-1, 0, 2, 2, 0, 0],
  "Esus4": [ 0, 2, 2, 2, 0, 0],
  "Cadd9": [-1, 3, 2, 0, 3, 3],
  "Gadd9": [ 3, 2, 0, 2, 3, 3],
};

const NOTE_TO_IDX = {
  "C":0,"C#":1,"Db":1,"D":2,"D#":3,"Eb":3,"E":4,"F":5,
  "F#":6,"Gb":6,"G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11,
};

const CHORD_NOTES = {
  "C":["C","E","G"],"Cm":["C","Eb","G"],
  "D":["D","F#","A"],"Dm":["D","F","A"],
  "E":["E","G#","B"],"Em":["E","G","B"],
  "F":["F","A","C"],"Fm":["F","Ab","C"],
  "G":["G","B","D"],"Gm":["G","Bb","D"],
  "A":["A","C#","E"],"Am":["A","C","E"],
  "B":["B","D#","F#"],"Bm":["B","D","F#"],
  "F#m":["F#","A","C#"],"G#m":["G#","B","D#"],"C#m":["C#","E","G#"],
  "Bb":["Bb","D","F"],"Eb":["Eb","G","Bb"],
  "A7":["A","C#","E","G"],"D7":["D","F#","A","C"],
  "E7":["E","G#","B","D"],"G7":["G","B","D","F"],"B7":["B","D#","F#","A"],
  "Dsus4":["D","G","A"],"Dsus2":["D","E","A"],
  "Asus4":["A","D","E"],"Asus2":["A","B","E"],"Esus4":["E","A","B"],
  "Cadd9":["C","D","E","G"],"Gadd9":["G","A","B","D"],
};

function GuitarDiagram({ chord, color = "#6b5de7" }) {
  const frets = GUITAR_CHORDS[chord];
  if (!frets) return (
    <div style={{ fontSize:11, color:"#636366", textAlign:"center", padding:"8px 0" }}>
      {chord} — 다이어그램 없음
    </div>
  );
  const active = frets.filter(f => f > 0);
  const minF = active.length ? Math.min(...active) : 1;
  const base = Math.max(1, minF);
  const showNut = base <= 2;
  const W = 84, H = 88;
  const pL = 14, pR = 6, pT = 20, pB = 8;
  const rows = 4;
  const fH = (H - pT - pB) / rows;
  const sW = (W - pL - pR) / 5;
  const sx = i => pL + i * sW;
  const fy = f => pT + (f - base) * fH + fH / 2;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {Array.from({length: rows + 1}, (_, i) => (
        <line key={i} x1={pL} y1={pT + i * fH} x2={W - pR} y2={pT + i * fH}
          stroke={i === 0 && showNut ? "#1c1c1e" : "#ccc"}
          strokeWidth={i === 0 && showNut ? 3.5 : 1} />
      ))}
      {Array.from({length: 6}, (_, i) => (
        <line key={i} x1={sx(i)} y1={pT} x2={sx(i)} y2={H - pB}
          stroke="#c0c0c0" strokeWidth={1} />
      ))}
      {base > 2 && (
        <text x={pL - 3} y={pT + fH / 2} textAnchor="end"
          dominantBaseline="middle" fontSize={8} fill="#8e8e93" fontWeight="700">{base}</text>
      )}
      {frets.map((f, i) => {
        const x = sx(i);
        if (f === -1) return <text key={i} x={x} y={pT - 7} textAnchor="middle"
          fontSize={10} fill="#ff3b30" fontWeight="800">×</text>;
        if (f === 0) return <circle key={i} cx={x} cy={pT - 7} r={4}
          fill="none" stroke="#1c1c1e" strokeWidth={1.5} />;
        return <circle key={i} cx={x} cy={fy(f)} r={6.5} fill={color} />;
      })}
    </svg>
  );
}

function PianoChord({ chord, color = "#6b5de7" }) {
  const notes = CHORD_NOTES[chord] || [];
  const litSet = new Set(notes.map(n => NOTE_TO_IDX[n]).filter(x => x != null));
  const rootIdx = notes.length ? NOTE_TO_IDX[notes[0]] : -1;
  const WHITE_IDX = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
  const BLACK_KEYS = [
    {idx:1, after:0}, {idx:3, after:1},
    {idx:6, after:3}, {idx:8, after:4}, {idx:10, after:5},
  ];
  const wW = 19, wH = 50, gap = 1.5, bW = 12, bH = 30;
  const unitW = wW + gap;
  const totalW = WHITE_IDX.length * unitW - gap;
  const isLit = idx => litSet.has(idx);
  const isRoot = idx => idx === rootIdx;
  return (
    <svg width={totalW} height={wH + 10} viewBox={`0 0 ${totalW} ${wH + 10}`}>
      {WHITE_IDX.map((noteIdx, i) => {
        const x = i * unitW;
        const lit = isLit(noteIdx); const root = isRoot(noteIdx);
        return (
          <rect key={i} x={x} y={8} width={wW} height={wH} rx={3}
            fill={root ? color : lit ? `${color}44` : "#fff"}
            stroke={lit ? color : "#ddd"} strokeWidth={1} />
        );
      })}
      {BLACK_KEYS.map(({ idx, after }) => {
        const x = after * unitW + wW - bW / 2;
        const lit = isLit(idx); const root = isRoot(idx);
        return (
          <rect key={idx} x={x} y={8} width={bW} height={bH} rx={2}
            fill={root ? color : lit ? `${color}cc` : "#1c1c1e"} />
        );
      })}
    </svg>
  );
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
          <span style={{ fontSize:10, color:C.dim }}>자동입력</span>
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
          소속 파트 <span style={{ color:C.dim, fontWeight:400 }}>(선택)</span>
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
          신청 메시지 <span style={{ color:C.dim, fontWeight:400 }}>(선택)</span>
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
                color:"#7a4a00", fontSize:14, fontWeight:600,
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
  const [date,       setDate]       = useState(() => localDateStr());
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
function EditServiceModal({ svc, onClose, onSave, onPracticeUrlSaved }) {
  const [title,             setTitle]             = useState(svc.title || "주일 2부");
  const [date,              setDate]              = useState(svc.date  || "");
  const [time,              setTime]              = useState(svc.time  || "");
  const [practiceUrl,       setPracticeUrl]       = useState("");
  const [practiceUrlLoaded, setPracticeUrlLoaded] = useState(false);
  const [showCustom,        setShowCustom]        = useState(!SVC_TIME_PRESETS.some(p => p.time === (svc.time || "")));
  const [saving,            setSaving]            = useState(false);

  // Supabase Storage에서 기존 practiceUrl 로드 (완료 전 저장하면 덮어쓰는 버그 방지)
  useEffect(() => {
    loadServiceSettings(svc.id)
      .then(d => { setPracticeUrl(d?.practiceUrl || ""); setPracticeUrlLoaded(true); })
      .catch(() => { setPracticeUrlLoaded(true); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!title) return;
    setSaving(true);
    try {
      // 로드 완료된 경우에만 practiceUrl 저장 (미완료 시 기존값 보존)
      if (practiceUrlLoaded) {
        const trimmedUrl = practiceUrl.trim() || null;
        await saveServiceSettings(svc.id, { practiceUrl: trimmedUrl });
        await updateDoc(doc(db, "services", svc.id), { hasPracticeUrl: !!trimmedUrl }).catch(() => {});
        onPracticeUrlSaved?.(trimmedUrl);
      }
      const changed = title !== svc.title || date !== svc.date || time !== (svc.time || "");
      if (changed) await onSave(svc.id, { title, date, time });
      onClose();
    } catch (e) {
      alert("저장 실패\n" + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="예배 정보 수정" onClose={onClose}>
      <ServiceTitleField value={title} onChange={setTitle} />
      <Input label="날짜" value={date} onChange={setDate} type="date" />
      <TimeSelector time={time} setTime={setTime} showCustom={showCustom} setShowCustom={setShowCustom} />
      <Input label="예배 연습 녹음 링크 (Google Drive)"
        value={practiceUrlLoaded ? practiceUrl : ""}
        onChange={setPracticeUrl}
        placeholder={practiceUrlLoaded ? "https://drive.google.com/file/d/..." : "불러오는 중..."}
        disabled={!practiceUrlLoaded} />
      <Btn label={saving ? "저장 중..." : "저장"} icon="check"
        onClick={handleSave} full disabled={saving || !title} />
    </Modal>
  );
}

/* ── PDF 단일 페이지 추출 (pdf-lib CDN 사용) ─────────────────────────────── */
async function extractSinglePdfPage(pdfBytes, pageNum) {
  if (!window.PDFLib) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  if (!window.PDFLib) throw new Error("pdf-lib 로드 실패");
  const { PDFDocument } = window.PDFLib;
  const src = await PDFDocument.load(pdfBytes);
  const dst = await PDFDocument.create();
  const [page] = await dst.copyPages(src, [pageNum - 1]); // 0-indexed
  dst.addPage(page);
  const bytes = await dst.save();
  return new Blob([bytes], { type: "application/pdf" });
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
      const objectUrl = URL.createObjectURL(file);
      try {
        const pdf = await window.pdfjsLib.getDocument({ url: objectUrl }).promise;
        setPdfPageCount(pdf.numPages);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
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

        // PDF bytes를 한 번만 읽어 페이지 추출에 재사용
        let pdfBytes = null;
        if (pdfFile) {
          try { pdfBytes = await pdfFile.arrayBuffer(); } catch {}
        }

        for (let i = 0; i < toSave.length; i++) {
          const e = toSave[i];
          setSavingPage(`${i + 1}/${toSave.length}`);

          // 각 곡마다 해당 페이지만 추출해 독립 파일로 업로드
          let uploadFile = pdfFile;
          let pdfPageToStore = e.pageNum;
          if (pdfBytes) {
            try {
              uploadFile = await extractSinglePdfPage(pdfBytes, e.pageNum);
              pdfPageToStore = 1; // 1-page PDF이므로 항상 1
            } catch (ex) {
              console.warn(`페이지 ${e.pageNum} 추출 실패 — 전체 PDF 사용:`, ex);
            }
          }

          const ref = await onAdd({
            title: e.title, artist: e.artist,
            key: e.key, bpm: Number(e.bpm) || 80, pdfPage: pdfPageToStore,
          });
          if (uploadFile && ref?.id) {
            const url = await uploadPdf(uploadFile, ref.id);
            const extra = { pdfUrl: url };
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
      console.error("upload error", e, e?.code, e?.customData);
      const detail = e.serverResponse || e.customData?.serverResponse || "";
      const code = e.code ? ` [${e.code}]` : "";
      alert("오류: " + e.message + code + (detail ? "\n\n서버 응답: " + detail : ""));
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
   PIANO ON OVERLAY
══════════════════════════════════════════════════════════════════ */
const PIANO_TOAST_MS = 8000;

/* ── FOH 팀 메시지 토스트 ── */
const FOH_MSG_MS = 3000;
function FohMsgToast({ message, fromName, onDismiss }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / FOH_MSG_MS) * 100);
      setPct(remaining);
      if (elapsed >= FOH_MSG_MS) { onDismiss(); return; }
      requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDismiss]);
  return (
    <div onClick={onDismiss} style={{
      position:"fixed", top:0, left:0, right:0, zIndex:99999,
      background:"linear-gradient(135deg, #1a237e, #283593)",
      color:"#fff",
      paddingTop:"env(safe-area-inset-top, 0px)",
      boxShadow:"0 4px 24px rgba(26,35,126,0.5)",
      animation:"pianoToastSlide 0.35s cubic-bezier(0.22,1,0.36,1)",
      cursor:"pointer",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px" }}>
        <span style={{ fontSize:34, lineHeight:1 }}>📢</span>
        <div style={{ flex:1 }}>
          {fromName && <div style={{ fontSize:12, opacity:0.7, marginBottom:3, fontWeight:700 }}>{String(fromName).split(" ")[0]}</div>}
          <div style={{ fontWeight:900, fontSize:20, letterSpacing:"0.03em", lineHeight:1.1 }}>{message}</div>
        </div>
        <div style={{ fontSize:12, opacity:0.55, flexShrink:0 }}>탭하면 닫힘</div>
      </div>
      <div style={{ height:3, background:"rgba(255,255,255,0.2)" }}>
        <div style={{ height:"100%", background:"rgba(255,255,255,0.7)", width:`${pct}%`, transition:"none" }} />
      </div>
    </div>
  );
}
function PianoOnOverlay({ onDismiss }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / PIANO_TOAST_MS) * 100);
      setPct(remaining);
      if (elapsed >= PIANO_TOAST_MS) { onDismiss(); return; }
      requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDismiss]);
  return (
    <div onClick={onDismiss} style={{
      position:"fixed", top:0, left:0, right:0, zIndex:99999,
      background:"linear-gradient(135deg, #b71c1c, #c62828)",
      color:"#fff",
      paddingTop:"env(safe-area-inset-top, 0px)",
      boxShadow:"0 4px 24px rgba(183,28,28,0.5)",
      animation:"pianoToastSlide 0.35s cubic-bezier(0.22,1,0.36,1)",
      cursor:"pointer",
    }}>
      <style>{`@keyframes pianoToastSlide{from{transform:translateY(-110%)}to{transform:translateY(0)}}`}</style>
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px" }}>
        <span style={{ fontSize:34, lineHeight:1 }}>🎹</span>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:900, fontSize:20, letterSpacing:"0.03em", lineHeight:1.1 }}>Piano ON</div>
          <div style={{ fontSize:13, opacity:0.8, marginTop:2 }}>반주 시작해주세요</div>
        </div>
        <div style={{ fontSize:12, opacity:0.55, flexShrink:0 }}>탭하면 닫힘</div>
      </div>
      <div style={{ height:3, background:"rgba(255,255,255,0.2)" }}>
        <div style={{ height:"100%", background:"rgba(255,255,255,0.7)", width:`${pct}%`, transition:"none" }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   HOME SCREEN
══════════════════════════════════════════════════════════════════ */
/* ── 큐 노트 스티키 섹션 ── */
function CueNotesSection({ svcSongs, songCues, user, acknowledgeCue }) {
  return (
    <div style={{ marginTop:20, marginBottom:4 }}>
      <style>{`
        @keyframes cueSlideIn {
          from { opacity:0; transform:translateX(18px); }
          to   { opacity:1; transform:translateX(0); }
        }
      `}</style>
      <div style={{ fontSize:11, fontWeight:800, color:"#e65c00",
        letterSpacing:"0.05em", textTransform:"uppercase", marginBottom:10 }}>
        🎯 큐 노트
      </div>
      {/* 가로 스크롤 스티키 노트 행 */}
      <div style={{ display:"flex", gap:10, overflowX:"auto",
        paddingBottom:6, WebkitOverflowScrolling:"touch" }}>
        {svcSongs.map((song, idx) => {
          const cues = songCues?.[song.id] || [];
          if (cues.length === 0) return null;
          return (
            <div key={song.id} style={{
              minWidth:200, maxWidth:240, flexShrink:0,
              background:"#fff8e1", border:"1.5px solid #ffe082",
              borderRadius:12, padding:"10px 12px",
              boxShadow:"0 2px 8px rgba(0,0,0,0.08)",
              display:"flex", flexDirection:"column", gap:6,
            }}>
              {/* 곡 번호 + 제목 */}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                <span style={{ background:"#ff8f00", color:"#fff", fontWeight:800,
                  fontSize:10, borderRadius:6, padding:"1px 7px", flexShrink:0 }}>
                  {idx + 1}
                </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#4a3500",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {song.title}
                </span>
              </div>
              {/* 큐 목록 */}
              {cues.map(cue => {
                const isAdmin  = user?.role === "admin" || user?.role === "leader";
                const acked    = cue.acknowledged === true;
                const isPanic  = cue.panic === true;
                const isNew    = isPanic && cue.createdAt?.toMillis?.() > Date.now() - 8000;
                const cardBg   = isPanic
                  ? (acked ? "#ffeaea" : "#fff0f0")
                  : (acked ? "#e8f5e9" : "#fffde7");
                const cardBdr  = isPanic
                  ? (acked ? "#ffaaaa" : "#ff3b30")
                  : (acked ? "#a5d6a7" : "#ffe082");
                const senderClr = isPanic ? "#c0392b" : "#e65c00";
                const textClr   = isPanic ? "#7b0000" : "#4a3500";
                return (
                  <div key={cue.id} style={{
                    background: cardBg,
                    border:`1.5px solid ${cardBdr}`,
                    borderRadius:8, padding:"7px 9px",
                    animation: isNew ? "cueSlideIn 0.3s ease-out" : "none",
                  }}>
                    {/* 보낸 사람 */}
                    <div style={{ fontSize:10, fontWeight:800, color: senderClr, marginBottom:3,
                      display:"flex", alignItems:"center", gap:4 }}>
                      {isPanic && <span style={{ fontSize:11 }}>🚨</span>}
                      {cue.userPart || cue.userName}
                    </div>
                    <div style={{ fontSize:12, color: textClr, lineHeight:1.5,
                      whiteSpace:"pre-wrap", wordBreak:"break-all", marginBottom:5,
                      fontWeight: isPanic ? 700 : 400 }}>
                      {cue.text}
                    </div>
                    {/* 하단: 수신확인(어드민만 토글) */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:5 }}>
                      {isAdmin ? (
                        <button
                          onClick={() => acknowledgeCue?.(cue.id, acked)}
                          style={{ display:"flex", alignItems:"center", gap:4,
                            background:"none", border:"none", cursor:"pointer",
                            padding:0, fontFamily:"inherit" }}>
                          <div style={{
                            width:16, height:16, borderRadius:4,
                            border:`2px solid ${acked ? "#43a047" : "#bbb"}`,
                            background: acked ? "#43a047" : "transparent",
                            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                          }}>
                            {acked && <span style={{ color:"#fff", fontSize:10, fontWeight:900, lineHeight:1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize:10, color: acked ? "#43a047" : "#636366", fontWeight:700 }}>
                            {acked ? "확인됨" : "확인"}
                          </span>
                        </button>
                      ) : (
                        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <div style={{
                            width:16, height:16, borderRadius:4,
                            border:`2px solid ${acked ? "#43a047" : "#ddd"}`,
                            background: acked ? "#43a047" : "transparent",
                            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                          }}>
                            {acked && <span style={{ color:"#fff", fontSize:10, fontWeight:900, lineHeight:1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize:10, color: acked ? "#43a047" : "#636366", fontWeight:700 }}>
                            {acked ? "확인됨" : "미확인"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PdfThumb({ pdfUrl, scale = 1.0, fitHeight = false, page = 1 }) {
  const cvRef = useRef(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    if (cvRef.current) {
      cvRef.current.width  = Math.round(595 * scale);
      cvRef.current.height = Math.round(842 * scale);
    }
    const tryRender = () => {
      if (!window.pdfjsLib) { setTimeout(tryRender, 300); return; }
      window.pdfjsLib.getDocument(pdfUrl).promise
        .then(pdf => pdf.getPage(Math.min(page || 1, pdf.numPages)))
        .then(pg => {
          if (cancelled || !cvRef.current) return;
          const vp = pg.getViewport({ scale });
          const cvs = cvRef.current;
          cvs.width = vp.width; cvs.height = vp.height;
          pg.render({ canvasContext: cvs.getContext("2d"), viewport: vp });
        })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    tryRender();
    return () => { cancelled = true; };
  }, [pdfUrl, scale, page]);
  if (err) return <span style={{ fontSize:18 }}>📄</span>;
  if (fitHeight) return (
    <canvas ref={cvRef} style={{
      display:"block", height:"100%",
      width:"auto", maxWidth:"100%", margin:"0 auto"
    }} />
  );
  return <canvas ref={cvRef} style={{ width:"100%", display:"block" }} />;
}

class FohErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, background:C.bg, padding:32 }}>
        <div style={{ fontSize:40 }}>⚠️</div>
        <div style={{ fontSize:15, fontWeight:700, color:C.txt, textAlign:"center" }}>화면 로드 오류</div>
        <div style={{ fontSize:12, color:C.dim, textAlign:"center", lineHeight:1.6 }}>캐시가 오래됐을 수 있습니다.<br/>아래 버튼을 눌러 초기화해주세요.</div>
        <button onClick={() => window.location.replace("/clear-cache.html")}
          style={{ padding:"12px 24px", borderRadius:12, background:C.pur, color:"#fff", border:"none", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
          캐시 초기화
        </button>
        <button onClick={() => this.setState({ err: null })}
          style={{ padding:"8px 16px", borderRadius:8, background:"none", color:C.dim, border:`1px solid ${C.bdr}`, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
          다시 시도
        </button>
      </div>
    );
  }
}

function HomeScreen({ user, services, songs, notifs, teamAnnotations, userMap, nav, createService, bgmChannel, songCues, acknowledgeCue, deleteCue, sheetLinkEnabled, sheetSyncTrigger, sheetSyncAllowedParts }) {
  const [countdown,    setCountdown]    = useState("");
  const [inHour,       setInHour]       = useState(false);
  const [worshipReady, setWorshipReady] = useState(false);
  const [worshipEnded, setWorshipEnded] = useState(false);
  const [autoPhase,    setAutoPhase]    = useState("idle"); // idle|vol_down|piano_on|service_start
  const [testPhase,    setTestPhase]    = useState(0); // 0=off 1=countdown 2=worshipReady 3=piano_on
  const [syncSongIdx,  setSyncSongIdx]  = useState(-1);
  const [syncSvcId,    setSyncSvcId]    = useState(null);
  const [syncSongId,   setSyncSongId]   = useState(null);
  const [adminDispIdx, setAdminDispIdx] = useState(-1);
  const [fohMsgTo,     setFohMsgTo]     = useState(null); // 선택된 수신자 uid
  const [fohMsgText,   setFohMsgText]   = useState(null); // 선택된 메시지
  const [teamUsers,    setTeamUsers]    = useState([]);
  const [fohMsgSending,setFohMsgSending]= useState(false);
  const [fohQuickMsgs, setFohQuickMsgs] = useState([]);
  const [fohPinnedUids,setFohPinnedUids]= useState([]);
  const [fohMsgEdit,   setFohMsgEdit]   = useState(false);
  const [fohMsgInput,  setFohMsgInput]  = useState("");
  const [teamChatMsgs, setTeamChatMsgs] = useState([]);
  const [showTeamChat, setShowTeamChat] = useState(false);
  const [teamChatInput,setTeamChatInput]= useState("");
  const [chatToast,    setChatToast]    = useState(null); // { name, text }
  const chatToastTimer = useRef(null);
  const [teamChatEditMode, setTeamChatEditMode] = useState(false);
  const [teamChatPresetInput, setTeamChatPresetInput] = useState("");
  const [teamChatPresets, setTeamChatPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tvpc_foh_chat_presets") || "null") || ["준비됐어요","잠깐요","확인했습니다","볼륨 체크","다음 곡 준비"]; }
    catch { return ["준비됐어요","잠깐요","확인했습니다","볼륨 체크","다음 곡 준비"]; }
  });
  const saveFohPresets = (list) => { setTeamChatPresets(list); localStorage.setItem("tvpc_foh_chat_presets", JSON.stringify(list)); };
  const [chatLastSeen, setChatLastSeen] = useState(0); // timestamp ms
  const [fohCardTab,   setFohCardTab]   = useState("chat"); // "chat" | "msg" | "foh"
  const [fohRecentSent, setFohRecentSent] = useState([]); // [{toLabel, text, time}]
  const [fohFollowTarget, setFohFollowTarget] = useState("키보드"); // 예배순서 자동감지 대상 악기
  const [pp7AutoOn,    setPp7AutoOn]    = useState(false);
  const [pp7ConnSt,    setPp7ConnSt]    = useState("idle"); // "idle"|"ok"|"err"
  const teamChatEndRef = useRef(null);
  const autoNavDone  = useRef(false);
  const phaseFiredRef = useRef({});
  const svcSongsRef  = useRef([]);
  const nextSvcIdRef  = useRef(null);
  const pp7UuidRef    = useRef("");
  const navRef       = useRef(nav);
  const stripRef     = useRef(null);
  navRef.current     = nav;
  const unread = notifs.filter(n => !n.read).length;
  const userIsFoh = isFoh(user); // parts 포함 FOH 여부 — dep array에 사용

  // FOH/어드민: 현재 sync 중인 곡 인덱스 구독
  useEffect(() => {
    if (!userIsFoh) return;
    return onSnapshot(doc(db, "liveStatus", "sheetSync"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setSyncSongIdx(d.songIdx ?? -1);
      setSyncSvcId(d.svcId ?? null);
      setSyncSongId(d.songId ?? null);
    }, () => {});
  }, [userIsFoh]);

  // FOH/어드민: 팀원 목록 로드
  useEffect(() => {
    if (!userIsFoh) return;
    getDocs(collection(db, "users")).then(snap => {
      setTeamUsers(snap.docs
        .map(d => ({ id: d.id, name: d.data().name || d.data().displayName || d.data().email || "", parts: d.data().parts || [] }))
        .filter(u => u.id !== user.uid)
        .sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
  }, [user?.uid, userIsFoh]);

  // FOH/어드민: FOH 프리메이드 메시지 목록 구독
  useEffect(() => {
    if (!userIsFoh) return;
    return onSnapshot(doc(db, "settings", "fohMessages"), snap => {
      const d = snap.exists() ? snap.data() : {};
      setFohQuickMsgs(d.messages || []);
      setFohPinnedUids(d.recipients || []);
    }, () => {});
  }, [userIsFoh]);

  const today    = localDateStr();
  const upcoming = services
    .filter(s => s.date >= today)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  const nextSvc  = upcoming[0] || null;
  const otherSvcs = upcoming.slice(1);   // nextSvc 제외 나머지 예정 예배
  const svcSongs = nextSvc
    ? (nextSvc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean)
    : [];
  // activeSyncIdx: songId 기반으로 파생 — Firestore의 숫자 인덱스(songIdx)는 신뢰하지 않음
  const _syncSongForIdx = (syncSvcId === nextSvc?.id && syncSongId)
    ? svcSongs.find(s => s.id === syncSongId) ?? null : null;
  const activeSyncIdx = _syncSongForIdx ? svcSongs.indexOf(_syncSongForIdx) : -1;
  useEffect(() => {
    if (activeSyncIdx < 0 || !stripRef.current) return;
    if (isFoh(user)) {
      const el = document.getElementById(`sheet-card-${activeSyncIdx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      const firstCard = stripRef.current.firstElementChild;
      const cardW = firstCard ? firstCard.offsetWidth : 300;
      stripRef.current.scrollTo({ left: activeSyncIdx * (cardW + 14), behavior: "smooth" });
    }
  }, [activeSyncIdx]);

  const dDay = nextSvc ? Math.ceil(
    (new Date(nextSvc.date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000
  ) : null;

  const fmtSvcDate = d => new Date(d + "T00:00:00").toLocaleDateString("ko-KR",
    { month:"long", day:"numeric", weekday:"short" });

  // svcSongs ref — 항상 최신 값 유지
  svcSongsRef.current = svcSongs;
  nextSvcIdRef.current = nextSvc?.id ?? null;

  // 서비스 변경 시 초기화
  useEffect(() => {
    autoNavDone.current = false;
    phaseFiredRef.current = {};
    setWorshipEnded(false);
    setAutoPhase("idle");
  }, [nextSvc?.id]);

  // 팀 채팅 구독 (liveChat) — 예배 ID 기준
  const teamChatMsgsRef = useRef([]);
  useEffect(() => {
    if (!nextSvc?.id) return;
    const q = query(
      collection(db, "liveChat", nextSvc.id, "messages"),
      orderBy("createdAt"), limit(60)
    );
    return onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTeamChatMsgs(msgs);
      // 새 메시지 토스트 — 내가 보낸 것 제외, 초기 로드(prev 없을 때) 제외
      if (teamChatMsgsRef.current.length > 0) {
        const prevIds = new Set(teamChatMsgsRef.current.map(m => m.id));
        const newMsgs = msgs.filter(m => !prevIds.has(m.id) && m.uid !== user?.uid);
        if (newMsgs.length > 0) {
          const last = newMsgs[newMsgs.length - 1];
          clearTimeout(chatToastTimer.current);
          setChatToast({ name: last.name?.split(" ")[0] || "팀원", text: last.text });
        }
      }
      teamChatMsgsRef.current = msgs;
    });
  }, [nextSvc?.id]);

  useEffect(() => {
    if (showTeamChat || fohCardTab === "chat") {
      setChatLastSeen(Date.now());
      setTimeout(() => teamChatEndRef.current?.scrollIntoView({ behavior:"smooth" }), 60);
    }
  }, [showTeamChat, fohCardTab, teamChatMsgs.length]);

  // PP7 자동감지 폴링
  const PP7_BASE = "http://192.168.1.21:5004";
  useEffect(() => {
    if (!pp7AutoOn || !isFoh(user)) return;
    let timer;
    const matchSong = (name) => {
      const songs = svcSongsRef.current;
      const nl = name.trim().toLowerCase();
      const idx = songs.findIndex(s => {
        const tl = s.title.trim().toLowerCase();
        return tl === nl || tl.includes(nl) || nl.includes(tl);
      });
      if (idx >= 0) {
        setAdminDispIdx(idx);
        const svcId = nextSvcIdRef.current;
        const s = songs[idx];
        if (svcId && s) {
          setDoc(doc(db, "liveStatus", "sheetSync"), {
            svcId, songId: s.id, songIdx: idx,
            pageNum: 1, linkEnabled: true, updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
    };
    const fetchPresentationName = async () => {
      for (const ep of ["/v1/presentation/active", "/v1/presentation/focused", "/v1/presentation/current"]) {
        try {
          const r = await fetch(PP7_BASE + ep, { signal: AbortSignal.timeout(1000) });
          if (!r.ok) continue;
          const d = await r.json();
          const name = d?.presentation?.name || d?.name || d?.presentation_name || "";
          if (name) { matchSong(name); return; }
        } catch {}
      }
    };
    const poll = async () => {
      try {
        const r = await fetch(PP7_BASE + "/v1/status/slide", { signal: AbortSignal.timeout(1500) });
        if (!r.ok) { setPp7ConnSt("err"); return; }
        const d = await r.json();
        const uuid = d?.current?.uuid;
        setPp7ConnSt("ok");
        if (uuid && uuid !== pp7UuidRef.current) {
          pp7UuidRef.current = uuid;
          await fetchPresentationName();
        }
      } catch { setPp7ConnSt("err"); }
      timer = setTimeout(poll, 2000);
    };
    pp7UuidRef.current = "";
    setPp7ConnSt("idle");
    poll();
    return () => clearTimeout(timer);
  }, [pp7AutoOn, user?.uid]);

  // T-0 도달 시 첫 번째 악보로 자동이동 — tick 내부에서 직접 호출

  // 카운트다운: 1시간 이내에만 표시 + 자동화 phase 엔진
  useEffect(() => {
    if (!nextSvc?.time) return;

    // leader만 phase 기록 — 멤버는 구독만
    const leader = isLeader(user?.role);

    const firePhase = async (phase, x32Action) => {
      if (phaseFiredRef.current[phase]) return;
      phaseFiredRef.current[phase] = true;
      setAutoPhase(phase);
      // PP REST API 호출
      if (phase === "piano_on") {
        // 스테이지 메시지 전송
        fetch("http://192.168.1.21:5004/v1/stage/message", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify("PIANO ON"),
        }).catch(() => {});
      }
      if (phase === "service_start") {
        // 다음 슬라이드 자동 전환
        fetch("http://192.168.1.21:5004/v1/trigger/next", {
          method: "GET",
        }).catch(() => {});
      }
      if (!leader) return; // 멤버는 Firestore 쓰기 권한 없음
      try {
        await setDoc(doc(db, "liveStatus", "automation"), {
          phase, svcId: nextSvc.id, updatedAt: serverTimestamp(),
          ...(x32Action ? { x32: x32Action } : {}),
        });
      } catch {}
    };

    const tick = () => {
      if (!nextSvc?.time?.includes(":")) return;
      const [h, m] = nextSvc.time.split(":").map(Number);
      const svcDt  = new Date(nextSvc.date + "T00:00:00");
      svcDt.setHours(h, m, 0, 0);
      const diff = svcDt - Date.now();

      if (diff <= 0) {
        setCountdown(""); setInHour(false); setWorshipReady(false);
        setWorshipEnded(true);
        firePhase("service_start", null); // X32는 건드리지 않음 — BGM 정지는 PP 페이드가 처리
        // 예배 시작 → 악보 링크 자동 해제 (어드민만)
        if (isFoh(user) && !phaseFiredRef.current.sheetLink_off) {
          phaseFiredRef.current.sheetLink_off = true;
          setDoc(doc(db, "liveStatus", "sheetLink"), {
            enabled: false, svcId: nextSvc.id, updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
        return;
      }

      setWorshipEnded(false);
      const within1h = diff <= 3_600_000;
      setInHour(within1h);
      setWorshipReady(diff <= 40_000);

      // 자동화 phase 트리거 — X32는 건드리지 않음 (페이더/뮤트 수동 복구 문제).
      // BGM은 PP 소스 자체를 페이드하므로 예배실·송출 모두 함께 줄어듦.
      if (diff <= 10_000) {
        firePhase("piano_on", null);
      } else if (diff <= 15_000) {
        firePhase("bgm_fade", null); // PP BGM 페이드아웃 시작 (pp-bridge가 처리)
      } else if (within1h && !phaseFiredRef.current.bgm_playing) {
        firePhase("bgm_playing", null);
      }

      if (within1h) {
        const totalSec = Math.floor(diff / 1000);
        const mm = Math.floor(totalSec / 60);
        const ss = totalSec % 60;
        setCountdown(`${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextSvc, user?.role, bgmChannel]);

  return (
    <div style={{ height:"100%", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* 헤더 */}
      <div style={{
        background:C.surf, flexShrink:0,
        padding:"14px 20px 12px",
        paddingTop:"calc(14px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ height:32, overflow:"hidden", display:"flex", alignItems:"center" }}>
            <img src="/icon-192.png" alt="ainos" style={{ height:90, width:"auto", objectFit:"contain", marginTop:-2 }} />
          </div>
          <span style={{ fontSize:10, fontWeight:700, color:C.dim, letterSpacing:"0.03em" }}>v{APP_VERSION}</span>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {isLeader(user.role) && (
            <button onClick={() => nav("services")}
              style={{ height:34, padding:"0 12px", borderRadius:9, cursor:"pointer",
                background:`${C.pur}18`, border:`1px solid ${C.pur}44`,
                display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <Icon n="calendar" size={14} color={C.pur} />
              <span style={{ fontSize:12, fontWeight:700, color:C.pur }}>예배일정</span>
            </button>
          )}
          <button onClick={() => nav("notifications")}
            style={{ width:34, height:34, borderRadius:9, cursor:"pointer", position:"relative",
              background:C.card, border:`1px solid ${unread > 0 ? C.acc : C.bdr}`,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Icon n="bell" size={17} color={unread > 0 ? C.acc : C.dim} />
            {unread > 0 && (
              <span style={{ position:"absolute", top:-4, right:-4, minWidth:15, height:15,
                padding:"0 3px", background:C.red, borderRadius:8, border:`2px solid ${C.surf}`,
                fontSize:9, fontWeight:800, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                lineHeight:1, boxSizing:"border-box" }}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      </div>

      <div style={{ flex:"1 1 0", height:0, overflow:"hidden", padding: userIsFoh ? "8px 10px 0" : "14px 14px 0", ...(userIsFoh && { display:"flex", flexDirection:"column" }) }}>
        {userIsFoh ? (() => {
            /* ─── FOH/ADMIN: 좌우 2열 고정 레이아웃 (nextSvc 유무 무관) ─── */
            const tInHour       = testPhase > 0 ? true  : inHour;
            const tCountdown    = testPhase === 1 ? "45:00" : testPhase === 2 ? "00:35" : testPhase === 3 ? "00:09" : countdown;
            const tWorshipReady = testPhase === 2 ? true  : testPhase === 3 ? true  : worshipReady;
            const tPhase        = testPhase === 3 ? "piano_on" : testPhase > 0 ? "bgm_playing" : autoPhase;
            const isPianoOn     = tPhase === "piano_on";
            const showMsg       = tInHour && tCountdown && (tWorshipReady || isPianoOn);

            const currentParts = sheetSyncAllowedParts ?? DEFAULT_SHEET_PARTS;
            // songId 기반 조회 — 인덱스 순서 불일치 방지
            const syncSong      = (syncSvcId === nextSvc?.id && syncSongId)
              ? svcSongs.find(s => s.id === syncSongId) ?? null : null;
            const firestoreIdx  = syncSong ? svcSongs.indexOf(syncSong) : -1;
            // 로컬 즉시 반영: adminDispIdx 우선, 없으면 서버 songId 기반 idx
            const dispIdx       = adminDispIdx >= 0 ? adminDispIdx : (firestoreIdx >= 0 ? firestoreIdx : 0);
            const dispSong      = svcSongs.length > 0 ? svcSongs[dispIdx] : null;

            const toggleLink = async () => {
              const newEnabled = !sheetLinkEnabled;
              // 수동 토글 시 tick의 자동 phase가 덮어쓰지 못하도록 양쪽 모두 차단
              phaseFiredRef.current.sheetLink_on  = true;
              phaseFiredRef.current.sheetLink_off = true;
              await setDoc(doc(db, "liveStatus", "sheetLink"), {
                enabled: newEnabled, svcId: nextSvc.id,
                allowedParts: currentParts, updatedAt: serverTimestamp(),
              }).catch(() => {});
              if (newEnabled) {
                // 싱크 ON 시 항상 첫 번째 곡으로 이동
                setAdminDispIdx(-1); // 로컬 선택 초기화 → firestoreIdx(0) 우선
                const s = svcSongs[0];
                if (s) await setDoc(doc(db, "liveStatus", "sheetSync"), {
                  svcId: nextSvc.id, songId: s.id, songIdx: 0,
                  pageNum: 1, linkEnabled: true, updatedAt: serverTimestamp(),
                }).catch(() => {});
              }
            };
            const togglePart = async (part) => {
              const next = currentParts.includes(part)
                ? currentParts.filter(p => p !== part)
                : [...currentParts, part];
              // updateDoc 사용 — enabled 필드를 건드리지 않음
              await updateDoc(doc(db, "liveStatus", "sheetLink"), {
                allowedParts: next, svcId: nextSvc.id,
              }).catch(() => {});
            };
            const selectSong = (idx) => {
              setAdminDispIdx(idx);
              if (sheetLinkEnabled) {
                const s = svcSongs[idx];
                if (s) setDoc(doc(db, "liveStatus", "sheetSync"), {
                  svcId: nextSvc.id, songId: s.id, songIdx: idx,
                  pageNum: 1, linkEnabled: true, updatedAt: serverTimestamp(),
                }).catch(() => {});
              }
            };
            const saveFohSettings = async (msgs, recipients) => {
              await setDoc(doc(db, "settings", "fohMessages"), { messages: msgs, recipients }).catch(() => {});
            };
            const addFohMsg = async () => {
              const t = fohMsgInput.trim();
              if (!t) return;
              const next = [...fohQuickMsgs, t];
              setFohMsgInput("");
              await saveFohSettings(next, fohPinnedUids);
            };
            const deleteFohMsg = async (idx) => {
              const next = fohQuickMsgs.filter((_, i) => i !== idx);
              if (fohMsgText === fohQuickMsgs[idx]) setFohMsgText(null);
              await saveFohSettings(next, fohPinnedUids);
            };
            const togglePinnedUid = async (uid) => {
              const next = fohPinnedUids.includes(uid)
                ? fohPinnedUids.filter(id => id !== uid)
                : [...fohPinnedUids, uid];
              if (!next.includes(fohMsgTo)) setFohMsgTo(null);
              await saveFohSettings(fohQuickMsgs, next);
            };
            const sendFohMessage = async () => {
              if (!fohMsgTo || !fohMsgText) return;
              setFohMsgSending(true);
              try {
                if (typeof fohMsgTo === "string" && fohMsgTo.startsWith("group:")) {
                  const groupId = fohMsgTo.slice(6);
                  const targets = teamUsers.filter(u => getUserParts(u).includes(groupId));
                  await Promise.all(targets.map(u => setDoc(doc(db, "fohMessages", u.id), {
                    message: fohMsgText, sentAt: serverTimestamp(),
                    fromName: user.name || user.email,
                  })));
                } else {
                  await setDoc(doc(db, "fohMessages", fohMsgTo), {
                    message: fohMsgText, sentAt: serverTimestamp(),
                    fromName: user.name || user.email,
                  });
                }
                setFohMsgText(null);
              } catch(e) {}
              setFohMsgSending(false);
            };

            const advanceSong = async (delta) => {
              const base = dispIdx;
              const newIdx = Math.max(0, Math.min(base + delta, svcSongs.length - 1));
              const s = svcSongs[newIdx];
              if (!s) return;
              setAdminDispIdx(newIdx); // 즉시 로컬 반영
              await setDoc(doc(db, "liveStatus", "sheetSync"), {
                svcId: nextSvc.id, songId: s.id, songIdx: newIdx,
                pageNum: 1, linkEnabled: true, updatedAt: serverTimestamp(),
              }).catch(() => {});
            };

            // 곡 번호별 구별 색상 (최대 12곡)
            const SONG_PALETTE = [
              "#ef9a9a","#90caf9","#a5d6a7","#ffcc80",
              "#ce93d8","#80cbc4","#f48fb1","#b0bec5",
              "#ffab91","#81d4fa","#dce775","#bcaaa4",
            ];
            const songColor = (idx) => SONG_PALETTE[idx % SONG_PALETTE.length];

            return (
              <>
              {/* ── 팀 채팅 토스트 알림 ── */}
              {chatToast && (
                <div onClick={() => { setShowTeamChat(true); setChatToast(null); clearTimeout(chatToastTimer.current); }}
                  style={{
                    position:"fixed", top:16, left:"50%", transform:"translateX(-50%)",
                    zIndex:9000, display:"flex", alignItems:"center", gap:10,
                    background:"#1d4ed8", color:"#fff",
                    borderRadius:14, padding:"10px 16px",
                    boxShadow:"0 4px 20px rgba(0,0,0,0.3)",
                    cursor:"pointer", maxWidth:320, width:"calc(100% - 32px)",
                    animation:"slideDown 0.25s ease",
                  }}>
                  <span style={{ fontSize:18 }}>💬</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:10, fontWeight:700, opacity:0.8, marginBottom:2 }}>{chatToast.name}</div>
                    <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{chatToast.text}</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setChatToast(null); clearTimeout(chatToastTimer.current); }}
                    style={{ background:"none", border:"none", color:"rgba(255,255,255,0.7)", fontSize:16, cursor:"pointer", padding:"0 2px" }}>✕</button>
                </div>
              )}
              {/* floating nav buttons removed — moved into sync bar */}
              <div style={{ display:"flex", flex:"1 1 0", height:0, paddingBottom:"calc(70px + env(safe-area-inset-bottom))", overflow:"hidden", background:C.bg }}>

                {/* ── 왼쪽 50%: 카드 기반 레이아웃 ── */}
                <div style={{ width:"50%", display:"flex", flexDirection:"column", gap:6, padding:"6px 4px 6px 6px", overflow:"hidden" }}>

                  {/* 히어로 카드 */}
                  {nextSvc ? (
                  <div style={{
                    flexShrink:0,
                    background: isPianoOn ? `linear-gradient(135deg, ${C.red}18, ${C.red}08)` : `linear-gradient(135deg, ${C.pur}22, ${C.acc}11)`,
                    border: isPianoOn ? `1.5px solid ${C.red}55` : `1.5px solid ${C.pur}33`,
                    borderRadius:12, padding:"10px 12px",
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      {dDay === 0
                        ? <span style={{ background:C.red, color:"#fff", fontWeight:800, fontSize:11, borderRadius:6, padding:"2px 8px", flexShrink:0 }}>오늘</span>
                        : dDay === 1
                        ? <span style={{ background:C.acc, color:"#111", fontWeight:800, fontSize:11, borderRadius:6, padding:"2px 8px", flexShrink:0 }}>내일</span>
                        : <span style={{ background:`${C.pur}22`, color:C.pur, fontWeight:800, fontSize:11, borderRadius:6, padding:"2px 8px", flexShrink:0 }}>D-{dDay}</span>
                      }
                      <div style={{ flexShrink:0, minWidth:0 }}>
                        <div style={{ fontWeight:800, fontSize:16, color:C.txt, lineHeight:1.2 }}>{fmtSvcDate(nextSvc.date)}</div>
                        <div style={{ fontSize:11, color:C.dim, marginTop:2, display:"flex", alignItems:"center", gap:4 }}>
                          <span>{nextSvc.title}</span>
                          {nextSvc.time && <><span>·</span><span>{nextSvc.time}</span></>}
                          <span>·</span><span>{svcSongs.length}곡</span>
                        </div>
                      </div>
                      <div style={{ flex:1, textAlign:"center", padding:"0 6px" }}>
                        {showMsg && (isPianoOn
                          ? <span style={{ color:C.red, fontWeight:900, fontSize:14, letterSpacing:"0.04em" }}>PIANO ON &nbsp;·&nbsp; 반주 시작</span>
                          : <span style={{ color:C.pur, fontWeight:800, fontSize:12 }}>⛪ 예배준비</span>
                        )}
                      </div>
                      {tInHour && tCountdown
                        ? <span style={{ fontVariantNumeric:"tabular-nums", fontWeight:900, fontSize:16, color: isPianoOn ? C.red : C.pur, flexShrink:0, letterSpacing:1 }}>{tCountdown}</span>
                        : <span style={{ flexShrink:0 }}><ServiceStatusBadge svc={nextSvc} /></span>
                      }
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
                      <button onClick={async () => {
                        try {
                          await setDoc(doc(db, "liveStatus", "automation"), {
                            phase: "piano_on", svcId: nextSvc?.id || null, updatedAt: serverTimestamp(),
                          });
                          fetch("http://192.168.1.21:5004/v1/stage/message", {
                            method: "PUT", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify("PIANO ON"),
                          }).catch(() => {});
                        } catch {}
                      }} style={{
                        fontSize:11, fontWeight:800, color:"#fff", background:"#b71c1c",
                        border:"none", borderRadius:6, padding:"4px 12px", cursor:"pointer", fontFamily:"inherit",
                      }}>🎹 Piano ON 알림 보내기</button>
                      <button onClick={() => setTestPhase(p => (p + 1) % 4)} style={{
                        fontSize:10, fontWeight:700, color:C.dim,
                        background:"transparent", border:`1px solid ${C.bdr}`,
                        borderRadius:5, padding:"2px 8px", cursor:"pointer", fontFamily:"inherit",
                      }}>
                        {testPhase === 0 ? "TEST" : testPhase === 1 ? "TEST 1/3" : testPhase === 2 ? "TEST 2/3" : "TEST 3/3"}
                      </button>
                    </div>
                  </div>
                  ) : (
                  <div style={{ flexShrink:0, borderRadius:12, padding:"12px 14px",
                    background:`linear-gradient(135deg, ${C.pur}18, ${C.acc}0a)`,
                    border:`1.5px solid ${C.pur}33` }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.dim, textAlign:"center" }}>예정된 예배 없음</div>
                  </div>
                  )}

                  {/* 예배종료 카드 */}
                  {worshipEnded && (
                    <div style={{ flexShrink:0, borderRadius:12, padding:"10px 16px", textAlign:"center",
                      background:`linear-gradient(135deg, ${C.dim}12, ${C.dim}06)`, border:`2px solid ${C.dim}33` }}>
                      <div style={{ fontSize:16, marginBottom:2 }}>🙏</div>
                      <div style={{ fontSize:12, fontWeight:800, color:C.dim }}>예배종료</div>
                    </div>
                  )}

                  {/* X32 상태 카드 */}
                  <div style={{ flexShrink:0 }}>
                    <X32StatusBar />
                  </div>

                  {/* ── 예배순서 + 큐노트 카드 2열 ── */}
                  <div style={{ flex:"1 1 0", height:0, display:"flex", gap:6, overflow:"hidden" }}>

                    {/* 예배 순서 카드 */}
                    <div style={{ flex:"1 1 0", display:"flex", flexDirection:"column", overflow:"hidden", background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}` }}>
                      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.bdr}`, fontSize:12, fontWeight:800, color:C.txt, flexShrink:0, display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:3, height:14, background:C.pur, borderRadius:2, display:"inline-block", flexShrink:0 }} />
                        예배 순서
                      </div>
                      <div style={{ flex:1, overflowY:"auto", padding:"6px 6px", scrollbarWidth:"none" }}>
                        {svcSongs.length === 0 ? (
                          <div style={{ fontSize:11, color:C.dim, padding:"10px 8px", textAlign:"center" }}>곡이 없습니다</div>
                        ) : svcSongs.map((song, idx) => {
                          const isActive = idx === dispIdx;
                          const sc = songColor(idx);
                          const hasCues = (songCues?.[song.id] || []).filter(c => !c.panic).length > 0;
                          return (
                            <div key={song.id + idx} onClick={() => selectSong(idx)}
                              style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 8px", borderRadius:10, marginBottom:4, cursor:"pointer",
                                background: isActive ? `${sc}20` : "transparent",
                                border:`1px solid ${isActive ? sc+"55" : "transparent"}`,
                              }}>
                              {isActive
                                ? <div style={{ width:20, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                                    <div style={{ width:0, height:0, borderTop:"7px solid transparent", borderBottom:"7px solid transparent", borderLeft:`12px solid ${sc}` }} />
                                  </div>
                                : <span style={{ width:20, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:C.dim, fontSize:12 }}>⋮⋮</span>
                              }
                              <div style={{ width:26, height:26, borderRadius:8, flexShrink:0,
                                background:sc, display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
                                <span style={{ fontSize:11, fontWeight:800, color:"#fff" }}>{idx+1}</span>
                                {hasCues && <div style={{ position:"absolute", top:-4, right:-4, width:9, height:9, borderRadius:"50%", background:"#ff6f00", border:"2px solid #fff" }} />}
                              </div>
                              <span style={{ flex:1, fontSize:13, fontWeight: isActive ? 700 : 500,
                                color: isActive ? C.pur : C.txt,
                                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {song.title}
                              </span>
                              <span style={{ flexShrink:0, fontSize:10, fontWeight: isActive ? 700 : 400,
                                color: isActive ? sc : C.dim,
                                background: isActive ? `${sc}22` : "transparent",
                                borderRadius:5, padding: isActive ? "1px 6px" : "0" }}>
                                {isActive ? "진행중" : "대기"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 큐 노트 카드 */}
                    <div style={{ flex:"1 1 0", display:"flex", flexDirection:"column", overflow:"hidden", background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}` }}>
                      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.bdr}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ width:3, height:14, background:`#ff9500`, borderRadius:2, display:"inline-block", flexShrink:0 }} />
                          <span style={{ fontSize:12, fontWeight:800, color:C.txt }}>큐 노트</span>
                        </div>
                        {dispSong && <span style={{ fontSize:10, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"55%" }}>{dispIdx+1}. {dispSong.title}</span>}
                      </div>
                      <div style={{ flex:1, overflowY:"auto", padding:"8px 10px", display:"flex", flexDirection:"column", gap:6, scrollbarWidth:"none", background:C.bg, borderRadius:"0 0 12px 12px" }}>
                        {(() => {
                          const songId = dispSong?.id;
                          const notes = songId
                            ? (songCues?.[songId] || []).filter(c => !c.panic)
                                .slice().sort((a,b) => (a.createdAt?.seconds??0)-(b.createdAt?.seconds??0))
                            : [];
                          if (notes.length === 0) return (
                            <div style={{ fontSize:11, color:C.dim, padding:"6px 10px",
                              background:C.card, borderRadius:8, border:`1px solid ${C.bdr}` }}>
                              {dispSong ? "큐노트 없음" : "곡을 선택하세요"}
                            </div>
                          );
                          const SEC_STYLES = {
                            "전체":         { bg:"#fff",    border:"#e8e8f0", title:"#1c1c1e" },
                            "인트로":       { bg:"#fff",    border:"#e8e8f0", title:"#1c1c1e" },
                            "브릿지":       { bg:"#fff8ec", border:"#f0e4c0", title:"#c07800" },
                            "아웃트로":     { bg:"#edfaf3", border:"#b8e8ce", title:"#1a8a46" },
                            "FOH 주의사항": { bg:"#fff0f0", border:"#f0c0c0", title:"#cc2200" },
                            "기타":         { bg:"#f5f5fa", border:"#e0e0ea", title:"#555566" },
                          };
                          const grouped = CUE_SECTIONS.reduce((acc, sec) => {
                            const list = notes.filter(c => (c.section || "전체") === sec);
                            if (list.length > 0) acc[sec] = list;
                            return acc;
                          }, {});
                          const unknownSec = notes.filter(c => !CUE_SECTIONS.includes(c.section || "전체"));
                          if (unknownSec.length > 0) grouped["기타"] = unknownSec;
                          return Object.entries(grouped).map(([sec, list]) => {
                            const st = SEC_STYLES[sec] || { bg:"#fffde7", border:"#ffe082", title:"#bf360c" };
                            return (
                              <div key={sec} style={{ background:st.bg, border:`1px solid ${st.border}`, borderRadius:10, overflow:"hidden" }}>
                                <div style={{ padding:"3px 10px", fontSize:10, fontWeight:800,
                                  color:st.title, letterSpacing:"0.05em", borderBottom:`1px solid ${st.border}`,
                                  background:`${st.title}10` }}>
                                  {sec}
                                </div>
                                <div style={{ display:"flex", flexDirection:"column", gap:4, padding:"6px 10px" }}>
                                  {list.map(cue => (
                                    <div key={cue.id}>
                                      <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:1 }}>
                                        <span style={{ fontSize:9, color:C.dim, flexShrink:0 }}>{cue.userPart || cue.userName || ""}</span>
                                        <button onClick={() => deleteCue?.(cue.id)} style={{
                                          marginLeft:"auto", flexShrink:0, width:14, height:14, borderRadius:"50%",
                                          background:"transparent", border:`1px solid ${C.bdr}`,
                                          color:C.dim, fontSize:9, cursor:"pointer", fontFamily:"inherit",
                                          display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
                                        }}>×</button>
                                      </div>
                                      <div style={{ fontSize:12, fontWeight:700, color:"#3c3c43", lineHeight:1.5, wordBreak:"break-all" }}>{cue.text}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                  </div>

                  {/* ── 싱크바 카드 ── */}
                  <div style={{ flexShrink:0, background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}` }}>
                    {/* 1행: 예배순서 자동감지 (PP7) */}
                    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px 6px", borderBottom:`1px solid ${C.pur}22` }}>
                      <span style={{ fontSize:11, fontWeight:800, color:C.pur, flexShrink:0, whiteSpace:"nowrap" }}>🎹 예배순서 자동감지</span>
                      <div style={{ display:"flex", gap:6, alignItems:"center", flex:1 }}>
                        <button onClick={() => setPp7AutoOn(v => !v)} style={{
                          fontSize:11, fontWeight:700,
                          background: pp7AutoOn ? C.pur : `${C.pur}18`,
                          color: pp7AutoOn ? "#fff" : C.pur,
                          border:`1.5px solid ${pp7AutoOn ? C.pur : "transparent"}`,
                          borderRadius:20, padding:"3px 10px", cursor:"pointer", fontFamily:"inherit", flexShrink:0,
                        }}>PP7</button>
                        {pp7AutoOn && (
                          <span style={{ fontSize:10, fontWeight:600,
                            color: pp7ConnSt === "ok" ? "#22c55e" : pp7ConnSt === "err" ? C.red : C.dim }}>
                            {pp7ConnSt === "ok" ? "● 연결됨" : pp7ConnSt === "err" ? "● 연결 실패" : "● 연결 중..."}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 2행: 악보 싱크 */}
                    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px 8px" }}>
                      <span style={{ fontSize:11, fontWeight:800, color:C.pur, flexShrink:0, whiteSpace:"nowrap" }}>🔗 악보 싱크</span>
                      <button onClick={svcSongs.length > 0 ? toggleLink : undefined} style={{
                        flexShrink:0, display:"flex", alignItems:"center", gap:4,
                        background:"transparent", border:"none", cursor: svcSongs.length > 0 ? "pointer" : "default",
                        padding:0, fontFamily:"inherit",
                      }}>
                        <div style={{ width:36, height:20, borderRadius:10, background: sheetLinkEnabled ? C.pur : C.bdr, position:"relative", transition:"background 0.2s" }}>
                          <div style={{ width:16, height:16, borderRadius:"50%", background:"#fff", position:"absolute", top:2, left: sheetLinkEnabled ? 18 : 2, transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }} />
                        </div>
                        <span style={{ fontSize:10, fontWeight:700, color: sheetLinkEnabled ? C.pur : C.dim }}>{sheetLinkEnabled ? "ON" : "OFF"}</span>
                      </button>
                      <div style={{ display:"flex", gap:4, flex:1, overflowX:"auto", scrollbarWidth:"none" }}>
                        {SHEET_SYNC_INST_PARTS.map(part => {
                          const active = currentParts.includes(part);
                          return (
                            <button key={part} onClick={() => togglePart(part)} style={{
                              fontSize:11, fontWeight: active ? 700 : 600,
                              background: active && sheetLinkEnabled ? C.pur : (active ? `${C.pur}22` : C.card),
                              color: active && sheetLinkEnabled ? "#fff" : (active ? C.pur : C.dim),
                              border:`1.5px solid ${active ? C.pur+"44" : C.bdr}`,
                              borderRadius:20, padding:"3px 9px", cursor:"pointer", fontFamily:"inherit", flexShrink:0,
                            }}>{part}</button>
                          );
                        })}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                        <button onClick={() => advanceSong(-1)} disabled={dispIdx <= 0} style={{
                          width:44, height:44, borderRadius:10,
                          border:`1.5px solid ${dispIdx <= 0 ? C.bdr : C.pur}`,
                          background: dispIdx <= 0 ? C.card : `${C.pur}18`,
                          fontSize:18, fontWeight:700, cursor: dispIdx <= 0 ? "not-allowed" : "pointer",
                          color: dispIdx <= 0 ? C.dim : C.pur,
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}>◀</button>
                        <button onClick={() => advanceSong(1)} disabled={dispIdx >= svcSongs.length - 1} style={{
                          width:44, height:44, borderRadius:10,
                          border:`1.5px solid ${dispIdx >= svcSongs.length - 1 ? C.bdr : C.pur}`,
                          background: dispIdx >= svcSongs.length - 1 ? C.card : `${C.pur}18`,
                          fontSize:18, fontWeight:700, cursor: dispIdx >= svcSongs.length - 1 ? "not-allowed" : "pointer",
                          color: dispIdx >= svcSongs.length - 1 ? C.dim : C.pur,
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}>▶</button>
                      </div>
                    </div>
                  </div>

                </div>

                {/* ── 오른쪽 50%: 3탭 레이아웃 ── */}
                <div style={{ width:"50%", display:"flex", flexDirection:"column", padding:"6px 6px 6px 4px", overflow:"hidden" }}>

                  {/* 탭 바 */}
                  {(() => {
                    const allCuesT = svcSongs.flatMap(s => songCues?.[s.id] || []);
                    const panicBadge = allCuesT.filter(c => c.panic === true && !c.acknowledged).length;
                    const unreadBadge = teamChatMsgs.filter(m => m.uid !== user.uid && (m.createdAt?.toMillis?.() ?? 0) > chatLastSeen).length;
                    return (
                      <div style={{ display:"flex", background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}`, marginBottom:6, flexShrink:0, overflow:"hidden" }}>
                        {[
                          { key:"chat", label:"팀채팅",    icon:"💬", color:C.pur, badge:unreadBadge },
                          { key:"msg",  label:"팀 메시지", icon:"📢", color:C.acc, badge:0 },
                          { key:"foh",  label:"FOH 알림",  icon:"🔴", color:C.red, badge:panicBadge },
                        ].map(t => (
                          <button key={t.key} onClick={() => setFohCardTab(t.key)} style={{
                            flex:1, padding:"9px 4px 7px", border:"none",
                            borderBottom:`2.5px solid ${fohCardTab===t.key ? t.color : "transparent"}`,
                            background:"none", cursor:"pointer", fontFamily:"inherit",
                            display:"flex", flexDirection:"column", alignItems:"center", gap:2, position:"relative",
                          }}>
                            <span style={{ fontSize:13, lineHeight:1 }}>{t.icon}</span>
                            <span style={{ fontSize:10, fontWeight:700, color:fohCardTab===t.key ? t.color : C.dim }}>{t.label}</span>
                            {t.badge > 0 && <span style={{ position:"absolute", top:5, right:8, minWidth:16, height:16, borderRadius:8, padding:"0 3px", background:t.color, color:"#fff", fontSize:9, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center" }}>{t.badge}</span>}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  {/* 탭 1: 팀채팅 */}
                  {fohCardTab === "chat" && (
                    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}` }}>
                      <div style={{ flex:"1 1 0", height:0, overflowY:"auto", padding:"10px", display:"flex", flexDirection:"column", gap:7, scrollbarWidth:"none" }}>
                        {teamChatMsgs.map(m => {
                          const isMe = m.uid === user.uid;
                          const timeStr = m.createdAt ? new Date(m.createdAt.toMillis()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}) : "";
                          return (
                            <div key={m.id} style={{ display:"flex", flexDirection:"column", alignItems:isMe?"flex-end":"flex-start" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:2 }}>
                                {!isMe && <span style={{ fontSize:10, color:C.dim }}>{m.name?.split(" ")[0]}</span>}
                                {timeStr && <span style={{ fontSize:9, color:C.dim }}>{timeStr}</span>}
                              </div>
                              <div style={{ maxWidth:"82%", padding:"7px 11px", borderRadius:14, fontSize:12, lineHeight:1.5, background:isMe?C.pur:C.card, color:isMe?"#fff":C.txt, borderBottomLeftRadius:isMe?14:4, borderBottomRightRadius:isMe?4:14, border:`1px solid ${isMe?"transparent":C.bdr}` }}>{m.text}</div>
                            </div>
                          );
                        })}
                        {teamChatMsgs.length === 0 && <div style={{ textAlign:"center", color:C.dim, fontSize:12, padding:"20px 0" }}>메시지 없음</div>}
                        <div ref={teamChatEndRef} />
                      </div>
                      {teamChatEditMode ? (
                        <div style={{ flexShrink:0, padding:"8px 10px", borderTop:`1px solid ${C.bdr}`, background:C.card }}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                            <span style={{ fontSize:10, fontWeight:800, color:C.dim }}>프리셋 편집</span>
                            <button onClick={() => { setTeamChatEditMode(false); setTeamChatPresetInput(""); }} style={{ fontSize:11, fontWeight:700, color:C.pur, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>완료</button>
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:6 }}>
                            {teamChatPresets.map((p, i) => (
                              <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                                <span style={{ flex:1, fontSize:11, color:C.txt }}>{p}</span>
                                <button onClick={() => {
                                  const next = teamChatPresets.filter((_,idx) => idx !== i);
                                  setTeamChatPresets(next);
                                  localStorage.setItem("tvpc_foh_chat_presets", JSON.stringify(next));
                                }} style={{ flexShrink:0, width:18, height:18, borderRadius:"50%", background:C.red, color:"#fff", border:"none", fontSize:12, fontWeight:900, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>×</button>
                              </div>
                            ))}
                            {teamChatPresets.length === 0 && <span style={{ fontSize:11, color:C.dim }}>프리셋 없음</span>}
                          </div>
                          <div style={{ display:"flex", gap:4 }}>
                            <input value={teamChatPresetInput} onChange={e => setTeamChatPresetInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key==="Enter" && teamChatPresetInput.trim()) {
                                  const next = [...teamChatPresets, teamChatPresetInput.trim()];
                                  setTeamChatPresets(next);
                                  localStorage.setItem("tvpc_foh_chat_presets", JSON.stringify(next));
                                  setTeamChatPresetInput("");
                                }
                              }}
                              placeholder="새 프리셋 추가..."
                              style={{ flex:1, fontSize:11, padding:"5px 8px", borderRadius:8, border:`1px solid ${C.bdr}`, background:C.bg, color:C.txt, outline:"none", fontFamily:"inherit" }} />
                            <button onClick={() => {
                              if (!teamChatPresetInput.trim()) return;
                              const next = [...teamChatPresets, teamChatPresetInput.trim()];
                              setTeamChatPresets(next);
                              localStorage.setItem("tvpc_foh_chat_presets", JSON.stringify(next));
                              setTeamChatPresetInput("");
                            }} style={{ flexShrink:0, padding:"5px 10px", borderRadius:8, background:C.pur, color:"#fff", border:"none", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>추가</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ flexShrink:0, padding:"6px 10px", borderTop:`1px solid ${C.bdr}`, display:"flex", flexWrap:"wrap", gap:4 }}>
                          {teamChatPresets.map((p, i) => (
                            <button key={i} onClick={async () => {
                              if (!nextSvc?.id) return;
                              await addDoc(collection(db,"liveChat",nextSvc.id,"messages"),{text:p,uid:user.uid,name:user.name||user.email,role:user.role,type:"chat",createdAt:serverTimestamp()});
                            }} style={{ padding:"4px 10px", borderRadius:14, fontSize:11, fontWeight:700, border:`1.5px solid ${C.acc}55`, background:`${C.acc}12`, color:C.acc, cursor:"pointer", fontFamily:"inherit" }}>{p}</button>
                          ))}
                          <button onClick={() => setTeamChatEditMode(true)} style={{ padding:"4px 8px", borderRadius:14, fontSize:10, border:`1px solid ${C.bdr}`, background:"none", color:C.dim, cursor:"pointer", fontFamily:"inherit" }}>✏️</button>
                        </div>
                      )}
                      <div style={{ flexShrink:0, display:"flex", gap:6, padding:"8px 10px", borderTop:`1px solid ${C.bdr}` }}>
                        <input value={teamChatInput} onChange={e => setTeamChatInput(e.target.value)}
                          onKeyDown={async e => {
                            if (e.key==="Enter" && teamChatInput.trim() && nextSvc?.id) {
                              const t = teamChatInput.trim(); setTeamChatInput("");
                              await addDoc(collection(db,"liveChat",nextSvc.id,"messages"),{text:t,uid:user.uid,name:user.name||user.email,role:user.role,type:"chat",createdAt:serverTimestamp()});
                            }
                          }}
                          placeholder="메시지 입력..."
                          style={{ flex:1, padding:"7px 10px", borderRadius:20, border:`1px solid ${C.bdr}`, background:C.bg, color:C.txt, fontSize:12, outline:"none", fontFamily:"inherit" }} />
                        <button onClick={async () => {
                          const t = teamChatInput.trim(); if (!t||!nextSvc?.id) return;
                          setTeamChatInput("");
                          await addDoc(collection(db,"liveChat",nextSvc.id,"messages"),{text:t,uid:user.uid,name:user.name||user.email,role:user.role,type:"chat",createdAt:serverTimestamp()});
                        }} style={{ width:30, height:30, borderRadius:15, background:C.pur, border:"none", color:"#fff", fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>↑</button>
                      </div>
                    </div>
                  )}

                  {/* 탭 2: 팀 메시지 */}
                  {fohCardTab === "msg" && (
                    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}` }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", borderBottom:`1px solid ${C.bdr}`, flexShrink:0 }}>
                        <span style={{ fontSize:12, fontWeight:800, color:C.acc }}>팀 메시지 보내기</span>
                        <button onClick={() => { setFohMsgEdit(e => !e); setFohMsgInput(""); }} style={{ fontSize:11, fontWeight:700, color:fohMsgEdit?C.acc:C.dim, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>{fohMsgEdit?"완료":"편집"}</button>
                      </div>
                      {fohMsgEdit ? (
                        <div style={{ flex:"1 1 0", height:0, overflowY:"auto", padding:"10px", scrollbarWidth:"none" }}>
                          <div style={{ fontSize:9, color:C.dim, fontWeight:700, marginBottom:3 }}>수신자 목록 편집</div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
                            {teamUsers.map(u => {
                              const pinned = fohPinnedUids.includes(u.id);
                              return (
                                <button key={u.id} onClick={() => togglePinnedUid(u.id)} style={{ flexShrink:0, fontSize:10, fontWeight:700, fontFamily:"inherit", padding:"3px 8px", borderRadius:12, cursor:"pointer", background:pinned?C.acc:C.card, color:pinned?"#fff":C.dim, border:`1px solid ${pinned?C.acc:C.bdr}` }}>
                                  {pinned?"✓ ":""}{u.name.split(" ")[0]}{getUserDisplayPart(u)?` (${getUserDisplayPart(u)})`:""}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ fontSize:9, color:C.dim, fontWeight:700, marginBottom:3 }}>메시지 편집</div>
                          <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:6 }}>
                            {fohQuickMsgs.map((msg, idx) => (
                              <div key={idx} style={{ display:"flex", alignItems:"center", gap:4 }}>
                                <span style={{ flex:1, fontSize:11, color:C.txt }}>{msg}</span>
                                <button onClick={() => deleteFohMsg(idx)} style={{ flexShrink:0, width:18, height:18, borderRadius:"50%", background:C.red, color:"#fff", border:"none", fontSize:11, fontWeight:900, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>×</button>
                              </div>
                            ))}
                          </div>
                          <div style={{ display:"flex", gap:4 }}>
                            <input value={fohMsgInput} onChange={e => setFohMsgInput(e.target.value)} onKeyDown={e => e.key==="Enter"&&addFohMsg()} placeholder="새 메시지 입력..." style={{ flex:1, fontSize:11, padding:"4px 8px", borderRadius:7, border:`1px solid ${C.bdr}`, background:C.bg, color:C.txt, outline:"none", fontFamily:"inherit" }} />
                            <button onClick={addFohMsg} style={{ flexShrink:0, padding:"4px 10px", borderRadius:7, cursor:"pointer", background:C.acc, color:"#fff", border:"none", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>추가</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ flex:"1 1 0", height:0, overflowY:"auto", padding:"10px", display:"flex", flexDirection:"column", gap:10, scrollbarWidth:"none" }}>
                          {/* 수신자 그리드 */}
                          <div>
                            <div style={{ fontSize:10, fontWeight:800, color:C.dim, letterSpacing:"0.04em", marginBottom:5 }}>수신자 선택</div>
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:5 }}>
                              {[["밴드","🎶"],["보컬","🎤","보컬그룹"]].map(([label, emoji, groupId = label]) => {
                                const members = teamUsers.filter(u => getUserParts(u).includes(groupId));
                                if (members.length === 0) return null;
                                const gKey = `group:${groupId}`;
                                const sel = fohMsgTo === gKey;
                                return (
                                  <button key={gKey} onClick={() => setFohMsgTo(sel?null:gKey)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"7px 4px", borderRadius:10, border:`1.5px solid ${sel?C.acc:C.bdr}`, background:sel?`${C.acc}15`:C.card, cursor:"pointer", fontFamily:"inherit" }}>
                                    <span style={{ fontSize:16, lineHeight:1 }}>{emoji}</span>
                                    <span style={{ fontSize:10, fontWeight:700, color:sel?C.acc:C.txt }}>{label}</span>
                                  </button>
                                );
                              })}
                              {teamUsers.filter(u => fohPinnedUids.includes(u.id)).map(u => {
                                const dp = getUserDisplayPart(u)||u.name.split(" ")[0];
                                const sel = fohMsgTo === u.id;
                                const pEmoji = dp.includes("드럼")?"🥁":dp.includes("베이스")?"🎸":dp.includes("키보드")?"🎹":dp.includes("일렉")?"⚡":dp.includes("기타")?"🎵":dp.includes("보컬")?"🎤":"👤";
                                return (
                                  <button key={u.id} onClick={() => setFohMsgTo(sel?null:u.id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"7px 4px", borderRadius:10, border:`1.5px solid ${sel?C.pur:C.bdr}`, background:sel?`${C.pur}15`:C.card, cursor:"pointer", fontFamily:"inherit" }}>
                                    <span style={{ fontSize:16, lineHeight:1 }}>{pEmoji}</span>
                                    <span style={{ fontSize:10, fontWeight:700, color:sel?C.pur:C.txt }}>{dp}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {/* 빠른 메시지 */}
                          {fohMsgTo && (
                            <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.bdr}`, padding:"10px" }}>
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                                <span style={{ fontSize:11, fontWeight:800, color:C.acc }}>→ {fohMsgTo?.startsWith?.("group:")?fohMsgTo.slice(6):(teamUsers.find(u=>u.id===fohMsgTo)?.name?.split(" ")[0]||"")}에게 전송</span>
                                <button onClick={() => setFohMsgTo(null)} style={{ background:"none", border:"none", fontSize:16, color:C.dim, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>✕</button>
                              </div>
                              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                                {fohQuickMsgs.length===0
                                  ? <span style={{ fontSize:11, color:C.dim }}>편집에서 메시지를 추가하세요</span>
                                  : fohQuickMsgs.map((msg, idx) => (
                                    <button key={idx} onClick={async () => {
                                      if (fohMsgSending) return;
                                      setFohMsgSending(true);
                                      const toLabel = fohMsgTo?.startsWith?.("group:") ? fohMsgTo.slice(6) : (teamUsers.find(u=>u.id===fohMsgTo)?.name?.split(" ")[0] || "");
                                      try {
                                        if (fohMsgTo.startsWith("group:")) {
                                          const targets = teamUsers.filter(u => getUserParts(u).includes(fohMsgTo.slice(6)));
                                          await Promise.all(targets.map(u => setDoc(doc(db,"fohMessages",u.id),{message:msg,sentAt:serverTimestamp(),fromName:user.name||user.email})));
                                        } else {
                                          await setDoc(doc(db,"fohMessages",fohMsgTo),{message:msg,sentAt:serverTimestamp(),fromName:user.name||user.email});
                                        }
                                        setFohRecentSent(prev => [{toLabel, text:msg, time:new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}, ...prev].slice(0,5));
                                        setFohMsgTo(null);
                                      } catch(e){}
                                      setFohMsgSending(false);
                                    }} style={{ padding:"6px 12px", borderRadius:20, border:`1.5px solid ${C.acc}55`, background:`${C.acc}12`, color:C.txt, fontSize:12, fontWeight:600, cursor:fohMsgSending?"default":"pointer", fontFamily:"inherit", opacity:fohMsgSending?0.6:1 }}>{msg}</button>
                                  ))
                                }
                              </div>
                            </div>
                          )}
                          {/* 최근 전송 */}
                          {fohRecentSent.length > 0 && (
                            <div>
                              <div style={{ fontSize:10, fontWeight:800, color:C.dim, letterSpacing:"0.04em", marginBottom:5 }}>최근 전송</div>
                              <div style={{ background:C.card, borderRadius:10, border:`1px solid ${C.bdr}`, overflow:"hidden" }}>
                                {fohRecentSent.map((r, i) => (
                                  <div key={i} style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 10px", borderBottom: i < fohRecentSent.length-1 ? `1px solid ${C.bdr}` : "none" }}>
                                    <span style={{ fontSize:11, fontWeight:800, color:C.pur, minWidth:40 }}>→ {r.toLabel}</span>
                                    <span style={{ flex:1, fontSize:11, color:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.text}</span>
                                    <span style={{ fontSize:10, color:C.dim, flexShrink:0 }}>{r.time}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 탭 3: FOH 알림 */}
                  {fohCardTab === "foh" && (
                    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}` }}>
                      <div style={{ flex:"1 1 0", height:0, overflowY:"auto", display:"flex", flexDirection:"column", gap:6, padding:"10px", scrollbarWidth:"none" }}>
                        {(() => {
                          const allCuesOv = svcSongs.flatMap(s => songCues?.[s.id] || []);
                          const panicCues = allCuesOv.filter(c => c.panic === true).sort((a,b) => (b.createdAt?.seconds??0)-(a.createdAt?.seconds??0));
                          return panicCues.length === 0 ? (
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flex:1, color:C.dim }}>
                              <div style={{ textAlign:"center" }}><div style={{ fontSize:32, marginBottom:8, opacity:0.3 }}>🔔</div><div style={{ fontSize:12 }}>알림 없음</div></div>
                            </div>
                          ) : (
                            <>
                              <style>{`@keyframes cueSlideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}`}</style>
                              {panicCues.map(cue => {
                                const acked = cue.acknowledged === true;
                                const isNew = (cue.createdAt?.toMillis?.() ?? 0) > Date.now() - 8000;
                                const partIcon = cue.userPart==="드럼"?"🥁":cue.userPart==="베이스"?"🎸":cue.userPart==="키보드"?"🎹":cue.userPart==="일렉기타"?"⚡":cue.userPart==="기타"?"🎵":cue.userPart==="보컬"?"🎤":"🚨";
                                return (
                                  <div key={cue.id} style={{ borderRadius:12, padding:"10px 12px", background:acked?"#f0fff5":"#fff5f5", border:`1.5px solid ${acked?"#34c75966":"#ffd0cc"}`, display:"flex", alignItems:"flex-start", gap:10, animation:isNew?"cueSlideIn 0.3s ease-out":"none", flexShrink:0 }}>
                                    <div style={{ fontSize:18, flexShrink:0, lineHeight:1, marginTop:1 }}>{partIcon}</div>
                                    <div style={{ flex:1, minWidth:0 }}>
                                      <div style={{ fontSize:11, fontWeight:800, color:acked?"#34c759":C.red }}>{cue.userPart||cue.userName}</div>
                                      <div style={{ fontSize:13, fontWeight:700, color:"#1c1c1e", marginTop:2, lineHeight:1.5 }}>{cue.text}</div>
                                      {cue.createdAt && <div style={{ fontSize:10, color:C.dim, marginTop:3 }}>{new Date(cue.createdAt.toMillis()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</div>}
                                    </div>
                                    <div style={{ display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>
                                      <button onClick={() => acknowledgeCue?.(cue.id, acked, {targetUid:cue.userId,cueText:cue.text})} style={{ padding:"5px 11px", borderRadius:7, background:acked?"#f0fff5":"#fff", border:`1.5px solid ${acked?"#34c75966":C.red+"66"}`, color:acked?"#34c759":C.red, fontSize:11, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>{acked?"확인됨":"확인"}</button>
                                      <button onClick={() => deleteCue?.(cue.id)} style={{ padding:"3px 8px", borderRadius:7, background:"transparent", border:`1px solid ${C.bdr}`, color:C.dim, fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>삭제</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}


                </div>
              </div>
</>
            );
          })() : (
          nextSvc ? (<>
            {/* 이번 예배 히어로 — 1행 전체 (non-admin) */}
            {(() => {
              const tInHour       = testPhase > 0 ? true  : inHour;
              const tCountdown    = testPhase === 1 ? "45:00" : testPhase === 2 ? "00:35" : testPhase === 3 ? "00:09" : countdown;
              const tWorshipReady = testPhase === 2 ? true  : testPhase === 3 ? true  : worshipReady;
              const tPhase        = testPhase === 3 ? "piano_on" : testPhase > 0 ? "bgm_playing" : autoPhase;
              const isPianoOn     = tPhase === "piano_on";
              const showMsg       = tInHour && tCountdown && (tWorshipReady || isPianoOn);
              return (
                <div style={{
                  background: isPianoOn
                    ? `linear-gradient(135deg, ${C.red}18, ${C.red}08)`
                    : `linear-gradient(135deg, ${C.pur}22, ${C.acc}11)`,
                  border: isPianoOn
                    ? `1.5px solid ${C.red}55`
                    : `1.5px solid ${C.pur}33`,
                  borderRadius:12, padding:"10px 12px", marginBottom:10,
                }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {dDay === 0
                      ? <span style={{ background:C.red, color:"#fff", fontWeight:800, fontSize:11, borderRadius:6, padding:"2px 8px", flexShrink:0 }}>오늘</span>
                      : dDay === 1
                      ? <span style={{ background:C.acc, color:"#111", fontWeight:800, fontSize:11, borderRadius:6, padding:"2px 8px", flexShrink:0 }}>내일</span>
                      : <span style={{ background:`${C.pur}22`, color:C.pur, fontWeight:800, fontSize:11, borderRadius:6, padding:"2px 8px", flexShrink:0 }}>D-{dDay}</span>
                    }
                    <div style={{ flexShrink:0, minWidth:0 }}>
                      <div style={{ fontWeight:800, fontSize:18, color:C.txt, lineHeight:1.2 }}>{fmtSvcDate(nextSvc.date)}</div>
                      <div style={{ fontSize:12, color:C.dim, marginTop:2, display:"flex", alignItems:"center", gap:5 }}>
                        <span>{nextSvc.title}</span>
                        {nextSvc.time && <><span>·</span><span>{nextSvc.time}</span></>}
                        <span>·</span>
                        <span>{svcSongs.length}곡</span>
                      </div>
                    </div>
                    <div style={{ flex:1, textAlign:"center", padding:"0 8px" }}>
                      {showMsg && (isPianoOn
                        ? <span style={{ color:C.red, fontWeight:900, fontSize:22, letterSpacing:"0.04em" }}>
                            PIANO ON &nbsp;·&nbsp; 반주 시작해주세요
                          </span>
                        : <span style={{ color:C.pur, fontWeight:800, fontSize:18 }}>
                            ⛪ 예배준비 &nbsp;·&nbsp; 예배 시작 시 악보로 자동 이동합니다
                          </span>
                      )}
                    </div>
                    {tInHour && tCountdown
                      ? <span style={{
                          fontVariantNumeric:"tabular-nums", fontWeight:900, fontSize:17,
                          color: isPianoOn ? C.red : C.pur,
                          flexShrink:0, letterSpacing:1,
                        }}>{tCountdown}</span>
                      : <span style={{ flexShrink:0 }}><ServiceStatusBadge svc={nextSvc} /></span>
                    }
                  </div>
                </div>
              );
            })()}

            {/* 예배종료 */}
            {worshipEnded && (
              <div style={{
                borderRadius:16, padding:"14px 20px", marginBottom:10,
                textAlign:"center",
                background:`linear-gradient(135deg, ${C.dim}12, ${C.dim}06)`,
                border:`2px solid ${C.dim}33`,
              }}>
                <div style={{ fontSize:22, marginBottom:4 }}>🙏</div>
                <div style={{ fontSize:15, fontWeight:800, color:C.dim, letterSpacing:"0.08em" }}>
                  예배종료
                </div>
                <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>
                  {nextSvc?.title} · {nextSvc?.time}
                </div>
              </div>
            )}

            {isBroadcast(user?.role) ? (
            <>
            {/* X32 채널 상태 */}
            <X32StatusBar />

            {/* 악보 리스트 — 스냅 캐러셀 */}
            {svcSongs.length > 0 && (
              <>
                <div style={{ fontSize:11, fontWeight:800, color:C.pur,
                  letterSpacing:"0.05em", textTransform:"uppercase", marginBottom:10 }}>
                  이번 주 악보
                </div>
                <div ref={stripRef} style={{
                  display:"flex", gap:14, overflowX:"auto", paddingBottom:8,
                  scrollSnapType:"x mandatory",
                  WebkitOverflowScrolling:"touch",
                  scrollbarWidth:"none", msOverflowStyle:"none",
                  paddingLeft:"calc(50% - 41vw)",
                  paddingRight:"calc(50% - 41vw)",
                  margin:"0 -14px",
                }}>
                  {svcSongs.map((song, idx) => {
                    const hasSheet    = !!(song.pdfUrl || song.imageUrl);
                    const hasTranspose = user?.uid && localStorage.getItem(`tvpc_tm_${user.uid}_${song.id}`) === "1";
                    const isActive    = idx === activeSyncIdx;
                    return (
                      <div key={song.id + idx}
                        onClick={() => hasSheet && nav("pdfViewer", { songId:song.id, svcId:nextSvc.id, svcSongIdx:idx, backTo:"home" })}
                        style={{
                          flexShrink:0, width:"82vw",
                          scrollSnapAlign:"center",
                          cursor: hasSheet ? "pointer" : "default",
                        }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                          <div style={{ width:20, height:20, borderRadius:6,
                            background: isActive ? C.pur : `${C.pur}18`,
                            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <span style={{ fontSize:11, fontWeight:800, color: isActive ? "#fff" : C.pur }}>{idx + 1}</span>
                          </div>
                          <span style={{ fontSize:12, fontWeight:700, color: isActive ? C.pur : C.txt,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
                            {song.title}
                          </span>
                        </div>
                        <div style={{
                          width:"82vw", height:"60vh", borderRadius:12, overflow:"hidden",
                          background:C.card,
                          border: isActive ? `2.5px solid ${C.pur}` : `1px solid ${C.bdr}`,
                          boxShadow: isActive ? `0 0 0 4px ${C.pur}28` : "none",
                          position:"relative",
                          transition:"border 0.15s, box-shadow 0.15s",
                          opacity: hasSheet ? 1 : 0.5,
                        }}>
                          {song.imageUrl ? (
                            <img src={song.imageUrl} alt=""
                              style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top center" }} />
                          ) : song.pdfUrl ? (
                            <div style={{ width:"100%", overflow:"hidden" }}>
                              <PdfThumb pdfUrl={song.pdfUrl} page={song.pdfPage || 1} />
                            </div>
                          ) : (
                            <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}>
                              <span style={{ fontSize:40, opacity:0.2 }}>🎵</span>
                            </div>
                          )}
                          <div style={{ position:"absolute", bottom:7, left:7, display:"flex", gap:4, flexWrap:"wrap" }}>
                            {song.key && (
                              <span style={{ background:`${keyColor(song.key)}ee`, color:"#fff",
                                borderRadius:6, padding:"2px 7px", fontSize:10, fontWeight:800 }}>
                                {song.key}
                              </span>
                            )}
                            {song.bpm && (
                              <span style={{ background:"rgba(0,0,0,0.6)", color:"#fff",
                                borderRadius:6, padding:"2px 7px", fontSize:10 }}>
                                ♩{song.bpm}
                              </span>
                            )}
                            {hasTranspose && (
                              <span style={{ background:`${C.pur}ee`, color:"#fff",
                                borderRadius:6, padding:"2px 7px", fontSize:10, fontWeight:800 }}>
                                전조
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 빈 상태 */}
            {svcSongs.length === 0 && (
              <div style={{ textAlign:"center", padding:"32px 0", color:C.dim }}>
                <div style={{ fontSize:32, marginBottom:8 }}>🎵</div>
                <div style={{ fontSize:14 }}>아직 곡이 없습니다</div>
              </div>
            )}

            {/* ── 큐 노트 섹션 ── */}
            {(() => {
              const allCues = svcSongs.flatMap(s => songCues?.[s.id] || []);
              if (allCues.length === 0) return null;
              return (
                <CueNotesSection
                  svcSongs={svcSongs}
                  songCues={songCues}
                  user={user}
                  acknowledgeCue={acknowledgeCue}
                />
              );
            })()}
            </> /* broadcast end */
            ) : (
            /* 일반 멤버: 단순 곡 리스트 */
            <>
              {svcSongs.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:800, color:C.pur,
                    letterSpacing:"0.05em", textTransform:"uppercase", marginBottom:6 }}>
                    이번 주 악보
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {svcSongs.map((song, idx) => {
                      const hasSheet = !!(song.pdfUrl || song.imageUrl);
                      return (
                        <div key={song.id + idx}
                          onClick={() => hasSheet && nav("pdfViewer", { songId:song.id, svcId:nextSvc.id, svcSongIdx:idx, backTo:"home" })}
                          style={{ display:"flex", alignItems:"center", gap:10,
                            background:C.surf, border:`1px solid ${C.bdr}`,
                            borderRadius:12, padding:"10px 14px",
                            cursor: hasSheet ? "pointer" : "default",
                            opacity: hasSheet ? 1 : 0.65,
                          }}>
                          <div style={{ width:26, height:26, borderRadius:8, flexShrink:0,
                            background:`${C.pur}18`,
                            display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <span style={{ fontSize:11, fontWeight:800, color:C.pur }}>{idx + 1}</span>
                          </div>
                          <span style={{ flex:1, fontWeight:700, fontSize:15,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {song.title}
                          </span>
                          {song.key && (
                            <span style={{ flexShrink:0, fontSize:11, fontWeight:700,
                              background:`${keyColor(song.key)}22`, color:darkKeyColor(song.key),
                              border:`1px solid ${keyColor(song.key)}44`,
                              borderRadius:6, padding:"2px 8px" }}>
                              {song.key}
                            </span>
                          )}
                          {hasSheet && <Icon n="chevR" size={14} color={C.dim} />}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {svcSongs.length === 0 && (
                <div style={{ textAlign:"center", padding:"32px 0", color:C.dim }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>🎵</div>
                  <div style={{ fontSize:14 }}>아직 곡이 없습니다</div>
                </div>
              )}
            </> /* 일반 멤버 end */
            )}

            {/* 다음 예배 일정 전체 목록 (admin은 숨김 - 큐 노트 집중) */}
            {otherSvcs.length > 0 && user?.role !== "admin" && (
              <>
                <div style={{ fontSize:11, fontWeight:800, color:C.dim,
                  letterSpacing:"0.05em", textTransform:"uppercase",
                  marginTop:20, marginBottom:8 }}>
                  예배 일정
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {otherSvcs.map(svc => {
                    const cnt = (svc.songIds || []).length;
                    const dd  = Math.ceil(
                      (new Date(svc.date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000
                    );
                    return (
                      <div key={svc.id}
                        onClick={() => nav("svcDetail", { svcId: svc.id })}
                        style={{
                          background:C.surf, border:`1px solid ${C.bdr}`,
                          borderRadius:12, padding:"10px 14px",
                          display:"flex", alignItems:"center", gap:10,
                          cursor:"pointer",
                        }}>
                        <span style={{
                          background:`${C.pur}18`, color:C.pur,
                          fontWeight:800, fontSize:10, borderRadius:6,
                          padding:"2px 7px", flexShrink:0,
                        }}>D-{dd}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:14,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {fmtSvcDate(svc.date)}{svc.time ? ` · ${svc.time}` : ""}
                          </div>
                          <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                            {svc.title}
                          </div>
                        </div>
                        <span style={{ fontSize:12, color:C.dim, flexShrink:0 }}>{cnt}곡</span>
                        <Icon n="chevR" size={14} color={C.dim} />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>) : (
            <div style={{ textAlign:"center", padding:"80px 20px", color:C.dim }}>
              <div style={{ fontSize:52, marginBottom:16 }}>📋</div>
              <div style={{ fontWeight:700, fontSize:16, marginBottom:8, color:C.txt }}>예정된 예배가 없습니다</div>
              <div style={{ fontSize:13, marginBottom:24 }}>예배를 추가해 악보를 준비하세요</div>
              {isLeader(user.role) && (
                <button onClick={() => nav("services")} style={{ background:C.pur, border:"none", borderRadius:12, padding:"12px 28px", cursor:"pointer", fontSize:14, fontWeight:700, color:"#fff", fontFamily:"inherit" }}>예배 관리로 이동</button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* 밴드 악기 상태 바 — Firestore x32/status 실시간 구독 */
function X32StatusBar() {
  const X32_CHANNELS = [
    { id:"drum",   label:"드럼",     icon:"🥁", chs:"CH 1,2" },
    { id:"bass",   label:"베이스",   icon:"🎸", chs:"CH 3"   },
    { id:"guitar", label:"기타",     icon:"🎸", chs:"CH 4"   },
    { id:"elec",   label:"일렉기타", icon:"⚡", chs:"CH 5,6" },
    { id:"kbd",    label:"키보드",   icon:"🎹", chs:"CH 7,8" },
  ];
  const [groups,    setGroups]    = useState([]);
  const [connected, setConnected] = useState(false);
  const [stale,     setStale]     = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "x32", "status"), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setGroups(d.groups || []);
      setConnected(!!d.connected);
      // 10초 이상 갱신 없으면 stale
      const updatedAt = d.updatedAt?.toDate?.() || null;
      setStale(updatedAt ? (Date.now() - updatedAt.getTime() > 10000) : true);
    }, () => {});
    return unsub;
  }, []);

  const live = connected && !stale;

  // 오프라인이면 작은 뱃지만 표시
  if (!live) {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6,
        padding:"5px 8px", borderRadius:8,
        background:C.surf, border:`1px solid ${C.bdr}` }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background:C.dim, flexShrink:0 }} />
        <span style={{ fontSize:10, color:C.dim }}>믹서 오프라인</span>
      </div>
    );
  }

  return (
    <div style={{ padding:"5px 8px", borderRadius:8, background:C.surf, border:`1px solid ${C.bdr}`, marginBottom:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:3, flexShrink:0 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:C.grn, flexShrink:0 }} />
          <span style={{ fontSize:10, fontWeight:800, color:C.grn }}>LIVE</span>
        </div>
        {X32_CHANNELS.map(ch => {
          const g     = groups.find(g => g.id === ch.id);
          const pct   = Math.round((g?.fader ?? 0) * 100);
          const muted = g?.muted ?? false;
          const color = muted ? C.acc : pct > 90 ? C.red : C.grn;
          return (
            <div key={ch.id} style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <span style={{ fontSize:9, fontWeight:700, color: muted ? C.acc : C.dim, lineHeight:1 }}>{ch.label}</span>
              <div style={{ width:"100%", height:4, background:C.bdr, borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:2, width:pct+"%", background:color, transition:"width 0.3s" }} />
              </div>
              {muted && <span style={{ fontSize:8, fontWeight:800, color:C.acc, lineHeight:1 }}>MUTE</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SERVICES SCREEN
══════════════════════════════════════════════════════════════════ */
function ServiceStatusBadge({ svc }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!svc.time) return <span style={{ fontSize:13, color:C.dim, borderRadius:7, padding:"4px 10px", fontWeight:700, background:`${C.dim}18`, border:`1px solid ${C.bdr}` }}>예배 준비중</span>;

  const [hh, mm] = svc.time.split(":").map(Number);
  const start = new Date(svc.date + "T00:00:00");
  start.setHours(hh, mm, 0, 0);
  const secsUntil = (start - now) / 1000;
  const secsAfter = (now - start) / 1000;

  let label, type;
  if (secsUntil > 3600)      { label = "예배 준비중";    type = "preparing"; }
  else if (secsUntil > 0) {
    const t = Math.ceil(secsUntil);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    label = h > 0
      ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
      : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    type = "countdown";
  }
  else if (secsAfter < 5400)  { label = "예배 진행중";    type = "active"; }
  else if (secsAfter < 10800) { label = "예배 종료";      type = "ended"; }
  else                        { label = "다음 예배 준비중"; type = "next"; }

  const s = {
    preparing: { bg:`${C.dim}18`, color:C.dim, border:`1px solid ${C.bdr}` },
    countdown: { bg:`${C.acc}15`, color:"#7a4a00", border:`1px solid ${C.acc}55`, fontVariantNumeric:"tabular-nums", fontWeight:800, fontSize:15, letterSpacing:"-0.02em" },
    active:    { bg:`${C.grn}18`, color:"#157a30", border:`1px solid ${C.grn}55` },
    ended:     { bg:`${C.dim}12`, color:C.dim, border:`1px solid ${C.bdr}` },
    next:      { bg:`${C.pur}15`, color:C.pur, border:`1px solid ${C.pur}44` },
  }[type];

  return (
    <span style={{ fontSize:13, borderRadius:7, padding:"4px 10px", fontWeight:700, background:s.bg, color:s.color, border:s.border, ...s }}>
      {type === "active" && <span style={{ marginRight:4 }}>●</span>}
      {label}
    </span>
  );
}

function ServicesScreen({ user, services, servicesLoaded, songs, notifs, createService, nav, teamAnnotations }) {
  const [showCreate,   setShowCreate]   = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const unread = notifs.filter(n => !n.read).length;

  const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("ko-KR",
    { month:"long", day:"numeric", weekday:"short" });

  const today    = localDateStr();
  // 예배가 시작 후 2시간 경과했는지 (오늘 날짜용)
  const twoHoursElapsed = (svc) => {
    if (!svc.time) return false;
    const [hh, mm] = svc.time.split(":").map(Number);
    const now = new Date();
    const svcMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0).getTime();
    return Date.now() - svcMs > 2 * 60 * 60 * 1000;
  };
  // 예배 날짜 기준 다음 토요일 (그 토요일이 되면 지난 예배로 이동)
  const nextSaturday = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const daysToSat = d.getDay() === 6 ? 7 : (6 - d.getDay());
    d.setDate(d.getDate() + daysToSat);
    return localDateStr(d);
  };
  // 바로 지난 예배 판단: 지났지만 다음 토요일 전까지
  const isJustPast = (svc) => {
    const hasPassed = svc.date < today || (svc.date === today && twoHoursElapsed(svc));
    return hasPassed && today < nextSaturday(svc.date);
  };
  const upcoming  = services.filter(s => !isJustPast(s) && (s.date > today || (s.date === today && !twoHoursElapsed(s))));
  const justPast  = services.filter(s => isJustPast(s));
  // 지난 예배: 바로 지난 예배 제외, 최신순 정렬
  const past     = services.filter(s => {
    const hasPassed = s.date < today || (s.date === today && twoHoursElapsed(s));
    return hasPassed && !isJustPast(s);
  }).slice().sort((a, b) => b.date.localeCompare(a.date));
  const pastShown = pastExpanded ? past : past.slice(0, 3);

  const SvcCard = ({ svc, past, first, justPast: jp }) => {
    const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    const borderStyle = jp
      ? `1.5px solid ${C.pur}66`
      : past
        ? `1px solid ${C.bdr}`
        : first
          ? `2px solid ${C.acc}`
          : `1px solid ${C.bdr}`;
    const shadowStyle = jp
      ? `0 2px 10px ${C.pur}22`
      : past
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
            <div style={{ fontWeight: first || jp ? 800 : 700, fontSize: first || jp ? 17 : 16 }}>{fmtDate(svc.date)}</div>
            <div style={{ color: jp ? C.pur : first ? C.acc : C.dim, fontSize:13, marginTop:3, fontWeight: first || jp ? 600 : 400 }}>
              {svc.title}{svc.time ? ` · ${svc.time}` : ""}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:3, flexShrink:0, marginLeft:8 }}>
            {svc.notified && (
              <span style={{ fontSize:10, fontWeight:700, color:"#8a4f00", background:"#e8a93e14", border:"1px solid #e8a93e40", borderRadius:4, padding:"2px 7px", whiteSpace:"nowrap" }}>알림완료</span>
            )}
            {svc.hasRecordings && (
              <span style={{ fontSize:10, fontWeight:700, color:"#1a72c2", background:"#3a7bd514", border:"1px solid #3a7bd540", borderRadius:4, padding:"2px 7px", whiteSpace:"nowrap" }}>예배녹음</span>
            )}
            {svc.hasPracticeUrl && (
              <span style={{ fontSize:10, fontWeight:700, color:"#157a30", background:"#34c75914", border:"1px solid #34c75940", borderRadius:4, padding:"2px 7px", whiteSpace:"nowrap" }}>연습녹음</span>
            )}
          </div>
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
                background:`${keyColor(s.key)}22`, color:darkKeyColor(s.key),
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

      <div style={{ flex:1, overflowY:"auto", padding:16, paddingBottom:"calc(80px + env(safe-area-inset-bottom))" }}>
        {/* 다가오는 예배 */}
        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:10 }}>다가오는 예배</div>
            {upcoming.map((svc, i) => <SvcCard key={svc.id} svc={svc} past={false} first={i === 0} />)}
          </>
        )}

        {/* 바로 지난 예배 */}
        {justPast.length > 0 && (
          <>
            <div style={{
              fontSize:11, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:10,
              marginTop: upcoming.length > 0 ? 28 : 0,
              display:"flex", alignItems:"center", gap:5,
              color: C.pur,
            }}>
              <span>⏰</span>
              <span>바로 지난 예배</span>
            </div>
            {justPast.map(svc => <SvcCard key={svc.id} svc={svc} past={false} first={false} justPast={true} />)}
          </>
        )}

        {/* 지난 예배 아카이브 — 미니 리스트 */}
        {past.length > 0 && (
          <>
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              margin:`${upcoming.length > 0 || justPast.length > 0 ? "28px" : "16px"} 0 8px`,
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
              {pastExpanded && (
                <button onClick={() => setPastExpanded(false)} style={{
                  background:"transparent", border:`1px solid ${C.bdr}`,
                  borderRadius:7, padding:"3px 10px", cursor:"pointer",
                  fontSize:11, color:C.dim, fontFamily:"inherit", fontWeight:600,
                }}>접기</button>
              )}
            </div>
            <div style={{
              background:C.surf, borderRadius:14, border:`1px solid ${C.bdr}`, overflow:"hidden",
            }}>
              {pastShown.map((svc, i) => {
                const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
                return (
                  <div key={svc.id}
                    onClick={() => nav("svcDetail", { svcId: svc.id })}
                    style={{
                      display:"flex", alignItems:"center", gap:12,
                      padding:"12px 14px", cursor:"pointer",
                      borderBottom: i < pastShown.length - 1 ? `1px solid ${C.bdr}` : "none",
                    }}>
                    <div style={{
                      width:8, height:8, borderRadius:"50%", flexShrink:0,
                      background:`${C.dim}44`, border:`1.5px solid ${C.bdr}`,
                    }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, color:C.dim, fontWeight:600, marginBottom:1 }}>
                        {fmtDate(svc.date)}
                      </div>
                      <div style={{ fontSize:13, color:C.txt, fontWeight:700,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {svc.title}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                      {svcSongs.length > 0 && (
                        <span style={{
                          fontSize:11, color:C.dim,
                          background:C.bg, border:`1px solid ${C.bdr}`,
                          borderRadius:5, padding:"1px 6px",
                        }}>{svcSongs.length}곡</span>
                      )}
                      {svc.notified && (
                        <span style={{ fontSize:10, fontWeight:700, color:"#8a4f00", background:"#e8a93e14", border:"1px solid #e8a93e40", borderRadius:4, padding:"1px 6px" }}>알림완료</span>
                      )}
                      {svc.hasRecordings && (
                        <span style={{ fontSize:10, fontWeight:700, color:"#1a72c2", background:"#3a7bd514", border:"1px solid #3a7bd540", borderRadius:4, padding:"1px 6px" }}>예배녹음</span>
                      )}
                      {svc.hasPracticeUrl && (
                        <span style={{ fontSize:10, fontWeight:700, color:"#157a30", background:"#34c75914", border:"1px solid #34c75940", borderRadius:4, padding:"1px 6px" }}>연습녹음</span>
                      )}
                    </div>
                    <Icon n="chevR" size={14} color={C.bdr} />
                  </div>
                );
              })}
            </div>
            {!pastExpanded && past.length > 3 && (
              <button onClick={() => setPastExpanded(true)} style={{
                width:"100%", padding:"10px 0", borderRadius:10, marginTop:6,
                background:"transparent", border:`1px dashed ${C.bdr}`,
                cursor:"pointer", fontSize:12, color:C.dim, fontFamily:"inherit",
              }}>
                지난 예배 {past.length - 3}개 더 보기
              </button>
            )}
          </>
        )}

        {!servicesLoaded && (
          <div style={{ textAlign:"center", padding:"60px 0", color:C.dim, fontSize:13 }}>
            불러오는 중...
          </div>
        )}
        {servicesLoaded && services.length === 0 && (
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
  const [recSong,        setRecSong]        = useState(null); // { id, title }
  const [songsWithRecs,   setSongsWithRecs]   = useState(new Set()); // 녹음 있는 songId Set
  const [drag, setDrag]           = useState(null);
  const [dropIdx, setDropIdx]     = useState(null);
  const cardRefs = useRef([]);
  const [svcLyricsModal,        setSvcLyricsModal]        = useState(null); // { song, text }
  const [svcLyricsSaving,       setSvcLyricsSaving]       = useState(false);
  const [svcPp7Confirm,         setSvcPp7Confirm]         = useState(null); // { stanzaCount, title, text }
  const [removeSongConfirm,     setRemoveSongConfirm]     = useState(null); // { idx, songTitle }
  const [showKakaoFormatPicker, setShowKakaoFormatPicker] = useState(false);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  useEffect(() => {
    const onResize = () => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); };
  }, []);

  // 예배 설정 (practiceUrl 등) — Supabase Storage에서 로드
  const [svcPracticeUrl,    setSvcPracticeUrl]    = useState(svc?.practiceUrl || null);
  const [showPracticePlayer, setShowPracticePlayer] = useState(false);
  useEffect(() => {
    if (!svc?.id) return;
    setSvcPracticeUrl(svc?.practiceUrl || null); // Firestore fallback
    loadServiceSettings(svc.id)
      .then(d => { if (d?.practiceUrl !== undefined) setSvcPracticeUrl(d.practiceUrl); })
      .catch(() => {});
  }, [svc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 녹음 있는 곡 목록 — 재생 버튼 색상용 (보컬은 "밴드" 녹음 제외)
  const _songIdsKey = (svc?.songIds || []).join(",");
  const _isVocalist = isVocalistUser(user);
  useEffect(() => {
    const ids = svc?.songIds?.filter(Boolean) || [];
    if (!ids.length) { setSongsWithRecs(new Set()); return; }
    const isVocalist = isVocalistUser(user);
    let cancelled = false;
    let firestoreSet = new Set();
    let supaSet = new Set();
    let supaLoaded = false;
    const merge = () => {
      if (!cancelled) {
        const combined = new Set([...firestoreSet, ...supaSet]);
        setSongsWithRecs(combined);
        if (supaLoaded && svc?.id) {
          updateDoc(doc(db, "services", svc.id), { hasRecordings: combined.size > 0 }).catch(() => {});
        }
      }
    };

    const q = query(collection(db, "worshipRecordings"), where("songId", "in", ids));
    const unsub = onSnapshot(q, snap => {
      firestoreSet = new Set(
        snap.docs.map(d => d.data())
          .filter(r => r._session
            ? Object.keys(r.parts || {}).some(p => p !== "밴드" || !isVocalist)
            : r.part !== "밴드" || !isVocalist)
          .map(r => r.songId)
      );
      merge();
    }, () => {});

    // Supabase Storage 녹음 확인 (Firestore 쿼터 우회)
    Promise.all(ids.map(async sid => {
      try {
        const d = await loadWorshipRecording(`${sid}_${svc.id}`);
        if (d?.parts && Object.entries(d.parts).some(([p, v]) => v && (p !== "밴드" || !isVocalist))) return sid;
      } catch {}
      return null;
    })).then(results => {
      supaSet = new Set(results.filter(Boolean));
      supaLoaded = true;
      merge();
    });

    return () => { cancelled = true; unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_songIdsKey, _isVocalist]);


  if (!svc) return null;

  // Map from svc.songIds — keep raw index (i) for duplicate support
  const entries = (svc.songIds || []).map((id, i) => ({ id, song: songs.find(s => s.id === id) || null, i }));
  const totalCount = entries.filter(e => e.song).length;
  // valid-only list — index here = what PDFViewerScreen uses for navigation
  const validEntries = entries.filter(e => e.song);

  const leader  = isLeader(user.role);
  const isAdmin = user?.role === "admin";
  const svcNotifCount = (notifs || []).filter(n => n.serviceId === svc.id).length;

  const saveSvcLyrics = async () => {
    setSvcLyricsSaving(true);
    await updateDoc(doc(db, "songs", svcLyricsModal.song.id), { lyrics: svcLyricsModal.text });
    setSvcLyricsSaving(false);
    setSvcLyricsModal(null);
  };

  const _doSvcProDownload = async (title, text, stanzaCount) => {
    try {
      const binary = await _generatePP7Binary(title, text);
      const blob = new Blob([binary], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[\\\/:*?"<>|]/g, "_")}.pro`;
      a.click();
      URL.revokeObjectURL(url);
      alert(`"${title}" — ${Math.min(stanzaCount, 12)}슬라이드 생성 완료!\n(입력한 가사로 교체된 .pro 파일입니다)`);
    } catch(e) {
      alert("PP7 파일 생성 실패: " + e.message);
    }
  };

  const downloadSvcProFile = async () => {
    const title = svcLyricsModal.song.title;
    const text  = svcLyricsModal.text;
    if (!text || !text.trim()) {
      alert("가사를 먼저 입력하세요. Pro 파일은 입력한 가사로 슬라이드를 생성합니다.");
      return;
    }
    const stanzaCount = text.split(/\n{2,}/).filter(s => s.trim()).length;
    if (stanzaCount > 12) {
      setSvcPp7Confirm({ stanzaCount, title, text });
      return;
    }
    _doSvcProDownload(title, text, stanzaCount);
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
    updateDoc(doc(db, "services", svc.id), { notified: true }).catch(() => {});
    setNotifContent("");
    setNotifType("예배 악보");
    setNotifSending(false);
    setShowNotifModal(false);
  };

  const doKakaoSend = (text, countKey = "shareCount") => {
    const doCount = () => updateDoc(doc(db, "services", svc.id), { [countKey]: increment(1), notified: true }).catch(() => {});
    if (window.Kakao?.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: "text",
        text,
        link: { mobileWebUrl: window.location.origin, webUrl: window.location.origin },
        success: doCount,
      });
    } else {
      navigator.clipboard?.writeText(text)
        .then(() => { alert("메시지가 복사됐습니다. 카카오톡에 붙여넣기 해주세요."); doCount(); })
        .catch(() => alert("클립보드 복사에 실패했습니다."));
    }
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
    doKakaoSend(text, "shareCount");
  };

  const shareToKakaoRecording = () => {
    const sep = "─".repeat(9);
    const text = `🎵 ${svc.title}\n\n📅 ${svc.date}${svc.time ? " · " + svc.time : ""}\n${sep}\n녹음 파일이 업로드 되었습니다.\n오늘예배 악보 파일에서 확인하세요.\n${sep}\n\n🎵 Ainos 앱에서 확인하세요`;
    doKakaoSend(text, "shareCount");
  };

  const handleKakaoButtonClick = () => {
    if (isAdmin) {
      setShowKakaoFormatPicker(true);
    } else {
      shareToKakao();
    }
  };

  const [memoBlockModal, setMemoBlockModal] = useState(null); // { song, notes }

  const _doRemoveSong = async (idx) => {
    const song = entries[idx]?.song;
    const newIds = (svc.songIds || []).filter((_, i) => i !== idx);
    const newAddedAt = { ...(svc.songAddedAt || {}) };
    if (song) delete newAddedAt[song.id];
    await updateDoc(doc(db, "services", svc.id), { songIds: newIds, songAddedAt: newAddedAt });
  };

  const removeSong = (idx) => {
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
    setRemoveSongConfirm({ idx, songTitle: song?.title || "이 곡" });
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
          <button onClick={handleKakaoButtonClick} title="카카오톡 공유" style={{
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

      {/* 카카오 메시지 포맷 선택 (어드민 전용) */}
      {showKakaoFormatPicker && (
        <div onClick={() => setShowKakaoFormatPicker(false)} style={{
          position:"fixed", inset:0, zIndex:9000,
          background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:C.surf, borderRadius:16, padding:20, width:"100%", maxWidth:380,
          }}>
            <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
              <div style={{ flex:1, fontWeight:700, fontSize:16 }}>카카오 메시지 형식 선택</div>
              <button onClick={() => setShowKakaoFormatPicker(false)}
                style={{ background:"none", border:"none", cursor:"pointer", padding:6 }}>
                <Icon n="xmark" size={20} color={C.dim} />
              </button>
            </div>
            {/* 포맷 1: 예배 악보 목록 */}
            <button onClick={() => { setShowKakaoFormatPicker(false); shareToKakao(); }} style={{
              width:"100%", textAlign:"left", padding:"14px 16px", borderRadius:12, marginBottom:10,
              border:`1.5px solid ${C.bdr}`, background:C.card, cursor:"pointer", fontFamily:"inherit",
            }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.txt, marginBottom:4 }}>
                📋 예배 악보 목록
              </div>
              <div style={{ fontSize:11, color:C.dim, lineHeight:1.6, whiteSpace:"pre-line" }}>
                {`${svc.title}\n${svc.date}${svc.time ? " · " + svc.time : ""}\n─────────\n1. ${validEntries[0]?.song?.title || "(곡 없음)"}${validEntries.length > 1 ? ` 외 ${validEntries.length - 1}곡` : ""}\n─────────\n예배 악보가 등록 되었어요...`}
              </div>
            </button>
            {/* 포맷 2: 녹음 파일 업로드 알림 (어드민 전용) */}
            <button onClick={() => { setShowKakaoFormatPicker(false); shareToKakaoRecording(); }} style={{
              width:"100%", textAlign:"left", padding:"14px 16px", borderRadius:12,
              border:`1.5px solid ${C.acc}66`, background:`${C.acc}08`, cursor:"pointer", fontFamily:"inherit",
            }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.acc, marginBottom:4 }}>
                🎵 녹음 파일 업로드 알림
                <span style={{ marginLeft:6, fontSize:10, fontWeight:700,
                  background:C.red, color:"#fff", borderRadius:4, padding:"1px 5px" }}>어드민</span>
              </div>
              <div style={{ fontSize:11, color:C.dim, lineHeight:1.6, whiteSpace:"pre-line" }}>
                {`${svc.title}\n${svc.date}${svc.time ? " · " + svc.time : ""}\n─────────\n녹음 파일이 업로드 되었습니다.\n오늘예배 악보 파일에서 확인하세요.`}
              </div>
            </button>
          </div>
        </div>
      )}

      {/* 스크롤 영역 */}
      <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>

      <div style={{ padding:16, paddingBottom:"calc(100px + env(safe-area-inset-bottom))" }}>
        {svcPracticeUrl && (() => {
          const practiceFileId = svcPracticeUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] || null;
          const practiceEmbedSrc = practiceFileId ? `https://drive.google.com/file/d/${practiceFileId}/preview` : null;
          return (
            <div style={{ marginBottom:10, borderRadius:10, overflow:"hidden",
              border:`1px solid ${C.grn}66`, background:`${C.grn}12` }}>
              <button onClick={() => practiceEmbedSrc ? setShowPracticePlayer(v => !v) : (window.location.href = svcPracticeUrl)}
                style={{ display:"flex", alignItems:"center", gap:10, width:"100%",
                  background:"none", border:"none", padding:"10px 14px",
                  cursor:"pointer", fontFamily:"inherit" }}>
                <Icon n={showPracticePlayer ? "pause" : "play"} size={16} color={C.grn} />
                <div style={{ flex:1, textAlign:"left", fontSize:14, fontWeight:700, color:C.txt }}>예배 연습 녹음 재생</div>
                {!practiceEmbedSrc && <Icon n="link" size={14} color={C.grn} />}
              </button>
              {showPracticePlayer && practiceEmbedSrc && (
                <iframe src={practiceEmbedSrc} width="100%" height="80"
                  allow="autoplay" style={{ display:"block", border:"none", borderTop:`1px solid ${C.grn}33` }}
                  title="예배 연습 녹음" />
              )}
            </div>
          );
        })()}

        <div style={{ display:"flex", alignItems:"center", marginBottom:10 }}>
          <div style={{ flex:1, fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
            textTransform:"uppercase" }}>
            예배 곡 순서 · {totalCount}곡
            {leader && <span style={{ fontSize:10, color:C.dim, fontWeight:500,
              marginLeft:6, textTransform:"none" }}>≡ 드래그로 순서 변경</span>}
          </div>
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
          const visIdx = entries.slice(0, i + 1).filter(e => e.song).length;
          const hasNotes = teamNotes.length > 0;
          const hasRec = songsWithRecs.has(song.id);

          const numEl = leader ? (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, flexShrink:0 }}>
              <div onPointerDown={e => onHandleDown(e, i)} onPointerMove={onHandleMove}
                onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                style={{ cursor:"grab", touchAction:"none", userSelect:"none",
                  fontSize:16, color:C.dim, lineHeight:1, padding:"4px 6px", borderRadius:6,
                  background: isDragging ? `${C.acc}18` : "transparent" }}>≡</div>
              <div style={{ width:26, height:22, borderRadius:7,
                background:`linear-gradient(135deg, ${C.acc}33, ${C.pur}22)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontWeight:800, fontSize:12, color:C.acc }}>{visIdx}</div>
            </div>
          ) : (
            <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
              background:`linear-gradient(135deg, ${C.acc}33, ${C.pur}22)`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontWeight:800, fontSize:15, color:C.acc }}>{visIdx}</div>
          );

          const btnEl = (
            <div style={{ display:"flex", flexDirection: landscape ? "row" : "column", gap:4, flexShrink:0 }}>
              <button onClick={e => { e.stopPropagation(); setRecSong({ id: song.id, title: song.title }); }}
                title={hasRec ? "녹음 재생 준비 완료" : "녹음 파일 없음"}
                style={{ background: hasRec ? `${C.grn}12` : `${C.dim}10`,
                  border:`1px solid ${hasRec ? C.grn+"55" : C.dim+"33"}`,
                  borderRadius:7, cursor:"pointer", padding:"4px 7px",
                  display:"flex", alignItems:"center", gap:4,
                  fontSize:10, fontWeight:700,
                  color: hasRec ? C.grn : C.dim, fontFamily:"inherit" }}>
                <Icon n="play" size={11} color={hasRec ? C.grn : C.dim} />
                재생
              </button>
              {leader && <>
                <button onClick={() => duplicateSong(i)} style={{
                  background:`${C.pur}15`, border:`1px solid ${C.pur}44`,
                  borderRadius:7, cursor:"pointer", padding:"4px 8px",
                  fontSize:11, fontWeight:700, color:C.pur, fontFamily:"inherit" }}>복사</button>
                <button onClick={() => removeSong(i)} style={{
                  background:"none", border:"none", cursor:"pointer",
                  padding:4, display:"flex", justifyContent:"center" }}>
                  <Icon n="xmark" size={16} color={C.dim} />
                </button>
              </>}
            </div>
          );

          const infoEl = (compact) => (
            <div style={{ flex:1, minWidth:0, cursor:"pointer" }}
              onClick={() => !drag && nav("pdfViewer", {
                songId: song.id,
                svcSongIdx: validEntries.findIndex(e => e.i === i),
                backTo: "svcDetail",
              })}>
              {compact ? (
                <div style={{ display:"flex", alignItems:"baseline", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontWeight:700, fontSize:14, overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"40vw" }}>{song.title}</span>
                  {song.artist && <span style={{ fontSize:11, color:C.dim, whiteSpace:"nowrap" }}>{song.artist}</span>}
                  {song.bpm ? <span style={{ fontSize:11, color:C.dim }}>♩{song.bpm}</span> : null}
                  <KeyBadge k={song.key} />
                  {song.pdfUrl && <Badge label={song.pdfPage > 1 ? `PDF·${song.pdfPage}p` : "PDF"} color={C.grn} />}
                  {!song.pdfUrl && song.imageUrl && <Badge label="🖼️" color={C.acc} />}
                  {user?.uid && localStorage.getItem(`tvpc_tm_${user.uid}_${song.id}`) === "1" && (
                    <Badge label="전조" color={C.pur} />
                  )}
                  {leader && (
                    <button onClick={e => { e.stopPropagation(); setSvcLyricsModal({ song, text: song.lyrics || "" }); }}
                      style={{ background: song.lyrics ? `${C.grn}22` : `${C.pur}12`,
                        border:`1px solid ${song.lyrics ? C.grn+"55" : C.pur+"33"}`,
                        borderRadius:5, cursor:"pointer", padding:"1px 6px",
                        fontSize:10, fontWeight:700,
                        color: song.lyrics ? C.grn : C.dim, fontFamily:"inherit" }}>
                      {song.lyrics ? "✓ 가사" : "📝 가사"}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ fontWeight:700, fontSize:15, overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{song.title}</div>
                  <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>
                    {song.artist}{song.bpm ? ` · ♩${song.bpm}` : ""}
                  </div>
                  <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap", alignItems:"center" }}>
                    <KeyBadge k={song.key} />
                    {song.pdfUrl && <Badge label={song.pdfPage > 1 ? `PDF · 페이지${song.pdfPage}` : "PDF"} color={C.grn} />}
                    {!song.pdfUrl && song.imageUrl && <Badge label="🖼️ 이미지" color={C.acc} />}
                    {user?.uid && localStorage.getItem(`tvpc_tm_${user.uid}_${song.id}`) === "1" && (
                      <Badge label="전조" color={C.pur} />
                    )}
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
                </>
              )}
            </div>
          );

          const notesEl = (
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {teamNotes.map((m, mi) => {
                const _a1 = m.authorName || "";
                const authorName = (_a1.includes("@") ? (userMap||{})[m.userId] : _a1) || (userMap||{})[m.userId] || "팀원";
                return (
                  <div key={mi} style={{ padding:"7px 10px", borderRadius:8,
                    background:"#e5393510", border:"1px solid #e5393530" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                      <Icon n="users" size={10} color="#e53935" sw={2.5} />
                      <span style={{ fontSize:11, fontWeight:700, color:"#e53935" }}>{authorName}</span>
                    </div>
                    <div style={{ fontSize:12, color:C.txt, lineHeight:1.5 }}>{m.text}</div>
                  </div>
                );
              })}
            </div>
          );

          return (
            <div key={`${id}_${i}`} ref={el => cardRefs.current[i] = el}
              style={{ position:"relative" }}>
              {isDropTarget && (
                <div style={{ height:3, borderRadius:2, background:C.acc, margin:"0 0 4px", transition:"none" }} />
              )}
              <div className="wFadeIn" style={{
                background:C.surf, borderRadius:14,
                padding: landscape ? "10px 12px" : "14px 16px",
                marginBottom:8, border:`1px solid ${isDragging ? C.acc : C.bdr}`,
                boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,.18)" : "0 1px 4px rgba(0,0,0,.05)",
                transform: isDragging ? `translateY(${dy}px)` : "none",
                transition: isDragging ? "none" : "transform 0.15s",
                opacity: isDragging ? 0.88 : 1, zIndex: isDragging ? 20 : 1,
                position:"relative", touchAction:"none",
              }}>
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {numEl}
                    {infoEl(landscape)}
                    {btnEl}
                  </div>
                  {hasNotes && (
                    <div style={{ marginTop: landscape ? 6 : 10 }}>{notesEl}</div>
                  )}
                </>
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
              메모 작성자가 먼저 메모를 삭제해야 예배 목록에서 이 악보를 제거할 수 있습니다.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
              {[...new Map(memoBlockModal.notes.map(n => [n.userId, n])).values()].map(n => {
                const _a2 = n.authorName || ""; const name = (_a2.includes("@") ? (userMap||{})[n.userId] : _a2) || (userMap||{})[n.userId] || "팀원";
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

      {svcPp7Confirm && (
        <ConfirmModal
          title="슬라이드 개수 초과"
          message={`가사가 ${svcPp7Confirm.stanzaCount}단락입니다. 템플릿은 12슬라이드까지 지원하므로 처음 12단락만 사용됩니다.`}
          confirmLabel="계속"
          onConfirm={() => { setSvcPp7Confirm(null); _doSvcProDownload(svcPp7Confirm.title, svcPp7Confirm.text, svcPp7Confirm.stanzaCount); }}
          onClose={() => setSvcPp7Confirm(null)}
        />
      )}
      {removeSongConfirm && (
        <ConfirmModal
          title="곡 제거"
          message={`"${removeSongConfirm.songTitle}"을(를) 예배 목록에서 제거하시겠습니까?`}
          confirmLabel="제거"
          danger
          onConfirm={() => { const idx = removeSongConfirm.idx; setRemoveSongConfirm(null); _doRemoveSong(idx); }}
          onClose={() => setRemoveSongConfirm(null)}
        />
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
        <EditServiceModal svc={svc} onClose={() => setShowEdit(false)} onSave={onUpdateService}
          onPracticeUrlSaved={url => setSvcPracticeUrl(url)} />
      )}
      {recSong && (
        <WorshipRecordingsModal
          songId={recSong.id}
          songTitle={recSong.title}
          user={user}
          svc={svc}
          onClose={() => setRecSong(null)}
        />
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
    // objectURL 사용 — arrayBuffer()로 버퍼 소비 없이 썸네일 렌더링 (iOS Safari 호환)
    const objectUrl = URL.createObjectURL(file);
    (async () => {
      const pdf = await window.pdfjsLib.getDocument({ url: objectUrl }).promise;
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
    })().catch(e => { console.error(e); if (!cancelled) setRendering(false); })
      .finally(() => URL.revokeObjectURL(objectUrl));
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
  const tbNarrow = window.innerWidth < 600;
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
  const [pp7Confirm,   setPp7Confirm]   = useState(null); // { stanzaCount, title, text }

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
        // objectURL 사용 — arrayBuffer()로 파일 버퍼를 소비하면 iOS Safari에서
        // 이후 업로드 시 파일이 비어있는 문제가 생김
        const objectUrl = URL.createObjectURL(file);
        let numPages = 1;
        try {
          const pdf = await window.pdfjsLib.getDocument({ url: objectUrl }).promise;
          numPages = pdf.numPages;
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        if (numPages > 1) {
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
      console.error("pdf upload error", err, err?.code, err?.customData);
      const detail2 = err.customData?.serverResponse || "";
      alert("업로드 실패: " + err.message + (err.code ? ` [${err.code}]` : "") + (detail2 ? "\n" + detail2 : ""));
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
      console.error("img upload error", err, err?.code, err?.customData);
      alert("이미지 업로드 실패: " + err.message + (err.code ? ` [${err.code}]` : ""));
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

  const _doProDownload = async (title, text, stanzaCount) => {
    try {
      const binary = await _generatePP7Binary(title, text);
      const blob = new Blob([binary], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[\\\/:*?"<>|]/g, "_")}.pro`;
      a.click();
      URL.revokeObjectURL(url);
      alert(`"${title}" — ${Math.min(stanzaCount, 12)}슬라이드 생성 완료!\n(입력한 가사로 교체된 .pro 파일입니다)`);
    } catch(e) {
      alert("PP7 파일 생성 실패: " + e.message);
    }
  };

  const downloadProFile = async () => {
    const title = lyricsModal.song.title;
    const text  = lyricsModal.text;
    if (!text || !text.trim()) {
      alert("가사를 먼저 입력하세요. Pro 파일은 입력한 가사로 슬라이드를 생성합니다.");
      return;
    }
    const stanzaCount = text.split(/\n{2,}/).filter(s => s.trim()).length;
    if (stanzaCount > 12) {
      setPp7Confirm({ stanzaCount, title, text });
      return;
    }
    _doProDownload(title, text, stanzaCount);
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
        <div style={{ flex:1, overflowY:"auto", padding:"12px 52px 0 16px", paddingBottom:"calc(90px + env(safe-area-inset-bottom))" }}>
          {filtered.length === 0 && (
            <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🎵</div>
              <div>{query || consonant ? "검색 결과가 없습니다" : "등록된 곡이 없습니다"}</div>
            </div>
          )}
          {filtered.map(song => {
            const songIconBox = (
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
            );
            const songInfoArea = (
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
                  {song.lyrics && <Badge label="가사 ✓" color={C.grn} />}
                  {(() => {
                    const tNotes = (teamAnnotations || {})[song.id] || [];
                    const pNotes = (annotations || {})[song.id] || [];
                    const draws = (songDrawings || {})[song.id] || {};
                    const hasPersonal = pNotes.length > 0 || draws.my;
                    const hasTeam = tNotes.length > 0 || draws.team || draws.others;
                    if (!hasPersonal && !hasTeam) return null;
                    return (
                      <>
                        {hasPersonal && (
                          <span style={{
                            display:"flex", alignItems:"center", gap:3,
                            background:`${C.pur}18`, border:`1px solid ${C.pur}44`,
                            borderRadius:5, padding:"1px 6px", fontSize:10, fontWeight:700, color:C.pur,
                          }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.pur} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                            </svg>
                            내 필기
                          </span>
                        )}
                        {hasTeam && (
                          <span style={{
                            display:"flex", alignItems:"center", gap:3,
                            background:"#347C1718", border:"1px solid #347C1744",
                            borderRadius:5, padding:"1px 6px", fontSize:10, fontWeight:700, color:"#347C17",
                          }}>
                            <Icon n="users" size={9} color="#347C17" sw={2.5} />
                            팀 필기
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            );
            const BtnSz = tbNarrow ? 32 : 34;
            const IcoSz = tbNarrow ? 13 : 14;
            const songActionBtns = isLeader(user.role) ? (
              (uploading === song.id || imgUploading === song.id) ? (
                <div style={{ fontSize:11, color:C.acc, padding:"0 6px" }}>업로드 중...</div>
              ) : (
                <>
                  <button onClick={() => { setEditSong(song); setEditForm({ title: song.title, artist: song.artist || "", key: song.key || "", bpm: song.bpm || "", timeSig: song.timeSig || "4/4", youtubeUrl: song.youtubeUrl || "" }); }}
                    title="편집"
                    style={{ display:"flex", alignItems:"center", justifyContent:"center",
                      width:BtnSz, height:BtnSz, borderRadius:9, cursor:"pointer",
                      background:`${C.acc}22`, border:`1px solid ${C.acc}55` }}>
                    <Icon n="pen" size={IcoSz} color={C.acc} />
                  </button>
                  <button onClick={() => setLyricsModal({ song, text: song.lyrics || "" })}
                    title={song.lyrics ? "가사입력 완료 — 클릭하여 편집" : "가사 편집 / .pro 다운로드"}
                    style={{ display:"flex", alignItems:"center", justifyContent:"center",
                      width:BtnSz, height:BtnSz, borderRadius:9, cursor:"pointer",
                      background: song.lyrics ? `${C.grn}22` : `${C.pur}12`,
                      border:`1px solid ${song.lyrics ? C.grn+"66" : C.pur+"33"}` }}>
                    <Icon n="note" size={IcoSz} color={song.lyrics ? C.grn : C.dim} />
                  </button>
                  {(song.pdfUrl || song.imageUrl) && (
                    <button onClick={() => setCropSong({ id: song.id, pdfUrl: song.pdfUrl || null, imageUrl: song.imageUrl || null, cropBox: song.cropBox || null })}
                      title="크롭 설정"
                      style={{ display:"flex", alignItems:"center", justifyContent:"center",
                        width:BtnSz, height:BtnSz, borderRadius:9, cursor:"pointer",
                        background: song.cropBox ? `${C.acc}22` : `${C.pur}12`,
                        border:`1px solid ${song.cropBox ? C.acc+"55" : C.pur+"33"}` }}>
                      <Icon n="fitCrop" size={IcoSz} color={song.cropBox ? C.acc : C.pur} />
                    </button>
                  )}
                  <input type="file" accept=".pdf,application/pdf"
                    style={{ display:"none" }} id={`up-${song.id}`}
                    onChange={e => handleUpload(e, song.id)} />
                  <button
                    onClick={() => { if (!checkMemoBeforeReplace(song)) document.getElementById(`up-${song.id}`)?.click(); }}
                    title={song.pdfUrl ? "PDF 교체" : "PDF 업로드"}
                    style={{ display:"flex", alignItems:"center", justifyContent:"center",
                      width:BtnSz, height:BtnSz, borderRadius:9, cursor:"pointer",
                      background: song.pdfUrl ? `${C.grn}22` : C.surf,
                      border:`1px solid ${song.pdfUrl ? C.grn : C.bdr}` }}>
                    <Icon n="upload" size={IcoSz} color={song.pdfUrl ? C.grn : C.dim} />
                  </button>
                  <input type="file" accept="image/*"
                    style={{ display:"none" }} id={`img-${song.id}`}
                    onChange={e => handleImgUpload(e, song.id)} />
                  <button
                    onClick={() => { if (!checkMemoBeforeReplace(song)) document.getElementById(`img-${song.id}`)?.click(); }}
                    title={song.imageUrl ? "이미지 교체" : "이미지 업로드"}
                    style={{ display:"flex", alignItems:"center", justifyContent:"center",
                      width:BtnSz, height:BtnSz, borderRadius:9, cursor:"pointer",
                      background: song.imageUrl ? `${C.acc}22` : C.surf,
                      border:`1px solid ${song.imageUrl ? C.acc+"55" : C.bdr}` }}>
                    <span style={{ fontSize:IcoSz+1 }}>🖼️</span>
                  </button>
                  <button onClick={() => setConfirmDel(song.id)}
                    title="곡 삭제"
                    style={{ display:"flex", alignItems:"center", justifyContent:"center",
                      width:BtnSz, height:BtnSz, borderRadius:9, cursor:"pointer",
                      background:`${C.red}11`, border:`1px solid ${C.red}33` }}>
                    <Icon n="trash" size={IcoSz} color={C.red} />
                  </button>
                </>
              )
            ) : null;
            return (
              <div key={song.id} className="wFadeIn" style={{
                background:C.card, borderRadius:14, padding:"13px 16px",
                marginBottom:8, border:`1px solid ${C.bdr}`,
                display:"flex", flexDirection:"column", gap:0,
              }}>
                {/* 상단: 아이콘 + 곡 정보 (+ 넓은 화면에서만 버튼 인라인) */}
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  {songIconBox}
                  {songInfoArea}
                  {!tbNarrow && isLeader(user.role) && (
                    <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                      {songActionBtns}
                    </div>
                  )}
                </div>
                {/* 하단: 모바일에서 버튼 별도 행 */}
                {tbNarrow && isLeader(user.role) && (
                  <div style={{
                    display:"flex", gap:5, marginTop:10, paddingTop:10,
                    borderTop:`1px solid ${C.bdr}`,
                  }}>
                    {songActionBtns}
                  </div>
                )}
              </div>
            );
          })}
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
                  const _a4 = n.authorName || ""; const name = (_a4.includes("@") ? (userMap||{})[n.userId] : _a4) || (userMap||{})[n.userId] || "팀원";
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

      {pp7Confirm && (
        <ConfirmModal
          title="슬라이드 개수 초과"
          message={`가사가 ${pp7Confirm.stanzaCount}단락입니다. 템플릿은 12슬라이드까지 지원하므로 처음 12단락만 사용됩니다.`}
          confirmLabel="계속"
          onConfirm={() => { setPp7Confirm(null); _doProDownload(pp7Confirm.title, pp7Confirm.text, pp7Confirm.stanzaCount); }}
          onClose={() => setPp7Confirm(null)}
        />
      )}

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
      <div style={{ flex:1, overflowY:"auto", padding:16, paddingBottom:"calc(80px + env(safe-area-inset-bottom))" }}>
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
  const [partVal,        setPartVal]        = useState([]);
  const [partSaving,     setPartSaving]     = useState(false);
  const [partSaveErr,    setPartSaveErr]    = useState("");
  const [partSaveOk,     setPartSaveOk]     = useState(null); // uid of member just saved
  const [allowedEmails,  setAllowedEmails]  = useState([]); // [{email, role, part}]
  const [emailInput,     setEmailInput]     = useState("");
  const [newRole,        setNewRole]        = useState("member");
  const [newPart,        setNewPart]        = useState([]);
  const [addingEmail,    setAddingEmail]    = useState(false);
  const [emailErr,       setEmailErr]       = useState("");
  const [accessRequests, setAccessRequests] = useState([]); // [{email, name, part, message, ...}]
  const [approvingReq,   setApprovingReq]   = useState(null);
  const [removeEmailConfirm, setRemoveEmailConfirm] = useState(null); // email string

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

    // 허용 이메일 — 일회성 읽기 (변경 드문 데이터라 실시간 불필요)
    getDocs(collection(db, "allowedEmails"))
      .then(snap => setAllowedEmails(snap.docs.map(d => ({ email: d.id, ...d.data() }))))
      .catch(e => console.error("allowedEmails 실패:", e));

    // 액세스 신청 대기 — 실시간
    const unsubReq = onSnapshot(
      query(collection(db, "accessRequests"), where("status", "==", "pending")),
      snap => setAccessRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => console.error("accessRequests 실패:", e)
    );

    return () => { unsubReq(); };
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
        parts: newPart,
        part: newPart[0] || "",
      });
      setEmailInput("");
      setNewRole("member");
      setNewPart([]);
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

  const savePart = (uid) => {
    const updates = { parts: partVal, part: partVal[0] || "" };
    // 롤백용 원본값 캡처
    const origParts = members.find(u => u.id === uid);
    const origVal   = origParts ? getUserParts(origParts) : [];
    setMembers(p => p.map(u => u.id === uid ? { ...u, ...updates } : u));
    setEditPart(null);
    setPartSaveErr("");
    setPartSaveOk(null);
    setDoc(doc(db, "users", uid), updates, { merge: true })
      .then(() => {
        setPartSaveOk(uid);
        setTimeout(() => setPartSaveOk(v => v === uid ? null : v), 2500);
      })
      .catch(e => {
        // 원본값으로 롤백
        setMembers(p => p.map(u => u.id === uid ? { ...u, parts: origVal, part: origVal[0] || "" } : u));
        setPartSaveErr(e.code === "permission-denied" ? "저장 실패: 권한 없음" : "저장 실패: " + e.message);
        setEditPart(uid);
        console.error("savePart 실패:", e);
      });
  };

  const ROLES = [["member","멤버"], ["leader","리더"], ["broadcast","방송팀"], ["foh","FOH"], ["admin","어드민"]];
  const roleColor = (r) => r === "admin" ? C.red : r === "leader" ? C.acc : r === "broadcast" ? "#ff9f0a" : r?.toLowerCase() === "foh" ? "#0a84ff" : C.grn;

  return (
    <>
    {removeEmailConfirm && (
      <ConfirmModal
        title="팀원 접근 권한 삭제"
        message={`"${removeEmailConfirm}" 이메일을 삭제하면 해당 팀원이 로그인할 수 없게 됩니다. 삭제하시겠습니까?`}
        confirmLabel="삭제"
        danger
        onConfirm={() => { removeEmail(removeEmailConfirm); setRemoveEmailConfirm(null); }}
        onClose={() => setRemoveEmailConfirm(null)}
      />
    )}
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
                      <div style={{ fontSize:12, color:C.dim, marginTop:4,
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
                  label={m.role === "admin" ? "어드민" : m.role === "leader" ? "리더" : m.role === "broadcast" ? "방송팀" : m.role === "foh" ? "FOH" : "멤버"}
                  color={roleColor(m.role)} />
              </div>

              {/* 파트 편집 */}
              {editPart === m.id ? (
                <div style={{ marginBottom:8 }}>
                  {/* 표준 파트 버튼 */}
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:6 }}>
                    {PARTS.filter(p => p.id !== "전체").map(p => {
                      const sel = partVal.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => setPartVal(prev => sel ? prev.filter(x => x !== p.id) : [...prev, p.id])} style={{
                          padding:"4px 9px", borderRadius:6,
                          border:`1px solid ${sel ? C.acc + "99" : C.bdr}`,
                          background: sel ? C.acc + "22" : C.surf,
                          color: sel ? C.acc : C.dim,
                          fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                          transition:"all .1s",
                        }}>
                          {p.emoji} {p.label}
                        </button>
                      );
                    })}
                  </div>
                  {/* 커스텀 파트 (목록에 없는 기존 값) */}
                  {partVal.filter(v => !PARTS.find(p => p.id === v)).map(v => (
                    <span key={v} style={{ display:"inline-flex", alignItems:"center", gap:4,
                      background:`${C.pur}18`, border:`1px solid ${C.pur}44`,
                      borderRadius:6, padding:"3px 8px", fontSize:11, color:C.pur, marginRight:4, marginBottom:4 }}>
                      {v}
                      <button onClick={() => setPartVal(prev => prev.filter(x => x !== v))}
                        style={{ background:"none", border:"none", cursor:"pointer", color:C.pur, fontSize:13, padding:0, lineHeight:1 }}>×</button>
                    </span>
                  ))}
                  {/* 파트 추가 드롭다운 */}
                  <div style={{ marginTop:4, marginBottom:6 }}>
                    <select value="" onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      if (!partVal.includes(v)) setPartVal(prev => [...prev, v]);
                    }} style={{
                      padding:"4px 9px", borderRadius:6, fontSize:11,
                      border:`1px solid ${C.bdr}`, background:C.surf, color:C.txt,
                      fontFamily:"inherit", outline:"none", cursor:"pointer",
                    }}>
                      <option value="">+ 파트 추가...</option>
                      {PARTS.filter(p => p.id !== "전체" && !partVal.includes(p.id)).map(p => (
                        <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                    <button onClick={() => savePart(m.id)} disabled={partSaving} style={{
                      background:C.acc, border:"none", borderRadius:8,
                      padding:"6px 12px", cursor: partSaving ? "default" : "pointer",
                      fontSize:12, fontWeight:700, color:"#111", fontFamily:"inherit",
                      opacity: partSaving ? 0.6 : 1,
                    }}>{partSaving ? "저장 중..." : "저장"}</button>
                    <button onClick={() => { setEditPart(null); setPartSaveErr(""); }} style={{
                      background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:8,
                      padding:"6px 10px", cursor:"pointer",
                      fontSize:12, color:C.dim, fontFamily:"inherit",
                    }}>취소</button>
                    {partSaveErr && (
                      <span style={{ fontSize:11, color:C.red, fontWeight:600 }}>⚠ {partSaveErr}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                  <span style={{ fontSize:12, color:C.dim, flex:1 }}>
                    {getUserParts(m).join(", ") || <span style={{ color:C.dim }}>파트 미설정</span>}
                  </span>
                  {partSaveOk === m.id && (
                    <span style={{ fontSize:11, color:C.grn, fontWeight:700 }}>저장됨 ✓</span>
                  )}
                  <button onClick={() => { setEditPart(m.id); setPartVal(getUserParts(m)); setPartSaveOk(null); }} style={{
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
            {[["member","멤버",C.grn],["leader","리더",C.acc],["broadcast","방송팀","#ff9f0a"],["foh","FOH","#0a84ff"],["admin","어드민",C.red]].map(([r, label, clr]) => (
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
          {/* 파트 선택 (멀티) */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {PARTS.filter(p => p.id !== "전체").map(p => {
              const sel = newPart.includes(p.id);
              return (
                <button key={p.id} onClick={() => setNewPart(prev => sel ? prev.filter(x => x !== p.id) : [...prev, p.id])} style={{
                  padding:"4px 9px", borderRadius:6,
                  border:`1px solid ${sel ? C.acc + "99" : C.bdr}`,
                  background: sel ? C.acc + "22" : C.surf,
                  color: sel ? C.acc : C.dim,
                  fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                  transition:"all .1s",
                }}>
                  {p.emoji} {p.label}
                </button>
              );
            })}
          </div>
          <button onClick={addEmail} disabled={addingEmail || !emailInput.trim()} style={{
            background:C.acc, border:"none", borderRadius:8,
            padding:"7px 16px", cursor:"pointer", alignSelf:"flex-start",
            fontSize:12, fontWeight:700, color:"#111", fontFamily:"inherit",
            opacity: addingEmail || !emailInput.trim() ? 0.5 : 1,
          }}>추가</button>
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
            fontSize:12, color:C.dim,
          }}>
            허용된 이메일이 없습니다 (부트스트랩 모드 — 누구나 로그인 가능)
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {allowedEmails.map(item => {
              const clr = item.role === "admin" ? C.red : item.role === "leader" ? C.acc : C.grn;
              const roleLabel = item.role === "admin" ? "어드민" : item.role === "leader" ? "리더" : item.role === "foh" ? "FOH" : item.role === "broadcast" ? "방송팀" : "멤버";
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
                  <button onClick={() => setRemoveEmailConfirm(item.email)} style={{
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
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PROFILE SCREEN
══════════════════════════════════════════════════════════════════ */
function ProfileScreen({ user, onLogout, onRoleUpdate, sharedGeminiKey }) {
  const [showTeam,    setShowTeam]    = useState(false);
  const [claiming,    setClaiming]    = useState(false);
  const [releasing,   setReleasing]   = useState(false);
  const [migrating,   setMigrating]   = useState(false);
  const doMigrateFlags = async () => {
    setMigrating(true);
    try {
      const [recsSnap, svcsSnap, supaServiceIds] = await Promise.all([
        getDocs(collection(db, "worshipRecordings")),
        getDocs(collection(db, "services")),
        listWorshipRecordingServiceIds(),
      ]);
      const serviceIdsWithRecs = new Set(supaServiceIds);
      recsSnap.docs.forEach(d => { if (d.data().serviceId) serviceIdsWithRecs.add(d.data().serviceId); });

      const batch = writeBatch(db);
      svcsSnap.docs.forEach(svcDoc => {
        const data = svcDoc.data();
        const updates = {};
        if (serviceIdsWithRecs.has(svcDoc.id)) updates.hasRecordings = true;
        if ((data.shareCount || 0) > 0) updates.notified = true;
        if (Object.keys(updates).length > 0) batch.update(doc(db, "services", svcDoc.id), updates);
      });
      await batch.commit();

      let practiceCount = 0;
      for (const svcDoc of svcsSnap.docs) {
        const settings = await loadServiceSettings(svcDoc.id).catch(() => null);
        if (settings?.practiceUrl) {
          await updateDoc(doc(db, "services", svcDoc.id), { hasPracticeUrl: true }).catch(() => {});
          practiceCount++;
        }
      }
      alert(`마이그레이션 완료!\n예배녹음: ${serviceIdsWithRecs.size}개\n알림완료: 설정됨\n연습녹음: ${practiceCount}개`);
    } catch(e) { alert("마이그레이션 실패: " + e.message); }
    finally { setMigrating(false); }
  };
  const doReleaseBuild = async () => {
    setReleasing(true);
    try {
      await setDoc(doc(db, "appConfig", "release"), { version: APP_VERSION, releasedAt: serverTimestamp() });
      alert(`v${APP_VERSION} 사용자 배포 완료!`);
    } catch(e) { alert("배포 실패: " + e.message); }
    finally { setReleasing(false); }
  };
  const [previewItems,   setPreviewItems]   = useState([]);
  const [previewVersion, setPreviewVersion] = useState("");
  const [showPreview,    setShowPreview]    = useState(false);
  const openWhatsNewPreview = () => {
    fetch(`/admin-version.json?t=${Date.now()}`).then(r => r.json()).then(data => {
      if (data?.whatsNew?.length) {
        setPreviewItems(data.whatsNew);
        setPreviewVersion(data.build || APP_VERSION);
        setShowPreview(true);
      } else {
        alert("admin-version.json에 whatsNew 항목이 없습니다.");
      }
    }).catch(() => alert("admin-version.json 로드 실패"));
  };
  const [noLeader,    setNoLeader]    = useState(false);
  const [myPartSel,   setMyPartSel]   = useState(() => getUserParts(user));
  const [partSaving,  setPartSaving]  = useState(false);
  // 어드민이 Firestore에서 파트를 변경하면 로컬 선택값도 동기화
  const prevPartsKey = useRef(getUserParts(user).sort().join(","));
  useEffect(() => {
    const newKey = getUserParts(user).sort().join(",");
    if (newKey !== prevPartsKey.current) {
      prevPartsKey.current = newKey;
      setMyPartSel(getUserParts(user));
    }
  }, [user]);
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
  const [sharedKeyErr,    setSharedKeyErr]    = useState("");
  const [tapOn,  setTapOn]  = useState(() => localStorage.getItem("tvpc_tapNav")   !== "0");
  const [swipeOn,setSwipeOn]= useState(() => localStorage.getItem("tvpc_swipeNav") !== "0");

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
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${k}`,
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

  const partChanged = JSON.stringify(myPartSel.slice().sort()) !== JSON.stringify(getUserParts(user).slice().sort());
  const saveMyParts = async () => {
    setPartSaving(true);
    try {
      await setDoc(doc(db, "users", user.uid), { parts: myPartSel, part: myPartSel[0] || "" }, { merge: true });
    } finally { setPartSaving(false); }
  };
  const toggleNav = (key, val, setter) => {
    if (!val && key === "tvpc_tapNav"   && !swipeOn) return;
    if (!val && key === "tvpc_swipeNav" && !tapOn)   return;
    localStorage.setItem(key, val ? "1" : "0");
    setter(val);
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
      <div style={{ flex:1, overflowY:"auto", padding:20, paddingBottom:"calc(80px + env(safe-area-inset-bottom))" }}>

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
                label={user.role === "admin" ? "어드민" : user.role === "leader" ? "리더" : user.role === "foh" ? "FOH" : user.role === "broadcast" ? "방송팀" : "멤버"}
                color={user.role === "admin" ? C.red : user.role === "leader" ? C.acc : C.grn} />
              {getUserParts(user).map(p => {
                const pt = PARTS.find(x => x.id === p);
                return pt ? <span key={p} style={{ fontSize:11, color:C.acc, background:`${C.acc}18`,
                  border:`1px solid ${C.acc}44`, borderRadius:5, padding:"1px 6px", fontWeight:600 }}>{pt.emoji} {pt.label}</span> : null;
              })}
            </div>
          </div>
        </div>

        {/* 내 파트 선택 */}
        <div style={{ marginTop:14, borderTop:`1px solid ${C.bdr}`, paddingTop:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.dim, marginBottom:8, letterSpacing:".04em" }}>내 파트 선택</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
            {PARTS.filter(p => p.id !== "전체").map(p => {
              const sel = myPartSel.includes(p.id);
              return (
                <button key={p.id} onClick={() => setMyPartSel(prev => sel ? prev.filter(x => x !== p.id) : [...prev, p.id])} style={{
                  padding:"5px 10px", borderRadius:7, fontSize:12, fontWeight:600,
                  cursor:"pointer", fontFamily:"inherit",
                  background: sel ? `${C.acc}22` : C.bg,
                  color: sel ? C.acc : C.dim,
                  border:`1px solid ${sel ? C.acc+"66" : C.bdr}`,
                }}>{p.emoji} {p.label}</button>
              );
            })}
          </div>
          {myPartSel.filter(v => !PARTS.find(p => p.id === v)).map(v => (
            <span key={v} style={{ display:"inline-flex", alignItems:"center", gap:4,
              background:`${C.pur}18`, border:`1px solid ${C.pur}44`,
              borderRadius:6, padding:"3px 8px", fontSize:11, color:C.pur, marginRight:4, marginBottom:4 }}>
              {v}
              <button onClick={() => setMyPartSel(prev => prev.filter(x => x !== v))}
                style={{ background:"none", border:"none", cursor:"pointer", color:C.pur, fontSize:13, padding:0, lineHeight:1 }}>×</button>
            </span>
          ))}
          <div style={{ marginTop:6, marginBottom:8 }}>
            <select value="" onChange={e => {
              const v = e.target.value;
              if (!v) return;
              if (!myPartSel.includes(v)) setMyPartSel(prev => [...prev, v]);
            }} style={{
              padding:"5px 10px", borderRadius:7, fontSize:12,
              border:`1px solid ${C.bdr}`, background:C.bg, color:C.txt,
              fontFamily:"inherit", outline:"none", cursor:"pointer",
            }}>
              <option value="">+ 파트 추가...</option>
              {PARTS.filter(p => p.id !== "전체" && !myPartSel.includes(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
              ))}
            </select>
          </div>
          {partChanged && (
            <button onClick={saveMyParts} disabled={partSaving} style={{
              background:C.acc, border:"none", borderRadius:8, padding:"7px 16px",
              fontSize:12, fontWeight:700, color:"#111", cursor:"pointer", fontFamily:"inherit",
              opacity: partSaving ? 0.6 : 1,
            }}>{partSaving ? "저장 중..." : "저장"}</button>
          )}
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

      {/* 팀 관리 (리더/어드민) */}
      {isLeader(user.role) && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
            textTransform:"uppercase", marginBottom:10 }}>팀 관리</div>
          <Btn label="팀원 관리" icon="user" onClick={() => setShowTeam(true)}
            full variant="outline" />
        </div>
      )}

      {/* 악보 넘기기 설정 */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:8 }}>악보 넘기기</div>
        <div style={{ background:C.card, borderRadius:12, overflow:"hidden", border:`1px solid ${C.bdr}` }}>
          {[
            { label:"탭 이동",      desc:"화면 좌/우 탭으로 페이지 넘기기",    on:tapOn,   key:"tvpc_tapNav",   setter:setTapOn },
            { label:"스와이프 이동", desc:"손가락 좌/우 드래그로 페이지 넘기기", on:swipeOn, key:"tvpc_swipeNav", setter:setSwipeOn },
          ].map((row, i, arr) => (
            <div key={row.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"12px 16px", borderBottom: i < arr.length-1 ? `1px solid ${C.bdr}` : "none" }}>
              <div>
                <div style={{ fontSize:14, color:C.txt }}>{row.label}</div>
                <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{row.desc}</div>
              </div>
              <button onClick={() => toggleNav(row.key, !row.on, row.setter)} style={{
                width:44, height:26, borderRadius:13, border:"none", cursor:"pointer",
                background: row.on ? C.grn : C.bdr, position:"relative", flexShrink:0,
                transition:"background 0.2s",
              }}>
                <div style={{
                  position:"absolute", top:3, left: row.on ? 21 : 3,
                  width:20, height:20, borderRadius:"50%", background:"#fff",
                  transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:C.card, borderRadius:12, overflow:"hidden",
        border:`1px solid ${C.bdr}`, marginBottom:16 }}>
        {[
          { label:`앱 정보 (v${APP_VERSION})`, action: () => setShowInfo(true) },
          { label: user?.geminiKey ? "AI 분석 키 (설정됨 ✓)" : sharedGeminiKey ? "AI 분석 키 설정 (공유 키 사용 중)" : "AI 분석 키 설정", action: () => { setApiKeyInput(user?.geminiKey || ""); setShowApiKey(true); } },
          ...(isLeader(user?.role) ? [{ label:"🔑 공유 AI 키 설정 (멤버용)", action: async () => { setSharedKeyInput(""); setSharedKeyErr(""); setShowSharedKey(true); try { const d = await getDoc(doc(db,"settings","app")); setSharedKeyInput(d.exists() ? (d.data().sharedGeminiKey||"") : ""); } catch(e) {} } }] : []),
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

      {(user.role === "admin" || user.role === "leader") && (
        <div style={{ background:`${C.pur}0d`, border:`1.5px solid ${C.pur}44`, borderRadius:12, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ fontSize:12, fontWeight:800, color:C.pur, marginBottom:6 }}>🔧 사용자 배포</div>
          <div style={{ fontSize:11, color:C.dim, marginBottom:10 }}>현재 버전: <b style={{ color:C.txt }}>v{APP_VERSION}</b></div>
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <button onClick={openWhatsNewPreview} style={{
              flex:1, padding:"10px", borderRadius:9,
              background:"transparent", color:C.pur,
              border:`1.5px solid ${C.pur}66`, fontWeight:700, fontSize:13,
              cursor:"pointer", fontFamily:"inherit",
            }}>👁 What's New 미리보기</button>
          </div>
          <button onClick={doReleaseBuild} disabled={releasing} style={{
            width:"100%", padding:"10px", borderRadius:9,
            background: releasing ? `${C.pur}55` : C.pur,
            color:"#fff", border:"none", fontWeight:800, fontSize:13,
            cursor: releasing ? "not-allowed" : "pointer", fontFamily:"inherit",
          }}>{releasing ? "배포 중…" : `✓ v${APP_VERSION} 사용자 배포`}</button>
          <button onClick={doMigrateFlags} disabled={migrating} style={{
            width:"100%", marginTop:8, padding:"9px", borderRadius:9,
            background: migrating ? `${C.dim}33` : `${C.dim}18`,
            color: C.dim, border:`1px solid ${C.bdr}`, fontWeight:700, fontSize:12,
            cursor: migrating ? "not-allowed" : "pointer", fontFamily:"inherit",
          }}>{migrating ? "마이그레이션 중…" : "🔄 기존 배지 데이터 마이그레이션"}</button>
        </div>
      )}
      {showPreview && (
        <WhatsNewModal
          items={previewItems}
          version={previewVersion}
          onClose={() => setShowPreview(false)}
          C={C}
        />
      )}
      <Btn label="로그아웃" icon="logout" onClick={onLogout} variant="ghost" full />

      {showTeam && <TeamManagementModal currentUserId={user.uid} onClose={() => setShowTeam(false)} />}

      {/* Gemini API 키 설정 */}
      {showApiKey && (
        <Modal title="AI 분석 키 설정" onClose={() => setShowApiKey(false)}>
          <div style={{ padding:"4px 0 8px" }}>
            {sharedGeminiKey && !user?.geminiKey && (
              <div style={{ background:`${C.grn}22`, border:`1px solid ${C.grn}55`,
                borderRadius:8, padding:"8px 12px", marginBottom:10, fontSize:12, color:C.grn }}>
                ✓ 리더가 공유 키를 설정했습니다. 개인 키 없이도 AI 분석 사용 가능합니다.
              </div>
            )}
            <div style={{ fontSize:13, color:C.dim, marginBottom:12, lineHeight:1.6 }}>
              AI 키를 설정하면 코드 감지와 녹음 분석을 사용할 수 있습니다.<br />
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
        <Modal title="🔑 공유 AI 키 설정" onClose={() => { setShowSharedKey(false); setSharedKeyErr(""); }}>
          <div style={{ fontSize:13, color:C.dim, marginBottom:12, lineHeight:1.6 }}>
            여기서 설정한 키는 본인 키가 없는 모든 멤버에게 자동으로 적용됩니다.
          </div>
          <input
            value={sharedKeyInput}
            onChange={e => { setSharedKeyInput(e.target.value); setSharedKeyErr(""); }}
            placeholder="AIza..."
            style={{ width:"100%", padding:"10px 12px", borderRadius:8,
              border:`1px solid ${sharedKeyErr ? C.red : C.bdr}`,
              fontSize:13, fontFamily:"monospace", boxSizing:"border-box", marginBottom: sharedKeyErr ? 6 : 12 }}
          />
          {sharedKeyErr && <div style={{ fontSize:12, color:C.red, marginBottom:10 }}>{sharedKeyErr}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <Btn label={sharedKeySaving ? "저장 중…" : "저장"} full onClick={async () => {
              setSharedKeySaving(true); setSharedKeyErr("");
              try {
                await setDoc(doc(db,"settings","app"), { sharedGeminiKey: sharedKeyInput.trim() }, { merge:true });
                setShowSharedKey(false);
              } catch(e) {
                setSharedKeyErr("저장 실패: " + (e.message || "권한 오류"));
              } finally { setSharedKeySaving(false); }
            }} />
            {sharedKeyInput && (
              <Btn label="삭제" full onClick={async () => {
                try {
                  await setDoc(doc(db,"settings","app"), { sharedGeminiKey:"" }, { merge:true });
                  setShowSharedKey(false);
                } catch(e) { setSharedKeyErr("삭제 실패: " + (e.message || "권한 오류")); }
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

function fmtSchedDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일","월","화","수","목","금","토"];
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${m}/${dd} (${days[d.getDay()]})`;
}

function fmtSchedTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h < 12 ? "오전" : "오후";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const min = String(m).padStart(2, "0");
  return `${period} ${hour}:${min}`;
}

// portrait=true → top strip side-by-side, portrait=false → left/right center
function ScheduleCard({ title, icon, events, side, ldr, onAdd, portrait, screenW }) {
  const isPC  = screenW >= 1100;
  const isMid = screenW >= 700 && screenW < 1100;

  const posStyle = portrait
    ? {
        [side]: 12,
        top: "calc(env(safe-area-inset-top, 44px) + 10px)",
        width: "calc(50% - 18px)",
      }
    : {
        [side]: isPC ? 36 : isMid ? 22 : 14,
        top: "50%",
        transform: "translateY(-55%)",
        width: isPC ? 220 : isMid ? 190 : 156,
        maxHeight: "calc(100dvh - 160px)",
      };

  const visible = portrait ? events.slice(0, 2) : events;

  // 타이틀 크기: PC는 임팩트 있게, 세로모드는 컴팩트
  const titleIconSz = portrait ? 14 : isPC ? 22 : 18;
  const titleTxtSz  = portrait ? 12 : isPC ? 18 : 15;
  const dateSz      = portrait ? 11 : isPC ? 13 : 12;
  const contentSz   = portrait ? 14 : isPC ? 16 : 15;
  const timeSz      = portrait ? 12 : isPC ? 14 : 13;

  return (
    <div style={{
      position:"fixed",
      ...posStyle,
      overflowY:"auto",
      background:"rgba(255,255,255,0.28)",
      backdropFilter:"blur(12px)",
      WebkitBackdropFilter:"blur(12px)",
      border:"1px solid rgba(255,255,255,0.50)",
      borderRadius:16,
      padding: portrait ? "10px 12px" : isPC ? "14px 16px" : "11px 13px",
      zIndex:4,
      boxShadow:"0 4px 20px rgba(0,0,0,0.07)",
    }}>
      {/* header — 타이틀 임팩트 강화 */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom: portrait ? 8 : 10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:titleIconSz, lineHeight:1 }}>{icon}</span>
          <span style={{ fontSize:titleTxtSz, fontWeight:900, color:"#2d2460",
            letterSpacing:"-0.01em", lineHeight:1 }}>{title}</span>
        </div>
        {ldr && (
          <button onClick={onAdd} style={{
            background:"none", border:"none", cursor:"pointer", padding:"0 2px",
            color:"rgba(45,36,96,0.75)", fontSize:20, lineHeight:1, fontWeight:300,
          }}>+</button>
        )}
      </div>
      {/* 구분선 */}
      <div style={{ height:1, background:"rgba(45,36,96,0.1)", marginBottom: portrait ? 8 : 10 }} />
      {/* events */}
      {visible.length === 0 ? (
        <div style={{ fontSize:11, color:"rgba(45,36,96,0.65)", textAlign:"center", padding:"4px 0" }}>
          {ldr ? "+ 추가" : "예정 없음"}
        </div>
      ) : visible.map((e, i) => (
        <div key={e.id}>
          {i > 0 && <div style={{ height:1, background:"rgba(45,36,96,0.07)", margin:"7px 0" }} />}
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:4 }}>
            <div style={{ fontSize:dateSz, color:"rgba(45,36,96,0.75)", fontWeight:700,
              letterSpacing:"0.02em", marginBottom:2 }}>
              {fmtSchedDate(e.date)}
            </div>
            {e.type === "service" && (
              <span style={{ fontSize:9, fontWeight:700, color:"#047857",
                background:"rgba(16,185,129,0.12)", borderRadius:4, padding:"1px 5px",
                flexShrink:0, lineHeight:1.6 }}>자동</span>
            )}
          </div>
          <div style={{ fontSize:contentSz, fontWeight:700, color:"#2d2460", lineHeight:1.3 }}>
            {e.title}
          </div>
          {e.time && (
            <div style={{ fontSize:timeSz, color:"rgba(45,36,96,0.75)", marginTop:2 }}>{fmtSchedTime(e.time)}</div>
          )}
          {e.type === "rehearsal" && (
            <span style={{ display:"inline-block", background:"rgba(232,169,62,0.18)",
              color:"#7a4a00", borderRadius:4, padding:"2px 7px",
              fontSize:10, fontWeight:700, marginTop:4 }}>연습</span>
          )}
          {e.type === "service" && (
            <span style={{ display:"inline-block", background:"rgba(16,185,129,0.15)",
              color:"#047857", borderRadius:4, padding:"2px 7px",
              fontSize:10, fontWeight:700, marginTop:4 }}>예배</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ScheduleEditModal({ group, schedules, onClose }) {
  const [title, setTitle]     = useState("");
  const [date, setDate]       = useState(localDateStr());
  const [time, setTime]       = useState("");
  const [type, setType]       = useState("rehearsal");
  const [grp, setGrp]         = useState(group);
  const [saving, setSaving]   = useState(false);
  const [delConfirm, setDelConfirm] = useState(null); // { id, title }

  const upcoming = schedules
    .filter(s => s.group === grp || s.group === "all" || grp === "all")
    .sort((a,b) => a.date.localeCompare(b.date));

  const save = async () => {
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "rehearsalSchedule"), {
        title: title.trim(), date, time, group: grp, type,
        createdAt: serverTimestamp(),
      });
      setTitle(""); setTime("");
    } finally { setSaving(false); }
  };

  const del = async (id) => {
    await deleteDoc(doc(db, "rehearsalSchedule", id));
  };

  const confirmAndDel = (e) => setDelConfirm({ id: e.id, title: e.title });

  const grpLabel = { vocal:"보컬", band:"밴드", all:"전체" };

  return (
    <>
    {delConfirm && (
      <ConfirmModal
        title="일정 삭제"
        message={`"${delConfirm.title}" 일정을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        danger
        onConfirm={() => { del(delConfirm.id); setDelConfirm(null); }}
        onClose={() => setDelConfirm(null)}
      />
    )}
    <div style={{
      position:"fixed", inset:0, zIndex:9000,
      background:"rgba(0,0,0,0.45)",
      display:"flex", alignItems:"flex-end", justifyContent:"center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width:"100%", maxWidth:420,
        background:"#fff", borderRadius:"20px 20px 0 0",
        padding:"20px 20px calc(20px + env(safe-area-inset-bottom))",
        maxHeight:"80dvh", display:"flex", flexDirection:"column",
      }}>
        {/* 헤더 */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontSize:16, fontWeight:800, color:"#2d2460" }}>연습 스케줄 관리</div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer",
            fontSize:20, color:"rgba(45,36,96,0.7)", padding:4 }}>✕</button>
        </div>

        {/* 그룹 탭 */}
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          {["vocal","band","all"].map(g => (
            <button key={g} onClick={() => setGrp(g)} style={{
              flex:1, padding:"7px 0", borderRadius:10, border:"1.5px solid",
              borderColor: grp === g ? "#2d2460" : "rgba(45,36,96,0.15)",
              background: grp === g ? "#2d2460" : "transparent",
              color: grp === g ? "#fff" : "rgba(45,36,96,0.75)",
              fontWeight:700, fontSize:12, cursor:"pointer",
            }}>{grpLabel[g]}</button>
          ))}
        </div>

        {/* 이벤트 목록 */}
        <div style={{ flex:1, overflowY:"auto", marginBottom:16 }}>
          {upcoming.length === 0 ? (
            <div style={{ textAlign:"center", padding:"20px 0", color:"rgba(45,36,96,0.65)", fontSize:13 }}>
              예정된 일정이 없습니다
            </div>
          ) : upcoming.map(e => (
            <div key={e.id} style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"10px 0", borderBottom:"1px solid rgba(45,36,96,0.06)",
            }}>
              <div>
                <div style={{ fontSize:10, color:"rgba(45,36,96,0.7)", fontWeight:700, marginBottom:2 }}>
                  {fmtSchedDate(e.date)}{e.time ? " · " + fmtSchedTime(e.time) : ""}
                  {" "}
                  <span style={{ background: e.type==="rehearsal"?"rgba(232,169,62,0.18)":"rgba(45,36,96,0.07)",
                    color: e.type==="rehearsal"?"#7a4a00":"rgba(45,36,96,0.75)",
                    borderRadius:4, padding:"1px 5px", fontSize:8, fontWeight:700 }}>
                    {e.type==="rehearsal"?"연습":"예배"}
                  </span>
                  {" "}
                  <span style={{ fontSize:8, color:"rgba(45,36,96,0.65)" }}>
                    [{grpLabel[e.group]||e.group}]
                  </span>
                </div>
                <div style={{ fontSize:13, fontWeight:700, color:"#2d2460" }}>{e.title}</div>
              </div>
              <button onClick={() => confirmAndDel(e)} style={{
                background:"none", border:"none", cursor:"pointer",
                color:"rgba(200,80,80,0.55)", fontSize:18, padding:"4px 8px",
              }}>🗑</button>
            </div>
          ))}
        </div>

        {/* 추가 폼 */}
        <div style={{ borderTop:"1px solid rgba(45,36,96,0.1)", paddingTop:14, display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"rgba(45,36,96,0.7)",
            letterSpacing:"0.06em", textTransform:"uppercase" }}>새 일정 추가</div>

          <input value={title} onChange={e=>setTitle(e.target.value)}
            placeholder="제목 (예: 보컬 리허설, 밴드 연습)"
            style={{ width:"100%", padding:"10px 12px", borderRadius:10,
              border:"1.5px solid rgba(45,36,96,0.18)", fontSize:14,
              color:"#2d2460", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }} />

          <div style={{ display:"flex", gap:8 }}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{ flex:1, padding:"9px 10px", borderRadius:10,
                border:"1.5px solid rgba(45,36,96,0.18)", fontSize:13,
                color:"#2d2460", outline:"none", fontFamily:"inherit" }} />
            <select value={time} onChange={e=>setTime(e.target.value)}
              style={{ width:120, padding:"9px 10px", borderRadius:10,
                border:"1.5px solid rgba(45,36,96,0.18)", fontSize:13,
                color: time ? "#2d2460" : "rgba(45,36,96,0.65)",
                outline:"none", fontFamily:"inherit", background:"#fff" }}>
              <option value="">시간 선택</option>
              {Array.from({length: 18*4}, (_, i) => {
                const mins = 5*60 + i*15;
                const h = Math.floor(mins/60), m = mins%60;
                const t = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
                return <option key={t} value={t}>{fmtSchedTime(t)}</option>;
              })}
            </select>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            {[["rehearsal","연습"],["worship","예배"]].map(([v,l]) => (
              <button key={v} onClick={() => setType(v)} style={{
                flex:1, padding:"8px 0", borderRadius:10, border:"1.5px solid",
                borderColor: type===v ? "#e8a93e" : "rgba(45,36,96,0.15)",
                background: type===v ? "rgba(232,169,62,0.12)" : "transparent",
                color: type===v ? "#7a4a00" : "rgba(45,36,96,0.75)",
                fontWeight:700, fontSize:12, cursor:"pointer",
              }}>{l}</button>
            ))}
          </div>

          <button onClick={save} disabled={saving || !title.trim()} style={{
            width:"100%", padding:"13px 0", borderRadius:12, border:"none",
            background: title.trim() ? "#2d2460" : "rgba(45,36,96,0.15)",
            color: title.trim() ? "#fff" : "rgba(45,36,96,0.35)",
            fontWeight:800, fontSize:14, cursor: title.trim() ? "pointer" : "default",
            fontFamily:"inherit",
          }}>
            {saving ? "저장 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   HOME SPLASH SCREEN
══════════════════════════════════════════════════════════════════ */
function HomeSplashScreen({ user }) {
  const [portrait, setPortrait] = useState(
    () => window.matchMedia("(orientation: portrait)").matches
  );
  const [screenW, setScreenW] = useState(() => window.innerWidth);
  const [schedules, setSchedules] = useState([]);
  const [svcList, setSvcList] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [schedModal, setSchedModal] = useState(null); // null | "vocal" | "band"

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = e => { setPortrait(e.matches); setScreenW(window.innerWidth); };
    mq.addEventListener("change", handler);
    const onResize = () => { setScreenW(window.innerWidth); setPortrait(window.matchMedia("(orientation: portrait)").matches); };
    window.addEventListener("resize", onResize);
    return () => { mq.removeEventListener("change", handler); window.removeEventListener("resize", onResize); };
  }, []);

  // 1분마다 현재 시각 갱신 → 지난 스케줄 자동 제거
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const today = localDateStr();
    const q = query(
      collection(db, "rehearsalSchedule"),
      where("date", ">=", today),
      orderBy("date"),
      limit(30)
    );
    return onSnapshot(q, snap => {
      setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    const today = localDateStr();
    const q = query(
      collection(db, "services"),
      where("date", ">=", today),
      orderBy("date"),
      limit(20)
    );
    return onSnapshot(q, snap => {
      setSvcList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const ldr = user && isLeader(user.role);

  // 서비스 → 스케줄 형식으로 변환, 지난 것 제외
  const svcEvents = svcList
    .filter(s => {
      const dt = new Date(`${s.date}T${s.time ? s.time : "23:59"}:00`);
      return dt > now;
    })
    .map(s => ({ id:"svc_"+s.id, title: s.title || "주일 예배", date: s.date, time: s.time || "", type:"service", group:"all" }));

  // 수동 스케줄 중 지난 것 제외 (당일 시간도 체크)
  const todayStr = localDateStr(now);
  const upcomingRehearsals = schedules.filter(s => {
    if (s.date > todayStr) return true;
    if (s.date === todayStr) {
      if (!s.time) return true;
      const [h, m] = s.time.split(":").map(Number);
      const dt = new Date(now); dt.setHours(h, m, 0, 0);
      return dt > now;
    }
    return false;
  });

  // 합치고 날짜+시간순 정렬
  const allEvents = [...svcEvents, ...upcomingRehearsals]
    .sort((a, b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||"")));

  const vocalEvents = allEvents.filter(s => s.group === "vocal" || s.group === "all").slice(0, 2);
  const bandEvents  = allEvents.filter(s => s.group === "band"  || s.group === "all").slice(0, 2);

  // (hover:hover) and (pointer:fine) = mouse/trackpad → real PC, not iPad/tablet
  const isPC = !portrait && screenW >= 1200 && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return (
    <>
      <div style={{
        position:"fixed", inset:"-20px",
        backgroundImage: portrait ? "url('/home-bg-portrait.webp')"
          : isPC ? "url('/home-bg-pc.webp')"
          :        "url('/home-bg.webp')",
        backgroundSize:"cover",
        backgroundPosition:"center center",
        backgroundRepeat:"no-repeat",
      }} />
      {/* Dark gradient so status bar text is readable on the light background */}
      <div style={{
        position:"fixed", top:0, left:0, right:0,
        height:"calc(env(safe-area-inset-top, 44px) + 12px)",
        background:"linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, transparent 100%)",
        pointerEvents:"none", zIndex:1,
      }} />

      {/* Schedule cards — always shown; portrait=top strip, landscape=left/right center */}
      <ScheduleCard
        title="보컬" icon="🎤"
        events={vocalEvents}
        side="left"
        ldr={ldr}
        portrait={portrait}
        screenW={screenW}
        onAdd={() => setSchedModal("vocal")}
      />
      <ScheduleCard
        title="밴드" icon="🎸"
        events={bandEvents}
        side="right"
        ldr={ldr}
        portrait={portrait}
        screenW={screenW}
        onAdd={() => setSchedModal("band")}
      />

      {/* YouTube — centered above 악보 tab (3rd of 5 flex tabs; version btn ~60px shifts center by -30px) */}
      <a
        href="https://m.youtube.com/playlist?list=PLbDbHDX38DM2DLSk57Ei6BGg-mvzs_1HZ"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          position:"fixed",
          bottom:"calc(72px + env(safe-area-inset-bottom))",
          left:"calc(50% - 30px)", transform:"translateX(-50%)",
          display:"flex", alignItems:"center", gap:6,
          background:"transparent",
          border:"1.5px solid rgba(80,80,110,0.35)",
          color:"#333", textDecoration:"none",
          borderRadius:20, padding:"5px 13px",
          fontSize:12, fontWeight:700, letterSpacing:"0.01em",
          zIndex:10,
          whiteSpace:"nowrap",
        }}
      >
        <svg width="18" height="13" viewBox="0 0 18 13" fill="none">
          <rect width="18" height="13" rx="3" fill="#FF0000"/>
          <path d="M7 9.5V3.5L13 6.5L7 9.5Z" fill="white"/>
        </svg>
        TVPC
      </a>

      {/* Schedule edit modal */}
      {schedModal && (
        <ScheduleEditModal
          group={schedModal}
          schedules={schedules}
          onClose={() => setSchedModal(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   BOTTOM NAV
══════════════════════════════════════════════════════════════════ */
function BottomNav({ view, nav, unread, user, anyLiveActive }) {
  const isFohUser = getUserParts(user).some(p => p?.toLowerCase() === "foh");
  const tabs = [
    { id:"home",                              icon:"home",       label:"홈"     },
    { id: isFohUser ? "foh" : "services",    icon:"calendar",   label:"예배"   },
    { id:"library",                           icon:"music",      label:"악보"   },
    { id:"notifications",                     icon:"bell",       label:"알림"   },
    { id:"profile",                           icon:"user",       label:"프로필" },
  ];
  const isHome = view === "home";
  const navPur = "#2d2460";
  return (
    <div style={{
      flexShrink:0,
      width:"100%", maxWidth:640, margin:"0 auto",
      background: "transparent",
      backdropFilter: "none",
      WebkitBackdropFilter: "none",
      borderTop: "none",
      display:"flex", alignItems:"center",
      padding:"4px 0",
      paddingBottom:"calc(4px + env(safe-area-inset-bottom))",
      zIndex:500,
    }}>
      {tabs.map(t => {
        const active = view === t.id;
        return (
          <button key={t.id} onClick={() => nav(t.id)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              gap:3, background:"none", border:"none", cursor:"pointer", padding:"1px 0" }}>
            <div style={{ position:"relative" }}>
              <div style={{
                width:44, height:44, borderRadius:12,
                background: active ? navPur : "transparent",
                border: `2px solid ${active ? navPur : "rgba(45,36,96,0.55)"}`,
                boxShadow: !active ? "0 1px 5px rgba(0,0,0,0.12)" : "none",
                display:"flex", alignItems:"center", justifyContent:"center",
                transition:"background .15s",
              }}>
                <Icon n={t.icon} size={22} color={active ? "#fff" : navPur} />
              </div>
              {t.id === "notifications" && unread > 0 && (
                <span style={{
                  position:"absolute", top:-4, right:-6,
                  minWidth:16, height:16, padding:"0 4px",
                  background:C.red, borderRadius:8, border:`2px solid ${isHome ? "transparent" : C.surf}`,
                  fontSize:10, fontWeight:700, color:"#fff",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  lineHeight:1, boxSizing:"border-box",
                }}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <span style={{ fontSize:11, fontWeight: active ? 700 : 600,
              color: active ? navPur : "rgba(45,36,96,0.65)",
              letterSpacing:"0.01em" }}>
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
function WhatsNewModal({ items, version, onClose, C }) {
  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999,
               display:"flex", alignItems:"center", justifyContent:"center", padding:20,
               touchAction:"manipulation" }}
      onClick={onClose}
    >
      <div
        style={{ background:C.surf, borderRadius:18, width:"100%", maxWidth:400,
                 overflow:"hidden", boxShadow:"0 24px 60px rgba(0,0,0,0.35)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ background:"linear-gradient(135deg,#3a7bd5,#6b5de7)", padding:"22px 24px 18px", color:"#fff" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
            <span>🎵</span>
            <span style={{ background:"rgba(255,255,255,0.25)", borderRadius:20, padding:"2px 10px",
                           fontSize:11, fontWeight:700, letterSpacing:"0.04em" }}>v{version}</span>
          </div>
          <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.02em" }}>새로운 기능을 확인하세요</div>
          <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>
            {new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" })} 업데이트
          </div>
        </div>

        {/* 바디 */}
        <div style={{ maxHeight:"55vh", overflowY:"auto" }}>
          {items.map((item, i) => (
            <div key={i} style={{ borderBottom: i < items.length - 1 ? `1px solid ${C.bdr}` : "none" }}>
              {item.image ? (
                <>
                  <img src={item.image} alt={item.title}
                    style={{ width:"100%", display:"block", objectFit:"cover", maxHeight:180 }} />
                  <div style={{ padding:"12px 16px 14px" }}>
                    {item.tag && (
                      <span style={{ display:"inline-block", background:`${item.tagColor||C.pur}18`,
                        color:item.tagColor||C.pur, borderRadius:4, padding:"1px 7px",
                        fontSize:10, fontWeight:700, marginBottom:5 }}>{item.tag}</span>
                    )}
                    <div style={{ fontSize:14, fontWeight:800, color:C.txt, marginBottom:3, letterSpacing:"-0.01em" }}>{item.title}</div>
                    <div style={{ fontSize:12, color:C.dim, lineHeight:1.5 }}>{item.desc}</div>
                  </div>
                </>
              ) : (
                <div style={{ padding:"14px 16px", display:"flex", alignItems:"flex-start", gap:10 }}>
                  <div style={{ width:32, height:32, borderRadius:8, flexShrink:0,
                    background:`${item.tagColor||C.pur}18`, display:"flex",
                    alignItems:"center", justifyContent:"center", fontSize:16 }}>
                    {item.icon || "✨"}
                  </div>
                  <div>
                    {item.tag && (
                      <span style={{ display:"inline-block", background:`${item.tagColor||C.pur}18`,
                        color:item.tagColor||C.pur, borderRadius:4, padding:"1px 7px",
                        fontSize:10, fontWeight:700, marginBottom:3 }}>{item.tag}</span>
                    )}
                    <div style={{ fontSize:13, fontWeight:700, color:C.txt, marginBottom:2 }}>{item.title}</div>
                    <div style={{ fontSize:11, color:C.dim, lineHeight:1.45 }}>{item.desc}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 푸터 */}
        <div style={{ padding:"14px 20px", borderTop:`1px solid ${C.bdr}`, display:"flex",
                      alignItems:"center", justifyContent:"space-between", background:C.card }}>
          <span style={{ fontSize:11, color:C.dim }}>버전 {version}</span>
          <button onClick={onClose}
            style={{ background:"linear-gradient(135deg,#3a7bd5,#6b5de7)", color:"#fff", border:"none",
                     borderRadius:10, padding:"10px 28px", fontSize:14, fontWeight:700,
                     cursor:"pointer", fontFamily:"inherit",
                     touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }}>
            확인했어요 ✓
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user,        setUser]        = useState(undefined); // undefined = loading
  const [loginErr,        setLoginErr]        = useState("");
  const [loginBlockedUser,setLoginBlockedUser] = useState(null); // { email, name } 미등록 로그인 시도
  const [view,        setView]        = useState(() => {
    const saved = localStorage.getItem("tvpc_view") || "home";
    // selSongId가 저장돼 있으면 pdfViewer 복원 허용
    if (saved === "pdfViewer" && localStorage.getItem("tvpc_selSongId")) return "pdfViewer";
    if (saved === "svcDetail") return "home";
    return saved;
  });
  const [songs,       setSongs]       = useState(() => {
    try { const c = localStorage.getItem("tvpc_songs_cache"); const p = c ? JSON.parse(c) : []; return Array.isArray(p) ? p : []; } catch { return []; }
  });
  const [services,    setServices]    = useState(() => {
    try { const c = localStorage.getItem("tvpc_services_cache"); const p = c ? JSON.parse(c) : []; return Array.isArray(p) ? p : []; } catch { return []; }
  });
  const [servicesLoaded, setServicesLoaded] = useState(() => {
    try { return !!localStorage.getItem("tvpc_services_cache"); } catch { return false; }
  });
  const [notifs,      setNotifs]      = useState([]);
  const [songCues,    setSongCues]    = useState({});
  const [annotations,     setAnnotations]     = useState({}); // 개인 메모
  const [teamAnnotations, setTeamAnnotations] = useState({}); // 팀 공유 메모
  const [userMap,         setUserMap]         = useState({}); // uid -> displayName
  const [songDrawings,    setSongDrawings]    = useState({}); // songId -> { my: bool, team: bool }
  const [anyLiveActive,   setAnyLiveActive]   = useState(false); // 방송팀 라이브탭 표시 여부
  const [selSvcId,      setSelSvcId]      = useState(() => localStorage.getItem("tvpc_selSvcId") || null);
  const [selSongId,     setSelSongId]     = useState(() => localStorage.getItem("tvpc_selSongId") || null);
  const [selSvcSongIdx, setSelSvcSongIdx] = useState(() => parseInt(localStorage.getItem("tvpc_selSvcSongIdx") || "-1"));
  const [backTo,        setBackTo]        = useState(() => localStorage.getItem("tvpc_backTo") || "library");
  const [pdfjsReady,    setPdfjsReady]    = useState(false);
  const [showHelp,      setShowHelp]      = useState(false);
  const [notifPopup,    setNotifPopup]    = useState(null); // {unreadCount, latest}
  const notifPopupShownRef = useRef(false);
  const [sharedGeminiKey, setSharedGeminiKey] = useState("");
  const [bgmChannel,      setBgmChannel]      = useState("09");
  const [autoPhaseGlobal, setAutoPhaseGlobal] = useState(null); // { phase, svcId }
  const [pianoOverlayDismissed, setPianoOverlayDismissed] = useState(false);
  const pianoOverlayDismissedTsRef = useRef(
    parseInt(localStorage.getItem("tvpc_pianoOverlay_dismissed_ts") || "0")
  );
  const autoLiveTriggeredRef = useRef(null);
  const [sheetLinkEnabled,      setSheetLinkEnabled]      = useState(false);
  const [sheetSyncAllowedParts, setSheetSyncAllowedParts] = useState(null);
  const [sheetSyncTrigger,      setSheetSyncTrigger]      = useState(0);
  const [fohMsgBanner,          setFohMsgBanner]          = useState(null); // { message }
  const fohMsgTsRef       = useRef(null);
  const navRef          = useRef(null);
  const userRoleRef     = useRef(undefined);
  const userIsFohRef    = useRef(false);
  // localStorage 복원값으로 초기화 — onSnapshot이 첫 렌더 직후 발화해도 올바른 값을 가짐
  const selSongIdRef    = useRef(localStorage.getItem("tvpc_selSongId") || null);
  const viewRef         = useRef(
    localStorage.getItem("tvpc_view") === "pdfViewer" && localStorage.getItem("tvpc_selSongId")
      ? "pdfViewer"
      : localStorage.getItem("tvpc_view") === "svcDetail"
      ? "home"
      : (localStorage.getItem("tvpc_view") || "home")
  );
  const sheetLinkEnabledRef = useRef(false);
  const allowedPartsRef = useRef(null);
  const userPartsRef    = useRef([]);
  const sheetSyncTsRef  = useRef(null);
  useEffect(() => { userRoleRef.current  = user?.role;      }, [user?.role]);
  useEffect(() => { selSongIdRef.current = selSongId;       }, [selSongId]);
  useEffect(() => { viewRef.current      = view;            }, [view]);
  useEffect(() => { userPartsRef.current = getUserParts(user); }, [user]);
  useEffect(() => { userIsFohRef.current  = isFoh(user);           }, [user]);

  // 서비스 워커 업데이트 감지 → 1회만 새로고침 (무한 루프 방지)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (hadController && !sessionStorage.getItem("sw_reloaded")) {
        sessionStorage.setItem("sw_reloaded", "1");
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  // 로그인/새로고침 직후 sheetSyncTsRef 초기화 — 이동은 하지 않음 (저장 위치 유지)
  useEffect(() => {
    if (!user?.uid) return;
    getDoc(doc(db, "liveStatus", "sheetSync")).then(snap => {
      if (!snap.exists()) return;
      const ts = snap.data().updatedAt?.toMillis?.() ?? 0;
      if (sheetSyncTsRef.current === null) sheetSyncTsRef.current = ts;
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // ── Kakao SDK 초기화
  useEffect(() => {
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init(KAKAO_JS_KEY);
    }
  }, []);

  // ── 공유 Gemini 키 + 자동화 설정 구독 (인증 완료 후에만 시작)
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(
      doc(db, "settings", "app"),
      d => {
        const data = d.exists() ? d.data() : {};
        setSharedGeminiKey(data.sharedGeminiKey || "");
        setBgmChannel(data.bgmChannel || "09");
      },
      err => console.warn("settings/app 읽기 실패:", err.code)
    );
    return unsub;
  }, [user?.uid]);

  // ── Piano ON phase 전체 구독
  useEffect(() => {
    return onSnapshot(doc(db, "liveStatus", "automation"), snap => {
      const data = snap.exists() ? snap.data() : null;
      setAutoPhaseGlobal(data);
      if (data?.phase === "piano_on") {
        // updatedAt 기반 비교 — 버튼을 다시 누를 때마다 새 timestamp로 오버레이 재표시
        const ts = data.updatedAt?.toMillis?.() ?? 0;
        if (ts > pianoOverlayDismissedTsRef.current) {
          setPianoOverlayDismissed(false);
        } else {
          setPianoOverlayDismissed(true);
        }
      }
    }, () => {});
  }, []);

  // (removed: --app-h resize listener — app root is now position:fixed so no resize jumps)

  // ── 악보 링크 ON/OFF + 파트 필터 구독
  useEffect(() => {
    return onSnapshot(doc(db, "liveStatus", "sheetLink"), snap => {
      const d = snap.exists() ? snap.data() : {};
      const enabled = d.enabled ?? false;
      const parts   = d.allowedParts ?? null;
      sheetLinkEnabledRef.current = enabled;
      allowedPartsRef.current     = parts;
      setSheetLinkEnabled(enabled);
      setSheetSyncAllowedParts(parts);
    }, () => {});
  }, []);

  // ── 악보 sync 구독 → admin 아닌 모든 사용자 자동 이동
  useEffect(() => {
    let isFirst = true;
    const unsub = onSnapshot(doc(db, "liveStatus", "sheetSync"), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      const ts = data.updatedAt?.toMillis?.() ?? 0;
      if (isFirst) {
        // 새로고침/첫 로드 시 ts만 기록하고 이동하지 않음 — 저장 위치 유지
        isFirst = false;
        sheetSyncTsRef.current = ts;
        return;
      }
      if (ts === sheetSyncTsRef.current) return;
      sheetSyncTsRef.current = ts;
      if (userIsFohRef.current) return;
      if (!sheetLinkEnabledRef.current && !data.linkEnabled) return;
      const allowedParts = allowedPartsRef.current ?? data.allowedParts ?? null;
      if (allowedParts !== null) {
        const myParts = userPartsRef.current;
        if (myParts.length > 0 && !myParts.some(p => allowedParts.includes(p) || p === "전체")) return;
      } else {
        if (isVocalistUser({ parts: userPartsRef.current })) return;
      }
      const { svcId, songId, songIdx } = data;
      if (!svcId || !songId) return;
      setSheetSyncTrigger(n => n + 1);
      if (viewRef.current === "pdfViewer" && selSongIdRef.current === songId) return;
      navRef.current?.("pdfViewer", { songId, svcId, svcSongIdx: songIdx ?? 0, backTo: "home" });
    }, () => {});
    return unsub;
  }, []);



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
            const presetParts = allowed?.data()?.parts || (allowed?.data()?.part ? [allowed.data().part] : []);
            await setDoc(uRef, {
              name:  firebaseUser.displayName || firebaseUser.email,
              email: firebaseUser.email,
              role:  presetRole,
              parts: presetParts,
              part:  presetParts[0] || "",
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
          uid: u?.uid,
          name: d.name || u.name,
          role: d.role || "member",
          parts: d.parts || u?.parts || [],
          part: d.part || "",
          geminiKey: d.geminiKey || "",
        }));
      }
    }, () => {});
  }, [user?.uid]);

  // ── Firestore: songs (real-time, auth-gated)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "songs"), orderBy("title")),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSongs(data);
        try { localStorage.setItem("tvpc_songs_cache", JSON.stringify(data)); } catch {}
      },
      () => {}
    );
  }, [user?.uid]);

  // ── Firestore: services (real-time, auth-gated)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "services"), orderBy("date")),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setServices(data);
        setServicesLoaded(true);
        try { localStorage.setItem("tvpc_services_cache", JSON.stringify(data)); } catch {}
      },
      () => {}
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
      },
      () => {}
    );
  }, [user?.uid]);

  // 알림 토스트 5초 후 자동 닫기
  useEffect(() => {
    if (!notifPopup) return;
    const t = setTimeout(() => setNotifPopup(null), 5000);
    return () => clearTimeout(t);
  }, [notifPopup]);

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

  // ── Firestore: 큐 노트 (현재 열린 서비스 우선, 없으면 가장 가까운 서비스)
  useEffect(() => {
    if (!user?.uid) return;
    const todayStr = localDateStr();
    const sorted = [...services].sort((a, b) => a.date.localeCompare(b.date));
    const nearestId = sorted.find(s => s.date >= todayStr)?.id
                   ?? sorted[sorted.length - 1]?.id;
    const watchId = selSvcId || nearestId;
    if (!watchId) { setSongCues({}); return; }
    return onSnapshot(
      query(collection(db, "cueNotes"), where("svcId", "==", watchId)),
      snap => {
        const bySong = {};
        snap.docs.forEach(d => {
          const data = d.data();
          if (!bySong[data.songId]) bySong[data.songId] = [];
          bySong[data.songId].push({ id: d.id, ...data });
        });
        Object.values(bySong).forEach(arr =>
          arr.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
        );
        setSongCues(bySong);
      }
    );
  }, [user?.uid, services, selSvcId]);

  // ── Firestore: 유저 이름 맵 (uid -> name) — 1회 로드 (실시간 불필요)
  useEffect(() => {
    if (!user?.uid) return;
    getDocs(collection(db, "users")).then(snap => {
      const m = {};
      snap.docs.forEach(d => { m[d.id] = d.data().displayName || d.data().name || d.data().email || ""; });
      setUserMap(m);
    }).catch(() => {});
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
    if (!user?.uid) { setAnyLiveActive(false); return; }
    return onSnapshot(doc(db, "liveStatus", "global"), snap => {
      setAnyLiveActive(snap.exists() && snap.data().active === true);
    }, () => {});
  }, [user?.uid]);

  // ── FOH 팀 메시지 수신 (멤버 전용)
  useEffect(() => {
    if (!user?.uid || isFoh(user)) return;
    return onSnapshot(doc(db, "fohMessages", user.uid), snap => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const data = snap.data();
      const ts = data.sentAt?.toMillis?.() ?? 0;
      if (fohMsgTsRef.current === null) { fohMsgTsRef.current = ts; return; }
      if (ts === fohMsgTsRef.current) return;
      fohMsgTsRef.current = ts;
      if (Date.now() - ts > 10_000) return;
      setFohMsgBanner({ message: data.message, fromName: data.fromName });
    }, () => {});
  }, [user?.uid, user?.role]);

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
      @keyframes fohMsgIn { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:translateX(0); } }
    `;
    document.head.appendChild(el);
    return () => { try { document.head.removeChild(el); } catch(_) {} };
  }, []);

  // ── 예배 시작 10분 전 자동 라이브 모드 활성화
  useEffect(() => {
    if (!user || !services.length) return;
    if (user.role !== "admin" && !isLeader(user.role)) return;
    if (view === "pdfViewer") return;
    const check = () => {
      const now = new Date();
      const today = localDateStr(now);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const upcoming = services.find(svc => {
        if (svc.date !== today || !svc.time) return false;
        const [h, m] = svc.time.split(":").map(Number);
        const svcMin = h * 60 + m;
        return nowMin >= svcMin - 10 && nowMin <= svcMin + 120;
      });
      if (!upcoming || autoLiveTriggeredRef.current === upcoming.id) return;
      autoLiveTriggeredRef.current = upcoming.id;
      setView("live");
      localStorage.setItem("tvpc_view", "live");
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [user?.role, user?.uid, services, view]);

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
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해주세요.");
    const toVal = (v) => (v === null || v === undefined) ? { nullValue: null } : { stringValue: String(v) };
    const fields = {};
    for (const [k, v] of Object.entries(data)) fields[k] = toVal(v);
    const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const docPath = `projects/tvpcainos/databases/(default)/documents/services/${svcId}`;
    const resp = await fetch(`https://firestore.googleapis.com/v1/${docPath}?${fieldPaths}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!resp.ok) {
      const e2 = await resp.json().catch(() => ({}));
      const msg = e2.error?.message || `HTTP ${resp.status}`;
      if (resp.status === 429 || msg.includes("Quota")) throw new Error("저장 한도 초과. 잠시 후 다시 시도해주세요.");
      throw new Error(msg);
    }
    // REST API 성공 후 로컬 state 직접 갱신 (SDK 캐시와 무관하게 UI 즉시 반영)
    setServices(prev => prev.map(s => s.id === svcId ? { ...s, ...data } : s));
  };

  const addAnnotation = async (songId, noteData) => {
    await addDoc(collection(db, "annotations"), {
      ...noteData,
      songId,
      userId: user.uid,
      authorName: user.name || user.email || "",
      shared: noteData.shared ?? false,
      createdAt: serverTimestamp(),
    });
  };

  const deleteAnnotation = async (_songId, noteId) => {
    await deleteDoc(doc(db, "annotations", noteId));
  };

  const sendCue = async (svcId, songId, text, opts = {}) => {
    if (!user?.uid || !text?.trim()) return;
    const parts = getUserParts(user);
    const userPart = parts.length > 0 ? parts.join("/") : (user.displayName || user.name || user.email || "팀원");
    await addDoc(collection(db, "cueNotes"), {
      svcId, songId,
      userId: user.uid,
      userName: user.displayName || user.name || user.email || "팀원",
      userPart,
      text: text.trim(),
      section: opts.section || "전체",
      createdAt: serverTimestamp(),
      acknowledgedBy: [],
      panic: opts.panic ?? false,
    });
  };

  const deleteCue = async (cueId) => {
    await deleteDoc(doc(db, "cueNotes", cueId));
  };

  const editCue = async (cueId, newText) => {
    if (!newText?.trim()) return;
    await updateDoc(doc(db, "cueNotes", cueId), { text: newText.trim() });
  };

  const acknowledgeCue = async (cueId, alreadyAcked, opts = {}) => {
    if (!user?.uid) return;
    await updateDoc(doc(db, "cueNotes", cueId), { acknowledged: !alreadyAcked });
    // 확인 시 (언확인 아닐 때) 발신자에게 FOH 확인 토스트 전송
    if (!alreadyAcked && opts.targetUid && isFoh(user)) {
      const msg = opts.cueText ? `✅ ${opts.cueText}` : "✅ FOH 확인";
      await setDoc(doc(db, "fohMessages", opts.targetUid), {
        message: msg, sentAt: serverTimestamp(), fromName: user.name || user.email,
      }).catch(() => {});
    }
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

  // ── 버전 업데이트 체크 (Firestore 기반 — 어드민 파이널 승인 시만 사용자 알림)
  const isAdmin = user?.role === "admin";
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [adminNewBuild,   setAdminNewBuild]   = useState(false);
  const [adminBuildData,  setAdminBuildData]  = useState(null);
  const [releasingBuild,  setReleasingBuild]  = useState(false);
  const [releaseBuildOk,  setReleaseBuildOk]  = useState(false);
  const [showWhatsNewModal,  setShowWhatsNewModal]  = useState(false);
  const [whatsNewItems,      setWhatsNewItems]       = useState([]);
  const [whatsNewVersion,    setWhatsNewVersion]     = useState("");
  useEffect(() => {
    // 일반 사용자: Firestore appConfig/release 버전이 현재보다 신버전일 때만 알림
    const unsub = onSnapshot(doc(db, "appConfig", "release"), (snap) => {
      const v = snap.data()?.version;
      if (v && v !== APP_VERSION) {
        const fNum = parseFloat(v);
        const cNum = parseFloat(APP_VERSION);
        if (fNum > cNum) setUpdateAvailable(true);
      }
    }, () => {});
    return () => unsub();
  }, []);
  useEffect(() => {
    // 어드민 전용: buildTime vs releasedAt 비교 — 새 빌드가 마지막 배포보다 최신이면 배너 표시
    if (!isAdmin) return;
    Promise.all([
      fetch(`/admin-version.json?t=${Date.now()}`).then(r => r.json()),
      getDoc(doc(db, "appConfig", "release")),
    ]).then(([adminData, snap]) => {
      const buildTime  = adminData?.buildTime ? new Date(adminData.buildTime) : null;
      const releasedAt = snap.data()?.releasedAt?.toDate?.() || null;
      if (buildTime && (!releasedAt || buildTime > releasedAt)) {
        // 이미 이 빌드를 배포/닫기 한 경우 다시 표시 안 함
        const dismissed = localStorage.getItem("tvpc_dismissed_build");
        if (dismissed === adminData.buildTime) return;
        setAdminNewBuild(true);
        setAdminBuildData(adminData);
      }
    }).catch(() => {});
  }, [isAdmin]);
  useEffect(() => {
    // What's New 모달: admin-version.json에 showWhatsNew:true이고 이 빌드를 아직 안 본 경우 표시
    fetch(`/admin-version.json?t=${Date.now()}`).then(r => r.json()).then(data => {
      if (!data?.showWhatsNew) return;
      const build = data.build || "";
      const seen = localStorage.getItem("tvpc_seen_whats_new");
      if (seen === build) return;
      if (data.whatsNew?.length) {
        setWhatsNewItems(data.whatsNew);
        setWhatsNewVersion(build);
        setShowWhatsNewModal(true);
      }
    }).catch(() => {});
  }, []);
  const releaseBuild = async () => {
    setReleasingBuild(true);
    try {
      const newVersion = adminBuildData?.build || APP_VERSION;
      await setDoc(doc(db, "appConfig", "release"), { version: newVersion, releasedAt: serverTimestamp() });
      if (adminBuildData?.buildTime) {
        try { localStorage.setItem("tvpc_dismissed_build", adminBuildData.buildTime); } catch {}
      }
      setAdminNewBuild(false);
      setReleaseBuildOk(true);
      setTimeout(() => setReleaseBuildOk(false), 3000);
    } catch(e) { alert("배포 실패: " + e.message); }
    finally { setReleasingBuild(false); }
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
    if (params.svcId       !== undefined) { setSelSvcId(params.svcId);           localStorage.setItem("tvpc_selSvcId", params.svcId ?? ""); }
    if (params.songId      !== undefined) { setSelSongId(params.songId);          localStorage.setItem("tvpc_selSongId", params.songId ?? ""); }
    if (params.svcSongIdx  !== undefined) { setSelSvcSongIdx(params.svcSongIdx);  localStorage.setItem("tvpc_selSvcSongIdx", params.svcSongIdx ?? -1); }
    if (params.backTo      !== undefined) { setBackTo(params.backTo); localStorage.setItem("tvpc_backTo", params.backTo); }
    setView(newView);
    localStorage.setItem("tvpc_view", newView);
  };
  navRef.current = nav; // 매 렌더마다 갱신 — 구독 클로저에서 최신 nav 호출

  const unread = notifs.filter(n => !n.read).length;

  const shared = {
    user, songs, services, servicesLoaded, notifs, annotations, teamAnnotations, userMap, songDrawings,
    addSong, createService, updateService,
    onAddAnnotation: addAnnotation,
    onDeleteAnnotation: deleteAnnotation,
    markNotifRead, markAllNotifRead,
    nav, bgmChannel,
    songCues, sendCue, deleteCue, editCue, acknowledgeCue,
    sheetLinkEnabled, sheetSyncTrigger, sheetSyncAllowedParts,
  };

  return (
    <div style={{ width:"100%", height:"100dvh", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* 일반 사용자 업데이트 배너 */}
      {updateAvailable && (() => {
        const doUpdate = async () => {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
          }
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.href = window.location.pathname + "?t=" + Date.now();
        };
        return (
          <div style={{
            position:"fixed", top:0, left:0, right:0, zIndex:9999,
            background:"#1d4ed8", color:"#fff",
            display:"flex", alignItems:"center", gap:10,
            padding:"10px 14px",
          }}>
            <span style={{ flex:1, fontSize:14, fontWeight:600, minWidth:0 }}>🆕 새 버전이 있습니다</span>
            <button onClick={doUpdate} style={{
              background:"#fff", color:"#1d4ed8", border:"none",
              borderRadius:10, padding:"10px 20px", fontWeight:800, fontSize:14,
              cursor:"pointer", fontFamily:"inherit", flexShrink:0,
              touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
            }}>업데이트</button>
            <button onClick={() => setUpdateAvailable(false)} style={{
              background:"none", border:"none", color:"#fff",
              borderRadius:8, padding:"10px 14px", fontSize:20, lineHeight:1,
              cursor:"pointer", flexShrink:0,
              touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
            }}>✕</button>
          </div>
        );
      })()}
      {/* 어드민 전용: 새 빌드 배포 배너 */}
      {isAdmin && adminNewBuild && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, zIndex:9999,
          background:"#7c3aed", color:"#fff",
          display:"flex", alignItems:"center", gap:10,
          padding:"10px 14px",
        }}>
          <span style={{ flex:1, fontSize:13, fontWeight:600, minWidth:0 }}>
            🔧 새 빌드 v{adminBuildData?.build || APP_VERSION} (어드민)
          </span>
          <button onClick={() => {
              fetch(`/admin-version.json?t=${Date.now()}`).then(r => r.json()).then(data => {
                if (data?.whatsNew?.length) {
                  setWhatsNewItems(data.whatsNew);
                  setWhatsNewVersion(data.build || APP_VERSION);
                  setShowWhatsNewModal(true);
                } else {
                  alert("admin-version.json에 whatsNew 항목이 없습니다.");
                }
              }).catch(() => alert("admin-version.json 로드 실패"));
            }}
            style={{ background:"rgba(255,255,255,0.2)", color:"#fff", border:"1px solid rgba(255,255,255,0.4)",
              borderRadius:8, padding:"10px 14px", fontWeight:700, fontSize:13,
              cursor:"pointer", fontFamily:"inherit",
              flexShrink:0, touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
            }}>
            👁 미리보기
          </button>
          <button onClick={releaseBuild} disabled={releasingBuild}
            style={{ background:"#fff", color:"#7c3aed", border:"none",
              borderRadius:8, padding:"10px 18px", fontWeight:800, fontSize:13,
              cursor: releasingBuild ? "not-allowed" : "pointer", fontFamily:"inherit",
              flexShrink:0, touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
            }}>
            {releasingBuild ? "배포 중…" : "사용자 배포"}
          </button>
          <button onClick={() => {
              if (adminBuildData?.buildTime) {
                try { localStorage.setItem("tvpc_dismissed_build", adminBuildData.buildTime); } catch {}
              }
              setAdminNewBuild(false);
            }}
            style={{ background:"none", border:"none",
              color:"#fff", borderRadius:8, padding:"10px 14px", fontSize:20, lineHeight:1,
              cursor:"pointer", fontFamily:"inherit", flexShrink:0,
              touchAction:"manipulation", WebkitTapHighlightColor:"transparent",
            }}>✕</button>
        </div>
      )}
      {/* 어드민 전용: 배포 완료 알림 */}
      {isAdmin && releaseBuildOk && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, zIndex:9999,
          background:"#16a34a", color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:"12px 14px",
        }}>
          <span style={{ fontSize:13, fontWeight:700 }}>✓ v{adminBuildData?.build} 사용자 배포 완료!</span>
        </div>
      )}
      {/* 스크린 영역 — flex:1 로 남은 공간 차지, 각 스크린이 내부 스크롤 담당 */}
      <div style={{ flex:1, overflow:"hidden", position:"relative", display:"flex", flexDirection:"column" }}>
        {view === "home"          && <HomeSplashScreen user={user} />}
        {view === "services"      && <ServicesScreen      {...shared} />}
        {view === "foh"           && <FohErrorBoundary><HomeScreen {...shared} /></FohErrorBoundary>}
        {view === "svcDetail"     && <ServiceDetailScreen {...shared} selectedSvcId={selSvcId} onUpdateService={updateService} />}
        {view === "library"       && <SongLibraryScreen   {...shared} />}
        {view === "pdfViewer"     && (
          <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",background:C.bg}}><div style={{color:C.dim,fontSize:14}}>불러오는 중...</div></div>}>
            <PDFViewerScreen {...shared} selectedSongId={selSongId}
              selectedSvcId={selSvcId} selectedSvcSongIdx={selSvcSongIdx}
              backTo={backTo} pdfjsReady={pdfjsReady} sharedGeminiKey={sharedGeminiKey} />
          </Suspense>
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
          <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",background:C.bg}}><div style={{color:C.dim,fontSize:14}}>불러오는 중...</div></div>}>
            <LiveScreen user={user} services={services} songs={songs} nav={nav} anyLiveActive={anyLiveActive} />
          </Suspense>
        )}
        {view === "profile" && (
          <ProfileScreen user={user} onLogout={() => signOut(auth)}
            onRoleUpdate={() => setUser(u => ({ ...u, role: "leader" }))}
            sharedGeminiKey={sharedGeminiKey} />
        )}
      </div>

      {/* 하단 탭바 — position:fixed 없이 flex 하단에 자연 배치 */}
      {view !== "pdfViewer" && (
        <BottomNav view={view} nav={nav} unread={unread} user={user} anyLiveActive={anyLiveActive} />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {autoPhaseGlobal?.phase === "piano_on" && !pianoOverlayDismissed && (
        <PianoOnOverlay onDismiss={() => {
          const ts = autoPhaseGlobal?.updatedAt?.toMillis?.() ?? Date.now();
          pianoOverlayDismissedTsRef.current = ts;
          localStorage.setItem("tvpc_pianoOverlay_dismissed_ts", String(ts));
          setPianoOverlayDismissed(true);
        }} />
      )}

      {/* FOH → 멤버 메시지 배너 */}
      {fohMsgBanner && (
        <FohMsgToast message={fohMsgBanner.message} fromName={fohMsgBanner.fromName} onDismiss={() => setFohMsgBanner(null)} />
      )}

      {/* What's New 모달 */}
      {showWhatsNewModal && (
        <WhatsNewModal
          items={whatsNewItems}
          version={whatsNewVersion}
          onClose={() => {
            try { localStorage.setItem("tvpc_seen_whats_new", whatsNewVersion); } catch {}
            setShowWhatsNewModal(false);
          }}
          C={C}
        />
      )}

      {notifPopup && (
        <div style={{
          position:"fixed", top:"calc(env(safe-area-inset-top) + 10px)",
          left:12, right:12, zIndex:3000,
          animation:"notifToastSlide .32s cubic-bezier(.16,1,.3,1)",
        }}>
          <style>{`@keyframes notifToastSlide{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}`}</style>
          <div
            onClick={() => {
              setNotifPopup(null);
              const n = notifPopup.latest;
              markNotifRead(n.id);
              nav("notifications");
            }}
            style={{
              background:C.surf, borderRadius:16,
              boxShadow:"0 4px 20px rgba(0,0,0,0.18)",
              border:`1px solid ${C.bdr}`,
              padding:"12px 14px", cursor:"pointer",
              display:"flex", alignItems:"center", gap:12,
            }}>
            <div style={{ width:38, height:38, borderRadius:10, background:`${C.pur}18`,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <Icon n="bell" size={19} color={C.pur} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:13, color:C.txt }}>
                새 알림 {notifPopup.unreadCount}개
              </div>
              <div style={{ fontSize:12, color:C.dim, overflow:"hidden",
                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {notifPopup.latest.title?.replace(/^\[.*?\]\s*/, "") || notifPopup.latest.content || ""}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setNotifPopup(null); }}
              style={{ background:"none", border:"none", cursor:"pointer",
                padding:4, display:"flex", flexShrink:0, color:C.dim }}>
              <Icon n="xmark" size={16} color={C.dim} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
