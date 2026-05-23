TVPC Ainos - Browser Back Guard

기존 tvpc-worship UI/기능은 그대로 유지했습니다.

수정:
- React 앱이 시작되기 전에 Safari/iPad browser back guard를 먼저 설치합니다.
- iPad edge swipe가 앱을 Home 상태로 복구하는 것을 막는 목적입니다.
- 앱 내부 Back/Services/Song Library 버튼은 그대로 동작합니다.
- Share URL은 tvpcainos 테스트 주소로 고정했습니다.

테스트:
1. tvpcainos에 업로드
2. iPad에서 새로고침
3. Service > 첫 곡 악보 열기
4. 화면 어느 곳에서든 오른쪽/back swipe
5. Home으로 돌아가지 않는지 확인
