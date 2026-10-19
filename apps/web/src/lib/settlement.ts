// 정산 화면의 값 (STL-01·02·03·07·09, R-12, D-058, D-092). 금액은 서버 조회(코어 listSettlements) 그대로 쓰고,
// 보내기 전 미리 보기만 코어 settle(R-12 순서: 품목 없음 0 → 예외 → 무료 기준(그날 첫 방송의 설정 스냅샷, 상품 합계만) → 기본 배송비)로 계산한다.
import { DEFAULT_SETTINGS, settle, type PaymentStatus, type SaleSettings, type SettlementEntry, type SettlementTotals } from '@livejjim/core'
import type { Settlement } from '../api/types.ts'
import type { ScopeData } from './scope-data.ts'

/** 정산이 쓰는 설정: 그날 첫 방송의 설정 스냅샷 (코어 settlementSettings와 같다) */
export function settlementSettings(data: ScopeData): SaleSettings {
  for (const broadcast of data.broadcasts.values()) if (broadcast.date === data.date) return broadcast.settings
  return DEFAULT_SETTINGS
}

/** 남은 금액 = 최종 − 받은 금액 (0 아래면 0) */
export function remainingOf(settlement: Pick<Settlement, 'total' | 'received'>): number {
  return Math.max(settlement.total - settlement.received, 0)
}

/** 조회의 기록 → 코어 정산 기록 (미리 보기 계산용) */
function entriesOf(settlement: Settlement): SettlementEntry[] {
  const out: SettlementEntry[] = []
  for (const record of settlement.records) {
    switch (record.kind) {
      case 'shipping':
        out.push({ kind: 'shipping', mode: record.mode ?? 'DEFAULT', amount: record.amount, seq: record.seq, at: 0 })
        break
      case 'adjust':
        out.push({ kind: 'adjust', amount: record.amount ?? 0, reason: record.reason ?? '', seq: record.seq, at: 0 })
        break
      case 'payment':
        out.push({ kind: 'payment', amount: record.amount ?? 0, memo: record.memo, seq: record.seq, at: 0 })
        break
      case 'refund':
        out.push({ kind: 'refund', amount: record.amount ?? 0, reason: record.reason ?? '', seq: record.seq, at: 0 })
        break
    }
  }
  return out
}

export type PreviewEntry =
  | { readonly kind: 'shipping'; readonly mode: 'DEFAULT' | 'PICKUP' | 'COMBINED' | 'FIXED'; readonly amount: number | null }
  | { readonly kind: 'adjust'; readonly amount: number }

/** 기록 하나를 더했을 때의 묶음 금액 (보내기 전 미리 보기, AC-S06-33·34) */
export function previewWith(data: ScopeData, settlement: Settlement, entry: PreviewEntry): SettlementTotals {
  const entries = entriesOf(settlement)
  const seq = entries.reduce((max, item) => Math.max(max, item.seq), 0) + 1
  const extra: SettlementEntry =
    entry.kind === 'shipping'
      ? { kind: 'shipping', mode: entry.mode, amount: entry.amount, seq, at: 0 }
      : { kind: 'adjust', amount: entry.amount, reason: '미리 보기', seq, at: 0 }
  return settle(settlementSettings(data), settlement.subtotal, settlement.items.length, [...entries, extra])
}

export interface SettlementSummary {
  readonly count: number
  readonly byStatus: Readonly<Record<PaymentStatus, number>>
  readonly total: number
  readonly received: number
  /** Σ max(최종 − 받은 금액, 0) */
  readonly remaining: number
  readonly refundDue: number
}

/** 목록 위 요약 (AC-S06-30): 서버 조회 값으로 계산한다 */
export function summarize(list: readonly Settlement[]): SettlementSummary {
  const byStatus: Record<PaymentStatus, number> = { UNPAID: 0, PARTIAL: 0, PAID: 0, OVERPAID: 0 }
  let total = 0
  let received = 0
  let remaining = 0
  let refundDue = 0
  for (const item of list) {
    byStatus[item.payment]++
    total += item.total
    received += item.received
    remaining += remainingOf(item)
    refundDue += item.refundDue
  }
  return { count: list.length, byStatus, total, received, remaining, refundDue }
}

export type PaymentFilter = 'ALL' | PaymentStatus

/** 기본 정렬 (AC-S06-30): 미입금·부분 입금 먼저, 그다음 표시 이름 순 */
export function sortSettlements(list: readonly Settlement[], nameOf: (buyer: string) => string): Settlement[] {
  const first = (item: Settlement) => (item.payment === 'UNPAID' || item.payment === 'PARTIAL' ? 0 : 1)
  return [...list].sort((a, b) => first(a) - first(b) || nameOf(a.buyer).localeCompare(nameOf(b.buyer), 'ko') || (a.buyer < b.buyer ? -1 : a.buyer > b.buyer ? 1 : 0))
}

/** 그날 묶음 목록 (거르기·이름 찾기) */
export function filterSettlements(list: readonly Settlement[], filter: PaymentFilter, query: string, nameOf: (buyer: string) => string): Settlement[] {
  const text = query.trim().toLowerCase()
  return list.filter((item) => (filter === 'ALL' || item.payment === filter) && (text === '' || nameOf(item.buyer).toLowerCase().includes(text)))
}
