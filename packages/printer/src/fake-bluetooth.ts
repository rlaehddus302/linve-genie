// 가짜 Web Bluetooth 기기 (LABEL_RULES L-12 7, AC-N1-50) — 시험·개발용, 제품 목록에 없다.
// navigator.bluetooth 모양(requestDevice·getAvailability, 기기의 gatt.connect·getPrimaryService·getCharacteristic·쓰기·startNotifications·
// 알림 사건·gattserverdisconnected)을 흉내 낸다. 받은 조각을 받은 순서대로 복사해 기록하고, 출력(작업)마다 이어 붙인 바이트를 돌려준다.
// 기기 이름, 꾸러미(A·C·없음), 고르기 창 닫기, 블루투스 꺼짐, 연결 실패, 첫 크레딧(`01 04` — 안 보냄 포함)과 조각마다 보충할 크레딧,
// MTU 알림, `AA`(보냄·안 보냄·n ms 늦게·붙잡아 두기·다른 바이트), n번째 조각에서 끊김·쓰기 오류·쓰기 멈춤(끝나지 않음 — 연결은 그대로,
// D-N1-12)을 미리 정할 수 있다.
// 시각·난수를 쓰지 않는다(지연은 주입한 타이머). 작업의 끝은 받은 바이트의 래스터 머리로 계산한다(작업을 다 받아야 `AA`를 보낸다).
// 작업의 시작은 방식마다의 시작 바이트로 알아본다 — 어댑터가 작업 중간에 그만둔 시도는 다음 작업의 시작을 받으면 닫고,
// 다음 출력은 새 시도로 센다(어댑터와 가짜 기기 사이에 따로 신호가 없다).
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
import type { EncodedImage } from '@mmote/niimbluelib'
import type { NiimbotClientLike, NiimbotPrintTaskLike, NiimbotTaskOptions, PrinterEnvironment } from './niimbot.ts'
import type { ConnectionMethod } from './adapter.ts'

/** 끝 알림: 보냄(작업을 다 받은 그 쓰기 안에서) · 안 보냄 · 붙잡아 두기(releaseAck로 보냄) · n ms 늦게 · 다른 바이트 */
export type FakeAck = 'send' | 'none' | 'hold' | { readonly delayMs: number } | { readonly bytes: readonly number[] }

/** 출력(작업) 하나에 낼 일 — 받은 순서로 1부터 센다(끊겨 끝나지 않은 시도도 하나로 센다) */
export interface FakeJobBehavior {
  readonly ack?: FakeAck
  /** 이 작업의 n번째(1부터) 조각을 받을 때 연결이 끊긴다 (그 조각은 받지 않는다) */
  readonly disconnectAtPacket?: number
  /** 이 작업의 n번째 조각 쓰기가 오류다 (연결은 그대로, 그 조각은 받지 않고 이 작업은 끝까지 받지 못한 채 닫힌다) */
  readonly failWriteAtPacket?: number
  /**
   * 이 작업의 n번째 조각 쓰기가 끝나지 않는다 (멈춤 — 연결은 그대로, L-12 7·D-N1-12). 그 쓰기의 promise는 releaseStalledWrites()·끊김
   * 전까지 끝나지 않고, 그 조각은 받지 않는다. 이 작업은 끝까지 받지 못한 채 닫힌다 — 어댑터가 TIMEOUT으로 그만둔 뒤의 다음 출력은 새 시도로 센다
   */
  readonly stallWriteAtPacket?: number
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
  /**
   * 블루투스 장치가 정말 꺼짐 — requestDevice가 `NotFoundError`(Bluetooth adapter not available.), gatt.connect()가 실패한다.
   * 기본은 getAvailability() 값을 따른다(false면 꺼짐). `available: false, adapterOff: false` = 윈도우 크롬 오판(실제로는 이어진다 — D-QS1-03)
   */
  readonly adapterOff?: boolean
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
  /**
   * 프린터 쪽에서 끊긴다. notice가 false면 gattserverdisconnected 알림을 보내지 않는다 —
   * 연결은 이미 없어 쓰기는 거절되는데 끊김 알림은 아직 오지 않은 순간(쓰기 거절이 먼저 오는 경우)을 흉내 낸다.
   */
  disconnect(options?: { readonly notice?: boolean }): void
  /** 알림 특성(ff01/fd02)으로 보낸다 */
  sendNotify(bytes: readonly number[]): void
  /** 흐름 제어 특성(ff03)으로 보낸다 */
  sendFlow(bytes: readonly number[]): void
  /** 붙잡아 둔 끝 알림을 보낸다 */
  releaseAck(): void
  /** 멈춘 쓰기(stallWriteAtPacket)를 끝낸다 — promise만 성공으로 끝나고 그 조각은 여전히 받지 않은 것이다 */
  releaseStalledWrites(): void
  /** 끝나지 않은 채 멈춰 있는 쓰기 수 */
  readonly stalledWrites: number
  setJob(n: number, behavior: FakeJobBehavior | undefined): void
  setAvailable(available: boolean): void
  /** 블루투스 장치 꺼짐을 정한다. undefined면 getAvailability() 값을 따른다 */
  setAdapterOff(off: boolean | undefined): void
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

/** 아무 값이나 받는 자리 (농도) */
const ANY = -1
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0x00)

