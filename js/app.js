import { hasFirebase, loadSongs, saveSong, removeSong, uploadPdf } from './firebase.js';

const modeText = document.getElementById('modeText');
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.view');

const titleInput = document.getElementById('songTitle');
const keyInput = document.getElementById('songKey');
const urlInput = document.getElementById('pdfUrl');
const fileInput = document.getElementById('pdfFile');
const uploadBtn = document.getElementById('uploadBtn');
const addUrlBtn = document.getElementById('addUrlBtn');
const songList = document.getElementById('songList');

const leftPane = document.getElementById('leftPane');
const rightPane = document.getElementById('rightPane');

let songs = [];

modeText.textContent = hasFirebase ? 'Firebase connected' : 'Local mode';

tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    views.forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
  });
});

function renderSongs() {
  songList.innerHTML = '';
  if (!songs.length) {
    songList.innerHTML = '<p class="hint">아직 라이브러리에 항목이 없습니다.</p>';
    return;
  }

  songs.forEach(song => {
    const row = document.createElement('div');
    row.className = 'song-item';
    row.innerHTML = `
      <div>
        <div class="song-title">${escapeHtml(song.title || 'Untitled')}</div>
        <div class="song-meta">Key: ${escapeHtml(song.key || '-')}</div>
      </div>
      <div class="song-actions">
        <button data-side="left">Left</button>
        <button data-side="right">Right</button>
        <button class="delete">Delete</button>
      </div>
    `;

    row.querySelector('[data-side="left"]').onclick = () => setPane(leftPane, song);
    row.querySelector('[data-side="right"]').onclick = () => setPane(rightPane, song);
    row.querySelector('.delete').onclick = async () => {
      await removeSong(song.id);
      songs = songs.filter(s => s.id !== song.id);
      renderSongs();
    };

    songList.appendChild(row);
  });
}

function setPane(pane, song) {
  pane.className = 'pdf-pane';

  if (!song.pdfUrl) {
    pane.innerHTML = `<div class="empty" style="height:100%;padding:24px;">PDF URL이 없습니다.</div>`;
    return;
  }

  const encodedUrl = encodeURI(song.pdfUrl);
const viewerUrl = `./viewer.html?file=${encodedUrl}`;
  pane.innerHTML = `<iframe src="${viewerUrl}" title="${escapeHtml(song.title || 'PDF')}"></iframe>`;
}

document.getElementById('clearLeft').onclick = () => {
  leftPane.className = 'pdf-pane empty';
  leftPane.textContent = '라이브러리에서 Left를 선택하세요.';
};

document.getElementById('clearRight').onclick = () => {
  rightPane.className = 'pdf-pane empty';
  rightPane.textContent = '라이브러리에서 Right를 선택하세요.';
};

uploadBtn.onclick = async () => {
  const title = titleInput.value.trim();
  const key = keyInput.value.trim();
  const file = fileInput.files[0];

  if (!title) return alert('곡 제목을 입력하세요.');
  if (!file) return alert('PDF 파일을 선택하세요.');
  if (file.type !== 'application/pdf') return alert('PDF 파일만 업로드 가능합니다.');

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading 0%...';

  try {
    const pdfUrl = await uploadPdf(file, (progress) => {
      uploadBtn.textContent = `Uploading ${progress}%...`;
    });

    uploadBtn.textContent = 'Saving...';

    const saved = await saveSong({ title, key, pdfUrl, fileName: file.name });
    songs.unshift(saved);
    clearForm();
    renderSongs();

    alert('Upload complete');
  } catch (e) {
    console.error(e);
    alert(`업로드 실패: ${e.message || e.code || 'Unknown error'}\nFirebase Storage Rules 또는 Storage Bucket을 확인하세요.`);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload PDF';
  }
};

addUrlBtn.onclick = async () => {
  const title = titleInput.value.trim();
  const key = keyInput.value.trim();
  const pdfUrl = urlInput.value.trim();

  if (!title) return alert('곡 제목을 입력하세요.');
  if (!pdfUrl) return alert('PDF URL을 입력하세요.');

  const saved = await saveSong({ title, key, pdfUrl, fileName: '' });
  songs.unshift(saved);
  clearForm();
  renderSongs();
};

function clearForm() {
  titleInput.value = '';
  keyInput.value = '';
  urlInput.value = '';
  fileInput.value = '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[s]));
}

(async function init() {
  songs = await loadSongs();
  renderSongs();
})();
