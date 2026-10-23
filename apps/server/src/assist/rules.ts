// 확인 필요 항목의 제안 — 순수 함수 넷 (A1, SPEC CMT-06, DOMAIN_RULES R-20 10, D-A1-02~D-A1-06, 골든 tests/golden/assist/*.json).
// - 제안은 판정이 아니다: 이 함수들은 이벤트를 만들지 않고 엔진 상태를 바꾸지 않는다. 판매자가 제안을 누를 때만 기존 host.resolveReview가 나간다.
// - 규칙 제안은 코어 parseOptionComment(R-20)를 지금 상품 없이(focus = null) 다시 부를 뿐이다 — 새 문법을 만들지 않는다.
// - 시계·난수·I/O를 쓰지 않는다. 어떤 입력에도 예외를 던지지 않는다(받은 글은 신뢰할 수 없는 입력).
import { compareChars, normalizeText, parseOptionComment, type OptionCatalogEntry, type OptionItem, type SettingsOverride } from '@livejjim/core'

/** 제안 하나 = R-20 결과의 주문 한 줄과 같은 모양 (옵션 상품이면 모든 항목을 항목 순서로, 옵션 없는 상품이면 options 없음) */
export interface Suggestion {
  readonly no: number
  readonly options?: Readonly<Record<string, string>>
  readonly qty: number
}

/** 확인 필요 사유 (comment-options review.reason + STOCK_SHORT) */
export type AssistReason =
  | 'OPTION_MISSING'
  | 'OPTION_CONFLICT'
  | 'UNKNOWN_WORD'
  | 'QTY_INVALID'
  | 'NUMBER_AMBIGUOUS'
  | 'PRODUCT_AMBIGUOUS'
  | 'MULTI_PRODUCT'
  | 'FOCUS_CHANGED'
  | 'STOCK_SHORT'

/** 제안을 붙이는 사유 (D-A1-02) */
export const SUGGEST_REASONS: ReadonlySet<string> = new Set(['UNKNOWN_WORD', 'PRODUCT_AMBIGUOUS'])

/** 엔진이 읽은 것 (comment-options review와 같은 모양) */
export interface ReviewRead {
  readonly reason: string
  readonly no?: number
  readonly options?: Readonly<Record<string, string>>
  readonly qty?: number
}

/** 한글 음절(가~힣)로만 된 3글자 이상 (D-A1-09) */
const HANGUL_WORD = /^[가-힣]{3,}$/u

/** 코드 포인트 배열 */
const points = (text: string): string[] => Array.from(text)

/** 편집 거리가 1 이하인가 (넣기·빼기·바꾸기 각 1, 코드 포인트 단위) */
function withinOne(a: readonly string[], b: readonly string[]): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    edits++
    if (edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else {
      i++
      j++
    }
  }
  edits += a.length - i + (b.length - j)
  return edits <= 1
}

/**
 * 비슷함 (R-20 10, D-A1-09): 둘을 비교 글자(R-19)로 바꾸고, 둘 다 한글 음절(가~힣)로만 된 3글자 이상이며,
 * NFD로 푼 자모열의 편집 거리가 1 이하. 거리 0(같은 글자)도 비슷하다.
 * 영문·숫자·기호가 섞인 말(XS·black·4호)과 두 글자 이하 말(핑크·라지)은 맞추지 않는다 — 한 글자 차이가 다른 상품이다
 */
export function similar(chunk: string, name: string): boolean {
  if (typeof chunk !== 'string' || typeof name !== 'string') return false
  const a = compareChars(chunk)
  const b = compareChars(name)
  if (!HANGUL_WORD.test(a) || !HANGUL_WORD.test(b)) return false
  return withinOne(points(a.normalize('NFD')), points(b.normalize('NFD')))
}

const orderKey = (order: Suggestion): string => JSON.stringify([order.no, order.options === undefined ? null : Object.entries(order.options), order.qty])

const copyOrder = (order: Suggestion): Suggestion => (order.options === undefined ? { no: order.no, qty: order.qty } : { no: order.no, options: { ...order.options }, qty: order.qty })

