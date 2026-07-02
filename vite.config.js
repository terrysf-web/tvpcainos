import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// 게스트(SFFBC) 빌드: index.html의 타이틀·매니페스트·아이콘을 게스트용으로 교체
const guestBranding = {
  name: "guest-branding",
  transformIndexHtml(html) {
    return html
      .replace(/<title>[^<]*<\/title>/, "<title>Ainos</title>")
      .replace(/href="\/manifest\.json"/, 'href="/manifest-guest.json"')
      .replace(/href="\/icon-192\.png"/g, 'href="/sffbc_logo.jpg"')
      .replace(/(<meta name="description" content=")[^"]*(")/, "$1Ainos 예배팀 악보·예배 앱$2");
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === "guest" && guestBranding,
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // public/manifest.json 유지
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
        globIgnores: ["**/version.json", "**/clear-cache.html"],
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
}));
