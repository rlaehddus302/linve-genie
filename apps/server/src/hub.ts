// 실시간 알림 (SSE, SPEC §3, D-075, AC-S04-60).
// - 커밋된 이벤트마다 그 판매자의 모든 연결에 (범위 날짜, 리허설인지, seq, 이벤트 종류) 알림을 보낸다. 커밋 전·거른 입력·중복 입력은 알림이 없다.
//   범위는 날짜와 리허설인지로 알린다(D-081, AC-S05-50) — 같은 날 실제 범위와 리허설 범위의 seq는 따로다.
// - 리허설 가짜 채팅 생성기의 상태가 바뀌면(시작·보냄·멈춤) generator 알림을 보낸다(AC-S05-54, 기록이 아니라 seq가 없다).
// - 다른 판매자의 연결은 아무것도 받지 않는다. 하트비트는 30초 이내 간격. 로그아웃·세션 만료면 그 세션의 연결을 닫는다.
// - 여러 서버 인스턴스 사이의 알림 공유는 범위 밖(컨테이너 1개).
// - 연결 순서 (RA-S04-003·SA-S04-005): 연결을 먼저 등록해 알림을 모으기 시작한 뒤 범위별 seq를 읽는다. 읽는 동안 커밋된 변경도
//   놓치지 않는다. ready의 seq에 이미 들어 있는 알림(그 범위의 seq 이하)은 서버가 거른다 — 같은 변경이 ready와 change로 두 번 오지 않는다.
//   한 범위의 seq는 늘기만 하므로 "ready의 seq 이하는 버린다"는 언제나 안전하다.

const encoder = new TextEncoder()

export interface StreamNotice {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly type: string
}

export interface ScopeSeq {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
}

/** 범위 키 (날짜, 리허설인지) */
const scopeOf = (scope: { readonly date: string; readonly rehearsal: boolean }): string => `${scope.date}|${scope.rehearsal ? 'r' : 'l'}`

interface Connection {
  readonly sellerId: string
  readonly sessionHash: string
  /** 이름 붙은 알림(유튜브·리허설 생성기)을 받는지 — 보조자 연결은 받지 않는다 (AC-I3-61: 보조자는 유튜브·리허설을 쓰지 않는다) */
  readonly named: boolean
  readonly controller: ReadableStreamDefaultController<Uint8Array>
  /** ready에 보낸 범위별 seq (키 = 날짜·리허설인지) — 그 이하의 알림은 이미 반영된 것이라 보내지 않는다 */
  readonly baseline: ReadonlyMap<string, number>
  nextId: number
  closed: boolean
}

/** 범위별 seq를 읽는 동안의 연결 (알림을 모아 둔다) */
interface Pending {
  readonly sellerId: string
  readonly sessionHash: string
  readonly named: boolean
  /** 모인 알림 (generator 알림은 그대로 지나간다) */
  readonly notices: (StreamNotice | GeneratorNotice)[]
  closed: boolean
}

/** 리허설 생성기 상태 알림 (event: generator) · 유튜브 알림 (event: youtube — 연결·수집·발송함·할당량·삭제·차단, AC-Y1-05·27·28·39·52) */
export interface GeneratorNotice {
  readonly kind: 'generator' | 'youtube'
  readonly data: Readonly<Record<string, unknown>>
}

const isGenerator = (notice: StreamNotice | GeneratorNotice): notice is GeneratorNotice => 'kind' in notice

export interface HubOptions {
  /** 하트비트 간격 (밀리초, 30초 이내) */
  readonly heartbeatMs: number
  /** 하트비트 때 세션이 아직 유효한지 (만료면 연결을 닫는다) */
  readonly sessionAlive: (sessionHash: string) => Promise<boolean>
}

export class StreamHub {
  readonly #options: HubOptions
  readonly #connections = new Set<Connection>()
  readonly #pending = new Set<Pending>()
  #timer: ReturnType<typeof setInterval> | null = null

  constructor(options: HubOptions) {
    this.#options = options
  }

  /** 연결 수 (시험용) */
  get size(): number {
    return this.#connections.size
  }

