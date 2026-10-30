# APP1/APP1b E2E 이행 기록

- 역할: 독립 test-e2e. 제품 코드는 이 역할에서 수정하지 않는다. 커밋/전체 verify는 오케스트레이터 소유다.
- 근거: D-APP1b-05~07, APP1 acceptance의 기존 E2E 이전 판정. 기존 시험 파일을 유지하고 주입 경계만 이전했다. skip/only/todo나 검색 제외는 추가하지 않았다.
- PC 넓은 화면은 저장된 명시 `chrome` 선택으로 기존 Web Speech 입력/중간 글/재시작 규칙을 계속 시험한다. 모바일 375/393/412px와 WebKit은 같은 상품 원문을 LG 경로로 보낸다.

## 실제 연결과 모의 경계

`tests/e2e/app1/support.ts`는 실제 로컬 인증 서버의 `/api/voice/worker`에 테스트 전용 토큰으로 연결한다. 기기는 제품 WebSocket/transport를 쓰며, worker가 받은 흐름 번호 4바이트+PCM 3,200바이트를 확인한 뒤에만 그 흐름에 최종 결과를 준다. 카드 snapshot이나 읽기 판단을 직접 주입하지 않는다. 등록/고침/문자찜은 기존 실제 HTTP/DB 경로를 지난다.

- Chromium: 합성 상수 소리 MediaStream → 제품 AudioWorklet → 제품 WS → 실제 relay → 모의 STT worker. PCM 기기별 표지로 흐름을 식별한다.
- WebKit: 자동화 런타임의 마이크/AudioContext 허용 정책 때문에 캡처 경계에서 100ms PCM 틀을 합성한다. 제품 transport와 실제 relay/읽기/HTTP는 그대로 쓴다. 이는 실제 iPhone 마이크/오디오 하드웨어 검증을 대신하지 않는다.
- ready 이전의 소리는 제품이 버린다. fixture도 ready 이후 100ms 캡처 시간이 흐른 뒤 틀을 보낸다. 연결 전/끊긴 소리를 뒤늦게 재생하지 않는다.
- 권한/마이크 없음은 getUserMedia 경계의 실제 DOMException 이름으로 주입한다. 연결 끊김은 열린 실제 기기 WS를 닫는다. 재시도는 page.clock과 관측 가능한 상태/소켓 수로 확인한다.
- 늦은 결과는 동일 최종 글의 음성 종료 시각을 10초 넘게 과거로 둔다. LG에는 Web Speech intermediate/end가 없으므로 옛 `flushedAtEnd`의 수동 확인 의미를 이 조건으로 확인한다.
- 이력은 운영에 없는 `/_e2e/voice/history` 공급자 관측/실패/지연 주입을 쓴다. 브라우저 `/api/days` 경로를 가짜 실패로 바꾸지 않는다.

## 시험 대응표

같은 AC로 묶인 매개변수 시험은 아래에 모두 표시했다. 변경되지 않은 PC 시험의 입력/번호/금액/중복/개인정보 단언은 유지한다.

