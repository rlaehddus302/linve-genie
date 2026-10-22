// 상품 옵션 화면 도우미 (OPT-01·05, R-19 "옵션 모델"·"비교 글자"·"변형과 재고 단위"·"가격", D-O2-05·06·07·11).
// - "옵션 추가" 창의 칸 값(글자)을 들고, 치는 동안 모양·겹침·한도를 쉬운 한국어로 알린다. 최종 판단은 서버(코어 checkEvent)다.
// - 변형 재고 표(행 = 변형 옵션 글, 처음 값 1)·변형 단가·옵션 요약 글.
// - 확인 필요 한 줄의 미리 채움(엔진이 읽은 것만)·후보 제안(편집 거리 1)·바로잡기 결과 낱말.
// 판정은 하지 않는다 — 비교 글자·변형 글은 코어 함수(compareChars·variantTexts)를 그대로 쓴다.
import { OPTION_LIMITS, compareChars, formatWon, variantCount, variantTexts, type OptionItem } from '@livejjim/core'
import type { Product } from '../api/types.ts'

// ── 칸 값 ─────────────────────────────────────────────────────────────

/** 선택지 한 줄의 칸 값 (별칭은 쉼표로 나눠 적는다) */
export interface ChoiceDraft {
  readonly label: string
  readonly aliases: string
  readonly price: string
}

export interface ItemDraft {
  readonly name: string
  readonly choices: readonly ChoiceDraft[]
}

/** "옵션 추가" 창 전체의 칸 값 */
export interface OptionDraft {
  readonly items: readonly ItemDraft[]
  /** 상품 별칭 (쉼표로 나눠 적는다) */
  readonly aliases: string
  /** 변형 옵션 글 → 재고 칸 글자 (없으면 처음 값 1) */
  readonly stocks: Readonly<Record<string, string>>
}

export const EMPTY_DRAFT: OptionDraft = { items: [], aliases: '', stocks: {} }

/** 변형 재고의 처음 값 (D-O2-06 — 더 팔리는 것보다 덜 팔리는 쪽) */
export const DEFAULT_VARIANT_STOCK = '1'

export const emptyChoice = (): ChoiceDraft => ({ label: '', aliases: '', price: '' })
export const emptyItem = (): ItemDraft => ({ name: '', choices: [emptyChoice()] })

