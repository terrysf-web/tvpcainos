import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
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

// PDF 캔버스를 JPEG base64로 변환 (최대 1280px 너비로 리사이즈)
function canvasToBase64(canvas, maxW = 1280) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  const scale = Math.min(1, maxW / canvas.width);
  const oc = document.createElement("canvas");
  oc.width  = Math.round(canvas.width  * scale);
  oc.height = Math.round(canvas.height * scale);
  oc.getContext("2d").drawImage(canvas, 0, 0, oc.width, oc.height);
  const dataUrl = oc.toDataURL("image/jpeg", 0.88);
  return dataUrl.split(",")[1]; // base64 부분만
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

export default function AIPanel({ song, user, pdfCanvasRef }) {
  const [ytInput,   setYtInput]   = useState("");
  const [editYt,    setEditYt]    = useState(false);
  const [ytErr,     setYtErr]     = useState("");
  const [analysis,  setAnalysis]  = useState("");
  const [loading,   setLoading]   = useState(false);
  const [aiErr,     setAiErr]     = useState("");
  const [usedImage, setUsedImage] = useState(false); // 이번 분석에 이미지 사용 여부

  const isLeader = user?.role === "leader" || user?.role === "admin";
  const ytId = song?.youtubeId;

  const saveYtId = async () => {
    const id = parseYtId(ytInput);
    if (!id) { setYtErr("올바른 YouTube URL을 입력하세요."); return; }
    await updateDoc(doc(db, "songs", song.id), { youtubeId: id });
    setEditYt(false); setYtInput(""); setYtErr("");
  };

  const removeYtId = async () => {
    await updateDoc(doc(db, "songs", song.id), { youtubeId: null });
  };

  const analyze = async (attempt = 0) => {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) { setAiErr("⚠️ .env 파일에 VITE_GEMINI_API_KEY를 설정하세요."); return; }
    setLoading(true);
    if (attempt === 0) { setAnalysis(""); setAiErr(""); setUsedImage(false); }

    // PDF 캔버스 이미지 추출
    const imageB64 = canvasToBase64(pdfCanvasRef?.current);

    const prompt = imageB64
      ? `첨부된 악보 이미지와 아래 곡 정보를 함께 참고해서 분석해주세요.

곡 정보:
제목: ${song.title}
아티스트: ${song.artist || "미상"}
Key: ${song.key}
BPM: ${song.bpm || "미상"}

악보 이미지를 직접 보고 한국어로 분석해주세요:
1. **코드 진행** — 악보에 실제로 표시된 코드 패턴과 진행 특징
2. **섹션별 포인트** — 악보에서 확인되는 섹션(Verse/Pre-Chorus/Chorus 등) 연습 팁
3. **파트별 조언** — 기타, 건반, 드럼, 베이스 각각
4. **예배 흐름** — 곡 분위기와 예배에서의 역할`
      : `찬양 악보를 분석해주세요:
제목: ${song.title}
아티스트: ${song.artist || "미상"}
Key: ${song.key}
BPM: ${song.bpm || "미상"}

한국어로 간결하게 분석해주세요:
1. **코드 진행** — 이 Key에서 주요 코드 패턴과 특징
2. **섹션별 포인트** — Verse / Pre-Chorus / Chorus 연습 팁
3. **파트별 조언** — 기타, 건반, 드럼, 베이스 각각
4. **예배 흐름** — 곡 분위기와 예배에서의 역할`;

    // Gemini API parts: 이미지가 있으면 이미지 먼저, 그 다음 텍스트
    const parts = [];
    if (imageB64) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64 } });
    }
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
      setAnalysis(data.candidates[0].content.parts[0].text);
      setUsedImage(!!imageB64);
      setAiErr("");
    } catch (e) {
      setAiErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.surf, overflow:"hidden" }}>
      {/* Header */}
      <div style={{
        padding:"10px 14px", borderBottom:`1px solid ${C.bdr}`,
        display:"flex", alignItems:"center", gap:8,
        background:C.card, flexShrink:0,
      }}>
        <span style={{ fontSize:14 }}>🎵</span>
        <span style={{ fontWeight:800, fontSize:13, color:C.acc, letterSpacing:"-0.01em" }}>AI 도움</span>
        <span style={{ fontSize:10, color:`${C.dim}88`, marginLeft:2 }}>고정 영역</span>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
          <span style={{
            background:`${keyColor(song.key)}22`, color:keyColor(song.key),
            border:`1px solid ${keyColor(song.key)}44`,
            padding:"2px 7px", borderRadius:5, fontSize:10, fontWeight:700,
          }}>Key {song.key}</span>
          {song.bpm && <span style={{ fontSize:10, color:C.dim }}>♩{song.bpm}</span>}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {/* ── YouTube Section */}
        <div style={{ padding:"12px 12px 0" }}>
          <div style={{ fontSize:10, color:C.dim, fontWeight:700,
            letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>
            유튜브 레퍼런스
          </div>

          {ytId && !editYt ? (
            <div>
              <div style={{ position:"relative", paddingBottom:"56.25%",
                height:0, borderRadius:8, overflow:"hidden", border:`1px solid ${C.bdr}` }}>
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                  style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", border:"none" }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div style={{
                display:"flex", alignItems:"center", gap:9, marginTop:8,
                padding:"8px 10px", background:C.card, borderRadius:9, border:`1px solid ${C.bdr}`,
              }}>
                <div style={{
                  width:34, height:34, borderRadius:8, flexShrink:0,
                  background:`linear-gradient(135deg, ${keyColor(song.key)}33, ${C.pur}33)`,
                  border:`1px solid ${keyColor(song.key)}33`,
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:15,
                }}>🎵</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:12, overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{song.title}</div>
                  <div style={{ fontSize:11, color:C.dim, marginTop:2,
                    display:"flex", alignItems:"center", gap:5 }}>
                    <span>{song.artist || "미상"}</span>
                    <span style={{ background:`${C.grn}22`, color:C.grn,
                      padding:"1px 5px", borderRadius:4, fontSize:9, fontWeight:700 }}>Live</span>
                  </div>
                </div>
                <a href={`https://www.youtube.com/watch?v=${ytId}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ display:"flex", alignItems:"center", justifyContent:"center",
                    width:26, height:26, borderRadius:6,
                    background:C.surf, border:`1px solid ${C.bdr}`,
                    textDecoration:"none", flexShrink:0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"
                      stroke={C.dim} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
              </div>
              {isLeader && (
                <div style={{ display:"flex", gap:6, marginTop:6 }}>
                  <button onClick={() => setEditYt(true)} style={ghostBtnStyle}>영상 변경</button>
                  <button onClick={removeYtId}            style={ghostBtnStyle}>삭제</button>
                </div>
              )}
            </div>
          ) : (
            <div>
              {isLeader ? (
                <>
                  <input
                    value={ytInput}
                    onChange={e => setYtInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveYtId()}
                    placeholder="YouTube URL 또는 영상 ID 붙여넣기"
                    style={{
                      width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
                      color:C.txt, padding:"8px 10px", borderRadius:8,
                      fontSize:12, outline:"none", fontFamily:"inherit",
                      marginBottom:6, boxSizing:"border-box",
                    }}
                  />
                  {ytErr && <div style={{ fontSize:11, color:C.red, marginBottom:6 }}>{ytErr}</div>}
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={saveYtId} style={accentBtnStyle}>저장</button>
                    {editYt && (
                      <button onClick={() => { setEditYt(false); setYtInput(""); setYtErr(""); }}
                        style={ghostBtnStyle}>취소</button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ background:C.card, borderRadius:8, padding:"20px 0",
                  textAlign:"center", color:C.dim, fontSize:12, border:`1px dashed ${C.bdr}` }}>
                  영상이 등록되지 않았습니다
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Divider */}
        <div style={{ height:1, background:C.bdr, margin:"12px 12px" }} />

        {/* ── AI Analysis Section */}
        <div style={{ padding:"0 12px 20px" }}>
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

          {/* 분석 방식 안내 */}
          {!loading && !analysis && !aiErr && (
            <div style={{ fontSize:10, color:C.dim, textAlign:"center", marginBottom:12, lineHeight:1.6 }}>
              {pdfCanvasRef?.current?.width
                ? "📄 현재 페이지 악보 이미지를 AI가 직접 읽어 분석합니다"
                : "ℹ️ 곡 메타데이터 기반으로 분석합니다"}
            </div>
          )}

          {usedImage && analysis && (
            <div style={{ fontSize:10, color:C.grn, marginBottom:8,
              display:"flex", alignItems:"center", gap:4 }}>
              <span>📄</span> 악보 이미지 기반 분석
            </div>
          )}

          {aiErr && (
            <div style={{ fontSize:12, marginBottom:8,
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

          {analysis && (
            <div style={{ background:C.card, borderRadius:10, padding:"12px 14px", border:`1px solid ${C.bdr}` }}>
              <Markdown text={analysis} />
            </div>
          )}
        </div>
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
