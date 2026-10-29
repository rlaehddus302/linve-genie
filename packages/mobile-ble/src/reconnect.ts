// 끊김 다시 잇기 (APP-03 "다른 앱으로 가 있어도 연결은 끊지 않는다", LABEL_RULES L-11, D-QS1-02 저절로 다시 잇기).
// 프린터 쪽에서 끊기면(절전·거리) 기억한 기기로 고르기 창 없이 1·2·4·8초(가장 길게 8초) 간격으로 다시 잇는다. 판매자가 "연결 끊기"를 누른 것은 다시 잇지 않는다.
// 라벨 대기열은 앱 몫이다 — 이 파일은 연결만 되살리고, 출력 성공·실패는 어댑터의 print 결과가 그대로 알린다.
import { printerError, systemTimer, type PrinterResult, type PrinterTimer, type RememberingPrinterAdapter } from '@livejjim/printer'

export const RECONNECT_DELAYS_MS: readonly number[] = Object.freeze([1_000, 2_000, 4_000, 8_000])

export interface ReconnectingAdapterOptions {
  readonly timer?: PrinterTimer
  readonly delaysMs?: readonly number[]
  /** 연속 실패 한도 — 넘으면 멈추고 onGiveUp. 기본 끝없이(8초마다) */
  readonly maxAttempts?: number
  readonly onGiveUp?: () => void
}

export interface ReconnectingAdapter extends RememberingPrinterAdapter {
  /** 지금 다시 잇는 중인가 */
  readonly reconnecting: boolean
  /** 이번 끊김 뒤 시도 횟수 */
  readonly attempts: number
  /** 더는 다시 잇지 않는다 (앱을 끌 때) */
  dispose(): void
}

export function createReconnectingAdapter(adapter: RememberingPrinterAdapter, options: ReconnectingAdapterOptions = {}): ReconnectingAdapter {
  const timer = options.timer ?? systemTimer
  const delays = options.delaysMs ?? RECONNECT_DELAYS_MS
  let wanted = false
  let attempts = 0
  let handle: unknown = null
  let disposed = false
  let trying = false

  const cancel = (): void => {
    if (handle === null) return
    timer.clearTimeout(handle)
    handle = null
  }

  const schedule = (): void => {
    if (!wanted || disposed || handle !== null || trying) return
    if (options.maxAttempts !== undefined && attempts >= options.maxAttempts) {
      wanted = false
      options.onGiveUp?.()
      return
    }
    const delay = delays[Math.min(attempts, delays.length - 1)] ?? 8_000
    handle = timer.setTimeout(() => {
      handle = null
      void attempt()
    }, delay)
  }

  const attempt = async (): Promise<void> => {
    if (!wanted || disposed) return
    attempts++
    trying = true
    let result: PrinterResult
    try {
      result = await adapter.connectRemembered()
    } catch (error) {
      result = { ok: false, error: printerError('CONNECT_FAILED', error) }
    } finally {
      trying = false
    }
    if (!wanted || disposed) return
    if (result.ok || adapter.state === 'CONNECTED' || adapter.state === 'PRINTING') {
      attempts = 0
      return
    }
    schedule()
  }

  const unlisten = adapter.onStateChange((state) => {
    if (state === 'CONNECTED' || state === 'PRINTING') {
      attempts = 0
      cancel()
      return
    }
    if (state === 'DISCONNECTED' && wanted && adapter.hasRemembered) schedule()
  })

  const wrapped: ReconnectingAdapter = {
    get profile() {
      return adapter.profile
    },
    get state() {
      return adapter.state
    },
    get hasRemembered() {
      return adapter.hasRemembered
    },
    get remembered() {
      return adapter.remembered
    },
    get reconnecting() {
      return wanted && (handle !== null || trying)
    },
    get attempts() {
      return attempts
    },
    onStateChange: (listener) => adapter.onStateChange(listener),
    onRememberedChange: (listener) => adapter.onRememberedChange(listener),
    availableMethods: () => adapter.availableMethods(),
    restoreRemembered: (value) => adapter.restoreRemembered(value),
    async connect(method) {
      const result = await adapter.connect(method)
      if (result.ok) {
        wanted = true
        attempts = 0
      }
      return result
    },
    async reconnect(method) {
      const result = await adapter.reconnect(method)
      if (result.ok) {
        wanted = true
        attempts = 0
      }
      return result
    },
    async connectRemembered() {
      const result = await adapter.connectRemembered()
      if (result.ok) {
        wanted = true
        attempts = 0
      }
      return result
    },
    async disconnect() {
      // 판매자가 끊었다 — 다시 잇지 않는다
      wanted = false
      attempts = 0
      cancel()
      await adapter.disconnect()
    },
    print: (image, printOptions) => adapter.print(image, printOptions),
    dispose() {
      disposed = true
      wanted = false
      cancel()
      unlisten()
    },
  }
  return wrapped
}
