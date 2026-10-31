// NIIMBOT 어댑터 — 켠 프로필 B1(확인됨) + B1 SE·B21·D110(실험) (LABEL_RULES L-7, LBL-06·12, D-P1-08·D-PRN2-04·05, TECH_REVIEW §1).
// 연결한 뒤 niimbluelib 모델 정보가 켠 프로필의 모델과 같을 때만 그 프로필로 쓰고, 아니면(B1 Pro·B21 Pro·변형·모름) 끊고 WRONG_MODEL.
// @mmote/niimbluelib(정확한 버전 고정)로 연결·출력한다. 클라이언트는 주입할 수 있어 시험은 가짜 클라이언트로 돈다.
// import만으로는 navigator를 건드리지 않는다 — 기능 감지는 함수를 부를 때 한다.
import { ImageEncoder, LabelType, NiimbotBluetoothClient, NiimbotSerialClient, PageColorType, type EncodedImage } from '@mmote/niimbluelib'
import { getPixel, isLabelBitmap, type LabelBitmap } from '@livejjim/label'
import {
  DEFAULT_PRINT_TIMEOUT_MS,
  RememberBox,
  StateBox,
  systemTimer,
  withBlankRows,
  type ConnectionMethod,
  type ConnectionState,
  type PrintOptions,
  type PrinterProfile,
  type PrinterTimer,
  type RememberedPrinter,
  type RememberingPrinterAdapter,
} from './adapter.ts'
import { OK, densityMessage, fail, isTimeoutCause, modelDetail, printerErrorWithMessage, retriedTimeoutDetail, type PrinterErrorCode, type PrinterResult } from './errors.ts'
import { ENABLED_PROFILES, NIIMBOT_SERVICE_UUID, PRINTER_PROFILES, labelProfilesOf, profileForDeviceName } from './profiles.ts'

/** niimbluelib 인쇄 작업에서 이 어댑터가 쓰는 부분 */
export interface NiimbotPrintTaskLike {
  printInit(): Promise<void>
  printPage(image: EncodedImage, quantity?: number): Promise<void>
  waitForFinished(): Promise<void>
  printEnd(): Promise<boolean>
}

/** niimbluelib 인쇄 작업 설정에서 이 어댑터가 보내는 부분 */
export interface NiimbotTaskOptions {
  readonly density: number
  readonly labelType: number
  readonly totalPages: number
}

/** niimbluelib 클라이언트(NiimbotBluetoothClient·NiimbotSerialClient)에서 이 어댑터가 쓰는 부분 */
export interface NiimbotClientLike {
  /**
   * 연결 — authorizedDevice(블루투스)·authorizedPort(USB)를 주면 고르기 창을 띄우지 않고 그 기기·포트로 잇는다
   * (niimbluelib NiimbotBluetoothClient·NiimbotSerialClient와 같다). 주지 않으면 클라이언트가 고르기 창을 띄운다
   */
  connect(options?: { readonly authorizedDevice?: unknown; readonly authorizedPort?: unknown }): Promise<unknown>
  disconnect(): Promise<void>
  isConnected(): boolean
  /** 연결한 프린터의 모델 정보 (모르면 undefined) */
  getModelMetadata(): { readonly model: string } | undefined
  on(event: 'disconnect', listener: () => void): unknown
  off(event: 'disconnect', listener: () => void): unknown
  readonly protocol: { newPrintTask(name: string, options: NiimbotTaskOptions): NiimbotPrintTaskLike }
}

/** 기능 감지에 쓰는 환경 (브라우저의 navigator.bluetooth·navigator.serial) */
export interface PrinterEnvironment {
  /** getDevices는 있을 때만 쓴다(크롬 기본값엔 없을 수 있다) — 새로고침 뒤 기억한 기기 ID 찾기 (D-QS1-01 (3)) */
  readonly bluetooth?: { readonly requestDevice?: unknown; getAvailability?(): Promise<boolean>; getDevices?(): Promise<readonly unknown[]> }
  /** getPorts — 새로고침 뒤 기억한 USB 제조사·제품 번호의 포트 찾기 (D-QS1-01 (3)) */
  readonly serial?: { readonly requestPort?: unknown; getPorts?(): Promise<readonly unknown[]> }
}

