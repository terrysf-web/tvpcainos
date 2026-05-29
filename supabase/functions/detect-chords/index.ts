import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-8b",
];

const PROMPT = `You are analyzing a sheet music image. Find every chord symbol printed above the staff (like C, Am, G7, F#m, Bb, Dm7, Cadd9, etc.).
For each chord symbol, provide its center position as a fraction of the total image dimensions.

Return ONLY a JSON array, no other text:
[{"label":"C","cx":0.15,"cy":0.08},{"label":"Am","cx":0.35,"cy":0.08}]

- "label": the chord symbol exactly as printed
- "cx": horizontal center (0.0=left edge, 1.0=right edge)
- "cy": vertical center (0.0=top edge, 1.0=bottom edge)

Be precise. Return [] if no chords found.`;

// Firebase 서비스 계정으로 OAuth 토큰 발급 (send-fcm와 동일 패턴)
async function getAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const header  = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({
    iss: sa.client_email,
    sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/generative-language",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });

  const pem    = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key    = await crypto.subtle.importKey(
    "pkcs8", keyDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${header}.${payload}`),
  ));
  const b64sig = btoa(String.fromCharCode(...sig))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${b64sig}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth 실패: " + JSON.stringify(data));
  return data.access_token as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { imageData } = await req.json();
    if (!imageData) return new Response(JSON.stringify({ error: "imageData 필요" }), { status: 400, headers: CORS });

    // 인증: GEMINI_API_KEY 우선, 없으면 Firebase 서비스 계정 OAuth
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    let authHeader = "";
    let keyParam   = "";

    if (apiKey) {
      keyParam = `?key=${apiKey}`;
    } else {
      const saStr = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
      if (!saStr) return new Response(JSON.stringify({ error: "인증 정보 없음" }), { status: 500, headers: CORS });
      const token = await getAccessToken(JSON.parse(saStr));
      authHeader = `Bearer ${token}`;
    }

    const body = JSON.stringify({ contents: [{ parts: [
      { inlineData: { mimeType: "image/jpeg", data: imageData } },
      { text: PROMPT },
    ]}]});

    let result = null;
    for (let i = 0; i < MODELS.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[i]}:generateContent${keyParam}`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;

      const res = await fetch(url, { method: "POST", headers, body });
      const d = await res.json();
      if (d.error) {
        const msg = (d.error.message || "") as string;
        if (d.error.code === 429 || /quota|resource_exhausted|rate/i.test(msg)) continue;
        throw new Error(msg || "Gemini 오류");
      }
      result = d;
      break;
    }
    if (!result) throw new Error("쿼터 초과 — 잠시 후 재시도");

    const rawText: string = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "").trim();

    let chords: unknown[] | null = null;
    try {
      const p = JSON.parse(cleaned);
      chords = Array.isArray(p) ? p : (p?.chords || p?.items || p?.result || null);
    } catch { /* ignore */ }
    if (!chords) {
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) try { chords = JSON.parse(m[0]); } catch { /* ignore */ }
    }
    if (!Array.isArray(chords)) throw new Error("응답 파싱 실패");

    return new Response(JSON.stringify({ chords }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
