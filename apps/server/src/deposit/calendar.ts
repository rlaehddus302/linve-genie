// 입금 확인 순수 함수가 쓰는 날짜 계산 (DEPOSIT_RULES DP-1·DP-2·DP-4, AC-N3-05).
// 시계·실행 환경 시간대·Intl을 쓰지 않는다: 날짜는 그레고리력 일수(1970-01-01 = 0)로 직접 계산하고, KST는 UTC+9(서머타임 없음)로 더한다.

export const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/** 그레고리력 (연, 월 1~12, 일) → 1970-01-01부터의 일수 (H. Hinnant의 days_from_civil) */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146_097 + doe - 719_468
}

/** 1970-01-01부터의 일수 → (연, 월, 일) (civil_from_days) */
export function civilFromDays(days: number): readonly [number, number, number] {
  const z = days + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day]
}

/** 있는 날짜인지 (2월 30일·13월 아님) */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return false
  const [y, m, d] = civilFromDays(daysFromCivil(year, month, day))
  return y === year && m === month && d === day
}

/** `YYYY-MM-DD` */
export function dateText(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** `YYYY-MM-DD` → 일수 (형식이 틀리면 null) */
export function daysOfDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return isRealDate(year, month, day) ? daysFromCivil(year, month, day) : null
}

/** 일수 → `YYYY-MM-DD` */
export function dateOfDays(days: number): string {
  const [year, month, day] = civilFromDays(days)
  return dateText(year, month, day)
}

/** `YYYY-MM-DD`에 n일을 더한 날짜 (형식이 틀리면 그대로) */
export function addDays(date: string, n: number): string {
  const days = daysOfDate(date)
  return days === null ? date : dateOfDays(days + n)
}

/** UTC 밀리초 → KST 날짜 `YYYY-MM-DD` */
export function kstDateOf(ms: number): string {
  return dateOfDays(Math.floor((ms + KST_OFFSET_MS) / DAY_MS))
}

/** KST 날짜·시각 → UTC 밀리초 */
export function kstToMs(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  return daysFromCivil(year, month, day) * DAY_MS + hour * 3_600_000 + minute * 60_000 + second * 1000 - KST_OFFSET_MS
}

/** KST 날짜의 00:00:00 → UTC 밀리초 (형식이 틀리면 null) */
export function kstStartOf(date: string): number | null {
  const days = daysOfDate(date)
  return days === null ? null : days * DAY_MS - KST_OFFSET_MS
}

/** UTC 밀리초 → `YYYY-MM-DDTHH:MM:SS+09:00` */
export function kstIso(ms: number): string {
  const shifted = ms + KST_OFFSET_MS
  const days = Math.floor(shifted / DAY_MS)
  const rest = shifted - days * DAY_MS
  const [year, month, day] = civilFromDays(days)
  const hour = Math.floor(rest / 3_600_000)
  const minute = Math.floor((rest % 3_600_000) / 60_000)
  const second = Math.floor((rest % 60_000) / 1000)
  return `${dateText(year, month, day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+09:00`
}

/**
 * 오프셋을 적은 ISO 8601 시각(`2026-10-18T21:03:15+09:00`, `…Z`, 밀리초 선택) → UTC 밀리초. 형식이 틀리거나 없는 시각이면 null.
 * Date.parse를 쓰지 않는다(실행 환경과 상관없이 같은 결과)
 */
export function parseOffsetIso(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(text)
  if (match === null) return null
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((index) => Number(match[index]))
  if (!isRealDate(year as number, month as number, day as number) || (hour as number) > 23 || (minute as number) > 59 || (second as number) > 59) return null
  const millis = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  const zone = match[8] as string
  let offset = 0
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const zoneHour = Number(zone.slice(1, 3))
    const zoneMinute = Number(zone.slice(4, 6))
    if (zoneHour > 14 || zoneMinute > 59) return null
    offset = sign * (zoneHour * 3_600_000 + zoneMinute * 60_000)
  }
  return daysFromCivil(year as number, month as number, day as number) * DAY_MS + (hour as number) * 3_600_000 + (minute as number) * 60_000 + (second as number) * 1000 + millis - offset
}
