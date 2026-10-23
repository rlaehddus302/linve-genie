// 정정 말 (VOC-02, D-V2-05). 한 덩어리를 정정 표시·취소 낱말·칸 이름에서 조각으로 나누고, 조각마다 R-17(readSentence)로 읽어
// 왼쪽부터 뒤 조각에서 읽힌 칸(번호·품종·가격 각각)이 앞 값을 덮는다. R-17 자체는 바꾸지 않는다.
// 순수 함수: 넘긴 사전을 바꾸지 않고 시계·난수를 쓰지 않으며 어떤 입력에도 예외를 던지지 않는다.
import { normalizeText, parseAmount, parseKoreanNumber } from '@livejjim/core'
import { STOP_WORDS } from './default-dictionary.ts'
import { candidatesFromWindows, type VarietyCandidate } from './candidates.ts'
import { VarietyDictionary } from './dictionary.ts'
import { readSentence, readingForms, tokenize, type Confidence, type SentenceReading } from './extract.ts'

/** 정정 표시 (D-V2-05). `말고`로 끝나는 토큰은 앞 글 + 표시 */
export const CORRECTION_MARKERS: readonly string[] = Object.freeze(['아니', '아니야', '아니요', '아니고', '다시', '정정', '말고'])
/** 취소 낱말 */
export const CANCEL_WORDS: readonly string[] = Object.freeze(['취소', '취소요', '취소해', '취소해요', '취소할게요'])
/** 칸 이름 → 칸 */
export const FIELD_NAMES: Readonly<Record<string, ChunkField>> = Object.freeze({ 품종은: 'name', 품종: 'name', 이름은: 'name', 가격은: 'price', 번호는: 'no' })
/** 칸 이름으로 말한 사전 밖 품종 글의 최대 길이(코드 포인트) */
export const RAW_NAME_MAX = 20

const MALGO = '말고'
const STOP_KEYS: ReadonlySet<string> = new Set(STOP_WORDS.map((word) => normalizeText(word).split(' ').join('')))

export type ChunkField = 'no' | 'name' | 'price'

/** 조각을 시작한 것: 덩어리 맨 앞(null)·정정 표시·취소 낱말·칸 이름 */
export type PieceStart = 'correction' | 'cancel' | 'field' | null

export interface CorrectionPiece {
  /** 조각 글 (토큰을 공백 하나로 이은 것 — 칸 이름 토큰은 빼고) */
  readonly text: string
  /** 칸 이름 조각이면 그 칸 */
  readonly field: ChunkField | null
  readonly start: PieceStart
}

export interface CorrectionSplit {
  /** 조각들 (빈 조각은 칸 이름·취소 조각만 남는다) */
  readonly pieces: readonly CorrectionPiece[]
  /** 정정 표시·취소 낱말·칸 이름이 하나라도 있는가 (정정 덩어리, D-V2-06) */
  readonly correction: boolean
  /** 첫 토큰이 정정 표시·취소 낱말·칸 이름인가 */
  readonly startsWithCorrection: boolean
  /** 취소: 취소 낱말이 있고 마지막 취소 낱말 뒤 조각들에서 아무 칸도 읽히지 않음 */
  readonly cancel: boolean
}

export interface ChunkOptions {
  /** claim.maxNumber (생략하면 999) */
  readonly maxNumber?: number
  /** 품종 사전 (prepareVoiceDictionary·prepareDictionary로 준비한 것 또는 이름 목록) */
  readonly dictionary?: readonly unknown[] | VarietyDictionary
}

const EMPTY_SPLIT: CorrectionSplit = Object.freeze({ pieces: Object.freeze([]), correction: false, startsWithCorrection: false, cancel: false })

const markerKind = (token: string): PieceStart => {
  if (CORRECTION_MARKERS.includes(token)) return 'correction'
  if (CANCEL_WORDS.includes(token)) return 'cancel'
  if (Object.hasOwn(FIELD_NAMES, token)) return 'field'
  return null
}

function toDictionary(value: unknown): VarietyDictionary {
  if (value instanceof VarietyDictionary) return value
  return new VarietyDictionary(Array.isArray(value) ? value : [])
}

interface RawPiece {
  tokens: string[]
  field: ChunkField | null
  start: PieceStart
}

