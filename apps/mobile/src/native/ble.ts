// 네이티브 블루투스(BLE) 프린터 모듈의 약속 (APP-03). 실제 구현은 packages/mobile-ble(dev-device)가 낸다 — 여기에는 타입과 가짜 구현만 둔다.
// 모양은 packages/printer의 RememberingPrinterAdapter와 같다(L-7): 연결은 판매자가 누른 동작 안에서만, 1비트 그림 한 장을 보내고 프린터가 끝났다고
// 알린 뒤에 끝난다. 프린터 통신·작업 바이트는 packages/printer의 같은 어댑터 코드가 만들고 보내는 길(BLE 쓰기)만 다르다.
// 앱은 그림을 다시 그리지 않는다 — 서버가 만든 1비트 그림(LabelBitmap)을 그대로 넘긴다(APP-03 AC3).
import type { LabelBitmap } from '@livejjim/label'
import type { AdapterProfile, ConnectionMethod, ConnectionState, PrinterError, PrinterResult, RememberedPrinter, RememberingPrinterAdapter } from '@livejjim/printer'

export type { ConnectionMethod, ConnectionState, PrinterError, PrinterResult, RememberedPrinter }

/** 앱 BLE 프린터 어댑터 — RememberingPrinterAdapter와 같은 모양 (연결 방법은 'bluetooth' 하나) */
export type NativeBlePrinter = RememberingPrinterAdapter

export interface FakeBleOptions {
  /** 연결·출력 결과를 바꾸는 손잡이 (시험) */
  readonly connectResult?: () => PrinterResult
  readonly printResult?: () => PrinterResult
}

const OK: PrinterResult = { ok: true }
/** 끊김 결과 (PRINTER_MESSAGES.DISCONNECTED와 같은 문장) */
export const DISCONNECTED_RESULT: PrinterResult = { ok: false, error: { code: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', action: '다시 연결' } }

/** 가짜 BLE 프린터 — 개발·시험용. 보낸 그림을 기록한다 */
export class FakeBlePrinter implements NativeBlePrinter {
  readonly profile: AdapterProfile = { displayName: 'B1', dpi: 203, headDots: 384, density: { min: 1, max: 5, default: 3 } }
  state: ConnectionState = 'DISCONNECTED'
  readonly printed: { readonly image: LabelBitmap; readonly density: number | undefined }[] = []
  #remembered: RememberedPrinter | null = null
  readonly #stateListeners = new Set<(state: ConnectionState) => void>()
  readonly #rememberListeners = new Set<(value: RememberedPrinter | null) => void>()
  readonly #options: FakeBleOptions

  constructor(options: FakeBleOptions = {}) {
    this.#options = options
  }

  get hasRemembered(): boolean {
    return this.#remembered !== null
  }

  get remembered(): RememberedPrinter | null {
    return this.#remembered
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  onRememberedChange(listener: (value: RememberedPrinter | null) => void): () => void {
    this.#rememberListeners.add(listener)
    return () => this.#rememberListeners.delete(listener)
  }

  availableMethods(): ConnectionMethod[] {
    return ['bluetooth']
  }

  setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    for (const listener of [...this.#stateListeners]) listener(state)
  }

  restoreRemembered(value: RememberedPrinter | null): void {
    this.#remembered = value
  }

  async connect(_method: ConnectionMethod): Promise<PrinterResult> {
    this.setState('CONNECTING')
    const result = this.#options.connectResult?.() ?? OK
    if (!result.ok) {
      this.setState('DISCONNECTED')
      return result
    }
    this.setState('CONNECTED')
    this.#remembered = { method: 'bluetooth', deviceId: 'fake-b1' }
    for (const listener of [...this.#rememberListeners]) listener(this.#remembered)
    return result
  }

  reconnect(method: ConnectionMethod): Promise<PrinterResult> {
    return this.connect(method)
  }

  async connectRemembered(): Promise<PrinterResult> {
    if (this.#remembered === null) return DISCONNECTED_RESULT
    return this.connect('bluetooth')
  }

  async disconnect(): Promise<void> {
    this.setState('DISCONNECTED')
  }

  async print(image: LabelBitmap, options?: { readonly density?: number }): Promise<PrinterResult> {
    if (this.state !== 'CONNECTED') return DISCONNECTED_RESULT
    this.setState('PRINTING')
    const result = this.#options.printResult?.() ?? OK
    if (result.ok) this.printed.push({ image, density: options?.density })
    this.setState(result.ok ? 'CONNECTED' : 'DISCONNECTED')
    return result
  }

  /** 프린터가 저절로 끊겼다 (시험) */
  drop(): void {
    this.setState('DISCONNECTED')
  }
}
