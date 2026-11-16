// 서버 읽기 입구의 순수 함수 (SRV1 약속 1, D-APP-22~24, APP-05 AC10·AC12): 판매자가 친 글 원문 → 읽은 값.
// 기기는 이 함수를 부르지 않는다 — 서버가 `POST /api/broadcasts/:id/read`·`POST /api/read`로 돌린 답만 보인다.
// 같은 함수를 쓰기 API(원문을 받는 등록·고치기·문자찜·정산 금액)도 쓴다 — 미리 보기 = 저장 값.
// 글·읽은 값은 저장·로그하지 않는다(호출하는 쪽도 남기지 않는다, AC-SRV1-03).
import { containsPhoneRun, formatWon, normalizePhone, parseAmount, phoneLast4 } from '@livejjim/core'
import { decideFixForm, decideQuickInput, editQuestion, fixPricePreview, previewNumber, registerPreviewText, type QuickDecision, type QuickSettings } from './quick.ts'
import { RECEIVED_INVALID, readReceived, receivedWords } from './received.ts'

export * from './quick.ts'
export * from './received.ts'

/** 읽을 수 있는 칸 (SRV1 약속 1) */
export const READ_KINDS = ['quick', 'fix', 'price', 'money', 'received', 'phone'] as const
export type ReadKind = (typeof READ_KINDS)[number]
/** 방송 설정(가격 단위·번호 한도)·상품이 있어야 읽는 칸 */
export const BROADCAST_READ_KINDS: readonly ReadKind[] = ['quick', 'fix', 'price']
/** 글 한 칸 한도 (SRV1 약속 1) */
export const READ_TEXT_MAX = 2000

/** 정산 금액 칸을 읽지 못했을 때 (웹 lib/money.ts와 같은 문장) */
export const AMOUNT_UNREADABLE = '금액을 14000처럼 적어 주세요.'

/** 전화번호 칸을 휴대폰 번호로 읽지 못했을 때 (웹 SmsPage와 같은 문장) */
export const PHONE_UNREADABLE = '휴대폰 번호로 읽지 못했어요. 고치거나 지워 주세요.'
/** 메모·사유 칸에 전화번호가 있을 때 (웹 SmsPage MEMO_HAS_PHONE·SettlementsPage PHONE_IN_TEXT, 서버 messages.ts PHONE_NUMBER_MESSAGE와 같은 문장) */
export const PHONE_IN_TEXT = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

/** 읽기에 쓰는 그 방송의 상품 (번호로 찾는다) */
export interface ReadProduct {
  readonly id: string
  readonly no: number
  readonly name: string
  /** null = 가격이 빈 확인 중 상품 (D-RECOG-22) */
  readonly price: number | null
  readonly closed: boolean
}

export interface ReadContext {
  /** 그 방송의 가격 단위·번호 한도 (방송 칸만) */
  readonly settings?: QuickSettings
  /** 그 방송의 번호 → 상품 (방송 칸만) */
  readonly findProduct?: (no: number) => ReadProduct | undefined
  /** 지금 (UTC 밀리초, 서버 시계) */
  readonly now: number
}

export type FixText = { readonly no: string; readonly name: string; readonly price: string }

/** 빠른 입력·고치기 칸의 읽은 결과 (응답 모양) */
export interface QuickRead {
  /** register 등록 · edit "고칠까요?" · open 상품 자세히 · fix 고치기 칸 · none 빈 줄 */
  readonly decision: 'none' | 'register' | 'edit' | 'open' | 'fix'
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  /** 가격 모양 "20,000원" (가격을 읽었을 때) */
  readonly priceWords: string | null
  /** edit·open: 그 번호의 상품 ID와 판매 종료 여부 */
  readonly productId: string | null
  readonly closed: boolean | null
  /** edit: "15번이 이미 있어요. 고칠까요?" */
  readonly question: string | null
  /** fix: 오류 코드·문장·커서 칸·칸 채우기 */
  readonly error: 'PRICE_MISSING' | 'PRICE_TOO_LOW' | 'NUMBER_MISSING' | 'NUMBER_INVALID' | null
  readonly message: string | null
  readonly focus: 'no' | 'name' | 'price' | null
  readonly noText: string | null
  readonly priceText: string | null
}

export function quickRead(decision: QuickDecision<ReadProduct>): QuickRead {
  const blank: QuickRead = { decision: decision.kind, no: null, name: null, price: null, priceWords: null, productId: null, closed: null, question: null, error: null, message: null, focus: null, noText: null, priceText: null }
  switch (decision.kind) {
    case 'none':
      return blank
    case 'register':
      return { ...blank, no: decision.no, name: decision.name, price: decision.price, priceWords: formatWon(decision.price) }
    case 'edit':
      return {
        ...blank,
        no: decision.no,
        name: decision.name,
        price: decision.price,
        priceWords: formatWon(decision.price),
        productId: decision.product.id,
        closed: decision.product.closed,
        question: editQuestion(decision.no, decision.product.closed),
      }
    case 'open':
      return { ...blank, no: decision.product.no, name: decision.product.name, productId: decision.product.id, closed: decision.product.closed }
    case 'fix':
      return {
        ...blank,
        no: decision.no,
        name: decision.name,
        error: decision.error,
        message: decision.message,
        focus: decision.focus,
        noText: decision.noText ?? null,
        priceText: decision.priceText ?? null,
      }
  }
}

