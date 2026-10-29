# APP2 수용 기준 — Expo 앱과 실제 서버 연결

- 근거: SPEC APP-01~APP-04·APP-05, VOC-06·VOC-07, LABEL_RULES L-0·L-7·L-11, D-APP-19~21·D-APP-11·12·16·17, D-APP2-01~03.
- 전제: APP1 받아쓰기 서버 연결과 APP1b의 같은 읽기 입구. 기기 모듈 → 앱 화면 순서, 독립 domain/E2E/UX 검증.
- 범위: 로그인·방송 목록/시작·콘솔·음성·상품/빠른 입력·찜/문자찜·라벨·프린터·포장·음성/라벨 설정, 앱 복귀. 정산/택배/판매대장/나머지 가게 설정은 기기 브라우저의 기존 웹으로 연결한다.
- 스토어 게시·계정 결제·실물 B1/폰 측정은 HG-APP2로 남기되, 모의 어댑터·실제 로컬 서버를 연결한 검증은 수행한다. 컴파일/모의 시험만으로 백그라운드 실기기 성공을 주장하지 않는다.

## 인증·전송 계약

- 로그인은 기존 서버 세션 쿠키다. 앱 fetch와 네이티브 WebSocket은 동일한 네이티브 쿠키 저장소의 현재 쿠키를 사용한다. 세션 값을 JS AsyncStorage·설정·로그에 복사하지 않는다.
- 음성 경로는 APP1/APP1b의 `/api/voice/stream?broadcastId=…&device=…`. React Native WebSocket의 native header 옵션으로 `Origin`을 설정된 `LIVEJJIM_APP_ORIGIN`과 같은 공개 앱 origin으로 보낸다. Origin 없음/불일치 거절과 서버 세션·판매자/방송 검사는 그대로다. URL이나 앱 번들에 세션/일꾼 토큰을 넣지 않는다. `/api/voice/ticket`과 `dev-fake-ticket`은 임시 개발 구현이므로 사용하지 않는다.
- REST 쓰기도 기존 Origin/CSRF 검사에 맞는 헤더를 보낸다. 허용 Origin을 `*`로 넓히거나 native라는 이유로 인증을 생략하지 않는다. 쿠키 저장소 연결이 해당 플랫폼에서 확인되지 않으면 로그인 실패를 표시하고 모의 성공으로 바꾸지 않는다.
- `GET /api/print/jobs/:id/bitmap?attempt=…&device=…`은 세션 판매자의 지금 받은 작업·유효한 시도 표·출력 기기를 확인한 뒤 그 작업의 고정된 라벨 데이터를 기존 서버 renderer로 그려 `{ width, height, data }`를 반환한다. data는 L-1의 1비트 행 바이트 base64다. 존재하지 않음·소유자/기기/시도 불일치·실패는 오류로 전달하며 404를 빈 그림으로 바꾸지 않는다. 조회로 작업을 다시 받거나 출력 성공을 기록하지 않는다.
- 테스트 인쇄도 서버가 L-7 그림을 만든다. 정상 라벨/테스트 그림은 웹과 앱 모두 같은 입구·렌더 함수·글꼴을 사용한다. 그림 받기가 실패하면 실제 프린터로 보내지 않고 기존 실패/재시도 절차를 따른다.
- native 마이크·BLE는 실제 모듈을 production 기본 어댑터로 연결한다. FakeNativeAudio/FakePrinter/빈 그림은 명시적인 시험 주입에서만 쓴다. 모듈 미설치/권한 거절/서버 미구현을 가짜 성공으로 대체하지 않는다.

## 수용 기준

