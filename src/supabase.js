import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://byvbrsuvporwhlapecja.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dmJyc3V2cG9yd2hsYXBlY2phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc5MDgsImV4cCI6MjA5NTQwMzkwOH0.iEHk3ZH34o4OXZYVqejKRT0ti0VJ7FbFaU728ioGxo8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-8b",
];

const GEMINI_PROMPT = `You are analyzing a sheet music image. Find every chord symbol printed above the staff (like C, Am, G7, F#m, Bb, Dm7, Cadd9, etc.).
For each chord symbol, provide its center position as a fraction of the total image dimensions.

Return ONLY a JSON array, no other text:
[{"label":"C","cx":0.15,"cy":0.08},{"label":"Am","cx":0.35,"cy":0.08}]

- "label": the chord symbol exactly as printed
- "cx": horizontal center (0.0=left edge, 1.0=right edge)
- "cy": vertical center (0.0=top edge, 1.0=bottom edge)

Be precise. Return [] if no chords found.`;

async function detectChordsDirectly(imageData, apiKey) {
  const body = JSON.stringify({ contents: [{ parts: [
    { inlineData: { mimeType: "image/jpeg", data: imageData } },
    { text: GEMINI_PROMPT },
  ]}]});

  let result = null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[i]}:generateContent?key=${apiKey}`,
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

  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "").trim();

  let chords = null;
  try {
    const p = JSON.parse(cleaned);
    chords = Array.isArray(p) ? p : (p?.chords || p?.items || p?.result || null);
  } catch { /* ignore */ }
  if (!chords) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) try { chords = JSON.parse(m[0]); } catch { /* ignore */ }
  }
  if (!Array.isArray(chords)) throw new Error("응답 파싱 실패");
  return chords;
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

async function detectChordsWithOAuth(imageData, oauthToken) {
  const body = JSON.stringify({ contents: [{ parts: [
    { inlineData: { mimeType: "image/jpeg", data: imageData } },
    { text: GEMINI_PROMPT },
  ]}]});

  let result = null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[i]}:generateContent`,
      { method: "POST", headers: { "content-type": "application/json", "Authorization": `Bearer ${oauthToken}` }, body }
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

  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "").trim();

  let chords = null;
  try {
    const p = JSON.parse(cleaned);
    chords = Array.isArray(p) ? p : (p?.chords || p?.items || p?.result || null);
  } catch { /* ignore */ }
  if (!chords) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) try { chords = JSON.parse(m[0]); } catch { /* ignore */ }
  }
  if (!Array.isArray(chords)) throw new Error("응답 파싱 실패");
  return chords;
}

// 코드 감지: Edge Function → API 키 → Google OAuth 순으로 시도
export async function detectChordsViaEdge(imageData, userApiKey, oauthToken) {
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
    if (apiKey) return detectChordsDirectly(imageData, apiKey);
    if (oauthToken) return detectChordsWithOAuth(imageData, oauthToken);
    throw new Error("__need_oauth__");
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

