/**
 * ProPresenter 7 Bridge — Firebase Firestore → ProPresenter REST API
 *
 * 사전 준비:
 *   1) ProPresenter 7 → 설정 → 네트워크 → "네트워크 활성화" ON, 포트 1025
 *   2) Firebase 서비스 계정 JSON → 이 폴더에 service-account.json 으로 저장
 *   3) npm install
 *   4) node bridge.js
 *
 * 동작:
 *   vol_down  (-60s) : PP 오디오는 X32 bridge가 처리 (PP 측 무동작)
 *   piano_on  (-10s) : ProPresenter 오디오 즉시 정지
 *   service_start (0s): ProPresenter 다음 슬라이드로 자동 전환
 */
'use strict';

const admin = require('firebase-admin');
const http  = require('http');

// ── 설정 ──────────────────────────────────────────────
const PP_HOST = 'localhost';
const PP_PORT = 1025;           // ProPresenter 7 기본 포트
// ──────────────────────────────────────────────────────

let serviceAccount;
try {
  serviceAccount = require('./service-account.json');
} catch {
  console.error('❌ service-account.json 없음. Firebase 콘솔에서 다운로드 후 저장하세요.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── ProPresenter 7 REST API 헬퍼 ─────────────────────
// PP7 API 문서: http://localhost:1025 (PP7 실행 중일 때 Swagger UI)
function ppRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: PP_HOST,
      port:     PP_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
      timeout: 3000,
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function ppGet(path)        { return ppRequest('GET',  path); }
async function ppPut(path, body)  { return ppRequest('PUT',  path, body); }
async function ppPost(path, body) { return ppRequest('POST', path, body); }

// ── ProPresenter 명령 ─────────────────────────────────

// 현재 재생 중인 오디오 정지
async function stopAudio() {
  try {
    // PP7 오디오 트랜스포트 정지
    const r = await ppPut('/v1/audio/active/transport/stop');
    if (r.status < 300) {
      console.log('🔇 ProPresenter 오디오 정지됨');
    } else {
      console.warn('⚠️  오디오 정지 응답:', r.status, r.body);
    }
  } catch (e) {
    console.error('오디오 정지 실패:', e.message);
  }
}

// 현재 포커스된 프레젠테이션의 다음 슬라이드로 전환
// (카운트다운 슬라이드 → 예배 시작 슬라이드)
async function triggerNextSlide() {
  try {
    // PP7 next trigger — 슬라이드 순서대로 다음으로 이동
    const r = await ppPut('/v1/presentation/focused/trigger/next');
    if (r.status < 300) {
      console.log('▶️  ProPresenter 다음 슬라이드로 전환');
    } else {
      console.warn('⚠️  슬라이드 전환 응답:', r.status, r.body);
      // 일부 PP7 버전에서는 다른 경로 사용
      await ppPost('/v1/trigger/next');
    }
  } catch (e) {
    console.error('슬라이드 전환 실패:', e.message);
  }
}

// ── ProPresenter 연결 상태 확인 ───────────────────────
async function checkConnection() {
  try {
    const r = await ppGet('/v1/version');
    if (r.status === 200) {
      const ver = r.body?.host?.name || r.body?.version || 'PP7';
      console.log(`✅ ProPresenter 연결됨: ${ver}`);
      return true;
    }
  } catch {}
  console.warn('⚠️  ProPresenter 연결 안됨 (PP7 실행 중인지 확인)');
  return false;
}

// ── Automation Phase 구독 ─────────────────────────────
let lastPhaseKey = null;

function listenAutomation() {
  db.collection('liveStatus').doc('automation').onSnapshot(async snap => {
    if (!snap.exists) return;
    const data = snap.data();
    if (!data?.phase) return;

    const key = `${data.phase}_${data.svcId || ''}`;
    if (key === lastPhaseKey) return;   // 중복 처리 방지
    lastPhaseKey = key;

    console.log(`🎛  Phase: ${data.phase} (svc: ${data.svcId || '-'})`);

    switch (data.phase) {
      case 'piano_on':
        // -10초: PP 오디오 즉시 정지 (X32 bridge도 뮤트 처리)
        await stopAudio();
        break;

      case 'service_start':
        // 0초: 카운트다운 → 예배 시작 슬라이드 자동 전환
        // 짧은 딜레이 후 전환 (BGM 정지 완료 후)
        await new Promise(r => setTimeout(r, 500));
        await triggerNextSlide();
        break;

      default:
        // vol_down, bgm_playing 등 — PP 측 별도 처리 없음
        break;
    }
  }, err => {
    console.error('Automation 구독 오류:', err.message);
  });
}

// ── 시작 ─────────────────────────────────────────────
(async () => {
  console.log('🎬  ProPresenter Bridge 시작');
  console.log(`   PP7 주소: ${PP_HOST}:${PP_PORT}`);
  console.log(`   Firebase: ${serviceAccount.project_id}`);
  console.log('');

  await checkConnection();
  listenAutomation();

  console.log('👂 Firestore liveStatus/automation 구독 중...');
})();

process.on('SIGINT',  () => { console.log('\n종료'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n종료'); process.exit(0); });
