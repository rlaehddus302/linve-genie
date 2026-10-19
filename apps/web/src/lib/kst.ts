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

/** 방송 이름 "1부 · 10/18(토)" */
export function broadcastWords(title: string, date: string): string {
  return `${title} · ${dateWithWeekday(date)}`
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

/** UTC 시각 → KST `HH:MM` (출력 이력 "20:01 휴대폰") */
export function kstHm(value: string | number): string {
  const time = kstTime(value)
  return time === '' ? '' : time.slice(0, 5)
}
