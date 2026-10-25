// 손님 기록 (CRM1, SPEC BUY-06·BUY-07, D-CRM1-02~D-CRM1-10). 계산은 서버가 한다 — 화면은 받은 숫자를 낱말로 바꾸고 정렬·거르기만 한다.
// - 서버 계약: harness/sprints/CRM1/dev-notes.md "API". 판매자 계정만(보조자 403). 응답에 전화번호 키·전화번호가 없다 — 손님은 불투명 ID.
// - 날짜 문장은 KST 날짜 그대로(범위 날짜는 이미 KST). 올해 기준은 응답의 today(서버 KST 날짜) — 화면 기기 시계와 상관없다.
// - 영어 상태값(PAID·UNPAID 등)은 낱말로만 보인다(절대 규칙 8).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaymentStatus } from '@livejjim/core'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { Buyer } from '../api/types.ts'
import { formatWon } from './derive.ts'
import { kstDate } from './kst.ts'
import { PAYMENT_WORD } from './words.ts'

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

/** GET /api/days/:date/customers 의 한 줄 (지금의 구매자마다) */
export interface DayCustomer extends CustomerSummary {
  readonly buyer: string
}

export interface DayCustomersView {
  readonly date: string
  readonly today: string
  readonly settings: CustomerSettings
  readonly customers: readonly DayCustomer[]
}

export interface MemoView {
  readonly text: string
  /** UTC ISO */
  readonly savedAt: string
}

export type CustomerPlatform = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK'

/** 구매자 자세히의 묶음 구성원 (메모 칸 하나씩) */
export interface DayMember {
  readonly buyer: string
  readonly name: string
  readonly platform: CustomerPlatform | null
  readonly kindLabel: string
  readonly phoneLast4: string | null
  /** 불투명 손님 ID — null이면 전화번호 없는 문자 손님(메모를 남길 수 없다) */
  readonly customer: string | null
  readonly memo: MemoView | null
}

export interface DayCustomerView {
  readonly date: string
  readonly buyer: string
  readonly summary: CustomerSummary
  readonly members: readonly DayMember[]
}

/** "모든 손님" 한 줄 */
export interface CustomerRow extends CustomerSummary {
  readonly id: string
  readonly name: string
  readonly platform: CustomerPlatform | null
  readonly kindLabel: string
  readonly phoneLast4: string | null
  readonly blocked: boolean
  readonly latestDate: string
  readonly latestBuyer: string
}

export interface CustomersView {
  readonly today: string
  readonly settings: CustomerSettings
  readonly customers: readonly CustomerRow[]
  readonly count: number
  readonly more: boolean
  readonly next: number | null
}

export interface CustomerDayLine {
  readonly date: string
  readonly buyer: string
  readonly name: string
  readonly subtotal: number
  readonly payment: PaymentStatus
  readonly unpaid: boolean
}

export interface CustomerDetailView {
  readonly customer: CustomerRow
  readonly memo: MemoView | null
  readonly days: readonly CustomerDayLine[]
  readonly more: boolean
  readonly next: string | null
}

// ── 낱말 ──────────────────────────────────────────────────────────────

export const REGULAR_WORD = '단골'
export const CAUTION_WORD = '입금 늦음 주의'
/** 콘솔 요약 줄에 다 들어가지 않을 때 (D-CRM1-07) */
export const CAUTION_SHORT = '주의'
/** 화면 읽기 프로그램이 읽는 말 (D-CRM1-07) */
export const CAUTION_SPOKEN = '입금 늦음 주의 손님'
export const BLOCKED_WORD = '차단'
export const NO_PURCHASE = '아직 입금 완료된 구매 없음'
export const NO_UNPAID = '미입금 없음'
export const NO_PHONE_MEMO = '전화번호 없는 문자 손님은 다른 날과 이어지지 않아 메모를 남길 수 없어요.'
export const MEMO_HINT = '연락처·주소는 적지 마세요.'
export const MEMO_MAX = 200
export const MEMO_TOO_LONG = '메모는 200자까지 적을 수 있어요.'
export const MEMO_SAVED = '메모를 저장했어요.'
export const MEMO_CLEARED = '메모를 지웠어요.'
export const CUSTOMER_LOAD_FAILED = '손님 기록을 불러오지 못했어요.'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 손님 기록의 날짜 (D-CRM1-06): 올해(today의 연도)면 "10월 15일(목)", 아니면 "2025년 12월 29일(월)".
 * 날짜는 KST 날짜 그대로 — 요일은 그 날짜 자체로 정한다(브라우저 시간대와 상관없다).
 */