/** 쉼표로 나눈 글 → 목록 (앞뒤 공백을 빼고 빈 것은 버린다) */
export function splitList(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export const joinList = (items: readonly string[] | undefined): string => (items ?? []).join(', ')

/** 옵션 항목 → 칸 값 (템플릿·상품의 지금 옵션) */
export function itemDraftOf(item: OptionItem): ItemDraft {
  return {
    name: item.name,
    choices: item.choices.map((choice) => ({ label: choice.label, aliases: joinList(choice.aliases), price: choice.price === undefined || choice.price === 0 ? '' : String(choice.price) })),
  }
}

/** 상품의 지금 옵션·별칭·변형 재고 → 칸 값 ("옵션 고치기") */
export function draftOfProduct(product: Pick<Product, 'options' | 'aliases' | 'variants'>): OptionDraft {
  const stocks: Record<string, string> = {}
  for (const variant of product.variants) stocks[variant.text] = String(variant.stock)
  return { items: product.options.map(itemDraftOf), aliases: joinList(product.aliases), stocks }
}

// ── 문장 (D-O2-06·13 — 서버 문장과 같은 말) ─────────────────────────────

export const OPTION_WORDS = {
  tooManyItems: '옵션 항목은 3개까지예요.',
  itemsFull: '옵션 항목은 3개까지라 더 고를 수 없어요.',
  itemName: '항목 이름은 1~10자로, 줄바꿈 같은 특수 글자 없이 적어 주세요.',
  itemNameSame: '같은 항목 이름이 두 개 있어요. 항목 이름을 다르게 적어 주세요.',
  choiceCount: '선택지는 항목마다 1~20개예요.',
  word: '선택지 이름·별칭은 1~20자로, ‘/’·‘#’ 없이 적어 주세요.',
  choiceAliases: '선택지 별칭은 10개까지예요.',
  price: '가격 차이는 −1,000,000원부터 1,000,000원까지의 정수로 적어 주세요.',
  variants: '옵션 조합(변형)은 100개까지예요. 선택지를 줄여 주세요.',
  stock: '옵션별 재고는 0 이상의 정수로 적어 주세요.',
  unitPrice: '가격 차이 때문에 값이 0원보다 작아져요.',
  productAliases: '상품 별칭은 10개까지예요.',
  productAlias: '상품 별칭은 1~20자로 적어 주세요.',
  soldOutAtStart: '없음(처음부터 품절)',
  locked: '찜이 있어 선택지 더하기·가격·재고만 바꿀 수 있어요. 다른 것은 새 번호로 등록해 주세요.',
  unchanged: '바뀐 것이 없어요',
  numericAlias: "숫자만 쓴 별칭은 상품 번호와 헷갈려 '확인 필요'로 갈 수 있어요",
} as const

/** 별칭 칸에 숫자만으로 된 별칭이 있나 (D-O4-11 — 안내만, 막지 않는다). 선택지 이름은 보지 않는다 */
export function hasNumericAlias(text: string): boolean {
  return splitList(text).some((alias) => /^[0-9０-９]+$/.test(alias))
}

/** 받침이 있는 말인가 (조사 고르기) — 한글은 받침, 숫자·영문은 읽는 소리로 */
function hasFinal(word: string): boolean {
  const last = [...word.trim()].at(-1)
  if (last === undefined) return false
  const code = last.codePointAt(0) ?? 0
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0
  if (/[0-9]/.test(last)) return '0136789'.includes(last) // 영·일·삼·육·칠·팔 (구·이·사·오는 받침 없음)
  if (/[a-z]/i.test(last)) return 'lmnr'.includes(last.toLowerCase()) // 엘·엠·엔·알
  return false
}

/** 과/와 */
export const andJosa = (word: string): string => (hasFinal(word) ? '과' : '와')

// ── 검사 ─────────────────────────────────────────────────────────────

const CONTROL = /\p{Cc}/u
const charCount = (text: string): number => [...text].length

/** 판매자가 적은 이름·별칭 하나가 서버가 받는 모양인가 (1~max자, 공백만 아님, 제어 글자 없음, label·별칭은 `/`·`#` 없음) */
function wordOk(text: string, max: number, noMarks: boolean): boolean {
  const n = charCount(text)
  if (n < 1 || n > max) return false
  if (compareChars(text) === '') return false
  if (CONTROL.test(text)) return false
  if (noMarks && (text.includes('/') || text.includes('#'))) return false
  return true
}

/** 가격 차이 칸 → 정수 원 (빈 칸 0). 읽지 못하거나 범위 밖이면 null */
export function readPriceDiff(text: string): number | null {
  const compact = text.trim().replace(/,/g, '').replace(/^[−–]/, '-')
  if (compact === '') return 0
  if (!/^[-+]?\d+$/.test(compact)) return null
  const value = Number(compact)
  return Number.isSafeInteger(value) && Math.abs(value) <= OPTION_LIMITS.price ? value : null
}

/** 재고 칸 → 0 이상 정수 (아니면 null) */
export function readStock(text: string): number | null {
  const compact = text.trim()
  if (!/^\d{1,6}$/.test(compact)) return null
  return Number(compact)
}

/** 변형 재고 표 한 줄 */
export interface VariantRow {
  /** 옵션 글 `흰색/대형` */
  readonly text: string
  /** 칸 글자 */
  readonly stock: string
  /** 단가 (상품 가격을 모르면 null) */
  readonly unitPrice: number | null
  /** 재고 0 — "없음(처음부터 품절)" */
  readonly soldOut: boolean
}

export interface DraftCheck {
  /** 칸 이름 → 문장 (`items.0.name`·`items.0.choices.1.label`·`…aliases`·`…price`·`items.0.choices`·`items`·`aliases`·`stocks.<옵션 글>`·`unit.<옵션 글>`) */
  readonly problems: ReadonlyMap<string, string>
  /** 변형 재고 표 (변형이 100개를 넘거나 항목 모양이 틀리면 빈 목록) */
  readonly rows: readonly VariantRow[]
  /** 보낼 값 (문제가 있으면 null) */
  readonly payload: OptionPayload | null
}

/** 서버에 보내는 칸 (product.register·update) — 템플릿 이름은 들어가지 않는다 */
export interface OptionPayload {
  readonly options: OptionItem[]
  readonly aliases: string[]
  readonly stocks: Record<string, number>
}

/** 칸 값 → 옵션 항목 (모양은 보지 않는다 — 빈 선택지 줄은 뺀다) */
export function itemsOfDraft(draft: OptionDraft): OptionItem[] {
  return draft.items.map((item) => ({
    name: item.name.trim(),
    choices: item.choices
      .filter((choice) => choice.label.trim() !== '' || choice.aliases.trim() !== '' || choice.price.trim() !== '')
      .map((choice) => {
        const aliases = splitList(choice.aliases)
        const price = readPriceDiff(choice.price) ?? 0
        return { label: choice.label.trim(), ...(aliases.length > 0 ? { aliases } : {}), ...(price !== 0 ? { price } : {}) }
      }),
  }))
}

/**
 * 치는 동안의 검사 (D-O2-06). price는 상품 가격(빠른 입력 줄에서 읽은 값 — 모르면 null: 단가 검사를 하지 않는다).
 * 겹침은 R-19 비교 글자(공백 빼기·영문 소문자)로 보고 두 자리를 말한다: "‘m’이 사이즈 M과 사이즈 L에 함께 있어요".
 */
export function checkDraft(draft: OptionDraft, price: number | null): DraftCheck {
  const problems = new Map<string, string>()
  const put = (field: string, message: string) => {
    if (!problems.has(field)) problems.set(field, message)
  }
  if (draft.items.length > OPTION_LIMITS.items) put('items', OPTION_WORDS.tooManyItems)
  const names = new Map<string, number>()
  /** 비교 글자 → 처음 나온 자리 (항목 이름 + 선택지 이름) */
  const seen = new Map<string, string>()
  draft.items.forEach((item, i) => {
    const name = item.name.trim()
    if (!wordOk(name, OPTION_LIMITS.itemName, false)) put(`items.${String(i)}.name`, OPTION_WORDS.itemName)
    else {
      const key = compareChars(name)
      if (names.has(key)) put(`items.${String(i)}.name`, OPTION_WORDS.itemNameSame)
      names.set(key, i)
    }
    const filled = item.choices.filter((choice) => choice.label.trim() !== '' || choice.aliases.trim() !== '' || choice.price.trim() !== '')
    if (filled.length < 1 || filled.length > OPTION_LIMITS.choices) put(`items.${String(i)}.choices`, OPTION_WORDS.choiceCount)
    item.choices.forEach((choice, j) => {
      const base = `items.${String(i)}.choices.${String(j)}`
      const label = choice.label.trim()
      const empty = label === '' && choice.aliases.trim() === '' && choice.price.trim() === ''
      if (empty) return
      const place = `${name === '' ? '이름 없는 항목' : name} ${label === '' ? '이름 없는 선택지' : label}`
      const words: [string, string][] = [[`${base}.label`, label]]
      const aliases = splitList(choice.aliases)
      if (aliases.length > OPTION_LIMITS.aliases) put(`${base}.aliases`, OPTION_WORDS.choiceAliases)
      for (const alias of aliases) words.push([`${base}.aliases`, alias])
      for (const [field, word] of words) {
        if (!wordOk(word, OPTION_LIMITS.label, true)) {
          put(field, OPTION_WORDS.word)
          continue
        }
        const key = compareChars(word)
        const first = seen.get(key)
        if (first !== undefined) put(field, `‘${word}’이 ${first}${andJosa(first)} ${place}에 함께 있어요`)
        else seen.set(key, place)
      }
      if (readPriceDiff(choice.price) === null) put(`${base}.price`, OPTION_WORDS.price)
    })
  })
  const productAliases = splitList(draft.aliases)
  if (productAliases.length > OPTION_LIMITS.productAliases) put('aliases', OPTION_WORDS.productAliases)
  else if (productAliases.some((alias) => !wordOk(alias, OPTION_LIMITS.productAlias, false))) put('aliases', OPTION_WORDS.productAlias)

  const options = itemsOfDraft(draft)
  const shapeOk = [...problems.keys()].every((field) => field === 'aliases')
  let rows: VariantRow[] = []
  if (shapeOk && options.length > 0) {
    if (variantCount(options) > OPTION_LIMITS.variants) put('items', OPTION_WORDS.variants)
    else rows = variantRowsOf(options, draft.stocks, price)
  }
  for (const row of rows) {
    if (readStock(row.stock) === null) put(`stocks.${row.text}`, OPTION_WORDS.stock)
    if (row.unitPrice !== null && row.unitPrice < 0) put(`unit.${row.text}`, OPTION_WORDS.unitPrice)
  }
  if (problems.size > 0) return { problems, rows, payload: null }
  const stocks: Record<string, number> = {}
  for (const row of rows) stocks[row.text] = readStock(row.stock) ?? 1
  return { problems, rows, payload: { options, aliases: productAliases, stocks } }
}

/** 변형마다 선택지 번호 (항목 순서, 마지막 항목이 가장 빨리 바뀐다 — 코어 variantTexts와 같은 순서) */
function variantIndexes(options: readonly OptionItem[]): number[][] {
  let out: number[][] = [[]]
  for (const item of options) {
    const next: number[][] = []
    for (const prefix of out) for (let i = 0; i < item.choices.length; i++) next.push([...prefix, i])
    out = next
  }
  return out
}

/** 변형 재고 표 (행 = 변형, 처음 값 1, 단가 = 상품 가격 + 가격 차이 합) */
export function variantRowsOf(options: readonly OptionItem[], stocks: Readonly<Record<string, string>>, price: number | null): VariantRow[] {
  if (options.length === 0) return []
  const texts = variantTexts(options)
  return variantIndexes(options).map((indexes, n) => {
    const text = texts[n] ?? ''
    const stock = stocks[text] ?? DEFAULT_VARIANT_STOCK
    let unit: number | null = price
    if (unit !== null) indexes.forEach((choice, item) => (unit = (unit as number) + (options[item]?.choices[choice]?.price ?? 0)))
    return { text, stock, unitPrice: unit, soldOut: readStock(stock) === 0 }
  })
}

/** 붙은 옵션 요약: "옵션: 사이즈 S/M/L · 변형 3개" (항목이 여럿이면 항목마다) */
export function optionSummary(options: readonly OptionItem[]): string {
  if (options.length === 0) return '옵션 없음'
  const parts = options.map((item) => `${item.name} ${item.choices.map((choice) => choice.label).join('/')}`)
  return `옵션: ${parts.join(' · ')} · 변형 ${String(variantCount(options))}개`
}

/** 단가 글 */
export const unitPriceWords = (price: number | null): string => (price === null ? '' : formatWon(price))

/**
 * 찜이 있는 상품의 고치기(D-O-14, D-O2-11)에서 고칠 수 있는 칸만 바꿨는지: 항목 수·이름, 기존 선택지 이름이 그대로이고
 * 선택지는 끝에 더하기만. 화면은 막힌 칸을 보이지 않으므로 이 검사는 고친 값이 그 범위 안인지 확인할 뿐이다.
 */
export function onlyAppends(before: readonly OptionItem[], after: readonly OptionItem[]): boolean {
  if (before.length !== after.length) return false
  return before.every((item, i) => {
    const next = after[i]
    if (next === undefined || next.name !== item.name || next.choices.length < item.choices.length) return false
    return item.choices.every((choice, j) => next.choices[j]?.label === choice.label)
  })
}

// ── 확인 필요 (D-O2-07) ─────────────────────────────────────────────────

/** 편집 거리 (코드 포인트) */
export function editDistance(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const current = [i]
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost))
    }
    previous = current
  }
  return previous[y.length] ?? 0
}

