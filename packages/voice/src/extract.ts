// 음성 문장 추출 (VOC-02·VOC-03, DOMAIN_RULES R-17, D-202·D-203, 끊어 말한 번호 D-I4-01). 사례: tests/golden/parser/voice-extract.yaml.
// 방송자가 말한 문장 하나 → 정확히 { no, name, price, confidence }. 애매하면 그 칸을 비운다(null).
// 순수 함수: 같은 입력이면 같은 결과, 넘긴 사전·설정을 바꾸지 않고, 시계·난수·네트워크를 쓰지 않으며, 어떤 입력에도 예외를 던지지 않는다.
// 정규화(R-3)·금액(R-14)·수사(R-15)는 코어 함수를 그대로 다시 쓴다 — 코어와 결과가 갈라지지 않게.
import { normalizeText, parseAmount, parseKoreanNumber } from '@livejjim/core'
import { VarietyDictionary, type DictionaryEntry } from './dictionary.ts'
import { BIT_PATTERN_MAX, JamoPattern, bitParallelDistance, candidateLengthRange, compareSimilarity, isCandidate, jamoKey, jamoOf, type Similarity } from './jamo.ts'

export type Confidence = 'HIGH' | 'LOW'

/** 추출 결과 — 정확히 네 키 */
export interface VoiceExtraction {
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  readonly confidence: Confidence
}

export interface ExtractOptions {
  /** claim.maxNumber (생략하거나 1 이상 정수가 아니면 999) */
  readonly maxNumber?: number
  /** 품종 사전: 이름 목록(사전 규칙을 여기서도 적용한다) 또는 prepareDictionary로 준비한 사전. 생략하면 빈 사전 */
  readonly dictionary?: readonly string[] | VarietyDictionary
}

/** 정규화한 문장의 최대 길이(코드 포인트). 넘으면 아무것도 뽑지 않는다 (R-17 1) */
export const SENTENCE_MAX_CODE_POINTS = 300
/** claim.maxNumber 기본값 (DOMAIN_RULES 설정표) */
const DEFAULT_MAX_NUMBER = 999
/** 끝말 21개 (R-17 2). 읽는 모양은 짧은 끝말부터 뗀다 */
export const ENDINGS: readonly string[] = Object.freeze([
  '이에요',
  '예요',
  '에요',
  '입니다',
  '이요',
  '이고',
  '이랑',
  '하고',
  '짜리',
  '에는',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '엔',
  '도',
  '요',
  '랑',
])
const ENDINGS_SHORT_FIRST: readonly string[] = [...ENDINGS].sort((a, b) => a.length - b.length)
/** 토큰 끝에서 지우는 문장 부호 (R-17 1) */
const TRAILING_PUNCTUATION = new Set(['.', ',', '?', '!', '~'])
/** 한자어 수사 글자 (R-17 3) */
const SINO_NUMERAL = new Set([...'일이삼사오육칠팔구십백천'])
/** 한글 수·단위 (R-17 4: 가격 묶음의 글에 있어야 하는 글자, `원`과 함께) */
const KOREAN_AMOUNT = new Set([...'일이삼사오육칠팔구십백천만'])
/** 금액 글자 토큰을 이루는 글자 (R-17 4 금액 조각) */
const AMOUNT_TOKEN_CHARS = new Set([...'0123456789,.일이삼사오육칠팔구십백천만'])
/** 단위로 시작하는 묶음 (R-17 4 금액 조각) */
const UNIT_START = new Set([...'십백천만'])
const WON = '원'
const BEON = '번'
/** 가격 묶음 최대 토큰 수 (R-17 4) */
const PRICE_MAX_TOKENS = 6
/** 품종 창 최대 토큰 수 (R-17 5) */
const WINDOW_MAX_TOKENS = 4
/** 말 금액은 원 단위로 읽는다 (price.unit과 상관없다, D-202) */
const WON_UNIT = { 'price.unit': 'WON' } as const

const EMPTY: VoiceExtraction = Object.freeze({ no: null, name: null, price: null, confidence: 'LOW' })

// ── 1·2. 토큰과 읽는 모양 ────────────────────────────────────────────────

function codePointCount(text: string): number {
  let n = 0
  for (const _ of text) n++
  return n
}

/** 토큰 끝의 문장 부호를 모두 지운다 */
function stripTrailingPunctuation(token: string): string {
  let end = token.length
  while (end > 0 && TRAILING_PUNCTUATION.has(token.charAt(end - 1))) end--
  return token.slice(0, end)
}

/** R-17 1: 정규화 → 공백으로 나누기 → 끝 문장 부호 지우기 → 빈 토큰 버리기. 300글자를 넘으면 null */
export function tokenize(text: unknown): string[] | null {
  const normalized = normalizeText(typeof text === 'string' ? text : '')
  if (codePointCount(normalized) > SENTENCE_MAX_CODE_POINTS) return null
  if (normalized === '') return []
  return normalized
    .split(' ')
    .map(stripTrailingPunctuation)
    .filter((token) => token !== '')
}

