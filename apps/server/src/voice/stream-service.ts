// LV1 방송 소리로 듣기 (VOC-08): 콘솔이 열려 있는 동안(watch 신호) 그 방송의 소리를 받아 일꾼에 넣고, 받아쓴 글은 그 방송 콘솔의 읽기로 넘긴다.
// 판매자 하나에 흐름 하나 — 휴대폰 마이크가 켜지면 쉬고, 꺼지면 돌아온다(D-LV1-06). 소리·글은 메모리에서만(로그·DB 없음).
import type { Clock } from '../time.ts'
import type { LogSink } from '../log.ts'
import type { ExternalStream, VoiceRelay } from './relay.ts'
import { STREAM_IDLE_RECHECK_MS, STREAM_LATE_MS, STREAM_STALL_CHECK_MS, STREAM_STALL_MS, recordFailure, retryDelayMs, type AudioFeed, type StreamLocator } from './stream-audio.ts'

export type StreamAudioPhase = 'hidden' | 'off' | 'idle' | 'listening' | 'reconnecting' | 'stopped' | 'unsupported' | 'mic' | 'ended'
/** late = lagMs가 30초를 넘음 (늦음 안내를 보일 때, D-LV1-10) */
export interface StreamAudioView { readonly phase: StreamAudioPhase; readonly lagMs?: number; readonly late?: boolean }

/** 콘솔 열림 신호가 이만큼 끊기면 콘솔이 닫힌 것으로 본다 (콘솔은 10초마다 보낸다) */
export const WATCH_TTL_MS = 25_000

export interface StreamAudioServiceOptions {
  readonly available: boolean
  readonly locate: StreamLocator
  readonly feed: AudioFeed
  readonly clock: Clock
  readonly log: LogSink
  readonly sellerOn: (sellerId: string) => Promise<boolean>
  readonly schedule?: (run: () => void, ms: number) => () => void
}

