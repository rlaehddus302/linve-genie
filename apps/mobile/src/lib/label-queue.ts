import type { PrinterTests } from '../services.tsx'
// 앱의 라벨 대기열 (APP-03·APP-04, LABEL_RULES L-11, 웹 lib/printer-station.ts와 같은 규칙 — 서버 대기열에서 한 장씩 받아 찍고 결과를 알린다).
// - 연결은 판매자가 누른 동작 안에서만(BLE 모듈). 이 기기가 출력 기기이고 대기열이 멈추지 않았고 프린터가 연결돼 있으면 한 번에 한 장씩 받는다(claim).
// - 그림은 서버가 만든다(APP-05) — 받은 그림을 BLE 모듈에 그대로 넘긴다. 결과는 같은 시도 번호로 알린다(네트워크 오류면 다시 보낸다).
// - 프린터 연결이 바뀌면 서버에 알린다(끊김 → 끊김 멈춤, 다시 연결 → 풀림).
// - 앱이 뒤에 있어도 연결은 끊지 않는다. 앞으로 돌아오면(resume) 대기열 요약을 다시 받고 쌓인 라벨을 이어 찍는다.
// - 연결 방법 단추("블루투스로 연결"·시험용 프린터)는 늘 고르기 창, "다시 연결"은 기억한 프린터로(고르기 창 없이 — 기억이 없으면 고르기 창, L-7).
// - 저절로 다시 잇기(L-11 8)는 이 기기가 출력 기기이고 라벨 기능이 켜져 있을 때만 허락한다(프린터 모듈이 1·2·4·8·16·30초 6번 잇는다).
// - 시험용 프린터는 서버가 시험 모드(GET /api/client-config testPrinter)일 때만 고를 수 있다(L-11 15).
// - 농도는 연결한 프린터의 범위 안에서만(B1 1~5 · Marklife YXQ 1~3). 농도를 받지 않는 프린터(L11)면 보내지 않고, 고른 농도가 범위 밖이면
//   보내지 않아 프린터 기본값으로 찍는다(D-PRN2-31 — 웹과 같다. 프로필이 바뀌어도 고른 농도를 바꾸지 않는다).
// - 이은 프린터의 프로필 ID를 연결 알림·"이 기기에서 출력"에 함께 보낸다(PRN2 L-11 10 — 이름·기기 ID는 보내지 않는다). 받은 작업의 템플릿 크기가
//   그 프로필 목록에 없거나 템플릿에 크기가 없으면 찍지 않고 라벨 오류(INVALID_TEMPLATE, size)로 알린다 — 서버는 라벨 오류로 멈춘다(L-11 13, D-PRN2-34).
// - 실험 기종(L-7 지원 단계)은 그 연결에서 테스트 인쇄 뒤 "예"를 누른 것을 기억한다(testConfirmed — 끊김·다시 잇기면 지운다). 화면은 그 뒤에만 "이 기기에서 출력"을 보인다.
//   이미 출력 기기여도 같다(D-PRN2-10·15, 웹과 같은 기준): "예" 전에는 받지 않고 서버에는 연결 안 됨으로 알린다. "예" 뒤 연결됨+프로필 ID로 다시 알린다.
// - 테스트 그림·그림 파일 크기: 저장된 라벨 크기가 이은 프린터 프로필의 크기 목록에 있으면 그 크기, 없으면 프로필 기본 크기(D-PRN2-27 —
//   프로필을 모르면 저장된 크기, 그것도 모르면 50×30). 테스트 인쇄 중에는 작업을 받지 않는다(D-PRN2-29 — 웹 testing과 같다).
// - 제조사 앱으로 보내기(기본 대체, L-7·L-11 17)는 서버가 만든 PNG를 그대로 공유 창에 넘긴다 — 앱이 다시 그리거나 PNG를 만들지 않는다.
//   테스트 라벨은 `/api/print/test-png`, 이 기기가 받은 작업은 `/api/print/jobs/:id/png`(D-PRN2-28). 작업 그림을 보내도 작업 상태를 바꾸지 않고
//   결과(/print/result)를 보내지 않는다(LBL-07 — 파일로 내보낸 것은 출력함으로 치지 않는다).
import { connectedProfileId, printerProfile, printerSupportStage, profileSupportsSize, sizeNotSupportedMessage, type DensityRange } from '@livejjim/printer'
import type { ClaimedJob, ClientConfig, PrintNotice, PrintOverview, QueueSummary, Templates } from '@livejjim/web/src/api/print-types.ts'
import { fetchTestBitmap, fetchJobBitmap, bitmapFailure, fetchJobPng, fetchTestPng } from '../api/labels.ts'
import { get, isApiError, post, withRetry, type ApiError } from '../api/client.ts'
import type { EventSourceLike, SseMessage } from '../api/sse.ts'
import type { AutoReconnectState, ConnectionState, NativeBlePrinter, PrinterError, PrinterTarget } from '../native/ble.ts'
import { labelPaper } from './label-paper.ts'
import { realTimer, type Timer } from './live.ts'
import { APP_PRINTER_UNSUPPORTED } from './words.ts'

