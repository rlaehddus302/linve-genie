// LV1 방송 소리로 듣기 (VOC-08): 콘솔이 한 번 열리면(watch 신호) 그 방송의 소리를 받아 일꾼에 넣고, 받아쓴 글은 그 방송 콘솔의 읽기로 넘긴다.
// D-LV1-14: 콘솔(앱)이 닫혀도 방송이 끝날 때까지 듣는다 — 받을 콘솔이 없으면 서버 읽기(HeadlessVoice)가 읽고 등록한다. 마지막 watch 뒤 12시간이면 닫는다(잊힌 흐름).
// 판매자 하나에 듣는 자리 하나 — 휴대폰 마이크가 켜지면 쉬고, 꺼지면 돌아온다(D-LV1-06). 소리·글은 메모리에서만(로그·DB 없음).
// D-LV1-15: 여러 판매자 계정이 같은 영상을 이으면 소리 받기·받아쓰기 흐름(Flow)은 하나 — 받아쓴 글을 듣는 판매자마다 넘긴다.
import type { Clock } from '../time.ts'
import type { LogSink } from '../log.ts'
import type { ExternalStream, VoiceRelay } from './relay.ts'
import { STREAM_IDLE_RECHECK_MS, STREAM_UNREACHABLE_RECHECK_MS, STREAM_SAMPLE_RATE, STREAM_LATE_MS, STREAM_STALL_CHECK_MS, STREAM_STALL_MS, recordFailure, retryDelayMs, type AudioFeed, type StreamLocator } from './stream-audio.ts'

export type StreamAudioPhase = 'hidden' | 'off' | 'idle' | 'listening' | 'reconnecting' | 'stopped' | 'unsupported' | 'mic' | 'ended'
/** late = lagMs가 30초를 넘음 (늦음 안내를 보일 때, D-LV1-10) */
/**
 * serverFault = 방송은 멀쩡한데 서버가 소리를 받아 오는 길이 끊김 (D-LV1-17). 옛 앱이 모르는 phase는 숨김으로 읽으므로
 * phase는 'unsupported' 그대로 두고 이 표시만 더한다 — 옛 앱은 지금 문구, 새 앱은 "서버 문제" 문구와 [다시 켜기]
 */
export interface StreamAudioView { readonly phase: StreamAudioPhase; readonly lagMs?: number; readonly late?: boolean; readonly serverFault?: boolean }

/** 콘솔 열림 신호가 이만큼 끊기면 콘솔이 닫힌 것으로 본다 (콘솔은 10초마다 보낸다) — 다른 방송으로 바꿀 때 */
export const WATCH_TTL_MS = 25_000
/** 콘솔이 닫혀도 이만큼은 듣는다 (D-LV1-14 — 방송 끝·유튜브 끝이 먼저 오는 것이 보통, 이건 잊힌 흐름을 닫는 상한) */
export const UNWATCHED_MAX_MS = 12 * 60 * 60 * 1000

/** 앱 없이 서버가 읽기 (D-LV1-14) */
export interface ServerReading {
  deliver(sellerId: string, broadcastId: string, result: { text: string; startAt: number; endAt: number; conf?: number }): void
  release(sellerId: string): void
  endBroadcast(sellerId: string, broadcastId: string): void
}

export interface StreamAudioServiceOptions {
  readonly available: boolean
  readonly locate: StreamLocator
  readonly feed: AudioFeed
  readonly clock: Clock
  readonly log: LogSink
  readonly sellerOn: (sellerId: string) => Promise<boolean>
  /** D-V3-127 받아쓰기 힌트는 중계가 open에 싣는다 — 흐름을 열기 전에 장부를 읽어 둔다 */
  readonly warmHint?: (sellerId: string) => Promise<void>
  readonly schedule?: (run: () => void, ms: number) => () => void
  /** 받을 콘솔이 없을 때 서버가 읽고 등록 (D-LV1-14). 없으면 지금처럼 버린다 */
  readonly serverReading?: ServerReading
}

/** 판매자 하나가 한 방송을 듣는 자리 (보이는 상태·콘솔 신호·끊김 셈·서버 읽기 알림). 소리·일꾼은 Flow가 가진다 */
interface Listen {
  readonly sellerId: string
  readonly broadcastId: string
  phase: StreamAudioPhase
  /** 서버 쪽 길이 끊겨서 못 받는 중 (D-LV1-17) — phase가 'unsupported'일 때만 뜻이 있다 */
  serverFault: boolean
  watchedUntil: number
  failures: number[]
  generation: number
  /** 지금 받는 공유 흐름 (주소를 찾는 중·쉬는 중·다시 잇기 기다림이면 null) */
  flow: Flow | null
  cancel: (() => void) | null
  delivered: boolean
}

