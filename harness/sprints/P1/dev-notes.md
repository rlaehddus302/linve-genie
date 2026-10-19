# P1 개발 노트

## dev-device

### 만든 것
- **`packages/label` (`@livejjim/label`)** — 라벨 글 계산·렌더·내보내기.
  - 글 계산(순수, 캔버스 없음): `computeProductText`·`computePackingText` — 템플릿 검사 → 데이터 검사 → 항목 값·쪽 나누기. 라벨 골든 83사례(`tests/golden/label/*.json`)를 `packages/label/test/golden.test.ts`가 `pnpm test` 단계에서 돌린다(파일 3·사례 83·상품 50·포장 29·크기 4를 고정값으로 단언, 모르는 키·kind·겹친 id는 읽기 오류).
  - 그리기: `renderProductText`·`renderPackingText`·`renderPackingPage`(글 계산 결과만 받는다), 한 번에 `renderProductLabel`·`renderPackingLabels`, 테스트 라벨 `renderTestLabel`. 캔버스는 주입한다(`LabelRenderEnv`).
  - 내장 글꼴 `fonts/Pretendard-Bold.otf`(Pretendard 1.3.9 Bold, SIL OFL 1.1, 라이선스 `fonts/OFL-Pretendard.txt`). 글자 표(cmap)를 직접 읽어 글꼴에 없는 글자는 캔버스에 맡기지 않고 빈 네모로 그린다(`missing`).
  - 1비트 그림 `LabelBitmap { width, height, data }`(줄 순서, 한 줄 `ceil(width/8)`바이트, 왼쪽 점이 높은 비트, 1 = 검정), 문턱값 128(흰 바탕 합성, 정수 계산).
  - 템플릿 JSON(`format: 1`) 모델·`validateTemplate`(문제마다 한국어 문장, 겹침은 경고)·`templateToJson`·`parseTemplateJson`, 크기마다 기본 템플릿(상품·포장).
  - 내보내기: `encodeLabelPng`(1비트 흑백 PNG, pHYs 7992점/m), `createLabelPdf`(라벨 크기 쪽), `createA4Pdf`(A4 모아찍기, 자르는 선), 미리보기 `toPreviewRgba`. PDF는 직접 쓴다(필요한 객체만, 결정적 바이트, PrintScaling None, 문서 정보 없음).
  - 내용 키 `labelContentKey`(L-10).
- **`packages/printer` (`@livejjim/printer`, 새 워크스페이스 패키지)**
  - `PrinterAdapter` 계약, `B1_PROFILE`·`ENABLED_PROFILES`(B1 하나), niimbluelib 어댑터 `createNiimbotAdapter`/`createB1Adapter`(클라이언트·환경·타이머 주입), L-7 오류 코드와 문장(`PRINTER_MESSAGES`), 가짜 프린터 `createFakePrinter`.
  - 출력 대기열 순수 함수(`createPrintQueue`·`enqueueJob`·`startNextJob`·`completeJob`·`failJob`·`setConnection`·`pauseQueue`·`resumeQueue`·`voidLabel`·`reprintLabel`·`cancelJob`·`labelHistory`·`needsReprint`)와 실행기 `createPrintRunner`.
- 화면·서버·엔진 연결은 하지 않았다(I1). `packages/core`·`apps/**`·검증 파이프라인은 바꾸지 않았다.

### I1에게 — 공개 함수·타입 (AC-P1-63)

**라벨 (`@livejjim/label`)**

