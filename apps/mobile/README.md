# 라이브지니 휴대폰 앱 (apps/mobile)

안드로이드·아이폰에서 쓰는 라이브지니 앱이에요. React Native(Expo SDK 58, 새 아키텍처)로 만든 네이티브 화면 앱이고, 웹 화면을 감싼 껍데기가 아니에요(SPEC §5.14 APP-01, D-APP-19).

앱은 **얇은 클라이언트**예요(D-APP-20). 판정·받아쓰기·음성 추출·라벨 그림·문서는 모두 서버가 만들고, 앱은 화면·마이크 소리 보내기·블루투스 전송·실시간 구독·라벨 대기열만 해요.

## 화면

| 화면 | 하는 일 |
|---|---|
| 로그인 | 아이디·비밀번호 (간편 로그인은 "웹으로 열기") |
| 방송 목록 | 진행 중·끝난 방송, 새 방송 시작, 리허설 |
| 라이브 콘솔 | 알림 띠 · 음성(켜기/끄기, 듣기 멈춤 큰 글) · 빠른 입력 한 줄 + 보내기 · 현재 상품 · 상품 보드(1등·대기·보류·충돌·라벨 상태) · 문자찜 · 방송 끝내기 · 자리를 비운 동안 한 줄 |
| 포장 | 날짜 → 구매자 → 체크리스트 → 포장 완료·배송 완료 |
| 라벨·프린터 | 블루투스 연결, 이 기기에서 출력, 대기열, 출력 멈추기/다시 시작, 테스트 인쇄, 인쇄 농도 |
| 설정 | 음성(바로 등록)·라벨(기능 켬/끔·자동 출력), 로그아웃 |

정산·구매자·택배·판매대장·가게 설정은 앱 안 "웹으로 열기"로 기기 브라우저에서 열려요.

## 개발 서버 띄우기

1. 저장소 루트에서 `pnpm install` (Node 24 이상).
2. 라이브지니 서버를 먼저 켜요 (`apps/server` — 기본 `http://localhost:3000`).
3. 앱 폴더에서:

```sh
cd apps/mobile
EXPO_PUBLIC_SERVER_URL=http://<내 PC의 IP>:3000 \
EXPO_PUBLIC_APP_ORIGIN=https://<서버의 공개 앱 origin> npx expo start --dev-client
```

- 마이크·BLE는 **커스텀 개발 빌드**에 들어 있는 실제 모듈을 써요. Expo Go에서는 모듈이 없다는 안내를 보이고 가짜 성공으로 바꾸지 않아요.
- `EXPO_PUBLIC_SERVER_URL`을 안 적으면 `http://localhost:3000`이에요. 휴대폰에서는 localhost가 안 되니 PC의 IP를 적어 주세요.
- `EXPO_PUBLIC_APP_ORIGIN`은 서버의 `LIVEJJIM_APP_ORIGIN`과 같아야 해요. REST 쓰기와 네이티브 WebSocket이 이 값을 Origin 헤더로 보내요. 생략하면 서버 주소의 origin을 써요.
- 로그인은 기기 쿠키 저장소를 써요. 세션 값을 JS 설정이나 AsyncStorage로 옮기지 않아요.
- **서버 주소는 https여야 로그인이 유지돼요.** 서버의 로그인 쿠키는 언제나 `Secure`라서, 안드로이드 기기 쿠키 저장소는 `http://` 주소(`http://10.0.2.2:…`·`http://localhost:…`·`http://<PC IP>:…` 모두)에서 받은 쿠키를 버려요. 그러면 로그인 직후 "로그인이 풀렸어요"가 떠요. 개발 때는 아래 "에뮬레이터"처럼 https 중계를 앞에 두세요.
- 비밀값은 앱에 넣지 않아요. 받아쓰기 서버 주소·토큰은 라이브지니 서버만 알아요.

## 에뮬레이터·시뮬레이터