| 파일·시험 제목(식별 부분) | 옛 AC → 새 AC | 바꾼 전제·주입 | 보존한 단언 |
|---|---|---|---|
| i4/voice-onoff `누르기 전에는…` | I4-10 → APP1-40, APP1b 이력 | PC Chrome 유지, 이력 관찰만 서버 hook | 켜기 전 자원/조회 0, 켠 뒤 한 번 조회, 새로고침/화면 이동 뒤 꺼짐 |
| i4/voice-onoff `지원하지 않는 브라우저…` | I4-12 → APP1-41 | Chrome도 없고 캡처도 없는 기기의 새 안내 | 창 전 안내, 꺼짐, 빠른 입력 |
| i4/voice-onoff `저장소를 쓸 수 없으면…` | I4-11 → APP1-37 | 저장 선택 불가 시 기본 LG + PCM | 매번 동의, 닫기 때 시작 금지 |
| i4/voice-history `켤 때 한 번…10개만` | I4-40 → APP1b 이력 | 인증된 서버 공급자의 날짜/null 호출 관찰 | 켜기 전 0, 현재 제외 최신 실제 10개 정확한 날짜, 10번째 포함/11·12·리허설 제외, 새 현재 품종 갱신, 브라우저 이력 HTTP 0 |
| i4/voice-history `조회가 실패하면…` | I4-40 → APP1b 이력 | 서버 공급자 fail=true | 정확한 실패 안내, 현재/기본 사전으로 계속 |
| i4/voice-cards `휴대폰 폭…` | I4 카드 → APP1b-14 | 375px 그대로, 합성 마이크/실제 WS | 카드·등록 버튼/Enter 금지·가로 넘침 |
| i4/voice-cards 오프라인 등록 | I4-03 → D-APP1b-07 | 서버 카드가 보인 뒤 offline | 카드 보존, 명시 등록, 재시도, 단일 쓰기 |
| i4/attacks `휴대폰 폭에서 긴 자막…` | I4 배치 → APP1-38/APP1b-14 | 같은 긴 원문을 LG 최종 글로 전송 | 긴 자막/카드, 가로 스크롤 없음 |
| i4/attacks `TE-I4-002 음성 코드를 받지 못하면…` | I4 lazy load → APP1-40 | 동적 조각 이름 src-* → transport-* | 첫 요청 실패 안내, 재시도 때 실제 새 요청, 카드 생성 |
| i5/safari `조용한 120초…` | I5-20 → APP1-38 | Safari 3초 end 반복 → LG 같은 WS | 120초 오류/멈춤 없음, 뒤 최종 카드와 등록 |
| i5/safari `권한 거부` / `마이크 없음` | I5-21·28 a/b → APP1-42 | getUserMedia NotAllowedError/NotFoundError | 정확한 오류·자동 재시도 없음·빠른 입력·다시 켜기 |
| i5/safari `듣는 중 세션 종료…` | I5-21 c → APP1-33 | 폐기된 Safari Siri 제한 → 실제 logout/AUTH | 명시 오류·재시도 없음·자동 쓰기 없음 |
| i5/safari `60초 안 여섯 번째 끊김…` | I5-21 d → APP1-31 | 실제 WS 6회 끊김 | 한도 멈춤·다시 켜기·빠른 입력 |
| i5/safari `늦은 최종 글…30초` | I5-22 → APP1-36 | 중간 글/end → 10초 넘게 늦은 결과 | 카드 정확히 1, 바로 등록 켜져도 30초 자동 등록 0, 명시 등록 |
| i5/safari `같은 최종 글…바로 등록` | I5-04/V3-20 → APP1b-04 | 실제 PCM/worker 최종 글 | 같은 번호/품종/가격 즉시 등록, 대기 카드/카운트다운 없음 |
| i5/safari `홈 화면 여부 true/false` | I5-11 a/b/c → APP1-37·38 | Safari 전용 경고 → LG 고지 | 두 기기 모드의 고지, 60초 안정 연결, 폐기된 경고 없음 |
| i5/safari `다시 켜기 뒤 대기 카드…` | I5-14 → APP1-31/APP1b 세션 | 인식 객체 재생성 → 실제 연결 재개 | 동의창 없음·오류 제거·기존 카드 보존/수동 등록 |
| i5/safari `처음 동의 세 줄…` | I5-12 → APP1-37 | Apple 고지 → 정확한 LG 세 줄/별도 동의 키 | 첫 닫기 포커스, 상시 고지, 옛 Apple 고지 없음 |
| i5/safari `캡처 미지원…` | I5-10 → APP1-41 | SpeechRecognition 없음 → getUserMedia 없음 | 동의/마이크/소켓 0, 안내, 손 입력 |
| i5/safari `393px 카드 4장…` | I5-23 → APP1b-14 | 동일 393px/최종 글 4개 | 카드/고지/버튼 가시성, Enter 쓰기 0, 끄기 뒤 카드 보존, 트랙 종료 |
| i5/safari `켜지 않으면…` | I5-24 → APP1-40 | 인식 객체 대신 마이크/WS/transport 조각 | 모두 0, 빠른 입력 유지 |
| i5/safari `서버 이력이 느려도…` | I5-22 이력 → APP1b-11 | 브라우저 route gate → 서버 지연 3초 | 지연 중 늦은 카드도 자동 등록 0, 수동 등록 |
| i5/breaks `클라우드 음성 키 칸…` | I5-13 → APP1 UI | LG 연결 | 설정/콘솔 외부 서비스 키 칸 없음 |
| i5/breaks `결과 없는 소리 중 끄면…` | I5-03 c → APP1-40 | intermediate 대신 결과 전 PCM | 카드/쓰기 없음, 트랙 종료 |
| i5/breaks `결과 전 로그아웃…` | I5-03 d → APP1-33 | 폐기된 인식 오류 대신 AUTH | 카드/쓰기 없음, 재시도 없음 |
| i5/breaks `공백뿐인 최종 글…` | I5-03 e → APP1-38 | 최종 공백 | 카드/알림 없음, 동일 연결 |
| i5/breaks `최종 글 뒤 60초…` | I5-03 b/22 → APP1b-12 | end 반복 대신 60초 조용함 | 카드 중복 없음, 늦은 두 번째도 한 장 |
| i5/breaks `늦은 카드 뒤 바로 등록…` | D-I5-02 → APP1-36 | 늦은 결과 + 이후 옵션 켬 | 기존 카드는 자동 등록 금지 |
| i5/breaks `5회 끊김 뒤 63초…` | D-I5-01 → APP1-31 | 실제 연결 끊기 | 60초 창 밖 여섯 번째는 재연결 |
| i5/breaks `사이사이 3초 조용함…` | D-I5-01 → APP1-31 | 실제 연결 끊기 | 조용함이 한도 초기화하지 않음, 60초 안 여섯 번째는 멈춤 |
| i5/breaks `393px 긴 연결 오류…` | I5 오류 배치 → APP1-31·37 | LG 정확한 연결 오류 | 긴 오류/대기 카드/고지 가로 넘침 없음, 재개 뒤 수동 등록 |
| i5/audit2 `넘긴 카드 표시…` | I5-25 → APP1-36/APP1b 카드 | end-flush → 늦은 최종 결과 | 확인 필요/이유, 밀린 카드 알림/알겠어요, 보통 카드 알림 없음, 자동 등록 없음 |
| i5/audit2 `새 맨 앞 카드…` | I5-26 a/b/c → APP1b-14 | 실제 LG 최종 글 | 393×568 메뉴 위 카드, 편집 중 스크롤 0, 이미 보이면 이동 0 |
| i5/audit2 `홈 화면 앱도 서버 고지…` | I5-26 홈 화면 줄 → APP1-37 | 폐기된 경고 대신 서버 고지 | 두 카드, 좁은 화면 가로 넘침 없음 |
| i5/audit2 `LG 첫 동의 세 줄…` | I5-27 → APP1-37 | LG 세 줄 | 동의 유지·재개 시 창 없음·옛 권한 문장 없음 |
| i5/audit2 `18초 조용함…` | I5-29 a → APP1-38 | end 반복 대신 같은 연결 | 재연결 상태 깜빡임 0, 오류 0 |
| i5/audit2 `연결 직후` / `연결 후 3초` | I5-29 b/c → APP1-31 | 실제 WS close | 재연결 상태를 거쳐 듣는 중, 소켓 2 |
| i5/audit2 `지원 안 함 안내…` | I5-30 → APP1-41·42 | 캡처 미지원/권한 DOMException | 안내/오류 색 구별, 닫기, 빠른 입력 성공 때만 제거 |
| i5/audit2 `393px는 짧은 고지…` | I5-31 → APP1-37 | LG 상시 고지 | 카드가 생겨도 고지/배치 유지 |
| i5/audit2 `network…1분 안에6번` | I5-32 → APP1-31 | 실제 WS 6회 | 연결 오류·재개 버튼·손 입력 |
| i5/audit2 `홈 화면 앱…60초` 두 시험 | I5-33 a/b → APP1-38 | 폐기된 홈화면 end 제한 대신 같은 LG 연결 | 두 환경 모두 60초 안정·오류/옛 경고 없음 |
| mob1/voice `처음…LG 안내 세 줄` | MOB1 동의 → APP1-37 | 모바일 LG 세 줄/별도 키 | dialog 동의/포커스, 화면 잠금 7개 시나리오 그대로 |
| v1/attacks `두 기기…` | V1-31 → APP1-32/APP1b 한 흐름 | 둘째 OTHER_DEVICE, 첫 음성의 실제 HTTP 본문을 둘째 인증 기기가 새 요청 ID로 중복 제출 | 두 품목/손님 문자찜 정확히 각각1·양쪽 보드·voice:true, 중복 HTTP409 VOICE_REPEATED 정확문장·추가 이벤트/대기0 |
| v1/sms-cards `15초 뒤 같은 말…` | V1-21 → APP1b 시간 | 실제 서버 HTTP 중복방어10초 대기 뒤 읽기세션의 가속시각 동기화 | 3·2·1초/쓰기1, 이후 같은구매자 새찜0·HTTP2·claim1, 실제10초방어 유지 |
| v1/attacks `연결이 끊긴 채…` | V1-22 → APP1b 연결 안전성 | 끊긴 WS 뒤 자동효과가 전달되지 않으면 HTTP 시도0(실제 실패trace 확인) | 카드/안내·자동대기중지, 복귀 자동쓰기0, 명시넣기 하나·동일 요청 ID |
| v2/chunks `V2-17 휴대폰375 큰칸` | V2-17 → APP1-38 | 같은 HTML 모양 원문을 LG 최종 조각으로 전달(PC 중간 결과는 유지) | 모은 글·22px·HTML 비실행·다음 가격 조각 뒤 카드/읽은 결과·가로 넘침 없음 |
| v2/chunks `S9 선버스…배운 이름 유지` | V2-07·09 → APP1b-08 | localStorage 확인 → 인증된 aliases API | 선택 후보/등록/새로고침 뒤 같은 별칭 읽기 유지, 기기 원문 저장 없음 |
| v3/settings `판매 이력 2초 기다림…` | V3-43 e → APP1b 이력 | 새 판매자의 서버 공급자 지연/pending/completed | 끈 채 읽은 덩어리는 옵션을 켜도 자동 등록 0, 이력 완료 뒤에도 카드, 다음 덩어리만 바로 등록 |
| v3/settings `R29 둘째 휴대폰 음성…` | V3-38 R29 → APP1-32/APP1b 한 흐름 | 오케스트레이터/spec_final 명시 판정: 두 음성 동시 읽기 대신 둘째 OTHER_DEVICE | 첫 등록 정확히 1, 양쪽 보드, 임의 고침/중복 쓰기 0, 둘째 손 입력 유지. 같은 요청 ID 멱등성은 기존 실제 HTTP/오프라인 시험으로 유지 |
| pl1b/voice-flush `10초 넘게 늦은…` | PL1B-26 → APP1-36/APP1b-04 | 같은 문자찜 원문을 늦은 최종 글로 | 카드·10초 자동 문자찜 0·수동 넣기 정확히1·끝자리/상품·393px 배치 |
| i4/voice-layout `I4-51 개발용어 없음` | I4-51 → APP1b 비동기 캡처 | 동의/오류재시작 직접 클릭 뒤 서버 LISTENING 및 실제 Chrome capture 시작을 기다림 | 동의·카드·설정·입력오류·음성오류 전체 문장에서 영어상태/개발용어 없음 |
| i4/voice-onoff `I4-11 새 페이지도 창 없이` | I4-11 → D-APP1-04/APP1b 공용1 | 첫 페이지 명시OFF+실제WS닫힘 뒤 같은 context 새 페이지 켜기 | 첫 동의 정확문장·닫기/Esc/포커스·동의 영속성·새페이지 동의0/실제LISTENING·Chrome 인식설정 |
| mob1/hide `방송을 다른 기기에서 끝내면` | MOB1-17 → APP1-44/APP1b-16 | 구 음성끄기 잔존 대신 ENDED 자동OFF | 빠른입력1초제거·치던글/늦은쓰기0·캡처/소켓종료·10초뒤 재연결0·음성켜기없음; 같은파일 끝난상품 손고치기 시험 그대로 |
| n3/round1 `이력2초 안/끝내없음/설정전환` 3개 | N3 라운드1·I4-40·TE-V3-009 → APP1b-11 | browser /api/days route gate → 서버 실제 historyObserver hold/release·held 관측 | 지난품종 정확카드/원문기록, 응답미도착2초fallback 두카드순서, 끈채말한후옵션켜도10초 자동등록0 |