| 하는 일 | 함수·상수 | 타입 |
|---|---|---|
| 글 계산 | `computeProductText(template, data)` → `{ ok, text: { kind, template, items } }` · `computePackingText(template, data)` → `{ ok, text: { kind, template, common, pages } }` | `ProductText`·`PackingText`·`ProductItems`·`PackingCommon`·`PackingPage`·`TextResult` |
| 데이터 형식·검사 | `checkProductData`·`checkPackingData` (표 밖 칸 = `INVALID_DATA`, `field`는 경로, 문장은 "라벨에 넣을 수 없는 값이 있어요: 번호") | `ProductLabelData`·`PackingLabelData`·`LabelBuyer`(`{kind:'youtube',name}` 또는 `{kind:'sms'}`) |
| 렌더 | `renderProductLabel(env, template, data)` → `{ ok, image, layout, text }` · `renderPackingLabels(env, template, data)` → `{ ok, pages: [{ image, layout }], text }` · `renderProductText(env, text)` · `renderPackingText(env, text)` · `renderTestLabel(env, { shopName, date, size? })` | `LabelRenderEnv`·`LabelCanvas2D`·`RenderedLabel`·`LabelLayout`·`LayoutItem`(`id`·`box`·`fontSize`·`method`·`caption`·`suffix`·`value`·`lines`·`valueLines`·`missing`)·`FitMethod` |
| 템플릿 | `defaultTemplate(kind, size?)` · `validateTemplate(value)` → `{ ok, template, warnings }` / `{ ok:false, error:{ code:'INVALID_TEMPLATE', problems:[{path,message}] }, warnings }` · `templateToJson` · `parseTemplateJson` · `TEMPLATE_MESSAGES` | `LabelTemplate`·`ProductTemplate`·`PackingTemplate`·`TemplateItem`·`TemplateProblem` |
| 크기 | `LABEL_SIZES`(`50x30`·`50x20`·`50x40`) · `DEFAULT_LABEL_SIZE` · `labelSizeInfo(size)` · `a4Layout(size)` · `a4Cell(size, i)` · `sizeOfBitmap(w, h)` | `LabelSizeId`·`LabelSizeInfo`·`A4Layout`·`A4Cell` |
| 내보내기 | `encodeLabelPng(image)` → `{ ok, bytes }` · `createLabelPdf(images)` / `createA4Pdf(images)` → `{ ok, bytes, pages }` (크기가 섞이면 `MIXED_SIZES`) | `PngResult`·`PdfResult` |
| 미리보기 | `toPreviewRgba(image, scale)` → `{ width, height, data: Uint8ClampedArray }` (화면은 `new ImageData(data, width, height)` → `putImageData`) | `PreviewImage` |
| 그림 도우미 | `getPixel`·`setPixel`·`createBitmap`·`bitmapsEqual`·`copyBitmap`·`isLabelBitmap`·`oneBitFromRgba`·`countBlack` | `LabelBitmap` |
| 글 도우미 | `trimLabelText`(L-2) · `formatLabelPrice` · `formatLabelDate` · `splitGraphemes` · `labelContentKey(kind, data)` | `PriceStyle` |
| 문장 | `LABEL_MESSAGES` · `doesNotFitMessage(item)` · `ITEM_NAMES` | `LabelError`(`code`·`message`·`field?`·`item?`·`problems?`) |

- 오류 코드: `INVALID_DATA`·`INVALID_TEMPLATE`·`DOES_NOT_FIT`(`item`)·`MIXED_SIZES`·`NO_LABELS`·`INVALID_IMAGE`. 오류에는 값(닉네임·메모·전화번호)을 담지 않는다.
- **브라우저에서 글꼴 불러오기** (`@livejjim/label/browser`):
  ```ts
  import { loadBrowserLabelFont, createBrowserRenderEnv } from '@livejjim/label/browser'
  const font = await loadBrowserLabelFont()          // 번들 안 자산(LABEL_FONT_URL)을 fetch → FontFace 등록 → cmap 읽기
  const env = createBrowserRenderEnv(font)          // OffscreenCanvas(없으면 <canvas>)
  const r = renderProductLabel(env, template, data)
  ```
  `LABEL_FONT_URL = new URL('../fonts/Pretendard-Bold.otf', import.meta.url)` — Vite가 자산 주소로 바꾼다(같은 출처, 인터넷 글꼴 아님). 등록이 끝나기 전에 렌더하면 캔버스가 다른 글꼴로 그리므로 `await` 뒤에 렌더한다. 이미 바이트가 있으면 `registerBrowserLabelFont(bytes)`. 패키지 export `@livejjim/label/font`는 글꼴 파일 자체다.
- **Node 전용 진입점** (`@livejjim/label/node`): `createNodeRenderEnv()`(내장 글꼴을 `@napi-rs/canvas`에 한 번 등록), `nodeLabelFont()`, `readLabelFontBytes()`, `LABEL_FONT_PATH`. 렌더 경로의 다른 파일은 `node:` 모듈·fs·path를 쓰지 않는다(`tsconfig.json`이 Node 타입 없이 검사, 소스 검사 시험).
- 기본 템플릿 값: 가게 이름 빈 글, 가격 표기 `THOUSAND`, 포장 `perPage` 50×30 = 10 · 50×20 = 8 · 50×40 = 16 (`DEFAULT_PER_PAGE`). 상자 좌표는 `src/template.ts`.

