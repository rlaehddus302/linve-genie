// 소리 올리기 (APP-02, D-APP-19 (나) 방식): 네이티브 틀 → 음성 엔진.sendAudio(틀, 잡은 시각). 웹의 AudioWorklet → 엔진과 같은 자리.
// 엔진은 packages/voice의 LiveGenieSpeechEngine(웹소켓·ready·다시 잇기·늦은 글 셈)을 그대로 쓴다 — 여기서는 구조 모양(AudioSink)으로만 받는다.
// 엔진이 ready 전·끊긴 동안이면 sendAudio가 거짓을 돌려주고 틀은 버려진다(D-APP-05 "끊긴 동안의 소리는 버린다").
// 소리 틀은 어디에도 저장·기록하지 않는다(D-APP-03). 센 것은 수(틀 수·버린 수)뿐이다.
import type { AudioCapture, AudioCaptureState, AudioHaltReason } from '../types.ts'

/** 음성 엔진에서 이 파일이 쓰는 부분 (LiveGenieSpeechEngine과 맞는다) */
export interface AudioSink {
  /** 보냈으면 참, 버렸으면 거짓 */
  sendAudio(chunk: ArrayBuffer | ArrayBufferView, capturedAt?: number): boolean
}

export interface UplinkCounters {
  /** 네이티브에서 받은 틀 수 */
  readonly received: number
  /** 엔진이 보낸 틀 수 */
  readonly sent: number
  /** 엔진이 버린 틀 수 (ready 전·다시 잇는 중) */
  readonly dropped: number
}

export interface AudioUplink {
  /** 마이크를 켜고 틀을 엔진으로 흘린다. 엔진 start()는 부르는 쪽이 한다(켜는 차례: 엔진 → 마이크 또는 반대, 상관없다) */
  start(): Promise<void>
  /** 마이크를 멈추고 틀 흘리기를 끊는다. 엔진 stop()은 부르는 쪽이 한다 */
  stop(): Promise<void>
  getCounters(): UplinkCounters
  /** 마이크 상태 (AudioCapture 그대로) */
  getCaptureState(): AudioCaptureState
  onCaptureState(listener: (state: AudioCaptureState, reason?: AudioHaltReason) => void): () => void
}

export interface UplinkOptions {
  readonly capture: AudioCapture
  readonly engine: AudioSink
}

export function createAudioUplink(options: UplinkOptions): AudioUplink {
  const { capture, engine } = options
  if (typeof engine?.sendAudio !== 'function') throw new TypeError('음성 엔진(sendAudio)이 필요하다')
  let received = 0
  let sent = 0
  let dropped = 0
  let unsubscribe: (() => void) | null = null

  const onFrame = (pcm: ArrayBuffer, capturedAtMs: number): void => {
    received++
    let ok: boolean
    try {
      ok = engine.sendAudio(pcm, Number.isFinite(capturedAtMs) ? capturedAtMs : undefined)
    } catch {
      ok = false
    }
    if (ok) sent++
    else dropped++
  }

  return {
    async start() {
      unsubscribe ??= capture.addFrameListener(onFrame)
      await capture.start({ sampleRate: 16_000 })
    },
    async stop() {
      unsubscribe?.()
      unsubscribe = null
      await capture.stop()
    },
    getCounters: () => ({ received, sent, dropped }),
    getCaptureState: () => capture.getState(),
    onCaptureState: (listener) => capture.addStateListener(listener),
  }
}
