// 실시간 알림 (SSE, SPEC §3, D-075, AC-S04-60).
// - 커밋된 이벤트마다 그 판매자의 모든 연결에 (범위 날짜, 리허설인지, seq, 이벤트 종류) 알림을 보낸다. 커밋 전·거른 입력·중복 입력은 알림이 없다.
//   범위는 날짜와 리허설인지로 알린다(D-081, AC-S05-50) — 같은 날 실제 범위와 리허설 범위의 seq는 따로다.
// - 리허설 가짜 채팅 생성기의 상태가 바뀌면(시작·보냄·멈춤) generator 알림을 보낸다(AC-S05-54, 기록이 아니라 seq가 없다).
// - I2: 포장·배송 기록이 저장되면 packing 알림({ date, buyer }), 가게 설정이 바뀌면 shop 알림({})을 보낸다(AC-I2-32·13 — 엔진 기록이 아니라 seq가 없다).
// - 다른 판매자의 연결은 아무것도 받지 않는다. 하트비트는 30초 이내 간격. 로그아웃·세션 만료면 그 세션의 연결을 닫는다.
// - 여러 서버 인스턴스 사이의 알림 공유는 범위 밖(컨테이너 1개).
// - 연결 순서 (RA-S04-003·SA-S04-005): 연결을 먼저 등록해 알림을 모으기 시작한 뒤 범위별 seq를 읽는다. 읽는 동안 커밋된 변경도
//   놓치지 않는다. ready의 seq에 이미 들어 있는 알림(그 범위의 seq 이하)은 서버가 거른다 — 같은 변경이 ready와 change로 두 번 오지 않는다.
//   한 범위의 seq는 늘기만 하므로 "ready의 seq 이하는 버린다"는 언제나 안전하다.
// - 인스타그램 연결·라이브 연결·수집 상태·알림 문장·DM 행이 바뀌면(N2) instagram 알림을 보낸다(data.kind로 나눈다 — dev-notes N2 "화면에게").
// - 요금 원장이 바뀌면(N5) billing 알림을 보낸다(까닭만 — 화면이 요금 상태를 새로 읽는다).
// - 출력 기록이 바뀌면(I1, L-11) print 알림을 보낸다(기록 seq가 아니라 출력 기록의 rev — 바뀐 작업·라벨 키와 대기열 요약만, 대기열 전체가 아니다).
// - 입금이 저장·처리되거나 확인 필요 수·원천 상태가 바뀌면(N3, AC-N3-30) deposit 알림을 보낸다(바뀐 입금 번호·확인 필요 수·바뀐 원천 ID — 입금자명은 담지 않는다).
//   연결이 출력 기기 ID를 밝히면(?device=) 그 기기의 실시간 연결이 열려 있는지 안다 — 열리고 닫힐 때 onDevice로 알린다(다른 기기의 "연결됨/끊김").
// - 라벨 기능 켬/끔이 바뀌면(N4a, L-13) labels 알림을 보낸다(바뀐 값·바꾼 기록 한 줄·그때의 출력 기록 rev).
// - 연결 한도 (QS1 D-QS1-04, SPEC §3): (1) 연결마다 아직 내보내지 못한(받는 쪽이 읽지 않은) 글이 1 MiB를 넘으면 그 연결만 닫는다 —
//   쌓인 글은 버린다(본문은 오류로 끝난다, 메모리를 바로 돌려받는다). 범위를 읽는 중(ready 전)에 모인 알림도 같은 한도 — 넘으면 모은 것을 버리고
//   ready 없이 닫힌 응답이다. (2) 판매자마다 연결(읽는 중 포함) 30개 — 넘게 되면 그 판매자의 가장 먼저 연 연결부터 닫는다(열린 연결이 먼저, 그다음 읽는 중).
//   (3) 닫힌 연결의 브라우저는 다시 연결해 새 ready로 따라잡는다. 닫는 일은 로그에 판매자 ID와 까닭 코드(reason)만 남긴다.

import type { LogSink } from './log.ts'

const encoder = new TextEncoder()

/** 연결마다 아직 내보내지 못한 글의 한도 (바이트, D-QS1-04 (1)) */
export const STREAM_BUFFER_MAX_BYTES = 1_048_576
/** 판매자마다 실시간 연결 수 (읽는 중 포함, D-QS1-04 (2)) */
export const STREAM_SELLER_MAX = 30
/** 연결을 닫은 까닭 (로그 reason) */
export type StreamCloseReason = 'BUFFER_FULL' | 'SELLER_LIMIT'

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
  /** 이 연결이 밝힌 기기 ID (출력 기기 실시간 연결 여부, I1). 없으면 null */
  readonly deviceId: string | null
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
  /** 밝힌 출력 기기 ID (없으면 null) — 30개를 넘을 때 마지막에 닫는다 (D-QS1-13) */
  readonly deviceId: string | null
  /** 모인 알림 (generator 알림은 그대로 지나간다) */
  readonly notices: (StreamNotice | GeneratorNotice)[]
  /** 모인 알림의 어림 크기 (바이트) — 한도를 넘으면 모은 것을 버리고 닫는다 */
  bytes: number
  closed: boolean
}

