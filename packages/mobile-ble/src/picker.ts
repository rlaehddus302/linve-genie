// 한 목록 프린터 고르기 (APP-03, LABEL_RULES L-7·L-12 3) — 앱 화면은 "프린터 고르기" 하나만 쓴다.
// 찾은 기기를 한 목록에 보이고, 판매자가 고른 기기의 이름으로 기종을 갈라 그 어댑터(B1 = createNativeB1Adapter, Marklife = createNativeMarklifeAdapter)로 보낸다.
// Marklife는 NIIMBOT 서비스 UUID(e7810a71-…)도 알리고 이름 첫 글자(P·S·L…)도 NIIMBOT 거르기에 걸려 B1 목록에 섞인다 — 이름으로 가르면
// 판매자는 기종을 몰라도 목록에서 자기 프린터를 고르면 된다(잘못된 어댑터로 이어 "다른 프린터"를 보는 일이 없다).
// - Marklife 이름(L-12 3 — 대소문자 가림, `P12_`) → Marklife. Marklife 앞자리를 대소문자만 다르게 가진 이름(`p12_…`)은 어느 쪽도 받지 않아 목록에 넣지 않는다.
// - 그 밖에 NIIMBOT 거르기(이름 첫 글자·서비스)에 걸린 기기 → B1 (B1 확인은 이은 뒤 모델 정보로 — L-7).
// 기억은 마지막으로 이은 기기 하나다(RememberedPrinter — ID만). 앱을 다시 켜 기종을 모르면 잠깐 찾아 그 ID의 이름으로 정한다.
import {
  B1_PROFILE,
  MARKLIFE_MESSAGES,
  MARKLIFE_PROFILES,
  RememberBox,
  niimbotRequestOptions,
  printerErrorWithMessage,
  sameRememberedPrinter,
  systemTimer,
  type AdapterProfile,
  type ConnectionState,
  type MarklifeErrorCode,
  type ModelProfile,
  type PrinterProfile,
  type PrinterResult,
  type PrinterTimer,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import { createNativeB1Adapter, looksLikeMarklifeName } from './adapter.ts'
import type { NiimbotBleClientOptions } from './client.ts'
import { createNativeMarklifeAdapter, matchesMarklifeName, type NativeMarklifeAdapter } from './marklife.ts'
import { pickFromScan, type DevicePicker } from './pick.ts'
import type { BleDeviceInfo, BleRadioState, BleScanFilter, BleTransport } from './transport.ts'

/** 기종 */
export type PrinterKind = 'NIIMBOT' | 'MARKLIFE'

/** 앱을 다시 켠 뒤 기억한 기기의 기종을 정하려고 찾는 시간 (ms) */
export const IDENTIFY_SCAN_MS = 5_000

export interface PrinterPickerOptions {
  readonly transport: BleTransport
  readonly pickDevice: DevicePicker
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
  /** B1 첫 확인 다시 잇기 전 쉬는 시간 */
  readonly reconnectDelayMs?: number
  /** 켤 NIIMBOT 프로필 (기본 B1 하나) */
  readonly niimbotProfiles?: readonly PrinterProfile[]
  /** 켤 Marklife 프로필 (기본 9종 — 바우아토는 일부러 넘길 때만) */
  readonly marklifeProfiles?: readonly ModelProfile[]
  readonly client?: NiimbotBleClientOptions
  readonly marklife?: { readonly packetIntervalMs?: number; readonly maxPacketBytes?: number; readonly creditWaitMs?: number }
  /** 기억한 기기의 기종을 찾는 시간 (기본 5초) */
  readonly identifyScanMs?: number
}

export interface PrinterPicker extends RememberingPrinterAdapter {
  /** 이은(잇는 중인) 프린터의 기종 — 아직 없으면 null */
  readonly kind: PrinterKind | null
  readonly profile: AdapterProfile
}

/**
 * 이름으로 기종 가르기: Marklife 이름(L-12 3 그대로) → MARKLIFE, Marklife 앞자리를 대소문자만 다르게 가진 이름 → null(받지 않음), 그 밖 → NIIMBOT.
 * NIIMBOT은 찾기 거르기(이름 첫 글자·서비스)를 지난 기기만 여기 온다
 */
export function printerKindOf(name: string | null, marklifeProfiles: readonly ModelProfile[] = MARKLIFE_PROFILES): PrinterKind | null {
  if (matchesMarklifeName(name, marklifeProfiles)) return 'MARKLIFE'
  if (looksLikeMarklifeName(name)) return null
  return 'NIIMBOT'
}

export function createPrinterPicker(options: PrinterPickerOptions): PrinterPicker {
  const { transport, pickDevice } = options
  if (typeof transport?.connect !== 'function' || typeof pickDevice !== 'function') throw new TypeError('BLE 전송과 고르기 창이 필요하다')
  const timer = options.timer ?? systemTimer
  const marklifeProfiles = [...(options.marklifeProfiles ?? MARKLIFE_PROFILES)]
  const identifyMs = options.identifyScanMs ?? IDENTIFY_SCAN_MS

  const request = niimbotRequestOptions()
  /** 한 목록 찾기 — NIIMBOT 거르기(이름 첫 글자·서비스) + Marklife 앞자리 */
  const filter: BleScanFilter = {
    serviceUuids: request.filters.flatMap((f) => ('services' in f ? f.services : [])),
    namePrefixes: [...request.filters.flatMap((f) => ('namePrefix' in f ? [f.namePrefix] : [])), ...marklifeProfiles.flatMap((p) => (p.namePrefix ? [p.namePrefix] : []))],
  }
  const kindOf = (device: BleDeviceInfo): PrinterKind | null => printerKindOf(device.name, marklifeProfiles)

  /** 한 목록에서 고른 기기 — 안쪽 어댑터의 고르기 대신 넘긴다 */
  let preselected: BleDeviceInfo | null = null
  const selectDevice = (): Promise<BleDeviceInfo | null> => Promise.resolve(preselected)

  const niimbot = createNativeB1Adapter({
    transport,
    pickDevice,
    selectDevice,
    ...(options.timer === undefined ? {} : { timer: options.timer }),
    ...(options.printTimeoutMs === undefined ? {} : { printTimeoutMs: options.printTimeoutMs }),
    ...(options.reconnectDelayMs === undefined ? {} : { reconnectDelayMs: options.reconnectDelayMs }),
    ...(options.niimbotProfiles === undefined ? {} : { profiles: options.niimbotProfiles }),
    ...(options.client === undefined ? {} : { client: options.client }),
  })
  const marklife: NativeMarklifeAdapter = createNativeMarklifeAdapter({
    transport,
    pickDevice,
    selectDevice,
    profiles: marklifeProfiles,
    ...(options.timer === undefined ? {} : { timer: options.timer }),
    ...(options.printTimeoutMs === undefined ? {} : { printTimeoutMs: options.printTimeoutMs }),
    ...(options.marklife?.packetIntervalMs === undefined ? {} : { packetIntervalMs: options.marklife.packetIntervalMs }),
    ...(options.marklife?.maxPacketBytes === undefined ? {} : { maxPacketBytes: options.marklife.maxPacketBytes }),
    ...(options.marklife?.creditWaitMs === undefined ? {} : { creditWaitMs: options.marklife.creditWaitMs }),
  })
  const adapters: Readonly<Record<PrinterKind, RememberingPrinterAdapter>> = { NIIMBOT: niimbot, MARKLIFE: marklife }

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

  let active: PrinterKind | null = null
  /** 한 목록 고르기 창이 떠 있는 동안 — 상태는 CONNECTING, 안쪽 어댑터 상태를 따르지 않는다 */
  let picking = false
  const state = new StateBoxLike()
  const memory = new RememberBox<string>()
  /** 이 앱이 켜 있는 동안 정한 기기의 기종 */
  const kinds = new Map<string, PrinterKind>()
  let connecting: Promise<PrinterResult> | undefined
  let generation = 0

  for (const kind of ['NIIMBOT', 'MARKLIFE'] as const) {
    const adapter = adapters[kind]
    adapter.onStateChange((next) => {
      if (active === kind && !picking) state.set(next)
    })
    adapter.onRememberedChange((value) => {
      if (active !== kind) return
      if (value === null) {
        memory.forget()
        return
      }
      if (value.method !== 'bluetooth') return
      kinds.set(value.deviceId, kind)
      memory.remember('bluetooth', value.deviceId, value)
    })
  }

  const fail = (code: MarklifeErrorCode): PrinterResult => ({ ok: false, error: printerErrorWithMessage(code, MARKLIFE_MESSAGES[code]) })

  /** 다른 기종이 이어져 있으면 끊고 이 기종을 쓴다 */
  const use = async (kind: PrinterKind): Promise<RememberingPrinterAdapter> => {
    const other = adapters[kind === 'NIIMBOT' ? 'MARKLIFE' : 'NIIMBOT']
    if (other.state !== 'DISCONNECTED') await other.disconnect()
    active = kind
    return adapters[kind]
  }

  /** 기억한 ID의 기종 — 이번에 정한 것, 없으면 잠깐 찾아 그 ID의 이름으로 (못 찾으면 null) */
  const identify = (id: string): Promise<PrinterKind | null> => {
    const known = kinds.get(id)
    if (known !== undefined) return Promise.resolve(known)
    return new Promise<PrinterKind | null>((resolve) => {
      let done = false
      let stop: (() => void) | null = null
      const finish = (kind: PrinterKind | null): void => {
        if (done) return
        done = true
        timer.clearTimeout(handle)
        stop?.()
        if (kind !== null) kinds.set(id, kind)
        resolve(kind)
      }
      const handle = timer.setTimeout(() => finish(null), identifyMs)
      stop = transport.scan(filter, (device) => {
        if (device.id === id) finish(kindOf(device))
      })
      if (done) stop()
    })
  }

  const syncInner = (adapter: RememberingPrinterAdapter): void => {
    if (!sameRememberedPrinter(adapter.remembered, memory.value)) adapter.restoreRemembered(memory.value)
  }

  const pickAndConnect = async (started: number): Promise<PrinterResult> => {
    const radioNow = await transport.state().catch((): BleRadioState => 'unknown')
    radio = radioNow
    if (radioNow === 'unsupported') return niimbot.connect('bluetooth')
    if (radioNow === 'off' || radioNow === 'unauthorized') return fail('BLUETOOTH_OFF')
    picking = true
    state.set('CONNECTING')
    try {
      let picked: BleDeviceInfo | null
      try {
        picked = await pickFromScan(transport, filter, pickDevice, (device) => kindOf(device) !== null)
      } catch {
        picked = null
      }
      if (generation !== started) return fail('DISCONNECTED')
      const kind = picked === null ? null : kindOf(picked)
      if (picked === null || kind === null) return fail('NOT_SELECTED')
      const adapter = await use(kind)
      preselected = picked
      try {
        const result = await adapter.connect('bluetooth')
        if (result.ok) kinds.set(picked.id, kind)
        return result
      } finally {
        preselected = null
      }
    } finally {
      // 고르는 동안·잇는 동안은 "연결 중" 하나로 보이고, 끝나면 쓰는 어댑터의 상태를 따른다
      picking = false
      state.set(active === null ? 'DISCONNECTED' : adapters[active].state)
    }
  }

  const attempt = async (mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    const started = generation
    const saved = memory.value
    const id = mode !== 'pick' && saved?.method === 'bluetooth' ? saved.deviceId : null
    if (id === null) {
      if (mode === 'only') return fail('DISCONNECTED')
      return pickAndConnect(started)
    }
    const kind = await identify(id)
    if (generation !== started) return fail('DISCONNECTED')
    if (kind === null) {
      // 기억한 기기가 지금 보이지 않는다 — 저절로 다시 잇기는 다음 시도로, "다시 연결"은 고르기 창으로
      if (mode === 'only') return fail('DISCONNECTED')
      return pickAndConnect(started)
    }
    const adapter = await use(kind)
    state.set(adapter.state)
    syncInner(adapter)
    try {
      return await (mode === 'only' ? adapter.connectRemembered() : adapter.reconnect('bluetooth'))
    } finally {
      state.set(adapter.state)
    }
  }

  const run = (mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    if (state.state === 'CONNECTED' || state.state === 'PRINTING') return Promise.resolve({ ok: true })
    connecting ??= attempt(mode).finally(() => {
      connecting = undefined
    })
    return connecting
  }

  const picker: PrinterPicker = {
    get kind() {
      return active
    },
    get profile(): AdapterProfile {
      return active === null ? B1_PROFILE : adapters[active].profile
    },
    get state() {
      return state.state
    },
    get hasRemembered() {
      return memory.has
    },
    get remembered() {
      return memory.value
    },
    onStateChange: (listener) => state.listen(listener),
    onRememberedChange: (listener) => memory.listen(listener),
    availableMethods: () => (radio === 'unsupported' ? [] : ['bluetooth']),
    restoreRemembered(value) {
      memory.restore(value)
    },
    connect: () => run('pick'),
    reconnect: () => run('prefer'),
    connectRemembered: () => run('only'),
    async disconnect() {
      generation++
      await Promise.all([niimbot.disconnect(), marklife.disconnect()])
      state.set('DISCONNECTED')
    },
    print(image, printOptions) {
      if (active === null) return Promise.resolve(fail('NOT_CONNECTED'))
      return adapters[active].print(image, printOptions)
    },
  }
  return picker
}

/** 상태와 알림 (printer의 StateBox는 내보내지 않는다) */
class StateBoxLike {
  private value: ConnectionState = 'DISCONNECTED'
  private readonly listeners = new Set<(state: ConnectionState) => void>()

  get state(): ConnectionState {
    return this.value
  }

  set(next: ConnectionState): void {
    if (next === this.value) return
    this.value = next
    for (const listener of [...this.listeners]) listener(next)
  }

  listen(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