| ID | 영역·근거 | Given / When / Then | 확인 |
|---|---|---|---|
| AC-APP2-01 | [web] APP-01 AC1 | Given 실제 로컬 서버와 앱 개발 빌드/화면 시험. When 로그인. Then 서버 세션이 생성되고 같은 계정 방송·상품이 보인다. 웹에서 등록한 상품도 실시간 갱신된다(성능 1초 목표는 별도 측정). | 통합·화면·HG |
| AC-APP2-02 | [web][device] APP-01 AC2 | Given 앱 번들·설정·내보낸 iOS/Android 결과. When 문자열/의존 검사. Then 받아쓰기 일꾼 주소·토큰·운영 비밀·세션 상수가 없다. | 빌드 결과 검사 |
| AC-APP2-03 | [web] APP-01 AC3 | Given production 앱 번들. When 검사. Then core 판정·정산·voice 추출·품종 사전 구현이 없고 서버 결과를 표시한다. | 단위·번들 검사 |
| AC-APP2-04 | [web] APP-01 AC4 | Given 웹으로 열기/외부 링크. When 누름. Then 기기 브라우저로 열리고 앱 내부 WebView로 바꾸지 않는다. 로그인 연속성은 실제 기기에서 별도 확인한다. | 단위·HG |
| AC-APP2-05 | [web][ux] APP-01 AC5 | Given 콘솔·프린터·포장 화면 375px. When 정상·오류·빈 상태 확인. Then 웹과 같은 쉬운 한국어, 16px 이상, 색 외 상태 표현·44px 누름 영역을 지킨다. | 화면·UX |
| AC-APP2-06 | [device] APP-02 AC3 | Given 네이티브 마이크 표본. When 정상 캡처/전송. Then 16kHz 모노 PCM16 LE, 100ms마다 3,200바이트이며 JS view 바깥 버퍼를 보내지 않는다. | 단위·모의 전송 |
| AC-APP2-07 | [device][web] APP-02 AC1 | Given 앱이 음성 듣기 중 다른 앱으로 이동. When 30초 동안 모의 결과가 옴. Then 10초 안에 처리한 정상 결과만 기존 서버 요청으로 등록되며 앱 복귀 때 중복 등록하지 않는다. | 상태/통합·HG |
| AC-APP2-08 | [device] APP-02 AC2 | Given 마이크/Android 알림 활성. When 음성 끄기·방송 종료·로그아웃. Then 마이크·소켓·알림이 정리되며 뒤늦은 결과로 쓰지 않는다(실기기 1초 기준 HG). | 단위·HG |
| AC-APP2-09 | [device] APP-02 AC4 | Given Android foreground service/iOS background audio 설정. When 화면 꺼짐 5분. Then 조각/연결이 유지되는지 측정한다. SDK/기기 없음은 미검증으로 보고한다. | 에뮬레이터·HG |
| AC-APP2-10 | [device][web] VOC-06 끊김 | Given 음성 중계 끊김. When 다시 연결 시도. Then 1·2·4·8초·60초 안 여섯 번째 멈춤, 빨간 안내·빠른 입력 유지, 끊긴 동안 PCM 재전송 없음. | 단위·통합 |
| AC-APP2-11 | [web] VOC-06 늦은 글 | Given 말 끝 기준 기기 10초 초과 결과. When 앱이 처리. Then 자동 등록 없이 전체 읽기 결과의 확인 카드로 남긴다. | 단위·통합 |
| AC-APP2-12 | [device] APP-03 AC1 | Given 모의 B1 BLE·웹 B1 adapter와 같은 라벨/농도. When 연결·테스트/상품 출력. Then 프린터 골든과 같은 프로토콜 바이트·점이 간다. | 골든·단위 |
| AC-APP2-13 | [web] APP-03 AC2 | Given iOS 앱 native BLE 사용 가능. When 프린터 연결. Then 연결→B1 선택→서버 테스트 라벨→네 변/한글 확인→출력 기기 마법사가 보이고 UNSUPPORTED로 건너뛰지 않는다. | 화면·HG |
| AC-APP2-14 | [server][device] APP-03 AC3, APP-05 | Given 실제 서버가 보낸 상품/포장 라벨 bitmap. When 앱/BLE로 출력. Then 원래 점은 동일하고 B1 흰 마지막 줄 추가 등 기존 adapter 변환만 적용된다. 앱에는 renderer가 없다. | 서버↔adapter 통합 |
| AC-APP2-15 | [server][web] D-APP2-02 | Given bitmap 404·403·409·잘못된 base64/크기·통신 실패. When 받기. Then 빈 라벨·가짜 성공·print done 없이 오류를 보이고 기존 대기열 안전 규칙을 따른다. | 적대·단위 |
| AC-APP2-16 | [server] L-11 | Given 다른 판매자/다른 기기/지난 시도/완료 작업의 bitmap 요청. When 조회. Then 그림 유출·작업 탈취·출력 상태 변경이 없다. 정상 시도는 기존 고정 데이터로만 그린다. | 적대 |
| AC-APP2-17 | [device] APP-03 AC4 | Given 실제 Android/iPhone/B1. When 30장 연속 출력. Then 모든 라벨·마지막 줄·중복/누락·재연결을 확인한다. 실제 장비 없음은 HG-APP2 미확인. | HG |
| AC-APP2-18 | [web] APP-04 AC1 | Given 앱/탭이 뒤로 간 동안 새 찜 발생. When 앞으로 돌아옴. Then SSE를 다시 잇고 최신 찜이 보인다(3초 목표는 별도 측정). | 웹 E2E·앱 상태 단위 |
| AC-APP2-19 | [web][device] APP-04 AC2 | Given 뒤에 있는 동안 서버에 라벨 대기열이 쌓임. When 복귀/기존 프린터 재연결. Then 현재 출력 기기만 기존 순서로 이어 출력하고 이미 끝난 라벨을 중복 출력하지 않는다. | 통합·E2E |
| AC-APP2-20 | [web] APP-04 AC3 | Given 자리를 비운 동안 라벨/찜/음성 변화. When 복귀. Then 맞는 수의 `자리를 비운 동안 …` 한 줄, 0 항목 생략, 모두 0이면 없음, 10초 뒤 제거. | 단위 |
| AC-APP2-21 | [server][web][device] D-APP2-01 | Given native 헤더·쿠키를 쓰는 실제 서버 연결. When 정상 세션, 쿠키 없음/만료, 보조자, Origin 없음/다름을 각각 요청. Then 정상만 허용되고 다른 경우 거절된다. token URL/가짜 표/인증 우회 없음. | 서버 통합·적대·HG |
| AC-APP2-22 | [web][device] D-APP2-03 | Given production native 모듈을 연결할 수 없음/권한 거절. When 음성/프린터 켜기. Then 설명과 대체 손 입력이 보이고 Fake 구현이 자동 선택되지 않는다. | 단위·화면 |
| AC-APP2-23 | [device][web] D-APP-11 | Given iOS/Android 앱 설정. When 권한 설명·서비스 알림 검사. Then 스펙의 한국어 마이크/블루투스/알림 문장과 background 권한·서비스 선언이 들어 있다. | 구조·HG |
| AC-APP2-24 | [web] APP-01 화면 범위 | Given 로그인한 판매자. When 방송 시작·상품 빠른 입력·문자찜·포장 확인·음성/라벨 설정을 사용. Then 모의 API 성공이 아닌 실제 서버 상태·오류가 화면에 반영된다. | 통합·화면·E2E |

## 완료 판단

타입·린트·단위·골든·적대·E2E·보호 경로 게이트 통과 및 수용 기준별 근거를 남긴다. Expo 번들 검증은 기기 설치/백그라운드/실물 인쇄의 증거로 대신하지 않는다. EAS/스토어 계정·SDK·실물 부재는 구체적인 미확인 항목으로 보고한다.
