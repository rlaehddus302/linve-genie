// 그 기기(브라우저 저장소)에 남기는 음성 값 (D-I4-04·05): 처음 켤 때의 안내 확인, 자동 확정 설정.
// 인식 문장·카드는 남기지 않는다(D-I4-09). 저장소를 쓸 수 없으면(읽기·쓰기 예외) 확인은 "안 함"(다음에도 창), 설정은 기본값이다.

/** 안내 창 확인 기록 */
export const VOICE_CONSENT_KEY = 'livejjim.voiceConsent'
/** 자동 확정 설정 ({"voice.autoConfirm": boolean, "voice.autoConfirmSec": number}) */
export const VOICE_SETTINGS_KEY = 'livejjim.voiceSettings'

const CONSENT_VALUE = 'yes'

export function readConsent(): boolean {
  try {
    return window.localStorage.getItem(VOICE_CONSENT_KEY) === CONSENT_VALUE
  } catch {
    return false
  }
}

export function writeConsent(): void {
  try {
    window.localStorage.setItem(VOICE_CONSENT_KEY, CONSENT_VALUE)
  } catch {
    // 남기지 못하면 다음에도 창을 보인다
  }
}

/** 저장한 설정 (JSON으로 읽은 값 그대로 — 검사는 resolveVoiceSettings가 한다). 없거나 읽지 못하면 null */
export function readSettings(): unknown {
  try {
    const raw = window.localStorage.getItem(VOICE_SETTINGS_KEY)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeSettings(settings: object): void {
  try {
    window.localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 남기지 못하면 이번 콘솔에서만 쓴다
  }
}
