// 실시간 알림 (SSE, SPEC §3, D-075, AC-S04-60).
// - 커밋된 이벤트마다 그 판매자의 모든 연결에 (범위 날짜, seq, 이벤트 종류) 알림을 보낸다. 커밋 전·거른 입력·중복 입력은 알림이 없다.
// - 다른 판매자의 연결은 아무것도 받지 않는다. 하트비트는 30초 이내 간격. 로그아웃·세션 만료면 그 세션의 연결을 닫는다.
// - 여러 서버 인스턴스 사이의 알림 공유는 범위 밖(컨테이너 1개).

const encoder = new TextEncoder()

export interface StreamNotice {
  readonly date: string
  readonly seq: number
  readonly type: string
}

interface Connection {
  readonly sellerId: string
  readonly sessionHash: string
  readonly controller: ReadableStreamDefaultController<Uint8Array>
  nextId: number
  closed: boolean
}

export interface HubOptions {
  /** 하트비트 간격 (밀리초, 30초 이내) */
  readonly heartbeatMs: number
  /** 하트비트 때 세션이 아직 유효한지 (만료면 연결을 닫는다) */
  readonly sessionAlive: (sessionHash: string) => Promise<boolean>
}

export class StreamHub {
  readonly #options: HubOptions
  readonly #connections = new Set<Connection>()
  #timer: ReturnType<typeof setInterval> | null = null

  constructor(options: HubOptions) {
    this.#options = options
  }

  /** 연결 수 (시험용) */
  get size(): number {
    return this.#connections.size
  }

  /** 새 연결. 첫 메시지(ready: 범위별 지금 seq)를 보낸 응답을 돌려준다 */
  open(sellerId: string, sessionHash: string, scopes: readonly { date: string; seq: number }[]): Response {
    let connection: Connection | null = null
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        connection = { sellerId, sessionHash, controller, nextId: 1, closed: false }
        this.#connections.add(connection)
        this.#write(connection, `retry: 3000\nevent: ready\ndata: ${JSON.stringify({ scopes })}\n\n`)
        this.#ensureTimer()
      },
      cancel: () => {
        if (connection !== null) this.#drop(connection)
      },
    })
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  /** 커밋된 이벤트 알림 (그 판매자의 연결 전부) */
  publish(sellerId: string, notices: readonly StreamNotice[]): void {
    for (const connection of this.#connections) {
      if (connection.sellerId !== sellerId) continue
      for (const notice of notices) {
        const id = connection.nextId++
        this.#write(connection, `id: ${String(id)}\nevent: change\ndata: ${JSON.stringify(notice)}\n\n`)
      }
    }
  }

  /** 그 세션의 연결을 닫는다 (로그아웃) */
  closeSession(sessionHash: string): void {
    for (const connection of [...this.#connections]) if (connection.sessionHash === sessionHash) this.#close(connection)
  }

  /** 모든 연결을 닫고 타이머를 멈춘다 */
  closeAll(): void {
    for (const connection of [...this.#connections]) this.#close(connection)
    this.#stopTimer()
  }

  /** 하트비트를 한 번 보낸다 (세션이 끝난 연결은 닫는다) */
  async heartbeat(): Promise<void> {
    const alive = new Map<string, boolean>()
    for (const connection of [...this.#connections]) {
      let ok = alive.get(connection.sessionHash)
      if (ok === undefined) {
        try {
          ok = await this.#options.sessionAlive(connection.sessionHash)
        } catch {
          ok = true // 확인하지 못하면 끊지 않는다 (방송 중 연결이 끊기지 않게)
        }
        alive.set(connection.sessionHash, ok)
      }
      if (!ok) this.#close(connection)
      else this.#write(connection, ': ping\n\n')
    }
  }

  #write(connection: Connection, text: string): void {
    if (connection.closed) return
    try {
      connection.controller.enqueue(encoder.encode(text))
    } catch {
      this.#drop(connection)
    }
  }

  #close(connection: Connection): void {
    if (!connection.closed) {
      try {
        connection.controller.close()
      } catch {
        // 이미 닫힘
      }
    }
    this.#drop(connection)
  }

  #drop(connection: Connection): void {
    connection.closed = true
    this.#connections.delete(connection)
    if (this.#connections.size === 0) this.#stopTimer()
  }

  #ensureTimer(): void {
    if (this.#timer !== null) return
    this.#timer = setInterval(() => void this.heartbeat(), this.#options.heartbeatMs)
    this.#timer.unref?.()
  }

  #stopTimer(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
  }
}
