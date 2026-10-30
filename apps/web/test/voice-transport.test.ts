import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVoiceTransport } from '../src/voice/transport.ts'

const sockets: FakeSocket[] = []
class FakeSocket extends EventTarget {
  static readonly OPEN = 1
  readyState = 1
  send = vi.fn()
  readonly url: URL
  constructor(url: URL) { super(); this.url = url; sockets.push(this) }
  close() { this.readyState = 3 }
  message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const transports: ReturnType<typeof createVoiceTransport>[] = []
function setup() {
  const error = vi.fn()
  const lost = vi.fn()
  const transport = createVoiceTransport({ broadcastId: 'b1', device: 'abcdefgh', hello: () => ({ type: 'voice.session', op: 'hello', context: { now: Date.now(), dialogOpen: false, smsAutoAllowed: true } }), onMessage() {}, onState() {}, onError: error, onConnectionLost: lost })
  transports.push(transport)
  transport.start()
  sockets.at(-1)!.message({ type: 'ready' })
  return { transport, error, lost, socket: sockets.at(-1)! }
}
beforeEach(() => { sockets.length = 0; vi.useFakeTimers(); vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('AudioWorkletNode', vi.fn(function AudioWorkletNode() {})) })
afterEach(() => { for (const transport of transports.splice(0)) transport.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('마이크 비동기 캡처 취소', () => {
  it.each(['pause', 'AUTH', 'ENDED', 'OTHER_DEVICE'] as const)('%s 뒤 권한 응답이 와도 트랙을 닫고 캡처를 시작하지 않는다', async (reason) => {
    const pending = deferred<MediaStream>()
    const stop = vi.fn()
    const createContext = vi.fn(function AudioContext() {})
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => pending.promise) } })
    vi.stubGlobal('AudioContext', createContext)
    const { transport, socket } = setup()
    if (reason === 'pause') transport.pauseCapture()
    else socket.message({ type: 'closing', reason })
    pending.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await flush()
    expect(stop).toHaveBeenCalledOnce()
    expect(createContext).not.toHaveBeenCalled()
    expect(socket.send.mock.calls.every(([data]) => typeof data === 'string')).toBe(true)
  })

  it('작업 모듈을 읽는 중 끄면 트랙과 문맥을 닫고 늦은 완료로 노드를 만들지 않는다', async () => {
    const module = deferred<void>()
    const stop = vi.fn(); const close = vi.fn(async () => undefined)
    const addModule = vi.fn((_url: string) => module.promise)
    const getMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: getMedia } })
    vi.stubGlobal('AudioContext', class { audioWorklet = { addModule }; close = close })
    const { transport, error } = setup()
    await flush()
    // D-APP1-10: 모노만 요청하고 메아리·잡음·자동 크기는 브라우저 기본값에 맡긴다.
    expect(getMedia).toHaveBeenCalledExactlyOnceWith({ audio: { channelCount: 1 }, video: false })
    expect(addModule).toHaveBeenCalledOnce()
    const address = new URL(addModule.mock.calls[0]![0], location.href)
    expect(address.origin).toBe(location.origin)
    expect(address.pathname).toMatch(/\/pcm-worklet(?:-[^/]+)?\.js$/)
    transport.pauseCapture(); module.resolve(); await flush()
    expect(stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(AudioWorkletNode).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('재연결 뒤 옛 권한 응답은 새 캡처를 덮지 않는다', async () => {
    const first = deferred<MediaStream>(); const second = deferred<MediaStream>()
    const getMedia = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const stop = vi.fn(); const createContext = vi.fn(function AudioContext() {})
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: getMedia } })
    vi.stubGlobal('AudioContext', createContext)
    const { transport, socket } = setup()
    socket.dispatchEvent(new Event('close'))
    await vi.advanceTimersByTimeAsync(1000)
    sockets.at(-1)!.message({ type: 'ready' })
    expect(getMedia).toHaveBeenCalledTimes(2)
    first.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await flush()
    expect(stop).toHaveBeenCalledOnce()
    expect(createContext).not.toHaveBeenCalled()
    transport.pauseCapture()
    second.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await flush()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(createContext).not.toHaveBeenCalled()
  })

  it('브라우저 offline 알림은 기존 소켓을 닫고 대기 캡처도 취소한다', async () => {
    const pending = deferred<MediaStream>(); const stop = vi.fn(); const createContext = vi.fn(function AudioContext() {})
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => pending.promise } })
    vi.stubGlobal('AudioContext', createContext)
    const { socket, lost } = setup()
    window.dispatchEvent(new Event('offline'))
    pending.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await flush()
    expect(socket.readyState).toBe(3)
    expect(lost).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
    expect(createContext).not.toHaveBeenCalled()
  })
})

// SRV1 (D-APP-22·25, 약속 4): 받아쓰기는 언제나 서버 — 크롬 길(mode=chrome)이 없다. 마이크 없는 조작 전용 연결은 capture=false로 연다.
describe('서버 받아쓰기 연결 인자 (SRV1)', () => {
  it('음성 듣기 연결은 mode·capture 인자 없이 열고, 조작 전용 연결은 capture=false로 연다 (mode=chrome 없음)', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise(() => {})) } })
    vi.stubGlobal('AudioContext', vi.fn(function AudioContext() {}))
    setup()
    const listening = sockets.at(-1)!.url
    expect(listening.searchParams.has('mode')).toBe(false)
    expect(listening.searchParams.has('capture')).toBe(false)
    const control = createVoiceTransport({ broadcastId: 'b1', device: 'abcdefgh', capture: false, hello: () => ({ type: 'voice.session', op: 'hello', context: { now: Date.now(), dialogOpen: false, smsAutoAllowed: true } }), onMessage() {}, onState() {}, onError() {} })
    transports.push(control)
    expect(control.isSupported()).toBe(true)
    control.start()
    const url = sockets.at(-1)!.url
    expect(url.searchParams.get('capture')).toBe('false')
    expect(url.searchParams.has('mode')).toBe(false)
  })
})
