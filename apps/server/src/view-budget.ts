// 보기 캐시 상한 (AC-S06b-12, D-104, RA-S06-002, NFR-01·04, SYS-02).
// 범위마다의 보기 캐시(색인 8·메시지 4 — D-096)는 그대로 두고, 보기 캐시를 가진 범위 수를 묶는다:
// - 판매자마다 가장 최근에 조회한 범위 4개까지. 5번째 범위를 조회하면 그 판매자의 가장 오래 조회하지 않은 범위의 캐시를 비운다.
//   다른 판매자의 캐시는 건드리지 않는다(D-096 — 한 판매자의 조회가 다른 판매자를 밀어내지 않는다).
// - 서버 전체로 32개까지. 넘으면 가장 오래 조회하지 않은 범위부터 비운다(판매자 9명 이상이 저마다 범위 4개씩 조회할 때만 닿는 방어선).
// - 마지막 조회 뒤 10분이 지난 범위의 캐시는 다음 정리 때 비운다.
// 비우는 것은 보기 캐시뿐이다. 범위 실행 상태(writer의 상한 128)는 그대로이고, 비운 범위를 다시 조회하면 다시 계산한다(결과는 같다).
// 정리는 조회 때(use)와 쓰기 커밋 뒤(sweep)에 한다. 항목이 많아야 33개라 판정·저장 경로를 늦추지 않는다. 타이머는 없다.
import type { ScopeRuntime } from './runtime.ts'
import { clearViewCaches, type ViewCaches } from './views.ts'

/** 판매자마다 보기 캐시를 가진 범위 수 상한 */
export const VIEW_CACHE_SCOPES_PER_SELLER = 4
/** 서버 전체로 보기 캐시를 가진 범위 수 상한 */
export const VIEW_CACHE_SCOPES_MAX = 32
/** 마지막 조회 뒤 이만큼 지나면 그 범위의 보기 캐시를 비운다 (10분) */
export const VIEW_CACHE_IDLE_MS = 10 * 60 * 1000

/** 보기 캐시를 쓰는 범위 실행 상태 (범위 키와 캐시) */
export type ViewScope = Pick<ScopeRuntime, 'sellerId' | 'date' | 'rehearsal' | 'views'>

export interface ViewCacheBudgetOptions {
  /** 서버 시계 (UTC 밀리초) */
  readonly now: () => number
  readonly perSeller?: number
  readonly max?: number
  readonly idleMs?: number
}

interface Entry {
  readonly sellerId: string
  readonly views: ViewCaches
  readonly lastUsed: number
}

const keyOf = (sellerId: string, date: string, rehearsal: boolean): string => JSON.stringify([sellerId, date, rehearsal])

export class ViewCacheBudget {
  readonly #now: () => number
  readonly #perSeller: number
  readonly #max: number
  readonly #idleMs: number
  /** 범위 키 → 항목. 넣은 순서 = 마지막으로 조회한 순서 (앞이 가장 오래 조회하지 않은 것) */
  readonly #entries = new Map<string, Entry>()

  constructor(options: ViewCacheBudgetOptions) {
    const perSeller = options.perSeller ?? VIEW_CACHE_SCOPES_PER_SELLER
    const max = options.max ?? VIEW_CACHE_SCOPES_MAX
    const idleMs = options.idleMs ?? VIEW_CACHE_IDLE_MS
    if (!Number.isSafeInteger(perSeller) || perSeller < 1 || !Number.isSafeInteger(max) || max < 1) throw new RangeError('보기 캐시 범위 수 상한은 1 이상이어야 한다')
    if (!Number.isSafeInteger(idleMs) || idleMs < 1) throw new RangeError('보기 캐시를 비우는 시간은 1밀리초 이상이어야 한다')
    this.#now = options.now
    this.#perSeller = perSeller
    this.#max = max
    this.#idleMs = idleMs
  }

  /**
   * 그 범위의 보기 캐시를 쓰기 직전에 부른다: 가장 최근에 조회한 범위로 옮기고, 오래된 범위·상한을 넘은 범위의 캐시를 비운다.
   * 지금 조회하는 범위의 캐시는 비우지 않는다
   */
  use(scope: ViewScope): void {
    const key = keyOf(scope.sellerId, scope.date, scope.rehearsal)
    const now = this.#now()
    const previous = this.#entries.get(key)
    if (previous !== undefined) {
      this.#entries.delete(key)
      // 같은 범위를 다시 불러온 새 실행 상태면 앞의 것(메모리에서 내려간 실행 상태)의 캐시는 비운다
      if (previous.views !== scope.views) clearViewCaches(previous.views)
    }
    this.#entries.set(key, { sellerId: scope.sellerId, views: scope.views, lastUsed: now })
    this.#expire(now, key)
    let mine = this.countOf(scope.sellerId)
    for (const [other, entry] of this.#entries) {
      if (mine <= this.#perSeller) break
      if (other === key || entry.sellerId !== scope.sellerId) continue
      this.#evict(other, entry)
      mine -= 1
    }
    for (const [other, entry] of this.#entries) {
      if (this.#entries.size <= this.#max) break
      if (other !== key) this.#evict(other, entry)
    }
  }

  /** 마지막 조회 뒤 오래된 범위의 캐시를 비운다 (쓰기 커밋 뒤에 부른다) */
  sweep(): void {
    this.#expire(this.#now(), null)
  }

  /** 범위 실행 상태가 메모리에서 내려갈 때(writer의 상한·forget): 그 캐시를 비우고 항목을 지운다 */
  release(scope: ViewScope): void {
    clearViewCaches(scope.views)
    const key = keyOf(scope.sellerId, scope.date, scope.rehearsal)
    if (this.#entries.get(key)?.views === scope.views) this.#entries.delete(key)
  }

  /** 보기 캐시를 가진 범위 수 (시험·점검용) */
  get size(): number {
    return this.#entries.size
  }

  /** 그 판매자의 보기 캐시를 가진 범위 수 */
  countOf(sellerId: string): number {
    let count = 0
    for (const entry of this.#entries.values()) if (entry.sellerId === sellerId) count += 1
    return count
  }

  /** 그 범위가 보기 캐시를 가진 범위로 남아 있는지 */
  has(sellerId: string, date: string, rehearsal = false): boolean {
    return this.#entries.has(keyOf(sellerId, date, rehearsal))
  }

  #expire(now: number, keep: string | null): void {
    for (const [key, entry] of this.#entries) {
      if (key !== keep && now - entry.lastUsed >= this.#idleMs) this.#evict(key, entry)
    }
  }

  #evict(key: string, entry: Entry): void {
    clearViewCaches(entry.views)
    this.#entries.delete(key)
  }
}
