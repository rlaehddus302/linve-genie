// V3 덩어리를 조각으로 소비하는 확정 읽기 (DOMAIN_RULES R-17 8, D-V3-46·D-V3-48). 실방송 7차: 쉬지 않고 이어 말해 한 덩어리에 93번·97번이 쌓였다.
// 덩어리 글(모은 최종 결과 + 지금 중간 결과)을 앞에서부터 읽어 "N번 … 가격 원" 짝마다 등록할 값(pick)을 낸다 — 화면은 pick마다 한 번씩 바로 등록한다.
// 순수 함수: 시계·난수를 쓰지 않고 어떤 입력에도 예외를 던지지 않는다.
import { parseAmount, parseKoreanNumber, type PriceUnit } from '@livejjim/core'
import { analyzeSentence, listNumberMarkers, listWonLines, punctuatedTokens, readSentence, readingForms, tokenize } from './extract.ts'
import { isBigChange, readRegistration, type ReadyBlock, type RegistrationOptions } from './register.ts'
import { DEFAULT_COMMON_ALIASES } from './default-dictionary.ts'
import { VarietyDictionary } from './dictionary.ts'
import { CANCEL_WORDS, CORRECTION_MARKERS, isWindowFiller } from './words.ts'
import { hasPriceCorrection } from './price-gate.ts'
import { isPastPriceLine } from './past-price.ts'

export interface SegmentOptions extends RegistrationOptions {
  /** 그 방송의 판매 규칙 price.unit — "N번 품종 수" 꼴(D-V3-48)의 수를 읽는 단위. 생략 = WON */
  readonly priceUnit?: PriceUnit
}

/** 조각 하나에서 고른 등록 값 */
export interface SegmentPick {
  readonly no: number
  readonly price: number
  /** 사전 맞춤 이름 (없으면 null = 품종 미입력) */
  readonly name: string | null
  readonly numberFrom: 'marker' | 'bare'
  /** 가격을 낸 것: 원 가격 줄(won) · "N번 품종 수" 꼴(quick, D-V3-48) */
  readonly priceFrom: 'won' | 'quick'
  /** 짝의 첫 토큰 위치 (덩어리 글 토큰 기준) */
  readonly start: number
  /** 소비한 마지막 토큰 위치 — 다음 조각은 그 뒤부터 */
  readonly end: number
  /** 바로 등록하지 않고 카드로만 보일 까닭 — D-V3-64부터 늘 null(가격 크기로는 막지 않는다). 옛 모양을 위해 남김 */
  readonly blocked: ReadyBlock | null
  /** 크게 바뀜 (R-25, D-V3-64): 등록 가격 > 3,000,000원 — 막지 않고 기록에 표시 */
  readonly bigChange: boolean
}

export interface SegmentReading {
  /** 덩어리 글 토큰 (R-17 1) */
  readonly tokens: readonly string[]
  /** 앞에서부터 고른 등록 값 (조각마다 하나) */
  readonly picks: readonly SegmentPick[]
  /** 버렸거나 끝까지 짝을 못 찾은 다른 'N번' (고른 번호와 다른 값, 겹친 값 한 번) — 덩어리 끝 알림(D-V3-46 4) */
  readonly others: readonly number[]
  /** 고른 뒤 남은 조각이 정정·취소로 시작하고 'N번'이 없으면: 방금 고른 번호를 고침(R-22)·되돌림 (D-V3-46 5) */
  readonly tail: { readonly kind: 'correction' | 'cancel'; readonly no: number; readonly text: string } | null
  /** 마지막으로 소비한 뒤 남은 글 */
  readonly rest: string
  /**
   * 중간 결과에서 가격 뒤 낱말을 기다리느라 picks에서 뺀 조각 (글 끝이 `원까지`·`원에` — 지난 일 가격 `120만 원까지 팔아 본 적` 일 수 있다).
   * 없는 번호의 새 등록은 이것으로 바로 해도 된다(R1 — `108번 … 10만 원까지` 때 등록), 있는 상품의 가격은 이것으로 고치지 않는다. 최종 결과면 늘 빈 목록. 옛 모양에는 없다
   */
  readonly held?: readonly SegmentPick[]
}

