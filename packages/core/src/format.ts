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