### 이력 세션 수명 해석

오케스트레이터 확인(2026-10-30): APP1b-09는 종료 시 서버 세션 메모리를 버린다. 따라서 off/on으로 새 세션을 만들 때 동일한 최근 10개 범위를 다시 읽는 것은 허용한다. 기존 브라우저 컨트롤러 수명 전체 한 번 조회 가정은 세션당 한 번으로 옮긴다. 카드 보존은 별개의 사용자 기능이므로 이력 재조회 허용으로 카드 소실을 정당화하지 않는다.

## 실행 기록

- 이행 전 i4 카드/바로등록/이력 29개: 21 통과, 8 실패. 제품: 체크박스 즉시 반영 2, 끄기/켜기 카드 소실 1, TOO_SOON 해제 1. 오래된 시험 경계: 모바일 worker 없음 2, 브라우저 이력 실패 주입 2.
- 이행 후 Chromium 모바일 카드 + 서버 최근 10개/실패 이력 3개 통과. WebKit 정상 최종 즉시 등록 1개 통과.
- 중간 빌드 `SERVICE_NAME` import 누락으로 로그인 렌더 실패한 실행은 제품 개발 중 산출물이며 통과로 세지 않았다. 다음 빌드에서 해소됨.
- 첫 최신 Safari 실행 16개 중 5 통과/6 실패/5 미실행(max-failures): 재연결 문구, LG 홈화면 경고, LG 동의 네 번째 문장 제품 오류를 개발자에게 전달. 나머지 PCM 준비 실패는 fixture가 ready 후 100ms 전에 틀을 보낸 문제로 수정함.
- 후속 정확성 재실행 결과는 아래에 이어 기록한다. 실제 iPhone 오디오/실제 STT 품질/실제 프린터 하드웨어 통과를 이 결과로 주장하지 않는다.

### 시험 경계 보완

- `navigator.mediaDevices` 객체 자체를 fixture에 보존한다. WebKit에서 wrapper가 다시 생기면 getUserMedia만 바꾼 값이 사라져 실제 OS 권한 거절이 섞였다. getter로 합성 마이크 경계를 유지한 뒤 정상/늦음/이력 지연 3개가 통과했다.
- 읽기 소비 이전에 끄는 경우와 이미 읽힌 기록 보존을 구분하도록 첫 문장의 서버 `heard` 응답을 기다린다. 기록 50개 시험은 각 문장 사이 서버의 실제 시계와 가속한 기기 시각을 `context`로 맞추고 응답을 기다린다. 1.8초 quiet 경계를 별도 검증하는 시험이 아니므로 기록 상한 시험의 간격은 2.5초로 둔다. 기록 수/처음·마지막 원문/버린 1개 단언은 그대로다.
- WebKit pauseAt(now+10ms)는 병렬 부하에서 과거로 이동 오류가 나므로 기존 다른 fixture와 같은 now+1000ms로 시작 시계를 멈춘다. 최종/중간/늦음의 기준 간격은 각 시험이 이후 명시적으로 흘린다.
- page.clock이 없는 실제 AudioWorklet 시험에서는 fixture가 runFor로 시계를 설치하지 않는다. 첫 100ms 캡처는 관측한 시각을 기다린다(미설치 runFor가 epoch 0으로 바꾸는 오류 방지).

## 제품 지적과 검증 상태

