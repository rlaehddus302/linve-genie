# APP2 dev-notes

## dev-web / dev-device — Expo 앱 실제 연결 (2026-10-30)

### 구현 계약

- production 기본 어댑터는 `LiveNativeAudio` → `@livejjim/mobile-audio/native`와 `createNativeB1Adapter` → `createPlxTransport`다. BLE 기기 선택 화면·Android 런타임 권한·iOS background audio/bluetooth 설정을 연결했다. 모듈 없음·권한 거절은 설명을 보이며 Fake 구현으로 바꾸지 않는다. Fake는 명시적인 시험 주입만 허용한다.
- 로그인은 기존 세션 쿠키다. REST는 `credentials: include`와 쓰기 `Origin`을, RN WebSocket은 native `Origin` 헤더를 사용한다. 공개 주소는 `EXPO_PUBLIC_SERVER_URL`, 별도 Origin은 `EXPO_PUBLIC_APP_ORIGIN`이다. 음성은 `/api/voice/stream?broadcastId=&device=`로 연결하며 `ready` 수신 뒤 hello, 최초 캡처 시각, PCM 순서로 보낸다. ticket API·개발 토큰·끊긴 PCM 재전송은 없다.
- 전체 읽기 상태·효과는 `@livejjim/voice-session/wire`의 Map/Set DTO를 이용한다. 기기에 추출·사전·판정 엔진을 넣지 않는다. 카드/후보/폼, 정정/번호 이동/되돌리기 제안, 문자찜 후보/시간 확인/결과, 설정·기록을 서버 상태로 표시한다. 실제 등록·고침·문자찜은 기존 HTTP 입구로 실행하고 결과를 회신한다. B가 포함된 이벤트에는 date/rehearsal 쿼리를 덧붙이지 않는다.
- 효과 작업마다 고정 requestId로 재시도한다. sessionId와 연결 세대별로 중복·늦은 효과를 막고, 자동 LiveGenie 쓰기는 말 끝 10초·유효 시각 조건을 확인한다. 이미 있던 번호(`changed: false`)를 새 등록으로 표시하거나 되돌리지 않는다.
- 서버가 서명한 확인 DTO를 카드 버전별 1회 소비하여 OFF/일시 연결 끊김에서도 수동 등록할 수 있다. 실패 재시도는 같은 requestId를 쓴다. 폼·후보 수정 시 이전 확인 DTO는 즉시 무효화한다. 서버가 서명한 resumeToken은 메모리에서만 유지한다. OFF 후 수동 폼/문자찜/고침은 capture 없이 제어 연결을 열어 처리하고 idle이면 닫는다. 다시 켜면 같은 방송의 카드·폼·제안·문자찜을 복원한다. 로그아웃은 상태와 token을 지운다.
- 동의·음성 설정만 기기 저장소에 둔다. 사용자가 켠 음성 글 기록은 판매자별 30일 보존하며 로그아웃 시 삭제한다. PCM·세션 쿠키·resumeToken은 AsyncStorage에 저장하지 않는다.
- 상품 라벨은 `/api/print/jobs/:id/bitmap?attempt=&device=`, 테스트 라벨은 `/api/print/test-bitmap`에서 받은 실제 1비트 점을 BLE 어댑터로 보낸다. 404 빈 그림 대체는 없다. base64/크기/행 바이트를 확인하며 실패 시 프린터에 보내지 않는다. 서버 렌더 오류 코드는 그대로, 전송 오류는 `DISCONNECTED`, 잘못된 그림은 `INVALID_IMAGE`로 `/api/print/result`에 보고한다.
- 네이티브 오디오 relay 오류에서 기존 소켓도 닫도록 고쳤다. 출력 대기열은 로그아웃 뒤 로그인해도 재시작한다. 음성 끄기·방송 종료·로그아웃은 마이크·소켓·알림을 정리한다.

### 공유 코드 / 변경 범위

