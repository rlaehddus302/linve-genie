// 표시용 포맷 (R-13 "감사 문구", D-044). 실행 환경의 언어·시간대 설정과 무관한 순수 함수다(Intl·toLocaleString 금지, D-024).

/**
 * 정수 원을 세 자리마다 쉼표로 끊고 `원`을 붙인다: `800원`, `10,000원`, `1,000,000원`.
 * 음수는 앞에 `-`를 붙인다(조정 항목 표시용). 안전한 정수가 아니면 RangeError — 금액은 정수 원이다(CLAUDE.md 규칙 2).
 */
export function formatWon(amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`금액은 안전한 정수 원이어야 한다 (값: ${String(amount)})`)
  const digits = String(Math.abs(amount))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return `${amount < 0 ? '-' : ''}${out}원`
}

export interface ThanksTextInput {
  /** 상품 번호 */
  readonly no: number
  /** 품종. 앞뒤 공백은 뺀다. 비어 있으면 품종과 그 뒤 공백을 뺀다 */
  readonly name: string
  /** 가격 스냅샷 (정수 원) */
  readonly price: number
  /** 확정되는 순간의 구매자 표시 이름 */
  readonly buyerName: string
  /** 옵션 글 (`흰색/대형` — 옵션을 가진 찜만, R-19 "표시"). 없거나 null이면 넣지 않는다 */
  readonly optionText?: string | null
  /** 수량 (기본 1). 2 이상일 때만 `{수량}개`를 넣고, 금액은 가격 × 수량이다 */
  readonly qty?: number
}

/** 감사 문구에서 구매자 이름 앞까지 들어가는 값 (번호·품종·옵션 글·수량·가격) */
export type ThanksHeadInput = Omit<ThanksTextInput, 'buyerName'>

/**
 * 감사 문구의 앞머리 — 구매자 이름 바로 앞까지(끝에 공백 하나): `{번호}번 {품종}[ {옵션 글}][ {수량}개] {찜 금액} `.
 * 전체 문구 = 앞머리 + `{구매자}님 구매 감사합니다`. 아직 게시되지 않은 감사 문구를 품종·가격 고침에 맞춰 다시 만들 때
 * 이름과 끝말은 글자 그대로 두고 앞머리만 바꾸는 데 쓴다 (R-13, D-RETRO-02).
 */
export function formatThanksHead({ no, name, price, optionText = null, qty = 1 }: ThanksHeadInput): string {
  if (!Number.isSafeInteger(qty) || qty < 1) throw new RangeError(`수량은 1 이상 정수여야 한다 (값: ${String(qty)})`)
  const variety = name.trim()
  return [
    `${String(no)}번`,
    ...(variety === '' ? [] : [variety]),
    ...(optionText === null || optionText === '' ? [] : [optionText]),
    ...(qty >= 2 ? [`${String(qty)}개`] : []),
    formatWon(price * qty),
    '',
  ].join(' ')
}

/**
 * 감사 문구 `{번호}번 {품종}[ {옵션 글}][ {수량}개] {찜 금액} {구매자}님 구매 감사합니다` (R-13, R-19 "표시", YT-04).
 * 옵션 글은 있을 때만, 수량은 2 이상일 때만 넣는다 — 옵션 없는 수량 1 찜은 `{번호}번 {품종} {가격} {구매자}님 구매 감사합니다` 그대로다.
 * 찜 금액 = 가격 × 수량 (정수 곱). 두 대상(LIVE_CHAT·VIDEO_COMMENT)의 문구는 같다. 글자 수 제한은 게시하는 쪽(S11)이 다룬다.
 */
export function formatThanksText({ buyerName, ...head }: ThanksTextInput): string {
  return `${formatThanksHead(head)}${buyerName}님 구매 감사합니다`
}

/** 한글 닉네임 뒤의 영문·영숫자 꼬리만 줄인다. 구매자 식별에는 원문을 쓴다. */
export function displayNickname(name: string, hideSuffix: boolean): string {
  if (!hideSuffix || !/[가-힣]/u.test(name)) return name
  const suffix = /(?:[\s_-]+(?=[a-zA-Z0-9]*[a-zA-Z])[a-zA-Z0-9]+|[a-zA-Z][a-zA-Z0-9]*)\s*$/u
  return name.replace(suffix, '')
}

/** 품종명이 "5개" 또는 "5개 세트"인 상품의 한 세트당 낱개 수 */
export function saleSetSize(name: string): number | null {
  const match = /^([1-9]\d{0,3})\s*개(?:\s*세트)?$/u.exec(name.trim())
  return match ? Number(match[1]) : null
}

