// 입력 문제를 화면에 보여 줄 쉬운 한국어로 바꾼다 (AC-S04-22, UX-03).
// 코어 checkEvent의 문장은 개발 문장이고 받은 값이 들어 있을 수 있어 그대로 내보내지 않는다. 필드 이름만 쓰고 문장은 여기서 정한다.
import { containsPhoneRun, type EventProblem } from '@livejjim/core'
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

/** 판매자가 적는 칸(글 칸·ID 칸)의 휴대폰 번호 거절 안내 (R-1, D-079 ⑥, AC-S04-22) — 칸과 상관없이 같은 문장 */
export const PHONE_NUMBER_MESSAGE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'
/**
 * 번호를 뺀 뒤 무엇을 하면 되는지 (D-079 ⑥ 문장 뒤에 화면이 덧붙이는 안내, `problems[].hint`).
 * ID 칸은 글을 적는 칸이 아니라 고르는 칸이라 "빼고 적어 주세요"만으로는 할 일이 없다 — 번호 대신 무엇을 고를지 알린다
 */
const PHONE_ID_HINTS: Readonly<Record<string, string>> = {
  buyer: '전화번호 대신 구매자를 골라 주세요.',
  from: '전화번호 대신 구매자를 골라 주세요.',
  into: '전화번호 대신 합칠 구매자를 골라 주세요.',
  replace: '전화번호 대신 교체할 1등을 골라 주세요.',
  msg: '전화번호 대신 메시지를 골라 주세요.',
}
/** 문자찜 메모는 같은 화면에 전화번호 칸이 있다 */
const PHONE_SMS_MEMO_HINT = '전화번호는 전화번호 칸에 적어 주세요.'
const DEFAULT_MESSAGE = '값을 확인해 주세요.'

/** 화면에 돌려줘도 되는 필드 이름인지 (받은 키가 번호·긴 글자이면 이름도 되돌려 보내지 않는다) */
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,40}(?:\.[A-Za-z][A-Za-z0-9_]{0,40}){0,2}$/

export function safeFieldName(name: string): string | null {
  return SAFE_FIELD.test(name) && !containsPhoneRun(name) ? name : null
}

/** 필드 하나의 쉬운 문장 (휴대폰 번호 문제는 phoneProblem — 코어가 code로 알린 것만) */
export function fieldMessage(field: string | null): string {
  if (field === null) return DEFAULT_MESSAGE
  return FIELD_MESSAGES[field] ?? DEFAULT_MESSAGE
}

/**
 * 휴대폰 번호 문제의 쉬운 문제. 문장은 칸과 상관없이 D-079 ⑥이고, ID 칸·문자찜 메모는 다음에 할 일(hint)을 덧붙인다.
 * 값은 보지 않는다 — 번호인지는 코어 checkEvent가 정했다(AC-S04-22)
 */
function phoneProblem(field: string, type: unknown): FieldProblem {
  const hint = Object.hasOwn(PHONE_ID_HINTS, field) ? PHONE_ID_HINTS[field] : type === 'sms' && field === 'memo' ? PHONE_SMS_MEMO_HINT : undefined
  return hint === undefined ? { field, message: PHONE_NUMBER_MESSAGE } : { field, message: PHONE_NUMBER_MESSAGE, hint }
}

/** ID 칸(조회 검색값 포함 — 합치기 미리 보기의 from·into)의 휴대폰 번호 문제: D-079 ⑥ 문장과 그 칸의 다음 할 일. 값은 담지 않는다 */
export function phoneIdProblem(field: string): FieldProblem {
  return phoneProblem(field, null)
}

/**
 * 코어 입력 문제 → 쉬운 문제 (필드마다 하나). 휴대폰 번호 문제는 코어가 붙인 `code: 'PHONE_NUMBER'`로만 고른다(값을 다시 판단하지 않는다, AC-S04-22).
 * 설정 문제(`settings.<키>`)는 호출하는 쪽이 checkSettings 문장을 쓴다
 */
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
    if (problem.code === 'PHONE_NUMBER') {
      out.push(field === null ? { field: null, message: PHONE_NUMBER_MESSAGE } : phoneProblem(field, event.type))
      continue
    }
    out.push({ field, message: fieldMessage(field) })
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
