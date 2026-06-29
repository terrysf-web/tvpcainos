import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

// 환경변수(VITE_FB_*)가 있으면 그 값(다른 교회용), 없으면 기본 tvpcainos.
// → 같은 코드로 여러 교회 Firebase 프로젝트에 각각 배포 가능 (메인 앱은 기본값 그대로).
const E = import.meta.env;
const firebaseConfig = {
  apiKey:            E.VITE_FB_API_KEY        || "AIzaSyAzXyQA-BbL_0KsTnukODBfMBkIZINxiNM",
  authDomain:        E.VITE_FB_AUTH_DOMAIN    || "tvpcainos.firebaseapp.com",
  projectId:         E.VITE_FB_PROJECT_ID     || "tvpcainos",
  storageBucket:     E.VITE_FB_STORAGE_BUCKET || "tvpcainos.firebasestorage.app",
  messagingSenderId: E.VITE_FB_MSG_SENDER_ID  || "721441022829",
  appId:             E.VITE_FB_APP_ID         || "1:721441022829:web:45a0ee8fc152090b09f064",
};

// 게스트(무료 테스트) 빌드 여부 — AI·PP7·X32 등 비용/장비 기능 숨김
export const GUEST_BUILD = E.VITE_GUEST === "1";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// memoryLocalCache: IndexedDB 대신 메모리 캐시 사용
// → iOS Safari에서 IndexedDB 초기화 실패 시 쓰기가 영구 블로킹되는 문제 해결
// ignoreUndefinedProperties: undefined 필드 자동 제거 (malformed request 방지)
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  ignoreUndefinedProperties: true,
});
export const storage = getStorage(app);
export const FIREBASE_API_KEY = firebaseConfig.apiKey;
export const firebaseConfigObj = firebaseConfig;

// FCM — 지원 여부 확인 후 초기화 (Safari/iOS는 미지원)
export const messagingPromise = isSupported()
  .then(ok => ok ? getMessaging(app) : null)
  .catch(() => null);
