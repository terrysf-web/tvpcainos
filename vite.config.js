import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // public/manifest.json 유지
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
        skipWaiting: true,
        clientsClaim: true,
        // FCM 서비스 워커는 별도 등록 — 충돌 방지
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/firebase-messaging-sw\.js/],
      },
    }),
  ],
  base: "/",
});
