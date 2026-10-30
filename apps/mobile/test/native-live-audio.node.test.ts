// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioCapture, type NativeAudioModuleLike, type NativeFrameEvent, type NativeStateEvent, type WebSocketLike } from '@livejjim/mobile-audio'
import { LiveNativeAudio } from '../src/native/live-audio.ts'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'

class Socket implements WebSocketLike {
  readyState = 0
  onopen: WebSocketLike['onopen'] = null
  onmessage: WebSocketLike['onmessage'] = null
  onclose: WebSocketLike['onclose'] = null
  onerror: WebSocketLike['onerror'] = null
  sent: unknown[] = []
  closed = false
  send(data: unknown) { this.sent.push(data) }
  close() { this.closed = true }
  open() { this.readyState = 1; this.onopen?.({}) }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
function setup() {
  let frame: ((value: NativeFrameEvent) => void) | undefined
  const native = {
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    getPermission: async () => ({ status: 'granted' as const, granted: true, canAskAgain: true }),
    requestPermission: async () => ({ status: 'granted' as const, granted: true, canAskAgain: true }),
    addListener: (event: string, cb: ((value: NativeFrameEvent) => void) | ((value: NativeStateEvent) => void)) => { if (event === 'frame') frame = cb as (value: NativeFrameEvent) => void; return { remove() {} } },
  } as NativeAudioModuleLike
  const capture = createAudioCapture(native)
  const sockets: Socket[] = []
  const factory = vi.fn(() => { const socket = new Socket(); sockets.push(socket); return socket })
  const audio = new LiveNativeAudio(() => capture, factory)
  return { audio, native, factory, sockets, frame: (at = Date.now()) => frame?.({ pcm: new Uint8Array(3200), capturedAtMs: at }) }
}
afterEach(() => vi.useRealTimers())
describe('실제 네이티브 음성 연결', () => {
  it('공개 Origin으로 연결하고 ready 뒤 hello → 캡처 시각 → 실제 PCM만 보낸다', async () => {
    const { audio, factory, sockets, frame, native } = setup()
    audio.sendSession({ type: 'voice.session', op: 'hello', context: { now: 0, dialogOpen: false, smsAutoAllowed: true, consent: true } })
    await audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream?broadcastId=b1&device=abcdefgh', origin: 'https://app.example' })
    expect(factory).toHaveBeenCalledWith('wss://app.example/api/voice/stream?broadcastId=b1&device=abcdefgh', { Origin: 'https://app.example' })
    const socket = sockets[0]!
    socket.open(); frame()
    expect(socket.sent).toEqual([])
    socket.message({ type: 'ready' }); frame(123456)
    expect(JSON.parse(String(socket.sent[0])).op).toBe('hello')
    expect(JSON.parse(String(socket.sent[1]))).toEqual({ type: 'voice.session', op: 'capture', at: 123456 })
    expect(socket.sent[2]).toBeInstanceOf(ArrayBuffer)
    expect((socket.sent[2] as ArrayBuffer).byteLength).toBe(3200)
    await audio.stopListening()
    expect(native.stop).toHaveBeenCalled()
    expect(socket.closed).toBe(true)
    expect(audio.state.kind).toBe('off')
  })
  it('서버 거절은 성공으로 바꾸지 않고 마이크를 끄고 서버 문장을 보인다', async () => {
    const { audio, sockets, native } = setup()
    await audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    sockets[0]!.open(); sockets[0]!.message({ type: 'error', message: '다른 기기에서 듣는 중이에요.' })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(audio.state).toEqual({ kind: 'stopped', message: '다른 기기에서 듣는 중이에요.' })
    expect(native.stop).toHaveBeenCalled()
  })
  it('네이티브 모듈이 없으면 가짜 듣기로 대체하지 않는다', async () => {
    const factory = vi.fn()
    const audio = new LiveNativeAudio(() => { throw new Error('native unavailable') }, factory)
    await audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    expect(audio.state.kind).toBe('stopped')
    expect(factory).not.toHaveBeenCalled()
  })
  it('듣던 중 일꾼 연결이 끊기면 다시 잇되 처음부터 서버가 없으면 멈춘다', async () => {
    vi.useFakeTimers()
    const first = setup()
    await first.audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    first.sockets[0]!.open(); first.sockets[0]!.message({ type: 'closing', reason: 'NO_WORKER' })
    await vi.advanceTimersByTimeAsync(0)
    expect(first.audio.state).toEqual({ kind: 'stopped', message: '받아쓰기 서버가 꺼져 있어요. 상품은 빠른 입력으로 넣어 주세요.' })
    const next = setup()
    await next.audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    next.sockets[0]!.open(); next.sockets[0]!.message({ type: 'ready' }); next.sockets[0]!.message({ type: 'closing', reason: 'WORKER_LOST' })
    expect(next.audio.state).toEqual({ kind: 'reconnecting', attempt: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(next.sockets).toHaveLength(2)
    await next.audio.stopListening()
  })
  it('끊긴 동안 PCM과 효과 회신을 쌓거나 재생하지 않는다', async () => {
    vi.useFakeTimers()
    const { audio, sockets, frame } = setup()
    audio.sendSession({ type: 'voice.session', op: 'hello', context: { now: 0, dialogOpen: false, smsAutoAllowed: true } })
    await audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    sockets[0]!.open(); sockets[0]!.message({ type: 'ready' }); sockets[0]!.onclose?.({})
    frame(); audio.sendSession({ type: 'voice.session', op: 'effectResult', id: 1, value: true })
    await vi.advanceTimersByTimeAsync(1000)
    sockets[1]!.open(); sockets[1]!.message({ type: 'ready' })
    expect(sockets[1]!.sent).toHaveLength(1)
    expect(JSON.parse(String(sockets[1]!.sent[0])).op).toBe('hello')
    await audio.stopListening()
  })
  it('마이크를 켜는 동안만 "켜는 중" 표시를 기기에 남기고, 켜지거나 실패하면 지운다 (앱째 꺼짐 반복 막기)', async () => {
    const saved = new Map<string, string>()
    configureVoiceStorage({ getItem: async (k) => saved.get(k) ?? null, setItem: async (k, v) => { saved.set(k, v) }, removeItem: async (k) => { saved.delete(k) } })
    const { audio, native } = setup()
    let duringStart: boolean | undefined
    vi.mocked(native.start).mockImplementationOnce(async () => { duringStart = await audio.startWasCut() })
    await audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    expect(duringStart).toBe(true)
    expect(await audio.startWasCut()).toBe(false)
    await audio.stopListening()
    vi.mocked(native.start).mockImplementationOnce(async () => { throw new Error('장치 오류') })
    await audio.startListening({ wsUrl: 'wss://app.example/api/voice/stream' })
    expect(audio.state.kind).toBe('stopped')
    expect(await audio.startWasCut()).toBe(false)
    // 켜는 도중 앱이 꺼진 경우: 표시가 남아 있다
    saved.set('livegenie.voice.micstarting.v1', '1')
    expect(await audio.startWasCut()).toBe(true)
    configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  })
})