  /**
   * 새 연결. 연결을 먼저 등록(알림 모으기 시작)한 뒤 `readScopes`로 범위별 지금 seq를 읽고, 첫 메시지(ready)와
   * 읽는 동안 모인 알림 중 ready에 없는 것(그 날짜의 seq보다 큰 것)을 차례로 보낸 응답을 돌려준다 (RA-S04-003).
   * 읽기가 실패하면 등록을 지우고 오류를 그대로 던진다. 읽는 동안 로그아웃·종료되면 ready 없이 닫힌 응답이다
   */
  async open(sellerId: string, sessionHash: string, readScopes: () => Promise<readonly ScopeSeq[]>, options: { readonly named?: boolean } = {}): Promise<Response> {
    const named = options.named ?? true
    const pending: Pending = { sellerId, sessionHash, named, notices: [], closed: false }
    this.#pending.add(pending)
    let scopes: readonly ScopeSeq[]
    try {
      scopes = await readScopes()
    } catch (error) {
      this.#pending.delete(pending)
      throw error
    }
    let connection: Connection | null = null
    // start는 생성자 안에서 바로(동기로) 불린다 — 모인 알림 넘기기와 연결 등록 사이에 다른 알림이 끼지 않는다
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#pending.delete(pending)
        if (pending.closed) {
          controller.close()
          return
        }
        const baseline = new Map(scopes.map((scope) => [scopeOf(scope), scope.seq]))
        const live: Connection = { sellerId, sessionHash, named, controller, baseline, nextId: 1, closed: false }
        connection = live
        this.#write(live, `retry: 3000\nevent: ready\ndata: ${JSON.stringify({ scopes })}\n\n`)
        for (const notice of pending.notices) this.#send(live, notice)
        if (live.closed) return
        this.#connections.add(live)
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

  /** 범위별 seq를 읽는 중인 연결 수 (시험용) */
  get pendingSize(): number {
    return this.#pending.size
  }

  /** 커밋된 이벤트 알림 (그 판매자의 연결 전부) */
  publish(sellerId: string, notices: readonly StreamNotice[]): void {
    for (const pending of this.#pending) if (pending.sellerId === sellerId) pending.notices.push(...notices)
    for (const connection of [...this.#connections]) {
      if (connection.sellerId !== sellerId) continue
      for (const notice of notices) this.#send(connection, notice)
    }
  }

  /** 리허설 생성기 상태 알림 (그 판매자의 연결 전부) */
  publishGenerator(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'generator', data })
  }

  /** 유튜브 알림 (그 판매자의 연결 전부, event: youtube). data.kind = connection · collector · outbox · quota · notice */
  publishYoutube(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'youtube', data })
  }

  #publishNamed(sellerId: string, notice: GeneratorNotice): void {
    for (const pending of this.#pending) if (pending.sellerId === sellerId && pending.named) pending.notices.push(notice)
    for (const connection of [...this.#connections]) if (connection.sellerId === sellerId && connection.named) this.#send(connection, notice)
  }

  /** 알림 하나. ready에 이미 반영된 변경(그 범위의 ready seq 이하)은 보내지 않는다 */
  #send(connection: Connection, notice: StreamNotice | GeneratorNotice): void {
    if (isGenerator(notice)) {
      this.#write(connection, `event: ${notice.kind}\ndata: ${JSON.stringify(notice.data)}\n\n`)
      return
    }
    const seen = connection.baseline.get(scopeOf(notice))
    if (seen !== undefined && notice.seq <= seen) return
    const id = connection.nextId++
    this.#write(connection, `id: ${String(id)}\nevent: change\ndata: ${JSON.stringify(notice)}\n\n`)
  }

  /** 그 세션의 연결을 닫는다 (로그아웃) */
  closeSession(sessionHash: string): void {
    for (const pending of this.#pending) if (pending.sessionHash === sessionHash) pending.closed = true
    for (const connection of [...this.#connections]) if (connection.sessionHash === sessionHash) this.#close(connection)
  }

  /** 모든 연결을 닫고 타이머를 멈춘다 */
  closeAll(): void {
    for (const pending of this.#pending) pending.closed = true
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
