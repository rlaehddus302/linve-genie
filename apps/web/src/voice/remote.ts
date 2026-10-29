// APP1b: 화면은 서버 읽기 상태를 그리며 쓰기 효과만 기존 API 경로로 넘긴다.
// 추출·사전·판정 모듈은 불러오지 않는다. controller.ts의 공개 인터페이스는 그대로다.
import type { SuggestionCard, SmsCard, SpeechGap, SpeechDiagnostic, OnDeviceStatus, SpeechState } from '@livejjim/voice'
import { RESTART_LABEL_MS, VOICE_IDLE, type VoiceController, type VoiceHost, type VoiceSnapshot, type SmsEntry, type SmsWords, type VoiceLogInput, type VoiceLogLine } from './controller.ts'
import { post } from '../api/client.ts'
import { decideVoiceEnter, enterReady, nextFront } from '../lib/voice.ts'
import { archiveBroadcasts, archiveGaps, readArchive } from './archive-store.ts'
import { fromWire, isRecord, VOICE_COMMANDS, type VoiceCommand, type VoiceClientMessage, type VoiceConfirmation } from '../../../../packages/voice-session/src/wire.ts'
import type { createVoiceTransport } from './transport.ts'
import type * as TransportModule from './transport.ts'
import type { VoiceModule } from './load.ts'
import { VOICE_CHUNK_PLACEHOLDER } from './chunk.ts'
import { retryAddress } from './load.ts'
import { SERVICE_NAME } from '../brand.ts'
import { supportsVoiceCapture } from './capabilities.ts'
let transportFailures = 0

export type VoiceControllerPort = Pick<VoiceController, keyof VoiceController>
export const VOICE_ENGINE_KEY = 'livejjim.voiceEngine'
export const REMOTE_NOTICE = `음성은 ${SERVICE_NAME} 받아쓰기 서버로 보내져요.`
export const REMOTE_CONSENT = [
  `음성 듣기를 켜면 이 기기 마이크 소리를 ${SERVICE_NAME} 받아쓰기 서버로 보내 글로 바꿔요. 소리는 저장하지 않아요.`,
  '와이파이에서 쓰세요. 휴대폰 데이터로는 1시간에 약 120MB를 써요.',
  '방송 동안 충전기를 꽂아 두세요.',
] as const
export function canChooseVoiceEngine(): boolean {
  const scope = globalThis as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 48rem)').matches && (typeof scope.SpeechRecognition === 'function' || typeof scope.webkitSpeechRecognition === 'function')
}
export function readVoiceEngine(): 'livegenie' | 'chrome' {
  try { return canChooseVoiceEngine() && localStorage.getItem(VOICE_ENGINE_KEY) === 'chrome' ? 'chrome' : 'livegenie' } catch { return 'livegenie' }
}
export function writeVoiceEngine(value: 'livegenie' | 'chrome'): void {
  try { localStorage.setItem(VOICE_ENGINE_KEY, value) } catch { /* 이 화면에서 선택만 */ }
}
/** 옛 host 모양과 호환하되 production에서 추출 패키지를 받지 않는다. */
export function serverVoiceOnly(): Promise<VoiceModule> { return Promise.reject(new Error('음성 읽기는 서버에서 실행해요.')) }

type Display = Record<string, unknown>
const mapValue = <T>(value: unknown, key: string, fallback: T): T => value instanceof Map ? (value.get(key) as T | undefined) ?? fallback : fallback
const safeSettings = (value: unknown) => isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([key, item]) => ['voice.autoConfirm', 'voice.autoConfirmSec', 'voice.autoRegister', 'voice.quietMs', 'voice.archive', 'voice.stallMs', 'voice.smsListen', 'voice.smsAutoSec'].includes(key) && (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))))) : {}

