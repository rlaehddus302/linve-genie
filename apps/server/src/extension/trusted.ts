// 확장 연결 코드를 만든 주소 (QS1 D-QS1-06 (3), SPEC YT-10 AC4 "코드 넣기 한도").
// 로그인한 판매자 화면이 "확장 연결" 코드를 만들거나 다시 만든 연결 주소(IP 한도와 같은 키 — IPv6는 앞 64비트)를 그 코드가 살아 있는 10분 동안 기억한다.
// 판매자마다 최근 3개(같은 주소는 새로 만든 때로 옮긴다, 넘치면 가장 오래된 것부터 버린다). 그 주소에서 온 코드 넣기는 서버 전체 한도를 세지도 막지도 않는다
// (주소마다 20번은 그대로 센다 — routes.ts). 서버 메모리에만 둔다(DB·로그 없음, 절대 규칙 7). 서버를 다시 켜면 비워진다(코드를 다시 만들면 된다).

/** 믿는 주소가 살아 있는 시간 (코드 수명과 같다, 밀리초) */
export const TRUSTED_TTL_MS = 10 * 60 * 1000
/** 판매자마다 믿는 주소 수 */
export const TRUSTED_PER_SELLER = 3

interface Entry {
  readonly key: string
  readonly until: number
}

export class TrustedAddresses {
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #perSeller: number
  /** 판매자 ID → 오래된 것부터 */
  readonly #bySeller = new Map<string, Entry[]>()

  constructor(now: () => number, options: { readonly ttlMs?: number; readonly perSeller?: number } = {}) {
    this.#now = now
    this.#ttlMs = options.ttlMs ?? TRUSTED_TTL_MS
    this.#perSeller = options.perSeller ?? TRUSTED_PER_SELLER
  }

  /** 그 판매자가 이 주소(키)에서 코드를 만들었다. 키가 null(주소를 모름)이면 아무것도 하지 않는다 */
  remember(sellerId: string, key: string | null): void {
    if (key === null) return
    const now = this.#now()
    const kept = (this.#bySeller.get(sellerId) ?? []).filter((entry) => entry.until > now && entry.key !== key)
    kept.push({ key, until: now + this.#ttlMs })
    while (kept.length > this.#perSeller) kept.shift()
    this.#bySeller.set(sellerId, kept)
  }

  /** 이 주소(키)가 지금 어떤 판매자의 믿는 주소인지 (지난 것은 함께 치운다) */
  has(key: string | null): boolean {
    if (key === null) return false
    const now = this.#now()
    let found = false
    for (const [sellerId, entries] of this.#bySeller) {
      const alive = entries.filter((entry) => entry.until > now)
      if (alive.length === 0) this.#bySeller.delete(sellerId)
      else if (alive.length !== entries.length) this.#bySeller.set(sellerId, alive)
      if (alive.some((entry) => entry.key === key)) found = true
    }
    return found
  }

  /** 그 판매자의 지금 믿는 주소 수 (시험·점검 — 주소 값은 내주지 않는다) */
  countFor(sellerId: string): number {
    const now = this.#now()
    return (this.#bySeller.get(sellerId) ?? []).filter((entry) => entry.until > now).length
  }
}
