// 정산 계산 (R-12, D-058). 판정(입금 기록 잠금 R-7.3, 입금 전 찜 R-10, 큰 환불 거절)과 조회가 같은 함수를 쓴다.
// 정산 기록은 적힌 (구매자 자신, 날짜)에 붙어 있고, 묶음 = (지금의 구매자, 날짜)는 합친 구매자들 것을 모두 더한다(D-057).
import type { SaleSettings } from '../settings.ts'
import type { LedgerRecord, PaymentStatus, SettlementEntry } from './types.ts'

export interface LedgerReader {
  readLedger(buyer: string, date: string): LedgerRecord | undefined
  /** 그 구매자와 그 아래에 합쳐진 구매자 전부 */
  members(id: string): string[]
}

/** 묶음의 정산 기록 (적힌 구매자와 함께), 적힌 순서(seq) */
export function groupEntries(reader: LedgerReader, root: string, date: string): { readonly buyer: string; readonly entry: SettlementEntry }[] {
  const out: { buyer: string; entry: SettlementEntry }[] = []
  for (const member of reader.members(root)) {
    for (const entry of reader.readLedger(member, date)?.entries ?? []) out.push({ buyer: member, entry })
  }
  return out.sort((a, b) => a.entry.seq - b.entry.seq)
}

/** 기록 목록의 받은 금액 = 입금 합 − 환불 합 */
export function receivedFrom(entries: readonly SettlementEntry[]): number {
  let total = 0
  for (const entry of entries) {
    if (entry.kind === 'payment') total += entry.amount
    else if (entry.kind === 'refund') total -= entry.amount
  }
  return total
}

/** 구매자들의 그 날짜 받은 금액 합 */
export function receivedOfMembers(reader: LedgerReader, members: readonly string[], date: string): number {
  let total = 0
  for (const member of members) total += receivedFrom(reader.readLedger(member, date)?.entries ?? [])
  return total
}

/** (지금의 구매자, 날짜) 묶음의 받은 금액 */
export function receivedOf(reader: LedgerReader, root: string, date: string): number {
  return receivedOfMembers(reader, reader.members(root), date)
}

export interface SettlementTotals {
  readonly subtotal: number
  readonly shipping: number
  readonly shippingOverride: 'PICKUP' | 'COMBINED' | 'FIXED' | null
  readonly adjustments: number
  readonly total: number
  readonly received: number
  readonly refundDue: number
  readonly payment: PaymentStatus
}

/**
 * 묶음 금액 (R-12, D-058).
 * - 배송비: 품목 없음 0 → 예외(기록 중 가장 나중 것: PICKUP·COMBINED 0, FIXED 금액, DEFAULT면 예외 없음) → 무료 기준(상품 합계만) → 기본 배송비
 * - 조정: 품목이 없으면 0으로 본다. 최종 금액은 0 아래로 내려가지 않는다.
 * - 입금 상태: 받은 금액 0 → UNPAID(최종 0이어도), 0 < 받은 < 최종 → PARTIAL, 같음 → PAID, 큼 → OVERPAID·환불 필요 = 차액
 */
export function settle(settings: SaleSettings, subtotal: number, itemCount: number, entries: readonly SettlementEntry[]): SettlementTotals {
  let latest: Extract<SettlementEntry, { kind: 'shipping' }> | null = null
  let adjustments = 0
  for (const entry of entries) {
    if (entry.kind === 'shipping') {
      if (latest === null || entry.seq >= latest.seq) latest = entry
    } else if (entry.kind === 'adjust') adjustments += entry.amount
  }
  const override = latest === null || latest.mode === 'DEFAULT' ? null : latest.mode
  const received = receivedFrom(entries)
  const empty = itemCount === 0
  const threshold = settings['shipping.freeThreshold']
  let shipping: number
  if (empty || override === 'PICKUP' || override === 'COMBINED') shipping = 0
  else if (override === 'FIXED') shipping = latest?.amount ?? 0
  else shipping = threshold !== null && subtotal >= threshold ? 0 : settings['shipping.baseFee']
  const adjusted = empty ? 0 : adjustments
  const total = empty ? 0 : Math.max(0, subtotal + shipping + adjusted)
  let payment: PaymentStatus
  if (received === 0) payment = 'UNPAID'
  else if (received < total) payment = 'PARTIAL'
  else if (received === total) payment = 'PAID'
  else payment = 'OVERPAID'
  return {
    subtotal,
    shipping,
    shippingOverride: override,
    adjustments: adjusted,
    total,
    received,
    refundDue: payment === 'OVERPAID' ? received - total : 0,
    payment,
  }
}