/** 하나뿐이면 그것, 아니면 null */
function onlyOne(candidates: ReadonlyMap<string, Suggestion>): Suggestion | null {
  if (candidates.size !== 1) return null
  const [only] = candidates.values()
  return only === undefined ? null : copyOrder(only)
}

/**
 * 규칙 제안 (R-20 10 "규칙 제안", D-A1-02). catalog = 그 방송의 판매 종료가 아닌 상품, settings = 그 방송의 설정(claim.maxNumber·maxQuantity·multiNumber).
 * - UNKNOWN_WORD: 공백 덩어리 하나를 비슷한 선택지의 label로 바꿔 R-20으로 다시 읽어, 읽은 번호의 주문 하나가 되는 서로 다른 후보가 정확히 하나일 때
 * - PRODUCT_AMBIGUOUS: 상품 하나씩만 남긴 목록으로 다시 읽어 주문 하나가 나오는 상품이 정확히 하나일 때
 * - 그 밖의 사유는 null
 */
export function ruleSuggestion(text: string, review: ReviewRead, catalog: readonly OptionCatalogEntry[], settings: SettingsOverride): Suggestion | null {
  if (typeof text !== 'string') return null
  if (review.reason === 'UNKNOWN_WORD') {
    const no = review.no
    if (no === undefined) return null
    const product = catalog.find((entry) => entry.no === no)
    if (product === undefined || (product.options ?? []).length === 0) return null
    const chunks = normalizeText(text).split(' ')
    const candidates = new Map<string, Suggestion>()
    chunks.forEach((chunk, index) => {
      if (chunk === '') return
      for (const item of product.options ?? []) {
        for (const choice of item.choices) {
          const names = [choice.label, ...(choice.aliases ?? [])]
          if (!names.some((name) => similar(chunk, name))) continue
          const replaced = chunks.map((part, at) => (at === index ? choice.label : part)).join(' ')
          const parsed = parseOptionComment(replaced, catalog, null, settings)
          const order = parsed.orders.length === 1 ? parsed.orders[0] : undefined
          if (order !== undefined && order.no === no) candidates.set(orderKey(order), order)
        }
      }
    })
    return onlyOne(candidates)
  }
  if (review.reason === 'PRODUCT_AMBIGUOUS') {
    const candidates = new Map<string, Suggestion>()
    let products = 0
    for (const entry of catalog) {
      const parsed = parseOptionComment(text, [entry], null, settings)
      if (parsed.orders.length !== 1) continue
      const order = parsed.orders[0] as Suggestion
      products++
      candidates.set(orderKey(order), order)
    }
    return products === 1 ? onlyOne(candidates) : null
  }
  return null
}

// ── 가리기 (R-20 10 "가리기", D-A1-06) ────────────────────────────────

/** AI로 보내는 글의 최대 글자 수 (코드 포인트) */
export const REDACT_MAX_CHARS = 200
const MASK = '***'
const PHONE_DIGITS = 7
/** 숫자로 쓰는 모든 글자 (0~9, ①, ⓪, 전각 숫자 …) — D-A1-10 */
const NUMBER_CHAR = /\p{N}/gu

const isDigitChar = (s: string, i: number): boolean => {
  const code = s.charCodeAt(i)
  return code >= 0x30 && code <= 0x39
}

/** 숫자 사이에 공백·'-'·'.'이 하나씩 끼어도 이어진 숫자가 7개 이상이면 그 구간을 *** 로 */
function maskDigitRuns(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (!isDigitChar(s, i)) {
      out += s[i]
      i++
      continue
    }
    const start = i
    let digits = 0
    let end = i
    for (;;) {
      while (isDigitChar(s, end)) {
        digits++
        end++
      }
      const sep = s[end]
      if ((sep === ' ' || sep === '-' || sep === '.') && isDigitChar(s, end + 1)) {
        end++
        continue
      }
      break
    }
    out += digits >= PHONE_DIGITS ? MASK : s.slice(start, end)
    i = end
  }
  return out
}

