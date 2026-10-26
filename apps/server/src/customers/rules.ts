// 설정 "손님 관리"·손님 메모 검사 (CRM1 D-CRM1-05·D-CRM1-08). 받은 값은 오류 응답·로그에 되돌려 보내지 않는다.
import { containsPhoneRun } from '@livejjim/core'
import { isPlainObject, own, ownKeys } from '../api-fields.ts'
import type { FieldProblem } from '../errors.ts'
import { PHONE_NUMBER_MESSAGE, unknownFieldProblems } from '../messages.ts'
import type { CustomerSettings } from './summary.ts'

export const CUSTOMER_SETTINGS_MESSAGES = {
  regularCount: '단골 횟수는 2~99번으로 적어 주세요.',
  regularAmount: '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.',
  waitDays: '입금 기다리는 날은 1~30일로 적어 주세요.',
} as const

export const MEMO_MAX = 200
export const MEMO_MESSAGES = {
  tooLong: '메모는 200자까지 적을 수 있어요.',
  phone: PHONE_NUMBER_MESSAGE,
  control: '메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요.',
  text: '메모는 글자로 보내 주세요.',
} as const
/** 전화번호 없는 문자 손님 (표지 없음 — 메모 칸 대신, D-CRM1-08) */
export const NO_MARKER_MEMO_MESSAGE = '전화번호 없는 문자 손님은 다른 날과 이어지지 않아 메모를 남길 수 없어요.'

type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly unknown: boolean; readonly problems: readonly FieldProblem[] }

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)

/** PUT /api/customer-settings 본문 { regularCount, regularAmount (정수 또는 null), waitDays } — 셋 다 적는다 */
export function checkCustomerSettings(body: unknown): Checked<CustomerSettings> {
  if (!isPlainObject(body)) return { ok: false, unknown: false, problems: [{ field: 'regularCount', message: CUSTOMER_SETTINGS_MESSAGES.regularCount }] }
  const extra = ownKeys(body).filter((key) => key !== 'regularCount' && key !== 'regularAmount' && key !== 'waitDays')
  if (extra.length > 0) return { ok: false, unknown: true, problems: unknownFieldProblems(extra) }
  const count = own(body, 'regularCount')
  const amount = own(body, 'regularAmount')
  const wait = own(body, 'waitDays')
  const problems: FieldProblem[] = []
  if (!isInt(count) || count < 2 || count > 99) problems.push({ field: 'regularCount', message: CUSTOMER_SETTINGS_MESSAGES.regularCount })
  if (amount !== null && (!isInt(amount) || amount < 1000 || amount > 100_000_000)) problems.push({ field: 'regularAmount', message: CUSTOMER_SETTINGS_MESSAGES.regularAmount })
  if (!isInt(wait) || wait < 1 || wait > 30) problems.push({ field: 'waitDays', message: CUSTOMER_SETTINGS_MESSAGES.waitDays })
  if (problems.length > 0) return { ok: false, unknown: false, problems }
  return { ok: true, value: { regularCount: count as number, regularAmount: amount as number | null, waitDays: wait as number } }
}

/** 줄 나눔(\n) 밖의 제어 글자·짝 없는 서로게이트 */
function hasBadChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x0a) continue
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true
  }
  return !text.isWellFormed()
}

/**
 * 메모 글 검사 (D-CRM1-08): 줄 나눔은 \n으로 맞춘 뒤 앞뒤 공백을 뺀다. 0~200글자(코드 포인트), 줄 나눔 밖 제어 글자 거절,
 * 휴대폰 번호 모양 거절(R-1·D-079 ⑥과 같은 검사·문장). 빈 글 = 지움
 */
export function checkMemo(body: unknown): Checked<string> {
  if (!isPlainObject(body)) return { ok: false, unknown: false, problems: [{ field: 'text', message: MEMO_MESSAGES.text }] }
  const extra = ownKeys(body).filter((key) => key !== 'text')
  if (extra.length > 0) return { ok: false, unknown: true, problems: unknownFieldProblems(extra) }
  const raw = own(body, 'text')
  if (typeof raw !== 'string') return { ok: false, unknown: false, problems: [{ field: 'text', message: MEMO_MESSAGES.text }] }
  const text = raw.replace(/\r\n?/g, '\n').trim()
  if (hasBadChar(text)) return { ok: false, unknown: false, problems: [{ field: 'text', message: MEMO_MESSAGES.control }] }
  if ([...text].length > MEMO_MAX) return { ok: false, unknown: false, problems: [{ field: 'text', message: MEMO_MESSAGES.tooLong }] }
  if (containsPhoneRun(text)) return { ok: false, unknown: false, problems: [{ field: 'text', message: MEMO_MESSAGES.phone }] }
  return { ok: true, value: text }
}
