// 연결이 돌아오면 저절로 한 번 다시 보내기 (UX-06, D-MOB2-07).
// - 대상: 이 화면이 열린 동안 메모리에 남은, 기록되지 않았음이 확실한 실패(ApiError.retryable — 네트워크 실패·SAVE_FAILED)만.
//   새로고침·화면을 닫으면 버린다(쌓아 두지 않는다 — D-093·D-103).
// - 때: 실시간 연결이 끊김 뒤 다시 이어진 순간 한 번(ConsoleStore.onReconnect).
// - 차례: 빠른 입력 등록 → 상품 관리 명령 → 방송자 조치(되돌리기 목록) → 문자찜. 종류마다 처음 실패한 차례, 하나씩(앞이 끝난 뒤 다음).
// - 요청 번호는 처음 것 그대로(각 항목의 run이 같은 번호로 보낸다 — 서버가 한 번만 기록한다).
// - 다시 보내는 중에 또 다시 이어짐 알림이 와도 겹쳐 보내지 않는다(동시에 하나). 대신 그 알림을 표시해 두었다가 지금 차례가 끝나면
//   남은 항목으로 한 번 더 돈다(TD-MOB2-001 — 그 사이 다시 실패해 올라온 항목이 연결이 이어졌는데도 다음 끊김까지 남지 않게).
//   또 실패한 항목은 그 화면이 다시 올리고, 다음 회복 때 한 번 더.

export type ResendKind = 'register' | 'command' | 'sms'

const KIND_ORDER: Readonly<Record<ResendKind, number>> = { register: 0, command: 1, sms: 3 }
/** 방송자 조치(되돌리기 목록)의 차례 — 상품 관리 명령 뒤, 문자찜 앞 */
const HOST_ORDER = 2

/** 성공하면 붙이는 앞말 (D-MOB2-07) */
export const RESENT_PREFIX = '연결이 돌아와 보냈어요: '
/** 실패 줄에 덧붙이는 안내 (다시 보낼 대상인 실패만) */
export const AUTO_RESEND_NOTE = '연결이 돌아오면 저절로 다시 보내요.'
/** 저절로 다시 보내려다 그사이 상품 상태가 바뀌어 그만둔 때 (RA-MOB2-01) */
export const STATUS_CHANGED_NOTE = '그사이 상품 상태가 바뀌어 저절로 보내지 않았어요. 지금 상태를 보고 필요하면 다시 눌러 주세요.'
/** 저절로 다시 보내는 동안 */
export const RESENDING_WORD = '다시 보내는 중…'

interface Entry {
  readonly kind: ResendKind
  readonly order: number
  readonly run: () => Promise<void>
}

export class ResendBoard {
  readonly #entries = new Map<string, Entry>()
  readonly #hosts = new Set<() => Promise<void>>()
  #order = 0
  #running = false
  /** 보내는 중에 다시 이어짐 알림이 또 왔다 — 지금 차례가 끝나면 한 번 더 */
  #again = false

  /** 다시 보낼 실패 하나를 올린다(같은 key면 바꿈 — 처음 차례는 그대로) */
  add(key: string, kind: ResendKind, run: () => Promise<void>): void {
    const old = this.#entries.get(key)
    this.#entries.set(key, { kind, order: old?.order ?? this.#order++, run })
  }

  /** 내린다 (성공·판매자가 닫음·직접 다시 보냄·칸을 바꿈) */
  remove(key: string): void {
    this.#entries.delete(key)
  }

  has(key: string): boolean {
    return this.#entries.has(key)
  }

  get size(): number {
    return this.#entries.size
  }

  /** 방송자 조치 목록의 다시 보내기(UndoQueue.resendRetryable)를 이은다. 돌려준 함수로 끊는다 */
  addHost(run: () => Promise<void>): () => void {
    this.#hosts.add(run)
    return () => this.#hosts.delete(run)
  }

  /** 지금 보내는 중인가 */
  get running(): boolean {
    return this.#running
  }

  /**
   * 다시 이어졌다: 올라온 실패를 차례대로 하나씩 한 번 보낸다. 보내는 중에 또 부르면 겹쳐 보내지 않고 표시만 해 두고,
   * 지금 차례가 끝나면 남은 항목(그 사이 또 실패해 다시 올라온 것 포함)으로 한 번 더 돈다.
   * 보내는 중에 다시 이어짐이 없었으면, 또 실패해 올라온 항목은 다음 회복 때 보낸다.
   */
  async flush(): Promise<void> {
    if (this.#running) {
      this.#again = true
      return
    }
    this.#running = true
    try {
      do {
        this.#again = false
        await this.#pass()
      } while (this.#again)
    } finally {
      this.#running = false
      this.#again = false
    }
  }

  /** 지금 올라온 항목을 차례대로 하나씩 한 번 */
  async #pass(): Promise<void> {
    const list = [...this.#entries.entries()].map(([key, entry]) => ({ key, rank: KIND_ORDER[entry.kind], order: entry.order }))
    const steps: { rank: number; order: number; go: () => Promise<void> }[] = list.map((item) => ({
      rank: item.rank,
      order: item.order,
      go: async () => {
        const entry = this.#entries.get(item.key)
        // 그사이 내렸으면(판매자가 닫음·직접 보냄) 보내지 않는다
        if (entry === undefined || entry.order !== item.order) return
        this.#entries.delete(item.key)
        await entry.run()
      },
    }))
    for (const host of this.#hosts) steps.push({ rank: HOST_ORDER, order: 0, go: host })
    steps.sort((a, b) => a.rank - b.rank || a.order - b.order)
    for (const step of steps) {
      try {
        await step.go()
      } catch {
        // 한 항목의 실패가 다음 항목을 막지 않는다 — 실패 표시는 그 화면이 한다
      }
    }
  }
}
