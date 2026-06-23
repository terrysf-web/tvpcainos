import { useState, useEffect } from "react";
import { C } from "./theme.js";

const PART_COLOR = { "결단": "#e07a60", "Closing": "#34c759" };

const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

function svcStartMs(svc) {
  if (!svc?.time || !svc?.date) return null;
  const [h, m] = svc.time.split(":").map(Number);
  const d = new Date(svc.date + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function isExpired(svc) {
  const ms = svcStartMs(svc);
  return ms !== null && Date.now() - ms > 2 * 60 * 60 * 1000;
}

function isLive(svc) {
  const ms = svcStartMs(svc);
  if (ms === null) return false;
  const elapsed = Date.now() - ms;
  return elapsed >= 0 && elapsed < 2 * 60 * 60 * 1000;
}

function fmtDate(dateStr) {
  return new Date(dateStr + "T00:00:00")
    .toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

export default function LiteScreen({ user, services, songs }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const today = localDateStr();
  const sorted = [...services]
    .filter(s => s?.date)
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : (a.time||"").localeCompare(b.time||""));

  const todaySvc = sorted.find(s => s.date === today);
  let svc = null;
  let isNext = false;
  if (todaySvc && !isExpired(todaySvc)) {
    svc = todaySvc;
  } else {
    svc = sorted.find(s => s.date > today) ?? null;
    isNext = !!svc;
  }

  const svcSongs = svc
    ? (svc.songIds || []).map(id => songs.find(s => s.id === id)).filter(Boolean)
    : [];
  const rawSvcIdxs = svc
    ? (svc.songIds || []).reduce((acc, id, ri) => {
        if (songs.find(s => s.id === id)) acc.push(ri);
        return acc;
      }, [])
    : [];
  const getPart = fi =>
    svc?.partsEnabled ? (svc.songPartIds?.[rawSvcIdxs[fi]] || null) : null;

  const live = svc ? isLive(svc) : false;

  return (
    <div style={{
      minHeight: "100dvh", background: C.bg, color: C.txt,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif",
      paddingBottom: 40,
    }}>
      {/* ── 헤더 */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: C.card, borderBottom: `1px solid ${C.bdr}`,
        padding: "14px 20px",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.02em" }}>🎵 아이노스</span>
          {live && (
            <span style={{
              fontSize: 10, fontWeight: 800, color: "#fff",
              background: "#e53935", borderRadius: 6, padding: "2px 7px", lineHeight: 1.5,
            }}>● LIVE</span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: 10, color: C.dim, fontWeight: 600,
          }}>실시간</span>
        </div>
        {svc ? (
          <>
            {isNext && (
              <div style={{ fontSize: 11, color: C.acc, fontWeight: 800, marginBottom: 2 }}>
                다음 예배
              </div>
            )}
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {fmtDate(svc.date)}
            </div>
            <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
              {svc.title}{svc.time ? ` · ${svc.time}` : ""}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 14, color: C.dim }}>
            {services.length === 0 ? "불러오는 중…" : "예배 일정이 없습니다"}
          </div>
        )}
      </div>

      {/* ── 곡 목록 */}
      {svc && (
        <div style={{ padding: "14px 16px" }}>
          {svcSongs.length === 0 ? (
            <div style={{ textAlign: "center", color: C.dim, fontSize: 14, padding: 40 }}>
              등록된 악보가 없습니다
            </div>
          ) : svcSongs.map((song, fi) => {
            const part     = getPart(fi);
            const prevPart = fi > 0 ? getPart(fi - 1) : null;
            const showDivider = part && part !== prevPart && (part === "결단" || part === "Closing");
            const partClr  = PART_COLOR[part] || null;

            return (
              <div key={song.id + "_" + fi}>
                {showDivider && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    margin: "16px 0 10px",
                  }}>
                    <div style={{ flex: 1, height: 1.5, background: `${partClr}55`, borderRadius: 1 }} />
                    <span style={{
                      fontSize: 11, fontWeight: 900, color: partClr,
                      letterSpacing: "0.1em",
                    }}>{part.toUpperCase()}</span>
                    <div style={{ flex: 1, height: 1.5, background: `${partClr}55`, borderRadius: 1 }} />
                  </div>
                )}

                <div style={{
                  background: C.surf,
                  border: `1px solid ${C.bdr}`,
                  borderLeft: partClr ? `3.5px solid ${partClr}` : `1px solid ${C.bdr}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: part ? 5 : 0 }}>
                    {part && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, flexShrink: 0,
                        color: partClr ? "#fff" : C.dim,
                        background: partClr || `${C.dim}22`,
                        borderRadius: 6, padding: "2px 8px", lineHeight: 1.5,
                      }}>{part}</span>
                    )}
                    <span style={{
                      fontSize: 15, fontWeight: 700,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{song.title}</span>
                  </div>
                  {(song.key || song.bpm) && (
                    <div style={{ fontSize: 12, color: C.dim, marginTop: part ? 0 : 4 }}>
                      {[song.key && `Key ${song.key}`, song.bpm && `${song.bpm} BPM`]
                        .filter(Boolean).join("  ·  ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 푸터 */}
      <div style={{ textAlign: "center", padding: "4px 16px", fontSize: 11, color: `${C.dim}88` }}>
        {user?.name || user?.email} · 읽기 전용
      </div>
    </div>
  );
}
