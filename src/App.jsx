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
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  tag:     "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  eraser:  "M20 20H7L3 16 13 6l8 8-2.5 2.5M9 15l2 2",
  undo:    "M3 10h13a4 4 0 0 1 0 8H9M3 10l4-4M3 10l4 4",
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

/* ── Canvas drawing utility (module-level, pure) */
function drawStrokes(canvas, strokes, cur = null) {
  if (!canvas || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const all = cur ? [...strokes, cur] : strokes;
  for (const s of all) {
    if (!s.points || s.points.length < 1) continue;
    ctx.save();
    const lw = Math.max(1, s.width * canvas.width / 600);
    ctx.lineWidth = lw;
    ctx.lineCap   = "round";
    ctx.lineJoin  = "round";
    if (s.eraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle   = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = s.color;
      ctx.fillStyle   = s.color;
    }
    const pts = s.points.map(p => [p.x * canvas.width, p.y * canvas.height]);
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.arc(pts[0][0], pts[0][1], lw / 2, 0, Math.PI * 2);
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
function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.45)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:900, backdropFilter:"blur(4px)",
      padding:"16px 16px calc(16px + env(safe-area-inset-bottom)) 16px",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
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
   CREATE SERVICE MODAL
══════════════════════════════════════════════════════════════════ */
function CreateServiceModal({ songs, onClose, onCreate }) {
  const [title,    setTitle]    = useState("");
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
      <Input label="예배 제목" value={title} onChange={setTitle}
        placeholder="예) 주일 1부 예배" autoFocus />
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
   ADD SONG MODAL
══════════════════════════════════════════════════════════════════ */
function AddSongModal({ onClose, onAdd }) {
  const [title,    setTitle]   = useState("");
  const [artist,   setArtist]  = useState("");
  const [key,      setKey]     = useState("C");
  const [bpm,      setBpm]     = useState("80");
  const [pdfFile,   setPdfFile]   = useState(null);
  const [saving,    setSaving]    = useState(false);
  const fileRef = useRef(null);
  const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  const handleAdd = async () => {
    if (!title) return;
    setSaving(true);
    try {
      const docRef = await onAdd({ title, artist, key, bpm: Number(bpm) || 80 });
      if (pdfFile && docRef?.id) {
        const url = await uploadPdf(pdfFile, docRef.id);
        await updateDoc(doc(db, "songs", docRef.id), { pdfUrl: url });
      }
      onClose();
    } catch(e) {
      console.error(e);
      alert("오류: " + e.message);
      setSaving(false);
    }
  };

  return (
    <Modal title="새 곡 추가" onClose={onClose}>
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

      {/* PDF 업로드 */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:8 }}>악보 PDF (선택)</div>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf"
          style={{ display:"none" }}
          onChange={e => { setPdfFile(e.target.files[0] || null); e.target.value = ""; }} />
        {pdfFile ? (
          <div style={{
            display:"flex", alignItems:"center", gap:10, padding:"12px 14px",
            background:`${C.grn}12`, border:`1.5px solid ${C.grn}55`, borderRadius:10,
          }}>
            <span style={{ fontSize:20 }}>📄</span>
            <span style={{ fontSize:13, color:C.grn, fontWeight:600, flex:1,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {pdfFile.name}
            </span>
            <button onClick={() => setPdfFile(null)}
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

      {saving && (
        <div style={{ fontSize:12, color:C.dim, marginBottom:12, textAlign:"center" }}>
          {pdfFile ? "📤 업로드 중..." : "저장 중..."}
        </div>
      )}

      <Btn label={saving ? "추가 중..." : "추가하기"}
        icon="plus" onClick={handleAdd} full disabled={saving || !title} />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SERVICES SCREEN
══════════════════════════════════════════════════════════════════ */
function ServicesScreen({ user, services, songs, notifs, createService, nav }) {
  const [showCreate, setShowCreate] = useState(false);
  const unread = notifs.filter(n => !n.read).length;

  const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("ko-KR",
    { month:"long", day:"numeric", weekday:"short" });

  const upcoming = services.filter(s => s.date >= new Date().toISOString().slice(0,10));
  const past     = services.filter(s => s.date <  new Date().toISOString().slice(0,10));

  const SvcCard = ({ svc }) => {
    const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
    return (
      <div className="wFadeIn"
        onClick={() => nav("svcDetail", { svcId: svc.id })}
        style={{
          background:C.surf, borderRadius:14, padding:"16px",
          marginBottom:10, border:`1px solid ${C.bdr}`, cursor:"pointer",
          boxShadow:"0 1px 4px rgba(0,0,0,.06)",
        }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:16 }}>{svc.title}</div>
            <div style={{ color:C.dim, fontSize:13, marginTop:3 }}>
              📅 {fmtDate(svc.date)}{svc.time ? ` · ${svc.time}` : ""}
            </div>
          </div>
          <Badge label={svc.notified ? "알림완료" : "대기중"}
            color={svc.notified ? C.grn : C.dim} />
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
          <button onClick={() => nav("notifications")} style={{
            background:C.card, border:`1px solid ${C.bdr}`,
            borderRadius:10, padding:8, position:"relative",
            cursor:"pointer", display:"flex",
          }}>
            <Icon n="bell" size={18} color={unread > 0 ? C.acc : C.dim} />
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
        {/* 리더: 예배 만들기 큰 버튼 */}
        {isLeader(user.role) && (
          <button onClick={() => setShowCreate(true)} style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
            gap:10, padding:"14px 0", borderRadius:14, marginBottom:20,
            background:`linear-gradient(135deg, ${C.acc}, #d4922a)`,
            border:"none", cursor:"pointer", fontFamily:"inherit",
            fontWeight:700, fontSize:15, color:"#fff",
            boxShadow:`0 4px 16px ${C.acc}44`,
          }}>
            <Icon n="plus" size={18} color="#fff" />
            새 예배 일정 만들기
          </button>
        )}

        {/* 다가오는 예배 */}
        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", marginBottom:10 }}>다가오는 예배</div>
            {upcoming.map(svc => <SvcCard key={svc.id} svc={svc} />)}
          </>
        )}

        {/* 지난 예배 */}
        {past.length > 0 && (
          <>
            <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
              textTransform:"uppercase", margin:"16px 0 10px" }}>지난 예배</div>
            {past.map(svc => <SvcCard key={svc.id} svc={svc} />)}
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

function ServiceDetailScreen({ user, services, songs, annotations, nav, selectedSvcId }) {
  const svc = services.find(s => s.id === selectedSvcId);
  const [showPicker, setShowPicker] = useState(false);

  if (!svc) return null;

  const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);

  const sendNotif = async () => {
    await updateDoc(doc(db, "services", svc.id), { notified: true });
    await addDoc(collection(db, "notifications"), {
      title: `${svc.title} 악보 등록`,
      body: `${svc.date} ${svc.title} 악보가 등록되었습니다. 연습 준비해주세요!`,
      createdAt: serverTimestamp(),
      readBy: [],
      serviceId: svc.id,
    });
  };

  const removeSong = async (id) => {
    const newIds = (svc.songIds || []).filter(x => x !== id);
    await updateDoc(doc(db, "services", svc.id), { songIds: newIds });
  };

  const saveSongs = async (ids) => {
    await updateDoc(doc(db, "services", svc.id), { songIds: ids });
    setShowPicker(false);
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
        {svc.notified
          ? <Badge label="알림완료" color={C.grn} />
          : isLeader(user.role) && (
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
        {/* 리더: 곡 추가 버튼 */}
        {isLeader(user.role) && (
          <button onClick={() => setShowPicker(true)} style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
            gap:8, padding:"12px 0", borderRadius:12, marginBottom:16,
            background:"transparent", border:`2px dashed ${C.acc}`,
            cursor:"pointer", fontFamily:"inherit",
            fontWeight:600, fontSize:14, color:C.acc,
          }}>
            <Icon n="plus" size={16} color={C.acc} />
            라이브러리에서 곡 추가
          </button>
        )}

        {/* 곡 목록 */}
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:10 }}>
          예배 곡 순서 · {svcSongs.length}곡
        </div>

        {svcSongs.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 0", color:C.dim }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🎵</div>
            <div style={{ fontWeight:600, marginBottom:4 }}>곡이 없습니다</div>
            <div style={{ fontSize:13 }}>위 버튼으로 라이브러리에서 곡을 추가하세요</div>
          </div>
        )}

        {svcSongs.map((song, idx) => {
          const hasNotes = (annotations[song.id] || []).length > 0;
          return (
            <div key={song.id} className="wFadeIn" style={{
              background:C.surf, borderRadius:14, padding:"14px 16px",
              marginBottom:8, border:`1px solid ${C.bdr}`,
              display:"flex", alignItems:"center", gap:12,
              boxShadow:"0 1px 4px rgba(0,0,0,.05)",
            }}>
              {/* 순서 번호 */}
              <div style={{
                width:34, height:34, borderRadius:10, flexShrink:0,
                background:`linear-gradient(135deg, ${C.acc}33, ${C.pur}22)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontWeight:800, fontSize:15, color:C.acc,
              }}>{idx + 1}</div>

              {/* 곡 정보 */}
              <div style={{ flex:1, minWidth:0, cursor:"pointer" }}
                onClick={() => nav("pdfViewer", { songId: song.id, backTo: "svcDetail" })}>
                <div style={{ fontWeight:700, fontSize:15, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{song.title}</div>
                <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>
                  {song.artist}{song.bpm ? ` · ♩${song.bpm}` : ""}
                </div>
                <div style={{ display:"flex", gap:5, marginTop:5 }}>
                  <KeyBadge k={song.key} />
                  {song.pdfUrl && <Badge label="PDF" color={C.grn} />}
                  {hasNotes    && <Badge label="✏ 메모" color={C.pur} />}
                </div>
              </div>

              {/* 삭제 버튼 (리더만) */}
              {isLeader(user.role) && (
                <button onClick={() => removeSong(song.id)} style={{
                  background:"none", border:"none", cursor:"pointer",
                  padding:6, display:"flex", flexShrink:0,
                }}>
                  <Icon n="xmark" size={18} color={C.dim} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showPicker && (
        <SongPickerModal
          songs={songs}
          currentIds={svc.songIds || []}
          onClose={() => setShowPicker(false)}
          onSave={saveSongs}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SONG LIBRARY SCREEN
══════════════════════════════════════════════════════════════════ */
function SongLibraryScreen({ user, songs, addSong, nav }) {
  const [query,       setQuery]       = useState("");
  const [showAdd,     setShowAdd]     = useState(false);
  const [uploading,  setUploading]  = useState(null); // songId
  const [confirmDel, setConfirmDel] = useState(null); // songId

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(query.toLowerCase())
  );

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

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <div style={{ background:C.surf, padding:"18px 16px 14px",
        paddingTop:"calc(18px + env(safe-area-inset-top))",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>악보 라이브러리</div>
          {isLeader(user.role) && (
            <Btn label="곡 추가" icon="plus" sm onClick={() => setShowAdd(true)} />
          )}
        </div>
        <div style={{ position:"relative" }}>
          <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}>
            <Icon n="search" size={16} color={C.dim} />
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="곡명, 아티스트 검색..."
            style={{
              width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
              color:C.txt, padding:"9px 14px 9px 38px", borderRadius:10,
              fontSize:14, outline:"none", fontFamily:"inherit",
            }} />
        </div>
      </div>

      <div style={{ padding:16, paddingBottom:90, overflowY:"auto", maxHeight:"calc(100vh - 130px)" }}>
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🎵</div>
            <div>{query ? "검색 결과가 없습니다" : "등록된 곡이 없습니다"}</div>
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
                    <input type="file" accept=".pdf,application/pdf"
                      style={{ display:"none" }} id={`up-${song.id}`}
                      onChange={e => handleUpload(e, song.id)} />
                    <label htmlFor={`up-${song.id}`}
                      title={song.pdfUrl ? "PDF 교체" : "PDF 업로드"}
                      style={{
                        display:"flex", alignItems:"center", justifyContent:"center",
                        width:34, height:34, borderRadius:9, cursor:"pointer",
                        background: song.pdfUrl ? `${C.grn}22` : C.surf,
                        border:`1px solid ${song.pdfUrl ? C.grn : C.bdr}`,
                      }}>
                      <Icon n="upload" size={14} color={song.pdfUrl ? C.grn : C.dim} />
                    </label>
                    <button onClick={() => setConfirmDel(song.id)}
                      title="곡 삭제"
                      style={{
                        display:"flex", alignItems:"center", justifyContent:"center",
                        width:34, height:34, borderRadius:9, cursor:"pointer",
                        background:`${C.red}11`, border:`1px solid ${C.red}33`,
                      }}>
                      <Icon n="trash" size={14} color={C.red} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

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
function PDFViewerScreen({ user, songs, services, annotations, onAddAnnotation, onDeleteAnnotation, nav, selectedSongId, selectedSvcId, backTo, pdfjsReady }) {
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
  const [loadErr,  setLoadErr]  = useState("");
  const [cSize,    setCSize]    = useState({ w: 0, h: 0 });
  const [dualIdx,  setDualIdx]  = useState(Math.max(0, songIdx));
  const dualPdf1Ref = useRef(null);  // dual left song PDF doc
  const dualPdf2Ref = useRef(null);  // dual right song PDF doc
  const [dualKey,  setDualKey]  = useState(0); // bumped once when both PDFs are ready
  const [dualToast, setDualToast] = useState("");
  const touchStartX = useRef(null);
  const toastTimer  = useRef(null);

  // ── UI
  const [dual,          setDual]          = useState(false);
  const [media,         setMedia]         = useState(false);
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteInput,     setNoteInput]     = useState(false);
  const [noteTxt,       setNoteTxt]       = useState("");
  const [saving,        setSaving]        = useState(false);

  // ── Drawing / handwriting
  const [drawMode,  setDrawMode]  = useState(false);
  const [drawColor, setDrawColor] = useState("#e8383b");
  const [drawWidth, setDrawWidth] = useState(3);
  const [eraser,    setEraser]    = useState(false);
  const drawCanvasRef = useRef(null);
  const isDrawingRef  = useRef(false);
  const strokesRef    = useRef([]);
  const curStrokeRef  = useRef(null);
  const drawModeRef   = useRef(false);

  const myNotes = annotations[selectedSongId] || [];

  // keep drawModeRef in sync for non-reactive listeners
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  // load strokes from Firestore when song/page changes
  const drawDocId = `${selectedSongId}_p${pageNum}`;
  useEffect(() => {
    strokesRef.current = [];
    const dc = drawCanvasRef.current;
    if (dc) dc.getContext("2d").clearRect(0, 0, dc.width, dc.height);
    if (!user?.uid) return;
    getDoc(doc(db, "userDrawings", user.uid, "pages", drawDocId))
      .then(snap => {
        if (snap.exists()) {
          strokesRef.current = snap.data().strokes || [];
          const dc2 = drawCanvasRef.current;
          if (dc2 && dc2.width > 0) drawStrokes(dc2, strokesRef.current);
        }
      })
      .catch(() => {});
  }, [drawDocId, user?.uid]);

  const saveStrokes = useCallback(async (strokes) => {
    if (!user?.uid) return;
    try {
      await setDoc(
        doc(db, "userDrawings", user.uid, "pages", `${selectedSongId}_p${pageNum}`),
        { strokes, updatedAt: serverTimestamp() }
      );
    } catch(e) { console.error("필기 저장 실패:", e); }
  }, [user?.uid, selectedSongId, pageNum]);

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

  // PDF 로드 (싱글 모드)
  useEffect(() => {
    if (dual) return;
    pdfDocRef.current = null;
    setPageNum(1); setNumPages(0); setLoadErr("");
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
        const renderTo = async (ref, pdfDoc) => {
          if (!ref.current) return;
          if (!pdfDoc) { ref.current.width = 0; ref.current.height = 0; return; }
          const page = await pdfDoc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const sc   = Math.min(halfW / base.width, availH / base.height) * zoomMul;
          const vp   = page.getViewport({ scale: sc });
          ref.current.width  = vp.width;
          ref.current.height = vp.height;
          await page.render({ canvasContext: ref.current.getContext("2d"), viewport: vp }).promise;
        };
        await renderTo(canvas1Ref, dualPdf1Ref.current);
        await renderTo(canvas2Ref, dualPdf2Ref.current);
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
        if (drawCanvasRef.current) {
          drawCanvasRef.current.width  = vp.width;
          drawCanvasRef.current.height = vp.height;
          drawStrokes(drawCanvasRef.current, strokesRef.current);
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
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (drawModeRef.current) return;
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
    await onAddAnnotation(selectedSongId, { text: noteTxt, page: pageNum, x: 0, y: 0 });
    setNoteTxt(""); setNoteInput(false); setSaving(false);
  };
  const deleteNote = id => onDeleteAnnotation(selectedSongId, id);

  // ── Drawing pointer handlers
  const getCanvasPt = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const handleDrawDown = (e) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pt = getCanvasPt(e, canvas);
    curStrokeRef.current = { color: drawColor, width: drawWidth, eraser, points: [pt] };
    drawStrokes(canvas, strokesRef.current, curStrokeRef.current);
  };

  const handleDrawMove = (e) => {
    if (!isDrawingRef.current || !curStrokeRef.current) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const pt = getCanvasPt(e, canvas);
    curStrokeRef.current.points.push(pt);
    drawStrokes(canvas, strokesRef.current, curStrokeRef.current);
  };

  const handleDrawUp = async () => {
    if (!isDrawingRef.current || !curStrokeRef.current) return;
    isDrawingRef.current = false;
    const stroke = curStrokeRef.current;
    curStrokeRef.current = null;
    if (stroke.points.length > 0) {
      const next = [...strokesRef.current, stroke];
      strokesRef.current = next;
      await saveStrokes(next);
    }
    const canvas = drawCanvasRef.current;
    if (canvas) drawStrokes(canvas, strokesRef.current);
  };

  const handleDrawCancel = () => {
    isDrawingRef.current = false;
    curStrokeRef.current = null;
    const canvas = drawCanvasRef.current;
    if (canvas) drawStrokes(canvas, strokesRef.current);
  };

  const handleUndo = async () => {
    if (strokesRef.current.length === 0) return;
    const next = strokesRef.current.slice(0, -1);
    strokesRef.current = next;
    await saveStrokes(next);
    const canvas = drawCanvasRef.current;
    if (canvas) drawStrokes(canvas, next);
  };

  const handleClearPage = async () => {
    strokesRef.current = [];
    await saveStrokes([]);
    const canvas = drawCanvasRef.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
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
    <div className="h-screen" style={{ background:C.bg, display:"flex",
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
            Key {song.key}{song.bpm ? ` · ♩${song.bpm}` : ""}
            {numPages > 0 ? ` · ${pageNum}/${numPages}p` : ""}
            {svcSongs.length > 1 ? ` · 곡 ${songIdx + 1}/${svcSongs.length}` : ""}
          </div>
        </div>

        <div style={{ display:"flex", gap:4, alignItems:"center", flexShrink:0 }}>
          <button onClick={() => setZoomMul(z => Math.max(0.5, +(z - 0.15).toFixed(2)))}
            style={{ background:"none", border:"none", cursor:"pointer", padding:7, display:"flex", borderRadius:8 }}>
            <Icon n="zoomOut" size={18} color={C.dim} />
          </button>
          <span style={{ fontSize:11, color:C.dim, minWidth:34, textAlign:"center", fontWeight:600 }}>
            {Math.round(zoomMul * 100)}%
          </span>
          <button onClick={() => setZoomMul(z => Math.min(2.5, +(z + 0.15).toFixed(2)))}
            style={{ background:"none", border:"none", cursor:"pointer", padding:7, display:"flex", borderRadius:8 }}>
            <Icon n="zoomIn" size={18} color={C.dim} />
          </button>
          <div style={{ width:1, height:20, background:C.bdr, margin:"0 2px" }} />
          {toolBtn("pen",  drawMode,      () => { setDrawMode(p => !p); setEraser(false); }, "필기 모드")}
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
        </div>
      </div>

      {/* 필기 서브툴바 */}
      {drawMode && !dual && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          padding:"0 14px", height:46, flexShrink:0,
          background:`${C.pur}0a`, borderBottom:`1px solid ${C.bdr}`,
          overflowX:"auto",
        }}>
          {["#e8383b","#1a73e8","#1c1c1e","#34c759","#e8a93e"].map(clr => (
            <button key={clr} onClick={() => { setDrawColor(clr); setEraser(false); }}
              style={{
                width:22, height:22, borderRadius:"50%", background:clr,
                border: drawColor === clr && !eraser ? "3px solid #fff" : "2px solid transparent",
                outline: drawColor === clr && !eraser ? `2px solid ${clr}` : "none",
                cursor:"pointer", flexShrink:0, padding:0,
              }} />
          ))}
          <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
          {[2, 4, 7].map(w => (
            <button key={w} onClick={() => { setDrawWidth(w); setEraser(false); }}
              style={{
                width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
                background: drawWidth === w && !eraser ? `${C.pur}22` : "transparent",
                border:`1px solid ${drawWidth === w && !eraser ? C.pur : C.bdr}`,
                borderRadius:6, cursor:"pointer", flexShrink:0,
              }}>
              <div style={{
                width:w + 2, height:w + 2, borderRadius:"50%",
                background: eraser ? C.dim : drawColor,
              }} />
            </button>
          ))}
          <div style={{ width:1, height:20, background:C.bdr, flexShrink:0 }} />
          <button onClick={() => setEraser(p => !p)} title="지우개" style={{
            background: eraser ? `${C.red}22` : "transparent",
            border:`1px solid ${eraser ? C.red : C.bdr}`,
            borderRadius:6, padding:5, cursor:"pointer", display:"flex", flexShrink:0,
          }}>
            <Icon n="eraser" size={16} color={eraser ? C.red : C.dim} />
          </button>
          <button onClick={handleUndo} title="실행 취소" style={{
            background:"transparent", border:`1px solid ${C.bdr}`,
            borderRadius:6, padding:5, cursor:"pointer", display:"flex", flexShrink:0,
          }}>
            <Icon n="undo" size={16} color={C.dim} />
          </button>
          <button onClick={handleClearPage} title="페이지 지우기" style={{
            background:"transparent", border:`1px solid ${C.bdr}`,
            borderRadius:6, padding:5, cursor:"pointer", display:"flex", flexShrink:0,
          }}>
            <Icon n="trash" size={16} color={C.dim} />
          </button>
        </div>
      )}
      </div>

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
                  ? <canvas ref={canvas1Ref} style={{ display:"block",
                      borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
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
                    ? <canvas ref={canvas2Ref} style={{ display:"block",
                        borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
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
            // ── 싱글 모드
            <div style={{ width:"100%", height:"100%", display:"flex",
              alignItems:"center", justifyContent:"center", padding:8 }}>
              {song.pdfUrl ? (
                loadErr
                  ? <div style={{ color:C.red, fontSize:13 }}>{loadErr}</div>
                  : <div style={{ position:"relative", display:"inline-block", lineHeight:0, flexShrink:0 }}>
                      <canvas ref={canvas1Ref} style={{ display:"block",
                        borderRadius:4, boxShadow:"0 2px 16px rgba(0,0,0,.10)" }} />
                      <canvas ref={drawCanvasRef} style={{
                        position:"absolute", top:0, left:0, width:"100%", height:"100%",
                        borderRadius:4,
                        cursor: drawMode ? (eraser ? "cell" : "crosshair") : "default",
                        touchAction:"none",
                        pointerEvents: drawMode ? "auto" : "none",
                      }}
                        onPointerDown={handleDrawDown}
                        onPointerMove={handleDrawMove}
                        onPointerUp={handleDrawUp}
                        onPointerCancel={handleDrawCancel}
                      />
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
            <textarea value={noteTxt} onChange={e => setNoteTxt(e.target.value)}
              placeholder="예) 2절 — 건반 솔로" autoFocus
              style={{ width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
                color:C.txt, padding:"10px 14px", borderRadius:10,
                fontSize:14, outline:"none", fontFamily:"inherit",
                resize:"vertical", minHeight:80 }} />
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <Btn label="취소" variant="ghost" onClick={() => { setNoteInput(false); setNoteTxt(""); }} full />
              <Btn label={saving ? "저장 중..." : "저장"} variant="primary" onClick={saveNote} full disabled={saving} />
            </div>
          </div>
        </div>
      )}

      {/* 메모 패널 */}
      {showNotePanel && (
        <div style={{ position:"absolute", right:0, top:0, bottom:0,
          width:270, background:C.surf, borderLeft:`1px solid ${C.bdr}`,
          zIndex:100, overflowY:"auto", padding:16 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div style={{ fontWeight:700 }}>내 메모</div>
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
          {myNotes.length === 0
            ? <div style={{ color:C.dim, fontSize:13, textAlign:"center", padding:"40px 0" }}>메모가 없습니다</div>
            : myNotes.map(n => (
              <div key={n.id} style={{ background:C.card, borderRadius:10, padding:"10px 12px",
                marginBottom:8, border:`1px solid ${C.bdr}` }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                  <div style={{ flex:1 }}>
                    {n.page > 0 && <span style={{ fontSize:10, color:C.acc, fontWeight:700 }}>p.{n.page} </span>}
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
  const [allowedEmails, setAllowedEmails] = useState([]);
  const [emailInput,    setEmailInput]    = useState("");
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
      snap => setAllowedEmails(snap.docs.map(d => d.id)),
      e => console.error("allowedEmails 실패:", e)
    );
    return unsub;
  }, []);

  const addEmail = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || allowedEmails.includes(email)) return;
    setAddingEmail(true);
    setEmailErr("");
    try {
      await setDoc(doc(db, "allowedEmails", email), { addedAt: serverTimestamp() });
      setEmailInput("");
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
        <div style={{ display:"flex", gap:6, marginBottom:10 }}>
          <input
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addEmail()}
            placeholder="example@gmail.com"
            style={{
              flex:1, background:C.card, border:`1.5px solid ${C.bdr}`,
              color:C.txt, padding:"8px 10px", borderRadius:8,
              fontSize:12, outline:"none", fontFamily:"inherit",
            }}
          />
          <button onClick={addEmail} disabled={addingEmail || !emailInput.trim()} style={{
            background:C.acc, border:"none", borderRadius:8,
            padding:"8px 14px", cursor:"pointer",
            fontSize:12, fontWeight:700, color:"#111", fontFamily:"inherit",
            opacity: addingEmail || !emailInput.trim() ? 0.5 : 1,
            flexShrink:0,
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
            fontSize:12, color:`${C.dim}88`,
          }}>
            허용된 이메일이 없습니다 (부트스트랩 모드 — 누구나 로그인 가능)
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {allowedEmails.map(email => (
              <div key={email} style={{
                display:"flex", alignItems:"center", gap:8,
                padding:"8px 10px", borderRadius:8,
                background:C.card, border:`1px solid ${C.bdr}`,
              }}>
                <span style={{ flex:1, fontSize:12, color:C.txt,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {email}
                </span>
                <button onClick={() => removeEmail(email)} style={{
                  background:"transparent", border:"none", cursor:"pointer",
                  padding:4, display:"flex", flexShrink:0,
                }}>
                  <Icon n="xmark" size={14} color={C.dim} />
                </button>
              </div>
            ))}
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
  const [showTeam,   setShowTeam]   = useState(false);
  const [claiming,   setClaiming]   = useState(false);
  const [noLeader,   setNoLeader]   = useState(false);

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
        {["앱 정보 (v3.0)", "도움말", "문의하기"].map((item, i) => (
          <div key={i} style={{
            padding:"14px 16px",
            borderBottom: i < 2 ? `1px solid ${C.bdr}` : "none",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            cursor:"pointer",
          }}>
            <span style={{ fontSize:14 }}>{item}</span>
            <Icon n="chevR" size={15} color={C.dim} />
          </div>
        ))}
      </div>

      <Btn label="로그아웃" icon="logout" onClick={onLogout} variant="ghost" full />

      {showTeam && <TeamManagementModal currentUserId={user.uid} onClose={() => setShowTeam(false)} />}
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
  const [annotations, setAnnotations] = useState({});
  const [selSvcId,    setSelSvcId]    = useState(null);
  const [selSongId,   setSelSongId]   = useState(null);
  const [backTo,      setBackTo]      = useState("library");
  const [pdfjsReady,  setPdfjsReady]  = useState(false);

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
            if (!anyAdmin.empty) {
              // 어드민이 이미 있으면 허용 목록 확인
              const allowed = await getDoc(doc(db, "allowedEmails", firebaseUser.email));
              if (!allowed.exists()) {
                await signOut(auth);
                setLoginErr("등록되지 않은 이메일입니다. 관리자에게 문의하세요.");
                return;
              }
            }
            const autoRole = anyAdmin.empty ? "admin" : "member";
            await setDoc(uRef, {
              name:  firebaseUser.displayName || firebaseUser.email,
              email: firebaseUser.email,
              role:  autoRole,
              part:  "",
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

  // ── Firestore: annotations (per user, real-time)
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      query(collection(db, "annotations"), where("userId", "==", user.uid)),
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
      input, textarea { font-family: inherit; }
      .wFadeIn  { animation: wFadeIn  .22s ease; }
      .wSlideUp { animation: wSlideUp .28s cubic-bezier(.16,1,.3,1); }
      @keyframes wFadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes wSlideUp { from { opacity:0; transform:translateY(32px);} to { opacity:1; transform:translateY(0); } }
      .h-screen { height: 100vh; height: 100dvh; }
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

  const addAnnotation = async (songId, noteData) => {
    await addDoc(collection(db, "annotations"), {
      ...noteData,
      songId,
      userId: user.uid,
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
    user, songs, services, notifs, annotations,
    addSong, createService,
    onAddAnnotation: addAnnotation,
    onDeleteAnnotation: deleteAnnotation,
    markNotifRead, markAllNotifRead,
    nav,
  };

  return (
    <div style={{ width:"100%", minHeight:"100vh", background:C.bg, position:"relative" }}>
      {view === "services"      && <ServicesScreen      {...shared} />}
      {view === "svcDetail"     && <ServiceDetailScreen {...shared} selectedSvcId={selSvcId} />}
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