/**
 * 품종과 개수를 한 줄로 (D-PIECES-01): 개수가 2 이상이면 품종 뒤에 "3개"를 붙인다 — `채홍 3개`. 개수 1·없음은 품종 그대로.
 * 품종이 비었으면 개수만(`3개`). 앞뒤 빈칸은 뗀다. 금액과 상관없다(가격은 묶음 하나의 값).
 */
export function productTitle(name: string, pieces?: number | null): string {
  const base = name.trim()
  if (pieces === undefined || pieces === null || !Number.isSafeInteger(pieces) || pieces <= 1) return base
  return base === '' ? `${String(pieces)}개` : `${base} ${String(pieces)}개`
}

/**
 * 판매자가 품종 칸에 "채홍 3개"처럼 개수까지 적은 것을 나눈다 (D-PIECES-01): 끝의 "<2~99>개"를 떼어 개수로.
 * 개수만 적은 것("5개", "5개 세트" — 세트 상품 이름, saleSetSize)과 개수가 없는 것은 그대로 (pieces null).
 */
export function splitPieces(text: string): { readonly name: string; readonly pieces: number | null } {
  const trimmed = text.trim()
  const match = /^(.*\S)\s+([1-9]\d?)\s*개$/u.exec(trimmed)
  if (match === null || Number(match[2]) < 2) return { name: trimmed, pieces: null }
  return { name: (match[1] ?? '').trim(), pieces: Number(match[2]) }
}

/**
 * 한 상품의 낱개 수 (방송 판매 수량): 개수 칸(2 이상)이 있으면 그 값, 아니면 세트 이름("5개 세트")의 낱개 수, 둘 다 없으면 1 (D-PIECES-01)
 */
export function piecesPerSale(product: { readonly name: string; readonly pieces?: number }): number {
  return product.pieces ?? saleSetSize(product.name) ?? 1
}

// 찜 감사 채팅 양식 (D-THANKS-FMT-01, 사용자 지시 2026-11-23 "찜 감사 채팅 양식 … 블록 코딩 느낌으로 커스텀 … 번호, 품명, 가격, 닉네임 블록"):
// 판매자가 감사 채팅 글의 모양을 블록으로 정한다. 블록은 번호(`15번`) · 품명(`핑크프릴[ 흰색/대형][ 2개]`) · 가격(`10,000원`) · 닉네임(`홍길동님`) · 글자.
// 블록 사이는 빈칸 하나로 잇는다(빈 블록은 빠진다). 기본 양식은 엔진 감사 문구(formatThanksText)와 글자까지 같다:
//   [번호] [품명] [가격] [닉네임] "구매 감사합니다" → `15번 핑크프릴 10,000원 홍길동님 구매 감사합니다`.
// 순수 함수(앱도 이 파일만 가져온다 — APP-01 AC3) — 엔진 문구(기록·재생·정정 비교)는 늘 기본 모양이고, 글을 올리는 쪽(서버 발송함)만 이 양식으로 바꿔 올린다.
export type ThanksBlock =
  | { readonly k: 'no' }
  | { readonly k: 'name' }
  | { readonly k: 'price' }
  | { readonly k: 'buyer' }
  | { readonly k: 'text'; readonly t: string }

export type ThanksTemplate = readonly ThanksBlock[]
export type ThanksValueKind = Exclude<ThanksBlock['k'], 'text'>

/** 블록 이름 (화면 글) */
export const THANKS_BLOCK_WORD: Readonly<Record<ThanksValueKind, string>> = { no: '번호', name: '품명', price: '가격', buyer: '닉네임' }
/** 꼭 있어야 하는 블록 — 손님이 어느 찜이 누구에게 갔는지 알아야 한다(분쟁) */
export const THANKS_REQUIRED: readonly ThanksValueKind[] = ['no', 'buyer']
/** 글자 블록 하나의 길이 (코드 포인트) */
export const THANKS_TEXT_BLOCK_MAX = 30
/** 블록 수 상한 */
export const THANKS_BLOCKS_MAX = 12

export const DEFAULT_THANKS_TEMPLATE: ThanksTemplate = Object.freeze([
  { k: 'no' },
  { k: 'name' },
  { k: 'price' },
  { k: 'buyer' },
  { k: 'text', t: '구매 감사합니다' },
] as const)

export interface ThanksValues {
  readonly no: number
  /** 품종 (앞뒤 공백은 뺀다) */
  readonly name: string
  /** 단가 (정수 원) */
  readonly price: number
  readonly buyerName: string
  readonly optionText?: string | null
  readonly qty?: number
}

