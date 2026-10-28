// 품종 사전 (VOC-03, DOMAIN_RULES R-17 5 "사전", D-203).
// - 이름마다 R-3 정규화(코어 normalizeText). 공백을 뺀 글자가 2글자(코드 포인트) 이상인 이름만 넣는다.
// - 공백을 뺀 모양이 같은 이름은 앞에 적힌 하나만 둔다(판매 이력이 기본 사전보다 앞).
// - 넘긴 목록을 바꾸지 않는다. 문자열이 아닌 항목은 건너뛴다(신뢰할 수 없는 입력).
import { normalizeText } from '@livejjim/core'
import { DEFAULT_DICTIONARY, DEFAULT_VARIETIES, STOP_WORDS, type VarietySource } from './default-dictionary.ts'
import { compact, jamoKey, jamoOf } from './jamo.ts'
import { isCommonWord } from './words.ts'

export interface DictionaryEntry {
  /** 돌려줄 이름 = 사전에 적힌 모양을 R-3 정규화한 것 */
  readonly name: string
  /** 공백을 뺀 모양 (같은 이름 판단·품는 이름 판단) */
  readonly key: string
  /** 자모 (공백 지우고 NFD) */
  readonly jamo: readonly number[]
  /** 자모를 사전의 기호 번호로 바꾼 것 (빠른 거리 계산용) */
  readonly ids: Int32Array
  /** 별칭 항목이면 true — key·jamo는 별칭 모양, name은 가리키는 이름. 별칭은 공백 뺀 모양이 같을 때만 맞춘다(D-V2-01) */
  readonly alias?: boolean
  /** 공백 뺀 모양이 같을 때만 맞추는 이름 항목 (판매 영수증 거래명, D-V3-116) — 0.8·한 글자 다른 이름 맞추기에 쓰지 않는다 */
  readonly exactOnly?: boolean
}

/** 그 기기에서 배운 별칭: 들은 말(공백 뺀 품종 창 글) → 판매자가 고른 품종 (D-V2-10) */
export interface LearnedAlias {
  readonly heard: string
  readonly name: string
  /** 마지막으로 배우거나 쓴 시각 (UTC 밀리초 — 오래 안 쓴 것부터 지운다) */
  readonly usedAt: number
}

/** 사전에 넣을 수 있는 것: 이름 글, 이름·별칭 묶음, 배운 별칭 */
export type DictionarySource = string | VarietySource | LearnedAlias

