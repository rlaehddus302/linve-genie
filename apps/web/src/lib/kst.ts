// 한국 시각 표시 (NFR-07, D-026, AC-S05-21·70). 서버는 시각을 UTC ISO로 준다. 화면은 시간대를 'Asia/Seoul'로 정해 보이므로
// 실행 환경(브라우저·시험)의 시간대와 상관없이 같은 글자가 나온다.
export const KST_TIME_ZONE = 'Asia/Seoul'

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function parts(format: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of format.formatToParts(ms)) out[part.type] = part.value
  return out
}

function toMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

/** UTC 시각 → KST `HH:MM:SS`. 읽을 수 없는 값이면 빈 글자 */
export function kstTime(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(timeFormat, ms)
  return `${p.hour ?? '00'}:${p.minute ?? '00'}:${p.second ?? '00'}`
}

/** UTC 시각 → KST 날짜 `YYYY-MM-DD` */
export function kstDate(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(dateFormat, ms)
  return `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}`
}

/** 오늘 (KST) */
export function kstToday(now: number = Date.now()): string {
  return kstDate(now)
}

/** `YYYY-MM-DD` → `M월 D일` (방송 목록) */
export function dateWords(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return `${String(Number(m[2]))}월 ${String(Number(m[3]))}일`
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** `YYYY-MM-DD` → `10/18(토)` (요일은 그 날짜 자체로 — 시간대와 무관) */
export function dateWithWeekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${String(Number(m[2]))}/${String(Number(m[3]))}(${WEEKDAYS[day] ?? ''})`
}

/** `YYYY-MM-DD` → `2026년 10월 18일` (정산 묶음 이름) */
export function dateYear(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return `${String(Number(m[1]))}년 ${String(Number(m[2]))}월 ${String(Number(m[3]))}일`
}

/**
 * `YYYY-MM-DD` → `2026년 10월 18일(일)` — 날짜 고르기·방송 고르기는 늘 연도와 요일까지 (AC-S06b-22, D-101).
 * 범위 날짜는 이미 KST 날짜라 그 날짜 자체로 요일을 정한다(브라우저 시간대와 상관없다).
 */
export function dateLong(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${dateYear(date)}(${WEEKDAYS[day] ?? ''})`
}

/** 방송 이름 "1부 · 2026년 10월 18일(일)" (문자찜 화면의 방송 고르기·고른 방송, AC-S06b-22) */
export function broadcastWords(title: string, date: string): string {
  return `${title} · ${dateLong(date)}`
}

const shortFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIME_ZONE,
  hourCycle: 'h23',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** UTC 시각 → KST `10/18 21:00` (정산 기록의 "기록한 때") */
export function kstShort(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(shortFormat, ms)
  return `${String(Number(p.month ?? '0'))}/${String(Number(p.day ?? '0'))} ${p.hour ?? '00'}:${p.minute ?? '00'}`
}

const wordsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIME_ZONE,
  hourCycle: 'h23',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** 시·분(·초) → "오후 8:01" / "오후 8:31:05" (12시간, 0시는 오전 12시) */
function clockWords(hour: number, minute: string, second: string | null): string {
  const half = hour < 12 ? '오전' : '오후'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${half} ${String(h)}:${minute}${second === null ? '' : `:${second}`}`
}

/** UTC 시각 → KST "10월 25일 오후 8:01" (동의한 때·예정 시각·다시 채워지는 때) */
export function kstDateTimeWords(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(wordsFormat, ms)
  return `${String(Number(p.month ?? '0'))}월 ${String(Number(p.day ?? '0'))}일 ${clockWords(Number(p.hour ?? '0'), p.minute ?? '00', null)}`
}

/** UTC 시각 → KST "오후 8:31:05" (마지막 채팅) */
export function kstClockWords(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(wordsFormat, ms)
  return clockWords(Number(p.hour ?? '0'), p.minute ?? '00', p.second ?? '00')
}

/** UTC 시각 → KST "11월 25일 0시" (봉인 시각 — 분이 있으면 "0시 30분") */
export function kstHourWords(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(wordsFormat, ms)
  const minute = Number(p.minute ?? '0')
  return `${String(Number(p.month ?? '0'))}월 ${String(Number(p.day ?? '0'))}일 ${String(Number(p.hour ?? '0'))}시${minute === 0 ? '' : ` ${String(minute)}분`}`
}

const stampFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIME_ZONE,
  hourCycle: 'h23',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * 받은 시각에 날짜를 붙여 "10/18 20:01:05" (분까지만 적었으면 "10/18 20:01") — KST (AC-S06b-31, D-102).
 * 날짜는 엔진이 R-6(D-023)으로 정한 날(문자찜 찜의 순위 시각)이다: 00:01에 넣은 "23:59"는 전날.
 */
export function kstStamp(value: string | number, minute = false): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(stampFormat, ms)
  const clock = `${p.hour ?? '00'}:${p.minute ?? '00'}${minute ? '' : `:${p.second ?? '00'}`}`
  return `${String(Number(p.month ?? '0'))}/${String(Number(p.day ?? '0'))} ${clock}`
}

/** UTC 시각 → KST `HH:MM` (출력 이력 "20:01 휴대폰") */
export function kstHm(value: string | number): string {
  const time = kstTime(value)
  return time === '' ? '' : time.slice(0, 5)
}

const minuteFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * UTC 시각 → KST "2026년 10월 20일 (화) 04:00" (설정 화면의 백업 시각, I2 AC-I2-65). 읽을 수 없는 값이면 빈 글자.
 * 요일은 그 KST 날짜 자체로 정한다(브라우저 시간대와 상관없다).
 */
export function kstDateTimeLong(value: string | number): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return ''
  const p = parts(minuteFormat, ms)
  const date = `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}`
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return ''
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${dateYear(date)} (${WEEKDAYS[day] ?? ''}) ${p.hour ?? '00'}:${p.minute ?? '00'}`
}
