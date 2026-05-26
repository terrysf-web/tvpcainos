import { firebaseConfig, collectionName } from "./config.js";

let firebaseReady = false;
let db = null;
let fb = null;

export async function initFirebase() {
  const hasConfig = firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId;
  if (!hasConfig) return { ready: false, message: "Local mode" };

  try {
    const appMod = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const app = appMod.initializeApp(firebaseConfig);
    db = fsMod.getFirestore(app);
    fb = fsMod;
    firebaseReady = true;
    return { ready: true, message: "Firebase connected" };
  } catch (error) {
    console.warn("Firebase init failed. Falling back to local mode.", error);
    return { ready: false, message: "Firebase failed · Local mode" };
  }
}

export function isFirebaseReady() {
  return firebaseReady;
}

export async function fetchCloudItems() {
  if (!firebaseReady) return null;
  const snap = await fb.getDocs(fb.collection(db, collectionName));
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function saveCloudItem(item) {
  if (!firebaseReady) return null;
  const ref = item.id ? fb.doc(db, collectionName, item.id) : fb.doc(fb.collection(db, collectionName));
  const data = { ...item, id: ref.id, updatedAt: Date.now() };
  if (!data.createdAt) data.createdAt = Date.now();
  await fb.setDoc(ref, data, { merge: true });
  return data;
}

export async function deleteCloudItem(id) {
  if (!firebaseReady || !id) return;
  await fb.deleteDoc(fb.doc(db, collectionName, id));
}
