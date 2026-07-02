// 게스트(SFFBC) 빌드는 포인트색을 파랑으로 (로고 지구본 색에 맞춤). 메인은 앰버.
const GUEST = import.meta.env.VITE_GUEST === "1";
export const C = {
  bg:    "#f2f2f7",
  surf:  "#ffffff",
  card:  "#f8f8fb",
  bdr:   "#e5e5ea",
  acc:   GUEST ? "#2f6fd6" : "#e8a93e",
  pur:   "#6b5de7",
  grn:   "#34c759",
  txt:   "#1c1c1e",
  dim:   "#6e6e73",
  red:   "#ff3b30",
};

export const KEY_CLR = {
  C:"#45b87a", D:"#60b4e0", E:"#e07a60", F:"#a060e0",
  G:"#60e0a0", A:"#e8a93e", B:"#7b6af5",
};
export const DARK_KEY = {
  C:"#1a6b40", D:"#1a5c7a", E:"#8a3018",
  F:"#5a1fa0", G:"#1a7a50", A:"#7a4a00", B:"#3d2fa0",
};
export const keyColor = (k) => KEY_CLR[k ? k[0].toUpperCase() : "C"] || C.acc;
export const darkKeyColor = (k) => DARK_KEY[k ? k[0].toUpperCase() : "C"] || "#7a4a00";
