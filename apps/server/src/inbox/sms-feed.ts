// 방송 화면 "채팅·문자" 탭의 최근 문자 (D-UX4-12, 사용자 지시 2026-11-08 "방송 중 화면에서 실시간 채팅, 문자 오는거 볼 수 있게").
// - 손님 문자(휴대폰 알림 받기 → 방송 창 안의 문자)만 적는다. 은행·앱 알림은 적지 않는다.
// - 본문을 DB에 두지 않는다는 규칙(C-07 "넣은 문자찜·거른 문자·찜 아닌 문자의 본문은 저장하지 않는다")을 지키려 이 서버 메모리에만 둔다:
//   방송마다 최근 FEED_MAX통, 마지막 문자 뒤 FEED_KEEP_MS가 지나면 지운다(처리 안 한 카드를 지우는 24시간과 같음). 서버를 다시 켜면 비어 있다.
// - 보낸 사람은 휴대폰 끝 4자리 또는 보낸 이름(화면용으로 정리한 글)만 — 전체 번호는 두지 않는다. 로그에도 남기지 않는다.
import { randomUUID } from 'node:crypto'

export const SMS_FEED_MAX = 200
export const SMS_FEED_KEEP_MS = 24 * 3_600_000

/** 서버가 그 문자로 한 일 — claim 찜으로 넣음 · cancel 취소 요청 카드 · review 확인 필요 카드 · info 손님 정보(닉네임·주소) · none 찜 아님 · stale 오래된 방송이라 넣지 않음 */
export type SmsFeedResult = 'claim' | 'cancel' | 'review' | 'info' | 'none' | 'stale'

export interface SmsFeedEntry {
  readonly id: string
  /** 휴대폰이 받은 시각 (ISO) */
  readonly at: string
  /** 보낸 휴대폰 끝 4자리 (휴대폰 번호가 아니면 null) */
  readonly last4: string | null
  /** 휴대폰 번호가 아닐 때 보낸 이름 */
  readonly sender: string | null
  readonly text: string
  readonly result: SmsFeedResult
  /** 넣은 찜·취소 요청·확인할 번호 */
  readonly numbers: readonly number[]
}

export interface SmsFeedInput {
  readonly atMs: number
  readonly last4: string | null
  readonly sender: string | null
  readonly text: string
  readonly result: SmsFeedResult
  readonly numbers?: readonly number[]
}

export class SmsFeed {
  readonly #now: () => number
  /** `${판매자}\n${방송}` → 최근 문자(오래된 것 앞) · 마지막으로 적은 서버 시각 */
  readonly #lists = new Map<string, { entries: SmsFeedEntry[]; touched: number }>()

  constructor(now: () => number) {
    this.#now = now
  }

  add(sellerId: string, broadcastId: string, input: SmsFeedInput): void {
    this.#sweep()
    const key = `${sellerId}\n${broadcastId}`
    const list = this.#lists.get(key) ?? { entries: [], touched: 0 }
    list.entries.push({ id: randomUUID(), at: new Date(input.atMs).toISOString(), last4: input.last4, sender: input.sender, text: input.text, result: input.result, numbers: [...(input.numbers ?? [])] })
    if (list.entries.length > SMS_FEED_MAX) list.entries.splice(0, list.entries.length - SMS_FEED_MAX)
    list.touched = this.#now()
    this.#lists.set(key, list)
  }

  /** 그 방송의 최근 문자 (최신이 앞) */
  view(sellerId: string, broadcastId: string): SmsFeedEntry[] {
    this.#sweep()
    return [...(this.#lists.get(`${sellerId}\n${broadcastId}`)?.entries ?? [])].reverse()
  }

  clear(): void {
    this.#lists.clear()
  }

  #sweep(): void {
    const cutoff = this.#now() - SMS_FEED_KEEP_MS
    for (const [key, list] of this.#lists) if (list.touched < cutoff) this.#lists.delete(key)
  }
}