export function customerDate(date: string, today: string): string {
  const m = DATE_RE.exec(date)
  if (!m) return date
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  const words = `${String(Number(m[2]))}월 ${String(Number(m[3]))}일(${WEEKDAYS[day] ?? ''})`
  return today.slice(0, 4) === m[1] ? words : `${String(Number(m[1]))}년 ${words}`
}

/** 메모 저장 시각 → "10월 26일(월) 저장" (savedAt은 UTC — KST 날짜로) */
export function memoSavedWords(savedAt: string, today: string): string {
  return `${customerDate(kstDate(savedAt), today)} 저장`
}

/** 손님 기록 칸의 줄들 (D-CRM1-06) */
export function summaryLines(summary: CustomerSummary, today: string): string[] {
  return [
    `누적 구매 ${formatWon(summary.purchaseTotal)} · ${String(summary.purchaseDays)}번`,
    summary.lastPurchase === null ? NO_PURCHASE : `마지막 구매 ${customerDate(summary.lastPurchase, today)}`,
    summary.unpaidDays === 0 ? NO_UNPAID : `미입금 ${String(summary.unpaidDays)}번${summary.lastUnpaid === null ? '' : ` · 마지막 ${customerDate(summary.lastUnpaid, today)}`}`,
    `취소 ${String(summary.cancels)}번`,
  ]
}

/** 손님 자세히 날짜 줄의 입금 상태 낱말 (영어 상태값을 보이지 않는다) */
export function paymentWords(payment: PaymentStatus): string {
  return PAYMENT_WORD[payment]
}

/** 메모 칸 이름: 플랫폼 손님은 "유튜브 · 다육이맘", 문자 손님은 "문자 · 끝자리 1234" (AC-CRM1-23) */
export function memberLabel(member: Pick<DayMember, 'platform' | 'kindLabel' | 'name'>): string {
  return member.platform === null ? member.kindLabel : `${member.kindLabel} · ${member.name}`
}

/** 코드 포인트 수 (메모 200자 셈 — 서버와 같다) */
export const codePoints = (text: string): number => [...text].length

// ── 구매자 목록 정렬·거르기 (D-CRM1-06, AC-CRM1-14) ─────────────────

export type CustomerFilter = 'all' | 'regular' | 'caution'

export const FILTER_WORD: Readonly<Record<CustomerFilter, string>> = {
  all: '모두',
  regular: '단골만',
  caution: '입금 늦음 주의만',
}

/** 거르기: 단골만·입금 늦음 주의만 (기록이 없는 구매자는 둘 다 아니다) */
export function passesFilter(summary: Pick<CustomerSummary, 'regular' | 'caution'> | undefined, filter: CustomerFilter): boolean {
  if (filter === 'all') return true
  if (summary === undefined) return false
  return filter === 'regular' ? summary.regular : summary.caution
}

