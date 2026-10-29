// APP1: 세션 인증·출처 검사를 거친 기기와 인증된 받아쓰기 일꾼을 잇는다.
// 음성·받아쓴 글은 이 연결의 메모리만 거치며 DB·로그에 남기지 않는다.
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { isVoiceClientMessage } from '@livejjim/voice-session/wire'
import type { Auth, SessionContext } from '../auth.ts'
import type { Db } from '../db/database.ts'
import type { LogSink } from '../log.ts'
import { findBroadcast } from '../store.ts'
import type { Clock } from '../time.ts'

export type VoiceCloseReason = 'OTHER_DEVICE' | 'BUSY' | 'NO_WORKER' | 'ENDED' | 'AUTH' | 'RATE' | 'WORKER_LOST'
export interface VoiceReadingSession {
  onResult(result: { text: string; startMs: number; endMs: number }): void | Promise<void>
  onMessage(message: unknown): void | Promise<void>
  close(): void
  refresh?(): Promise<void>
}
export interface VoiceRelayOptions {
  readonly auth: Auth
  readonly db: Db
  readonly appOrigin: string
  readonly clock: Clock
  readonly log: LogSink
  readonly workerToken?: string
  readonly reading?: (context: { session: SessionContext; broadcastId: string; device: string; mode: 'chrome' | 'livegenie'; send: (message: unknown) => void }) => VoiceReadingSession | Promise<VoiceReadingSession>
}
interface Peer { readonly ws: WebSocket; pongAt: number }
interface Worker extends Peer { capacity: number; nextStream: number; readonly streams: Map<number, Device> }
interface Device extends Peer {
  session: SessionContext | null
  broadcastId: string
  device: string
  mode: 'chrome' | 'livegenie'
  pending: number
  worker: Worker | null
  stream: number
  ready: boolean
  bytes: number
  windowAt: number
  reading: VoiceReadingSession | null
  work: Promise<void>
}
const REGISTRATIONS = new WeakMap<object, VoiceRelay>()
export function registerVoiceRelay(app: object, voice: VoiceRelay): void { REGISTRATIONS.set(app, voice) }
export function attachVoiceRelay(server: Server, app: object): void { REGISTRATIONS.get(app)?.attach(server) }
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
      if (req.headers.origin !== this.#options.appOrigin) { reject(socket, 403); return }
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
      for (const device of [...worker.streams.values()]) this.#finish(device, 'WORKER_LOST')
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
      if (!device?.ready) return
      this.#samples.push({ at: this.#options.clock.now(), ms: value.procMs })
      this.#trimSamples()
      const result = { text: value.text, startMs: value.startMs, endMs: value.endMs }
      send(device.ws, { type: 'result', ...result })
      if (device.reading !== null) this.#enqueue(device, () => device.reading?.onResult(result))
    })
  }
  #device(ws: WebSocket, req: IncomingMessage, url: URL): void {
    const now = this.#options.clock.now()
    const device: Device = { ws, pongAt: now, session: null, broadcastId: url.searchParams.get('broadcastId') ?? '', device: url.searchParams.get('device') ?? '', mode: url.searchParams.get('mode') === 'chrome' ? 'chrome' : 'livegenie', pending: 0, worker: null, stream: 0, ready: false, bytes: 0, windowAt: now, reading: null, work: Promise.resolve() }
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
    if (session === null || session.role !== 'SELLER') { this.#finish(device, 'AUTH'); return }
    device.session = session
    if (!/^[A-Za-z0-9]{8,64}$/.test(device.device)) { this.#finish(device, 'AUTH'); return }
    const broadcast = await findBroadcast(db, session.sellerId, device.broadcastId)
    if (!this.#devices.has(device)) return
    if (broadcast === null || broadcast.endedAt !== null) { this.#finish(device, 'ENDED'); return }
    const owner = this.#owners.get(session.sellerId)
    if (owner !== undefined) {
      if (owner.device !== device.device) { this.#finish(device, 'OTHER_DEVICE'); return }
      this.#finish(owner)
    }
    const worker = [...this.#workers].filter((candidate) => candidate.ws.readyState === WebSocket.OPEN && candidate.streams.size < candidate.capacity && candidate.nextStream <= 4_294_967_295)
      .sort((a, b) => (b.capacity - b.streams.size) - (a.capacity - a.streams.size))[0]
    if (worker === undefined && device.mode !== 'chrome') {
      if (this.#workers.size === 0) { this.#noWorker(); this.#finish(device, 'NO_WORKER') }
      else this.#finish(device, 'BUSY')
      return
    }
    if (device.mode !== 'chrome' && worker !== undefined) {
      device.worker = worker
      device.stream = worker.nextStream++
      worker.streams.set(device.stream, device)
    }
    this.#owners.set(session.sellerId, device)
    if (this.#options.reading !== undefined) {
      const reading = await this.#options.reading({ session, broadcastId: device.broadcastId, device: device.device, mode: device.mode, send: (value) => send(device.ws, value) })
      if (!this.#devices.has(device)) { reading.close(); return }
      device.reading = reading
    }
    // 인증 조회 동안 로그아웃·방송 종료가 일어났으면 시작하지 않는다.
    if (!(await auth.alive(session.tokenHash))) { this.#finish(device, 'AUTH'); return }
    const stillOpen = await findBroadcast(db, session.sellerId, device.broadcastId)
    if (!this.#devices.has(device)) return
    if (stillOpen?.endedAt !== null) { this.#finish(device, 'ENDED'); return }
    if (device.worker !== null) {
      if (device.worker.ws.readyState !== WebSocket.OPEN) { this.#finish(device, 'WORKER_LOST'); return }
      send(device.worker.ws, { type: 'open', stream: device.stream })
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
    if (device.session && this.#owners.get(device.session.sellerId) === device) this.#owners.delete(device.session.sellerId)
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
