// 직렬화 가능한 영속 맵 (AC-S02-02·05). 평범한 객체만으로 된 두 단계 해시 트라이다.
// - 값을 하나 넣으면 지나가는 마디 세 개(32칸·32칸·잎)만 새로 만들고 나머지는 이전 상태와 공유한다.
//   그래서 상태가 커져도 이벤트마다 전체 모음을 복사하지 않는다.
// - JSON으로 왕복해도 같은 맵이다(함수·Map·클래스 없음). 키 해시는 문자열만 보는 결정적인 계산(FNV-1a)이다.
// - 키는 신뢰할 수 없는 문자열(메시지 ID·채널 ID)일 수 있으므로 읽을 때는 항상 자기 속성인지 확인한다(`__proto__` 등).

type Leaf<V> = Readonly<Record<string, V>>
type Branch<V> = Readonly<Record<string, Leaf<V>>>

export interface PMap<V> {
  /** 들어 있는 키 수 */
  readonly size: number
  /** 해시 앞 5비트 → 다음 5비트 → 잎(키 → 값) */
  readonly root: Readonly<Record<string, Branch<V>>>
}

const FANOUT_BITS = 5
const FANOUT_MASK = (1 << FANOUT_BITS) - 1

export function emptyPMap<V>(): PMap<V> {
  return { size: 0, root: {} }
}

/** FNV-1a 32비트 (UTF-16 코드 단위). 실행 환경과 상관없이 같은 값 */
function hash(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function slots(key: string): readonly [string, string] {
  const h = hash(key)
  return [String(h & FANOUT_MASK), String((h >>> FANOUT_BITS) & FANOUT_MASK)]
}

function child<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function pget<V>(map: PMap<V>, key: string): V | undefined {
  const [a, b] = slots(key)
  const branch = child(map.root, a)
  const leaf = branch === undefined ? undefined : child(branch, b)
  return leaf === undefined ? undefined : child(leaf, key)
}

export function phas<V>(map: PMap<V>, key: string): boolean {
  return pget(map, key) !== undefined
}

/** 키에 값을 넣은 새 맵. 넘긴 맵은 바꾸지 않는다. 값은 undefined가 아니어야 한다. */
export function pset<V>(map: PMap<V>, key: string, value: V): PMap<V> {
  const [a, b] = slots(key)
  const branch = child(map.root, a) ?? {}
  const leaf = child(branch, b) ?? {}
  const existed = Object.hasOwn(leaf, key)
  return {
    size: map.size + (existed ? 0 : 1),
    root: { ...map.root, [a]: { ...branch, [b]: { ...leaf, [key]: value } } },
  }
}

/** 키를 뺀 새 맵. 없는 키면 같은 맵 */
export function pdelete<V>(map: PMap<V>, key: string): PMap<V> {
  const [a, b] = slots(key)
  const branch = child(map.root, a)
  const leaf = branch === undefined ? undefined : child(branch, b)
  if (leaf === undefined || !Object.hasOwn(leaf, key)) return map
  const { [key]: _removed, ...rest } = leaf
  return { size: map.size - 1, root: { ...map.root, [a]: { ...branch, [b]: rest } } }
}

/** 모든 값 (트라이 순서 — 결정적이지만 의미 있는 순서는 아니다. 보여 줄 때는 명시적인 키로 정렬한다) */
export function pvalues<V>(map: PMap<V>): V[] {
  const out: V[] = []
  for (const branch of Object.values(map.root)) {
    for (const leaf of Object.values(branch)) {
      for (const value of Object.values(leaf)) out.push(value)
    }
  }
  return out
}

/** 모든 키 (트라이 순서, pvalues와 같은 순서) */
export function pkeys<V>(map: PMap<V>): string[] {
  const out: string[] = []
  for (const branch of Object.values(map.root)) {
    for (const leaf of Object.values(branch)) {
      for (const key of Object.keys(leaf)) out.push(key)
    }
  }
  return out
}