const EMPTY: SegmentReading = Object.freeze({ tokens: Object.freeze([]), picks: Object.freeze([]), others: Object.freeze([]), tail: null, rest: '' })
const MALGO = '말고'
const isCorrectionToken = (token: string): boolean => CORRECTION_MARKERS.includes(token) || token.endsWith(MALGO)
const isCancelToken = (token: string): boolean => CANCEL_WORDS.includes(token)
/** "N번 품종 수"의 수 토큰: 숫자 1~4자리·쉼표 묶음, 한글 수 두 글자 이상, 단위 붙은 금액(`6만`) */
const QUICK_NUMBER = /^([0-9]{1,4}|[0-9]{1,3}(,[0-9]{3})+|[0-9일이삼사오육칠팔구십백천만,.]{2,})$/

function maxNumberOf(options: SegmentOptions): number {
  const value = options.maxNumber
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 999
}

/** 사전 이름이 tokens[k..]의 앞 1~4토큰 창과 맞으면 그 창의 마지막 위치 (가장 긴 것), 아니면 -1 */
// 'N번' 표시 토큰(한글로 적힌 `십오번` 포함)에서도 멈춘다 — 숫자 꼴(`15번`)과 같게 (TD-V3-011)
function nameWindowEnd(tokens: readonly string[], k: number, options: SegmentOptions, markerAt: ReadonlySet<number> = new Set()): { end: number; name: string } | null {
  let found: { end: number; name: string } | null = null
  for (let j = k; j < tokens.length && j < k + 4; j++) {
    const piece = tokens.slice(k, j + 1)
    if (markerAt.has(j) || piece.some((token) => isWindowFiller(token) || /[0-9]/.test(token) || isCorrectionToken(token) || isCancelToken(token))) break
    const reading = readSentence(piece.join(' '), { dictionary: options.dictionary ?? [] })
    if (reading.extraction.name !== null && reading.nameWindow !== null && reading.nameWindow.startsWith(piece[0] as string)) found = { end: j, name: reading.extraction.name }
    else if (found === null && piece.length === 1) {
      const alias = commonAliasIn(piece, options)
      if (alias !== null) found = { end: j, name: alias }
    }
  }
  return found
}

/** 한 글자 다른 이름 맞추기에 쓰는 이름 길이 하한 (음절) */
export const ONE_SYLLABLE_MIN = 3

/** 사전 이름 (공백 뺀 모양 → 이름, 별칭 아님) */
function dictionaryNames(options: SegmentOptions): { readonly key: string; readonly name: string }[] {
  const dictionary = options.dictionary
  if (dictionary instanceof VarietyDictionary) return dictionary.entries.filter((entry) => entry.alias !== true).map((entry) => ({ key: entry.key, name: entry.name }))
  return Array.isArray(dictionary) ? dictionary.filter((item): item is string => typeof item === 'string').map((name) => ({ key: name.split(' ').join(''), name })) : []
}

const isHangulWord = (text: string): boolean => /^[가-힣]+$/.test(text)

/**
 * 한 글자 다른 사전 이름 (실방송 V3: "야래양"·"야래학" = 야래향 — 크롬이 향/양/학을 헷갈린다): 'N번'과 원 가격 사이 토큰(그대로 또는 끝말 뗀 모양)이
 * 한글 3음절 이상이고, 같은 길이의 사전 이름과 음절 하나만 다르면 그 이름. 그런 이름이 정확히 하나일 때만(둘 이상이면 비움).
 */
export function oneSyllableName(tokens: readonly string[], options: SegmentOptions): string | null {
  const names = dictionaryNames(options).filter((item) => isHangulWord(item.key) && [...item.key].length >= ONE_SYLLABLE_MIN)
  const found = new Set<string>()
  for (const token of tokens) {
    if (isWindowFiller(token)) continue
    for (const form of readingForms(token)) {
      if (!isHangulWord(form)) continue
      const chars = [...form]
      if (chars.length < ONE_SYLLABLE_MIN) continue
      for (const item of names) {
        const key = [...item.key]
        if (key.length !== chars.length) continue
        let differ = 0
        for (let i = 0; i < key.length && differ < 2; i++) if (key[i] !== chars[i]) differ++
        if (differ === 1) found.add(item.name)
      }
    }
  }
  return found.size === 1 ? ([...found][0] as string) : null
}

/** 흔한 말 별칭(D-V3-54)의 이름이 넘긴 사전에 있는가 */
function dictionaryHas(options: SegmentOptions, name: string): boolean {
  const dictionary = options.dictionary
  if (dictionary instanceof VarietyDictionary) return dictionary.byKey.has(name.split(' ').join(''))
  return Array.isArray(dictionary) && dictionary.some((item) => typeof item === 'string' && item.split(' ').join('') === name.split(' ').join(''))
}

