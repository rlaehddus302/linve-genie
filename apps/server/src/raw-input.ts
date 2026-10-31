// 원문 쓰기 (SRV1 약속 2, D-APP-22·D-APP-24, APP-05 AC10·AC12): 기기는 판매자가 친 글 원문을 보내고 서버가 읽기 입구와 같은 함수로 읽어 엔진 필드를 만든다.
// - 빠른 입력 등록·고치기: product.register·product.update의 `text`(한 줄) 또는 고치기 칸 `noText`·`priceText`(+ 엔진 필드 `name`)
// - 문자찜: sms의 `noText`(번호 칸)·`receivedText`(받은 시각 칸). 전화번호(`phone`)·메모(`memo`)는 원래 원문이다
// - 정산 금액: settlement.payment·refund·adjust·shippingOverride의 `amountText`(원 단위), 할인·추가는 `amountSign`(PLUS·MINUS)
// 원문 필드는 엔진 필드가 아니다 — 이벤트에는 읽은 값만 들어가고, 원문은 이벤트·로그·오류 문장에 담지 않는다(받은 값은 되돌려 보내지 않는다).
// 기존 숫자 필드(no·price·received·amount)도 한 판 동안 함께 받는다(약속 2). 같은 칸을 원문과 숫자로 함께 보내면 400.
// 읽기는 기록 경로의 build 안(범위 락·최신 상태)에서 한다 — 그 방송 스냅샷의 price.unit·claim.maxNumber와 그때의 상품으로 읽는다.
import { getBroadcast, getProduct, parseAmount, type EngineState } from '@livejjim/core'
import {
  AMOUNT_UNREADABLE,
  RECEIVED_INVALID,
  READ_TEXT_MAX,
  decideFixForm,
  decideQuickInput,
  quickErrorMessage,
  quickRead,
  quickSettings,
  readMoney,
  readNumberField,
  readReceived,
  type QuickDecision,
  type ReadProduct,
} from '@livejjim/voice-session/read'
import { own } from './api-fields.ts'
import type { FieldProblem } from './errors.ts'
import type { Rejection } from './writer.ts'

/** 종류마다 받는 원문 필드 (API_EVENTS 허용 목록에 더한다 — 엔진 필드로 옮기지 않는다) */
export const RAW_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'product.register': ['text', 'noText', 'priceText'],
  'product.update': ['text', 'noText', 'priceText'],
  sms: ['noText', 'receivedText', 'receivedLateOk'],
  'settlement.payment': ['amountText'],
  'settlement.refund': ['amountText'],
  'settlement.adjust': ['amountText', 'amountSign'],
  'settlement.shippingOverride': ['amountText'],
}
/** 원문 필드 이름 전부 (엔진 필드로 옮기지 않는다) */
export const RAW_FIELD_NAMES: ReadonlySet<string> = new Set(Object.values(RAW_FIELDS).flat())

export interface RawInput {
  readonly text?: string
  readonly noText?: string
  readonly priceText?: string
  readonly receivedText?: string
  /** 받은 시각이 지금보다 늦어도 넣는다 — 판매자가 "이대로 넣을까요?"에 답한 뒤에만 true (REL1) */
  readonly receivedLateOk?: boolean
  readonly amountText?: string
  readonly amountSign?: 'PLUS' | 'MINUS'
}

const RAW_TEXT_MESSAGE = `글자로 ${String(READ_TEXT_MAX)}자까지 적어 주세요.`
const BOTH_MESSAGE = '같은 칸을 글과 숫자로 함께 보내지 않아요. 화면을 새로고침한 뒤 다시 해 주세요.'
const SMS_NO_EMPTY = '상품 번호를 적어 주세요.'

/** 받은 시각이 지금보다 늦어 확인이 필요하다 (기록하지 않는다 — 같은 요청에 receivedLateOk: true를 더해 다시 보내면 넣는다) */
const receivedLate = (value: string, day: string): Rejection => ({
  status: 409,
  code: 'RECEIVED_LATE',
  message: `받은 시각(${day} ${value})이 지금보다 늦어요. 이대로 넣을까요?`,
  problems: [{ field: 'receivedText', message: '받은 시각이 지금보다 늦어요.' }],
  extra: { received: { value, day } },
})

const invalid = (problems: readonly FieldProblem[]): Rejection => ({ status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems })

