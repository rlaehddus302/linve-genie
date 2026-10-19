# S04 리포트 — 저장소·API·실시간 동기화

**결과: FAIL** — 수정 2라운드 뒤에도 `pnpm verify` adversarial 단계 2건 실패(TD-S04-004: ID 칸의 휴대폰 번호가 평문으로 기록됨). blocker 2, major 3 남음.

verify 요약: typecheck·lint·test(57파일 · 1549)·golden(19파일 · 490 통과 · 불일치 0)·coverage(라인 100% · 분기 99.65%) 통과, adversarial 실패(24파일 · 613 · 실패 2). 보호 경로 게이트 통과(BASE 4f9ebde, 스펙 커밋 366c471).

## 영역별로 만든 것

### core (dev-core)
- broadcast.start / broadcast.end 처리: 방송마다 설정 스냅샷, 정산 설정은 그날 첫 방송 것, end는 기록만(AC-01~04).
- `checkSettings` 설정 범위 검사(D-071), initEngine은 범위 밖 설정에 TypeError(AC-05).
- 모든 이벤트에서 표에 없는 필드는 입력 오류(AC-06).
- `containsPhoneNumber`(phone.ts): 숫자 모으기 + 구분자 덩어리(ㅡ·물결·별표 포함) + 번호 배열 판단. sms ref·memo, 입금 메모, 모든 reason, 방송 제목, 상품 이름에 적용(AC-07보다 넓음).
- 상태 형식 4(STATE_FORMAT), 다르면 StateFormatError(AC-08).
- 취소 메시지 변환 금지(D-076), 대기 한도 0의 ASK = AUTO(D-077).
- listBroadcasts·getBroadcast 조회 함수.
- 골든 러너 계약·어댑터 갱신, 읽기 오류 픽스처 17·18·19. 골든 19파일 · 파서 379 · 엔진 111 · 통과 490.
- engine-s04.test.ts 100개, 속성 테스트 AC-S04-92 갱신, 바뀐 규칙에 맞춘 기존 테스트 교체(AC-93).

### server (dev-server)
- Drizzle 스키마·마이그레이션(PGlite 시험): sellers·accounts·sessions·scopes·broadcasts·events·outbox·snapshots·login_limits, DB 유일 제약(AC-20·25).
- 엔진 범위 = (판매자, 날짜), 범위별 직렬 처리 + 어드바이저리 락, 기록 전 거르기, 커밋 후 응답, 엔진 예외는 실패 표시(AC-21~26·30).
- 차단 이어받기(AC-27), 스냅샷·재시작·LRU 범위 캐시(기본 128), check-replay 명령(AC-28·29).
- 문자찜: 서버 생성 ref, 판매자별 키 HMAC phoneKey, 원문 번호 미저장, 금지 린트, 로그 최소화(AC-31~34).
- 로그인: scrypt, 세션 30일·연장, 비밀번호 확인 전 시도 계수로 10회/15분 잠금(경합 해소), 아이디 HMAC 키로 없는 아이디도 같은 응답, Origin·64KB 검사, 판매자 격리(AC-40~42).
- 설정·방송·이벤트·조회·이력 API, SSE, 지연 p99 응답 약 2.6ms(AC-50~53·60·70·94).

## 남은 blocker / major

