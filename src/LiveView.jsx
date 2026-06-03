import { useState, useEffect, useRef } from "react";

const C = {
  bg:    "#f2f2f7",
  surf:  "#ffffff",
  card:  "#f8f8fb",
  bdr:   "#e5e5ea",
  acc:   "#e8a93e",
  pur:   "#6b5de7",
  grn:   "#34c759",
  txt:   "#1c1c1e",
  dim:   "#8e8e93",
  red:   "#ff3b30",
};

const P = {
  home:    "M3 12L12 3l9 9M5 10v9h4v-5h6v5h4v-9",
  music:   "M9 18V5l12-2v13M6 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0M18 16a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  bell:    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  user:    "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  circle:  "M12 22C6.48 22 2 17.52 2 12S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10z",
  xmark:   "M18 6L6 18M6 6l12 12",
  check:   "M20 6L9 17l-5-5",
};

function Icon({ n, size = 20, color = C.txt, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display:"block", flexShrink:0 }}>
      <path d={P[n] || ""} stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusBadge({ label, status, color }) {
  const statusColor = status === "online" ? C.grn : status === "offline" ? C.red : C.dim;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: C.card, borderRadius: 10, padding: "10px 14px",
      border: `1px solid ${C.bdr}`, marginBottom: 8,
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: "50%",
        background: statusColor, flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.txt }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
          {status === "online" ? "연결됨" : status === "offline" ? "연결 안됨" : "대기중"}
        </div>
      </div>
      <div style={{ fontSize: 12, color: statusColor, fontWeight: 700 }}>
        {status.toUpperCase()}
      </div>
    </div>
  );
}

function AudioLevelBar({ label, level = 0, peak = 0 }) {
  const normalizedLevel = Math.min(100, Math.max(0, level));
  const normalizedPeak = Math.min(100, Math.max(0, peak));
  
  let barColor = C.grn;
  if (normalizedLevel > 80) barColor = C.red;
  else if (normalizedLevel > 60) barColor = C.acc;
  
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 11, color: C.dim, marginBottom: 4, fontWeight: 600,
      }}>
        <span>{label}</span>
        <span>{Math.round(normalizedLevel)} dB</span>
      </div>
      <div style={{
        width: "100%", height: 24, background: C.card,
        borderRadius: 6, overflow: "hidden", border: `1px solid ${C.bdr}`,
        position: "relative",
      }}>
        <div style={{
          height: "100%", width: `${normalizedLevel}%`,
          background: barColor, transition: "width 0.1s",
        }} />
        {normalizedPeak > 0 && (
          <div style={{
            position: "absolute", top: 0, height: "100%",
            left: `${normalizedPeak}%`, width: 2, background: C.red,
          }} />
        )}
      </div>
    </div>
  );
}

export default function LiveView({ user, nav }) {
  const [devices, setDevices] = useState({
    audio: { status: "offline", channels: {} },
    camera: { status: "offline", current: null },
    switcher: { status: "offline", activeInput: null },
    encoder: { status: "offline", bitrate: 0 },
    youtube: { status: "offline", viewers: 0, duration: "00:00:00" },
    lights: { status: "offline", intensity: 0 },
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 임시로 로딩 상태 해제
    setLoading(false);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      {/* 헤더 */}
      <div style={{
        background: C.surf, padding: "20px 20px 16px",
        paddingTop: "calc(20px + env(safe-area-inset-top))",
        borderBottom: `1px solid ${C.bdr}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 2 }}>TVPC Worship</div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>LIVE</div>
        </div>
        <div style={{
          width: 12, height: 12, borderRadius: "50%",
          background: devices.youtube.status === "online" ? C.red : C.dim,
          animation: devices.youtube.status === "online" ? "pulse 1s infinite" : "none",
        }} />
      </div>

      <div style={{ padding: 16, paddingBottom: 90 }}>
        {loading ? (
          <div style={{
            textAlign: "center", padding: "60px 0", color: C.dim,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
            <div style={{ fontWeight: 600 }}>기기 연결 중...</div>
          </div>
        ) : (
          <>
            {/* YouTube Live 상태 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, color: C.dim, fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                marginBottom: 10,
              }}>🔴 YouTube Live</div>
              <div style={{
                background: devices.youtube.status === "online" ? `${C.red}15` : C.card,
                borderRadius: 14, padding: 16, border: `1px solid ${devices.youtube.status === "online" ? `${C.red}44` : C.bdr}`,
              }}>
                <div style{{
                  display: "flex", alignItems: "center", gap: 10,
                  marginBottom: 12,
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 3, background: C.red,
                    animation: devices.youtube.status === "online" ? "pulse 1s infinite" : "none",
                  }} />
                  <div style={{
                    flex: 1, fontWeight: 700, fontSize: 16,
                    color: devices.youtube.status === "online" ? C.red : C.dim,
                  }}>
                    {devices.youtube.status === "online" ? "LIVE" : "오프라인"}
                  </div>
                  <div style={{ fontSize: 13, color: C.dim, fontWeight: 600 }}>
                    {devices.youtube.duration}
                  </div>
                </div>
                <div style={{
                  display: "flex", gap: 8,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: C.dim, marginBottom: 2 }}>시청자</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.txt }}>
                      {devices.youtube.viewers.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 오디오 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, color: C.dim, fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                marginBottom: 10,
              }}>🔊 Audio</div>
              <div style={{
                background: C.card, borderRadius: 14, padding: 14,
                border: `1px solid ${C.bdr}`,
              }}>
                <StatusBadge label="Behringer X32" status={devices.audio.status} />
                <AudioLevelBar label="Main L" level={-12} peak={-8} />
                <AudioLevelBar label="Main R" level={-12} peak={-8} />
              </div>
            </div>

            {/* 카메라 & 스위처 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, color: C.dim, fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                marginBottom: 10,
              }}>🎥 Video</div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <StatusBadge label="Camera 1" status={devices.camera.status} />
                </div>
                <div style={{ flex: 1 }}>
                  <StatusBadge label="Switcher" status={devices.switcher.status} />
                </div>
              </div>
            </div>

            {/* 인코더 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, color: C.dim, fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                marginBottom: 10,
              }}>📡 Encoder</div>
              <div style={{
                background: C.card, borderRadius: 14, padding: 14,
                border: `1px solid ${C.bdr}`,
              }}>
                <StatusBadge label="Blackmagic WebPresenter HD" status={devices.encoder.status} />
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "10px 0", fontSize: 12,
                }}>
                  <span style={{ color: C.dim }}>Bitrate</span>
                  <span style={{ fontWeight: 700, color: C.txt }}>
                    {devices.encoder.bitrate} Mbps
                  </span>
                </div>
              </div>
            </div>

            {/* 조명 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, color: C.dim, fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                marginBottom: 10,
              }}>💡 Lighting</div>
              <StatusBadge label="ChauveDJ Artnet" status={devices.lights.status} />
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