interface Listen {
  readonly sellerId: string
  readonly broadcastId: string
  phase: StreamAudioPhase
  /** 모르면 null (소리 받기가 조각 시각을 주지 않음 — 늦음 안내를 숨긴다) */
  lagMs: number | null
  lastChunkAt: number
  stall: (() => void) | null
  watchedUntil: number
  failures: number[]
  generation: number
  feed: { close(): void } | null
  worker: ExternalStream | null
  /** 지금 일꾼 흐름의 첫 조각을 받은 서버 시각 */
  base: number
  cancel: (() => void) | null
  delivered: boolean
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
      listen = { sellerId, broadcastId, phase: 'idle', lagMs: null, lastChunkAt: 0, stall: null, watchedUntil: now + WATCH_TTL_MS, failures: [], generation: 0, feed: null, worker: null, base: 0, cancel: null, delivered: false }
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
    if (listen.phase === 'listening') return listen.lagMs === null ? { phase: 'listening' } : { phase: 'listening', lagMs: listen.lagMs, late: listen.lagMs > STREAM_LATE_MS }
    return { phase: listen.phase }
  }
  async viewFor(sellerId: string, broadcastId: string): Promise<StreamAudioView> {
    if (!this.#o.available) return { phase: 'hidden' }
    if (!(await this.#o.sellerOn(sellerId))) return { phase: 'off' }
    return this.view(sellerId, broadcastId)
  }

  /** 마이크가 켜지거나 꺼졌다 (중계가 부른다) */
  micChanged(sellerId: string, active: boolean): void {
    const listen = this.#listens.get(sellerId)
    if (listen !== undefined) this.#arrange(listen, active)
  }
  /** 판매자 설정 끔 */
  stopSeller(sellerId: string): void {
    const listen = this.#listens.get(sellerId)
    if (listen === undefined) return
    this.#listens.delete(sellerId)
    this.#stop(listen)
  }
  /** 방송 끝 (D-LV1-05) */
  endBroadcast(sellerId: string, broadcastId: string): void {
    const listen = this.#listens.get(sellerId)
    if (listen === undefined || listen.broadcastId !== broadcastId) return
    this.#stop(listen)
    listen.phase = 'ended'
  }
  /** 콘솔이 닫힌 흐름을 닫는다 */
  sweep(): void {
    const now = this.#o.clock.now()
    for (const listen of [...this.#listens.values()]) {
      if (listen.watchedUntil > now) continue
      this.#listens.delete(listen.sellerId)
      this.#stop(listen)
    }
  }
  status(): { listening: number } {
    return { listening: [...this.#listens.values()].filter((listen) => listen.feed !== null).length }
  }
  close(): void {
    this.#closed = true
    this.#sweep?.()
    for (const listen of this.#listens.values()) this.#stop(listen)
    this.#listens.clear()
  }

  // ── 안쪽 ──────────────────────────────────────────────

  #arrange(listen: Listen, micStarting = false): void {
    if (listen.phase === 'stopped' || listen.phase === 'unsupported' || listen.phase === 'ended') return
    if (micStarting || this.#relay?.micActive(listen.sellerId) === true) {
      this.#stop(listen)
      listen.phase = 'mic'
      return
    }
    if (listen.feed === null && listen.cancel === null) {
      if (listen.phase === 'mic') listen.phase = 'idle'
      void this.#attempt(listen, ++listen.generation)
    }
  }
  #stop(listen: Listen): void {
    listen.generation++
    listen.cancel?.()
    listen.cancel = null
    listen.stall?.()
    listen.stall = null
    listen.feed?.close()
    listen.feed = null
    listen.worker?.close()
    listen.worker = null
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
    if (this.#relay?.micActive(listen.sellerId) === true) { listen.phase = 'mic'; return }
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
      case 'retry':
        this.#fail(listen, generation)
        return
      case 'ok':
        break
    }
    let first = true
    listen.feed = this.#o.feed.open(location.url, {
      chunk: (pcm, producedAt) => {
        if (!this.#live(listen, generation)) return
        const now = this.#o.clock.now()
        if (listen.worker === null) {
          const opened = this.#relay?.openExternal(
            (result) => this.#result(listen, generation, result),
            () => { if (this.#live(listen, generation)) { listen.worker = null; this.#fail(listen, generation) } },
          ) ?? 'NO_WORKER'
          if (typeof opened === 'string') { this.#fail(listen, generation); return }
          listen.worker = opened
          // 첫 조각(100ms)은 도착한 순간 끝난 소리다 — 일꾼의 시각 0은 그보다 100ms 앞 (말 끝이 미래 시각이 되어 늦은 글로 빠지지 않게)
          listen.base = now - 100
        }
        if (!listen.worker.send(pcm)) { this.#fail(listen, generation); return }
        listen.lagMs = producedAt === undefined ? null : Math.max(0, now - producedAt)
        listen.lastChunkAt = now
        if (first) { first = false; listen.phase = 'listening' }
      },
      fail: () => { if (this.#live(listen, generation)) this.#fail(listen, generation) },
    })
    listen.lastChunkAt = this.#o.clock.now()
    this.#watchStall(listen, generation)
  }
  /** HLS가 말없이 멈추면(조각이 8초 안 옴) 끊김으로 센다 */
  #watchStall(listen: Listen, generation: number): void {
    listen.stall = this.#schedule(() => {
      listen.stall = null
      if (!this.#live(listen, generation) || listen.feed === null) return
      if (this.#o.clock.now() - listen.lastChunkAt >= STREAM_STALL_MS) this.#fail(listen, generation)
      else this.#watchStall(listen, generation)
    }, STREAM_STALL_CHECK_MS)
  }
  #result(listen: Listen, generation: number, result: { text: string; startMs: number; endMs: number }): void {
    if (!this.#live(listen, generation) || this.#relay === null) return
    const now = this.#o.clock.now()
    const endAt = Math.min(listen.base + result.endMs, now)
    const delivered = this.#relay.deliver(listen.sellerId, listen.broadcastId, { text: result.text, startAt: Math.min(listen.base + result.startMs, endAt), endAt })
    if (!delivered && !listen.delivered) {
      listen.delivered = true
      this.#o.log({ level: 'info', code: 'STREAM_AUDIO_NO_CONSOLE', seller: listen.sellerId })
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