**프린터 (`@livejjim/printer`)**

| 하는 일 | 함수·상수 | 타입 |
|---|---|---|
| 어댑터 계약 | `PrinterAdapter`: `profile`·`state`·`onStateChange(fn) → 그만 듣기`·`availableMethods()`·`connect(method)`·`disconnect()`·`print(image, { density? })` → `{ ok }` / `{ ok:false, error }` | `PrinterAdapter`·`ConnectionState`(`DISCONNECTED`·`CONNECTING`·`CONNECTED`·`PRINTING`)·`ConnectionMethod`(`bluetooth`·`serial`)·`PrinterResult`·`PrinterError`(`code`·`message`·`action?`·`detail?`) |
| B1 | `createB1Adapter({ environment?, createClient?, timer?, printTimeoutMs? })` · `createNiimbotAdapter({ profiles, ... })` · `B1_PROFILE` · `ENABLED_PROFILES` · `detectMethods(env)` · `browserEnvironment()` · `encodeForNiimbot` | `PrinterProfile`·`NiimbotClientLike`·`PrinterEnvironment`·`PrinterTimer` |
| 오류 문장 | `PRINTER_MESSAGES`(L-7 표 그대로) · `RECONNECT_ACTION`(`다시 연결`, 끊김 오류의 `action`) · `CONNECTION_STATE_NAMES` | `PrinterErrorCode` |
| 가짜 프린터 | `createFakePrinter({ methods?, script?: { n: 'disconnect' \| 'fail' \| { delayMs } }, connectError?, timer?, printTimeoutMs? })` → `printed`·`printCalls`·`simulateDisconnect()`·`setBehavior(n, b)`·`setConnectError(code)` | `FakePrinter`·`FakePrintBehavior` |
| 대기열(순수) | 위 "만든 것" 목록 · `jobStatusText(job)` · `pauseMessage(state)` · `JOB_STATUS_NAMES` · `PAUSE_MESSAGES` · `REFUSAL_MESSAGES` | `PrintQueueState`(JSON)·`PrintJob`·`NewJob`(`id`·`labelKey`·`kind`·`data`·`contentKey`)·`QueueUpdate`·`LabelHistory`·`PauseReason` |
| 실행기 | `createPrintRunner({ adapter, render, clock, device, density?, initialState?, onChange? })` → `state`·`enqueue`·`reprint`·`cancel`·`voidLabel`·`pause`·`restart`·`idle()`·`dispose()` | `PrintRunner`·`JobRenderer` |

- **시간 초과 기본값**: `DEFAULT_PRINT_TIMEOUT_MS = 20_000`(20초, 출력 시작부터 프린터의 끝 알림까지). `printTimeoutMs`로 바꾼다.
- 연결은 판매자가 누른 동작 안에서 `connect('bluetooth' | 'serial')`를 부를 때만 한다. 미지원(아이폰 사파리)이면 `availableMethods()`가 빈 목록이고 `connect`는 `UNSUPPORTED` — 화면은 PNG 저장 안내로.
- 실행기 사용 예 (I1):
  ```ts
  const runner = createPrintRunner({
    adapter: createB1Adapter(),
    render: (job) => renderProductLabel(env, currentTemplate, job.data),   // { ok, image } | { ok:false, error }
    clock: () => Date.now(), device: '판매 PC',
    initialState: saved, onChange: (s) => save(JSON.stringify(s)),
  })
  runner.enqueue({ id: effect.id, labelKey: `${claimId}@${confirmVersion}`, kind: 'product', data, contentKey: labelContentKey('product', data).key })
  runner.voidLabel(`${claimId}@${confirmVersion}`)   // VOID_LABEL 효과
  ```
  자동 출력 작업 ID = `PRINT_PRODUCT_LABEL` 효과 ID, 라벨 키 = (찜, 확정버전)(L-9). 리허설 범위의 라벨 효과는 넣지 않는다(D-081 — 실행기는 거르지 않는다).
- 대기열 상태는 `JSON.stringify` 그대로 저장한다(`format: 1`). 저장해 둔 상태에 출력 중 작업이 있으면(앱이 출력 중에 닫힘) 실행기가 대기 맨 앞으로 되돌린다(시도 +1, 마지막 오류 `DISCONNECTED`).

