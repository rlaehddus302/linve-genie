// 마이크 소리 잡기 (APP-02) — 네이티브 모듈 위의 얇은 JS. 네이티브는 넣어 받는다(시험은 가짜).
// - start(): 권한 확인 → 없으면 요청 → 거절이면 HALTED(PERMISSION_DENIED), 허락이면 네이티브 start. 표본률은 16,000만(D-APP-06).
// - 틀: 네이티브 사건(pcm base64 또는 바이트, capturedAtMs) → ArrayBuffer로 정규화. 빈 틀·홀수 바이트는 버린다. 소리는 어디에도 저장·기록하지 않는다(D-APP-03).
// - 상태: 네이티브 상태 사건을 그대로 비춘다. 끼어들기(전화)·마이크 뺏김 뒤의 다시 잡기는 네이티브가 하고 LISTENING으로 돌아온다.
// - stop(): 네이티브 마이크·알림을 바로 멈춘다(APP-02 AC2). 멈춘 뒤 늦게 온 틀·상태는 무시한다.
import { decodeBase64 } from './base64.ts'
import { LISTENING_NOTIFICATION_TEXT, LISTENING_NOTIFICATION_TITLE } from './messages.ts'
import {
  AUDIO_FRAME_MS,
  AUDIO_HALT_REASONS,
  AUDIO_SAMPLE_RATE,
  type AudioCapture,
  type AudioCaptureState,
  type AudioHaltReason,
  type AudioPermission,
  type FrameListener,
  type NativeAudioModuleLike,
  type NativeEventSubscription,
  type NativeFrameEvent,
  type NativeStateEvent,
  type StartOptions,
  type StateListener,
} from './types.ts'

/** 네이티브가 거절한 까닭(예외의 code 또는 message) → 멈춘 까닭 */
export function haltReasonOf(error: unknown): AudioHaltReason {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  const text = `${code} ${message}`
  if (/PERMISSION|DENIED|NotAllowed/i.test(text)) return 'PERMISSION_DENIED'
  if (/NO_MIC|NotFound|no input|unavailable/i.test(text)) return 'NO_MICROPHONE'
  if (/UNSUPPORTED|not supported/i.test(text)) return 'UNSUPPORTED'
  return 'DEVICE_ERROR'
}

const asHaltReason = (reason: unknown): AudioHaltReason => AUDIO_HALT_REASONS.find((r) => r === reason) ?? 'DEVICE_ERROR'

/** 네이티브 틀 사건의 pcm → ArrayBuffer (틀린 것은 null) */
export function frameBytesOf(event: NativeFrameEvent): ArrayBuffer | null {
  const pcm = event.pcm
  let bytes: Uint8Array | null
  if (typeof pcm === 'string') bytes = decodeBase64(pcm)
  else if (pcm instanceof ArrayBuffer) bytes = new Uint8Array(pcm)
  else if (ArrayBuffer.isView(pcm)) bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  else bytes = null
  if (bytes === null || bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) return null
  // 늘 새 ArrayBuffer로 — 듣는 쪽이 붙들어도 네이티브 버퍼와 얽히지 않는다
  return bytes.slice().buffer
}

class Listeners<T extends (...args: never[]) => void> {
  private readonly set = new Set<T>()
  add(listener: T): () => void {
    this.set.add(listener)
    return () => {
      this.set.delete(listener)
    }
  }
  emit(...args: Parameters<T>): void {
    for (const listener of [...this.set]) {
      try {
        listener(...args)
      } catch {
        // 듣는 쪽의 예외가 다른 듣는 쪽·상태를 깨뜨리지 않게
      }
    }
  }
  get size(): number {
    return this.set.size
  }
}

