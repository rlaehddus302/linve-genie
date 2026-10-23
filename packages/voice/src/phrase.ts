// 이어 붙이기 (VOC-01, D-V2-03). 최종 결과를 모으는 글에 공백 하나로 잇고, 마지막 결과(중간 결과 포함)에서 조용한 시간이 지나면 한 덩어리로 내보낸다.
// 타이머가 없다 — 시각은 부르는 쪽이 넘긴다(feed의 at, tick의 now). 다음에 tick을 부를 시각은 nextTickAt으로 알 수 있다.
// 먼저 끊는 때: (a) 새 최종 결과에 모으는 글과 다른 번호 표시(정정 표시가 든 결과는 예외) (b) 모으기 시작 15초 (c) 300글자를 넘기게 됨
// (d) `문자찜` 낱말 — 모은 글을 먼저 내보내고 그 결과 하나만 따로(R-21) (e) 음성을 끔(stop)·끝에서 넘긴 결과(자동 확정 없음).
// 순수 함수: 넘긴 상태를 바꾸지 않고 새 상태를 돌려준다. 어떤 입력에도 예외를 던지지 않는다.
import { normalizeText } from '@livejjim/core'
import { CANCEL_WORDS, CORRECTION_MARKERS } from './correction.ts'
import { findNumberMarkers, readingForms, tokenize, SENTENCE_MAX_CODE_POINTS } from './extract.ts'
import { resolveQuietMs } from './settings.ts'
import { findSmsMarker } from './sms.ts'

/** 모으기 시작에서 이 시간이 지나면 끊는다 (D-V2-03 b) */
export const PHRASE_MAX_MS = 15_000
/** 모은 글 최대 길이(코드 포인트, R-17 1) */
export const PHRASE_MAX_CODE_POINTS = SENTENCE_MAX_CODE_POINTS

/** 덩어리를 끊은 까닭 */
export type ChunkEnd = 'quiet' | 'number' | 'max' | 'long' | 'sms' | 'flushed' | 'stop'

export interface PhrasePiece {
  /** 최종 결과 글 (정규화) */
  readonly text: string
  readonly at: number
  /** 끝에서 넘긴 결과 (D-I5-02) */
  readonly flushedAtEnd: boolean
}

export interface PhraseChunk {
  /** 덩어리 글 = 조각들을 공백 하나로 이은 것 */
  readonly text: string
  readonly pieces: readonly PhrasePiece[]
  /** 모으기 시작 시각 (첫 최종 결과) */
  readonly startedAt: number
  /** 내보낸 시각 */
  readonly endedAt: number
  readonly end: ChunkEnd
  /** 끝에서 넘긴 결과가 들었거나 음성을 꺼서 끊은 덩어리 — 이 덩어리로 만든 카드는 자동 확정하지 않는다 */
  readonly noAutoConfirm: boolean
}

/** 문자찜 결과 — 이어 붙이지 않고 그 결과 하나만 지금처럼 R-21로 읽는다 */
export interface PhraseSms {
  readonly text: string
  readonly at: number
  readonly flushedAtEnd: boolean
}

export type PhraseOutput = { readonly kind: 'chunk'; readonly chunk: PhraseChunk } | { readonly kind: 'sms'; readonly sms: PhraseSms }

export interface PhraseState {
  readonly quietMs: number
  readonly pieces: readonly PhrasePiece[]
  /** 첫 최종 결과 시각 (모으는 글이 없으면 null) */
  readonly startedAt: number | null
  /** 마지막 결과(중간 결과 포함) 시각 */
  readonly lastAt: number | null
  /** 지금 중간 결과 (최종이 되면 비운다) */
  readonly interim: string
}

export interface PhraseInput {
  readonly text: string
  readonly final: boolean
  readonly at: number
  readonly flushedAtEnd?: boolean
}

export interface PhraseStep {
  readonly state: PhraseState
  readonly out: readonly PhraseOutput[]
}

