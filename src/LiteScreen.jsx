import { useState, useEffect } from "react";
import { C } from "./theme.js";

const PART_COLOR  = { "결단": "#e07a60", "Closing": "#34c759" };
const PART_TINT   = { "결단": "rgba(224,122,96,0.10)", "Closing": "rgba(52,199,89,0.09)", "찬양": "rgba(107,93,231,0.06)" };
const PART_BORDER = { "결단": "#e07a60", "Closing": "#34c759", "찬양": "#6b5de7" };

const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

function svcStartMs(svc) {
  if (!svc?.time || !svc?.date) return null;
  const [h, m] = svc.time.split(":").map(Number);
  const d = new Date(svc.date + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
const isExpired = svc => { const ms = svcStartMs(svc); return ms !== null && Date.now() - ms > 2 * 60 * 60 * 1000; };
const isLive    = svc => { const ms = svcStartMs(svc); if (!ms) return false; const e = Date.now()-ms; return e>=0 && e<7200000; };

function fmtDate(dateStr) {
  return new Date(dateStr + "T00:00:00")
    .toLocaleDateString("ko-KR", { month:"long", day:"numeric", weekday:"short" });
}

export default function LiteScreen({ user, services, songs, onOpenSong, onGoToApp }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n+1), 30000);
    return () => clearInterval(id);
  }, []);

  const today  = localDateStr();
  const sorted = [...services].filter(s=>s?.date)
    .sort((a,b) => a.date!==b.date ? a.date.localeCompare(b.date) : (a.time||"").localeCompare(b.time||""));

  const todaySvc = sorted.find(s => s.date === today);
  let svc = null, isNext = false;
  if (todaySvc && !isExpired(todaySvc)) { svc = todaySvc; }
  else { svc = sorted.find(s => s.date > today) ?? null; isNext = !!svc; }

  const svcSongs = svc
    ? (svc.songIds||[]).map(id => songs.find(s=>s.id===id)).filter(Boolean) : [];
  const rawSvcIdxs = svc
    ? (svc.songIds||[]).reduce((acc,id,ri) => { if (songs.find(s=>s.id===id)) acc.push(ri); return acc; }, []) : [];
  const getPart = fi => svc?.partsEnabled ? (svc.songPartIds?.[rawSvcIdxs[fi]]||null) : null;

  const live = svc ? isLive(svc) : false;

  return (
    <div style={{
      minHeight:"100dvh", background:C.bg, color:C.txt,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif",
      paddingBottom:40,
    }}>

      {/* ── 헤더 그라디언트 */}
      <div style={{
        background:"linear-gradient(135deg,#1a1264 0%,#3a2b9e 45%,#6b5de7 100%)",
        color:"#fff",
        padding:"16px 20px 20px",
        paddingTop:"calc(env(safe-area-inset-top,0px) + 16px)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          {/* 로고 — 메인은 Ainos 스크립트(screen 블렌드), 게스트는 지구본 배지+Ainos */}
          {GUEST_BUILD ? (
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <img src="/sffbc_logo.jpg" alt="Ainos"
                style={{ width:26, height:26, borderRadius:"50%", background:"#fff", objectFit:"cover", flexShrink:0 }} />
              <span style={{ fontSize:16, fontWeight:900, fontStyle:"italic", color:"#fff", letterSpacing:"0.3px" }}>Ainos</span>
            </div>
          ) : (
            <div style={{ height:28, overflow:"hidden", flexShrink:0 }}>
              <img
                src="/ainos-logo.jpg"
                alt="Ainos"
                style={{
                  height:46,
                  width:"auto",
                  display:"block",
                  filter:"brightness(9)",
                  mixBlendMode:"screen",
                }}
              />
            </div>
          )}
          <span style={{ fontSize:13, fontWeight:900, color:"rgba(255,255,255,0.85)", letterSpacing:"0.04em" }}>Lite</span>
          {live && (
            <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"rgba(229,57,53,0.9)", borderRadius:6, padding:"2px 8px", lineHeight:1.5 }}>
              ● LIVE
            </span>
          )}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontWeight:600 }}>실시간</span>
            <button onClick={onGoToApp} style={{
              fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.9)",
              background:"rgba(255,255,255,0.14)", border:"1px solid rgba(255,255,255,0.22)",
              borderRadius:12, padding:"3px 10px",
              letterSpacing:"-0.01em", cursor:"pointer", fontFamily:"inherit",
            }}>아이노스 앱 →</button>
          </div>
        </div>

        {svc ? (
          <>
            {isNext && (
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", fontWeight:800, marginBottom:3, letterSpacing:"0.04em" }}>
                다음 예배
              </div>
            )}
            <div style={{ fontSize:22, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1.2 }}>
              {fmtDate(svc.date)}
            </div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", marginTop:4 }}>
              {svc.title}{svc.time ? ` · ${svc.time}` : ""}
            </div>
          </>
        ) : (
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.7)" }}>
            {services.length === 0 ? "불러오는 중…" : "예배 일정이 없습니다"}
          </div>
        )}
      </div>

      {/* ── 곡 목록 */}
      {svc && (
        <div style={{ padding:"14px 14px" }}>
          {svcSongs.length === 0 ? (
            <div style={{ textAlign:"center", color:C.dim, fontSize:14, padding:40 }}>
              등록된 악보가 없습니다
            </div>
          ) : svcSongs.map((song, fi) => {
            const part     = getPart(fi);
            const prevPart = fi > 0 ? getPart(fi-1) : null;
            const showDiv  = part && part !== prevPart && (part === "결단" || part === "Closing");
            const pc       = PART_COLOR[part]  || "#6b5de7";
            const tint     = PART_TINT[part]   || "transparent";
            const border   = PART_BORDER[part] || "#6b5de7";
            const hasPdf   = !!(song.pdfUrl || song.imageUrl);

            return (
              <div key={song.id+"_"+fi}>
                {showDiv && (
                  <div style={{ display:"flex", alignItems:"center", gap:10, margin:"18px 2px 10px" }}>
                    <div style={{ flex:1, height:2, background:`linear-gradient(90deg,transparent,${pc}88)`, borderRadius:1 }} />
                    <span style={{ fontSize:12, fontWeight:900, color:pc, letterSpacing:"0.12em" }}>
                      {part.toUpperCase()}
                    </span>
                    <div style={{ flex:1, height:2, background:`linear-gradient(90deg,${pc}88,transparent)`, borderRadius:1 }} />
                  </div>
                )}

                <div
                  onClick={() => hasPdf && onOpenSong?.(song.id, svc.id, fi)}
                  style={{
                    background: tint || C.surf,
                    border:`1px solid ${border}44`,
                    borderLeft:`4px solid ${border}`,
                    borderRadius:14,
                    padding:"13px 14px",
                    marginBottom:9,
                    cursor: hasPdf ? "pointer" : "default",
                    WebkitTapHighlightColor:"transparent",
                    userSelect:"none",
                    transition:"opacity 0.12s",
                  }}
                >
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {part && (
                      <span style={{
                        fontSize:10, fontWeight:900, flexShrink:0,
                        color: pc === "#6b5de7" ? "#6b5de7" : "#fff",
                        background: pc === "#6b5de7" ? `${pc}22` : pc,
                        border: pc === "#6b5de7" ? `1.5px solid ${pc}55` : "none",
                        borderRadius:7, padding:"2px 9px", lineHeight:1.6,
                        letterSpacing:"0.04em",
                      }}>{part}</span>
                    )}
                    <span style={{
                      fontSize:16, fontWeight:800, flex:1,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      letterSpacing:"-0.01em",
                    }}>{song.title}</span>
                    {hasPdf && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink:0, opacity:0.4 }}>
                        <path d="M6 3L11 8L6 13" stroke={C.txt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  {(song.key || song.bpm) && (
                    <div style={{ fontSize:12, color:C.dim, marginTop:6, paddingLeft:part ? 0 : 0 }}>
                      {[song.key && `Key ${song.key}`, song.bpm && `${song.bpm} BPM`].filter(Boolean).join("  ·  ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 푸터 */}
      <div style={{ textAlign:"center", padding:"4px 16px 12px", fontSize:11, color:`${C.dim}88` }}>
        {user?.name || user?.email} · 읽기 전용
      </div>
    </div>
  );
}