export interface LabelQueueSnapshot {
  readonly queue: QueueSummary | null
  /** 이 기기가 출력 기기인가 */
  readonly mine: boolean
  readonly printer: ConnectionState
  /** 지금 찍는 장 */
  readonly job: ClaimedJob | null
  readonly busy: boolean
  /** 마지막 프린터 오류 (쉬운 문장) */
  readonly printerError: PrinterError | null
  /** 불러오지 못함 */
  readonly loadError: ApiError | null
  /** 이 앱이 켜진 뒤 찍은 장 수 */
  readonly printed: number
  readonly density: number
  /** 지금 프린터가 받는 농도 범위 — 없으면 농도 칸을 숨긴다(L11) */
  readonly densityRange: DensityRange | null
  /** 지금 쓰는 연결 방법 */
  readonly target: PrinterTarget
  /** 기억한 프린터가 있다 ("다시 연결"이 고르기 창 없이 잇는다) */
  readonly hasRemembered: boolean
  /** 저절로 다시 잇기 (n번째 시도 · 그침) */
  readonly autoReconnect: AutoReconnectState
  /** 서버가 시험 모드 — 시험용 프린터를 고를 수 있다 (L-11 15) */
  readonly testPrinter: boolean
  /** 이은 프린터의 프로필 ID (끊겼거나 모르면 null — L-7·L-12) */
  readonly profileId: string | null
  /** 이 연결에서 테스트 인쇄가 나왔다 ("또렷하게 보이나요?"를 묻는다) */
  readonly testPrinted: boolean
  /** 이 연결에서 테스트 인쇄 뒤 "예"를 눌렀다 (실험 기종의 "이 기기에서 출력" 조건 — L-7 지원 단계) */
  readonly testConfirmed: boolean
  /** 테스트 인쇄 중 (이 동안 작업을 받지 않는다 — D-PRN2-29) */
  readonly testing: boolean
  /** 마지막 테스트 인쇄의 라벨 크기 ("아니요" 도움말의 크기 줄 — UX-PRN2-001). 아직 안 했으면 null */
  readonly testSize?: string | null
}

/**
 * 테스트 인쇄 크기 (D-PRN2-27, 웹 testLabelSize와 같다): 저장된 라벨 크기가 이은 프린터 프로필의 크기 목록에 있으면 그 크기,
 * 없으면 프로필 기본 크기. 프로필을 모르면 저장된 크기, 그것도 모르면 50×30
 */
export function testLabelSize(profileId: string | null, saved: string | null): string {
  const profile = profileId === null ? undefined : printerProfile(profileId)
  if (profile === undefined) return saved ?? '50x30'
  return saved !== null && profileSupportsSize(profile.id, saved) ? saved : profile.defaultSize
}

/**
 * 실험 기종이 이어져 있는데 그 연결에서 테스트 인쇄 "예"를 아직 누르지 않았다 (L-7 지원 단계, D-PRN2-10·15 — 웹 awaitingTest와 같다).
 * 이 동안 받지 않고 서버에는 연결 안 됨으로 알린다
 */
