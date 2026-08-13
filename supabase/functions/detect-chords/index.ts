import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const MODELS = [
  "gemini-2.5-pro",        // 흐린 인쇄 코드 OCR에 강함 → 우선 시도
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
];

const PROMPT = `Analyze this sheet music image. Find every PRINTED chord symbol above the staff lines. These are the original engraved/typeset chords (usually small, thin, dark or gray text).

IMPORTANT: IGNORE any handwritten pen/marker annotations (e.g. green, blue, or red handwriting). Only report the ORIGINAL PRINTED chords.

Chord symbols: C, Am, G7, F#m, Bb, Dm7, E/G#, Bm7, Dsus4, C#m, A7, etc.
They appear as short TEXT LABELS in the space above each staff system — NOT the lyrics below the staff. Look carefully: printed chords can be small and faint.

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

Return [] ONLY if there are truly no chord symbols anywhere (printed or handwritten).`;

function parseText(text: string): unknown[] {
  if (!text || !text.trim()) return [];
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[\w]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/,\s*([\]}])/g, "$1")
    .trim();
  let chords: unknown[] | null = null;
  try {
    const p = JSON.parse(cleaned);
    chords = Array.isArray(p) ? p : ((p as Record<string, unknown>)?.chords as unknown[] || null);
  } catch { /* ignore */ }
  if (!chords) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) try { chords = JSON.parse(m[0].replace(/,\s*([\]}])/g, "$1")); } catch { /* ignore */ }
  }
  return Array.isArray(chords) ? chords : [];
}

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

    // Gemini 시도 — 모델별로 생성옵션 구성.
    // 2.5 계열은 thinking(추론)을 끄지 않으면 사고에 출력 토큰을 소진해 정작 답(JSON)이 빈 채로 오는
    // 문제가 있어 thinkingBudget=0으로 비활성화. (모든 악보에서 감지 0개로 나오던 원인)
    let result = null;
    let usedModel = "";
    for (let i = 0; i < MODELS.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      const model = MODELS[i];
      usedModel = model;
      const genCfg: Record<string, unknown> = {
        temperature: 0,
        maxOutputTokens: 2048,
        // 순수 JSON 배열만 반환하도록 강제(산문/마크다운 섞임 → 파싱 0개 방지)
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              label: { type: "STRING" },
              cx: { type: "NUMBER" },
              cy: { type: "NUMBER" },
            },
            required: ["label", "cx", "cy"],
          },
        },
      };
      // flash 계열만 thinking 비활성화(pro는 thinking을 끌 수 없어 제외)
      if (model === "gemini-2.5-flash" || model === "gemini-2.5-flash-lite") genCfg.thinkingConfig = { thinkingBudget: 0 };
      const body = JSON.stringify({ contents: [{ parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageData } },
        { text: PROMPT },
      ]}], generationConfig: genCfg });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent${keyParam}`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;

      const res = await fetch(url, { method: "POST", headers, body });
      const d = await res.json();
      if (d.error) {
        const msg = (d.error.message || "") as string;
        if (d.error.code === 429 || d.error.code === 404 ||
            /quota|resource_exhausted|rate|high demand|overloaded|temporarily|try again|not found|no longer|not supported|deprecat|unavailable/i.test(msg)) continue;
        throw new Error(msg || "Gemini 오류");
      }
      result = d;
      break;
    }

    // Gemini 쿼터 소진 시 Groq 폴백
    if (!result) {
      const groqKey = Deno.env.get("GROQ_API_KEY");
      if (!groqKey) throw new Error("쿼터 초과 — 잠시 후 재시도");
      const groqModels = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "llama-3.2-11b-vision-preview",
        "llama-3.2-90b-vision-preview",
      ];
      for (const model of groqModels) {
        const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } },
            ]}],
            max_tokens: 1024,
            temperature: 0,
          }),
        });
        const gd = await gr.json();
        if (gd.error) {
          const msg = (gd.error.message || "") as string;
          if (/decommissioned|deprecated|not supported|unavailable|does not exist|no access|high demand|overloaded|temporarily|try again/i.test(msg)) continue;
          throw new Error(msg || "Groq 오류");
        }
        const rawText: string = gd.choices?.[0]?.message?.content || "";
        const chords = parseText(rawText);
        return new Response(JSON.stringify({ chords }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      throw new Error("쿼터 초과 — 잠시 후 재시도");
    }

    // 모든 파트의 text를 이어붙임 — 답이 parts[0]이 아닌 다른 파트에 있어도 놓치지 않도록
    const parts = (result.candidates?.[0]?.content?.parts || []) as Array<{ text?: string }>;
    const rawText: string = parts.map(p => p?.text || "").join("").trim();
    const finishReason: string = result.candidates?.[0]?.finishReason || "";
    const chords = parseText(rawText);

    // debug: 0개일 때 원인 특정용 (모델/종료사유/응답 길이·앞부분)
    const debug = {
      model: usedModel,
      finishReason,
      textLen: rawText.length,
      textHead: rawText.slice(0, 180),
    };

    return new Response(JSON.stringify({ chords, debug }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
