// 주문 탭 목록·주문 상세의 글자와 작은 도움 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항 … 사진1처럼 주문 목록 … 사진2처럼 상세 내역").
// 날짜·시각은 늘 한국 시각(KST)으로 — 기기 시간대 시각 함수(getHours 등)는 쓰지 않는다. 금액은 서버가 준 정수 원 그대로.
import { useEffect, useRef } from 'react'
import type { OrderDetailView, OrderRow } from '@livejjim/web/src/api/order-types.ts'
import { kstDate, kstHm } from '@livejjim/web/src/lib/kst.ts'
import { useServices } from '../services.tsx'
import { formatWon } from './words.ts'

/** 주문 목록 경로 (첫 쪽) */
export const ORDERS_PATH = '/api/orders'

/** 주문 목록·상세가 서로 다시 받으라고 알리는 이름 (상세에서 금액을 고치면 목록 합계도 바뀐다) */
export const ORDERS_TOPIC = 'orders'

/** 주문 상세 경로 */
export const orderPath = (date: string, buyer: string): string => `/api/days/${date}/order?buyer=${encodeURIComponent(buyer)}`

export const NO_NAME = '성함 받기 전'
export const NO_ADDRESS_YET = '배송지 받기 전'
export const NO_PHONE = '모름'
export const NO_ORDERS = '아직 주문이 없어요'
export const NO_HISTORY = '지난 거래가 없어요'
export const ORDER_DETAIL_TITLE = '주문 상세'

const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const

function dateParts(date: string): { readonly year: number; readonly month: number; readonly day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m === null ? null : { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/** `2026-11-11` → `11.11` (토스 거래 내역 왼쪽 날짜 칸 — 자리를 맞추려고 두 자리) */
export function dotDate(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return m === null ? date : `${m[1] ?? ''}.${m[2] ?? ''}`
}

/** `2026-11-03` → `11월 3일 화요일` (요일은 그 날짜 자체로 — 시간대와 무관) */
export function dayWeekdayWords(date: string): string {
  const parts = dateParts(date)
  if (parts === null) return date
  const weekday = WEEKDAY_LONG[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()] ?? ''
  return `${String(parts.month)}월 ${String(parts.day)}일 ${weekday}`
}

/** UTC 시각 → KST `11월 11일 수요일 15:42` (예약일시). 읽을 수 없으면 빈 글자 */
export function claimedAtWords(value: string): string {
  const date = kstDate(value)
  if (date === '') return ''
  return `${dayWeekdayWords(date)} ${kstHm(value)}`
}

/** 줄·머리의 큰 이름: 성함, 모르면 닉네임 */
export const orderTitle = (row: Pick<OrderRow, 'name' | 'nickname'>): string => row.name ?? row.nickname

/** 이름 아래 작은 줄: 성함이 있으면 닉네임, 없으면 "성함 받기 전" */
export const orderSubline = (row: Pick<OrderRow, 'name' | 'nickname'>): string => (row.name === null ? NO_NAME : row.nickname)

export const countWords = (n: number): string => `${String(n)}개`

/** 휴대폰 번호 `01012345678` → `010-1234-5678` (모르면 "모름"). 판매자 화면에만 — 로그에 넣지 않는다 */
export function phoneDashes(phone: string | null): string {
  if (phone === null) return NO_PHONE
  const digits = phone.replace(/\D/g, '')
  if (/^02\d{7,8}$/.test(digits)) return `02-${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`
  if (/^\d{10,11}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`
  return phone
}

/** 주소 한 줄 `(50603) 경상남도 … 1034` — 우편번호를 모르면 괄호 없이, 배송지가 없으면 "배송지 받기 전" */
export function addressWords(address: OrderDetailView['address']): string {
  if (address === null) return NO_ADDRESS_YET
  const zip = address.zip.trim()
  return [zip === '' ? null : `(${zip})`, address.address.trim(), address.detail.trim()].filter((part) => part !== null && part !== '').join(' ')
}

/** 배송비 아래 작은 회색 글: 그날 배송비 규칙 (직접 수령·합배송·따로 정함이면 그 말) */
export function shippingNote(rule: OrderDetailView['shippingRule']): string {
  if (rule.mode === 'PICKUP') return '직접 수령'
  if (rule.mode === 'COMBINED') return '합배송'
  if (rule.mode === 'FIXED') return '따로 정한 배송비'
  return rule.freeThreshold !== null ? `${formatWon(rule.freeThreshold)} 이상 구매 시 무료` : `기본 배송비 ${formatWon(rule.baseFee)}`
}

/** 목록 쪽들을 이어 붙인다 — 같은 날짜·같은 손님 줄은 한 번만 (쪽 사이에 자료가 바뀌어도 겹쳐 보이지 않게) */
export function joinOrders(pages: readonly (readonly OrderRow[])[]): OrderRow[] {
  const seen = new Set<string>()
  const out: OrderRow[] = []
  for (const page of pages) {
    for (const row of page) {
      const key = JSON.stringify([row.date, row.buyer])
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

/** 옛 경로 /settle-buyer?key=["buyer","date"] (D-UX4-58) 열쇠를 읽는다 — 옛 링크가 끊기지 않게. 못 읽으면 null */
export function parseOrderKey(key: string): { readonly buyer: string; readonly date: string } | null {
  try {
    const parsed: unknown = JSON.parse(key)
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [buyer, date] = parsed as unknown[]
    if (typeof buyer !== 'string' || typeof date !== 'string' || dateParts(date) === null) return null
    return { buyer, date }
  } catch {
    return null
  }
}

/** 실시간 알림이 잦아도(라이브 중 찜마다) 한 번에 모아 다시 받는 시간 */
export const LIVE_RELOAD_MS = 1000

/**
 * 실제 범위(리허설 아님)가 바뀌었다는 알림·다시 붙음이면 다시 받는다. date가 있으면 그 날짜 알림만.
 * 라이브 중엔 알림이 잦아 LIVE_RELOAD_MS 안의 알림은 한 번으로 모은다.
 */
export function useOrdersLive(date: string | null, reload: () => void): void {
  const { stream } = useServices()
  const latest = useRef(reload)
  latest.current = reload
  useEffect(() => {
    const view = stream.open()
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        latest.current()
      }, LIVE_RELOAD_MS)
    }
    let ready = 0
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) soon()
    })
    view.addEventListener('change', (event) => {
      try {
        const scope = JSON.parse(event.data ?? '{}') as { date?: string; rehearsal?: boolean }
        if (scope.rehearsal === true) return
        if (date === null || scope.date === date) soon()
      } catch {
        soon()
      }
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      view.close()
    }
  }, [date, stream])
}
