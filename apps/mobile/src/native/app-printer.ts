// 앱 프린터 (APP-03, LABEL_RULES L-7·L-11 8·L-11 15) — 연결 방법 둘을 한 어댑터처럼 보인다:
// - 블루투스 프린터: 한 목록 고르기(@livejjim/mobile-ble createPrinterPicker) + 저절로 다시 잇기(createReconnectingAdapter, L-11 8 정책)
// - 시험용 프린터: L-7 가짜 프린터(@livejjim/printer createFakePrinter) + 같은 저절로 다시 잇기. 서버가 시험 모드일 때만 화면이 고른다(L-11 15) —
//   라벨 흐름(받기·서버 그림·출력·결과 알림) 전체를 실물 없이 돈다. 처음 고를 때 만든다(운영에서는 만들지 않는다).
// 지금 고른 방법의 어댑터만 상태·기억 알림을 넘긴다. 방법을 바꾸면 앞 방법은 끊는다(연결 끊기와 같다 — 다시 잇지 않는다).
// 저절로 다시 잇기 허락(출력 기기 + 라벨 기능 켬)은 화면 쪽(LabelQueue)이 정해 넘긴다 — 처음에는 허락하지 않는다.
import type { LabelBitmap } from '@livejjim/label'
import type { ReconnectingAdapter } from '@livejjim/mobile-ble'
import type { AdapterProfile, ConnectionMethod, ConnectionState, PrintOptions, PrinterResult, RememberedPrinter } from '@livejjim/printer'
import type { AutoReconnectState, NativeBlePrinter, PrinterTarget } from './ble.ts'

export interface AppPrinterOptions {
  /** 블루투스 프린터 (고르기 + 저절로 다시 잇기) */
  readonly device: ReconnectingAdapter
  /** 시험용 프린터를 만든다 (처음 고를 때 한 번) */
  readonly createTest: () => ReconnectingAdapter
}

export class AppPrinter implements NativeBlePrinter {
  readonly #device: ReconnectingAdapter
  readonly #createTest: () => ReconnectingAdapter
  #test: ReconnectingAdapter | null = null
  #target: PrinterTarget = 'bluetooth'
  #allowed = false
  readonly #stateListeners = new Set<(state: ConnectionState) => void>()
  readonly #rememberListeners = new Set<(value: RememberedPrinter | null) => void>()
  readonly #changeListeners = new Set<() => void>()

  constructor(options: AppPrinterOptions) {
    this.#device = options.device
    this.#createTest = options.createTest
    this.#device.setAllowed(false)
    this.#wire(this.#device, 'bluetooth')
  }

  #wire(adapter: ReconnectingAdapter, target: PrinterTarget): void {
    adapter.onStateChange((state) => {
      if (this.#target !== target) return
      for (const listener of [...this.#stateListeners]) listener(state)
      this.#emit()
    })
    adapter.onRememberedChange((value) => {
      if (this.#target !== target) return
      for (const listener of [...this.#rememberListeners]) listener(value)
      this.#emit()
    })
    adapter.onAutoChange(() => {
      if (this.#target === target) this.#emit()
    })
  }

  #emit(): void {
    for (const listener of [...this.#changeListeners]) listener()
  }

  #testAdapter(): ReconnectingAdapter {
    if (this.#test === null) {
      const test = this.#createTest()
      test.setAllowed(this.#allowed)
      this.#test = test
      this.#wire(test, 'test')
    }
    return this.#test
  }

  get #active(): ReconnectingAdapter {
    return this.#target === 'test' ? this.#testAdapter() : this.#device
  }

  get target(): PrinterTarget {
    return this.#target
  }

  get profile(): AdapterProfile {
    return this.#active.profile
  }

  get state(): ConnectionState {
    return this.#active.state
  }

  get hasRemembered(): boolean {
    return this.#active.hasRemembered
  }

  get remembered(): RememberedPrinter | null {
    return this.#active.remembered
  }

  get autoReconnect(): AutoReconnectState {
    return this.#active.autoState
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  onRememberedChange(listener: (value: RememberedPrinter | null) => void): () => void {
    this.#rememberListeners.add(listener)
    return () => this.#rememberListeners.delete(listener)
  }

  onChange(listener: () => void): () => void {
    this.#changeListeners.add(listener)
    return () => this.#changeListeners.delete(listener)
  }

  availableMethods(): ConnectionMethod[] {
    return this.#active.availableMethods()
  }

  restoreRemembered(value: RememberedPrinter | null): void {
    this.#active.restoreRemembered(value)
    this.#emit()
  }

  /** 블루투스 프린터의 기억을 앱 저장소에서 되살린다 (지금 고른 방법과 상관없이 — 시험용 프린터의 기억과 섞이지 않는다) */
  restoreDeviceMemory(value: RememberedPrinter | null): void {
    this.#device.restoreRemembered(value)
    this.#emit()
  }

  async selectTarget(target: PrinterTarget): Promise<void> {
    if (target === this.#target) return
    const previous = this.#active
    if (previous.state !== 'DISCONNECTED') await previous.disconnect()
    const before = previous.state
    this.#target = target
    const next = this.#active
    if (next.state !== before) for (const listener of [...this.#stateListeners]) listener(next.state)
    this.#emit()
  }

  setAutoReconnect(allowed: boolean): void {
    this.#allowed = allowed
    this.#device.setAllowed(allowed)
    this.#test?.setAllowed(allowed)
  }

  connect(method: ConnectionMethod): Promise<PrinterResult> {
    return this.#active.connect(method)
  }

  reconnect(method: ConnectionMethod): Promise<PrinterResult> {
    return this.#active.reconnect(method)
  }

  connectRemembered(): Promise<PrinterResult> {
    return this.#active.connectRemembered()
  }

  disconnect(): Promise<void> {
    return this.#active.disconnect()
  }

  print(image: LabelBitmap, options?: PrintOptions): Promise<PrinterResult> {
    return this.#active.print(image, options)
  }
}
