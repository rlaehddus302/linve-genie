// 품종 유사도 (DOMAIN_RULES R-17 5, D-203): 자모 = 공백을 지우고 유니코드 NFD로 푼 코드 포인트 하나.
// 유사도 = 1 − 자모 편집 거리 ÷ 긴 쪽 자모 수. 0.8 이상(거리 × 5 ≤ 긴 쪽 자모 수)만 후보다. 비교는 정수로만 한다(부동소수점 없음).

/** 공백(R-3의 공백 — 정규화한 글에는 ' '만 남는다)을 지운 글 */
export function compact(text: string): string {
  return text.split(' ').join('')
}

/** 공백을 지우고 NFD로 푼 코드 포인트 목록 (한글 음절은 초성·중성·종성 2~3개, 그 밖의 글자는 한 개) */
export function jamoOf(text: string): number[] {
  const out: number[] = []
  for (const char of compact(text).normalize('NFD')) out.push(char.codePointAt(0) as number)
  return out
}

/** 자모 목록을 맵 키로 (같은 자모 = 유사도 1) */
export function jamoKey(jamo: readonly number[]): string {
  return jamo.join(',')
}

/** 넣기·지우기·바꾸기 각 1인 편집 거리 (두 줄 동적 계획법 — 기준 구현) */
export function editDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Array<number>(b.length + 1)
  let next = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    next[0] = i
    const ai = a[i - 1]
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b[j - 1] ? 0 : 1
      next[j] = Math.min((prev[j] as number) + 1, (next[j - 1] as number) + 1, (prev[j - 1] as number) + cost)
    }
    ;[prev, next] = [next, prev]
  }
  return prev[b.length] as number
}

/** 비트 병렬 계산에 쓸 수 있는 패턴 최대 길이 (32비트 정수 안에서 자리 올림이 넘치지 않게) */
export const BIT_PATTERN_MAX = 31

/**
 * 패턴 하나를 여러 글과 빠르게 비교하는 준비물 (Myers·Hyyrö 비트 병렬 편집 거리).
 * 패턴이 31자모를 넘으면 기준 구현(editDistance)을 쓴다. 결과는 editDistance와 같다(단위 테스트로 맞춘다).
 */
export class JamoPattern {
  readonly jamo: readonly number[]
  private readonly peq: Map<number, number> | null

  constructor(jamo: readonly number[]) {
    this.jamo = jamo
    if (jamo.length === 0 || jamo.length > BIT_PATTERN_MAX) {
      this.peq = null
      return
    }
    const peq = new Map<number, number>()
    jamo.forEach((code, i) => peq.set(code, (peq.get(code) ?? 0) | (1 << i)))
    this.peq = peq
  }

  /** 이 패턴과 글 b의 편집 거리 */
  distanceTo(b: readonly number[]): number {
    const m = this.jamo.length
    if (this.peq === null) return editDistance(this.jamo, b)
    const peq = this.peq
    const last = 1 << (m - 1)
    // 아래 m비트를 모두 1로 (m ≤ 31이라 양의 32비트 정수)
    let pv = -1 >>> (32 - m)
    let mv = 0
    let score = m
    for (const code of b) {
      const eq = peq.get(code) ?? 0
      const xv = eq | mv
      const xh = (((eq & pv) + pv) ^ pv) | eq
      let ph = mv | ~(xh | pv)
      let mh = pv & xh
      if (ph & last) score++
      else if (mh & last) score--
      ph = (ph << 1) | 1
      mh = mh << 1
      pv = mh | ~(xv | ph)
      mv = ph & xv
    }
    return score
  }
}

/**
 * 사전 전용 빠른 길: 자모를 사전의 기호 번호(코드 포인트 → 0부터의 번호)로 바꿔 두고, 패턴의 일치 비트를 번호로 찾는다(맵 조회 없음).
 * peq[기호 번호] = 패턴에서 그 기호가 있는 자리의 비트. 패턴은 1~31자모. 결과가 limit을 넘을 것이 확실해지면 limit + 1을 돌려준다.
 */
export function bitParallelDistance(m: number, peq: Int32Array, ids: Int32Array, limit: number): number {
  const last = 1 << (m - 1)
  let pv = -1 >>> (32 - m)
  let mv = 0
  let score = m
  const n = ids.length
  for (let j = 0; j < n; j++) {
    const id = ids[j] as number
    const eq = id < 0 ? 0 : (peq[id] as number)
    const xv = eq | mv
    const xh = (((eq & pv) + pv) ^ pv) | eq
    let ph = mv | ~(xh | pv)
    let mh = pv & xh
    if (ph & last) score++
    else if (mh & last) score--
    // 남은 글자마다 거리는 많아야 1씩 준다
    if (score - (n - 1 - j) > limit) return limit + 1
    ph = (ph << 1) | 1
    mh = mh << 1
    pv = mh | ~(xv | ph)
    mv = ph & xv
  }
  return score
}

/** 유사도를 분수로: 1 − distance / length (length = 긴 쪽 자모 수) */
export interface Similarity {
  readonly distance: number
  readonly length: number
}

/** 후보 조건: 유사도 0.8 이상 ⇔ 거리 × 5 ≤ 긴 쪽 자모 수 (R-17 5). 두 글이 모두 4자모 이하이면 이 조건이 곧 "정확히 같음"이다 */
export function isCandidate(similarity: Similarity): boolean {
  return similarity.length > 0 && similarity.distance * 5 <= similarity.length
}

/** a와 b의 유사도 비교: 양수면 a가 더 높다 (분수 비교 — (La−da)/La 대 (Lb−db)/Lb) */
export function compareSimilarity(a: Similarity, b: Similarity): number {
  return (a.length - a.distance) * b.length - (b.length - b.distance) * a.length
}

/** 유사도가 1인가 (공백만 다름) */
export function isExact(similarity: Similarity): boolean {
  return similarity.distance === 0
}

/** 길이 la인 글과 후보가 될 수 있는 글의 자모 수 범위 [min, max] — |la − lb| ≤ 거리 ≤ max(la, lb) / 5 에서 나온다 */
export function candidateLengthRange(la: number): { readonly min: number; readonly max: number } {
  return { min: Math.ceil((la * 4) / 5), max: Math.floor((la * 5) / 4) }
}