function splitTokens(tokens: readonly string[]): { pieces: RawPiece[]; correction: boolean; startsWithCorrection: boolean; lastCancel: number } {
  const pieces: RawPiece[] = []
  let current: RawPiece = { tokens: [], field: null, start: null }
  let correction = false
  let lastCancel = -1
  const open = (start: PieceStart, field: ChunkField | null): void => {
    correction = true
    if (current.tokens.length === 0) {
      // 덩어리 맨 앞이거나 표시 바로 뒤의 표시: 조각을 새로 만들지 않고 이어 쓴다 (`아니 아니` = 표시 하나)
      if (current.start === null || start === 'cancel') current.start = start
      else if (start === 'field' && current.start !== 'cancel') current.start = 'field'
      if (field !== null) current.field = field
      if (start === 'cancel') lastCancel = pieces.length
      return
    }
    pieces.push(current)
    current = { tokens: [], field, start }
    if (start === 'cancel') lastCancel = pieces.length
  }
  tokens.forEach((token) => {
    const kind = markerKind(token)
    if (kind === 'field') open('field', FIELD_NAMES[token] as ChunkField)
    else if (kind !== null) open(kind, null)
    else if (token.length > MALGO.length && token.endsWith(MALGO)) {
      current.tokens.push(token.slice(0, -MALGO.length))
      open('correction', null)
    } else current.tokens.push(token)
  })
  pieces.push(current)
  const first = tokens[0]
  const startsWithCorrection = first !== undefined && (markerKind(first) !== null || first === MALGO)
  return { pieces, correction, startsWithCorrection, lastCancel }
}

const isDigitString = (text: string): boolean => /^[0-9]{1,4}$/.test(text)
const isSinoOnly = (text: string): boolean => text !== '' && [...text].every((char) => '일이삼사오육칠팔구십백천'.includes(char))

/** `번호는` 조각의 `번` 없는 수 (`16`·`십육`, 끝말을 뗀 모양 포함) */
function bareNumber(text: string, maxNumber: number): number | null {
  const tokens = tokenize(text)
  if (tokens === null || tokens.length !== 1) return null
  for (const form of readingForms(tokens[0] as string)) {
    if (form === '이' || (!isDigitString(form) && !isSinoOnly(form))) continue
    const value = parseKoreanNumber(form)
    if (value !== null && Number.isSafeInteger(value) && value >= 1 && value <= maxNumber) return value
  }
  return null
}

const resolveMax = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 999)
const codePointLength = (text: string): number => {
  let n = 0
  for (const _ of text) n++
  return n
}

interface PieceReading {
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  readonly nameExact: boolean
  readonly nameWindow: string | null
  readonly rawName: boolean
  readonly windows: ReadonlySet<string>
}

function readPiece(piece: CorrectionPiece, dictionary: VarietyDictionary, maxNumber: number): PieceReading {
  const reading: SentenceReading = readSentence(piece.text, { dictionary, maxNumber })
  const { extraction } = reading
  const base = { nameExact: false, nameWindow: null, rawName: false, windows: reading.windows }
  // 칸 이름은 조각을 나누기만 한다 — 다른 칸도 R-17로 평소대로 읽는다 (D-V2-18)
  const plain = { ...base, no: extraction.no, name: extraction.name, price: extraction.price, nameExact: reading.nameExact, nameWindow: reading.nameWindow }
  if (piece.field === 'price') return plain
  if (piece.field === 'no') return { ...plain, no: extraction.no ?? bareNumber(piece.text, maxNumber) }
  if (piece.field === 'name') {
    if (extraction.name !== null) return plain
    // 품종은 번호 표시·가격 묶음 토큰을 뺀 나머지 (D-V2-05·D-V2-18)
    const raw = reading.rest
    // 막는 낱말·지시어·가격이나 수로 읽히는 말은 품종이 되지 않는다 (TD-V2-002)
    const ok =
      raw !== '' &&
      codePointLength(raw) <= RAW_NAME_MAX &&
      !/[0-9]/.test(raw) &&
      !raw.split(' ').some((token) => readingForms(token).some((form) => STOP_KEYS.has(form))) &&
      !STOP_KEYS.has(raw.split(' ').join('')) &&
      parseAmount(raw, { 'price.unit': 'WON' }) === null &&
      parseKoreanNumber(raw.split(' ').join('')) === null
    return { ...plain, name: ok ? raw : null, rawName: ok, nameWindow: ok ? raw.split(' ').join('') : null }
  }
  return plain
}

const hasField = (reading: PieceReading): boolean => reading.no !== null || reading.name !== null || reading.price !== null

function splitWith(text: unknown, dictionary: VarietyDictionary, maxNumber: number): { split: CorrectionSplit; readings: PieceReading[] } {
  const tokens = tokenize(text)
  if (tokens === null || tokens.length === 0) return { split: EMPTY_SPLIT, readings: [] }
  const raw = splitTokens(tokens)
  const pieces: CorrectionPiece[] = raw.pieces.map((piece) => Object.freeze({ text: piece.tokens.join(' '), field: piece.field, start: piece.start }))
  const readings = pieces.map((piece) => readPiece(piece, dictionary, maxNumber))
  const cancel = raw.lastCancel >= 0 && readings.slice(raw.lastCancel).every((reading) => !hasField(reading))
  return { split: { pieces: Object.freeze(pieces), correction: raw.correction, startsWithCorrection: raw.startsWithCorrection, cancel }, readings }
}

