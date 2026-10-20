// Marklife·바우아토 어댑터 (LABEL_RULES L-12 3~6, L-7 어댑터 계약, D-N1-04·05·06·08) — Web Bluetooth만 쓴다(USB·Web Serial 없음).
// - 연결: 판매자가 누른 동작 안에서만. 기기 고르기 창은 켠 프로필의 이름 앞자리로 거르고, 고른 기기의 이름으로 프로필을 정한다.
//   GATT 꾸러미 A(ff00) → C(fd00). 꾸러미 A면 연결할 때 ff03·ff01 알림을 켠다(첫 `01 04`를 놓치지 않게 듣기를 먼저 붙인다).
// - 보내기: 작업 바이트(job.ts)를 90바이트 이하 조각으로, 조각 사이 30ms, 꾸러미 A는 크레딧(0에서 시작, 상한 4, 1초 기다려도 없으면 하나).
// - 끝: 이번 출력의 첫 조각을 쓴 뒤 받은 `AA` + 모든 조각을 씀 → 출력 OK. 20초 안에 안 끝나면 TIMEOUT, 그 전 끊김은 DISCONNECTED —
//   바이트를 다 썼다는 것만으로 출력함이라 하지 않는다(라벨이 조용히 빠지지 않게, D-N1-06).
// 시각·난수를 읽지 않는다(타이머는 주입). import만으로는 navigator를 건드리지 않는다.
import type { LabelBitmap } from '@livejjim/label'
import {
  DEFAULT_PRINT_TIMEOUT_MS,
  StateBox,
  systemTimer,
  type ConnectionMethod,
  type ConnectionState,
  type ModelProfile,
  type PrintOptions,
  type PrinterAdapter,
  type PrinterTimer,
} from './adapter.ts'
import {
  GATT_BUNDLES,
  MARKLIFE_OPTIONAL_SERVICES,
  bluetoothEnvironment,
  notificationBytes,
  type BluetoothDeviceLike,
  type BluetoothEnvironment,
  type BluetoothRequestOptions,
  type CharacteristicValueEvent,
  type GattBundleId,
  type GattCharacteristicLike,
  type GattServerLike,
} from './bluetooth.ts'
import { unsupportedMessage, unsupportedReason } from './browser-support.ts'
import { MARKLIFE_MESSAGES, OK, printerErrorWithMessage, type MarklifeErrorCode, type PrinterResult } from './errors.ts'
import { buildPrintJob } from './job.ts'
import { MARKLIFE_PROFILES, profileForDeviceName } from './profiles.ts'

/** 보내기 기본값 (L-12 4·5, D-N1-05·06) */
export const MARKLIFE_DEFAULTS = Object.freeze({
  /** 출력 시작부터 끝 알림까지 (ms) */
  printTimeoutMs: DEFAULT_PRINT_TIMEOUT_MS,
  /** 조각 사이 쉬는 시간 (ms) */
  packetIntervalMs: 30,
  /** 조각 크기 상한 (바이트) — MTU 알림으로 줄기만 한다 */
  maxPacketBytes: 90,
  /** 크레딧이 0일 때 기다리는 시간 (ms) — 지나면 조각 하나를 그냥 보낸다 */
  creditWaitMs: 1000,
  /** 크레딧 상한 */
  maxCredits: 4,
})

/** 끝 알림 바이트 */
const END_ACK = 0xaa
/** 흐름 제어 알림: `01 n` 크레딧, `02 lo hi` MTU */
const FLOW_CREDIT = 0x01
const FLOW_MTU = 0x02

export interface MarklifeAdapterOptions {
  /** 켤 프로필 (기본: Marklife 9종 — 바우아토는 EXPERIMENTAL_PROFILES를 일부러 넘길 때만) */
  readonly profiles?: readonly ModelProfile[]
  /** 기능 감지 환경 (기본: 부를 때의 navigator) */
  readonly environment?: () => BluetoothEnvironment
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
  readonly packetIntervalMs?: number
  readonly maxPacketBytes?: number
  readonly creditWaitMs?: number
}