- 안드로이드: 안드로이드 스튜디오(SDK·에뮬레이터)를 깔고 `npx expo run:android` 또는 `expo start` 뒤 `a`.
- 아이폰: 맥에 Xcode를 깔고 `npx expo run:ios` 또는 `expo start` 뒤 `i`.
- SDK가 없으면 아래 EAS 개발 빌드를 실제 기기에 설치해요. 번들 생성만으로 기기 설치나 백그라운드 동작을 확인할 수는 없어요.

### 안드로이드 에뮬레이터를 연습 서버(`pnpm try`)에 붙이기 (APP2에서 확인한 방법)

1. 연습 서버를 켜요: `pnpm try --port 7760` (화면 주소 `http://localhost:7760`).
2. 이 컴퓨터에 자체 서명 인증서(SAN `localhost`, `CA:TRUE`)를 만들고, `https://127.0.0.1:7443` → `127.0.0.1:7760`으로 TCP를 그대로 넘기는 작은 TLS 중계를 켜요(머리글을 바꾸지 않아야 음성 WebSocket도 지나가요). `pnpm try`의 휴대폰 https 주소(포트+1)는 WebSocket을 넘기지 않아 음성이 안 돼요.
3. `npx expo prebuild --platform android` 뒤, 생성된 `android/app/src/debug/`에만 그 인증서를 `res/raw/devca.pem`으로 넣고 `res/xml/network_security_config.xml`(`debug-overrides`에 `@raw/devca`, `base-config`는 Metro 때문에 `cleartextTrafficPermitted="true"`)을 만들어 debug `AndroidManifest.xml`의 `<application>`에 `android:networkSecurityConfig`를 달아요. 생성 폴더라 커밋되지 않고, 출시 빌드에는 들어가지 않아요.
4. `adb reverse tcp:7443 tcp:7443` · `adb reverse tcp:8081 tcp:8081` (`expo start`를 다시 켜면 reverse가 지워질 수 있어 다시 걸어요).
5. `EXPO_PUBLIC_SERVER_URL=https://localhost:7443 EXPO_PUBLIC_APP_ORIGIN=http://localhost:7760 npx expo start --dev-client --clear`
   - `APP_ORIGIN`은 연습 서버 화면 주소와 같아야 쓰기가 403이 아니에요.
   - `.claude/worktrees/…` 같은 작업 폴더에서는 Metro가 바뀐 파일을 못 잡을 때가 있어요. 고친 뒤에는 `--clear`로 다시 켜요.
6. 에뮬레이터 마이크: `emulator -avd <이름> -allow-host-audio`로 켜고 `adb emu avd hostmicon`. 이 옵션이 없으면 마이크 소리가 모두 0이에요. 맥 마이크 권한이 없는 셸에서 켠 에뮬레이터도 0일 수 있어요.

### 아이폰 시뮬레이터를 연습 서버에 붙이기 (APP2에서 확인한 방법, Xcode 27)

1. CocoaPods가 없으면 `brew install cocoapods`. 셸은 `LANG=en_US.UTF-8`.
2. `npx expo prebuild --platform ios` → `cd ios && pod install` → `xcodebuild -workspace app.xcworkspace -scheme app -configuration Debug -sdk iphonesimulator -destination 'id=<기기 UDID>' -derivedDataPath build/dd build` → `xcrun simctl install <UDID> build/dd/Build/Products/Debug-iphonesimulator/app.app`. (첫 빌드 약 10분)
   - `@capacitor-community/bluetooth-le`(niimbluelib이 딸려 옴)는 `package.json`의 `expo.autolinking.exclude`로 뺐어요. 빼지 않으면 `pod install`이 Capacitor 모듈 오류로 멈춰요.
