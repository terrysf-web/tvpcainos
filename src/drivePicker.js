// Google Drive Picker — Firebase Auth Google OAuth 토큰 사용
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "./firebase.js";

const DEVELOPER_KEY = "AIzaSyAzXyQA-BbL_0KsTnukODBfMBkIZINxiNM";

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.defer = true;
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

async function getAccessToken() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/drive.readonly");
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) throw new Error("Drive 접근 토큰을 가져오지 못했습니다.");
  return credential.accessToken;
}

// 파일 여러 개를 선택하면 docs 배열로 콜백
export async function openDrivePicker(onPicked) {
  await ensureGapi();
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
