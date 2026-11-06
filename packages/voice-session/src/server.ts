// APP1b: 기존 V2/V3 읽기 컨트롤러를 서버 메모리에서 그대로 실행한다.
// 쓰기 효과는 기기로 보내 기존 요청 API를 거친다. 소리·글·상태는 저장하지 않는다.
import { AsyncLocalStorage } from 'node:async_hooks'
import { decideFixForm } from './read/quick.ts'
import * as voice from '@livejjim/voice'
import { BaseSpeechEngine, type SpeechResult } from '../../voice/src/speech.ts'
import { VoiceController, type VoiceHost } from './controller/controller.ts'
import { CHROME_RESULT_UNSUPPORTED, VOICE_COMMANDS, isRecord, isVoiceClientMessage, toWire, type VoiceFlowMode, type VoiceServerMessage } from './wire.ts'
import { sealResume, openResume } from './resume.ts'

type DataKeys = 'maxNumber' | 'currentNames' | 'products' | 'fetchHistory' | 'priceUnit' | 'existingProduct' | 'smsReadOptions' | 'smsProduct' | 'smsProductName' | 'readSmsTime' | 'readLearned' | 'writeLearned' | 'lastVoiceDevice' | 'ready'
export type ReadingHost = Pick<VoiceHost, DataKeys>
export interface ReadingSessionOptions {
  readonly host: ReadingHost
  readonly device: string
  readonly broadcastId?: string
  readonly accountId?: string
  readonly send: (message: VoiceServerMessage) => void
  readonly now?: () => number
  /** 흐름 종류 (D-APP-25). control·chrome은 마이크 없는 조작 전용 — 받아쓴 글을 받지 않는다 */
  readonly mode?: VoiceFlowMode
  readonly mergeLearned?: (learned: unknown) => Promise<void>
}

class ReceivedSpeech extends BaseSpeechEngine {
  readonly kind = 'livegenie' as const
  isSupported(): boolean { return true }
  start(): void { this.setState('LISTENING') }
  stop(): void { this.setState('OFF') }
  receive(result: SpeechResult): void { if (this.getState() === 'LISTENING') this.emitResult(result) }
}

