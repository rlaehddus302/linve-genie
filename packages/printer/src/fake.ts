// 가짜 프린터 (LABEL_RULES L-7 가짜 프린터, AC-P1-44) — 같은 어댑터 계약을 지키고, 받은 그림을 받은 순서대로 복사해 기록한다.
// 몇 번째 출력에서 끊김·프린터 오류·지연을 낼지 미리 정할 수 있다. 시각·난수를 쓰지 않는다(지연은 주입한 타이머).
// 시험과 개발에 쓴다. 리허설 방송은 가짜 프린터로도 출력하지 않는다(D-081 — 거르는 일은 I1).
import { copyBitmap, isLabelBitmap, type LabelBitmap } from '@livejjim/label'
import {
  B1_PROFILE,
  DEFAULT_PRINT_TIMEOUT_MS,
  RememberBox,
  StateBox,
  sameRememberedPrinter,
  systemTimer,
  type ConnectionMethod,
  type ConnectionState,
  type ModelProfile,
  type PrintOptions,
  type PrinterProfile,
  type PrinterTimer,
  type RememberedPrinter,
  type RememberingPrinterAdapter,
} from './adapter.ts'
import { OK, densityMessage, fail, printerErrorWithMessage, type PrinterErrorCode, type PrinterResult } from './errors.ts'
import { FAKE_B1_USB_PRODUCT_ID, FAKE_B1_USB_VENDOR_ID } from './fake-serial.ts'

/** 시험용 프린터를 기억할 때의 값 (블루투스 기기 ID) */
export const FAKE_PRINTER_DEVICE_ID = 'fake-printer'

/** 시험용 프린터의 연결 방법마다의 기억 값 */
export function fakePrinterRemembered(method: ConnectionMethod): RememberedPrinter {
  return method === 'bluetooth'
    ? { method: 'bluetooth', deviceId: FAKE_PRINTER_DEVICE_ID }
    : { method: 'serial', usbVendorId: FAKE_B1_USB_VENDOR_ID, usbProductId: FAKE_B1_USB_PRODUCT_ID }
}

/** n번째 출력에서 낼 일: 끊김 · 프린터 오류(PRINT_FAILED) · 지연(그 뒤 성공, 시간 초과보다 길면 TIMEOUT) */
export type FakePrintBehavior = 'disconnect' | 'fail' | { readonly delayMs: number }

export interface FakePrintRecord {
  /** 받은 그림의 복사본 (받은 뒤 원본을 바꿔도 그대로) */
  readonly image: LabelBitmap
  /** 보낸 농도 (농도가 없는 프로필은 0 — 쓰지 않음) */
  readonly density: number
}

export interface FakePrinterOptions {
  /** 이 환경에서 쓸 수 있다고 할 연결 방법 (기본: 블루투스) */
  readonly methods?: readonly ConnectionMethod[]
  /** 출력 횟수(1부터, 출력을 부른 순서)마다 낼 일 */
  readonly script?: Readonly<Record<number, FakePrintBehavior>>
  /** 연결하면 낼 오류 (없으면 연결 성공) */
  readonly connectError?: PrinterErrorCode
  /**
   * 흉내 낼 프로필 (기본 B1). 켠 프로필 표의 어느 줄이든 된다(printerProfile('BAUATO_PPA2L') 등 — PRN2 실험 표시·크기 목록 시험용).
   * 농도가 없는 프로필(L-12 테이프·바우아토)은 농도를 받아도 쓰지 않는다. 돌림이 있으면(CW90·left) 받은 그림의 높이를 헤드와 견준다
   */
  readonly profile?: PrinterProfile | ModelProfile
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
}

export interface FakePrinter extends RememberingPrinterAdapter {
  /** 끝까지 출력한 그림들 (받은 순서) */
  readonly printed: readonly FakePrintRecord[]
  /** print를 부른 횟수 (거절 포함하지 않음 — 보내기 시작한 출력만 센다) */
  readonly printCalls: number
  /** 연결 시도 수 (고르기 창 길·기억한 기기 길 모두 — 시도하지 않고 끝난 것은 세지 않는다) */
  readonly connectAttempts: number
  /** 고르기 창을 거친 연결 시도 수 (B1의 requestDevice 횟수에 해당) */
  readonly pickerCount: number
  /** 기억한 기기로 이은 시도 수 (고르기 창 없음) */
  readonly rememberedAttempts: number
  /** 지금 연결이 끊긴 것처럼 한다 (출력 중이면 그 출력은 DISCONNECTED) */
  simulateDisconnect(): void
  /** n번째 출력에서 낼 일을 정한다 */
  setBehavior(n: number, behavior: FakePrintBehavior | undefined): void
  /** 다음 연결 시도에서 낼 오류 (undefined면 성공) */
  setConnectError(code: PrinterErrorCode | undefined): void
}