/** 이어진 토큰 1~4개(군말 없이, 마지막 토큰은 그대로 또는 끝말 뗀 모양)를 공백 없이 이은 글이 사전 이름·별칭과 같은 곳이 있는가 */
function hearsDictionaryName(tokens: readonly string[], options: SegmentOptions): boolean {
  for (let start = 0; start < tokens.length; start++) {
    let head = ''
    for (let end = start; end < tokens.length && end < start + 4; end++) {
      const token = tokens[end] as string
      if (isWindowFiller(token)) break
      for (const form of readingForms(token)) if (dictionaryHas(options, head + form)) return true
      head += token
    }
  }
  return false
}

/** 조각 안 흔한 말 별칭(`녹음` → 녹금): 토큰(그대로 또는 끝말 뗀 모양)이 별칭이면 그 이름 */
function commonAliasIn(tokens: readonly string[], options: SegmentOptions): string | null {
  for (const token of tokens) {
    for (const form of readingForms(token)) {
      const name = DEFAULT_COMMON_ALIASES.get(form)
      if (name !== undefined && dictionaryHas(options, name)) return name
    }
  }
  return null
}

/** 빠른 꼴 수 뒤에 와도 조각 끝으로 보는 판매 말투 ("150번 180 가겠습니다") — 끝말 붙은 꼴은 끝말 뗀 모양으로 */
export const SALE_TAIL_WORDS: readonly string[] = Object.freeze([
  '갑니다', '가겠습니다', '갈게요', '가요', '드릴게요', '드릴게요요', '드려요', '드립니다', '드려볼게요', '드려봅니다', '드려', '볼게요', '보겠습니다', '줄게요',
  '보낼게요', '보냅니다', '보내요', '할게요', '입니다', '이에요', '예요', '요', '까지', '까지요',
])
/** 빠른 꼴 수 토큰에 붙어도 떼는 말 (`45에`·`45에요`·`180이요`·`180입니다`) */
const NUMBER_TAILS: readonly string[] = [...SALE_TAIL_WORDS, '에', '에요', '이요'].sort((a, b) => b.length - a.length)
const isSaleTail = (token: string): boolean => readingForms(token).some((form) => SALE_TAIL_WORDS.includes(form))

const skipFillers = (tokens: readonly string[], from: number): number => {
  let k = from
  while (k < tokens.length && isWindowFiller(tokens[k] as string)) k++
  return k
}

/** 덩어리 글 → 조각마다 등록 값 (R-17 8 조각, D-V3-46·48) */
export function readSegments(text: unknown, options: SegmentOptions = {}): SegmentReading {
  try {
    const tokens = tokenize(text)
    if (tokens === null || tokens.length === 0) return EMPTY
    const final = options.final === true
    const maxNumber = maxNumberOf(options)
    const unit: PriceUnit = options.priceUnit ?? 'WON'
    const punct = punctuatedTokens(text)
    const markers = listNumberMarkers(tokens, punct)
    // 중간 결과: 글 끝 가격이 지난 일 가격일지 몰라 기다리는 줄은 picks에서 빼고, 그 줄로 고를 조각은 held로 따로 (R1·실방송 468번)
    const allLines = listWonLines(tokens, { maxNumber, punct, final: true })
    const lines = final ? allLines : allLines.filter((line) => !isPastPriceLine(tokens, line.end, false))
    const reading = readPicks(tokens, options, final, maxNumber, unit, markers, lines)
    // held는 글 끝 토큰이 그 가격 줄 끝일 때만(`10만 원까지`) — 뒤에 경험담 꼴 앞부분(`팔`·`팔아`)이 이미 들렸으면 새 등록도 기다린다
    const last = tokens.length - 1
    if (lines.length === allLines.length || lines.some((line) => line.end === last) || !allLines.some((line) => line.end === last)) return reading
    const heldLines = allLines.filter((line) => lines.includes(line) || line.end === last)
    const done = new Set(reading.picks.map((item) => `${String(item.no)}@${String(item.start)}`))
    const held = readPicks(tokens, options, final, maxNumber, unit, markers, heldLines).picks.filter((item) => !done.has(`${String(item.no)}@${String(item.start)}`))
    return held.length === 0 ? reading : { ...reading, held }
  } catch {
    return EMPTY
  }
}