export interface MarklifeAdapter extends PrinterAdapter {
  /** 연결한 프린터의 프로필 (연결 전에는 켠 첫 프로필) */
  readonly profile: ModelProfile
  /** 연결한 GATT 꾸러미 (연결 전 null) */
  readonly bundle: GattBundleId | null
}

/** 연결 하나의 자원과 흐름 제어 상태 */
interface Link {
  readonly device: BluetoothDeviceLike
  readonly gatt: GattServerLike
  readonly bundle: GattBundleId
  readonly write: (packet: Uint8Array) => Promise<void>
  readonly notify: GattCharacteristicLike
  readonly flow: GattCharacteristicLike | undefined
  credits: number
  packetLimit: number
  /** 출력 중에만 있다 */
  onEnd?: () => void
  onCredit?: () => void
  onDrop?: () => void
  readonly detach: () => void
}

type Outcome = { readonly kind: 'done' } | { readonly kind: 'timeout' } | { readonly kind: 'disconnected' } | { readonly kind: 'error'; readonly error: unknown }

const errorName = (error: unknown): string => (typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '')

function safeDisconnect(gatt: GattServerLike | null | undefined): void {
  try {
    gatt?.disconnect()
  } catch {
    // 이미 끊겼다
  }
}

/** 꾸러미의 특성들을 찾는다 (하나라도 없으면 undefined — 다음 꾸러미를 본다) */
async function findBundle(server: GattServerLike, id: GattBundleId): Promise<{ write: GattCharacteristicLike; notify: GattCharacteristicLike; flow: GattCharacteristicLike | undefined } | undefined> {
  const spec = GATT_BUNDLES[id]
  try {
    const service = await server.getPrimaryService(spec.service)
    const write = await service.getCharacteristic(spec.write)
    const notify = await service.getCharacteristic(spec.notify)
    const flow = spec.flow === null ? undefined : await service.getCharacteristic(spec.flow)
    if (typeof write.writeValueWithoutResponse !== 'function' && typeof write.writeValue !== 'function') return undefined
    return { write, notify, flow }
  } catch {
    return undefined
  }
}

