import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";

const C = {
  bg:"#f2f2f7", surf:"#ffffff", card:"#f8f8fb", bdr:"#e5e5ea",
  acc:"#e8a93e", pur:"#6b5de7", grn:"#34c759", txt:"#1c1c1e",
  dim:"#8e8e93", red:"#ff3b30",
};

const KEY_CLR = {
  C:"#45b87a", D:"#60b4e0", E:"#e07a60", F:"#a060e0",
  G:"#60e0a0", A:"#e8a93e", B:"#7b6af5",
};
const keyColor = (k) => KEY_CLR[k ? k[0].toUpperCase() : "C"] || C.acc;

const MODEL = "gemini-2.5-flash";

function mmssToSec(mmss) {
  if (!mmss) return 0;
  const parts = mmss.trim().split(":").map(Number);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  return parts[0] || 0;
}

function parseYtId(url) {
  const s = (url || "").trim();
  const m =
    s.match(/[?&]v=([^&#]+)/) ||
    s.match(/youtu\.be\/([^?#]+)/) ||
    s.match(/embed\/([^?#]+)/);
  if (m) return m[1].trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
}

function canvasToBase64(canvas, maxW = 1280) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  const scale = Math.min(1, maxW / canvas.width);
  const oc = document.createElement("canvas");
  oc.width  = Math.round(canvas.width  * scale);
  oc.height = Math.round(canvas.height * scale);
  oc.getContext("2d").drawImage(canvas, 0, 0, oc.width, oc.height);
  return oc.toDataURL("image/jpeg", 0.88).split(",")[1];
}

function fmtDate(ts) {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7)  return `${diffDays}일 전`;
  return d.toLocaleDateString("ko-KR", { month:"short", day:"numeric" });
}

function Markdown({ text }) {
  return (
    <div style={{ fontSize:12, lineHeight:1.8, color:C.txt }}>
      {text.split("\n").map((line, i) => {
        const parts = line.split(/\*\*(.+?)\*\*/g);
        const isHeader = line.startsWith("##") || /^\d+\.\s\*\*/.test(line);
        return (
          <p key={i} style={{ margin: isHeader ? "10px 0 4px" : "1px 0" }}>
            {parts.map((p, j) =>
              j % 2 === 1
                ? <strong key={j} style={{ color:C.acc }}>{p}</strong>
                : p.replace(/^##\s*/, "").replace(/^\d+\.\s*/, "")
            )}
          </p>
        );
      })}
    </div>
  );
}

function MiniGuitarDiagram({ frets, color = "#6b5de7" }) {
  if (!frets || frets.length !== 6) return null;
  const active = frets.filter(f => f > 0);
  const minF = active.length ? Math.min(...active) : 1;
  const base = Math.max(1, minF);
  const showNut = base <= 2;
  const W = 72, H = 76, pL = 12, pR = 5, pT = 17, pB = 6;
  const rows = 4, fH = (H - pT - pB) / rows, sW = (W - pL - pR) / 5;
  const sx = i => pL + i * sW;
  const fy = f => pT + (f - base) * fH + fH / 2;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {Array.from({length: rows + 1}, (_, i) => (
        <line key={i} x1={pL} y1={pT + i * fH} x2={W - pR} y2={pT + i * fH}
          stroke={i === 0 && showNut ? "#1c1c1e" : "#ccc"}
          strokeWidth={i === 0 && showNut ? 3 : 1} />
      ))}
      {Array.from({length: 6}, (_, i) => (
        <line key={i} x1={sx(i)} y1={pT} x2={sx(i)} y2={H - pB}
          stroke="#ccc" strokeWidth={i === 0 ? 2 : 1} />
      ))}
      {!showNut && (
        <text x={pL - 2} y={pT + fH / 2 + 4} textAnchor="end"
          fontSize={8} fill="#8e8e93">{base}</text>
      )}
      {frets.map((f, i) => {
        if (f === -1) return (
          <text key={i} x={sx(i)} y={pT - 5} textAnchor="middle"
            fontSize={8} fill="#8e8e93">✕</text>
        );
        if (f === 0) return (
          <circle key={i} cx={sx(i)} cy={pT - 5} r={3}
            fill="none" stroke="#8e8e93" strokeWidth={1.2} />
        );
        return (
          <circle key={i} cx={sx(i)} cy={fy(f)} r={5}
            fill={color} />
        );
      })}
    </svg>
  );
}

export default function AIPanel({ song, user, pdfCanvasRef }) {
  const [ytInput,   setYtInput]   = useState("");
  const [editYt,    setEditYt]    = useState(false);
  const [ytErr,     setYtErr]     = useState("");
  const [analysis,  setAnalysis]  = useState("");
  const [loading,   setLoading]   = useState(false);
  const [aiErr,     setAiErr]     = useState("");
  const [usedImage,  setUsedImage]  = useState(false);
  const [savedMeta,  setSavedMeta]  = useState(null);

  const isLeader = user?.role === "leader" || user?.role === "admin";
  const myParts = user?.parts || (user?.part ? [user.part] : []);
  const isAdmin = user?.role === "admin";
  const isElecGuitar = isAdmin || myParts.includes("일렉기타");

  const [voicings, setVoicings] = useState(null);
  const [voicingLoading, setVoicingLoading] = useState(false);
  const [voicingErr, setVoicingErr] = useState("");

  const [ytId, setYtId] = useState(song?.youtubeId || null);
  const [ytMeta, setYtMeta] = useState(null);
  const [ytRange, setYtRange] = useState({ start:"", end:"" });

  useEffect(() => {
    if (!ytId) { setYtMeta(null); return; }
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`)
      .then(r => r.json())
      .then(d => setYtMeta({ title: d.title, author: d.author_name }))
      .catch(() => setYtMeta(null));
  }, [ytId]);

  useEffect(() => {
    if (!song?.id) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`tvpc_ytr_${song.id}`) || "null");
      setYtRange(saved || { start:"", end:"" });
    } catch { setYtRange({ start:"", end:"" }); }
  }, [song?.id]);

  useEffect(() => {
    if (!song?.id) return;
    setAnalysis(""); setAiErr(""); setUsedImage(false);
    setYtId(song?.youtubeId || null);
    getDoc(doc(db, "songAnalysis", song.id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setAnalysis(d.text || "");
        setUsedImage(!!d.usedImage);
        setSavedMeta({ at: d.savedAt, usedImage: !!d.usedImage });
      }
    });
  }, [song?.id]);

  const saveYtId = async () => {
    const id = parseYtId(ytInput);
    if (!id) { setYtErr("올바른 YouTube URL을 입력하세요."); return; }
    if (!song?.id) { setYtErr("악보가 선택되지 않았습니다."); return; }
    try {
      // youtubeUrl 이 effectiveYtUrl 에서 우선이므로 그쪽에 저장(+레거시 youtubeId 정리)
      await updateDoc(doc(db, "songs", song.id), { youtubeUrl: `https://youtu.be/${id}`, youtubeId: null });
      setYtId(id);
      setEditYt(false); setYtInput(""); setYtErr("");
    } catch (e) {
      setYtErr("저장 실패: " + (e.code === "permission-denied" ? "권한이 없습니다" : e.message));
    }
  };

  const removeYtId = async () => {
    if (!song?.id) return;
    try {
      await updateDoc(doc(db, "songs", song.id), { youtubeUrl: null, youtubeId: null });
      setYtId(null);
    } catch (e) {
      setYtErr("삭제 실패: " + e.message);
    }
  };

  const generateVoicings = async () => {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) { setVoicingErr("API 키 없음"); return; }
    setVoicingLoading(true); setVoicingErr(""); setVoicings(null);
    const uniqueChords = song?.chordTimeline?.length
      ? [...new Set(song.chordTimeline.map(e => e.chord))]
      : [];
    const chordStr = uniqueChords.length ? uniqueChords.join(", ") : "곡 키에서 자주 쓰이는 코드들";
    const prompt = `예배 찬양곡 일렉 기타 보이싱을 추천해주세요.

곡 정보: ${song.title} / Key: ${song.key || "?"} / BPM: ${song.bpm || "?"}
코드: ${chordStr}

각 코드마다 예배 일렉 기타에 맞는 보이싱을 JSON 배열로만 반환. 설명 없이 배열만.
형식: [{"chord":"G","shape":"오픈","frets":[3,2,0,0,0,3],"tip":"깨끗한 사운드"},...]

frets: 6현(저음 E)→1현(고음 E) 순서, -1=뮤트, 0=개방현
예배 장르에 맞게 클린하고 깔끔한 보이싱 위주로 추천.`;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
        { method:"POST", headers:{"content-type":"application/json"},
          body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] }) }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleaned = text.replace(/```[\w]*\n?/g,"").replace(/```/g,"").trim();
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const fixed = m[0].replace(/,\s*([\]}])/g,"$1");
          const parsed = JSON.parse(fixed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setVoicings(parsed);
            return;
          }
        } catch(_) {}
      }
      setVoicingErr("파싱 실패. 다시 시도해주세요.");
    } catch(e) { setVoicingErr(e.message); }
    finally { setVoicingLoading(false); }
  };

  const analyze = async (attempt = 0) => {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) { setAiErr("⚠️ .env 파일에 VITE_GEMINI_API_KEY를 설정하세요."); return; }
    setLoading(true);
    if (attempt === 0) { setAnalysis(""); setAiErr(""); setUsedImage(false); }

    const imageB64 = canvasToBase64(pdfCanvasRef?.current);

    const timeSig = song.timeSig || "미상";
    const prompt = imageB64
      ? `첨부된 악보 이미지와 아래 곡 정보를 함께 참고해서 분석해주세요.

곡 정보:
제목: ${song.title}
아티스트: ${song.artist || "미상"}
Key: ${song.key}
BPM: ${song.bpm || "미상"}
박자: ${timeSig}

중요: 박자표(time signature)는 악보 이미지 왼쪽 상단에서 직접 확인하세요. 위 박자 정보가 "미상"이거나 이미지와 다르면 이미지를 우선합니다.

악보 이미지를 직접 보고 한국어로 분석해주세요:
1. **박자 & 리듬** — 악보에서 확인한 박자표와 리듬 특징 (6/8이면 흔들리는 느낌, 3/4이면 왈츠 등)
2. **코드 진행** — 악보에 실제로 표시된 코드 패턴과 진행 특징
3. **섹션별 포인트** — 악보에서 확인되는 섹션(Verse/Pre-Chorus/Chorus 등) 연습 팁
4. **파트별 조언** — 기타, 건반, 드럼, 베이스 각각
5. **예배 흐름** — 곡 분위기와 예배에서의 역할`
      : `찬양 악보를 분석해주세요:
제목: ${song.title}
아티스트: ${song.artist || "미상"}
Key: ${song.key}
BPM: ${song.bpm || "미상"}
박자: ${timeSig}

한국어로 간결하게 분석해주세요:
1. **박자 & 리듬** — ${timeSig} 박자의 특징과 연주 시 주의점
2. **코드 진행** — 이 Key에서 주요 코드 패턴과 특징
3. **섹션별 포인트** — Verse / Pre-Chorus / Chorus 연습 팁
4. **파트별 조언** — 기타, 건반, 드럼, 베이스 각각
5. **예배 흐름** — 곡 분위기와 예배에서의 역할`;

    const parts = [];
    if (imageB64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64 } });
    parts.push({ text: prompt });

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] }),
        }
      );
      const data = await res.json();
      if (data.error) {
        const isOverload =
          data.error.status === "RESOURCE_EXHAUSTED" ||
          (data.error.message || "").toLowerCase().includes("high demand") ||
          (data.error.message || "").toLowerCase().includes("overload");
        if (isOverload && attempt < 2) {
          const wait = (attempt + 1) * 4000;
          setAiErr(`⏳ 서버가 바빠요. ${wait / 1000}초 후 재시도 중... (${attempt + 1}/2)`);
          await new Promise(r => setTimeout(r, wait));
          return analyze(attempt + 1);
        }
        throw new Error(isOverload
          ? "서버가 혼잡합니다. 잠시 후 다시 시도해주세요."
          : data.error.message);
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("AI 응답을 받지 못했습니다. 다시 시도해주세요.");
      setAnalysis(text);
      setUsedImage(!!imageB64);
      setAiErr("");
      const now = serverTimestamp();
      await setDoc(doc(db, "songAnalysis", song.id), {
        text, usedImage: !!imageB64, savedAt: now,
        songTitle: song.title,
      });
      setSavedMeta({ at: { toDate: () => new Date() }, usedImage: !!imageB64 });
    } catch (e) {
      setAiErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const savedAt = savedMeta?.at;

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.surf, overflow:"hidden" }}>

      {/* ── 고정: 헤더 */}
      <div style={{
        padding:"10px 14px", borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", gap:8,
        background:C.card, flexShrink:0,
      }}>
        <span style={{ fontSize:14 }}>🎵</span>
        <span style={{ fontWeight:800, fontSize:13, color:C.acc, letterSpacing:"-0.01em" }}>AI 도움</span>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
          <span style={{
            background:`${keyColor(song.key)}22`, color:keyColor(song.key),
            border:`1px solid ${keyColor(song.key)}44`,
            padding:"2px 7px", borderRadius:5, fontSize:10, fontWeight:700,
          }}>Key {song.key}</span>
          {song.bpm && <span style={{ fontSize:10, color:C.dim }}>♩{song.bpm}</span>}
        </div>
      </div>

      {/* ── 고정: YouTube 링크 추가/변경 + AI 컨트롤 */}
      <div style={{ flexShrink:0 }}>
        {/* 유튜브 링크 — 링크 없으면 입력(리더), 있으면 리더에게 변경/삭제. 영상 자체는 MEDIA 패널 상단에 표시됨 */}
        {(() => {
          const hasYt = !!(song?.youtubeUrl || song?.youtubeId || ytId);
          const showAdd = isLeader && (!hasYt || editYt);
          const showManage = isLeader && hasYt && !editYt;
          if (!showAdd && !showManage) return null;
          return (
            <div style={{ padding:"8px 12px 10px", borderBottom:`1px solid ${C.bdr}` }}>
              {showAdd ? (
                <>
                  <div style={{ fontSize:10, color:C.dim, marginBottom:4, fontWeight:600 }}>🎬 유튜브 레퍼런스 링크</div>
                  <div style={{ display:"flex", gap:5 }}>
                    <input value={ytInput} onChange={e => setYtInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveYtId(); }}
                      placeholder="유튜브 URL 붙여넣기"
                      style={{ flex:1, fontSize:12, padding:"6px 8px", borderRadius:7, border:`1px solid ${C.bdr}`,
                        background:C.card, color:C.txt, outline:"none", fontFamily:"inherit" }} />
                    <button onClick={saveYtId}
                      style={{ fontSize:12, padding:"6px 12px", borderRadius:7, cursor:"pointer", background:C.acc,
                        color:"#fff", border:"none", fontWeight:800, fontFamily:"inherit", flexShrink:0 }}>저장</button>
                    {editYt && (
                      <button onClick={() => { setEditYt(false); setYtInput(""); setYtErr(""); }}
                        style={{ fontSize:12, padding:"6px 9px", borderRadius:7, cursor:"pointer", background:C.card,
                          color:C.dim, border:`1px solid ${C.bdr}`, fontFamily:"inherit", flexShrink:0 }}>취소</button>
                    )}
                  </div>
                  {ytErr && <div style={{ fontSize:10, color:C.red, marginTop:4 }}>{ytErr}</div>}
                </>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:11, color:C.dim, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>🎬 유튜브 연결됨</span>
                  <button onClick={() => { setEditYt(true); setYtInput(""); setYtErr(""); }}
                    style={{ fontSize:11, padding:"4px 9px", borderRadius:6, cursor:"pointer", background:`${C.acc}18`,
                      color:C.acc, border:`1px solid ${C.acc}44`, fontWeight:700, fontFamily:"inherit" }}>변경</button>
                  <button onClick={removeYtId}
                    style={{ fontSize:11, padding:"4px 9px", borderRadius:6, cursor:"pointer", background:`${C.red}18`,
                      color:C.red, border:`1px solid ${C.red}44`, fontWeight:700, fontFamily:"inherit" }}>삭제</button>
                </div>
              )}
            </div>
          );
        })()}
        {/* AI 컨트롤 (버튼/메타 행) */}
        <div style={{ padding:"0 12px 10px" }}>
          {analysis ? (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {usedImage
                  ? <span style={{ fontSize:10, color:C.grn }}>📄 악보 이미지 분석</span>
                  : <span style={{ fontSize:10, color:C.dim }}>ℹ️ 메타데이터 분석</span>
                }
                {savedAt && (
                  <span style={{ fontSize:10, color:C.dim }}>· {fmtDate(savedAt)}</span>
                )}
              </div>
              <button onClick={() => analyze(0)} disabled={loading} style={{
                background:"transparent", border:`1px solid ${C.pur}`,
                borderRadius:7, padding:"3px 10px", cursor:"pointer",
                fontSize:11, color:C.pur, fontFamily:"inherit", fontWeight:600,
                opacity: loading ? 0.5 : 1,
              }}>
                {loading ? "분석 중..." : "↺ 다시 분석"}
              </button>
            </div>
          ) : (
            <>
              <button onClick={() => analyze(0)} disabled={loading} style={{
                width:"100%",
                background: loading ? `${C.pur}55` : `linear-gradient(135deg, ${C.pur}, #5a4fd6)`,
                border:"none", borderRadius:10, padding:"10px 0",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight:700, fontSize:13, color:"#fff", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                marginBottom:8, boxShadow: loading ? "none" : `0 4px 14px ${C.pur}44`,
                transition:"all .2s",
              }}>
                {loading ? "⏳ 분석 중..." : "✨ AI 분석하기"}
              </button>
              <div style={{ fontSize:10, color:C.dim, textAlign:"center", lineHeight:1.6 }}>
                {pdfCanvasRef?.current?.width
                  ? "📄 현재 페이지 악보 이미지를 AI가 직접 읽어 분석합니다"
                  : "ℹ️ 곡 메타데이터 기반으로 분석합니다"}
                <br />분석 결과는 저장되어 팀 전체가 공유합니다
              </div>
            </>
          )}

          {aiErr && (
            <div style={{ fontSize:12, marginTop:8,
              background: aiErr.startsWith("⏳") ? `${C.acc}11` : `${C.red}11`,
              color: aiErr.startsWith("⏳") ? C.acc : C.red,
              padding:"10px 12px", borderRadius:8,
              border:`1px solid ${aiErr.startsWith("⏳") ? C.acc : C.red}33` }}>
              <div>{aiErr}</div>
              {!loading && !aiErr.startsWith("⏳") && (
                <button onClick={() => analyze(0)} style={{
                  marginTop:8, background:"transparent",
                  border:`1px solid ${C.red}55`, borderRadius:6,
                  padding:"4px 12px", cursor:"pointer",
                  fontSize:11, color:C.red, fontFamily:"inherit", fontWeight:600,
                }}>다시 시도</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 스크롤 가능: AI 분석 결과 + 일렉기타 보이싱 */}
      <div style={{ flex:1, overflowY:"auto", padding:"0 12px 20px" }}>
        {analysis && (
          <div style={{ background:C.card, borderRadius:10, padding:"12px 14px",
            border:`1px solid ${C.bdr}`, marginBottom: isElecGuitar ? 12 : 0 }}>
            <Markdown text={analysis} />
          </div>
        )}

        {/* 일렉기타 보이싱 — 일렉기타 파트만 표시 */}
        {isElecGuitar && (
          <div style={{ background:C.surf, borderRadius:12, border:`1px solid ${C.bdr}`,
            padding:"12px 12px" }}>
            <div style={{ fontSize:10, fontWeight:800, color:"#6b5de7", letterSpacing:"0.05em",
              textTransform:"uppercase", marginBottom:8 }}>⚡ 일렉 기타 보이싱</div>
            <button onClick={generateVoicings} disabled={voicingLoading}
              style={{ width:"100%", padding:"8px 0", borderRadius:9, border:"none",
                cursor: voicingLoading ? "not-allowed" : "pointer",
                background: voicingLoading ? "#8e8e93" : "#6b5de7",
                color:"#fff", fontSize:12, fontWeight:800, fontFamily:"inherit" }}>
              {voicingLoading ? "분석 중…" : "🎸 보이싱 추천 받기"}
            </button>
            {voicingErr && (
              <div style={{ fontSize:11, color:C.red, marginTop:6 }}>{voicingErr}</div>
            )}
            {voicings && (
              <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:10 }}>
                {voicings.map((v, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10,
                    background:C.card, borderRadius:10, padding:"8px 10px",
                    border:`1px solid ${C.bdr}` }}>
                    <MiniGuitarDiagram frets={v.frets} color="#6b5de7" />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:15, fontWeight:900, color:"#6b5de7",
                        letterSpacing:"-0.5px" }}>{v.chord}</div>
                      {v.shape && (
                        <div style={{ fontSize:10, fontWeight:700, color:C.dim,
                          marginBottom:2 }}>{v.shape}</div>
                      )}
                      {v.tip && (
                        <div style={{ fontSize:11, color:C.txt, lineHeight:1.5 }}>{v.tip}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

const ghostBtnStyle = {
  background:"transparent", border:`1px solid #252840`,
  borderRadius:6, padding:"4px 10px", cursor:"pointer",
  fontSize:11, color:"#585c80", fontFamily:"inherit",
};

const accentBtnStyle = {
  flex:1, background:"#e8a93e", border:"none", borderRadius:8,
  padding:"7px 0", cursor:"pointer", fontWeight:700,
  fontSize:12, color:"#111", fontFamily:"inherit",
};
