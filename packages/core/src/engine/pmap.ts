// 직렬화 가능한 영속 맵 (AC-S02-02·05, AC-S03-05). 평범한 객체·배열만으로 된 세 단계 해시 트라이다.
// - 값을 하나 넣으면 지나가는 마디 네 개(32칸·32칸·32칸·잎)만 새로 만들고 나머지는 이전 상태와 공유한다.
//   그래서 상태가 커져도 이벤트마다 전체 모음을 복사하지 않는다.
// - 잎은 [키, 값] 쌍의 배열이다. 잎을 키가 제각각인 객체로 두면 넣을 때마다 실행 엔진이 새 객체 모양(숨은 클래스)을 만들어
//   맵이 커질수록 한 번 넣는 비용이 늘었다(S03 측정). 32칸 마디의 키는 "0"~"31"이라 그런 문제가 없다.
// - 잎은 32×32×32칸에 나뉘어 키가 수만 개여도 잎 하나에 한두 개라, 잎을 처음부터 훑어 찾아도 찾는 비용이 맵 크기에 따라 늘지 않는다.
// - JSON으로 왕복해도 같은 맵이다(함수·Map·클래스 없음). 키 해시는 문자열만 보는 결정적인 계산(FNV-1a)이다.
// - 키는 신뢰할 수 없는 문자열(메시지 ID·채널 ID)일 수 있다. 잎은 배열이라 `__proto__` 같은 키도 그냥 문자열로 비교한다.

type Entry<V> = readonly [string, V]
type Leaf<V> = readonly Entry<V>[]
type Twig<V> = Readonly<Record<string, Leaf<V>>>
type Branch<V> = Readonly<Record<string, Twig<V>>>

export interface PMap<V> {
  /** 들어 있는 키 수 */
  readonly size: number
  /** 해시 5비트씩 세 번 → 잎([키, 값] 쌍, 넣은 순서) */
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

function slots(key: string): readonly [string, string, string] {
  const h = hash(key)
  return [String(h & FANOUT_MASK), String((h >>> FANOUT_BITS) & FANOUT_MASK), String((h >>> (2 * FANOUT_BITS)) & FANOUT_MASK)]
}

function child<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function leafOf<V>(map: PMap<V>, a: string, b: string, c: string): Leaf<V> | undefined {
  const branch = child(map.root, a)
  const twig = branch === undefined ? undefined : child(branch, b)
  return twig === undefined ? undefined : child(twig, c)
}

function indexIn<V>(leaf: Leaf<V>, key: string): number {
  for (let i = 0; i < leaf.length; i++) if ((leaf[i] as Entry<V>)[0] === key) return i
  return -1
}

export function pget<V>(map: PMap<V>, key: string): V | undefined {
  const [a, b, c] = slots(key)
  const leaf = leafOf(map, a, b, c)
  if (leaf === undefined) return undefined
  const at = indexIn(leaf, key)
  return at < 0 ? undefined : (leaf[at] as Entry<V>)[1]
}

export function phas<V>(map: PMap<V>, key: string): boolean {
  return pget(map, key) !== undefined
}

/** 키에 값을 넣은 새 맵. 넘긴 맵은 바꾸지 않는다. 값은 undefined가 아니어야 한다. */
export function pset<V>(map: PMap<V>, key: string, value: V): PMap<V> {
  const [a, b, c] = slots(key)
  const branch = child(map.root, a) ?? {}
  const twig = child(branch, b) ?? {}
  const leaf = child(twig, c) ?? []
  const at = indexIn(leaf, key)
  const next: Leaf<V> = at < 0 ? [...leaf, [key, value]] : leaf.with(at, [key, value])
  return {
    size: map.size + (at < 0 ? 1 : 0),
    root: { ...map.root, [a]: { ...branch, [b]: { ...twig, [c]: next } } },
  }
}

/** 키를 뺀 새 맵. 없는 키면 같은 맵 */
export function pdelete<V>(map: PMap<V>, key: string): PMap<V> {
  const [a, b, c] = slots(key)
  const branch = child(map.root, a)
  const twig = branch === undefined ? undefined : child(branch, b)
  const leaf = twig === undefined ? undefined : child(twig, c)
  const at = leaf === undefined ? -1 : indexIn(leaf, key)
  if (branch === undefined || twig === undefined || leaf === undefined || at < 0) return map
  return { size: map.size - 1, root: { ...map.root, [a]: { ...branch, [b]: { ...twig, [c]: leaf.toSpliced(at, 1) } } } }
}

/** 모든 값 (트라이 순서 — 결정적이지만 의미 있는 순서는 아니다. 보여 줄 때는 명시적인 키로 정렬한다) */
export function pvalues<V>(map: PMap<V>): V[] {
  const out: V[] = []
  for (const branch of Object.values(map.root)) {
    for (const twig of Object.values(branch)) {
      for (const leaf of Object.values(twig)) {
        for (const entry of leaf) out.push(entry[1])
      }
    }
  }
  return out
}

/** 모든 키 (트라이 순서, pvalues와 같은 순서) */
export function pkeys<V>(map: PMap<V>): string[] {
  const out: string[] = []
  for (const branch of Object.values(map.root)) {
    for (const twig of Object.values(branch)) {
      for (const leaf of Object.values(twig)) {
        for (const entry of leaf) out.push(entry[0])
      }
    }
  }
  return out
}

/** 모든 [키, 값] 쌍 (트라이 순서, pvalues와 같은 순서). 키마다 찾아보는 것보다 한 번에 훑는 편이 빠르다 */
export function pentries<V>(map: PMap<V>): (readonly [string, V])[] {
  const out: (readonly [string, V])[] = []
  for (const branch of Object.values(map.root)) {
    for (const twig of Object.values(branch)) {
      for (const leaf of Object.values(twig)) {
        for (const entry of leaf) out.push(entry)
      }
    }
  }
  return out
}
