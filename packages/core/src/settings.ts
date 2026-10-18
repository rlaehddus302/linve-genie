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
 * - 값의 범위 검사는 하지 않는다(설정 저장 때 S04·S05에서 검사).
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