### test-domain에게 (AC-P1-70~72, `tests/adversarial/p1/`)
- 라벨: `import { … } from '@livejjim/label'`, 렌더 환경은 `import { createNodeRenderEnv } from '@livejjim/label/node'`, 프린터는 `'@livejjim/printer'`. 루트 `package.json` devDependencies에 두 패키지(`workspace:*`)를 더해 두었다. 루트 tsconfig(DOM 없음)로 두 패키지 진입점이 타입 검사를 통과하는 것도 확인했다.
- 배치 검사 도우미 예: `packages/label/test/helpers.ts`(`expectCleanLayout`·`strayInk`·`expectLayoutMatchesText`).
- PDF 다시 읽기: `pdf-lib`(label의 devDependency), 이미지 스트림은 `/Filter /FlateDecode`·`/BitsPerComponent 1`·`/Decode [1 0]`, 내용은 `fflate.unzlibSync`로 풀면 라벨 그림 바이트 그대로다. 자르는 선은 내용 스트림의 `re S`.
- 프린터: 가짜 niimbluelib 클라이언트 예 `packages/printer/test/fakes.ts`(`FakeNiimbotClient`·`ManualTimer`·`decodeEncoded`).
- 대기열 무작위 열: 순수 함수만으로 된다(시각·기기는 인자).

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **글꼴은 Pretendard Bold(OTF) 하나**. 굵은 굵기를 권하는 L-2를 따랐다. 글자 표에 한글 음절 11,172·호환 자모 51·ASCII 95·`…`가 모두 있다(시험). 1.58MB.
- **없는 글자 판단은 내장 글꼴의 cmap으로 한다.** 보이는 글자(자소 묶음 — `Intl.Segmenter('und')`, 언어 맞춤 없음) 안의 코드 포인트가 하나라도 없으면 그 글자 전체를 네모 하나로. 네모 = 폭 0.6em·높이 0.7em 테두리, 전진 폭 0.8em.
- **세로 치수는 글꼴의 hhea(ascender 0.952 · descender 0.241)**로 줄 높이 = `ceil(1.193 × 글자 크기)`. 캔버스의 글꼴 치수(브라우저마다 다를 수 있다) 대신 글꼴 파일 값을 쓴다. 가로는 `measureText`의 폭과 잉크 경계(`actualBoundingBoxLeft/Right`)로 맞춘다.
- **항목 정렬은 항목마다 고정이다**(템플릿 칸이 아니다 — L-5 템플릿에 정렬 칸이 없다): 상품 가게 이름 가운데, 날짜 오른쪽, 나머지 왼쪽 / 포장 쪽·날짜 오른쪽, 나머지 왼쪽 / 테스트 라벨 모두 가운데. 줄이 여럿이면 세로 가운데.
- **품종 두 줄은 캡션 폭만큼 들여 쓴다**("품종: " 다음에서 둘째 줄이 시작). 나눌 곳은 `minFontSize`로 잰 두 값 부분의 폭 차가 가장 작은 곳(이분 탐색), 그 나눔으로 두 줄이 맞는 가장 큰 글자 크기를 쓴다. 폭 차를 줄이는 곳이 두 줄 중 긴 줄을 가장 짧게 하므로 그 나눔이 안 맞으면 어떤 나눔도 안 맞는다 — 그때 `truncated`.
- **`truncated`(품종)**: `minFontSize` 두 줄, 첫 줄은 들어가는 만큼 보이는 글자 단위로 채우고(첫 줄 끝 공백은 첫 줄에 남긴다 — 보이지 않음), 둘째 줄은 들어가는 만큼 + `…`. 공백 나눔이 안 맞지만 글자 사이 나눔으로는 다 들어가는 드문 경우에도 규칙대로 `truncated`(끝 `…`)다 — 아래 "스펙에 올린 것" 3.
- **1만 자 품종·닉네임**: 두 줄로도 안 될 만큼 길면(전체 폭 > 두 줄 폭 × 1.1 + 여유) 나눌 곳을 찾지 않고 바로 줄인다. 줄이는 길이는 이분 탐색이라 1만 자 가게 이름·품종·닉네임이 함께 든 라벨도 이 PC에서 약 0.04초다.
- **기본 템플릿 상자**(점): 50×30 상품 = 가게 이름 (72,6,240,38) · 번호 (4,48,100,36) · 가격 (108,48,180,36) · 날짜 (292,48,88,36) · 품종 (4,88,376,88, 최소 22) · 닉네임 (4,180,376,54). 둘째 줄은 `번호: 9999`·`가격: 99,999,999원`·`26.10.08`이 20점에 들어가는 폭이다. 위아래 여백 6~8점(라벨 위치 오차 대비), 좌우 4점. 포장은 첫 줄 가게 이름 + 쪽(쪽 상자 104점 — `100/100`도 들어간다), 둘째 줄 구매자 + 날짜, 방송 제목, 번호 목록(50×30: 26점 4개씩 3줄 / 20점 6개씩), 끝 줄 상품 수 + 상품 합계.
- **`G-LBL-013`(1억 원, 원 표기)은 글 계산은 골든대로지만 기본 50×30 가격 상자에 20점으로 들어가지 않아 렌더는 `DOES_NOT_FIT`(price)**이다. AC-P1-14의 최악값은 `99,999,999원`(여덟 자리)이고 L-5 맞추기 4는 숫자를 자르지 않는다. 골든 시험은 이 사례만 렌더 `DOES_NOT_FIT`을 허용 목록(`TOO_WIDE_FOR_DEFAULT`)으로 적어 둔다 — 다른 사례가 같은 이유로 실패하면 시험이 실패한다.
- **캡션까지 안 들어가는 아주 작은 상자**(텍스트 항목 `…`도 못 넣는 폭, 한 줄 높이도 안 되는 상자)는 `DOES_NOT_FIT`(그 항목). 상자 밖으로 그리지 않기 위해서다.
- **품종 상자 높이가 `minFontSize` 두 줄보다 낮으면** 품종도 한 줄 `…`로 줄인다(두 줄 자리가 없다).
- **번호 목록 줄의 글**은 `,`로 끝나고(다음 줄이 있을 때) `lines.join(' ')`이 원래 `1, 2, 3`이다.
- **PDF는 직접 쓴다**(필요한 객체 몇 개뿐이다). pdf-lib는 기본으로 만든 시각·작성 프로그램을 문서 정보에 넣고(끄는 설정이 따로 있다), PNG 그림을 8비트로 다시 담는다 — 1비트 그림을 바이트 그대로 담고 결과 바이트를 완전히 정하려고 직접 썼다. 그림은 `DeviceGray`·1비트·`Decode [1 0]`·Flate로 라벨 바이트를 바꾸지 않고 넣는다. pdf-lib는 시험에서 다시 읽는 데만 쓴다(만든 쪽과 다른 해석기).
- **PNG 압축은 fflate `zlibSync(level 9)`**, PNG 흑백 1비트(0 = 검정이라 라벨 비트를 뒤집어 담는다).
- **B1 어댑터 연결 오류 짝짓기**: `NotFoundError`(선택 창 닫음)·`AbortError`·`SecurityError`·`NotAllowedError` → `NOT_SELECTED`("다시 연결을 누르고…"), 메시지에 "adapter not available" → `BLUETOOTH_OFF`, 시리얼의 `NetworkError`·`InvalidStateError`(포트 열기 실패) → `PORT_BUSY`, 그 밖(GATT 연결 실패 등) → `DISCONNECTED`("프린터 연결이 끊겼어요." + `다시 연결`). 연결 중에 또 누르면 같은 연결을 기다리고, 연결 중에 연결 끊기를 누르면 붙지 않는다.
- **출력 중 오류 예외가 끊김 알림보다 먼저 오면**(클라이언트가 이미 끊김) `DISCONNECTED`로 본다. 시간 초과 뒤에도 프린터에 끝냄 알림(`printEnd`)은 보낸다(기다리지 않음).
- **기술 상세(`detail`)**: 원래 예외의 `이름: 메시지`(300자까지), 7자리 이상 이어진 숫자(구분자 포함)는 `***`로 가린다. 라벨 내용은 넣지 않는다.
- **대기열 시도 횟수(`attempts`)는 실패한 시도 수**다(L-8 3 "시도 횟수 +1"은 오류·끊김으로 끝날 때). 처음 한 번에 출력되면 0.
- **아직 연결한 적이 없는 빈 대기열은 멈춤이 아니다**(`createPrintQueue()`의 `paused: null`). 실행기는 어댑터 상태로 연결 여부를 알린다 — 끊겨 있으면 멈춤(끊김).
- **멈춤 까닭의 우선**: 판매자·프린터 오류 멈춤 중에 끊겼다 다시 연결돼도 저절로 풀리지 않는다(손으로 푸는 멈춤이 끊김보다 앞). 끊긴 채 "다시 시작"하면 끊김 멈춤으로 바뀌어 다시 연결되면 이어진다.
- **폐기한 라벨 키로 새 작업이 오면**(VOID_LABEL이 PRINT보다 먼저 도착) 출력하지 않고 `CANCELLED` + 폐기로 기록만 남긴다(`accepted: false`, `reason: 'VOIDED'`) — 넣은 작업이 사라지지 않게. 출력 중에 폐기된 작업이 오류·끊김으로 끝나면 대기로 되돌리지 않고 `CANCELLED` + 폐기.
- **재출력 거절 이유**: `DUPLICATE_JOB`(이미 있는 작업 ID)·`VOIDED`·`IN_PROGRESS`(그 라벨 키 작업이 대기·출력 중)·`NOT_PRINTED`(그 라벨 키 작업이 없음) + 문장(`REFUSAL_MESSAGES`).
- **이력은 작업 목록에서 계산한다**(한 번에 하나씩 넣은 순서로 출력하므로 출력한 순서 = 목록 순서). 따로 저장하지 않아 어긋날 일이 없다.
- **실행기**는 출력 한 장마다 렌더 → `adapter.print` → 결과로 `completeJob`/`failJob`. drain은 다음 마이크로태스크에 시작하고, 도는 중에 다시 불리면 끝난 뒤 한 번 더 돈다(어댑터 알림이 drain 안에서 동기로 와도 겹쳐 돌지 않는다).
- **테스트 라벨**은 가게 이름이 비면 그 줄을 빼고 그린다. 테두리 두께 2점. 크기를 받으면 그 크기로(기본 50×30).

