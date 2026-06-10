import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyAzXyQA-BbL_0KsTnukODBfMBkIZINxiNM",
  authDomain: "tvpcainos.firebaseapp.com",
  projectId: "tvpcainos",
  storageBucket: "tvpcainos.firebasestorage.app",
  messagingSenderId: "721441022829",
  appId: "1:721441022829:web:45a0ee8fc152090b09f064",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// persistentLocalCache: IndexedDB에 데이터 캐시 → 재접속 시 서버 읽기 대폭 절감
// Firestore 규칙이 수정된 이후 쓰기 블로킹 문제 없음
// IndexedDB 미지원 환경(사파리 사생활 보호 등) → memoryLocalCache 폴백
function makeLocalCache() {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB) return memoryLocalCache();
    return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch {
    return memoryLocalCache();
  }
}
export const db = initializeFirestore(app, {
  localCache: makeLocalCache(),
  ignoreUndefinedProperties: true,
});
export const storage = getStorage(app);
export const FIREBASE_API_KEY = firebaseConfig.apiKey;
export const firebaseConfigObj = firebaseConfig;

// FCM — 지원 여부 확인 후 초기화 (Safari/iOS는 미지원)
export const messagingPromise = isSupported()
  .then(ok => ok ? getMessaging(app) : null)
  .catch(() => null);
