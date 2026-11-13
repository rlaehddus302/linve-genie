// 끊김 다시 잇기 (APP-03 "다른 앱으로 가 있어도 연결은 끊지 않는다", LABEL_RULES L-11 8, D-QS1-02 저절로 다시 잇기).
// 프린터 쪽에서 끊기면(절전·거리) 기억한 기기로 고르기 창 없이 다시 잇는다. 판매자가 "연결 끊기"를 누른 것은 다시 잇지 않는다.
// - 간격·횟수·새로 세기는 옵션이다. 기본은 1·2·4·8초(가장 길게 8초, 끝없이). 앱은 L-11 8 그대로인 AUTO_RECONNECT_POLICY를 쓴다:
//   첫 시도는 끊긴 때부터·그 뒤는 앞 시도가 끝난 때부터 1·2·4·8·16·30초, 모두 6번, 다시 이어진 뒤 60초 동안 끊기지 않아야 횟수를 새로 센다.
// - 시도끼리 겹치지 않는다. 판매자가 잇기(connect·reconnect)를 부르면 기다림을 그치고 그것 하나만 — 이어지면 그 연결부터 새로 세고,
//   실패하면 저절로 잇기도 그친다(D-QS1-02 (4) — 판매자가 누른 결과라 오류로 끝난다).
// - setAllowed(false)(출력 기기에서 내려옴·라벨 기능 끔 — L-11 8)면 그친다. 다시 켜져도 지난 끊김으로는 시작하지 않는다(다음 끊김부터).
// - setKeepTrying(true)(방송 중 — 출력 기기이고 방송이 열려 있다, F2 D-RETRO-42)면 한도(6번)를 넘겨도 그치지 않고 마지막 간격(30초)으로 계속 잇는다.
//   화면 상태의 total은 null("n번째"). false로 돌아오면 한도를 넘긴 기다림은 그 자리에서 그친다. 그친 뒤 true가 되면 30초 간격으로 다시 잇는다.
// 라벨 대기열은 앱 몫이다 — 이 파일은 연결만 되살리고, 출력 성공·실패는 어댑터의 print 결과가 그대로 알린다.
import { printerError, systemTimer, type ConnectionState, type PrinterResult, type PrinterTimer, type RememberingPrinterAdapter } from '@livejjim/printer'

export const RECONNECT_DELAYS_MS: readonly number[] = Object.freeze([1_000, 2_000, 4_000, 8_000])

/** LABEL_RULES L-11 8·D-QS1-02 그대로의 저절로 다시 잇기 (웹 printer-station과 같은 값) */
export const AUTO_RECONNECT_POLICY = Object.freeze({
  delaysMs: Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) as readonly number[],
  maxAttempts: 6,
  stableMs: 60_000,
})

/** 저절로 다시 잇기 화면 상태: 없음 · n번째 시도(기다리거나 하는 중) · 그침(다 실패) */
export type AutoReconnectState = null | { readonly kind: 'trying'; readonly attempt: number; readonly total: number | null } | { readonly kind: 'gaveUp' }

export interface ReconnectingAdapterOptions {
  readonly timer?: PrinterTimer
  readonly delaysMs?: readonly number[]
  /** 연속 실패 한도 — 넘으면 멈추고 onGiveUp. 기본 끝없이(8초마다) */
  readonly maxAttempts?: number
  readonly onGiveUp?: () => void
  /** 다시 이어진 뒤 이만큼 끊기지 않아야 횟수를 새로 센다 (기본 0 — 이어지면 바로) */
  readonly stableMs?: number
}

export interface ReconnectingAdapter extends RememberingPrinterAdapter {
  /** 지금 다시 잇는 중인가 */
  readonly reconnecting: boolean
  /** 이번 끊김 뒤 시도 횟수 */
  readonly attempts: number
  /** 화면에 보일 저절로 다시 잇기 상태 (허락되지 않으면 늘 null) */
  readonly autoState: AutoReconnectState
  /** autoState가 바뀔 때마다 */
  onAutoChange(listener: (state: AutoReconnectState) => void): () => void
  /** 저절로 다시 이어도 되는지 (기본 true). false면 기다리던 시도를 그친다 */
  setAllowed(allowed: boolean): void
  /**
   * 한도를 넘겨도 계속 이을지 (기본 false — 한도에서 그친다). true면 한도 뒤에도 마지막 간격으로 끝없이 잇고(방송 중, F2),
   * 한도에 걸려 그쳐 있었으면 다시 잇기 시작한다. false로 돌아오면 한도를 넘긴 기다림은 그친다
   */
  setKeepTrying(keep: boolean): void
  /** 더는 다시 잇지 않는다 (앱을 끌 때) */
  dispose(): void
}

const linked = (state: ConnectionState): boolean => state === 'CONNECTED' || state === 'PRINTING'