/** 새 모으기 상태. quietMs는 voice.quietMs 규칙으로 읽는다(범위 밖이면 1800) */
export function createPhraseState(options: { readonly quietMs?: unknown } = {}): PhraseState {
  return Object.freeze({ quietMs: resolveQuietMs(options?.quietMs), pieces: Object.freeze([]), startedAt: null, lastAt: null, interim: '' })
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const codePointLength = (text: string): number => {
  let n = 0
  for (const _ of text) n++
  return n
}
const joined = (pieces: readonly PhrasePiece[]): string => pieces.map((piece) => piece.text).join(' ')

const safeState = (state: unknown): PhraseState => {
  if (typeof state !== 'object' || state === null) return createPhraseState()
  const s = state as Partial<PhraseState>
  return {
    quietMs: resolveQuietMs(s.quietMs),
    pieces: Array.isArray(s.pieces) ? s.pieces : [],
    startedAt: isTime(s.startedAt) ? s.startedAt : null,
    lastAt: isTime(s.lastAt) ? s.lastAt : null,
    interim: typeof s.interim === 'string' ? s.interim : '',
  }
}

/** 글의 번호 표시 값들 (R-17 3) */
function numbersOf(text: string): Set<number> {
  const tokens = tokenize(text)
  if (tokens === null) return new Set()
  return new Set(findNumberMarkers(tokens, tokens.map(readingForms)).values)
}

/** 정정 표시(·취소 낱말)가 든 결과인가 — 다른 번호가 있어도 끊지 않고 붙인다 (D-V2-03 a 단서) */
function hasCorrectionMarker(text: string): boolean {
  const tokens = tokenize(text) ?? normalizeText(text).split(' ')
  return tokens.some((token) => CORRECTION_MARKERS.includes(token) || CANCEL_WORDS.includes(token) || (token.length > 2 && token.endsWith('말고')))
}

function isSms(text: string): boolean {
  const tokens = tokenize(text) ?? normalizeText(text).split(' ')
  return findSmsMarker(tokens) >= 0
}

function emit(state: PhraseState, at: number, end: ChunkEnd): { state: PhraseState; out: PhraseOutput[] } {
  const cleared: PhraseState = { ...state, pieces: [], startedAt: null }
  if (state.pieces.length === 0 || state.startedAt === null) return { state: cleared, out: [] }
  const chunk: PhraseChunk = {
    text: joined(state.pieces),
    pieces: state.pieces,
    startedAt: state.startedAt,
    endedAt: at,
    end,
    noAutoConfirm: end === 'stop' || end === 'flushed' || state.pieces.some((piece) => piece.flushedAtEnd),
  }
  return { state: cleared, out: [{ kind: 'chunk', chunk }] }
}

/** 지금 시각으로 끝난 덩어리가 있으면 내보낸다 (조용한 시간·15초) */
function due(state: PhraseState, now: number): ChunkEnd | null {
  if (state.pieces.length === 0 || state.startedAt === null) return null
  if (state.lastAt !== null && now - state.lastAt >= state.quietMs) return 'quiet'
  if (now - state.startedAt >= PHRASE_MAX_MS) return 'max'
  return null
}

/**
 * 시각 now에 끝난 덩어리 (D-V2-03). 모은 글이 없으면 아무것도 내보내지 않는다.
 * 조용한 시간이 지난 중간 결과는 지운다(최종이 되지 않고 사라진 말).
 */
export function tick(state: PhraseState, now: number): PhraseStep {
  try {
    const current = safeState(state)
    if (!isTime(now)) return { state: current, out: [] }
    const end = due(current, now)
    let next = current
    let out: PhraseOutput[] = []
    if (end !== null) ({ state: next, out } = emit(current, now, end))
    if (next.interim !== '' && next.lastAt !== null && now - next.lastAt >= next.quietMs) next = { ...next, interim: '' }
    return { state: next, out }
  } catch {
    return { state: createPhraseState(), out: [] }
  }
}

/** 결과 하나 넣기 (중간·최종). 내보낼 덩어리·문자찜 결과가 있으면 out에 차례대로 */
export function feed(state: PhraseState, input: PhraseInput): PhraseStep {
  try {
    let current = safeState(state)
    const at = isTime(input?.at) ? input.at : current.lastAt ?? 0
    const text = normalizeText(typeof input?.text === 'string' ? input.text : '')
    const out: PhraseOutput[] = []
    const push = (step: { state: PhraseState; out: readonly PhraseOutput[] }): void => {
      current = step.state
      out.push(...step.out)
    }
    // 먼저 이 시각까지 끝난 덩어리 (tick을 늦게 불렀어도 순서가 맞게)
    push(tick(current, at))
    if (input?.final !== true) {
      current = { ...current, interim: text, lastAt: at }
      return { state: current, out }
    }
    const flushed = input.flushedAtEnd === true
    current = { ...current, interim: '', lastAt: at }
    if (text === '') {
      if (flushed) push(emit(current, at, 'flushed'))
      return { state: current, out }
    }
    // (d) 문자찜: 모은 글을 먼저 내보내고 이 결과 하나만 따로
    if (isSms(text)) {
      push(emit(current, at, 'sms'))
      out.push({ kind: 'sms', sms: { text, at, flushedAtEnd: flushed } })
      return { state: current, out }
    }
    if (current.pieces.length > 0) {
      // (a) 다른 번호
      const before = numbersOf(joined(current.pieces))
      const incoming = numbersOf(text)
      const differs = before.size > 0 && [...incoming].some((value) => !before.has(value))
      if (differs && !hasCorrectionMarker(text)) push(emit(current, at, 'number'))
      // (c) 300글자를 넘기게 되면 새 결과 앞에서
      else if (codePointLength(`${joined(current.pieces)} ${text}`) > PHRASE_MAX_CODE_POINTS) push(emit(current, at, 'long'))
    }
    const piece: PhrasePiece = { text, at, flushedAtEnd: flushed }
    current = { ...current, pieces: [...current.pieces, piece], startedAt: current.startedAt ?? at, lastAt: at }
    // (e) 끝에서 넘긴 결과는 바로 덩어리로 (자동 확정 없음)
    if (flushed) push(emit(current, at, 'flushed'))
    return { state: current, out }
  } catch {
    return { state: createPhraseState(), out: [] }
  }
}

/** 음성을 끌 때: 모으던 글을 덩어리로 내보낸다 (자동 확정 없음, D-V2-03 e). 중간 결과는 버린다 */
export function stopPhrase(state: PhraseState, at: number): PhraseStep {
  try {
    const current = safeState(state)
    const step = emit(current, isTime(at) ? at : current.lastAt ?? 0, 'stop')
    return { state: { ...step.state, interim: '', lastAt: null }, out: step.out }
  } catch {
    return { state: createPhraseState(), out: [] }
  }
}

/** 다음에 tick을 불러야 할 시각 (모은 글이 없으면 null) — 화면 타이머가 쓴다 */
export function nextTickAt(state: PhraseState): number | null {
  const current = safeState(state)
  if (current.pieces.length === 0 || current.startedAt === null) return current.interim !== '' && current.lastAt !== null ? current.lastAt + current.quietMs : null
  const quiet = (current.lastAt ?? current.startedAt) + current.quietMs
  return Math.min(quiet, current.startedAt + PHRASE_MAX_MS)
}

/** 말이 들리는 중인가 (모은 글이나 중간 결과가 있음) — 이 동안 열린 카드의 자동 확정 기다림을 멈춘다 (D-V2-06) */
export function isHearing(state: PhraseState): boolean {
  const current = safeState(state)
  return current.pieces.length > 0 || current.interim !== ''
}

/** "들은 말" 칸에 보일 글: 모은 글과 지금 중간 결과 (화면이 이스케이프한다, D-V2-07) */
export function heardText(state: PhraseState): { readonly collected: string; readonly interim: string } {
  const current = safeState(state)
  return { collected: joined(current.pieces), interim: current.interim }
}


