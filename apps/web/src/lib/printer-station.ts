// 이 기기의 프린터와 출력 기기 역할 (I1, LABEL_RULES L-7·L-8·L-11 4·6·8·10, D-I1-01·03·06, AC-I1-21~23·70).
// - 연결은 판매자가 누른 동작 안에서만 한다(블루투스·USB 선 — 이 브라우저에 있는 것만, 시험 모드면 시험용 프린터). 페이지를 열 때 스스로 잇지 않는다.
// - 이 기기가 출력 기기이고 대기열이 멈추지 않았고 프린터가 연결돼 있으면 서버 대기열에서 한 번에 한 장씩 받아(claim) 그리고 찍고 결과를 알린다.
//   받은 작업이 없으면(멈춤·대기 없음) 다음 print 알림을 기다린다. 앱 안에서 화면을 옮겨도 이어진다(앱 전체에 하나).
// - 프린터 연결이 바뀌면 서버에 알린다(끊김 → 끊김 멈춤, 다시 연결 → 끊김 멈춤 풀림, L-8 3).
// - 출력 중에 앱이 닫히면 그 시도는 다음에 열 때 끊김으로 알린다(찍혔는지 모른다 — 한 장 더 나오는 편이 빠지는 것보다 낫다, D-P1-09).
// - 테스트 인쇄는 서버를 거치지 않는다(기록 없음). 그 기기가 대기열 작업을 출력하는 중이면 할 수 없다.
// - 출력 기기는 화면 꺼짐 막기를 요청한다(지원할 때). 안 되면 화면이 안내한다.
// - 라벨 기능이 꺼져 있거나 켬/끔을 아직 모르면 받지 않는다(N4a, L-13 5·6, AC-N4a-17·18). 꺼지면(labels 알림·대기열 요약·받기의 LABELS_OFF)
//   새 받기를 멈추고, 이미 받은 한 장은 마저 찍어 결과를 알린다. 꺼진 동안은 화면 꺼짐 막기도 풀어 둔다(출력하지 않는다).
// - 마지막 프린터를 기억한다(QS1, D-QS1-01, L-7 "마지막 프린터 기억"): 연결에 성공하면 연결 방법과 기기를 알아보는 값만 이 브라우저 저장소에 둔다
//   (서버로 보내지 않는다). "다시 연결"은 기억한 기기로(고르기 창 없이 — 얻을 수 없으면 고르기 창), 연결 방법 단추는 늘 고르기 창이다.
// - 출력 기기에서 프린터가 저절로 끊기면 기억한 기기로만 1·2·4·8·16·30초 뒤 모두 6번 다시 잇는다(D-QS1-02, L-11 8). 이어진 뒤 60초가 지나야
//   횟수를 새로 센다. "연결 끊기"·다른 연결 방법·출력 기기에서 내려옴·라벨 기능 꺼짐이면 그친다. 다시 이어도 라벨을 다시 보내지 않는다.
// - 프린터 고르기 창은 한 목록이다(PRN2, L-7 고르기 목록 — createWebPrinterAdapter: NIIMBOT·Marklife·바우아토). 이은 프린터의 프로필 ID를
//   연결 알림에 함께 보낸다(L-11 10 — 이름·기기 ID는 보내지 않는다). 받은 작업의 템플릿 크기가 그 프로필 목록에 없으면 찍지 않고 라벨 오류로 알린다(L-11 13).
// - 실험 기종(L-7 지원 단계)은 그 연결에서 테스트 인쇄 뒤 "예"를 누른 것을 기억한다(testConfirmed — 끊김·다시 잇기면 지운다). 화면은 그 뒤에만 "이 기기에서 출력"을 보인다.
//   이미 출력 기기여도 같다(D-PRN2-10·15): "예" 전에는 받지(claim) 않고 서버에는 연결 안 됨으로 알린다(작업은 대기에 남는다). "예" 뒤 연결됨+프로필 ID로 다시 알린다.
// - 테스트 그림 크기: 저장된 라벨 크기가 이은 프린터 프로필의 크기 목록에 있으면 그 크기, 없으면 프로필 기본 크기(D-PRN2-27 — 프로필을 모르면 화면이 준 저장 크기).
import type { LabelBitmap } from '@livejjim/label'
import {
  PRINTER_MESSAGES,
  browserEnvironment,
  combineNiimbotFakes,
  connectedProfileId,
  createFakeNiimbotBluetooth,
  createFakeNiimbotSerial,
  createFakePrinter,
  createWebPrinterAdapter,
  detectMethods,
  isRememberingAdapter,
  parseRememberedPrinter,
  printerProfile,
  printerSupportStage,
  profileSupportsSize,
  sizeNotSupportedMessage,
  systemTimer,
  type ConnectionMethod,
  type ConnectionState,
  type FakeNiimbotBluetooth,
  type FakeNiimbotSerial,
  type FakePrintBehavior,
  type FakePrinter,
  type PrinterAdapter,
  type PrinterError,
  type PrinterErrorCode,
  type PrinterResult,
  type PrinterTimer,
} from '@livejjim/printer'
import { isApiError, post, withRetry, type ApiError } from '../api/client.ts'
import type { ClaimedJob, QueueSummary } from '../api/print-types.ts'
import { DENSITY_MAX, DENSITY_MIN, saveAttempt, saveDensity, saveDeviceName, savedAttempt, savedDensity } from './device.ts'
import type { RenderOutcome } from './label-render.ts'
import { LABELS_OFF, type PrintStore } from './print-store.ts'

/** 연결 방법: 브라우저(블루투스·USB 선) 또는 시험용 프린터 */
export type PrinterMethod = ConnectionMethod | 'test'

const METHOD_KEY = 'livejjim.printMethod'
/** 기억한 프린터 (실제 프린터 어댑터 — 연결 방법과 기기 ID·USB 번호만, D-QS1-01 (6)) */
export const REMEMBERED_KEY = 'livejjim.printer.remembered'
/** 기억한 시험용 프린터 (시험 모드 — 실제 프린터 기억과 섞이지 않게 따로) */
export const REMEMBERED_TEST_KEY = 'livejjim.printer.rememberedTest'
/** 시험 모드의 가짜 B1·가짜 USB 설정 (새로고침을 넘는 E2E — 시험 모드에서만 쓴다, AC-QS1-25) */
export const FAKE_DEVICES_KEY = 'livejjim.test.fakeDevices'

/** 저절로 다시 잇기 간격 (끊긴 때부터 차례로 — 누적 1·3·7·15·31·61초, D-QS1-02 (2)) */
export const AUTO_RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000]
/** 다시 이어진 뒤 이만큼 끊기지 않아야 저절로 다시 잇기 횟수를 새로 센다 (D-QS1-02 (3)) */
export const AUTO_RECONNECT_STABLE_MS = 60_000

/**
 * 그리기가 던지면(설정 오류가 아님 — 느린·메모리가 모자란 휴대폰의 글꼴 불러오기·캔버스 만들기 실패 등) 같은 장을 다시 그리기 전에 기다리는 시간.
 * 그리기에는 시간 제한이 없다(오래 걸리면 기다린다). 모두 실패하면 찍지 않은 채 끊김으로 알린다(그 장은 대기 맨 앞).
 * 그리기가 오류 결과를 돌려준 것(템플릿·데이터 — 설정 오류)은 다시 그려도 같으니 바로 라벨 오류로 알린다.
 */
export const RENDER_RETRY_DELAYS_MS: readonly number[] = [500, 1500, 3000]

