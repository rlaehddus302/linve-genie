# QL3R2 개발 메모

## dev-web

### 한 일 (커밋 `[dev:web] QL3R2: …`)
- **D-QL3R2-01** `lib/csv-text.ts`: 바이트에 NUL(0x00)이 하나라도 있거나, UTF-8(엄격)·EUC-KR(엄격, `fatal: true`) 둘 다 풀리지 않으면 `NotTextFileError`를 던진다. 빈 파일은 빈 글, 그 밖은 지금처럼 UTF-8 → EUC-KR. 파일 이름·`mimeType`은 보지 않는다.
  - `DepositPaste.tsx`: 읽기에 실패하면 `role=alert` "파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요."만 보인다. 글 칸은 고르기 전 그대로 두고, 미리 보기도 부르지 않는다.
  - 주의: NUL이 없고 EUC-KR로 풀리는 바이트는 글로 읽힌다. 예를 들어 PDF 머리 줄 `%PDF-1.4\n%âãÏÓ`만 있으면 EUC-KR 글이 된다. 결정이 두 줄 규칙만 두었기 때문이다. 실제 PDF·PNG·JPEG·zip은 바이너리 부분에 NUL이 있어 걸러진다. 단위 시험의 PDF 바이트에는 압축 덩어리를 넣었다.
- **D-QL3R2-02**
  - `AlertStrip.tsx`는 `useWide`로 한 모양만 그린다. 숨긴 사본은 두지 않는다.
  - 접힌 휴대폰(48rem 미만 + 접힘)에서:
    - 짧은 문장이 있는 출력 기기 항목은 "알림" 영역 안에 그리지 않는다. 화면에도 접근성 트리에도 없고, 짧은 줄 하나만 남는다.
    - 보류 단추의 글과 이름은 **"보류 n"**(`PENDING_SHORT_WORD`)이다.
  - 펼친 띠·PC는 "보류 찜 n"과 긴 문장 하나를 그대로 보이고, 짧은 줄은 없다. 알림 수는 그대로다(출력 기기 항목은 세지 않는다).
  - `styles.css`:
    - `text-wrap-mode: nowrap` 규칙 4개마다 바로 앞에 `white-space: nowrap`을 넣었다.
    - 짧은 줄 위 간격(`row-gap`)을 0.25rem으로 했다.
    - 짧은 줄이 있을 때만(`.console-sticky:has(.alert-short-row)`) 고정 영역을 줄인다(D-QL3R1-02 ⓑ): 위아래 여백 0.125rem, 칸 사이 0.25rem, 짧은 줄 안쪽 위아래 여백 0(높이는 `min-height` 2.75rem), 큰 글씨 격자의 "빠른 입력"·"개수" 이름 줄 줄 높이 1.25. 글자 16px·누르는 곳 44px은 그대로다. 출력 기기가 정상이면(짧은 줄 없음) 지금과 같다.
- **D-QL3R2-03** `print-words.ts`에 `NO_STATION_SHORT` "라벨이 안 나가요 · 라벨 화면에서 프린터를 연결해 주세요"를 더했다. `stationLeadShortText`는 출력 기기 없음 + 대기 라벨 > 0일 때 이 문장을 돌려준다. 콘솔은 그대로 `shortText`로 넘긴다(누르면 `/labels`).
- **D-QL3R2-04**
  - "방송 화면으로 돌아가기"(`ReceiptsPage`), "방송 화면으로"(`ReviewsPage`), 제목 "방송 화면을 열지 못했어요"(`ConsolePage`).
  - `DepositSources.tsx`: "원천"을 "입금 받는 곳"으로 바꿨다. 바꾼 곳은 제목·빈 안내·시험용 단추·안내·목록과 항목의 `aria-label`이다.
  - `deposit-words.ts`: `FUTURE` "시각이 지금보다 늦은 입금", 같은 입금 "(입금 #n도 같은 입금이에요)".
  - 결과 문장: "…, 시각이 지금보다 늦은 입금 n건은 넣지 않았어요. 은행 글의 날짜·시각을 확인해 주세요."
  - `BUYER_CAN_WRITE`에 영수증 보내기 가는 길을 더했다.
- **D-QL3R2-05**: `PASTE_NO_HEADER`일 때 `ErrorNote`의 서버 문장 바로 아래 `<p class="error-extra">`에 `NO_HEADER_PHONE_HINT`를 보인다. 같은 `role=alert` 안이다. `ErrorNote`에는 선택 속성 `extra`를 새로 넣었다.
- **D-QL3R2-06**: `Modal.tsx`의 숫자 키는 `event.repeat`이면 누르지 않는다(기본 동작만 막는다). 음성 칸·문자찜 화면은 이미 `openClaimAction`을 써서 빠른 사유를 바로 보낸다. 코드는 바꾸지 않았다.

