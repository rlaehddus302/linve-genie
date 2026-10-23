// 그 기기(브라우저 저장소)에 남기는 음성 값 (D-I4-04·05): 처음 켤 때의 안내 확인, 자동 확정 설정(V2: 같은 값에 조용한 시간 `voice.quietMs`), 문자찜 설정(V1), 배운 품종 이름(V2).
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

/** 문자찜 설정 ({"voice.smsListen": boolean, "voice.smsAutoSec": number}, V1 D-V1-05·09) — 상품 등록 설정과 따로 둔다(서로 모르는 키로 보지 않게) */
export const VOICE_SMS_SETTINGS_KEY = 'livejjim.voiceSmsSettings'

/** 저장한 문자찜 설정 (JSON으로 읽은 값 그대로 — 검사는 resolveSmsSettings가 한다). 없거나 읽지 못하면 null */
export function readSmsSettings(): unknown {
  try {
    const raw = window.localStorage.getItem(VOICE_SMS_SETTINGS_KEY)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeSmsSettings(settings: object): void {
  try {
    window.localStorage.setItem(VOICE_SMS_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 남기지 못하면 이번 콘솔에서만 쓴다
  }
}

/**
 * 배운 품종 이름 (`voice.learnedAliases`, D-V2-10): [{ heard, name, usedAt }] 200개까지 — 품종 낱말뿐이라 저장한다(받아쓴 문장·기록은 남기지 않는다, D-V2-08).
 * 검사는 readLearnedAliases가 한다
 */
export const VOICE_LEARNED_KEY = 'livejjim.voiceLearnedAliases'

export function readLearned(): unknown {
  try {
    const raw = window.localStorage.getItem(VOICE_LEARNED_KEY)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeLearned(list: readonly object[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(VOICE_LEARNED_KEY)
    else window.localStorage.setItem(VOICE_LEARNED_KEY, JSON.stringify(list))
  } catch {
    // 남기지 못하면 이번 콘솔에서만 쓴다
  }
}
