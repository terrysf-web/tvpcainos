import React from "react";
import { C, KEY_CLR, DARK_KEY, keyColor, darkKeyColor } from "./theme.js";

/* ══════════════════════════════════════════════════════════════════
   SVG ICONS
══════════════════════════════════════════════════════════════════ */
const P = {
  home:    "M3 12L12 3l9 9M5 10v9h4v-5h6v5h4v-9",
  music:   "M9 18V5l12-2v13M6 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0M18 16a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  bell:    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  user:    "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  plus:    "M12 5v14M5 12h14",
  xmark:   "M18 6L6 18M6 6l12 12",
  send:    "M22 2L11 13M22 2L15 22l-4-9-9-4z",
  upload:  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  chevR:   "M9 18l6-6-6-6",
  check:   "M20 6L9 17l-5-5",
  search:  "M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z",
  logout:  "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  pen:     "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  note:    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  dual:    "M3 3h7v18H3zM14 3h7v18h-7z",
  sideR:   "M3 3h18v18H3zM14 3v18",
  zoomIn:  "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM11 8v6M8 11h6",
  zoomOut: "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM8 11h6",
  fitCrop: "M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4",
  prev:    "M15 18l-6-6 6-6",
  next:    "M9 18l6-6-6-6",
  back:    "M19 12H5M12 5l-7 7 7 7",
  refresh: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5",
  chevU:   "M18 15l-6-6-6 6",
  chevD:   "M6 9l6 6 6-6",
  chevL:   "M15 18l-6-6 6-6",
  chevR2:  "M9 18l6-6-6-6",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  tag:     "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  textT:   "M4 6h16M12 6v13M8 19h8",
  eraser:  "M20 20H7L3 16 13 6l8 8-2.5 2.5M9 15l2 2",
  cover:   "M4 8h16v8H4z M8 8V5.5h8V8",
  undo:    "M3 10h13a4 4 0 0 1 0 8H9M3 10l4-4M3 10l4 4",
  download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  highlight:"M3 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17 3 20zM16 5l3 3M15 7l-8 8",
  stamp:   "M9 2h6v3H9zM7 5h10v2H7zM3 7h18v11H3zM2 21h20",
  slur:    "M4 17 Q12 7 20 17",
  cursor:  "M4 4l7 18 3-7 7-3L4 4z",
  cresc:   "M4 12 L20 7 M4 12 L20 17",
  dim:     "M4 7 L20 12 M4 17 L20 12",
  line:    "M4 12 L20 12",
  rect:    "M3 5h18v14H3z",
  circle:  "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
  help:    "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  play:    "M5 3l14 9-14 9V3z",
  pause:   "M6 4h4v16H6zM14 4h4v16h-4z",
  calendar:"M8 2v4M16 2v4M3 8h18M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z",
  clock:   "M12 6v6l4 2M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0z",
  antenna: "M12 9A3 3 0 0 0 12 15M12 9A3 3 0 0 1 12 15M12 6A6 6 0 0 0 12 18M12 6A6 6 0 0 1 12 18M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4",
  megaphone:"M3 11v2a1 1 0 0 0 1 1h2l5 4V7l-5 4H4a1 1 0 0 0-1 1zM19 12a7 7 0 0 0-3-5.83M15.54 16.46A5 5 0 0 0 17 12a5 5 0 0 0-1.46-3.54",
  stop:    "M6 6h12v12H6z",
  mic:     "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8",
  share:   "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  repeat:  "M17 2l4 4-4 4M21 6H7a4 4 0 0 0 0 8h1M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 0-8h-1",
  users:   "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
};