export interface StationSnapshot {
  /** 이 브라우저에 있는 연결 방법 (블루투스가 앞) */
  readonly methods: readonly ConnectionMethod[]
  /** 마지막으로 고른 연결 방법 */
  readonly method: PrinterMethod | null
  readonly connection: ConnectionState
  readonly connecting: boolean
  readonly connectError: PrinterError | null
  readonly density: number
  /** 이 기기가 지금 찍고 있는 대기열 작업 */
  readonly job: { readonly id: string; readonly date: string } | null
  /** 대기열 작업을 받는 중이거나 찍는 중 (테스트 인쇄를 막는다 — 프린터에 두 장을 겹쳐 보내지 않는다) */
  readonly busy: boolean
  readonly testing: boolean
  /** 테스트 인쇄가 나왔다 ("또렷하게 보이나요?"를 묻는다) */
  readonly testPrinted: boolean
  /** 이 연결에서 테스트 인쇄를 하고 "예"를 눌렀다 (실험 기종의 "이 기기에서 출력" 조건 — L-7 지원 단계. 끊기면 지운다) */
  readonly testConfirmed: boolean
  /** 이은 프린터의 프로필 ID (끊겼거나 모르면 null — L-7·L-12, 예 `NIIMBOT_B1`) */
  readonly profileId: string | null
  /** 마지막으로 이었거나 잇는 프린터가 Marklife·바우아토(L-12)다 — 해볼 일의 "NIIMBOT 앱"·"B1"을 "프린터 앱"·"프린터"로 (L-7 해볼 일) */
  readonly labelPrinter: boolean
  readonly testError: string | null
  /** 이 기기에서 마지막으로 실패한 출력의 문장 */
  readonly lastError: string | null
  /** 화면 꺼짐 막기: 켬 · 지원 안 함/실패 · 쓰지 않음(출력 기기가 아님) */
  readonly wake: 'on' | 'unsupported' | 'off'
  /** 라벨 글꼴을 불러오지 못했다 (출력하지 않고 기다린다) */
  readonly fontError: boolean
  /**
   * 저절로 다시 잇기 (QL2 D-QL2-04, L-11 8): 이어지는 동안(다음 시도를 기다리거나 하는 중) `trying` — attempt = 그 시도의 차례(1~total),
   * 60초 안에 다시 끊겨 남은 횟수로 이어지면 그 차례부터. 마지막 시도까지 실패해 그쳤으면 `gaveUp`. 그 밖(판매자가 누름·이어짐·연결 끊기·
   * 다른 연결 방법·출력 기기에서 내려옴·라벨 기능 끔·출력 기기가 아님)은 null
   */
  readonly autoReconnect: AutoReconnectState
}

/**
 * 실험 기종이 이어져 있는데 그 연결에서 테스트 인쇄 "예"를 아직 누르지 않았다 (L-7 지원 단계, D-PRN2-10·15).
 * 이 동안 이 기기는 작업을 받지 않고 서버에는 연결 안 됨으로 알린다 — 출력 기기이든 아니든 같다
 */
export function awaitingTest(snapshot: Pick<StationSnapshot, 'connection' | 'profileId' | 'testConfirmed'>): boolean {
  const linked = snapshot.connection === 'CONNECTED' || snapshot.connection === 'PRINTING'
  return linked && !snapshot.testConfirmed && printerSupportStage(snapshot.profileId) === 'EXPERIMENTAL'
}

/**
 * 테스트 인쇄 크기 (D-PRN2-27, L-7 테스트 라벨): 저장된 라벨 크기가 이은 프린터 프로필의 크기 목록에 있으면 그 크기(실제 작업이 찍힐 크기로 확인),
 * 없으면 프로필 기본 크기(목록 밖 크기는 어차피 출력 때 라벨 오류다). 프로필을 모르면 저장된 크기 그대로
 */
export function testLabelSize<S extends string>(profileId: string | null, saved: S): S {
  const profile = profileId === null ? undefined : printerProfile(profileId)
  if (profile === undefined) return saved
  return profileSupportsSize(profile.id, saved) ? saved : (profile.defaultSize as S)
}

/** 저절로 다시 잇기의 화면 상태 (QL2 D-QL2-04) */
export type AutoReconnectState = { readonly kind: 'trying'; readonly attempt: number; readonly total: number } | { readonly kind: 'gaveUp' } | null

export type BecomeOutcome =
  | { readonly kind: 'ok'; readonly backlog: boolean; readonly waiting: number }
  | { readonly kind: 'taken'; readonly name: string }
  | { readonly kind: 'error'; readonly error: ApiError }

interface WakeSentinel {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

export interface StationOptions {
  readonly store: PrintStore
  readonly deviceId: string
  /** 실제 프린터 어댑터 (기본: 한 목록 어댑터 — NIIMBOT·Marklife·바우아토, L-7 고르기 목록) */
  readonly createAdapter?: () => PrinterAdapter
  /** 시험용 프린터 (기본: 가짜 프린터) */
  readonly createTestPrinter?: () => FakePrinter
  /** 이 브라우저의 연결 방법 (기본: navigator.bluetooth·serial 감지) */
  readonly detect?: () => ConnectionMethod[]
  /** 작업 그리기 (기본: 내장 글꼴 렌더러) */
  readonly render: (job: ClaimedJob) => Promise<RenderOutcome>
  /** 테스트 라벨 그리기 */
  readonly renderTest: (input: { shopName: string; date: string; size: ClaimedJob['template']['size'] }) => Promise<RenderOutcome>
  /** 그리기 준비 (내장 글꼴 불러오기) — 실패하면 받지 않고 기다린다 */
  readonly prepare?: () => Promise<void>
  /** 화면 꺼짐 막기 (없으면 지원 안 함) */
  readonly requestWakeLock?: (() => Promise<WakeSentinel>) | null
  readonly today: () => string
  /** 시험용 프린터 손잡이를 놓을 곳 (시험 모드에서만) */
  readonly exposeTestHandle?: (handle: TestPrinterHandle | null) => void
  /** 저절로 다시 잇기의 타이머 (기본: 시스템 타이머 — 시험은 손으로 돌리는 타이머를 넣는다) */
  readonly timer?: PrinterTimer
}

/** 가짜 B1 블루투스 설정 (시험 모드 손잡이 — 새로고침을 넘어 이어 갈 값) */
export interface FakeB1Setup {
  /** navigator.bluetooth.getDevices 없음·있음·예외 */
  readonly getDevices?: boolean | 'throws'
  /** 이미 허락된 기기인지 (새로고침 뒤 getDevices가 돌려준다) */
  readonly permitted?: boolean
  /** getAvailability() 값 */
  readonly available?: boolean
  /** 블루투스 장치가 정말 꺼짐 (없으면 available을 따른다 — `available: false, adapterOff: false`가 윈도우 오판) */
  readonly adapterOff?: boolean
  /** 프린터 전원 (끄면 다시 잇기를 거절한다) */
  readonly powered?: boolean
}

/** 가짜 B1 USB 설정 (시험 모드 손잡이) */
export interface FakeUsbSetup {
  /** navigator.serial.getPorts 있음·없음·예외 */
  readonly getPorts?: boolean | 'throws'
  /** 포트들 — 없으면 B1 포트 하나 */
  readonly ports?: readonly { readonly plugged?: boolean; readonly permitted?: boolean; readonly usbVendorId?: number; readonly usbProductId?: number }[]
}

/** E2E가 쓰는 시험용 프린터 손잡이 (서버가 시험 모드일 때만 생긴다, AC-I1-50) */
export interface TestPrinterHandle {
  /** 끝까지 출력한 그림 (받은 순서) */
  printed(): { width: number; height: number; data: number[] }[]
  printedCount(): number
  printCalls(): number
  /** n번째 출력(1부터)에서 낼 일: 'disconnect' · 'fail' · { delayMs } · null(지우기) */
  setBehavior(n: number, behavior: FakePrintBehavior | null): void
  simulateDisconnect(): void
  /** 다음 연결 시도에서 낼 오류 (null이면 성공) */
  setConnectError(code: PrinterErrorCode | null): void
  /**
   * "블루투스로 연결"을 가짜 B1 블루투스 기기(실제 B1 어댑터 + 가짜 기기)로 바꾼다 (FB1 AC-FB1-40 — 첫 확인 시간 초과·다시 잇기를 실제 어댑터로 본다).
   * 시험 모드에서만 있다. 부른 뒤 연결 방법에 블루투스가 생긴다
   */
  useFakeB1(): void
  /** 가짜 B1이 처음 몇 번의 첫 확인(협상)에 답하지 않을지 */
  setUnansweredNegotiations(n: number): void
  /** 가짜 B1: 고르기 창을 띄운 횟수 · 연결 시도 수(다시 잇기 포함) · 이어져 있는지 */
  fakeB1(): { readonly requests: number; readonly connectAttempts: number; readonly connected: boolean } | null
  /** 가짜 B1 더 보기 (QS1): fakeB1()에 더해 전원 · 허락됨 · getDevices를 부른 횟수 */
  fakeB1State(): {
    readonly requests: number
    readonly connectAttempts: number
    readonly connected: boolean
    readonly powered: boolean
    readonly permitted: boolean
    readonly getDevicesCalls: number
  } | null
  /** 가짜 B1 설정을 바꾼다 (없으면 가짜 B1을 먼저 꽂는다). 새로고침을 넘어 이어 간다(시험 모드의 sessionStorage) */
  setFakeB1(setup: FakeB1Setup): void
  /** 가짜 B1 프린터 쪽 끊김 (전원은 그대로 — 다시 잇기를 받는다) */
  fakeB1Disconnect(): void
  /** "USB 선으로 연결"을 가짜 B1 USB 포트로 바꾼다 (가짜 B1 블루투스와 같은 B1 어댑터에 꽂는다). 부른 뒤 연결 방법에 USB 선이 생긴다 */
  useFakeUsb(setup?: FakeUsbSetup): void
  /** 가짜 USB n번째(0부터) 포트를 뽑는다(이어져 있었으면 끊김) · 다시 꽂는다 */
  unplugFakeUsb(index?: number): void
  plugFakeUsb(index?: number): void
  /** 가짜 USB: 고르기 창(requestPort) 횟수 · getPorts를 부른 횟수 · 연결 시도 수 · 이어져 있는지 */
  fakeUsb(): { readonly requests: number; readonly getPortsCalls: number; readonly connectAttempts: number; readonly connected: boolean } | null
  /** 저절로 다시 잇기 시도 수 (이 페이지에서 — 기억한 기기로만 잇기를 부른 횟수) */
  autoReconnectAttempts(): number
  /** 저절로 다시 잇기를 기다리는 중인지 (다음 시도가 잡혀 있다) */
  autoReconnectWaiting(): boolean
  /**
   * 저절로 다시 잇기 켬/끔 (시험 모드만, 기본 켬 — 운영과 같다). 끊김 멈춤이 그대로 남아야 하는 앞 스프린트 E2E가 쓸 수 있게 둔다.
   * 끄면 기다리던 시도도 그친다
   */
  setAutoReconnect(on: boolean): void
  /**
   * 시험용 프린터가 흉내 낼 프로필 (PRN2 — 켠 프로필 표의 ID, 예 `BAUATO_PPA2L`. null이면 B1). 실험 표시·크기 목록 시험용.
   * 시험용 프린터가 이어져 있으면 먼저 끊는다(다음 연결부터 그 프로필). 표에 없는 ID면 바꾸지 않고 false
   */
  setTestProfile(profileId: string | null): boolean
}

function readMethod(): PrinterMethod | null {
  try {
    const value = window.localStorage.getItem(METHOD_KEY)
    return value === 'bluetooth' || value === 'serial' || value === 'test' ? value : null
  } catch {
    return null
  }
}

function writeMethod(method: PrinterMethod): void {
  try {
    window.localStorage.setItem(METHOD_KEY, method)
  } catch {
    // 이 페이지 동안만
  }
}

/** 한 목록 어댑터가 Marklife·바우아토(L-12) 쪽으로 이었나 */
const isLabelKind = (adapter: PrinterAdapter): boolean => (adapter as { readonly kind?: unknown }).kind === 'LABEL'

const bitmapOut = (image: LabelBitmap) => ({ width: image.width, height: image.height, data: [...image.data] })

function readJson(storage: () => Storage, key: string): unknown {
  try {
    const raw = storage().getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    // 깨진 값·저장소를 쓸 수 없음: 없는 것으로 본다
    return null
  }
}

function writeJson(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, JSON.stringify(value))
  } catch {
    // 이 페이지 동안만
  }
}