/**
 * 방식마다 작업이 시작하는 바이트 (L-12 2의 순서: 머리 명령 전부 + 래스터 명령 — 농도 자리는 아무 값).
 * 래스터 명령까지 맞춰 보므로 압축한 줄 가운데에서 우연히 맞을 일이 사실상 없다. 끝 바이트(`1D 0C 10 FF F1 45`·`… 1F 11 50`)는
 * 어느 방식의 시작 바이트와도 어긋나므로, 작업 하나를 끝까지 받으면 그 안의 시작 후보는 모두 가려진다.
 */
const JOB_START: Readonly<Record<Exclude<PrinterProtocol, 'NIIMBOT_B1'>, readonly number[]>> = (() => {
  const yxq38 = [0x1f, 0x80, 0x02, 0x20, 0x1f, 0x70, 0x02, ANY, ...zeros(6), 0x1f, 0xc0, 0x01, 0x00, 0x1f, 0x11, 0x51, 0x1f, 0x10]
  return {
    MARKLIFE_YXQ2: [0x1f, 0x70, 0x01, ANY, 0x10, 0xff, 0xf1, 0x02, 0x1f, 0x10],
    MARKLIFE_YXQ3: yxq38,
    MARKLIFE_YXQ8: yxq38,
    MARKLIFE_L11: [...zeros(15), 0x10, 0xff, 0xf1, 0x02, 0x1d, 0x76, 0x30, 0x00],
  }
})()

/**
 * bytes의 at 자리부터가 작업 시작 바이트인지: 'yes'(모두 맞음) · 'no'(어긋남) · 'maybe'(받은 데까지는 맞는데 아직 짧다).
 * 조각이 시작 바이트보다 짧을 수 있어(MTU 알림) 여러 조각에 걸쳐 본다.
 */
