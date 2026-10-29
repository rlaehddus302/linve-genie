// 가짜 B1 (바이트 수준) + 가짜 BLE 전송 — 시험·리허설용, 제품 목록에 없다 (APP-03 AC1 "모의 BLE 장치", D-APP-17).
// niimbluelib 패킷(55 55 cmd len data chk aa aa)을 받아 B1처럼 답한다: 연결 협상, 모델(B1 = 4096), 심박, 농도·라벨 종류·인쇄 시작·쪽 시작·쪽 크기,
// 래스터 줄(일방향, 셈만), 쪽 끝, 인쇄 상태(쪽을 다 받으면 1쪽 100%), 인쇄 끝. 모르는 요청은 "지원 안 함"(NotSupported — 클라이언트가 조용히 넘긴다).
// 받은 바이트를 모두 기록해 두 길(Web Bluetooth·네이티브 BLE)이 같은 바이트를 보내는지 비교할 수 있다. 시각·난수를 쓰지 않는다(답은 넘긴 예약 함수로).
import { ConnectResult, HeartbeatType, NiimbotPacket, PrinterInfoType, RequestCommandId, ResponseCommandId } from '@mmote/niimbluelib'
import type { BleCharacteristicInfo, BleDeviceInfo, BleLink, BleRadioState, BleTransport } from './transport.ts'
import { BLE_DEFAULT_MTU } from './transport.ts'

/** niimbluelib 블루투스 클라이언트가 찾는 서비스와 흔한 특성 UUID (NIIMBOT) */
export const FAKE_B1_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
export const FAKE_B1_CHARACTERISTIC = 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'
/** B1 모델 번호 (niimbluelib modelsLibrary) */
export const B1_MODEL_ID = 4096

export interface FakePrintedPage {
  readonly rows: number
  readonly cols: number
  readonly copies: number
  readonly density: number
  readonly labelType: number
  /** 받은 래스터 줄 수 (빈 줄 묶음 포함, 줄 번호 기준) */
  readonly rasterRows: number
  /** 이 쪽의 비트맵(점) — 줄 번호 → 바이트들 (빈 줄은 0). 줄 폭 = cols/8 바이트 */
  readonly bitmap: Uint8Array
}

export interface FakeB1Options {
  /** 심박·상태에 보일 배터리 (기본 100) */
  readonly battery?: number
  /** 답을 보내는 예약 — 기본 setTimeout 0 (클라이언트가 답 듣기를 건 뒤에 닿게) */
  readonly schedule?: (run: () => void) => void
  /** 답하지 않을 요청 (시간 초과 흉내) */
  readonly silent?: readonly number[]
  /** 모델 번호 (기본 B1 = 4096). 다른 값이면 어댑터가 WRONG_MODEL로 거른다 */
  readonly modelId?: number
}

/** 바이트 수준 B1 */
export interface FakeB1 {
  /** 프린터가 받은 바이트 (쓰기 조각을 받은 순서로 이어 붙임) */
  readonly received: Uint8Array
  /** 받은 쓰기 조각 수 */
  readonly writes: number
  /** 풀어 낸 요청 패킷 (명령 번호) */
  readonly requests: readonly number[]
  /** 끝까지 받은 쪽 */
  readonly printed: readonly FakePrintedPage[]
  /** 프린터에 바이트를 쓴다 (전송이 부른다) */
  write(bytes: Uint8Array): void
  /** 알림(프린터 → 앱)을 받을 곳 */
  onNotify(listener: (bytes: Uint8Array) => void): () => void
  reset(): void
}