/** 블루투스 기기의 ID (Web Bluetooth BluetoothDevice.id) — 없으면 null */
export function bluetoothDeviceId(device: unknown): string | null {
  if (typeof device !== 'object' || device === null) return null
  const id = (device as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : null
}

/** USB 포트의 제조사·제품 번호 (Web Serial SerialPort.getInfo()) — 없거나 예외면 null */
export function serialPortIds(port: unknown): { readonly usbVendorId: number; readonly usbProductId: number } | null {
  if (typeof port !== 'object' || port === null) return null
  const getInfo = (port as { getInfo?: unknown }).getInfo
  if (typeof getInfo !== 'function') return null
  try {
    const info = getInfo.call(port) as { usbVendorId?: unknown; usbProductId?: unknown } | undefined
    const vendor = info?.usbVendorId
    const product = info?.usbProductId
    if (typeof vendor !== 'number' || typeof product !== 'number') return null
    return { usbVendorId: vendor, usbProductId: product }
  } catch {
    return null
  }
}

/** 이은 기기 → 저장소에 둘 값 (알아볼 값이 없으면 null) */
function rememberedValueOf(method: ConnectionMethod, target: unknown): RememberedPrinter | null {
  if (method === 'bluetooth') {
    const id = bluetoothDeviceId(target)
    return id === null ? null : { method: 'bluetooth', deviceId: id }
  }
  const ids = serialPortIds(target)
  return ids === null ? null : { method: 'serial', ...ids }
}

/** 지금 브라우저의 환경 (부를 때 읽는다) */
export function browserEnvironment(): PrinterEnvironment {
  const nav = (globalThis as { navigator?: { bluetooth?: PrinterEnvironment['bluetooth']; serial?: PrinterEnvironment['serial'] } }).navigator
  return { bluetooth: nav?.bluetooth, serial: nav?.serial }
}

/** 환경에서 쓸 수 있는 연결 방법 — 블루투스가 앞, 둘 다 없으면(아이폰 사파리·Node) 빈 목록 */
export function detectMethods(env: PrinterEnvironment): ConnectionMethod[] {
  const out: ConnectionMethod[] = []
  if (typeof env.bluetooth?.requestDevice === 'function') out.push('bluetooth')
  if (typeof env.serial?.requestPort === 'function') out.push('serial')
  return out
}

export function defaultNiimbotClient(method: ConnectionMethod): NiimbotClientLike {
  return (method === 'bluetooth' ? new NiimbotBluetoothClient() : new NiimbotSerialClient()) as unknown as NiimbotClientLike
}

export interface NiimbotAdapterOptions {
  /** 켤 프로필 (기본: ENABLED_PROFILES — B1·B1 SE·B21·D110) */
  readonly profiles?: readonly PrinterProfile[]
  /** 기능 감지 환경 (기본: 부를 때의 navigator) */
  readonly environment?: () => PrinterEnvironment
  /** niimbluelib 클라이언트 만들기 (기본: 진짜 클라이언트) */
  readonly createClient?: (method: ConnectionMethod) => NiimbotClientLike
  readonly timer?: PrinterTimer
  /** 출력 시간 초과 (ms) */
  readonly printTimeoutMs?: number
  /** B1 첫 확인이 시간 초과로 실패했을 때 같은 기기로 다시 잇기 전에 쉬는 시간 (ms, 기본 1초 — L-7, D-FB1-09) */
  readonly reconnectDelayMs?: number
}

/** 다시 잇기 전에 쉬는 시간 기본값 (L-7 B1 첫 확인 다시 잇기) */
export const NIIMBOT_RECONNECT_DELAY_MS = 1_000

/** niimbluelib 블루투스 클라이언트가 쓰는 서비스 (BleDefaultConfiguration.SERVICES와 같다 — 0.47.1은 내보내지 않는다) */
export const NIIMBOT_BLE_SERVICES: readonly string[] = Object.freeze([NIIMBOT_SERVICE_UUID])

/** Web Bluetooth requestDevice 인자 (이 패키지가 쓰는 칸) */
export interface NiimbotRequestOptions {
  filters: ({ namePrefix: string } | { services: string[] })[]
  exclusionFilters?: { namePrefix: string }[]
  optionalServices?: string[]
}

/**
 * NIIMBOT 어댑터가 혼자 고르기 창을 띄울 때의 거르기 (L-7 고르기 목록 — 한 목록 밖): NIIMBOT 서비스 + 켠 NIIMBOT 모델 이름 꼴(`B1-`·`B1_`…),
 * L-12 앞자리는 exclusionFilters로 뺀다(모르는 브라우저는 무시 — 그래도 고르면 연결하지 않고 WRONG_MODEL). 이름 첫 글자 거르기(niimbluelib 기본)는
 * 쓰지 않는다(D-PRN2-04). 어댑터가 고르기 창을 직접 띄우고 고른 기기를 클라이언트에 넘긴다 — 첫 확인이 시간 초과면 그 기기로 다시 잇는다
 */
export function niimbotRequestOptions(profiles: readonly PrinterProfile[] = ENABLED_PROFILES): NiimbotRequestOptions {
  // 모델 이름 + `-`·`_` (pickListTarget 2와 같은 꼴 — profiles.ts niimbotNamePrefixes)
  const shapes = [...new Set(profiles.flatMap((p) => [`${p.model}-`, `${p.model}_`]))]
  const labels = labelProfilesOf(PRINTER_PROFILES)
  return {
    filters: [{ services: [...NIIMBOT_BLE_SERVICES] }, ...shapes.map((namePrefix) => ({ namePrefix }))],
    exclusionFilters: labels.map((p) => ({ namePrefix: p.namePrefix as string })),
  }
}

/** 기기 이름이 L-12 프로필(Marklife·바우아토) 이름인지 — NIIMBOT 어댑터는 그 기기에 연결하지 않는다(WRONG_MODEL) */
const isLabelPrinterName = (device: unknown): boolean =>
  typeof device === 'object' && device !== null && profileForDeviceName((device as { name?: unknown }).name, labelProfilesOf(PRINTER_PROFILES)) !== undefined

/** 1비트 그림 → niimbluelib 인쇄 그림 (흰색 0xffffff, 검정 0x000000) */
export function encodeForNiimbot(image: LabelBitmap, direction: 'top' | 'left'): EncodedImage {
  return ImageEncoder.encode(
    {
      width: image.width,
      height: image.height,
      // 'left'는 시계 방향 90도 (niimbluelib CanvasImageSource와 같은 계산)
      getPixelColor: (x, y, dir) => ((dir === 'left' ? getPixel(image, y, image.height - 1 - x) : getPixel(image, x, y)) ? 0x000000 : 0xffffff),
    },
    PageColorType.SingleColor,
    direction,
  )
}

/** 연결 중 예외 → 오류 코드 (L-7 — 한 목록 어댑터도 같은 판단을 쓴다) */
export function connectErrorCode(error: unknown, method: ConnectionMethod): PrinterErrorCode {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  const message = error instanceof Error ? error.message : String(error)
  if (/adapter (is )?not available|bluetooth.*(off|disabled|unavailable)/i.test(message)) return 'BLUETOOTH_OFF'
  // 장치·포트 선택 창을 닫음 (사용자 동작 밖에서 부른 경우도 다시 누르게 안내한다)
  if (name === 'NotFoundError' || name === 'AbortError' || name === 'SecurityError' || name === 'NotAllowedError') return 'NOT_SELECTED'
  if (method === 'serial' && (name === 'InvalidStateError' || name === 'NetworkError' || /open|busy|access/i.test(message))) return 'PORT_BUSY'
  // 그 밖의 연결 중 예외 — 첫 확인 시간 초과·특성 없음·GATT 연결 실패 등 (FB1, D-FB1-09)
  return 'CONNECT_FAILED'
}

/** NIIMBOT 어댑터 (켠 프로필 목록에 있는 모델만 받는다) */
export function createNiimbotAdapter(options: NiimbotAdapterOptions = {}): RememberingPrinterAdapter {
  const profiles = options.profiles ?? ENABLED_PROFILES
  const first = profiles[0]
  if (!first) throw new Error('프로필이 하나도 없다')
  const environment = options.environment ?? browserEnvironment
  const createClient = options.createClient ?? defaultNiimbotClient
  const timer = options.timer ?? systemTimer
  const timeoutMs = options.printTimeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS
  const box = new StateBox()
  let profile: PrinterProfile = first
  let client: NiimbotClientLike | undefined
  /** 출력 중 끊김을 알리는 함수 (출력 중일 때만 있다) */
  let interruptPrint: (() => void) | undefined
  let connecting: Promise<PrinterResult> | undefined
  /** disconnect()를 부를 때마다 늘린다 — 그 전에 시작한 연결은 끝나도 붙지 않는다 */
  let generation = 0

  const onDisconnect = (): void => {
    const gone = client
    client = undefined
    gone?.off('disconnect', onDisconnect)
    interruptPrint?.()
    box.set('DISCONNECTED')
  }

  /** 다시 잇기 전에 쉬는 동안의 깨우기 — 판매자가 연결 끊기를 누르면 바로 깨운다 */
  let wakeWait: (() => void) | undefined
  const reconnectDelayMs = options.reconnectDelayMs ?? NIIMBOT_RECONNECT_DELAY_MS

  const pause = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const handle = timer.setTimeout(() => {
        wakeWait = undefined
        resolve()
      }, ms)
      wakeWait = () => {
        wakeWait = undefined
        timer.clearTimeout(handle)
        resolve()
      }
    })

  /** 마지막으로 연결에 성공한 기기 (D-QS1-01) */
  const memory = new RememberBox<unknown>()

  /**
   * 기억한 기기를 지금 얻는다 — 페이지 안의 객체가 있으면 그것, 새로고침 뒤면 getDevices(블루투스, 있을 때만)·getPorts(USB —
   * 같은 번호가 정확히 하나일 때만)로 찾는다. 못 얻으면 undefined
   */
  const rememberedTarget = async (env: PrinterEnvironment, method: ConnectionMethod): Promise<unknown> => {
    if (memory.methodOf !== method) return undefined
    if (memory.object !== undefined) return memory.object
    const saved = memory.value
    if (saved === null) return undefined
    if (saved.method === 'bluetooth') {
      const getDevices = env.bluetooth?.getDevices
      if (typeof getDevices !== 'function') return undefined
      const devices = await Promise.resolve()
        .then(() => getDevices.call(env.bluetooth))
        .catch(() => [] as readonly unknown[])
      return (Array.isArray(devices) ? devices : []).find((d) => bluetoothDeviceId(d) === saved.deviceId)
    }
    const getPorts = env.serial?.getPorts
    if (typeof getPorts !== 'function') return undefined
    const ports = await Promise.resolve()
      .then(() => getPorts.call(env.serial))
      .catch(() => [] as readonly unknown[])
    const same = (Array.isArray(ports) ? ports : []).filter((port) => {
      const ids = serialPortIds(port)
      return ids !== null && ids.usbVendorId === saved.usbVendorId && ids.usbProductId === saved.usbProductId
    })
    return same.length === 1 ? same[0] : undefined
  }

  /**
   * 연결 시도 하나. mode: pick = 늘 고르기 창(연결 방법 단추) · prefer = 기억한 기기가 있으면 그것, 없으면 고르기 창("다시 연결") ·
   * only = 기억한 기기로만(저절로 다시 잇기 — 고르기 창 없음)
   */
  const connectOnce = async (method: ConnectionMethod, mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    const started = generation
    const stale = (): boolean => generation !== started
    const env = environment()
    if (!detectMethods(env).includes(method)) return fail('UNSUPPORTED')
    if (mode === 'only' && !memory.has) return fail('DISCONNECTED')
    box.set('CONNECTING')
    /** getAvailability()가 false였다 — 그래도 한 번 시도하고, 실패하면 BLUETOOTH_OFF (D-QS1-03) */
    let reportedOff = false
    /** 기억한 기기로 잇는 시도인지 */
    let usingMemory = false
    /** 실패로 끝낸다 — 연결하는 동안 판매자가 끊기를 눌렀으면 언제나 DISCONNECTED(원인 없음) */
    const giveUp = (code: PrinterErrorCode, cause?: unknown): PrinterResult => {
      if (stale()) return fail('DISCONNECTED')
      box.set('DISCONNECTED')
      // "다시 연결"로 기억한 기기에 이은 시도가 실패하면 기억을 지운다 — 다음 "다시 연결"은 고르기 창부터 (D-QS1-01 (4))
      if (usingMemory && mode === 'prefer') memory.forget()
      // 브라우저도 꺼졌다고 했고 시도도 안 됐다 — 블루투스를 켜 보라는 안내 (D-QS1-03). 다른 모델을 고른 것은 블루투스가 된 것이다
      if (reportedOff && code !== 'WRONG_MODEL') return fail('BLUETOOTH_OFF')
      return fail(code, cause)
    }
    if (method === 'bluetooth' && typeof env.bluetooth?.getAvailability === 'function') {
      // 확인할 수 없으면(예외) 지금처럼 시도해 본다. false여도 시도한다(윈도우 크롬 오판 — D-QS1-03)
      const available = await env.bluetooth.getAvailability().catch(() => true)
      if (!available) reportedOff = true
    }
    if (stale()) return fail('DISCONNECTED')
    /** 고르기 창 없이 이을 기기·포트 */
    const target = mode === 'pick' ? undefined : await rememberedTarget(env, method)
    if (stale()) return fail('DISCONNECTED')
    if (mode === 'only' && target === undefined) {
      // 기억한 기기를 지금 얻을 수 없다 — 시도하지 않는다(기억은 그대로)
      box.set('DISCONNECTED')
      return fail('DISCONNECTED')
    }
    usingMemory = target !== undefined
    let next: NiimbotClientLike
    try {
      next = createClient(method)
    } catch (error) {
      return giveUp(connectErrorCode(error, method), error)
    }
    /** 이은 기기 (블루투스 기기·USB 포트 — 다시 잇기와 기억에 쓴다) */
    let device: unknown = target
    const linkOptions = (picked: unknown): { authorizedDevice: unknown } | { authorizedPort: unknown } | undefined =>
      picked === undefined || picked === null ? undefined : method === 'bluetooth' ? { authorizedDevice: picked } : { authorizedPort: picked }
    try {
      if (target === undefined && method === 'bluetooth') {
        const requestDevice = env.bluetooth?.requestDevice as (options: ReturnType<typeof niimbotRequestOptions>) => Promise<unknown>
        device = await requestDevice.call(env.bluetooth, niimbotRequestOptions(profiles))
        if (stale()) return fail('DISCONNECTED')
        // exclusionFilters를 모르는 브라우저에서 L-12 이름의 기기를 골랐다 — 연결하지 않는다 (L-7 고르기 목록)
        if (isLabelPrinterName(device)) return giveUp('WRONG_MODEL')
      } else if (target === undefined) {
        // USB 고르기 창도 어댑터가 띄운다 — 고른 포트를 기억하려고 (niimbluelib도 거르기 없이 requestPort()를 부른다)
        const requestPort = env.serial?.requestPort as () => Promise<unknown>
        device = await requestPort.call(env.serial)
        if (stale()) return fail('DISCONNECTED')
      }
      await next.connect(linkOptions(device))
    } catch (firstError) {
      if (stale()) return fail('DISCONNECTED')
      const code = connectErrorCode(firstError, method)
      const canRetry = method === 'bluetooth' && code === 'CONNECT_FAILED' && device !== undefined && device !== null && isTimeoutCause(firstError)
      if (!canRetry) return giveUp(code, firstError)
      // B1 첫 확인 시간 초과 — 같은 기기로 한 번만, 쉬었다가 다시 잇는다(고르기 창을 다시 띄우지 않는다). 그동안 CONNECTING
      await pause(reconnectDelayMs)
      if (stale()) return fail('DISCONNECTED')
      try {
        // 같은 클라이언트로 다시 잇는다 — niimbluelib은 connect() 처음에 앞 연결을 정리한다
        await next.connect({ authorizedDevice: device })
      } catch (secondError) {
        if (stale()) return fail('DISCONNECTED')
        const again = connectErrorCode(secondError, method)
        return giveUp(again, again === 'CONNECT_FAILED' ? retriedTimeoutDetail() : secondError)
      }
    }
    if (stale()) {
      // 연결하는 동안 판매자가 연결 끊기를 눌렀다
      await next.disconnect().catch(() => undefined)
      return fail('DISCONNECTED')
    }
    const model = next.getModelMetadata()?.model
    const matched = profiles.find((p) => p.model === model)
    if (!matched) {
      await next.disconnect().catch(() => undefined)
      // WRONG_MODEL은 기억하지 않는다 (D-QS1-01 (4))
      return giveUp('WRONG_MODEL', model === undefined ? undefined : modelDetail(model))
    }
    profile = matched
    client = next
    next.on('disconnect', onDisconnect)
    // 기억 = 마지막으로 연결에 성공한 기기. 고른 기기를 모르면(클라이언트가 직접 고름) 기억할 것이 없다
    if (device === undefined || device === null) memory.forget()
    else memory.remember(method, device, rememberedValueOf(method, device))
    box.set('CONNECTED')
    return OK
  }

  /** 연결 중에 또 부르면 같은 연결을 기다린다 (세 길 모두 — 시도는 하나) */
  const start = (method: ConnectionMethod, mode: 'pick' | 'prefer' | 'only'): Promise<PrinterResult> => {
    if (box.state === 'CONNECTED' || box.state === 'PRINTING') return Promise.resolve(OK)
    connecting ??= connectOnce(method, mode).finally(() => {
      connecting = undefined
    })
    return connecting
  }

  const adapter: RememberingPrinterAdapter = {
    get profile() {
      return profile
    },
    get state(): ConnectionState {
      return box.state
    },
    get hasRemembered() {
      return memory.has
    },
    get remembered() {
      return memory.value
    },
    onStateChange: (listener) => box.listen(listener),
    onRememberedChange: (listener) => memory.listen(listener),
    availableMethods: () => detectMethods(environment()),

    restoreRemembered(value) {
      memory.restore(value)
    },

    connect: (method) => start(method, 'pick'),

    reconnect: (method) => start(method, 'prefer'),

    connectRemembered() {
      if (connecting) return connecting
      const method = memory.methodOf
      if (method === undefined || !memory.has) {
        if (box.state === 'CONNECTED' || box.state === 'PRINTING') return Promise.resolve(OK)
        return Promise.resolve(fail('DISCONNECTED'))
      }
      return start(method, 'only')
    },

    async disconnect() {
      generation++
      wakeWait?.()
      const gone = client
      client = undefined
      gone?.off('disconnect', onDisconnect)
      interruptPrint?.()
      box.set('DISCONNECTED')
      await gone?.disconnect().catch(() => undefined)
    },

    async print(image, printOptions: PrintOptions = {}) {
      if (box.state === 'PRINTING') return fail('BUSY')
      const current = client
      if (box.state !== 'CONNECTED' || !current) return fail('NOT_CONNECTED')
      const density = printOptions.density ?? profile.density.default
      if (!Number.isInteger(density) || density < profile.density.min || density > profile.density.max) {
        return { ok: false, error: printerErrorWithMessage('INVALID_DENSITY', densityMessage(profile.density)) }
      }
      if (!isLabelBitmap(image)) return fail('PRINT_FAILED', '그림 형식(L-1)이 아니다')
      // 보낼 그림의 폭(돌린 뒤 — left는 받은 그림의 높이)이 헤드보다 넓으면 보내지 않는다 (L-7)
      const sendWidth = profile.printDirection === 'left' ? image.height + profile.extraBlankRows : image.width
      if (sendWidth > profile.headDots) return fail('IMAGE_TOO_WIDE')
      // 마지막 줄 미출력 대응: 아래에 흰 줄을 더해 보낸다 (받은 그림은 바꾸지 않는다)
      const encoded = encodeForNiimbot(withBlankRows(image, profile.extraBlankRows), profile.printDirection)
      box.set('PRINTING')
      const task = current.protocol.newPrintTask(profile.printTask, { density, labelType: LabelType.WithGaps, totalPages: 1 })
      type Outcome = { kind: 'done' } | { kind: 'error'; error: unknown } | { kind: 'disconnected' } | { kind: 'timeout' }
      let handle: unknown
      /** 프린터가 끝났다고 알렸는지 (라벨이 나왔다) — 그 뒤의 끊김·시간 초과·끝냄 알림 실패는 출력 실패가 아니다 */
      let finished = false
      const outcome = await new Promise<Outcome>((resolve) => {
        interruptPrint = () => resolve(finished ? { kind: 'done' } : { kind: 'disconnected' })
        handle = timer.setTimeout(() => resolve(finished ? { kind: 'done' } : { kind: 'timeout' }), timeoutMs)
        void (async () => {
          try {
            await task.printInit()
            await task.printPage(encoded, 1)
            await task.waitForFinished()
          } catch (error) {
            void task.printEnd().catch(() => false)
            throw error
          }
          finished = true
          // 끝냄 알림 — 라벨은 이미 나왔으니 이 알림의 실패는 출력 실패로 보지 않는다
          await task.printEnd().catch(() => false)
        })().then(
          () => resolve({ kind: 'done' }),
          (error: unknown) => resolve({ kind: 'error', error }),
        )
      })
      interruptPrint = undefined
      timer.clearTimeout(handle)
      if (outcome.kind === 'done') {
        // 끝냄 알림을 기다리는 동안 끊겼으면(또는 판매자가 끊었으면) 상태는 끊김 그대로 두고 출력은 끝난 것으로 알린다.
        // 그 사이 다시 연결했으면 새 연결의 상태도 건드리지 않는다
        if (client === current) box.set('CONNECTED')
        return OK
      }
      if (outcome.kind === 'disconnected' || client !== current) return fail('DISCONNECTED')
      if (outcome.kind === 'error' && !current.isConnected()) {
        // 끊김 알림보다 예외가 먼저 왔다 — 끊김으로 본다
        onDisconnect()
        return fail('DISCONNECTED', outcome.error)
      }
      box.set('CONNECTED')
      if (outcome.kind === 'timeout') {
        void task.printEnd().catch(() => false)
        return fail('TIMEOUT')
      }
      return fail('PRINT_FAILED', outcome.error)
    },
  }
  return adapter
}

/** NIIMBOT 어댑터 (켠 프로필 = ENABLED_PROFILES — B1·B1 SE·B21·D110). 이름은 예전 그대로 둔다(웹·시험이 쓴다) */
export function createB1Adapter(options: Omit<NiimbotAdapterOptions, 'profiles'> = {}): RememberingPrinterAdapter {
  return createNiimbotAdapter({ ...options, profiles: ENABLED_PROFILES })
}