/** 리허설 생성기 상태 알림 (event: generator) · 유튜브 알림 (event: youtube — 연결·수집·발송함·할당량·삭제·차단, AC-Y1-05·27·28·39·52) · 출력 기록 알림 (event: print, I1) · I2 포장·배송(event: packing)·가게 설정(event: shop) 알림 · 인스타그램 알림 (event: instagram, N2) · 라벨 기능 켬/끔 (event: labels, N4a) · 틱톡 연결 알림 (event: tiktok, N2b-2) · 입금 확인 알림 (event: deposit, N3) · 요금 알림 (event: billing, N5) — seq가 없다 */
export interface GeneratorNotice {
  readonly kind: 'generator' | 'youtube' | 'print' | 'packing' | 'shop' | 'instagram' | 'labels' | 'tiktok' | 'deposit' | 'billing' | 'login' | 'parcel' | 'extension' | 'voice'
  readonly data: Readonly<Record<string, unknown>>
}

const isGenerator = (notice: StreamNotice | GeneratorNotice): notice is GeneratorNotice => 'kind' in notice

export interface HubOptions {
  /** 하트비트 간격 (밀리초, 30초 이내) */
  readonly heartbeatMs: number
  /** 하트비트 때 세션이 아직 유효한지 (만료면 연결을 닫는다) */
  readonly sessionAlive: (sessionHash: string) => Promise<boolean>
  /** 기기 ID를 밝힌 연결이 열리거나 닫혔다 (출력 기기 실시간 연결 여부, I1) */
  readonly onDevice?: (sellerId: string, deviceId: string) => void
  /** 서버 로그 (연결을 한도로 닫았을 때 — 판매자 ID·까닭 코드만) */
  readonly log?: LogSink
  /** 연결마다 쌓이는 글 한도 (바이트, 기본 1 MiB — 시험용) */
  readonly bufferMaxBytes?: number
  /** 판매자마다 연결 수 (기본 30 — 시험용) */
  readonly sellerMax?: number
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
  async open(
    sellerId: string,
    sessionHash: string,
    readScopes: () => Promise<readonly ScopeSeq[]>,
    options: { readonly named?: boolean; readonly deviceId?: string | null } = {},
  ): Promise<Response> {
    const named = options.named ?? true
    const deviceId = options.deviceId ?? null
    const pending: Pending = { sellerId, sessionHash, named, deviceId, notices: [], bytes: 0, closed: false }
    this.#pending.add(pending)
    this.#enforceSellerMax(sellerId, pending)
    let scopes: readonly ScopeSeq[]
    try {
      scopes = await readScopes()
    } catch (error) {
      this.#pending.delete(pending)
      throw error
    }
    let connection: Connection | null = null
    // start는 생성자 안에서 바로(동기로) 불린다 — 모인 알림 넘기기와 연결 등록 사이에 다른 알림이 끼지 않는다
    // 크기 = 바이트, 높은 물 0 — desiredSize의 음수가 아직 내보내지 못한 바이트다 (D-QS1-04 (1))
    const body = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.#pending.delete(pending)
          if (pending.closed) {
            controller.close()
            return
          }
          const baseline = new Map(scopes.map((scope) => [scopeOf(scope), scope.seq]))
          const live: Connection = { sellerId, sessionHash, named, deviceId, controller, baseline, nextId: 1, closed: false }
          connection = live
          this.#write(live, `retry: 3000\nevent: ready\ndata: ${JSON.stringify({ scopes })}\n\n`)
          for (const notice of pending.notices) this.#send(live, notice)
          pending.notices.length = 0
          if (live.closed) return
          this.#connections.add(live)
          this.#ensureTimer()
          if (deviceId !== null) this.#deviceChanged(sellerId, deviceId)
        },
        cancel: () => {
          if (connection !== null) this.#drop(connection)
        },
      },
      { highWaterMark: 0, size: (chunk) => chunk.byteLength },
    )
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
    for (const pending of this.#pending) if (pending.sellerId === sellerId) for (const notice of notices) this.#hold(pending, notice)
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

  /** 크롬 확장 상태 알림 (그 판매자의 연결 전부, X1 YT-10 AC7·AC8, event: extension). 채팅 내용·닉네임·토큰은 담지 않는다 */
  publishExtension(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'extension', data })
  }

  /** 출력 기록 알림 (그 판매자의 연결 전부, I1). 보조자 연결은 받지 않는다 — 보조자는 출력을 쓰지 않는다 (SYS-04) */
  publishPrint(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'print', data })
  }

  /**
   * 요금 알림 (그 판매자의 연결 전부, N5 AC-N5-13): 부여·회수·결제 주문 상태·방송 시작(방송 일 쓰기)·사업자 정보가 바뀌었다.
   * 까닭(reason)만 담는다 — 화면은 요금 상태를 새로 읽는다. 주문 건·라벨 장 쓰기는 알리지 않는다. 사업자 정보·결제 ID·금액은 담지 않는다.
   * 보조자 연결은 받지 않는다 — 요금·결제는 판매자만 쓴다 (AC-I3-61)
   */
  publishBilling(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'billing', data })
  }

  /** 인스타그램 연결·라이브 연결·수집 상태·알림 문장·DM 행 알림 (그 판매자의 연결 전부, N2). 보조자 연결은 받지 않는다 — 보조자는 인스타그램 경로를 쓰지 않는다 (SYS-04) */
  publishInstagram(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'instagram', data })
  }

  /** 틱톡 연결 알림 (그 판매자의 연결 전부, event: tiktok — N2b-2). data.kind = LINK (연결 보기) */
  publishTiktok(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind: 'tiktok', data })
  }

  /** I2 포장·배송(packing, AC-I2-32)·가게 설정(shop, AC-I2-13)·L1 로그인 방법(login — 간편 로그인 연결·끊기, { kind: 'methods' }) 알림 (그 판매자의 연결 전부 — 다른 판매자의 연결은 받지 않는다). 보조자 연결은 받지 않는다 — 보조자는 포장·설정을 쓰지 않는다 (SYS-04) */
  // T1 택배(parcel — 배송지·접수·취소·조회가 바뀐 묶음 { date, buyer }, 값은 담지 않는다)도 같은 길이다
  publishNamed(sellerId: string, kind: 'packing' | 'shop' | 'login' | 'parcel', data: Readonly<Record<string, unknown>>): void {
    this.#publishNamed(sellerId, { kind, data })
  }

  /** 라벨 기능 켬/끔이 바뀜 (그 판매자의 연결 전부 — 보조자 연결도 받는다: 메뉴의 라벨 칸을 숨기고 보이는 규칙이 모든 화면에 같아야 한다, N4a L-13 9) */
  publishLabels(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishKind(sellerId, { kind: 'labels', data })
  }

  /** 입금 확인 알림 (그 판매자의 연결 전부, N3 AC-N3-30 — 입금 번호·확인 필요 수·원천 ID만) */
  publishDeposit(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishKind(sellerId, { kind: 'deposit', data })
  }

  /**
   * 음성 알림 (V3, event: voice) — 판매자 품종 사전에 새 이름이 생김 (R-23, D-V3-49 — data { kind: 'sellerNames', name }) ·
   * 판매자 글의 번호가 그 방송에 상품으로 없음 (D-V3-60 — data { kind: 'sellerNoteMissing', b, date, no, name, price, chat }). 그 판매자의 연결 전부.
   * name은 판매자가 주인 배지 채팅에 쓴 품종(2~20글자 한글·로마자·공백)이다 — 화면은 글자로만 보인다
   */
  publishVoice(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publishKind(sellerId, { kind: 'voice', data })
  }

  #publishKind(sellerId: string, notice: GeneratorNotice): void {
    for (const pending of this.#pending) if (pending.sellerId === sellerId) this.#hold(pending, notice)
    for (const connection of [...this.#connections]) if (connection.sellerId === sellerId) this.#send(connection, notice)
  }

  #publishNamed(sellerId: string, notice: GeneratorNotice): void {
    for (const pending of this.#pending) if (pending.sellerId === sellerId && pending.named) this.#hold(pending, notice)
    for (const connection of [...this.#connections]) if (connection.sellerId === sellerId && connection.named) this.#send(connection, notice)
  }

  /** 읽는 중인 연결에 알림을 모은다. 모인 양이 한도를 넘으면 모은 것을 버리고 ready 없이 닫는다 (D-QS1-04 (1), AC-QS1-11) */
  #hold(pending: Pending, notice: StreamNotice | GeneratorNotice): void {
    if (pending.closed) return
    pending.notices.push(notice)
    // 실제로 보낼 글보다 조금 크게 어림한다 (event·id 줄)
    pending.bytes += encoder.encode(isGenerator(notice) ? JSON.stringify(notice.data) : JSON.stringify(notice)).byteLength + 48
    if (pending.bytes > this.#bufferMax) this.#closePending(pending, 'BUFFER_FULL')
  }

  #closePending(pending: Pending, reason: StreamCloseReason): void {
    pending.closed = true
    pending.notices.length = 0
    pending.bytes = 0
    this.#logClosed(pending.sellerId, reason)
  }

  get #bufferMax(): number {
    return this.#options.bufferMaxBytes ?? STREAM_BUFFER_MAX_BYTES
  }

  /**
   * 판매자의 연결(읽는 중 포함)이 한도를 넘으면 가장 먼저 연 것부터 닫는다 — 열린 연결이 먼저 (D-QS1-04 (2), AC-QS1-12).
   * 출력 기기 ID를 밝힌 연결(`?device=`)은 마지막에 닫는다 — 밝히지 않은 연결이 남아 있으면 그중 가장 오래된 것부터 (D-QS1-13, AC-QS1-46).
   * 새로 연 연결(`fresh`)은 닫지 않는다
   */
  #enforceSellerMax(sellerId: string, fresh: Pending): void {
    const max = this.#options.sellerMax ?? STREAM_SELLER_MAX
    const live = [...this.#connections].filter((connection) => connection.sellerId === sellerId && !connection.closed)
    const reading = [...this.#pending].filter((pending) => pending.sellerId === sellerId && !pending.closed)
    let excess = live.length + reading.length - max
    if (excess <= 0) return
    // 닫을 차례: 기기 ID 없는 것(열린 것 → 읽는 중) → 기기 ID 밝힌 것(열린 것 → 읽는 중). 각 안에서는 연 차례(Set 순서)
    const order: ({ readonly live: Connection } | { readonly reading: Pending })[] = []
    for (const withDevice of [false, true]) {
      for (const connection of live) if ((connection.deviceId !== null) === withDevice) order.push({ live: connection })
      for (const pending of reading) if (pending !== fresh && (pending.deviceId !== null) === withDevice) order.push({ reading: pending })
    }
    for (const victim of order) {
      if (excess <= 0) return
      if ('live' in victim) this.#discard(victim.live, 'SELLER_LIMIT')
      else this.#closePending(victim.reading, 'SELLER_LIMIT')
      excess -= 1
    }
  }

  #logClosed(sellerId: string, reason: StreamCloseReason): void {
    try {
      this.#options.log?.({ level: 'info', code: 'STREAM_CLOSED', seller: sellerId, reason })
    } catch {
      // 로그 실패는 연결에 영향을 주지 않는다
    }
  }

  /**
   * 한도로 닫는다. 아직 내보내지 못한 글이 있으면 버리고(오류로 끝냄 — 메모리를 바로 돌려받는다), 없으면 보통으로 닫는다.
   * 출력 기기 연결이면 지금처럼 onDevice로 알린다
   */
  #discard(connection: Connection, reason: StreamCloseReason): void {
    if (connection.closed) return
    const unread = -(connection.controller.desiredSize ?? 0)
    if (unread > 0) {
      try {
        connection.controller.error(new Error('stream limit'))
      } catch {
        // 이미 닫힘
      }
      this.#drop(connection)
    } else {
      this.#close(connection)
    }
    this.#logClosed(connection.sellerId, reason)
  }

  /** 그 기기 ID를 밝힌 실시간 연결이 지금 열려 있는지 (출력 기기의 "연결됨/끊김", I1) */
  deviceLive(sellerId: string, deviceId: string): boolean {
    for (const connection of this.#connections) if (connection.sellerId === sellerId && connection.deviceId === deviceId && !connection.closed) return true
    return false
  }

  #deviceChanged(sellerId: string, deviceId: string): void {
    try {
      this.#options.onDevice?.(sellerId, deviceId)
    } catch {
      // 알림 실패는 연결에 영향을 주지 않는다
    }
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
      return
    }
    // 받는 쪽이 읽지 않아 쌓인 글이 한도를 넘으면 그 연결만 닫는다 (D-QS1-04 (1), AC-QS1-10)
    if (-(connection.controller.desiredSize ?? 0) > this.#bufferMax) this.#discard(connection, 'BUFFER_FULL')
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
    const wasLive = this.#connections.delete(connection)
    connection.closed = true
    if (this.#connections.size === 0) this.#stopTimer()
    if (wasLive && connection.deviceId !== null) this.#deviceChanged(connection.sellerId, connection.deviceId)
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
