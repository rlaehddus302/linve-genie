// 손님 기록 요약 (SPEC BUY-06, CRM1 D-CRM1-03·D-CRM1-04·D-CRM1-05, 골든 tests/golden/regulars/summary.json).
// - 순수 함수다: 시계·난수·I/O를 쓰지 않는다. 오늘 날짜(서버 시각의 KST 날짜)는 부르는 쪽이 넣는다.
// - 날짜 더하기는 달력 날짜(정수 날 수)로 한다 — 실행 환경 시간대(TZ)와 상관없다. 묶음 순서가 바뀌어도 결과가 같다.
// - 금액은 코어 묶음 값(상품 합계)을 더하기만 한다(다시 계산하지 않는다). 정수 원.
import type { PaymentStatus } from '@livejjim/core'

/** 기록 묶음 하나 (실제 날짜의 정산 묶음 하나) */
export interface SummaryBundle {
  readonly date: string
  readonly buyer: string
  /** 확정 찜 수량 합 */
  readonly items: number
  /** 상품 합계 (원) */
  readonly subtotal: number
  readonly payment: PaymentStatus
  /** 1등이었다가 취소·무효로 끝난 찜 수 */
  readonly cancels: number
  /** 그중 사유가 '입금 안 함'인 찜 수 */
  readonly noPay: number
}

/** 설정 "손님 관리" (D-CRM1-05) */
export interface CustomerSettings {
  readonly regularCount: number
  /** 정수 원, null = 금액 기준 안 씀 */
  readonly regularAmount: number | null
  readonly waitDays: number
}

export const DEFAULT_CUSTOMER_SETTINGS: CustomerSettings = { regularCount: 3, regularAmount: 100_000, waitDays: 3 }

export interface CustomerSummary {
  readonly purchaseDays: number
  readonly purchaseTotal: number
  readonly lastPurchase: string | null
  readonly unpaidDays: number
  readonly lastUnpaid: string | null
  readonly cancels: number
  readonly regular: boolean
  readonly caution: boolean
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** 그레고리력 날짜 → 1970-01-01부터의 날 수 (시간대 없음) */
function daysFromCivil(y: number, m: number, d: number): number {
  const year = m <= 2 ? y - 1 : y
  const era = Math.floor(year / 400)
  const yoe = year - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(z: number): string {
  const shifted = z + 719468
  const era = Math.floor(shifted / 146097)
  const doe = shifted - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

/** 'YYYY-MM-DD' + n일 (달력 날짜) */
export function addDays(date: string, days: number): string {
  const match = DATE_RE.exec(date)
  if (match === null) throw new RangeError('날짜 형식이 아니다')
  return civilFromDays(daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3])) + days)
}

/** 사유가 빠른 선택 "입금 안 함"인지 (D-CRM1-04 (나)): 공백(전각 공백·탭·줄 나눔 포함)을 모두 뺀 글이 `입금안함`과 같다 */
export function isNoPayReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.replace(/\s/gu, '') === '입금안함'
}

/** 구매 묶음 (D-CRM1-03): 품목이 있고 입금 완료·과입금 */
export function isPurchase(bundle: SummaryBundle): boolean {
  return bundle.items >= 1 && (bundle.payment === 'PAID' || bundle.payment === 'OVERPAID')
}

/** 미입금 날의 묶음 (D-CRM1-04): (가) 품목이 있고 미입금·부분 입금이며 오늘 > 날짜 + 기다리는 날, 또는 (나) '입금 안 함'으로 끝낸 1등 찜이 있다 */
export function isUnpaid(bundle: SummaryBundle, today: string, waitDays: number): boolean {
  if (bundle.noPay >= 1) return true
  return bundle.items >= 1 && (bundle.payment === 'UNPAID' || bundle.payment === 'PARTIAL') && today > addDays(bundle.date, waitDays)
}

const latest = (dates: ReadonlySet<string>): string | null => {
  let found: string | null = null
  for (const date of dates) if (found === null || date > found) found = date
  return found
}

/** 손님 기록 요약 (골든 G-CRM-001~013) */
export function customerSummary(today: string, settings: CustomerSettings, bundles: readonly SummaryBundle[]): CustomerSummary {
  const purchaseDates = new Set<string>()
  const unpaidDates = new Set<string>()
  let purchaseTotal = 0
  let cancels = 0
  for (const bundle of bundles) {
    if (isPurchase(bundle)) {
      purchaseDates.add(bundle.date)
      purchaseTotal += bundle.subtotal
    }
    if (isUnpaid(bundle, today, settings.waitDays)) unpaidDates.add(bundle.date)
    cancels += bundle.cancels
  }
  const purchaseDays = purchaseDates.size
  const unpaidDays = unpaidDates.size
  const regular = purchaseDays >= settings.regularCount || (settings.regularAmount !== null && purchaseTotal >= settings.regularAmount)
  return { purchaseDays, purchaseTotal, lastPurchase: latest(purchaseDates), unpaidDays, lastUnpaid: latest(unpaidDates), cancels, regular, caution: unpaidDays >= 1 }
}
