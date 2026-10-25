# QL2 dev-notes

## dev-web — 바뀐 공개 모양 (시험에게)

### 새 문장 상수·함수
- `lib/print-words.ts`
  - `NO_STATION_PILING` = "출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 프린터를 연결한 뒤 '이 기기에서 출력'을 눌러 주세요." (D-QL2-09 ①)
  - `pauseAlertMessage(pause, waiting)` — 콘솔 알림 띠 "출력 멈춤 · …"의 뒤 문장. 판매자 멈춤(SELLER)만 바뀜: 쌓인 라벨 "쌓인 라벨 {n}장이 기다려요. 눌러서 '출력 시작'을 골라 주세요.", 손으로 멈춤 "'출력 멈추기'를 눌러 멈췄어요. 눌러서 '다시 시작'을 골라 주세요." 그 밖은 서버 문장 그대로 (D-QL2-09 ②)
  - `CANCEL_JOB_TITLE` = "라벨 빼기", `cancelJobQuestion(what)` = "{what} 라벨을 뺄까요? 뺀 라벨은 출력하지 않아요(기록은 남아요)." — what = 번호·품종(·옵션), 예 "15번 핑크프릴", 포장 "포장 1/2쪽" (D-QL2-09 ③)
  - `autoReconnectingMessage(n, total)` = "프린터에 다시 잇고 있어요. ({n}/{total})", `AUTO_RECONNECT_GAVE_UP` = "저절로 다시 잇지 못했어요. 아래를 해 본 뒤 '다시 연결'을 눌러 주세요." (D-QL2-04)
  - `isIphone(userAgent?, touchPoints?)` — iPhone·iPad·iPod, 또는 Macintosh + 터치 지점 > 1. 기본값은 navigator (D-QL2-07)
- `components/PackingPrint.tsx` `NO_PRINT_DEVICE_WAITING` = "출력 기기가 아직 없어 기다리는 중이에요. 라벨 화면에서 프린터를 연결한 뒤 '이 기기에서 출력'을 눌러 주세요." — D-QL2-09 ① "'이 기기에서 출력'을 누르라는 모든 문장은 프린터 연결을 먼저"를 따름(파일 경계 표 밖이지만 AC-QL2-40 단위 시험 조건이라 고침)
- `lib/device.ts` `DefaultNameInput.touchPoints?`(기본 0) — `defaultDeviceName`이 `isIphone`을 씀
- `lib/assist.ts` `ASSIST_NOTICE`(D-QL2-05 ② 글자 그대로), `ASSIST_YOUTUBE_EXCLUDED`, `showsYoutubeExcluded(on, items)`, `useAssistOnOpen`이 `on`(켜짐) 칸을 더 돌려줌
- `api/types.ts` `ReviewItem.excluded?: 'YOUTUBE_POLICY' | null` (서버가 이미 보내던 칸)
- `components/PolicyPages.tsx` `AI_ASSIST_YOUTUBE` = "유튜브에서 받은 채팅 글은 보내지 않아요."(14번 절 마지막 줄), 6번 위탁 줄 "… — 14번 'AI 제안(선택)'을 보세요. [검토 필요]"
- `lib/words.ts` `agoWord(seconds)`("N초 전"/"N분 전"), `pendingMeaning(windowSec)` (D-QL2-09 ④)
- `components/AlertStrip.tsx` `alertToggleWord(total, expanded)` — 항목이 하나라도 있으면 단추가 늘 있다. 세는 알림 0이면 "알림 펼치기"/"알림 접기"
- `components/PrintParts.tsx` `ConnectTipsList`(해볼 일 목록 — 오류 상자와 멈춤 띠가 같이 씀), `cancelJobWhat(job)`

### 스테이션 상태의 새 칸
- `StationSnapshot.autoReconnect: { kind: 'trying', attempt: 1~6, total: 6 } | { kind: 'gaveUp' } | null`
  - 끊긴 직후 `trying 1`, 시도가 실패하면 다음 차례, 시도 중에도 그 차례. 60초 안 다시 끊기면 남은 차례부터. 6번째까지 실패하면 `gaveUp`
  - null이 되는 때: 이어짐, 판매자 "다시 연결"·연결 방법 단추·"연결 끊기", 출력 기기에서 내려옴, 라벨 기능 끔
  - 출력 기기가 아닌 기기는 늘 null