export function createAudioCapture(native: NativeAudioModuleLike): AudioCapture {
  if (typeof native?.start !== 'function' || typeof native.addListener !== 'function') throw new TypeError('네이티브 마이크 모듈이 필요하다')
  const frames = new Listeners<FrameListener>()
  const states = new Listeners<StateListener>()
  let state: AudioCaptureState = 'OFF'
  let haltReason: AudioHaltReason | undefined
  let frameSub: NativeEventSubscription | null = null
  let stateSub: NativeEventSubscription | null = null
  /** start마다 늘어난다 — 지난 켜기의 늦은 알림은 무시 */
  let session = 0
  let starting: Promise<void> | null = null

  const setState = (next: AudioCaptureState, reason?: AudioHaltReason): void => {
    haltReason = next === 'HALTED' ? (reason ?? 'DEVICE_ERROR') : undefined
    if (next === state && next !== 'HALTED') return
    state = next
    states.emit(next, haltReason)
  }

  const onFrame = (event: NativeFrameEvent): void => {
    if (state !== 'LISTENING' && state !== 'STARTING') return
    const pcm = frameBytesOf(event)
    if (pcm === null) return
    const at = typeof event.capturedAtMs === 'number' && Number.isFinite(event.capturedAtMs) ? event.capturedAtMs : Number.NaN
    // 틀이 오고 있으면 듣는 중이다 (네이티브 상태 사건이 늦어도)
    if (state === 'STARTING') setState('LISTENING')
    frames.emit(pcm, at)
  }

  const onNativeState = (event: NativeStateEvent): void => {
    if (state === 'OFF') return
    switch (event.state) {
      case 'LISTENING':
        setState('LISTENING')
        return
      case 'INTERRUPTED':
        setState('INTERRUPTED')
        return
      case 'HALTED':
        setState('HALTED', asHaltReason(event.reason))
        return
      case 'OFF':
        // 네이티브가 스스로 끝냈다(OS가 서비스를 거둠 등) — 켜진 채로 두지 않는다
        setState('HALTED', 'DEVICE_ERROR')
        return
      default:
        return
    }
  }

  const listen = (): void => {
    frameSub ??= native.addListener('frame', onFrame)
    stateSub ??= native.addListener('state', onNativeState)
  }
  const unlisten = (): void => {
    frameSub?.remove()
    stateSub?.remove()
    frameSub = null
    stateSub = null
  }

  const startOnce = async (options: StartOptions): Promise<void> => {
    const mine = ++session
    setState('STARTING')
    let permission: AudioPermission
    try {
      permission = await native.getPermission()
      if (!permission.granted && permission.status !== 'denied') permission = await native.requestPermission()
      else if (!permission.granted && permission.canAskAgain) permission = await native.requestPermission()
    } catch (error) {
      if (mine !== session) return
      setState('HALTED', haltReasonOf(error))
      return
    }
    if (mine !== session) return
    if (!permission.granted) {
      setState('HALTED', 'PERMISSION_DENIED')
      return
    }
    listen()
    try {
      await native.start({
        sampleRate: options.sampleRate,
        frameMs: AUDIO_FRAME_MS,
        notificationTitle: LISTENING_NOTIFICATION_TITLE,
        notificationText: LISTENING_NOTIFICATION_TEXT,
      })
    } catch (error) {
      if (mine !== session) return
      unlisten()
      setState('HALTED', haltReasonOf(error))
      return
    }
    if (mine !== session) return
    if (state === 'STARTING') setState('LISTENING')
  }

  return {
    start(options) {
      if (options?.sampleRate !== AUDIO_SAMPLE_RATE) throw new TypeError(`표본률은 ${AUDIO_SAMPLE_RATE}만 받는다(D-APP-06)`)
      if (state === 'LISTENING' || state === 'INTERRUPTED') return Promise.resolve()
      if (starting !== null) return starting
      starting = startOnce(options).finally(() => {
        starting = null
      })
      return starting
    },
    async stop() {
      session++
      unlisten()
      const wasOn = state !== 'OFF'
      setState('OFF')
      if (!wasOn) return
      try {
        await native.stop()
      } catch {
        // 이미 멈춘 네이티브 — 무시
      }
    },
    getState: () => state,
    getHaltReason: () => haltReason,
    getPermission: () => native.getPermission(),
    requestPermission: () => native.requestPermission(),
    addFrameListener: (listener) => frames.add(listener),
    addStateListener: (listener) => states.add(listener),
  }
}