function readPicks(
  tokens: readonly string[],
  options: SegmentOptions,
  final: boolean,
  maxNumber: number,
  unit: PriceUnit,
  markers: ReturnType<typeof listNumberMarkers>,
  lines: ReturnType<typeof listWonLines>,
): SegmentReading {
  const markerAt = new Set<number>()
  for (const marker of markers) for (let i = marker.start; i <= marker.last; i++) markerAt.add(i)
  const picks: SegmentPick[] = []
  const dropped: number[] = []
  let s = 0
  const pick = (value: SegmentPick): void => {
    picks.push(value)
    s = value.end + 1
  }
  const correctionBetween = (from: number, to: number): boolean => tokens.slice(from, to + 1).some((token) => isCorrectionToken(token) || isCancelToken(token))
  for (let guard = 0; guard < tokens.length && s < tokens.length; guard++) {
    const segMarkers = markers.filter((marker) => marker.start >= s)
    const segLines = lines.filter((line) => line.start >= s)
    // '번' 없는 번호는 첫 조각에서, 첫 원 가격 줄 앞에 'N번'이 없을 때만 그 줄까지의 글로 본다 (D-V3-23·73).
    // 줄 뒤의 말은 보지 않는다 — 뒤에 낱말이 붙어도 이미 고른 값이 바뀌지 않게
    const firstLine = segLines[0]
    if (picks.length === 0 && firstLine !== undefined && !segMarkers.some((marker) => marker.start < firstLine.start)) {
      const ready = readRegistration(tokens.slice(s, firstLine.end + 1).join(' '), options).ready
      if (ready !== null && ready.numberFrom === 'bare') {
        pick({ no: ready.no, price: ready.price, name: ready.name, numberFrom: 'bare', priceFrom: 'won', start: s, end: firstLine.end, blocked: null, bigChange: isBigChange(null, ready.price) })
        continue
      }
    }
    if (segMarkers.length === 0) break
    // 1. 짝: 앞에 'N번'이 있는 첫 원 가격 줄 R과 그 앞 가장 뒤의 'N번' M
    const line = segLines.find((item) => segMarkers.some((marker) => marker.last < item.start))
    if (line !== undefined) {
      const before = segMarkers.filter((marker) => marker.last < line.start)
      const m = before[before.length - 1] as (typeof before)[number]
      for (const other of before) if (other.value !== m.value) dropped.push(other.value)
      if (m.split || line.value === null || m.value > maxNumber || correctionBetween(m.start, line.end)) break
      // 품종은 조각 범위(앞 조각이 소비된 끝 또는 앞 'N번' 뒤 ~ 이 원 가격) 안에서 찾는다 — 번호보다 먼저 말한 품종도(TE-V3-013), 다른 'N번' 앞의 품종은 쓰지 않는다
      // 앞 'N번' 바로 뒤(군말 건너)의 품종은 그 앞 번호의 것이다(`93번 청개구리 97번 23만 원`)
      const previous = before[before.length - 2]
      const ownedByPrevious = previous === undefined ? null : nameWindowEnd(tokens, skipFillers(tokens, previous.last + 1), options, markerAt)
      const lo = previous === undefined ? s : ownedByPrevious === null ? previous.last + 1 : ownedByPrevious.end + 1
      const reading = analyzeSentence(tokens.slice(lo, line.end + 1).join(' '), { dictionary: options.dictionary ?? [], maxNumber })
      // 흔한 말 별칭(`녹음` → 녹금)·한 글자 다른 이름(`야래양` → 야래향)은 'N번'과 원 가격 사이에서만 (D-V3-54)
      const slot = tokens.slice(m.last + 1, line.start)
      // 조각 범위에서 사전 이름(공백만 다른 맞춤)을 들었는데 이름이 비었으면 두 이름이 갈린 것 — 흔한 말 별칭·한 글자 다른 이름으로 채우지 않는다
      // (R-17 8 "사전 이름도 흔한 말 별칭도 못 찾았으면", D-V3-92 `89번 녹금 녹색금` → 비움 — 녹색금이 창색금과 한 글자 다르다)
      const heardName = reading.reading.extraction.name === null && hearsDictionaryName(tokens.slice(lo, line.end + 1), options)
      const name = reading.reading.extraction.name ?? (heardName ? null : (commonAliasIn(slot, options) ?? oneSyllableName(slot, options)))
      pick({ no: m.value, price: line.value, name, numberFrom: 'marker', priceFrom: 'won', start: m.start, end: line.end, blocked: null, bigChange: isBigChange(null, line.value) })
      continue
    }
    // 2. "N번 품종 수" (D-V3-48): 표시 → (군말) 사전 품종 → 수 → 조각 끝
    let quick: SegmentPick | null = null
    for (const m of segMarkers) {
      if (m.split || m.value > maxNumber) continue
      // D-V3-63: 품종 없이도 — 'N번' 바로 뒤(군말만 사이) 수가 조각 끝이면 (품종이 있으면 그 뒤 수)
      const k = skipFillers(tokens, m.last + 1)
      // 정정 표시·취소 낱말이 끼면 빠른 꼴이 아니다 (TD-V3-009 — `15번 다시 180`·`15번 취소 백육십팔`)
      if (correctionBetween(m.last + 1, k)) continue
      const name = nameWindowEnd(tokens, k, options, markerAt)
      const q = name === null ? k : name.end + 1
      // 정정 표시·취소 낱말(붙은 꼴 `만오천말고` 포함)이 번호와 수 사이에 끼면 빠른 꼴이 아니다 (TD-V3-009)
      if (correctionBetween(m.last + 1, q)) continue
      // 수에 붙은 판매 말투는 뗀다 (`180입니다`·`180까지요` — D-V3-69, AC-V3-73)
      const rawNumber = tokens[q]
      const attachedTail = rawNumber === undefined ? undefined : NUMBER_TAILS.find((tail) => rawNumber.length > tail.length && rawNumber.endsWith(tail) && QUICK_NUMBER.test(rawNumber.slice(0, -tail.length)))
      const numberToken = rawNumber !== undefined && attachedTail !== undefined ? rawNumber.slice(0, -attachedTail.length) : rawNumber
      if (numberToken === undefined || !QUICK_NUMBER.test(numberToken)) continue
      const next = markers.find((marker) => marker.start > q)
      const stop = next === undefined ? tokens.length : next.start
      // 뒤에 군말·판매 말투, 또는 같은 수를 다시 말한 것(`113번 45에 드려볼게요 자 45~` — 중복)만 오면 조각 끝
      const sameNumber = (token: string): boolean => token === numberToken || NUMBER_TAILS.some((tail) => token === numberToken + tail)
      if (tokens.slice(q + 1, stop).some((token) => !isWindowFiller(token) && !isSaleTail(token) && !sameNumber(token))) continue
      // 수 뒤에 정정·취소 낱말이 오면 빠른 꼴이 아니다 (TD-V3-009 — `174번 170 다시 170`)
      if (correctionBetween(q + 1, stop - 1)) continue
      if (q === tokens.length - 1 && !final) continue // 중간 결과 끝의 수는 기다린다(60 → 60만)
      // 품종 없는 꼴은 덩어리가 끝났을 때만(D-V3-63 — 뒤에 무엇이 올지 모른다)
      if (name === null && !final) continue
      // 품종 없는 꼴에서 숫자 한 개·한글 한 글자 수는 가격이 아니다(D-V3-63 — `68번 3`은 D-V3-54로 번호도 비움)
      if (name === null && [...numberToken].length === 1) continue
      // 한글 수만 된 토큰(`이십오`)은 숫자로 바꿔 단위를 적용한다(만원 단위 `이십오` = 250,000원 — 숫자 `25`와 같게, D-V3-63)
      const sino = /^[일이삼사오육칠팔구십백천]+$/.test(numberToken) ? parseKoreanNumber(numberToken) : null
      const price = parseAmount(sino === null ? numberToken : String(sino), { 'price.unit': unit })
      if (price === null || price < 100) continue
      quick = { no: m.value, price, name: name?.name ?? null, numberFrom: 'marker', priceFrom: 'quick', start: m.start, end: stop - 1, blocked: null, bigChange: isBigChange(null, price) }
      break
    }
    if (quick !== null) {
      pick(quick)
      continue
    }
    // 3. 가격 뒤 번호 (덩어리 끝에서만): 뒤에 'N번'이 있는 가장 뒤의 원 가격 줄과 그 뒤 첫 'N번'
    if (final) {
      const after = segLines.filter((item) => item.value !== null && segMarkers.some((marker) => marker.start > item.end))
      const r = after[after.length - 1]
      if (r !== undefined && r.value !== null) {
        const m = segMarkers.find((marker) => marker.start > r.end) as (typeof segMarkers)[number]
        if (!m.split && m.value <= maxNumber && !correctionBetween(s, m.last)) {
          const reading = analyzeSentence(tokens.slice(s, m.last + 1).join(' '), { dictionary: options.dictionary ?? [], maxNumber })
          pick({ no: m.value, price: r.value, name: reading.reading.extraction.name, numberFrom: 'marker', priceFrom: 'won', start: s, end: m.last, blocked: null, bigChange: isBigChange(null, r.value) })
          continue
        }
      }
    }
    break
  }
  const picked = new Set(picks.map((item) => item.no))
  const leftover = markers.filter((marker) => marker.start >= s).map((marker) => marker.value)
  const others = [...new Set([...dropped, ...leftover])].filter((value) => !picked.has(value))
  const restTokens = tokens.slice(s)
  let tail: SegmentReading['tail'] = null
  const last = picks[picks.length - 1]
  const first = restTokens[0]
  if (last !== undefined && first !== undefined && !markers.some((marker) => marker.start >= s)) {
    if (isCancelToken(first)) tail = { kind: 'cancel', no: last.no, text: restTokens.join(' ') }
    else if (isCorrectionToken(first)) {
      // 대화 속 '아니'와 가리기: 정정 표시 바로 뒤(군말 건너)에 원 가격 줄이나 사전 품종이 와야 정정이다
      const k = skipFillers(tokens, s + 1)
      const priceNext = lines.some((item) => item.start === k && item.value !== null)
      if (priceNext || nameWindowEnd(tokens, k, options, markerAt) !== null) tail = { kind: 'correction', no: last.no, text: restTokens.join(' ') }
    }
  }
  return { tokens, picks, others, tail, rest: restTokens.join(' ') }
}

