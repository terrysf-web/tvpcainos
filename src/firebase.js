import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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
export const db = getFirestore(app);
export const storage = getStorage(app);
export const FIREBASE_API_KEY = firebaseConfig.apiKey;