| ID | 심각도/분류 | 제품 위치 | 근거/재현 | 상태 |
|---|---|---|---|---|
| TE-APP1-001 | major / ux | apps/web/src/voice/remote.ts turnOn | APP1-41; i5/safari 캡처 미지원, i5/audit2 I5-30. 지원검사 전에 동의창이 열림 | Safari 및 Chrome 최신 재검증 통과 |
| TE-APP1-002 | major / ux | apps/web/src/voice/remote.ts setInstant | V3-40; i4/voice-auto:79 및 v3/settings. 옵션을 끈 뒤 저장소 null, 새로고침 경쟁 | I4·V3 설정 저장/새로고침 재검증 통과 |
| TE-APP1-003 | major / ux | apps/web/src/voice/remote.ts turnOff | I4-14/V2 기록; i4/attacks 첫 글 서버 heard ACK 후 끄고 기록 조회 → 1개 기대0 | Chrome pauseCapture가 reader 준비상태를 지워 turnOff 전송 누락 확인. 수정 후 기록 보존/늦은 결과 무시 재검증 통과 |
| TE-APP1-004 | major / ux | apps/web/src/voice/remote.ts onState | I4-12; i4/attacks TE-I4-001, voice-onoff 오류6회 뒤. Chrome 재시작 표시 누락/멈춤 뒤 phase on | 재시작 표시·여섯번째 멈춤·최종글 뒤 횟수 초기화 재검증 통과 |
| TE-APP1-005 | major / ux | apps/web/src/voice/remote.ts 연결 종료/SMS snapshot | V1-22/APP1b; v1/attacks offline 대기 문자찜. 자동쓰기0은 옳지만 안내·수동 재시도 상태가 없음 | offline 이벤트에서 캡처/WS를 끊고 자동대기 중단. setOffline 원형으로 안내·복귀자동0·수동1 재검증 통과 |
| TE-APP1-006 | minor / spec | apps/web/src/components/VoicePanel.tsx, voice/remote.ts | APP1-31·37; LG 재연결 문구·홈화면 경고·동의4번째문장 | 수정 후 해당 Safari 사례 통과 |

| TE-APP1-007 | major / logic | packages/voice-session/src/server.ts register/fixRecent | V3-57 R66; 등록 DB는 존재하나 기기 store 동기화 전에 고침 효과가 도착해 수정 유실 | matching noteVoiceRegistered ACK까지 기다리도록 수정, 원문 200ms 토큰 E2E 재검증 통과 |
| TE-APP1-008 | minor / spec | apps/web/src/components/VoiceBand.tsx | V3-58; 명시 Chrome 선택인데 고지 문구가 LG 서버로 고정됨 | 현재 캡처 엔진에 맞는 고지로 수정, 재검증 통과 |
| TE-APP1-009 | minor / ux | apps/web/src/voice/remote.ts 초기 snapshot | V3-42; 저장된 바로등록 OFF인데 동의창은 ON 문장 | 초기 기기설정 반영, ON/OFF 모두 재검증 통과 |
| TE-APP1-010 | major / logic | APP1b 읽기 결과/등록 ACK 경계 | V3-25 R7; 139 등록 뒤 189 다른 번호 안내 대신 이미 등록됨 | 기존 4초 읽기 안내 큐로 앞 알림 보존, 원문 200ms 토큰 재검증 통과 |

모든 지적 confidence=CONFIRMED, area=web. 실제 마이크 문제처럼 보였던 native getUserMedia 호출은 fixture 원인으로 제품 지적에서 제외했다.

- Safari 선택37개: 31통과6실패. 3개 첫 캡처 시계 동기화, 1개 옛 4장 배치의 손댄 카드 준비 누락은 fixture/시험 이행 수정. 2개는 TE-APP1-001이며 수정 뒤 재실행한다.
- PC I4 선택53개: 41통과8실패4미실행. 제품 TE-APP1-002~004 및 fixture/옛 이력·모바일 준비 경계로 분류했고 후속 재실행한다.
- V1/V2/V3 선택229개: 219통과/10실패. V1 두기기 전제와 offline SMS를 위 명시 판정대로 이행했고, 아래 최신 선택으로 수정/이행을 다시 검증한다.
- V1 offline 실패 trace의 실제 요청: `/api/events` 상품 준비 POST 1, SMS POST 0. 새 시험은 이 0을 명시하고, 복귀 후 자동 전송0/명시적 넣기 요청 ID1/문자찜 이벤트1을 유지한다.

### 후속 재검증

- 최신 웹 수정 뒤 Safari37개 선택: 36통과, I5-25만 늦음 주입의 시각 오차로 실패. 모의 worker의 최종 글 전에 읽기 시각 ACK를 받고 11초 늦음으로 고정한 뒤 해당 I5-25가 1/1 통과했다. 합계37개 모두 확인됨. 393×568 자동 스크롤/편집 중 스크롤 금지, 393px 4장(앞3장 손댐)·끄기 뒤 보존, 문자찜 늦음 자동쓰기0, 정확한 동의3줄·unsupported·권한·실제 연결 재시도 포함.
- V1/V2/V3 229개 선택: 이전 웹 빌드에서 219통과/10실패. 5개는 이미 이행한 시험 경계(V1 두기기/오프라인HTTP0/실제10초 뒤 시계, V2 별칭 API/모바일 최종 글), 2개는 수정된 제품(설정즉시저장/R66 등록 ACK), 3개는 추가 지적(Chrome 외부 전송 고지, 저장된 OFF 동의, R7 다른 번호 안내)이다. 기존 I4 수정 지적을 합친 23개를 최신 빌드로 다시 검증한다.

- 최신 23개 선택: 18통과/5실패(2.3분). 통과한 핵심은 위 표 TE-APP1-001~004·007, R29/V1 한 흐름·HTTP 중복409, V1 15초 후 문자찜, V2 계정별칭/375px, 서버 이력 지연이다. 남은 5개는 Chrome 캡처 시작 전 오류주입(helper 대기 추가), offline 이벤트 전달/끊긴 WS 처리, TE-APP1-008~010이다. 모든 수정 E2E 타입 검사·lint·diff 공백 검사 통과.

- 마지막 최신 선택20개: **20/20 통과(36.6초)**. 앞 선택에서 남은5개(Chrome 권한 재시작, V1 offlineSMS, Chrome Band 고지, R7 다른번호 안내, 저장 OFF 동의)를 모두 해결 확인했고, Chrome ON 동의 및 I5 PC7개·MOB1 화면잠금/동의7개도 통과했다. V1 offline 시험은 `context.setOffline(true)`만 쓰는 기존 경계 그대로이며 fixture에서 추가 WS close로 통과시키지 않았다.
- 이 역할에서 등록한 제품 지적 `TE-APP1-001`~`TE-APP1-010`은 모두 `resolvedIds`다. 미해결 제품 지적은 없다. 전체 `pnpm verify`는 오케스트레이터가 최신 소스에서 최종 실행한다. 위 개별 결과는 서로 중복되는 회귀 선택이므로 합쳐서 고유 시험 총수로 세지 않는다.
- 마지막 공용 fixture 수정은 Chrome 실제 인식 객체의 `started && !stopped` 확인 후 오류/결과를 주입하는 준비 경계다. 결과/카드/상품 상태는 수정하지 않는다. E2E 타입 검사와 변경 파일 lint, `git diff --check`가 통과했다.

