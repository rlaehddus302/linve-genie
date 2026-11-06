// APP1: 세션 인증·출처 검사를 거친 기기와 인증된 받아쓰기 일꾼을 잇는다.
// 음성·받아쓴 글은 이 연결의 메모리만 거치며 DB·로그에 남기지 않는다.
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { isVoiceClientMessage, type VoiceFlowMode } from '@livejjim/voice-session/wire'
import type { Auth, SessionContext } from '../auth.ts'
import { originAllowed } from '../config.ts'
import type { Db } from '../db/database.ts'
import type { LogSink } from '../log.ts'
import { findBroadcast } from '../store.ts'
import type { Clock } from '../time.ts'

export type VoiceCloseReason = 'OTHER_DEVICE' | 'BUSY' | 'NO_WORKER' | 'ENDED' | 'AUTH' | 'RATE' | 'WORKER_LOST'
export interface VoiceReadingSession {
  onResult(result: { text: string; startMs: number; endMs: number }): void | Promise<void>
  onMessage(message: unknown): void | Promise<void>
  /** 서버가 받은 방송 소리의 시각 0 (서버 시계) — 없으면 기기가 보낸 capture처럼 쓴다 */
  onServerCapture?(at: number): void | Promise<void>
  close(): void
  refresh?(): Promise<void>
}
export interface VoiceRelayOptions {
  readonly auth: Auth
  readonly db: Db
  readonly appOrigin: string
  /** 옛 앱 주소들 (D-OPS-DOMAIN) */
  readonly oldAppOrigins?: readonly string[]
  readonly clock: Clock
  readonly log: LogSink
  readonly workerToken?: string
  /** LV1: 휴대폰 마이크 흐름이 생기기 직전·끝난 뒤 (방송 소리는 마이크에 자리를 내준다, D-LV1-06) */
  readonly onMicChange?: (sellerId: string, active: boolean) => void
  /** D-V3-127 받아쓰기 힌트(한글 수 보기 + 그 판매자 품종). 흐름을 열 때 open에 실어 보낸다 */
  readonly hint?: (sellerId: string) => string
  /** 흐름을 열기 전에 장부를 읽어 둔다 */
  readonly warmHint?: (sellerId: string) => Promise<void>
  readonly reading?: (context: { session: SessionContext; broadcastId: string; device: string; mode: VoiceFlowMode; send: (message: unknown) => void }) => VoiceReadingSession | Promise<VoiceReadingSession>
}
interface Peer { readonly ws: WebSocket; pongAt: number }
/** 서버가 직접 여는 흐름 (방송 소리, LV1) — 기기 대신 서버가 소리를 넣고 글을 받는다 */
interface External { readonly external: true; readonly onResult: (result: { text: string; startMs: number; endMs: number }) => void; readonly onLost: () => void }
interface Worker extends Peer { capacity: number; nextStream: number; readonly streams: Map<number, Device | External> }
export interface ExternalStream { send(pcm: Buffer): boolean; close(): void }
const isExternal = (x: Device | External): x is External => 'external' in x
interface Device extends Peer {
  session: SessionContext | null
  broadcastId: string
  device: string
  mode: VoiceFlowMode
  pending: number
  worker: Worker | null
  stream: number
  ready: boolean
  /** 서버 방송 소리 글을 넘길 때 쓴 첫 시각 (조작 흐름에만) */
  captureAt: number | null
  bytes: number
  windowAt: number
  reading: VoiceReadingSession | null
  work: Promise<void>
}
const REGISTRATIONS = new WeakMap<object, VoiceRelay>()
export function registerVoiceRelay(app: object, voice: VoiceRelay): void { REGISTRATIONS.set(app, voice) }
export function attachVoiceRelay(server: Server, app: object): void { REGISTRATIONS.get(app)?.attach(server) }
/**
 * 흐름 종류 (D-APP-25 (2)): `capture=false`는 마이크 없는 조작 전용(control). 옛 `mode=chrome`도 조작 전용으로만 연다 — SRV1부터 받아쓴 글은 받지 않는다
 * (읽기 세션이 chromeResult를 UNSUPPORTED로 거절). 둘 다 받아쓰기 일꾼을 잡지 않는다
 */
