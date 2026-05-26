import { db, storage } from './firebase.js';

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import {
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const uploadBtn = document.getElementById('uploadBtn');

if (uploadBtn) {

  uploadBtn.addEventListener('click', async () => {

    const title = document.getElementById('songTitle').value;
    const key = document.getElementById('songKey').value;
    const file = document.getElementById('pdfFile').files[0];

    if (!file) {
      alert('Select PDF');
      return;
    }

    try {

      const storageRef = ref(storage, `songs/${file.name}`);

      await uploadBytes(storageRef, file);

      const url = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'songs'), {
        title,
        key,
        pdfUrl: url,
        createdAt: new Date()
      });

      alert('Upload Complete');

    } catch (err) {
      console.error(err);
      alert('Upload Failed');
    }

  });

}