### 화면
- 콘솔(휴대폰 폭만): 제목 → (끝내기 오류·봉인 안내) → 고정 영역 → 단위 줄 → 현재 상품 → 행동 줄(`.console-head.console-head-actions` 안 `.console-actions`) → 음성 칸 → 음성 설정과 기록 → 리허설 조작판 → 그 밖. PC는 그대로
- 현재 상품 카드: 번호 → 이름 → "1등: …" → 가격 → 상태 → 대기 → … (PC·휴대폰)
- 라벨 화면 프린터 칸: 이어져 있지 않고·잇는 중이 아니고·`canReconnect`면 연결 방법 줄 **위** "다시 연결"(`station.reconnect()`). 출력 기기인지와 상관없음. 한 화면 하나 — 이 기기의 끊김 멈춤 띠(라벨 화면) > 오류 상자 > 프린터 칸. 오류 상자 "다시 연결"도 `station.reconnect()`
- 멈춤 띠(출력 기기 자신, 끊김): 까닭 문장 → `role="status"` "(n/6)" 또는 그친 뒤 문장 → "해볼 일" → "다시 연결"
- 대기 작업 "빼기" → 창 "라벨 빼기"(처음 포커스 "닫기", "1 빼기" 위험 모양·숫자 1). 확인한 뒤에만 `/api/print/jobs/cancel`
- 보류 찜 창 맨 위 뜻 한 줄(지금 방송의 `claim.preOpenWindowSec`), 지난 시간 `agoWord`
- 확인 필요 화면: AI 켜짐 + 보이는 항목 중 `excluded: 'YOUTUBE_POLICY'`가 있으면 목록 위 `p.hint` 한 줄

### 기존 시험 기대값을 바꾼 곳 (`// QL2 D-QL2-0x`)
- `apps/web/test/a1-assist.test.tsx` ASSIST_NOTICE
- `apps/web/test/mob1-print-voice.test.tsx` NO_STATION_PILING
- `apps/web/test/pl1b-packing.test.tsx` NO_PRINT_DEVICE_WAITING

### E2E에서 바뀔 줄 (test-e2e 몫 — 내가 고치지 않음)
- E2E 실행(오프셋 3000, mob1·qs1·nav·wiz·aiy1·a1·lnd1 211 통과 / i1·s06·s06b·fb1 198 통과)에서 이번 결정 때문에 깨진 줄 — 모두 기대 문장·동작이 바뀐 곳:
  - `tests/e2e/mob1/station.spec.ts` 12줄 `PILING` 옛 문장(250줄 시험) — D-QL2-09 ①
  - `tests/e2e/a1/screen.spec.ts` 137줄 근처 옛 `ASSIST_NOTICE` — D-QL2-05 ②
  - `tests/e2e/i1/attacks.spec.ts` 177~178줄 "빼기"를 바로 누르면 빠짐 → 이제 창 "라벨 빼기"의 "1 빼기"까지 — D-QL2-09 ③
  - `tests/e2e/i1/screens.spec.ts` 91줄·113줄 "출력 멈춤 · 출력을 멈췄어요." → "출력 멈춤 · '출력 멈추기'를 눌러 멈췄어요. 눌러서 '다시 시작'을 골라 주세요." — D-QL2-09 ②
- `tests/e2e/s06/pwa.spec.ts` 78줄(AC-S06-51 새 버전)은 폴더 실행에서 한 번 실패, 그 파일만 다시 돌리면 통과 — 문자찜 화면이라 이번 변경과 무관한 흔들림으로 봄
- 포장 화면 출력 기기 없음 문장을 글자로 찾는 줄이 있으면 새 문장

### 한 화면 하나 — 위 줄 "다시 연결"
- 새 `lib/reconnect-owner.ts`(`useOwnReconnect`·`useReconnectOwned`). 프린터 칸(`PrinterSection` — 라벨 화면·마법사 4/5)이나 이 기기의 끊김 멈춤 띠(`PausePanel` — 라벨 화면·알림 띠 "출력 멈춤" 창)가 떠 있으면 위 줄(`TopBar`) 프린터 상태 옆 "다시 연결"(AC-WIZ-04)은 숨는다. 그 밖 화면은 그대로. `TopBar.tsx`는 파일 경계 표 밖이지만 D-QL2-03 (c)·AC-QL2-12("라벨 화면에서 '다시 연결'은 정확히 하나")를 지키려면 필요해 최소로 고침

