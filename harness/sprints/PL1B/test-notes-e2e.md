# PL1B test-notes (test-e2e)

## 쓴 시험 (`tests/e2e/pl1b/**`)
| 파일 | 묶음 | 수용 기준 |
|---|---|---|
| `packing-print.spec.ts` | chromium | AC-PL1B-15·10·11(12품목 2쪽 → "포장 라벨 2장 출력을 접수했어요."·시험용 프린터 2장, 체크·포장 완료로는 요청 0, 두 번째 누름 새 requestId·새 작업 둘, "라벨 PDF"와 같은 부모·주 버튼 아님), AC-PL1B-12(다른 기기에서 끔 → 1초 안 칸 전체 안내·버튼/그림 0, 꺼진 채 새로고침 그림 요청 0, 켬 → 1초 안 돌아옴, 켬/끔 모르는 동안 버튼 없음), 깨뜨리기(응답 끊김 → 같은 requestId 다시 보내 작업 2개, 두 번 탭 → 요청 하나, 대기 중 다시 누름 → 서버 문장 "이 라벨은 이미 출력을 기다리고 있어요." 그대로·작업 그대로), AC-PL1B-11(그림 받는 중에도 누름) |
| `wizard-no-labels.spec.ts` | chromium | AC-PL1B-19·17(새 판매자 1→4, 확인 창 없이 `PUT {enabled:false}` 하나·보내는 동안 이 버튼과 "다음" 잠김, 5/5 제목 포커스·서버 단계 5, 이 기기·다른 기기 메뉴 "라벨" 1초 안에 사라짐, 다른 기기 설정 "라벨 기능: 꺼짐"·바꾼 기록 "라벨 끔 · 아이디", 이전 → 3/5, 리허설 콘솔에 라벨 문장 없음), AC-PL1B-18(네트워크 실패 → 4/5·"인터넷 연결을 확인하고 다시 눌러 주세요."·라벨 켜짐·다시 눌림) |
| `receipt.spec.ts` | chromium-billing (@billing) | AC-PL1B-05·08(1440·375: 라디오 0·안내 두 줄·"증빙 받을 이메일 (선택)"·저장 본문 receiptKind 없음 또는 CASH_RECEIPT·보기 칸 "현금영수증(지출증빙)"·"세금계산서 받을 이메일" 없음), AC-PL1B-06·08(계좌이체 결제 전 문장, 결제 내역 "현금영수증 발행됨 · TEST-…") — 새 판매자로 |
| `voice-flush.spec.ts` | webkit-iphone (@webkit) | AC-PL1B-26(끝 넘김 문자찜 카드 → 10초 동안 쓰기·이력 0, "넣기"로 15번 끝자리 1234 하나, 393px 가로 넘침 없음) |

## 고친 기존 시험 (근거 주석)
- `tests/e2e/n5/billing.spec.ts`: 결제 전 안내 "현금영수증(지출증빙)을 발행해요."(옛 문장 없음), 결제 내역 "현금영수증 발행됨 · TEST-…" — D-PL1-07.
- `tests/e2e/i2/packing.spec.ts`: "B1 버튼 없음" → 포장 라벨 칸에 "포장 라벨 출력" 하나 — D-PL1-05.

## 돌린 범위
- `CI=1 E2E_PORT_OFFSET=84 … playwright test tests/e2e/pl1b tests/e2e/i2/packing.spec.ts tests/e2e/n5/billing.spec.ts` 모두 통과. `packing-print.spec.ts`는 `--repeat-each 2`로도 통과.

## 알아 둘 것
- 포장 라벨 출력 시험은 먼저 `cleanupPrint`를 부른다. 앞 시험(I2)이 남긴 대기 작업이 있으면 출력 기기가 될 때 밀린 출력 멈춤(L-11)으로 시작해 시험용 프린터가 받지 않는다 — 제품 버그가 아니라 시험 순서 문제였다.
- `GET /api/print`의 `jobs`는 대기·출력 중만 — 출력된 작업 수는 POST 응답의 `jobs`와 시험용 프린터 장수로 본다.
- AC-PL1B-14(봉인 날짜 숨김)는 합치는 트랙 몫이라 여기서 보지 않았다.