### 전체 검증 후 추가 재검토

- 라벨 canonical bitmap 변경 재검증: `E2E_ONLY=chromium E2E_PORT_OFFSET=30000`, `i1/files.spec.ts` 전체 2개와 `i1/screens.spec.ts` AC-I1-35 포장 1개가 **3/3 통과(31.5초)**. 미리보기/실제 시험 프린터/PNG 픽셀 일치, 개인정보 없는 파일명·PDF 정보, 25장 A4 2쪽, 포장 묶음 변경 시 재출력 단언을 그대로 유지했다. 절대 경로 결과 `work/e2e-label-recheck-results`, 로그 `work/e2e-label-recheck.log`.
- 새 지적 **TE-APP1-011** (major / logic, CONFIRMED, area=web, file=`packages/voice-session/src/server.ts`): 빠른 입력 15번 핑크프릴 20,000원 등록의 응답을 보류한 동안 음성 "15번 라울 만원"을 읽고 응답을 풀면, 첫 발화는 가격 고침 묻기로 끝난다. 같은 최종 글을 다시 읽으면 고침이 진행돼야 하나 "고치는 중"에서 멈추고 상품이 바뀌지 않는다. 기존 `i4/attacks.spec.ts:235`가 전체 실행과 별도 빈 서버에서 같은 line270으로 실패했다. fixture/기대값 변경 없음.
- 원인: 서버 어댑터의 `registering`은 자기 등록의 `noteVoiceRegistered`를 기다리지만 기기 등록 큐에서 기존 상품을 발견하면 `instantExists(card)`만 돌아온다. 이 경로에서 대기가 정리되지 않아 이후 `fixRecent`가 30초 기다린다. 실패 trace 실제 HTTP는 손 입력 `product.register` 200 한 건뿐이며 `product.update`는 0건이다. 등록 실패/timeout의 대기 수명 정리도 개발 담당에게 함께 전달했다.
- TE-APP1-011 상태: 수정 후 독립 E2E 재검증 통과, resolvedIds에 추가. 독립 재현 로그 `work/e2e-voice-collision.log`, 결과 `work/e2e-voice-collision-results`. 전체 7개 게이트의 최종 결과는 부모 오케스트레이터가 별도 확정한다.

- 수정 뒤 최신 독립 선택 **3/3 통과(6.7초)**: I4 손입력/음성 같은 번호 충돌, R66 등록 뒤 즉시 정정, R7 다른 번호 안내. 기존 시험 코드·기대값을 바꾸지 않았다. `instantExists`는 서버가 보낸 원본 카드와 실제 상품을 검증한 뒤 해당 등록 대기를 끝내며, restore/timeout에서도 대기 항목을 정리한다. 재검증 로그 `work/e2e-voice-collision-fixed.log`, 결과 `work/e2e-voice-collision-fixed-results`. 현재 TE-APP1-001~011의 미해결 지적은 0개다.

### 추가 네 사례 재검토

- 전체 검증에서 지적된 I4-51 언어/동의 새페이지/MOB1 방송종료/PC채팅8행은 별도 빈 서버에서 4/4 동일 실패했다(`work/e2e-followup-four.log`). 앞 세 건은 위 대응표처럼 폐기된 동기 초기화·동시 흐름·종료 음성 잔존 전제만 이전한다. spec_final이 I4 동의/MOB1 종료 이행을 UPHOLD했고, 직접 근거는 D-APP1-04·D-APP1-03·AC-APP1-44·APP1b-16이다. 같은 브라우저 저장소의 새 페이지에도 메모리 device 표지는 새로 생기므로 동시 두 흐름을 가정하지 않는다.
- 동의 새페이지/방송종료는 이행 뒤 2/2 통과했다. I4-51은 최초 동의뿐 아니라 오류 반복 재시작에도 실제 캡처 준비를 기다리는 공용 helper를 적용해 재검증한다. 시험 정답과 문장 검사는 바꾸지 않는다.
- **TE-APP1-012** (major / ux, CONFIRMED, area=web, file=`apps/web/src/components/VoicePanel.tsx`): 1440×900 음성 꺼진 콘솔에서 새 엔진 선택/켜기 두 행 때문에 `.console-head` 높이96px, 채팅목록 y524.98px가 되어 언급20개 중 완전히 보이는 행이7개다. AC-MOB1-22/S06-62는 ≥8개이며 모든 변환 버튼 ≥44px를 유지해야 한다. 빈 서버 두 번 재현했고 `mob1/small.spec.ts`에 읽기전용 `chat-geometry.json` 첨부를 추가해 상단/목록/행 좌표를 기록했다. 기존 수치 기대는 그대로다. 개발 담당에 전달했고 수정 후 재검증 예정이다.

- I4-51 비동기 캡처 준비 이행 뒤 **1/1 통과(시험5.9초)**. 최초 동의와 오류3종 반복 재시작의 문구/개발용어 금지 단언은 모두 그대로다. `work/e2e-followup-language.log`.

- TE-APP1-012 수정 후 최신 선택 **9/9 통과(1.1분)**. PC 8행/변환·옵션 버튼44px, 375px·1440px 음성카드 고정영역, 375/412px 글자150% 빠른입력/되돌리기, I4-51 전체문구, 동의새페이지, ENDED 종료를 함께 검증했다. PC 선택/켜기를 공용 row로 배치하여 기존 크기/이름을 유지한다. `work/e2e-followup-final.log` 및 `work/e2e-followup-final-results`. TE-APP1-012를 resolvedIds에 추가, 현재 열린 제품 지적0. 변경 E2E typecheck/lint 및 diff 공백 검사 통과.

### N3 과거 이력 대기 시험 이행

- 전체 진단의 실패7~9는 서버 읽기로 이전된 이력을 브라우저 `/api/days` route에서 기다려 발생했다. E2E 전용 공급자 observer에 hold/release를 추가하여 실제 DB 읽기를 통제한다. 기대 사전/카드/쓰기 결과를 가짜로 주입하지 않는다. hold:false는 진행 중인 대기를 해제하고, held는 실제 대기 수를 반환한다. 시험 뒤에는 해제/초기화해 다음 시험에 남기지 않는다.
- 기존 세 사례 그대로 **3/3 통과(19.6초)**: 2초 안 도착한 과거 임의 한글품종 읽기+원문기록, 응답 없이 기본사전으로 두카드 생성+순서, OFF 발화 후 이력대기 중 ON 전환에도10초 자동쓰기0. 발화가 서버에 소비된 뒤 gate를 푸는 준비 관측만 추가했다. 결과 `work/e2e-n3-history-results`, 로그 `work/e2e-n3-history.log`. 변경 시험 tsc/lint/diff 공백 검사 통과.

