import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const PROJECT_ID = "tvpcainos";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { sessionDocId, fields, idToken } = await req.json();
    if (!sessionDocId || !fields || !idToken) {
      throw new Error("sessionDocId, fields, idToken required");
    }

    const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/worshipRecordings/${sessionDocId}`;

    const resp = await fetch(
      `https://firestore.googleapis.com/v1/${docPath}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: docPath, fields }),
      }
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `Firestore HTTP ${resp.status}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("save-recording error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
