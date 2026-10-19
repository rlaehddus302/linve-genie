// 품종 사전 (VOC-03, DOMAIN_RULES R-17 5 "사전", D-203).
// - 이름마다 R-3 정규화(코어 normalizeText). 공백을 뺀 글자가 2글자(코드 포인트) 이상인 이름만 넣는다.
// - 공백을 뺀 모양이 같은 이름은 앞에 적힌 하나만 둔다(판매 이력이 기본 사전보다 앞).
// - 넘긴 목록을 바꾸지 않는다. 문자열이 아닌 항목은 건너뛴다(신뢰할 수 없는 입력).
import { normalizeText } from '@livejjim/core'
import { DEFAULT_DICTIONARY } from './default-dictionary.ts'
import { compact, jamoKey, jamoOf } from './jamo.ts'

export interface DictionaryEntry {
  /** 돌려줄 이름 = 사전에 적힌 모양을 R-3 정규화한 것 */
  readonly name: string
  /** 공백을 뺀 모양 (같은 이름 판단·품는 이름 판단) */
  readonly key: string
  /** 자모 (공백 지우고 NFD) */
  readonly jamo: readonly number[]
  /** 자모를 사전의 기호 번호로 바꾼 것 (빠른 거리 계산용) */
  readonly ids: Int32Array
}

const codePointLength = (text: string): number => {
  let n = 0
  for (const _ of text) n++
  return n
}

/** 사전 규칙으로 정리한 이름 목록 (순서 유지) */
export function normalizeDictionary(names: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  if (!Array.isArray(names)) return out
  for (const raw of names) {
    if (typeof raw !== 'string') continue
    const name = normalizeText(raw)
    const key = compact(name)
    if (codePointLength(key) < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * 판매 이력 다음 기본 사전 (D-203). 판매 이력은 최근 것 먼저 — 부르는 쪽이 정렬해 넘긴다.
 * 결과는 정리한 이름 목록(R-3 정규화, 공백만 다른 이름은 앞의 것, 공백 뺀 1글자·빈 이름 없음).
 */
export function buildDictionary(history: readonly string[], base: readonly string[] = DEFAULT_DICTIONARY): string[] {
  return normalizeDictionary([...(Array.isArray(history) ? history : []), ...(Array.isArray(base) ? base : [])])
}

/**
 * 추출에 쓰려고 준비한 사전. 같은 사전으로 여러 문장을 볼 때(방송 중) 한 번만 만들어 넘기면 정리·자모 풀기를 되풀이하지 않는다.
 * 만든 뒤에는 바뀌지 않는다(넘긴 목록을 나중에 바꿔도 영향 없음).
 */
export class VarietyDictionary {
  readonly entries: readonly DictionaryEntry[]
  /** 자모 코드 포인트 → 기호 번호 (사전에 나온 자모만) */
  readonly symbols: ReadonlyMap<number, number>
  /** 공백 뺀 모양 → 항목 (정확히 같은 이름 찾기) */
  readonly byKey: ReadonlyMap<string, DictionaryEntry>
  /** 자모 → 항목들 (유사도 1 = 자모가 같은 이름 찾기) */
  readonly byJamo: ReadonlyMap<string, readonly DictionaryEntry[]>
  /** 자모 수 → 항목들 (길이 차로 미리 거르기) */
  readonly byLength: ReadonlyMap<number, readonly DictionaryEntry[]>

  constructor(names: readonly unknown[]) {
    const symbols = new Map<number, number>()
    const idOf = (code: number): number => {
      let id = symbols.get(code)
      if (id === undefined) {
        id = symbols.size
        symbols.set(code, id)
      }
      return id
    }
    const entries = normalizeDictionary(names).map((name): DictionaryEntry => {
      const jamo = jamoOf(name)
      return { name, key: compact(name), jamo: Object.freeze(jamo), ids: Int32Array.from(jamo, idOf) }
    })
    this.symbols = symbols
    this.entries = Object.freeze(entries.map((entry) => Object.freeze(entry)))
    const byKey = new Map<string, DictionaryEntry>()
    const byJamo = new Map<string, DictionaryEntry[]>()
    const byLength = new Map<number, DictionaryEntry[]>()
    const push = <K>(map: Map<K, DictionaryEntry[]>, key: K, entry: DictionaryEntry): void => {
      const bucket = map.get(key)
      if (bucket === undefined) map.set(key, [entry])
      else bucket.push(entry)
    }
    for (const entry of this.entries) {
      byKey.set(entry.key, entry)
      push(byJamo, jamoKey(entry.jamo), entry)
      push(byLength, entry.jamo.length, entry)
    }
    this.byKey = byKey
    this.byJamo = byJamo
    this.byLength = byLength
    Object.freeze(this)
  }

  get size(): number {
    return this.entries.length
  }
}

/** 이름 목록 → 준비한 사전 */
export function prepareDictionary(names: readonly unknown[]): VarietyDictionary {
  return new VarietyDictionary(names)
}