- 전체 진단의 실패10(`o4/attacks` TE-O4-ATK-4, 옵션 L 2개 미리보기/출력 bitmap 비교)은 이미 수정한 canonical 서버 미리보기의 이전 빌드 결과였다. 최신 빈 서버에서 기존 시험 그대로 **1/1 통과(6.7초)**. 출력 대기/이력 옵션·수량, M 취소 시 버릴 라벨, L 2개 픽셀 일치를 모두 보존했다. 로그 `work/e2e-option-label.log`, 결과 `work/e2e-option-label-results`. 추가 코드 변경 없음.

- RA-APP2-004 성능 보완과 단일키 조회의 await 전 상태 고정까지 포함한 최신 빌드에서 라벨 회귀 **4/4 통과(35.7초)**: 상품 미리보기/실제 시험 프린터/PNG 픽셀, 25장 A4 두 쪽, 포장 묶음 변경, 옵션·수량/취소 라벨을 기존 시험 그대로 확인했다. 별도 빈 서버 `E2E_ONLY=chromium E2E_PORT_OFFSET=30000`; 로그 `work/e2e-label-final.log`, 결과 `work/e2e-label-final-results`. 전체 진단의 기존 서버와 빌드는 변경하지 않았다.

- 전체 진단의 실패11(`s06/layout` TE-S06-004, PC 1440×900 채팅 8행 기대7)은 TE-APP1-012와 같은 이전 빌드의 밀도 회귀다. 최신 빈 서버에서 기존 시험·≥8 단언 그대로 **1/1 통과(11초)**. 로그 `work/e2e-s06-density.log`, 결과 `work/e2e-s06-density-results`. 새 제품·시험 수정 없음.

### 실제 서버 AudioWorklet 로딩 경계

- **TE-APP1-013** (major / spec, CONFIRMED, area=web, file=`apps/web/src/voice/transport.ts`, specRef=`AC-APP1-30·34 / AC-APP1b-04`): 실제 연습 서버에서 Chromium 합성 WAV 장치의 getUserMedia와 AudioContext(48kHz, running)는 성공했지만 `audioWorklet.addModule(blobURL)`이 `AbortError: Unable to load a worklet's module.`로 실패했다. PCM0/등록POST0, 트랙·WS 종료, 화면은 마이크 없음 문장이다. 실제 사용자 마이크는 사용하지 않았고 일꾼은 로컬 Cohere였다. 실패 단계 관측은 원본 API 호출/예외를 보존한다. CSP console/violation 이벤트는0이므로 CSP가 직접 원인이라고 단정하지 않는다. 이전 근거 `work/real-asr-browser-before-fix.json`.
- 개발 담당이 같은 PCM 본문을 독립 JS 자산으로 옮겨 같은 출처에서 읽도록 수정했다. 기존 `script-src 'self'`/`worker-src 'self'` 정책과 음성 켜기 전 지연 로딩은 유지한다. 최신 `?url`/해당 자산만 inline 제외 구성에서 독립 `@served` **6/6 통과(10.3초)**: 새 실제 AudioWorklet→16kHz PCM→WS→서버 읽기→등록POST1/DB1→트랙·흐름 종료 및 CSP0, 기존 I3/LND1 보안5개. `tests/e2e/app1/served-voice.spec.ts` 추가, 기존 보안 단언은 수정하지 않았다. 모의 일꾼의 말끝은 실제 VAD 계약대로 0.4초 쉼 이전 표본 위치다.
- 위 실행은 `work/served-voice.playwright.config.mts`의 별도 빌드 `work/e2e-served-voice-web`만 사용하여 진행 중인 전체 진단의 shared served-web을 보존했다. 로그 `work/e2e-served-voice.log`, 결과 `work/e2e-served-voice-results`. TE-APP1-013의 운영 묶음 로딩 회귀는 해결 확인됐으며, 실제 Cohere 브라우저 관통 결과는 별도 후속 기록한다.

- 일반 Chromium 최신 회귀 **3/3 통과(9.8초)**: 기존 실제 PCM→등록→끄기, 일꾼 없음의 안내·손입력, 누르기 전 캡처/이력/음성 자산0 및 새로고침·다른 화면 후 OFF. 원형 시험을 바꾸지 않았다. `work/e2e-worklet-regression.log`, `work/e2e-worklet-regression-results`. 신규 E2E typecheck/lint 및 diff 공백 검사 통과.
- 실제 브라우저→로컬 Cohere→저장 관통 smoke **통과(5,600ms)**: 375px Chromium의 합성 WAV 파일 장치만 사용, native getUserMedia1→48kHz AudioContext→동일출처 AudioWorklet→PCM45틀(잘못된 크기0)→실제 Cohere 최종 글 `15번 핑크프릴 2만 원.`(말끝3,392ms)→등록POST1/HTTP200→DB15번·핑크프릴·20,000원1건. 끄기 뒤 모든 트랙 ended/WS closed, CSP 위반0. 모의 일꾼/인식 글 주입0, 실제 사용자 마이크0, 새 연습 리허설만 생성했다. 자격정보는 환경변수로만 전달했고 결과·화면에 저장하지 않았다. `work/real-asr-browser-before-default-mic.json`, `outputs/livegenie-cohere-browser.jpg`를 직접 확인했다. TE-APP1-013을 resolvedIds에 추가, 현재 열린 제품 지적0. 이 합성 입력 1건은 실제 iPhone·실사용 음성 정확도·실제 BLE 프린터 하드웨어 검증을 대신하지 않는다.

전체 진단 종료: 최종 Playwright JSON(`node_modules/.cache/livejjim-verify/e2e.json`)의 expected=1,665, unexpected=11, flaky=0, skipped=0, errors=0을 직접 확인했다(총1,676개, 약2.1시간). 실패 목록은 위에서 기록한 I1 라벨, I4 충돌·문구·동의, MOB1 종료·밀도, N3 이력3개, O4 옵션 라벨, S06 밀도와 정확히 일치하며 추가 실패는 없다. 모두 옛 빌드·이행 전 fixture에서 발생했고 각 사례는 최신 코드의 독립 재검증으로 해결 확인됐다. 이 결과는 진단 완료이며 최종 게이트 PASS가 아니다. 새 `@served` 음성 시험을 포함한 최신 트리의 전체 게이트 결과는 후속 최종 실행에서 별도로 확정한다. 제품·fixture 추가 변경 없이 이 기록을 동결한다.

### 최종 실행의 모의 말끝 시각 보완

