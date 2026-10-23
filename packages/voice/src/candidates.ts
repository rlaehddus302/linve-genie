// 품종 후보 (VOC-03, D-V2-01). R-17이 품종을 비웠을 때 카드에 단추로만 보이는 이름들 — 저절로 품종이 되지 않는다.
// - 창: R-17 5의 창(번호 표시·가격 묶음 토큰을 뺀 창) 가운데 공백 뺀 글이 2글자 이상·자모 5개 이상
// - 이름: 사전 이름(별칭 아님) 가운데 자모 5개 이상
// - 접은 자모: ㅐ→ㅔ, ㅒ→ㅖ, ㅙ·ㅚ→ㅞ 세 가지만 (크롬·사람 모두 구별하지 못하는 소리)
// - 유사도 0.6 이상 ⇔ 거리 × 5 ≤ 긴 쪽 자모 수 × 2 (정수 비교). 점수 = ⌊(긴 쪽 − 거리) × 100 ÷ 긴 쪽⌋ (정수)
// - 이름마다 가장 높은 점수 한 번, 점수 높은 순·같으면 이름 글자 순(코드 포인트), 3개까지
// 순수 함수: 넘긴 사전을 바꾸지 않고 예외를 던지지 않는다.
import { VarietyDictionary } from './dictionary.ts'
import { readSentence, type ExtractOptions } from './extract.ts'
import { editDistance, jamoOf } from './jamo.ts'

export interface VarietyCandidate {
  /** 사전 이름 */
  readonly name: string
  /** 0~100 정수 (유사도 × 100 버림) */
  readonly score: number
  /** 그 점수를 낸 창 글 (공백 없이) — 배운 별칭의 "들은 말" */
  readonly heard: string
}

/** 후보 최대 수 */
export const MAX_CANDIDATES = 3
/** 후보가 될 수 있는 가장 짧은 자모 수 */
export const CANDIDATE_MIN_JAMO = 5

const FOLD: ReadonlyMap<number, number> = new Map([
  [0x1162, 0x1166], // ㅐ → ㅔ
  [0x1164, 0x1168], // ㅒ → ㅖ
  [0x116b, 0x1170], // ㅙ → ㅞ
  [0x116c, 0x1170], // ㅚ → ㅞ
])

/** 접은 자모 (D-V2-01 세 가지 모음 합침만) */
export function foldedJamoOf(text: string): number[] {
  return jamoOf(text).map((code) => FOLD.get(code) ?? code)
}

const codePointLength = (text: string): number => {
  let n = 0
  for (const _ of text) n++
  return n
}

interface FoldedEntry {
  readonly name: string
  readonly jamo: readonly number[]
}

const foldedCache = new WeakMap<VarietyDictionary, readonly FoldedEntry[]>()

function foldedEntries(dictionary: VarietyDictionary): readonly FoldedEntry[] {
  const cached = foldedCache.get(dictionary)
  if (cached !== undefined) return cached
  const list = dictionary.entries.filter((entry) => entry.jamo.length >= CANDIDATE_MIN_JAMO).map((entry) => ({ name: entry.name, jamo: foldedJamoOf(entry.name) }))
  foldedCache.set(dictionary, list)
  return list
}

function toDictionary(value: unknown): VarietyDictionary {
  if (value instanceof VarietyDictionary) return value
  return new VarietyDictionary(Array.isArray(value) ? value : [])
}

/** 이미 읽은 창들로 후보 고르기 (readChunk가 같은 창을 두 번 만들지 않게) */
export function candidatesFromWindows(windows: Iterable<string>, dictionary: VarietyDictionary): VarietyCandidate[] {
  const entries = foldedEntries(dictionary)
  const best = new Map<string, VarietyCandidate>()
  for (const window of windows) {
    if (typeof window !== 'string' || codePointLength(window) < 2) continue
    const jamo = foldedJamoOf(window)
    if (jamo.length < CANDIDATE_MIN_JAMO) continue
    for (const entry of entries) {
      const longer = Math.max(jamo.length, entry.jamo.length)
      // 길이 차만으로 0.6에 못 미치면 건너뛴다
      if (Math.abs(jamo.length - entry.jamo.length) * 5 > longer * 2) continue
      const distance = editDistance(jamo, entry.jamo)
      if (distance * 5 > longer * 2) continue
      const score = Math.floor(((longer - distance) * 100) / longer)
      const previous = best.get(entry.name)
      if (previous === undefined || score > previous.score) best.set(entry.name, { name: entry.name, score, heard: window })
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, MAX_CANDIDATES)
}

/**
 * 글 하나 → 품종 후보 3개까지 (D-V2-01). 글은 R-17처럼 읽어 번호 표시·가격 묶음을 창에서 뺀다.
 * 품종이 채워졌든 아니든 계산한다 — 화면은 품종이 빈 카드에서만 보인다(readChunk는 품종이 비었을 때만 돌려준다).
 */
export function varietyCandidates(text: unknown, dictionary: unknown, options: Omit<ExtractOptions, 'dictionary'> = {}): VarietyCandidate[] {
  try {
    const prepared = toDictionary(dictionary)
    const reading = readSentence(text, { ...options, dictionary: prepared })
    return candidatesFromWindows(reading.windows, prepared)
  } catch {
    return []
  }
}
