// 시각·날짜 해석 (R-6 "문자 수신 시각의 날짜", D-023, D-024). Date·Intl 없이 정수 산술만 쓴다 → 실행 환경의 시간대와 무관하다.
// 서버·화면·골든 러너가 같은 함수를 쓴다(AC-S03-01·13).

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** KST = UTC+9, 일광 절약 시간 없음 */
const KST_OFFSET = 9 * HOUR

const RECEIVED_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface ReceivedTime {
  /** UTC 밀리초: 초까지 입력했으면 그 초 정각, 분까지면 그 분 구간의 시작 */
  readonly time: number
  /** 분 단위 수신 시각 (구간 [time, time + 1분)) */
  readonly minute: boolean
}

function parseReceived(text: string): { readonly clock: number; readonly minute: boolean } | null {
  const m = RECEIVED_RE.exec(text)
  if (m === null) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  const second = m[3] === undefined ? 0 : Number(m[3])
  if (hour > 23 || minute > 59 || second > 59) return null
  return { clock: hour * HOUR + minute * MINUTE + second * SECOND, minute: m[3] === undefined }
}

/** 문자 수신 시각 형식 `HH:MM` 또는 `HH:MM:SS` (00:00 ~ 23:59:59, 두 자리씩). `24:00`·`8:01`·`20:01:60`은 아니다 */
export function isValidReceivedTime(text: unknown): text is string {
  return typeof text === 'string' && parseReceived(text) !== null
}

/**
 * 문자 수신 시각 해석 (D-023): 입력 시각 at(KST)의 전날·당일·다음날 중 at에 가장 가까운 날짜의 그 시각.
 * 분 단위면 구간 시작(HH:MM:00)으로 거리를 재고, 거리가 같으면 늦은 날짜를 고른다.
 * 형식이 틀렸거나 at이 유한한 수가 아니면 null.
 */
export function resolveReceivedTime(received: string, at: number): ReceivedTime | null {
  const parsed = typeof received === 'string' ? parseReceived(received) : null
  if (parsed === null || !Number.isFinite(at)) return null
  const today = Math.floor((at + KST_OFFSET) / DAY)
  let best = Number.NaN
  for (const day of [today - 1, today, today + 1]) {
    const candidate = day * DAY + parsed.clock - KST_OFFSET
    // 같은 거리면 뒤(늦은 날짜)가 이긴다
    if (Number.isNaN(best) || Math.abs(candidate - at) <= Math.abs(best - at)) best = candidate
  }
  return { time: best, minute: parsed.minute }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/** 실제 있는 날짜 `YYYY-MM-DD` (정산 묶음 날짜) */
export function isValidDate(text: unknown): text is string {
  if (typeof text !== 'string') return false
  const m = DATE_RE.exec(text)
  if (m === null) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}