/** 이 인스턴스 하나는 인증된 판매자·방송·기기 흐름 하나에만 속한다. */
export function createReadingSession(options: ReadingSessionOptions) {
  const wallNow = options.now ?? Date.now
  const engine = new ReceivedSpeech()
  const sessionId = globalThis.crypto.randomUUID()
  const cardVersions = new Map<string, { json: string; version: number }>()
  const cardEnds = new Map<string, number>()
  const smsEnds = new Map<string, number>()
  const numberEnds = new Map<number, number>()
  const registrationEnds = new Map<string, number>()
  const automaticContext = new AsyncLocalStorage<{ readonly automatic: boolean; readonly spokenEndAt?: number }>()
  let closed = false
  let initialized = false
  let sessionReady = false
  const resumeScope = JSON.stringify([options.accountId ?? '', options.broadcastId ?? '', options.device])
  let clockOffset = 0
  let capturedAt: number | null = null
  /** 마지막 결과의 받아쓰기 확신도 (D-V3-130) */
  let lastConf: number | null = null
  let settings: unknown = null
  let smsSettings: unknown = null
  let consent = false
  let dialogOpen = false
  let smsAutoAllowed = true
  let nextEffect = 1
  const undoable = new Map<string, number>()
  const pending = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  // DB의 등록 반영은 기기의 상품 목록 반영보다 빠를 수 있다. 같은 등록의 고침은
  // 기존 HTTP 경로가 목록까지 따라잡았다는 noteVoiceRegistered 뒤에 보낸다.
  const registering = new Map<number, {
    cardId: string
    card: unknown
    name: string
    price: number
    done: Promise<boolean>
    finish: (confirmed: boolean) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const finishRegistration = (no: number, confirmed: boolean) => {
    const waiting = registering.get(no)
    if (waiting === undefined) return
    clearTimeout(waiting.timer); registering.delete(no); waiting.finish(confirmed)
  }
  const sameCard = (left: unknown, right: unknown): boolean => isRecord(left) && isRecord(right) && Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => JSON.stringify(value) === JSON.stringify(right[key]))
  const now = () => wallNow() + clockOffset
  let nextTimer = 1
  const scheduled = new Map<number, { at: number; run: () => void; timer: ReturnType<typeof setTimeout> }>()
  const timers = {
    set(run: () => void, ms: number): number {
      const id = nextTimer++
      const context = automaticContext.getStore() ?? { automatic: true }
      const runInContext = () => automaticContext.run(context, run)
      const timer = setTimeout(() => { const item = scheduled.get(id); scheduled.delete(id); if (item !== undefined && !closed) item.run() }, ms)
      scheduled.set(id, { at: now() + ms, run: runInContext, timer })
      return id
    },
    clear(id: unknown): void { if (typeof id !== 'number') return; const item = scheduled.get(id); if (item !== undefined) clearTimeout(item.timer); scheduled.delete(id) },
    flush(): void {
      for (let count = 0; count < 100; count++) {
        const due = [...scheduled].filter(([, item]) => item.at <= now()).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.clear(due[0]); if (!closed) due[1].run()
      }
    },
  }
  const emit = (message: VoiceServerMessage) => { if (!closed) options.send(message) }

  function effect(method: string, args: readonly unknown[], wait = false): Promise<unknown> {
    if (closed) return Promise.resolve(null)
    const id = nextEffect++
    const { automatic, spokenEndAt: currentEnd } = automaticContext.getStore() ?? { automatic: true }
    let spokenEndAt = currentEnd
    if (spokenEndAt === undefined) {
      if (method === 'register' && isRecord(args[0])) spokenEndAt = cardEnds.get(String(args[0].id))
      if (method === 'fixRecent' || method === 'undoRecent') spokenEndAt = registrationEnds.get(String(args[0]))
      if (method === 'renumber' && typeof args[0] === 'number') spokenEndAt = numberEnds.get(args[0])
      if (method === 'writeSms' && isRecord(args[0])) {
        const no = args[0].no
        const ends = controller.getSnapshot().sms.filter((entry) => entry.sending && entry.card.reading.orders.some((order) => order.no === no)).map((entry) => smsEnds.get(entry.card.id)).filter((end): end is number => end !== undefined)
        if (ends.length > 0) spokenEndAt = Math.min(...ends)
      }
    }
    if (method === 'register' && spokenEndAt !== undefined && isRecord(args[1]) && typeof args[1].no === 'number') numberEnds.set(args[1].no, spokenEndAt)
    const message = { type: 'voice.effect' as const, sessionId, id, method, args: toWire(args), automatic, source: options.mode ?? 'livegenie', ...(!automatic || spokenEndAt === undefined ? {} : { spokenEndAt }) }
    if (!wait) { emit(message); return Promise.resolve(null) }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve(null) }, 30_000)
      pending.set(id, { resolve, timer })
      emit(message)
    })
  }
  const host: VoiceHost = {
    ...options.host,
    load: async () => voice,
    createEngine: () => engine,
    now,
    timers,
    deviceId: () => options.device,
    dialogOpen: () => dialogOpen,
    readConsent: () => consent,
    writeConsent: () => { consent = true; void effect('writeConsent', []) },
    readSettings: () => settings,
    writeSettings: (value) => { settings = value; void effect('writeSettings', [value]) },
    readSmsSettings: () => smsSettings,
    writeSmsSettings: (value) => { smsSettings = value; void effect('writeSmsSettings', [value]) },
    register: (card, registration, source) => {
      finishRegistration(registration.no, false)
      let finish: (confirmed: boolean) => void = () => {}
      const done = new Promise<boolean>((resolve) => { finish = resolve })
      const timer = setTimeout(() => finishRegistration(registration.no, false), 30_000)
      registering.set(registration.no, { cardId: card.id, card: toWire(card), name: registration.name, price: registration.price, done, finish, timer })
      const log = controller.voiceLogFor(card.text)
      void effect('register', [card, registration, source, log === null || lastConf === null ? log : { ...log, conf: lastConf }])
    },
    focusQuick: () => { void effect('focusQuick', []) },
    newRequestId: () => globalThis.crypto.randomUUID(),
    smsAutoAllowed: () => smsAutoAllowed,
    writeSms: async (...args) => (await effect('writeSms', args, true) as Awaited<ReturnType<NonNullable<VoiceHost['writeSms']>>>) ?? { kind: 'failed', message: '문자찜을 넣지 못했어요. 연결을 확인해 주세요.' },
    fixRecent: async (...args) => {
      const waiting = [...registering].find(([no]) => options.host.existingProduct?.(no)?.key === args[0])?.[1]
      if (waiting !== undefined && !await waiting.done) return { kind: 'failed', message: '등록한 상품을 확인하지 못했어요. 연결을 확인한 뒤 다시 고쳐 주세요.' }
      return (await effect('fixRecent', args, true) as Awaited<ReturnType<NonNullable<VoiceHost['fixRecent']>>>) ?? { kind: 'failed', message: '고치지 못했어요. 연결을 확인해 주세요.' }
    },
    renumber: async (...args) => (await effect('renumber', args, true) as boolean | 'claimed' | null) ?? false,
    undoRecent: (id) => {
      if ((undoable.get(id) ?? 0) < now()) return false
      undoable.delete(id)
      void effect('undoRecent', [id])
      return true
    },
    openProduct: (id) => { void effect('openProduct', [id]) },
    voiceOff: () => { void effect('voiceOff', []) },
    archiveChunk: (chunk) => { void effect('archiveChunk', [chunk]) },
    archiveGap: (gap) => { void effect('archiveGap', [gap]) },
  }
  const controller = new VoiceController(host)
  const sendState = () => {
    if (closed) return
    const snapshot = controller.getSnapshot()
    const end = automaticContext.getStore()?.spokenEndAt
    if (end !== undefined) {
      for (const card of snapshot.cards) if (cardVersions.get(card.id)?.json !== JSON.stringify(card)) cardEnds.set(card.id, end)
      for (const entry of snapshot.sms) if (!smsEnds.has(entry.card.id)) smsEnds.set(entry.card.id, end)
    }
    const words = controller.smsWords()
    const masked = new Map<string, unknown>()
    for (const card of snapshot.cards) masked.set(card.text, controller.voiceLogFor(card.text))
    for (const line of snapshot.heard) masked.set(line.text, controller.voiceLogFor(line.text))
    const display = {
      confirmations: new Map(snapshot.cards.flatMap((card) => {
        const json = JSON.stringify(card)
        const old = cardVersions.get(card.id)
        const version = old?.json === json ? old.version : (old?.version ?? 0) + 1
        cardVersions.set(card.id, { json, version })
        const checked = voice.confirmCard(card, { maxNumber: host.maxNumber(), existingNumbers: [] })
        return checked.ok ? [[card.id, { sessionId, broadcastId: options.broadcastId ?? '', device: options.device, cardId: card.id, cardVersion: version, registration: checked.registration }] as const] : []
      })),
      cards: new Map(snapshot.cards.map((card) => [card.id, controller.describe(card)])),
      sms: new Map(snapshot.sms.map((entry) => [entry.card.id, controller.describeSms(entry.card)])),
      countdowns: new Map(snapshot.sms.map((entry) => [entry.card.id, controller.smsCountdown(entry)])),
      smsWords: words === null ? null : { ...words, choose: undefined, choices: new Map(snapshot.sms.map((entry) => [entry.card.reading.last4 ?? '', words.choose(entry.card.reading.last4)])) },
      keyCandidateCard: controller.keyCandidateCard(),
      smsEscTarget: controller.smsEscTarget(),
      smsResultShown: controller.smsResultShown(),
      instantScreen: controller.instantScreen(),
      logLines: controller.logLines(),
      masked,
    }
    const resumeToken = sealResume(resumeScope, controller.pendingView(), wallNow())
    emit({ type: 'voice.state', sessionId, sessionReady, resumeToken, snapshot: toWire(snapshot), display: toWire(display) })
  }
  controller.subscribe(sendState)

  function updateContext(value: unknown): void {
    if (!isRecord(value)) return
    if (typeof value.now === 'number' && Number.isSafeInteger(value.now) && value.now >= 0) clockOffset = value.now - wallNow()
    if (typeof value.dialogOpen === 'boolean') dialogOpen = value.dialogOpen
    if (typeof value.smsAutoAllowed === 'boolean') smsAutoAllowed = value.smsAutoAllowed
    if (value.settings !== undefined) settings = value.settings
    if (value.smsSettings !== undefined) smsSettings = value.smsSettings
    if (typeof value.consent === 'boolean') consent = value.consent
  }

  const onMessage = (value: unknown): void => {
    if (closed || !isVoiceClientMessage(value)) return
    if (value.op === 'hello') {
      if (initialized) return
      initialized = true
      updateContext(value.context)
      const learned = isRecord(value.context) ? value.context.learned : undefined
      const start = async () => {
        if (closed) return
        await controller.turnOn()
        if (closed) return
        if (value.context.resumeToken !== undefined) {
          const view = openResume(value.context.resumeToken, resumeScope, wallNow())
          if (view === null) {
            emit({ type: 'voice.error', code: 'RESUME_INVALID', message: '음성 대기 내용을 다시 연결하지 못했어요. 남은 상품과 문자찜을 확인하고 손으로 입력해 주세요.' })
            controller.dispose()
            return
          }
          controller.resumeView(view)
          for (const entry of view.recent) if (typeof entry.undoUntil === 'number' && entry.undoUntil >= now()) undoable.set(entry.id, entry.undoUntil)
        }
        if (value.context.listening === false) controller.turnOff()
        sessionReady = true
        sendState()
      }
      void (options.mergeLearned?.(learned) ?? Promise.resolve()).then(start, start)
    } else if (value.op === 'context') {
      updateContext(value.context)
      timers.flush()
      controller.refresh()
    } else if (value.op === 'capture') {
      if (capturedAt === null && typeof value.at === 'number' && Number.isFinite(value.at)) capturedAt = value.at
    } else if (value.op === 'effectResult' && typeof value.id === 'number') {
      const item = pending.get(value.id)
      if (item !== undefined) { pending.delete(value.id); clearTimeout(item.timer); item.resolve(value.value) }
    } else if (value.op === 'chromeResult') {
      // SRV1 (D-APP-22·D-APP-25 (2), APP-05 AC5): 기기가 보낸 "받아쓴 글"은 받아쓴 말처럼 읽지 않는다 — 거절만 알리고 아무것도 쓰지 않는다.
      // 받아쓰기는 소리 틀(VOC-06)로만. 연결은 끊지 않는다(카드 손 조작은 그대로, D-APP1b-08)
      emit({ type: 'voice.error', code: 'UNSUPPORTED', message: CHROME_RESULT_UNSUPPORTED })
    } else if (value.op === 'command' && typeof value.method === 'string' && VOICE_COMMANDS.some((method) => method === value.method) && Array.isArray(value.args) && value.args.length <= 4) {
      if (!initialized) return
      if (value.method === 'noteVoiceRegistered' && isRecord(value.args[0]) && typeof value.args[0].id === 'string') {
        const entry = value.args[0]
        const waiting = registering.get(Number(entry.no))
        if (waiting !== undefined) {
          if (waiting.name !== entry.name || waiting.price !== entry.price || options.host.existingProduct?.(Number(entry.no))?.key !== entry.id) return
          finishRegistration(Number(entry.no), true)
        }
        undoable.set(value.args[0].id, now() + 5000)
        const end = numberEnds.get(Number(value.args[0].no))
        if (end !== undefined) registrationEnds.set(value.args[0].id, end)
      }
      if (value.method === 'restore' && isRecord(value.args[0])) {
        const waiting = registering.get(Number(value.args[0].no))
        if (waiting !== undefined && waiting.cardId === value.args[0].id) finishRegistration(Number(value.args[0].no), false)
      }
      if (value.method === 'instantExists' && isRecord(value.args[0])) {
        const card = value.args[0]
        const no = Number(card.no)
        const waiting = registering.get(no)
        const product = options.host.existingProduct?.(no)
        if (waiting === undefined || waiting.cardId !== card.id || !sameCard(waiting.card, toWire(card)) || product === null || product === undefined || product.key === '') return
        // 등록을 보낼 차례에 손입력 상품이 먼저 생겼다. 이 등록의 성공 ACK는 오지 않는다.
        // 서버가 보낸 같은 카드·번호와 실제 상품을 확인한 뒤 기존 상품 판단으로 이어 간다.
        finishRegistration(no, !product.closed)
      }
      const method = value.method as (typeof VOICE_COMMANDS)[number]
      if (method === 'submitForm') {
        const id = String(value.args[0])
        const form = controller.getSnapshot().forms.get(id)
        if (form === undefined) return
        const parsed = decideFixForm(form, { 'price.unit': host.priceUnit?.() ?? 'WON', 'claim.maxNumber': host.maxNumber() }, () => undefined)
        if (parsed.kind === 'fix') controller.formProblem(id, parsed.message, parsed.focus)
        else if (parsed.kind === 'register') {
          const card = controller.take(id)
          if (card !== undefined) { controller.learnFrom(card, parsed.name); automaticContext.run({ automatic: false }, () => host.register(card, { no: parsed.no, name: parsed.name, price: parsed.price }, 'click')) }
        }
        sendState(); return
      }
      const fn: unknown = controller[method]
      if (typeof fn !== 'function') return
      const automatic = !['confirm', 'smsSend', 'smsChoose', 'smsNewBuyer', 'fixOffer', 'revertOffer', 'undoOffer', 'renumberOffer', 'fixCardOffer', 'submitMissed'].includes(method)
      try { void Promise.resolve(automaticContext.run({ automatic }, () => Reflect.apply(fn, controller, value.args))).then(sendState).catch(sendState) } catch { sendState() }
    }
  }

  return {
    onMessage,
    /**
     * 서버가 받은 방송 소리(VOC-08)의 시각 0 — 서버 시계 기준이다. 말 끝 시각(now)은 기기 시계 기준이라 기기 시계 차이를 더해 맞춘다.
     * 그러지 않으면 기기 시계가 서버보다 늦을 때 말 끝이 "미래"가 되어 모든 말이 늦은 말로 빠진다(D-LIVETEST-05).
     */
    onServerCapture(at: number): void {
      if (capturedAt === null && Number.isFinite(at)) capturedAt = at + clockOffset
    },
    onResult(text: string, _startMs: number, endMs: number, conf?: number): void {
      if (closed || !initialized || text.length > 2000) return
      // 확신도(D-V3-130): 등록은 거의 늘 마지막 결과로 일어나므로 그 조각의 확신도를 등록 기록에 붙인다(측정용)
      lastConf = typeof conf === 'number' && Number.isFinite(conf) ? conf : null
      const spokenEndAt = capturedAt === null ? undefined : capturedAt + endMs
      const late = spokenEndAt === undefined || !Number.isFinite(spokenEndAt) || now() - spokenEndAt > 10_000 || spokenEndAt > now()
      automaticContext.run({ automatic: true, ...(spokenEndAt === undefined ? {} : { spokenEndAt }) }, () => engine.receive({ text, final: true, ...(late ? { flushedAtEnd: true } : {}) }))
    },
    close(): void {
      closed = true
      controller.dispose()
      for (const id of [...scheduled.keys()]) timers.clear(id)
      for (const item of pending.values()) { clearTimeout(item.timer); item.resolve(null) }
      pending.clear()
      for (const item of registering.values()) { clearTimeout(item.timer); item.finish(false) }
      registering.clear()
      undoable.clear()
    },
  }
}