/** R-17 2: 토큰 그대로, 그다음 끝말 하나를 뗀 모양(남는 글자가 있을 때만, 짧은 끝말부터) */
export function readingForms(token: string): string[] {
  const forms = [token]
  for (const ending of ENDINGS_SHORT_FIRST) {
    if (token.length > ending.length && token.endsWith(ending)) forms.push(token.slice(0, -ending.length))
  }
  return forms
}

// ── 3. 번호 ──────────────────────────────────────────────────────────────

const isDigitString = (text: string): boolean => /^[0-9]{1,4}$/.test(text)
const isSinoOnly = (text: string): boolean => text !== '' && [...text].every((char) => SINO_NUMERAL.has(char))

/** 번호 표시의 X → 값 (R-17 3). X는 숫자 1~4자리 또는 한자어 수사 글자만, `이` 한 글자는 아니다. 값은 R-15 */
function numberValue(x: string): number | null {
  if (x === '이') return null
  if (!isDigitString(x) && !isSinoOnly(x)) return null
  return parseKoreanNumber(x)
}

export interface NumberMarkers {
  /** 번호 표시에 속한 토큰 위치 */
  readonly tokens: ReadonlySet<number>
  /** 번호 표시 값 (나온 것 전부) */
  readonly values: readonly number[]
  /** 끊어 말한 번호가 하나라도 있는가 (R-17 3, D-I4-01) */
  readonly split: boolean
}

/**
 * 끊어 말한 번호 (R-17 3, D-I4-01, TD-P2-002): 번호 표시의 X 바로 앞 토큰(그대로 — 끝말을 떼지 않는다)을 X 앞에 공백 없이 붙인 글이
 * R-15로 읽히면 번호를 끊어 말했거나 인식이 번호를 갈랐을 수 있다(`1 5번` → `15`, `십 오번` → `십오`, `이 십 번` → `이십`, `백 오번` → `백오`).
 * 앞 토큰이 없거나 붙인 글이 수가 아니면 해당 없다(`이 15번` → `이15`, `네 15번` → `네15`).
 */
function isSplitNumber(previous: string | undefined, x: string): boolean {
  return previous !== undefined && parseKoreanNumber(previous + x) !== null
}

/**
 * 번호 표시 찾기 (R-17 3). R-21 7(V1)도 같은 코드를 쓴다: `skip`이 참인 토큰(맡은 토큰)은 표시 토큰이 될 수 없다.
 * 끊어 말한 번호 검사의 앞 토큰은 맡은 토큰이어도 그대로 본다(R-21 7).
 */
export function findNumberMarkers(tokens: readonly string[], forms: readonly (readonly string[])[], skip: (i: number) => boolean = () => false): NumberMarkers {
  const marked = new Set<number>()
  const values: number[] = []
  let split = false
  tokens.forEach((token, i) => {
    if (skip(i)) return
    const previous = i > 0 ? tokens[i - 1] : undefined
    // 붙여 씀: 읽는 모양 하나가 `X번` (앞 토큰 = 표시 토큰의 앞 토큰)
    for (const form of forms[i] ?? []) {
      if (form.length < 2 || !form.endsWith(BEON)) continue
      const x = form.slice(0, -BEON.length)
      const value = numberValue(x)
      if (value === null) continue
      marked.add(i)
      values.push(value)
      if (isSplitNumber(previous, x)) split = true
    }
    // 띄어 씀: 토큰 X(그대로) 바로 다음 토큰의 읽는 모양 하나가 `번` (앞 토큰 = X 토큰의 앞 토큰)
    const next = forms[i + 1]
    if (next !== undefined && next.includes(BEON) && !skip(i + 1)) {
      const value = numberValue(token)
      if (value !== null) {
        marked.add(i)
        marked.add(i + 1)
        values.push(value)
        if (isSplitNumber(previous, token)) split = true
      }
    }
  })
  return { tokens: marked, values, split }
}

// ── 4. 가격 ──────────────────────────────────────────────────────────────

interface PriceBundle {
  readonly start: number
  readonly end: number
  readonly value: number
  /** 읽은 글 (마지막 토큰은 처음 읽힌 읽는 모양) */
  readonly text: string
}

const hasWonOrKoreanAmount = (text: string): boolean => text.includes(WON) || [...text].some((char) => KOREAN_AMOUNT.has(char))
const isAmountToken = (token: string): boolean => token !== '' && [...token].every((char) => AMOUNT_TOKEN_CHARS.has(char))

