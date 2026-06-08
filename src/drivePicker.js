// Google Drive Picker API 유틸리티
// Safari 브라우저에서 어드민이 파일 선택 시 사용

const DEVELOPER_KEY  = "AIzaSyAzXyQA-BbL_0KsTnukODBfMBkIZINxiNM"; // Firebase API key
const CLIENT_ID      = import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "721441022829-55s9lnlpt88lhla1fcnar429kgp30ajp.apps.googleusercontent.com";

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureGapi() {
  await loadScript("https://apis.google.com/js/api.js");
  if (!window.gapi?.picker) {
    await new Promise(resolve => window.gapi.load("picker", resolve));
  }
}

async function ensureGis() {
  await loadScript("https://accounts.google.com/gsi/client");
}

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error));
        else resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

// 파일 여러 개를 선택하면 docs 배열로 콜백
export async function openDrivePicker(onPicked) {
  if (!CLIENT_ID) {
    alert("VITE_GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.");
    return;
  }

  await Promise.all([ensureGapi(), ensureGis()]);

  const token = await getAccessToken();

  const view = new window.google.picker.DocsView()
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false)
    .setMimeTypes("audio/,video/,application/octet-stream");

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .addView(new window.google.picker.DocsView(window.google.picker.ViewId.DOCS))
    .setOAuthToken(token)
    .setDeveloperKey(DEVELOPER_KEY)
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .setTitle("녹음 파일 선택 — 파트 순서대로 선택하세요")
    .setCallback((data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        onPicked(data.docs);
      }
    })
    .build();

  picker.setVisible(true);
}
