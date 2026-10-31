// 문자 보내기 규칙 (MESSAGE_RULES MR-1~MR-6, KP1 — D-KP1-16~D-KP1-20). 골든 `tests/golden/message/*.json`.
// 순수 함수 넷(바이트·글 만들기·보낼 수 있는 시각·수신 동의 상태)만 둔다. 시계·난수·DB·네트워크를 쓰지 않고,
// 실행 환경 시간대와 상관없이 같은 결과를 낸다(시각은 인자로 받은 오프셋 ISO를 직접 읽는다).
// 이 폴더에는 문자를 보내는 코드가 없다(MR-0 1 — 발송 스프린트가 이 규칙을 그대로 쓴다).
import { addDays, daysOfDate, DAY_MS, kstDateOf, kstIso, kstStartOf, parseOffsetIso } from '../deposit/calendar.ts'

/** MR-1 메시지 종류 */
export const MESSAGE_KINDS = ['RECEIPT_LINK', 'PAYMENT_DUE', 'SHIPPED', 'CONSENT_RESULT', 'CONSENT_NOTICE', 'BROADCAST_ALERT', 'FREE_TEXT'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** 광고성 종류 (MR-1·MR-0 2) — 나머지는 정보성 */
export const AD_KINDS: readonly MessageKind[] = ['BROADCAST_ALERT', 'FREE_TEXT']

export const isAdKind = (kind: MessageKind): boolean => AD_KINDS.includes(kind)

export const isMessageKind = (value: unknown): value is MessageKind => typeof value === 'string' && (MESSAGE_KINDS as readonly string[]).includes(value)

/** 한 건 값 (MR-5, 정수 원) */
export interface MessagePrice {
  readonly SMS: number
  readonly LMS: number
}

export const DEFAULT_MESSAGE_PRICE: MessagePrice = { SMS: 20, LMS: 50 }

/** SMS 상한 바이트 (MR-4) */
export const SMS_MAX_BYTES = 90
/** LMS 상한 바이트 (MR-4) */
export const LMS_MAX_BYTES = 2000

/** MR-6 수신 동의 문구 판 */
export const MR_CONSENT_1 = {
  id: 'MR-CONSENT-1',
  body: (shop: string): string =>
    `${shop}의 방송 알림(광고) 문자를 받을게요. 오전 8시~오후 9시 사이에만 보내요. 언제든 무료로 그만 받을 수 있어요. 번호는 그만 받을 때까지 보관하고, 2년마다 계속 받는지 알려 드려요.`,
} as const

/** MR-4 바이트: 코드 포인트마다 U+0000~U+007F면 1, 그 밖은 2 (다듬기·정규화 없음) */
export function messageBytes(text: string): number {
  let bytes = 0
  for (const char of text) bytes += (char.codePointAt(0) as number) <= 0x7f ? 1 : 2
  return bytes
}

export interface ComposeInput {
  readonly kind: MessageKind
  readonly shop: string
  readonly body: string
  readonly optOut: string
  readonly recipients: number
}

export type ComposeError = 'EMPTY' | 'NO_OPT_OUT' | 'OPT_OUT_INVALID' | 'TOO_LONG'

export type ComposeResult = { readonly text: string; readonly bytes: number; readonly type: 'SMS' | 'LMS'; readonly cost: number } | { readonly error: ComposeError }

/** MR-3 본문 다듬기: NFC, CRLF·CR → LF, 앞뒤 공백(\s) 지움 */
function cleanBody(body: string): string {
  return body.normalize('NFC').replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '')
}

/** MR-3 2: 수신거부 번호 읽기 (`-`·공백을 지운 숫자가 080 + 7~8자리) */
function readOptOut(optOut: string): { readonly digits: string } | { readonly error: 'NO_OPT_OUT' | 'OPT_OUT_INVALID' } {
  const digits = optOut.replace(/[-\s]/g, '')
  if (digits === '') return { error: 'NO_OPT_OUT' }
  if (!/^080\d{7,8}$/.test(digits)) return { error: 'OPT_OUT_INVALID' }
  return { digits }
}

/** MR-3·MR-4·MR-5 보낼 글 만들기. 오류 순서 EMPTY → NO_OPT_OUT·OPT_OUT_INVALID → TOO_LONG */
export function composeMessage(input: ComposeInput, price: MessagePrice = DEFAULT_MESSAGE_PRICE): ComposeResult {
  const body = cleanBody(input.body)
  if (body === '') return { error: 'EMPTY' }
  let text: string
  if (isAdKind(input.kind)) {
    const optOut = readOptOut(input.optOut)
    if ('error' in optOut) return { error: optOut.error }
    text = `(광고) ${input.shop}\n${body}\n무료수신거부 ${optOut.digits}`
  } else {
    text = `[${input.shop}] ${body}`
  }
  const bytes = messageBytes(text)
  if (bytes > LMS_MAX_BYTES) return { error: 'TOO_LONG' }
  const type = bytes <= SMS_MAX_BYTES ? 'SMS' : 'LMS'
  return { text, bytes, type, cost: price[type] * input.recipients }
}

