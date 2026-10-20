// 가짜 Web Bluetooth 기기 (LABEL_RULES L-12 7, AC-N1-50) — 시험·개발용, 제품 목록에 없다.
// navigator.bluetooth 모양(requestDevice·getAvailability, 기기의 gatt.connect·getPrimaryService·getCharacteristic·쓰기·startNotifications·
// 알림 사건·gattserverdisconnected)을 흉내 낸다. 받은 조각을 받은 순서대로 복사해 기록하고, 출력(작업)마다 이어 붙인 바이트를 돌려준다.
// 기기 이름, 꾸러미(A·C·없음), 고르기 창 닫기, 블루투스 꺼짐, 연결 실패, 첫 크레딧(`01 04` — 안 보냄 포함)과 조각마다 보충할 크레딧,
// MTU 알림, `AA`(보냄·안 보냄·n ms 늦게·붙잡아 두기·다른 바이트), n번째 조각에서 끊김·쓰기 오류를 미리 정할 수 있다.
// 시각·난수를 쓰지 않는다(지연은 주입한 타이머). 작업의 끝은 받은 바이트의 래스터 머리로 계산한다(작업을 다 받아야 `AA`를 보낸다).
import { systemTimer, type PrinterProtocol, type PrinterTimer } from './adapter.ts'
import {
  GATT_BUNDLES,
  type BluetoothDeviceLike,
  type BluetoothEnvironment,
  type BluetoothLike,
  type BluetoothRequestOptions,
  type CharacteristicValueEvent,
  type GattCharacteristicLike,
  type GattServerLike,
  type GattServiceLike,
} from './bluetooth.ts'
import { EXPERIMENTAL_PROFILES, MARKLIFE_PROFILES, profileForDeviceName } from './profiles.ts'

/** 끝 알림: 보냄(작업을 다 받은 그 쓰기 안에서) · 안 보냄 · 붙잡아 두기(releaseAck로 보냄) · n ms 늦게 · 다른 바이트 */
export type FakeAck = 'send' | 'none' | 'hold' | { readonly delayMs: number } | { readonly bytes: readonly number[] }

/** 출력(작업) 하나에 낼 일 — 받은 순서로 1부터 센다(끊겨 끝나지 않은 시도도 하나로 센다) */
export interface FakeJobBehavior {
  readonly ack?: FakeAck
  /** 이 작업의 n번째(1부터) 조각을 받을 때 연결이 끊긴다 (그 조각은 받지 않는다) */
  readonly disconnectAtPacket?: number
  /** 이 작업의 n번째 조각 쓰기가 오류다 (연결은 그대로, 그 조각은 받지 않고 이 작업은 끝까지 받지 못한 채 닫힌다) */
  readonly failWriteAtPacket?: number
}

export interface FakeBluetoothOptions {
  /** 기기 이름 (기본 `S2_FAKE01`). null이면 이름 없음 */
  readonly name?: string | null
  /** GATT 꾸러미 (기본 A) */
  readonly bundle?: 'A' | 'C' | 'none'
  /** 빠뜨릴 특성 (16비트 UUID 글 — 예 `ff02`) */
  readonly missingCharacteristics?: readonly string[]
  /** getAvailability() 값 (기본 true) */
  readonly available?: boolean
  /** getAvailability가 있는지 (기본 true) */
  readonly hasAvailability?: boolean
  /** 고르기 창에서: 기기를 고른다(기본) · 창을 닫는다(NotFoundError) */
  readonly chooser?: 'pick' | 'cancel'
  /** true면 이름이 거르기와 맞지 않을 때 고르기 창에 기기가 없다(NotFoundError). 기본 false — 맞지 않는 기기도 고른다 */
  readonly respectFilters?: boolean
  /** gatt.connect()가 실패한다 */
  readonly connectFails?: boolean
  /** 흐름 제어 알림을 켜면 보내는 첫 크레딧 (기본 4 → `01 04`). null이면 보내지 않는다 */
  readonly initialCredits?: number | null
  /** 조각을 하나 받을 때마다 보내는 크레딧 (기본 1 → `01 01`). 0이면 보내지 않는다 */
  readonly creditsPerPacket?: number
  /** 첫 크레딧 뒤에 보내는 MTU 알림 `02 lo hi` (기본 없음) */
  readonly mtu?: number | null
  /** 끝 알림 기본값 (기본 'send') */
  readonly ack?: FakeAck
  /** 출력마다 낼 일 */
  readonly jobs?: Readonly<Record<number, FakeJobBehavior>>
  /** 작업의 끝을 계산할 방식 (기본: 이름으로 고른 프로필의 방식, 없으면 MARKLIFE_YXQ2) */
  readonly protocol?: Exclude<PrinterProtocol, 'NIIMBOT_B1'>
  /** 지연용 타이머 (기본: 시스템 타이머) */
  readonly timer?: PrinterTimer
  /** 환경의 사용자 에이전트 (기본 데스크톱 크롬 꼴) */
  readonly userAgent?: string
}

