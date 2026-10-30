// BleTransport → Web Bluetooth 모양 끼움 장치 (APP-03, LABEL_RULES L-12 3, D-APP-19) — @livejjim/printer의 Marklife 어댑터가 쓰는
// BluetoothEnvironment(requestDevice·getAvailability, 기기의 gatt.connect·getPrimaryService·getCharacteristic·쓰기·startNotifications·
// characteristicvaluechanged·gattserverdisconnected)를 네이티브 BLE 위에 만든다. 프린터 바이트(작업·조각·크레딧·끝 알림)는 printer 어댑터가
// 그대로 정하고, 이 파일은 바이트를 옮기기만 한다(패킷을 만들지 않는다).
// 기기 고르기는 부르는 쪽(chooseDevice)이 정한다 — 판매자의 고르기 창, 또는 기억한 기기(고르기 창 없음).
import type {
  BluetoothDeviceLike,
  BluetoothEnvironment,
  BluetoothLike,
  BluetoothRequestOptions,
  GattCharacteristicLike,
  GattServerLike,
  GattServiceLike,
} from '@livejjim/printer'
import { splitForMtu } from './chunk.ts'
import { PickCancelledError, RadioOffError } from './pick.ts'
import { BLE_ATT_HEADER, BLE_REQUEST_MTU, type BleCharacteristicInfo, type BleLink, type BleTransport } from './transport.ts'

/** 알림 사건 (printer는 이 타입을 내보내지 않는다 — 듣는 함수의 인자에서 꺼낸다) */
type CharacteristicValueEvent = Parameters<Parameters<GattCharacteristicLike['addEventListener']>[1]>[0]

/** 고를 기기 — name이 undefined면 이름을 모른다(앱을 다시 켠 뒤 기억한 ID만 있음): 먼저 이어서 기기가 알린 이름을 쓴다 */
export interface ChosenDevice {
  readonly id: string
  readonly name?: string | null
}

export interface BleBluetoothOptions {
  readonly transport: BleTransport
  /** requestDevice가 부른다 — 고른 기기, 닫으면 null */
  chooseDevice(request: BluetoothRequestOptions): Promise<ChosenDevice | null>
  /** requestDevice가 기기를 내줄 때 (이름까지 정해진 뒤) */
  onChosen?(device: { readonly id: string; readonly name: string | null }): void
  /** 안드로이드에서 요청할 MTU (기본 247) */
  readonly requestMtu?: number
  readonly connectTimeoutMs?: number
}

/** 끼움 장치가 내주는 기기 (Web Bluetooth BluetoothDevice 모양 + id) */
export interface BleBluetoothDevice extends BluetoothDeviceLike {
  readonly id: string
  readonly name: string | null
}

