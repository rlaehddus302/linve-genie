// 웹 한 목록 프린터 어댑터 (LABEL_RULES L-7 "고르기 목록"·지원 단계, D-PRN2-01·04) — 고르기 창은 requestDevice 하나다.
// filters = NIIMBOT 서비스 + NIIMBOT 이름 꼴(`B1-`·`B1_`…) + L-12 앞자리, optionalServices = ff00·fd00 (printerRequestOptions).
// 고른 기기의 이름이 L-12 앞자리면 Marklife·바우아토 어댑터로, 아니면 NIIMBOT 어댑터로 잇는다 — 판정은 pickListTarget(앱과 같은 함수).
// 안쪽 어댑터에는 고른 기기를 넘겨 고르기 창을 다시 띄우지 않는다. USB(Web Serial)는 NIIMBOT 어댑터 그대로다.
// 기억(D-QS1-01)은 NIIMBOT 어댑터의 기억이다 — 웹 L-12 어댑터는 기억이 없어(L-7) L-12 프린터가 마지막으로 이어지면 NIIMBOT 기억을 지운다
// (기억 = 마지막으로 연결에 성공한 프린터). 시각·난수를 읽지 않는다. import만으로는 navigator를 건드리지 않는다.
import type { LabelBitmap } from '@livejjim/label'
import {
  B1_PROFILE,
  StateBox,
  systemTimer,
  type AdapterProfile,
  type ConnectionMethod,
  type ConnectionState,
  type ModelProfile,
  type PrintOptions,
  type PrinterTimer,
  type RememberedPrinter,
  type RememberingPrinterAdapter,
} from './adapter.ts'
import { MARKLIFE_OPTIONAL_SERVICES, type BluetoothDeviceLike, type BluetoothEnvironment, type BluetoothRequestOptions } from './bluetooth.ts'
import { fail, type PrinterResult } from './errors.ts'
import { createMarklifeAdapter, type MarklifeAdapter } from './marklife.ts'
import { browserEnvironment, connectErrorCode, createNiimbotAdapter, type NiimbotClientLike, type PrinterEnvironment } from './niimbot.ts'
import { NIIMBOT_TARGET, PRINTER_PROFILES, connectedProfileId, labelProfilesOf, niimbotProfilesOf, pickListFilter, pickListTarget } from './profiles.ts'

/** 웹 한 목록 고르기 창 인자 (requestDevice 하나 — L-7) */
export interface PrinterRequestOptions {
  readonly filters: readonly ({ readonly namePrefix: string } | { readonly services: readonly string[] })[]
  readonly optionalServices: readonly string[]
}

/** 한 목록 고르기 창 인자: filters = NIIMBOT 서비스 + NIIMBOT 이름 꼴 + L-12 앞자리, optionalServices = ff00·fd00 (L-7, D-PRN2-04) */
export function printerRequestOptions(profiles: readonly ModelProfile[] = PRINTER_PROFILES): PrinterRequestOptions {
  const filter = pickListFilter(profiles)
  return {
    filters: [
      ...(filter.serviceUuids.length === 0 ? [] : [{ services: [...filter.serviceUuids] }]),
      ...filter.niimbotNamePrefixes.map((namePrefix) => ({ namePrefix })),
      ...filter.labelNamePrefixes.map((namePrefix) => ({ namePrefix })),
    ],
    optionalServices: [...MARKLIFE_OPTIONAL_SERVICES],
  }
}

/** 웹 환경 (navigator.bluetooth·serial·userAgent·maxTouchPoints) */
export interface WebPrinterEnvironment extends PrinterEnvironment {
  readonly userAgent?: string
  readonly maxTouchPoints?: number
}

/** 지금 브라우저의 환경 (부를 때 읽는다) */
export function webPrinterEnvironment(): WebPrinterEnvironment {
  const nav = (globalThis as { navigator?: { userAgent?: string; maxTouchPoints?: number } }).navigator
  return { ...browserEnvironment(), userAgent: nav?.userAgent, maxTouchPoints: nav?.maxTouchPoints }
}