/** 블록 하나의 글 (빈 글이면 빠진다) */
function piece(block: ThanksBlock, values: ThanksValues): string {
  const qty = values.qty ?? 1
  switch (block.k) {
    case 'no':
      return `${String(values.no)}번`
    case 'name':
      return [values.name.trim(), values.optionText ?? '', qty >= 2 ? `${String(qty)}개` : ''].filter((part) => part !== '').join(' ')
    case 'price':
      return formatWon(values.price * qty)
    case 'buyer':
      return `${values.buyerName}님`
    case 'text':
      return block.t.trim()
  }
}

/** 양식대로 감사 글을 만든다. 기본 양식이면 formatThanksText와 같다 */
export function renderThanks(template: ThanksTemplate, values: ThanksValues): string {
  const qty = values.qty ?? 1
  if (!Number.isSafeInteger(qty) || qty < 1) throw new RangeError(`수량은 1 이상 정수여야 한다 (값: ${String(qty)})`)
  return template.map((block) => piece(block, values)).filter((text) => text !== '').join(' ')
}

/** 두 양식이 같은가 */
export function sameThanksTemplate(a: ThanksTemplate, b: ThanksTemplate): boolean {
  return a.length === b.length && a.every((block, index) => {
    const other = b[index]
    if (other === undefined || other.k !== block.k) return false
    return block.k !== 'text' || (other.k === 'text' && other.t.trim() === block.t.trim())
  })
}

export function isDefaultThanksTemplate(template: ThanksTemplate): boolean {
  return sameThanksTemplate(template, DEFAULT_THANKS_TEMPLATE)
}

/**
 * 여러 감사를 한 글로 묶을 때의 끝말: 양식의 마지막 블록이 글자면 ` {그 글자}`(묶음은 앞 항목들을 `, `로 잇고 끝말 한 번), 아니면 빈 글(끝말 없이 잇는다).
 * 기본 양식은 ` 구매 감사합니다`(texts.ts THANKS_SUFFIX와 같다)
 */
export function thanksTemplateSuffix(template: ThanksTemplate): string {
  const last = template.at(-1)
  return last?.k === 'text' && last.t.trim() !== '' ? ` ${last.t.trim()}` : ''
}

/** 양식 검사 — 문제가 없으면 null, 있으면 판매자에게 보일 쉬운 문장 */
export function checkThanksTemplate(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return '양식을 만들어 주세요.'
  if (value.length > THANKS_BLOCKS_MAX) return `블록은 ${String(THANKS_BLOCKS_MAX)}개까지 넣을 수 있어요.`
  const seen = new Set<string>()
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '알 수 없는 블록이 있어요.'
    const block = raw as Record<string, unknown>
    const keys = Object.keys(block)
    if (block.k === 'text') {
      if (keys.some((key) => key !== 'k' && key !== 't') || typeof block.t !== 'string') return '알 수 없는 블록이 있어요.'
      if ([...block.t].length > THANKS_TEXT_BLOCK_MAX) return `글자 블록은 ${String(THANKS_TEXT_BLOCK_MAX)}자까지 적을 수 있어요.`
      if (/[\n\r]/u.test(block.t)) return '글자 블록에는 줄을 바꿀 수 없어요.'
      continue
    }
    if (block.k !== 'no' && block.k !== 'name' && block.k !== 'price' && block.k !== 'buyer') return '알 수 없는 블록이 있어요.'
    if (keys.some((key) => key !== 'k')) return '알 수 없는 블록이 있어요.'
    if (seen.has(block.k)) return `${THANKS_BLOCK_WORD[block.k]} 블록은 한 번만 넣을 수 있어요.`
    seen.add(block.k)
  }
  for (const kind of THANKS_REQUIRED) if (!seen.has(kind)) return `${THANKS_BLOCK_WORD[kind]} 블록은 꼭 있어야 해요.`
  return null
}

/** 저장된 글(JSON)을 양식으로 — 비었거나 깨졌거나 맞지 않으면 기본 양식 (판매자 안전: 감사는 늘 올라간다) */
export function parseThanksTemplate(stored: string | null | undefined): ThanksTemplate {
  if (stored === null || stored === undefined || stored === '') return DEFAULT_THANKS_TEMPLATE
  try {
    const value: unknown = JSON.parse(stored)
    if (checkThanksTemplate(value) !== null) return DEFAULT_THANKS_TEMPLATE
    return (value as ThanksBlock[]).map((block) => (block.k === 'text' ? { k: 'text', t: block.t.trim() } : { k: block.k }))
  } catch {
    return DEFAULT_THANKS_TEMPLATE
  }
}