export function createFakeB1(options: FakeB1Options = {}): FakeB1 {
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0))
  const silent = new Set(options.silent ?? [])
  const battery = options.battery ?? 100
  const modelId = options.modelId ?? B1_MODEL_ID
  const listeners = new Set<(bytes: Uint8Array) => void>()
  let buffer = new Uint8Array(0)
  let received = new Uint8Array(0)
  let writes = 0
  const requests: number[] = []
  const printed: FakePrintedPage[] = []
  let density = 3
  let labelType = 1
  let page: { rows: number; cols: number; copies: number; rasterRows: number; bitmap: Uint8Array; done: boolean } | null = null

  const notify = (packet: NiimbotPacket): void => {
    const bytes = packet.toBytes()
    schedule(() => {
      for (const l of [...listeners]) l(bytes)
    })
  }
  const reply = (command: ResponseCommandId, data: readonly number[]): void => notify(new NiimbotPacket(command, [...data]))
  const notSupported = (): void => reply(ResponseCommandId.In_NotSupported, [1])

  const u16 = (hi: number | undefined, lo: number | undefined): number => ((hi ?? 0) << 8) | (lo ?? 0)

  const handle = (cmd: number, data: Uint8Array): void => {
    requests.push(cmd)
    if (silent.has(cmd)) return
    switch (cmd) {
      case RequestCommandId.Connect:
        reply(ResponseCommandId.In_Connect, [ConnectResult.ConnectedNew])
        return
      case RequestCommandId.PrinterInfo:
        if (data[0] === PrinterInfoType.PrinterModelId) reply(ResponseCommandId.In_PrinterInfoPrinterCode, [(modelId >> 8) & 0xff, modelId & 0xff])
        else if (data[0] === PrinterInfoType.BatteryChargeLevel) reply(ResponseCommandId.In_PrinterInfoChargeLevel, [battery])
        else notSupported()
        return
      case RequestCommandId.Heartbeat:
        if (data[0] === HeartbeatType.Advanced1) {
          // B1 꼴 13바이트: 9 건너뜀, 덮개(0 = 닫힘), 배터리, 종이(0 = 있음), RFID(1 = 성공)
          reply(ResponseCommandId.In_HeartbeatAdvanced1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, battery, 0, 1])
        } else notSupported()
        return
      case RequestCommandId.SetDensity:
        density = data[0] ?? density
        reply(ResponseCommandId.In_SetDensity, [1])
        return
      case RequestCommandId.SetLabelType:
        labelType = data[0] ?? labelType
        reply(ResponseCommandId.In_SetLabelType, [1])
        return
      case RequestCommandId.PrintStart:
        reply(ResponseCommandId.In_PrintStart, [1])
        return
      case RequestCommandId.PageStart:
        page = { rows: 0, cols: 0, copies: 1, rasterRows: 0, bitmap: new Uint8Array(0), done: false }
        reply(ResponseCommandId.In_PageStart, [1])
        return
      case RequestCommandId.SetPageSize:
        if (page !== null) {
          page.rows = u16(data[0], data[1])
          page.cols = u16(data[2], data[3])
          page.copies = data.length >= 6 ? u16(data[4], data[5]) : 1
          page.bitmap = new Uint8Array(Math.ceil(page.cols / 8) * page.rows)
        }
        reply(ResponseCommandId.In_SetPageSize, [1])
        return
      case RequestCommandId.PrintEmptyRow: {
        // 일방향: pos u16, repeats
        if (page !== null) page.rasterRows += data[2] ?? 1
        return
      }
      case RequestCommandId.PrintBitmapRow: {
        // 일방향: pos u16, 셈 3바이트, repeats, 줄 바이트
        if (page !== null) {
          const pos = u16(data[0], data[1])
          const repeats = data[5] ?? 1
          const row = data.subarray(6)
          const width = Math.ceil(page.cols / 8)
          for (let r = 0; r < repeats; r++) {
            const y = pos + r
            if (y < page.rows) page.bitmap.set(row.subarray(0, width), y * width)
          }
          page.rasterRows += repeats
        }
        return
      }
      case RequestCommandId.PrintBitmapRowIndexed: {
        // 일방향 (검정 점 6개 이하인 줄): pos u16, 셈 3바이트, repeats, 점 x 자리 u16들
        if (page !== null) {
          const pos = u16(data[0], data[1])
          const repeats = data[5] ?? 1
          const width = Math.ceil(page.cols / 8)
          for (let r = 0; r < repeats; r++) {
            const y = pos + r
            if (y >= page.rows) continue
            for (let i = 6; i + 1 < data.length; i += 2) {
              const x = u16(data[i], data[i + 1])
              const at = y * width + (x >> 3)
              page.bitmap[at] = (page.bitmap[at] ?? 0) | (0x80 >> (x & 7))
            }
          }
          page.rasterRows += repeats
        }
        return
      }
      case RequestCommandId.PageEnd:
        if (page !== null) {
          page.done = true
          printed.push({ rows: page.rows, cols: page.cols, copies: page.copies, density, labelType, rasterRows: page.rasterRows, bitmap: page.bitmap })
        }
        reply(ResponseCommandId.In_PageEnd, [1])
        return
      case RequestCommandId.PrintStatus: {
        const done = page?.done === true
        reply(ResponseCommandId.In_PrintStatus, [0, done ? 1 : 0, done ? 100 : 0, done ? 100 : 0])
        return
      }
      case RequestCommandId.PrintEnd:
        page = null
        reply(ResponseCommandId.In_PrintEnd, [1])
        return
      default:
        notSupported()
    }
  }

  const parse = (): void => {
    for (;;) {
      // Connect 패킷은 앞에 03이 붙는다 (niimbluelib) — 실제 프린터처럼 건너뛴다
      if (buffer.length >= 3 && buffer[0] === 0x03 && buffer[1] === 0x55 && buffer[2] === 0x55) buffer = buffer.subarray(1)
      if (buffer.length < 7) return
      if (buffer[0] !== 0x55 || buffer[1] !== 0x55) {
        buffer = buffer.subarray(1)
        continue
      }
      const len = buffer[3] ?? 0
      const total = 7 + len
      if (buffer.length < total) return
      const packet = buffer.subarray(0, total)
      buffer = buffer.subarray(total)
      if (packet[total - 2] !== 0xaa || packet[total - 1] !== 0xaa) continue
      handle(packet[2] ?? 0, packet.subarray(4, 4 + len))
    }
  }

  return {
    get received() {
      return received
    },
    get writes() {
      return writes
    },
    get requests() {
      return requests
    },
    get printed() {
      return printed
    },
    write(bytes) {
      writes++
      const copy = new Uint8Array(bytes)
      const joined = new Uint8Array(received.length + copy.length)
      joined.set(received, 0)
      joined.set(copy, received.length)
      received = joined
      const next = new Uint8Array(buffer.length + copy.length)
      next.set(buffer, 0)
      next.set(copy, buffer.length)
      buffer = next
      parse()
    },
    onNotify(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      buffer = new Uint8Array(0)
      received = new Uint8Array(0)
      writes = 0
      requests.length = 0
      printed.length = 0
      page = null
    },
  }
}

