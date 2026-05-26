const uploadBtn = document.getElementById('uploadBtn');
const songList = document.getElementById('songList');

uploadBtn.addEventListener('click', async () => {

  const title = document.getElementById('songTitle').value;
  const key = document.getElementById('songKey').value;
  const file = document.getElementById('pdfFile').files[0];

  if (!file) {
    alert('PDF 선택');
    return;
  }

  const item = document.createElement('div');
  item.style.marginTop = '20px';
  item.style.padding = '12px';
  item.style.background = '#f5f5f5';
  item.style.borderRadius = '10px';

  item.innerHTML = `
    <strong>${title}</strong> (${key})<br>
    ${file.name}
  `;

  songList.appendChild(item);

  alert('업로드 UI 테스트 성공');
});
