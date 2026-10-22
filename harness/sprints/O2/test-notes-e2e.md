# O2 test-e2e 노트 (라운드 0)

## 시험 파일 (`tests/e2e/o2/`)

| 파일 | 수용 기준 |
|---|---|
| `sale-mode.spec.ts` | AC-O2-01·02·04·05·06·10·50 (새 판매자로 — 시험 계정 설정을 건드리지 않는다) |
| `console.spec.ts` | AC-O2-11·12·13·14·16·17·20·21·22·23·24·25(리허설·실제 문자찜)·30(뒤 4자리만), TE-O2-001~003 |
| `reviews.spec.ts` | AC-O2-32·33·34·35·36·37·38·39(375px) |
| `orders.spec.ts` | AC-O2-40(375px)·41·42·43·44 |
| `attacks.spec.ts` | AC-O2-51(이스케이프)·52(사유 낱말), 묶음 보내기 중 끊김 재전송, 두 기기 동시 바로잡기 |

## 실행

- `cd apps/web && E2E_PORT_OFFSET=5500 npx playwright test --project=chromium tests/e2e/o2` (주의: 작업 폴더 이름이 `o2`라 `o2/` 거르기는 모든 시험에 맞는다 — `o2/<파일 이름>`으로 거른다)
- 채팅은 리허설 방송에서만 넣을 수 있어 옵션 리허설 방송(API `saleMode: 'OPTIONS'`)을 쓴다. 가짜 채널은 `sim_` + 닉네임 UTF-8 16진(`simChannel`).
- 15초 안내는 `page.clock.install()` + `runFor(16_000)`.

## 시험 쪽에서 정한 것

- AC-O2-34의 예 `반바지 XLL`은 DOMAIN_RULES R-20 4·5대로 `XL`+`L` 두 선택지로 읽혀 `OPTION_CONFLICT`가 맞다. 골든(G-ENG-O2-01 m6)과 같은 `반바지 XXL`(모르는 말)로 시험한다.
- 마법사 2단계 판매 방식은 고르면 저장이 끝난 뒤에 골라진 것으로 보인다 — `check()` 대신 `click()` 뒤 상태를 기다린다.
- 확인 필요 결과 글("보낸 결과")은 하나씩 8초 보인 뒤 사라진다(세 줄이면 24초) — 목록이 비었는지는 줄 수로 본다.

## 찾은 것

- TE-O2-001: 옵션 상품의 변형 승계 결정 필요(`cancel.succession=ASK`)가 알림 띠·상품 줄에 안 뜬다(`derive.ts` alertCounts·승계 창이 상품 단위 `awaitingSuccession`·`waitlistClaims`만 본다). 변형 충돌도 같은 계열.
- TE-O2-002: 옵션 상품에 1등이 있어도 상품 상세 "판매 종료"가 눌린다(`ProductDetail.tsx` hasClaims가 상품 단위 winners만). 엔진은 막지만 안내 없이 아무 일도 없다.
- TE-O2-003: 옵션 상품에 1등이 있을 때 가격을 바꾸면 "확정된 찜에도 새 가격을 적용할까요?"를 묻지 않는다(`ActionDialogs.tsx` `product.winners.length`).
- 붙은 옵션 + 이미 있는 번호: "고칠까요?" → 예 뒤 옵션은 그 상품에 들어가지 않고 붙은 채 남아 다음 등록 상품에 들어간다(스펙 확인 필요 — 시험 없음).

## 라운드 1 (tests/e2e/o2/round1.spec.ts)

- TE-O2-001~003: 수정 뒤 console.spec.ts의 세 시험이 통과한다(o2 40개 모두 통과). 이어서 변형 둘(M·L)의 승계 결정을 끝까지 — M은 대기자를 1등으로(`host.promote` options M), L은 다시 판매(`host.reopen` options L), 알림 띠 2 → 1 → 알림 없음.
- TE-O2-004(SA-O2-05): dev-notes 5번(떼고 주의 안내)대로 고쳐졌다 — 이미 있는 번호 "고칠까요?"·번호만 친 찾기 모두 안내(`data-tone=warning`)·붙은 옵션 사라짐·이어 친 22는 옵션 없음.
- 깨뜨리기: 옵션 붙인 등록이 서버엔 닿고 응답만 끊김(재시도 모두 실패) → "다시 보내기" 한 번 → 등록 1건·옵션 그대로, 떼었다는 안내 없음. 옵션 붙여 Enter한 사이 휴대폰이 같은 번호를 먼저 등록 → 안내·고칠까요, 옵션은 어느 상품에도 안 들어간다.
- AC-O2-53: 옵션 추가 창 오류(겹침)는 붉은 글자 + role=alert, 확인 필요 목록 줄 3개에도 채운 색 주 버튼 1개, 찜이 생긴 결과 success·"그대로 두었어요" warning, 문자찜 결과 1등 success·확인 필요로 보냄 warning(375px). 주 버튼은 `.button-primary`로 센다.
- 새로 찾은 실패 없음.
