// 가짜 NIIMBOT B1 USB(Web Serial) 기기 (QS1, AC-QS1-04·07, D-QS1-01 (3)) — 시험·개발용, 제품 목록에 없다.
// B1 어댑터의 environment·createClient 자리에 넣는다. navigator.serial 모양(requestPort·getPorts, 포트의 getInfo)과
// niimbluelib 시리얼 클라이언트 모양(connect({ authorizedPort })·끊김 알림·인쇄 작업)을 흉내 낸다.
// 포트마다 USB 제조사·제품 번호, 꽂힘/뽑힘, 허락됨을 정할 수 있다. 시각·난수를 쓰지 않는다.
import type { EncodedImage } from '@mmote/niimbluelib'
import type { ConnectionMethod } from './adapter.ts'
import type { NiimbotClientLike, NiimbotPrintTaskLike, NiimbotTaskOptions, PrinterEnvironment } from './niimbot.ts'

/** 가짜 B1 USB 번호 (시험용 값 — 실제 B1의 번호는 HG-2에서 확인한다) */
export const FAKE_B1_USB_VENDOR_ID = 0x3513
export const FAKE_B1_USB_PRODUCT_ID = 0x0002

export interface FakeSerialPortOptions {
  /** USB 제조사 번호 (기본 FAKE_B1_USB_VENDOR_ID). null이면 번호 없음(getInfo가 빈 값) */
  readonly usbVendorId?: number | null
  /** USB 제품 번호 (기본 FAKE_B1_USB_PRODUCT_ID). null이면 번호 없음 */
  readonly usbProductId?: number | null
  /** 꽂혀 있는지 (기본 true) */
  readonly plugged?: boolean
  /** 이미 허락된 포트인지 (getPorts가 돌려준다, 기본 false — 고르기 창에서 고르면 허락됨) — 새로고침 뒤를 흉내 낸다 */
  readonly permitted?: boolean
  /** 연결한 뒤 알리는 모델 (기본 `B1`) */
  readonly model?: string
}

/** 가짜 포트 (Web Serial SerialPort에서 쓰는 부분) */
export interface FakeSerialPort {
  getInfo(): { readonly usbVendorId?: number; readonly usbProductId?: number }
  readonly plugged: boolean
  readonly permitted: boolean
}

export interface FakeNiimbotSerialOptions {
  /** 포트들 (기본: B1 포트 하나) */
  readonly ports?: readonly FakeSerialPortOptions[]
  /** 고르기 창에서: 꽂힌 첫 포트를 고른다(기본) · n번째(0부터) 포트를 고른다 · 창을 닫는다(NotFoundError) */
  readonly chooser?: 'pick' | 'cancel' | number
  /** navigator.serial.getPorts — 있음(기본) · 없음 · 있지만 예외 */
  readonly getPorts?: boolean | 'throws'
  /** 포트를 다른 프로그램이 쓰고 있다 (열기가 InvalidStateError) */
  readonly busy?: boolean
}

export interface FakeNiimbotSerialPrint {
  readonly options: NiimbotTaskOptions
  readonly image: EncodedImage
}

export interface FakeNiimbotSerial {
  /** 어댑터의 environment 자리에 넣는다 (시리얼만 — 블루투스 없음. combineNiimbotFakes로 합친다) */
  readonly environment: PrinterEnvironment
  /** 어댑터의 createClient 자리에 넣는다 */
  readonly createClient: (method: ConnectionMethod) => NiimbotClientLike
  readonly ports: readonly FakeSerialPort[]
  /** 고르기 창(requestPort)을 부른 횟수 */
  readonly requests: number
  /** getPorts를 부른 횟수 */
  readonly getPortsCalls: number
  /** 클라이언트 connect()를 부른 횟수 */
  readonly connectAttempts: number
  /** connect()마다 받은 포트 — 넘겼으면 그 포트, 안 넘겼으면 undefined */
  readonly authorizedPorts: readonly unknown[]
  readonly connected: boolean
  readonly printed: readonly FakeNiimbotSerialPrint[]
  /** n번째(0부터) 포트를 뽑는다 — 이어져 있었으면 끊김 알림 */
  unplug(index?: number): void
  /** n번째 포트를 다시 꽂는다 (같은 포트 객체 — 허락은 그대로) */
  plug(index?: number): void
  /** 포트를 더한다 (돌려준 값 = 번호) */
  addPort(options?: FakeSerialPortOptions): number
  setChooser(chooser: 'pick' | 'cancel' | number): void
  setGetPorts(mode: boolean | 'throws'): void
  setBusy(busy: boolean): void
}

