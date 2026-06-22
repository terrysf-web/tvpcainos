import { useState } from "react";
import { C } from "./theme.js";
import { Icon } from "./ui.jsx";

export const HELP_ITEMS = [
  // ㄱ
  { icon:"search",    name:"검색",              eng:"Search",        ini:"ㄱ", desc:"악보 제목 또는 아티스트 이름으로 악보를 검색합니다." },
  { icon:"send",      name:"공유",              eng:"Share",         ini:"ㄱ", desc:"카카오톡으로 예배 악보 목록을 공유합니다. 처음 공유 시 \"예배 악보가 등록 되었어요. 연습을 준비해 주세요!\", 두 번째부터는 \"예배 악보가 업데이트 되었어요.\" 메시지가 포함됩니다. 공유 횟수가 버튼 배지에 표시됩니다." },
  { icon:"pen",       name:"그리기(펜)",        eng:"Draw / Pen",    ini:"ㄱ", desc:"악보 위에 자유곡선으로 필기합니다. 색상과 굵기를 선택할 수 있습니다. ⚠️ 그리기 모드가 켜져 있는 동안에는 손가락 스와이프로 페이지를 넘길 수 없습니다." },
  // ㄴ
  { icon:"back",      name:"나가기",            eng:"Back",          ini:"ㄴ", desc:"이전 화면으로 돌아갑니다." },
  { icon:"pen",       name:"내 필기 배지",      eng:"My Annotation Badge", ini:"ㄴ", desc:"악보 카드에 보라색 ✏ '내 필기' 배지가 표시되면 해당 악보에 내가 필기한 내용이 있습니다. 배지를 탭하면 바로 악보 뷰어로 이동합니다. 내 필기는 나만 볼 수 있습니다." },
  // ㄷ
  { icon:"next",      name:"다음 페이지",       eng:"Next Page",     ini:"ㄷ", desc:"악보의 다음 페이지로 이동합니다. ⚠️ 그리기·형광펜·도형 등 쓰기 모드가 켜진 상태에서는 이 버튼 외 스와이프 페이지 이동은 불가합니다." },
  { icon:"xmark",     name:"닫기",              eng:"Close",         ini:"ㄷ", desc:"현재 화면이나 모달을 닫습니다." },
  { icon:"help",      name:"도움말",            eng:"Help",          ini:"ㄷ", desc:"각 기능의 아이콘·이름·설명을 확인합니다. 악보 뷰어에서는 상단 ⋯ 더보기 버튼 → 도움말로, 그 외 화면에서는 내 정보 → 도움말로 열 수 있습니다. 한글 자음 탭 또는 영문 알파벳 탭으로 분류하거나 검색창에서 기능을 찾을 수 있습니다." },
  { icon:"note",      name:"더보기 메뉴 (⋯)",   eng:"More Menu",     ini:"ㄷ", desc:"폰 화면에서 악보 뷰어 상단 ⋯ 버튼을 탭하면 보조 기능 패널이 펼쳐집니다. 필기·메모·녹음·재생·FIT·다운로드·DUAL·미디어·전조·도움말이 포함되어 있습니다. 기능을 선택하면 패널이 자동으로 닫힙니다. 태블릿(아이패드)에서는 기존 상단 툴바에 모든 버튼이 표시됩니다." },
  { icon:"dual",      name:"두 화면(Dual)",     eng:"Dual View",     ini:"ㄷ", desc:"두 악보를 화면 좌우에 나란히 표시합니다. 예배 중 두 곡을 동시에 볼 때 유용합니다. ⚠️ 두 화면 모드에서는 ① 미디어 패널(유튜브·AI 분석) 사용 불가, ② 각 악보의 1페이지만 표시, ③ 스와이프가 페이지 이동 대신 곡 전환으로 동작합니다. 코드 감지·전조는 전조 툴바에서 왼쪽/오른쪽 각각 사용 가능합니다." },
  { icon:"dim",       name:"디미누엔도",        eng:"Diminuendo",    ini:"ㄷ", desc:"악보에 디미누엔도(점점 여리게 >) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅁ
  { icon:"note",      name:"메모 목록",         eng:"Memo / Notes",  ini:"ㅁ", desc:"악보에 추가된 메모 패널을 엽니다. 팀 전체가 보는 공유 메모(👥)와 나만 보는 개인 메모(🔒)를 함께 확인하고, 페이지 번호를 탭하면 해당 페이지로 바로 이동합니다." },
  // ㅅ
  { icon:"rect",      name:"사각형",            eng:"Rectangle",     ini:"ㅅ", desc:"악보 위에 사각형 도형을 그립니다. 시작점 터치 후 끝점까지 드래그하세요. ⚠️ 도형 그리기 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"sideR",     name:"미디어 패널",       eng:"Media Panel",   ini:"ㅅ", desc:"화면 오른쪽에 미디어 패널을 펼칩니다. 유튜브 영상 재생과 AI 악보 분석을 제공합니다. ⚠️ 두 화면(Dual) 모드에서는 사용할 수 없습니다. 두 화면 모드에서 코드 감지는 미디어 패널 없이 전조(🎵) 버튼에서 직접 실행합니다." },
  { icon:"trash",     name:"삭제",              eng:"Delete",        ini:"ㅅ", desc:"선택한 악보, 예배, 또는 항목을 삭제합니다. 삭제 후 복구할 수 없습니다." },
  { icon:"line",      name:"선",                eng:"Line",          ini:"ㅅ", desc:"악보 위에 직선을 그립니다. 시작점 터치 후 끝점까지 드래그하세요. ⚠️ 도형 그리기 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"slur",      name:"슬러",              eng:"Slur",          ini:"ㅅ", desc:"악보에 슬러(연결선 ⌢) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"stamp",     name:"스탬프",            eng:"Stamp",         ini:"ㅅ", desc:"악악상기호(pp · f · sfz), 음표, 아티큘레이션 등을 악보 위에 찍습니다. 루페(돋보기)로 정확한 위치를 확인하며 배치할 수 있습니다. ⚠️ 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"undo",      name:"실행 취소",         eng:"Undo",          ini:"ㅅ", desc:"가장 마지막에 그린 필기 또는 도형을 취소합니다. 현재 페이지의 필기에만 적용됩니다." },
  // ㅇ
  { icon:"music",     name:"악보 라이브러리",   eng:"Library",       ini:"ㅇ", desc:"전체 악보 목록을 관리합니다. 리더는 PDF 업로드·편집·삭제가 가능하고, 일반 팀원은 열람만 할 수 있습니다." },
  { icon:"bell",      name:"알림",              eng:"Notifications", ini:"ㅇ", desc:"리더 또는 어드민이 보낸 알림 목록을 확인합니다. 알림은 번호순(최신이 맨 위)으로 표시되며 예배 일자·타입·내용이 함께 표시됩니다.\n\n어드민이 보낸 알림은 빨간색으로 강조되며 '어드민' 배지가 붙어 리더 알림(보라색)과 구별됩니다.\n\n읽지 않은 알림 수가 하단 탭 배지에 표시되고, 앱을 열 때 읽지 않은 알림이 있으면 팝업으로 먼저 안내합니다. 항목을 탭하면 읽음 처리됩니다." },
  { icon:"bell",      name:"알림 보내기",       eng:"Send Notification", ini:"ㅇ", desc:"예배 상세 화면의 종(🔔) 버튼으로 팀원 전체에게 알림을 보냅니다. (리더·어드민 전용) 알림 타입(예배 악보·참고·공지)을 선택하고 내용을 입력한 뒤 전송합니다. 같은 예배에 여러 번 보낼 수 있으며 전송 횟수가 종 버튼 배지에 표시됩니다. FCM 푸시를 통해 앱이 닫힌 팀원에게도 알림이 전달됩니다.\n\n어드민이 보낸 알림은 수신자 화면에서 빨간 테마로 표시됩니다." },
  { icon:"upload",    name:"업로드",            eng:"Upload",        ini:"ㅇ", desc:"PDF 형식의 악보 파일을 업로드합니다. 리더 권한이 있어야 합니다." },
  { icon:"home",      name:"예배",              eng:"Services",      ini:"ㅇ", desc:"예배 목록과 예배 모드를 관리합니다. 예배별 악보 세트를 구성하고 순서를 변경할 수 있습니다. 다가오는 예배는 풀 카드로 강조 표시되고, 지난 예배는 날짜·제목·곡수만 표시하는 미니 리스트로 접혀 있습니다. 3개 이상이면 '더 보기' 버튼으로 펼칩니다." },
  { icon:"circle",    name:"원",                eng:"Circle",        ini:"ㅇ", desc:"악보 위에 원 도형을 그립니다. 시작점 터치 후 드래그하세요. ⚠️ 도형 그리기 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"prev",      name:"이전 페이지",       eng:"Prev Page",     ini:"ㅇ", desc:"악보의 이전 페이지로 이동합니다. ⚠️ 쓰기 모드(그리기·도형·스탬프 등)가 켜진 상태에서는 스와이프 이동이 불가하지만 이 버튼은 동작합니다." },
  // ㅈ
  { icon:"refresh",   name:"전조",              eng:"Transpose",     ini:"ㅈ", desc:"AI가 감지한 코드를 반음 단위로 올리거나 내립니다. +는 반음 올리기, -는 반음 내리기, 0은 원위치입니다. 전조 설정은 내 계정에만 저장되며 다른 팀원 화면에는 보이지 않습니다.\n\n전조 버튼을 껐다 켜도 코드는 유지됩니다.\n\n⚠️ 권한 안내:\n• 멤버: 전조 +/− 사용만 가능\n• 리더·어드민: 코드 감지, 코드 위치 조정, 초기화까지 가능\n\n초기화 버튼(리더·어드민 전용)을 누르면 전조값·코드·크기가 모두 초기화되고 코드 감지 버튼이 다시 나타납니다." },
  { icon:"fitCrop",   name:"자동 맞춤(FIT)",    eng:"Auto Fit",      ini:"ㅈ", desc:"악보 여백을 자동으로 분석해 화면에 꽉 차게 맞춥니다. 다시 누르면 원래 크기로 돌아옵니다. 두 화면 모드에서도 좌우 각각 동작합니다." },
  { icon:"zoomIn",    name:"줌인",              eng:"Zoom In",       ini:"ㅈ", desc:"악보를 확대합니다. 핀치 제스처로도 확대할 수 있습니다. 줌인 상태에서는 화면 오른쪽에 방향 D-패드가 나타나 악보를 상하좌우로 이동할 수 있습니다." },
  { icon:"zoomOut",   name:"줌아웃",            eng:"Zoom Out",      ini:"ㅈ", desc:"악보를 축소합니다. 가운데 % 버튼을 누르면 원래 100% 크기로 즉시 돌아옵니다." },
  { icon:"eraser",    name:"지우개",            eng:"Eraser",        ini:"ㅈ", desc:"필기한 내용을 부분적으로 지웁니다. 하단 슬라이더로 지우개 크기를 조절할 수 있습니다. ⚠️ 지우개 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅊ
  { icon:"plus",      name:"추가",              eng:"Add",           ini:"ㅊ", desc:"새 악보, 예배, 또는 항목을 추가합니다." },
  // ㅋ
  { icon:"music",     name:"코드 감지(AI)",     eng:"Chord Detect",  ini:"ㅋ", desc:"AI(Gemini 또는 Groq)가 악보 이미지에서 코드 기호를 자동 인식합니다. ⚠️ 리더·어드민 전용 기능입니다.\n\n싱글 모드에서는 미디어 패널에서, 두 화면(Dual) 모드에서는 전조 서브툴바에서 왼쪽·오른쪽 각각 실행합니다. API 키가 없으면 서버 키를 우선 사용합니다.\n\n한 번 감지된 코드는 전조 버튼을 켤 때마다 표시됩니다. 전조 버튼을 끄면 숨겨지지만 데이터는 유지됩니다. 초기화 버튼을 누르면 코드가 모두 지워지고 감지 버튼이 다시 활성화됩니다.\n\n코드 라벨 조작(리더·어드민 전용): 드래그로 위치 이동 | 더블탭으로 복사 | 꾹 누르기(0.6초)로 삭제.\n\n전조 +/−는 모든 역할이 개인별로 사용 가능하며 내 계정에만 저장됩니다. 리더가 코드를 감지하거나 위치를 조정하면 팀 전체에 공유되고 악보 라이브러리에도 저장됩니다.\n\n코드 크기(A−/A+)도 저장되어 다음에 열면 그대로 유지됩니다. V·I·II 같은 섹션 마커는 전조되지 않고 그대로 유지됩니다." },
  { icon:"cresc",     name:"크레센도",          eng:"Crescendo",     ini:"ㅋ", desc:"악보에 크레센도(점점 세게 <) 기호를 스탬프로 찍습니다. 스탬프 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  // ㅌ
  { icon:"textT",     name:"텍스트",            eng:"Text",          ini:"ㅌ", desc:"악보 위에 텍스트를 입력합니다. 텍스트 모드가 켜지면 노란색 원형 커서(T)가 손가락 위치를 실시간으로 표시해 입력 위치를 잡는 데 도움을 줍니다. 원하는 위치를 탭하면 입력창이 열리고 커서가 사라집니다. ⚠️ 텍스트 입력 모드 중에는 스와이프 페이지 이동이 불가합니다." },
  { icon:"pen",       name:"팀 필기",           eng:"Team Annotation",ini:"ㅌ", desc:"리더·어드민이 팀 전체를 위해 남기는 필기입니다. 항상 초록색(#347C17)으로 표시되어 개인 필기와 구분됩니다. 악보 뷰어 상단에 '이 페이지에 팀필기가 있습니다' 배너가 표시되고, 악보 카드에도 초록색 '팀 필기' 배지가 붙습니다. 필기 모드에서 👥 버튼을 켜면 팀 필기 모드로 전환됩니다." },
  // ㅍ
  { icon:"user",      name:"파트 선택",         eng:"Part Select",   ini:"ㅍ", desc:"내 정보 화면에서 파트를 복수로 선택할 수 있습니다. 표준 파트(밴드·보컬·기타·드럼 등)는 버튼으로 바로 선택·해제하고, 드롭다운으로 추가 파트를 선택합니다. 기존에 직접 입력한 파트는 태그(×)로 표시되어 개별 삭제할 수 있습니다. 어드민 팀원 관리에서도 동일한 방식으로 멤버 파트를 수정할 수 있습니다." },
  { icon:"user",      name:"프로필",            eng:"Profile",       ini:"ㅍ", desc:"사용자 정보, AI API 키(Gemini/Groq), 알림 설정을 관리합니다. API 키를 등록하면 코드 감지 기능을 우선 사용합니다. 리더·어드민은 공유 AI 키도 설정할 수 있습니다." },
  // ㅎ
  { icon:"highlight", name:"형광펜",            eng:"Highlight",     ini:"ㅎ", desc:"악보 위에 반투명 형광펜으로 중요 부분을 강조합니다. ⚠️ 형광펜 모드가 켜진 동안에는 손가락 스와이프로 페이지를 넘길 수 없습니다." },
  { icon:"check",     name:"확인",              eng:"Check / Select",ini:"ㅎ", desc:"선택 또는 확인 동작을 수행합니다." },
];

export function HelpModal({ onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("전체");
  const KO_TABS = ["전체","ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const EN_TABS = [...new Set(HELP_ITEMS.map(h => h.eng[0].toUpperCase()))].sort();
  const koAvail = new Set(HELP_ITEMS.map(h => h.ini));
  const isEng = t => /^[A-Z]$/.test(t);
  const filtered = HELP_ITEMS.filter(h => {
    const q = query.toLowerCase();
    const matchQ = !q || h.name.includes(q) || h.eng.toLowerCase().includes(q) || h.desc.includes(q);
    const matchC = active === "전체"
      || (isEng(active) ? h.eng[0].toUpperCase() === active : h.ini === active);
    return matchQ && matchC;
  });
  const Tab = ({ c }) => {
    const hasItems = c === "전체" || (isEng(c) ? true : koAvail.has(c));
    return (
      <button key={c} onClick={() => { setActive(c); setQuery(""); }}
        disabled={!hasItems}
        style={{ padding:"4px 9px", borderRadius:14, border:"none", cursor: hasItems ? "pointer" : "default",
          flexShrink:0, fontSize:13, fontWeight:600,
          background: active === c ? C.pur : C.card,
          color: active === c ? "#fff" : hasItems ? C.txt : C.bdr,
          opacity: hasItems ? 1 : 0.4,
        }}>{c}</button>
    );
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:2000, display:"flex", flexDirection:"column" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:C.surf, display:"flex", flexDirection:"column",
        height:"100%", maxWidth:560, width:"100%", margin:"0 auto",
        paddingTop:"env(safe-area-inset-top)" }}>
        <div style={{ padding:"16px 16px 12px", borderBottom:`1px solid ${C.bdr}`,
          display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <div style={{ flex:1, fontWeight:700, fontSize:18 }}>도움말</div>
          <button onClick={onClose} style={{
            background:C.card, border:`1px solid ${C.bdr}`, borderRadius:10,
            cursor:"pointer", padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center",
            minWidth:40, minHeight:40,
          }}>
            <Icon n="xmark" size={22} color={C.dim} />
          </button>
        </div>
        <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.bdr}`, flexShrink:0 }}>
          <div style={{ background:C.card, borderRadius:10, padding:"8px 12px",
            display:"flex", gap:8, alignItems:"center", border:`1px solid ${C.bdr}` }}>
            <Icon n="search" size={15} color={C.dim} />
            <input value={query} onChange={e => { setQuery(e.target.value); setActive("전체"); }}
              placeholder="기능 검색 (한글 또는 영문)..."
              style={{ border:"none", background:"none", flex:1, fontSize:14, color:C.txt, outline:"none" }} />
            {query && <button onClick={() => setQuery("")} style={{ background:"none", border:"none", cursor:"pointer", padding:0 }}>
              <Icon n="xmark" size={14} color={C.dim} />
            </button>}
          </div>
        </div>
        <div style={{ display:"flex", overflowX:"auto", padding:"6px 12px 4px", gap:4, flexShrink:0 }}>
          {KO_TABS.map(c => <Tab key={c} c={c} />)}
        </div>
        <div style={{ display:"flex", overflowX:"auto", padding:"4px 12px 6px", gap:4,
          borderBottom:`1px solid ${C.bdr}`, flexShrink:0 }}>
          {EN_TABS.map(c => <Tab key={c} c={c} />)}
        </div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {filtered.length === 0
            ? <div style={{ textAlign:"center", color:C.dim, padding:40, fontSize:14 }}>검색 결과가 없습니다</div>
            : filtered.map((item, i) => (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12,
                padding:"12px 16px", borderBottom:`1px solid ${C.bdr}` }}>
                <div style={{ width:38, height:38, borderRadius:10, background:`${C.pur}18`,
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                  <Icon n={item.icon} size={18} color={C.pur} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:3 }}>
                    <span style={{ fontWeight:700, fontSize:14, color:C.txt }}>{item.name}</span>
                    <span style={{ fontSize:11, color:C.dim, background:C.card, padding:"1px 6px", borderRadius:6 }}>{item.eng}</span>
                    <span style={{ fontSize:11, color:C.pur, marginLeft:"auto", fontWeight:600 }}>{item.ini}</span>
                  </div>
                  <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))
          }
        </div>
        <div style={{ padding:"12px 16px", paddingBottom:"calc(16px + env(safe-area-inset-bottom))",
          borderTop:`1px solid ${C.bdr}`, flexShrink:0,
          display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ flex:1, fontSize:12, color:C.dim }}>총 {filtered.length}개 기능</span>
          <button onClick={onClose} style={{
            background:C.pur, border:"none", borderRadius:12, cursor:"pointer",
            padding:"12px 32px", display:"flex", alignItems:"center", gap:8,
            boxShadow:"0 2px 10px rgba(107,93,231,0.35)",
          }}>
            <Icon n="xmark" size={18} color="#fff" />
            <span style={{ color:"#fff", fontWeight:700, fontSize:15, fontFamily:"inherit" }}>닫기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