### 스펙에 올린 것 (disputesWithSpec — 규칙이 정하지 않은 곳, 구현은 아래처럼 해 두었다)
1. **농도 범위 밖 오류의 코드·문장**: AC-P1-42는 "0·6·소수는 보내지 않고 오류"인데 L-7 표에 이 코드가 없다. `INVALID_DENSITY` · "인쇄 농도는 1~5 사이의 정수로 정해 주세요."로 두었다(표의 11개 코드·문장은 글자 그대로). spec-keeper가 L-7 표에 더하거나 다른 코드로 정해 주면 맞춘다.
2. **렌더 실패(템플릿을 바꿔 `DOES_NOT_FIT` 등)로 출력하지 못한 작업**: L-8에 멈춘 까닭이 없다. 조용히 빼면 라벨이 사라지고, "프린터 오류로 멈췄어요."는 틀린 안내라 네 번째 까닭 `LABEL_ERROR` · "라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요."로 멈춘다(작업은 대기 맨 앞, 마지막 오류 = 렌더 오류 코드, 다시 시작으로만 이어짐 — 판매자가 그 작업을 빼거나 템플릿을 고친 뒤).
3. **품종: 공백 나눔은 안 맞지만 글자 사이 나눔으로는 다 들어가는 경우**: L-5는 "공백이 있으면 공백에서"만 두 줄로 나누고, 안 되면 `…`. 규칙대로 `truncated`이고, 남은 글이 둘째 줄에 다 들어가도 끝에 `…`를 붙인다(빠진 글자는 없다). 이 경우 글자 사이 나눔으로 `twoLines`를 허용할지 정해 주면 맞춘다.
4. **G-LBL-013(1억 원 원 표기)**은 기본 50×30 템플릿에서 렌더하면 `DOES_NOT_FIT`이다(위 결정). AC-P1-06 "골든 사례 전부를 렌더해 배치 결과와 비교"와 AC-P1-14(최악값 99,999,999원)·L-5 맞추기 4가 이 사례에서 만난다 — 지금은 L-5를 따랐다. 1억 이상도 기본 템플릿에 들어가야 하면 기본 가격 상자를 넓혀야 한다(날짜를 셋째 줄로 내리는 등 판매자 샘플 배치가 바뀐다).