export function createReconnectingAdapter(adapter: RememberingPrinterAdapter, options: ReconnectingAdapterOptions = {}): ReconnectingAdapter {
  const timer = options.timer ?? systemTimer
  const delays = options.delaysMs ?? RECONNECT_DELAYS_MS
  const stableMs = options.stableMs ?? 0
  const total = options.maxAttempts ?? null
  let wanted = false
  let allowed = true
  let attempts = 0
  let handle: unknown = null
  let stableHandle: unknown = null
  let disposed = false
  let trying = false
  let gaveUp = false
  /** 한도를 넘겨도 계속 잇는다 (방송 중 — F2) */
  let keep = false
  /** 판매자 동작·그침마다 는다 — 그 전에 시작한 시도의 뒤처리는 하지 않는다 */
  let series = 0
  let last: ConnectionState = adapter.state
  const autoListeners = new Set<(state: AutoReconnectState) => void>()
  let shown: AutoReconnectState = null

  const autoState = (): AutoReconnectState => {
    if (!allowed || disposed) return null
    if (gaveUp) return { kind: 'gaveUp' }
    if (wanted && (handle !== null || trying)) return { kind: 'trying', attempt: trying ? attempts : attempts + 1, total: keep ? null : total }
    return null
  }

  const emit = (): void => {
    const next = autoState()
    const same =
      next === shown ||
      (next !== null && shown !== null && next.kind === shown.kind && (next.kind === 'gaveUp' || (shown.kind === 'trying' && next.attempt === shown.attempt && next.total === shown.total)))
    if (same) return
    shown = next
    for (const listener of [...autoListeners]) listener(next)
  }

  const cancel = (): void => {
    if (handle === null) return
    timer.clearTimeout(handle)
    handle = null
  }

  const clearStable = (): void => {
    if (stableHandle === null) return
    timer.clearTimeout(stableHandle)
    stableHandle = null
  }

  /** 기다림을 그치고, 하는 중인 시도의 뒤처리를 버린다 */
  const stopSeries = (): void => {
    series++
    cancel()
  }

  const schedule = (): void => {
    if (!wanted || !allowed || disposed || handle !== null || trying) return
    if (total !== null && attempts >= total && !keep) {
      wanted = false
      gaveUp = true
      emit()
      options.onGiveUp?.()
      return
    }
    const delay = delays[Math.min(attempts, delays.length - 1)] ?? 8_000
    const mine = series
    handle = timer.setTimeout(() => {
      handle = null
      if (mine === series) void attempt(mine)
    }, delay)
    emit()
  }

  const attempt = async (mine: number): Promise<void> => {
    if (!wanted || !allowed || disposed) {
      emit()
      return
    }
    attempts++
    trying = true
    emit()
    let result: PrinterResult
    try {
      result = await adapter.connectRemembered()
    } catch (error) {
      result = { ok: false, error: printerError('CONNECT_FAILED', error) }
    } finally {
      trying = false
    }
    if (mine !== series || !wanted || disposed) {
      emit()
      return
    }
    if (result.ok || linked(adapter.state)) {
      if (stableMs <= 0) attempts = 0
      emit()
      return
    }
    schedule()
    emit()
  }

  const unlisten = adapter.onStateChange((state) => {
    const previous = last
    last = state
    if (linked(state)) {
      cancel()
      gaveUp = false
      if (stableMs <= 0) attempts = 0
      else if (!linked(previous) && attempts > 0 && stableHandle === null) {
        // 저절로 다시 이어졌다 — 60초 동안 끊기지 않으면 횟수를 새로 센다 (출력 한 장마다의 PRINTING → CONNECTED로는 다시 걸지 않는다)
        stableHandle = timer.setTimeout(() => {
          stableHandle = null
          attempts = 0
        }, stableMs)
      }
      emit()
      return
    }
    if (state === 'DISCONNECTED' && linked(previous)) {
      clearStable()
      if (wanted && adapter.hasRemembered) schedule()
    }
    emit()
  })

  /** 판매자 동작: 기다림을 그치고 이것 하나 — 이어지면 새로 세고, 실패하면 저절로 잇기도 그친다 */
  const manual = async (run: () => Promise<PrinterResult>): Promise<PrinterResult> => {
    stopSeries()
    gaveUp = false
    emit()
    const result = await run()
    if (result.ok) {
      wanted = true
      attempts = 0
      clearStable()
    } else {
      wanted = false
      attempts = 0
    }
    emit()
    return result
  }

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
    get autoState() {
      return autoState()
    },
    onAutoChange(listener) {
      autoListeners.add(listener)
      return () => {
        autoListeners.delete(listener)
      }
    },
    onStateChange: (listener) => adapter.onStateChange(listener),
    onRememberedChange: (listener) => adapter.onRememberedChange(listener),
    availableMethods: () => adapter.availableMethods(),
    restoreRemembered: (value) => adapter.restoreRemembered(value),
    connect: (method) => manual(() => adapter.connect(method)),
    reconnect: (method) => manual(() => adapter.reconnect(method)),
    async connectRemembered() {
      const result = await adapter.connectRemembered()
      if (result.ok) {
        wanted = true
        attempts = 0
        emit()
      }
      return result
    },
    async disconnect() {
      // 판매자가 끊었다 — 다시 잇지 않는다
      wanted = false
      attempts = 0
      gaveUp = false
      stopSeries()
      clearStable()
      emit()
      await adapter.disconnect()
    },
    print: (image, printOptions) => adapter.print(image, printOptions),
    setAllowed(next) {
      if (allowed === next) return
      allowed = next
      if (!next) {
        // 출력 기기에서 내려옴·라벨 기능 끔 — 그친다 (L-11 8)
        stopSeries()
        gaveUp = false
      }
      emit()
    },
    setKeepTrying(next) {
      if (keep === next) return
      keep = next
      if (next) {
        // 한도에 걸려 그쳐 있었다 — 방송이 열렸으니 다시 잇는다 (판매자가 끊었거나 손으로 이은 것이 실패해 그친 것은 gaveUp이 아니다)
        if (gaveUp && allowed && !disposed && !linked(adapter.state) && adapter.hasRemembered) {
          gaveUp = false
          wanted = true
          schedule()
        }
      } else if (wanted && handle !== null && total !== null && attempts >= total) {
        // 한도를 넘겨 기다리던 중 — 방송이 끝났으니 그 자리에서 그친다 (하는 중인 시도는 끝난 뒤 schedule이 그친다)
        cancel()
        schedule()
      }
      emit()
    },
    dispose() {
      disposed = true
      wanted = false
      stopSeries()
      clearStable()
      unlisten()
      emit()
    },
  }
  return wrapped
}