- HEAD `1f924b96`의 후속 전체 실행에서 I4 긴 자막 375px 시험이 실패했다. 실제 trace WS에는 captureAt=1793299458256, 모의 result endMs=325, 따라서 spokenEndAt=1793299458581이었다. 서버 읽기 log.at=1793299458580보다 1ms 미래여서 `flushedAtEnd=true`로 처리됐으며, 원문은 heard에 있었지만 번호·가격 없는 문장이 즉시 discard되어 hearing/readout은 비었다. 입력 유실이나 화면 배치 제품 오류가 아닌 fixture의 쉼0 시각 모형 오류다. 미래 시각을 거르는 제품 방어는 그대로 유지한다.
- `tests/e2e/app1/support.ts`의 정상 `sayPcm` 말끝만 기존 실제 VAD 계약인 400ms 쉼 이전으로 계산한다. 최초 구간 `Math.max(0, ...)`, `late:true`의 기존11,000ms, 모든 원래 UI 단언·시간제한·skip 금지를 유지한다. 앞선 `@served`의 VAD 말끝 모형과 일치한다. 기존 전체 실행을 정지하고 trace를 보존한 뒤 별도 offset30000/출력 폴더에서 검증했다.
- 원래 실패 제목·본문·단언 그대로 반복 **10/10 통과(44.0초)**; 관련 WebKit 정상·늦음·이력 대기·문자찜 **7/7 통과(22.1초)**; Chromium 실제PCM·일꾼없음·지연로딩 **3/3 통과(10.8초)**; 독립 `@served` PCM·기존 보안 **6/6 통과(10.4초)**. 각각 `work/e2e-vad-repeat.log`, `work/e2e-vad-late.log`, `work/e2e-vad-pcm.log`, `work/e2e-vad-served.log`와 같은 이름의 `*-results` 폴더다. 반복 결과를 고유 시험 수로 합산하지 않는다. E2E typecheck/lint와 변경 파일 diff 공백 검사 통과. 최신 capture 제약 변경도 함께 빌드했으며, 이 결과 역시 최신 전체 게이트 결과를 대신하지 않는다.

- 기본 마이크 제약의 실제 Cohere 재검증 결과 `work/real-asr-browser-before-controller-fix.json`을 직접 확인했다: `ok=true`, `2026-10-31`의 격리 리허설 `b_Zf1ym5fzJe_8SVPb`, captureConstraints는 정확히 `[{audio:{channelCount:1},video:false}]`였다. 합성 WAV 장치의 native48kHz→동일출처 Worklet→PCM106틀(잘못된 크기0)→실제 최종 글 `15번 핑크프릴 2만 원.`→등록POST1/HTTP200→DB15번·핑크프릴·20,000원1건, 종료 후 tracksEnded/socketsClosed=true 및 CSP 위반0을 확인했다. 총11,919ms는 합성 재생을 포함한 단일 실행 시간이며 성능 p95나 인식 정확도 평가가 아니다. 오케스트레이터는 런처 서버·DB를 재시작하지 않고 새 웹 자산만 배포했으며 기존 자료를 유지했다. 이전45틀/5,600ms 결과는 위 `work/real-asr-browser-before-default-mic.json`으로 보존됐고 당시 화면은 `outputs/livegenie-cohere-browser.jpg`에서 확인했다. 추가 시험 없이 기록만 반영하고 동결한다.

- 같은 입력 조각 안에서 품종을 덮는 기존 잠재 오류를 수정한 제품 `bab85239`의 실제 브라우저 관통 결과 `work/real-asr-browser-result.json`을 직접 확인했다: `ok=true`, `2026-10-30`의 격리 리허설 `b_58onCsl03i1T80lG`, captureConstraints는 정확히 `[{audio:{channelCount:1},video:false}]`다. 합성 WAV 장치의 native48kHz→동일출처 Worklet→PCM45틀(잘못된 크기0)→실제 Cohere 최종 글 `15번 핑크프릴 2만 원.`→등록POST1/HTTP200→DB15번·핑크프릴·20,000원1건을 확인했다. 종료 후 tracksEnded/socketsClosed=true, 읽기 오류0, CSP 위반0이며 총5,805ms다. 이 단일 합성 입력의 성공은 해당 품종 덮기 결함의 별도 재현 시험이나 실사용 정확도·성능 p95를 대신하지 않는다. 오케스트레이터의 실행 기록에 따르면 최신 Node 서버와 Cohere를 재시작했고, 기존 보관 연습2개는 부모가 생성한 데이터만 확인했다. 최신 실행 화면은 `outputs/livegenie-cohere-browser.jpg`다.
- 일꾼 처리시간 두 표본은 오케스트레이터가 종료된 세션84961의 로그에서 관측한 284ms와6,506ms다. 느린6,506ms 표본도 포함해 기록하며, 현재 사용자용 서버 세션36602/PID17776의 측정값으로 오인하지 않는다. 표본 수가 부족하여 성능 p95와 실방송 지연 목표 달성 여부는 미확인이다. 추가 시험·소스·시험 코드 변경 없이 증거 기록만 갱신하고 동결한다.

### 독립 실제 PCM 시험의 모의 말끝 시각 보완

- HEAD `4d0f510a`의 전체 실행은 7단계 중6단계 통과, E2E는1,676통과·1실패로 끝났다(`work/verify-final-clean.log`). 유일한 실패는 `tests/e2e/app1/server-voice.spec.ts`의 `AC-APP1b-04·15·16`이었다. trace의 captureAt=1793307362657, 모의 일꾼 result startMs=2600/endMs=3600(PCM36틀)이므로 spokenEndAt=1793307366257이다. 서버 읽기 log.at 및 카드 createdAt=1793307366247보다10ms 미래여서 `flushedAtEnd=true`가 됐다. 원문 `15번 2만 원`은 heard에 있고, 번호15·가격20,000·autoConfirmAt=null인 OPEN 확인 카드가 남았으며 등록 effect는 없었다. 제품의 미래 시각 방어가 정상 작동한 것이며, 입력 유실이나 등록 제품 오류로 판정하지 않는다. 원 trace와 오류 화면 기록은 `work/verify-final-clean-pcm-trace/`에 보존했다.
- E2E와 웹 E2E 지원 코드의 모의 worker result 생산자는3곳이다. 공용 `app1/support.ts`는 정상400ms/늦음11,000ms, `app1/served-voice.spec.ts`는400ms를 이미 반영했다. 별도 `app1/server-voice.spec.ts`만 쉼0이 남아 있어 정상 endMs 한 줄을 `Math.max(0, (frames.get(stream) ?? 0) * 100 - 400)`으로 맞췄다(AC-APP1-01, 실제 VAD의0.4초 쉼 앞이 말끝). 기존 원문·보드 표시·20,000원·등록POST1건·끄기 후 흐름 종료·16번 늦은 결과의 등록0건·손입력17번 및10초 단언 제한을 모두 유지했다. 제품·골든·설정과 나머지 fixture는 변경하지 않았다.
- 전체 실행 종료와 포트 정리가 확인된 뒤 `E2E_ONLY=chromium E2E_PORT_OFFSET=30000`, `--project chromium --workers=1`로 별도 빈 서버에서 검증했다. 첫 시험만 `--grep 'AC-APP1b-04·15·16' --repeat-each=20`으로 **20/20 통과(Playwright 요약1.8분, 재시도0, exit0)**; 같은 파일의 `--grep 'AC-APP1-일꾼없음'`은 별도 실행으로 **1/1 통과(3.5초, exit0)**했다. 로그는 `work/e2e-pcm-vad-repeat.log`·`work/e2e-pcm-vad-no-worker.log`, 결과는 각각 `work/e2e-pcm-vad-repeat-results`·`work/e2e-pcm-vad-no-worker-results`다. 반복20회를 서로 다른20개 기능 시험으로 합산하지 않는다.
- E2E 전체 타입 검사(`tsc --noEmit -p tests/e2e/tsconfig.json`), 변경 시험 파일 ESLint, 변경 파일 diff 공백 검사 통과. 타입·린트 로그는 `work/e2e-pcm-vad-typecheck.log`·`work/e2e-pcm-vad-lint.log`다. 이 독립 재검증은 마지막 fixture 실패의 해결 근거이며 최신 트리 전체7단계 PASS를 대신하지 않는다. 변경을 동결하고 커밋·후속 전체 검증은 오케스트레이터에게 넘긴다.