interface SavedFakes {
  b1?: FakeB1Setup
  usb?: FakeUsbSetup
}

function readFakes(): SavedFakes {
  if (typeof window === 'undefined') return {}
  const value = readJson(() => window.sessionStorage, FAKE_DEVICES_KEY)
  if (typeof value !== 'object' || value === null) return {}
  const v = value as Record<string, unknown>
  const pick = (x: unknown): Record<string, unknown> | undefined => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : undefined)
  const mode = (x: unknown): boolean | 'throws' | undefined => (x === true || x === false || x === 'throws' ? x : undefined)
  const flag = (x: unknown): boolean | undefined => (typeof x === 'boolean' ? x : undefined)
  const out: SavedFakes = {}
  const b1 = pick(v['b1'])
  if (b1 !== undefined) {
    const setup: { -readonly [K in keyof FakeB1Setup]: FakeB1Setup[K] } = {}
    const getDevices = mode(b1['getDevices'])
    if (getDevices !== undefined) setup.getDevices = getDevices
    for (const key of ['permitted', 'available', 'adapterOff', 'powered'] as const) {
      const f = flag(b1[key])
      if (f !== undefined) setup[key] = f
    }
    out.b1 = setup
  }
  const usb = pick(v['usb'])
  if (usb !== undefined) {
    const getPorts = mode(usb['getPorts'])
    const ports = Array.isArray(usb['ports'])
      ? (usb['ports'] as unknown[]).slice(0, 8).map((p) => {
          const port = pick(p) ?? {}
          const id = (x: unknown): number | undefined => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xffff ? x : undefined)
          const plugged = flag(port['plugged'])
          const permitted = flag(port['permitted'])
          const vendor = id(port['usbVendorId'])
          const product = id(port['usbProductId'])
          return {
            ...(plugged === undefined ? {} : { plugged }),
            ...(permitted === undefined ? {} : { permitted }),
            ...(vendor === undefined ? {} : { usbVendorId: vendor }),
            ...(product === undefined ? {} : { usbProductId: product }),
          }
        })
      : undefined
    out.usb = { ...(getPorts === undefined ? {} : { getPorts }), ...(ports === undefined ? {} : { ports }) }
  }
  return out
}

export class PrinterStation {
  readonly #options: StationOptions
  readonly #listeners = new Set<() => void>()
  #snapshot: StationSnapshot
  #adapter: PrinterAdapter | null = null
  #adapterMethod: PrinterMethod | null = null
  #unlistenAdapter: (() => void) | null = null
  #real: PrinterAdapter | null = null
  #test: FakePrinter | null = null
  /** 시험용 프린터가 흉내 낼 프로필 (null = B1) */
  #testProfileId: string | null = null
  #fakeB1: FakeNiimbotBluetooth | null = null
  #fakeB1Setup: FakeB1Setup = {}
  #fakeUsb: FakeNiimbotSerial | null = null
  #fakeUsbSetup: FakeUsbSetup = {}
  /** 기억한 프린터를 저장소에 맞추는 구독 (실제 어댑터·시험용 프린터) */
  #unlistenRealMemory: (() => void) | null = null
  #unlistenTestMemory: (() => void) | null = null
  /** 지금 어댑터의 마지막 상태 (연결된 뒤 끊김인지 가린다) */
  #lastState: ConnectionState = 'DISCONNECTED'
  readonly #timer: PrinterTimer
  /** 저절로 다시 잇기: 이번 끊김 묶음에서 쓴 시도 수 (D-QS1-02 (2)(3) — 6이면 그친다) */
  #autoUsed = 0
  /** 저절로 다시 잇기: 다음 시도 타이머 */
  #autoTimer: unknown = undefined
  /** 저절로 다시 잇기: 하는 중인 시도 */
  #autoInFlight: Promise<PrinterResult> | null = null
  /** 저절로 다시 잇기를 그칠 때마다 늘린다 — 그 전의 시도 결과는 다음 시도를 잡지 않는다 */
  #autoSeries = 0
  /** 다시 이어진 뒤 60초 타이머 (지나면 횟수를 새로 센다) */
  #stableTimer: unknown = undefined
  /** 판매자가 "연결 끊기"를 눌렀다 — 다시 이어질 때까지 저절로 잇지 않는다 */
  #autoBlocked = false
  /** 이 페이지에서 저절로 다시 잇기를 시도한 수 (시험 손잡이) */
  #autoAttempts = 0
  /** 시험 손잡이로 저절로 다시 잇기를 껐다 (시험 모드만) */
  #autoOffForTest = false
  #unsubscribeStore: (() => void) | null = null
  #stopped = false
  #pumping = false
  #again = false
  /** 마지막으로 서버에 알린 프린터 연결 (같은 값은 다시 알리지 않는다) */
  #reported: boolean | null = null
  /** 보내지 못한 결과 (같은 시도 표로 다시 보낸다 — 서버는 한 번만 기록) */
  #pendingResult: { readonly attempt: string; readonly body: Record<string, unknown> } | null = null
  #recovered = false
  #wake: WakeSentinel | null = null
  #wakeAsking = false
  #retryTimer: ReturnType<typeof setTimeout> | undefined = undefined
  #mine = false
  /**
   * 받기 응답을 잃었다(요청이 응답 없이 끊김, 또는 출력 중에 앱이 닫혀 받은 장이 기억에 없다): 서버는 그 장을 이 기기의 출력 중으로 적었을 수 있지만
   * 이 기기는 받지 못했다 — 그 장의 결과는 이 기기가 다시 받아야만 정해진다(서버가 대기 맨 앞으로 돌리고 같은 장을 새 표로, L-11 4).
   * 그래서 이 동안은 출력 그만하기를 기다리는 중에도 받기를 보낸다(그 장의 결과가 정해지면 서버가 출력 기기를 비운다, L-11 10·TE-I1-004).
   * 서버가 아직 이르다(BUSY)고 하면 조금 뒤 다시. 응답을 받은 받기(작업·대기 없음)나 출력 기기가 아님이면 지운다
   */
  #lostClaim = false

