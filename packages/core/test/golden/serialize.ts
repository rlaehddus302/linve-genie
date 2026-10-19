// 결정성 검사용 직렬화 (NFR-02, AC-S00-27).
// 상태는 직렬화 가능한 순수 데이터여야 한다. 함수·심볼·클래스 인스턴스·순환 참조는 오류로 본다.
// 객체 키는 넣은 순서 그대로 적는다 → 실행마다 키 순서가 달라져도 결정성 위반으로 잡힌다.

export class SerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SerializationError'
  }
}

// ── 빠른 길 ───────────────────────────────────────────────────────────────
// 러너는 단계마다 상태 전체를 여러 번 적는다(제자리 변경 검사·결정성 비교). 기준 구현은 값마다 경로 글자를 이어 붙이고
// 줄기 집합에 넣고 빼느라 골든 CLI 시간의 절반 넘게 걸렸다(P2 측정: 적는 글자 합 약 3,500만 자).
// 빠른 길은 경로·줄기 없이 적고, 다루지 않는 값을 만나면 기준 구현으로 처음부터 다시 돈다 — 결과 글자와 오류 문장은 기준 구현과 같다.

/** 빠른 길에서 다루지 않는 값을 만나면 던진다 → 기준 구현으로 다시 돈다 */
const SLOW_PATH = Symbol('slow-path')
/** 빠른 길이 걷는 최대 깊이. 넘으면(순환 참조일 수 있다) 기준 구현으로 다시 돈다 */
const FAST_MAX_DEPTH = 256
/** 되풀이되는 짧은 글자(객체 키·ID·이름)의 JSON 글자 기억. 결과에는 영향이 없다 */
const QUOTE_CACHE_LIMIT = 8192
const QUOTE_CACHE_MAX_LENGTH = 128
const quoted = new Map<string, string>()
const keyPrefixes = new Map<string, string>()

function quote(text: string): string {
  let out = quoted.get(text)
  if (out === undefined) {
    out = JSON.stringify(text)
    if (text.length <= QUOTE_CACHE_MAX_LENGTH && quoted.size < QUOTE_CACHE_LIMIT) quoted.set(text, out)
  }
  return out
}

/** `"키":` */
function keyPrefix(key: string): string {
  let out = keyPrefixes.get(key)
  if (out === undefined) {
    out = `${JSON.stringify(key)}:`
    if (key.length <= QUOTE_CACHE_MAX_LENGTH && keyPrefixes.size < QUOTE_CACHE_LIMIT) keyPrefixes.set(key, out)
  }
  return out
}

function fastWalk(v: unknown, depth: number): string {
  switch (typeof v) {
    case 'undefined':
      return 'undefined'
    case 'boolean':
      return v ? 'true' : 'false'
    case 'string':
      return quote(v)
    case 'bigint':
      return `${v.toString()}n`
    case 'number':
      if (Number.isNaN(v)) return 'NaN'
      if (Object.is(v, -0)) return '-0'
      // 유한한 수의 JSON 글자 = String(v)
      return Number.isFinite(v) ? String(v) : v > 0 ? 'Infinity' : '-Infinity'
    case 'object':
      break
    default:
      throw SLOW_PATH
  }
  if (v === null) return 'null'
  if (depth >= FAST_MAX_DEPTH) throw SLOW_PATH
  const next = depth + 1
  if (Array.isArray(v)) {
    const parts = new Array<string>(v.length)
    for (let i = 0; i < v.length; i++) parts[i] = fastWalk(v[i], next)
    return `[${parts.join(',')}]`
  }
  if (v instanceof Map) {
    const parts: string[] = []
    for (const [k, item] of v) parts.push(`${fastWalk(k, next)}=>${fastWalk(item, next)}`)
    return `Map{${parts.join(',')}}`
  }
  if (v instanceof Set) {
    const parts: string[] = []
    for (const item of v) parts.push(fastWalk(item, next))
    return `Set{${parts.join(',')}}`
  }
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) throw SLOW_PATH
  const record = v as Record<string, unknown>
  const keys = Object.keys(record)
  const parts = new Array<string>(keys.length)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string
    parts[i] = keyPrefix(key) + fastWalk(record[key], next)
  }
  return `{${parts.join(',')}}`
}

/**
 * 상태 → 결정적인 글자. 객체 키는 넣은 순서 그대로(키 순서가 달라지면 다른 글자).
 * 함수·심볼·순수 데이터가 아닌 객체·순환 참조는 SerializationError(경로 포함).
 */
export function stableSerialize(value: unknown): string {
  try {
    return fastWalk(value, 0)
  } catch (error) {
    if (error !== SLOW_PATH) throw error
    return referenceSerialize(value)
  }
}

/**
 * 기준 구현: 값마다 경로를 들고 다니며 순환 참조를 지금 걷는 줄기(stack)로 찾는다.
 * 빠른 길이 다루지 않는 값(오류가 날 값·아주 깊은 값)은 이 구현이 결과나 경로가 담긴 오류 문장을 만든다.
 * 시험에서 빠른 길과 결과를 맞댄다.
 */
export function referenceSerialize(value: unknown): string {
  const stack = new Set<object>()

  const walk = (v: unknown, path: string): string => {
    switch (typeof v) {
      case 'undefined':
        return 'undefined'
      case 'boolean':
        return v ? 'true' : 'false'
      case 'string':
        return JSON.stringify(v)
      case 'bigint':
        return `${v.toString()}n`
      case 'number':
        if (Number.isNaN(v)) return 'NaN'
        if (Object.is(v, -0)) return '-0'
        return Number.isFinite(v) ? JSON.stringify(v) : v > 0 ? 'Infinity' : '-Infinity'
      case 'function':
      case 'symbol':
        throw new SerializationError(`상태에 직렬화할 수 없는 값(${typeof v})이 있다: ${path || '(최상위)'}`)
      case 'object':
        break
    }
    if (v === null) return 'null'
    const obj = v as object
    if (stack.has(obj)) throw new SerializationError(`상태에 순환 참조가 있다: ${path || '(최상위)'}`)
    stack.add(obj)
    try {
      if (Array.isArray(obj)) {
        const parts: string[] = []
        for (let i = 0; i < obj.length; i++) parts.push(walk(obj[i], `${path}[${i}]`))
        return `[${parts.join(',')}]`
      }
      if (obj instanceof Map) {
        const parts: string[] = []
        let i = 0
        for (const [k, item] of obj) {
          parts.push(`${walk(k, `${path}<key ${i}>`)}=>${walk(item, `${path}<${i}>`)}`)
          i++
        }
        return `Map{${parts.join(',')}}`
      }
      if (obj instanceof Set) {
        const parts: string[] = []
        let i = 0
        for (const item of obj) parts.push(walk(item, `${path}<${i++}>`))
        return `Set{${parts.join(',')}}`
      }
      const proto: unknown = Object.getPrototypeOf(obj)
      if (proto !== Object.prototype && proto !== null) {
        const name = (obj as { constructor?: { name?: string } }).constructor?.name ?? '알 수 없음'
        throw new SerializationError(`상태에 순수 데이터가 아닌 객체(${name})가 있다: ${path || '(최상위)'}`)
      }
      const record = obj as Record<string, unknown>
      const parts = Object.keys(record).map((key) => `${JSON.stringify(key)}:${walk(record[key], path ? `${path}.${key}` : key)}`)
      return `{${parts.join(',')}}`
    } finally {
      stack.delete(obj)
    }
  }

  return walk(value, '')
}
