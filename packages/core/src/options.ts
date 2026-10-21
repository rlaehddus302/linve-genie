// 상품 옵션 모델 (DOMAIN_RULES R-19 "옵션 모델"·"변형과 재고 단위"·"가격", D-O-03~D-O-05, D-O1-03).
// 판정 엔진(입력 검사·변형 재고)과 댓글 옵션 인식(R-20)이 같은 정의를 쓴다. 모두 순수 함수다.
import { normalizeText } from './parse/text.ts'

/** 선택지 (R-19): 표시 이름 label, 동의어 aliases(0~10), 가격 차이 price(정수 원, 기본 0) */
export interface OptionChoice {
  readonly label: string
  readonly aliases?: readonly string[]
  readonly price?: number
}

/** 옵션 항목 (R-19): 이름(예 `사이즈`)과 선택지 1~20개. 모든 항목은 필수다 */
export interface OptionItem {
  readonly name: string
  readonly choices: readonly OptionChoice[]
}

/** 고른 옵션 = 항목 이름 → 선택지 label */
export type OptionPick = Readonly<Record<string, string>>

/** 모양 제한 (R-19 "옵션 모델", README product.register 행) */
export const OPTION_LIMITS = Object.freeze({
  items: 3,
  itemName: 10,
  choices: 20,
  label: 20,
  aliases: 10,
  alias: 20,
  price: 1_000_000,
  variants: 100,
  productAliases: 10,
  productAlias: 20,
})

/** 옵션 글의 항목 구분자. label에는 쓰지 않는다 (변형 키 `<방송>/<번호>#<옵션 글>`) */
export const OPTION_TEXT_SEPARATOR = '/'

const ASCII_UPPER = /[A-Z]/g
const SPACE = / /g

/**
 * 비교 글자 (R-19 "비교 글자"): R-3 정규화 뒤 공백을 모두 빼고 영문을 소문자로 바꾼 글자. `17 Pro` = `17pro`.
 * 이름·별칭을 댓글과 비교할 때와 한 상품 안의 겹침을 볼 때 같은 함수를 쓴다.
 */
export function compareChars(text: string): string {
  return normalizeText(text)
    .replace(SPACE, '')
    .replace(ASCII_UPPER, (c) => c.toLowerCase())
}

/** 글자 수 = 코드 포인트 수 (이모지 하나 = 한 자) */
export function charCount(text: string): number {
  let n = 0
  for (const _ of text) n++
  return n
}

/**
 * 변형마다의 선택지 번호 (항목 순서, 마지막 항목이 가장 빨리 바뀐다). 항목이 없으면 빈 목록.
 * 변형 수는 선택지 수의 곱이다 — 부르는 쪽이 100개 이하인지 먼저 본다.
 */
export function variantIndexes(options: readonly OptionItem[]): number[][] {
  if (options.length === 0) return []
  let out: number[][] = [[]]
  for (const item of options) {
    const next: number[][] = []
    for (const prefix of out) for (let i = 0; i < item.choices.length; i++) next.push([...prefix, i])
    out = next
  }
  return out
}

/** 선택지 번호 → 옵션 글 (`흰색/대형` — label을 항목 순서대로 `/`로) */
export function optionTextOf(options: readonly OptionItem[], indexes: readonly number[]): string {
  return indexes.map((choice, item) => (options[item] as OptionItem).choices[choice]?.label ?? '').join(OPTION_TEXT_SEPARATOR)
}

/** 모든 변형의 옵션 글, 항목 순서·선택지 순서 */
export function variantTexts(options: readonly OptionItem[]): string[] {
  return variantIndexes(options).map((indexes) => optionTextOf(options, indexes))
}

/** 변형 수 = 선택지 수의 곱 (항목이 없으면 0 — 변형은 상품 자신 하나) */
export function variantCount(options: readonly OptionItem[]): number {
  return options.length === 0 ? 0 : options.reduce((product, item) => product * item.choices.length, 1)
}

/** 변형 단가 = 상품 가격 + 고른 선택지들의 가격 차이 합 (R-19 "가격") */
export function unitPriceOf(price: number, options: readonly OptionItem[], indexes: readonly number[]): number {
  let total = price
  indexes.forEach((choice, item) => {
    total += (options[item] as OptionItem).choices[choice]?.price ?? 0
  })
  return total
}

/** 가장 싼 변형의 단가 (0 이상이어야 한다 — R-19 "가격") */
export function lowestUnitPrice(price: number, options: readonly OptionItem[]): number {
  let total = price
  for (const item of options) total += Math.min(...item.choices.map((choice) => choice.price ?? 0))
  return total
}

/**
 * 고른 옵션(항목 이름 → label)을 선택지 번호로. 그 상품의 모든 항목이 정확히 한 번씩, 있는 label이어야 한다.
 * 맞지 않으면(빠진 항목, 모르는 항목, 모르는 label) null.
 */
export function pickIndexes(options: readonly OptionItem[], pick: OptionPick): number[] | null {
  const names = Object.keys(pick)
  if (names.length !== options.length) return null
  const out: number[] = []
  for (const item of options) {
    if (!Object.hasOwn(pick, item.name)) return null
    const label = pick[item.name]
    const index = item.choices.findIndex((choice) => choice.label === label)
    if (index < 0) return null
    out.push(index)
  }
  return out
}

/** 옵션 글 → 선택지 번호 (그 상품의 변형이 아니면 null) */
export function indexesOfText(options: readonly OptionItem[], text: string): number[] | null {
  const labels = text.split(OPTION_TEXT_SEPARATOR)
  if (options.length === 0 || labels.length !== options.length) return null
  const out: number[] = []
  for (let i = 0; i < options.length; i++) {
    const index = (options[i] as OptionItem).choices.findIndex((choice) => choice.label === labels[i])
    if (index < 0) return null
    out.push(index)
  }
  return out
}

/** 옵션 글 → 고른 옵션 쌍 목록 `[항목 이름, label]` (항목 순서) */
export function pairsOfText(options: readonly OptionItem[], text: string): [string, string][] {
  const labels = text.split(OPTION_TEXT_SEPARATOR)
  return options.map((item, i) => [item.name, labels[i] ?? ''])
}
