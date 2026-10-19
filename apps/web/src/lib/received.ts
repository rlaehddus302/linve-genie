// 문자찜 "받은 시각" 칸 읽기 (AC-S06-12, ORD-08 AC1, R-6 "문자 수신 시각의 날짜"(D-023), D-089, G-ENG-169).
// 날짜는 코어 resolveReceivedTime으로 정한다(지금 시각을 입력 시각으로 본다). 보내는 값은 `HH:MM` 또는 `HH:MM:SS`.
//   | 친 글자                         | 읽은 값                                                                        |
//   | `20:01` / `2001`                | 20:01 (분까지)                                                                 |
//   | `20:01:05` / `200105`           | 20:01:05                                                                       |
//   | `8:01` / `801` (오전·오후 없음, 앞자리 0 없음, 시 1~12) | 오전·오후 두 읽기 중 지금과의 거리가 짧은 쪽(같으면 이른 쪽) |
//   | `오후 8:01` / `오전 8:01`        | 20:01 / 08:01                                                                  |
//   | `08:01` / `00:30` / `13:05`     | 그대로 24시간 표기                                                             |
//   | `25:00`·`20:61`·`2:5`·그 밖     | 읽지 못함                                                                      |
import { resolveReceivedTime } from '@livejjim/core'
import { kstDate } from './kst.ts'

export type ReceivedDay = '어제' | '오늘' | '내일'

export type ReceivedRead =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'ok'
      /** 보내는 값 `HH:MM` 또는 `HH:MM:SS` */
      readonly value: string
      /** 분까지만 적었는가 */
      readonly minute: boolean
      /** 읽은 시각 (UTC 밀리초 — 분까지면 그 분의 시작) */
      readonly time: number
      readonly day: ReceivedDay
      /** 지금보다 늦다 (보내기 전에 묻는다) */
      readonly late: boolean
    }

export const RECEIVED_INVALID = '받은 시각을 20:01처럼 적어 주세요.'
export const RECEIVED_HELP = '비우면 지금 시각(초까지)으로 넣어요'

interface Clock {
  readonly hour: number
  readonly minute: number
  readonly second: number | null
  /** 오전·오후 없이 12시간 표기로 읽힐 수 있다 (앞자리 0 없음, 시 1~12) */
  readonly ambiguous: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')

function clockText(clock: Pick<Clock, 'hour' | 'minute' | 'second'>): string {
  return clock.second === null ? `${pad(clock.hour)}:${pad(clock.minute)}` : `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
}

/** 숫자·콜론 부분 → 시·분·초 (시 글자의 앞자리 0 여부도) */
function readBody(body: string): { hourText: string; minute: number; second: number | null } | null {
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(body)
  if (m !== null) return { hourText: m[1] as string, minute: Number(m[2]), second: m[3] === undefined ? null : Number(m[3]) }
  m = /^(\d{1,2})(\d{2})(\d{2})?$/.exec(body)
  if (m === null) return null
  // 숫자만: 3자리 HMM · 4자리 HHMM · 5자리 HMMSS · 6자리 HHMMSS
  const digits = body.length
  if (digits === 3 || digits === 5) {
    const hourText = body.slice(0, 1)
    return { hourText, minute: Number(body.slice(1, 3)), second: digits === 5 ? Number(body.slice(3, 5)) : null }
  }
  if (digits === 4 || digits === 6) return { hourText: body.slice(0, 2), minute: Number(body.slice(2, 4)), second: digits === 6 ? Number(body.slice(4, 6)) : null }
  return null
}

function readClock(text: string): Clock | null {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const m = /^(오전|오후)?\s?([\d:]+)$/.exec(trimmed)
  if (m === null) return null
  const half = m[1] ?? null
  const body = readBody(m[2] as string)
  if (body === null) return null
  const hour = Number(body.hourText)
  if (body.minute > 59 || (body.second !== null && body.second > 59)) return null
  if (half !== null) {
    if (hour > 12) return null
    const h24 = half === '오전' ? hour % 12 : (hour % 12) + 12
    return { hour: h24, minute: body.minute, second: body.second, ambiguous: false }
  }
  if (hour > 23) return null
  const ambiguous = !body.hourText.startsWith('0') && hour >= 1 && hour <= 12
  return { hour, minute: body.minute, second: body.second, ambiguous }
}

/** 칸 글자 → 읽은 수신 시각. now = 지금(UTC 밀리초) */
export function readReceived(text: string, now: number): ReceivedRead {
  if (text.trim() === '') return { kind: 'empty' }
  const clock = readClock(text)
  if (clock === null) return { kind: 'invalid' }
  const candidates = clock.ambiguous ? [clock.hour % 12, (clock.hour % 12) + 12] : [clock.hour]
  let best: { value: string; time: number; minute: boolean } | null = null
  for (const hour of candidates) {
    const value = clockText({ hour, minute: clock.minute, second: clock.second })
    const resolved = resolveReceivedTime(value, now)
    if (resolved === null) continue
    const distance = Math.abs(resolved.time - now)
    const bestDistance = best === null ? Number.POSITIVE_INFINITY : Math.abs(best.time - now)
    // 거리가 짧은 쪽, 같으면 이른 쪽
    if (best === null || distance < bestDistance || (distance === bestDistance && resolved.time < best.time)) best = { value, time: resolved.time, minute: resolved.minute }
  }
  if (best === null) return { kind: 'invalid' }
  const dayOffset = Math.round((Date.parse(`${kstDate(best.time)}T00:00:00Z`) - Date.parse(`${kstDate(now)}T00:00:00Z`)) / 86_400_000)
  const day: ReceivedDay = dayOffset < 0 ? '어제' : dayOffset > 0 ? '내일' : '오늘'
  return { kind: 'ok', value: best.value, minute: best.minute, time: best.time, day, late: best.time > now }
}

/** "오늘 20:01" */
export function receivedWords(read: Extract<ReceivedRead, { kind: 'ok' }>): string {
  return `${read.day} ${read.value}`
}