/** 정정 낱말로 고친 같은 번호 가격 (readMarkerCorrection) */
export interface MarkerCorrection {
  readonly no: number
  readonly price: number
  /** 그 말 조각 (기록·카드에 남길 글) */
  readonly text: string
}

/**
 * 정정 낱말이 든 "N번 … 원 가격" 조각 (TD-V3-013, D-V3-83 (가)): 조각 읽기는 정정 낱말이 'N번'과 원 가격 사이에 끼면 고르지 않는다(D-V3-51 —
 * 새 등록으로는 쓰지 않는다). 그 번호가 이미 있는 상품이면 이 조각은 그 상품의 가격 고침이다 — "65번 아니 5만 원"·"65번 다시 5만 원"·
 * "아니 65번 5만 원"·"잘못 말했어요 15번 7만 원". 고르는 값: 'N번'이 한 번호뿐(같은 번호 되풀이는 하나)이고, 정정 낱말이 있고, 취소 낱말이 없고,
 * 'N번' 뒤·첫 정정 낱말 뒤의 마지막 원 가격 줄. 'N번' 바로 뒤(군말 건너)가 `…말고`면 고르지 않는다("15번 말고 7만 원" — 번호를 고친 말일 수 있어 애매).
 * 순수 함수: 어떤 입력에도 예외를 던지지 않는다.
 */
