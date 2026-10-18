// 결정성 검사용 직렬화 (NFR-02, AC-S00-27).
// 상태는 직렬화 가능한 순수 데이터여야 한다. 함수·심볼·클래스 인스턴스·순환 참조는 오류로 본다.
// 객체 키는 넣은 순서 그대로 적는다 → 실행마다 키 순서가 달라져도 결정성 위반으로 잡힌다.

export class SerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SerializationError'
  }
}

export function stableSerialize(value: unknown): string {
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
