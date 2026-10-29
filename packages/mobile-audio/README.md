# @livejjim/mobile-audio — 앱 마이크 모듈 (APP-02)

Expo Modules API로 만든 네이티브 모듈(이름 `LivejjimAudio`)과 그 위의 얇은 TS. 뒤에서도(다른 앱·화면 꺼짐) 마이크 소리를 **16kHz 모노 PCM16 100ms 틀(3,200바이트)**로 JS에 넘긴다. 웹소켓·다시 잇기·결과 처리는 웹과 같은 TS 코드(`packages/voice`의 라이브지니 엔진)가 한다.

근거: SPEC §5.14 APP-02, VOC-06, D-APP-05·06·11·12·19.

## 설계 선택 — (나) 네이티브는 소리만, 웹소켓은 TS 한 벌

| | (가) 네이티브가 웹소켓까지 | (나) 네이티브는 PCM만, 웹소켓은 TS |
|---|---|---|
| 다시 잇기·ready·closing·늦은 글 셈 | Kotlin·Swift·TS 세 벌 | `packages/voice/livegenie.ts` 한 벌 (웹과 같은 코드·같은 시험) |
| 로그인 쿠키 | 네이티브가 세션 쿠키를 알아야 함 | 앱 JS가 머리글로 넘김 |
| 뒤에서 JS가 도나 | 상관없음 | RN은 안드로이드 포그라운드 서비스·아이폰 백그라운드 오디오 모드에서 JS 스레드가 계속 돈다(앱 프로세스가 살아 있는 동안) |

**(나)를 기본으로 한다.** D-APP-19(2026-10-29)가 이 방식을 스펙으로 삼았다 — "웹의 `AudioWorklet` 자리를 네이티브 모듈이 맡을 뿐 그 뒤는 같다". 전송 계층은 `src/transport/`에 따로 두어, 아이폰에서 JS가 멈추는 경우가 실물 확인(HG-APP2)에서 나오면 (가)로 바꿀 자리를 남겼다(엔진이 받는 `RelayConnect`를 네이티브 사건으로 구현하면 된다).

## JS API

```ts
import { createAudioUplink } from '@livejjim/mobile-audio'
import { getAudioCapture, isNativeAudioAvailable } from '@livejjim/mobile-audio/native'
import { createLiveGenieEngine, voiceStreamUrl } from '@livejjim/voice'   // APP1 합류 뒤
import { createRelayConnect } from '@livejjim/mobile-audio'

const capture = getAudioCapture()                 // AudioCapture — 앱 전체가 하나를 나눠 쓴다
const engine = createLiveGenieEngine({
  connect: createRelayConnect({ url: () => voiceStreamUrl(origin, broadcastId, device), headers: () => ({ Cookie: sessionCookie }) }),
  now: () => Date.now(),
  isSupported: () => isNativeAudioAvailable(),
})
const uplink = createAudioUplink({ capture, engine })
engine.start(); await uplink.start()              // 켜기 (권한 확인·요청 → 네이티브 start → 틀을 엔진.sendAudio로)
await uplink.stop(); engine.stop()                // "음성 끄기" — 네이티브 마이크·알림이 바로 멈춘다
```

- `AudioCapture`: `start({ sampleRate: 16000 })` · `stop()` · `getState()` (`OFF | STARTING | LISTENING | INTERRUPTED | HALTED`) · `getHaltReason()` · `getPermission()` · `requestPermission()` · `addFrameListener((pcm: ArrayBuffer, capturedAtMs) => void)` · `addStateListener((state, reason?) => void)`
- 틀의 `capturedAtMs` = 첫 표본을 잡은 기기 벽시계(UTC ms). 엔진의 말 끝 시각 셈(D-APP1-08)과 같은 눈금.
- 끼어들기(전화·시리)·마이크 뺏김: 네이티브가 `INTERRUPTED`를 알리고 1초마다 다시 잡아 `LISTENING`으로 돌아온다. JS는 비추기만 한다.
- 권한 거절: 네이티브를 켜지 않고 `HALTED`(`PERMISSION_DENIED`). 문장은 `AUDIO_HALT_MESSAGES`.
- 소리는 어디에도 저장·기록하지 않는다(D-APP-03). 받아쓰기 서버 주소·토큰이 없다(D-APP-04).

## 네이티브

- 안드로이드 (`android/`): `LivejjimAudioService` — 마이크 종류 포그라운드 서비스, 고정 알림 "라이브지니 · 음성 듣는 중 · 눌러서 돌아가기"(끄기 단추 없음, 누르면 앱으로). `PcmRecorder` — `AudioRecord` 16kHz 모노 PCM16 → 3,200바이트 틀. 권한·서비스 선언은 모듈의 `AndroidManifest.xml`이 앱에 합쳐진다.
- 아이폰 (`ios/`): `PcmCapture` — `AVAudioSession(.playAndRecord, mixWithOthers)` + `AVAudioEngine` 입력 탭 → `AVAudioConverter`로 16kHz Int16 모노 → 3,200바이트 틀. 끼어들기·경로 바뀜·미디어 서비스 재시작을 받아 다시 켠다.

## 앱 설정 (apps/mobile — 설정 플러그인 없음)

저장소 린트가 CommonJS `require`를 막아 `app.plugin.js`를 두지 않는다. 앱이 `app.json`에 아래를 그대로 넣는다(값은 `IOS_INFO_PLIST`·`ANDROID_PERMISSIONS` 상수와 같다 — 구조 시험이 문장을 잠근다).

```json
{
  "ios": { "infoPlist": { "NSMicrophoneUsageDescription": "방송 중 사장님 말(상품 번호·가격)을 듣고 상품을 등록하려고 마이크를 써요.", "UIBackgroundModes": ["audio"] } },
  "android": { "permissions": ["android.permission.RECORD_AUDIO", "android.permission.POST_NOTIFICATIONS", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MICROPHONE"] }
}
```

의존: `expo-modules-core`는 peer — 앱의 `expo`가 가져온다(개발 의존은 타입 검사용 58.0.28 = Expo SDK 55). 앱 `package.json`에 `"@livejjim/mobile-audio": "workspace:*"`를 넣으면 Expo 자동 연결이 `expo-module.config.json`을 보고 네이티브를 붙인다.

## 시험

`vitest` — 가짜 네이티브·가짜 웹소켓(실기기·네이티브 빌드 없음). 네이티브는 파일 구조·권한 선언·문장·비밀 없음·소리 저장 없음을 소스 검사한다. 실제 빌드·30초 뒤 돌아오기·5분 화면 꺼짐(APP-02 AC1·AC4)은 HG-APP2.