### 새 의존성 (모두 정확한 버전, AC-P1-60)
| 패키지 | 버전 | 어디 | 라이선스 | 왜 |
|---|---|---|---|---|
| Pretendard (글꼴 파일, npm `pretendard` 1.3.9의 `Pretendard-Bold.otf`를 복사) | 1.3.9 | `packages/label/fonts/` | SIL OFL 1.1 (`fonts/OFL-Pretendard.txt`) | 내장 한글 글꼴 (L-2) |
| `fflate` | 0.8.3 | label dependencies | MIT | PNG·PDF 압축(zlib, 결정적, 브라우저·Node 공통) |
| `@napi-rs/canvas` | 1.0.11 | label dependencies (Node 진입점 `@livejjim/label/node`만 쓴다) | MIT | Node 캔버스(시험·서버 렌더) |
| `pdf-lib` | 1.17.1 | label devDependencies | MIT (+ pako MIT·Zlib, tslib 0BSD) | 시험에서 PDF 다시 읽기 |
| `@mmote/niimbluelib` | 0.47.1 | printer dependencies | MIT (+ `@capacitor/core` 8.5.3 MIT, `@capacitor-community/bluetooth-le` 8.3.0 MIT, eventemitter3 MIT, async-mutex MIT, crc-32 Apache-2.0) | B1 프로토콜 |
| `fast-check`·`vitest`·`@types/node` | 4.10.2·5.0.5·24.19.2 | 두 패키지 devDependencies | MIT | 저장소에 이미 있는 판 |