### 최종 단일 전체 실행 통과

- HEAD `b14815ea783b4616a1c8a4777381757bd516965d`에서 새로 실행한 `work/verify-release.log`와 `work/verify-release-e2e.json`을 직접 확인했다. 전체 E2E **225파일·1,677개 전부 passed**, 실패·skipped·flaky·재시도·runner errors·개별 결과 errors는 모두0이다. E2E 단계 시간은 로그 기준 **7,584.4초**(Playwright JSON duration=7,584,079.854ms)이며, 전체 `pnpm verify`도 **7단계 통과·실패0·건너뜀0**으로 끝났다.
- 같은 단일 실행 안에서 `app1/server-voice.spec.ts:38`의 실제 PCM→등록·끄기 정리는 **4,996ms**, 같은 파일의 일꾼 없음 시험은 **967ms**, `app1/served-voice.spec.ts:16`의 엄격한 CSP·실제 AudioWorklet 시험은 **4,970ms**에 각각 passed, retry=0임을 JSON에서 확인했다. 앞선 실패 기록과 독립 반복 결과는 그대로 보존하며, 이번 PASS는 여러 실행의 성공 사례를 합친 수치가 아니라 최신 HEAD의 새로운 전체 실행 결과다. 추가 시험·제품·시험 코드 수정 없이 최종 기록만 추가하고 동결한다.

### 입금 후보 충돌과 반복 이력의 시험 격리 (2026-10-30)

- 영구 저장 변경 `343d2f17`의 전체 검증에서 `n3/flow.spec.ts:195`가 실패했다. 기존 다른 시험의 구매자 잔액이 우연히 이번 입금액과 같아 후보가 두 개였고 제품은 선택 전 확정 버튼을 정상적으로 비활성화했다. trace의 두 후보와 실패 화면은 `work/verify-persistent-failure/`, 원래 실행은 `work/verify-persistent.log`에 보존했다. 이 실행은 실패가 확인된 뒤 오케스트레이터가 종료했으며 전체 PASS가 아니다.
- 기존 BUNDLE_CHANGED·REVIEW·새 제안 및 단일 새 입금 기록 단언을 유지한다. 두 번째 구매자의 잔액이 이번 부분 입금액과 같도록 충돌을 매번 만들고, 해당 시험 구매자 라디오를 명시 선택한다. 같은 날짜에 다른 반복의 입금 기록이 남아 있어도 이번 조치 직전 이력과 비교해 새 입금이 정확히 하나이며 대상 구매자와 500원임을 함께 검증한다. 제품의 후보 선택·안전 동작은 변경하지 않았다.
- 첫 충돌 반복은 8/10 통과·2/10 실패했다. 둘 다 날짜가 겹쳐 이전 반복의 입금 기록까지 세던 기존 전체 날짜 이력 단언 때문이며 `work/n3-collision-repeat.log`에 보존했다. 기준 이력을 추가한 뒤 같은 충돌 반복은 `work/n3-collision-fixed.log`에서 10/10 통과했다. 선택 반복을 전체 PASS 수에 합산하지 않는다. 전체 게이트는 별도로 다시 실행한다.
- 같은 입금 확인 흐름 파일 전체는 별도 서버에서 7/7 통과(46.9초), 로그 `work/n3-flow-fixed.log`. E2E 타입 검사·린트·diff 검사도 통과했다.

- `7f6ac72b` 전체 재실행: 7/7 통과, E2E 225파일·1,677/1,677 통과(실패·skip·flaky·러너 오류0). 위 충돌 재현 시험도 전체 실행에서 통과했다. 로그 `work/verify-persistent-final.log`, JSON `work/verify-persistent-final-e2e.json`. 별도 성능 단위25·적대48·브라우저2 통과. 아이폰 Safari 실제 마이크 발화·등록과 정상 재시작 후 상품 보존은 사용자가 직접 확인했고 서버 상태도 재시작 전후 비교했다.

### Cohere 합성 음성 지연 탐색 (2026-10-30)

- 별도 메모리 서버·별도 Cohere 일꾼에서 macOS Yuna의 동일한 합성 한국어 한 문장을 실시간 속도로 20회 보냈다. 사용자 방송·DB·마이크는 사용하지 않았다. 기존 사용자용 일꾼이 같은 맥에 상주하고 있었으므로 유휴 단독 기기 기준이 아니다. `work/cohere-latency-benchmark.mjs`, `work/cohere-latency-benchmark.log`, `work/cohere-latency-result.json`에 보존했다.
- 각 회차에서 발화 말끝이 포함된 PCM 100ms 틀의 전송부터 WebSocket 결과 도착까지 측정했다(틀 단위 최대 약100ms 및 전송 스케줄 오차 포함). 20회 모두 결과1개, 중앙값628ms·근접 순위 p95 645ms·최대1,124ms(첫 회). 일꾼의 VAD 분리 후 처리시간 누적 p95는238ms다. 전송 스케줄 누적 오차는37~52ms였다.
- 이는 반복된 한 합성 음성과 같은 맥의 별도 서버 측정이다. 아이폰의 마이크·와이파이·브라우저 표시 시간, 실제 판매자 발화·다중 흐름·장시간 운용을 포함하지 않는다. 실방송 지연1.5초·대표 p95·정확도 통과로 판정하지 않는다. 이전 관측의 느린 처리6,506ms 표본도 그대로 보존하며 원인을 단정하지 않는다.