/** Web Bluetooth의 예외 이름을 단 오류 (printer 어댑터는 이름으로 읽는다) */
class NamedError extends Error {
  override readonly name: string
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

/** UUID를 128비트 소문자 꼴로 (16비트 `ff00`·32비트도 받는다) */
export function fullUuid(uuid: string): string {
  const u = uuid.toLowerCase()
  if (/^[0-9a-f]{4}$/.test(u)) return `0000${u}-0000-1000-8000-00805f9b34fb`
  if (/^[0-9a-f]{8}$/.test(u)) return `${u}-0000-1000-8000-00805f9b34fb`
  return u
}

/** 기기 하나 — 이을 때마다 새 BleLink를 쓴다 */
function createDevice(transport: BleTransport, id: string, initialName: string | null, options: Pick<BleBluetoothOptions, 'requestMtu' | 'connectTimeoutMs'>) {
  let name = initialName
  let link: BleLink | null = null
  let opening: Promise<BleLink> | null = null
  let characteristicsOf: Promise<readonly BleCharacteristicInfo[]> | null = null
  const stops = new Set<() => void>()
  const goneListeners = new Set<() => void>()

  const release = (): void => {
    link = null
    characteristicsOf = null
    for (const stop of [...stops]) {
      try {
        stop()
      } catch {
        // 이미 멈췄다
      }
    }
    stops.clear()
  }

  const open = (): Promise<BleLink> => {
    if (link !== null) return Promise.resolve(link)
    opening ??= (async () => {
      let mine: BleLink | null = null
      try {
        mine = await transport.connect(id, {
          requestMtu: options.requestMtu ?? BLE_REQUEST_MTU,
          ...(options.connectTimeoutMs === undefined ? {} : { timeoutMs: options.connectTimeoutMs }),
          onDisconnect: () => {
            // 프린터 쪽 끊김 — 이 연결일 때만 알린다
            if (mine === null || link !== mine) return
            release()
            for (const l of [...goneListeners]) l()
          },
        })
        link = mine
        return mine
      } finally {
        opening = null
      }
    })()
    return opening
  }

  const live = (): BleLink => {
    if (link === null) throw new NamedError('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.')
    return link
  }

  const characteristicOf = (owner: BleLink, info: BleCharacteristicInfo): GattCharacteristicLike => {
    const listeners = new Set<(event: CharacteristicValueEvent) => void>()
    /** 쓰기 — 링크의 한 번 쓰기(MTU − 3)보다 크면 나눠 쓴다(이어 붙이면 같은 바이트) */
    const write = async (bytes: Uint8Array, withResponse: boolean): Promise<void> => {
      if (link !== owner) throw new NamedError('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.')
      const pieces = bytes.byteLength > owner.mtu - BLE_ATT_HEADER ? splitForMtu(bytes, owner.mtu) : [bytes]
      for (const piece of pieces) {
        const copy = piece.slice()
        if (withResponse) await owner.writeWithResponse(info.serviceUuid, info.uuid, copy)
        else await owner.writeWithoutResponse(info.serviceUuid, info.uuid, copy)
      }
    }
    const characteristic: { value: DataView | null } & GattCharacteristicLike = {
      uuid: fullUuid(info.uuid),
      value: null,
      properties: { notify: info.notify, writeWithoutResponse: info.writeWithoutResponse, write: info.writeWithResponse !== false },
      writeValueWithoutResponse: (value: Uint8Array) => write(value, false),
      writeValue: (value: Uint8Array) => write(value, true),
      async startNotifications() {
        if (link !== owner) throw new NamedError('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.')
        const stop = await owner.monitor(info.serviceUuid, info.uuid, (bytes) => {
          const copy = bytes.slice()
          characteristic.value = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
          const event: CharacteristicValueEvent = { target: characteristic }
          for (const l of [...listeners]) l(event)
        })
        stops.add(stop)
        return characteristic
      },
      addEventListener(type, listener) {
        if (type === 'characteristicvaluechanged') listeners.add(listener)
      },
      removeEventListener(type, listener) {
        if (type === 'characteristicvaluechanged') listeners.delete(listener)
      },
    }
    return characteristic
  }

  const server: GattServerLike = {
    get connected() {
      return link !== null
    },
    async connect() {
      await open()
      return server
    },
    disconnect() {
      const gone = link
      release()
      // 판매자·어댑터가 끊었다 — gattserverdisconnected는 보내지 않는다(어댑터가 이미 듣기를 뗐다)
      if (gone !== null) void gone.disconnect().catch(() => undefined)
    },
    async getPrimaryService(uuid: string): Promise<GattServiceLike> {
      const owner = live()
      characteristicsOf ??= owner.characteristics()
      const all = await characteristicsOf
      const want = fullUuid(uuid)
      const mine = all.filter((c) => fullUuid(c.serviceUuid) === want)
      if (mine.length === 0) throw new NamedError('NotFoundError', `No Services matching UUID ${want} found in Device.`)
      return {
        async getCharacteristic(characteristicUuid: string) {
          const target = fullUuid(characteristicUuid)
          const info = mine.find((c) => fullUuid(c.uuid) === target)
          if (!info) throw new NamedError('NotFoundError', `No Characteristics matching UUID ${target} found in Service.`)
          return characteristicOf(owner, info)
        },
      }
    },
  }

  const device: BleBluetoothDevice = {
    id,
    get name() {
      return name
    },
    gatt: server,
    addEventListener(type, listener) {
      if (type === 'gattserverdisconnected') goneListeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'gattserverdisconnected') goneListeners.delete(listener)
    },
  }
  return {
    device,
    open,
    setName(next: string | null) {
      name = next
    },
  }
}

/**
 * BleTransport 위의 Web Bluetooth 모양 (navigator.bluetooth 자리). requestDevice는 장치 상태를 보고(꺼짐·권한 없음이면 printer 어댑터가
 * BLUETOOTH_OFF로 읽는 예외), chooseDevice로 기기를 정하고(null이면 NOT_SELECTED로 읽는 예외), 이름을 모르는 기기는 먼저 이어 기기가 알린 이름을 쓴다
 */
export function createBleBluetooth(options: BleBluetoothOptions): BluetoothLike {
  const { transport } = options
  return {
    async requestDevice(request: BluetoothRequestOptions): Promise<BluetoothDeviceLike> {
      const state = await transport.state()
      if (state === 'off' || state === 'unauthorized') throw new RadioOffError()
      const chosen = await options.chooseDevice(request)
      if (chosen === null) throw new PickCancelledError()
      const made = createDevice(transport, chosen.id, chosen.name ?? null, options)
      if (chosen.name === undefined) {
        // 이름을 모른다 — 이어서 기기가 알린 이름으로 기종을 정한다(이은 연결은 gatt.connect()가 그대로 쓴다)
        const link = await made.open()
        made.setName(link.name ?? null)
      }
      options.onChosen?.({ id: made.device.id, name: made.device.name })
      return made.device
    },
    async getAvailability() {
      return (await transport.state()) === 'on'
    },
  }
}

/** printer 어댑터의 environment 자리 — 이 기기에 BLE가 없으면 빈 환경(연결 방법 없음) */
export function bleBluetoothEnvironment(bluetooth: BluetoothLike, supported: () => boolean): () => BluetoothEnvironment {
  return () => (supported() ? { bluetooth } : {})
}
