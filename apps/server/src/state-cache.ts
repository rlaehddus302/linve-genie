// 상태(불변 객체) → 계산한 값 캐시. 가장 최근에 쓴 몇 개만 둔다.
// 범위 실행 상태(ScopeRuntime)마다 하나씩 둔다 — 모든 판매자가 함께 쓰는 캐시는 없다(AC-S06-72, D-096).
// 범위 실행 상태가 메모리에서 내려가면(writer의 상한·forget) 그 캐시도 함께 사라진다.
import type { EngineState } from '@livejjim/core'

export class StateCache<T> {
  readonly #max: number
  readonly #entries = new Map<EngineState, T>()
  #builds = 0

  constructor(max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('캐시 크기는 1 이상이어야 한다')
    this.#max = max
  }

  get(state: EngineState, make: (state: EngineState) => T): T {
    const hit = this.#entries.get(state)
    if (hit !== undefined) {
      this.#entries.delete(state)
      this.#entries.set(state, hit)
      return hit
    }
    const value = make(state)
    this.#builds += 1
    this.#entries.set(state, value)
    while (this.#entries.size > this.#max) {
      const oldest = this.#entries.keys().next().value as EngineState
      this.#entries.delete(oldest)
    }
    return value
  }

  /** 지금 둔 상태 수 */
  get size(): number {
    return this.#entries.size
  }

  /** 지금까지 새로 계산한 횟수 (시험·점검용) */
  get builds(): number {
    return this.#builds
  }
}
