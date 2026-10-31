import pcmWorkletUrl from './pcm-worklet.js?url'
// APP1: 마이크·연결만 기기에서 실행한다. 품종 사전이나 상품 추출을 불러오지 않는다.
// SRV1 (D-APP-22·25): 받아쓰기는 언제나 서버다 — PC도 마이크 소리(16kHz PCM)를 서버로 보낸다. 브라우저 음성 인식(Web Speech) 길은 없다.
// 마이크 없는 조작 전용 연결(D-APP1b-08)은 `capture=false`로 연다(크롬과 무관한 인자).
import { createLiveGenieEngine, voiceStreamUrl, canCaptureAudio } from '../../../../packages/voice/src/livegenie.ts'
import type { SpeechError, SpeechState } from '../../../../packages/voice/src/speech.ts'
import { speechError } from '../../../../packages/voice/src/speech.ts'
import type { VoiceClientMessage } from '../../../../packages/voice-session/src/wire.ts'

export interface VoiceTransportOptions {
  readonly broadcastId: string
  readonly device: string
  readonly capture?: boolean
  readonly hello: () => VoiceClientMessage
  readonly onMessage: (value: unknown) => void
  readonly onState: (state: SpeechState) => void
  readonly onError: (error: SpeechError) => void
  readonly onConnectionLost?: () => void
}


export function createVoiceTransport(options: VoiceTransportOptions) {
  let socket: WebSocket | null = null
  let captureSent = false
  let wanted = false
  let media: MediaStream | null = null
  let context: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let mute: GainNode | null = null
  let startingCapture = false
  let captureGeneration = 0
  const engine = createLiveGenieEngine({
    now: Date.now,
    isSupported: () => options.capture === false || canCaptureAudio(),
    connect: (handlers) => {
      captureSent = false
      const url = new URL(voiceStreamUrl(location.origin, options.broadcastId, options.device))
      if (options.capture === false) url.searchParams.set('capture', 'false')
      const current = new WebSocket(url)
      socket = current
      current.addEventListener('message', (event) => {
        if (current !== socket || typeof event.data !== 'string') return
        let message: unknown
        try { message = JSON.parse(event.data) } catch { return }
        options.onMessage(message)
        handlers.onMessage(event.data)
        if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'ready') {
          current.send(JSON.stringify(options.hello()))
          if (options.capture !== false) void startCapture()
        }
      })
      current.addEventListener('close', () => handlers.onClose())
      current.addEventListener('error', () => handlers.onError())
      return {
        send: (data) => { if (current.readyState !== WebSocket.OPEN) throw new Error('연결이 끊겼어요.'); current.send(data as ArrayBuffer) },
        close: () => { if (socket === current) socket = null; current.close() },
      }
    },
  })
  engine.onState((state) => {
    if (state === 'RESTARTING' || state === 'HALTED') options.onConnectionLost?.()
    if (state === 'HALTED' || state === 'OFF') wanted = false
    if (state === 'RESTARTING' || state === 'HALTED' || state === 'OFF') stopCapture()
    options.onState(state)
  })
  engine.onError(options.onError)
  engine.onClosing((reason) => { if (reason === 'ENDED' || reason === 'AUTH' || reason === 'OTHER_DEVICE') { wanted = false; stopCapture() } })

  async function startCapture(): Promise<void> {
    if (!wanted || startingCapture || media !== null) return
    startingCapture = true
    const born = captureGeneration
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
      if (!wanted || born !== captureGeneration) { for (const track of stream.getTracks()) track.stop(); return }
      media = stream
      const activeContext = new AudioContext()
      context = activeContext
      await activeContext.audioWorklet.addModule(pcmWorkletUrl)
      if (!wanted || born !== captureGeneration || context !== activeContext) return
      node = new AudioWorkletNode(activeContext, 'livegenie-pcm')
      source = activeContext.createMediaStreamSource(stream)
      mute = activeContext.createGain()
      mute.gain.value = 0
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!wanted || born !== captureGeneration || !(event.data instanceof ArrayBuffer) || !engine.isStreaming()) return
        const at = Date.now() - 100
        if (!captureSent) { captureSent = true; send({ type: 'voice.session', op: 'capture', at }) }
        engine.sendAudio(event.data, at)
      }
      source.connect(node).connect(mute).connect(activeContext.destination)
      await activeContext.resume()
    } catch (error) {
      if (!wanted || born !== captureGeneration) return
      stopCapture()
      options.onError(speechError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'PERMISSION_DENIED' : 'NO_MICROPHONE'))
      engine.stop()
    } finally { if (born === captureGeneration) startingCapture = false }
  }
  function stopCapture(): void {
    captureGeneration++
    startingCapture = false
    if (node !== null) { node.port.onmessage = null; node.disconnect(); node = null }
    source?.disconnect(); source = null
    mute?.disconnect(); mute = null
    for (const track of media?.getTracks() ?? []) track.stop()
    media = null
    const old = context; context = null
    if (old !== null) void old.close().catch(() => {})
  }
  function send(message: VoiceClientMessage): boolean {
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message)); return true
  }
  function offline(): void {
    if (!wanted) return
    stopCapture()
    options.onConnectionLost?.()
    socket?.close()
  }
  return {
    isSupported: () => engine.isSupported(),
    start(): void { wanted = true; window.addEventListener('offline', offline); engine.start() },
    stop(): void { wanted = false; window.removeEventListener('offline', offline); stopCapture(); engine.stop() },
    pauseCapture(): void { wanted = false; stopCapture() },
    send,
  }
}