3. 연습 서버(`pnpm try --port <포트>`)와 안드로이드와 같은 https TCP 중계를 켜요. 인증서(SAN `localhost`, `CA:TRUE`, 짧은 유효기간)를 `xcrun simctl keychain <UDID> add-root-cert cert.pem`으로 시뮬레이터에 믿게 해요. 시뮬레이터의 `localhost`는 맥이라 `adb reverse`가 필요 없어요.
4. `EXPO_PUBLIC_SERVER_URL=https://localhost:<중계 포트> EXPO_PUBLIC_APP_ORIGIN=http://localhost:<포트> npx expo start --dev-client --clear` 뒤 `xcrun simctl launch <UDID> app.livejjim.mobile`.
5. 마이크 권한 창은 `xcrun simctl privacy <UDID> grant microphone app.livejjim.mobile`로 대신할 수 있어요(앱이 다시 켜져요). 다른 앱을 띄우면(`xcrun simctl launch <UDID> com.apple.Preferences`) 뒤에서 듣기를 확인할 수 있어요.
   - 시뮬레이터 마이크는 맥 소리 장치를 써요. 맥 쪽이 답하지 않으면 `AVAudioEngine`이 앱째로 멈출 수 있어요(AURemoteIO RPC timeout). 이때 앱은 다음에 방송 화면을 열 때 음성을 저절로 다시 켜지 않아요.
   - 시뮬레이터에는 블루투스가 없어 프린터 연결은 "이 휴대폰에서는 블루투스를 쓸 수 없어…"로 끝나요. 실제 B1은 실제 아이폰에서 확인해요.

## EAS 빌드 (클라우드 — 아이폰도 Xcode 없이)

```sh
npm install -g eas-cli
eas login
eas build:configure          # app.json extra.eas.projectId를 채워 줘요
eas build --profile development --platform android   # 개발용 APK
eas build --profile preview --platform all           # 내부 시험용
eas build --profile production --platform all        # 스토어용
eas update --channel production                      # JS만 고쳤을 때 (심사 없이)
```

프로필별 서버 주소는 `eas.json`의 `env.EXPO_PUBLIC_SERVER_URL`에 있어요. `.example` 주소는 예시이므로 실제 서버 주소와 공개 Origin으로 바꾼 뒤 빌드해요.

## 출시 빌드 (안드로이드, 맥에서 직접)

EAS 없이 Play 업로드용 AAB와 직접 설치용 APK를 만들어요. 필요한 것: `ANDROID_HOME`(안드로이드 SDK), Java 21.

1. **업로드 열쇠**는 저장소 밖 `~/.livejjim-release/`에 있어요(`upload.jks`, `upload.properties`, 둘 다 권한 600). 다른 곳에 두면 `LIVEJJIM_UPLOAD_PROPERTIES=<속성 파일 경로>`로 알려 줘요. 속성 파일에는 `storeFile`·`storePassword`·`keyAlias`·`keyPassword`가 있어요. 이 파일이 없으면 release 빌드가 멈춰요(개발 열쇠로 서명되지 않게). **잃으면 Play 업로드 열쇠를 재설정해야 하니 백업해요.**
2. 네이티브 폴더 만들기: `npx expo prebuild -p android --clean` (`android/`는 커밋하지 않아요). 권한 정리와 업로드 서명은 `plugins/with-android-release.js`가 넣어요 — `android/`를 손으로 고치지 말고 이 플러그인을 고쳐요. prebuild가 `package.json`의 `android`·`ios` 스크립트를 바꾸면 되돌려요.
3. 서버 주소를 넣고 빌드 (주소는 JS 번들에 들어가요):

```sh
cd android
EXPO_PUBLIC_SERVER_URL=https://<운영 서버> NODE_ENV=production ./gradlew bundleRelease     # Play용 → app/build/outputs/bundle/release/app-release.aab
EXPO_PUBLIC_SERVER_URL=https://<연습 서버> NODE_ENV=production ./gradlew assembleRelease   # 폰 설치용 → app/build/outputs/apk/release/app-release.apk
```