export interface FakeBleTransportOptions {
  readonly device?: BleDeviceInfo
  /** 장치 상태 (기본 on) */
  readonly radio?: BleRadioState
  /** 협상된 MTU (기본 23) */
  readonly mtu?: number
  /** 연결이 실패한다 */
  readonly connectFails?: boolean
  /** 찾기에 장치가 보이지 않는다 */
  readonly invisible?: boolean
  /** 특성 목록 (기본: NIIMBOT 서비스의 notify+writeWithoutResponse 하나) */
  readonly characteristics?: readonly BleCharacteristicInfo[]
  readonly printer?: FakeB1Options
}

export interface FakeBleTransport {
  readonly transport: BleTransport
  readonly printer: FakeB1
  readonly device: BleDeviceInfo
  readonly connected: boolean
  /** connect 성공 횟수 */
  readonly connectCount: number
  /** 지금 켜진 찾기 수 */
  readonly scanning: number
  /** 프린터 쪽에서 끊는다 */
  dropLink(): void
  setRadio(state: BleRadioState): void
  setConnectFails(fails: boolean): void
}

export function createFakeBleTransport(options: FakeBleTransportOptions = {}): FakeBleTransport {
  const device = options.device ?? { id: 'FA:KE:B1:00:00:01', name: 'B1-FAKE01' }
  const mtu = options.mtu ?? BLE_DEFAULT_MTU
  const printer = createFakeB1(options.printer)
  const characteristics = options.characteristics ?? [{ serviceUuid: FAKE_B1_SERVICE, uuid: FAKE_B1_CHARACTERISTIC, notify: true, writeWithoutResponse: true }]
  let radio = options.radio ?? 'on'
  let connectFails = options.connectFails ?? false
  const stateListeners = new Set<(state: BleRadioState) => void>()
  let current: { onDisconnect: () => void } | null = null
  let connectCount = 0
  let scanning = 0

  const transport: BleTransport = {
    state: () => Promise.resolve(radio),
    onStateChange(listener) {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    scan(_filter, onFound) {
      scanning++
      let stopped = false
      if (!options.invisible && radio === 'on') {
        queueMicrotask(() => {
          if (!stopped) onFound(device)
        })
      }
      return () => {
        if (stopped) return
        stopped = true
        scanning--
      }
    },
    async connect(id, connectOptions) {
      if (radio !== 'on') throw new Error('Bluetooth is not enabled')
      if (connectFails || id !== device.id) throw new Error('Device disconnected')
      if (current !== null) current.onDisconnect()
      const me = { onDisconnect: connectOptions.onDisconnect }
      current = me
      connectCount++
      let alive = true
      let unlisten: (() => void) | null = null
      const link: BleLink = {
        id,
        mtu,
        characteristics: () => Promise.resolve(characteristics),
        monitor(_service, _characteristic, onValue) {
          unlisten?.()
          unlisten = printer.onNotify((bytes) => {
            if (alive) onValue(bytes)
          })
          return Promise.resolve(() => {
            unlisten?.()
            unlisten = null
          })
        },
        async writeWithoutResponse(_service, _characteristic, bytes) {
          if (!alive) throw new Error('GATT Server is disconnected')
          printer.write(bytes)
        },
        async disconnect() {
          alive = false
          unlisten?.()
          if (current === me) current = null
        },
      }
      // 프린터 쪽 끊김은 dropLink가 부른다
      const drop = me.onDisconnect
      me.onDisconnect = () => {
        alive = false
        unlisten?.()
        if (current === me) current = null
        drop()
      }
      return link
    },
  }

  return {
    transport,
    printer,
    device,
    get connected() {
      return current !== null
    },
    get connectCount() {
      return connectCount
    },
    get scanning() {
      return scanning
    },
    dropLink() {
      current?.onDisconnect()
    },
    setRadio(state) {
      radio = state
      for (const l of [...stateListeners]) l(state)
    },
    setConnectFails(fails) {
      connectFails = fails
    },
  }
}