export interface WindowInput {
  readonly kind: MessageKind
  /** 오프셋을 적은 ISO 8601 */
  readonly at: string
}

export type WindowResult = { readonly sendable: true } | { readonly sendable: false; readonly next: string }

const HOUR_MS = 3_600_000
/** 광고를 보낼 수 있는 KST 시각 [08:00, 21:00) */
const AD_OPEN_MS = 8 * HOUR_MS
const AD_CLOSE_MS = 21 * HOUR_MS

function parseAt(text: string, what: string): number {
  const ms = parseOffsetIso(text)
  if (ms === null) throw new RangeError(`${what}: 오프셋을 적은 ISO 시각이 아니다`)
  return ms
}

/** MR-2 지금 보내도 되는지. 광고성은 KST 08:00:00 이상 21:00:00 미만, 막히면 다음 08:00 KST */
export function canSendAt(input: WindowInput): WindowResult {
  const ms = parseAt(input.at, 'at')
  if (!isAdKind(input.kind)) return { sendable: true }
  const date = kstDateOf(ms)
  const dayStart = kstStartOf(date) as number
  const inDay = ms - dayStart
  if (inDay >= AD_OPEN_MS && inDay < AD_CLOSE_MS) return { sendable: true }
  const next = inDay < AD_OPEN_MS ? dayStart + AD_OPEN_MS : dayStart + DAY_MS + AD_OPEN_MS
  return { sendable: false, next: kstIso(next) }
}

export type ConsentRecordType = 'AGREE' | 'VERIFY' | 'WITHDRAW' | 'NOTICE'
export const CONSENT_RECORD_TYPES: readonly ConsentRecordType[] = ['AGREE', 'VERIFY', 'WITHDRAW', 'NOTICE']

export interface ConsentRecord {
  readonly type: ConsentRecordType
  /** 오프셋을 적은 ISO 8601 */
  readonly at: string
}

export type ConsentState = 'NONE' | 'PENDING' | 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED'

export interface ConsentResult {
  readonly status: ConsentState
  /** 기한 KST 날짜 (NONE·WITHDRAWN이면 null) */
  readonly due: string | null
}

/** 날짜 + 2년 (2월 29일이면 2월 28일) */
export function addTwoYears(date: string): string {
  const year = Number(date.slice(0, 4)) + 2
  const rest = date.slice(4)
  const shifted = `${String(year).padStart(4, '0')}${rest}`
  return daysOfDate(shifted) === null ? addDays(`${String(year).padStart(4, '0')}-03-01`, -1) : shifted
}

/**
 * MR-6 수신 동의 상태. 기록은 시각 순으로 다시 세운다(같은 시각이면 받은 순서).
 * AGREE가 없으면 NONE, 마지막 WITHDRAW가 마지막 AGREE보다 뒤면 WITHDRAWN.
 * 기준 날짜 = 마지막 AGREE와 그 뒤 마지막 NOTICE의 KST 날짜 중 늦은 날, 기한 = + 2년. 오늘(KST) ≥ 기한이면 EXPIRED.
 * 아니면 마지막 AGREE 뒤 VERIFY가 있으면 ACTIVE, 없으면 PENDING.
 */
export function consentStatus(input: { readonly now: string; readonly records: readonly ConsentRecord[] }): ConsentResult {
  const now = parseAt(input.now, 'now')
  const records = input.records
    .map((record, index) => ({ type: record.type, ms: parseAt(record.at, 'records.at'), index }))
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
  let agree = -1
  for (let i = 0; i < records.length; i += 1) if ((records[i] as { type: ConsentRecordType }).type === 'AGREE') agree = i
  if (agree < 0) return { status: 'NONE', due: null }
  const after = records.slice(agree + 1)
  if (after.some((record) => record.type === 'WITHDRAW')) return { status: 'WITHDRAWN', due: null }
  let baseMs = (records[agree] as { ms: number }).ms
  for (const record of after) if (record.type === 'NOTICE' && record.ms > baseMs) baseMs = record.ms
  const due = addTwoYears(kstDateOf(baseMs))
  if (kstDateOf(now) >= due) return { status: 'EXPIRED', due }
  return { status: after.some((record) => record.type === 'VERIFY') ? 'ACTIVE' : 'PENDING', due }
}