- **niimbluelib 상업적 사용은 제조사 동의 필요 (D-009, 사용자 확인).** README: 교육·정보용이며 제조사 동의 없이 상업적으로 쓰지 않는다는 문구가 있다(프로토콜 역분석 구현). 어댑터 뒤에 두어 교체할 수 있게 했고(`NiimbotClientLike` 주입, `PrinterAdapter` 계약), PNG·PDF 대체 경로가 늘 있다.
- niimbluelib은 import만으로 `navigator`를 건드리지 않는다(Node에서 import해도 오류 없음 — 시험). `NiimbotBluetoothClient` 연결 성공 때 `console.log`를 한 줄 남긴다(라이브러리 동작, 라벨 내용 없음).

### 시험 (내 영역)
- `packages/label/test/`: `golden.test.ts`(골든 83 + 렌더 배치 비교), `text.test.ts`(글 계산·다듬기·입력 검사·쪽 나누기·내용 키), `template.test.ts`, `render.test.ts`(크기·1비트·글꼴·배치 검사·긴 품종·숫자 항목·결정성·속도·테스트 라벨·조정), `export.test.ts`(PNG·PDF·A4·미리보기), `font-and-source.test.ts`(cmap·라이선스·소스 검사).
- `packages/printer/test/`: `contract.test.ts`(B1·가짜 프린터 공통 계약), `b1.test.ts`, `queue.test.ts`(fast-check JSON 왕복·얼린 상태 포함), `runner.test.ts`(30장), `source.test.ts`.
- 렌더 30장 합계는 이 PC에서 약 0.02초(글꼴 등록 뒤, 기준 6초).

### HG-2(실제 B1)에서 함께 볼 것 (I1 뒤)
- 블루투스 연결은 `getAvailability()`를 먼저 기다린 뒤 장치 선택 창(`requestDevice`)을 연다(AC-P1-41). 크롬의 사용자 동작 유효 시간 안이라 문제없을 것으로 보지만, 실제 크롬에서 "연결" 한 번 누름으로 선택 창이 뜨는지 확인한다.
- 시간 초과 20초가 B1 블루투스 한 장 출력에 넉넉한지(30장 연속 출력 때 TIMEOUT이 나지 않는지).
- 기본 템플릿 위아래 여백(50×20은 2~3점)이 실제 라벨 위치 오차 안에서 잘리지 않는지.

### 검증
- `E2E_PORT_OFFSET=100 pnpm verify` (커밋 bf69805 시점): 7단계 모두 통과 — typecheck(설정 11개·TS 파일 286개), lint(오류 0·경고 0), test(파일 89·테스트 2121 — 라벨 7파일·프린터 5파일 포함), golden(파일 21·통과 498, 코어 골든 그대로), adversarial(파일 30·테스트 642), e2e(파일 12·통과 67), coverage(코어 라인 100%·분기 99.65%). TZ=Pacific/Honolulu.
- 실기기·블루투스·시리얼·인터넷 없이 돈다(가짜 niimbluelib 클라이언트·가짜 프린터·Node 캔버스).