/** 원문 필드 모양 검사 (상태 없이). 없으면 raw null */
export function checkRawInput(type: string, body: Record<string, unknown>): { ok: true; raw: RawInput | null } | { ok: false; rejection: Rejection } {
  const names = RAW_FIELDS[type] ?? []
  const raw: Record<string, unknown> = {}
  const problems: FieldProblem[] = []
  for (const name of names) {
    const value = own(body, name)
    if (value === undefined) continue
    if (name === 'amountSign') {
      if (value !== 'PLUS' && value !== 'MINUS') problems.push({ field: name, message: '더하기인지 빼기인지 골라 주세요.' })
      else raw[name] = value
      continue
    }
    if (name === 'receivedLateOk') {
      if (typeof value !== 'boolean') problems.push({ field: name, message: '입력한 내용을 확인해 주세요.' })
      else if (value) raw[name] = true
      continue
    }
    if (typeof value !== 'string' || value.length > READ_TEXT_MAX || !value.isWellFormed()) problems.push({ field: name, message: RAW_TEXT_MESSAGE })
    else raw[name] = value
  }
  if (problems.length > 0) return { ok: false, rejection: invalid(problems) }
  if (Object.keys(raw).length === 0) return { ok: true, raw: null }
  const has = (key: string) => own(body, key) !== undefined
  const both: FieldProblem[] = []
  if (raw.text !== undefined) {
    for (const key of ['no', 'price', 'noText', 'priceText']) if (has(key)) both.push({ field: key, message: BOTH_MESSAGE })
    // 한 줄 원문은 품종도 읽는다 — 품종 칸을 따로 보내지 않는다
    if (has('name')) both.push({ field: 'name', message: BOTH_MESSAGE })
  }
  if (raw.noText !== undefined && has('no')) both.push({ field: 'no', message: BOTH_MESSAGE })
  if (raw.priceText !== undefined && has('price')) both.push({ field: 'price', message: BOTH_MESSAGE })
  // 고치기 칸은 번호·가격 칸을 함께 보낸다
  if (type.startsWith('product.') && (raw.noText === undefined) !== (raw.priceText === undefined)) both.push({ field: raw.noText === undefined ? 'noText' : 'priceText', message: '번호 칸과 가격 칸을 함께 보내 주세요.' })
  if (raw.receivedText !== undefined && has('received')) both.push({ field: 'received', message: BOTH_MESSAGE })
  if (raw.amountText !== undefined && has('amount')) both.push({ field: 'amount', message: BOTH_MESSAGE })
  if (raw.amountSign !== undefined && raw.amountText === undefined) both.push({ field: 'amountSign', message: '금액 칸과 함께 보내 주세요.' })
  if (both.length > 0) return { ok: false, rejection: invalid(both) }
  return { ok: true, raw: raw as RawInput }
}

/** 그 방송의 번호 → 읽기용 상품 (판매 종료한 상품도 있는 것으로 본다 — 웹 빠른 입력과 같다) */
export function readProductOf(state: EngineState, b: string): (no: number) => ReadProduct | undefined {
  return (no) => {
    const product = getProduct(state, b, no)
    return product === null ? undefined : { id: product.id, no: product.no, name: product.name, price: product.price, closed: product.status === 'CLOSED' }
  }
}

/** 문자찜 번호가 그 방송의 번호 한도 안인지 (claim.maxNumber — 코어 입력 검사는 1 이상만 본다). 밖이면 문장 */
export function smsNumberProblem(state: EngineState, b: unknown, no: unknown, field: 'no' | 'noText'): Rejection | null {
  if (typeof b !== 'string' || typeof no !== 'number' || !Number.isSafeInteger(no) || no < 1) return null
  const settings = getBroadcast(state, b)?.settings
  if (settings === undefined) return null
  const max = settings['claim.maxNumber']
  return no > max ? invalid([{ field, message: quickErrorMessage('NUMBER_INVALID', max) }]) : null
}

// 등록하려던 번호의 상품이 이미 있으면(다른 기기가 먼저 등록 등) 거절하지 않고 읽은 번호·가격으로 기록한다 — 엔진은 이미 있는 번호를
// 바꾸지 않고 changed:false로 답한다(D-MOB2-14 (2), 입력 우선 기록). 화면은 그 답으로 "고칠까요?"를 묻거나, 저절로 다시 보낸 줄이면 한 줄로 알린다

function quickRejection(decision: QuickDecision<ReadProduct>): Rejection | null {
  switch (decision.kind) {
    case 'register':
    case 'edit':
      return null
    case 'none':
      return invalid([{ field: 'text', message: quickErrorMessage('NUMBER_MISSING', 0) }])
    case 'open':
      return { status: 409, code: 'QUICK_OPEN', message: `${String(decision.product.no)}번 상품이 이미 있어요.`, problems: [], extra: { read: quickRead(decision) } }
    case 'fix':
      return { status: 400, code: 'QUICK_FIX', message: decision.message, problems: [{ field: 'text', message: decision.message }], extra: { read: quickRead(decision) } }
  }
}

/**
 * 원문 → 엔진 필드 (기록 경로 build 안 — 그 범위의 지금 상태). fields는 이미 옮긴 엔진 필드(원문 필드 없음).
 * 읽지 못하면 그 칸의 지금 문장으로 거절(기록하지 않는다)
 */
