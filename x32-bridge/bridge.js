/**
 * X32 Bridge — Behringer X32 OSC → Firebase Firestore
 *
 * 사전 준비:
 *   1) Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
 *      → 다운로드한 JSON을 이 폴더에 service-account.json 으로 저장
 *   2) npm install
 *   3) node bridge.js
 *
 * X32 IP: 192.168.1.24  (변경 필요 시 아래 X32_IP 수정)
 */
'use strict';

const dgram = require('dgram');
const osc   = require('osc-min');
const admin = require('firebase-admin');

// ── 설정 ──────────────────────────────────────────────
const X32_IP   = '192.168.1.24';
const X32_PORT = 10023;
const MY_PORT  = 10024;   // 이 PC가 수신할 UDP 포트

const GROUPS = [
  { id: 'drum',   chs: [1, 2] },
  { id: 'bass',   chs: [3]    },
  { id: 'guitar', chs: [4]    },
  { id: 'elec',   chs: [5, 6] },
  { id: 'kbd',    chs: [7, 8] },
];

// 뮤트 깜빡 방지 알림용 마이크 채널 (켜져 있는데 무음이 지속되면 앱이 경고). 채널/이름만 바꾸면 됨.
const MICS = [
  { id: 'pastor', ch: 29, label: '목사님' },
];
const MIC_LEVEL_THRESH = 0.06; // 이 값보다 크면 "소리 있음"으로 판단 (미터 0~1). 필요시 튜닝
// ──────────────────────────────────────────────────────