| ID | 심각도 | 내용 | 제안 |
|---|---|---|---|
| GATE-S04-VERIFY | blocker | adversarial 2건 실패(phone-in-fields.test.ts TD-S04-004). blockBuyer buyer '010-5151-6161'이 기록되고, 차단 이어받기가 다음 범위에 '7171-8181'을 다시 기록 | 아래 SA-S04-006 수정으로 닫힘 |
| SA-S04-006 | blocker | validate.ts:47 `id` 검사가 빈 문자열만 봐서 buyer·from·into·msg·replace의 번호가 events·스냅샷·차단 목록에 평문으로 남음(DAT-06, D-061 위반) | `buyerRef` 검사: 덩어리·배열 판단 또는 "숫자·구분자로만 된 ID"로 좁힌 `looksLikePhoneId`. containsPhoneNumber 전체를 쓰면 base64url 메시지 ID 약 0.19%가 오탐. 채팅 id·ch에는 붙이지 않음. 골든 contract.ts F.buyer·msg와 messages.ts 안내 문장도 맞춤 |
| TD-S04-004 | major | 위와 같은 원인(개인정보). 이어받기가 `!startsWith('sms:')`로 걸러 매일 번짐 | 코어에서 거르기 + 이어받기에서 이미 차단된 번호 모양 ID는 제외 |
| SA-S04-007 | major | withoutPhone이 숫자 모으기 판단까지 써서 '01/05 3개 25,000원' 같은 날짜+금액 글을 거절. 방송 제목에 걸리면 POST /api/broadcasts 400 → 방송 시작 불가 | 덩어리·배열만 보는 `containsPhoneRun`을 따로 두고 sms ref·memo 외 칸에 사용. 골든 noPhoneInText·픽스처 19도 맞춤 |
| SA-S04-003 | major | 구현은 넓어졌는데 R-1·D-073·AC-S04-07·AC-S04-91·골든 README 문장은 'sms ref·memo의 숫자 모으기' 그대로. 러너가 README 밖으로 넓혀짐 | spec-keeper가 검사 칸·구분자·배열을 문장으로 고정하며 (a) 숫자 모으기는 sms ref·memo만 (b) ID 칸은 번호 자체인 ID만 (c) 010 뺀 8자리 처리를 함께 정함 |

## 자율 결정 · 사용자 확인 필요 사항

이번 스프린트의 결정은 모두 AUTO로 적용했고 사용자에게 올린 항목(escalated)은 없다.

| ID | 결정 |
|---|---|
| D-069 | 엔진 범위 = (판매자, 방송 날짜). 새 범위 시작 시 앞 날짜의 유튜브 채널 차단 이어받기 |
| D-070 | 방송별 설정 스냅샷, 정산 설정은 그날 첫 방송, 방송 중 설정 변경은 다음 방송부터 |
| D-071 | 설정값 범위(maxNumber 1~9999 등), 코어가 검사 함수 제공 |
| D-072 | 기록 전 거르기, 이벤트+발송함 한 트랜잭션, 엔진 예외는 실패 표시 후 계속, 유일 제약, 메모리+스냅샷 프로젝션 |
| D-073 | 원문 번호 미저장, 판매자별 키 HMAC, 표 밖 필드 입력 오류, ref·memo 번호 모양 입력 오류 |
| D-074 | 아이디·비밀번호 + 세션 쿠키, 10회/15분 잠금, Origin 검사 |
| D-075 | SSE로 (범위, seq, 종류) 알림만 |
| D-076 | 취소 메시지는 찜으로 변환하지 않음 |
| D-077 | 대기 한도 0이면 ASK = AUTO |
| D-078 | 유튜브 원본 30일 분리는 S10 전에 결정 |

사용자 확인이 필요한 것:
- **HG-4**: 이 스프린트의 휴먼 게이트. FAIL이므로 수정 뒤 다시 확인.
- **D-012 / D-078**: 유튜브 원본 30일 규정의 법률 검토는 계속 사용자 몫(S10 전).
- **휴대폰 번호 판단 범위**(SA-S04-003·007, TD-S04-005): 010을 뺀 8자리, 'ㆍ'·'ㅣ' 구분자, 날짜·금액·계좌 오탐을 어디까지 받을지. 판매자 입력 경험에 직접 닿으므로 spec-keeper 결정 후 확인 권장.
- **재생 시 검사 원칙**(RA-S04-011): 번호 규칙을 넓힐 때 이미 기록된 로그를 어떻게 재생할지 운영 데이터가 쌓이기 전에 정해야 함.

## minor / nit 백로그 (techDebt에 추가함)

