# QL2 test-notes — e2e

## 새 시험 (`tests/e2e/ql2/`)
- `console.spec.ts` — AC-QL2-01~04 (375·412 크로미움 150%·100%, 393 WebKit @webkit, 1440 PC, 리허설·끝난 방송)
- `alerts.spec.ts` — AC-QL2-05~08·40·41 (세는 알림 0 "알림 펼치기", 150% 글자 잘림 0, PC 그대로, 멈춤 알림 문장 셋)
- `reconnect.spec.ts` — AC-QL2-10~15 @printer (가짜 B1·시험용 프린터, 브라우저 시계)
- `labels.spec.ts` — AC-QL2-42·43 ("라벨 빼기" 창, 보류 찜 창 시간·뜻 — 브라우저 시계 고정)
- `assist.spec.ts` — AC-QL2-20·21 @assist, AC-QL2-22 (/privacy)
- `ipad.spec.ts` — AC-QL2-25 @webkit (1024×1366, Macintosh 사파리 + maxTouchPoints 5/0)
- `support.ts` — 공통 전제의 "보인다(첫 화면)"·"글자 잘림 0" 측정

## 바꾼 기존 줄 (AC-QL2-80, 줄마다 `// QL2 D-QL2-0x`)
- `tests/e2e/mob1/station.spec.ts` — 출력 기기 없음 문장(D-QL2-09), 출력 기기 항목 하나뿐일 때 "알림 펼치기"가 있음(D-QL2-02)
- `tests/e2e/s05/scopes.spec.ts` — 출력 기기 없음 문장(D-QL2-09)
- `tests/e2e/a1/support.ts` — 설정 AI 고지(D-QL2-05)
- `tests/e2e/i1/screens.spec.ts` — 판매자 멈춤 알림 문장 두 줄(D-QL2-09)
- `tests/e2e/i1/attacks.spec.ts` — "빼기" 뒤 창 "라벨 빼기"의 "1 빼기"(D-QL2-09)
- `tests/e2e/qs1/reconnect.spec.ts` — AC-QS1-44 출력 기기 아닌 기기의 "다시 연결" 단언 추가(TE-QS1-001 → D-QL2-03)

## 실행 (CI=1 E2E_PORT_OFFSET=3100, 폴더별)
- ql2: 38 통과 / 4 실패 (아래 TE-QL2-001 — 의도한 실패)
- mob1 73 · a1+aiy1+lnd1 90 · i1+qs1+s05/scopes 64 — 모두 통과

## 지적
- **TE-QL2-001 (major, web)** AC-QL2-01 글자 150%: 375×812·412×915에서 현재 상품 "15번"이 829~908px(아래 막대 위 끝 375: 733, 412: 836), 리허설은 962~1086px — 첫 화면에 없다. 100%·393 WebKit은 통과. 실패 시험 `console.spec.ts` "글자 150%" 4개. dev-web이 올린 대로 위 줄·고정 영역·단위 줄을 줄이지 않고는 못 맞춘다 — spec-keeper 결정 필요. file: `apps/web/src/components/ConsolePage.tsx`
- **TE-QL2-002 (spec 확인 필요)** AC-QL2-11 둘째 줄 "오류 상자 '다시 연결' → 고르기 창 수 그대로"는 L-7 (4)·D-QS1-01 (4)(기억한 기기로 이은 시도가 실패하면 기억을 지움)와 어긋난다. 시험은 연결됨까지만 보고 고르기 창 수는 세지 않는다.
- **TE-QL2-003 (minor, 시험 환경)** AC-QL2-20의 "인스타그램 줄"은 E2E로 만들 수 없다 — AI 제안 묶음(chromium-assist)에 가짜 메타가 없다. 리허설 줄로 "뺀 항목 없음"만 봤다. 인스타그램 줄 거르기는 서버 단위 시험(AC-QL2-32)에 기댄다. file: `apps/web/playwright.config.ts`
- 참고: 실제 방송에서 채팅 없이 "충돌"을 만들 수 없어 AC-QL2-01·06의 예(충돌 1)는 보류 찜·출력 멈춤(판매자)으로 바꿨다(세는 알림 둘 그대로).
