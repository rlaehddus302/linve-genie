# PRN2 개발자가 고칠 목록 (D-PRN2-09~26 결과)

## dev-web
- [ ] D-PRN2-10·15: 실험 기종이 연결되면(출력 기기든 아니든) 그 연결에서 테스트 "예" 전까지 작업 받기(claim)를 멈추고 서버에는 `connected: false`로 알림. "예" 뒤 `connected: true`+`profileId`. 끊김·다시 잇기(저절로 다시 잇기 포함)면 "예"를 지움. 연결 단위 시험 추가.
- [ ] D-PRN2-11: 테스트 비트맵·PNG 경로에 `?size=<프로필 defaultSize>`를 붙임(웹·앱 모두). 단위 시험의 `$` 끝맺음 정리.
- [ ] D-PRN2-09: 단추 글 "예" 그대로(변경 없음).
- [ ] D-PRN2-23: 농도 범위 밖이라 못 보냈을 때 안내 한 줄(선택).

## dev-server
- [ ] D-PRN2-11: `GET /api/print/test-bitmap`·`/test-png`가 `?size=`를 받음(없으면 50×30, L-1 목록 밖이면 `INVALID_TEMPLATE` item `size`).
- [ ] D-PRN2-12·13·14: 이미 구현대로(확인만).

## dev-device
- [ ] D-PRN2-20: `printerRequestOptions()`의 `optionalServices`에 NIIMBOT 서비스 UUID를 더함(ff00·fd00 유지). 단위 시험 갱신.

## test-e2e / test-domain
- [ ] "네" → "예" 문장 정리(있다면). 출력 기기 상태에서 실험 프린터로 바꾸면 받기 멈춤 → "예" → 재개(D-PRN2-10). 테이프·D110 테스트 인쇄가 `?size=`로 성공(D-PRN2-11). 옵션에 NIIMBOT 서비스 포함(D-PRN2-20).
- [ ] 골든 제안(spec-keeper가 다음에 반영, test-domain은 손대지 않음): list에 `p50_lower` + NIIMBOT 서비스 → NIIMBOT 목록에 들어감(D-PRN2-16).
