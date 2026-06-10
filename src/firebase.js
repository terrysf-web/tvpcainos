import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
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