- **알림 받기 스위치** `LIVEGENIE_NOTICE`: `on`일 때만 휴대폰 알림 받기(문자찜·입금 알림 읽기)가 들어가요. 비우면 `off` — 1차 Play 출시 기본(SMS 정책 거절 위험). off면 알림 읽기 서비스·재부팅 수신기·`RECEIVE_BOOT_COMPLETED`가 빠지고 설정 화면의 알림 받기 칸이 숨어요. **prebuild와 gradle 둘 다 같은 값**으로 돌려요(개발 때 쓰려면 `LIVEGENIE_NOTICE=on npx expo start`).
- 아이콘·스플래시는 임시 그림이에요: `node apps/mobile/scripts/make-icons.mjs [Play 그림 폴더]`로 다시 만들어요(Play 512 아이콘·1024×500 그래픽은 폴더를 줄 때만).
- 서버의 `LIVEJJIM_APP_ORIGIN`이 서버 주소의 origin과 다르면 `EXPO_PUBLIC_APP_ORIGIN`도 같이 넣어요.
- 버전은 `app.json`의 `version`(versionName)·`android.versionCode`. Play에 새로 올릴 때마다 versionCode를 1씩 올려요.
- 확인: `apksigner verify --print-certs <apk>`, `aapt2 dump badging <apk>`(targetSdk·권한).

## 검사

```sh
cd apps/mobile
npx tsc --noEmit -p tsconfig.json   # 타입
npx vitest run                      # 단위·화면 시험 (react-native-web + jsdom)
npx expo export --platform ios --platform android   # Metro 번들이 되는지 (dist/)
```

저장소 루트의 `pnpm typecheck`·`pnpm lint`·`pnpm test`에도 이 폴더가 들어가요.

## 실제 연결

- `src/native/production.tsx`가 `@livejjim/mobile-audio/native` 캡처와 BLE PLX/B1 어댑터를 앱 시작 때 연결해요. 프린터는 판매자가 검색 목록에서 직접 골라요.
- `src/native/live-audio.ts`는 서버의 `ready` 뒤 동의/설정과 첫 캡처 시각을 보내고 PCM을 전송해요. 끊긴 동안 PCM·쓰기를 쌓지 않아요. 세션 URL은 `/api/voice/stream?broadcastId=…&device=…`이고 별도 표나 토큰은 없어요.
- 음성 화면은 `@livejjim/voice-session/wire`의 전체 상태·카드·정정·문자찜을 보여요. 추출과 사전은 서버에만 있어요. 자동 쓰기에는 기기 시각의 10초 제한을 적용하고, 수동 확인은 서버가 검증한 현재 카드 DTO를 한 번 소비해 같은 요청 번호로 재전송해요. 껐다 켤 때 남은 카드·문자찜은 메모리의 서명된 복원값으로 되살리고, 꺼진 상태의 조작은 마이크 없이 세션만 열어요. 복원값은 설정·로그에 저장하지 않아요.
- 상품/테스트 라벨은 서버의 bitmap API에서 받아요. 404·오류·잘못된 그림에는 출력하지 않고 실패 결과를 서버에 알려요.
- 명시적인 시험에서만 `FakeNativeAudio`와 `FakeBlePrinter`를 주입해요. 실제 HTTP/WS 서버와 PGlite를 사용하는 `test/server-integration.node.test.ts`는 로그인→PCM→서버 읽기→앱 등록→DB와 라벨 오류 기록까지 확인해요.

## 실제 기기 확인 (HG-APP2)

EAS 프로젝트/개발자 계정 설정과 Android/iPhone/B1이 필요해요. 기기에서 REST·WebSocket 쿠키 공유, 외부 브라우저 로그인 연속성, 화면 꺼짐 5분의 음성·알림, 앱 복귀, B1 30장 연속 출력을 확인해야 해요. Metro 내보내기·모의 네이티브 시험은 이 확인을 대신하지 않아요.
