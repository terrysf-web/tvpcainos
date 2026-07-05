// 게스트(SFFBC) 빌드는 보컬 구성이 달라 이름 있는 보컬을 빼고 보컬/리드보컬/보컬그룹만 사용
const GUEST_BUILD = import.meta.env.VITE_GUEST === "1";

const VOCAL_PARTS = GUEST_BUILD
  ? [
      { id:"보컬",      emoji:"🎤", label:"보컬" },
      { id:"리드보컬",  emoji:"🎤", label:"리드 보컬" },
      { id:"보컬그룹",  emoji:"🎤", label:"보컬 그룹" },
    ]
  : [
      { id:"보컬그룹",  emoji:"🎤", label:"보컬 그룹" },
      { id:"리드보컬",  emoji:"🎤", label:"리드 보컬" },
      { id:"보컬Jeon",  emoji:"🎤", label:"보컬 Jeon" },
      { id:"보컬Chung", emoji:"🎤", label:"보컬 Chung" },
      { id:"보컬Lee",   emoji:"🎤", label:"보컬 Lee" },
    ];

export const PARTS = [
  { id:"전체",      emoji:"🎵", label:"전체" },
  { id:"밴드",      emoji:"🎶", label:"밴드" },
  ...VOCAL_PARTS,
  { id:"기타",      emoji:"🎸", label:"기타" },
  { id:"베이스",    emoji:"🎶", label:"베이스" },
  { id:"드럼",      emoji:"🥁", label:"드럼" },
  { id:"키보드",    emoji:"🎹", label:"키보드" },
  { id:"피아노",    emoji:"🎹", label:"피아노" },
  { id:"일렉기타",  emoji:"⚡", label:"일렉기타" },
  { id:"FOH",       emoji:"🎚", label:"FOH" },
];

export const VOCALIST_PART_IDS = new Set(VOCAL_PARTS.map(p => p.id));
export const SHEET_SYNC_INST_PARTS = ["밴드","기타","베이스","드럼","키보드","피아노","일렉기타"];
export const DEFAULT_SHEET_PARTS   = ["밴드","기타","베이스","드럼","키보드","피아노","일렉기타"];
export const GROUP_PART_IDS = new Set(["밴드", "보컬그룹"]);

export const CUE_SECTIONS = ["전체","Intro","Verse","Chorus","Bridge","Outro"];

export const INST_MODES = [
  { id:"piano",    emoji:"🎹", label:"피아노" },
  { id:"guitar",   emoji:"🎸", label:"기타" },
  { id:"drum",     emoji:"🥁", label:"드럼" },
  { id:"bass",     emoji:"🎶", label:"베이스" },
  { id:"other",    emoji:"🎵", label:"기타 악기" },
  { id:"ensemble", emoji:"🎼", label:"앙상블" },
];

export const getUserParts = (u) => u?.parts?.length ? u.parts : (u?.part ? [u.part] : []);
export const isVocalistUser = (u) => getUserParts(u).some(p => VOCALIST_PART_IDS.has(p));
export const getUserDisplayPart = (u) => {
  const parts = getUserParts(u);
  const inst = parts.find(p => !GROUP_PART_IDS.has(p) && p !== "전체");
  return inst || parts[0] || "";
};

export const isLeader = (role) => role === "leader" || role === "admin";
export const isBroadcast = (role) => role === "broadcast" || isLeader(role);
export const isFoh = (userOrRole) => {
  if (!userOrRole) return false;
  if (typeof userOrRole === "string") {
    return userOrRole === "admin" || userOrRole.toLowerCase() === "foh";
  }
  return userOrRole.role === "admin" ||
         userOrRole.role?.toLowerCase() === "foh" ||
         getUserParts(userOrRole).some(p => p?.toLowerCase() === "foh");
};
