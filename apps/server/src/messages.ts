// 입력 문제를 화면에 보여 줄 쉬운 한국어로 바꾼다 (AC-S04-22, UX-03).
// 코어 checkEvent의 문장은 개발 문장이고 받은 값이 들어 있을 수 있어 그대로 내보내지 않는다. 필드 이름만 쓰고 문장은 여기서 정한다.
import { containsPhoneNumber, type EventProblem } from '@livejjim/core'
import type { FieldProblem } from './errors.ts'

const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  type: '지원하지 않는 입력 종류예요.',
  b: '방송을 골라 주세요.',
  no: '상품 번호는 1 이상의 정수로 적어 주세요.',
  from: '값을 확인해 주세요.',
  to: '바꿀 번호는 1 이상의 정수로 적어 주세요.',
  name: '품종은 글자로 적어 주세요.',
  price: '가격은 0 이상의 정수(원)로 적어 주세요.',
  stock: '재고는 1 이상의 정수로 적어 주세요.',
  status: '상품 상태를 골라 주세요.',
  applyTo: '가격을 어디까지 바꿀지 골라 주세요.',
  received: "받은 시각은 '14:05'나 '14:05:30'처럼 적어 주세요.",
  memo: '메모는 글자로 적어 주세요.',
  buyer: '구매자를 골라 주세요.',
  into: '합칠 구매자를 골라 주세요.',
  replace: '교체할 1등을 골라 주세요.',
  replaceTo: '교체한 1등을 대기로 둘지 취소할지 골라 주세요.',
  reason: '사유를 적어 주세요.',
  decision: '충돌을 어떻게 처리할지 골라 주세요.',
  msg: '메시지를 골라 주세요.',
  date: "날짜는 '2026-10-18'처럼 적어 주세요.",
  mode: '배송비 방식을 골라 주세요.',
  amount: '금액은 정수(원)로 적어 주세요.',
  title: '제목은 글자로 적어 주세요.',
  settings: '판매 규칙 설정을 확인해 주세요.',
  phone: '전화번호는 글자로 적어 주세요.',
  requestId: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요.",
}

/** 문자찜 메모·ref의 휴대폰 번호 — 전화번호 칸이 있는 화면 */
const PHONE_IN_SMS_TEXT = '전화번호는 여기에 적을 수 없어요. 전화번호 칸에 적어 주세요.'
/** 그 밖의 판매자 글 칸(입금 메모·사유·방송 제목·상품 이름)의 휴대폰 번호 — 전화번호 칸이 없는 화면 */
const PHONE_IN_TEXT = '전화번호는 적을 수 없어요. 전화번호를 빼고 적어 주세요.'
/** 코어가 휴대폰 번호를 입력 오류로 거르는 판매자 글 칸 (containsPhoneNumber, D-073·DAT-06) */
const TEXT_FIELDS: ReadonlySet<string> = new Set(['memo', 'ref', 'reason', 'title', 'name'])
const DEFAULT_MESSAGE = '값을 확인해 주세요.'

/** 화면에 돌려줘도 되는 필드 이름인지 (받은 키가 번호·긴 글자이면 이름도 되돌려 보내지 않는다) */
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,40}(?:\.[A-Za-z][A-Za-z0-9_]{0,40}){0,2}$/

export function safeFieldName(name: string): string | null {
  return SAFE_FIELD.test(name) && !containsPhoneNumber(name) ? name : null
}

/**
 * 필드 하나의 쉬운 문장. 판매자 글 칸에 휴대폰 번호가 들어 있으면(코어 입력 오류와 같은 판단 — containsPhoneNumber)
 * 문자찜(type 'sms')은 전화번호 칸으로, 그 밖의 칸은 번호를 빼고 적도록 안내한다
 */
export function fieldMessage(field: string | null, value?: unknown, type?: unknown): string {
  if (field === null) return DEFAULT_MESSAGE
  if (typeof value === 'string' && TEXT_FIELDS.has(field) && containsPhoneNumber(value)) return type === 'sms' || field === 'ref' ? PHONE_IN_SMS_TEXT : PHONE_IN_TEXT
  return FIELD_MESSAGES[field] ?? DEFAULT_MESSAGE
}

/** 코어 입력 문제 → 쉬운 문제 (필드마다 하나). 설정 문제(`settings.<키>`)는 호출하는 쪽이 checkSettings 문장을 쓴다 */
export function easyProblems(problems: readonly EventProblem[], event: Readonly<Record<string, unknown>>): FieldProblem[] {
  const out: FieldProblem[] = []
  const seen = new Set<string>()
  for (const problem of problems) {
    const field = problem.field === null ? null : safeFieldName(problem.field)
    const key = field ?? '\u0000'
    if (seen.has(key)) continue
    seen.add(key)
    if (field !== null && field.startsWith('settings.')) {
      out.push({ field, message: FIELD_MESSAGES.settings ?? DEFAULT_MESSAGE })
      continue
    }
    out.push({ field, message: fieldMessage(field, field === null ? undefined : event[field], event.type) })
  }
  return out
}

/** 모르는 필드 문제 (필드 이름만 — 이름이 안전하지 않으면 이름도 빼고) */
export function unknownFieldProblems(fields: readonly string[]): FieldProblem[] {
  const named = new Set<string>()
  let anonymous = false
  for (const field of fields) {
    const safe = safeFieldName(field)
    if (safe === null) anonymous = true
    else named.add(safe)
  }
  const out: FieldProblem[] = [...named].map((field) => ({ field, message: '받을 수 없는 항목이에요.' }))
  if (anonymous) out.push({ field: null, message: '받을 수 없는 항목이 있어요.' })
  return out
}
