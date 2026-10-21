// 옵션 방송 어휘의 형식 계약 검사 (README "옵션 방송"·product.register 행·comment-options suite, O1, D-O1-01~D-O1-10).
// 코어의 검사 함수를 쓰지 않고 README대로 따로 적는다 — 러너가 코어의 검사를 그대로 따라 하면 코어가 틀려도 잡지 못한다(contract.ts 머리말).
import { OPTION_RULES, isPlainObject, noPhoneInText, showValue } from './contract.ts'
import type { PathSegment } from './yaml.ts'

export interface Fail {
  fail(path: readonly PathSegment[], message: string): false
}

/** 시나리오가 아는 옵션 상품 하나: 항목마다 그동안 적힌 선택지 label 전부 (바꾸기가 엔진에서 막혔을 수도 있어 합집합으로 본다) */
export interface CatalogItem {
  readonly items: { readonly name: string; readonly labels: string[] }[]
}

/** 비교 글자 (README·R-19): 공백을 모두 빼고 영문을 소문자로 */
export function comparable(text: string): string {
  return text.replace(/\s+/gu, '').replace(/[A-Z]/g, (c) => c.toLowerCase())
}

const CONTROL = /\p{Cc}/u
const count = (text: string): number => [...text].length

function word(c: Fail, path: readonly PathSegment[], value: unknown, max: number, marks: boolean, what: string): value is string {
  if (typeof value !== 'string') return c.fail(path, `${what}은 문자열이어야 한다 (값: ${showValue(value)})`)
  const n = count(value)
  if (n < 1 || n > max || comparable(value) === '') return c.fail(path, `${what}은 1~${String(max)}자여야 한다 (값: ${showValue(value)})`)
  if (CONTROL.test(value)) return c.fail(path, `${what}에 제어 글자를 쓸 수 없다`)
  if (marks && (value.includes('/') || value.includes('#'))) return c.fail(path, `${what}에 '/'·'#'를 쓸 수 없다 (값: ${showValue(value)})`)
  const phone = noPhoneInText(value)
  if (phone !== undefined) return c.fail(path, phone)
  return true
}

/**
 * 옵션 항목 목록 (README product.register 행): 항목 0~3개·선택지 1~20개·별칭 0~10개·글자 1~10/1~20자·`/`·`#`·제어 글자 없음·
 * price 정수 −1,000,000~1,000,000·변형 100개까지·한 상품 안 비교 글자 겹침 없음·변형 단가 0 이상(price를 주면). 이름·별칭은 글 칸(휴대폰 번호 없음).
 * @returns 맞으면 항목 이름·label 목록, 아니면 undefined
 */
export function checkOptionItems(c: Fail, path: readonly PathSegment[], value: unknown, price: number | undefined): CatalogItem | undefined {
  if (!Array.isArray(value)) {
    c.fail(path, `options는 옵션 항목 목록이어야 한다 (값: ${showValue(value)})`)
    return undefined
  }
  let ok = true
  if (value.length > OPTION_RULES.items) ok = c.fail(path, `옵션 항목은 ${String(OPTION_RULES.items)}개까지다`)
  const names = new Set<string>()
  const words = new Set<string>()
  const items: { name: string; labels: string[] }[] = []
  let variants = 1
  let lowest = price ?? 0
  value.forEach((item: unknown, i) => {
    const ip = [...path, i]
    if (!isPlainObject(item)) {
      ok = c.fail(ip, '옵션 항목은 { name, choices } 맵이어야 한다')
      return
    }
    for (const key of Object.keys(item)) if (key !== 'name' && key !== 'choices') ok = c.fail([...ip, key], `옵션 항목의 모르는 키 '${key}'`)
    if (!word(c, [...ip, 'name'], item.name, OPTION_RULES.itemName, false, '항목 이름')) ok = false
    else if (names.has(comparable(item.name))) ok = c.fail([...ip, 'name'], `한 상품 안의 항목 이름이 겹친다 (${item.name})`)
    else names.add(comparable(item.name))
    const choices = item.choices
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > OPTION_RULES.choices) {
      ok = c.fail([...ip, 'choices'], `선택지는 1~${String(OPTION_RULES.choices)}개 목록이어야 한다`)
      return
    }
    variants *= choices.length
    const labels: string[] = []
    let cheapest = Number.POSITIVE_INFINITY
    choices.forEach((choice: unknown, j) => {
      const cp = [...ip, 'choices', j]
      if (!isPlainObject(choice)) {
        ok = c.fail(cp, '선택지는 { label, aliases?, price? } 맵이어야 한다')
        return
      }
      for (const key of Object.keys(choice)) if (key !== 'label' && key !== 'aliases' && key !== 'price') ok = c.fail([...cp, key], `선택지의 모르는 키 '${key}'`)
      const all: [readonly PathSegment[], unknown][] = [[[...cp, 'label'], choice.label]]
      if (choice.aliases !== undefined) {
        if (!Array.isArray(choice.aliases) || choice.aliases.length > OPTION_RULES.aliases) ok = c.fail([...cp, 'aliases'], `별칭은 ${String(OPTION_RULES.aliases)}개까지의 목록이어야 한다`)
        else choice.aliases.forEach((alias: unknown, k) => all.push([[...cp, 'aliases', k], alias]))
      }
      for (const [p, w] of all) {
        if (!word(c, p, w, OPTION_RULES.label, true, '선택지 이름·별칭')) {
          ok = false
          continue
        }
        const key = comparable(w)
        if (words.has(key)) ok = c.fail(p, `한 상품 안의 선택지 이름·별칭이 비교 글자로 겹친다 (${w})`)
        words.add(key)
      }
      if (typeof choice.label === 'string') labels.push(choice.label)
      const delta = choice.price ?? 0
      if (!(typeof delta === 'number' && Number.isSafeInteger(delta) && Math.abs(delta) <= OPTION_RULES.price)) {
        ok = c.fail([...cp, 'price'], `가격 차이는 −1,000,000~1,000,000 정수여야 한다 (값: ${showValue(delta)})`)
      } else cheapest = Math.min(cheapest, delta)
    })
    if (Number.isFinite(cheapest)) lowest += cheapest
    if (typeof item.name === 'string') items.push({ name: item.name, labels })
  })
  if (value.length > 0 && variants > OPTION_RULES.variants) ok = c.fail(path, `변형(선택지 조합)은 ${String(OPTION_RULES.variants)}개까지다 (지금 ${String(variants)}개)`)
  if (price !== undefined && value.length > 0 && lowest < 0) ok = c.fail(path, '변형 단가(상품 가격 + 가격 차이)는 0 이상이어야 한다')
  return ok ? { items } : undefined
}