export type ReadResult =
  | ({ readonly kind: 'quick'; readonly preview: string | null; readonly previewNo: number | null } & QuickRead)
  | ({ readonly kind: 'fix'; readonly pricePreview: string | null } & QuickRead)
  | { readonly kind: 'price'; readonly amount: number | null; readonly words: string | null; readonly preview: string | null }
  | { readonly kind: 'money'; readonly empty: boolean; readonly amount: number | null; readonly words: string | null; readonly message: string | null }
  | {
      readonly kind: 'received'
      readonly state: 'empty' | 'invalid' | 'ok'
      readonly value: string | null
      readonly minute: boolean | null
      readonly time: string | null
      readonly day: '어제' | '오늘' | '내일' | null
      readonly late: boolean | null
      readonly words: string | null
      readonly message: string | null
    }
  | { readonly kind: 'phone'; readonly empty: boolean; readonly valid: boolean; readonly last4: string | null; readonly hasPhone: boolean; readonly message: string | null }

const noProduct = (): undefined => undefined

/** 정산·설정 금액 칸 (원 단위 — 판매자 가격 단위를 쓰지 않는다, R-14·D-092) */
export function readMoney(text: string): { empty: boolean; amount: number | null } {
  if (text.trim() === '') return { empty: true, amount: null }
  return { empty: false, amount: parseAmount(text, { 'price.unit': 'WON' }) }
}

/**
 * 글 한 칸 읽기. 방송 칸(quick·fix·price)은 ctx.settings가 있어야 한다(없으면 코어 기본값으로 읽지 않고 호출하는 쪽이 막는다).
 * text: fix만 { no, name, price }, 나머지는 글 하나
 */
export function readText(kind: ReadKind, text: string | FixText, ctx: ReadContext): ReadResult {
  const settings = ctx.settings
  const find = ctx.findProduct ?? noProduct
  if (kind === 'fix') {
    const form = typeof text === 'string' ? { no: '', name: '', price: text } : text
    if (settings === undefined) throw new Error('방송 설정 없이 고치기 칸을 읽을 수 없다')
    return { kind, ...quickRead(decideFixForm(form, settings, find)), pricePreview: fixPricePreview(form.price, settings) }
  }
  const line = typeof text === 'string' ? text : ''
  switch (kind) {
    case 'quick': {
      if (settings === undefined) throw new Error('방송 설정 없이 빠른 입력을 읽을 수 없다')
      const decision = decideQuickInput(line, settings, find)
      return {
        kind,
        ...quickRead(decision),
        preview: decision.kind === 'register' ? registerPreviewText(decision.no, decision.name, decision.price) : null,
        previewNo: previewNumber(line, settings),
      }
    }
    case 'price': {
      if (settings === undefined) throw new Error('방송 설정 없이 가격 칸을 읽을 수 없다')
      const amount = line.trim() === '' ? null : parseAmount(line, settings)
      return { kind, amount, words: amount === null ? null : formatWon(amount), preview: line.trim() === '' ? null : fixPricePreview(line, settings) }
    }
    case 'money': {
      const read = readMoney(line)
      return { kind, empty: read.empty, amount: read.amount, words: read.amount === null ? null : formatWon(read.amount), message: !read.empty && read.amount === null ? AMOUNT_UNREADABLE : null }
    }
    case 'received': {
      const read = readReceived(line, ctx.now)
      if (read.kind !== 'ok') return { kind, state: read.kind, value: null, minute: null, time: null, day: null, late: null, words: null, message: read.kind === 'invalid' ? RECEIVED_INVALID : null }
      return { kind, state: 'ok', value: read.value, minute: read.minute, time: new Date(read.time).toISOString(), day: read.day, late: read.late, words: receivedWords(read), message: null }
    }
    case 'phone': {
      const empty = line.trim() === ''
      const normalized = empty ? null : normalizePhone(line)
      // 정리한 번호 자체는 돌려주지 않는다 — 뒤 4자리만 (AC-S06-13, 전화번호는 화면 상태에 남기지 않는다)
      return {
        kind,
        empty,
        valid: normalized !== null,
        last4: normalized === null ? null : phoneLast4(normalized),
        hasPhone: !empty && containsPhoneRun(line),
        message: !empty && normalized === null ? PHONE_UNREADABLE : null,
      }
    }
  }
}