/** 한 시작 토큰에서 잡을 수 있는 가장 긴 묶음 (없으면 null) */
function longestBundleAt(tokens: readonly string[], forms: readonly (readonly string[])[], start: number, isMarker: (i: number) => boolean): PriceBundle | null {
  let best: PriceBundle | null = null
  for (let length = 1; length <= PRICE_MAX_TOKENS; length++) {
    const end = start + length - 1
    if (end >= tokens.length || isMarker(end)) break
    const prefix = tokens.slice(start, end).join(' ')
    for (const form of forms[end] ?? []) {
      const text = prefix === '' ? form : `${prefix} ${form}`
      const value = parseAmount(text, WON_UNIT)
      if (value === null) continue
      // 처음 읽히는 값이 조건에 맞아야 묶음이다 (뒤의 읽는 모양은 보지 않는다)
      if (value >= 100 && hasWonOrKoreanAmount(text)) best = { start, end, value, text }
      break
    }
  }
  return best
}

function findPrice(tokens: readonly string[], forms: readonly (readonly string[])[], isMarker: (i: number) => boolean): { price: number | null; tokens: ReadonlySet<number> } {
  const bundles: PriceBundle[] = []
  let i = 0
  while (i < tokens.length) {
    if (isMarker(i)) {
      i++
      continue
    }
    const bundle = longestBundleAt(tokens, forms, i, isMarker)
    if (bundle === null) {
      i++
      continue
    }
    bundles.push(bundle)
    i = bundle.end + 1
  }
  const inBundle = new Set<number>()
  for (const bundle of bundles) for (let j = bundle.start; j <= bundle.end; j++) inBundle.add(j)
  // 금액 조각: 이웃 토큰이 번호 표시나 다른 묶음에 속하면 보지 않는다
  const fragmentNeighbour = (j: number): boolean => j >= 0 && j < tokens.length && !isMarker(j) && !inBundle.has(j) && isAmountToken(tokens[j] as string)
  const ambiguous = bundles.some(
    (bundle) =>
      (UNIT_START.has(bundle.text.charAt(0)) && fragmentNeighbour(bundle.start - 1)) || (!bundle.text.endsWith(WON) && fragmentNeighbour(bundle.end + 1)),
  )
  const values = new Set(bundles.map((bundle) => bundle.value))
  const price = !ambiguous && values.size === 1 ? (bundles[0] as PriceBundle).value : null
  return { price, tokens: inBundle }
}

// ── 5. 품종 ──────────────────────────────────────────────────────────────

/** 창의 글(공백 없이 이은 것, 마지막 토큰은 읽는 모양마다) 전부 */
function windowTexts(tokens: readonly string[], forms: readonly (readonly string[])[], excluded: (i: number) => boolean): Set<string> {
  const texts = new Set<string>()
  let segmentStart = 0
  for (let i = 0; i <= tokens.length; i++) {
    if (i < tokens.length && !excluded(i)) continue
    // [segmentStart, i) = 뺀 토큰에서 끊긴 덩어리
    for (let start = segmentStart; start < i; start++) {
      for (let end = start; end < i && end < start + WINDOW_MAX_TOKENS; end++) {
        const prefix = tokens.slice(start, end).join('')
        for (const form of forms[end] ?? []) texts.add(prefix + form)
      }
    }
    segmentStart = i + 1
  }
  return texts
}

/** 창 하나와 사전 이름의 거리 함수 (limit을 넘으면 limit보다 큰 값) */
function distanceFrom(jamo: readonly number[], dictionary: VarietyDictionary): (entry: DictionaryEntry, limit: number) => number {
  if (jamo.length > BIT_PATTERN_MAX) {
    const pattern = new JamoPattern(jamo)
    return (entry) => pattern.distanceTo(entry.jamo)
  }
  // 사전 기호 번호로 일치 비트를 만든다 — 사전에 없는 자모는 어떤 이름과도 맞지 않는다
  const peq = new Int32Array(dictionary.symbols.size)
  jamo.forEach((code, i) => {
    const id = dictionary.symbols.get(code)
    if (id !== undefined) peq[id] = (peq[id] as number) | (1 << i)
  })
  return (entry, limit) => bitParallelDistance(jamo.length, peq, entry.ids, limit)
}

interface VarietyMatch {
  readonly name: string | null
  readonly exact: boolean
}

