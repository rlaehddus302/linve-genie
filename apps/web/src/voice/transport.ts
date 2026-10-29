import { PCM_WORKLET_SOURCE } from './pcm-worklet.ts'
// APP1: 마이크·연결만 기기에서 실행한다. 품종 사전이나 상품 추출을 불러오지 않는다.
import { createLiveGenieEngine, voiceStreamUrl, canCaptureAudio } from '../../../../packages/voice/src/livegenie.ts'
import { createWebSpeechEngine, formatSpeechDiagnostic, formatSpeechGap, type SpeechGap, type SpeechDiagnostic, type OnDeviceStatus } from '../../../../packages/voice/src/web-speech.ts'
import type { SpeechError, SpeechState } from '../../../../packages/voice/src/speech.ts'
import { speechError } from '../../../../packages/voice/src/speech.ts'
import { isHomeScreenApp } from './standalone.ts'
import type { VoiceClientMessage } from '../../../../packages/voice-session/src/wire.ts'

export interface VoiceTransportOptions {
  readonly broadcastId: string
  readonly device: string
  readonly chrome: boolean
  readonly capture?: boolean
  readonly hello: () => VoiceClientMessage
  readonly onMessage: (value: unknown) => void
  readonly onState: (state: SpeechState) => void
  readonly onError: (error: SpeechError) => void
  readonly onGap?: (gap: SpeechGap, text: string) => void
  readonly onDiagnostic?: (diagnostic: SpeechDiagnostic, text: string) => void
  readonly onDeviceStatus?: (status: OnDeviceStatus) => void
  readonly stallMs?: number
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
  let chromeEngine: ReturnType<typeof createWebSpeechEngine> | null = null
  let startingCapture = false
  const engine = createLiveGenieEngine({
    now: Date.now,
    isSupported: () => options.capture === false || (options.chrome ? createWebSpeechEngine({ now: Date.now }).isSupported() : canCaptureAudio()),
    connect: (handlers) => {
      captureSent = false
      const url = new URL(voiceStreamUrl(location.origin, options.broadcastId, options.device))
      if (options.chrome || options.capture === false) url.searchParams.set('mode', 'chrome')
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
  engine.onState((state) => { if (state === 'HALTED' || state === 'OFF') stopCapture(); options.onState(state) })
  engine.onError(options.onError)
  engine.onClosing((reason) => { if (reason === 'ENDED' || reason === 'AUTH' || reason === 'OTHER_DEVICE') stopCapture() })

  async function startCapture(): Promise<void> {
    if (!wanted || startingCapture || media !== null || chromeEngine !== null) return
    if (options.chrome) {
      chromeEngine = createWebSpeechEngine({ now: Date.now, countAllEnds: isHomeScreenApp(), ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }) })
      chromeEngine.onResult((result) => {
        send({ type: 'voice.session', op: 'chromeResult', result: { text: result.text, final: result.final, ...(result.slot === undefined ? {} : { slot: result.slot }), ...(result.lead === undefined ? {} : { lead: result.lead }), ...(result.flushedAtEnd === undefined ? {} : { flushedAtEnd: result.flushedAtEnd }) } })
      })
      chromeEngine.onError(options.onError)
      chromeEngine.onState(options.onState)
      chromeEngine.onGap((gap) => options.onGap?.(gap, formatSpeechGap(gap)))
      chromeEngine.onDiagnostic((diagnostic) => options.onDiagnostic?.(diagnostic, formatSpeechDiagnostic(diagnostic)))
      void chromeEngine.onDeviceStatus().then((status) => options.onDeviceStatus?.(status))
      chromeEngine.start()
      return
    }
    startingCapture = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
      if (!wanted) { for (const track of stream.getTracks()) track.stop(); return }
      media = stream
      context = new AudioContext()
      const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'text/javascript' }))
      try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
      if (!wanted || context === null) return
      node = new AudioWorkletNode(context, 'livegenie-pcm')
      source = context.createMediaStreamSource(stream)
      mute = context.createGain()
      mute.gain.value = 0
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!wanted || !(event.data instanceof ArrayBuffer) || !engine.isStreaming()) return
        const at = Date.now() - 100
        if (!captureSent) { captureSent = true; send({ type: 'voice.session', op: 'capture', at }) }
        engine.sendAudio(event.data, at)
      }
      source.connect(node).connect(mute).connect(context.destination)
      await context.resume()
    } catch (error) {
      stopCapture()
      options.onError(speechError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'PERMISSION_DENIED' : 'NO_MICROPHONE'))
      engine.stop()
    } finally { startingCapture = false }
  }
  function stopCapture(): void {
    chromeEngine?.stop(); chromeEngine = null
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
  return {
    isSupported: () => engine.isSupported(),
    start(): void { wanted = true; engine.start() },
    stop(): void { wanted = false; stopCapture(); engine.stop() },
    pauseCapture: stopCapture,
    send,
  }
}
