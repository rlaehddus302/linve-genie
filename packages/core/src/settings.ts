/**
 * 판매 규칙 설정 (DOMAIN_RULES "판매 규칙 설정표"). 키는 점 표기 그대로 쓴다.
 * 기본값 적용은 각 기능을 구현하는 스프린트(S01~S03)에서 코어가 맡는다.
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