export interface FakeAttempt {
  /** 1부터 */
  readonly index: number
  /** 받은 조각 (복사본, 받은 순서) */
  readonly packets: readonly Uint8Array[]
  /** 조각을 이어 붙인 바이트 */
  readonly bytes: Uint8Array
  /** 작업을 끝까지 받았는지 */
  readonly complete: boolean
  /** 끝 알림 `AA`를 보냈는지 */
  readonly acked: boolean
}

export interface FakeBluetooth {
  /** navigator.bluetooth 자리에 넣는다 */
  readonly bluetooth: BluetoothLike
  /** 어댑터의 environment 자리에 넣는다 */
  readonly environment: BluetoothEnvironment
  readonly device: BluetoothDeviceLike
  /** requestDevice에 받은 인자 (복사본) */
  readonly requests: readonly BluetoothRequestOptions[]
  /** 받은 조각 전부 (복사본, 받은 순서) */
  readonly packets: readonly Uint8Array[]
  /** 출력 시도마다 받은 것 */
  readonly attempts: readonly FakeAttempt[]
  /** 끝까지 받고 `AA`를 보낸 작업의 바이트 (받은 순서) */
  readonly printed: readonly Uint8Array[]
  readonly connected: boolean
  /** gatt.connect() 성공 횟수 */
  readonly connectCount: number
  /** 알림을 켠 특성 (16비트 UUID 글 — `ff01` 등) */
  readonly notifying: readonly string[]
  /** 프린터 쪽에서 끊긴다 */
  disconnect(): void
  /** 알림 특성(ff01/fd02)으로 보낸다 */
  sendNotify(bytes: readonly number[]): void
  /** 흐름 제어 특성(ff03)으로 보낸다 */
  sendFlow(bytes: readonly number[]): void
  /** 붙잡아 둔 끝 알림을 보낸다 */
  releaseAck(): void
  setJob(n: number, behavior: FakeJobBehavior | undefined): void
  setAvailable(available: boolean): void
  setChooser(chooser: 'pick' | 'cancel'): void
  setConnectFails(fails: boolean): void
}

const shortId = (uuid: string): string => uuid.slice(4, 8)

class FakeError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

/** 받은 바이트로 작업 길이를 계산한다 (래스터 머리를 아직 못 받았으면 undefined, 꼴이 틀리면 NaN) */
export function fakeJobLength(protocol: Exclude<PrinterProtocol, 'NIIMBOT_B1'>, bytes: Uint8Array): number | undefined {
  const at = (i: number): number => bytes[i] as number
  if (protocol === 'MARKLIFE_L11') {
    const head = 19
    if (bytes.length < head + 8) return undefined
    if (at(head) !== 0x1d || at(head + 1) !== 0x76 || at(head + 2) !== 0x30 || at(head + 3) !== 0x00) return Number.NaN
    const wb = at(head + 4) | (at(head + 5) << 8)
    const h = at(head + 6) | (at(head + 7) << 8)
    return head + 8 + wb * h + 2 + 4
  }
  const head = protocol === 'MARKLIFE_YXQ2' ? 8 : 21
  const tail = protocol === 'MARKLIFE_YXQ2' ? 2 + 4 : 4 + 4 + 3
  if (bytes.length < head + 10) return undefined
  if (at(head) !== 0x1f || at(head + 1) !== 0x10) return Number.NaN
  const length = ((at(head + 6) << 24) | (at(head + 7) << 16) | (at(head + 8) << 8) | at(head + 9)) >>> 0
  return head + 10 + length + tail
}