export function applyRawInput(type: string, raw: RawInput, fields: Readonly<Record<string, unknown>>, state: EngineState, now: number): { fields: Record<string, unknown> } | { rejection: Rejection } {
  // 읽은 엔진 필드에는 늘 type이 있고, 거절에는 없다
  const read = readRawInput(type, raw, { ...fields, type }, state, now)
  return 'type' in read ? { fields: read } : { rejection: read as Rejection }
}

function readRawInput(type: string, raw: RawInput, fields: Readonly<Record<string, unknown>>, state: EngineState, now: number): Record<string, unknown> | Rejection {
  const out: Record<string, unknown> = { ...fields }
  const b = typeof fields.b === 'string' ? fields.b : null
  const settings = b === null ? undefined : getBroadcast(state, b)?.settings
  if (type === 'product.register' || type === 'product.update') {
    if (b === null || settings === undefined) return invalid([{ field: 'b', message: '방송을 골라 주세요.' }])
    const quick = quickSettings(settings)
    const find = readProductOf(state, b)
    if (raw.text !== undefined) {
      const decision = decideQuickInput(raw.text, quick, find)
      const refused = quickRejection(decision)
      if (refused !== null) return refused
      if (decision.kind !== 'register' && decision.kind !== 'edit') return invalid([{ field: 'text', message: quickErrorMessage('NUMBER_MISSING', 0) }])
      out.no = decision.no
      out.price = decision.price
      // 고치기: 친 줄에 품종이 없으면(`15 12000`) 품종은 그대로 둔다 — 가격만 고치려던 줄이 품종을 지우지 않게 (웹 changedFields와 같다)
      // 고치기에서 품종이 지금 그대로면 넣지 않는다 — 바뀐 칸만 고친다 (AC-S05-13)
      const sameName = decision.kind === 'edit' && decision.name === decision.product.name
      if (type === 'product.register' || (decision.name !== '' && !sameName)) out.name = decision.name
      return out
    }
    if (raw.noText !== undefined && raw.priceText !== undefined) {
      const name = typeof fields.name === 'string' ? fields.name : ''
      const decision = decideFixForm({ no: raw.noText, name, price: raw.priceText }, quick, find)
      if (decision.kind === 'fix') {
        const field = decision.focus === 'price' ? 'priceText' : 'noText'
        return { status: 400, code: 'QUICK_FIX', message: decision.message, problems: [{ field, message: decision.message }], extra: { read: quickRead(decision) } }
      }
      if (decision.kind !== 'register' && decision.kind !== 'edit') return invalid([{ field: 'noText', message: quickErrorMessage('NUMBER_MISSING', 0) }])
      out.no = decision.no
      out.price = decision.price
      return out
    }
    return out
  }
  if (type === 'sms') {
    if (raw.noText !== undefined) {
      if (b === null || settings === undefined) return invalid([{ field: 'b', message: '방송을 골라 주세요.' }])
      const quick = quickSettings(settings)
      const no = readNumberField(raw.noText, quick)
      if (no === 'empty') return invalid([{ field: 'noText', message: SMS_NO_EMPTY }])
      if (no === null) return invalid([{ field: 'noText', message: quickErrorMessage('NUMBER_INVALID', quick['claim.maxNumber']) }])
      out.no = no
    }
    if (raw.receivedText !== undefined) {
      const read = readReceived(raw.receivedText, now)
      if (read.kind === 'invalid') return invalid([{ field: 'receivedText', message: RECEIVED_INVALID }])
      // 지금(서버 시계)보다 늦은 받은 시각은 판매자가 확인한 뒤에만 넣는다 — 화면이 미리 읽지 못하고 보냈어도 서버가 스스로 막는다 (REL1, SPEC S06 "지금보다 늦어요")
      if (read.kind === 'ok' && read.late && raw.receivedLateOk !== true) return receivedLate(read.value, read.day)
      // 비우면 서버 도착 시각(초까지) — 받은 시각 필드를 넣지 않는다
      if (read.kind === 'ok') out.received = read.value
    }
    return out
  }
  if (type.startsWith('settlement.') && raw.amountText !== undefined) {
    const read = readMoney(raw.amountText)
    if (read.amount === null) return invalid([{ field: 'amountText', message: AMOUNT_UNREADABLE }])
    out.amount = raw.amountSign === 'MINUS' ? -read.amount : read.amount
    return out
  }
  return out
}

/** 설정 금액 칸 (shipping.baseFee·shipping.freeThreshold): 글이면 원 단위로 읽는다(웹 settings-fields와 같다). 읽지 못하면 글 그대로 — 코어 설정 검사 문장을 받는다 */
export const MONEY_SETTING_KEYS: readonly string[] = ['shipping.baseFee', 'shipping.freeThreshold']

export function readMoneySetting(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > READ_TEXT_MAX) return value
  const text = value.trim()
  if (text === '') return value
  const compact = text.replace(/,/g, '')
  if (/^[-+]?\d+(\.\d+)?$/.test(compact)) return Number(compact)
  return parseAmount(text, { 'price.unit': 'WON' }) ?? value
}