export function createRemoteVoiceController(host: VoiceHost, broadcastId: string): VoiceControllerPort {
  let snapshot: VoiceSnapshot = { ...VOICE_IDLE, instant: true }
  let display: Display = {}
  const listeners = new Set<() => void>()
  const masked = new Map<string, VoiceLogInput>()
  const effects = new Map<number, Promise<unknown>>()
  const consumed = new Set<string>()
  let activeSession = ''
  const pendingTake = new Set<string>()
  let tooSoon = false
  let transportState: SpeechState | null = null
  let transportError: string | null = null
  let gaps: SpeechGap[] = []
  let diagnostics: SpeechDiagnostic[] = []
  let onDevice: OnDeviceStatus | null = null
  let pendingInstant: boolean | null = null
  let pendingArchive: boolean | null = null
  let pendingAuto: boolean | null = null
  let pendingSmsListen: boolean | null = null
  const pendingTexts: { secondsText?: string; quietText?: string; smsSecondsText?: string } = {}
  const pendingForms = new Map<string, Parameters<VoiceController['editForm']>[1]>()
  const pendingOfferPrices = new Map<string, string>()
  let resumeToken: string | null = null
  let readyForCommands = false
  let controlOnly = false
  let stopping = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let effectPending = 0
  let connecting = false
  let chromeMode = false
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let restartRequested = false
  const interruptedSms = new Set<string>()
  const localSettings: Record<string, boolean | number | undefined> = {}
  const localSmsSettings: Record<string, boolean | number> = {}
  const restartingLabel = () => chromeMode ? '음성: 다시 시작 중' : '다시 잇는 중'
  const haltedLabel = () => chromeMode ? '음성: 멈춤' : '듣기 멈춤'
  const commandQueue: { method: VoiceCommand; args: readonly unknown[] }[] = []
  let disposed = false
  let transport: ReturnType<typeof createVoiceTransport> | null = null
  let contextTimer: ReturnType<typeof setInterval> | null = null
  let generation = 0
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const device = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const emit = () => { for (const listener of [...listeners]) listener() }
  const set = (patch: Partial<VoiceSnapshot>) => { snapshot = { ...snapshot, ...patch, now: host.now() }; emit() }
  const releaseRestart = () => { if (restartTimer !== null) clearTimeout(restartTimer); restartTimer = null }
  const withLocalSettings = (settings: Parameters<VoiceHost['writeSettings']>[0]) => {
    const next: typeof settings & Record<string, unknown> = { ...settings, ...localSettings }
    for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key]
    return next
  }
  const saveSettings = (patch: typeof localSettings) => {
    Object.assign(localSettings, patch)
    if (snapshot.settings !== null) host.writeSettings(withLocalSettings({ ...snapshot.settings, ...safeSettings(host.readSettings()) }))
  }
  const stopSms = (entry: SmsEntry): SmsEntry => interruptedSms.has(entry.card.id) && entry.card.status === 'OPEN' && !entry.sending ? { ...entry, card: { ...entry.card, autoAt: null, touched: true }, error: entry.error ?? '연결이 끊겨 문자찜을 넣지 못했어요. 연결을 확인한 뒤 넣기를 눌러 주세요.' } : entry
  const context = () => ({ now: host.now(), dialogOpen: host.dialogOpen(), smsAutoAllowed: host.smsAutoAllowed?.() ?? true })
  const send = (message: VoiceClientMessage) => transport?.send(message) ?? false
  const command = (method: VoiceCommand, args: readonly unknown[]) => {
    if (['smsSend', 'smsChoose', 'smsNewBuyer', 'smsSkip', 'smsDismiss'].includes(method)) interruptedSms.delete(String(args[0]))
    if (['editForm', 'openForm', 'chooseCandidate', 'fixCardOffer', 'submitMissed'].includes(method) && display.confirmations instanceof Map) display.confirmations.delete(String(args[0]))
    if (!readyForCommands) {
      if (['refresh', 'noteRegistered', 'turnOff'].includes(method) || resumeToken === null) return
      commandQueue.push({ method, args })
      if (!connecting && ((transport === null && snapshot.phase === 'off') || transportState === 'HALTED')) void start(true)
      return
    }
    send({ type: 'voice.session', op: 'context', context: context() })
    send({ type: 'voice.session', op: 'command', method, args })
    scheduleIdle()
  }
  const scheduleIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    if (controlOnly) idleTimer = setTimeout(() => { idleTimer = null; if (effectPending === 0) stop(); else scheduleIdle() }, 1000)
  }
  const stop = () => {
    generation++
    releaseRestart()
    readyForCommands = false
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
    effects.clear()
    pendingTake.clear()
    if (contextTimer !== null) clearInterval(contextTimer)
    contextTimer = null
    transport?.stop(); transport = null
  }

  async function executeEffect(message: Record<string, unknown>): Promise<unknown> {
    const args = fromWire(message.args)
    if (!Array.isArray(args)) return null
    const end = message.spokenEndAt
    const stale = message.automatic !== false && ((message.source !== 'chrome' && (typeof end !== 'number' || !Number.isFinite(end) || host.now() - end > 10_000 || end > host.now())) || transportState === 'HALTED' || transportState === 'RESTARTING' || stopping || controlOnly)
    if (stale && ['fixRecent', 'writeSms'].includes(String(message.method))) return { kind: 'failed', message: '늦게 들린 말이에요. 확인하고 다시 눌러 주세요.' }
    if (stale && ['renumber', 'undoRecent'].includes(String(message.method))) return false
    let value: unknown = null
    try {
      switch (message.method) {
        case 'register': {
          const card = args[0] as SuggestionCard
          if (!isRecord(card) || !isRecord(args[1]) || typeof args[2] !== 'string') break
          const log = args[3] as VoiceLogInput | null
          if (log !== null && typeof log?.heard === 'string') masked.set(card.text, log)
          if ((args[2] === 'instant' && snapshot.instant === false) || (['instant', 'auto'].includes(args[2]) && stale)) {
            command('restore', [card, { touched: true, note: '늦게 들린 말이에요. 확인하고 등록해 주세요.' }])
            break
          }
          host.register(card, args[1] as unknown as Parameters<VoiceHost['register']>[1], args[2] as Parameters<VoiceHost['register']>[2]); break
        }
        case 'fixRecent': value = await host.fixRecent?.(...args as Parameters<NonNullable<VoiceHost['fixRecent']>>); break
        case 'renumber': value = await host.renumber?.(...args as Parameters<NonNullable<VoiceHost['renumber']>>); break
        case 'writeSms': value = await host.writeSms?.(...args as Parameters<NonNullable<VoiceHost['writeSms']>>); break
        case 'undoRecent': value = host.undoRecent?.(String(args[0])); break
        case 'openProduct': host.openProduct?.(String(args[0])); break
        case 'focusQuick': host.focusQuick(); break
        case 'writeConsent': host.writeConsent(); break
        case 'writeSettings': host.writeSettings(withLocalSettings(args[0] as Parameters<VoiceHost['writeSettings']>[0])); break
        case 'writeSmsSettings': host.writeSmsSettings?.({ ...args[0] as Parameters<NonNullable<VoiceHost['writeSmsSettings']>>[0], ...localSmsSettings }); break
        case 'archiveChunk': host.archiveChunk?.(args[0] as Parameters<NonNullable<VoiceHost['archiveChunk']>>[0]); break
        case 'archiveGap': host.archiveGap?.(args[0] as Parameters<NonNullable<VoiceHost['archiveGap']>>[0]); break
        case 'voiceOff': host.voiceOff?.(); break
        default: return null
      }
    } catch { value = null }
    return value ?? null
  }
  async function onEffect(message: Record<string, unknown>): Promise<void> {
    if (disposed || typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id < 1 || typeof message.method !== 'string') return
    const born = generation
    const session = activeSession
    if (message.sessionId !== session) return
    let result = effects.get(message.id)
    if (result === undefined) { effectPending++; result = executeEffect(message).finally(() => { effectPending--; scheduleIdle() }); effects.set(message.id, result) }
    const value = await result
    if (!disposed && generation === born && activeSession === session) send({ type: 'voice.session', op: 'effectResult', id: message.id, value })
  }

  async function start(commandsOnly = false): Promise<void> {
    if (transport !== null) stop()
    const born = ++generation
    connecting = true
    chromeMode = readVoiceEngine() === 'chrome'
    controlOnly = commandsOnly; stopping = false; readyForCommands = false
    transportState = null; transportError = null
    set({ phase: commandsOnly ? 'off' : 'loading', error: null, unsupported: false })
    try {
      const retry = transportFailures === 0 ? null : retryAddress(transportFailures, VOICE_CHUNK_PLACEHOLDER)
      const { createVoiceTransport: create } = retry === null ? await import('./transport.ts') : await import(/* @vite-ignore */ retry) as typeof TransportModule
      if (disposed || born !== generation) return
      const learned = host.readLearned?.()
      if (Array.isArray(learned) && learned.length > 0) {
        try { await post('/api/voice/aliases', { aliases: learned, migration: true }); host.writeLearned?.([]) }
        catch { set({ historyFailed: true }) }
      }
      if (disposed || born !== generation) return
      transport = create({
        broadcastId, device, chrome: chromeMode, capture: !commandsOnly,
        ...(isRecord(host.readSettings()) && typeof (host.readSettings() as Record<string, unknown>)['voice.stallMs'] === 'number' ? { stallMs: (host.readSettings() as Record<string, number>)['voice.stallMs'] } : {}),
        hello: () => ({ type: 'voice.session', op: 'hello', context: { ...context(), settings: { ...safeSettings(host.readSettings()), 'voice.archive': readArchive(host.readSettings()) }, smsSettings: safeSettings(host.readSmsSettings?.()), consent: true, listening: !commandsOnly, ...(resumeToken === null ? {} : { resumeToken }) } }),
        onState: (state) => {
          if (disposed || born !== generation) return
          transportState = state
          if (commandsOnly || stopping) return
          if (state === 'LISTENING') { transportError = null; set({ phase: 'on', stateLabel: restartTimer === null ? '음성: 듣는 중' : restartingLabel(), error: null }) }
          if (state === 'RESTARTING') {
            releaseRestart()
            if (chromeMode) restartTimer = setTimeout(() => { restartTimer = null; if (!disposed && born === generation && transportState === 'LISTENING' && !stopping) set({ stateLabel: '음성: 듣는 중' }) }, RESTART_LABEL_MS)
            set({ phase: 'on', stateLabel: restartingLabel() })
          }
          if (state === 'HALTED') set({ phase: chromeMode ? 'off' : 'on', stateLabel: chromeMode ? null : haltedLabel() })
        },
        onError: (error) => { if (!disposed && born === generation) { transportError = error.message; transportState = 'HALTED'; if (chromeMode && !commandsOnly) local.turnOff(); set({ phase: commandsOnly || chromeMode ? 'off' : 'on', stateLabel: chromeMode ? null : haltedLabel(), error: error.message, unsupported: error.kind === 'UNSUPPORTED' }) } },
        onConnectionLost: () => {
          if (disposed || born !== generation || stopping) return
          readyForCommands = false
          for (const entry of snapshot.sms) if (entry.card.status === 'OPEN' && !entry.sending) interruptedSms.add(entry.card.id)
          set({ sms: snapshot.sms.map(stopSms), cards: snapshot.cards.map((card) => ({ ...card, autoConfirmAt: null })) })
        },
        onGap: (gap, text) => { gaps = [...gaps.slice(-79), gap]; if (snapshot.archive) host.archiveGap?.({ at: gap.to, ms: gap.ms, reason: gap.reason, text }); emit() },
        onDiagnostic: (diagnostic, text) => { diagnostics = [...diagnostics.slice(-79), diagnostic]; if (snapshot.archive) host.archiveGap?.({ at: diagnostic.at, ms: diagnostic.ms, reason: diagnostic.kind, text }); emit() },
        onDeviceStatus: (status) => { onDevice = status; emit() },
        onMessage: (value) => {
          if (disposed || born !== generation || !isRecord(value)) return
          if (value.type === 'voice.state') {
            if (typeof value.sessionId !== 'string') return
            if (activeSession !== value.sessionId) { activeSession = value.sessionId; effects.clear() }
            if (value.sessionReady === false) return
            if (typeof value.resumeToken === 'string') resumeToken = value.resumeToken === '' ? null : value.resumeToken
            readyForCommands = true
            const next = fromWire(value.snapshot)
            const nextDisplay = fromWire(value.display)
            if (!isRecord(next) || !Array.isArray(next.cards) || !(next.forms instanceof Map)) return
            const state = next as unknown as VoiceSnapshot
            for (const id of pendingTake) if (!state.cards.some((card) => card.id === id) || state.forms.has(id)) pendingTake.delete(id)
            const cards = state.cards.filter((card) => !pendingTake.has(card.id))
            const front = nextFront(snapshot.front, cards, host.now())
            tooSoon = tooSoon && !enterReady(front, host.now())
            if (state.instant === pendingInstant) pendingInstant = null
            if (state.archive === pendingArchive) pendingArchive = null
            if (state.settings?.['voice.autoConfirm'] === pendingAuto) pendingAuto = null
            if (state.smsSettings?.['voice.smsListen'] === pendingSmsListen) pendingSmsListen = null
            for (const key of ['secondsText', 'quietText', 'smsSecondsText'] as const) if (state[key] === pendingTexts[key]) delete pendingTexts[key]
            const forms = new Map(state.forms)
            for (const [id, patch] of pendingForms) {
              const form = forms.get(id)
              if (form === undefined || Object.entries(patch).every(([key, value]) => form[key as keyof typeof patch] === value)) pendingForms.delete(id)
              else forms.set(id, { ...form, ...patch })
            }
            const offers = state.offers.map((offer) => {
              const text = pendingOfferPrices.get(offer.id)
              if (text === offer.priceEntry) pendingOfferPrices.delete(offer.id)
              return text === undefined ? offer : { ...offer, priceEntry: text }
            })
            snapshot = { ...state, cards, sms: state.sms.map(stopSms), front, tooSoon: state.tooSoon || tooSoon,
              ...pendingTexts, forms, offers,
              ...((controlOnly || stopping) ? { phase: 'off', stateLabel: null } : {}),
              instant: pendingInstant ?? state.instant, archive: pendingArchive ?? state.archive,
              settings: state.settings === null ? null : { ...state.settings, ...(pendingAuto === null ? {} : { 'voice.autoConfirm': pendingAuto }) },
              smsSettings: state.smsSettings === null ? null : { ...state.smsSettings, ...(pendingSmsListen === null ? {} : { 'voice.smsListen': pendingSmsListen }) },
              ...((transportState === 'RESTARTING' || restartTimer !== null) ? { stateLabel: restartingLabel() } : transportState === 'HALTED' || transportError !== null ? { stateLabel: chromeMode ? null : haltedLabel(), ...(chromeMode ? { phase: 'off' } : {}) } : {}),
              ...(transportError === null ? {} : { error: transportError }),
              ...(value.resumeToken === '' ? { error: '대기 내용이 많아 다시 연결할 수 없어요. 음성을 끄기 전에 남은 카드와 문자찜을 확인해 주세요.' } : {}),
            }
            display = isRecord(nextDisplay) ? nextDisplay : {}
            if (display.masked instanceof Map) for (const [text, log] of display.masked) if (typeof text === 'string' && isRecord(log)) masked.set(text, log as unknown as VoiceLogInput)
            if (masked.size > 300) for (const key of [...masked.keys()].slice(0, masked.size - 300)) masked.delete(key)
            emit()
            for (const item of commandQueue.splice(0)) command(item.method, item.args)
            if (stopping && state.phase === 'off') { stopping = false; stop(); if (restartRequested) { restartRequested = false; void start() } }
            else scheduleIdle()
          } else if (value.type === 'voice.error' && typeof value.message === 'string') {
            if (value.code === 'RESUME_INVALID') { resumeToken = null; commandQueue.length = 0; stop(); set({ phase: 'off', stateLabel: null, error: value.message }) }
            else set({ error: value.message })
          }
          else if (value.type === 'voice.effect') void onEffect(value)
          else if (value.type === 'closing' && value.reason === 'ENDED') { stop(); host.voiceOff?.(); set({ phase: 'off', stateLabel: null }) }
        },
      })
      if (!transport.isSupported()) { stop(); set({ phase: 'off', unsupported: true, error: '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.' }); return }
      transport.start()
      connecting = false
      if (!commandsOnly) contextTimer = setInterval(() => send({ type: 'voice.session', op: 'context', context: context() }), 500)
    } catch { connecting = false; transportFailures++; stop(); set({ phase: 'off', error: '음성 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.' }) }
  }

  const local = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    async turnOn() {
      if (disposed || snapshot.phase !== 'off') return
      if (!supportsVoiceCapture(readVoiceEngine())) { set({ unsupported: true, error: '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.' }); return }
      if (stopping) { restartRequested = true; return }
      if (!host.readConsent()) { set({ phase: 'consent' }); return }
      await start()
    },
    toggle() { if (snapshot.phase === 'on' || snapshot.phase === 'loading') local.turnOff(); else void local.turnOn() },
    acceptConsent() { if (snapshot.phase !== 'consent') return; host.writeConsent(); void start() },
    declineConsent() { if (snapshot.phase === 'consent') { set({ phase: 'off' }); host.focusQuick() } },
    turnOff() {
      stopping = true
      releaseRestart()
      transport?.pauseCapture?.()
      const sent = readyForCommands && send({ type: 'voice.session', op: 'command', method: 'turnOff', args: [] })
      if (!sent) { stopping = false; stop() }
      host.voiceOff?.()
      set({ phase: 'off', stateLabel: null, hearing: null, interim: null, paused: new Map(), cards: snapshot.cards.map((card) => ({ ...card, autoConfirmAt: null })), sms: snapshot.sms.map((entry) => ({ ...entry, card: { ...entry.card, autoAt: null } })) })
      host.focusQuick()
    },
    dispose() { disposed = true; stop(); listeners.clear(); masked.clear() },
    refresh() { command('refresh', []) },
    instantScreen: () => display.instantScreen !== false,
    voiceLogFor(text: string, undo?: string) { const log = masked.get(text); return log === undefined ? null : { ...log, ...(undo === undefined ? {} : { undo }) } },
    describe: (card: SuggestionCard) => mapValue(display.cards, card.id, ''),
    describeSms: (card: SmsCard) => mapValue(display.sms, card.id, ''),
    cardInfo: (id: string) => snapshot.info.get(id) ?? null,
    cardOffer: (id: string) => snapshot.offers.find((offer) => offer.kind === 'card' && offer.registrationId === id),
    keyCandidateCard: () => typeof display.keyCandidateCard === 'string' ? display.keyCandidateCard : null,
    smsEscTarget: () => typeof display.smsEscTarget === 'string' ? display.smsEscTarget : null,
    smsResultShown: () => display.smsResultShown === true,
    smsCountdown: (entry: SmsEntry) => entry.card.autoAt === null || interruptedSms.has(entry.card.id) ? null : mapValue<string | null>(display.countdowns, entry.card.id, null),
    logLines: () => Array.isArray(display.logLines) ? display.logLines as readonly VoiceLogLine[] : [],
    recognitionDiagnostics: () => diagnostics,
    recognitionGaps: () => gaps,
    onDeviceRecognition: () => onDevice,
    setInstant(on: boolean) { saveSettings({ 'voice.autoRegister': on ? undefined : false }); pendingInstant = on; set({ instant: on }); command('setInstant', [on]) },
    setArchive(on: boolean) { saveSettings({ 'voice.archive': on }); pendingArchive = on; set({ archive: on }); command('setArchive', [on]) },
    setAutoConfirm(on: boolean) { saveSettings({ 'voice.autoConfirm': on }); pendingAuto = on; if (snapshot.settings !== null) set({ settings: { ...snapshot.settings, 'voice.autoConfirm': on } }); command('setAutoConfirm', [on]) },
    setSmsListen(on: boolean) { localSmsSettings['voice.smsListen'] = on; pendingSmsListen = on; if (snapshot.smsSettings !== null) { const smsSettings = { ...snapshot.smsSettings, ...localSmsSettings }; host.writeSmsSettings?.(smsSettings); set({ smsSettings }) } command('setSmsListen', [on]) },
    setSeconds(text: string) { pendingTexts.secondsText = text; set({ secondsText: text }); command('setSeconds', [text]) },
    setQuietSeconds(text: string) { pendingTexts.quietText = text; set({ quietText: text }); command('setQuietSeconds', [text]) },
    setSmsSeconds(text: string) { pendingTexts.smsSecondsText = text; set({ smsSecondsText: text }); command('setSmsSeconds', [text]) },
    editForm(id: string, patch: Parameters<VoiceController['editForm']>[1]) {
      const form = snapshot.forms.get(id)
      if (form === undefined) return
      const next = { ...pendingForms.get(id), ...patch }
      pendingForms.set(id, next)
      set({ forms: new Map(snapshot.forms).set(id, { ...form, ...next }) })
      command('editForm', [id, patch])
    },
    setOfferPrice(id: string, text: string) { pendingOfferPrices.set(id, text); set({ offers: snapshot.offers.map((offer) => offer.id === id ? { ...offer, priceEntry: text } : offer) }); command('setOfferPrice', [id, text]) },
    dismissUnsupported() { transportError = null; set({ unsupported: false, error: null }); command('dismissUnsupported', []) },
    noteRegistered() { if (snapshot.unsupported) local.dismissUnsupported(); command('noteRegistered', []) },
    smsWords(): SmsWords | null {
      const words = display.smsWords
      return isRecord(words) ? { ...words, choose: (last4: string | null) => mapValue(words.choices, last4 ?? '', '손님을 골라 주세요.') } as unknown as SmsWords : null
    },
    take(id: string) {
      const card = snapshot.cards.find((item) => item.id === id)
      if (card === undefined || pendingTake.has(id)) return undefined
      pendingTake.add(id)
      const cards = snapshot.cards.filter((item) => item.id !== id)
      set({ cards, front: nextFront(snapshot.front, cards, host.now()) })
      command('take', [id]); return card
    },
    confirm(id: string, source: Parameters<VoiceController['confirm']>[1]) {
      const card = snapshot.cards.find((item) => item.id === id)
      if (card === undefined || pendingTake.has(id)) return
      const checked = mapValue<VoiceConfirmation | null>(display.confirmations, id, null)
      if (checked !== null && ['click', 'enter'].includes(source) && checked.broadcastId === broadcastId && checked.device === device && checked.sessionId === activeSession && checked.cardId === id) {
        const key = `${checked.sessionId}:${id}:${String(checked.cardVersion)}`
        if (consumed.has(key)) return
        consumed.add(key)
        tooSoon = false
        local.take(id)
        command('learnFrom', [card, checked.registration.name])
        host.register(card, checked.registration, source)
        return
      }
      // 요청 중인 카드만 숨긴다. 서버가 고치기 칸을 돌려주면 다시 보여 준다.
      if (card.no !== null && card.price !== null) {
        pendingTake.add(id)
        const cards = snapshot.cards.filter((item) => item.id !== id)
        set({ cards, front: nextFront(snapshot.front, cards, host.now()), tooSoon: false })
      }
      tooSoon = false
      command('confirm', [id, source])
    },
    restore(card: SuggestionCard, options: Parameters<VoiceController['restore']>[1] = {}) {
      pendingTake.delete(card.id)
      const restored = { ...card, status: 'OPEN' as const, touched: options.touched ?? card.touched, autoConfirmAt: null }
      const cards = [restored, ...snapshot.cards.filter((item) => item.id !== card.id)]
      const notes = new Map(snapshot.notes)
      if (options.note !== undefined) notes.set(card.id, options.note)
      set({ cards, notes, front: nextFront(snapshot.front, cards, host.now()) })
      command('restore', [restored, options])
    },
    enter(line: string, input: { wide: boolean; dialogOpen: boolean; composing?: boolean }) {
      const decision = decideVoiceEnter({ line, cards: snapshot.cards, front: snapshot.front, now: host.now(), ...input, editing: new Set(snapshot.forms.keys()) })
      if (decision.kind === 'quick') return false
      if (decision.kind === 'tooSoon') { tooSoon = true; set({ tooSoon: true }) }
      else local.confirm(decision.card.id, 'enter')
      return true
    },
    chooseCandidateByKey(index: number) {
      const id = local.keyCandidateCard()
      const candidate = id === null ? undefined : snapshot.info.get(id)?.candidates[index]
      if (id === null || candidate === undefined || index > 2 || snapshot.forms.size > 0) return false
      command('chooseCandidate', [id, candidate.name]); return true
    },
    smsEscape() { const id = local.smsEscTarget(); if (id === null) return false; command('smsSkip', [id]); return true },
    submitMissed(id: string, text: string) { command('submitMissed', [id, text]); return null },
    async exportArchive(broadcastId?: string) {
      const broadcasts = await archiveBroadcasts(broadcastId)
      const gaps = await archiveGaps(broadcastId, host.now())
      const known = new Set(broadcasts.map((item) => item.broadcastId))
      const only = [...gaps].filter(([id]) => !known.has(id)).map(([id, group]) => ({ broadcastId: id, title: group.title, date: group.date, chunks: [], gaps: group.gaps }))
      return { format: 'livegenie-voice-log', version: 1, exportedAt: new Date(host.now()).toISOString(), broadcasts: [...broadcasts.map((item) => ({ ...item, gaps: gaps.get(item.broadcastId)?.gaps ?? [] })), ...only] }
    },
  }
  // 공개 인터페이스의 나머지는 wire allowlist의 사용자 명령이다. 임의 속성은 호출하지 않는다.
  return new Proxy(local, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver) as unknown
      if (typeof property === 'string' && VOICE_COMMANDS.some((method) => method === property)) return (...args: readonly unknown[]) => command(property as VoiceCommand, args)
      return undefined
    },
  }) as unknown as VoiceControllerPort
}