function flowMode(url: URL): VoiceFlowMode {
  if (url.searchParams.get('capture') === 'false') return 'control'
  return url.searchParams.get('mode') === 'chrome' ? 'chrome' : 'livegenie'
}
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const natural = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const bytesOf = (data: RawData): Buffer => Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.concat(data)
function readJson(data: RawData): unknown { try { return JSON.parse(bytesOf(data).toString('utf8')) } catch { return null } }
function send(ws: WebSocket, value: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return
  if (ws.bufferedAmount > 262_144) { ws.terminate(); return }
  ws.send(JSON.stringify(value))
}
function reject(socket: Duplex, status: 401 | 403 | 404): void {
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}
function cookie(req: IncomingMessage): string | undefined {
  const pair = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('lj_session='))
  return pair?.slice('lj_session='.length)
}
/** 길이가 다른 비밀값도 같은 길이 해시끼리 비교한다. 입력값은 로그에 쓰지 않는다. */
export function workerTokenMatches(expected: string | undefined, supplied: string | undefined): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  const match = timingSafeEqual(hash(expected ?? ''), hash(supplied ?? ''))
  return expected !== undefined && expected.length > 0 && supplied !== undefined && match
}

export class VoiceRelay {
  readonly #options: VoiceRelayOptions
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 262_144, perMessageDeflate: false })
  readonly #workers = new Set<Worker>()
  readonly #devices = new Set<Device>()
  readonly #owners = new Map<string, Device>()
  /** 휴대폰 마이크에 자리를 내준 콘솔 조작 흐름 (닫지 않는다 — 마이크가 끝나면 다시 주인, 방송 소리 글을 받는다. TD-LV1-001) */
  readonly #parked = new Map<string, Device>()
  readonly #samples: { at: number; ms: number }[] = []
  readonly #timer: ReturnType<typeof setInterval>
  readonly #offLogout: () => void
  #closed = false
  #lastAlert = Number.NEGATIVE_INFINITY
  #alertCount = 0
  #checking = false
  constructor(options: VoiceRelayOptions) {
    this.#options = options
    this.#timer = setInterval(() => { void this.check().catch(() => {}) }, 15_000)
    this.#timer.unref()
    this.#offLogout = options.auth.onSessionEnd((hash) => {
      for (const device of this.#devices) if (device.session?.tokenHash === hash) this.#finish(device, 'AUTH')
    })
  }
  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => this.#upgrade(req, socket, head))
  }
  #upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.#closed) { socket.destroy(); return }
    let url: URL
    try { url = new URL(req.url ?? '', 'http://voice.local') } catch { reject(socket, 404); return }
    if (url.pathname === '/api/voice/worker') {
      const value = req.headers.authorization
      if (!workerTokenMatches(this.#options.workerToken, value?.startsWith('Bearer ') ? value.slice(7) : undefined)) { reject(socket, 401); return }
      this.#wss.handleUpgrade(req, socket, head, (ws) => this.#worker(ws))
    } else if (url.pathname === '/api/voice/stream') {
      if (!originAllowed(req.headers.origin, this.#options.appOrigin, this.#options.oldAppOrigins)) { reject(socket, 403); return }
      this.#wss.handleUpgrade(req, socket, head, (ws) => this.#device(ws, req, url))
    } else reject(socket, 404)
  }
  #worker(ws: WebSocket): void {
    const worker: Worker = { ws, capacity: 0, nextStream: 1, streams: new Map(), pongAt: this.#options.clock.now() }
    const greeting = setTimeout(() => { if (worker.capacity === 0) ws.terminate() }, 5_000)
    greeting.unref()
    ws.on('error', () => {})
    ws.on('pong', () => { worker.pongAt = this.#options.clock.now() })
    ws.on('close', () => {
      clearTimeout(greeting)
      const wasActive = this.#workers.delete(worker)
      for (const device of [...worker.streams.values()]) {
        if (isExternal(device)) device.onLost()
        else this.#finish(device, 'WORKER_LOST')
      }
      worker.streams.clear()
      if (wasActive && this.#workers.size === 0 && !this.#closed) this.#noWorker()
    })
    ws.on('message', (data, binary) => {
      if (binary || bytesOf(data).length > 16_384) { ws.close(); return }
      const value = readJson(data)
      if (!record(value)) return
      if (worker.capacity === 0) {
        if (value.type !== 'hello' || !natural(value.maxStreams) || value.maxStreams < 1 || value.maxStreams > 64) { ws.close(); return }
        worker.capacity = value.maxStreams
        clearTimeout(greeting)
        this.#workers.add(worker)
        return
      }
      if (value.type !== 'result' || !natural(value.stream) || typeof value.text !== 'string' || value.text.trim() === '' || value.text.length > 2_000 ||
        !natural(value.startMs) || !natural(value.endMs) || value.startMs > value.endMs || !natural(value.procMs)) return
      const device = worker.streams.get(value.stream)
      if (device === undefined) return
      const result = { text: value.text, startMs: value.startMs, endMs: value.endMs }
      if (isExternal(device)) {
        this.#samples.push({ at: this.#options.clock.now(), ms: value.procMs })
        this.#trimSamples()
        device.onResult(result)
        return
      }
      if (!device.ready) return
      this.#samples.push({ at: this.#options.clock.now(), ms: value.procMs })
      this.#trimSamples()
      send(device.ws, { type: 'result', ...result })
      if (device.reading !== null) this.#enqueue(device, () => device.reading?.onResult(result))
    })
  }
  #device(ws: WebSocket, req: IncomingMessage, url: URL): void {
    const now = this.#options.clock.now()
    const device: Device = { ws, pongAt: now, session: null, broadcastId: url.searchParams.get('broadcastId') ?? '', device: url.searchParams.get('device') ?? '', mode: flowMode(url), pending: 0, worker: null, stream: 0, ready: false, captureAt: null, bytes: 0, windowAt: now, reading: null, work: Promise.resolve() }
    this.#devices.add(device)
    ws.on('error', () => {})
    ws.on('pong', () => { device.pongAt = this.#options.clock.now() })
    ws.on('close', () => this.#finish(device))
    ws.on('message', (data, binary) => {
      const size = bytesOf(data).length
      const elapsed = this.#options.clock.now() - device.windowAt
      if (elapsed >= 1_000) { device.windowAt += Math.floor(elapsed / 1_000) * 1_000; device.bytes = 0 }
      device.bytes += size
      if (size > 65_536 || device.bytes > 65_536 || (!binary && size > 16_384)) { this.#finish(device, 'RATE'); return }
      if (!device.ready) return
      if (!binary) {
        const value = readJson(data)
        if (!isVoiceClientMessage(value)) { this.#finish(device, 'RATE'); return }
        if (device.reading !== null) this.#enqueue(device, () => device.reading?.onMessage(value))
        return
      }
      if (size === 0 || size % 2 !== 0 || device.worker === null) return
      const header = Buffer.allocUnsafe(4)
      header.writeUInt32BE(device.stream)
      if (device.worker.ws.bufferedAmount > 262_144) { this.#finish(device, 'WORKER_LOST'); return }
      if (device.worker.ws.readyState === WebSocket.OPEN) device.worker.ws.send(Buffer.concat([header, bytesOf(data)]))
      else this.#finish(device, 'WORKER_LOST')
    })
    void this.#authorize(device, cookie(req)).catch(() => this.#finish(device, 'AUTH'))
  }
  async #authorize(device: Device, token: string | undefined): Promise<void> {
    const { auth, db } = this.#options
    const session = await auth.session(token)
    if (!this.#devices.has(device)) return
    if (session === null) { this.#finish(device, 'AUTH'); return }
    device.session = session
    if (!/^[A-Za-z0-9]{8,64}$/.test(device.device)) { this.#finish(device, 'AUTH'); return }
    const broadcast = await findBroadcast(db, session.sellerId, device.broadcastId)
    if (!this.#devices.has(device)) return
    if (broadcast === null || broadcast.endedAt !== null) { this.#finish(device, 'ENDED'); return }
    const owner = this.#owners.get(session.sellerId)
    if (owner !== undefined) {
      if (owner.device !== device.device) {
        // 콘솔 조작 흐름(마이크 없음)이 주인이면 마이크를 받아들이고 그 흐름은 쉬게 둔다 (D-LV1-06)
        if (device.mode === 'livegenie' && owner.mode !== 'livegenie') {
          this.#owners.delete(session.sellerId)
          const before = this.#parked.get(session.sellerId)
          if (before !== undefined && before !== owner) this.#finish(before)
          this.#parked.set(session.sellerId, owner)
        } else { this.#finish(device, 'OTHER_DEVICE'); return }
      } else this.#finish(owner)
    }
    // 마이크가 일꾼 자리를 먼저 받게 방송 소리 흐름을 먼저 쉬게 한다 (D-LV1-06). 거절되면 다시 돌려 놓는다
    if (device.mode === 'livegenie') this.#options.onMicChange?.(session.sellerId, true)
    const worker = [...this.#workers].filter((candidate) => candidate.ws.readyState === WebSocket.OPEN && candidate.streams.size < candidate.capacity && candidate.nextStream <= 4_294_967_295)
      .sort((a, b) => (b.capacity - b.streams.size) - (a.capacity - a.streams.size))[0]
    if (worker === undefined && device.mode === 'livegenie') {
      queueMicrotask(() => this.#options.onMicChange?.(session.sellerId, false))
      if (this.#workers.size === 0) { this.#noWorker(); this.#finish(device, 'NO_WORKER') }
      else this.#finish(device, 'BUSY')
      return
    }
    if (device.mode === 'livegenie' && worker !== undefined) {
      device.worker = worker
      device.stream = worker.nextStream++
      worker.streams.set(device.stream, device)
    }
    this.#owners.set(session.sellerId, device)
    // 마이크가 이긴다: 방송 소리 흐름은 쉰다 (D-LV1-06)
    if (device.mode === 'livegenie') this.#options.onMicChange?.(session.sellerId, true)
    if (this.#options.reading !== undefined) {
      const reading = await this.#options.reading({ session, broadcastId: device.broadcastId, device: device.device, mode: device.mode, send: (value) => send(device.ws, value) })
      if (!this.#devices.has(device)) { reading.close(); return }
      device.reading = reading
    }
    // 인증 조회 동안 로그아웃·방송 종료가 일어났으면 시작하지 않는다.
    if (!(await auth.alive(session.tokenHash))) { this.#finish(device, 'AUTH'); return }
    await this.#options.warmHint?.(session.sellerId)
    const stillOpen = await findBroadcast(db, session.sellerId, device.broadcastId)
    if (!this.#devices.has(device)) return
    if (stillOpen?.endedAt !== null) { this.#finish(device, 'ENDED'); return }
    if (device.worker !== null) {
      if (device.worker.ws.readyState !== WebSocket.OPEN) { this.#finish(device, 'WORKER_LOST'); return }
      send(device.worker.ws, { type: 'open', stream: device.stream, ...this.#hintField(session.sellerId) })
    }
    device.ready = true
    send(device.ws, { type: 'ready' })
  }
  #enqueue(device: Device, task: () => void | Promise<void> | undefined): void {
    if (++device.pending > 32) { this.#finish(device, 'RATE'); return }
    device.work = device.work.then(async () => { if (device.ready) await task() }).catch(() => this.#finish(device, 'WORKER_LOST')).finally(() => { device.pending-- })
  }
  #finish(device: Device, reason?: VoiceCloseReason): void {
    if (!this.#devices.delete(device)) return
    device.ready = false
    if (device.session && this.#parked.get(device.session.sellerId) === device) this.#parked.delete(device.session.sellerId)
    if (device.session && this.#owners.get(device.session.sellerId) === device) {
      const sellerId = device.session.sellerId
      this.#owners.delete(sellerId)
      // 쉬던 콘솔 조작 흐름이 다시 주인이 된다
      const parked = this.#parked.get(sellerId)
      if (parked !== undefined) { this.#parked.delete(sellerId); if (this.#devices.has(parked)) this.#owners.set(sellerId, parked) }
      if (device.mode === 'livegenie') this.#options.onMicChange?.(sellerId, false)
    }
    const worker = device.worker
    if (worker !== null) {
      worker.streams.delete(device.stream)
      send(worker.ws, { type: 'close', stream: device.stream })
    }
    device.worker = null
    device.reading?.close()
    device.reading = null
    if (reason !== undefined) send(device.ws, { type: 'closing', reason })
    if (device.ws.readyState === WebSocket.OPEN) device.ws.close()
  }
  #hintField(sellerId: string): { hint?: string } {
    const hint = this.#options.hint?.(sellerId)
    return hint === undefined || hint === '' ? {} : { hint }
  }
  /** 그 판매자의 휴대폰 마이크(받아쓰기 흐름)가 듣는 중인가 */
  micActive(sellerId: string): boolean {
    return this.#owners.get(sellerId)?.mode === 'livegenie'
  }
  /** 서버가 직접 소리를 넣는 흐름을 연다 (방송 소리). 일꾼이 없거나 다 차면 까닭 */
  openExternal(onResult: External['onResult'], onLost: () => void, sellerId?: string): ExternalStream | 'NO_WORKER' | 'BUSY' {
    if (this.#closed) return 'NO_WORKER'
    const worker = [...this.#workers].filter((candidate) => candidate.ws.readyState === WebSocket.OPEN && candidate.streams.size < candidate.capacity && candidate.nextStream <= 4_294_967_295)
      .sort((a, b) => (b.capacity - b.streams.size) - (a.capacity - a.streams.size))[0]
    if (worker === undefined) {
      if (this.#workers.size === 0) { this.#noWorker(); return 'NO_WORKER' }
      return 'BUSY'
    }
    const stream = worker.nextStream++
    const entry: External = { external: true, onResult, onLost }
    worker.streams.set(stream, entry)
    send(worker.ws, { type: 'open', stream, ...(sellerId === undefined ? {} : this.#hintField(sellerId)) })
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(stream)
    let open = true
    return {
      send: (pcm) => {
        if (!open || worker.streams.get(stream) !== entry) return false
        if (worker.ws.readyState !== WebSocket.OPEN || worker.ws.bufferedAmount > 262_144) return false
        worker.ws.send(Buffer.concat([header, pcm]))
        return true
      },
      close: () => {
        if (!open) return
        open = false
        if (worker.streams.get(stream) === entry) { worker.streams.delete(stream); send(worker.ws, { type: 'close', stream }) }
      },
    }
  }
  /**
   * 방송 소리에서 받아쓴 글을 그 방송 콘솔(마이크 아닌 조작 흐름)의 읽기로 넘긴다. 시각은 서버가 조각을 받은 시각(밀리초, UTC).
   * 넘길 콘솔이 없으면 false — 아무도 못 보는 바로 등록은 하지 않는다 (D-LV1-03)
   */
  deliver(sellerId: string, broadcastId: string, result: { text: string; startAt: number; endAt: number }): boolean {
    const device = this.#owners.get(sellerId)
    if (device === undefined || device.mode === 'livegenie' || device.broadcastId !== broadcastId || !device.ready || device.reading === null) return false
    if (device.captureAt === null) {
      const at = result.startAt
      device.captureAt = at
      this.#enqueue(device, () => device.reading?.onServerCapture ? device.reading.onServerCapture(at) : device.reading?.onMessage({ type: 'voice.session', op: 'capture', at }))
    }
    const base = device.captureAt
    const shifted = { text: result.text, startMs: Math.max(0, result.startAt - base), endMs: Math.max(0, result.endAt - base) }
    send(device.ws, { type: 'result', ...shifted })
    this.#enqueue(device, () => device.reading?.onResult(shifted))
    return true
  }
  refreshSeller(sellerId: string): void {
    const device = this.#owners.get(sellerId)
    if (device?.reading?.refresh) this.#enqueue(device, () => device.reading?.refresh?.())
  }
  endBroadcast(sellerId: string, broadcastId: string): void {
    const device = this.#owners.get(sellerId)
    if (device?.broadcastId === broadcastId) this.#finish(device, 'ENDED')
  }
  async check(): Promise<void> {
    if (this.#checking || this.#closed) return
    this.#checking = true
    try {
      const now = this.#options.clock.now()
      for (const peer of [...this.#workers, ...this.#devices]) {
        if (now - peer.pongAt >= 30_000) { peer.ws.terminate(); continue }
        if (peer.ws.readyState === WebSocket.OPEN) peer.ws.ping()
      }
      for (const device of [...this.#devices]) {
        const session = device.session
        if (session === null) continue
        if (!(await this.#options.auth.alive(session.tokenHash))) { this.#finish(device, 'AUTH'); continue }
        const row = await findBroadcast(this.#options.db, session.sellerId, device.broadcastId)
        if (row === null || row.endedAt !== null) this.#finish(device, 'ENDED')
      }
    } finally { this.#checking = false }
  }
  #trimSamples(): void {
    const cutoff = this.#options.clock.now() - 600_000
    while (this.#samples.length > 0 && (this.#samples[0]!.at < cutoff || this.#samples.length > 100_000)) this.#samples.shift()
  }
  status(): { workers: number; streams: number; p95Ms: number | null } {
    this.#trimSamples()
    const values = this.#samples.map((sample) => sample.ms).sort((a, b) => a - b)
    return { workers: this.#workers.size, streams: this.#owners.size, p95Ms: values[Math.ceil(values.length * 0.95) - 1] ?? null }
  }
  #noWorker(): void {
    this.#alertCount++
    if (this.#options.clock.now() - this.#lastAlert < 600_000) return
    this.#options.log({ level: 'alert', code: 'TRANSCRIBE_NO_WORKER', count: this.#alertCount })
    this.#lastAlert = this.#options.clock.now()
    this.#alertCount = 0
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    clearInterval(this.#timer)
    this.#offLogout()
    for (const device of [...this.#devices]) { this.#finish(device); device.ws.terminate() }
    for (const worker of this.#workers) worker.ws.terminate()
    // hello 전 일꾼도 서버 종료 때 남겨 두지 않는다.
    for (const socket of this.#wss.clients) socket.terminate()
    this.#workers.clear()
    this.#samples.length = 0
    this.#wss.close()
  }
}