interface SourceForm {
  readonly form: string
  readonly name: string
  readonly alias: boolean
  readonly exactOnly?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 넣은 것 → (모양, 돌려줄 이름) 목록. 이름 먼저, 그 이름의 별칭이 바로 뒤. 형식이 틀린 것은 건너뛴다 */
function sourceForms(items: readonly unknown[]): SourceForm[] {
  const out: SourceForm[] = []
  if (!Array.isArray(items)) return out
  for (const item of items) {
    if (typeof item === 'string') {
      out.push({ form: item, name: item, alias: false })
      continue
    }
    if (!isRecord(item) || typeof item.name !== 'string') continue
    if (typeof item.heard === 'string') {
      out.push({ form: item.heard, name: item.name, alias: true })
      continue
    }
    out.push({ form: item.name, name: item.name, alias: false, ...(item.exactOnly === true ? { exactOnly: true } : {}) })
    if (Array.isArray(item.aliases)) for (const alias of item.aliases) if (typeof alias === 'string') out.push({ form: alias, name: item.name, alias: true })
  }
  return out
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

  /** 별칭 항목 (배운 별칭·기본 사전 별칭) — 공백 뺀 모양이 같을 때만 맞춘다 */
  readonly aliases: readonly DictionaryEntry[]

  /**
   * names: 이름 글·이름·별칭 묶음(`{ name, aliases }`)·배운 별칭(`{ heard, name }`)을 앞선 순서대로.
   * 공백 뺀 모양이 같으면 앞의 것 하나만 둔다(배운 별칭 → 판매 이력 → 기본 사전, D-V2-10). 공백 뺀 1글자 모양은 넣지 않는다.
   */
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
    const seen = new Set<string>()
    const entries: DictionaryEntry[] = []
    const aliases: DictionaryEntry[] = []
    for (const source of sourceForms(names)) {
      const form = normalizeText(source.form)
      const name = normalizeText(source.name)
      const key = compact(form)
      if (codePointLength(key) < 2 || codePointLength(compact(name)) < 2 || seen.has(key)) continue
      seen.add(key)
      const jamo = jamoOf(form)
      const entry: DictionaryEntry = { name, key, jamo: Object.freeze(jamo), ids: Int32Array.from(jamo, idOf), ...(source.alias ? { alias: true } : {}), ...(source.exactOnly === true ? { exactOnly: true } : {}) }
      ;(source.alias ? aliases : entries).push(Object.freeze(entry))
    }
    this.symbols = symbols
    this.entries = Object.freeze(entries)
    this.aliases = Object.freeze(aliases)
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
    // 별칭은 같은 모양 찾기에만 (비슷한 모양 찾기·후보는 이름만)
    for (const entry of this.aliases) {
      byKey.set(entry.key, entry)
      push(byJamo, jamoKey(entry.jamo), entry)
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

/**
 * 음성 사전 (D-V2-10): 배운 별칭 → 판매 이력 → 기본 사전(별칭 포함). 같은 공백 뺀 모양이면 앞의 것.
 * 판매 이력은 최근 것 먼저 — 부르는 쪽이 정렬해 넘긴다(D-I4-06). 배운 별칭은 최근에 쓴 것 먼저 넣는다.
 */
export function prepareVoiceDictionary(input: { readonly learned?: readonly LearnedAlias[]; readonly history?: readonly string[]; readonly base?: readonly VarietySource[] } = {}): VarietyDictionary {
  const learned = Array.isArray(input.learned) ? [...input.learned].sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0)) : []
  const history = Array.isArray(input.history) ? input.history : []
  const base = Array.isArray(input.base) ? input.base : DEFAULT_VARIETIES
  // 배운 별칭은 사전 이름·별칭을 가리지 않는다 — 같은 모양이면 사전이 이김 (D-V2-17)
  const known = new VarietyDictionary([...history, ...base])
  const kept = learned.filter((item) => !(isRecord(item) && typeof item.heard === 'string' && known.byKey.has(compact(normalizeText(item.heard)))))
  return new VarietyDictionary([...kept, ...history, ...base])
}

// ── 배운 별칭 (D-V2-10) ─────────────────────────────────────────────────

/** 배운 별칭 최대 수 (넘으면 가장 오래 안 쓴 것부터 지운다) */
export const LEARNED_ALIAS_MAX = 200

const isStopWord = (key: string): boolean => STOP_WORDS.some((word) => compact(normalizeText(word)) === key)

/** 배우기 막기에 쓸 사전: 판매 이력·기본 사전(이름·별칭). 배운 별칭은 넣지 않는다 (D-V2-17) */
export interface LearnOptions {
  /** 판매 이력 품종 이름 (생략하면 없음) */
  readonly history?: readonly string[]
  /** 기본 사전 (생략하면 DEFAULT_VARIETIES) */
  readonly base?: readonly VarietySource[]
}

let defaultKnown: VarietyDictionary | null = null
function knownDictionary(options: LearnOptions | undefined): VarietyDictionary {
  const history = Array.isArray(options?.history) ? options.history : []
  const base = Array.isArray(options?.base) ? options.base : null
  if (history.length === 0 && base === null) return (defaultKnown ??= new VarietyDictionary(DEFAULT_VARIETIES))
  return new VarietyDictionary([...history, ...(base ?? DEFAULT_VARIETIES)])
}

/**
 * 배울 만한가: 들은 말(공백 뺀)이 2글자 이상이고, 막는 낱말이 아니며, 고른 이름(공백 뺀)과 다르고,
 * 사전(판매 이력·기본 이름·별칭)의 어떤 이름·별칭과도 공백 뺀 모양이 같지 않다 (D-V2-17).
 */
export function canLearnAlias(heard: unknown, name: unknown, options?: LearnOptions): boolean {
  if (typeof heard !== 'string' || typeof name !== 'string') return false
  const key = compact(normalizeText(heard))
  const target = compact(normalizeText(name))
  // D-V3-38: 흔한 말(2글자 이하·군말·풀이말 끝·숫자)은 배우지 않는다 — 읽을 때도 이 검사로 버린다(readLearnedAliases)
  if (codePointLength(key) < 2 || codePointLength(target) < 2 || key === target || isStopWord(key) || isCommonWord(key)) return false
  try {
    return !knownDictionary(options).byKey.has(key)
  } catch {
    return false
  }
}

/**
 * 배운 별칭 넣기: 같은 들은 말이 있으면 새 이름으로 바꾸고, 200개를 넘으면 가장 오래 안 쓴(usedAt이 가장 작은) 것부터 지운다.
 * 배울 수 없는 것이면 목록을 그대로(복사) 돌려준다. 넘긴 목록을 바꾸지 않는다.
 */
export function learnAlias(list: readonly LearnedAlias[], input: { readonly heard: string; readonly name: string; readonly at: number }, options?: LearnOptions): LearnedAlias[] {
  const current = Array.isArray(list) ? list.filter((item) => typeof item?.heard === 'string' && typeof item?.name === 'string') : []
  if (!canLearnAlias(input?.heard, input?.name, options)) return [...current]
  const heard = compact(normalizeText(input.heard))
  const at = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : 0
  const next = [...current.filter((item) => compact(normalizeText(item.heard)) !== heard), { heard, name: normalizeText(input.name), usedAt: at }]
  next.sort((a, b) => b.usedAt - a.usedAt)
  return next.slice(0, LEARNED_ALIAS_MAX)
}

/** 배운 별칭을 썼다 (그 들은 말의 usedAt을 at으로) — 없으면 그대로(복사) */
export function touchLearnedAlias(list: readonly LearnedAlias[], heard: unknown, at: number): LearnedAlias[] {
  const current = Array.isArray(list) ? [...list] : []
  if (typeof heard !== 'string') return current
  const key = compact(normalizeText(heard))
  return current.map((item) => (typeof item?.heard === 'string' && compact(normalizeText(item.heard)) === key ? { ...item, usedAt: at } : item))
}

/** 저장소에서 읽은 값 → 배운 별칭 목록 (모양이 틀린 항목·배울 수 없는 항목은 버린다, 200개까지) */
export function readLearnedAliases(value: unknown): LearnedAlias[] {
  if (!Array.isArray(value)) return []
  const out: LearnedAlias[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { heard, name, usedAt } = item as Record<string, unknown>
    if (!canLearnAlias(heard, name)) continue
    out.push({ heard: compact(normalizeText(heard as string)), name: normalizeText(name as string), usedAt: typeof usedAt === 'number' && Number.isFinite(usedAt) ? usedAt : 0 })
  }
  return learnAliasesDedupe(out)
}

function learnAliasesDedupe(list: LearnedAlias[]): LearnedAlias[] {
  const sorted = [...list].sort((a, b) => b.usedAt - a.usedAt)
  const seen = new Set<string>()
  return sorted.filter((item) => (seen.has(item.heard) ? false : (seen.add(item.heard), true))).slice(0, LEARNED_ALIAS_MAX)
}