- SA-S04-004 (minor): 설정 검사 문장에 영어 'true'·'false' (settings.ts:130)
- RA-S04-003 (minor): SSE에서 seq 읽기와 연결 등록 사이 커밋 알림 유실 (api.ts:237)
- SA-S04-005 (minor): RA-S04-003과 같은 원인
- RA-S04-004 (minor): 로그인 경로에 IP·전체 속도 제한·scrypt 동시 실행 상한 없음 (auth.ts:84)
- RA-S04-006 (minor): 차단 이어받기가 코어 pmap 내부 구조를 직접 훑음 → 코어 `listBlocked` 필요 (service.ts:94)
- RA-S04-007 (minor): 지연 시험이 GET /api/days 재조회 비용·NFR-04 규모를 재지 않음
- RA-S04-008 (minor): scopeSeqs max(seq) GROUP BY 전체 집계 (store.ts:211)
- RA-S04-011 (minor): 글 칸 번호 검사가 재생 때도 돌아 규칙 확장 시 이벤트가 조용히 빠짐
- TD-S04-005 (nit): 'ㆍ' 구분자 미인식, 날짜·금액·계좌 오탐 — 스펙 판단 필요

## 추적성

| 기준 | 구현 | 테스트 |
|---|---|---|
| AC-S04-01 | validate.ts:116, engine.ts | engine-s04, engine-broadcast-isolation, G-ENG-160 |
| AC-S04-02 | reducer.ts 방송별 설정 | engine-s04, engine-broadcast-isolation, G-ENG-160 |
| AC-S04-03 | reducer.ts 첫 방송 정산 설정 | engine-s04, G-ENG-161 |
| AC-S04-04 | validate.ts broadcast.end | engine-s04, engine-broadcast-isolation, G-ENG-162 |
| AC-S04-05 | settings.ts:125 | engine-s04 (문구 SA-S04-004) |
| AC-S04-06 | validate.ts SPECS | engine-s04, engine-properties-s03 |
| AC-S04-07 | phone.ts:81, validate.ts:56-61·76-78 (문장보다 넓음) | engine-s04, phone-in-fields TD-S04-003 회귀(통과) |
| AC-S04-08 | STATE_FORMAT | engine-s04 |
| AC-S04-10 | reducer.ts 취소 변환 금지 | engine-s04, G-ENG-163 |
| AC-S04-11 | reducer.ts 대기 0 ASK | engine-s04, G-ENG-164·165 |
| AC-S04-20 | db/schema.ts, database.ts, config.ts, migrate.ts | schema, commands, config |
| AC-S04-21 | service.ts:175, writer.ts | write-path |
| AC-S04-22 | writer.ts, messages.ts | write-path, api (ID 칸 번호는 실패) |
| AC-S04-23 | writer.ts 커밋 후 응답 | write-path |
| AC-S04-24 | writer.ts, runtime.ts | write-path, runtime-cache |
| AC-S04-25 | schema.ts 유일 제약, api-fields.ts | concurrency, server-regression |
| AC-S04-26 | writer.ts 범위별 직렬 | concurrency, server-regression |
| AC-S04-27 | service.ts:94·189 | inherit-restart, server-regression, runtime-cache, phone-in-fields TD-S04-004(실패) |
| AC-S04-28 | runtime.ts | inherit-restart |
| AC-S04-29 | check-replay.ts | check-replay |
| AC-S04-30 | schema.ts outbox, writer.ts | write-path |
| AC-S04-31 | service.ts:335, api-fields.ts | sms-privacy, server-regression |
| AC-S04-32 | accounts.ts, eslint.config.mjs | secrets, lint-guard |
| AC-S04-33 | service.ts ingestChat | sms-privacy |
| AC-S04-34 | log.ts, app.ts, api.ts | app, sms-privacy (ID 칸 번호는 SA-S04-006) |
| AC-S04-40 | auth.ts:77 | auth, login-lock |
| AC-S04-41 | app.ts CSRF·CORS | auth, config |
| AC-S04-42 | store.ts seller_id | auth |
| AC-S04-50 | api.ts /settings | api |
| AC-S04-51 | api.ts /events | api |
| AC-S04-52 | api.ts /days·/history | api |
| AC-S04-53 | dev-notes 'API 계약' | 문서 검사 |
| AC-S04-60 | hub.ts, api.ts:235 | stream (RA-S04-003 남음) |
| AC-S04-70 | writer.ts → hub | latency (RA-S04-007 남음) |
| AC-S04-90 | 골든 19파일 · 490 | golden 단계, core-adapter |
| AC-S04-91 | contract.ts (README 밖으로 넓어짐) | core-adapter, read-errors (19) |
| AC-S04-92 | 속성 테스트 갱신 | engine-properties-s03 |
| AC-S04-93 | 적대 테스트 교체(80ca7f3) | s02·s03·s03b 갱신본 |
| AC-S04-94 | 서버 시험이 test 단계에서 실행 | test 단계(57 · 1549) |
| DAT-06 | withoutPhone(글 칸), ID 칸 없음 | phone-in-fields — TD-S04-003 통과, TD-S04-004 실패 |