export function Icon({ n, size = 20, color = C.txt, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display:"block", flexShrink:0 }}>
      <path d={P[n] || ""} stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Btn({ label, icon, onClick, variant="primary", disabled=false, full=false, sm=false, style:extra={} }) {
  const V = {
    primary: { bg:C.acc,         txt:"#111", bdr:"none"                   },
    outline: { bg:"transparent", txt:C.acc,  bdr:`1.5px solid ${C.acc}`   },
    ghost:   { bg:"transparent", txt:C.dim,  bdr:`1.5px solid ${C.bdr}`   },
    danger:  { bg:C.red,         txt:"#fff", bdr:"none"                   },
    purple:  { bg:C.pur,         txt:"#fff", bdr:"none"                   },
    green:   { bg:C.grn,         txt:"#fff", bdr:"none"                   },
  };
  const v = V[variant] || V.primary;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        display:"flex", alignItems:"center", justifyContent:"center", gap:6,
        padding: sm ? "6px 14px" : "10px 20px",
        background:v.bg, color:v.txt, border:v.bdr,
        borderRadius:10, fontWeight:600, fontSize: sm ? 13 : 14,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        width: full ? "100%" : "auto",
        fontFamily:"inherit", letterSpacing:"-0.01em",
        transition:"opacity .15s",
        ...extra,
      }}>
      {icon && <Icon n={icon} size={sm?14:16} color={v.txt} />}
      {label}
    </button>
  );
}

export function Badge({ label, color = C.acc }) {
  const DARK = { [C.acc]: "#7a4a00", [C.grn]: "#157a30" };
  const textColor = DARK[color] || color;
  return (
    <span style={{
      background:`${color}22`, color: textColor, border:`1px solid ${color}44`,
      padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700,
      letterSpacing:"0.02em", display:"inline-block",
    }}>{label}</span>
  );
}

export function KeyBadge({ k }) {
  return <Badge label={`Key ${k}`} color={keyColor(k)} />;
}

export function Input({ label, value, onChange, type="text", placeholder="", autoFocus=false }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && (
        <div style={{ fontSize:11, color:C.dim, marginBottom:5, fontWeight:700,
          letterSpacing:"0.06em", textTransform:"uppercase" }}>
          {label}
        </div>
      )}
      <input type={type} value={value} placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
        onChange={e => onChange(e.target.value)}
        style={{
          width:"100%", background:C.card, border:`1.5px solid ${C.bdr}`,
          color:C.txt, padding:"10px 14px", borderRadius:10,
          fontSize:14, outline:"none", fontFamily:"inherit",
        }}
      />
    </div>
  );
}

export function Divider() {
  return <div style={{ height:1, background:C.bdr, margin:"14px 0" }} />;
}

export function Modal({ title, onClose, children, noBackdrop = false }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.45)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:900, backdropFilter:"blur(4px)",
      padding:"16px 16px calc(16px + env(safe-area-inset-bottom)) 16px",
    }}
      onClick={noBackdrop ? undefined : (e => { if (e.target === e.currentTarget) onClose(); })}>
      <div className="wSlideUp modal-sheet" style={{
        background:C.surf, borderRadius:20,
        width:"100%", maxWidth:480,
        overflow:"auto", padding:"24px 20px 28px",
        border:`1px solid ${C.bdr}`,
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:17, letterSpacing:"-0.02em" }}>{title}</div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", padding:4, cursor:"pointer", color:C.dim, display:"flex" }}>
            <Icon n="xmark" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = "확인", danger = false, onConfirm, onClose }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.5)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:1200, backdropFilter:"blur(4px)", padding:"16px",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wSlideUp" style={{
        background:C.surf, borderRadius:20, width:"100%", maxWidth:360,
        padding:"24px 20px 20px", border:`1px solid ${C.bdr}`,
      }}>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:10, color:C.txt }}>{title}</div>
        <div style={{ fontSize:14, color:"#636366", lineHeight:1.6, marginBottom:22 }}>{message}</div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{
            flex:1, padding:"12px 0", borderRadius:12, border:`1px solid ${C.bdr}`,
            background:"transparent", color:C.txt, fontSize:14, fontWeight:700,
            cursor:"pointer", fontFamily:"inherit",
          }}>취소</button>
          <button onClick={onConfirm} style={{
            flex:1, padding:"12px 0", borderRadius:12, border:"none",
            background: danger ? C.red : C.acc, color:"#fff", fontSize:14, fontWeight:700,
            cursor:"pointer", fontFamily:"inherit",
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
