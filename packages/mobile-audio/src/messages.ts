// 앱 권한·알림 문장 (SPEC APP-01 권한 설명, APP-02 고정 알림, D-APP-11) — 글자 그대로. 쉬운 한국어, 개발 용어 없음.

/** 마이크 권한 설명 (iOS NSMicrophoneUsageDescription, 안드로이드 권한 창 앞 안내) */
export const MIC_PERMISSION_MESSAGE = '라이브 중 사장님 말(상품 번호·가격)을 음성 인식해 상품을 등록하려고 마이크를 써요.'
/** 알림 권한 설명 (안드로이드 13+ POST_NOTIFICATIONS) */
export const NOTIFICATION_PERMISSION_MESSAGE = '음성 인식 중이라는 알림을 보여 드리려고 해요.'
/** 안드로이드 포그라운드 서비스 고정 알림 — 제목·본문. 눌러서 앱으로 돌아가고, 알림에서 끌 수는 없다(APP-02) */
export const LISTENING_NOTIFICATION_TITLE = '라이브지니'
export const LISTENING_NOTIFICATION_TEXT = '음성 인식 중 · 눌러서 돌아가기'
/** 한 줄로 적을 때 (SPEC 문장 그대로) */
export const LISTENING_NOTIFICATION_LINE = `${LISTENING_NOTIFICATION_TITLE} · ${LISTENING_NOTIFICATION_TEXT}`
/** 안드로이드 알림 채널 이름 (설정 화면에 보임) */
export const LISTENING_CHANNEL_NAME = '음성 인식 중'

/**
 * 앱 설정(app.json/app.config)에 넣을 값 — 이 모듈은 설정 플러그인 없이 쓴다(저장소 린트가 CommonJS require를 막아 플러그인 파일을 두지 않는다).
 * 안드로이드 권한·서비스는 모듈의 AndroidManifest가 합쳐져 들어가고, 아이폰 Info.plist 키는 앱이 아래 값을 그대로 넣는다.
 */
export const IOS_INFO_PLIST = Object.freeze({
  NSMicrophoneUsageDescription: MIC_PERMISSION_MESSAGE,
  UIBackgroundModes: Object.freeze(['audio'] as const),
})
/** 안드로이드에서 앱이 실행 중에 물어야 하는 권한 (모듈이 requestPermission()에서 묻는다 — 앱 설정에도 적어 둔다) */
export const ANDROID_PERMISSIONS = Object.freeze(['android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MICROPHONE'] as const)
