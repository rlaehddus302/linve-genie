// 음성 설정 (VOC-04·VOC-05, D-204·D-205). 판매 규칙 설정표(엔진 스냅샷) 밖의 판매자·기기 설정이다 — 저장은 I4.
// 키는 점 표기. 기본: 자동 확정 꺼짐, 기다림 5초(정수 3~30).

export interface VoiceSettings {
  /** 신뢰도 HIGH 카드를 기다림 뒤 자동으로 확정한다 (기본 꺼짐 — 방송자가 보지 않은 등록이 생기지 않게) */
  readonly 'voice.autoConfirm': boolean
  /** 자동 확정까지 기다리는 초 (정수 3~30, 기본 5 — 되돌리기 5초와 같은 박자) */
  readonly 'voice.autoConfirmSec': number
}

export type VoiceSettingKey = keyof VoiceSettings
export type VoiceSettingsOverride = Partial<VoiceSettings>

export const DEFAULT_VOICE_SETTINGS: Readonly<VoiceSettings> = Object.freeze({
  'voice.autoConfirm': false,
  'voice.autoConfirmSec': 5,
})

export const AUTO_CONFIRM_SEC_MIN = 3
export const AUTO_CONFIRM_SEC_MAX = 30

const VOICE_KEYS = Object.freeze(Object.keys(DEFAULT_VOICE_SETTINGS) as VoiceSettingKey[])

export interface VoiceSettingsProblem {
  /** 문제가 있는 키 (설정 객체 전체의 문제면 null) */
  readonly key: string | null
  /** 판매자에게 보여 줄 수 있는 쉬운 이유 */
  readonly message: string
}

/**
 * 음성 설정 덮어쓰기 객체를 검사한다. 문제가 없으면 빈 목록.
 * 문제: 객체가 아님, 모르는 키, 예/아니오가 아닌 자동 확정 값, 정수가 아니거나 3~30 밖인 기다림.
 */
export function checkVoiceSettings(value: unknown): VoiceSettingsProblem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [{ key: null, message: '음성 설정은 키와 값을 짝지은 객체여야 해요' }]
  const problems: VoiceSettingsProblem[] = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !(VOICE_KEYS as readonly string[]).includes(key)) {
      problems.push({ key: String(key), message: '모르는 음성 설정이에요' })
      continue
    }
    const setting: unknown = (value as Record<string, unknown>)[key]
    if (key === 'voice.autoConfirm' && typeof setting !== 'boolean') problems.push({ key, message: '자동 확정은 켬이나 끔으로만 정할 수 있어요' })
    if (key === 'voice.autoConfirmSec' && !(typeof setting === 'number' && Number.isSafeInteger(setting) && setting >= AUTO_CONFIRM_SEC_MIN && setting <= AUTO_CONFIRM_SEC_MAX)) {
      problems.push({ key, message: `자동 확정 기다림은 ${AUTO_CONFIRM_SEC_MIN}초부터 ${AUTO_CONFIRM_SEC_MAX}초까지의 정수로 적어 주세요` })
    }
  }
  return problems
}

/**
 * 기본값 위에 덮어쓴 새 설정. 넘긴 객체는 바꾸지 않는다.
 * 검사를 통과하지 못한 값은 쓰지 않고 기본값을 쓴다 — 잘못된 설정으로 자동 확정이 켜지거나 기다림이 0이 되지 않게.
 */
export function resolveVoiceSettings(override?: unknown): VoiceSettings {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) return { ...DEFAULT_VOICE_SETTINGS }
  const record = override as Record<string, unknown>
  const auto = Object.hasOwn(record, 'voice.autoConfirm') ? record['voice.autoConfirm'] : undefined
  const sec = Object.hasOwn(record, 'voice.autoConfirmSec') ? record['voice.autoConfirmSec'] : undefined
  return {
    'voice.autoConfirm': typeof auto === 'boolean' ? auto : DEFAULT_VOICE_SETTINGS['voice.autoConfirm'],
    'voice.autoConfirmSec':
      typeof sec === 'number' && Number.isSafeInteger(sec) && sec >= AUTO_CONFIRM_SEC_MIN && sec <= AUTO_CONFIRM_SEC_MAX ? sec : DEFAULT_VOICE_SETTINGS['voice.autoConfirmSec'],
  }
}
