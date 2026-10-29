import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuggestionCard } from '@livejjim/voice'
import { createRemoteVoiceController, serverVoiceOnly } from '../src/voice/remote.ts'
import { RESTART_LABEL_MS, VOICE_IDLE, type VoiceHost, type SmsEntry } from '../src/voice/controller.ts'
import { supportsVoiceCapture } from '../src/voice/capabilities.ts'
import type { VoiceTransportOptions } from '../src/voice/transport.ts'
import { toWire } from '../../../packages/voice-session/src/wire.ts'

const transport = vi.hoisted(() => ({ options: null as VoiceTransportOptions | null, send: vi.fn((_message: unknown) => true), stop: vi.fn() }))
vi.mock('../src/voice/transport.ts', () => ({ createVoiceTransport: (options: VoiceTransportOptions) => { transport.options = options; return { start() {}, stop: transport.stop, pauseCapture: () => options.onState('OFF'), send: transport.send, isSupported: () => true } } }))
const T0 = Date.UTC(2026, 9, 29)
const card: SuggestionCard = { id: 'c1', no: 15, name: '엘레강스', price: 15000, text: '15번 엘레강스 만오천원', createdAt: T0, status: 'OPEN', confidence: 'HIGH', touched: false, autoConfirmAt: null }
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function fixture(patch: Partial<VoiceHost> = {}) {
  const register = vi.fn()
  const host: VoiceHost = { load: serverVoiceOnly, now: Date.now, maxNumber: () => 999, currentNames: () => [], products: () => new Map(), fetchHistory: async () => [], dialogOpen: () => false, readConsent: () => true, writeConsent() {}, readSettings: () => null, writeSettings() {}, register, focusQuick() {} }
  Object.assign(host, patch)
  const remote = createRemoteVoiceController(host, 'broadcast-1')
  return { remote, register, host }
}
function state(sessionId = 'session-1', patch: Record<string, unknown> = {}) {
  const options = transport.options!
  options.onMessage({ type: 'voice.state', sessionId, sessionReady: true, resumeToken: 'signed.pending.view', snapshot: toWire({ ...VOICE_IDLE, phase: 'on', instant: true, cards: [card], front: { id: card.id, since: T0 }, ...patch }), display: toWire({ confirmations: new Map([[card.id, { sessionId, broadcastId: 'broadcast-1', device: options.device, cardId: card.id, cardVersion: 1, registration: { no: 15, name: '엘레강스', price: 15000 } }]]) }) })
}
beforeEach(() => {
  vi.useFakeTimers({ now: T0 + 3000 }); transport.send.mockReset().mockReturnValue(true); transport.stop.mockClear(); localStorage.clear()
  vi.stubGlobal('AudioContext', function AudioContext() {}); vi.stubGlobal('AudioWorkletNode', function AudioWorkletNode() {})
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function chrome() {
  vi.stubGlobal('SpeechRecognition', function SpeechRecognition() {})
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  localStorage.setItem('livejjim.voiceEngine', 'chrome')
}

describe('server reading thin facade', () => {
  it('checks microphone support before consent without constructing or opening it', async () => {
    const create = vi.fn()
    expect(supportsVoiceCapture('chrome', { SpeechRecognition: create })).toBe(true)
    expect(supportsVoiceCapture('livegenie', { AudioContext: create, AudioWorkletNode: create, navigator: { mediaDevices: { getUserMedia: create } } })).toBe(true)
    expect(create).not.toHaveBeenCalled()
    vi.stubGlobal('AudioWorkletNode', undefined)
    const { remote } = fixture({ readConsent: () => false })
    await remote.turnOn()
    expect(remote.getSnapshot()).toMatchObject({ phase: 'off', unsupported: true })
    remote.dispose()
  })
  it('persists device preferences synchronously and ignores a delayed older settings effect', async () => {
    let stored: unknown = { 'voice.quietMs': 2500 }
    const writeSettings = vi.fn((value: unknown) => { stored = value })
    const { remote } = fixture({ readSettings: () => stored, writeSettings })
    await remote.turnOn(); state('session-1', { settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } })
    remote.setInstant(false)
    expect(stored).toMatchObject({ 'voice.autoRegister': false, 'voice.quietMs': 2500 })
    remote.setInstant(true)
    expect(stored).not.toHaveProperty('voice.autoRegister')
    transport.options!.onMessage({ type: 'voice.effect', sessionId: 'session-1', id: 1, method: 'writeSettings', args: toWire([{ 'voice.autoRegister': false, 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5, 'voice.quietMs': 2500 }]) })
    await settle()
    expect(stored).not.toHaveProperty('voice.autoRegister')
    remote.dispose()
  })
  it('keeps Chrome restarting visible for the established hold even when listening arrives in the same callback', async () => {
    chrome()
    const { remote } = fixture(); await remote.turnOn(); state()
    transport.options!.onState('RESTARTING'); transport.options!.onState('LISTENING'); state()
    expect(remote.getSnapshot().stateLabel).toBe('음성: 다시 시작 중')
    await vi.advanceTimersByTimeAsync(RESTART_LABEL_MS)
    expect(remote.getSnapshot().stateLabel).toBe('음성: 듣는 중')
    remote.dispose()
  })
  it('stops Chrome on a fatal error and starts a fresh capture after the final off state', async () => {
    chrome()
    const { remote } = fixture(); await remote.turnOn(); state()
    const old = transport.options!
    old.onError({ kind: 'PERMISSION_DENIED', message: '마이크 사용이 막혀 있어요.' }); old.onState('HALTED')
    expect(remote.getSnapshot()).toMatchObject({ phase: 'off', error: '마이크 사용이 막혀 있어요.' })
    await remote.turnOn()
    expect(transport.options).toBe(old)
    state('session-1', { phase: 'off' }); await vi.dynamicImportSettled(); await settle()
    expect(transport.options).not.toBe(old)
    transport.options!.onState('LISTENING')
    expect(remote.getSnapshot()).toMatchObject({ phase: 'on', error: null })
    remote.dispose()
  })
  it('sends stop after capture emits OFF and waits for server-flushed log before closing', async () => {
    const { remote } = fixture(); await remote.turnOn(); state()
    remote.turnOff()
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ op: 'command', method: 'turnOff' }))
    expect(transport.stop).not.toHaveBeenCalled()
    const options = transport.options!
    const log = [{ key: 'first', time: '12:00', pieces: ['첫 문장이에요'], read: null, candidates: '', action: '넘김', reason: null }]
    options.onMessage({ type: 'voice.state', sessionId: 'session-1', sessionReady: true, resumeToken: 'signed.flushed.view', snapshot: toWire({ ...VOICE_IDLE, phase: 'off' }), display: toWire({ logLines: log }) })
    expect(remote.logLines()).toEqual(log)
    expect(transport.stop).toHaveBeenCalledOnce()
    remote.dispose()
  })
  it('stops SMS countdown on lost connection and retains manual sending after reconnect', async () => {
    const { remote } = fixture(); await remote.turnOn()
    const sms = { card: { id: 'sms-1', status: 'OPEN', autoAt: T0 + 6000, touched: false }, reason: null, sending: false, error: null, results: [], hidden: false } as unknown as SmsEntry
    state('session-1', { sms: [sms] })
    transport.options!.onConnectionLost?.()
    expect(remote.getSnapshot().sms[0]).toMatchObject({ card: { autoAt: null }, error: expect.stringContaining('연결이 끊겨') })
    state('session-2', { sms: [sms] })
    expect(remote.smsCountdown(remote.getSnapshot().sms[0]!)).toBeNull()
    remote.smsSend('sms-1')
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ method: 'smsSend', args: ['sms-1'] }))
    remote.dispose()
  })
  it('holds local checkbox and transport error updates through earlier server snapshots', async () => {
    const { remote } = fixture(); await remote.turnOn(); state()
    remote.setInstant(false)
    expect(remote.getSnapshot().instant).toBe(false)
    state()
    expect(remote.getSnapshot().instant).toBe(false)
    state('session-1', { instant: false })
    transport.options!.onError({ kind: 'PERMISSION_DENIED', message: '마이크 사용이 막혀 있어요.' })
    state('session-1', { instant: false })
    expect(remote.getSnapshot().error).toBe('마이크 사용이 막혀 있어요.')
    expect(remote.getSnapshot().stateLabel).toBe('듣기 멈춤')
    transport.options!.onState('LISTENING')
    expect(remote.getSnapshot().error).toBeNull()
    remote.dispose()
  })
  it('opens a microphone-free command session for a manual action while voice is off', async () => {
    const { remote } = fixture(); await remote.turnOn(); state()
    remote.turnOff(); state('session-1', { phase: 'off' })
    expect(transport.stop).toHaveBeenCalledTimes(1)
    expect(remote.getSnapshot().cards).toHaveLength(1)
    remote.smsSend('sms-1'); await vi.dynamicImportSettled(); await settle()
    const options = transport.options!
    expect(options.capture).toBe(false)
    expect(options.hello()).toMatchObject({ context: { listening: false, resumeToken: 'signed.pending.view' } })
    state('session-2', { phase: 'off' })
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ op: 'command', method: 'smsSend', args: ['sms-1'] }))
    await vi.advanceTimersByTimeAsync(1100)
    expect(transport.stop).toHaveBeenCalledTimes(2)
    remote.dispose()
  })
  it('exposes Chrome recognition gap and diagnostic callbacks without reading speech in the client', async () => {
    const { remote } = fixture(); await remote.turnOn(); state()
    const gap = { from: T0, to: T0 + 100, ms: 100, retries: 1, reason: 'network' as const }
    transport.options!.onGap?.(gap, '인식 끊김 0.1초 (network)')
    transport.options!.onDeviceStatus?.('unavailable')
    expect(remote.recognitionGaps()).toEqual([gap])
    expect(remote.onDeviceRecognition()).toBe('unavailable')
    remote.dispose()
  })
  it('executes an effect once and acknowledges repeated responses without a second write', async () => {
    const { remote, register } = fixture(); await remote.turnOn(); state()
    const message = { type: 'voice.effect', sessionId: 'session-1', id: 1, method: 'register', args: toWire([card, { no: 15, name: '엘레강스', price: 15000 }, 'instant']), automatic: true, source: 'livegenie', spokenEndAt: T0 + 2900 }
    transport.options!.onMessage(message); transport.options!.onMessage(message); await settle()
    expect(register).toHaveBeenCalledTimes(1)
    expect(transport.send.mock.calls.filter(([message]) => (message as { op?: string }).op === 'effectResult')).toHaveLength(2)
    remote.dispose()
  })
  it('consumes a server-validated manual confirmation once even when the socket is offline', async () => {
    const { remote, register } = fixture(); await remote.turnOn(); state(); transport.send.mockReturnValue(false)
    remote.confirm(card.id, 'click'); remote.confirm(card.id, 'click')
    expect(register).toHaveBeenCalledExactlyOnceWith(card, { no: 15, name: '엘레강스', price: 15000 }, 'click')
    expect(remote.getSnapshot().cards).toHaveLength(0)
    state('session-2')
    remote.confirm(card.id, 'click')
    expect(register).toHaveBeenCalledTimes(1)
    remote.dispose()
  })
  it.each([undefined, Number.NaN, T0 - 20_000, T0 + 20_000])('keeps an automatic effect with invalid end %s for manual review', async (spokenEndAt) => {
    const { remote, register } = fixture(); await remote.turnOn(); state()
    transport.options!.onMessage({ type: 'voice.effect', sessionId: 'session-1', id: 1, method: 'register', args: toWire([card, { no: 15, name: '엘레강스', price: 15000 }, 'instant']), automatic: true, source: 'livegenie', spokenEndAt })
    await settle()
    expect(register).not.toHaveBeenCalled()
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ op: 'command', method: 'restore' }))
    remote.dispose()
  })
})
