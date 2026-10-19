/**
 * 판매 규칙 설정 (DOMAIN_RULES "판매 규칙 설정표"). 키는 점 표기 그대로 쓴다.
 * 기본값은 이 파일의 `DEFAULT_SETTINGS` 한 곳에서만 정의한다. 파서·엔진·서버는 `resolveSettings`로 채워 쓴다.
 */
export interface SaleSettings {
  'claim.parseMode': 'STRICT' | 'LOOSE'
  'claim.multiNumber': 'ALL' | 'FIRST' | 'IGNORE'
  'claim.maxNumber': number
  'claim.ignoreOwner': boolean
  'claim.preOpenWindowSec': number
  'waitlist.max': number
  'cancel.buyerChat': 'OFF' | 'REQUEST' | 'AUTO'
  'cancel.succession': 'AUTO' | 'ASK' | 'REOPEN'
  'contention.policy': 'ARRIVAL' | 'RECEIVED_TIME'
  'contention.sameMinuteTieBreaker': 'YOUTUBE' | 'SMS' | 'HOST'
  'price.unit': 'WON' | 'THOUSAND'
  'shipping.baseFee': number
  'shipping.freeThreshold': number | null
  'settlement.groupBy': 'DATE' | 'MANUAL'
  'print.autoOnConfirm': boolean
  'thanks.liveChat': boolean
  'thanks.videoComment': 'OFF' | 'PER_SALE' | 'SUMMARY'
  'thanks.batchWindowSec': number
}

export type SettingKey = keyof SaleSettings

/** 덮어쓸 설정만 담는다. 빠진 키는 DOMAIN_RULES 기본값. */
export type SettingsOverride = Partial<SaleSettings>

/** DOMAIN_RULES 설정표의 기본값. 코어 전체에서 이 객체 하나만 기본값을 정한다(AC-S01-01). */
export const DEFAULT_SETTINGS: Readonly<SaleSettings> = Object.freeze({
  'claim.parseMode': 'STRICT',
  'claim.multiNumber': 'ALL',
  'claim.maxNumber': 999,
  'claim.ignoreOwner': true,
  'claim.preOpenWindowSec': 30,
  'waitlist.max': 5,
  'cancel.buyerChat': 'REQUEST',
  'cancel.succession': 'AUTO',
  'contention.policy': 'ARRIVAL',
  'contention.sameMinuteTieBreaker': 'HOST',
  'price.unit': 'THOUSAND',
  'shipping.baseFee': 4000,
  'shipping.freeThreshold': null,
  'settlement.groupBy': 'DATE',
  'print.autoOnConfirm': true,
  'thanks.liveChat': true,
  'thanks.videoComment': 'OFF',
  'thanks.batchWindowSec': 0,
})

const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS) as SettingKey[])

/**
 * 기본값 위에 덮어쓴 새 설정 객체를 돌려준다. 넘긴 객체는 바꾸지 않는다.
 * - 덮어쓰는 값은 객체 자신의 속성만 본다(상속된 속성은 무시). 값이 `undefined`인 키는 기본값을 쓴다.
 * - 값의 범위 검사는 하지 않는다 — 검사는 checkSettings가 한다(엔진의 broadcast.start·initEngine, 서버 설정 저장, D-071).
 */
export function resolveSettings(override?: SettingsOverride | null): SaleSettings {
  const resolved: SaleSettings = { ...DEFAULT_SETTINGS }
  if (override === null || typeof override !== 'object') return resolved
  const target = resolved as unknown as Record<SettingKey, unknown>
  for (const key of SETTING_KEYS) {
    if (!Object.hasOwn(override, key)) continue
    const value: unknown = override[key]
    if (value !== undefined) target[key] = value
  }
  return resolved
}

// ── 설정값 범위 (DOMAIN_RULES 설정표 아래 "설정값 범위", D-071) ──────────────

/** 설정 덮어쓰기 객체의 문제 하나 */
export interface SettingsProblem {
  /** 문제가 있는 설정 키 (설정 객체 전체의 문제면 null) */
  readonly key: string | null
  /** 판매자에게 보여 줄 수 있는 쉬운 이유 */
  readonly message: string
}

type SettingRule =
  | { readonly kind: 'choice'; readonly choices: readonly string[] }
  | { readonly kind: 'yesNo' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number; readonly nullable: boolean }

