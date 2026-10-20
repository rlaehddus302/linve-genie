// NIIMBOT 어댑터 — 지금은 B1 프로필 하나 (LABEL_RULES L-7, LBL-06·12, D-P1-08, TECH_REVIEW §1).
// @mmote/niimbluelib(정확한 버전 고정)로 연결·출력한다. 클라이언트는 주입할 수 있어 시험은 가짜 클라이언트로 돈다.
// import만으로는 navigator를 건드리지 않는다 — 기능 감지는 함수를 부를 때 한다.
import { ImageEncoder, LabelType, NiimbotBluetoothClient, NiimbotSerialClient, PageColorType, type EncodedImage } from '@mmote/niimbluelib'
import { getPixel, isLabelBitmap, type LabelBitmap } from '@livejjim/label'
import {
  DEFAULT_PRINT_TIMEOUT_MS,
  ENABLED_PROFILES,
  StateBox,
  systemTimer,
  withBlankRows,
  type ConnectionMethod,
  type ConnectionState,
  type PrintOptions,
  type PrinterAdapter,
  type PrinterProfile,
  type PrinterTimer,
} from './adapter.ts'
import { OK, fail, type PrinterErrorCode, type PrinterResult } from './errors.ts'

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
  connect(): Promise<unknown>
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
  readonly bluetooth?: { readonly requestDevice?: unknown; getAvailability?(): Promise<boolean> }
  readonly serial?: { readonly requestPort?: unknown }
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
  /** 켤 프로필 (기본: B1 하나) */
  readonly profiles?: readonly PrinterProfile[]
  /** 기능 감지 환경 (기본: 부를 때의 navigator) */
  readonly environment?: () => PrinterEnvironment
  /** niimbluelib 클라이언트 만들기 (기본: 진짜 클라이언트) */
  readonly createClient?: (method: ConnectionMethod) => NiimbotClientLike
  readonly timer?: PrinterTimer
  /** 출력 시간 초과 (ms) */
  readonly printTimeoutMs?: number
}

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

function connectErrorCode(error: unknown, method: ConnectionMethod): PrinterErrorCode {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  const message = error instanceof Error ? error.message : String(error)
  if (/adapter (is )?not available|bluetooth.*(off|disabled|unavailable)/i.test(message)) return 'BLUETOOTH_OFF'
  // 장치·포트 선택 창을 닫음 (사용자 동작 밖에서 부른 경우도 다시 누르게 안내한다)
  if (name === 'NotFoundError' || name === 'AbortError' || name === 'SecurityError' || name === 'NotAllowedError') return 'NOT_SELECTED'
  if (method === 'serial' && (name === 'InvalidStateError' || name === 'NetworkError' || /open|busy|access/i.test(message))) return 'PORT_BUSY'
  return 'DISCONNECTED'
}

/** NIIMBOT 어댑터 (켠 프로필 목록에 있는 모델만 받는다) */
export function createNiimbotAdapter(options: NiimbotAdapterOptions = {}): PrinterAdapter {
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

  const connectOnce = async (method: ConnectionMethod): Promise<PrinterResult> => {
    const started = generation
    const env = environment()
    if (!detectMethods(env).includes(method)) return fail('UNSUPPORTED')
    box.set('CONNECTING')
    if (method === 'bluetooth' && typeof env.bluetooth?.getAvailability === 'function') {
      // 확인할 수 없으면(예외) 연결을 시도해 본다
      const available = await env.bluetooth.getAvailability().catch(() => true)
      if (!available) {
        if (generation === started) box.set('DISCONNECTED')
        return fail('BLUETOOTH_OFF')
      }
    }
    let next: NiimbotClientLike
    try {
      next = createClient(method)
      await next.connect()
    } catch (error) {
      box.set('DISCONNECTED')
      return fail(connectErrorCode(error, method), error)
    }
    if (generation !== started) {
      // 연결하는 동안 판매자가 연결 끊기를 눌렀다
      await next.disconnect().catch(() => undefined)
      return fail('DISCONNECTED')
    }
    const model = next.getModelMetadata()?.model
    const matched = profiles.find((p) => p.model === model)
    if (!matched) {
      await next.disconnect().catch(() => undefined)
      box.set('DISCONNECTED')
      return fail('WRONG_MODEL', model === undefined ? undefined : `모델: ${model}`)
    }
    profile = matched
    client = next
    next.on('disconnect', onDisconnect)
    box.set('CONNECTED')
    return OK
  }

  const adapter: PrinterAdapter = {
    get profile() {
      return profile
    },
    get state(): ConnectionState {
      return box.state
    },
    onStateChange: (listener) => box.listen(listener),
    availableMethods: () => detectMethods(environment()),

    connect(method) {
      if (box.state === 'CONNECTED' || box.state === 'PRINTING') return Promise.resolve(OK)
      // 연결 중에 또 누르면 같은 연결을 기다린다
      connecting ??= connectOnce(method).finally(() => {
        connecting = undefined
      })
      return connecting
    },

    async disconnect() {
      generation++
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
      if (!Number.isInteger(density) || density < profile.density.min || density > profile.density.max) return fail('INVALID_DENSITY')
      if (!isLabelBitmap(image)) return fail('PRINT_FAILED', '그림 형식(L-1)이 아니다')
      if (image.width > profile.headDots) return fail('IMAGE_TOO_WIDE')
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

/** B1 어댑터 (켠 프로필 = B1 하나) */
export function createB1Adapter(options: Omit<NiimbotAdapterOptions, 'profiles'> = {}): PrinterAdapter {
  return createNiimbotAdapter({ ...options, profiles: ENABLED_PROFILES })
}
