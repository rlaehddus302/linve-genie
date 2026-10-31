# PRN2 보고 — 프린터 지원 단계

2026-10-31 · 상태: 자동 구현·시험·감사 범위 완료. HG-5(실물 프린터 확인)는 미확인. 브랜치 `sprint/PRN2`(int/next 기준 + `origin/spec/printer-stages` + `origin/dev/printer-app`).

## 결과

- **device**: 켠 프로필 표 하나(`PRINTER_PROFILES`) — NIIMBOT B1(확인됨)·B1 SE·B21·D110, Marklife 9종, 바우아토(`LUCKJINGLE`) 모두 실험. 따로 된 실험 목록 없앰. 고르기 목록 판정 `pickListTarget`·`pickListFilter`를 앱·웹이 같이 씀(웹은 `requestDevice` 한 번, `optionalServices` ff00·fd00·NIIMBOT). 바우아토 Luck Jingle 작업 바이트, 끝 알림(Marklife `AA`만, 바우아토만 `4F 4B` — 마지막 조각을 쓰기 시작한 뒤 받은 것만), ff03 없는 꾸러미 A는 크레딧 없이, ff03 조회 오류는 "특성 없음"만 없음. NIIMBOT 모델이 켠 프로필과 다르면 `WRONG_MODEL`(B1 Pro·B21 Pro). 가짜 프린터(TS·Swift)가 바우아토·OK 끝·ff03 없는 기기를 흉내.
- **server**: `POST /api/print/device`·`/device/state`의 `profileId`(표에 있는 값만 기록, 모르면 null, 이름·기기 ID·받은 값 기록·로그 없음, 끊김 때 지움), `QueueSummary.device.profileId`·`labelSizes`. `GET /api/print/jobs/:id/png`·`/api/print/test-png`(비트맵 입구와 같은 검사·오류, 공용 `encodeLabelPng`), 테스트 그림 `?size=`. 마이그레이션 `0030_prn2_printer_profile`(`ADD COLUMN IF NOT EXISTS`).
- **web·app**: 실험 표시("실험" 꼬리표·이름 뒤 "(실험)"·L-7 안내), 실험 기종은 그 연결에서 테스트 "예" 전까지 출력·받기 멈춤(D-PRN2-10·15·29), 프로필별 크기 목록·목록 밖 크기 `LABEL_ERROR` 멈춤과 고치러 가는 단추, 테스트 크기 = 저장 크기가 프로필 목록에 있으면 그 크기(D-PRN2-27), 농도 범위 밖은 보내지 않음, 앱 숨김 스위치(`EXPO_PUBLIC_PRINTER_EXPERIMENTAL`) 제거, 앱 "제조사 앱으로 보내기"(테스트 라벨·찍는 중인 작업 라벨, 서버 PNG 그대로, 상태 바꾸지 않음), 실험 기종 "아니요" 뒤 프로필별 도움말, 프린터 칸 단추 18px·52px.
- **결정**: D-PRN2-09~41 AUTO(spec-keeper). 스펙은 LABEL_RULES L-7·L-11 17·L-12 5 몇 줄, 골든 변경 없음.

## 시험·감사

- 도메인: `tests/adversarial/prn2/` 237개(골든 printer 전부를 웹·앱 두 길로, 표 한 줄 추가가 코드 분기 없이, 끝 알림·이름 경계, 서버 profileId·PNG). 기존 n1·fb1·qs1 시험은 스펙이 바뀐 곳만 근거를 적어 고침. 제품 버그 0.
- E2E: `tests/e2e/prn2/` 20개(실험 표시·"예" 뒤 출력·크기 목록·PNG·테스트 크기·가짜 프린터 출력·휴대폰 390), `i1/attacks` 옛 문장 고침.
- 스펙 감사: AC-PRN2-01~11 충족(10은 D-PRN2-28로 보완). 위험 감사: 높음 0·보통 2(테스트 크기 → D-27로 고침, 마이그레이션 번호 겹침 → 합칠 때). 사용성: 높음 3·보통 6 모두 고침, 012(공통 알림 띠 잘림)만 범위 밖.
- 마지막 `pnpm verify`(e59f4a0d): typecheck·lint·test(499파일 9,397개)·golden(964)·adversarial(176파일 3,174개)·coverage(줄 99.78%·분기 97.85%) 통과. e2e 단계는 앞선 실행이 남긴 E2E 서버가 3100 포트를 잡아 돌지 못함 → 남은 서버를 끄고 e2e 단계만 다시 돌림: 230파일 1,707개 중 **1,705 통과·2 실패**. 실패 둘은 `tests/e2e/i3/youtube.spec.ts:107`(휴대폰 콘솔 고정 영역 높이 294.6 > 284.2)과 `:247`(INV1이 "남의 채널" 문장을 "초대받은 방송 확인" 줄로 바꿈, 8be839d5) — 둘 다 int/next(f4b04dd7)부터 있던 것으로 PRN2 웹 파일을 f4b04dd7판으로 되돌려도 같게 실패함을 확인. PRN2 몫 아님(INV1·YT 갈래 test-e2e 몫).

## 게이트

`check-protected.mjs d605751c`(PRN2 개발 시작점) **실패 2건** — 둘 다 `[spec]` 커밋이 spec 허용 밖 파일을 고친 것: `9988f420`(`harness/sprints/PRN2/decisions-for-dev.md`), `61c12fb5`(`harness/backlog.yaml`, `[harness]` 몫). 내용 문제는 없고 접두어 문제다. 원격 이력 고쳐 쓰기(강제 push)는 권한에서 막혀 하지 않았다. 같은 내용으로 두 커밋을 `[spec]`+`[orch]`/`[harness]`로 나눈 사본을 로컬 브랜치 `prn2-gate-clean`에 두었다(트리 동일, 게이트 통과 확인) — 메인이 합칠 때 그쪽을 쓰면 된다. `BASE`(6024ea1b) 기준으로는 PRN2 밖 3건(스펙 브랜치 `3ac9eead` backlog, INV1 `dev-notes-web.md` 2건)이 더 걸린다.

## 합칠 때 주의

- 마이그레이션 `0030`·journal `when`이 ytsrv·sms3 갈래와 겹친다(RA-PRN2-002) — 번호·`when`을 다시 매기고 빈 DB와 다른 0030이 적용된 DB 둘 다에서 확인.
- `docs/spec/SPEC.md` 버전 줄이 YT-SRV와 PRN2 둘 다 v0.1.72라 두 줄로 남김 — 메인이 정리.
- 서버가 `@livejjim/printer`에 의존하게 됨(`pnpm-lock.yaml` 몇 줄).

## 남은 일(후속)

- 앱에서 멈춘 대기 라벨을 그림 파일로 보내기(서버 규칙 변경 필요, D-PRN2-41), 앱 크기 멈춤 고치러 가기 단추, 공통 알림 띠 잘림(UX-PRN2-012).
- 골든 list에 대소문자만 다른 L-12 이름 + NIIMBOT 서비스 사례 추가(D-PRN2-16 제안, 적대 시험으로는 있음).
- 스펙 "네" 낱말을 "예"로 정리(D-PRN2-38).

## 사람만 할 일 (HG-5)

- 실제 Marklife·바우아토·NIIMBOT B1 SE·B21·D110 한 장씩 출력해 확인됨으로 옮길지 결정. 특히 바우아토 Luck Jingle 바이트·`OK` 끝 알림, 켜기 명령에 `OK`로 답하는지(TD-PRN2-001), 서비스 광고 없이 이름만 보이는 B1이 NIIMBOT 서비스를 여는지.
