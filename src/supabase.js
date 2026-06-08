import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://byvbrsuvporwhlapecja.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dmJyc3V2cG9yd2hsYXBlY2phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc5MDgsImV4cCI6MjA5NTQwMzkwOH0.iEHk3ZH34o4OXZYVqejKRT0ti0VJ7FbFaU728ioGxo8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const CHORD_PROMPT = `Analyze this sheet music image. Find every chord symbol printed above the staff lines.

Chord symbols: C, Am, G7, F#m, Bb, Dm7, E/G#, Bm7, Dsus4, C#m, A7, etc.
They appear as TEXT LABELS in the white space above each staff system — NOT lyrics below the staff.

Return ONLY a valid JSON array (no markdown, no explanation, no commentary):
[{"label":"C","cx":0.12,"cy":0.07},{"label":"Am","cx":0.34,"cy":0.07}]

Field definitions:
- "label": exact chord text as printed (keep # and b characters)
- "cx": 0.0=left image edge, 1.0=right image edge — measure at horizontal CENTER of the chord label text
- "cy": 0.0=top image edge, 1.0=bottom image edge — measure at vertical CENTER of the chord label text

Precision rules:
- Measure the center of the PRINTED CHORD TEXT characters, not the note head beneath it
- Chord labels in the same staff row share nearly identical cy values (within 0.01)
- Different rows must have clearly different cy values
- cx precision matters: each chord label has a distinct horizontal position

Return [] if no chord symbols exist.`;

function parseChordResponse(text) {
  if (!text || !text.trim()) return [];
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[\w]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/,\s*([\]}])/g, "$1")  // trailing comma
    .trim();
  let chords = null;
  try {
    const p = JSON.parse(cleaned);
    chords = Array.isArray(p) ? p : (p?.chords || p?.items || p?.result || null);
  } catch { /* ignore */ }
  if (!chords) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) try { chords = JSON.parse(m[0].replace(/,\s*([\]}])/g, "$1")); } catch { /* ignore */ }
  }
  if (!Array.isArray(chords)) return [];
  return chords;
}

async function detectWithGemini(imageData, apiKey) {
  const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash-8b"];
  const body = JSON.stringify({ contents: [{ parts: [
    { inlineData: { mimeType: "image/jpeg", data: imageData } },
    { text: CHORD_PROMPT },
  ]}]});
  let result = null;
  for (let i = 0; i < models.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "content-type": "application/json" }, body }
    );
    const d = await res.json();
    if (d.error) {
      const msg = d.error.message || "";
      if (d.error.code === 429 || /quota|resource_exhausted|rate|high demand|overloaded|temporarily|try again/i.test(msg)) continue;
      throw new Error(msg || "Gemini 오류");
    }
    result = d;
    break;
  }
  if (!result) throw new Error("쿼터 초과 — 잠시 후 재시도");
  return parseChordResponse(result.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

async function detectWithGroq(imageData, apiKey) {
  const models = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview",
  ];
  const content = [
    { type: "text", text: CHORD_PROMPT },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } },
  ];
  for (const model of models) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 1024, temperature: 0 }),
    });
    const d = await res.json();
    if (d.error) {
      const msg = d.error.message || "";
      if (/decommissioned|deprecated|not supported|unavailable|does not exist|no access|high demand|overloaded|temporarily|try again/i.test(msg)) continue;
      throw new Error(msg || "Groq 오류");
    }
    return parseChordResponse(d.choices?.[0]?.message?.content || "");
  }
  throw new Error("Groq 사용 가능한 모델 없음");
}

// FCM 푸시 알림 전송 — Supabase Edge Function 경유
export async function sendFcmPush(title, body) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-fcm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify({ title, body }),
    });
    return res.json();
  } catch (e) {
    console.warn("FCM 푸시 실패:", e);
    return null;
  }
}

// 코드 감지: Edge Function → 개인 키(Gemini/Groq) 순으로 시도
export async function detectChordsViaEdge(imageData, userApiKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/detect-chords`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify({ imageData }),
    });
    if (!res.ok) throw new Error(`edge ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.chords;
  } catch {
    const apiKey = userApiKey || import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("AI 키를 프로필에서 설정해주세요 (Groq 무료 키 사용 가능)");
    if (apiKey.startsWith("gsk_")) return detectWithGroq(imageData, apiKey);
    return detectWithGemini(imageData, apiKey);
  }
}

export async function uploadPdf(file, songId) {
  const path = `${songId}.pdf`;
  const { error } = await supabase.storage
    .from("pdfs")
    .upload(path, file, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("pdfs").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

// 예배 녹음 — Supabase Storage JSON 파일로 저장/읽기 (Firestore 할당량 완전 우회)
const REC_BUCKET = "pdfs";
const recPath = (docId) => `recordings/${docId}.json`;

export async function saveWorshipRecording(docId, data) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const { error } = await supabase.storage.from(REC_BUCKET).upload(recPath(docId), blob, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

export async function loadWorshipRecording(docId) {
  const { data, error } = await supabase.storage.from(REC_BUCKET).download(recPath(docId));
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

export async function deleteWorshipRecordingPart(docId, part) {
  const current = await loadWorshipRecording(docId);
  if (!current) return;
  delete current.parts[part];
  const blob = new Blob([JSON.stringify(current)], { type: "application/json" });
  await supabase.storage.from(REC_BUCKET).upload(recPath(docId), blob, { contentType: "application/json", upsert: true });
}

export async function updateWorshipRecordingPart(docId, part, driveId, title) {
  const current = (await loadWorshipRecording(docId)) || { parts: {} };
  current.parts = current.parts || {};
  current.parts[part] = driveId;
  if (title !== undefined) current.title = title;
  current.updatedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(current)], { type: "application/json" });
  await supabase.storage.from(REC_BUCKET).upload(recPath(docId), blob, { contentType: "application/json", upsert: true });
}

export async function uploadImage(file, songId) {
  const ext  = file.type.includes("png") ? "png" : "jpg";
  const path = `img_${songId}.${ext}`;
  const { error } = await supabase.storage
    .from("pdfs")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("pdfs").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}
