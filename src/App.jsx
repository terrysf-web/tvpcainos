import { useState, useEffect, useRef, useCallback } from "react";
import { auth, db, storage } from "./firebase.js";
import AIPanel from "./AIPanel.jsx";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, getDoc, serverTimestamp, arrayUnion,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

/* ══════════════════════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════════════════════ */
const C = {
  bg:    "#0a0b11",
  surf:  "#111320",
  card:  "#181a28",
  bdr:   "#252840",
  acc:   "#e8a93e",
  pur:   "#7b6af5",
  grn:   "#45b87a",
  txt:   "#dde0f2",
  dim:   "#585c80",
  red:   "#cc5f5f",
};

const KEY_CLR = {
  C:"#45b87a", D:"#60b4e0", E:"#e07a60", F:"#a060e0",
  G:"#60e0a0", A:"#e8a93e", B:"#7b6af5",
};
const keyColor = (k) => KEY_CLR[k ? k[0].toUpperCase() : "C"] || C.acc;

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
  zoomIn:  "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM11 8v6M8 11h6",
  zoomOut: "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM8 11h6",
  prev:    "M15 18l-6-6 6-6",
  next:    "M9 18l6-6-6-6",
  back:    "M19 12H5M12 5l-7 7 7 7",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  tag:     "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
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
      position:"fixed", inset:0, background:"rgba(0,0,0,.75)",
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      zIndex:900, backdropFilter:"blur(6px)",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wSlideUp" style={{
        background:C.surf, borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:480, maxHeight:"88vh",
        overflow:"auto", padding:"24px 20px 32px",
        border:`1px solid ${C.bdr}`, borderBottom:"none",
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
function LoginScreen() {
  const [email,   setEmail]   = useState("");
  const [pw,      setPw]      = useState("");
  const [err,     setErr]     = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !pw) return;
    setLoading(true);
    setErr("");
    try {
      await signInWithEmailAndPassword(auth, email, pw);
    } catch {
      setErr("이메일 또는 비밀번호를 확인하세요.");
      setLoading(false);
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
        <Input label="이메일" value={email} onChange={setEmail} type="email"
          placeholder="your@email.com" autoFocus />
        <Input label="비밀번호" value={pw} onChange={setPw} type="password" placeholder="••••••••" />
        {err && <div style={{ color:C.red, fontSize:13, marginBottom:12, textAlign:"center" }}>{err}</div>}
        <Btn label={loading ? "로그인 중..." : "로그인"}
          onClick={login} full disabled={loading || !email || !pw} />
        <Divider />
        <div style={{ fontSize:12, color:C.dim, textAlign:"center", lineHeight:1.8 }}>
          계정이 없으시면 리더에게 문의하세요
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
  const [title,  setTitle]  = useState("");
  const [artist, setArtist] = useState("");
  const [key,    setKey]    = useState("C");
  const [bpm,    setBpm]    = useState("80");
  const [saving, setSaving] = useState(false);
  const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  const handleAdd = async () => {
    if (!title) return;
    setSaving(true);
    await onAdd({ title, artist, key, bpm: Number(bpm) || 80 });
    setSaving(false);
    onClose();
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
      <Btn label={saving ? "추가 중..." : "추가하기"} icon="plus"
        onClick={handleAdd} full disabled={saving || !title} />
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

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <div style={{ background:C.surf, padding:"20px 20px 16px",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:12, color:C.dim, marginBottom:2 }}>안녕하세요,</div>
          <div style={{ fontWeight:800, fontSize:18, letterSpacing:"-0.03em" }}>
            {user.name} <span style={{ color:C.acc }}>✦</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {user.role === "leader" && (
            <Btn label="새 예배" icon="plus" sm onClick={() => setShowCreate(true)} />
          )}
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

      <div style={{ padding:16, paddingBottom:90, overflowY:"auto", maxHeight:"calc(100vh - 73px)" }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:12, paddingLeft:2 }}>
          예배 일정
        </div>
        {services.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:C.dim }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
            <div>등록된 예배 일정이 없습니다</div>
          </div>
        )}
        {services.map(svc => {
          const svcSongs = (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean);
          return (
            <div key={svc.id} className="wFadeIn"
              onClick={() => nav("svcDetail", { svcId: svc.id })}
              style={{
                background:C.card, borderRadius:14, padding:"16px",
                marginBottom:10, border:`1px solid ${C.bdr}`, cursor:"pointer",
              }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:16, letterSpacing:"-0.02em" }}>{svc.title}</div>
                  <div style={{ color:C.dim, fontSize:13, marginTop:2 }}>
                    {fmtDate(svc.date)} · {svc.time}
                  </div>
                </div>
                <Badge label={svc.notified ? "알림완료" : "대기중"}
                  color={svc.notified ? C.grn : C.dim} />
              </div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
                {svcSongs.map(s => (
                  <span key={s.id} style={{
                    fontSize:12, background:C.surf, border:`1px solid ${C.bdr}`,
                    borderRadius:6, padding:"2px 8px", color:`${C.txt}bb`,
                  }}>{s.title}</span>
                ))}
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:12, color:C.dim }}>{svcSongs.length}곡</span>
                <Icon n="chevR" size={16} color={C.dim} />
              </div>
            </div>
          );
        })}
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
function ServiceDetailScreen({ user, services, songs, annotations, nav, selectedSvcId }) {
  const svc = services.find(s => s.id === selectedSvcId);
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

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <div style={{ background:C.surf, padding:"18px 16px",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={() => nav("services")}
          style={{ background:"none", border:"none", color:C.txt, cursor:"pointer", padding:4, display:"flex" }}>
          <Icon n="back" size={20} />
        </button>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:17, letterSpacing:"-0.02em" }}>{svc.title}</div>
          <div style={{ fontSize:12, color:C.dim, marginTop:1 }}>{svc.date} · {svc.time}</div>
        </div>
        {svc.notified
          ? <Badge label="알림 완료" color={C.grn} />
          : user.role === "leader" && (
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

      <div style={{ padding:16, paddingBottom:90, overflowY:"auto", maxHeight:"calc(100vh - 73px)" }}>
        <div style={{ fontSize:11, color:C.dim, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", marginBottom:12 }}>
          예배 곡 순서 · {svcSongs.length}곡
        </div>
        {svcSongs.map((song, idx) => {
          const hasNotes = (annotations[song.id] || []).length > 0;
          return (
            <div key={song.id} className="wFadeIn"
              onClick={() => nav("pdfViewer", { songId: song.id, backTo: "svcDetail" })}
              style={{
                background:C.card, borderRadius:14, padding:"14px 16px",
                marginBottom:8, border:`1px solid ${C.bdr}`, cursor:"pointer",
                display:"flex", alignItems:"center", gap:12,
              }}>
              <div style={{
                width:32, height:32, borderRadius:9, flexShrink:0,
                background:`linear-gradient(135deg, ${C.acc}33, ${C.pur}33)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontWeight:700, fontSize:14, color:C.acc,
              }}>{idx + 1}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:15, letterSpacing:"-0.01em" }}>{song.title}</div>
                <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>{song.artist}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                <KeyBadge k={song.key} />
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
                  {song.pdfUrl && <span style={{ fontSize:10, color:C.acc, fontWeight:700 }}>📄 PDF</span>}
                  {hasNotes    && <span style={{ fontSize:10, color:C.grn, fontWeight:700 }}>✏ 메모</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SONG LIBRARY SCREEN
══════════════════════════════════════════════════════════════════ */
function SongLibraryScreen({ user, songs, addSong, nav }) {
  const [query,     setQuery]     = useState("");
  const [showAdd,   setShowAdd]   = useState(false);
  const [uploading, setUploading] = useState(null);

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(query.toLowerCase())
  );

  const handlePdfUpload = async (file, songId) => {
    if (!file || file.type !== "application/pdf") return;
    setUploading(songId);
    try {
      const storageRef = ref(storage, `pdfs/${songId}.pdf`);
      const task = uploadBytesResumable(storageRef, file);
      await new Promise((resolve, reject) => task.on("state_changed", null, reject, resolve));
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "songs", songId), { pdfUrl: url });
    } catch (e) {
      console.error("PDF upload failed:", e);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <div style={{ background:C.surf, padding:"18px 16px 14px",
        borderBottom:`1px solid ${C.bdr}` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em" }}>악보 라이브러리</div>
          {user.role === "leader" && (
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

            {user.role === "leader" && (
              <div style={{ flexShrink:0 }}>
                {uploading === song.id ? (
                  <div style={{ fontSize:11, color:C.acc, padding:"0 6px" }}>업로드 중...</div>
                ) : (
                  <>
                    <input type="file" accept=".pdf" style={{ display:"none" }}
                      id={`up-${song.id}`}
                      onChange={e => {
                        handlePdfUpload(e.target.files[0], song.id);
                        e.target.value = "";
                      }} />
                    <label htmlFor={`up-${song.id}`}
                      title={song.pdfUrl ? "PDF 다시 업로드" : "PDF 업로드"}
                      style={{
                        display:"flex", alignItems:"center", justifyContent:"center",
                        width:36, height:36, borderRadius:9, cursor:"pointer",
                        background: song.pdfUrl ? `${C.grn}22` : C.surf,
                        border:`1px solid ${song.pdfUrl ? C.grn : C.bdr}`,
                      }}>
                      <Icon n="upload" size={15} color={song.pdfUrl ? C.grn : C.dim} />
                    </label>
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PDF VIEWER SCREEN
══════════════════════════════════════════════════════════════════ */
function PDFViewerScreen({ user, songs, annotations, onAddAnnotation, onDeleteAnnotation, nav, selectedSongId, backTo, pdfjsReady }) {
  const song = songs.find(s => s.id === selectedSongId);

  const canvas1Ref = useRef(null);
  const pdfDocRef  = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [pageNum,  setPageNum]  = useState(1);
  const [scale,    setScale]    = useState(1.3);
  const [dual,     setDual]     = useState(false);
  const [addMode,  setAddMode]  = useState(false);
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteInput,     setNoteInput]     = useState(false);
  const [noteTxt,       setNoteTxt]       = useState("");
  const [notePos,       setNotePos]       = useState(null);
  const [saving,        setSaving]        = useState(false);

  const myNotes = annotations[selectedSongId] || [];

  useEffect(() => {
    if (!song?.pdfUrl || !pdfjsReady || !window.pdfjsLib) return;
    pdfDocRef.current = null;
    setPageNum(1);
    setNumPages(0);
    window.pdfjsLib.getDocument({ url: song.pdfUrl }).promise
      .then(pdf => {
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
      })
      .catch(err => console.error("PDF load:", err));
  }, [song?.pdfUrl, pdfjsReady]);

  const renderPage = useCallback(async (pNum, canvasEl, sc) => {
    if (!pdfDocRef.current || !canvasEl) return;
    if (pNum < 1 || pNum > pdfDocRef.current.numPages) return;
    try {
      const page = await pdfDocRef.current.getPage(pNum);
      const vp = page.getViewport({ scale: sc });
      canvasEl.width  = vp.width;
      canvasEl.height = vp.height;
      await page.render({ canvasContext: canvasEl.getContext("2d"), viewport: vp }).promise;
    } catch(e) { console.error("Render:", e); }
  }, []);

  useEffect(() => {
    if (!pdfDocRef.current) return;
    renderPage(pageNum, canvas1Ref.current, scale);
  }, [pageNum, scale, numPages, renderPage]);

  const handleCanvasClick = e => {
    if (!addMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setNotePos({
      x: +((e.clientX - rect.left) / rect.width  * 100).toFixed(1),
      y: +((e.clientY - rect.top)  / rect.height * 100).toFixed(1),
    });
    setNoteInput(true);
  };

  const saveNote = async () => {
    if (!noteTxt.trim() || !notePos || saving) return;
    setSaving(true);
    await onAddAnnotation(selectedSongId, {
      page: pageNum, x: notePos.x, y: notePos.y, text: noteTxt,
    });
    setNoteTxt("");
    setNotePos(null);
    setNoteInput(false);
    setAddMode(false);
    setSaving(false);
  };

  const deleteNote = id => onDeleteAnnotation(selectedSongId, id);
  const pageNotes  = myNotes.filter(n => n.page === pageNum);

  if (!song) return null;

  const navBtn = (disabled, onClick, icon) => (
    <button onClick={onClick} disabled={disabled}
      style={{
        background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
        padding:"8px 20px", cursor: disabled ? "not-allowed" : "pointer",
        display:"flex", alignItems:"center", justifyContent:"center",
        opacity: disabled ? 0.3 : 1,
      }}>
      <Icon n={icon} size={18} color={C.txt} />
    </button>
  );

  const toolBtn = (name, active, onClick, title) => (
    <button onClick={onClick} title={title}
      style={{
        background: active ? `${C.acc}33` : "transparent",
        border:`1px solid ${active ? C.acc : C.bdr}`,
        borderRadius:8, padding:7, cursor:"pointer",
        display:"flex", alignItems:"center",
      }}>
      <Icon n={name} size={17} color={active ? C.acc : C.dim} />
    </button>
  );

  return (
    <div style={{ height:"100vh", background:"#0a0a0e", display:"flex",
      flexDirection:"column", overflow:"hidden" }}>

      <div style={{ background:C.surf, padding:"10px 14px",
        borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <button onClick={() => nav(backTo || "library")}
          style={{ background:"none", border:"none", color:C.txt, cursor:"pointer",
            padding:4, display:"flex" }}>
          <Icon n="back" size={20} />
        </button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:15, letterSpacing:"-0.01em",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {song.title}
          </div>
          <div style={{ fontSize:11, color:C.dim }}>
            {song.artist} · Key {song.key} · {pageNum}/{numPages || "—"}p
          </div>
        </div>

        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
          <button onClick={() => setScale(s => Math.max(.6, s - .15))}
            style={{ background:"none", border:"none", cursor:"pointer", padding:6, display:"flex" }}>
            <Icon n="zoomOut" size={17} color={C.dim} />
          </button>
          <span style={{ fontSize:11, color:C.dim, minWidth:34, textAlign:"center" }}>
            {Math.round(scale * 100)}%
          </span>
          <button onClick={() => setScale(s => Math.min(2.5, s + .15))}
            style={{ background:"none", border:"none", cursor:"pointer", padding:6, display:"flex" }}>
            <Icon n="zoomIn" size={17} color={C.dim} />
          </button>
          {toolBtn("pen",  addMode,       () => setAddMode(p => !p),       "메모 추가 모드")}
          {toolBtn("note", showNotePanel, () => setShowNotePanel(p => !p), "메모 목록")}
          {toolBtn("dual", dual,          () => setDual(p => !p),          "듀얼 모드")}
        </div>
      </div>

      {addMode && (
        <div style={{ background:`${C.acc}22`, padding:"5px 14px",
          fontSize:12, color:C.acc, textAlign:"center", flexShrink:0 }}>
          ✎ 메모 추가 모드 — 악보를 탭하여 메모를 남기세요
        </div>
      )}

      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"row" }}>
        {/* PDF 악보 영역 */}
        <div style={{ flex:1, overflow:"auto", display:"flex",
          alignItems:"flex-start", justifyContent:"center",
          padding:"16px", flexDirection:"column" }}>
          {song.pdfUrl ? (
            <div style={{ position:"relative", display:"inline-block" }}>
              <canvas ref={canvas1Ref} onClick={handleCanvasClick}
                style={{
                  display:"block", maxWidth:"100%",
                  borderRadius:4, boxShadow:"0 4px 28px rgba(0,0,0,.5)",
                  cursor: addMode ? "crosshair" : "default",
                }} />
              {pageNotes.map(n => (
                <div key={n.id} title={n.text}
                  onClick={() => setShowNotePanel(true)}
                  style={{
                    position:"absolute", left:`${n.x}%`, top:`${n.y}%`,
                    transform:"translate(-50%,-50%)",
                    width:22, height:22, borderRadius:"50%",
                    background:C.acc, border:"2px solid #111",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:11, fontWeight:700, color:"#111",
                    cursor:"pointer", zIndex:10,
                    boxShadow:"0 2px 8px rgba(0,0,0,.5)",
                  }}>✎</div>
              ))}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", flex:1, color:C.dim, textAlign:"center", padding:40 }}>
              <div style={{
                width:84, height:84, borderRadius:18,
                background:`linear-gradient(135deg, ${C.acc}22, ${C.pur}22)`,
                border:`1px solid ${C.bdr}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:38, marginBottom:16,
              }}>🎼</div>
              <div style={{ fontWeight:700, fontSize:16, marginBottom:6 }}>{song.title}</div>
              <div style={{ fontSize:13, marginBottom:16 }}>PDF 악보가 없습니다</div>
              <div style={{ fontSize:12 }}>라이브러리 탭에서 PDF를 업로드해주세요</div>
            </div>
          )}
        </div>

        {/* AI 도움 패널 (DUAL 모드) */}
        {dual && (
          <div style={{ width:300, flexShrink:0, overflow:"hidden",
            borderLeft:`1px solid ${C.bdr}` }}>
            <AIPanel song={song} user={user} />
          </div>
        )}
      </div>

      <div style={{ background:C.surf, borderTop:`1px solid ${C.bdr}`,
        padding:"10px 20px", display:"flex", alignItems:"center",
        justifyContent:"space-between", flexShrink:0 }}>
        {navBtn(pageNum <= 1, () => setPageNum(p => Math.max(1, p - (dual ? 2 : 1))), "prev")}
        <div style={{ fontSize:13, color:C.dim, letterSpacing:"-0.01em" }}>
          <span style={{ color:C.txt, fontWeight:700 }}>{pageNum}</span>
          {dual && pageNum + 1 <= numPages && (
            <span> – <span style={{ color:C.txt, fontWeight:700 }}>{pageNum + 1}</span></span>
          )}
          <span> / {numPages || "—"}</span>
        </div>
        {navBtn(
          numPages > 0 && pageNum >= numPages,
          () => setPageNum(p => Math.min(numPages || 9999, p + (dual ? 2 : 1))),
          "next"
        )}
      </div>

      {noteInput && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.7)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:200, padding:20,
        }}>
          <div style={{ background:C.surf, borderRadius:16, padding:20,
            width:"100%", maxWidth:400, border:`1px solid ${C.bdr}` }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>메모 추가</div>
            <textarea value={noteTxt} onChange={e => setNoteTxt(e.target.value)}
              placeholder="예) 여기서 건반 솔로 — 리더 신호 기다릴 것"
              autoFocus
              style={{
                width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
                color:C.txt, padding:"10px 14px", borderRadius:10,
                fontSize:14, outline:"none", fontFamily:"inherit",
                resize:"vertical", minHeight:80,
              }} />
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <Btn label="취소" variant="ghost"
                onClick={() => { setNoteInput(false); setAddMode(false); }} full />
              <Btn label={saving ? "저장 중..." : "저장"} variant="primary"
                onClick={saveNote} full disabled={saving} />
            </div>
          </div>
        </div>
      )}

      {showNotePanel && (
        <div style={{
          position:"absolute", right:0, top:0, bottom:0,
          width:270, background:C.surf, borderLeft:`1px solid ${C.bdr}`,
          zIndex:100, overflowY:"auto", padding:16,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div style={{ fontWeight:700 }}>내 메모</div>
            <button onClick={() => setShowNotePanel(false)}
              style={{ background:"none", border:"none", cursor:"pointer", color:C.dim, display:"flex" }}>
              <Icon n="xmark" size={18} />
            </button>
          </div>
          {myNotes.length === 0 ? (
            <div style={{ color:C.dim, fontSize:13, textAlign:"center", padding:"40px 0" }}>
              메모가 없습니다
            </div>
          ) : (
            myNotes.map(n => (
              <div key={n.id} style={{
                background:C.card, borderRadius:10, padding:"10px 12px",
                marginBottom:8, border:`1px solid ${C.bdr}`,
              }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                  <div style={{ flex:1 }}>
                    <span style={{ fontSize:10, color:C.acc, fontWeight:700 }}>p.{n.page} </span>
                    <span style={{ fontSize:13, lineHeight:1.5 }}>{n.text}</span>
                  </div>
                  <button onClick={() => deleteNote(n.id)}
                    style={{ background:"none", border:"none", cursor:"pointer", padding:2, display:"flex" }}>
                    <Icon n="trash" size={14} color={C.red} />
                  </button>
                </div>
              </div>
            ))
          )}
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
   PROFILE SCREEN
══════════════════════════════════════════════════════════════════ */
function ProfileScreen({ user, onLogout }) {
  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:20, paddingBottom:90 }}>
      <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.02em", marginBottom:20 }}>내 정보</div>

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
              <Badge label={user.role === "leader" ? "리더" : "멤버"}
                color={user.role === "leader" ? C.acc : C.grn} />
              {user.part && <span style={{ fontSize:12, color:C.dim }}>{user.part}</span>}
            </div>
          </div>
        </div>
      </div>

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
      display:"flex", alignItems:"center", padding:"8px 0 14px",
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
  const [view,        setView]        = useState("services");
  const [songs,       setSongs]       = useState([]);
  const [services,    setServices]    = useState([]);
  const [notifs,      setNotifs]      = useState([]);
  const [annotations, setAnnotations] = useState({});
  const [selSvcId,    setSelSvcId]    = useState(null);
  const [selSongId,   setSelSongId]   = useState(null);
  const [backTo,      setBackTo]      = useState("library");
  const [pdfjsReady,  setPdfjsReady]  = useState(false);

  // ── Firebase Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        const profile = snap.exists() ? snap.data() : {};
        setUser({
          uid:   firebaseUser.uid,
          email: firebaseUser.email,
          name:  profile.name  || firebaseUser.email,
          role:  profile.role  || "member",
          part:  profile.part  || "",
        });
      } else {
        setUser(null);
      }
    });
  }, []);

  // ── Firestore: songs (real-time)
  useEffect(() => {
    return onSnapshot(
      query(collection(db, "songs"), orderBy("title")),
      snap => setSongs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, []);

  // ── Firestore: services (real-time)
  useEffect(() => {
    return onSnapshot(
      query(collection(db, "services"), orderBy("date")),
      snap => setServices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, []);

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

  // ── PDF.js loader
  useEffect(() => {
    if (window.pdfjsLib) { setPdfjsReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        setPdfjsReady(true);
      }
    };
    document.head.appendChild(script);
  }, []);

  // ── Global styles
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Noto Sans KR', -apple-system, sans-serif;
             background: ${C.bg}; color: ${C.txt}; -webkit-tap-highlight-color: transparent; }
      ::-webkit-scrollbar { width: 3px; height: 3px; }
      ::-webkit-scrollbar-thumb { background: ${C.bdr}; border-radius: 2px; }
      input, textarea { font-family: inherit; }
      .wFadeIn  { animation: wFadeIn  .22s ease; }
      .wSlideUp { animation: wSlideUp .28s cubic-bezier(.16,1,.3,1); }
      @keyframes wFadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes wSlideUp { from { opacity:0; transform:translateY(32px);} to { opacity:1; transform:translateY(0); } }
    `;
    document.head.appendChild(el);
    return () => { try { document.head.removeChild(el); } catch(_) {} };
  }, []);

  // ── CRUD helpers
  const addSong = async (data) => {
    await addDoc(collection(db, "songs"), {
      ...data,
      pdfUrl: null,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
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

  if (!user) return <LoginScreen />;

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
    nav, pdfjsReady,
  };

  return (
    <div style={{ maxWidth:640, margin:"0 auto", minHeight:"100vh",
      background:C.bg, position:"relative" }}>
      {view === "services"      && <ServicesScreen      {...shared} />}
      {view === "svcDetail"     && <ServiceDetailScreen {...shared} selectedSvcId={selSvcId} />}
      {view === "library"       && <SongLibraryScreen   {...shared} />}
      {view === "pdfViewer"     && (
        <PDFViewerScreen {...shared} selectedSongId={selSongId} backTo={backTo} />
      )}
      {view === "notifications" && (
        <NotificationsScreen
          notifs={notifs}
          markNotifRead={markNotifRead}
          markAllNotifRead={markAllNotifRead}
        />
      )}
      {view === "profile" && (
        <ProfileScreen user={user} onLogout={() => signOut(auth)} />
      )}

      {view !== "pdfViewer" && (
        <BottomNav view={view} nav={nav} unread={unread} />
      )}
    </div>
  );
}
