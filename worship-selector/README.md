# worship.tvpc.church — 팀 선택 페이지

`worship.tvpc.church` (= `anamnesis-301d8.web.app` **기본 사이트**)에 올라가는 정적 선택 페이지.
접속하면 **아이노스 / 아남네시스** 중 팀을 고르고, 각 팀의 앱으로 이동한다.
"이 팀 기억하기"를 켜면 다음부터 자동 이동(초기화는 `?choose=1` 또는 하단 링크).

## 이동 대상
- 아이노스   → https://tvpcainos.web.app
- 아남네시스 → https://anamnesisworship.web.app

## 배포 (자동 — 권장)
GitHub 저장소 시크릿에 **`ANAMNESIS_SERVICE_ACCOUNT`** (아남네시스 프로젝트 서비스계정 JSON)만
등록하면, `main`/개발 브랜치에 push할 때 `.github/workflows/deploy.yml` 의 `anamnesis` 잡이
자동으로 다음을 배포한다:
- 아남네시스 **앱** → `anamnesisworship.web.app` 사이트
- **선택 페이지**(이 폴더) → `anamnesis-301d8.web.app` 기본 사이트 (= worship.tvpc.church)
- Firestore / Storage 규칙 + CORS

## 배포 (수동 — CLI가 있을 때)
아남네시스 프로젝트(`anamnesis-301d8`) 기준. 저장소 루트에서 실행:

```bash
# 선택 페이지 → 기본 사이트(worship.tvpc.church)
firebase deploy --only hosting --project anamnesis-301d8 --config firebase.selector.json

# 아남네시스 앱 → anamnesisworship 사이트 (먼저 npx vite build --mode anamnesis)
firebase deploy --only hosting --project anamnesis-301d8 --config firebase.anamnesis.json
```

> ⚠️ 이 기본 사이트에는 원래 아남네시스 앱이 올라가 있었으나, 앱은
> `anamnesisworship.web.app` 로 이동했으므로 기본 사이트는 선택 페이지 전용이다.
