import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuggestionCard } from '@livejjim/voice'
import { createRemoteVoiceController, serverVoiceOnly } from '../src/voice/remote.ts'
import { VOICE_IDLE, type VoiceHost } from '../src/voice/controller.ts'
import type { VoiceTransportOptions } from '../src/voice/transport.ts'
import { toWire } from '../../../packages/voice-session/src/wire.ts'

const transport = vi.hoisted(() => ({ options: null as VoiceTransportOptions | null, send: vi.fn((_message: unknown) => true), stop: vi.fn() }))
vi.mock('../src/voice/transport.ts', () => ({ createVoiceTransport: (options: VoiceTransportOptions) => { transport.options = options; return { start() {}, stop: transport.stop, send: transport.send, isSupported: () => true } } }))
const T0 = Date.UTC(2026, 9, 29)
const card: SuggestionCard = { id: 'c1', no: 15, name: '엘레강스', price: 15000, text: '15번 엘레강스 만오천원', createdAt: T0, status: 'OPEN', confidence: 'HIGH', touched: false, autoConfirmAt: null }
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function fixture() {
  const register = vi.fn()
  const host: VoiceHost = { load: serverVoiceOnly, now: Date.now, maxNumber: () => 999, currentNames: () => [], products: () => new Map(), fetchHistory: async () => [], dialogOpen: () => false, readConsent: () => true, writeConsent() {}, readSettings: () => null, writeSettings() {}, register, focusQuick() {} }
  const remote = createRemoteVoiceController(host, 'broadcast-1')
  return { remote, register }
}
function state(sessionId = 'session-1', patch: Record<string, unknown> = {}) {
  const options = transport.options!
  options.onMessage({ type: 'voice.state', sessionId, sessionReady: true, resumeToken: 'signed.pending.view', snapshot: toWire({ ...VOICE_IDLE, phase: 'on', instant: true, cards: [card], front: { id: card.id, since: T0 }, ...patch }), display: toWire({ confirmations: new Map([[card.id, { sessionId, broadcastId: 'broadcast-1', device: options.device, cardId: card.id, cardVersion: 1, registration: { no: 15, name: '엘레강스', price: 15000 } }]]) }) })
}
beforeEach(() => { vi.useFakeTimers({ now: T0 + 3000 }); transport.send.mockReset().mockReturnValue(true); transport.stop.mockClear(); localStorage.clear() })
afterEach(() => { vi.useRealTimers() })

describe('server reading thin facade', () => {
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