export interface WebPrinterAdapterOptions {
  /** 기능 감지 환경 (기본: 부를 때의 navigator) */
  readonly environment?: () => WebPrinterEnvironment
  /** niimbluelib 클라이언트 만들기 (기본: 진짜 클라이언트) */
  readonly createClient?: (method: ConnectionMethod) => NiimbotClientLike
  /** 켠 프로필 표 (기본 PRINTER_PROFILES 전부) */
  readonly profiles?: readonly ModelProfile[]
  readonly timer?: PrinterTimer
  /** NIIMBOT 출력 시간 초과·L-12 진행 없음 시간 (ms) */
  readonly printTimeoutMs?: number
  readonly reconnectDelayMs?: number
  readonly marklife?: { readonly packetIntervalMs?: number; readonly maxPacketBytes?: number; readonly creditWaitMs?: number }
}

export interface WebPrinterAdapter extends RememberingPrinterAdapter {
  /** 이은(잇는 중인) 쪽: NIIMBOT 어댑터 · L-12 어댑터 · 아직 없음 */
  readonly kind: 'NIIMBOT' | 'LABEL' | null
  /** 연결된 프린터의 프로필 ID (끊겼거나 모르면 null) — 출력 기기가 서버에 알린다(L-11 10) */
  readonly profileId: string | null
}

type Kind = 'NIIMBOT' | 'LABEL'

