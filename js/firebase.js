import { firebaseConfig } from './config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, getDownloadURL, uploadBytesResumable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export const hasFirebase = !!firebaseConfig.projectId;

let app = null;
export let db = null;
export let storage = null;

if (hasFirebase) {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
}

const LOCAL_KEY = 'ainos_v2_songs';

export async function loadSongs() {
  if (hasFirebase) {
    const snap = await getDocs(collection(db, 'songs'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
}

export async function saveSong(song) {
  if (hasFirebase) {
    const docRef = await addDoc(collection(db, 'songs'), {
      ...song,
      createdAt: serverTimestamp()
    });
    return { id: docRef.id, ...song };
  }

  const songs = await loadSongs();
  const saved = { id: crypto.randomUUID(), ...song, createdAt: new Date().toISOString() };
  songs.unshift(saved);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(songs));
  return saved;
}

export async function removeSong(id) {
  if (hasFirebase) {
    await deleteDoc(doc(db, 'songs', id));
    return;
  }

  const songs = (await loadSongs()).filter(s => s.id !== id);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(songs));
}

export async function uploadPdf(file, onProgress = () => {}) {
  if (!hasFirebase) {
    return URL.createObjectURL(file);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `songs/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);

  return await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: 'application/pdf'
    });

    const timeout = setTimeout(() => {
      task.cancel();
      reject(new Error('Upload timeout. Firebase Storage Rules 또는 네트워크를 확인하세요.'));
    }, 60000);

    task.on(
      'state_changed',
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress(progress);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      async () => {
        clearTimeout(timeout);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}
