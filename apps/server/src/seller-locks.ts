// 판매자마다 한 줄로 처리하기 (프로세스 안). 라이브 잇기·끊기와 웹훅 댓글 기록이 같은 판매자 안에서 엇갈리지 않게 한다(N2, D-N2-08).
// 여러 인스턴스 사이는 DB 어드바이저리 락·유일 제약이 지킨다.
// N2b-2(D-N2b-2-01): 모든 플랫폼(유튜브·인스타그램·틱톡)의 잇기·기다리기·끊기는 판매자 잠금 하나(이 줄 + sellerLinkLockKey 어드바이저리 락) 안에서 한다.
import { sql, type SQL } from 'drizzle-orm'

/** 판매자의 라이브 연결 어드바이저리 락 키 (플랫폼 공통 — 트랜잭션 안에서 pg_advisory_xact_lock) */
export const sellerLinkLockKey = (sellerId: string): SQL => sql`hashtextextended(${`live-link/${sellerId}`}, 0)`

export class SellerLocks {
  readonly #chains = new Map<string, Promise<unknown>>()

  run<T>(sellerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(sellerId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.#chains.set(sellerId, settled)
    void settled.then(() => {
      if (this.#chains.get(sellerId) === settled) this.#chains.delete(sellerId)
    })
    return run
  }
}
