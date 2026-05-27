import { useState, useEffect, useRef, useCallback } from "react";
import { auth, db } from "./firebase.js";
import { uploadPdf } from "./supabase.js";
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
  query, orderBy, where, getDoc, getDocs, setDoc, serverTimestamp, arrayUnion, limit,
} from "firebase/firestore";

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
  prev:    "M15 18l-6-6 6-6",
  next:    "M9 18l6-6-6-6",
  back:    "M19 12H5M12 5l-7 7 7 7",
  refresh: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L13 11h7V4l-2.35 2.35z",
  chevU:   "M18 15l-6-6-6 6",
  chevD:   "M6 9l6 6 6-6",
  chevL:   "M15 18l-6-6 6-6",
  chevR2:  "M9 18l6-6-6-6",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  tag:     "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  eraser:  "M20 20H7L3 16 13 6l8 8-2.5 2.5M9 15l2 2",
  undo:    "M3 10h13a4 4 0 0 1 0 8H9M3 10l4-4M3 10l4 4",
  highlight:"M3 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17 3 20zM16 5l3 3M15 7l-8 8",
  stamp:   "M9 2h6v3H9zM5 7h14v2a3 3 0 0 0-3 3v8a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-8a3 3 0 0 0-3-3V7z",
  slur:    "M4 17 Q12 7 20 17",
  cresc:   "M4 12 L20 7 M4 12 L20 17",
  dim:     "M4 7 L20 12 M4 17 L20 12",
  line:    "M4 12 L20 12",
  rect:    "M3 5h18v14H3z",
  circle:  "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
};

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
function drawStrokes(canvas, strokes, cur = null) {
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
      continue;
    }
    const isEraser     = s.tool === "eraser"     || s.eraser;
    const isHighlight  = s.tool === "highlighter";
    const lw = Math.max(0.5, s.width * canvas.width / 900);
    if (isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle   = "rgba(0,0,0,1)";
      ctx.lineWidth   = lw * 2;
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
   LOGIN SCREEN
══════════════════════════════════════════════════════════════════ */
const googleProvider = new GoogleAuthProvider();

function LoginScreen({ loginErr = "", onClearErr }) {
  const [err,     setErr]     = useState("");
  const [loading, setLoading] = useState(false);

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
          <div style={{
            marginTop:14, padding:"10px 14px", borderRadius:10,
            background:`${C.red}11`, border:`1px solid ${C.red}33`,
            color:C.red, fontSize:13, textAlign:"center", lineHeight:1.6,
          }}>
            {err || loginErr}
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

function CreateServiceModal({ songs, onClose, onCreate }) {
  const [title,    setTitle]    = useState("주일 2부");
  const [date,     setDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [time,     setTime]     = useState("09:00");
  const [selected, setSelected] = useState([]);
  const [saving,   setSaving]   = useState(false);

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
      <Input label="시간" value={time} onChange={setTime} type="time" />

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
  const [title, setTitle] = useState(svc.title || "주일 2부");
  const [date,  setDate]  = useState(svc.date  || "");
  const [time,  setTime]  = useState(svc.time  || "");
  const [saving, setSaving] = useState(false);

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
      <Input label="시간" value={time} onChange={setTime} type="time" />
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
  const [pdfFile,      setPdfFile]      = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [splitMode,    setSplitMode]    = useState(false);
  const [splitEntries, setSplitEntries] = useState([]);
  const [savingPage,   setSavingPage]   = useState(""); // "2/5" progress
  const fileRef = useRef(null);
  const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  const handleFileSelect = async (file) => {
    setPdfFile(file);
    setSplitMode(false);
    setPdfPageCount(0);
    setSplitEntries([]);
    if (!file || !window.pdfjsLib) return;
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
        artist, key, bpm,
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
        // Upload PDF once using first song's id, then reuse url
        const first = splitEntries[0];
        setSavingPage(`1/${pdfPageCount}`);
        const firstRef = await onAdd({
          title: first.title, artist: first.artist,
          key: first.key, bpm: Number(first.bpm) || 80, pdfPage: 1,
        });
        let sharedUrl = null;
        if (pdfFile && firstRef?.id) {
          sharedUrl = await uploadPdf(pdfFile, firstRef.id);
          await updateDoc(doc(db, "songs", firstRef.id), { pdfUrl: sharedUrl });
        }
        for (let i = 1; i < splitEntries.length; i++) {
          const e = splitEntries[i];
          setSavingPage(`${i + 1}/${pdfPageCount}`);
          const ref = await onAdd({
            title: e.title, artist: e.artist,
            key: e.key, bpm: Number(e.bpm) || 80, pdfPage: i + 1,
          });
          if (sharedUrl && ref?.id) {
            await updateDoc(doc(db, "songs", ref.id), { pdfUrl: sharedUrl });
          }
        }
      } else {
        const docRef = await onAdd({ title, artist, key, bpm: Number(bpm) || 80 });
        if (pdfFile && docRef?.id) {
          const url = await uploadPdf(pdfFile, docRef.id);
          await updateDoc(doc(db, "songs", docRef.id), { pdfUrl: url });
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

  const canAdd = splitMode
    ? splitEntries.length > 0 && splitEntries.every(e => e.title.trim())
    : !!title.trim();

  return (
    <Modal title="새 곡 추가" onClose={onClose} noBackdrop>
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
        </>
      )}

      {/* PDF 업로드 */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:8 }}>악보 PDF (선택)</div>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf"
          style={{ display:"none" }}
          onChange={e => { handleFileSelect(e.target.files[0] || null); e.target.value = ""; }} />
        {pdfFile ? (
          <div style={{
            display:"flex", alignItems:"center", gap:10, padding:"12px 14px",
            background:`${C.grn}12`, border:`1.5px solid ${C.grn}55`, borderRadius:10,
          }}>
            <span style={{ fontSize:20 }}>📄</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:C.grn, fontWeight:600,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {pdfFile.name}
              </div>
              {pdfPageCount > 0 && (
                <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                  {pdfPageCount}페이지
                </div>
              )}
            </div>
            <button onClick={() => { setPdfFile(null); setSplitMode(false); setPdfPageCount(0); }}
              style={{ background:"none", border:"none", cursor:"pointer", padding:2, display:"flex" }}>
              <Icon n="xmark" size={16} color={C.dim} />
            </button>
          </div>
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
              분할 저장 — {pdfPageCount}페이지
            </div>
            <button onClick={() => setSplitMode(false)} style={{
              background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6,
              padding:"2px 8px", cursor:"pointer", fontSize:11, color:C.dim, fontFamily:"inherit",
            }}>취소</button>
          </div>
          <div style={{ maxHeight:280, overflowY:"auto", display:"flex", flexDirection:"column", gap:8 }}>
            {splitEntries.map((e, i) => (
              <div key={i} style={{
                background:C.card, borderRadius:10, padding:"10px 12px",
                border:`1px solid ${C.bdr}`,
              }}>
                <div style={{ fontSize:11, color:C.dim, fontWeight:700, marginBottom:6 }}>
                  페이지 {i + 1}
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
          {savingPage ? `📤 저장 중... (${savingPage})` : pdfFile ? "📤 업로드 중..." : "저장 중..."}
        </div>
      )}

      <Btn
        label={saving ? (savingPage ? `저장 중... ${savingPage}` : "추가 중...") : (splitMode ? `${pdfPageCount}개 곡 추가하기` : "추가하기")}
        icon="plus" onClick={handleAdd} full disabled={saving || !canAdd}
      />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SERVICES SCREEN
══════════════════════════════════════════════════════════════════ */
function ServicesScreen({ user, services, songs, notifs, createService, nav }) {
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

  const SvcCard = ({ svc, past }) => {
    const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    return (
      <div className="wFadeIn"
        onClick={() => nav("svcDetail", { svcId: svc.id })}
        style={{
          background: C.surf,
          borderRadius:14, padding:"16px",
          marginBottom:10,
          border: past ? `1px solid ${C.bdr}` : `1.5px solid ${C.acc}`,
          cursor:"pointer",
          boxShadow: past ? "0 1px 4px rgba(0,0,0,.06)" : `0 2px 12px ${C.acc}33`,
        }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:16 }}>{svc.title}</div>
            <div style={{ color:C.dim, fontSize:13, marginTop:3 }}>
              📅 {fmtDate(svc.date)}{svc.time ? ` · ${svc.time}` : ""}
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
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:C.dim }}>{svcSongs.length}곡 선택됨</span>
          <Icon n="chevR" size={16} color={C.dim} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      {/* 헤더 */}
      <div style={{ background:C.surf, padding:"20px 20px 16px",
        paddingTop:"calc(20px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:12, color:C.dim, marginBottom:2 }}>TVPC Worship</div>
          <div style={{ fontWeight:800, fontSize:20 }}>예배 일정</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {isLeader(user.role) && (
            <button onClick={() => setShowCreate(true)} style={{
              background:C.card, border:`1px solid ${C.acc}`, borderRadius:9,
              padding:"6px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4,
              color:C.acc, fontSize:12, fontFamily:"inherit", fontWeight:600,
            }}>
              <Icon n="plus" size={13} color={C.acc} /> 새 예배 일정 만들기
            </button>
          )}
          <button onClick={() => window.location.reload()} style={{
            background:C.card, border:`1px solid ${C.bdr}`,
            borderRadius:10, padding:"6px 8px", cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", gap:2,
          }}>
            <Icon n="refresh" size={18} color={C.dim} />
            <span style={{ fontSize:9, color:C.dim, fontWeight:600 }}>새로고침</span>
          </button>
          <button onClick={() => nav("notifications")} style={{
            background:C.card, border:`1px solid ${C.bdr}`,
            borderRadius:10, padding:"6px 8px", position:"relative",
            cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2,
          }}>
            <Icon n="bell" size={18} color={unread > 0 ? C.acc : C.dim} />
            <span style={{ fontSize:9, color:unread > 0 ? C.acc : C.dim, fontWeight:600 }}>알림</span>
            {unread > 0 && (
              <span style={{
                position:"absolute", top:4, right:4,
                width:8, height:8, background:C.red,
                borderRadius:"50%", border:`2px solid ${C.surf}`,
              }} />
            )}
          </button>
        </div>
      </div>

      <div style={{ padding:16, paddingBottom:90 }}>
        {/* 다가오는 예배 */}
        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:10 }}>다가오는 예배</div>
            {upcoming.map(svc => <SvcCard key={svc.id} svc={svc} past={false} />)}
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
function SongPickerModal({ songs, currentIds, onClose, onSave }) {
  const [selected, setSelected] = useState([...currentIds]);
  const [query,    setQuery]    = useState("");

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(query.toLowerCase())
  );
  const toggle = id => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  return (
    <Modal title={`곡 선택 (${selected.length}곡)`} onClose={onClose}>
      <input value={query} onChange={e => setQuery(e.target.value)}
        placeholder="곡명, 아티스트 검색..."
        style={{
          width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
          color:C.txt, padding:"9px 14px", borderRadius:10,
          fontSize:14, outline:"none", fontFamily:"inherit", marginBottom:12,
        }} />
      <div style={{ maxHeight:320, overflowY:"auto", marginBottom:14 }}>
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
                  {s.pdfUrl ? " · 📄 PDF" : ""}
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

function ServiceDetailScreen({ user, services, songs, annotations, teamAnnotations, nav, selectedSvcId, onUpdateService }) {
  const svc = services.find(s => s.id === selectedSvcId);
  const [showPicker, setShowPicker] = useState(false);
  const [showEdit,   setShowEdit]   = useState(false);
  const [drag, setDrag]           = useState(null); // {fromIdx, startY, curY}
  const [dropIdx, setDropIdx]     = useState(null);
  const cardRefs = useRef([]);

  if (!svc) return null;

  // Map directly from svc.songIds to keep indices aligned (no filter shift)
  const entries = (svc.songIds || []).map((id, i) => ({ id, song: songs.find(s => s.id === id) || null, i }));
  const totalCount = entries.filter(e => e.song).length;

  const leader = isLeader(user.role);

  const sendNotif = async () => {
    await updateDoc(doc(db, "services", svc.id), { notified: true });
    await addDoc(collection(db, "notifications"), {
      title: `${svc.title} 악보 등록`,
      body: `${svc.date} ${svc.title} 악보가 등록되었습니다. 연습 준비해주세요!`,
      createdAt: serverTimestamp(), readBy: [], serviceId: svc.id,
    });
  };

  const shareToKakao = () => {
    const songLines = entries
      .filter(e => e.song)
      .map((e, idx) => `${idx + 1}. ${e.song.title}`)
      .join("\n");
    const sep = "─".repeat(9);
    const text = `📋 ${svc.title}\n\n📅 ${svc.date}${svc.time ? " · " + svc.time : ""}\n${sep}\n${songLines}\n${sep}\n🎵 Ainos 앱에서 확인하세요`;

    if (window.Kakao?.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: "text",
        text,
        link: { mobileWebUrl: window.location.origin, webUrl: window.location.origin },
      });
    } else {
      // Kakao SDK 미초기화 시 클립보드 복사로 대체
      navigator.clipboard?.writeText(text).then(() => alert("메시지가 복사됐습니다. 카카오톡에 붙여넣기 해주세요."));
    }
  };

  const removeSong = async (idx) => {
    const newIds = (svc.songIds || []).filter((_, i) => i !== idx);
    await updateDoc(doc(db, "services", svc.id), { songIds: newIds });
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
    await updateDoc(doc(db, "services", svc.id), { songIds: ids });
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
    <div style={{ minHeight:"100vh", background:C.bg }}>
      {/* 헤더 */}
      <div style={{ background:C.surf, padding:"18px 16px",
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={() => nav("services")}
          style={{ background:"none", border:"none", color:C.acc, cursor:"pointer",
            padding:4, display:"flex", alignItems:"center", gap:4 }}>
          <Icon n="back" size={18} color={C.acc} />
        </button>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:17 }}>{svc.title}</div>
          <div style={{ fontSize:12, color:C.dim, marginTop:1 }}>
            📅 {svc.date}{svc.time ? ` · ${svc.time}` : ""}
          </div>
        </div>
        {leader && (
          <button onClick={() => setShowPicker(true)} style={{
            background:C.card, border:`1px solid ${C.acc}`, borderRadius:9,
            padding:"6px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4,
            color:C.acc, fontSize:12, fontFamily:"inherit", fontWeight:600,
          }}>
            <Icon n="plus" size={13} color={C.acc} /> 라이브러리에서 곡 추가
          </button>
        )}
        {leader && (
          <button onClick={() => setShowEdit(true)} style={{
            background:C.card, border:`1px solid ${C.bdr}`, borderRadius:9,
            padding:"6px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4,
            color:C.txt, fontSize:12, fontFamily:"inherit",
          }}>
            <Icon n="edit" size={13} color={C.txt} /> 수정
          </button>
        )}
        {leader && (
          <button onClick={shareToKakao} style={{
            background:"#FEE500", border:"none", borderRadius:9, padding:"7px 12px",
            display:"flex", alignItems:"center", gap:5,
            fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", color:"#3C1E1E",
          }}>
            <span style={{ fontSize:14 }}>💬</span> 공유
          </button>
        )}
        {svc.notified
          ? <Badge label="알림완료" color={C.grn} />
          : leader && (
            <button onClick={sendNotif} style={{
              background:C.pur, border:"none", borderRadius:9, padding:"7px 12px",
              display:"flex", alignItems:"center", gap:5, color:"#fff",
              fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit",
            }}>
              <Icon n="send" size={13} color="#fff" /> 알림
            </button>
          )
        }
      </div>

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
          const firstNote = teamNotes[0];
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
                    onClick={() => !drag && nav("pdfViewer", { songId: song.id, backTo:"svcDetail" })}>
                    <div style={{ fontWeight:700, fontSize:15, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{song.title}</div>
                    <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>
                      {song.artist}{song.bpm ? ` · ♩${song.bpm}` : ""}
                    </div>
                    <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                      <KeyBadge k={song.key} />
                      {song.pdfUrl && <Badge label="PDF" color={C.grn} />}
                      {teamNotes.length > 0 && <Badge label={`📋 ${teamNotes.length}`} color={C.acc} />}
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

                {/* 팀 메모 미리보기 */}
                {firstNote && (
                  <div style={{
                    marginTop:10, padding:"8px 10px", borderRadius:8,
                    background:`${C.acc}0d`, border:`1px solid ${C.acc}33`,
                    fontSize:12, color:C.dim, lineHeight:1.5,
                    overflow:"hidden", display:"-webkit-box",
                    WebkitLineClamp:2, WebkitBoxOrient:"vertical",
                  }}>
                    📋 {firstNote.text}
                    {teamNotes.length > 1 && <span style={{ color:C.acc, fontWeight:700 }}> +{teamNotes.length - 1}개</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showPicker && (
        <SongPickerModal songs={songs} currentIds={svc.songIds || []}
          onClose={() => setShowPicker(false)} onSave={saveSongs} />
      )}
      {showEdit && (
        <EditServiceModal svc={svc} onClose={() => setShowEdit(false)} onSave={onUpdateService} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SONG LIBRARY SCREEN
══════════════════════════════════════════════════════════════════ */
function SongLibraryScreen({ user, songs, addSong, nav }) {
  const [query,      setQuery]      = useState("");
  const [showAdd,    setShowAdd]    = useState(false);
  const [uploading,  setUploading]  = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [editSong,   setEditSong]   = useState(null);
  const [editForm,   setEditForm]   = useState({});
  const [consonant,  setConsonant]  = useState("");

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
    setUploading(songId);
    try {
      const url = await uploadPdf(file, songId);
      await updateDoc(doc(db, "songs", songId), { pdfUrl: url });
    } catch (err) {
      alert("업로드 실패: " + err.message);
    } finally {
      setUploading(null);
    }
  };

  const saveEdit = async () => {
    if (!editSong) return;
    await updateDoc(doc(db, "songs", editSong.id), {
      title:  editForm.title.trim(),
      artist: editForm.artist.trim(),
      key:    editForm.key.trim(),
      bpm:    Number(editForm.bpm) || 0,
    });
    setEditSong(null);
  };

  return (
    <div style={{ height:"var(--app-h, 100dvh)", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* 고정 헤더 */}
      <div style={{ background:C.surf, flexShrink:0,
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ padding:"0 16px 10px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>악보 라이브러리</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={() => window.location.reload()} style={{
              background:C.card, border:`1px solid ${C.bdr}`,
              borderRadius:10, padding:8, cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:2,
            }}>
              <img src="/icon-192.png" width={18} height={18}
                style={{ display:"block", borderRadius:4, objectFit:"cover" }} alt="새로고침" />
              <span style={{ fontSize:9, color:C.dim, fontWeight:600, letterSpacing:"0.02em" }}>새로고침</span>
            </button>
            {isLeader(user.role) && (
              <Btn label="곡 추가" icon="plus" sm onClick={() => setShowAdd(true)} />
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
                background:`linear-gradient(135deg, ${keyColor(song.key)}44, ${C.pur}44)`,
                border:`1px solid ${keyColor(song.key)}44`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:20,
              }}>🎵</div>

              <div style={{ flex:1, minWidth:0, cursor:"pointer" }}
                onClick={() => nav("pdfViewer", { songId: song.id, backTo: "library" })}>
                <div style={{ fontWeight:700, fontSize:14, letterSpacing:"-0.01em",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {song.title}
                </div>
                <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>{song.artist}</div>
                <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                  <KeyBadge k={song.key} />
                  <Badge label={`♩ ${song.bpm}`} color={C.dim} />
                  {song.pdfUrl && <Badge label="PDF" color={C.grn} />}
                </div>
              </div>

              {isLeader(user.role) && (
                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  {uploading === song.id ? (
                    <div style={{ fontSize:11, color:C.acc, padding:"0 6px" }}>업로드 중...</div>
                  ) : (
                    <>
                      <button onClick={() => { setEditSong(song); setEditForm({ title: song.title, artist: song.artist || "", key: song.key || "", bpm: song.bpm || "" }); }}
                        title="편집"
                        style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          width:34, height:34, borderRadius:9, cursor:"pointer",
                          background:`${C.acc}22`, border:`1px solid ${C.acc}55` }}>
                        <Icon n="pen" size={14} color={C.acc} />
                      </button>
                      <input type="file" accept=".pdf,application/pdf"
                        style={{ display:"none" }} id={`up-${song.id}`}
                        onChange={e => handleUpload(e, song.id)} />
                      <label htmlFor={`up-${song.id}`}
                        title={song.pdfUrl ? "PDF 교체" : "PDF 업로드"}
                        style={{ display:"flex", alignItems:"center", justifyContent:"center",
                          width:34, height:34, borderRadius:9, cursor:"pointer",
                          background: song.pdfUrl ? `${C.grn}22` : C.surf,
                          border:`1px solid ${song.pdfUrl ? C.grn : C.bdr}` }}>
                        <Icon n="upload" size={14} color={song.pdfUrl ? C.grn : C.dim} />
                      </label>
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
          ].map(f => (
            <div key={f.key} style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.dim, marginBottom:4 }}>{f.label}</div>
              <input
                type={f.type || "text"}
                value={editForm[f.key]}
                onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                style={{
                  width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
                  color:C.txt, padding:"9px 12px", borderRadius:10,
                  fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box",
                }}
              />
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PDF VIEWER SCREEN
══════════════════════════════════════════════════════════════════ */
function PDFViewerScreen({ user, songs, services, annotations, teamAnnotations, onAddAnnotation, onDeleteAnnotation, nav, selectedSongId, selectedSvcId, backTo, pdfjsReady }) {
  const song = songs.find(s => s.id === selectedSongId);

  // ── 예배 곡 순서
  const svc      = selectedSvcId ? services.find(s => s.id === selectedSvcId) : null;
  const svcSongs = svc ? (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean) : [];
  const songIdx  = svcSongs.findIndex(s => s?.id === selectedSongId);
  const goToSong = (idx) => {
    if (idx < 0 || idx >= svcSongs.length) return;
    nav("pdfViewer", { songId: svcSongs[idx].id, backTo });
  };

  // ── PDF.js refs / state
  const canvas1Ref   = useRef(null);
  const canvas2Ref   = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef    = useRef(null);
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
  const [dualKey,  setDualKey]  = useState(0); // bumped once when both PDFs are ready
  const [dualToast, setDualToast] = useState("");
  const touchStartX = useRef(null);
  const toastTimer  = useRef(null);
  const penDownRef  = useRef(false); // 애플펜슬 터치 중 여부

  // ── UI
  const [dual,          setDual]          = useState(false);
  const [media,         setMedia]         = useState(false);
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteInput,     setNoteInput]     = useState(false);
  const [noteShared,    setNoteShared]    = useState(false); // 팀 메모 여부
  const [noteTxt,       setNoteTxt]       = useState("");
  const [saving,        setSaving]        = useState(false);

  // ── Drawing / handwriting
  const [drawMode,  setDrawMode]  = useState(false);
  const [drawColor, setDrawColor] = useState("#e8383b");
  const [drawWidth, setDrawWidth] = useState(1);
  const [drawTool,  setDrawTool]  = useState("pen"); // "pen" | "highlighter" | "eraser" | "stamp"
  const [drawSaveErr, setDrawSaveErr] = useState("");

  // ── Stamp + loupe
  const [stampSymbol, setStampSymbol] = useState("f");
  const [stampItalic, setStampItalic] = useState(true);
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
  const [transposeSteps, setTransposeSteps] = useState(0);
  const [chordData,      setChordData]      = useState([]);   // [{chord,x,y}] — single / dual left
  const [chordData2,     setChordData2]     = useState([]);   // dual right
  const [detectingChords, setDetectingChords] = useState(false);
  const [detectErr,      setDetectErr]      = useState("");
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

  const resetZoom = useCallback(() => {
    setZoomMul(1.0);
    setPanOffset({ x: 0, y: 0 });
  }, []);

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
    getDoc(doc(db, "customSongs", `chord_${user.uid}_${selectedSongId}_p${pageNum}`))
      .then(snap => { if (snap.exists()) setChordData(snap.data().chords || []); })
      .catch(() => {});
  }, [pageNum, selectedSongId, user?.uid, dual]);

  // 코드 감지 결과 로드 — 듀얼 왼쪽
  useEffect(() => {
    setChordData([]);
    if (!user?.uid || !dualLeftSongId || !dual) return;
    getDoc(doc(db, "customSongs", `chord_${user.uid}_${dualLeftSongId}_p1`))
      .then(snap => { if (snap.exists()) setChordData(snap.data().chords || []); })
      .catch(() => {});
  }, [dualLeftSongId, user?.uid, dual]);

  // 코드 감지 결과 로드 — 듀얼 오른쪽
  useEffect(() => {
    setChordData2([]);
    if (!user?.uid || !dualRightSongId || !dual) return;
    getDoc(doc(db, "customSongs", `chord_${user.uid}_${dualRightSongId}_p1`))
      .then(snap => { if (snap.exists()) setChordData2(snap.data().chords || []); })
      .catch(() => {});
  }, [dualRightSongId, user?.uid, dual]);

  const detectChords = async (side = 1) => {
    const canvas = (side === 2 ? canvas2Ref : canvas1Ref).current;
    if (!canvas || !canvas.width) return;
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) { setDetectErr("VITE_GEMINI_API_KEY 없음"); return; }
    const setCD = side === 2 ? setChordData2 : setChordData;
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    const page   = dual ? 1 : pageNum;
    setDetectingChords(true); setDetectErr(""); setCD([]);
    try {
      const b64 = canvas.toDataURL("image/png").split(",")[1];
      const prompt = `Detect all chord symbols (like C, Am, G7, F#m, Bb, Dm7, etc.) in this sheet music image.
Return ONLY a JSON array. Each item must have:
- "label": the chord symbol text exactly as shown
- "box_2d": bounding box as [ymin, xmin, ymax, xmax] where values are 0-1000 (0=top/left, 1000=bottom/right)

Example: [{"label":"C","box_2d":[45,120,75,160]},{"label":"Am","box_2d":[45,340,75,390]}]
If no chords found, return [].
Return ONLY the JSON array, no other text.`;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [
            { inlineData: { mimeType: "image/png", data: b64 } },
            { text: prompt },
          ]}]}),
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.candidates[0].content.parts[0].text;
      // Strip markdown code fences if present, then find JSON array
      const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) { setDetectErr("응답 파싱 실패"); return; }
      let raw;
      try { raw = JSON.parse(match[0]); }
      catch { setDetectErr("JSON 파싱 실패 — 재시도 해보세요"); return; }
      const chords = raw.map(item => {
        const b = item.box_2d;
        const x = (b[1] + b[3]) / 2 / 1000;
        const y = (b[0] + b[2]) / 2 / 1000;
        const w = (b[3] - b[1]) / 1000;
        const h = (b[2] - b[0]) / 1000;
        return { chord: item.label, x, y, w, h };
      });
      setCD(chords);
      if (chords.length === 0) {
        setDetectErr("코드를 찾지 못했습니다");
      } else if (user?.uid && songId) {
        setDoc(
          doc(db, "customSongs", `chord_${user.uid}_${songId}_p${page}`),
          { chords, updatedAt: serverTimestamp() }
        ).catch(() => {});
      }
    } catch(e) {
      setDetectErr("오류: " + e.message);
    } finally {
      setDetectingChords(false);
    }
  };

  // PDF 로드 (싱글 모드)
  useEffect(() => {
    if (dual) return;
    pdfDocRef.current = null;
    setPageNum(song?.pdfPage || 1); setNumPages(0); setLoadErr("");
    if (!song?.pdfUrl || !pdfjsReady || !window.pdfjsLib) return;
    window.pdfjsLib.getDocument({ url: song.pdfUrl }).promise
      .then(pdf => { pdfDocRef.current = pdf; setNumPages(pdf.numPages); })
      .catch(() => setLoadErr("PDF를 불러올 수 없습니다"));
  }, [song?.pdfUrl, pdfjsReady, selectedSongId, dual]);

  // PDF 로드 (듀얼 모드) — Promise.all로 두 곡 동시 로드, 완료 후 한 번만 렌더 트리거
  const dualLeftUrl  = svcSongs[dualIdx]?.pdfUrl     || null;
  const dualRightUrl = svcSongs[dualIdx + 1]?.pdfUrl || null;
  useEffect(() => {
    if (!dual || !pdfjsReady || !window.pdfjsLib) return;
    dualPdf1Ref.current = null;
    dualPdf2Ref.current = null;
    const load = (url) => url
      ? window.pdfjsLib.getDocument({ url }).promise.catch(() => null)
      : Promise.resolve(null);
    Promise.all([load(dualLeftUrl), load(dualRightUrl)]).then(([p1, p2]) => {
      dualPdf1Ref.current = p1;
      dualPdf2Ref.current = p2;
      setDualKey(k => k + 1); // single render trigger after both are ready
    });
  }, [dual, dualIdx, dualLeftUrl, dualRightUrl, pdfjsReady]);

  // 페이지 렌더링 — 컨테이너에 꼭 맞게
  const renderPage = useCallback(async () => {
    if (!cSize.w || !cSize.h) return;
    const pad = 8;
    try {
      if (dual) {
        // 듀얼: 좌우 두 곡 (각자의 PDF 첫 페이지)
        const halfW  = Math.floor(cSize.w / 2) - pad * 2;
        const availH = cSize.h - pad * 2;
        const renderTo = async (ref, drawRef, strokesRef2, pdfDoc) => {
          if (!ref.current) return;
          if (!pdfDoc) { ref.current.width = 0; ref.current.height = 0; return; }
          const page = await pdfDoc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const sc   = Math.min(halfW / base.width, availH / base.height) * zoomMul;
          const vp   = page.getViewport({ scale: sc });
          ref.current.width  = vp.width;
          ref.current.height = vp.height;
          await page.render({ canvasContext: ref.current.getContext("2d"), viewport: vp }).promise;
          if (drawRef.current) {
            drawRef.current.width  = vp.width;
            drawRef.current.height = vp.height;
            drawStrokes(drawRef.current, strokesRef2.current);
          }
        };
        await renderTo(canvas1Ref, drawCanvas1Ref, strokes1Ref, dualPdf1Ref.current);
        await renderTo(canvas2Ref, drawCanvas2Ref, strokes2Ref, dualPdf2Ref.current);
      } else {
        // 싱글: 한 페이지 꽉 맞춤
        if (!pdfDocRef.current || !canvas1Ref.current) return;
        const page = await pdfDocRef.current.getPage(pageNum);
        const base = page.getViewport({ scale: 1 });
        const sc   = Math.min((cSize.w - pad * 2) / base.width, (cSize.h - pad * 2) / base.height) * zoomMul;
        const vp   = page.getViewport({ scale: sc });
        canvas1Ref.current.width  = vp.width;
        canvas1Ref.current.height = vp.height;
        await page.render({ canvasContext: canvas1Ref.current.getContext("2d"), viewport: vp }).promise;
        if (drawCanvas1Ref.current) {
          drawCanvas1Ref.current.width  = vp.width;
          drawCanvas1Ref.current.height = vp.height;
          drawStrokes(drawCanvas1Ref.current, strokes1Ref.current);
        }
      }
    } catch(e) { console.error(e); }
  }, [pageNum, zoomMul, dual, numPages, cSize, dualKey]);

  useEffect(() => { renderPage(); }, [renderPage, numPages]);

  const showToast = useCallback((msg) => {
    setDualToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setDualToast(""), 2000);
  }, []);

  const dualPrev = useCallback(() => {
    if (dualIdx <= 0) { showToast("첫번째 곡입니다"); return; }
    setDualIdx(i => i - 1);
  }, [dualIdx, showToast]);

  const dualNext = useCallback(() => {
    if (dualIdx >= svcSongs.length - 1) { showToast("마지막 곡입니다"); return; }
    setDualIdx(i => i + 1);
  }, [dualIdx, svcSongs.length, showToast]);

  const handleTouchStart = (e) => {
    if (drawModeRef.current) return;
    if (penDownRef.current) return;
    if (zoomMul > 1.0) return; // 줌인 상태에서는 D-패드로 이동
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (drawModeRef.current) return;
    if (zoomMul > 1.0) return;
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    if (dual) {
      if (delta < 0) dualNext(); else dualPrev();
    } else if (svcSongs.length > 1 && songIdx >= 0) {
      if (delta < 0) {
        if (songIdx >= svcSongs.length - 1) showToast("마지막 곡입니다");
        else nav("pdfViewer", { songId: svcSongs[songIdx + 1].id, backTo });
      } else {
        if (songIdx <= 0) showToast("첫번째 곡입니다");
        else nav("pdfViewer", { songId: svcSongs[songIdx - 1].id, backTo });
      }
    }
  };

  const saveNote = async () => {
    if (!noteTxt.trim() || saving) return;
    setSaving(true);
    await onAddAnnotation(selectedSongId, { text: noteTxt, page: pageNum, x: 0, y: 0, shared: noteShared });
    setNoteTxt(""); setNoteInput(false); setNoteShared(false); setSaving(false);
  };
  const deleteNote = id => onDeleteAnnotation(selectedSongId, id);

  // ── Loupe update (stamp mode)
  const updateLoupe = useCallback((e, pdfCanvas, drawCanvas, sym, italic, color) => {
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
      const baseline = getStampBaseline(sym);
      // 루프 크기에 비례한 크기 계산: 실제 스탬프 sz에 ZOOM 적용
      const actualSz = Math.max(7, 12 * pdfCanvas.width / 450);
      const sz = actualSz * ZOOM;
      const family = italic ? '"Times New Roman", Georgia, serif' : 'system-ui, sans-serif';
      ctx.font = `${italic ? "italic " : ""}bold ${sz}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = baseline;
      ctx.fillStyle = color || "#e8383b";
      ctx.globalAlpha = 0.88;
      ctx.fillText(sym, LW / 2, LH / 2);
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
    if (e.pointerType === "touch") return;
    const canvas = drawCanvas1Ref.current;
    if (!canvas) return;
    e.preventDefault(); e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    lastSideRef.current = 1;
    if (drawTool === "stamp") {
      const pt = getCanvasPt(e, canvas);
      lastPt1Ref.current = pt;
      updateLoupe(e, canvas1Ref.current, canvas, stampSymbol, stampItalic, drawColor);
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
    drawStrokes(canvas, strokes1Ref.current, curStroke1Ref.current);
  };
  const handleDraw1Move = (e) => {
    if (e.pointerType === "touch") return;
    const canvas = drawCanvas1Ref.current;
    if (!canvas) return;
    e.preventDefault();
    if (drawTool === "stamp") {
      lastPt1Ref.current = getCanvasPt(e, canvas);
      updateLoupe(e, canvas1Ref.current, canvas, stampSymbol, stampItalic, drawColor);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape" && shapeStart1Ref.current) {
      const pt = getCanvasPt(e, canvas);
      curStroke1Ref.current = { tool: shapeTool, points: [shapeStart1Ref.current, pt], color: drawColor, width: drawWidth };
      drawStrokes(canvas, strokes1Ref.current, curStroke1Ref.current);
      return;
    }
    if (!isDrawing1Ref.current || !curStroke1Ref.current) return;
    curStroke1Ref.current.points.push(getCanvasPt(e, canvas));
    drawStrokes(canvas, strokes1Ref.current, curStroke1Ref.current);
  };
  const handleDraw1Up = async (e) => {
    if (drawTool === "stamp") {
      setLoupePos(null);
      const canvas = drawCanvas1Ref.current;
      if (!canvas) return;
      const pt = e ? getCanvasPt(e, canvas) : lastPt1Ref.current;
      const stamp = { tool:"stamp", symbol:stampSymbol, italic:stampItalic,
        color:drawColor, size:drawWidth * 3 + 8, points:[pt] };
      const next = [...strokes1Ref.current, stamp];
      strokes1Ref.current = next;
      drawStrokes(canvas, next);
      const songId = dual ? dualLeftSongId : selectedSongId;
      await saveDrawing(songId, dual ? 1 : pageNum, next);
      return;
    }
    if (drawTool === "shape") {
      const shape = curStroke1Ref.current;
      curStroke1Ref.current = null;
      shapeStart1Ref.current = null;
      if (!shape || shape.points.length < 2) {
        const canvas = drawCanvas1Ref.current;
        if (canvas) drawStrokes(canvas, strokes1Ref.current);
        return;
      }
      const next = [...strokes1Ref.current, shape];
      strokes1Ref.current = next;
      const songId = dual ? dualLeftSongId : selectedSongId;
      await saveDrawing(songId, dual ? 1 : pageNum, next);
      const canvas = drawCanvas1Ref.current;
      if (canvas) drawStrokes(canvas, next);
      return;
    }
    if (!isDrawing1Ref.current || !curStroke1Ref.current) return;
    isDrawing1Ref.current = false;
    const stroke = curStroke1Ref.current;
    curStroke1Ref.current = null;
    if (stroke.points.length > 0) {
      const next = [...strokes1Ref.current, stroke];
      strokes1Ref.current = next;
      const songId = dual ? dualLeftSongId : selectedSongId;
      await saveDrawing(songId, dual ? 1 : pageNum, next);
    }
    const canvas = drawCanvas1Ref.current;
    if (canvas) drawStrokes(canvas, strokes1Ref.current);
  };
  const handleDraw1Cancel = () => {
    setLoupePos(null);
    shapeStart1Ref.current = null;
    isDrawing1Ref.current = false; curStroke1Ref.current = null;
    const canvas = drawCanvas1Ref.current;
    if (canvas) drawStrokes(canvas, strokes1Ref.current);
  };

  // ── Canvas 2 handlers (dual right)
  const handleDraw2Down = (e) => {
    if (e.pointerType === "touch") return;
    const canvas = drawCanvas2Ref.current;
    if (!canvas) return;
    e.preventDefault(); e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    lastSideRef.current = 2;
    if (drawTool === "stamp") {
      const pt = getCanvasPt(e, canvas);
      lastPt2Ref.current = pt;
      updateLoupe(e, canvas2Ref.current, canvas, stampSymbol, stampItalic, drawColor);
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
    drawStrokes(canvas, strokes2Ref.current, curStroke2Ref.current);
  };
  const handleDraw2Move = (e) => {
    if (e.pointerType === "touch") return;
    const canvas = drawCanvas2Ref.current;
    if (!canvas) return;
    e.preventDefault();
    if (drawTool === "stamp") {
      lastPt2Ref.current = getCanvasPt(e, canvas);
      updateLoupe(e, canvas2Ref.current, canvas, stampSymbol, stampItalic, drawColor);
      setLoupePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drawTool === "shape" && shapeStart2Ref.current) {
      const pt = getCanvasPt(e, canvas);
      curStroke2Ref.current = { tool: shapeTool, points: [shapeStart2Ref.current, pt], color: drawColor, width: drawWidth };
      drawStrokes(canvas, strokes2Ref.current, curStroke2Ref.current);
      return;
    }
    if (!isDrawing2Ref.current || !curStroke2Ref.current) return;
    curStroke2Ref.current.points.push(getCanvasPt(e, canvas));
    drawStrokes(canvas, strokes2Ref.current, curStroke2Ref.current);
  };
  const handleDraw2Up = async (e) => {
    if (drawTool === "stamp") {
      setLoupePos(null);
      const canvas = drawCanvas2Ref.current;
      if (!canvas) return;
      const pt = e ? getCanvasPt(e, canvas) : lastPt2Ref.current;
      const stamp = { tool:"stamp", symbol:stampSymbol, italic:stampItalic,
        color:drawColor, size:drawWidth * 3 + 8, points:[pt] };
      const next = [...strokes2Ref.current, stamp];
      strokes2Ref.current = next;
      drawStrokes(canvas, next);
      await saveDrawing(dualRightSongId, 1, next);
      return;
    }
    if (drawTool === "shape") {
      const shape = curStroke2Ref.current;
      curStroke2Ref.current = null;
      shapeStart2Ref.current = null;
      if (!shape || shape.points.length < 2) {
        const canvas = drawCanvas2Ref.current;
        if (canvas) drawStrokes(canvas, strokes2Ref.current);
        return;
      }
      const next = [...strokes2Ref.current, shape];
      strokes2Ref.current = next;
      await saveDrawing(dualRightSongId, 1, next);
      const canvas = drawCanvas2Ref.current;
      if (canvas) drawStrokes(canvas, next);
      return;
    }
    if (!isDrawing2Ref.current || !curStroke2Ref.current) return;
    isDrawing2Ref.current = false;
    const stroke = curStroke2Ref.current;
    curStroke2Ref.current = null;
    if (stroke.points.length > 0) {
      const next = [...strokes2Ref.current, stroke];
      strokes2Ref.current = next;
      await saveDrawing(dualRightSongId, 1, next);
    }
    const canvas = drawCanvas2Ref.current;
    if (canvas) drawStrokes(canvas, strokes2Ref.current);
  };
  const handleDraw2Cancel = () => {
    setLoupePos(null);
    shapeStart2Ref.current = null;
    isDrawing2Ref.current = false; curStroke2Ref.current = null;
    const canvas = drawCanvas2Ref.current;
    if (canvas) drawStrokes(canvas, strokes2Ref.current);
  };

  // ── Undo: acts on the last-drawn side
  const handleUndo = async () => {
    const side = lastSideRef.current;
    const sRef = side === 2 ? strokes2Ref : strokes1Ref;
    const dcRef = side === 2 ? drawCanvas2Ref : drawCanvas1Ref;
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    if (sRef.current.length === 0) return;
    const next = sRef.current.slice(0, -1);
    sRef.current = next;
    await saveDrawing(songId, dual ? 1 : pageNum, next);
    if (dcRef.current) drawStrokes(dcRef.current, next);
  };

  const handleClearPage = async () => {
    const side = lastSideRef.current;
    const sRef = side === 2 ? strokes2Ref : strokes1Ref;
    const dcRef = side === 2 ? drawCanvas2Ref : drawCanvas1Ref;
    const songId = side === 2 ? dualRightSongId : (dual ? dualLeftSongId : selectedSongId);
    sRef.current = [];
    await saveDrawing(songId, dual ? 1 : pageNum, []);
    if (dcRef.current) dcRef.current.getContext("2d").clearRect(0, 0, dcRef.current.width, dcRef.current.height);
  };

  const toolBtn = (name, active, onClick, ttl) => (
    <button onClick={onClick} title={ttl} style={{
      background: active ? `${C.acc}33` : "transparent",
      border:`1px solid ${active ? C.acc : C.bdr}`,
      borderRadius:8, padding:7, cursor:"pointer", display:"flex", alignItems:"center",
    }}>
      <Icon n={name} size={17} color={active ? C.acc : C.dim} />
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
              {svcSongs.length > 1 ? ` · 곡 ${songIdx + 1}/${svcSongs.length}` : ""}
            </div>
          </div>

          <div style={{ display:"flex", gap:4, alignItems:"center", flexShrink:0 }}>
            <button onClick={() => setZoomMul(z => Math.max(0.5, +(z - 0.15).toFixed(2)))}
              style={{ background:"none", border:"none", cursor:"pointer", padding:7, display:"flex", borderRadius:8 }}>
              <Icon n="zoomOut" size={18} color={C.dim} />
            </button>
            <button onClick={resetZoom}
              style={{
                background: zoomMul !== 1.0 ? `${C.acc}22` : "none",
                border: zoomMul !== 1.0 ? `1px solid ${C.acc}` : "1px solid transparent",
                borderRadius:6, cursor:"pointer", padding:"2px 6px",
                fontSize:11, color: zoomMul !== 1.0 ? C.acc : C.dim,
                fontWeight:700, fontFamily:"inherit", minWidth:36,
              }}>
              {Math.round(zoomMul * 100)}%
            </button>
            <button onClick={() => setZoomMul(z => Math.min(3.0, +(z + 0.15).toFixed(2)))}
              style={{ background:"none", border:"none", cursor:"pointer", padding:7, display:"flex", borderRadius:8 }}>
              <Icon n="zoomIn" size={18} color={C.dim} />
            </button>
            <div style={{ width:1, height:20, background:C.bdr, margin:"0 2px" }} />
            {toolBtn("pen",  drawMode,      () => { setDrawMode(p => !p); setDrawTool("pen"); }, "필기 모드")}
            {toolBtn("note", showNotePanel, () => setShowNotePanel(p => !p), "메모 목록")}
            <div style={{ width:1, height:20, background:C.bdr, margin:"0 2px" }} />
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
            </button>
            {isLeader(user.role) && (
              <button onClick={() => {
                setTransposeMode(p => !p);
                if (transposeMode) { setTransposeSteps(0); setChordData([]); setChordData2([]); setDetectErr(""); }
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
      </div>

      {/* 필기 서브툴바 */}
      {drawMode && (
        <div style={{ flexShrink:0, background:`${C.pur}0a`, borderBottom:`1px solid ${C.bdr}`, position:"relative" }}>
          {/* 메인 툴바 행 */}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"0 14px", height:56, overflowX:"auto" }}>
            {/* Tool selector */}
            {[
              { id:"pen",         icon:"pen",      label:"펜"    },
              { id:"highlighter", icon:"highlight", label:"마커"  },
              { id:"eraser",      icon:"eraser",    label:"지우개" },
              { id:"stamp",       icon:"stamp",     label:"스탬프" },
              { id:"shape",       icon:"slur",      label:"도형"  },
            ].map(t => (
              <button key={t.id} onClick={() => setDrawTool(t.id)} style={{
                display:"flex", flexDirection:"column", alignItems:"center", gap:2,
                padding:"5px 8px",
                background: drawTool === t.id ? `${C.pur}22` : "transparent",
                border:`1px solid ${drawTool === t.id ? C.pur : C.bdr}`,
                borderRadius:7, cursor:"pointer", flexShrink:0,
              }}>
                <Icon n={t.icon} size={15} color={drawTool === t.id ? C.pur : C.dim} />
                <span style={{ fontSize:9, fontWeight:600, color: drawTool === t.id ? C.pur : C.dim,
                  fontFamily:"inherit", lineHeight:1 }}>{t.label}</span>
              </button>
            ))}
            <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
            {/* Colors */}
            {(drawTool === "highlighter"
              ? ["#ffe034","#7dff6b","#5df4ff","#ff7de9","#ffac30"]
              : ["#e8383b","#1a73e8","#1c1c1e","#34c759","#e8a93e"]
            ).map(clr => (
              <button key={clr} onClick={() => setDrawColor(clr)}
                style={{
                  width:22, height:22, borderRadius:"50%", background:clr,
                  border: drawColor === clr && drawTool !== "eraser" ? "3px solid #fff" : "2px solid transparent",
                  outline: drawColor === clr && drawTool !== "eraser" ? `2px solid ${clr}` : "none",
                  cursor:"pointer", flexShrink:0, padding:0,
                  opacity: drawTool === "eraser" ? 0.35 : 1,
                }} />
            ))}
            <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
            {/* Width / size */}
            {[1, 2, 4].map(w => (
              <button key={w} onClick={() => setDrawWidth(w)}
                style={{
                  width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
                  background: drawWidth === w ? `${C.pur}22` : "transparent",
                  border:`1px solid ${drawWidth === w ? C.pur : C.bdr}`,
                  borderRadius:6, cursor:"pointer", flexShrink:0,
                }}>
                {(drawTool === "stamp" || drawTool === "shape") ? (
                  <span style={{ fontSize: w === 1 ? 9 : w === 2 ? 12 : 16, color:drawColor, fontWeight:700,
                    fontStyle: drawTool === "stamp" && stampItalic ? "italic" : "normal", lineHeight:1 }}>
                    {drawTool === "stamp" ? stampSymbol : w === 1 ? "S" : w === 2 ? "M" : "L"}
                  </span>
                ) : (
                  <div style={{
                    width: drawTool === "highlighter" ? w * 2 + 1 : w + 2,
                    height: drawTool === "highlighter" ? Math.max(6, w) : w + 2,
                    borderRadius: drawTool === "highlighter" ? 2 : "50%",
                    background: drawTool === "eraser" ? C.dim : drawColor,
                    opacity: drawTool === "eraser" ? 0.4 : 0.8,
                  }} />
                )}
              </button>
            ))}
            <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
            <button onClick={handleUndo} style={{
              background:"transparent", border:`1px solid ${C.bdr}`,
              borderRadius:7, padding:"5px 8px", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:2, flexShrink:0,
            }}>
              <Icon n="undo" size={15} color={C.dim} />
              <span style={{ fontSize:9, fontWeight:600, color:C.dim, fontFamily:"inherit", lineHeight:1 }}>취소</span>
            </button>
            <button onClick={handleClearPage} style={{
              background:"transparent", border:`1px solid ${C.bdr}`,
              borderRadius:7, padding:"5px 8px", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:2, flexShrink:0,
            }}>
              <Icon n="trash" size={15} color={C.dim} />
              <span style={{ fontSize:9, fontWeight:600, color:C.dim, fontFamily:"inherit", lineHeight:1 }}>지우기</span>
            </button>
            {drawSaveErr && (
              <span style={{ fontSize:10, color:C.red, marginLeft:4, flexShrink:0 }}>
                ⚠ {drawSaveErr}
              </span>
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
              {STAMP_GROUPS.map(group => (
                <div key={group.label} style={{ display:"flex", alignItems:"center", gap:3 }}>
                  <span style={{ fontSize:8, color:C.dim, fontWeight:700, width:26, textAlign:"right",
                    flexShrink:0, letterSpacing:"0.04em" }}>{group.label}</span>
                  {group.items.map(st => (
                    <button key={st.sym}
                      onClick={() => { setStampSymbol(st.sym); setStampItalic(st.italic); }}
                      style={{
                        width:28, height:24,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background: stampSymbol === st.sym ? `${C.acc}22` : "transparent",
                        border:`1px solid ${stampSymbol === st.sym ? C.acc : C.bdr}`,
                        borderRadius:5, cursor:"pointer", padding:0, flexShrink:0,
                      }}>
                      {st.sym === "staff" ? (
                        <svg width="20" height="12" viewBox="0 0 20 12" style={{ display:"block" }}>
                          {[0,1,2,3,4].map(i => (
                            <line key={i} x1="1" y1={1+i*2.5} x2="19" y2={1+i*2.5}
                              stroke={stampSymbol === "staff" ? C.acc : C.dim} strokeWidth="0.9" />
                          ))}
                        </svg>
                      ) : (
                        <span style={{
                          fontSize:11, fontWeight:700,
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
          {/* 반음 조절 */}
          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
            <button onClick={() => setTransposeSteps(s => Math.max(-6, s - 1))}
              style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.bdr}`,
                background:"transparent", cursor:"pointer", fontWeight:700, fontSize:15, display:"flex",
                alignItems:"center", justifyContent:"center", color:C.txt }}>−</button>
            <div style={{ textAlign:"center", minWidth:60 }}>
              <div style={{ fontSize:12, fontWeight:800, color: transposeSteps === 0 ? C.dim : C.grn }}>
                {transposeSteps === 0 ? "원본" : `${transposeSteps > 0 ? "+" : ""}${transposeSteps} 반음`}
              </div>
            </div>
            <button onClick={() => setTransposeSteps(s => Math.min(6, s + 1))}
              style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.bdr}`,
                background:"transparent", cursor:"pointer", fontWeight:700, fontSize:15, display:"flex",
                alignItems:"center", justifyContent:"center", color:C.txt }}>+</button>
          </div>
          <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
          {/* AI 감지 버튼 — 싱글: 하나, 듀얼: 왼쪽/오른쪽 */}
          {dual ? (
            <>
              <button onClick={() => detectChords(1)} disabled={detectingChords} style={{
                background: detectingChords ? `${C.grn}44` : C.grn,
                border:"none", borderRadius:7, padding:"5px 10px",
                cursor: detectingChords ? "not-allowed" : "pointer",
                fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
              }}>
                {detectingChords ? "⏳" : "🎵"} 왼쪽
              </button>
              {chordData.length > 0 && (
                <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓{chordData.length}</span>
              )}
              <button onClick={() => detectChords(2)} disabled={detectingChords} style={{
                background: detectingChords ? `${C.grn}44` : C.grn,
                border:"none", borderRadius:7, padding:"5px 10px",
                cursor: detectingChords ? "not-allowed" : "pointer",
                fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
              }}>
                {detectingChords ? "⏳" : "🎵"} 오른쪽
              </button>
              {chordData2.length > 0 && (
                <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>✓{chordData2.length}</span>
              )}
            </>
          ) : (
            <>
              <button onClick={() => detectChords(1)} disabled={detectingChords} style={{
                background: detectingChords ? `${C.grn}44` : C.grn,
                border:"none", borderRadius:7, padding:"5px 12px",
                cursor: detectingChords ? "not-allowed" : "pointer",
                fontWeight:700, fontSize:11, color:"#fff", fontFamily:"inherit", flexShrink:0,
              }}>
                {detectingChords ? "⏳ 감지 중..." : "🎵 코드 감지 (AI)"}
              </button>
              {chordData.length > 0 && (
                <span style={{ fontSize:11, color:C.grn, fontWeight:700, flexShrink:0 }}>
                  ✓ {chordData.length}개 감지됨
                </span>
              )}
            </>
          )}
          {detectErr && (
            <span style={{ fontSize:11, color:C.red, flexShrink:0 }}>⚠ {detectErr}</span>
          )}
          <div style={{ marginLeft:"auto", flexShrink:0 }}>
            <button onClick={() => { setTransposeSteps(0); setChordData([]); setChordData2([]); setDetectErr(""); }}
              style={{ background:"transparent", border:`1px solid ${C.bdr}`, borderRadius:6,
                padding:"4px 10px", cursor:"pointer", fontSize:11, color:C.dim, fontFamily:"inherit" }}>
              초기화
            </button>
          </div>
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

      {/* D-패드 (줌인 시에만 표시) */}
      {zoomMul > 1.0 && (
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
          position:"relative", background:C.bg, touchAction:"none" }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}>

          {dual ? (
            // ── 듀얼 모드: 두 곡 나란히 (정확히 50/50)
            <>
              {/* 왼쪽 곡 */}
              <div style={{ width:"50%", height:"100%", display:"flex",
                alignItems:"center", justifyContent:"center",
                borderRight:`1px solid ${C.bdr}`, overflow:"hidden", padding:8 }}>
                {svcSongs[dualIdx]?.pdfUrl
                  ? <div style={{ position:"relative", display:"inline-block", lineHeight:0 }}>
                      <canvas ref={canvas1Ref} style={{ display:"block",
                        borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
                      <canvas ref={drawCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4, touchAction:"none",
                        cursor: drawMode ? (drawTool === "eraser" ? "cell" : "crosshair") : "default",
                        pointerEvents: drawMode ? "auto" : "none",
                      }}
                        onPointerDown={handleDraw1Down}
                        onPointerMove={handleDraw1Move}
                        onPointerUp={handleDraw1Up}
                        onPointerCancel={handleDraw1Cancel}
                      />
                      {transposeMode && chordData.length > 0 && (() => {
                        const cw = canvas1Ref.current?.offsetWidth || 400;
                        const fs = Math.max(8, Math.min(14, cw / 50));
                        return (
                          <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
                            {chordData.map((item, i) => (
                              <span key={i} style={{
                                position:"absolute",
                                left:`${item.x * 100}%`, top:`${item.y * 100}%`,
                                transform:"translate(-50%,-50%)",
                                background: transposeSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                color: transposeSteps === 0 ? "#fff" : "#111",
                                borderRadius:3, padding:"1px 4px",
                                fontSize:fs, fontWeight:800, lineHeight:1.5,
                                whiteSpace:"nowrap", fontFamily:"monospace",
                                boxShadow:"0 1px 4px rgba(0,0,0,.3)",
                              }}>{transposeChord(item.chord, transposeSteps)}</span>
                            ))}
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
                alignItems:"center", justifyContent:"center",
                overflow:"hidden", padding:8 }}>
                {svcSongs[dualIdx + 1]
                  ? svcSongs[dualIdx + 1].pdfUrl
                    ? <div style={{ position:"relative", display:"inline-block", lineHeight:0 }}>
                        <canvas ref={canvas2Ref} style={{ display:"block",
                          borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
                        <canvas ref={drawCanvas2Ref} style={{
                          position:"absolute", top:0, left:0, width:"100%", height:"100%",
                          borderRadius:4, touchAction:"none",
                          cursor: drawMode ? (drawTool === "eraser" ? "cell" : "crosshair") : "default",
                          pointerEvents: drawMode ? "auto" : "none",
                        }}
                          onPointerDown={handleDraw2Down}
                          onPointerMove={handleDraw2Move}
                          onPointerUp={handleDraw2Up}
                          onPointerCancel={handleDraw2Cancel}
                        />
                        {transposeMode && chordData2.length > 0 && (() => {
                          const cw = canvas2Ref.current?.offsetWidth || 400;
                          const fs = Math.max(8, Math.min(14, cw / 50));
                          return (
                            <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
                              {chordData2.map((item, i) => (
                                <span key={i} style={{
                                  position:"absolute",
                                  left:`${item.x * 100}%`, top:`${item.y * 100}%`,
                                  transform:"translate(-50%,-50%)",
                                  background: transposeSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                  color: transposeSteps === 0 ? "#fff" : "#111",
                                  borderRadius:3, padding:"1px 4px",
                                  fontSize:fs, fontWeight:800, lineHeight:1.5,
                                  whiteSpace:"nowrap", fontFamily:"monospace",
                                  boxShadow:"0 1px 4px rgba(0,0,0,.3)",
                                }}>{transposeChord(item.chord, transposeSteps)}</span>
                              ))}
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
              {/* 곡 제목 레이블 */}
              <div style={{ position:"absolute", bottom:10, left:0, width:"50%",
                display:"flex", justifyContent:"center", pointerEvents:"none" }}>
                <div style={{ background:"rgba(0,0,0,.6)", color:"#fff",
                  padding:"4px 14px", borderRadius:20, fontSize:11, fontWeight:700,
                  maxWidth:"80%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {svcSongs[dualIdx]?.title}
                </div>
              </div>
              {svcSongs[dualIdx + 1] && (
                <div style={{ position:"absolute", bottom:10, right:0, width:"50%",
                  display:"flex", justifyContent:"center", pointerEvents:"none" }}>
                  <div style={{ background:"rgba(0,0,0,.6)", color:"#fff",
                    padding:"4px 14px", borderRadius:20, fontSize:11, fontWeight:700,
                    maxWidth:"80%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {svcSongs[dualIdx + 1].title}
                  </div>
                </div>
              )}
            </>
          ) : (
            // ── 싱글 모드 (panOffset transform으로 D-패드 이동)
            <div style={{ width:"100%", height:"100%", display:"flex",
              alignItems:"center", justifyContent:"center", padding:8,
              transform: panOffset.x !== 0 || panOffset.y !== 0
                ? `translate(${panOffset.x}px,${panOffset.y}px)` : undefined,
              willChange: panOffset.x !== 0 || panOffset.y !== 0 ? "transform" : undefined,
            }}>
              {song.pdfUrl ? (
                loadErr
                  ? <div style={{ color:C.red, fontSize:13 }}>{loadErr}</div>
                  : <div style={{ position:"relative", display:"inline-block", lineHeight:0, flexShrink:0 }}>
                      <canvas ref={canvas1Ref} style={{ display:"block",
                        borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
                      <canvas ref={drawCanvas1Ref} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4,
                        cursor: drawMode ? (drawTool === "eraser" ? "cell" : "crosshair") : "default",
                        touchAction:"none",
                        pointerEvents: drawMode ? "auto" : "none",
                      }}
                        onPointerDown={handleDraw1Down}
                        onPointerMove={handleDraw1Move}
                        onPointerUp={handleDraw1Up}
                        onPointerCancel={handleDraw1Cancel}
                      />
                      {/* 전조 코드 오버레이 */}
                      {transposeMode && chordData.length > 0 && (() => {
                        const cw = canvas1Ref.current?.offsetWidth || 600;
                        const fs = Math.max(10, Math.min(16, cw / 50));
                        return (
                          <div style={{ position:"absolute", inset:0, pointerEvents:"none", borderRadius:4 }}>
                            {chordData.map((item, i) => (
                              <span key={i} style={{
                                position:"absolute",
                                left:`${item.x * 100}%`,
                                top:`${item.y * 100}%`,
                                transform:"translate(-50%, -50%)",
                                background: transposeSteps === 0 ? "rgba(107,93,231,0.88)" : "rgba(255,220,20,0.95)",
                                color: transposeSteps === 0 ? "#fff" : "#111",
                                borderRadius:3,
                                padding:"1px 5px",
                                fontSize:fs,
                                fontWeight:800,
                                lineHeight:1.5,
                                whiteSpace:"nowrap",
                                fontFamily:"monospace",
                                boxShadow:"0 1px 4px rgba(0,0,0,.3)",
                              }}>
                                {transposeChord(item.chord, transposeSteps)}
                              </span>
                            ))}
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
                  <div style={{ fontSize:13 }}>PDF 악보가 없습니다</div>
                </div>
              )}
            </div>
          )}

          {/* 토스트 메시지 (싱글/듀얼 공통) */}
          {dualToast && (
            <div style={{ position:"absolute", top:"50%", left:"50%",
              transform:"translate(-50%,-50%)",
              background:"rgba(0,0,0,.78)", color:"#fff",
              padding:"14px 30px", borderRadius:14, fontSize:15,
              fontWeight:700, zIndex:50, pointerEvents:"none", textAlign:"center",
              boxShadow:"0 4px 20px rgba(0,0,0,.3)" }}>
              {dualToast}
            </div>
          )}
        </div>

        {/* AI 패널 (MEDIA 모드, 듀얼 아닐 때만) */}
        {media && !dual && (
          <div style={{ width:320, flexShrink:0, overflow:"hidden",
            borderLeft:`1px solid ${C.bdr}`, background:C.surf }}>
            <AIPanel song={song} user={user} />
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
                  {leader && <button onClick={() => deleteNote(n.id)}
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   NOTIFICATIONS SCREEN
══════════════════════════════════════════════════════════════════ */
function NotificationsScreen({ notifs, markNotifRead, markAllNotifRead }) {
  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <div style={{ background:C.surf, padding:"18px 16px",
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>알림</div>
        <button onClick={markAllNotifRead}
          style={{ background:"none", border:"none", color:C.acc, fontSize:13,
            cursor:"pointer", fontWeight:600, fontFamily:"inherit" }}>
          모두 읽음
        </button>
      </div>
      <div style={{ padding:16, paddingBottom:90 }}>
        {notifs.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🔔</div>새로운 알림이 없습니다
          </div>
        )}
        {notifs.map(n => (
          <div key={n.id} className="wFadeIn"
            onClick={() => markNotifRead(n.id)}
            style={{
              background: n.read ? C.card : `${C.pur}18`,
              border:`1px solid ${n.read ? C.bdr : `${C.pur}44`}`,
              borderRadius:12, padding:"14px 16px", marginBottom:8, cursor:"pointer",
              display:"flex", alignItems:"flex-start", gap:10,
            }}>
            <div style={{
              width:38, height:38, borderRadius:10, flexShrink:0,
              background: n.read ? C.surf : `${C.pur}33`,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <Icon n="bell" size={17} color={n.read ? C.dim : C.pur} />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:3 }}>{n.title}</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.5 }}>{n.body}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:5 }}>{n.time}</div>
            </div>
            {!n.read && (
              <div style={{ width:8, height:8, borderRadius:"50%",
                background:C.pur, flexShrink:0, marginTop:6 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TEAM MANAGEMENT MODAL
══════════════════════════════════════════════════════════════════ */
function TeamManagementModal({ currentUserId, onClose }) {
  const [members,       setMembers]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(null);
  const [editPart,      setEditPart]      = useState(null);
  const [partVal,       setPartVal]       = useState("");
  const [allowedEmails, setAllowedEmails] = useState([]); // [{email, role, part}]
  const [emailInput,    setEmailInput]    = useState("");
  const [newRole,       setNewRole]       = useState("member");
  const [newPart,       setNewPart]       = useState("");
  const [addingEmail,   setAddingEmail]   = useState(false);
  const [emailErr,      setEmailErr]      = useState("");

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
    return unsub;
  }, []);

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
    await updateDoc(doc(db, "users", uid), { part: partVal });
    setMembers(p => p.map(u => u.id === uid ? { ...u, part: partVal } : u));
    setEditPart(null);
  };

  const ROLES = [["member","멤버"], ["leader","리더"], ["admin","어드민"]];
  const roleColor = (r) => r === "admin" ? C.red : r === "leader" ? C.acc : C.grn;

  return (
    <Modal title={`팀원 관리 · ${members.length}명`} onClose={onClose}>
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
                  label={m.role === "admin" ? "어드민" : m.role === "leader" ? "리더" : "멤버"}
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
    <div style={{ minHeight:"100vh", background:C.bg, padding:20, paddingBottom:90,
      paddingTop:"calc(20px + env(safe-area-inset-top))" }}>
      <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em", marginBottom:20 }}>내 정보</div>

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

      <div style={{ background:C.card, borderRadius:12, overflow:"hidden",
        border:`1px solid ${C.bdr}`, marginBottom:16 }}>
        {[
          { label:"앱 정보 (v3.13)", action: () => setShowInfo(true) },
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

      {/* 앱 정보 */}
      {showInfo && (
        <Modal title="앱 정보" onClose={() => setShowInfo(false)}>
          <div style={{ textAlign:"center", padding:"8px 0 16px" }}>
            <img src="/icon-192.png" width={64} height={64}
              style={{ borderRadius:16, marginBottom:12 }} alt="Ainos" />
            <div style={{ fontWeight:800, fontSize:18, marginBottom:4 }}>TVPC Worship</div>
            <div style={{ fontSize:13, color:C.dim, marginBottom:16 }}>버전 3.13</div>
            <div style={{ fontSize:12, color:C.dim, lineHeight:1.8, textAlign:"left" }}>
              찬양팀 악보 관리 및 예배 준비를 위한 앱입니다.<br />
              악보 업로드, 필기, 코드 전조, 예배 일정 관리 등<br />
              찬양팀에 필요한 기능을 제공합니다.
            </div>
          </div>
          <Btn label="확인" full onClick={() => setShowInfo(false)} />
        </Modal>
      )}

      {/* 도움말 */}
      {showHelp && (
        <Modal title="도움말" onClose={() => setShowHelp(false)}>
          <div style={{ fontSize:13, lineHeight:1.9, color:C.txt }}>

            {/* 팀 공유 섹션 */}
            <div style={{ fontSize:11, fontWeight:800, color:C.acc, letterSpacing:"0.05em",
              marginBottom:8, textTransform:"uppercase" }}>👥 팀 전체 공유</div>
            {[
              { title:"📋 예배 일정", desc:"예배탭에서 일정을 만들고 곡을 추가하세요. 리더는 순서 변경·복사·삭제가 가능하고, 카카오톡으로 일정을 공유할 수 있습니다. 모든 팀원이 동일하게 봅니다." },
              { title:"🎵 악보 라이브러리", desc:"PDF 악보는 팀 전체가 공유합니다. 리더가 업로드·편집·삭제할 수 있고, 모든 팀원이 열람할 수 있습니다." },
              { title:"🔔 알림", desc:"리더가 예배 일정을 등록하면 팀 전체에게 알림이 갑니다. 알림탭에서 확인하세요." },
            ].map((s, i) => (
              <div key={i} style={{ marginBottom:12, paddingBottom:12, borderBottom:`1px solid ${C.bdr}` }}>
                <div style={{ fontWeight:700, marginBottom:3 }}>{s.title}</div>
                <div style={{ color:C.dim, fontSize:12 }}>{s.desc}</div>
              </div>
            ))}

            {/* 쓰기 툴 섹션 */}
            <div style={{ fontSize:11, fontWeight:800, color:"#4ade80", letterSpacing:"0.05em",
              margin:"16px 0 8px", textTransform:"uppercase" }}>✍️ 악보 쓰기 툴</div>
            {[
              { title:"펜 / 마커", desc:"펜은 가는 선으로 정밀하게 필기합니다. 마커는 반투명 형광펜으로 악보 구간을 강조할 때 유용합니다." },
              { title:"지우개", desc:"그린 획을 지웁니다. 지우개 크기는 하단 슬라이더로 조절하세요." },
              { title:"스탬프", desc:"악상기호(pp·f·sfz), 음표, 임시표, 아티큘레이션 등을 악보 위에 찍습니다. 돋보기(루페)로 정확한 위치를 확인하며 배치할 수 있습니다." },
              { title:"도형", desc:"슬러, 크레셴도/디크레셴도(헤어핀), 직선, 박스, 원형을 그릴 수 있습니다. 시작점을 터치한 뒤 끝점까지 드래그하세요." },
              { title:"줌 & D-패드", desc:"악보를 줌인하면 화면 오른쪽에 방향 D-패드가 나타납니다. 화살표로 악보를 상하좌우로 이동하고, 가운데 % 버튼으로 원래 크기로 돌아옵니다." },
            ].map((s, i, arr) => (
              <div key={i} style={{ marginBottom:12, paddingBottom:12,
                borderBottom: i < arr.length - 1 ? `1px solid ${C.bdr}` : `1px solid ${C.bdr}` }}>
                <div style={{ fontWeight:700, marginBottom:3 }}>{s.title}</div>
                <div style={{ color:C.dim, fontSize:12 }}>{s.desc}</div>
              </div>
            ))}

            {/* 개인 전용 섹션 */}
            <div style={{ fontSize:11, fontWeight:800, color:C.pur, letterSpacing:"0.05em",
              margin:"16px 0 8px", textTransform:"uppercase" }}>🔒 나만 보는 개인 데이터</div>
            {[
              { title:"✏️ 필기", desc:"악보에 그린 필기는 나만 볼 수 있습니다. 다른 팀원 화면에는 표시되지 않으며, 내 계정으로 로그인하면 어느 기기에서나 불러옵니다." },
              { title:"📝 메모", desc:"악보 화면의 메모 기능도 개인 전용입니다. 내가 추가한 메모는 나만 확인할 수 있습니다." },
              { title:"🎼 코드 전조", desc:"리더만 사용 가능합니다. 감지된 코드와 전조 설정은 내 계정에만 저장되며 다른 팀원에게는 보이지 않습니다." },
              { title:"📖 듀얼 모드", desc:"악보 두 개를 나란히 보는 개인 뷰입니다. 악보 화면 상단의 듀얼 아이콘을 눌러 사용하세요." },
            ].map((s, i, arr) => (
              <div key={i} style={{ marginBottom:12, paddingBottom:12,
                borderBottom: i < arr.length - 1 ? `1px solid ${C.bdr}` : "none" }}>
                <div style={{ fontWeight:700, marginBottom:3 }}>{s.title}</div>
                <div style={{ color:C.dim, fontSize:12 }}>{s.desc}</div>
              </div>
            ))}
          </div>
          <Btn label="확인" full onClick={() => setShowHelp(false)} />
        </Modal>
      )}

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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   BOTTOM NAV
══════════════════════════════════════════════════════════════════ */
function BottomNav({ view, nav, unread }) {
  const tabs = [
    { id:"services",      icon:"home",  label:"예배"   },
    { id:"library",       icon:"music", label:"악보"   },
    { id:"notifications", icon:"bell",  label:"알림"   },
    { id:"profile",       icon:"user",  label:"프로필" },
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
              <Icon n={t.icon} size={22} color={active ? C.acc : C.dim} />
              {t.id === "notifications" && unread > 0 && (
                <span style={{
                  position:"absolute", top:-2, right:-4, width:8, height:8,
                  background:C.red, borderRadius:"50%", border:`2px solid ${C.surf}`,
                }} />
              )}
            </div>
            <span style={{ fontSize:10, fontWeight: active ? 700 : 400,
              color: active ? C.acc : C.dim, letterSpacing:"0.01em" }}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [user,        setUser]        = useState(undefined); // undefined = loading
  const [loginErr,    setLoginErr]    = useState("");
  const [view,        setView]        = useState("services");
  const [songs,       setSongs]       = useState([]);
  const [services,    setServices]    = useState([]);
  const [notifs,      setNotifs]      = useState([]);
  const [annotations,     setAnnotations]     = useState({}); // 개인 메모
  const [teamAnnotations, setTeamAnnotations] = useState({}); // 팀 공유 메모
  const [selSvcId,    setSelSvcId]    = useState(null);
  const [selSongId,   setSelSongId]   = useState(null);
  const [backTo,      setBackTo]      = useState("library");
  const [pdfjsReady,  setPdfjsReady]  = useState(false);

  // ── Kakao SDK 초기화
  useEffect(() => {
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init(KAKAO_JS_KEY);
    }
  }, []);

  // ── 실제 뷰포트 높이 CSS 변수 고정 (Android 브라우저 URL바 대응)
  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
    };
    setVh();
    window.addEventListener("resize", setVh);
    return () => window.removeEventListener("resize", setVh);
  }, []);

  // ── Apple Pencil 호버 커서
  const [pencilCursor, setPencilCursor] = useState(null);
  const pencilHideTimer = useRef(null);
  useEffect(() => {
    const show = (x, y) => {
      setPencilCursor({ x, y });
      clearTimeout(pencilHideTimer.current);
      pencilHideTimer.current = setTimeout(() => setPencilCursor(null), 500);
    };
    const onMove  = (e) => { if (e.pointerType === "pen") show(e.clientX, e.clientY); };
    const onDown  = (e) => { if (e.pointerType === "pen") { clearTimeout(pencilHideTimer.current); setPencilCursor(null); } };
    window.addEventListener("pointermove",  onMove);
    window.addEventListener("pointerdown",  onDown);
    window.addEventListener("pointerleave", onDown);
    return () => {
      window.removeEventListener("pointermove",  onMove);
      window.removeEventListener("pointerdown",  onDown);
      window.removeEventListener("pointerleave", onDown);
      clearTimeout(pencilHideTimer.current);
    };
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
                await signOut(auth);
                setLoginErr("등록되지 않은 이메일입니다. 관리자에게 문의하세요.");
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

  // ── Firestore: notifications (per user, real-time)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "notifications"), orderBy("createdAt", "desc")),
      snap => setNotifs(snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          read: (data.readBy || []).includes(user.uid),
          time: fmtTime(data.createdAt),
        };
      }))
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

  if (!user) return <LoginScreen loginErr={loginErr} onClearErr={() => setLoginErr("")} />;

  const nav = (newView, params = {}) => {
    if (params.svcId  !== undefined) setSelSvcId(params.svcId);
    if (params.songId !== undefined) setSelSongId(params.songId);
    if (params.backTo !== undefined) setBackTo(params.backTo);
    setView(newView);
  };

  const unread = notifs.filter(n => !n.read).length;

  const shared = {
    user, songs, services, notifs, annotations, teamAnnotations,
    addSong, createService, updateService,
    onAddAnnotation: addAnnotation,
    onDeleteAnnotation: deleteAnnotation,
    markNotifRead, markAllNotifRead,
    nav,
  };

  return (
    <div style={{ width:"100%", minHeight:"100vh", background:C.bg, position:"relative" }}>
      {pencilCursor && (
        <div style={{
          position:"fixed", pointerEvents:"none", zIndex:9999,
          left: pencilCursor.x - 10, top: pencilCursor.y - 10,
          width:20, height:20, borderRadius:"50%",
          border:"2px solid rgba(108,93,231,0.8)",
          background:"rgba(108,93,231,0.12)",
        }} />
      )}
      {view === "services"      && <ServicesScreen      {...shared} />}
      {view === "svcDetail"     && <ServiceDetailScreen {...shared} selectedSvcId={selSvcId} onUpdateService={updateService} />}
      {view === "library"       && <SongLibraryScreen   {...shared} />}
      {view === "pdfViewer"     && (
        <PDFViewerScreen {...shared} selectedSongId={selSongId}
          selectedSvcId={selSvcId} backTo={backTo} pdfjsReady={pdfjsReady} />
      )}
      {view === "notifications" && (
        <NotificationsScreen
          notifs={notifs}
          markNotifRead={markNotifRead}
          markAllNotifRead={markAllNotifRead}
        />
      )}
      {view === "profile" && (
        <ProfileScreen user={user} onLogout={() => signOut(auth)}
          onRoleUpdate={() => setUser(u => ({ ...u, role: "leader" }))} />
      )}

      {view !== "pdfViewer" && (
        <BottomNav view={view} nav={nav} unread={unread} />
      )}
    </div>
  );
}