let serviceAccount;
try {
  serviceAccount = require('./service-account.json');
} catch {
  console.error('❌ service-account.json 없음. Firebase 콘솔에서 다운로드 후 이 폴더에 저장하세요.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── 채널 상태 저장소 ──────────────────────────────────
// state['01'] = { fader: 0.8, on: 1 }
//   fader: 0.0~1.0  (X32 linear fader position)
//   on:    1=소리나옴  0=뮤트
const state = {};

// ── UDP 소켓 ──────────────────────────────────────────
const sock = dgram.createSocket('udp4');

sock.on('error', err => {
  console.error('UDP 오류:', err.message);
});

sock.on('message', buf => {
  let msg;
  try { msg = osc.fromBuffer(buf); } catch { return; }

  // /meters/1 → 입력 채널 레벨 블롭 (int32 count + float32 × count). 마이크 무음 감지용
  if (msg.address === '/meters/1') {
    const blob = msg.args?.[0]?.value;
    if (Buffer.isBuffer(blob) && blob.length >= 4) {
      const count = blob.readInt32LE(0);
      for (const mic of MICS) {
        const idx = mic.ch - 1; // 입력 채널 1..32 → 인덱스 0..31
        const off = 4 + idx * 4;
        if (idx >= 0 && idx < count && off + 4 <= blob.length) {
          const lvl = blob.readFloatLE(off);
          const c = String(mic.ch).padStart(2, '0');
          if (!state[c]) state[c] = { fader: 0, on: 1 };
          if (lvl > MIC_LEVEL_THRESH) state[c].lastActiveMs = Date.now();
        }
      }
    }
    return;
  }

  // /ch/01/mix/fader  →  fader 값 (float 0~1)
  // /ch/01/mix/on     →  on/off (int 1=켜짐, 0=뮤트)
  const m = msg.address.match(/^\/ch\/(\d{2})\/mix\/(fader|on)$/);
  if (!m) return;

  const ch    = m[1];
  const param = m[2];
  const val   = msg.args?.[0]?.value ?? 0;

  if (!state[ch]) state[ch] = { fader: 0, on: 1 };
  state[ch][param] = typeof val === 'number' ? val : Number(val);
});

// ── OSC 전송 헬퍼 ────────────────────────────────────
function sendOsc(address, args = []) {
  try {
    const buf = osc.toBuffer({ address, args });
    sock.send(buf, X32_PORT, X32_IP);
  } catch (e) {
    console.error('전송 오류:', e.message);
  }
}

// ── X32 폴링 ─────────────────────────────────────────
// /xremote : X32가 이 주소로 업데이트를 보내도록 구독 유지 (10초마다 갱신 필요)
// /ch/XX/mix/fader : 현재 값 요청 (인자 없이 보내면 X32가 값을 응답)
function pollX32() {
  sendOsc('/xremote');
  for (const g of GROUPS) {
    for (const ch of g.chs) {
      const c = String(ch).padStart(2, '0');
      sendOsc(`/ch/${c}/mix/fader`);
      sendOsc(`/ch/${c}/mix/on`);
    }
  }
  for (const m of MICS) {
    const c = String(m.ch).padStart(2, '0');
    sendOsc(`/ch/${c}/mix/on`);
  }
}

// 미터(레벨) 요청 — /meters/1 블롭을 받아 무음 감지에 사용
// 펌웨어별로 방식이 달라 폴링(/meters)과 구독(/subscribe) 둘 다 시도
function pollMeters() {
  if (MICS.length) sendOsc('/meters', [{ type: 's', value: '/meters/1' }]);
}
function renewMeterSub() {
  if (MICS.length) sendOsc('/subscribe', [{ type: 's', value: '/meters/1' }, { type: 'i', value: 1 }]);
}

// ── Firestore 업로드 ──────────────────────────────────
let lastWriteOk = false;

async function pushToFirestore() {
  const groups = GROUPS.map(g => {
    const faderVals = g.chs.map(ch => state[String(ch).padStart(2,'0')]?.fader ?? 0);
    const onVals    = g.chs.map(ch => state[String(ch).padStart(2,'0')]?.on   ?? 1);
    return {
      id:    g.id,
      fader: Math.max(...faderVals),
      muted: onVals.every(v => v === 0), // 모든 채널이 0(뮤트)일 때만 그룹 뮤트
    };
  });

  const now = Date.now();
  const mics = MICS.map(m => {
    const c = String(m.ch).padStart(2, '0');
    const st = state[c] || {};
    const muted = (st.on ?? 1) === 0;
    // 켜져 있는데 마지막 소리 이후 몇 초 지났나 (무음 지속 시간). 뮤트면 0.
    const silentSec = muted ? 0 : Math.max(0, Math.round((now - (st.lastActiveMs ?? now)) / 1000));
    return { id: m.id, ch: m.ch, label: m.label, muted, silentSec };
  });

  try {
    await db.collection('x32').doc('status').set({
      connected: true,
      groups,
      mics,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (!lastWriteOk) {
      console.log('✅ Firestore 연결됨');
      lastWriteOk = true;
    }
  } catch (e) {
    if (lastWriteOk) console.error('Firestore 오류:', e.message);
    lastWriteOk = false;
  }
}

// ── X32 채널 명령 ─────────────────────────────────────
// X32 fader 값: 0.0~1.0 linear (X32 내부 곡선 적용됨)
// /ch/XX/mix/fader  [float]
// /ch/XX/mix/on     [int 0=뮤트, 1=켜짐]

function setFader(channel, value) {
  const c = String(channel).padStart(2, '0');
  sendOsc(`/ch/${c}/mix/fader`, [{ type: 'f', value }]);
  console.log(`🔊 CH${c} fader → ${value.toFixed(3)}`);
}

function setMute(channel, muted) {
  const c = String(channel).padStart(2, '0');
  sendOsc(`/ch/${c}/mix/on`, [{ type: 'i', value: muted ? 0 : 1 }]);
  console.log(`${muted ? '🔇' : '🔊'} CH${c} ${muted ? 'MUTE' : 'UNMUTE'}`);
}

// fade_out: duration초 동안 현재 fader→0 으로 서서히 낮춤 (100ms 간격)
function fadeOut(channel, durationSec) {
  const c    = String(channel).padStart(2, '0');
  const cur  = state[c]?.fader ?? 0.75;
  const steps = Math.max(1, Math.round(durationSec * 10)); // 100ms per step
  let   step  = 0;
  const iv = setInterval(() => {
    step++;
    const ratio = 1 - step / steps;
    const val   = Math.max(0, cur * ratio);
    sendOsc(`/ch/${c}/mix/fader`, [{ type: 'f', value: val }]);
    if (step >= steps) {
      clearInterval(iv);
      setMute(channel, true);
      console.log(`🔇 CH${c} fade_out 완료`);
    }
  }, 100);
}

// ── Automation 구독 ────────────────────────────────────
let lastAutomationPhase = null;

function listenAutomation() {
  db.collection('liveStatus').doc('automation').onSnapshot(snap => {
    if (!snap.exists) return;
    const data = snap.data();
    if (!data?.phase || !data?.x32) return;
    // 같은 phase 중복 실행 방지
    const key = `${data.phase}_${data.svcId || ''}`;
    if (key === lastAutomationPhase) return;
    lastAutomationPhase = key;

    const { type, channel, value, duration } = data.x32;
    const ch = parseInt(channel, 10);
    if (!ch) return;

    console.log(`🎛  Automation: phase=${data.phase} type=${type} ch=${channel}`);
    if (type === 'fader')    setFader(ch, value ?? 0.6);
    if (type === 'fade_out') fadeOut(ch, duration ?? 10);
    if (type === 'mute')     setMute(ch, true);
  }, err => {
    console.error('Automation 구독 오류:', err.message);
  });
}

// ── 시작 ─────────────────────────────────────────────
sock.bind(MY_PORT, () => {
  console.log(`🎛  X32 Bridge 시작`);
  console.log(`   X32 주소: ${X32_IP}:${X32_PORT}`);
  console.log(`   수신 포트: UDP ${MY_PORT}`);
  console.log(`   Firebase: ${serviceAccount.project_id}`);

  pollX32();
  renewMeterSub();
  setInterval(pollX32,          1000);   // 1초마다 X32 폴링 (fader/mute)
  setInterval(pollMeters,        250);   // 0.25초마다 레벨 미터 요청 (무음 감지)
  setInterval(renewMeterSub,    8000);   // 8초마다 미터 구독 갱신 (백업)
  setInterval(pushToFirestore,  1000);   // 1초마다 Firestore 갱신
  listenAutomation();                    // Automation 명령 구독
});

// ── 종료 처리 ─────────────────────────────────────────
async function shutdown() {
  console.log('\n종료 중...');
  try {
    await db.collection('x32').doc('status').update({ connected: false });
    console.log('Firestore: connected=false 기록 완료');
  } catch {}
  sock.close();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