- `apps/mobile/**`: production 연결·API·상태·효과·UI·시험·README·Expo 설정.
- `packages/mobile-audio/src/transport/relay.ts`, `test/relay.test.ts`: 오류 시 소켓 정리와 회귀 검사. 오디오 native Swift/Kotlin 소스와 BLE protocol 구현은 기존 모듈을 사용한다.
- 부모가 설치한 mobile-audio/mobile-ble/voice-session workspace 의존성과 react-native-ble-plx 3.5.1을 사용한다. 루트 lockfile·서버/웹·wire/server 구현은 각 담당 영역이다.
- 기존 core quick-input/format export, workspace Expo 설치 정책, 생성 native 디렉터리 ignore 변경은 앞선 APP2 구현을 유지한다. 앱에서 사용하는 core 실행 코드는 빠른 입력 읽기와 금액 표시뿐이다. `thin-client.node.test.ts`가 runtime import와 Hermes 산출물을 검사한다.
- 기기 ID는 프로세스 수명 동안 유지하는 `app` 접두사 영숫자 값이다. 출력 기기 역할은 앱을 다시 열면 다시 지정한다.

### 검증 근거

- `apps/mobile/test`: 17 파일, 70 tests 통과. 기존 화면·대기열 검사의 성공 의미는 유지하고 bitmap fixture는 실제 계약으로 교체했다. fake 서버도 B 이벤트의 scope 쿼리를 거부해 실제 계약 차이를 잡는다.
- `server-integration.node.test.ts`: 실제 Node HTTP/WebSocket 서버 + PGlite를 열고 앱 로그인 → 쿠키/Origin → PCM 전송 → 서버 전체 읽기 → 앱 효과 HTTP → 실제 상품 DB를 확인한다. OFF 중 카드 보존·수동 폼 수정·마이크 미시작·제어 연결 idle 종료·다시 켜기·중복 없음도 검사한다. 실제 서버 테스트/상품 bitmap을 받고 잘못된 bitmap은 `INVALID_IMAGE` 결과가 서버에 기록되는지 확인한다. 쿠키 저장소와 캡처 native 경계만 시험 대역이다.
- `native-live-audio.node.test.ts`, `remote-voice.node.test.ts`, `remote-voice-panel.test.tsx`: ready 이전 hello/PCM 차단, 서버 거절·권한/모듈 실패에 가짜 성공 없음, reconnect/no-replay, 전체 DTO, 늦은/중복/지난 연결 효과, 수동 DTO 1회 소비/재시도, 폼/후보/SMS 화면 명령을 검증한다.
- `@livejjim/mobile-audio`: 5 파일, 47 tests 통과. PCM 범위/relay/native 계약을 포함한다.
- 모바일 TypeScript·변경 파일 ESLint 통과. Expo iOS/Android Hermes export 통과. Expo config introspect와 Apple/Android autolinking에서 LivejjimAudio module을 확인했다. 최종 전체 verify와 독립 감사는 orchestrator가 별도 기록한다.

### HG-APP2 미확인

- 실제 iPhone/Android custom dev build 설치, native fetch/WebSocket 쿠키 저장소 공유, 외부 브라우저 로그인 연속성.
- 실제 권한 화면·Android foreground 알림과 종료 1초, 다른 앱 30초, 화면 꺼짐 5분, Hermes Intl/SSE·복귀 1초/3초 목표.
- 실물 B1 선택·재연결·네 변/한글 검사, 30장 연속 인쇄·마지막 줄·중복/누락. 부모의 서버 bitmap → B1 모의 transport 교차 검사와 구분한다.
- EAS/스토어 계정·서명·기기 SDK/장비가 필요한 설치/게시와 위 측정은 아직 하지 않았다. Expo 번들/모의 native 통과를 실기기 통과로 표시하지 않는다.

### 최종 회귀 수정 (2026-10-30)

- 복원표 거절 시 마이크·주기 전송을 종료하고 남은 카드와 재시작 동작을 보존한다. 독립 적대 시험으로 확인했다.
- 마이크를 켜기 전 설정 화면에서 바꾼 바로 등록 값을 기기에 저장하고 첫 연결과 앱 재시작에 적용한다. 저장 읽기/쓰기를 직렬화해 동의·다른 설정을 보존하며 늦은 서버 응답이 최신 선택을 덮지 않는다. 저장 실패도 설정 화면에서 알린다.
- 음성 끄기·다시 잇기 중에는 이전 카드/문자찜의 자동 처리 남은 초를 표시하지 않는다. 남은 폼·수동 조작은 보존한다.
- 독립 375px UX 검토의 긴 상품 요약 잘림과 농도 버튼 폭 미달을 공통 버튼의 최대폭·줄바꿈·최소폭으로 고쳤다. 검토자가 새 export/실제 서버에서 재확인해 두 지적을 닫았다.
- 최종 모바일 단위 17 파일 74개 통과. 실제 휴대폰·B1 검증 범위는 위 HG 목록 그대로다.
