// 시험용 가짜 네이티브 마이크 모듈·가짜 웹소켓 (실기기·네이티브 빌드 없음).
import { encodeBase64 } from '../src/base64.ts'
import type { AudioPermission, NativeAudioModuleLike, NativeFrameEvent, NativeStartOptions, NativeStateEvent } from '../src/types.ts'
import type { WebSocketLike } from '../src/transport/relay.ts'

export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

export interface FakeNative extends NativeAudioModuleLike {
  readonly starts: NativeStartOptions[]
  stops: number
  permission: AudioPermission
  /** requestPermission이 돌려줄 값 (없으면 permission 그대로) */
  afterRequest: AudioPermission | null
  requests: number
  startError: unknown
  running: boolean
  /** 네이티브가 틀을 보낸다 (base64 또는 바이트) */
  emitFrame(pcm: Uint8Array | string, capturedAtMs: number): void
  emitState(state: NativeStateEvent['state'], reason?: string): void
  readonly listeners: { frame: number; state: number }
}

export const GRANTED: AudioPermission = { status: 'granted', granted: true, canAskAgain: true }
export const DENIED: AudioPermission = { status: 'denied', granted: false, canAskAgain: false }
export const UNDETERMINED: AudioPermission = { status: 'undetermined', granted: false, canAskAgain: true }

export function createFakeNative(permission: AudioPermission = GRANTED): FakeNative {
  const frameListeners = new Set<(e: NativeFrameEvent) => void>()
  const stateListeners = new Set<(e: NativeStateEvent) => void>()
  const fake: FakeNative = {
    starts: [],
    stops: 0,
    permission,
    afterRequest: null,
    requests: 0,
    startError: undefined,
    running: false,
    listeners: { frame: 0, state: 0 },
    async start(options) {
      if (fake.startError !== undefined) throw fake.startError
      fake.starts.push(options)
      fake.running = true
    },
    async stop() {
      fake.stops++
      fake.running = false
    },
    async getPermission() {
      return fake.permission
    },
    async requestPermission() {
      fake.requests++
      if (fake.afterRequest !== null) fake.permission = fake.afterRequest
      return fake.permission
    },
    addListener(eventName: 'frame' | 'state', listener: ((e: NativeFrameEvent) => void) | ((e: NativeStateEvent) => void)) {
      if (eventName === 'frame') {
        const l = listener as (e: NativeFrameEvent) => void
        frameListeners.add(l)
        fake.listeners.frame++
        return {
          remove() {
            if (frameListeners.delete(l)) fake.listeners.frame--
          },
        }
      }
      const l = listener as (e: NativeStateEvent) => void
      stateListeners.add(l)
      fake.listeners.state++
      return {
        remove() {
          if (stateListeners.delete(l)) fake.listeners.state--
        },
      }
    },
    emitFrame(pcm, capturedAtMs) {
      const payload = typeof pcm === 'string' ? pcm : encodeBase64(pcm)
      for (const l of [...frameListeners]) l({ pcm: payload, capturedAtMs })
    },
    emitState(state, reason) {
      for (const l of [...stateListeners]) l(reason === undefined ? { state } : { state, reason })
    },
  } as FakeNative
  return fake
}

/** 100ms 틀 하나 (3,200바이트) — 값은 차례로 채운다 */
export function frame(seed = 0): Uint8Array {
  const out = new Uint8Array(3_200)
  for (let i = 0; i < out.length; i++) out[i] = (i + seed) & 0xff
  return out
}

export interface FakeSocket extends WebSocketLike {
  readonly url: string
  readonly headers: Readonly<Record<string, string>> | undefined
  readonly sent: (ArrayBuffer | ArrayBufferView | string)[]
  closed: number
  open(): void
  message(data: unknown): void
  drop(): void
  fail(): void
}

export function createFakeSocket(url: string, headers: Readonly<Record<string, string>> | undefined): FakeSocket {
  const socket: FakeSocket = {
    url,
    headers,
    sent: [],
    closed: 0,
    readyState: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      socket.sent.push(data)
    },
    close() {
      socket.closed++
      socket.readyState = 3
    },
    open() {
      socket.readyState = 1
      socket.onopen?.({})
    },
    message(data) {
      socket.onmessage?.({ data })
    },
    drop() {
      socket.readyState = 3
      socket.onclose?.({})
    },
    fail() {
      socket.onerror?.({})
    },
  }
  return socket
}