export function awaitingTest(snapshot: Pick<LabelQueueSnapshot, 'printer' | 'profileId' | 'testConfirmed'>): boolean {
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  return linked && !snapshot.testConfirmed && printerSupportStage(snapshot.profileId) === 'EXPERIMENTAL'
}

export interface LabelQueueOptions {
  readonly ble: NativeBlePrinter
  readonly deviceId: string
  /** 라벨 그림을 공유 시트로 보낸다 (PR-07) */
  readonly share?: (png: Uint8Array, name: string) => Promise<void>
  readonly openStream: () => EventSourceLike
  readonly printerTests?: PrinterTests
  readonly timer?: Timer
}

const RETRY_MS = 2000
/** 템플릿에 크기가 없을 때 (L-7 INVALID_TEMPLATE size 문장) */
const INVALID_SIZE_MESSAGE = '쓸 수 없는 라벨 크기예요. 라벨 크기 목록에서 다시 골라 주세요.'
const LABELS_OFF = 'LABELS_OFF'

export class LabelQueue {
  readonly #options: LabelQueueOptions
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  #snapshot: LabelQueueSnapshot
  #stream: EventSourceLike | null = null
  #pumping = false
  #again = false
  #retry: unknown = undefined
  #reported: boolean | null = null
  #stopped = false
  #readyCount = 0
  #unsubState: (() => void) | null = null
  #unsubChange: (() => void) | null = null
  #autoAllowed = false

