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
EXPO_PUBLIC_SERVER_URL=http://<내 PC의 IP>:3000 npx expo start
```

- 휴대폰에 **Expo Go**를 깔고 QR을 찍으면 바로 열려요(마이크·블루투스 네이티브 모듈은 Expo Go에서는 가짜로 돌아요).
- `EXPO_PUBLIC_SERVER_URL`을 안 적으면 `http://localhost:3000`이에요. 휴대폰에서는 localhost가 안 되니 PC의 IP를 적어 주세요.
- 비밀값은 앱에 넣지 않아요. 받아쓰기 서버 주소·토큰은 라이브지니 서버만 알아요.

## 에뮬레이터·시뮬레이터

- 안드로이드: 안드로이드 스튜디오(SDK·에뮬레이터)를 깔고 `npx expo run:android` 또는 `expo start` 뒤 `a`.
- 아이폰: 맥에 Xcode를 깔고 `npx expo run:ios` 또는 `expo start` 뒤 `i`.
- 이 둘이 없으면 Expo Go + 실제 휴대폰, 또는 아래 EAS 개발 빌드로 해요.

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

프로필별 서버 주소는 `eas.json`의 `env.EXPO_PUBLIC_SERVER_URL`에 있어요. 운영 주소로 바꿔 주세요.

## 검사

```sh
cd apps/mobile
npx tsc --noEmit -p tsconfig.json   # 타입
npx vitest run                      # 단위·화면 시험 (react-native-web + jsdom)
npx expo export --platform ios --platform android   # Metro 번들이 되는지 (dist/)
```

저장소 루트의 `pnpm typecheck`·`pnpm lint`·`pnpm test`에도 이 폴더가 들어가요.

## 네이티브 모듈 (다른 담당이 만드는 것)

- `src/native/audio.ts` — 마이크 모듈 약속. `startListening({ wsUrl, token })` / `stopListening()` / `onResult(cb)` / `onState(cb)`. 실제 구현은 `packages/mobile-audio`.
- `src/native/ble.ts` — BLE 프린터 모듈 약속(packages/printer의 `RememberingPrinterAdapter`와 같은 모양). 실제 구현은 `packages/mobile-ble`.
- `src/native/index.ts`에서 실제 모듈로 바꿔 끼워요. 지금은 가짜 구현이라 콘솔 음성 칸에 "시험: '15번 2만 원' 들림" 단추가 보여요.

## 사용자가 할 일

- Expo 계정(EAS Build·Update) 만들기 — 무료 한도가 있어요.
- 애플 개발자 계정(연 $99), 구글 플레이 개발자 계정($25 한 번) — 다른 사장님에게 앱을 주려면 필요해요.
- 시뮬레이터 시험을 원하면 맥에 Xcode, 에뮬레이터는 안드로이드 스튜디오.
- 실제 B1 프린터·실제 방송으로 확인(HG-APP2).