export function createFakePrinter(options: FakePrinterOptions = {}): FakePrinter {
  const profile = options.profile ?? B1_PROFILE
  const methods = [...(options.methods ?? ['bluetooth'])]
  const script = new Map<number, FakePrintBehavior>(Object.entries(options.script ?? {}).map(([k, v]) => [Number(k), v]))
  const timer = options.timer ?? systemTimer
  const timeoutMs = options.printTimeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS
  let connectError = options.connectError
  const box = new StateBox()
  const printed: FakePrintRecord[] = []
  let calls = 0
  let interrupt: (() => void) | undefined
  /** 끊길 때마다 늘린다 — 출력 결과가 정해진 뒤 끊겼는지(B1 어댑터의 `client !== current`와 같은 판단) */
  let session = 0
  /** 판매자가 연결 끊기를 누를 때마다 늘린다 — 그 전에 시작한 연결은 붙지 않는다 (B1 어댑터의 generation과 같다) */
  let generation = 0
  let connecting: Promise<PrinterResult> | undefined
  let connectAttempts = 0
  let pickerCount = 0
  let rememberedAttempts = 0
  /** 마지막으로 연결에 성공한 연결 방법 (D-QS1-01) */
  const memory = new RememberBox<ConnectionMethod>()

  const disconnectNow = (): void => {
    session++
    interrupt?.()
    box.set('DISCONNECTED')
  }

  /** 기억한 기기를 지금 얻을 수 있는지 — 페이지 안의 기억이거나, 되살린 값이 이 시험용 프린터의 값일 때 */
  const rememberedFor = (method: ConnectionMethod): boolean => {
    if (memory.methodOf !== method) return false
    if (memory.object !== undefined) return true
    return sameRememberedPrinter(memory.value, fakePrinterRemembered(method))
  }

  /**
   * 연결 시도 하나 (시도하지 않고 끝나는 경우는 start가 먼저 거른다). 기다림은 한 번뿐이다 — 지금까지의 시험용 프린터와 같은 때에
   * 연결된다(출력 기기 시험들이 이 때에 기대고 있다)
   */
  const connectOnce = async (method: ConnectionMethod, usingMemory: boolean, mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    const started = generation
    box.set('CONNECTING')
    connectAttempts++
    if (usingMemory) rememberedAttempts++
    else pickerCount++
    await Promise.resolve()
    connecting = undefined
    if (generation !== started) return fail('DISCONNECTED')
    if (connectError) {
      box.set('DISCONNECTED')
      // "다시 연결"로 기억한 기기에 이은 시도가 실패하면 기억을 지운다 (D-QS1-01 (4))
      if (usingMemory && mode === 'prefer') memory.forget()
      return fail(connectError)
    }
    memory.remember(method, method, fakePrinterRemembered(method))
    box.set('CONNECTED')
    return OK
  }

  /** 연결 중에 또 부르면 같은 연결을 기다린다 (세 길 모두 — 시도는 하나) */
  const start = (method: ConnectionMethod, mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    if (box.state === 'CONNECTED' || box.state === 'PRINTING') return Promise.resolve(OK)
    if (connecting) return connecting
    if (!methods.includes(method)) return Promise.resolve(fail('UNSUPPORTED'))
    const usingMemory = mode !== 'pick' && rememberedFor(method)
    // 기억한 기기로만 잇기 — 얻을 수 없으면 시도하지 않는다(기억은 그대로)
    if (mode === 'only' && !usingMemory) return Promise.resolve(fail('DISCONNECTED'))
    const attempt = connectOnce(method, usingMemory, mode)
    connecting = attempt
    return attempt
  }

  return {
    get profile() {
      return profile
    },
    get state(): ConnectionState {
      return box.state
    },
    get printed() {
      return printed
    },
    get printCalls() {
      return calls
    },
    get connectAttempts() {
      return connectAttempts
    },
    get pickerCount() {
      return pickerCount
    },
    get rememberedAttempts() {
      return rememberedAttempts
    },
    get hasRemembered() {
      return memory.has
    },
    get remembered() {
      return memory.value
    },
    onStateChange: (listener) => box.listen(listener),
    onRememberedChange: (listener) => memory.listen(listener),
    availableMethods: () => [...methods],

    restoreRemembered(value) {
      memory.restore(value)
    },

    connect: (method) => start(method, 'pick'),

    reconnect: (method) => start(method, 'prefer'),

    connectRemembered() {
      if (connecting) return connecting
      const method = memory.methodOf
      if (method === undefined || !memory.has) {
        if (box.state === 'CONNECTED' || box.state === 'PRINTING') return Promise.resolve(OK)
        return Promise.resolve(fail('DISCONNECTED'))
      }
      return start(method, 'only')
    },

    async disconnect() {
      generation++
      disconnectNow()
      await Promise.resolve()
    },

    simulateDisconnect: disconnectNow,

    setBehavior(n, behavior) {
      if (behavior === undefined) script.delete(n)
      else script.set(n, behavior)
    },

    setConnectError(code) {
      connectError = code
    },

    async print(image: LabelBitmap, printOptions: PrintOptions = {}): Promise<PrinterResult> {
      if (box.state === 'PRINTING') return fail('BUSY')
      if (box.state !== 'CONNECTED') return fail('NOT_CONNECTED')
      const range = profile.density
      // 농도가 없는 프로필은 받은 농도를 쓰지 않는다(0으로 기록)
      const density = range === null ? 0 : (printOptions.density ?? range.default)
      if (range !== null && (!Number.isInteger(density) || density < range.min || density > range.max)) {
        return { ok: false, error: printerErrorWithMessage('INVALID_DENSITY', densityMessage(range)) }
      }
      if (!isLabelBitmap(image)) return fail('PRINT_FAILED', '그림 형식(L-1)이 아니다')
      // 보낼 그림의 폭(돌린 뒤 — 돌림이 있으면 받은 그림의 높이)이 헤드보다 넓으면 보내지 않는다 (L-7·L-12 2)
      const turned = (profile as Partial<ModelProfile>).rotate === 'CW90' || (profile as Partial<PrinterProfile>).printDirection === 'left'
      if ((turned ? image.height : image.width) > profile.headDots) return fail('IMAGE_TOO_WIDE')
      const copy = copyBitmap(image)
      calls++
      const behavior = script.get(calls)
      const started = session
      box.set('PRINTING')
      type Outcome = 'done' | 'disconnected' | 'failed' | 'timeout'
      const handles: unknown[] = []
      const outcome = await new Promise<Outcome>((resolve) => {
        interrupt = () => resolve('disconnected')
        if (behavior === 'disconnect') {
          resolve('disconnected')
          return
        }
        if (behavior === 'fail') {
          resolve('failed')
          return
        }
        const delay = typeof behavior === 'object' ? behavior.delayMs : 0
        handles.push(timer.setTimeout(() => resolve('timeout'), timeoutMs))
        if (delay <= 0) queueMicrotask(() => resolve('done'))
        else handles.push(timer.setTimeout(() => resolve('done'), delay))
      })
      interrupt = undefined
      for (const h of handles) timer.clearTimeout(h)
      /** 결과가 정해진 뒤 돌려주기 전에 끊겼다(그 사이 다시 연결했을 수도 있다) */
      const dropped = session !== started
      if (outcome === 'done') {
        // 프린터가 끝났다고 알렸다 — 그 뒤 끊겨도 라벨은 나왔으니 기록하고 ok. 상태는 끊김(또는 새 연결) 그대로 둔다
        printed.push({ image: copy, density })
        if (!dropped) box.set('CONNECTED')
        return OK
      }
      if (outcome === 'disconnected' || dropped) {
        if (!dropped) box.set('DISCONNECTED')
        return fail('DISCONNECTED')
      }
      box.set('CONNECTED')
      if (outcome === 'failed') return fail('PRINT_FAILED')
      return fail('TIMEOUT')
    },
  }
}