export function readMarkerCorrection(text: unknown, options: SegmentOptions = {}): MarkerCorrection | null {
  try {
    const tokens = tokenize(text)
    if (tokens === null || tokens.length === 0) return null
    if (tokens.some(isCancelToken)) return null
    const maxNumber = maxNumberOf(options)
    const punct = punctuatedTokens(text)
    const markers = listNumberMarkers(tokens, punct)
    if (markers.length === 0 || new Set(markers.map((marker) => marker.value)).size !== 1) return null
    const m = markers[0] as (typeof markers)[number]
    if (markers.some((marker) => marker.split) || m.value > maxNumber) return null
    const c = tokens.findIndex((token) => hasPriceCorrection(token))
    if (c < 0) return null
    // 'N번' 바로 뒤 군말(정정 표시는 군말로 건너지 않는다) 다음이 `…말고`면 애매
    let k = m.last + 1
    while (k < tokens.length && isWindowFiller(tokens[k] as string) && !isCorrectionToken(tokens[k] as string)) k++
    if (tokens[k]?.endsWith(MALGO) === true) return null
    const from = Math.max(c, (markers[markers.length - 1] as (typeof markers)[number]).last)
    const lines = listWonLines(tokens, { maxNumber, punct }).filter((line) => line.start > from)
    const line = lines[lines.length - 1]
    if (line === undefined || line.value === null) return null
    return { no: m.value, price: line.value, text: tokens.join(' ') }
  } catch {
    return null
  }
}
