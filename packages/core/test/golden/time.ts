// 골든 시각 해석 (README "시각", D-022, D-026, NFR-07).
// Date·Intl을 쓰지 않고 정수 산술만으로 계산한다 → 실행 환경의 시간대와 무관하다.

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** 한국 표준시 오프셋(분). KST는 일광 절약 시간이 없다. */
export const KST_OFFSET_MINUTES = 9 * 60

export interface CivilDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** 1970-01-01부터의 일 수 (proleptic Gregorian, Howard Hinnant의 days_from_civil). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** daysFromCivil의 역함수. */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return { year, month, day }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const SHORT_AT_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
const ISO_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/
const RECEIVED_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

/** `YYYY-MM-DD` (실제 있는 날짜만). */
export function parseDate(text: string): CivilDate | undefined {
  const m = DATE_RE.exec(text)
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return undefined
  if (day < 1 || day > daysInMonth(year, month)) return undefined
  return { year, month, day }
}

function validClock(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59
}

/** 소수점 아래 1~3자리 = 밀리초 (`.1` = 100ms). */
function fractionToMs(fraction: string | undefined): number {
  if (fraction === undefined) return 0
  return Number(fraction.padEnd(3, '0'))
}

function civilToUtcMs(date: CivilDate, hour: number, minute: number, second: number, ms: number, offsetMinutes: number): number {
  return (
    daysFromCivil(date.year, date.month, date.day) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    ms -
    offsetMinutes * MS_PER_MINUTE
  )
}

export type AtForm = 'short' | 'iso'

export type AtResult =
  | { readonly ok: true; readonly utcMs: number; readonly form: AtForm }
  | { readonly ok: false; readonly reason: string }

/** 짧은 형식인지 (방송 날짜가 필요한지). 형식이 틀리면 false. */
export function isShortAt(text: string): boolean {
  return SHORT_AT_RE.test(text)
}

/**
 * `at`·`publishedAt` 해석.
 * - 짧은 형식 `HH:MM:SS[.f{1,3}]`: `baseDate`(방송 날짜)의 KST 시각
 * - ISO 8601 `YYYY-MM-DDTHH:MM:SS[.f{1,3}](Z|±HH:MM)`: 적힌 오프셋 그대로. 오프셋 없는 ISO는 오류
 */
export function resolveAt(text: string, baseDate: string | undefined): AtResult {
  const short = SHORT_AT_RE.exec(text)
  if (short) {
    const hour = Number(short[1])
    const minute = Number(short[2])
    const second = Number(short[3])
    if (!validClock(hour, minute, second)) return { ok: false, reason: `없는 시각 "${text}"` }
    if (baseDate === undefined) return { ok: false, reason: `짧은 시각 "${text}"의 기준 날짜가 없다` }
    const date = parseDate(baseDate)
    if (!date) return { ok: false, reason: `기준 날짜 "${baseDate}" 형식 오류` }
    return { ok: true, form: 'short', utcMs: civilToUtcMs(date, hour, minute, second, fractionToMs(short[4]), KST_OFFSET_MINUTES) }
  }
  const iso = ISO_AT_RE.exec(text)
  if (iso) {
    const date = parseDate(`${iso[1]}-${iso[2]}-${iso[3]}`)
    const hour = Number(iso[4])
    const minute = Number(iso[5])
    const second = Number(iso[6])
    if (!date || !validClock(hour, minute, second)) return { ok: false, reason: `없는 날짜·시각 "${text}"` }
    const zone = iso[8] ?? 'Z'
    let offsetMinutes = 0
    if (zone !== 'Z') {
      const sign = zone.startsWith('-') ? -1 : 1
      const offHour = Number(zone.slice(1, 3))
      const offMinute = Number(zone.slice(4, 6))
      if (offHour > 23 || offMinute > 59) return { ok: false, reason: `없는 오프셋 "${zone}"` }
      offsetMinutes = sign * (offHour * 60 + offMinute)
    }
    return { ok: true, form: 'iso', utcMs: civilToUtcMs(date, hour, minute, second, fractionToMs(iso[7]), offsetMinutes) }
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) {
    return { ok: false, reason: `오프셋 없는 ISO 시각 "${text}" (Z 또는 ±HH:MM 필요)` }
  }
  return { ok: false, reason: `시각 형식 오류 "${text}" (HH:MM:SS[.mmm] 또는 오프셋 포함 ISO 8601)` }
}

/** 문자 수신 시각 `HH:MM` 또는 `HH:MM:SS` (형식만 검사, 날짜 해석은 S03 코어 — D-023). */
export function isValidReceived(text: string): boolean {
  const m = RECEIVED_RE.exec(text)
  if (!m) return false
  return validClock(Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3]))
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** ECMAScript 날짜 문자열의 연도: 0~9999는 네 자리, 그 밖은 부호와 여섯 자리(확장 연도, `+010000`·`-000001`) */
function formatYear(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4)
  return `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`
}

/** UTC 밀리초 → `YYYY-MM-DDTHH:MM:SS.mmmZ` (Date 없이). `Date.prototype.toISOString`과 같은 모양(확장 연도 포함). */
export function formatUtcIso(utcMs: number): string {
  const days = Math.floor(utcMs / MS_PER_DAY)
  let rest = utcMs - days * MS_PER_DAY
  const { year, month, day } = civilFromDays(days)
  const hour = Math.floor(rest / MS_PER_HOUR)
  rest -= hour * MS_PER_HOUR
  const minute = Math.floor(rest / MS_PER_MINUTE)
  rest -= minute * MS_PER_MINUTE
  const second = Math.floor(rest / MS_PER_SECOND)
  const ms = rest - second * MS_PER_SECOND
  return `${formatYear(year)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(ms, 3)}Z`
}
