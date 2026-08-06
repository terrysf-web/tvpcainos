import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// project → 서비스계정 시크릿 이름 (없으면 기본 tvpcainos)
function saEnvFor(project: string): string {
  if (project === "anamnesis-301d8") return "ANAMNESIS_SERVICE_ACCOUNT";
  if (project === "sffbcainos")      return "SFFBC_SERVICE_ACCOUNT";
  return "FIREBASE_SERVICE_ACCOUNT";
}

// Google service account → OAuth2 access token (Deno 네이티브 crypto)
async function getAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const header  = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({
    iss: sa.client_email, sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
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

// Firestore REST API로 FCM 토큰 조회 → [{uid, token}]
async function getFcmTokens(accessToken: string, pid: string): Promise<{ uid: string; token: string }[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/fcmTokens?pageSize=1000`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!data.documents) return [];
  return (data.documents as any[])
    .map(d => ({ uid: d.fields?.uid?.stringValue || "", token: d.fields?.token?.stringValue || "" }))
    .filter(x => x.token);
}

// 관리자(admin/leader) uid 집합 — users 컬렉션의 role 기준
async function getAdminUids(accessToken: string, pid: string): Promise<Set<string>> {
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/users?pageSize=1000`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  const set = new Set<string>();
  if (!data.documents) return set;
  for (const d of data.documents as any[]) {
    const role = d.fields?.role?.stringValue;
    if (role === "admin" || role === "leader") {
      const uid = (d.name as string).split("/").pop();
      if (uid) set.add(uid);
    }
  }
  return set;
}

// FCM HTTP v1으로 단일 토큰에 푸시
async function sendOne(token: string, title: string, body: string, accessToken: string, pid: string, link: string, icon: string) {
  return fetch(
    `https://fcm.googleapis.com/v1/projects/${pid}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: { icon, badge: icon, tag: "worship-notif" },
            fcm_options: { link },
          },
        },
      }),
    },
  ).then(r => r.json());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { title, body, project, adminOnly, link } = await req.json();
    if (!title) return new Response("title 필요", { status: 400, headers: CORS });

    const proj    = typeof project === "string" && project ? project : "tvpcainos";
    const saStr   = Deno.env.get(saEnvFor(proj)) || Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!saStr) return new Response("서비스 계정 없음", { status: 500, headers: CORS });

    const sa          = JSON.parse(saStr);
    const pid         = sa.project_id as string;
    const accessToken = await getAccessToken(sa);

    let tokens = await getFcmTokens(accessToken, pid);

    // 관리자에게만 (액세스 신청 알림 등)
    if (adminOnly) {
      const adminUids = await getAdminUids(accessToken, pid);
      tokens = tokens.filter(t => t.uid && adminUids.has(t.uid));
    }

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const origin = `https://${pid}.web.app`;
    const icon   = `${origin}/icon-192.png`;
    const target = typeof link === "string" && link ? link : `${origin}/`;

    const results = await Promise.allSettled(
      tokens.map(t => sendOne(t.token, title, body, accessToken, pid, target, icon)),
    );
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