export function fakeJobStartAt(protocol: Exclude<PrinterProtocol, 'NIIMBOT_B1'>, bytes: Uint8Array, at: number): 'yes' | 'no' | 'maybe' {
  const start = JOB_START[protocol]
  const n = Math.min(start.length, bytes.length - at)
  for (let i = 0; i < n; i++) {
    const want = start[i] as number
    if (want !== ANY && bytes[at + i] !== want) return 'no'
  }
  return n === start.length ? 'yes' : 'maybe'
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
  let adapterOffSetting = options.adapterOff
  const adapterOff = (): boolean => adapterOffSetting ?? !available
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
    /** 아직 가리지 못한 새 작업 시작 후보 — 받은 데까지는 시작 바이트와 맞는 조각 경계 (조각 번호, 바이트 자리) */
    starts: { readonly packet: number; readonly at: number }[]
  }
  const attempts: MutableAttempt[] = []
  let open: MutableAttempt | undefined
  let connected = false
  let connectCount = 0
  const notifying = new Set<string>()
  const deviceListeners = new Set<() => void>()
  let held: (() => void) | undefined
  /** 멈춘 쓰기 — 끊기면 거절, releaseStalledWrites()면 성공으로 끝난다 */
  const stalled: { readonly resolve: () => void; readonly reject: (error: unknown) => void }[] = []

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

  const dropConnection = (notice = true): void => {
    if (!connected) return
    connected = false
    notifying.clear()
    held = undefined
    closeOpen()
    // 멈춰 있던 쓰기는 연결이 없어지면 거절된다 (진짜 Web Bluetooth와 같다)
    for (const write of stalled.splice(0)) write.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
    if (notice) for (const listener of [...deviceListeners]) listener()
  }

  const server: GattServerLike = {
    get connected() {
      return connected
    },
    connect: () => {
      if (connectFails || adapterOff()) return Promise.reject(new FakeError('NetworkError', '연결하지 못했다'))
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

  /** 열린 시도를 조각 경계 start에서 나눈다 — 앞은 끝까지 받지 못한 시도로 닫고, 그 뒤 조각으로 새 시도를 연다 */
  const splitAt = (attempt: MutableAttempt, start: MutableAttempt['starts'][number]): MutableAttempt => {
    const next: MutableAttempt = {
      index: attempts.length + 1,
      packets: attempt.packets.slice(start.packet),
      bytes: attempt.bytes.slice(start.at),
      complete: false,
      acked: false,
      writes: attempt.packets.length - start.packet,
      starts: attempt.starts.filter((s) => s.packet > start.packet).map((s) => ({ packet: s.packet - start.packet, at: s.at - start.at })),
    }
    attempt.packets = attempt.packets.slice(0, start.packet)
    attempt.bytes = attempt.bytes.slice(0, start.at)
    attempt.starts = []
    attempts.push(next)
    open = next
    return next
  }

  /**
   * 조각을 받은 뒤: 여러 조각에 걸쳐 보이게 된 새 작업의 시작에서 나누고, 작업을 끝까지 받았으면 끝 알림을 낸다.
   * 작업 끝 안쪽에 아직 가리지 못한 시작 후보가 있으면 다음 조각을 기다린다 — 앞 작업 머리로 잰 길이를 다음 작업의 바이트로
   * 채워 거짓으로 `AA`를 보내지 않게(출력하지 않은 라벨이 출력함으로 가지 않게, D-N1-06).
   */
  const settle = (first: MutableAttempt): void => {
    let attempt = first
    for (;;) {
      const current = attempt
      current.starts = current.starts.filter((s) => fakeJobStartAt(protocol, current.bytes, s.at) !== 'no')
      const found = current.starts.find((s) => fakeJobStartAt(protocol, current.bytes, s.at) === 'yes')
      if (!found) break
      attempt = splitAt(current, found)
    }
    const total = fakeJobLength(protocol, attempt.bytes)
    if (total === undefined || Number.isNaN(total) || attempt.bytes.length < total) return
    if (attempt.starts.some((s) => s.at < total)) return
    onComplete(attempt)
  }

  const onPacket = (packet: Uint8Array): Promise<void> => {
    // 끝까지 받지 못한 시도(어댑터가 TIMEOUT으로 그만뒀다)에 새 작업의 첫 조각이 오면 그 시도를 닫는다 — 출력마다 따로 센다(L-12 7).
    // 어댑터가 따로 알려 주지 않는다: 진짜 프린터처럼 받은 바이트만 본다
    if (open && fakeJobStartAt(protocol, packet, 0) === 'yes') closeOpen()
    if (!open) {
      open = { index: attempts.length + 1, packets: [], bytes: new Uint8Array(0), complete: false, acked: false, writes: 0, starts: [] }
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
    if (behavior?.stallWriteAtPacket === attempt.writes) {
      // 쓰기가 끝나지 않는다 — 연결은 그대로, 그 조각은 받지 않는다. 이 작업은 여기서 닫는다(다음 출력은 새 시도로 센다).
      // 이 설정은 '끝내 전달되지 않는 쓰기'만 흉내 낸다. 시간 초과(L-12 5) 뒤에 멈춘 쓰기를 끝내 주면 어댑터는 다음 조각을 보내지 않아야 한다.
      // 시간 초과 전에 끝내 주면 그것은 진행이라 어댑터가 다음 조각을 보내는 것이 맞지만, 이 작업은 이미 닫혀서 그 조각은 시작 바이트가 아닌 새 시도로 기록된다
      // — '늦게 끝나지만 전달되는 쓰기'는 이 설정으로 흉내 낼 수 없다(TD-N1-005)
      closeOpen()
      return new Promise<void>((resolve, reject) => {
        stalled.push({ resolve, reject })
      })
    }
    packets.push(packet)
    // 조각이 시작 바이트보다 짧으면(MTU 알림) 이 조각만으로 가리지 못한다 — 후보로 두고 뒤 조각과 함께 본다
    if (attempt.packets.length > 0 && fakeJobStartAt(protocol, packet, 0) !== 'no') attempt.starts.push({ packet: attempt.packets.length, at: attempt.bytes.length })
    attempt.packets.push(packet)
    const joined = new Uint8Array(attempt.bytes.length + packet.length)
    joined.set(attempt.bytes)
    joined.set(packet, attempt.bytes.length)
    attempt.bytes = joined
    if (creditsPerPacket > 0) flowChar?.emit([0x01, creditsPerPacket & 0xff])
    settle(attempt)
    return Promise.resolve()
  }

  const nameMatches = (request: BluetoothRequestOptions): boolean => typeof name === 'string' && request.filters.some((f) => name.startsWith(f.namePrefix))

  const bluetooth: BluetoothLike = {
    requestDevice: (request) => {
      requests.push({ filters: request.filters.map((f) => ({ ...f })), optionalServices: [...request.optionalServices] })
      if (adapterOff()) return Promise.reject(new FakeError('NotFoundError', 'Bluetooth adapter not available.'))
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
    disconnect: (opts) => dropConnection(opts?.notice ?? true),
    sendNotify: (bytes) => notifyChar?.emit(bytes),
    sendFlow: (bytes) => flowChar?.emit(bytes),
    releaseAck: () => {
      const release = held
      held = undefined
      release?.()
    },
    releaseStalledWrites: () => {
      for (const write of stalled.splice(0)) write.resolve()
    },
    get stalledWrites() {
      return stalled.length
    },
    setJob: (n, behavior) => {
      if (behavior === undefined) jobs.delete(n)
      else jobs.set(n, behavior)
    },
    setAvailable: (value) => {
      available = value
    },
    setAdapterOff: (value) => {
      adapterOffSetting = value
    },
    setChooser: (value) => {
      chooser = value
    },
    setConnectFails: (value) => {
      connectFails = value
    },
  }
}

// ─── 가짜 NIIMBOT B1 블루투스 기기 (FB1, AC-FB1-36·40, D-FB1-09) ───
// B1 어댑터의 environment·createClient 자리에 넣는다. niimbluelib 클라이언트 모양(connect({ authorizedDevice })·끊김 알림·인쇄 작업)을
// 흉내 내고, 처음 N번의 첫 확인(협상)에 답하지 않게 정할 수 있다 — 그때 connect()는 niimbluelib과 같은 영어 예외를 던진다
// (어댑터가 그 글을 화면·상세에 내지 않는지 보려고). 시각·난수를 쓰지 않는다(늦추기는 주입한 타이머).

/** niimbluelib 0.47.1이 첫 확인 시간 초과에 던지는 글 (실제 윈도우 시험자 화면에 나온 글) */
export const NIIMBOT_NEGOTIATE_TIMEOUT_MESSAGE = 'Unable to perform initial negotiate: Error: Timeout waiting response (waited for c2)'

export interface FakeNiimbotBluetoothOptions {
  /** 기기 이름 (기본 `B1-FAKE01`) */
  readonly name?: string
  /** 연결한 뒤 알리는 모델 (기본 `B1`) */
  readonly model?: string
  /** 처음 몇 번의 첫 확인(협상)에 답하지 않을지 (기본 0) — connect()마다 하나씩 센다 */
  readonly unansweredNegotiations?: number
  /** 답하지 않을 때 예외를 던지기까지 (ms, 기본 0 — 타이머로) */
  readonly negotiationTimeoutMs?: number
  /** 고르기 창에서: 기기를 고른다(기본) · 창을 닫는다(NotFoundError) */
  readonly chooser?: 'pick' | 'cancel'
  /** getAvailability() 값 (기본 true) */
  readonly available?: boolean
  /**
   * 블루투스 장치가 정말 꺼짐 — 고르기 창이 `NotFoundError`(Bluetooth adapter not available.), 기억한 기기 잇기도 실패한다.
   * 기본은 getAvailability() 값을 따른다(false면 꺼짐). `available: false, adapterOff: false` = 윈도우 크롬 오판(D-QS1-03)
   */
  readonly adapterOff?: boolean
  /** 블루투스 기기 ID (Web Bluetooth BluetoothDevice.id, 기본 `fake-b1-01`) — 새로고침 뒤 getDevices로 찾는 값 */
  readonly id?: string
  /** 프린터 전원 (기본 켜짐). 꺼지면 이어진 연결이 끊기고, 다시 잇기(connect)가 실패하고, 고르기 창에 기기가 없다(닫음) */
  readonly powered?: boolean
  /** navigator.bluetooth.getDevices — 없음(기본 — 크롬 기본값) · 있음 · 있지만 예외 */
  readonly getDevices?: boolean | 'throws'
  /** 이미 허락된 기기인지 (getDevices가 돌려준다, 기본 false — 고르기 창에서 고르면 허락됨) — 새로고침 뒤를 흉내 낸다 */
  readonly permitted?: boolean
  readonly timer?: PrinterTimer
}

export interface FakeNiimbotPrint {
  readonly options: NiimbotTaskOptions
  readonly image: EncodedImage
}

export interface FakeNiimbotBluetooth {
  /** 어댑터의 environment 자리에 넣는다 (블루투스만 — 시리얼 없음) */
  readonly environment: PrinterEnvironment
  /** 어댑터의 createClient 자리에 넣는다 */
  readonly createClient: (method: ConnectionMethod) => NiimbotClientLike
  /** 고르기 창(requestDevice)을 부른 횟수 */
  readonly requests: number
  /** 클라이언트 connect()를 부른 횟수 (다시 잇기 포함) */
  readonly connectAttempts: number
  /** connect()마다 받은 기기 — 고른 기기를 넘겼으면 그 기기, 안 넘겼으면 undefined */
  readonly authorizedDevices: readonly unknown[]
  /** 고르기 창·getDevices가 돌려주는 기기 (늘 같은 객체) */
  readonly device: { readonly name: string; readonly id: string }
  /** 아직 답하지 않을 협상 수 */
  readonly unansweredNegotiations: number
  readonly connected: boolean
  /** 프린터 전원 */
  readonly powered: boolean
  /** 허락된 기기인지 (getDevices가 돌려주는지) */
  readonly permitted: boolean
  /** getDevices를 부른 횟수 */
  readonly getDevicesCalls: number
  /** 받은 인쇄 (받은 순서) */
  readonly printed: readonly FakeNiimbotPrint[]
  setUnansweredNegotiations(n: number): void
  setChooser(chooser: 'pick' | 'cancel'): void
  setAvailable(available: boolean): void
  /** 블루투스 장치 꺼짐을 정한다. undefined면 getAvailability() 값을 따른다 */
  setAdapterOff(off: boolean | undefined): void
  /** 프린터 전원 — 끄면 이어진 연결이 끊기고 다시 잇기를 거절한다, 켜면 다시 잇기를 받는다 */
  setPowered(on: boolean): void
  /** getDevices 없음·있음·예외 (환경 객체는 그대로 — 부를 때 본다) */
  setGetDevices(mode: boolean | 'throws'): void
  setPermitted(permitted: boolean): void
  /** 프린터 쪽에서 끊긴다 (전원은 그대로 — 다시 잇기를 받는다) */
  disconnect(): void
}

/** 꺼진 프린터에 잇는 GATT 실패 글 (크롬이 내는 글과 같은 꼴 — 시간 초과가 아니라 다시 잇지 않는다) */
export const FAKE_GATT_CONNECT_FAILED_MESSAGE = 'Connection failed for unknown reason.'

export function createFakeNiimbotBluetooth(options: FakeNiimbotBluetoothOptions = {}): FakeNiimbotBluetooth {
  const timer = options.timer ?? systemTimer
  const device = Object.freeze({ name: options.name ?? 'B1-FAKE01', id: options.id ?? 'fake-b1-01' })
  const model = options.model ?? 'B1'
  let unanswered = Math.max(0, Math.floor(options.unansweredNegotiations ?? 0))
  let chooser = options.chooser ?? 'pick'
  let available = options.available ?? true
  let adapterOffSetting = options.adapterOff
  const adapterOff = (): boolean => adapterOffSetting ?? !available
  let powered = options.powered ?? true
  let getDevicesMode: boolean | 'throws' = options.getDevices ?? false
  let permitted = options.permitted ?? false
  let getDevicesCalls = 0
  let requests = 0
  let connectAttempts = 0
  const authorizedDevices: unknown[] = []
  const printed: FakeNiimbotPrint[] = []
  /** 지금 이어진 클라이언트 (많아야 하나 — 프린터는 한 기기에만 이어진다) */
  const live = new Set<FakeClient>()

  const later = (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => timer.setTimeout(resolve, ms)))

  class FakeClient implements NiimbotClientLike {
    #connected = false
    readonly #listeners = new Set<() => void>()
    readonly protocol = {
      newPrintTask: (_name: string, taskOptions: NiimbotTaskOptions): NiimbotPrintTaskLike => {
        return {
          printInit: () => (this.#connected ? Promise.resolve() : Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))),
          printPage: (image: EncodedImage) => {
            if (!this.#connected) return Promise.reject(new FakeError('NetworkError', 'GATT 서버가 끊겼다'))
            printed.push({ options: { ...taskOptions }, image })
            return Promise.resolve()
          },
          waitForFinished: () => Promise.resolve(),
          printEnd: () => Promise.resolve(true),
        }
      },
    }

    async connect(connectOptions?: { readonly authorizedDevice?: unknown }): Promise<unknown> {
      await this.disconnect()
      connectAttempts++
      const given = connectOptions?.authorizedDevice
      authorizedDevices.push(given)
      if (given === undefined) {
        // 고른 기기를 넘기지 않으면 niimbluelib처럼 고르기 창을 띄운다
        requests++
        if (adapterOff()) throw new FakeError('NotFoundError', 'Bluetooth adapter not available.')
        if (chooser === 'cancel' || !powered) throw new FakeError('NotFoundError', 'User cancelled the requestDevice() chooser.')
        permitted = true
      } else if (given !== device) {
        // 이 프린터가 아닌 기기 — 잇지 못한다
        throw new FakeError('NetworkError', FAKE_GATT_CONNECT_FAILED_MESSAGE)
      }
      if (adapterOff() || !powered) throw new FakeError('NetworkError', FAKE_GATT_CONNECT_FAILED_MESSAGE)
      if (unanswered > 0) {
        unanswered--
        await later(options.negotiationTimeoutMs ?? 0)
        throw new Error(NIIMBOT_NEGOTIATE_TIMEOUT_MESSAGE)
      }
      for (const other of [...live]) other.dropFromPrinter()
      this.#connected = true
      live.add(this)
      return { deviceName: device.name, result: 1 }
    }

    disconnect(): Promise<void> {
      live.delete(this)
      this.#connected = false
      return Promise.resolve()
    }

    isConnected(): boolean {
      return this.#connected
    }

    getModelMetadata(): { readonly model: string } | undefined {
      return this.#connected ? { model } : undefined
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
      this.#connected = false
      live.delete(this)
      for (const listener of [...this.#listeners]) listener()
    }
  }

  const bluetooth = {
    requestDevice: (): Promise<unknown> => {
      requests++
      if (adapterOff()) return Promise.reject(new FakeError('NotFoundError', 'Bluetooth adapter not available.'))
      // 전원이 꺼진 프린터는 목록에 없다 — 판매자가 창을 닫는다
      if (chooser === 'cancel' || !powered) return Promise.reject(new FakeError('NotFoundError', 'User cancelled the requestDevice() chooser.'))
      permitted = true
      return Promise.resolve(device)
    },
    getAvailability: (): Promise<boolean> => Promise.resolve(available),
  }
  // getDevices는 정해 둔 때만 있다 (없음이 크롬 기본값) — 부를 때마다 본다
  Object.defineProperty(bluetooth, 'getDevices', {
    enumerable: true,
    get: () =>
      getDevicesMode === false
        ? undefined
        : (): Promise<readonly unknown[]> => {
            getDevicesCalls++
            if (getDevicesMode === 'throws') return Promise.reject(new FakeError('SecurityError', 'getDevices is not allowed'))
            return Promise.resolve(permitted ? [device] : [])
          },
  })

  return {
    environment: { bluetooth },
    createClient: () => new FakeClient(),
    get requests() {
      return requests
    },
    get connectAttempts() {
      return connectAttempts
    },
    get authorizedDevices() {
      return [...authorizedDevices]
    },
    device,
    get unansweredNegotiations() {
      return unanswered
    },
    get connected() {
      return live.size > 0
    },
    get powered() {
      return powered
    },
    get permitted() {
      return permitted
    },
    get getDevicesCalls() {
      return getDevicesCalls
    },
    get printed() {
      return [...printed]
    },
    setUnansweredNegotiations: (n) => {
      unanswered = Math.max(0, Math.floor(n))
    },
    setChooser: (value) => {
      chooser = value
    },
    setAvailable: (value) => {
      available = value
    },
    setAdapterOff: (value) => {
      adapterOffSetting = value
    },
    setPowered: (on) => {
      powered = on
      if (!on) for (const client of [...live]) client.dropFromPrinter()
    },
    setGetDevices: (mode) => {
      getDevicesMode = mode
    },
    setPermitted: (value) => {
      permitted = value
    },
    disconnect: () => {
      for (const client of [...live]) client.dropFromPrinter()
    },
  }
}