### 알림 띠 CSS (휴대폰)
- 접힌 동안 항목 글은 버튼 안 칸(`.alert-item-text`·`.alert-lead-text`)에서 한 줄·말줄임. 줄 수 제한(line-clamp)은 숨은 둘째 줄의 글자 상자(Range.getClientRects)가 버튼 상자 밖에 남아 AC-QL2-07을 못 지켜 `text-wrap-mode: nowrap`(+ `overflow: hidden`·`min-width: 0`·`max-block-size: 1.25em`)로 함. `styles.node.test.ts`의 "`white-space: nowrap` 금지"(가로 스크롤 방지)는 고치지 않았다 — 이 줄은 넘침을 자르는 칸 안이라 가로 넘침을 만들지 않는다(측정: 375·412 150%·100% scrollWidth = 화면 폭). 감사가 우회로 보면 알려 달라
- `.alert-bar .alerts`에 `contain: inline-size` — 한 줄 긴 문장이 콘솔 폭을 넓히지 않게
- 측정(크로미움, 접힘): 375×812 150% 띠 한 줄 높이 66px = 버튼 66px, 버튼 scrollHeight 62 = clientHeight 62, 글자 상자가 버튼 밖 0. 펼침: 문장 전체 줄바꿈, 잘림 0. 100% 띠 44px(고정 영역 109px — 그대로)

### spec-keeper에게 — AC-QL2-01 (150%) 못 미침 (D-QL2-01 (4))
- (1)(2)를 넣은 뒤 크로미움 측정(실제 방송, 알림 둘 접힘, 음성 꺼짐, 스크롤 0). 아래 막대 위 끝: 375×812 = 733px, 412×915 = 836px
  - 375×812 150%: 위 줄(TopBar) 0~169 · 제목 181~228 · 고정 영역 246~556(310px — 띠 66 + 빠른 입력 216 + 등록될 내용 42) · 단위 줄 649~735 · **현재 상품 카드 753~** ("15번" 829~908, 이름 932~990, "1등" 1002~1088)
  - 412×915 150%: 같은 높이 — 카드 753~, "15번" 829~908, "1등" 1002~1045
  - 100%(375×812): 카드 353~, "15번" 404, "1등" 450~479 → 기준 통과. PC 1440 그대로
- 카드 안쪽 여백·줄 사이를 0으로 줄여도 카드 머리(753)가 이미 막대(733) 아래라 150%에서는 번호·이름·1등이 보이지 않는다(필요한 높이 ≈ 번호 79 + 이름 58 + 1등 43~86). 그래서 (4)의 여백 줄이기는 넣지 않았다. 남은 길은 위 줄(169px — 150%에서 여러 줄)·단위 줄(86px)·고정 영역 중 하나를 줄이는 것 — 모두 이 결정이 막은 곳이라 결정이 필요하다

### spec-keeper에게 — AC-QL2-11 둘째 줄과 L-7 (4)·D-QS1-01 (4)가 어긋남
- AC-QL2-11: "다시 잇기 거절(전원 꺼짐)에서 프린터 칸 '다시 연결' → 실패해 오류 상자 → 다시 잇기 허락 → 오류 상자 '다시 연결' → 고르기 창 수 그대로"
- L-7·D-QS1-01 (4)·프린터 패키지: "기억한 기기로 이은 시도가 실패하면 기억을 지운다 — 다음 '다시 연결'은 고르기 창부터". 그래서 측정에서 오류 상자 "다시 연결"은 고르기 창을 한 번 연다(고르기 창 1 → 2). 화면은 `station.reconnect()`를 부른다(D-QL2-03 (b) 그대로). 패키지는 이 스프린트가 고치지 않는 곳이라 그대로 둠

### 측정으로 본 것 (크로미움, 임시 시험 — 저장소에 남기지 않음)
- 출력 기기 아닌 기기(가짜 B1): 끊김 뒤 61초 당겨도 시도 0, 프린터 칸 단추 차례 "다시 연결" → "블루투스로 연결"…, 누르면 연결·고르기 창 1번 그대로. 실패 뒤 라벨 화면의 "다시 연결"은 오류 상자 하나
- 출력 기기(가짜 B1, 전원 꺼짐): 멈춤 띠 "(1/6)"…"(6/6)" → 그친 뒤 문장·해볼 일·"다시 연결", 화면의 "다시 연결" 하나(위 줄 숨음). 허락 뒤 누르면 연결·문장 없어짐
- 빼기: 창 "라벨 빼기", 본문 "15번 핑크프릴 라벨을 뺄까요? …", 처음 포커스 "닫기", 열 때 요청 0, Esc 뒤 2장, "1 빼기" 뒤 1장
- 보류 찜 창 맨 위 뜻 문장, 출력 기기 없음 항목만 있을 때 "알림 펼치기"