/** 후보 제안 하나: 고르면 그 항목 칸을 그 선택지로 채운다 (상품 이름이면 item = null) */
export interface Suggestion {
  readonly item: string | null
  readonly label: string
}

/** 많아야 이만큼 제안한다 */
export const MAX_SUGGESTIONS = 3

/**
 * 후보 제안 (D-O-11, D-O2-07): 댓글 글의 낱말(두 글자 이상)과 그 상품 선택지 이름·별칭(옵션이 없으면 상품 이름·별칭)의
 * 비교 글자가 편집 거리 1인 것, 많아야 3개. 칸을 채울 뿐 보내지 않는다.
 */
export function suggestionsFor(text: string, product: Pick<Product, 'name' | 'aliases' | 'options'> | undefined): Suggestion[] {
  if (product === undefined) return []
  const words = text
    .split(/\s+/)
    .map((word) => compareChars(word))
    .filter((word) => charCount(word) >= 2)
  const candidates: { suggestion: Suggestion; words: string[] }[] =
    product.options.length > 0
      ? product.options.flatMap((item) => item.choices.map((choice) => ({ suggestion: { item: item.name, label: choice.label }, words: [choice.label, ...(choice.aliases ?? [])].map(compareChars) })))
      : [{ suggestion: { item: null, label: product.name }, words: [product.name, ...product.aliases].map(compareChars) }]
  const out: Suggestion[] = []
  for (const candidate of candidates) {
    if (out.length >= MAX_SUGGESTIONS) break
    if (candidate.words.some((target) => target !== '' && words.some((word) => editDistance(word, target) === 1))) out.push(candidate.suggestion)
  }
  return out
}