function findVariety(texts: ReadonlySet<string>, dictionary: VarietyDictionary): VarietyMatch {
  const top: { similarity: Similarity | null; readonly entries: Map<string, DictionaryEntry> } = { similarity: null, entries: new Map() }
  const consider = (similarity: Similarity, entry: DictionaryEntry): void => {
    const order = top.similarity === null ? 1 : compareSimilarity(similarity, top.similarity)
    if (order > 0) {
      top.similarity = similarity
      top.entries.clear()
    }
    if (order >= 0) top.entries.set(entry.key, entry)
  }
  // 유사도 1(공백만 다름)이 하나라도 있으면 그보다 높은 유사도는 없다 — 거리 계산을 건너뛴다
  for (const text of texts) {
    const jamo = jamoOf(text)
    for (const entry of dictionary.byJamo.get(jamoKey(jamo)) ?? []) consider({ distance: 0, length: jamo.length }, entry)
  }
  if (top.similarity === null) {
    for (const text of texts) {
      const jamo = jamoOf(text)
      if (jamo.length === 0) continue
      const distance = distanceFrom(jamo, dictionary)
      const range = candidateLengthRange(jamo.length)
      for (let length = range.min; length <= range.max; length++) {
        const longer = Math.max(jamo.length, length)
        // 길이 차만으로도 지금 가장 높은 유사도에 못 미치면 그 길이의 이름은 보지 않는다 (같은 유사도는 봐야 한다 — 동률 판단)
        if (top.similarity !== null && compareSimilarity({ distance: Math.abs(jamo.length - length), length: longer }, top.similarity) < 0) continue
        const limit = Math.floor(longer / 5)
        for (const entry of dictionary.byLength.get(length) ?? []) {
          const similarity = { distance: distance(entry, limit), length: longer }
          if (isCandidate(similarity)) consider(similarity, entry)
        }
      }
    }
  }
  if (top.similarity === null) return { name: null, exact: false }
  const entries = [...top.entries.values()]
  // 가장 높은 유사도의 이름이 여럿이면 나머지를 모두 품는(공백 뺀 글자로 부분 문자열) 이름만
  const container = entries.find((entry) => entries.every((other) => entry.key.includes(other.key)))
  return { name: container === undefined ? null : container.name, exact: top.similarity.distance === 0 }
}

// ── 추출 ─────────────────────────────────────────────────────────────────

function resolveMaxNumber(options: unknown): number {
  const value = typeof options === 'object' && options !== null ? (options as { maxNumber?: unknown }).maxNumber : undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_MAX_NUMBER
}

function resolveDictionary(options: unknown): VarietyDictionary {
  const value = typeof options === 'object' && options !== null ? (options as { dictionary?: unknown }).dictionary : undefined
  if (value instanceof VarietyDictionary) return value
  return new VarietyDictionary(Array.isArray(value) ? value : [])
}

/**
 * 문장 하나 → { no, name, price, confidence } (R-17).
 * - no: 번호 표시(`X번`·`X 번`, X = 숫자 1~4자리 또는 한자어 수사, `이` 제외) 값이 모두 같고 1..maxNumber 안이고 끊어 말한 번호가 없으면 그 값
 * - price: 원 단위로 읽은 말 금액 묶음 값이 모두 같고 금액 조각·끊어 말한 번호가 없으면 그 값 (100원 이상, `원`이나 한글 수·단위가 있는 글)
 * - 끊어 말한 번호(D-I4-01): 번호 표시의 X 바로 앞 토큰 + X가 R-15로 읽히는 표시가 하나라도 있으면 no·price 모두 null
 * - name: 사전에서 자모 유사도 0.8 이상으로 가장 가까운 이름(여럿이면 나머지를 모두 품는 이름) — 사전에 없는 말은 넣지 않는다
 * - confidence: 셋이 모두 있고 품종이 사전 이름과 공백만 다르면 HIGH
 */
export function extractVoice(text: unknown, options: ExtractOptions = {}): VoiceExtraction {
  const tokens = tokenize(text)
  if (tokens === null || tokens.length === 0) return { ...EMPTY }
  const maxNumber = resolveMaxNumber(options)
  const dictionary = resolveDictionary(options)
  const forms = tokens.map(readingForms)

  const markers = findNumberMarkers(tokens, forms)
  const isMarker = (i: number): boolean => markers.tokens.has(i)
  const distinctNumbers = new Set(markers.values)
  const onlyNumber = distinctNumbers.size === 1 ? (markers.values[0] as number) : null
  // 끊어 말한 번호가 있으면 번호·가격을 모두 비운다 — 앞 조각이 가격으로도 읽힐 수 있다(`백 오번`의 `백` = 100원, D-I4-01)
  const no = !markers.split && onlyNumber !== null && onlyNumber >= 1 && onlyNumber <= maxNumber ? onlyNumber : null

  const bundles = findPrice(tokens, forms, isMarker)
  const price = markers.split ? null : bundles.price
  // 가격을 비워도 묶음 토큰은 품종 창에서 뺀다 (R-17 4·5)
  const variety = findVariety(
    windowTexts(tokens, forms, (i) => isMarker(i) || bundles.tokens.has(i)),
    dictionary,
  )

  const confidence: Confidence = no !== null && price !== null && variety.name !== null && variety.exact ? 'HIGH' : 'LOW'
  return { no, name: variety.name, price, confidence }
}