/** 실제 navigator.bluetooth의 메서드는 프로토타입에 있다 — this를 붙여 부른다 */
const call = <T>(owner: unknown, name: string, ...args: unknown[]): Promise<T> => {
  const fn = (owner as Record<string, unknown> | null | undefined)?.[name]
  if (typeof fn !== 'function') return Promise.reject(new Error(`${name}이 없다`))
  try {
    return Promise.resolve((fn as (...a: unknown[]) => T | Promise<T>).apply(owner, args))
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}
const has = (owner: unknown, name: string): boolean => typeof (owner as Record<string, unknown> | null | undefined)?.[name] === 'function'

export function createWebPrinterAdapter(options: WebPrinterAdapterOptions = {}): WebPrinterAdapter {
  const environment = options.environment ?? webPrinterEnvironment
  const profiles = options.profiles ?? PRINTER_PROFILES
  const timer = options.timer ?? systemTimer
  const niimbotRows = niimbotProfilesOf(profiles)
  const labelRows = labelProfilesOf(profiles)
  /** 한 목록에서 이미 고른 기기 — 안쪽 어댑터의 고르기 창 대신 넘긴다 */
  let handed: unknown

  /** 안쪽 어댑터가 보는 블루투스 — 고른 기기가 있으면 그것을 돌려주고 켜짐 확인은 바깥이 이미 했다 */
  const innerBluetooth = (real: unknown): Record<string, unknown> | undefined => {
    if (!has(real, 'requestDevice')) return undefined
    return {
      requestDevice: (request: unknown) => (handed !== undefined ? Promise.resolve(handed) : call(real, 'requestDevice', request)),
      ...(has(real, 'getAvailability') ? { getAvailability: () => (handed !== undefined ? Promise.resolve(true) : call<boolean>(real, 'getAvailability')) } : {}),
      ...(has(real, 'getDevices') ? { getDevices: () => call<readonly unknown[]>(real, 'getDevices') } : {}),
    }
  }

  const niimbot = createNiimbotAdapter({
    profiles: niimbotRows.length === 0 ? [B1_PROFILE] : niimbotRows,
    environment: () => {
      const env = environment()
      const bluetooth = innerBluetooth(env.bluetooth)
      return { ...(bluetooth ? { bluetooth: bluetooth as PrinterEnvironment['bluetooth'] } : {}), ...(env.serial ? { serial: env.serial } : {}) }
    },
    timer,
    ...(options.createClient === undefined ? {} : { createClient: options.createClient }),
    ...(options.printTimeoutMs === undefined ? {} : { printTimeoutMs: options.printTimeoutMs }),
    ...(options.reconnectDelayMs === undefined ? {} : { reconnectDelayMs: options.reconnectDelayMs }),
  })
  const label: MarklifeAdapter | null =
    labelRows.length === 0
      ? null
      : createMarklifeAdapter({
          profiles: labelRows,
          environment: () => {
            const env = environment()
            const bluetooth = innerBluetooth(env.bluetooth)
            return { ...(bluetooth ? { bluetooth } : {}), userAgent: env.userAgent ?? '', maxTouchPoints: env.maxTouchPoints ?? 0 } as BluetoothEnvironment
          },
          timer,
          ...(options.printTimeoutMs === undefined ? {} : { printTimeoutMs: options.printTimeoutMs }),
          ...(options.marklife?.packetIntervalMs === undefined ? {} : { packetIntervalMs: options.marklife.packetIntervalMs }),
          ...(options.marklife?.maxPacketBytes === undefined ? {} : { maxPacketBytes: options.marklife.maxPacketBytes }),
          ...(options.marklife?.creditWaitMs === undefined ? {} : { creditWaitMs: options.marklife.creditWaitMs }),
        })

  const box = new StateBox()
  let active: Kind | null = null
  /** 한 목록 고르기 창이 떠 있는 동안 — 상태는 CONNECTING, 안쪽 상태를 따르지 않는다 */
  let picking = false
  let connecting: Promise<PrinterResult> | undefined
  let generation = 0
  const rememberListeners = new Set<(value: RememberedPrinter | null) => void>()

  const inner = (kind: Kind): RememberingPrinterAdapter | MarklifeAdapter => (kind === 'NIIMBOT' ? niimbot : (label as MarklifeAdapter))
  niimbot.onStateChange((s) => {
    if (active === 'NIIMBOT' && !picking) box.set(s)
  })
  label?.onStateChange((s) => {
    if (active === 'LABEL' && !picking) box.set(s)
  })
  niimbot.onRememberedChange((value) => {
    for (const l of [...rememberListeners]) l(value)
  })

  /** 다른 쪽이 이어져 있으면 끊고 이쪽을 쓴다 */
  const use = async (kind: Kind): Promise<void> => {
    const other: Kind = kind === 'NIIMBOT' ? 'LABEL' : 'NIIMBOT'
    if (other === 'NIIMBOT' || label) {
      const o = inner(other)
      if (o.state !== 'DISCONNECTED') await o.disconnect()
    }
    active = kind
  }

  /** L-12 프린터가 마지막으로 이어졌다 — NIIMBOT 기억은 더 이상 "마지막 프린터"가 아니다 */
  const forgetNiimbot = (): void => {
    if (!niimbot.hasRemembered) return
    niimbot.restoreRemembered(null)
    for (const l of [...rememberListeners]) l(null)
  }

  const pickAndConnect = async (): Promise<PrinterResult> => {
    const started = generation
    const stale = (): boolean => generation !== started
    const env = environment()
    const bluetooth = env.bluetooth
    if (!has(bluetooth, 'requestDevice')) return fail('UNSUPPORTED')
    picking = true
    box.set('CONNECTING')
    try {
      /** getAvailability()가 false였다 — 그래도 한 번 시도하고, 실패하면 BLUETOOTH_OFF (D-QS1-03) */
      let reportedOff = false
      if (has(bluetooth, 'getAvailability')) {
        const available = await call<boolean>(bluetooth, 'getAvailability').catch(() => true)
        if (!available) reportedOff = true
      }
      if (stale()) return fail('DISCONNECTED')
      let device: unknown
      try {
        device = await call(bluetooth, 'requestDevice', printerRequestOptions(profiles) as unknown as BluetoothRequestOptions)
      } catch (error) {
        if (stale()) return fail('DISCONNECTED')
        return fail(reportedOff ? 'BLUETOOTH_OFF' : connectErrorCode(error, 'bluetooth'), error)
      }
      if (stale()) return fail('DISCONNECTED')
      // 웹은 고른 기기의 광고 서비스를 모른다 — 이름이 L-12 앞자리면 그 어댑터, 아니면(서비스로 보인 기기 포함) NIIMBOT (L-7)
      const target = pickListTarget((device as BluetoothDeviceLike | null)?.name, [], profiles)
      const kind: Kind = target !== null && target !== NIIMBOT_TARGET && label ? 'LABEL' : 'NIIMBOT'
      await use(kind)
      if (stale()) return fail('DISCONNECTED')
      picking = false
      handed = device
      let result: PrinterResult
      try {
        result = await inner(kind).connect('bluetooth')
      } finally {
        handed = undefined
      }
      if (stale()) return result.ok ? fail('DISCONNECTED') : result
      if (result.ok && kind === 'LABEL') forgetNiimbot()
      if (!result.ok && reportedOff && result.error.code !== 'WRONG_MODEL') return fail('BLUETOOTH_OFF')
      return result
    } finally {
      picking = false
      box.set(active === null ? 'DISCONNECTED' : inner(active).state)
    }
  }

  const start = (run: () => Promise<PrinterResult>): Promise<PrinterResult> => {
    if (box.state === 'CONNECTED' || box.state === 'PRINTING') return Promise.resolve({ ok: true })
    connecting ??= run().finally(() => {
      connecting = undefined
    })
    return connecting
  }

  const viaNiimbot = async (go: () => Promise<PrinterResult>): Promise<PrinterResult> => {
    await use('NIIMBOT')
    return go()
  }

  const adapter: WebPrinterAdapter = {
    get kind() {
      return active
    },
    get profileId() {
      return connectedProfileId(adapter)
    },
    get profile(): AdapterProfile {
      return active === null ? B1_PROFILE : inner(active).profile
    },
    get state(): ConnectionState {
      return box.state
    },
    get hasRemembered() {
      return niimbot.hasRemembered
    },
    get remembered() {
      return niimbot.remembered
    },
    onStateChange: (listener) => box.listen(listener),
    onRememberedChange(listener) {
      rememberListeners.add(listener)
      return () => {
        rememberListeners.delete(listener)
      }
    },
    availableMethods: () => niimbot.availableMethods(),
    restoreRemembered: (value) => niimbot.restoreRemembered(value),
    // 연결 방법 단추는 늘 고르기 창 (블루투스 = 한 목록, USB = NIIMBOT)
    connect: (method) => start(() => (method === 'bluetooth' ? pickAndConnect() : viaNiimbot(() => niimbot.connect(method)))),
    // "다시 연결": 기억한 NIIMBOT 기기가 있으면 그것(못 얻으면 NIIMBOT 고르기 창), 없으면 한 목록 고르기 창
    reconnect: (method) =>
      start(() => {
        const saved = niimbot.remembered
        if (niimbot.hasRemembered && (saved === null || saved.method === method)) return viaNiimbot(() => niimbot.reconnect(method))
        return method === 'bluetooth' ? pickAndConnect() : viaNiimbot(() => niimbot.connect(method))
      }),
    // 저절로 다시 잇기: 기억한 기기로만 — L-12 프린터는 웹에서 기억이 없어 시도하지 않는다
    connectRemembered: () => start(() => (niimbot.hasRemembered ? viaNiimbot(() => niimbot.connectRemembered()) : Promise.resolve(fail('DISCONNECTED')))),
    async disconnect() {
      generation++
      handed = undefined
      await Promise.all([niimbot.disconnect(), label?.disconnect()])
      box.set('DISCONNECTED')
    },
    print(image: LabelBitmap, printOptions?: PrintOptions) {
      if (active === null) return Promise.resolve(fail('NOT_CONNECTED'))
      return inner(active).print(image, printOptions)
    },
  }
  return adapter
}
