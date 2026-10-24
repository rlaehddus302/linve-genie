# FB1 test-notes — domain (test-domain)

적대 시험은 `tests/adversarial/fb1/`에 다섯 파일, 23개입니다. 모두 통과합니다. 실패로 남긴 시험은 없습니다.
기존 적대 시험 t1·s05·n1·i1·pl1b·p1(23개 파일, 268개)도 바꾸지 않은 채 통과합니다. 기존 적대 시험의 기대값은 하나도 바꾸지 않았습니다.

## 파일과 확인한 수용 기준

| 파일 | 수용 기준 | 공격 |
|---|---|---|
| `quick-preview.test.ts` | AC-FB1-02·03 | 무작위 줄 1,000개 × 천원·원. 미리 보기는 `register`일 때만 생기고, 가격은 `parseQuickInput` = `decideQuickInput` 가격(안전한 정수, 100원 이상, `formatWon` 표기)과 같은지. 이미 있는 번호에는 미리 보기가 없는지. 고치기 칸 "= …원"이 `parseAmount`와 같은지(500개). 예시 줄은 글자 그대로. `QuickInput.tsx`에 `innerHTML`이 없는지 |
| `printer-detail.test.ts` | AC-FB1-35·36·37 | 무작위 예외 1,000개(영어·숫자·전화번호·시간 초과 낱말·`<script>`, Error·이름 바꾼 Error·객체·글·숫자). B1 600개(블루투스 첫 확인과 두 번째 시도, 고르기 창, USB, 클라이언트 만들기, 출력 init/page/wait, 끊김 먼저), Marklife 400개(고르기, GATT 연결, 알림 켜기, 출력 쓰기). `detail`이 정해진 글 셋 가운데 하나인지, `모델:`은 WRONG_MODEL에만 붙는지, 문장은 표 그대로인지, 예외 낱말이 새지 않는지. 고정 사례로 다시 잇기 성공·실패, (a) 다시 잇지 않는 경우(USB, 기기 없음)는 첫 문장, 가짜 B1 기기 N=1·2 |
| `parcel-attacks.test.ts` | AC-FB1-15·16·17·89 | `readBox`에 무작위 값 2,000개를 넣어 골든 규칙(글자 그대로 비교, 새 코드 5개, 옛 낱말 4개)과 맞춰 봄. 넣은 값: 앞뒤 공백, 전각, NFD로 푼 한글, 제로폭, `__proto__`, 숫자, 배열, 객체. 골든 19개 사례 직접 대조. 설정 PUT 60개, 접수 `items[].box` 30개(틀린 값이 섞이면 400이고 택배사 요청 0개). DB에는 늘 새 코드만. `carrier`·`carrierName` 무작위 80쌍: 400이면 저장 없음, 200이면 다듬은 1~20자, 행에는 "OTHER일 때만 이름", 이름은 로그에 없음. `<b>` 이름은 JSON 글로만. 어댑터 없는 택배사 6개 × 동시 접수 5번 → 택배사 요청 0개. 택배사를 바꿔도 이미 접수한 가짜 택배의 운송장·조회·취소는 됨(회귀) |
| `box-migration.test.ts` | AC-FB1-16 | BASE 모양 DB에 판매자 40명(그중 절반은 BASE 기본값 '소'로 만든 행)과 접수 기록 200개(옛 낱말과 새 코드 무작위)를 넣고 0019를 다시 적용. 하나씩 정확히 옮겨지는지, 옛 낱말 0개, 행 수 그대로, `storedBox` 결과가 같은지 |
| `label-shop.test.ts` | AC-FB1-27·89 | 두 판매자. B의 템플릿 가게 이름이 빈 글, 공백, 전각 공백, 탭과 줄바꿈, 제로폭이면 B의 가게 이름이 들어가고, B의 조회·작업·글 계산·포장 그림에 A의 이름이 없는지. A가 이름을 바꾸는 8번과 B의 조회 8번을 동시에. B가 본문에 `sellerId`를 넣거나 판 번호를 맞춰도 A의 템플릿을 바꿀 수 없는지 |

## 통과한 공격 (버그 아님)
- 예외 글이 상세에 새는 길은 찾지 못했습니다. `NOT_SELECTED`·`PORT_BUSY`인데 예외 글에 timeout이 들어 있으면 상세가 `TIMEOUT_DETAIL`이 됩니다. 정해진 글 가운데 하나이니 AC-FB1-37 안입니다.
- 시간 초과 뒤 두 번째 시도가 시간 초과가 아닌 이유(NetworkError)로 실패해도 상세는 `RETRIED_TIMEOUT_DETAIL`입니다. AC-FB1-36 "두 번째 실패 → CONNECT_FAILED, 상세 …" 그대로입니다.
- 금액 해석 함수와 골든(`packages/core/src`, `amount.yaml`, `quick-input.yaml`)은 BASE와 비교해 diff가 0줄입니다(`git diff BASE`로 손으로 확인). 다음 스프린트에서 core가 바뀌면 깨지므로 시험으로는 두지 않았습니다.

## 지적 (findings)
- TD-FB1-001 (minor, 스펙 확인 필요): 직접 입력 택배사 이름이 보이지 않는 글자뿐이어도(`​`, `­`) 저장됩니다. 방향을 바꾸는 글자(`‮`)도 그대로 남습니다. `tidyText`는 공백과 제어 글자만 지우고, 형식 글자(Cf)는 지우지 않기 때문입니다. 라벨 쪽 L-2 `trimLabelText`는 형식 글자를 지웁니다. 그래서 같은 '​'이 라벨 가게 이름에서는 빈 글이 되고, 택배사 이름에서는 저장됩니다.
- TD-FB1-002 (nit, FB1 전부터 있던 것): 프린터 어댑터가 프로토타입 없는 객체(`Object.create(null)`)를 예외로 받으면 `String(error)`에서 TypeError가 납니다. 그러면 `connect()`가 PrinterResult 대신 거절되고, 상태는 `CONNECTING`에 머뭅니다. 실제 브라우저나 niimbluelib이 이런 값을 던지는 일은 거의 없어서 시험으로는 두지 않았습니다.
