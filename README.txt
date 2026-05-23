TVPC Ainos Dual Song/Page v5 ScoreFix

v5에서 악보가 안 보이는 문제를 수정했습니다.
원인 가능성:
- iPad Safari에서 CSS.escape / selector 기반 canvas lookup 문제
- DOM id selector 실패

수정:
- canvas 찾기를 document.getElementById 기반으로 변경
- DOM id를 안전한 문자열로 변환
- PDF 표시 오류 toast 추가

열기:
https://terrysf-web.github.io/tvpcainos/index.html?v=dual-song-page-v5-scorefix