/**
 * 소리 받기 + 받아쓰기 흐름 하나 (D-LV1-15): 같은 소리 주인(source — 같은 유튜브 영상)을 듣는 판매자 모두가 나눠 쓴다.
 * 받아쓴 글은 듣는 판매자마다 넘기고, 마지막 판매자가 떠나면 닫는다
 */
interface Flow {
  readonly key: string
  readonly members: Set<Listen>
  closed: boolean
  /** 첫 조각을 받았다 (듣는 중) */
  started: boolean
  /** 모르면 null (소리 받기가 조각 시각을 주지 않음 — 늦음 안내를 숨긴다) */
  lagMs: number | null
  lastChunkAt: number
  stall: (() => void) | null
  feed: { close(): void } | null
  worker: ExternalStream | null
  /** 지금 일꾼 흐름의 시각 0에 해당하는 서버 시각 (소리가 늦게 도착하면 앞으로 옮긴다) */
  base: number
  /** 지금 일꾼 흐름에 보낸 소리 길이(밀리초) */
  sentMs: number
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

export class StreamAudioService {
  readonly #o: StreamAudioServiceOptions
  readonly #schedule: (run: () => void, ms: number) => () => void
  /** 판매자 → 지금 듣는(또는 쉬는) 방송 하나 */
  readonly #listens = new Map<string, Listen>()
  /** 소리 주인 → 공유 흐름 (D-LV1-15) */
  readonly #flows = new Map<string, Flow>()
  #relay: VoiceRelay | null = null
  #sweep: (() => void) | null = null
  #closed = false

