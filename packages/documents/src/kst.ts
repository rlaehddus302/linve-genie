// 날짜·시각 글자 (NFR-07: 실행 환경 시간대와 상관없다). UTC 밀리초에 KST(+9시간)를 더해 UTC 읽기 함수로만 읽는다.
// 실행 환경의 언어·시간대 API(toLocale*·Intl)를 쓰지 않는다 (D-207).
import { isValidDate } from '@livejjim/core'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** 방송 날짜 글(YYYY-MM-DD)이 실제 있는 날짜인가 (코어 isValidDate) */
export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && isValidDate(value)
}

/** `2026-10-18` → `2026년 10월 18일` (확인서 주문 날짜, D-206) */
export function formatKoreanDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return `${String(year)}년 ${String(month)}월 ${String(day)}일`
}

interface KstParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

function kstParts(epochMs: number): KstParts {
  const shifted = new Date(Math.floor(epochMs / 1000) * 1000 + KST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/** UTC 밀리초가 문서에 쓸 수 있는 시각인가 (안전한 정수, 0000~9999년) */
export function isEpochMs(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false
  const year = new Date(value + KST_OFFSET_MS).getUTCFullYear()
  return year >= 1 && year <= 9999
}

/** 확인서 만든 시각: KST `2026년 10월 18일 23:30` (D-206) */
export function formatKstDateTime(epochMs: number): string {
  const p = kstParts(epochMs)
  return `${String(p.year)}년 ${String(p.month)}월 ${String(p.day)}일 ${pad2(p.hour)}:${pad2(p.minute)}`
}

/** 판매대장 찜 시각: KST `2026-10-19 20:00:03`, 분까지만이면 `2026-10-19 20:08` (D-208) */
export function formatKstLedgerTime(epochMs: number, minuteOnly: boolean): string {
  const p = kstParts(epochMs)
  const date = `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`
  return minuteOnly ? `${date} ${time}` : `${date} ${time}:${pad2(p.second)}`
}