이번 라운드에 추가된 적대 테스트: phone-in-fields.test.ts의 TD-S04-003 회귀 2건(통과), TD-S04-004 2건(실패).

## 다음 스프린트 제안

S04를 다시 열어 짧은 수정 스프린트(S04 재실행 또는 S04b)로 닫은 뒤 S05로 간다.
1. **spec-keeper 먼저**: R-1·D-073(개정 또는 새 결정)·AC-S04-07·AC-S04-91·골든 README를 고친다. 정할 것: 검사 칸, 구분자 목록, 번호 배열, 숫자 모으기는 sms ref·memo만, ID 칸은 번호 자체인 ID만, 010 뺀 8자리, 'ㆍ'·'ㅣ', 재생 시 개인정보 검사 원칙(RA-S04-011).
2. **dev-core**: `looksLikePhoneId`·`containsPhoneRun` 내보내기, `buyerRef` 검사를 buyer·from·into·replace·msg에 적용, 글 칸은 containsPhoneRun으로 교체, 골든 contract.ts·픽스처 19 정리, `listBlocked` 공개, settings.ts 문구 수정.
3. **dev-server**: messages.ts에 ID 칸 안내 문장, 이어받기에서 번호 모양 ID 제외 + listBlocked 사용, SSE 등록 순서 수정(RA-S04-003).
4. S05 전에 RA-S04-007(채팅 1만 범위 재조회 p99)을 재서 ETag·부분 조회 필요 여부를 정한다. RA-S04-004·008은 S12 전까지 처리.

---

## 오케스트레이터 후속 조치 (2026-10-19)

워크플로 결과는 FAIL이었다. 남은 blocker·major 5건은 모두 전화번호 검사 범위 문제다. 숫자 모으기 판단을 글 칸 전체로 넓히자 번호 없는 방송 제목이 거절됐고(SA-S04-007), 거꾸로 ID 칸은 검사가 없어 평문 번호가 로그에 남았다(SA-S04-006).

- 결정: **D-079**(오케스트레이터)로 단순화. 실제 번호 표기만 보는 덩어리 판단 하나를 쓰고, ID 칸은 번호 모양 값만 막고, 재생 때는 다시 검사하지 않는다. 세부는 spec-keeper가 D-080으로 정했다.
- 수정 패스(s04-fixup 워크플로): spec-keeper → test-domain → dev-core → dev-server. SSE 연결 순서 버그(RA-S04-003·SA-S04-005)와 영어 문구(SA-S04-004)도 함께 고쳤다.
- 오케스트레이터 확인
  - `pnpm verify` 6단계 통과: typecheck 174, test 1638, golden 491/491, adversarial 631, coverage 100/99.65.
  - 보호 경로 게이트 통과.
  - 실제 서버 스모크: PGlite 파일 DB, 마이그레이션, 계정 생성, 로그인 순으로 돌렸다.
    - 방송 '01/05 구피 30종 1000원' 생성이 통과했다.
    - 상품 15번을 등록한 뒤 문자찜 2건을 넣으니 1등과 대기로 나뉘었다.
    - 같은 요청 번호를 다시 보내면 첫 결과가 돌아온다.
    - 정산은 14,000원(UNPAID)이고, 라벨·감사 효과는 PENDING이다.
    - DB 파일에 전화번호 평문이 없다.
- 이관
  - RA-S04-006·007·008 → S05
  - RA-S04-004(로그인 속도 제한) → S12
  - D-080 번호 판단 범위 → 사용자 확인 목록
