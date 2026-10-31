// 앱 Marklife 어댑터 (APP-03, LABEL_RULES L-7·L-12, D-N1-04~06·D-QS1-01·02) — @livejjim/printer createMarklifeAdapter를 그대로 쓰고
// 환경(Web Bluetooth 모양)만 네이티브 BLE 끼움 장치(bluetooth.ts)로 바꾼다. 그래서 이름으로 고르기·GATT 꾸러미 A→C·조각·크레딧·끝 알림 `AA`·
// 시간 초과·출력 결과는 웹과 같은 코드가 정한다(이 파일에 패킷 만들기가 없다).
// 웹 Marklife 어댑터에는 기억이 없다 — 앱은 마지막으로 이은 기기를 기억하고, 기억한 기기로는 고르기 창 없이 잇는다
// (RememberingPrinterAdapter: connect = 늘 고르기 창, reconnect = 기억한 기기가 있으면 그것(실패하면 기억을 지움), connectRemembered = 기억한 기기로만).
import {
  LABEL_PROFILES,
  MARKLIFE_MESSAGES,
  RememberBox,
  createMarklifeAdapter,
  printerErrorWithMessage,
  profileForDeviceName,
  type GattBundleId,
  type ModelProfile,
  type PrinterResult,
  type PrinterTimer,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import { bleBluetoothEnvironment, createBleBluetooth, type ChosenDevice } from './bluetooth.ts'
import { pickFromScan, type DevicePicker } from './pick.ts'
import type { BleDeviceInfo, BleRadioState, BleTransport } from './transport.ts'

export interface NativeMarklifeAdapterOptions {
  readonly transport: BleTransport
  readonly pickDevice: DevicePicker
  /** 켤 프로필 (기본: LABEL_PROFILES — Marklife 9종 + 바우아토, D-PRN2-01) */
  readonly profiles?: readonly ModelProfile[]
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
  readonly packetIntervalMs?: number
  readonly maxPacketBytes?: number
  readonly creditWaitMs?: number
  /** 안드로이드에서 요청할 MTU (기본 247) */
  readonly requestMtu?: number
  /** 찾기·고르기를 대신한다 (한 목록 고르기 createPrinterPicker가 이미 고른 기기를 넘긴다). 있으면 pickDevice는 부르지 않는다. null이면 닫음 */
  readonly selectDevice?: () => Promise<BleDeviceInfo | null>
}

export interface NativeMarklifeAdapter extends RememberingPrinterAdapter {
  /** 연결한 프린터의 프로필 (연결 전에는 켠 첫 프로필) */
  readonly profile: ModelProfile
  /** 연결한 GATT 꾸러미 (연결 전 null) */
  readonly bundle: GattBundleId | null
}

/** 이름이 켠 프로필의 앞자리로 시작하는지 — L-12 3 그대로(대소문자를 가린다). 목록과 연결이 같은 판단을 쓴다 */
export function matchesMarklifeName(name: string | null, profiles: readonly ModelProfile[] = LABEL_PROFILES): boolean {
  return profileForDeviceName(name, profiles) !== undefined
}

export function createNativeMarklifeAdapter(options: NativeMarklifeAdapterOptions): NativeMarklifeAdapter {
  const { transport, pickDevice } = options
  if (typeof transport?.connect !== 'function' || typeof pickDevice !== 'function') throw new TypeError('BLE 전송과 고르기 창이 필요하다')
  const profiles = [...(options.profiles ?? LABEL_PROFILES)]
  let radio: BleRadioState = 'unknown'
  void transport.state().then(
    (state) => {
      radio = state
    },
    () => undefined,
  )
  transport.onStateChange((state) => {
    radio = state
  })

  const memory = new RememberBox<string>()
  /** 이번 시도에서 고를 기기: 고르기 창 · 기억한 기기 */
  let plan: { readonly kind: 'pick' } | { readonly kind: 'memory'; readonly id: string } = { kind: 'pick' }
  /** 이번 시도에서 requestDevice가 내준 기기 */
  let chosen: { readonly id: string; readonly name: string | null } | null = null
  /** 이 앱이 켜 있는 동안 본 기기 이름 (기억한 기기로 이을 때 기종을 정한다) */
  const names = new Map<string, string | null>()

  const chooseDevice = async (request: { readonly filters: readonly { readonly namePrefix: string }[] }): Promise<ChosenDevice | null> => {
    if (plan.kind === 'memory') {
      const id = plan.id
      return names.has(id) ? { id, name: names.get(id) ?? null } : { id }
    }
    if (options.selectDevice !== undefined) return options.selectDevice()
    const namePrefixes = request.filters.map((f) => f.namePrefix)
    // 대소문자를 가려 찾고(L-12 3), 연결 때와 같은 판단으로 한 번 더 거른다 — 목록에 보인 기기가 이름 때문에 거절되지 않게
    return pickFromScan(transport, { namePrefixes, matchCase: true }, pickDevice, (device) => matchesMarklifeName(device.name, profiles))
  }

  const bluetooth = createBleBluetooth({
    transport,
    chooseDevice,
    onChosen: (device) => {
      chosen = device
    },
    ...(options.requestMtu === undefined ? {} : { requestMtu: options.requestMtu }),
  })

  const inner = createMarklifeAdapter({
    profiles,
    environment: bleBluetoothEnvironment(bluetooth, () => radio !== 'unsupported'),
    ...(options.timer === undefined ? {} : { timer: options.timer }),
    ...(options.printTimeoutMs === undefined ? {} : { printTimeoutMs: options.printTimeoutMs }),
    ...(options.packetIntervalMs === undefined ? {} : { packetIntervalMs: options.packetIntervalMs }),
    ...(options.maxPacketBytes === undefined ? {} : { maxPacketBytes: options.maxPacketBytes }),
    ...(options.creditWaitMs === undefined ? {} : { creditWaitMs: options.creditWaitMs }),
  })

  let connecting: Promise<PrinterResult> | undefined
  let generation = 0
  const disconnectedResult = (): PrinterResult => ({ ok: false, error: printerErrorWithMessage('DISCONNECTED', MARKLIFE_MESSAGES.DISCONNECTED) })

  /** mode: pick = 늘 고르기 창 · prefer = 기억한 기기가 있으면 그것("다시 연결") · only = 기억한 기기로만(저절로 다시 잇기) */
  const attempt = async (mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    const started = generation
    const saved = memory.value
    const id = mode !== 'pick' && saved?.method === 'bluetooth' ? saved.deviceId : null
    // 기억이 없으면 시도하지 않는다(상태도 그대로)
    if (mode === 'only' && id === null) return disconnectedResult()
    plan = id === null ? { kind: 'pick' } : { kind: 'memory', id }
    chosen = null
    let result: PrinterResult
    try {
      result = await inner.connect('bluetooth')
    } finally {
      plan = { kind: 'pick' }
    }
    if (generation !== started) return result.ok ? disconnectedResult() : result
    const picked = chosen as { readonly id: string; readonly name: string | null } | null
    if (result.ok && picked !== null) {
      names.set(picked.id, picked.name)
      memory.remember('bluetooth', picked.id, { method: 'bluetooth', deviceId: picked.id })
    } else if (!result.ok && id !== null && mode === 'prefer') {
      // "다시 연결"로 기억한 기기에 이은 시도가 실패 — 다음 "다시 연결"은 고르기 창부터 (D-QS1-01 (4))
      memory.forget()
    }
    return result
  }

  const run = (mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    if (inner.state === 'CONNECTED' || inner.state === 'PRINTING') return Promise.resolve({ ok: true })
    // 세 연결 길은 같은 시도 하나를 나눠 기다린다
    connecting ??= attempt(mode).finally(() => {
      connecting = undefined
    })
    return connecting
  }

  const adapter: NativeMarklifeAdapter = {
    get profile() {
      return inner.profile
    },
    get bundle() {
      return inner.bundle
    },
    get state() {
      return inner.state
    },
    get hasRemembered() {
      return memory.has
    },
    get remembered() {
      return memory.value
    },
    onStateChange: (listener) => inner.onStateChange(listener),
    onRememberedChange: (listener) => memory.listen(listener),
    availableMethods: () => inner.availableMethods(),
    restoreRemembered(value) {
      memory.restore(value)
    },
    connect: (method) => (method === 'bluetooth' ? run('pick') : inner.connect(method)),
    reconnect: (method) => (method === 'bluetooth' ? run('prefer') : inner.connect(method)),
    connectRemembered: () => run('only'),
    async disconnect() {
      generation++
      await inner.disconnect()
    },
    print: (image, printOptions) => inner.print(image, printOptions),
  }
  return adapter
}
