import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// Google service account → OAuth2 access token (Deno 네이티브 crypto)
async function getAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const header  = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({
    iss: sa.client_email, sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  });

  const pem    = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key    = await crypto.subtle.importKey(
    "pkcs8", keyDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig    = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${header}.${payload}`),
  ));
  const b64sig = btoa(String.fromCharCode(...sig))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${b64sig}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth 실패: " + JSON.stringify(data));
  return data.access_token as string;
}

// Firestore REST API로 FCM 토큰 전체 조회
async function getFcmTokens(accessToken: string): Promise<string[]> {
  const url = "https://firestore.googleapis.com/v1/projects/tvpcainos/databases/(default)/documents/fcmTokens";
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!data.documents) return [];
  return (data.documents as any[])
    .map(d => d.fields?.token?.stringValue)
    .filter(Boolean);
}

// FCM HTTP v1으로 단일 토큰에 푸시
async function sendOne(token: string, title: string, body: string, accessToken: string) {
  return fetch(
    "https://fcm.googleapis.com/v1/projects/tvpcainos/messages:send",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: {
              icon:  "https://tvpcainos.web.app/icon-192.png",
              badge: "https://tvpcainos.web.app/icon-192.png",
              tag:   "worship-notif",
            },
            fcm_options: { link: "https://tvpcainos.web.app/" },
          },
        },
      }),
    },
  ).then(r => r.json());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { title, body } = await req.json();
    if (!title) return new Response("title 필요", { status: 400, headers: CORS });

    const saStr = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!saStr) return new Response("서비스 계정 없음", { status: 500, headers: CORS });

    const sa          = JSON.parse(saStr);
    const accessToken = await getAccessToken(sa);
    const tokens      = await getFcmTokens(accessToken);

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.allSettled(tokens.map(t => sendOne(t, title, body, accessToken)));
    const sent    = results.filter(r => r.status === "fulfilled").length;

    return new Response(JSON.stringify({ ok: true, sent, total: tokens.length }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