const choice = (...choices: readonly string[]): SettingRule => ({ kind: 'choice', choices })
const YES_NO: SettingRule = { kind: 'yesNo' }
const int = (min: number, max: number, nullable = false): SettingRule => ({ kind: 'int', min, max, nullable })

/** 키마다 받는 값. 선택지는 설정표, 정수 범위는 "설정값 범위" 표 그대로다 */
const SETTING_RULES: Readonly<Record<SettingKey, SettingRule>> = {
  'claim.parseMode': choice('STRICT', 'LOOSE'),
  'claim.multiNumber': choice('ALL', 'FIRST', 'IGNORE'),
  'claim.maxNumber': int(1, 9999),
  'claim.ignoreOwner': YES_NO,
  'claim.preOpenWindowSec': int(0, 300),
  'waitlist.max': int(0, 100),
  'cancel.buyerChat': choice('OFF', 'REQUEST', 'AUTO'),
  'cancel.succession': choice('AUTO', 'ASK', 'REOPEN'),
  'contention.policy': choice('ARRIVAL', 'RECEIVED_TIME'),
  'contention.sameMinuteTieBreaker': choice('YOUTUBE', 'SMS', 'HOST'),
  'price.unit': choice('WON', 'THOUSAND'),
  'shipping.baseFee': int(0, 1_000_000),
  'shipping.freeThreshold': int(0, 100_000_000, true),
  // MANUAL은 형식은 맞지만 아직 지원하지 않는다 — 문제가 아니라 엔진이 미구현을 알린다 (D-059)
  'settlement.groupBy': choice('DATE', 'MANUAL'),
  'print.autoOnConfirm': YES_NO,
  'thanks.liveChat': YES_NO,
  'thanks.videoComment': choice('OFF', 'PER_SALE', 'SUMMARY'),
  'thanks.batchWindowSec': int(0, 600),
}

/** 세 자리마다 쉼표 (실행 환경의 언어 설정과 무관하게) */
function grouped(value: number): string {
  const digits = String(value)
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}

function ruleProblem(rule: SettingRule, value: unknown): string | null {
  switch (rule.kind) {
    case 'choice':
      return typeof value === 'string' && rule.choices.includes(value) ? null : '고를 수 있는 값이 아니에요'
    case 'yesNo':
      return typeof value === 'boolean' ? null : '예나 아니오로만 정할 수 있어요'
    case 'int': {
      if (rule.nullable && value === null) return null
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= rule.min && value <= rule.max) return null
      const range = `${grouped(rule.min)}부터 ${grouped(rule.max)}까지의 정수로 적어 주세요`
      return rule.nullable ? `비워 두거나 ${range}` : range
    }
  }
}

/**
 * 설정 덮어쓰기 객체를 검사한다 (D-071). 문제가 없으면 빈 목록.
 * - 문제: 객체가 아님(배열·null 포함), 모르는 키, 선택지 밖 값, true·false가 아닌 예/아니오 값(문장은 '예나 아니오' — 판매자에게 그대로 보이므로 영어 값 이름을 쓰지 않는다, SA-S04-004), 정수가 아니거나 범위 밖인 수(`1.5`·`NaN`·`"5"` 포함).
 *   값이 `undefined`인 키도 문제다(값이 없다).
 * - `settlement.groupBy: MANUAL`은 문제가 아니다 — 엔진이 미구현(NotImplementedError)으로 알린다(D-059).
 * - 엔진의 broadcast.start 설정 검사, initEngine 시작 설정 검사, 서버의 설정 저장이 이 함수 하나로 같은 판정을 한다.
 * - 키는 자기 속성을 모두 본다(열거되지 않는 속성 포함 — resolveSettings가 읽는 값은 모두 검사한다).
 */
export function checkSettings(override: unknown): SettingsProblem[] {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) return [{ key: null, message: '설정은 키와 값을 짝지은 객체여야 해요' }]
  const problems: SettingsProblem[] = []
  for (const key of Reflect.ownKeys(override)) {
    const name = typeof key === 'string' ? key : String(key)
    const rule = typeof key === 'string' && Object.hasOwn(SETTING_RULES, key) ? SETTING_RULES[key as SettingKey] : undefined
    if (rule === undefined) {
      problems.push({ key: name, message: '모르는 설정이에요' })
      continue
    }
    const message = ruleProblem(rule, (override as Record<string, unknown>)[name])
    if (message !== null) problems.push({ key: name, message })
  }
  return problems
}