/**
 * 덩어리 → 조각·칸 이름·취소 (D-V2-05). 취소 판단에 조각을 R-17로 읽으므로 사전을 넘길 수 있다(생략하면 빈 사전 — 번호·가격만 본다).
 * 300글자를 넘는 덩어리는 조각 없음(R-17 1).
 */
export function splitCorrections(text: unknown, options: ChunkOptions = {}): CorrectionSplit {
  try {
    return splitWith(text, toDictionary(options.dictionary), resolveMax(options.maxNumber)).split
  } catch {
    return EMPTY_SPLIT
  }
}

/** 덩어리를 읽은 결과 (V2) */
export interface ChunkReading {
  /** 덮은 결과 */
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  /** 정정 없는 덩어리는 R-17 그대로. 정정 덩어리는 늘 LOW(자동 확정하지 않음 — 판매자가 한 번 보게) */
  readonly confidence: Confidence
  /** 품종이 비었을 때만 후보 (D-V2-01) */
  readonly candidates: readonly VarietyCandidate[]
  readonly cancel: boolean
  /** 첫 토큰이 정정 표시·취소·칸 이름 */
  readonly startsWithCorrection: boolean
  /** 정정 덩어리 (표시·취소·칸 이름이 하나라도 있음, D-V2-06) */
  readonly correction: boolean
  /** 고칠 칸 = 첫 표시·칸 이름 뒤 조각들이 읽은 칸 (D-V2-06 2) */
  readonly fieldsSet: readonly ChunkField[]
  /** 칸 이름으로 말한 사전 밖 글을 품종으로 둠 — 카드에 "확인 필요" */
  readonly nameNeedsCheck: boolean
  /** 품종이 사전 이름·별칭과 공백만 다름 */
  readonly nameExact: boolean
  /** 품종을 낸 창 글(공백 없이) — 배운 별칭 쓰임 표시에 */
  readonly nameWindow: string | null
  /** 첫 조각(표시 앞)에 번호가 있음 — D-V2-06 (1) 새 카드 */
  readonly leadNumber: boolean
  readonly split: CorrectionSplit
}

const FIELD_ORDER: readonly ChunkField[] = ['no', 'name', 'price']

const EMPTY_READING: ChunkReading = Object.freeze({
  no: null,
  name: null,
  price: null,
  confidence: 'LOW',
  candidates: Object.freeze([]),
  cancel: false,
  startsWithCorrection: false,
  correction: false,
  fieldsSet: Object.freeze([]),
  nameNeedsCheck: false,
  nameExact: false,
  nameWindow: null,
  leadNumber: false,
  split: EMPTY_SPLIT,
})

/** 덩어리 하나 읽기: 조각마다 R-17, 뒤가 앞을 덮음, 취소·고칠 칸·후보 (D-V2-01·D-V2-05) */
export function readChunk(text: unknown, options: ChunkOptions = {}): ChunkReading {
  try {
    const dictionary = toDictionary(options.dictionary)
    const maxNumber = resolveMax(options.maxNumber)
    const { split, readings } = splitWith(text, dictionary, maxNumber)
    if (split.pieces.length === 0) return EMPTY_READING
    let no: number | null = null
    let name: string | null = null
    let price: number | null = null
    let nameExact = false
    let nameWindow: string | null = null
    let rawName = false
    const fields = new Set<ChunkField>()
    const windows = new Set<string>()
    split.pieces.forEach((piece, i) => {
      const reading = readings[i] as PieceReading
      for (const window of reading.windows) windows.add(window)
      if (reading.no !== null) no = reading.no
      if (reading.price !== null) price = reading.price
      if (reading.name !== null) {
        name = reading.name
        nameExact = reading.nameExact
        nameWindow = reading.nameWindow
        rawName = reading.rawName
      }
      if (piece.start !== null) {
        if (reading.no !== null) fields.add('no')
        if (reading.name !== null) fields.add('name')
        if (reading.price !== null) fields.add('price')
      }
    })
    const first = readings[0] as PieceReading
    const leadNumber = (split.pieces[0] as CorrectionPiece).start === null && first.no !== null
    const plainHigh = !split.correction && no !== null && price !== null && name !== null && nameExact
    return {
      no,
      name,
      price,
      confidence: plainHigh ? 'HIGH' : 'LOW',
      candidates: name === null ? Object.freeze(candidatesFromWindows(windows, dictionary)) : Object.freeze([]),
      cancel: split.cancel,
      startsWithCorrection: split.startsWithCorrection,
      correction: split.correction,
      fieldsSet: Object.freeze(FIELD_ORDER.filter((field) => fields.has(field))),
      nameNeedsCheck: rawName,
      nameExact,
      nameWindow,
      leadNumber,
      split,
    }
  } catch {
    return EMPTY_READING
  }
}