export function createFakeBluetooth(options: FakeBluetoothOptions = {}): FakeBluetooth {
  const name = options.name === undefined ? 'S2_FAKE01' : options.name
  const bundleId = options.bundle ?? 'A'
  const missing = new Set((options.missingCharacteristics ?? []).map((s) => s.toLowerCase()))
  const timer = options.timer ?? systemTimer
  const jobs = new Map<number, FakeJobBehavior>(Object.entries(options.jobs ?? {}).map(([k, v]) => [Number(k), v]))
  const protocol =
    options.protocol ??
    ((profileForDeviceName(name, [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES])?.protocol ?? 'MARKLIFE_YXQ2') as Exclude<PrinterProtocol, 'NIIMBOT_B1'>)
  let available = options.available ?? true
  let chooser = options.chooser ?? 'pick'
  let connectFails = options.connectFails ?? false
  const initialCredits = options.initialCredits === undefined ? 4 : options.initialCredits
  const creditsPerPacket = options.creditsPerPacket ?? 1
  const requests: BluetoothRequestOptions[] = []
  const packets: Uint8Array[] = []
  interface MutableAttempt {
    index: number
    packets: Uint8Array[]
    bytes: Uint8Array
    complete: boolean
    acked: boolean
    /** 이 작업에서 쓰기를 부른 횟수 (끊김·오류로 받지 않은 조각 포함) */
    writes: number
  }
  const attempts: MutableAttempt[] = []
  let open: MutableAttempt | undefined
  let connected = false
  let connectCount = 0
  const notifying = new Set<string>()
  const deviceListeners = new Set<() => void>()
  let held: (() => void) | undefined

  class Characteristic implements GattCharacteristicLike {
    readonly uuid: string
    value: DataView | null = null
    readonly properties: { readonly write: boolean; readonly writeWithoutResponse: boolean; readonly notify: boolean }
    private readonly listeners = new Set<(event: CharacteristicValueEvent) => void>()
    private readonly role: 'write' | 'notify' | 'flow'

    constructor(uuid: string, role: 'write' | 'notify' | 'flow') {
      this.uuid = uuid
      this.role = role
      this.properties = { write: role === 'write', writeWithoutResponse: role === 'write', notify: role !== 'write' }
    }

    writeValueWithoutResponse(value: Uint8Array): Promise<void> {
      return this.receive(value)
    }

    writeValue(value: Uint8Array): Promise<void> {
      return this.receive(value)
    }

    private receive(value: Uint8Array): Promise<void> {
      if (this.role !== 'write') return Promise.reject(new FakeError('NotSupportedError', '쓰기 특성이 아니다'))
      if (!connected) return Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
      return onPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice())
    }

    startNotifications(): Promise<unknown> {
      if (this.role === 'write') return Promise.reject(new FakeError('NotSupportedError', '알림 특성이 아니다'))
      if (!connected) return Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
      notifying.add(shortId(this.uuid))
      // 알림을 켜자마자 첫 크레딧(과 MTU)을 보낸다 — 듣기를 먼저 붙이지 않으면 놓친다
      if (this.role === 'flow') {
        if (initialCredits !== null) this.emit([0x01, initialCredits & 0xff])
        if (options.mtu !== undefined && options.mtu !== null) this.emit([0x02, options.mtu & 0xff, (options.mtu >>> 8) & 0xff])
      }
      return Promise.resolve(this)
    }

    addEventListener(_type: 'characteristicvaluechanged', listener: (event: CharacteristicValueEvent) => void): void {
      this.listeners.add(listener)
    }

    removeEventListener(_type: 'characteristicvaluechanged', listener: (event: CharacteristicValueEvent) => void): void {
      this.listeners.delete(listener)
    }

    /** 알림을 켰고 연결돼 있을 때만 듣는 쪽에 간다 (진짜 Web Bluetooth와 같다) */
    emit(bytes: readonly number[]): void {
      if (!connected || !notifying.has(shortId(this.uuid))) return
      this.value = new DataView(new Uint8Array(bytes).buffer)
      for (const listener of [...this.listeners]) listener({ target: this })
    }
  }

  const spec = bundleId === 'none' ? undefined : GATT_BUNDLES[bundleId]
  const chars = new Map<string, Characteristic>()
  if (spec) {
    const add = (uuid: string | null, role: 'write' | 'notify' | 'flow'): void => {
      if (uuid !== null && !missing.has(shortId(uuid))) chars.set(uuid, new Characteristic(uuid, role))
    }
    add(spec.write, 'write')
    add(spec.notify, 'notify')
    add(spec.flow, 'flow')
  }
  const notifyChar = spec ? chars.get(spec.notify) : undefined
  const flowChar = spec?.flow ? chars.get(spec.flow) : undefined

  const service: GattServiceLike = {
    getCharacteristic: (uuid) => {
      const found = chars.get(String(uuid).toLowerCase())
      if (!connected) return Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
      return found ? Promise.resolve(found) : Promise.reject(new FakeError('NotFoundError', '특성이 없다'))
    },
  }

  const closeOpen = (): void => {
    open = undefined
  }

  const dropConnection = (): void => {
    if (!connected) return
    connected = false
    notifying.clear()
    held = undefined
    closeOpen()
    for (const listener of [...deviceListeners]) listener()
  }

  const server: GattServerLike = {
    get connected() {
      return connected
    },
    connect: () => {
      if (connectFails) return Promise.reject(new FakeError('NetworkError', '연결하지 못했다'))
      connected = true
      connectCount++
      return Promise.resolve(server)
    },
    disconnect: () => dropConnection(),
    getPrimaryService: (uuid) => {
      if (!connected) return Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
      return spec && String(uuid).toLowerCase() === spec.service ? Promise.resolve(service) : Promise.reject(new FakeError('NotFoundError', '서비스가 없다'))
    },
  }

  const device: BluetoothDeviceLike = {
    name,
    gatt: server,
    addEventListener: (_type, listener) => {
      deviceListeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      deviceListeners.delete(listener)
    },
  }

  const sendAck = (attempt: MutableAttempt, bytes: readonly number[]): void => {
    if (!connected) return
    if (bytes.length === 1 && bytes[0] === 0xaa) attempt.acked = true
    notifyChar?.emit(bytes)
  }

  const onComplete = (attempt: MutableAttempt): void => {
    attempt.complete = true
    closeOpen()
    const ack = jobs.get(attempt.index)?.ack ?? options.ack ?? 'send'
    if (ack === 'none') return
    if (ack === 'send') sendAck(attempt, [0xaa])
    else if (ack === 'hold') held = () => sendAck(attempt, [0xaa])
    else if ('delayMs' in ack) timer.setTimeout(() => sendAck(attempt, [0xaa]), ack.delayMs)
    else sendAck(attempt, ack.bytes)
  }

  const onPacket = (packet: Uint8Array): Promise<void> => {
    if (!open) {
      open = { index: attempts.length + 1, packets: [], bytes: new Uint8Array(0), complete: false, acked: false, writes: 0 }
      attempts.push(open)
    }
    const attempt = open
    attempt.writes++
    const behavior = jobs.get(attempt.index)
    if (behavior?.disconnectAtPacket === attempt.writes) {
      dropConnection()
      return Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
    }
    if (behavior?.failWriteAtPacket === attempt.writes) {
      // 이 작업은 여기서 끝난다(끝까지 받지 못함) — 다음 조각은 새 작업이다
      closeOpen()
      return Promise.reject(new FakeError('NotSupportedError', '쓰기 오류'))
    }
    packets.push(packet)
    attempt.packets.push(packet)
    const joined = new Uint8Array(attempt.bytes.length + packet.length)
    joined.set(attempt.bytes)
    joined.set(packet, attempt.bytes.length)
    attempt.bytes = joined
    if (creditsPerPacket > 0) flowChar?.emit([0x01, creditsPerPacket & 0xff])
    const total = fakeJobLength(protocol, attempt.bytes)
    if (total !== undefined && !Number.isNaN(total) && attempt.bytes.length >= total) onComplete(attempt)
    return Promise.resolve()
  }

  const nameMatches = (request: BluetoothRequestOptions): boolean => typeof name === 'string' && request.filters.some((f) => name.startsWith(f.namePrefix))

  const bluetooth: BluetoothLike = {
    requestDevice: (request) => {
      requests.push({ filters: request.filters.map((f) => ({ ...f })), optionalServices: [...request.optionalServices] })
      if (chooser === 'cancel' || (options.respectFilters === true && !nameMatches(request))) {
        return Promise.reject(new FakeError('NotFoundError', 'User cancelled the requestDevice() chooser.'))
      }
      return Promise.resolve(device)
    },
    ...(options.hasAvailability === false ? {} : { getAvailability: () => Promise.resolve(available) }),
  }

  const snapshot = (a: MutableAttempt): FakeAttempt => ({ index: a.index, packets: [...a.packets], bytes: a.bytes, complete: a.complete, acked: a.acked })

  return {
    bluetooth,
    environment: { bluetooth, userAgent: options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', maxTouchPoints: 0 },
    device,
    get requests() {
      return requests
    },
    get packets() {
      return packets
    },
    get attempts() {
      return attempts.map(snapshot)
    },
    get printed() {
      return attempts.filter((a) => a.complete && a.acked).map((a) => a.bytes)
    },
    get connected() {
      return connected
    },
    get connectCount() {
      return connectCount
    },
    get notifying() {
      return [...notifying].sort()
    },
    disconnect: () => dropConnection(),
    sendNotify: (bytes) => notifyChar?.emit(bytes),
    sendFlow: (bytes) => flowChar?.emit(bytes),
    releaseAck: () => {
      const release = held
      held = undefined
      release?.()
    },
    setJob: (n, behavior) => {
      if (behavior === undefined) jobs.delete(n)
      else jobs.set(n, behavior)
    },
    setAvailable: (value) => {
      available = value
    },
    setChooser: (value) => {
      chooser = value
    },
    setConnectFails: (value) => {
      connectFails = value
    },
  }
}
