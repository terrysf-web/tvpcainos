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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { imageData } = await req.json();
    if (!imageData) return new Response(JSON.stringify({ error: "imageData 필요" }), { status: 400, headers: CORS });

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "서버 API 키 미설정" }), { status: 500, headers: CORS });

    const body = JSON.stringify({ contents: [{ parts: [
      { inlineData: { mimeType: "image/jpeg", data: imageData } },
      { text: PROMPT },
    ]}]});

    let result = null;
    for (let i = 0; i < MODELS.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[i]}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "content-type": "application/json" }, body }
      );
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
