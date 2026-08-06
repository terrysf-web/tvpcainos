import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

// 게스트(SFFBC) 빌드: index.html·매니페스트·아이콘·FCM 서비스워커를 게스트용으로 교체
function guestBranding(env) {
  const fb = {
    apiKey:            env.VITE_FB_API_KEY,
    authDomain:        env.VITE_FB_AUTH_DOMAIN,
    projectId:         env.VITE_FB_PROJECT_ID,
    storageBucket:     env.VITE_FB_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FB_MSG_SENDER_ID,
    appId:             env.VITE_FB_APP_ID,
  };
  return {
    name: "guest-branding",
    transformIndexHtml(html) {
      return html
        .replace(/<title>[^<]*<\/title>/, "<title>SFFBC Worship</title>")
        .replace(/href="\/manifest\.json"/, 'href="/manifest-guest.json"')
        .replace(/href="\/icon-192\.png"/g, 'href="/sffbc-icon-192.png"')
        .replace(/(<meta name="description" content=")[^"]*(")/, "$1SFFBC 예배팀 악보·예배 앱$2");
    },
    // 빌드 후 dist의 FCM 서비스워커를 게스트 프로젝트 설정으로 재작성
    closeBundle() {
      if (!fb.projectId) return; // env 없으면 건너뜀
      const swPath = path.resolve("dist/firebase-messaging-sw.js");
      if (!fs.existsSync(swPath)) return;
      let sw = fs.readFileSync(swPath, "utf8");
      sw = sw
        .replace(/firebase\.initializeApp\(\{[\s\S]*?\}\);/, `firebase.initializeApp(${JSON.stringify(fb)});`)
        .replace(/"TVPC Worship"/g, '"SFFBC Worship"')
        .replace(/\/icon-192\.png/g, "/sffbc-icon-192.png");
      fs.writeFileSync(swPath, sw);
    },
  };
}

// 범용 팀 브랜딩 — .env.<mode> 의 VITE_APP_TITLE / VITE_MANIFEST / VITE_ICON 로 제목·아이콘·매니페스트 교체
// (새 교회/팀은 .env.<mode> 만 만들고 `vite build --mode <mode>` 로 빌드)
function teamBranding(env) {
  const fb = {
    apiKey:            env.VITE_FB_API_KEY,
    authDomain:        env.VITE_FB_AUTH_DOMAIN,
    projectId:         env.VITE_FB_PROJECT_ID,
    storageBucket:     env.VITE_FB_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FB_MSG_SENDER_ID,
    appId:             env.VITE_FB_APP_ID,
  };
  const title    = env.VITE_APP_TITLE || "Worship";
  const manifest = env.VITE_MANIFEST;  // 예: manifest-remembrance.json (없으면 기본)
  const icon     = env.VITE_ICON;      // 예: remembrance-icon-192.png (없으면 기본)
  return {
    name: "team-branding",
    transformIndexHtml(html) {
      let out = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
      if (manifest) out = out.replace(/href="\/manifest\.json"/, `href="/${manifest}"`);
      if (icon)     out = out.replace(/href="\/icon-192\.png"/g, `href="/${icon}"`);
      out = out.replace(/(<meta name="description" content=")[^"]*(")/, `$1${title} 예배·악보 앱$2`);
      return out;
    },
    closeBundle() {
      if (!fb.projectId) return;
      const swPath = path.resolve("dist/firebase-messaging-sw.js");
      if (!fs.existsSync(swPath)) return;
      let sw = fs.readFileSync(swPath, "utf8");
      sw = sw.replace(/firebase\.initializeApp\(\{[\s\S]*?\}\);/, `firebase.initializeApp(${JSON.stringify(fb)});`)
             .replace(/"TVPC Worship"/g, `"${title}"`);
      if (icon) sw = sw.replace(/\/icon-192\.png/g, `/${icon}`);
      fs.writeFileSync(swPath, sw);
    },
  };
}

// 빌드마다 고유 ID — 배포 시 version.json에 기록, 앱은 이 값과 비교해 새 버전 자동 감지
function writeBuildId(buildId) {
  return {
    name: "write-build-id",
    closeBundle() {
      const p = path.resolve("dist/version.json");
      let obj = {};
      try { obj = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* 없으면 새로 */ }
      obj.build = buildId;
      fs.writeFileSync(p, JSON.stringify(obj));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isNamedTeam = mode !== "guest" && mode !== "production" && mode !== "development";
  const BUILD_ID = String(Date.now());
  return {
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
    plugins: [
      react(),
      mode === "guest" && guestBranding(env),
      isNamedTeam && env.VITE_FB_PROJECT_ID && teamBranding(env),
      writeBuildId(BUILD_ID),
      VitePWA({
        registerType: "autoUpdate",
        manifest: false, // public/manifest.json 유지
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
          globIgnores: ["**/version.json", "**/clear-cache.html"],
          // 팀 배경 이미지 등 큰 PNG(>2MB) 프리캐시 허용 (기본 2MiB → 빌드 실패 방지)
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          skipWaiting: true,
          clientsClaim: true,
          // FCM 서비스 워커는 별도 등록 — 충돌 방지
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/firebase-messaging-sw\.js/, /^\/version\.json/, /^\/clear-cache\.html/],
          runtimeCaching: [{
            urlPattern: /\/version\.json$/,
            handler: "NetworkOnly",
          }],
        },
      }),
    ].filter(Boolean),
    base: "/",
    build: {
      target: "esnext",
    },
  };
});
