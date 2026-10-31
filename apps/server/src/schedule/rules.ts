// 방송 일정 입력 검사 (SPEC SCH-01·SCH-02, KP1 AC-KP1-20). 순수 함수 — 시각은 인자로 받는다.
// - 일정: 날짜(KST)·시작 시각 HH:MM·제목(앞뒤 공백 뺀 1~40자)·한 줄 소개(0~100자). 제어 글자·휴대폰 번호 모양(R-1)은 받지 않는다.
//   시작 시각이 지금보다 앞이면 받지 않는다(가정 — 지난 일정은 공개 페이지에 나오지 않는다).
// - 공개 설정: 켜기(참/거짓)와 유튜브 채널 주소(https·youtube.com 호스트·200자 이하, 빈 글은 없음).
// - 받은 값은 오류 문장에 되돌려 넣지 않는다.
import { containsPhoneRun, isValidDate } from '@livejjim/core'
import { hasUnsafeText } from '../api-fields.ts'
import { kstToMs } from '../deposit/calendar.ts'
import type { FieldProblem } from '../errors.ts'
import { PHONE_NUMBER_MESSAGE } from '../messages.ts'

/** 다가오는 일정 상한 (SCH-01) */
export const SCHEDULE_MAX = 10
export const SCHEDULE_TITLE_MAX = 40
export const SCHEDULE_INTRO_MAX = 100
export const CHANNEL_URL_MAX = 200
const CHANNEL_HOSTS: ReadonlySet<string> = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])

export const SCHEDULE_MESSAGES = {
  title: '제목은 1~40자로 적어 주세요.',
  intro: '소개는 100자까지 적을 수 있어요.',
  when: '날짜와 시각을 확인해 주세요.',
  past: '지난 시각은 적을 수 없어요.',
  unsafe: '쓸 수 없는 글자가 있어요. 빼고 적어 주세요.',
  full: '다가오는 방송은 10개까지 적을 수 있어요.',
  channel: '유튜브 채널 주소를 확인해 주세요.',
  enabled: '방송 일정 공개를 다시 골라 주세요.',
  unknown: '받을 수 없는 항목이 있어요.',
  invalid: '입력한 내용을 확인해 주세요.',
} as const

export interface ScheduleItemInput {
  readonly date: string
  readonly time: string
  /** 앞뒤 공백을 뺀 제목 */
  readonly title: string
  /** 앞뒤 공백을 뺀 소개 */
  readonly intro: string
  /** 시작 시각 (UTC 밀리초) */
  readonly startsAt: number
}

export interface SchedulePageInput {
  readonly enabled: boolean
  readonly channelUrl: string | null
}

export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly unknown: boolean; readonly problems: readonly FieldProblem[] }

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const length = (text: string) => [...text].length

function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): FieldProblem[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ field: key.length > 40 || hasUnsafeText(key) ? 'body' : key, message: SCHEDULE_MESSAGES.unknown }))
}

/** 글 칸 하나 검사 (제어 글자 → 휴대폰 번호 모양 → 길이) */
function textProblem(value: unknown, min: number, max: number, lengthMessage: string): string | null {
  if (typeof value !== 'string') return lengthMessage
  const trimmed = value.trim()
  if (hasUnsafeText(trimmed)) return SCHEDULE_MESSAGES.unsafe
  if (containsPhoneRun(trimmed)) return PHONE_NUMBER_MESSAGE
  const size = length(trimmed)
  return size < min || size > max ? lengthMessage : null
}

/** 일정 하나 { date, time, title, intro } (모두 있어야 한다) */
export function checkScheduleItem(body: Record<string, unknown>, nowMs: number): Checked<ScheduleItemInput> {
  const extra = unknownKeys(body, ['date', 'time', 'title', 'intro'])
  if (extra.length > 0) return { ok: false, unknown: true, problems: extra }
  const problems: FieldProblem[] = []
  const { date, time, title, intro } = body
  const titleProblem = textProblem(title, 1, SCHEDULE_TITLE_MAX, SCHEDULE_MESSAGES.title)
  if (titleProblem !== null) problems.push({ field: 'title', message: titleProblem })
  const introProblem = textProblem(intro, 0, SCHEDULE_INTRO_MAX, SCHEDULE_MESSAGES.intro)
  if (introProblem !== null) problems.push({ field: 'intro', message: introProblem })
  let startsAt: number | null = null
  const match = typeof time === 'string' ? TIME_RE.exec(time) : null
  if (typeof date !== 'string' || !isValidDate(date)) problems.push({ field: 'date', message: SCHEDULE_MESSAGES.when })
  else if (match === null) problems.push({ field: 'time', message: SCHEDULE_MESSAGES.when })
  else {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number]
    startsAt = kstToMs(year, month, day, Number(match[1]), Number(match[2]), 0)
    if (startsAt < nowMs) problems.push({ field: 'time', message: SCHEDULE_MESSAGES.past })
  }
  if (problems.length > 0 || startsAt === null) return { ok: false, unknown: false, problems }
  return { ok: true, value: { date: date as string, time: time as string, title: (title as string).trim(), intro: (intro as string).trim(), startsAt } }
}

/** 유튜브 채널 주소 (빈 글·null은 없음). 틀리면 undefined */
export function readChannelUrl(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return null
  if (length(text) > CHANNEL_URL_MAX || hasUnsafeText(text) || /\s/.test(text)) return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || !CHANNEL_HOSTS.has(url.hostname) || url.username !== '' || url.password !== '' || url.port !== '') return undefined
  // 판매자가 적은 글 그대로 둔다(한글 채널 이름이 % 글로 바뀌지 않게) — 화면·페이지는 이스케이프해서 쓴다
  return text
}

/** 공개 설정 { enabled, channelUrl } (둘 다 있어야 한다) */
export function checkSchedulePage(body: Record<string, unknown>): Checked<SchedulePageInput> {
  const extra = unknownKeys(body, ['enabled', 'channelUrl'])
  if (extra.length > 0) return { ok: false, unknown: true, problems: extra }
  const problems: FieldProblem[] = []
  if (typeof body.enabled !== 'boolean') problems.push({ field: 'enabled', message: SCHEDULE_MESSAGES.enabled })
  const channelUrl = Object.hasOwn(body, 'channelUrl') ? readChannelUrl(body.channelUrl) : undefined
  if (channelUrl === undefined) problems.push({ field: 'channelUrl', message: SCHEDULE_MESSAGES.channel })
  if (problems.length > 0 || channelUrl === undefined) return { ok: false, unknown: false, problems }
  return { ok: true, value: { enabled: body.enabled as boolean, channelUrl } }
}