  constructor(options: LabelQueueOptions) {
    this.#options = options
    this.#timer = options.timer ?? realTimer
    const ble = options.ble
    const range = ble.profile.density
    this.#snapshot = {
      queue: null,
      mine: false,
      printer: ble.state,
      job: null,
      busy: false,
      printerError: null,
      loadError: null,
      printed: 0,
      density: range?.default ?? 3,
      densityRange: range,
      target: ble.target,
      hasRemembered: ble.hasRemembered,
      autoReconnect: ble.autoReconnect,
      testPrinter: false,
      profileId: connectedProfileId(ble),
      testPrinted: false,
      testConfirmed: false,
      testing: false,
    }
  }

  get paperDeviceId(): string | null {
    const ble = this.#options.ble
    const device = ble.remembered
    return ble.target === 'bluetooth' && (ble.state === 'CONNECTED' || ble.state === 'PRINTING') && device?.method === 'bluetooth' ? device.deviceId : null
  }

  async #printSheet(bitmap: Parameters<NativeBlePrinter['print']>[0]) {
    const id = this.paperDeviceId
    const result = await this.#options.ble.print(bitmap, this.#printOptions())
    if (result.ok && id !== null) await labelPaper.update(id, 'printed').catch(() => undefined)
    return result
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): LabelQueueSnapshot => this.#snapshot

  #set(patch: Partial<LabelQueueSnapshot>): void {
    if (this.#stopped) return
    // 프린터 모듈의 UNSUPPORTED 문장은 웹 브라우저용("이 브라우저에서는…")이라 앱 문장으로 바꾼다 (블루투스가 없는 기기·시뮬레이터)
    const fixed = patch.printerError?.code === 'UNSUPPORTED' ? { ...patch, printerError: { ...patch.printerError, message: APP_PRINTER_UNSUPPORTED } } : patch
    this.#snapshot = { ...this.#snapshot, ...fixed }
    this.#syncAuto()
    for (const listener of [...this.#listeners]) listener()
  }

  /** 저절로 다시 잇기 허락: 출력 기기이고 라벨 기능이 켜져 있을 때만 (L-11 8 — 내려오거나 끄면 그친다) */
  #syncAuto(): void {
    const allowed = !this.#stopped && this.#snapshot.mine && this.#snapshot.queue?.labelsEnabled === true
    if (allowed === this.#autoAllowed) return
    this.#autoAllowed = allowed
    this.#options.ble.setAutoReconnect(allowed)
  }

  /** 프린터 모듈의 지금 값 → 화면 (프로필이 바뀌어 농도 범위가 달라지면 그 프린터의 기본 농도로) */
  #linkedId: string | null = null

  #syncPrinter(): void {
    const ble = this.#options.ble
    const range = ble.profile.density
    const linked = ble.state === 'CONNECTED' || ble.state === 'PRINTING'
    const profileId = connectedProfileId(ble)
    const id = this.paperDeviceId
    const same = linked && profileId === this.#snapshot.profileId && id === this.#linkedId
    this.#linkedId = id
    this.#set({
      printer: ble.state,
      target: ble.target,
      hasRemembered: ble.hasRemembered,
      autoReconnect: ble.autoReconnect,
      densityRange: range,
      profileId,
      // 끊겼거나 다른 프린터가 이어졌으면 테스트 확인은 지난 일이다 (실험 기종은 그 연결에서 다시 확인 — L-7)
      ...(!same ? { testPrinted: false, testConfirmed: false } : {}),
      ...(id !== null && this.#options.printerTests ? { testConfirmed: this.#options.printerTests.has(id) } : {}),
    })
  }

  /** 테스트 결과의 답 ("예"는 이 연결에서 테스트 인쇄가 나온 뒤에만 받는다 — 실험 기종의 "이 기기에서 출력" 조건, L-7) */
  answerTest(yes: boolean): void {
    if (yes && !this.#snapshot.testPrinted) return
    if (this.paperDeviceId !== null) this.#options.printerTests?.set(this.paperDeviceId, yes)
    this.#set({ testConfirmed: yes })
    this.#syncGate()
  }

  /** 테스트 확인이 바뀌었다: 출력 기기이고 프린터가 이어져 있으면 서버에 다시 알리고(실험 기종의 "예" 전이면 연결 안 됨) 받기를 다시 본다 (D-PRN2-10) */
  #syncGate(): void {
    if (!this.#snapshot.mine || this.#options.ble.state !== 'CONNECTED') return
    void this.#report(true).then(() => this.pump())
  }

  /** 테스트 그림 크기 (D-PRN2-27): 저장된 상품 라벨 크기를 서버에서 읽고(못 읽으면 모름) 이은 프린터 프로필로 고른다 */
  async #testSize(): Promise<string> {
    let saved: string | null
    try {
      const size: unknown = (await get<Templates>('/api/print/templates')).product.template.size
      saved = typeof size === 'string' ? size : null
    } catch {
      saved = null
    }
    return testLabelSize(connectedProfileId(this.#options.ble), saved)
  }

  /** 시험 모드 신호 (읽지 못하면 시험 모드가 아니다 — 웹 print-store와 같다) */
  async #loadConfig(): Promise<void> {
    try {
      const config = await get<Partial<ClientConfig>>('/api/client-config')
      this.#set({ testPrinter: config.testPrinter === true })
    } catch {
      this.#set({ testPrinter: false })
    }
  }

  /** 출력에 넘길 농도: 농도를 받지 않는 프린터거나 고른 농도가 그 프린터 범위 밖이면 넘기지 않는다 (프린터 기본값 — D-PRN2-31, 웹과 같다) */
  #printOptions(): { density?: number } {
    const range = this.#options.ble.profile.density
    const density = this.#snapshot.density
    return range === null || density < range.min || density > range.max ? {} : { density }
  }

  start(): void {
    this.#stopped = false
    this.#unsubChange = this.#options.ble.onChange(() => this.#syncPrinter())
    this.#syncPrinter()
    void this.#loadConfig()
    this.#unsubState = this.#options.ble.onStateChange((state) => {
      this.#set({ printer: state })
      this.#syncPrinter()
      if (state === 'CONNECTED') {
        void this.#report(true)
        void this.pump()
      } else if (state === 'DISCONNECTED') void this.#report(false)
    })
    this.#connect()
    void this.reload()
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    this.#unsubState?.()
    this.#unsubChange?.()
    this.#unsubChange = null
    // 로그아웃·앱 끔 — 저절로 다시 잇지 않는다
    this.#syncAuto()
    if (this.#retry !== undefined) this.#timer.clear(this.#retry)
  }

  #connect(): void {
    const stream = this.#options.openStream()
    this.#stream = stream
    stream.addEventListener('ready', () => {
      this.#readyCount++
      // 다시 붙었다: 놓친 알림이 있을 수 있다 — 요약을 다시 받고 쌓인 라벨을 이어 찍는다 (APP-04)
      if (this.#readyCount > 1) void this.reload()
    })
    stream.addEventListener('print', (event: SseMessage) => {
      let data: PrintNotice | null
      try {
        data = JSON.parse(event.data) as PrintNotice
      } catch {
        data = null
      }
      if (data === null || !('queue' in data)) return
      const current = this.#snapshot.queue
      if (current !== null && data.rev < current.rev) return
      this.#applyQueue(data.queue)
    })
    stream.addEventListener('labels', () => void this.reload())
  }

  #applyQueue(queue: QueueSummary): void {
    this.#set({ queue, mine: queue.device?.id === this.#options.deviceId })
    void this.pump()
  }

  /** 대기열 요약 다시 받기 (GET /api/print) */
  async reload(): Promise<void> {
    if (this.#stopped) return
    try {
      const overview = await get<PrintOverview>('/api/print')
      this.#set({ loadError: null })
      this.#applyQueue(overview.queue)
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#set({ loadError: error })
    }
  }

  /** 앱이 앞으로 돌아왔다 (APP-04): 요약을 다시 받고 이어 찍는다 */
  resume(): void {
    void this.reload()
  }

  /** 지금 서버에 남은 장 수 (대기 + 출력 중) — "자리를 비운 동안 라벨 n장" */
  get backlog(): number {
    const queue = this.#snapshot.queue
    return queue === null ? 0 : queue.waiting + queue.printing
  }

  setDensity(density: number): void {
    const range = this.#options.ble.profile.density
    if (range === null || !Number.isInteger(density) || density < range.min || density > range.max) return
    this.#set({ density })
  }

  // ── 프린터 연결 (판매자 동작 안에서만) ──

  /** 연결 방법 단추 — 늘 고르기 창 (다른 프린터로 바꾸는 길). 시험용 프린터는 서버가 시험 모드일 때만 */
  async connect(target: PrinterTarget = 'bluetooth'): Promise<void> {
    if (target === 'test' && !this.#snapshot.testPrinter) return
    // 새 연결: 앞 연결의 테스트 확인은 지난 일이다 (D-PRN2-15)
    this.#set({ printerError: null, testPrinted: false, testConfirmed: false })
    await this.#options.ble.selectTarget(target)
    const result = await this.#options.ble.connect('bluetooth')
    if (!result.ok) this.#set({ printerError: result.error })
  }

  /** "다시 연결" — 지금 연결 방법의 기억한 프린터로 고르기 창 없이 (기억이 없으면 고르기 창) */
  async reconnect(): Promise<void> {
    // 다시 잇기도 연결이 바뀐 것이다 — "예"를 지운다 (D-PRN2-15)
    this.#set({ printerError: null, testPrinted: false, testConfirmed: false })
    const ble = this.#options.ble
    const result = ble.hasRemembered ? await ble.reconnect('bluetooth') : await ble.connect('bluetooth')
    if (!result.ok) this.#set({ printerError: result.error })
  }

  async disconnect(): Promise<void> {
    await this.#options.ble.disconnect()
  }

  /** 서버가 만든 테스트 라벨 그림 파일(203dpi 1비트 PNG, L-11 17)을 그대로 공유 시트로 제조사 앱에 보낸다. 프린터 연결과 상관없다. */
  async shareTest(): Promise<boolean> {
    const share = this.#options.share
    if (share === undefined) return false
    try {
      await share(await fetchTestPng(await this.#testSize()), 'livejjim-test-label.png')
      return true
    } catch {
      this.#set({ printerError: { code: 'PRINT_FAILED', message: '라벨 그림을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.', action: '다시 시도' } })
      return false
    }
  }

  /**
   * 이 기기가 받은 작업(지금 찍는 장)의 라벨 그림 파일을 공유 창으로 제조사 앱에 보낸다 (D-PRN2-28, L-11 17).
   * 작업 상태를 바꾸지 않고 결과를 알리지 않는다 — 출력함으로 치지 않는다(LBL-07). 받은 작업이 없으면 하지 않는다
   */
  async shareJob(): Promise<boolean> {
    const share = this.#options.share
    const job = this.#snapshot.job
    if (share === undefined || job === null) return false
    try {
      await share(await fetchJobPng(job, this.#options.deviceId), 'livejjim-label.png')
      return true
    } catch {
      this.#set({ printerError: { code: 'PRINT_FAILED', message: '라벨 그림을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.', action: '다시 시도' } })
      return false
    }
  }

  /** 테스트도 서버에서 받은 같은 비트맵만 출력한다. */
  async printTest(): Promise<boolean> {
    // 작업을 받는 중·찍는 중이거나 이미 테스트 중이면 하지 않는다 — 두 출력이 겹치면 프린터가 바빠 작업이 멈춘다 (D-PRN2-29)
    if (this.#snapshot.job !== null || this.#snapshot.busy || this.#snapshot.testing) return false
    if (this.paperDeviceId !== null) this.#options.printerTests?.set(this.paperDeviceId, false)
    this.#set({ testing: true, testPrinted: false, testConfirmed: false })
    // 테스트를 다시 하면 앞 "예"는 지난 일 — 실험 기종이면 연결 안 됨으로 알린다 (D-PRN2-10)
    this.#syncGate()
    try {
      const size = await this.#testSize()
      this.#set({ testSize: size })
      const bitmap = await fetchTestBitmap(size)
      const result = await this.#printSheet(bitmap)
      if (!result.ok) this.#set({ printerError: result.error })
      else this.#set({ testPrinted: true })
      return result.ok
    } catch {
      this.#set({ printerError: { code: 'PRINT_FAILED', message: '테스트 라벨을 받지 못했어요. 연결을 확인하고 다시 눌러 주세요.', action: '다시 시도' } })
      return false
    } finally {
      this.#set({ testing: false })
      void this.pump()
    }
  }

  async #report(linked: boolean): Promise<void> {
    // 실험 기종이 그 연결에서 테스트 "예" 전이면 연결 안 됨으로 알린다 — 서버가 받기를 멈추고 작업은 대기에 남는다 (D-PRN2-10)
    const connected = linked && !awaitingTest(this.#snapshot)
    if (!this.#snapshot.mine || this.#reported === connected) return
    this.#reported = connected
    try {
      // 이어졌으면 그 프린터의 프로필 ID를 함께 (L-11 10, D-PRN2-07 — 모르면 보내지 않는다)
      const profileId = connected ? connectedProfileId(this.#options.ble) : null
      await post('/api/print/device/state', { deviceId: this.#options.deviceId, connected, ...(profileId === null ? {} : { profileId }) })
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#reported = null
      if (error.code === 'PRINT_NOT_DEVICE') void this.reload()
    }
  }

  // ── 출력 기기 (L-11 10) ──

  async become(name: string, replace = false): Promise<{ kind: 'ok' } | { kind: 'taken'; name: string } | { kind: 'error'; error: ApiError }> {
    try {
      const profileId = connectedProfileId(this.#options.ble)
      await post('/api/print/device', { deviceId: this.#options.deviceId, name, ...(replace ? { replace: true } : {}), ...(profileId === null ? {} : { profileId }) })
      this.#reported = true
      this.#set({ mine: true })
      if (this.#options.ble.state !== 'CONNECTED' || awaitingTest(this.#snapshot)) {
        this.#reported = null
        await this.#report(false)
      }
      await this.reload()
      return { kind: 'ok' }
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.code === 'PRINT_DEVICE_TAKEN') {
        const device = error.details['device'] as { name?: unknown } | undefined
        return { kind: 'taken', name: typeof device?.name === 'string' ? device.name : '' }
      }
      return { kind: 'error', error }
    }
  }

  async release(): Promise<void> {
    await post('/api/print/device/release', {})
    this.#set({ mine: false })
    await this.reload()
  }

  async pause(): Promise<void> {
    await post('/api/print/pause', {})
    await this.reload()
  }

  async restart(): Promise<void> {
    await post('/api/print/restart', {})
    await this.reload()
  }

  // ── 받기·찍기·결과 (L-11 4·6) ──

  #canClaim(): boolean {
    const queue = this.#snapshot.queue
    return !this.#stopped && queue !== null && queue.labelsEnabled && this.#snapshot.mine && queue.pause === null && queue.device?.releasing !== true && this.#options.ble.state === 'CONNECTED' && this.#snapshot.job === null && !this.#snapshot.testing && !awaitingTest(this.#snapshot)
  }

  #retryLater(): void {
    if (this.#retry !== undefined) return
    this.#retry = this.#timer.set(() => {
      this.#retry = undefined
      void this.pump()
    }, RETRY_MS)
  }

  async pump(): Promise<void> {
    if (this.#pumping) {
      this.#again = true
      return
    }
    this.#pumping = true
    try {
      do {
        this.#again = false
        if (!this.#canClaim()) continue
        let claimed: { job: ClaimedJob | null; reason?: string }
        this.#set({ busy: true })
        try {
          claimed = await post<{ job: ClaimedJob | null; reason?: string }>('/api/print/claim', { deviceId: this.#options.deviceId })
        } catch (error) {
          this.#set({ busy: false })
          if (!isApiError(error)) throw error
          if (error.code === 'PRINT_NOT_DEVICE' || error.code === LABELS_OFF) void this.reload()
          else if (error.transient) this.#retryLater()
          break
        }
        if (claimed.job === null) {
          this.#set({ busy: false })
          continue
        }
        await this.#printJob(claimed.job)
      } while (this.#again && !this.#stopped)
    } finally {
      this.#pumping = false
    }
  }

  async #printJob(job: ClaimedJob): Promise<void> {
    this.#set({ job, busy: true })
    let ok = false
    let error: { code: string; item?: string } | null = null
    // 템플릿에 크기가 없거나 이은 프린터가 이 크기를 찍지 못한다: 그림을 받지도 보내지도 않고 라벨 오류로 알린다 (L-11 13, D-PRN2-07·34 — 웹과 같다)
    const profileId = connectedProfileId(this.#options.ble)
    const size = (job.template as { readonly size?: unknown } | null)?.size
    if (typeof size !== 'string' || (profileId !== null && !profileSupportsSize(profileId, size))) {
      error = { code: 'INVALID_TEMPLATE', item: 'size' }
      this.#set({ printerError: { code: 'PRINT_FAILED', message: typeof size === 'string' ? sizeNotSupportedMessage(size) : INVALID_SIZE_MESSAGE } })
    } else {
      try {
        const bitmap = await fetchJobBitmap(job, this.#options.deviceId)
        const result = await this.#printSheet(bitmap)
        ok = result.ok
        if (!result.ok) {
          error = { code: result.error.code }
          this.#set({ printerError: result.error })
        }
      } catch (caught) {
        const failure = bitmapFailure(caught)
        error = { code: failure.code, ...(failure.item === undefined ? {} : { item: failure.item }) }
        this.#set({ printerError: { code: 'PRINT_FAILED', message: failure.message, action: '다시 시도' } })
      }
    }
    const body = { deviceId: this.#options.deviceId, attempt: job.attempt, ok, ...(error === null ? {} : { error }) }
    try {
      await withRetry(() => post<{ recorded: boolean }>('/api/print/result', body))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 결과를 알리지 못했다: 서버는 시도 시간이 지나면 끊김으로 본다 — 요약을 다시 받는다
    }
    this.#set({ job: null, busy: false, ...(ok ? { printed: this.#snapshot.printed + 1, printerError: null } : {}) })
    if (!ok) this.#retryLater()
    else this.#again = true
  }
}
