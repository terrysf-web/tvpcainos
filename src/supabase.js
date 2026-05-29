import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://byvbrsuvporwhlapecja.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dmJyc3V2cG9yd2hsYXBlY2phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc5MDgsImV4cCI6MjA5NTQwMzkwOH0.iEHk3ZH34o4OXZYVqejKRT0ti0VJ7FbFaU728ioGxo8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const CHORD_PROMPT = `You are analyzing a sheet music image. Your task: find every chord symbol printed ABOVE the staff lines.

Chord symbols look like: C, Am, G7, F#m, Bb, Dm7, Cadd9, E/G#, Bm7, Dsus4, etc.
They are TEXT labels placed directly above the musical staff, NOT lyrics below the staff.

For each chord symbol found, measure its CENTER position as a fraction of the TOTAL image size.

Return ONLY a valid JSON array — no markdown, no explanation:
[{"label":"C","cx":0.12,"cy":0.07},{"label":"Am","cx":0.34,"cy":0.07}]

Rules:
- "label": chord text exactly as written (preserve sharps # and flats b)
- "cx": horizontal center of that chord text (0.0=far left, 1.0=far right)
- "cy": vertical center of that chord text (0.0=very top, 1.0=very bottom)
- Measure cx/cy at the CHORD TEXT itself, not at the note below it
- Chords in the same row will have nearly identical cy values
- Be pixel-accurate: if two chords are in different rows, their cy must differ noticeably

Return [] only if truly no chords exist.`;

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
  const models = ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
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
      if (d.error.code === 429 || /quota|resource_exhausted|rate/i.test(msg)) continue;
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
      if (/decommissioned|deprecated|not supported|unavailable|does not exist|no access/i.test(msg)) continue;
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
  return data.publicUrl;
}