/** 한 줄의 고르기 칸 */
export interface ReviewPick {
  /** 상품 키 (없으면 '') */
  readonly product: string
  /** 항목 이름 → 선택지 label (고르지 않은 항목은 없다) */
  readonly options: Readonly<Record<string, string>>
  /** 수량 칸 글자 (읽지 않았으면 '' — 1로 채우지 않는다, D-O1-08) */
  readonly qty: string
}

/**
 * 미리 채움 = 엔진이 읽은 것만 (D-O2-07): 읽은 번호(없으면 항목의 지금 상품), 읽은 옵션, 읽은 수량. 선택지가 하나뿐인 항목은 그 값.
 */
export function prefillOf(
  review: { readonly broadcast: string; readonly product: string | null; readonly no: number | null; readonly options: readonly (readonly string[])[] | null; readonly qty: number | null },
  products: ReadonlyMap<string, Pick<Product, 'key' | 'options'>>,
): ReviewPick {
  const key = review.product ?? (review.no === null ? null : `${review.broadcast}/${String(review.no)}`)
  const product = key === null ? undefined : products.get(key)
  return { product: product?.key ?? '', options: pickFor(product, review.options ?? []), qty: review.qty === null ? '' : String(review.qty) }
}

/** 그 상품의 고르기: 주어진 옵션 중 그 상품에 있는 것 + 선택지가 하나뿐인 항목 */
export function pickFor(product: Pick<Product, 'options'> | undefined, given: readonly (readonly string[])[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (product === undefined) return out
  for (const item of product.options) {
    const found = given.find(([name, label]) => name === item.name && item.choices.some((choice) => choice.label === label))
    if (found?.[1] !== undefined) out[item.name] = found[1]
    else if (item.choices.length === 1 && item.choices[0] !== undefined) out[item.name] = item.choices[0].label
  }
  return out
}

/** 고른 옵션 → 옵션 글 (항목 순서, 모든 항목을 골랐을 때만) */
export function variantTextOf(product: Pick<Product, 'options'>, options: Readonly<Record<string, string>>): string | null {
  const labels: string[] = []
  for (const item of product.options) {
    const label = options[item.name]
    if (label === undefined) return null
    labels.push(label)
  }
  return labels.join('/')
}

/** 수량 칸 → 1~max 정수 (아니면 null) */
export function readQty(text: string, max: number): number | null {
  const compact = text.trim()
  if (!/^\d{1,3}$/.test(compact)) return null
  const value = Number(compact)
  return value >= 1 && value <= max ? value : null
}

export const qtyProblemWords = (max: number): string => `수량은 1부터 ${String(max)}까지예요.`

// ── 바로잡기 결과 (D-O2-07, AC-O2-35·36·38) ───────────────────────────────

export const KEPT_WORDS = {
  stock: '그대로 두었어요 — 남은 수량이 모자라요',
  notOnSale: '그대로 두었어요 — 판매 중인 상품이 아니에요',
  already: '그대로 두었어요 — 이 구매자가 같은 옵션을 이미 찜했어요',
  other: '그대로 두었어요 — 지금 상태를 확인해 주세요',
} as const

export type LineOutcome = { readonly kind: 'claimed'; readonly word: string } | { readonly kind: 'kept'; readonly word: string }

/** 보낸 한 줄 (그 상품·변형·수량·지금의 구매자) */
export interface SentLine {
  readonly product: string
  /** 옵션 글 (옵션 없는 상품이면 null) */
  readonly variant: string | null
  readonly qty: number
  readonly buyer: string
}

/** 상품·변형의 1등·대기·남은 수량 (옵션 없는 상품은 상품 자신) */
function slotOf(product: Product, variant: string | null): { winners: readonly string[]; waitlist: readonly string[]; remaining: number; status: Product['status'] } | null {
  if (variant === null) return { winners: product.winners, waitlist: product.waitlist, remaining: product.stock - product.confirmedUnits, status: product.status }
  const found = product.variants.find((item) => item.text === variant)
  return found === undefined ? null : { winners: found.winners, waitlist: found.waitlist, remaining: found.remaining, status: product.status }
}

/**
 * 응답 changed와 보낸 뒤의 상품으로 줄의 결과를 정한다 (화면이 상태로 판단 — 서버 계약 3).
 * 찜이 생겼으면 "1등"·"대기 n번"·"품절", 아무 일도 없었으면 까닭(판매 중 아님 → 같은 옵션 이미 찜 → 남은 수량 부족 순).
 */
export function outcomeOf(changed: boolean, line: SentLine, product: Product | undefined): LineOutcome {
  const slot = product === undefined ? null : slotOf(product, line.variant)
  if (changed) {
    if (slot === null) return { kind: 'claimed', word: '찜이 생겼어요' }
    if (slot.winners.includes(line.buyer)) return { kind: 'claimed', word: '1등' }
    const index = slot.waitlist.indexOf(line.buyer)
    if (index >= 0) return { kind: 'claimed', word: `대기 ${String(index + 1)}번` }
    return { kind: 'claimed', word: '품절' }
  }
  if (product === undefined || slot === null) return { kind: 'kept', word: KEPT_WORDS.other }
  if (slot.status !== 'OPEN' && slot.status !== 'SOLD') return { kind: 'kept', word: KEPT_WORDS.notOnSale }
  if (slot.winners.includes(line.buyer) || slot.waitlist.includes(line.buyer)) return { kind: 'kept', word: KEPT_WORDS.already }
  if (line.qty > slot.remaining) return { kind: 'kept', word: KEPT_WORDS.stock }
  return { kind: 'kept', word: KEPT_WORDS.other }
}

/** 고른 변형의 남은 수량 (모두 고르지 않았으면 null) */
export function remainingOf(product: Product | undefined, options: Readonly<Record<string, string>>): number | null {
  if (product === undefined) return null
  if (product.options.length === 0) return product.stock - product.confirmedUnits
  const text = variantTextOf(product, options)
  if (text === null) return null
  return product.variants.find((variant) => variant.text === text)?.remaining ?? null
}