/**
 * AI로 보낼 글: 정규화(R-20 1) → '@'가 든 덩어리 빼기 → 이어진 숫자 7개 이상 *** → 공백 정리 →
 * 숫자 글자(\p{N})가 모두 합쳐 7개 이상 남으면 빈 글(D-A1-10, 자르기 전에 센다) → 앞 200글자. 빈 글이면 ''(보내지 않는다)
 */
export function redact(text: string): string {
  if (typeof text !== 'string') return ''
  const normalized = normalizeText(text)
  const kept = normalized === '' ? '' : normalized.split(' ').filter((chunk) => !chunk.includes('@')).join(' ')
  const masked = maskDigitRuns(kept)
  const tidy = normalizeText(masked)
  if ((tidy.match(NUMBER_CHAR) ?? []).length >= PHONE_DIGITS) return ''
  return points(tidy).slice(0, REDACT_MAX_CHARS).join('')
}

// ── 응답 검사 (R-20 10 "응답 검사", D-A1-05) ──────────────────────────

/** AI에 보낸 항목 (id = 요청 안에서만 쓰는 글자 번호, no = 엔진이 읽은 번호 — 없으면 키 없음) */
export interface SentItem {
  readonly id: string
  readonly no?: number
}

const SUGGESTION_KEYS: ReadonlySet<string> = new Set(['id', 'no', 'options', 'qty'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 선택지 이름·별칭(비교 글자)으로 맞으면 그 label */
function choiceLabel(item: OptionItem, value: string): string | null {
  const wanted = compareChars(value)
  if (wanted === '') return null
  for (const choice of item.choices) {
    if (compareChars(choice.label) === wanted) return choice.label
    if ((choice.aliases ?? []).some((alias) => compareChars(alias) === wanted)) return choice.label
  }
  return null
}

/** 정수 글자 그대로가 아닌 숫자(`1e1`·`10.0`·`-0`)는 숫자로 보지 않는다 — 모델 답의 수량·번호는 정수 글자만 받는다 */
const INTEGER_SOURCE = /^-?(?:0|[1-9][0-9]*)$/
const NOT_A_NUMBER = Object.freeze({ notANumber: true })
function strictNumbers(_key: string, value: unknown, context?: { readonly source?: string }): unknown {
  if (typeof value !== 'number') return value
  const source = context?.source
  if (source !== undefined && (!INTEGER_SOURCE.test(source) || source === '-0')) return NOT_A_NUMBER
  return value
}

/** 답 한 줄 검사 → 제안 또는 null */
function checkLine(line: Record<string, unknown>, sent: SentItem, catalog: readonly OptionCatalogEntry[], maxQuantity: number): Suggestion | null {
  if (Object.keys(line).some((key) => !SUGGESTION_KEYS.has(key))) return null
  const no = line.no
  if (typeof no !== 'number' || !Number.isSafeInteger(no)) return null
  if (sent.no !== undefined && no !== sent.no) return null
  const product = catalog.find((entry) => entry.no === no)
  if (product === undefined) return null
  const qty = line.qty
  if (typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty < 1 || qty > maxQuantity) return null
  const raw = Object.hasOwn(line, 'options') ? line.options : {}
  if (!isRecord(raw)) return null
  const items = product.options ?? []
  const given = Object.keys(raw)
  if (given.some((name) => !items.some((item) => item.name === name))) return null
  if (items.length === 0) return { no, qty }
  const picked: Record<string, string> = {}
  for (const item of items) {
    if (Object.hasOwn(raw, item.name)) {
      const value = raw[item.name]
      if (typeof value !== 'string') return null
      const label = choiceLabel(item, value)
      if (label === null) return null
      picked[item.name] = label
    } else if (item.choices.length === 1) {
      picked[item.name] = (item.choices[0] as { label: string }).label
    } else return null
  }
  return { no, options: picked, qty }
}

/**
 * 모델 답 검사 (R-20 10): 응답 전체가 JSON 객체 `{ "suggestions": [...] }` 하나여야 한다(앞뒤 공백만 허용). 형식이 틀리면 모두 null.
 * 항목마다 보낸 id 하나에 한 번·모르는 키 없음·번호는 목록의 상품(읽은 번호가 있으면 그 번호)·옵션은 모든 항목(선택지 하나뿐인 항목은 채움)·
 * 선택지 이름이나 별칭(비교 글자, 이름으로 바꿈)·수량 1~maxQuantity 정수. 어긋나거나 빠진 항목은 null
 */
export function validateResponse(items: readonly SentItem[], response: unknown, catalog: readonly OptionCatalogEntry[], maxQuantity: number): Record<string, Suggestion | null> {
  const out = new Map<string, Suggestion | null>(items.map((item) => [item.id, null]))
  const result = () => Object.fromEntries(out) as Record<string, Suggestion | null>
  if (typeof response !== 'string') return result()
  let parsed: unknown
  try {
    parsed = JSON.parse(response, strictNumbers as (key: string, value: unknown) => unknown)
  } catch {
    return result()
  }
  if (!isRecord(parsed)) return result()
  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'suggestions') return result()
  const lines = parsed.suggestions
  if (!Array.isArray(lines) || lines.some((line) => !isRecord(line))) return result()
  const sentById = new Map(items.map((item) => [item.id, item]))
  const seen = new Map<string, number>()
  for (const line of lines as Record<string, unknown>[]) {
    const id = line.id
    if (typeof id === 'string' && sentById.has(id)) seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  for (const line of lines as Record<string, unknown>[]) {
    const id = line.id
    if (typeof id !== 'string' || seen.get(id) !== 1) continue
    const sent = sentById.get(id) as SentItem
    out.set(id, checkLine(line, sent, catalog, maxQuantity))
  }
  return result()
}

// ── 호출 고르기 (R-20 10, D-A1-03·D-A1-04) ────────────────────────────

export interface PlanItem {
  readonly id: string
  readonly origin: 'chat' | 'sms'
  readonly reason: string
  readonly no: number | null
  /** 규칙 제안이 있는지 */
  readonly rule: boolean
  /** 같은 캐시 키의 AI 결과가 있는지 */
  readonly cached: boolean
  readonly text: string
}

export interface PlanInput {
  readonly enabled: boolean
  readonly hasKey: boolean
  readonly usedToday: number
  readonly dailyLimit: number
  readonly globalUsed: number
  readonly globalLimit: number
  readonly batchMax: number
  /** 한 방송의 확인 필요 항목, 원래 순위 순 */
  readonly items: readonly PlanItem[]
}

/** 같은 캐시 키 = (가린 글, 읽은 번호) — 방송은 부르는 쪽이 나눈다 */
export const cacheKeyOf = (redacted: string, no: number | null): string => `${String(no ?? 0)}\u0000${redacted}`

/**
 * AI로 보낼 항목과 그 순서: 켜짐·키 있음·상한 안일 때만, 채팅 항목·사유 UNKNOWN_WORD·PRODUCT_AMBIGUOUS·규칙 제안 없음·캐시 없음·가린 글이 빈 글이 아님,
 * 같은 (가린 글, 읽은 번호)는 처음 하나만, 원래 순위 순으로 batchMax개까지. 빈 목록이면 부르지 않는다
 */
export function planAssist(input: PlanInput): { send: string[] } {
  if (!input.enabled || !input.hasKey) return { send: [] }
  if (input.usedToday >= input.dailyLimit || input.globalUsed >= input.globalLimit) return { send: [] }
  const send: string[] = []
  const keys = new Set<string>()
  for (const item of input.items) {
    if (send.length >= input.batchMax) break
    if (item.origin !== 'chat' || !SUGGEST_REASONS.has(item.reason) || item.rule || item.cached) continue
    const redacted = redact(item.text)
    if (redacted === '') continue
    const key = cacheKeyOf(redacted, item.no)
    if (keys.has(key)) continue
    keys.add(key)
    send.push(item.id)
  }
  return { send }
}
