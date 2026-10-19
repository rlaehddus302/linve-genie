// 가짜 프린터 (LABEL_RULES L-7 가짜 프린터, AC-P1-44) — 같은 어댑터 계약을 지키고, 받은 그림을 받은 순서대로 복사해 기록한다.
// 몇 번째 출력에서 끊김·프린터 오류·지연을 낼지 미리 정할 수 있다. 시각·난수를 쓰지 않는다(지연은 주입한 타이머).
// 시험과 개발에 쓴다. 리허설 방송은 가짜 프린터로도 출력하지 않는다(D-081 — 거르는 일은 I1).
import { copyBitmap, isLabelBitmap, type LabelBitmap } from '@livejjim/label'
import {
  B1_PROFILE,
  DEFAULT_PRINT_TIMEOUT_MS,
  StateBox,
  systemTimer,
  type ConnectionMethod,
  type ConnectionState,
  type PrintOptions,
  type PrinterAdapter,
  type PrinterProfile,
  type PrinterTimer,
} from './adapter.ts'
import { OK, fail, type PrinterErrorCode, type PrinterResult } from './errors.ts'

/** n번째 출력에서 낼 일: 끊김 · 프린터 오류(PRINT_FAILED) · 지연(그 뒤 성공, 시간 초과보다 길면 TIMEOUT) */
export type FakePrintBehavior = 'disconnect' | 'fail' | { readonly delayMs: number }

export interface FakePrintRecord {
  /** 받은 그림의 복사본 (받은 뒤 원본을 바꿔도 그대로) */
  readonly image: LabelBitmap
  readonly density: number
}

export interface FakePrinterOptions {
  /** 이 환경에서 쓸 수 있다고 할 연결 방법 (기본: 블루투스) */
  readonly methods?: readonly ConnectionMethod[]
  /** 출력 횟수(1부터, 출력을 부른 순서)마다 낼 일 */
  readonly script?: Readonly<Record<number, FakePrintBehavior>>
  /** 연결하면 낼 오류 (없으면 연결 성공) */
  readonly connectError?: PrinterErrorCode
  readonly profile?: PrinterProfile
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
}

export interface FakePrinter extends PrinterAdapter {
  /** 끝까지 출력한 그림들 (받은 순서) */
  readonly printed: readonly FakePrintRecord[]
  /** print를 부른 횟수 (거절 포함하지 않음 — 보내기 시작한 출력만 센다) */
  readonly printCalls: number
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

  const disconnectNow = (): void => {
    interrupt?.()
    box.set('DISCONNECTED')
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
    onStateChange: (listener) => box.listen(listener),
    availableMethods: () => [...methods],

    async connect(method) {
      if (box.state === 'CONNECTED' || box.state === 'PRINTING') return OK
      if (!methods.includes(method)) return fail('UNSUPPORTED')
      box.set('CONNECTING')
      await Promise.resolve()
      if (connectError) {
        box.set('DISCONNECTED')
        return fail(connectError)
      }
      box.set('CONNECTED')
      return OK
    },

    async disconnect() {
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
      const density = printOptions.density ?? profile.density.default
      if (!Number.isInteger(density) || density < profile.density.min || density > profile.density.max) return fail('INVALID_DENSITY')
      if (!isLabelBitmap(image)) return fail('PRINT_FAILED', '그림 형식(L-1)이 아니다')
      if (image.width > profile.headDots) return fail('IMAGE_TOO_WIDE')
      const copy = copyBitmap(image)
      calls++
      const behavior = script.get(calls)
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
      if (outcome === 'disconnected') {
        box.set('DISCONNECTED')
        return fail('DISCONNECTED')
      }
      box.set('CONNECTED')
      if (outcome === 'failed') return fail('PRINT_FAILED')
      if (outcome === 'timeout') return fail('TIMEOUT')
      printed.push({ image: copy, density })
      return OK
    },
  }
}