class FakeError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

interface PortState {
  readonly port: FakeSerialPort
  readonly info: { readonly usbVendorId?: number; readonly usbProductId?: number }
  readonly model: string
  plugged: boolean
  permitted: boolean
  readonly unplugListeners: Set<() => void>
}

export function createFakeNiimbotSerial(options: FakeNiimbotSerialOptions = {}): FakeNiimbotSerial {
  const states: PortState[] = []
  let chooser = options.chooser ?? 'pick'
  let getPortsMode: boolean | 'throws' = options.getPorts ?? true
  let busy = options.busy ?? false
  let requests = 0
  let getPortsCalls = 0
  let connectAttempts = 0
  const authorizedPorts: unknown[] = []
  const printed: FakeNiimbotSerialPrint[] = []
  const live = new Set<FakeSerialClient>()

  const addPort = (portOptions: FakeSerialPortOptions = {}): number => {
    const vendor = portOptions.usbVendorId === undefined ? FAKE_B1_USB_VENDOR_ID : portOptions.usbVendorId
    const product = portOptions.usbProductId === undefined ? FAKE_B1_USB_PRODUCT_ID : portOptions.usbProductId
    const info = Object.freeze({ ...(vendor === null ? {} : { usbVendorId: vendor }), ...(product === null ? {} : { usbProductId: product }) })
    const state: PortState = {
      port: undefined as unknown as FakeSerialPort,
      info,
      model: portOptions.model ?? 'B1',
      plugged: portOptions.plugged ?? true,
      permitted: portOptions.permitted ?? false,
      unplugListeners: new Set(),
    }
    const port: FakeSerialPort = Object.freeze({
      getInfo: () => ({ ...info }),
      get plugged() {
        return state.plugged
      },
      get permitted() {
        return state.permitted
      },
    })
    ;(state as { port: FakeSerialPort }).port = port
    states.push(state)
    return states.length - 1
  }
  for (const p of options.ports ?? [{}]) addPort(p)

  const stateOf = (port: unknown): PortState | undefined => states.find((s) => s.port === port)

  const pickPort = (): FakeSerialPort => {
    requests++
    if (chooser === 'cancel') throw new FakeError('NotFoundError', 'No port selected by the user.')
    const state = typeof chooser === 'number' ? states[chooser] : states.find((s) => s.plugged)
    if (!state || !state.plugged) throw new FakeError('NotFoundError', 'No port selected by the user.')
    state.permitted = true
    return state.port
  }

  class FakeSerialClient implements NiimbotClientLike {
    #connected = false
    #port: PortState | undefined
    readonly #listeners = new Set<() => void>()
    readonly #onUnplug = (): void => this.dropFromPrinter()
    readonly protocol = {
      newPrintTask: (_name: string, taskOptions: NiimbotTaskOptions): NiimbotPrintTaskLike => ({
        printInit: () => (this.#connected ? Promise.resolve() : Promise.reject(new FakeError('NetworkError', '포트가 끊겼다'))),
        printPage: (image: EncodedImage) => {
          if (!this.#connected) return Promise.reject(new FakeError('NetworkError', '포트가 끊겼다'))
          printed.push({ options: { ...taskOptions }, image })
          return Promise.resolve()
        },
        waitForFinished: () => Promise.resolve(),
        printEnd: () => Promise.resolve(true),
      }),
    }

    async connect(connectOptions?: { readonly authorizedPort?: unknown }): Promise<unknown> {
      await this.disconnect()
      connectAttempts++
      const given = connectOptions?.authorizedPort
      authorizedPorts.push(given)
      // 포트를 넘기지 않으면 niimbluelib처럼 고르기 창을 띄운다
      const port = given === undefined ? pickPort() : given
      const state = stateOf(port)
      if (!state) throw new FakeError('NetworkError', 'Failed to open serial port.')
      if (busy) throw new FakeError('InvalidStateError', 'The port is already open.')
      if (!state.plugged) throw new FakeError('NetworkError', 'Failed to open serial port.')
      for (const other of [...live]) other.dropFromPrinter()
      this.#connected = true
      this.#port = state
      state.unplugListeners.add(this.#onUnplug)
      live.add(this)
      return { deviceName: 'Serial', result: 1 }
    }

    disconnect(): Promise<void> {
      this.#port?.unplugListeners.delete(this.#onUnplug)
      this.#port = undefined
      live.delete(this)
      this.#connected = false
      return Promise.resolve()
    }

    isConnected(): boolean {
      return this.#connected
    }

    getModelMetadata(): { readonly model: string } | undefined {
      return this.#connected && this.#port ? { model: this.#port.model } : undefined
    }

    on(_event: 'disconnect', listener: () => void): unknown {
      this.#listeners.add(listener)
      return this
    }

    off(_event: 'disconnect', listener: () => void): unknown {
      this.#listeners.delete(listener)
      return this
    }

    dropFromPrinter(): void {
      if (!this.#connected) return
      this.#port?.unplugListeners.delete(this.#onUnplug)
      this.#port = undefined
      this.#connected = false
      live.delete(this)
      for (const listener of [...this.#listeners]) listener()
    }
  }

  const serial = {
    requestPort: (): Promise<unknown> => {
      try {
        return Promise.resolve(pickPort())
      } catch (error) {
        return Promise.reject(error)
      }
    },
  }
  Object.defineProperty(serial, 'getPorts', {
    enumerable: true,
    get: () =>
      getPortsMode === false
        ? undefined
        : (): Promise<readonly unknown[]> => {
            getPortsCalls++
            if (getPortsMode === 'throws') return Promise.reject(new FakeError('SecurityError', 'getPorts is not allowed'))
            return Promise.resolve(states.filter((s) => s.permitted && s.plugged).map((s) => s.port))
          },
  })

  const at = (index: number): PortState => {
    const state = states[index]
    if (!state) throw new Error(`가짜 포트 ${index}번이 없다`)
    return state
  }

  return {
    environment: { serial },
    createClient: () => new FakeSerialClient(),
    get ports() {
      return states.map((s) => s.port)
    },
    get requests() {
      return requests
    },
    get getPortsCalls() {
      return getPortsCalls
    },
    get connectAttempts() {
      return connectAttempts
    },
    get authorizedPorts() {
      return [...authorizedPorts]
    },
    get connected() {
      return live.size > 0
    },
    get printed() {
      return [...printed]
    },
    unplug: (index = 0) => {
      const state = at(index)
      state.plugged = false
      for (const listener of [...state.unplugListeners]) listener()
    },
    plug: (index = 0) => {
      at(index).plugged = true
    },
    addPort,
    setChooser: (value) => {
      chooser = value
    },
    setGetPorts: (mode) => {
      getPortsMode = mode
    },
    setBusy: (value) => {
      busy = value
    },
  }
}

/** 가짜 B1 블루투스와 가짜 B1 USB를 한 어댑터에 꽂는다 (연결 방법마다 그 가짜의 클라이언트) */
export function combineNiimbotFakes(
  bluetooth: { readonly environment: PrinterEnvironment; readonly createClient: (method: ConnectionMethod) => NiimbotClientLike },
  serial: { readonly environment: PrinterEnvironment; readonly createClient: (method: ConnectionMethod) => NiimbotClientLike },
): { readonly environment: PrinterEnvironment; readonly createClient: (method: ConnectionMethod) => NiimbotClientLike } {
  const environment: PrinterEnvironment = { bluetooth: bluetooth.environment.bluetooth, serial: serial.environment.serial }
  return {
    environment,
    createClient: (method) => (method === 'bluetooth' ? bluetooth.createClient(method) : serial.createClient(method)),
  }
}