### 실측 (CI=1 E2E_PORT_OFFSET=4100, 실제 방송·보류 찜 1·알림 접힘·700px 내림, 임시 측정 시험 — 저장소에 넣지 않음)
| 경우 | 375×812 150% | 393×852 WebKit 150% | 412×915 150% | 100% |
|---|---|---|---|---|
| 끊김 'PC 2' | 293 / 325 (짧은 줄 66px, 두 줄) | 294 / 341 | 293 / 366 | 177 |
| 출력 기기 없음 + 대기 2 | **321 / 325** (짧은 줄 94px, 세 줄) | 322 / 341 | 321 / 366 | 177 |

- 짧은 줄·"보류 1"은 모든 경우 `scrollWidth`가 `clientWidth`와 같다. 긴 문장은 접힌 동안 0번이고, 가로 넘침도 0이다.
- 375 150%의 출력 기기 없음 문장은 낱말 사이에서만 줄을 바꿔 세 줄이다. 그래서 여유가 4px뿐이다.
- 빠른 사유 뒤 되돌리기 띠(375 150%·393 WebKit 150%, 600px 내림):
  - 띠는 화면 안에 있고 잘리지 않는다. "되돌리기"는 66px이다.
  - 되돌리면 "보내지 않았어요: 1번 문자찜(물주기담당) 취소"가 보인다.

### 단위 시험
- 새 시험:
  - `apps/web/test/ql3r2.test.tsx`: 파일 (a)~(f), 붙여넣기 화면(사진·NUL에서 글 칸 유지·요청 0·U+FFFD 없음), 머리 줄 안내, 늦은 입금 결과, 낱말, 방송 화면 오류 제목, `stationLeadShortText` 7가지, 보류 n, 이중 표시, 숫자 키 반복.
  - `ql3r2-styles.node.test.ts`: nowrap 대체 순서, 짧은 줄 여백.
- 결정이 바꾼 기존 단언(줄마다 `// QL3R2 D-QL3R2-0x`):
  - `ql3r1`(출력 기기 없음 짧은 문장, 접힌 띠 긴 문장 0)
  - `mob1-print-voice`·`console-s06`(접힌 휴대폰 "보류 n")
  - `deposit-words`·`deposits-page`(원천, 늦은 입금, #n도)
  - `t1-parcels`, `receipts-page`
  - `styles.node`: `white-space: nowrap`은 같은 규칙에 `text-wrap-mode: nowrap` + `overflow: hidden`이 있을 때만 된다. 가로 스크롤 금지의 뜻은 그대로다.
- 결과: 웹 단위 107파일 1636개 통과(TZ=Pacific/Honolulu). `tsc`(web 두 설정)와 eslint(web src·test)는 오류 0.

### test-e2e에게 (결정이 바꾼 기존 E2E 줄)
- `tests/e2e/ql3r1/sticky-height.spec.ts:76`: 접힌 휴대폰의 `'보류 찜 1'` 단추는 이제 **`'보류 1'`**이다(D-QL3R2-02 (2)). 375·412·393 WebKit 150% 세 시험이 여기서 실패한다. 높이(35%)는 그대로 통과할 것이다(짧은 줄이 없으면 CSS가 같다).
- `tests/e2e/ql3r1/printer-lost.spec.ts:147`: 접힌 375 150%에서 `alerts(page)`의 긴 문장 단추는 이제 **0개**다(D-QL3R2-02 (1)). 같은 파일의 다른 곳에서 접힌 휴대폰 긴 문장을 찾는 줄도 같다.
- 접힌 휴대폰에서 `alerts(page).getByRole('button')`을 세는 AC-MOB1-13 줄: 짧은 문장이 있는 경우 출력 기기 항목은 빠진다. 끊김·출력 기기 없음은 모두 짧은 문장이 있다.
- `ql3r1` 나머지와 `words.spec.ts` TE-QL3R1-001은 초록이다(45/49 통과, 실패 4개는 위 두 줄).
- 짧은 줄 고르기: `page.locator('.alert-bar').getByRole('button', { name: … , exact: true })`(클래스 `.alert-short-row`). 접힌 휴대폰에서만 DOM에 있다.

### 남은 것 (범위 밖, 다른 영역)
- 서버 오류 문장에 "원천"이 남아 있다. 오류일 때만 화면에 나온다. server 영역이라 이번에는 고치지 않았고 다음 낱말 정리 후보다.
  - `apps/server/src/deposit/service.ts`: "꺼진 원천이에요. 켠 뒤 받아 와 주세요.", "계좌조회 원천만 만들 수 있어요.", "시험용 원천에는 계좌를 적지 않아요."
  - `deposit/api.ts`: "시험용 원천을 골라 주세요."
- 사용자 결정이 필요한 것: 없음.
