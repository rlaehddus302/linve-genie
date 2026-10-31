// LV1 방송 소리로 듣기: 조작 전용 흐름을 늘 열어 두고, 받아쓴 글의 효과를 마이크 때처럼 처리한다 (VOC-08, D-LV1-03·06)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuggestionCard } from '@livejjim/voice'
import { createRemoteVoiceController, serverVoiceOnly } from '../src/voice/remote.ts'
import { VOICE_IDLE, type VoiceHost } from '../src/voice/model.ts'
import type { VoiceTransportOptions } from '../src/voice/transport.ts'
import { toWire } from '../../../packages/voice-session/src/wire.ts'

const transport = vi.hoisted(() => ({ options: null as VoiceTransportOptions | null, created: 0, send: vi.fn((_message: unknown) => true), stop: vi.fn() }))
vi.mock('../src/voice/transport.ts', () => ({ createVoiceTransport: (options: VoiceTransportOptions) => { transport.options = options; transport.created++; return { start() {}, stop: transport.stop, pauseCapture: () => options.onState('OFF'), send: transport.send, isSupported: () => true } } }))
const T0 = Date.UTC(2026, 9, 31)
const card: SuggestionCard = { id: 'c1', no: 15, name: '핑크프릴', price: 20000, text: '15번 핑크프릴 이만 원', createdAt: T0, status: 'OPEN', confidence: 'HIGH', touched: false, autoConfirmAt: null }
const settle = async () => { for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0) }
function fixture() {
  const register = vi.fn()
  const host: VoiceHost = { load: serverVoiceOnly, now: Date.now, maxNumber: () => 999, currentNames: () => [], products: () => new Map(), fetchHistory: async () => [], dialogOpen: () => false, readConsent: () => true, writeConsent() {}, readSettings: () => null, writeSettings() {}, register, focusQuick() {} }
  return { remote: createRemoteVoiceController(host, 'broadcast-1'), register }
}
function state() {
  transport.options!.onMessage({ type: 'voice.state', sessionId: 'session-1', sessionReady: true, resumeToken: 'signed.pending.view', snapshot: toWire({ ...VOICE_IDLE, phase: 'on', instant: true }), display: toWire({}) })
}
beforeEach(() => { vi.useFakeTimers({ now: T0 + 3000 }); transport.send.mockReset().mockReturnValue(true); transport.stop.mockClear(); transport.created = 0; transport.options = null; localStorage.clear()
  vi.stubGlobal('AudioContext', function AudioContext() {}); vi.stubGlobal('AudioWorkletNode', function AudioWorkletNode() {})
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('방송 소리 흐름', () => {
  it('조작 전용으로 열고, 쉬어도 닫지 않고, 바로 등록 효과를 처리한다', async () => {
    const { remote, register } = fixture()
    remote.listenStream?.(true); await settle()
    expect(transport.options?.capture).toBe(false)
    state()
    transport.options!.onMessage({ type: 'voice.effect', sessionId: 'session-1', id: 1, method: 'register', args: toWire([card, { no: 15, name: '핑크프릴', price: 20000 }, 'instant']), automatic: true, source: 'control', spokenEndAt: T0 + 2900 })
    await settle()
    expect(register).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.stop).not.toHaveBeenCalled()
    remote.listenStream?.(true); await settle()
    expect(transport.created).toBe(1)
    remote.listenStream?.(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(transport.stop).toHaveBeenCalled()
    remote.dispose()
  })
  it('마이크가 듣는 중이면 따로 열지 않는다', async () => {
    const { remote } = fixture()
    await remote.turnOn(); await settle()
    expect(transport.options?.capture).not.toBe(false)
    remote.listenStream?.(true); await settle()
    expect(transport.created).toBe(1)
    remote.dispose()
  })
})