  constructor(options: StationOptions) {
    this.#options = options
    this.#timer = options.timer ?? systemTimer
    this.#snapshot = {
      methods: (options.detect ?? (() => detectMethods(browserEnvironment())))(),
      method: readMethod(),
      connection: 'DISCONNECTED',
      connecting: false,
      connectError: null,
      density: savedDensity(),
      job: null,
      busy: false,
      testing: false,
      testPrinted: false,
      testConfirmed: false,
      profileId: null,
      labelPrinter: false,
      testError: null,
      lastError: null,
      wake: 'off',
      fontError: false,
      autoReconnect: null,
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): StationSnapshot => this.#snapshot

  #set(patch: Partial<StationSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  get deviceId(): string {
    return this.#options.deviceId
  }

  /** 이 기기가 지금 출력 기기인지 */
  isMine(queue: QueueSummary | null = this.#options.store.queue): boolean {
    return queue?.device?.id === this.#options.deviceId
  }

  start(): void {
    this.#unsubscribeStore = this.#options.store.subscribe(() => this.#onStore())
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.#onVisible)
    this.#onStore()
  }

  stop(): void {
    this.#stopAuto()
    this.#clearStable()
    this.#stopped = true
    this.#unsubscribeStore?.()
    this.#unlistenAdapter?.()
    this.#unlistenRealMemory?.()
    this.#unlistenTestMemory?.()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.#onVisible)
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer)
    void this.#releaseWake()
    void this.#adapter?.disconnect()
    this.#options.exposeTestHandle?.(null)
    this.#listeners.clear()
  }

  #onVisible = (): void => {
    if (document.visibilityState === 'visible') this.#syncWake()
  }

  #onStore(): void {
    const snapshot = this.#options.store.getSnapshot()
    if (snapshot.config?.testPrinter === true && this.#test === null) this.#ensureTestPrinter()
    const queue = snapshot.overview?.queue ?? null
    if (queue === null) return
    const mine = this.isMine(queue)
    // 출력 기기에서 내려옴·라벨 기능 꺼짐: 저절로 다시 잇기를 그친다 (D-QS1-02 (4)) — 그친 뒤 문장도 지운다 (QL2 D-QL2-04 (3))
    if ((this.#autoTimer !== undefined || this.#autoInFlight !== null || this.#snapshot.autoReconnect !== null) && !this.#autoAllowed()) this.#stopAuto()
    if (mine !== this.#mine) {
      this.#mine = mine
      if (!mine) {
        this.#reported = null
        // 출력 기기가 아니게 됐다(바꾸기·그만하기): 서버가 이 기기의 출력 중 장을 대기 맨 앞으로 돌렸다
        this.#lostClaim = false
      }
    }
    if (!this.#recovered) {
      this.#recovered = true
      void this.#recover(queue)
    }
    this.#syncWake()
    void this.pump()
  }

  /** 처음: 앱이 출력 중에 닫혔던 시도를 끊김으로 알리고, 이 기기가 출력 기기인데 프린터가 이어져 있지 않으면 알린다 */
  async #recover(queue: QueueSummary): Promise<void> {
    const saved = savedAttempt()
    // 이 기기(탭)가 출력 기기이고 서버에 출력 중 장이 있는데 받은 장의 기억이 없다 = 받기 응답을 받기 전에 앱이 닫혔다 (받기와 같은 차례로 바로잡는다)
    if (this.isMine(queue) && queue.printing > 0 && (saved === null || saved.deviceId !== this.#options.deviceId)) this.#lostClaim = true
    if (saved !== null && saved.deviceId === this.#options.deviceId) {
      try {
        await post('/api/print/result', { deviceId: saved.deviceId, attempt: saved.attempt, ok: false, error: { code: 'DISCONNECTED' } })
        saveAttempt(null)
      } catch (error) {
        if (isApiError(error) && (error.status === 404 || error.status === 400 || error.status === 409)) saveAttempt(null)
      }
    } else if (saved !== null) saveAttempt(null)
    if (this.isMine(queue) && queue.device?.printerConnected === true && this.#adapter?.state !== 'CONNECTED') await this.#report(false, true)
  }

  // ── 연결 (판매자가 누른 동작 안에서만, L-7) ─────────────────────────────

  /** 시험용 프린터를 만든다 (흉내 낼 프로필 — 없으면 B1) */
  #makeTestPrinter(): FakePrinter {
    const profile = this.#testProfileId === null ? undefined : printerProfile(this.#testProfileId)
    if (profile === undefined && this.#options.createTestPrinter !== undefined) return this.#options.createTestPrinter()
    return createFakePrinter({ methods: ['bluetooth'], ...(profile === undefined ? {} : { profile }) })
  }

  /** 시험 손잡이: 시험용 프린터가 흉내 낼 프로필을 바꾼다 (이어져 있으면 먼저 끊는다) */
  #setTestProfile(profileId: string | null): boolean {
    if (profileId !== null && printerProfile(profileId) === undefined) return false
    if (profileId === this.#testProfileId) return true
    this.#testProfileId = profileId
    const previous = this.#test
    if (previous === null) return true
    this.#unlistenTestMemory?.()
    this.#test = this.#makeTestPrinter()
    this.#unlistenTestMemory = this.#wireMemory(this.#test, REMEMBERED_TEST_KEY)
    if (this.#adapter === previous) {
      this.#stopAuto()
      this.#unlistenAdapter?.()
      this.#unlistenAdapter = null
      this.#adapter = null
      this.#lastState = 'DISCONNECTED'
      void previous.disconnect()
      this.#set({ connection: 'DISCONNECTED', profileId: null, testPrinted: false, testConfirmed: false })
      if (this.isMine()) void this.#report(false)
    }
    return true
  }

  #ensureTestPrinter(): FakePrinter {
    if (this.#test === null) {
      this.#test = this.#makeTestPrinter()
      this.#unlistenTestMemory = this.#wireMemory(this.#test, REMEMBERED_TEST_KEY)
      // 손잡이는 지금의 시험용 프린터를 본다 (프로필을 바꾸면 새로 만든다)
      const test = (): FakePrinter => this.#test as FakePrinter
      this.#options.exposeTestHandle?.({
        printed: () => test().printed.map((record) => bitmapOut(record.image)),
        printedCount: () => test().printed.length,
        printCalls: () => test().printCalls,
        setBehavior: (n, behavior) => test().setBehavior(n, behavior ?? undefined),
        simulateDisconnect: () => test().simulateDisconnect(),
        setConnectError: (code) => test().setConnectError(code ?? undefined),
        useFakeB1: () => {
          this.#useFakeB1()
          this.#saveFakes()
        },
        setUnansweredNegotiations: (n) => {
          this.#useFakeB1().setUnansweredNegotiations(n)
        },
        fakeB1: () => {
          const fake = this.#fakeB1
          return fake === null ? null : { requests: fake.requests, connectAttempts: fake.connectAttempts, connected: fake.connected }
        },
        fakeB1State: () => {
          const fake = this.#fakeB1
          return fake === null
            ? null
            : {
                requests: fake.requests,
                connectAttempts: fake.connectAttempts,
                connected: fake.connected,
                powered: fake.powered,
                permitted: fake.permitted,
                getDevicesCalls: fake.getDevicesCalls,
              }
        },
        setFakeB1: (setup) => this.#setFakeB1(setup),
        fakeB1Disconnect: () => {
          this.#fakeB1?.disconnect()
        },
        useFakeUsb: (setup) => {
          this.#useFakeUsb(setup ?? {})
          this.#saveFakes()
        },
        unplugFakeUsb: (index) => {
          this.#fakeUsb?.unplug(index)
          this.#saveFakes()
        },
        plugFakeUsb: (index) => {
          this.#fakeUsb?.plug(index)
          this.#saveFakes()
        },
        fakeUsb: () => {
          const fake = this.#fakeUsb
          return fake === null ? null : { requests: fake.requests, getPortsCalls: fake.getPortsCalls, connectAttempts: fake.connectAttempts, connected: fake.connected }
        },
        autoReconnectAttempts: () => this.#autoAttempts,
        autoReconnectWaiting: () => this.#autoTimer !== undefined,
        setAutoReconnect: (on) => {
          this.#autoOffForTest = !on
          if (!on) this.#stopAuto()
        },
        setTestProfile: (profileId) => this.#setTestProfile(profileId),
      })
      // 새로고침을 넘는 시험(AC-QS1-42): 앞 페이지에서 꽂은 가짜 기기를 같은 설정(허락됨 포함)으로 다시 꽂는다 — 시험 모드에서만
      const saved = readFakes()
      if (saved.b1 !== undefined) {
        this.#fakeB1Setup = saved.b1
        this.#useFakeB1()
      }
      if (saved.usb !== undefined) this.#useFakeUsb(saved.usb)
    }
    return this.#test
  }

  /** 기억한 프린터를 저장소에서 되살리고, 바뀔 때마다 저장소에 쓴다 (D-QS1-01 (6) — 서버로 보내지 않는다) */
  #wireMemory(adapter: PrinterAdapter, key: string): (() => void) | null {
    if (!isRememberingAdapter(adapter) || typeof window === 'undefined') return null
    adapter.restoreRemembered(parseRememberedPrinter(readJson(() => window.localStorage, key)))
    return adapter.onRememberedChange((value) => {
      writeJson(() => window.localStorage, key, value)
    })
  }

  /** 시험 모드: 실제 한 목록 어댑터에 가짜 B1 블루투스 기기를 꽂는다 (한 번 — 이미 꽂았으면 그것) */
  #useFakeB1(): FakeNiimbotBluetooth {
    if (this.#fakeB1 !== null) return this.#fakeB1
    const setup = this.#fakeB1Setup
    const fake = createFakeNiimbotBluetooth({
      ...(setup.getDevices === undefined ? {} : { getDevices: setup.getDevices }),
      ...(setup.permitted === undefined ? {} : { permitted: setup.permitted }),
      ...(setup.available === undefined ? {} : { available: setup.available }),
      ...(setup.adapterOff === undefined ? {} : { adapterOff: setup.adapterOff }),
      ...(setup.powered === undefined ? {} : { powered: setup.powered }),
    })
    this.#fakeB1 = fake
    this.#plugFakeReal()
    if (!this.#snapshot.methods.includes('bluetooth')) this.#set({ methods: ['bluetooth', ...this.#snapshot.methods] })
    return fake
  }

  /** 시험 모드: 가짜 B1 설정 바꾸기 */
  #setFakeB1(setup: FakeB1Setup): void {
    const fake = this.#useFakeB1()
    if (setup.getDevices !== undefined) fake.setGetDevices(setup.getDevices)
    if (setup.permitted !== undefined) fake.setPermitted(setup.permitted)
    if (setup.available !== undefined) fake.setAvailable(setup.available)
    if ('adapterOff' in setup) fake.setAdapterOff(setup.adapterOff)
    if (setup.powered !== undefined) fake.setPowered(setup.powered)
    this.#fakeB1Setup = { ...this.#fakeB1Setup, ...setup }
    this.#saveFakes()
  }

  /** 시험 모드: 가짜 B1 USB 포트를 꽂는다 (가짜 B1 블루투스와 한 어댑터 — 한 번) */
  #useFakeUsb(setup: FakeUsbSetup): FakeNiimbotSerial {
    if (this.#fakeUsb !== null) {
      if (setup.getPorts !== undefined) this.#fakeUsb.setGetPorts(setup.getPorts)
      return this.#fakeUsb
    }
    this.#fakeUsbSetup = setup
    const usb = createFakeNiimbotSerial({
      ...(setup.getPorts === undefined ? {} : { getPorts: setup.getPorts }),
      ...(setup.ports === undefined ? {} : { ports: setup.ports }),
    })
    this.#fakeUsb = usb
    if (this.#fakeB1 === null) this.#useFakeB1()
    else this.#plugFakeReal()
    if (!this.#snapshot.methods.includes('serial')) this.#set({ methods: [...this.#snapshot.methods, 'serial'] })
    return usb
  }

  /** 시험 모드: 가짜 기기로 실제 B1 어댑터를 새로 만든다 (앞의 어댑터가 쓰이던 중이면 끊는다) */
  #plugFakeReal(): void {
    const bt = this.#fakeB1
    if (bt === null) return
    const usb = this.#fakeUsb
    const fakes = usb === null ? { environment: bt.environment, createClient: bt.createClient } : combineNiimbotFakes(bt, usb)
    const previous = this.#real
    this.#unlistenRealMemory?.()
    this.#real = createWebPrinterAdapter({ environment: () => fakes.environment, createClient: fakes.createClient })
    this.#unlistenRealMemory = this.#wireMemory(this.#real, REMEMBERED_KEY)
    if (previous !== null && this.#adapter === previous) {
      this.#stopAuto()
      this.#unlistenAdapter?.()
      this.#unlistenAdapter = null
      this.#adapter = null
      void previous.disconnect()
    }
  }

  /** 시험 모드: 꽂은 가짜 기기 설정(허락됨 포함)을 이 탭의 sessionStorage에 둔다 — 새로고침 뒤 같은 기기 */
  #saveFakes(): void {
    if (typeof window === 'undefined' || (this.#fakeB1 === null && this.#fakeUsb === null)) return
    const bt = this.#fakeB1
    const usb = this.#fakeUsb
    writeJson(() => window.sessionStorage, FAKE_DEVICES_KEY, {
      ...(bt === null ? {} : { b1: { ...this.#fakeB1Setup, permitted: bt.permitted, powered: bt.powered } }),
      ...(usb === null
        ? {}
        : {
            usb: {
              ...(this.#fakeUsbSetup.getPorts === undefined ? {} : { getPorts: this.#fakeUsbSetup.getPorts }),
              ports: usb.ports.map((port) => ({ plugged: port.plugged, permitted: port.permitted, ...port.getInfo() })),
            },
          }),
    })
  }

  #adapterFor(method: PrinterMethod): PrinterAdapter {
    if (method === 'test') return this.#ensureTestPrinter()
    if (this.#real === null) {
      this.#real = this.#options.createAdapter?.() ?? createWebPrinterAdapter()
      this.#unlistenRealMemory = this.#wireMemory(this.#real, REMEMBERED_KEY)
    }
    return this.#real
  }

  /** 연결 방법 단추 (판매자가 누른 동작 안에서 부른다 — 늘 고르기 창). 다른 방법으로 이어져 있었으면 먼저 끊는다 */
  async connect(method: PrinterMethod): Promise<boolean> {
    return this.#connect(method, 'pick')
  }

  async #connect(method: PrinterMethod, mode: 'pick' | 'remembered'): Promise<boolean> {
    // 판매자 동작: 저절로 다시 잇기를 그친다 (기다림은 없어지고, 하는 중인 시도는 끝까지 기다린다 — 같은 때 두 번 잇지 않는다)
    this.#stopAuto()
    const inFlight = this.#autoInFlight
    if (inFlight !== null) {
      await inFlight
      if (mode === 'remembered' && this.#adapter !== null && this.#adapter.state === 'CONNECTED') {
        // 그 시도로 이어졌다 = "다시 연결"의 결과 — 이 연결부터 새로 센다
        this.#autoUsed = 0
        this.#clearStable()
        this.#set({ connectError: null, lastError: null })
        if (this.isMine()) await this.#report(true, true)
        void this.pump()
        return true
      }
    }
    if (this.#snapshot.connecting) return false
    const adapter = this.#adapterFor(method)
    if (this.#adapter !== null && this.#adapter !== adapter) {
      const previous = this.#adapter
      this.#unlistenAdapter?.()
      this.#unlistenAdapter = null
      await previous.disconnect()
    }
    if (this.#adapter !== adapter) {
      this.#adapter = adapter
      this.#lastState = adapter.state
      this.#unlistenAdapter = adapter.onStateChange((state) => this.#onAdapterState(state))
    }
    this.#adapterMethod = method
    writeMethod(method)
    const wasConnected = adapter.state === 'CONNECTED'
    // 잇기·다시 잇기: 앞 연결의 테스트 확인은 지난 일이다 — 이어져 있던 프린터를 다시 이어도 연결이 바뀐 것으로 본다 (D-PRN2-15, 실험 기종은 이 연결에서 다시 확인)
    this.#set({ method, connecting: true, connectError: null, connection: adapter.state, testConfirmed: false, testPrinted: false })
    const target = method === 'test' ? (adapter.availableMethods()[0] ?? 'bluetooth') : method
    // "다시 연결"은 기억한 기기로 (얻을 수 없으면 고르기 창), 연결 방법 단추는 늘 고르기 창 (D-QS1-01 (5))
    const result = await (mode === 'remembered' && isRememberingAdapter(adapter) ? adapter.reconnect(target) : adapter.connect(target))
    this.#set({ connecting: false, connection: adapter.state, profileId: connectedProfileId(adapter), labelPrinter: isLabelKind(adapter), connectError: result.ok ? null : result.error, ...(result.ok ? { lastError: null } : {}) })
    if (result.ok) {
      // 판매자가 이은 연결부터 저절로 다시 잇기 횟수를 새로 센다 (D-QS1-02 (3))
      this.#autoUsed = 0
      this.#clearStable()
      // 이미 이어져 있던 프린터(연결 바뀜 알림이 없다)라도 다시 알린다: 서버는 끊김 결과(찍지 못한 장·늦게 닿은 결과)로 프린터를 끊김으로
      // 적었을 수 있다 — 알리지 않으면 "다시 연결"을 눌러도 끊김 멈춤이 풀리지 않는다
      if (this.isMine()) await this.#report(true, wasConnected)
      void this.pump()
    }
    return result.ok
  }

  /** "다시 연결": 마지막으로 쓴 방법의 기억한 기기로 (고르기 창 없이 — 얻을 수 없으면 고르기 창, D-QS1-01) */
  async reconnect(): Promise<boolean> {
    const method = this.#adapterMethod ?? this.#snapshot.method
    if (method === null) return false
    if (method === 'test' && this.#options.store.getSnapshot().config?.testPrinter !== true) return false
    if (method !== 'test' && !this.#snapshot.methods.includes(method)) return false
    return this.#connect(method, 'remembered')
  }

  /** 다시 연결할 수 있는 방법이 있는지 */
  get canReconnect(): boolean {
    const method = this.#adapterMethod ?? this.#snapshot.method
    if (method === null) return false
    if (method === 'test') return this.#options.store.getSnapshot().config?.testPrinter === true
    return this.#snapshot.methods.includes(method)
  }

  /** "연결 끊기": 저절로 다시 잇기도 그친다 (기억은 지우지 않는다 — "다시 연결"이 쓴다) */
  async disconnect(): Promise<void> {
    this.#stopAuto()
    this.#autoBlocked = true
    await this.#adapter?.disconnect()
  }

  #onAdapterState(state: ConnectionState): void {
    const previous = this.#lastState
    this.#lastState = state
    const adapter = this.#adapter
    const profileId = adapter === null ? null : connectedProfileId(adapter)
    // 끊기거나 다시 잇는 중이면 테스트 확인도 지운다 — 실험 기종은 이어진 그 연결에서 다시 확인한다 (L-7 지원 단계)
    const fresh = state === 'DISCONNECTED' || state === 'CONNECTING'
    this.#set({ connection: state, profileId, labelPrinter: adapter !== null && isLabelKind(adapter), ...(fresh ? { testConfirmed: false, testPrinted: false } : {}) })
    if (state === 'CONNECTED') {
      this.#autoBlocked = false
      this.#setAuto(null)
      // 저절로 다시 이어졌다: 60초 동안 끊기지 않으면 횟수를 새로 센다.
      // 타이머는 끊김/연결 중에서 처음 이어졌을 때만 건다 — 출력 한 장마다 오는
      // PRINTING → CONNECTED로 다시 걸면 자주 찍는 방송에서 횟수가 영영 새로 세어지지 않는다 (TD-QS1-001)
      const firstLink = previous !== 'PRINTING' && previous !== 'CONNECTED'
      if (firstLink && this.#autoUsed > 0) this.#armStable()
      this.#saveFakes()
    } else if (state === 'DISCONNECTED' && (previous === 'CONNECTED' || previous === 'PRINTING')) {
      // 연결된 뒤 끊김 (판매자 조작 아님 — "연결 끊기"는 #autoBlocked, 다른 방법은 듣기를 먼저 그만둔다)
      this.#clearStable()
      if (!this.#autoBlocked && this.#autoAllowed()) this.#scheduleAuto()
    }
    if (!this.isMine()) return
    if (state === 'DISCONNECTED') void this.#report(false)
    else if (state === 'CONNECTED') {
      void this.#report(true)
      void this.pump()
    }
  }

  // ── 저절로 다시 잇기 (D-QS1-02, L-11 8) ─────────────────────────────────

  /** 저절로 다시 이어도 되는가: 출력 기기이고 라벨 기능이 켜져 있고, 지금 어댑터가 기억한 기기를 안다 */
  #autoAllowed(): boolean {
    const adapter = this.#adapter
    return (
      !this.#stopped &&
      !this.#autoOffForTest &&
      this.isMine() &&
      this.#options.store.queue?.labelsEnabled === true &&
      adapter !== null &&
      isRememberingAdapter(adapter) &&
      adapter.hasRemembered
    )
  }

  /** 다음 시도를 잡는다 (이미 잡혀 있거나 6번을 다 썼으면 하지 않는다) */
  #scheduleAuto(): void {
    if (this.#autoTimer !== undefined || this.#autoInFlight !== null || this.#stopped) return
    const delay = AUTO_RECONNECT_DELAYS_MS[this.#autoUsed]
    if (delay === undefined) {
      // 다 썼다 — 그쳤다 (QL2 D-QL2-04 (2))
      this.#setAuto({ kind: 'gaveUp' })
      return
    }
    this.#setAuto({ kind: 'trying', attempt: this.#autoUsed + 1, total: AUTO_RECONNECT_DELAYS_MS.length })
    const series = this.#autoSeries
    this.#autoTimer = this.#timer.setTimeout(() => {
      this.#autoTimer = undefined
      if (series === this.#autoSeries) void this.#autoAttempt(series)
    }, delay)
  }

  async #autoAttempt(series: number): Promise<void> {
    const adapter = this.#adapter
    if (!this.#autoAllowed() || this.#autoBlocked || adapter === null || !isRememberingAdapter(adapter)) {
      this.#setAuto(null)
      return
    }
    if (adapter.state !== 'DISCONNECTED' || this.#snapshot.connecting) {
      this.#setAuto(null)
      return
    }
    this.#autoUsed++
    this.#autoAttempts++
    // 시도하는 동안은 지금의 "연결 중" (새 문장 없음, D-QS1-05). 저절로 잇기의 실패는 오류 상자를 띄우지 않는다(판매자 동작이 아니다)
    this.#set({ connecting: true })
    const attempt = adapter.connectRemembered()
    this.#autoInFlight = attempt
    let result: PrinterResult
    try {
      result = await attempt
    } finally {
      this.#autoInFlight = null
      this.#set({ connecting: false, connection: adapter.state })
    }
    if (result.ok) {
      this.#set({ connectError: null, lastError: null, autoReconnect: null })
      return
    }
    if (series !== this.#autoSeries || this.#adapter !== adapter) return
    this.#scheduleAuto()
  }

  /** 저절로 다시 잇기 화면 상태를 바꾼다 (같은 값이면 알리지 않는다) */
  #setAuto(next: AutoReconnectState): void {
    const now = this.#snapshot.autoReconnect
    if (now === next) return
    if (now !== null && next !== null && now.kind === next.kind && (now.kind === 'gaveUp' || (next.kind === 'trying' && now.attempt === next.attempt))) return
    this.#set({ autoReconnect: next })
  }

  /** 저절로 다시 잇기를 그친다 (기다리던 시도는 일어나지 않는다) */
  #stopAuto(): void {
    this.#autoSeries++
    if (this.#autoTimer !== undefined) {
      this.#timer.clearTimeout(this.#autoTimer)
      this.#autoTimer = undefined
    }
    this.#setAuto(null)
  }

  #armStable(): void {
    this.#clearStable()
    this.#stableTimer = this.#timer.setTimeout(() => {
      this.#stableTimer = undefined
      this.#autoUsed = 0
    }, AUTO_RECONNECT_STABLE_MS)
  }

  #clearStable(): void {
    if (this.#stableTimer !== undefined) {
      this.#timer.clearTimeout(this.#stableTimer)
      this.#stableTimer = undefined
    }
  }

  /** 서버에 프린터 연결 상태를 알린다 (같은 값이면 다시 알리지 않는다) */
  async #report(linked: boolean, force = false): Promise<void> {
    // 실험 기종이 그 연결에서 테스트 "예" 전이면 연결 안 됨으로 알린다 — 서버가 받기를 멈추고 작업은 대기에 남는다 (D-PRN2-10)
    const connected = linked && !awaitingTest(this.#snapshot)
    if (!force && this.#reported === connected) return
    this.#reported = connected
    try {
      // 이어졌으면 그 프린터의 프로필 ID를 함께 (L-11 10, D-PRN2-07 — 이름·기기 ID는 보내지 않는다. 모르면 보내지 않는다)
      const profileId = connected && this.#adapter !== null ? connectedProfileId(this.#adapter) : null
      await this.#options.store.act('/api/print/device/state', { deviceId: this.#options.deviceId, connected, ...(profileId === null ? {} : { profileId }) })
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#reported = null
      if (error.code === 'PRINT_NOT_DEVICE') void this.#options.store.reload()
    }
  }

  setDensity(density: number): void {
    if (!Number.isInteger(density) || density < DENSITY_MIN || density > DENSITY_MAX) return
    saveDensity(density)
    this.#set({ density })
  }

  // ── 출력 기기 (L-11 10) ─────────────────────────────────────────────────

  /** "이 기기에서 출력" (다른 기기가 출력 기기면 replace 없이는 taken) */
  async become(name: string, replace: boolean): Promise<BecomeOutcome> {
    try {
      // 이은 프린터의 프로필 ID도 함께 (L-11 10 — 모르면 보내지 않는다)
      const profileId = this.#adapter === null ? null : connectedProfileId(this.#adapter)
      const result = await this.#options.store.act<{ queue: QueueSummary; waiting: number; backlog: boolean }>('/api/print/device', {
        deviceId: this.#options.deviceId,
        name,
        ...(replace ? { replace: true } : {}),
        ...(profileId === null ? {} : { profileId }),
      })
      saveDeviceName(name)
      this.#mine = true
      this.#reported = true
      // 프린터가 그사이 끊겼거나 실험 기종의 테스트 "예" 전이면 바로 알린다 (출력 기기가 되는 기기는 연결된 것으로 서버가 본다, D-PRN2-10)
      if (this.#adapter?.state !== 'CONNECTED' || awaitingTest(this.#snapshot)) await this.#report(false, true)
      void this.#options.store.reload()
      void this.pump()
      return { kind: 'ok', backlog: result.backlog, waiting: result.waiting }
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.code === 'PRINT_DEVICE_TAKEN') {
        const device = error.details['device'] as { name?: unknown } | undefined
        return { kind: 'taken', name: typeof device?.name === 'string' ? device.name : '' }
      }
      return { kind: 'error', error }
    }
  }

  // ── 받기·찍기·결과 (L-11 4·6) ───────────────────────────────────────────

  #canClaim(): boolean {
    const queue = this.#options.store.queue
    return (
      !this.#stopped &&
      queue !== null &&
      // 라벨 기능이 켜져 있다고 안 뒤에만 (끔·모름이면 받지 않는다)
      queue.labelsEnabled === true &&
      this.isMine(queue) &&
      queue.pause === null &&
      // 출력 그만하기를 기다리는 중에는 새 장을 받지 않는다 — 단 받기 응답을 잃어 이 기기가 쥔 장이 없을 때는 그 장의 결과를 정하러 받는다(서버는 새 장을 주지 않고 비운다)
      (queue.device?.releasing !== true || (this.#lostClaim && this.#snapshot.job === null && this.#pendingResult === null)) &&
      this.#adapter !== null &&
      this.#adapter.state === 'CONNECTED' &&
      !this.#snapshot.testing &&
      // 실험 기종: 그 연결에서 테스트 "예" 전에는 받지 않는다 (D-PRN2-10)
      !awaitingTest(this.#snapshot)
    )
  }

  /** 받을 수 있으면 한 장씩 받아 찍는다. 이미 도는 중이면 끝난 뒤 한 번 더 본다 */
  async pump(): Promise<void> {
    if (this.#pumping) {
      this.#again = true
      return
    }
    this.#pumping = true
    try {
      do {
        this.#again = false
        if (this.#pendingResult !== null && !(await this.#flushResult())) break
        if (!this.#canClaim()) continue
        try {
          await this.#options.prepare?.()
          if (this.#snapshot.fontError) this.#set({ fontError: false })
        } catch {
          this.#set({ fontError: true })
          this.#retryLater()
          break
        }
        if (!this.#canClaim()) continue
        let claimed: { job: ClaimedJob | null; reason?: string }
        this.#set({ busy: true })
        try {
          claimed = await post<{ job: ClaimedJob | null; reason?: string }>('/api/print/claim', { deviceId: this.#options.deviceId })
        } catch (error) {
          this.#set({ busy: false })
          if (!isApiError(error)) throw error
          if (error.code === 'PRINT_NOT_DEVICE') {
            this.#lostClaim = false
            void this.#options.store.reload()
          } else if (error.code === LABELS_OFF) {
            // 꺼진 것을 늦게 알았다: 받기를 멈춘다 (다시 켜지면 알림이 다시 깨운다)
            this.#options.store.noteLabelsOff()
          } else if (error.transient) {
            // 응답을 잃었다: 서버가 그 장을 이 기기의 출력 중으로 적었을 수 있다
            this.#lostClaim = true
            this.#retryLater()
          }
          break
        }
        if (claimed.job === null) {
          this.#set({ busy: false })
          if (this.#lostClaim && claimed.reason === 'BUSY') {
            // 서버가 잃은 장을 아직 이 기기의 출력 중으로 둔다(준 지 얼마 안 됨) → 조금 뒤 다시 (그사이 알림마다 거듭 받지 않는다)
            this.#retryLater()
            break
          }
          // 대기도 출력 중도 없으면 잃은 장이 없다
          if (claimed.reason === 'EMPTY') this.#lostClaim = false
          continue
        }
        this.#lostClaim = false
        try {
          await this.#printJob(claimed.job)
        } finally {
          this.#set({ busy: false })
        }
        // 한 장 끝: 다음 장을 본다
        this.#again = true
      } while (this.#again && !this.#stopped)
    } finally {
      this.#pumping = false
    }
  }

  #retryLater(): void {
    if (this.#retryTimer !== undefined || this.#stopped) return
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      void this.pump()
    }, 3000)
  }

  async #printJob(job: ClaimedJob): Promise<void> {
    saveAttempt({ deviceId: this.#options.deviceId, attempt: job.attempt })
    this.#set({ job: { id: job.id, date: job.date } })
    // 이은 프린터가 이 크기를 찍지 못한다: 그리지도 보내지도 않고 라벨 오류로 알린다 — 서버는 라벨 오류로 멈춘다 (L-11 13, D-PRN2-07)
    const profileId = this.#adapter === null ? null : connectedProfileId(this.#adapter)
    if (profileId !== null && !profileSupportsSize(profileId, job.template.size)) {
      this.#set({ lastError: sizeNotSupportedMessage(job.template.size) })
      await this.#finishJob(job, { ok: false, error: { code: 'INVALID_TEMPLATE', item: 'size' } })
      return
    }
    let rendered: RenderOutcome
    try {
      rendered = await this.#renderWithRetry(job)
    } catch {
      // 다시 그려도 그리지 못했다(설정 오류가 아니다): 찍지 않았다 — 끊김으로 알린다(그 장은 대기 맨 앞, "다시 연결"로 이어서).
      // 라벨 오류로 알리지 않는다(판매자가 고칠 라벨 설정이 없다)
      await this.#finishJob(job, { ok: false, error: { code: 'DISCONNECTED' } })
      return
    }
    let body: Record<string, unknown>
    try {
      if (!rendered.ok) {
        body = { ok: false, error: { code: rendered.error.code, ...(rendered.error.item === undefined ? {} : { item: rendered.error.item }) } }
        this.#set({ lastError: rendered.error.message })
      } else {
        const adapter = this.#adapter
        // 받는 사이 프린터가 끊겼으면 끊김이다 (그 장은 대기 맨 앞 — 다시 연결하면 이어서)
        const result =
          adapter === null || adapter.state === 'DISCONNECTED'
            ? { ok: false as const, error: { code: 'DISCONNECTED' as const, message: PRINTER_MESSAGES.DISCONNECTED } }
            : await adapter.print(rendered.image, this.#printOptions(adapter))
        if (result.ok) {
          body = { ok: true }
          this.#set({ lastError: null })
        } else {
          body = { ok: false, error: { code: result.error.code } }
          this.#set({ lastError: result.error.message })
        }
      }
    } catch {
      // 출력 중 예상하지 못한 실패: 찍혔는지 모른다 — 끊김으로 알린다(그 장은 대기 맨 앞)
      body = { ok: false, error: { code: 'DISCONNECTED' } }
    }
    await this.#finishJob(job, body)
  }

  /**
   * 출력에 넘길 농도 (L-7 — 프로필 범위의 정수만): 농도를 받지 않는 프린터(L-12 테이프·바우아토)면 넘기지 않고,
   * 고른 농도가 그 프린터 범위 밖이면(B1에서 고른 4·5를 Marklife YXQ 1~3에) 넘기지 않아 프린터 기본값으로 찍는다
   */
  #printOptions(adapter: PrinterAdapter): { density?: number } {
    const range = adapter.profile.density
    const density = this.#snapshot.density
    return range === null || density < range.min || density > range.max ? {} : { density }
  }

  /** 그 장을 그린다. 던지면 조금 기다렸다 다시 그린다(RENDER_RETRY_DELAYS_MS). 오류 결과(설정 오류)는 다시 그리지 않는다 */
  async #renderWithRetry(job: ClaimedJob): Promise<RenderOutcome> {
    for (let tries = 0; ; tries++) {
      try {
        return await this.#options.render(job)
      } catch (error) {
        const wait = RENDER_RETRY_DELAYS_MS[tries]
        if (wait === undefined || this.#stopped) throw error
        await new Promise<void>((resolve) => setTimeout(resolve, wait))
      }
    }
  }

  async #finishJob(job: ClaimedJob, body: Record<string, unknown>): Promise<void> {
    this.#pendingResult = { attempt: job.attempt, body: { deviceId: this.#options.deviceId, attempt: job.attempt, ...body } }
    await this.#flushResult()
    this.#set({ job: null })
  }

  /** 보내지 못한 결과 보내기. 보냈거나 버려도 되면 true */
  async #flushResult(): Promise<boolean> {
    const pending = this.#pendingResult
    if (pending === null) return true
    try {
      await withRetry(() => post<{ recorded: boolean }>('/api/print/result', pending.body))
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.transient) {
        this.#retryLater()
        return false
      }
      // 모르는 시도(404) 등: 서버가 받지 않는다 — 버린다
    }
    if (this.#pendingResult === pending) this.#pendingResult = null
    if (savedAttempt()?.attempt === pending.attempt) saveAttempt(null)
    return true
  }

  // ── 테스트 인쇄 (서버 기록 없음, L-7 테스트 라벨) ───────────────────────

  /** 테스트 인쇄. 그 기기가 대기열 작업을 찍는 중이면 하지 않는다 */
  async testPrint(input: { shopName: string; size: ClaimedJob['template']['size'] }): Promise<void> {
    const adapter = this.#adapter
    if (adapter === null || adapter.state !== 'CONNECTED' || this.#snapshot.busy || this.#snapshot.job !== null || this.#snapshot.testing) return
    this.#set({ testing: true, testPrinted: false, testConfirmed: false, testError: null })
    // 테스트를 다시 하면 앞 "예"는 지난 일 — 실험 기종이면 연결 안 됨으로 알린다 (D-PRN2-10)
    this.#syncGate()
    const size = testLabelSize(connectedProfileId(adapter), input.size)
    try {
      const rendered = await this.#options.renderTest({ shopName: input.shopName, date: this.#options.today(), size })
      if (!rendered.ok) {
        this.#set({ testError: rendered.error.message })
        return
      }
      const result = await adapter.print(rendered.image, this.#printOptions(adapter))
      this.#set(result.ok ? { testPrinted: true } : { testError: result.error.message })
    } catch {
      this.#set({ testError: PRINTER_MESSAGES.PRINT_FAILED })
    } finally {
      this.#set({ testing: false })
      void this.pump()
    }
  }

  dismissTest(): void {
    this.#set({ testPrinted: false, testConfirmed: false, testError: null })
    this.#syncGate()
  }

  /** 테스트 결과의 답 ("예"는 이 연결에서 테스트 인쇄가 나온 뒤에만 받는다 — 실험 기종의 "이 기기에서 출력" 조건, L-7) */
  answerTest(yes: boolean): void {
    if (yes && !this.#snapshot.testPrinted) return
    this.#set({ testConfirmed: yes })
    this.#syncGate()
  }

  /**
   * 테스트 확인이 바뀌었다: 출력 기기이고 프린터가 이어져 있으면 서버에 다시 알린다 (D-PRN2-10) —
   * 실험 기종의 "예" 전이면 연결 안 됨, "예" 뒤면 연결됨+프로필 ID. 같은 값이면 알리지 않는다. 그 뒤 받기를 다시 본다
   */
  #syncGate(): void {
    if (!this.isMine() || this.#adapter === null || this.#adapter.state !== 'CONNECTED') return
    void this.#report(true).then(() => this.pump())
  }

  // ── 화면 꺼짐 막기 (D-I1-03) ───────────────────────────────────────────

  /** 화면 꺼짐 막기가 필요한가: 이 기기가 출력 기기이고 라벨 기능이 켜져 있다 */
  #wantWake(): boolean {
    return this.#mine && this.#options.store.queue?.labelsEnabled === true
  }

  #syncWake(): void {
    if (this.#wantWake()) {
      if (this.#wake !== null || this.#wakeAsking) return
      const request = this.#options.requestWakeLock
      if (request === undefined || request === null) {
        if (this.#snapshot.wake !== 'unsupported') this.#set({ wake: 'unsupported' })
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      this.#wakeAsking = true
      request().then(
        (sentinel) => {
          this.#wakeAsking = false
          if (!this.#wantWake() || this.#stopped) {
            void sentinel.release()
            return
          }
          this.#wake = sentinel
          this.#set({ wake: 'on' })
          sentinel.addEventListener('release', () => {
            if (this.#wake === sentinel) this.#wake = null
            if (this.#wantWake()) this.#set({ wake: 'unsupported' })
          })
        },
        () => {
          this.#wakeAsking = false
          this.#set({ wake: 'unsupported' })
        },
      )
    } else {
      void this.#releaseWake()
      if (this.#snapshot.wake !== 'off') this.#set({ wake: 'off' })
    }
  }

  async #releaseWake(): Promise<void> {
    const sentinel = this.#wake
    this.#wake = null
    try {
      await sentinel?.release()
    } catch {
      // 이미 풀렸다
    }
  }
}

/** 브라우저의 화면 꺼짐 막기 (없으면 null) */
export function browserWakeLock(): (() => Promise<WakeSentinel>) | null {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } }
  if (nav.wakeLock === undefined || typeof nav.wakeLock.request !== 'function') return null
  const lock = nav.wakeLock
  return () => lock.request('screen')
}