  constructor(options: StreamAudioServiceOptions) {
    this.#o = options
    this.#schedule = options.schedule ?? defaultSchedule
  }
  get available(): boolean { return this.#o.available }
  attach(relay: VoiceRelay): void {
    this.#relay = relay
    if (this.#o.available) this.#loopSweep()
  }
  #loopSweep(): void {
    if (this.#closed) return
    this.#sweep = this.#schedule(() => { this.sweep(); this.#loopSweep() }, 5_000)
  }

  /** 콘솔 열림 신호 (D-LV1-03). 끄인 판매자·쓸 수 없는 서버면 아무것도 열지 않는다 */
  async watch(sellerId: string, broadcastId: string): Promise<StreamAudioView> {
    if (!this.#o.available) return { phase: 'hidden' }
    if (!(await this.#o.sellerOn(sellerId))) { this.stopSeller(sellerId); return { phase: 'off' } }
    await this.#o.warmHint?.(sellerId)
    const now = this.#o.clock.now()
    let listen = this.#listens.get(sellerId)
    if (listen !== undefined && listen.broadcastId !== broadcastId) {
      // 다른 방송 콘솔이 열렸다: 앞의 것이 아직 듣는 중이면 그대로 둔다(한 번에 하나). 닫혔거나 끝남·멈춤·못 받음이면 바로 바꾼다 (RA-LV1-03)
      const settled = listen.phase === 'ended' || listen.phase === 'stopped' || listen.phase === 'unsupported'
      if (listen.watchedUntil > now && !settled) return { phase: 'idle' }
      this.#stop(listen)
      this.#listens.delete(sellerId)
      listen = undefined
    }
    if (listen === undefined) {
      listen = { sellerId, broadcastId, phase: 'idle', serverFault: false, watchedUntil: now + WATCH_TTL_MS, failures: [], generation: 0, flow: null, cancel: null, delivered: false }
      this.#listens.set(sellerId, listen)
      this.#arrange(listen)
    } else listen.watchedUntil = now + WATCH_TTL_MS
    return this.view(sellerId, broadcastId)
  }

  /** [다시 켜기] */
  async restart(sellerId: string, broadcastId: string): Promise<StreamAudioView> {
    const listen = this.#listens.get(sellerId)
    if (listen !== undefined && listen.broadcastId === broadcastId && (listen.phase === 'stopped' || listen.phase === 'unsupported')) {
      this.#listens.delete(sellerId)
      this.#stop(listen)
    }
    return this.watch(sellerId, broadcastId)
  }

  view(sellerId: string, broadcastId: string): StreamAudioView {
    if (!this.#o.available) return { phase: 'hidden' }
    const listen = this.#listens.get(sellerId)
    if (listen === undefined || listen.broadcastId !== broadcastId) return { phase: 'idle' }
    if (listen.phase === 'listening') {
      const lagMs = listen.flow?.lagMs ?? null
      return lagMs === null ? { phase: 'listening' } : { phase: 'listening', lagMs, late: lagMs > STREAM_LATE_MS }
    }
    if (listen.phase === 'unsupported' && listen.serverFault) return { phase: 'unsupported', serverFault: true }
    return { phase: listen.phase }
  }
  async viewFor(sellerId: string, broadcastId: string): Promise<StreamAudioView> {
    if (!this.#o.available) return { phase: 'hidden' }
    if (!(await this.#o.sellerOn(sellerId))) return { phase: 'off' }
    return this.view(sellerId, broadcastId)
  }

  /** 마이크가 켜지거나 꺼졌다 (중계가 부른다). 그 판매자만 공유 흐름에서 빠진다 — 다른 판매자는 계속 듣는다 (D-LV1-15) */
  micChanged(sellerId: string, active: boolean): void {
    const listen = this.#listens.get(sellerId)
    if (listen !== undefined) this.#arrange(listen, active)
  }
  /** 판매자 설정 끔 */
  stopSeller(sellerId: string): void {
    this.#o.serverReading?.release(sellerId)
    const listen = this.#listens.get(sellerId)
    if (listen === undefined) return
    this.#listens.delete(sellerId)
    this.#stop(listen)
  }
  /** 방송 끝 (D-LV1-05) */
  endBroadcast(sellerId: string, broadcastId: string): void {
    this.#o.serverReading?.endBroadcast(sellerId, broadcastId)
    const listen = this.#listens.get(sellerId)
    if (listen === undefined || listen.broadcastId !== broadcastId) return
    this.#stop(listen)
    listen.phase = 'ended'
  }
  /** 잊힌 흐름을 닫는다: 서버 읽기가 없으면 콘솔이 닫힌 흐름(옛 동작), 있으면 마지막 콘솔 뒤 12시간 (D-LV1-14) */
  sweep(): void {
    const now = this.#o.clock.now()
    const keep = this.#o.serverReading === undefined ? 0 : UNWATCHED_MAX_MS
    for (const listen of [...this.#listens.values()]) {
      if (listen.watchedUntil + keep > now) continue
      this.#listens.delete(listen.sellerId)
      this.#stop(listen)
      this.#o.serverReading?.release(listen.sellerId)
    }
  }
  /** listening = 지금 열린 소리 받기(ffmpeg) 수, sellers = 그 흐름을 듣는 판매자 수 */
  status(): { listening: number; sellers: number } {
    const open = [...this.#flows.values()].filter((flow) => flow.feed !== null)
    return { listening: open.length, sellers: open.reduce((sum, flow) => sum + flow.members.size, 0) }
  }
  close(): void {
    this.#closed = true
    this.#sweep?.()
    for (const listen of this.#listens.values()) this.#stop(listen)
    this.#listens.clear()
    for (const flow of [...this.#flows.values()]) this.#closeFlow(flow)
  }

  // ── 안쪽 ──────────────────────────────────────────────

  #arrange(listen: Listen, micStarting = false): void {
    if (listen.phase === 'stopped' || listen.phase === 'unsupported' || listen.phase === 'ended') return
    if (micStarting || this.#relay?.micActive(listen.sellerId) === true) {
      this.#stop(listen)
      listen.phase = 'mic'
      return
    }
    if (listen.flow === null && listen.cancel === null) {
      if (listen.phase === 'mic') listen.phase = 'idle'
      void this.#attempt(listen, ++listen.generation)
    }
  }
  /** 이 판매자만 멈춘다: 공유 흐름에서 빠지고, 남은 판매자가 없으면 흐름을 닫는다 */
  #stop(listen: Listen): void {
    listen.generation++
    listen.cancel?.()
    listen.cancel = null
    const flow = listen.flow
    listen.flow = null
    if (flow === null) return
    flow.members.delete(listen)
    if (flow.members.size === 0) this.#closeFlow(flow)
  }
  #closeFlow(flow: Flow): void {
    if (flow.closed) return
    flow.closed = true
    if (this.#flows.get(flow.key) === flow) this.#flows.delete(flow.key)
    flow.stall?.()
    flow.stall = null
    flow.feed?.close()
    flow.feed = null
    flow.worker?.close()
    flow.worker = null
  }
  #live(listen: Listen, generation: number): boolean {
    return !this.#closed && listen.generation === generation && this.#listens.get(listen.sellerId) === listen
  }
  #later(listen: Listen, ms: number): void {
    const generation = listen.generation
    listen.cancel = this.#schedule(() => {
      listen.cancel = null
      if (this.#live(listen, generation)) void this.#attempt(listen, ++listen.generation)
    }, ms)
  }
  async #attempt(listen: Listen, generation: number): Promise<void> {
    let location
    try {
      location = await this.#o.locate(listen.sellerId, listen.broadcastId)
    } catch {
      location = { kind: 'retry' as const }
    }
    if (!this.#live(listen, generation)) return
    listen.serverFault = location.kind === 'unreachable'
    if (this.#relay?.micActive(listen.sellerId) === true) { listen.phase = 'mic'; return }
    // 서버 쪽 길이 돌아왔다(D-LV1-17): "못 받음"을 지우고 평소처럼 잇는다
    if (listen.phase === 'unsupported' && location.kind !== 'unreachable' && location.kind !== 'unsupported') listen.phase = 'idle'
    switch (location.kind) {
      case 'none':
        if (listen.phase !== 'reconnecting') listen.phase = 'idle'
        this.#later(listen, STREAM_IDLE_RECHECK_MS)
        return
      case 'ended':
        this.#stop(listen); listen.phase = 'ended'
        return
      case 'unsupported':
        this.#stop(listen); listen.phase = 'unsupported'
        this.#o.log({ level: 'info', code: 'STREAM_AUDIO_UNSUPPORTED', seller: listen.sellerId })
        return
      case 'unreachable':
        // 방송 탓이 아니다(D-LV1-17): 화면은 "서버 문제로 못 받아요" + [다시 켜기], 서버는 1분마다 다시 본다 — 길이 돌아오면 저절로 듣는다
        this.#stop(listen); listen.phase = 'unsupported'
        this.#later(listen, STREAM_UNREACHABLE_RECHECK_MS)
        return
      case 'retry':
        this.#fail(listen, generation)
        return
      case 'ok':
        break
    }
    // 같은 소리 주인을 이미 듣고 있으면 그 흐름에 끼운다 — 소리 받기·받아쓰기는 한 번만 (D-LV1-15). 주인을 모르면 나누지 않는다
    const key = location.source ?? `seller:${listen.sellerId}:${listen.broadcastId}`
    const shared = this.#flows.get(key)
    if (shared !== undefined && !shared.closed) {
      shared.members.add(listen)
      listen.flow = shared
      if (shared.started) listen.phase = 'listening'
      return
    }
    const flow: Flow = { key, members: new Set([listen]), closed: false, started: false, lagMs: null, lastChunkAt: 0, stall: null, feed: null, worker: null, base: 0, sentMs: 0 }
    this.#flows.set(key, flow)
    listen.flow = flow
    flow.feed = this.#o.feed.open(location.url, {
      chunk: (pcm, producedAt) => this.#chunk(flow, pcm, producedAt),
      fail: () => this.#flowFail(flow),
    })
    flow.lastChunkAt = this.#o.clock.now()
    this.#watchStall(flow)
  }
  #chunk(flow: Flow, pcm: Buffer, producedAt: number | undefined): void {
    if (flow.closed || this.#closed) return
    const now = this.#o.clock.now()
    if (flow.worker === null) {
      // 힌트(D-V3-127)는 일꾼 흐름을 여는 이때 듣는 판매자들의 품종을 합친다 — 나중에 낀 판매자 품종은 다음에 열 때 든다 (D-LV1-15)
      const opened = this.#relay?.openExternal(
        (result) => this.#result(flow, result),
        () => { if (!flow.closed) { flow.worker = null; this.#flowFail(flow) } },
        [...flow.members].map((member) => member.sellerId),
      ) ?? 'NO_WORKER'
      if (typeof opened === 'string') { this.#flowFail(flow); return }
      flow.worker = opened
      // 첫 조각(100ms)은 도착한 순간 끝난 소리다 — 일꾼의 시각 0은 그보다 100ms 앞 (말 끝이 미래 시각이 되어 늦은 글로 빠지지 않게)
      flow.base = now - 100
      flow.sentMs = 0
    }
    if (!flow.worker.send(pcm)) { this.#flowFail(flow); return }
    // 방송 소리가 제 시간보다 늦게 도착하면(HLS 멈칫·끊김) 그만큼 기준을 옮긴다 — 소리 시각이 실제 도착보다 뒤처져
    // 받아쓴 말이 모두 "늦은 말"로 빠지지 않게(D-LIVETEST-03). 일찍 온 소리(첫 조각 몰림)는 그대로 둔다(말 끝은 now로 자른다).
    flow.sentMs += (pcm.length / 2 / STREAM_SAMPLE_RATE) * 1000
    if (now > flow.base + flow.sentMs) flow.base = now - flow.sentMs
    flow.lagMs = producedAt === undefined ? null : Math.max(0, now - producedAt)
    flow.lastChunkAt = now
    if (!flow.started) {
      flow.started = true
      for (const member of flow.members) member.phase = 'listening'
    }
  }
  /** HLS가 말없이 멈추면(조각이 8초 안 옴) 끊김으로 센다 */
  #watchStall(flow: Flow): void {
    flow.stall = this.#schedule(() => {
      flow.stall = null
      if (flow.closed || flow.feed === null) return
      if (this.#o.clock.now() - flow.lastChunkAt >= STREAM_STALL_MS) this.#flowFail(flow)
      else this.#watchStall(flow)
    }, STREAM_STALL_CHECK_MS)
  }
  /** 받아쓴 글 하나를 듣는 판매자마다 넘긴다 — 각자 자기 장부로 읽고 등록한다 */
  #result(flow: Flow, result: { text: string; startMs: number; endMs: number; conf?: number }): void {
    if (flow.closed || this.#closed || this.#relay === null) return
    const now = this.#o.clock.now()
    const endAt = Math.min(flow.base + result.endMs, now)
    const text = { text: result.text, startAt: Math.min(flow.base + result.startMs, endAt), endAt, ...(result.conf === undefined ? {} : { conf: result.conf }) }
    for (const listen of [...flow.members]) this.#deliver(listen, text)
  }
  #deliver(listen: Listen, text: { text: string; startAt: number; endAt: number; conf?: number }): void {
    if (this.#relay === null) return
    const delivered = this.#relay.deliver(listen.sellerId, listen.broadcastId, text)
    const reading = this.#o.serverReading
    // 앱이 받았으면 서버 읽기는 닫는다(두 곳에서 등록하지 않게). 받을 앱이 없으면 서버가 읽고 등록한다 (D-LV1-14)
    if (delivered) {
      reading?.release(listen.sellerId)
      listen.delivered = false
    } else {
      reading?.deliver(listen.sellerId, listen.broadcastId, text)
      if (!listen.delivered) {
        listen.delivered = true
        this.#o.log({ level: 'info', code: reading === undefined ? 'STREAM_AUDIO_NO_CONSOLE' : 'STREAM_AUDIO_SERVER_READING', seller: listen.sellerId })
      }
    }
  }
  /** 공유 흐름이 끊겼다: 흐름을 닫고, 듣던 판매자마다 끊김을 센다(각자 다시 주소를 찾고, 먼저 찾은 쪽이 새 흐름을 열면 나머지는 끼운다) */
  #flowFail(flow: Flow): void {
    if (flow.closed) return
    const members = [...flow.members]
    flow.members.clear()
    this.#closeFlow(flow)
    for (const listen of members) {
      listen.flow = null
      this.#fail(listen, listen.generation)
    }
  }
  /** 끊김: 소리는 버리고(따라잡지 않음) 1·2·4·8초 뒤 다시, 60초 안 여섯 번째면 멈춤 */
  #fail(listen: Listen, generation: number): void {
    if (!this.#live(listen, generation)) return
    this.#stop(listen)
    const { stop, count } = recordFailure(listen.failures, this.#o.clock.now())
    if (stop) {
      listen.phase = 'stopped'
      this.#o.log({ level: 'warn', code: 'STREAM_AUDIO_STOPPED', seller: listen.sellerId })
      return
    }
    listen.phase = 'reconnecting'
    this.#later(listen, retryDelayMs(count))
  }
}

export { STREAM_LATE_MS }