/** 상품 별칭 목록 (0~10개, 1~20자, 글 칸) */
export function checkProductAliases(c: Fail, path: readonly PathSegment[], value: unknown): void {
  if (!Array.isArray(value) || value.length > OPTION_RULES.productAliases) {
    c.fail(path, `aliases는 ${String(OPTION_RULES.productAliases)}개까지의 문자열 목록이어야 한다 (값: ${showValue(value)})`)
    return
  }
  value.forEach((alias: unknown, i) => word(c, [...path, i], alias, OPTION_RULES.productAlias, false, '상품 별칭'))
}

/** 옵션 글이 그 상품의 변형인가 (항목 수만큼 '/'로 나눈 label이 항목마다 있다) */
export function isVariantText(item: CatalogItem, text: string): boolean {
  const labels = text.split('/')
  return labels.length === item.items.length && item.items.length > 0 && labels.every((label, i) => (item.items[i] as { readonly labels: readonly string[] }).labels.includes(label))
}

/** 변형 재고 맵: 키는 그 상품(바꾼 뒤)의 변형 옵션 글, 값은 0 이상 정수 */
export function checkStocks(c: Fail, path: readonly PathSegment[], value: unknown, item: CatalogItem | undefined): void {
  if (!isPlainObject(value)) {
    c.fail(path, `stocks는 옵션 글 → 재고 맵이어야 한다 (값: ${showValue(value)})`)
    return
  }
  if (item === undefined || item.items.length === 0) {
    c.fail(path, 'options 없는 상품에는 stocks를 쓰지 않는다')
    return
  }
  for (const [key, stock] of Object.entries(value)) {
    if (!isVariantText(item, key)) c.fail([...path, key], `그 상품의 변형이 아니다 '${key}' (옵션 글 = label을 항목 순서대로 '/'로)`)
    if (!(typeof stock === 'number' && Number.isSafeInteger(stock) && stock >= 0)) c.fail([...path, key], `변형 재고는 0 이상 정수여야 한다 (값: ${showValue(stock)})`)
  }
}

/**
 * 고른 옵션 (항목 이름 → label): 같은 상품의 항목·선택지여야 한다. all이면 모든 항목, 아니면 읽은 항목만(확인 필요의 options).
 */
export function checkPick(c: Fail, path: readonly PathSegment[], value: unknown, item: CatalogItem | undefined, all: boolean): void {
  if (!isPlainObject(value)) {
    c.fail(path, `options는 항목 이름 → 선택지 label 맵이어야 한다 (값: ${showValue(value)})`)
    return
  }
  if (item === undefined || item.items.length === 0) {
    c.fail(path, '옵션이 있는 상품이 아니다 (같은 상품의 항목·선택지여야 한다)')
    return
  }
  for (const [name, label] of Object.entries(value)) {
    const known = item.items.find((entry) => entry.name === name)
    if (known === undefined) c.fail([...path, name], `그 상품의 항목이 아니다 '${name}'`)
    else if (typeof label !== 'string' || !known.labels.includes(label)) c.fail([...path, name], `그 항목의 선택지가 아니다 (값: ${showValue(label)})`)
  }
  if (all && Object.keys(value).length !== item.items.length) c.fail(path, `옵션 상품이면 모든 항목(${item.items.map((entry) => entry.name).join('·')})을 적는다`)
}

/** 두 항목 목록의 합집합 (같은 이름 항목의 label을 더한다, 항목 순서는 새 목록) */
export function mergeCatalog(before: CatalogItem | undefined, after: CatalogItem): CatalogItem {
  if (before === undefined) return after
  return {
    items: after.items.map((entry) => {
      const old = before.items.find((item) => item.name === entry.name)
      return { name: entry.name, labels: [...new Set([...entry.labels, ...(old?.labels ?? [])])] }
    }),
  }
}