/** Marklife·바우아토 어댑터 (켠 프로필의 이름 앞자리로 시작하는 기기만 받는다) */
export function createMarklifeAdapter(options: MarklifeAdapterOptions = {}): MarklifeAdapter {
  const profiles = [...(options.profiles ?? MARKLIFE_PROFILES)]
  const first = profiles[0]
  if (!first) throw new Error('프로필이 하나도 없다')
  for (const p of profiles) {
    if (p.protocol === 'NIIMBOT_B1') throw new Error(`NIIMBOT 프로필은 NIIMBOT 어댑터가 쓴다: ${p.id}`)
    if (p.namePrefix === null || p.namePrefix === '') throw new Error(`이름 앞자리가 없는 프로필은 고를 수 없다: ${p.id}`)
  }
  const environment = options.environment ?? bluetoothEnvironment
  const timer = options.timer ?? systemTimer
  const timeoutMs = options.printTimeoutMs ?? MARKLIFE_DEFAULTS.printTimeoutMs
  const intervalMs = options.packetIntervalMs ?? MARKLIFE_DEFAULTS.packetIntervalMs
  const maxPacket = Math.max(1, Math.min(MARKLIFE_DEFAULTS.maxPacketBytes, options.maxPacketBytes ?? MARKLIFE_DEFAULTS.maxPacketBytes))
  const creditWaitMs = options.creditWaitMs ?? MARKLIFE_DEFAULTS.creditWaitMs
  const box = new StateBox()
  let profile: ModelProfile = first
  let current: Link | undefined
  let connecting: Promise<PrinterResult> | undefined
  /** disconnect()를 부를 때마다 늘린다 — 그 전에 시작한 연결은 끝나도 붙지 않는다 */
  let generation = 0

  const fallbackApp = first.fallbackApp
  const fail = (code: MarklifeErrorCode, cause?: unknown, message: string = MARKLIFE_MESSAGES[code]): PrinterResult => ({ ok: false, error: printerErrorWithMessage(code, message, cause) })
  const unsupported = (env: BluetoothEnvironment): PrinterResult =>
    fail('UNSUPPORTED', undefined, unsupportedMessage(unsupportedReason(env.userAgent ?? '', env.maxTouchPoints ?? 0), fallbackApp))

  const methodsOf = (env: BluetoothEnvironment): ConnectionMethod[] => (typeof env.bluetooth?.requestDevice === 'function' ? ['bluetooth'] : [])

  /** 프린터 쪽에서 끊겼다 (또는 판매자가 끊었다) — 출력 중이면 그 출력은 DISCONNECTED */
  const drop = (link: Link): void => {
    if (current !== link) return
    current = undefined
    link.detach()
    link.onDrop?.()
    box.set('DISCONNECTED')
  }

  const requestErrorCode = (error: unknown): MarklifeErrorCode => {
    const name = errorName(error)
    const message = error instanceof Error ? error.message : String(error)
    if (/adapter (is )?not available|bluetooth.*(off|disabled|unavailable)/i.test(message)) return 'BLUETOOTH_OFF'
    // 고르기 창을 닫음 (판매자 동작 밖에서 부른 경우도 다시 누르게 안내한다)
    if (name === 'NotFoundError' || name === 'AbortError' || name === 'SecurityError' || name === 'NotAllowedError') return 'NOT_SELECTED'
    return 'DISCONNECTED'
  }

  const connectOnce = async (method: ConnectionMethod): Promise<PrinterResult> => {
    const started = generation
    const stale = (): boolean => generation !== started
    const env = environment()
    const bluetooth = env.bluetooth
    if (method !== 'bluetooth' || typeof bluetooth?.requestDevice !== 'function') return unsupported(env)
    box.set('CONNECTING')
    const giveUp = (code: MarklifeErrorCode, cause?: unknown): PrinterResult => {
      if (!stale()) box.set('DISCONNECTED')
      return fail(code, cause)
    }
    if (typeof bluetooth.getAvailability === 'function') {
      // 확인할 수 없으면(예외) 연결을 시도해 본다
      const available = await bluetooth.getAvailability().catch(() => true)
      if (stale()) return fail('DISCONNECTED')
      if (!available) return giveUp('BLUETOOTH_OFF')
    }
    const request: BluetoothRequestOptions = {
      filters: profiles.map((p) => ({ namePrefix: p.namePrefix as string })),
      optionalServices: [...MARKLIFE_OPTIONAL_SERVICES],
    }
    let device: BluetoothDeviceLike
    try {
      device = await bluetooth.requestDevice(request)
    } catch (error) {
      if (stale()) return fail('DISCONNECTED', error)
      return giveUp(requestErrorCode(error), error)
    }
    if (stale()) return fail('DISCONNECTED')
    const matched = profileForDeviceName(device.name, profiles)
    if (!matched) {
      safeDisconnect(device.gatt)
      return giveUp('WRONG_MODEL', '기기 이름이 켠 프로필의 이름 앞자리와 맞지 않다')
    }
    const gatt = device.gatt
    if (!gatt) return giveUp('DISCONNECTED')
    let server: GattServerLike
    try {
      server = await gatt.connect()
    } catch (error) {
      if (stale()) return fail('DISCONNECTED', error)
      return giveUp('DISCONNECTED', error)
    }
    if (stale()) {
      safeDisconnect(gatt)
      return fail('DISCONNECTED')
    }
    let bundle: GattBundleId = 'A'
    let chars = await findBundle(server, 'A')
    if (!chars) {
      bundle = 'C'
      chars = await findBundle(server, 'C')
    }
    if (stale()) {
      safeDisconnect(gatt)
      return fail('DISCONNECTED')
    }
    if (!chars) {
      const lost = !gatt.connected
      safeDisconnect(gatt)
      return giveUp(lost ? 'DISCONNECTED' : 'WRONG_MODEL', lost ? undefined : '꾸러미 A(ff00)·C(fd00)가 없다')
    }
    const { write: writeChar, notify, flow } = chars
    const withoutResponse = typeof writeChar.writeValueWithoutResponse === 'function' && writeChar.properties?.writeWithoutResponse !== false
    const write = (packet: Uint8Array): Promise<void> =>
      withoutResponse ? (writeChar.writeValueWithoutResponse as (v: Uint8Array) => Promise<void>).call(writeChar, packet) : (writeChar.writeValue as (v: Uint8Array) => Promise<void>).call(writeChar, packet)

    const onNotify = (event: CharacteristicValueEvent): void => {
      const value = notificationBytes(event, notify)
      // 끝 알림은 `AA` 한 바이트뿐이다 — `55`·여러 바이트는 끝 알림이 아니다
      if (value.length === 1 && value[0] === END_ACK) link.onEnd?.()
    }
    const onFlow = (event: CharacteristicValueEvent): void => {
      if (!flow) return
      const value = notificationBytes(event, flow)
      if (value[0] === FLOW_CREDIT && value.length >= 2) {
        link.credits = Math.min(MARKLIFE_DEFAULTS.maxCredits, link.credits + (value[1] as number))
        link.onCredit?.()
      } else if (value[0] === FLOW_MTU && value.length >= 3) {
        const mtu = (value[1] as number) | ((value[2] as number) << 8)
        // MTU 3 이하는 무시한다. 조각 크기는 줄기만 하고 90을 넘지 않는다
        if (mtu > 3) link.packetLimit = Math.max(1, Math.min(link.packetLimit, mtu - 3))
      }
    }
    const onGone = (): void => drop(link)
    const link: Link = {
      device,
      gatt,
      bundle,
      write,
      notify,
      flow,
      credits: 0,
      packetLimit: maxPacket,
      detach: () => {
        notify.removeEventListener('characteristicvaluechanged', onNotify)
        flow?.removeEventListener('characteristicvaluechanged', onFlow)
        device.removeEventListener('gattserverdisconnected', onGone)
      },
    }
    // 듣기를 먼저 붙이고 알림을 켠다 — 알림을 켜자마자 오는 첫 `01 04`를 놓치지 않게
    notify.addEventListener('characteristicvaluechanged', onNotify)
    flow?.addEventListener('characteristicvaluechanged', onFlow)
    device.addEventListener('gattserverdisconnected', onGone)
    // 연결하는 동안의 끊김은 아래에서 gatt.connected로 본다
    current = link
    const notConnected = (): boolean => current !== link || !gatt.connected
    try {
      if (flow) await flow.startNotifications()
      await notify.startNotifications()
    } catch (error) {
      if (current === link) current = undefined
      link.detach()
      safeDisconnect(gatt)
      if (stale()) return fail('DISCONNECTED', error)
      return giveUp('DISCONNECTED', error)
    }
    if (stale() || notConnected()) {
      if (current === link) current = undefined
      link.detach()
      safeDisconnect(gatt)
      if (stale()) return fail('DISCONNECTED')
      return giveUp('DISCONNECTED')
    }
    profile = matched
    box.set('CONNECTED')
    return OK
  }

  /** 작업 바이트를 조각으로 보내고 끝 알림을 기다린다 */
  const send = (link: Link, bytes: Uint8Array): Promise<Outcome> =>
    new Promise<Outcome>((resolve) => {
      let settled = false
      const handles = new Set<unknown>()
      const after = (ms: number, fn: () => void): unknown => {
        const handle = timer.setTimeout(() => {
          handles.delete(handle)
          fn()
        }, ms)
        handles.add(handle)
        return handle
      }
      const cancel = (handle: unknown): void => {
        if (handles.delete(handle)) timer.clearTimeout(handle)
      }
      let offset = 0
      /** 이번 출력의 첫 조각을 썼다 — 그 뒤의 `AA`만 센다 */
      let armed = false
      let ended = false
      let written = false
      const finish = (outcome: Outcome): void => {
        if (settled) return
        settled = true
        for (const handle of handles) timer.clearTimeout(handle)
        handles.clear()
        link.onEnd = undefined
        link.onCredit = undefined
        link.onDrop = undefined
        resolve(outcome)
      }
      link.onEnd = () => {
        if (!armed) return
        ended = true
        if (written) finish({ kind: 'done' })
      }
      link.onDrop = () => finish({ kind: 'disconnected' })
      after(timeoutMs, () => finish({ kind: 'timeout' }))

      const writeNext = (useCredit: boolean): void => {
        if (settled) return
        link.onCredit = undefined
        if (useCredit) link.credits = Math.max(0, link.credits - 1)
        const size = Math.min(link.packetLimit, bytes.length - offset)
        const packet = bytes.slice(offset, offset + size)
        offset += size
        armed = true
        let pending: Promise<void>
        try {
          pending = link.write(packet)
        } catch (error) {
          pending = Promise.reject(error instanceof Error ? error : new Error(String(error)))
        }
        pending.then(
          () => {
            if (settled) return
            if (offset >= bytes.length) {
              written = true
              if (ended) finish({ kind: 'done' })
              return
            }
            after(intervalMs, step)
          },
          (error: unknown) => {
            if (settled) return
            finish(link.gatt.connected && current === link ? { kind: 'error', error } : { kind: 'disconnected' })
          },
        )
      }

      const step = (): void => {
        if (settled) return
        if (!link.flow) {
          writeNext(false)
          return
        }
        if (link.credits > 0) {
          writeNext(true)
          return
        }
        // 크레딧이 0이면 기다린다. 1초 동안 오지 않으면 알림을 놓친 것으로 보고 하나를 그냥 보낸다
        const wait = after(creditWaitMs, () => writeNext(false))
        link.onCredit = () => {
          if (link.credits <= 0) return
          cancel(wait)
          writeNext(true)
        }
      }

      if (bytes.length === 0) {
        written = true
        return
      }
      step()
    })

  const adapter: MarklifeAdapter = {
    get profile() {
      return profile
    },
    get bundle() {
      return current?.bundle ?? null
    },
    get state(): ConnectionState {
      return box.state
    },
    onStateChange: (listener) => box.listen(listener),
    availableMethods: () => methodsOf(environment()),

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
      const gone = current
      current = undefined
      if (gone) {
        gone.detach()
        gone.onDrop?.()
      }
      box.set('DISCONNECTED')
      safeDisconnect(gone?.gatt)
      await Promise.resolve()
    },

    async print(image: LabelBitmap, printOptions: PrintOptions = {}): Promise<PrinterResult> {
      if (box.state === 'PRINTING') return fail('BUSY')
      const link = current
      if (box.state !== 'CONNECTED' || !link) return fail('NOT_CONNECTED')
      const job = buildPrintJob(profile, image, printOptions)
      if (!job.ok) return fail(job.code)
      box.set('PRINTING')
      const outcome = await send(link, job.bytes)
      if (outcome.kind === 'done') {
        // 끝 알림을 받은 뒤 끊겼으면 상태는 끊김 그대로 두고 출력은 끝난 것으로 알린다
        if (current === link) box.set('CONNECTED')
        return OK
      }
      if (outcome.kind === 'disconnected' || current !== link) return fail('DISCONNECTED')
      if (outcome.kind === 'error' && !link.gatt.connected) {
        // 끊김 알림보다 쓰기 오류가 먼저 왔다 — 끊김으로 본다
        drop(link)
        return fail('DISCONNECTED', outcome.error)
      }
      box.set('CONNECTED')
      if (outcome.kind === 'timeout') return fail('TIMEOUT')
      return fail('PRINT_FAILED', outcome.error)
    },
  }
  return adapter
}
