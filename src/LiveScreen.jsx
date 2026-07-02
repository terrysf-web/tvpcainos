import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { C, keyColor } from "./theme.js";
import { Icon, Input } from "./ui.jsx";

const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
import { db, GUEST_BUILD } from "./firebase.js";
import {
  collection, doc, onSnapshot, setDoc, addDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp,
} from "firebase/firestore";

const isLeader = (role) => role === "leader" || role === "admin";

// 메시지 시간 — 오늘이면 시간만, 다른 날이면 "M/D 시간"으로 날짜 포함
function fmtMsgTS(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const t = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
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
  const [bridgeOnline,   setBridgeOnline]   = useState(false);
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
    const today = localDateStr();
    const cutoff = localDateStr(new Date(Date.now() - 21 * 86400000));
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
    return onSnapshot(doc(db, "liveStatus", "bridge"), snap => {
      if (!snap.exists()) { setBridgeOnline(false); return; }
      const ts = snap.data()?.updatedAt?.toMillis?.();
      setBridgeOnline(!!ts && Date.now() - ts < 90_000);
    });
  }, []);

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

  const roleLbl = (r) => ({leader:"리더",broadcast:"방송팀",foh:"FOH",admin:"어드민",member:"멤버"})[r] || "";
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
      ? fmtMsgTS(msg.createdAt.toMillis())
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
    if (GUEST_BUILD || !ppConnected) { setPpPresentation(null); return; }
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
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: ppConnected ? C.grn : C.bdr }} />
              <span style={{ fontSize:12, color: ppConnected ? C.grn : C.dim, fontWeight:600 }}>
                PP {ppConnected ? "연결됨" : "연결 안됨"}
              </span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: bridgeOnline ? C.grn : C.bdr }} />
              <span style={{ fontSize:12, color: bridgeOnline ? C.grn : C.dim, fontWeight:600 }}>
                Bridge {bridgeOnline ? "실행 중" : "꺼짐"}
              </span>
            </div>
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
                {user.role === "admin" ? "어드민" : user.role === "leader" ? "리더" : user.role === "broadcast" ? "방송팀" : user.role === "foh" ? "FOH" : "멤버"}
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
                      <span style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)",
                        letterSpacing:"0.1em" }}>SLIDES</span>
                      {ppPresentation?.id?.name && (
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)", flex:1,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {ppPresentation.id.name}
                        </span>
                      )}
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)" }}>{ppAllSlides.length}장</span>
                    </div>
                    <div style={{ maxHeight:220, overflowY:"auto", padding:"8px 0" }}>
                      {ppAllSlides.map((text, i) => (
                        <div key={i} style={{ padding:"6px 16px", display:"flex", gap:10, alignItems:"flex-start",
                          borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                          <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)", flexShrink:0,
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
                              {fmtMsgTS(cue.updatedAt.toMillis())}
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
                          ? fmtMsgTS(cue.updatedAt.toMillis()) : ""}
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
                {!GUEST_BUILD && (
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
                )}
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
      paddingBottom:"calc(70px + env(safe-area-inset-bottom))" }}>

      {/* ── Header */}
      <div style={{ padding:"calc(16px + env(safe-area-inset-top)) 20px 0",
        background:(GUEST_BUILD ? "linear-gradient(135deg,#1a1264 0%,#3a2b9e 45%,#6b5de7 100%)" : "linear-gradient(135deg,#0c1850 0%,#1c3c88 45%,#3878e0 100%)") }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <button onClick={() => setShowSvcPicker(p => !p)} style={{
            display:"flex", alignItems:"center", gap:6, background:"none",
            border:"none", cursor:"pointer", padding:0, minWidth:0,
          }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:16, fontWeight:900, color:"#fff", textAlign:"left",
                fontFamily:"inherit", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:220 }}>
                {selSvc
                  ? `${new Date(selSvc.date+"T00:00:00").toLocaleDateString("ko-KR",{month:"numeric",day:"numeric",weekday:"short"})} ${selSvc.title||""}`
                  : "예배 선택"}
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.65)", textAlign:"left" }}>탭하여 예배 변경</div>
            </div>
            <Icon n="chevD" size={12} color="rgba(255,255,255,0.65)" />
          </button>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            {session?.timerRunning && (
              <span style={{ fontSize:10, color:"#fff", background:C.red,
                borderRadius:6, padding:"2px 8px", fontWeight:700, letterSpacing:"0.06em" }}>● LIVE</span>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: ppConnected ? C.grn : "rgba(255,255,255,0.3)" }} />
              <span style={{ fontSize:10, color: ppConnected ? C.grn : "rgba(255,255,255,0.5)" }}>PP</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: bridgeOnline ? C.grn : "rgba(255,255,255,0.3)" }} />
              <span style={{ fontSize:10, color: bridgeOnline ? C.grn : "rgba(255,255,255,0.5)" }}>Bridge</span>
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
                <span style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)",
                  letterSpacing:"0.1em" }}>SLIDES</span>
                {ppPresentation?.id?.name && (
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)", flex:1,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {ppPresentation.id.name}
                  </span>
                )}
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)" }}>{ppAllSlides.length}장</span>
              </div>
              <div style={{ maxHeight:200, overflowY:"auto", padding:"6px 0" }}>
                {ppAllSlides.map((text, i) => (
                  <div key={i} style={{ padding:"5px 14px", display:"flex", gap:9, alignItems:"flex-start",
                    borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)", flexShrink:0,
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
                    ? fmtMsgTS(cue.updatedAt.toMillis())
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
   HOME SPLASH SCREEN — SCHEDULE HELPERS
══════════════════════════════════════════════════════════════════ */

export default LiveScreen;
