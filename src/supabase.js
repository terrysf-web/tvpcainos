import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://byvbrsuvporwhlapecja.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dmJyc3V2cG9yd2hsYXBlY2phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc5MDgsImV4cCI6MjA5NTQwMzkwOH0.iEHk3ZH34o4OXZYVqejKRT0ti0VJ7FbFaU728ioGxo8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

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

export async function detectChordsViaEdge(imageData) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/detect-chords`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({ imageData }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.chords;
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