/** "누적 큰 순": 누적 구매 금액 큰 순, 같으면 이름 순 → 구매자 ID 순 (기록이 없으면 0원) */
export function byCumulative(customers: ReadonlyMap<string, DayCustomer>): (a: Buyer, b: Buyer) => number {
  const total = (buyer: Buyer) => customers.get(buyer.id)?.purchaseTotal ?? 0
  return (a, b) => total(b) - total(a) || a.display.localeCompare(b.display, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// ── "모든 손님" 정렬 ──────────────────────────────────────────────────

export type CustomerSort = 'total' | 'recent' | 'unpaid'

export const SORT_WORD: Readonly<Record<CustomerSort, string>> = {
  total: '누적 큰 순',
  recent: '최근 산 순',
  unpaid: '미입금 많은 순',
}

export const CUSTOMER_SORTS: readonly CustomerSort[] = ['total', 'recent', 'unpaid']
export const CUSTOMER_FILTERS: readonly CustomerFilter[] = ['all', 'regular', 'caution']

export const isCustomerSort = (value: string | null | undefined): value is CustomerSort => (CUSTOMER_SORTS as readonly string[]).includes(value ?? '')
export const isCustomerFilter = (value: string | null | undefined): value is CustomerFilter => (CUSTOMER_FILTERS as readonly string[]).includes(value ?? '')

// ── 받기 ──────────────────────────────────────────────────────────────

export const dayCustomersPath = (date: string): string => `/api/days/${date}/customers`
export const dayCustomerPath = (date: string, buyer: string): string => withQuery(`/api/days/${date}/customer`, { buyer })

export interface DayCustomers {
  /** 받은 값 (아직 없거나 실패하면 null) */
  readonly view: DayCustomersView | null
  readonly map: ReadonlyMap<string, DayCustomer>
  /** 마지막 실패 (없는 날짜 404 포함) */
  readonly error: ApiError | null
  readonly retry: () => void
}

const EMPTY: ReadonlyMap<string, DayCustomer> = new Map()

/**
 * 그날 구매자 꼬리표·누적 (GET /api/days/:date/customers). 실제 날짜만 — enabled가 거짓이면(리허설) 부르지 않는다.
 * refresh가 바뀌면 다시 받되 minGapMs에 한 번까지(그 사이 바뀐 것은 간격이 차면 한 번 받는다). 실패하면 받은 값을 그대로 둔다.
 * 화면을 열 때(날짜가 바뀔 때·다시 불러오기 포함) 받은 것은 간격에 세지 않는다 — 연 직후 첫 변화는 바로 받는다(D-CRM1-07 "1등이 바뀌면 5초 안에", TE-CRM1-001).
 */
export function useDayCustomers(date: string, enabled: boolean, refresh: string, minGapMs: number): DayCustomers {
  const [view, setView] = useState<DayCustomersView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** 간격을 세는 마지막 받기 시각 (0 = 셀 것 없음 — 아직 안 받았거나 연 때 받은 것뿐) */
  const last = useRef(0)
  /** 이 날짜를 연 뒤 받은 적이 있나 (연 때 받은 것은 간격에 세지 않는다) */
  const opened = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  const fetchKey = `${date}|${String(enabled)}`
  const keyRef = useRef(fetchKey)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  // 날짜가 바뀌면 받은 값을 버린다
  useEffect(() => {
    keyRef.current = fetchKey
    setView(null)
    setError(null)
    last.current = 0
    opened.current = false
  }, [fetchKey])

  useEffect(() => {
    if (!enabled || date === '') return
    const key = fetchKey
    const load = () => {
      timer.current = null
      last.current = opened.current ? Date.now() : 0
      opened.current = true
      get<DayCustomersView>(dayCustomersPath(date)).then(
        (result) => {
          if (!alive.current || keyRef.current !== key) return
          setView(result)
          setError(null)
        },
        (caught: unknown) => {
          if (!alive.current || keyRef.current !== key) return
          if (isApiError(caught)) setError(caught)
        },
      )
    }
    if (timer.current !== null) return
    const wait = last.current === 0 ? 0 : last.current + minGapMs - Date.now()
    if (wait <= 0) load()
    else timer.current = setTimeout(load, wait)
  }, [date, enabled, refresh, minGapMs, attempt, fetchKey])

  const map = useMemo(() => (view === null ? EMPTY : new Map(view.customers.map((customer) => [customer.buyer, customer]))), [view])
  return {
    view,
    map,
    error,
    retry: () => {
      last.current = 0
      opened.current = false
      setAttempt((n) => n + 1)
    },
  }
}
