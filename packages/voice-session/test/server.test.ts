import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as voice from '@livejjim/voice'
import { BaseSpeechEngine, type SpeechResult } from '../../voice/src/speech.ts'
import { VoiceController, type VoiceHost } from '../src/controller/controller.ts'
import { createReadingSession, type ReadingHost } from '../src/server.ts'
import { fromWire, isVoiceClientMessage, toWire, type VoiceEffectMessage, type VoiceServerMessage, type VoiceStateMessage } from '../src/wire.ts'
import { openResume } from '../src/resume.ts'

const T0 = Date.UTC(2026, 9, 29, 3)
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const context = () => ({ now: Date.now(), dialogOpen: false, smsAutoAllowed: true, consent: true, settings: { 'voice.instant': false } })
const data = (): ReadingHost => ({ maxNumber: () => 999, currentNames: () => [], products: () => new Map(), fetchHistory: async () => [], priceUnit: () => 'WON' })
class Engine extends BaseSpeechEngine {
  readonly kind = 'livegenie' as const
  isSupported() { return true }
  start() { this.setState('LISTENING') }
  stop() { this.setState('OFF') }
  result(result: SpeechResult) { this.emitResult(result) }
}
/**
 * SRV1 (D-APP-22·D-APP-25): 옛 크롬 받아쓴 글(chromeResult) 대신 받아쓰기 일꾼의 최종 글(onResult)로 말한다 — 같은 읽기 컨트롤러를 지난다.
 * 말 끝 시각이 지금이 되도록 처음 한 번 capture(소리 잡은 시각)를 보내고, 끝 ms는 그 뒤 지난 시간이다(늦은 글 판단 D-APP-12에 걸리지 않게)
 */
function speaker(session: { onMessage(value: unknown): void; onResult(text: string, startMs: number, endMs: number): void }) {
  let capturedAt: number | null = null
  return (text: string) => {
    if (capturedAt === null) {
      capturedAt = Date.now()
      session.onMessage({ type: 'voice.session', op: 'capture', at: capturedAt })
    }
    const end = Date.now() - capturedAt
    session.onResult(text, Math.max(0, end - 100), end)
  }
}
beforeEach(() => { vi.useFakeTimers({ now: T0 }) })
afterEach(() => { vi.useRealTimers() })

describe('APP1b server reading session', () => {
  it('releases a registration collision only for the original server card and allows the next price correction', async () => {
    const messages: VoiceServerMessage[] = []
    let product: { key: string; name: string; price: number; claimCount: number; closed: boolean } | null = null
    const session = createReadingSession({ host: { ...data(), existingProduct: (no) => no === 15 ? product : null }, device: 'test', send: (message) => messages.push(message) })
    const speak = speaker(session)
    session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), settings: { 'voice.autoRegister': true } } }); await settle()
    speak('15번 라울 만원')
    await vi.advanceTimersByTimeAsync(1900)
    const sent = messages.find((message): message is VoiceEffectMessage => message.type === 'voice.effect' && message.method === 'register')
    if (sent === undefined) throw new Error('음성 등록이 없다')
    const [card] = fromWire(sent.args) as [voice.SuggestionCard]
    const latest = () => fromWire(messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)!.snapshot) as ReturnType<VoiceController['getSnapshot']>
    // 동일 카드라도 서버에 실제 상품이 없으면 충돌 통지로 성공 대기를 풀지 않는다.
    session.onMessage({ type: 'voice.session', op: 'command', method: 'instantExists', args: [card] }); await settle()
    expect(latest().offers).toHaveLength(0)
    product = { key: 'broadcast:15', name: '핑크프릴', price: 20000, claimCount: 0, closed: false }
    for (const changed of [{ ...card, id: 'other-card' }, { ...card, price: 9000 }]) {
      session.onMessage({ type: 'voice.session', op: 'command', method: 'instantExists', args: [changed] }); await settle()
      expect(latest().offers).toHaveLength(0)
    }
    session.onMessage({ type: 'voice.session', op: 'command', method: 'instantExists', args: [card] }); await settle()
    expect(latest().offers).toEqual([expect.objectContaining({ stage: 'ask', changes: { name: '라울', price: 10000 } })])
    speak('15번 라울 만원')
    await vi.advanceTimersByTimeAsync(1900)
    const fixes = messages.filter((message): message is VoiceEffectMessage => message.type === 'voice.effect' && message.method === 'fixRecent')
    expect(fixes).toHaveLength(1)
    expect(fromWire(fixes[0]!.args)).toEqual(['broadcast:15', { name: '라울', price: 10000 }, expect.objectContaining({ newOnly: true })])
    session.onMessage({ type: 'voice.session', op: 'effectResult', id: fixes[0]!.id, value: { kind: 'fixed', before: { name: '핑크프릴', price: 20000 } } }); await settle()
    expect(latest().offers.some((offer) => offer.stage === 'fixed')).toBe(true)
    session.close()
  })
  it('preserves the other-number notice after an early interim registration in the long R7 utterance', async () => {
    const messages: VoiceServerMessage[] = []
    let product: { key: string; name: string; price: number; claimCount: number; closed: boolean } | null = null
    const session = createReadingSession({ host: { ...data(), existingProduct: (no) => no === 139 ? product : null }, device: 'test', send: (message) => {
      messages.push(message)
      if (message.type === 'voice.effect' && message.method === 'register') {
        const [, registration] = fromWire(message.args) as [unknown, { name: string; price: number }]
        product = { key: 'broadcast:139', ...registration, claimCount: 0, closed: false }
      }
    } })
    session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), settings: { 'voice.autoRegister': true } } }); await settle()
    // SRV1: 옛 크롬 중간 글(굳은 중간 글 D-V3-80) 대신 받아쓰기 일꾼의 최종 글 하나 — 같은 긴 말
    const speak = speaker(session)
    speak('어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요')
    await vi.advanceTimersByTimeAsync(1900)
    session.onMessage({ type: 'voice.session', op: 'command', method: 'noteVoiceRegistered', args: [{ id: 'broadcast:139', no: 139, name: '빅뱅금', price: 500000 }] }); await settle()
    await vi.advanceTimersByTimeAsync(2500)
    const latest = messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)!
    expect(fromWire(latest.snapshot)).toMatchObject({ readout: { text: '139번으로 등록했는데 189번도 들렸어요. 맞는지 확인해 주세요.' } })
    expect(messages.filter((message) => message.type === 'voice.effect' && message.method === 'register')).toHaveLength(1)
    session.close()
  })
  it.each(['ack', 'failed', 'timeout'] as const)('waits for the matching client registration before a following automatic price correction (%s)', async (outcome) => {
    const messages: VoiceServerMessage[] = []
    let product: { key: string; name: string; price: number; claimCount: number; closed: boolean } | null = null
    const session = createReadingSession({ host: { ...data(), existingProduct: (no) => no === 55 ? product : null }, device: 'test', send: (message) => {
      messages.push(message)
      if (message.type === 'voice.effect' && message.method === 'register') {
        const [, registration] = fromWire(message.args) as [unknown, { name: string; price: number }]
        product = { key: 'broadcast:55', ...registration, claimCount: 0, closed: false }
      }
    } })
    session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), settings: { 'voice.autoRegister': true } } }); await settle()
    // SRV1: 옛 크롬 중간 글로 먼저 등록되던 앞 말과 뒤따른 정정을 받아쓰기 일꾼의 두 최종 글로
    const speak = speaker(session)
    speak('55번 만 원')
    await vi.advanceTimersByTimeAsync(1900)
    speak('아니 만오천 원')
    await vi.advanceTimersByTimeAsync(1900)
    const registration = messages.find((message) => message.type === 'voice.effect' && message.method === 'register')
    expect(registration).toBeDefined()
    const fixes = () => messages.filter((message): message is VoiceEffectMessage => message.type === 'voice.effect' && message.method === 'fixRecent')
    expect(fixes()).toHaveLength(0)
    session.onMessage({ type: 'voice.session', op: 'command', method: 'noteVoiceRegistered', args: [{ id: 'wrong:55', no: 55, name: '', price: 10000 }] }); await settle()
    expect(fixes()).toHaveLength(0)
    if (outcome === 'ack') {
      session.onMessage({ type: 'voice.session', op: 'command', method: 'noteVoiceRegistered', args: [{ id: 'broadcast:55', no: 55, name: '', price: 10000 }] }); await settle()
      expect(fixes()).toHaveLength(1)
      expect(fromWire(fixes()[0]!.args)).toEqual(['broadcast:55', { price: 15000 }, expect.objectContaining({ newOnly: true })])
    } else {
      if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(30_000)
      else if (registration?.type === 'voice.effect') {
        const [card] = fromWire(registration.args) as unknown[]
        session.onMessage({ type: 'voice.session', op: 'command', method: 'restore', args: [card, { touched: true }] }); await settle()
      }
      expect(fixes()).toHaveLength(0)
      const latest = messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)!
      expect(fromWire(latest.snapshot)).toMatchObject({ offers: [expect.objectContaining({ stage: 'ask', error: expect.stringContaining('등록한 상품을 확인하지 못했어요') })] })
      const offer = (fromWire(latest.snapshot) as ReturnType<VoiceController['getSnapshot']>).offers[0]!
      session.onMessage({ type: 'voice.session', op: 'command', method: 'fixOffer', args: [offer.id] }); await settle()
      expect(fixes()).toHaveLength(1)
      expect(fixes()[0]?.automatic).toBe(false)
    }
    session.close()
  })
  it('flushes an accepted unfinished phrase into the final off-state log and ignores late capture', async () => {
    const messages: VoiceServerMessage[] = []
    const session = createReadingSession({ host: data(), device: 'test', send: (message) => messages.push(message) })
    const speak = speaker(session)
    session.onMessage({ type: 'voice.session', op: 'hello', context: context() }); await settle()
    speak('첫 문장이에요')
    session.onMessage({ type: 'voice.session', op: 'command', method: 'turnOff', args: [] }); await settle()
    speak('늦게 온 문장이에요')
    const latest = messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)!
    expect(fromWire(latest.snapshot)).toMatchObject({ phase: 'off', log: [{ pieces: [{ text: '첫 문장이에요' }] }] })
    expect(fromWire(latest.display)).toMatchObject({ logLines: [{ pieces: ['첫 문장이에요'] }] })
    session.close()
  })
  it('resumes cards, edited forms and SMS while off, with no automatic writes and the same SMS retry request', async () => {
    const messages: VoiceServerMessage[] = []
    const options = { host: { ...data(), smsReadOptions: () => ({ maxNumber: 999 }), smsProduct: () => ({ state: 'OPEN' as const, waitlistFull: false }) }, device: 'device', accountId: 'seller', broadcastId: 'broadcast', send: (message: VoiceServerMessage) => messages.push(message) }
    let session = createReadingSession(options)
    const speak = speaker(session)
    const start = async (token?: string) => {
      session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), smsSettings: { 'voice.smsAutoSec': 10 }, ...(token === undefined ? {} : { resumeToken: token, listening: false }) } })
      await settle()
    }
    const latest = () => messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state' && message.sessionReady).at(-1)!
    const view = () => fromWire(latest().snapshot) as ReturnType<VoiceController['getSnapshot']>
    await start()
    speak('16번 엘레강스 만오천원')
    await vi.advanceTimersByTimeAsync(1900)
    const id = view().cards[0]!.id
    session.onMessage({ type: 'voice.session', op: 'command', method: 'openForm', args: [id] })
    session.onMessage({ type: 'voice.session', op: 'command', method: 'editForm', args: [id, { price: '18000' }] })
    speak('15번 문자찜 끝자리 1234')
    await vi.advanceTimersByTimeAsync(1900)
    session.onMessage({ type: 'voice.session', op: 'command', method: 'turnOff', args: [] }); await settle()
    const before = view(), token = latest().resumeToken
    expect(before.sms).toHaveLength(1)
    expect(openResume(token, JSON.stringify(['other', 'broadcast', 'device']), Date.now())).toBeNull()
    expect(openResume(token.slice(0, -3) + 'xxx', JSON.stringify(['seller', 'broadcast', 'device']), Date.now())).toBeNull()
    expect(openResume(token.slice(0, 30), JSON.stringify(['seller', 'broadcast', 'device']), Date.now())).toBeNull()
    expect(openResume(token, JSON.stringify(['seller', 'broadcast', 'device']), Date.now() + 4 * 60 * 60 * 1000)).toBeNull()
    expect(token.length).toBeLessThanOrEqual(12000)
    expect(new TextEncoder().encode(JSON.stringify({ type: 'voice.session', op: 'hello', context: { ...context(), resumeToken: token } })).length).toBeLessThan(16 * 1024)
    session.close(); messages.length = 0
    session = createReadingSession(options); await start(token)
    expect(view().phase).toBe('off')
    expect(view().cards).toEqual(before.cards)
    expect(view().forms).toEqual(before.forms)
    expect(view().sms).toEqual(before.sms)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(messages.filter((message) => message.type === 'voice.effect' && ['register', 'writeSms'].includes(message.method))).toHaveLength(0)
    const smsId = view().sms[0]!.card.id
    session.onMessage({ type: 'voice.session', op: 'command', method: 'smsSend', args: [smsId] }); await settle()
    const first = messages.find((message) => message.type === 'voice.effect' && message.method === 'writeSms')
    expect(first?.type).toBe('voice.effect')
    const inFlight = latest().resumeToken
    session.close(); messages.length = 0
    session = createReadingSession(options); await start(inFlight)
    session.onMessage({ type: 'voice.session', op: 'command', method: 'smsSend', args: [smsId] }); await settle()
    const retry = messages.find((message) => message.type === 'voice.effect' && message.method === 'writeSms')
    if (first?.type === 'voice.effect' && retry?.type === 'voice.effect') {
      expect((fromWire(retry.args) as unknown[])[2]).toBe((fromWire(first.args) as unknown[])[2])
      expect(retry.automatic).toBe(false)
    } else throw new Error('manual SMS did not create a write')
    session.close()
  })

  it('preserves existing controller cards, candidates, forms and registration for the same utterances', async () => {
    const messages: VoiceServerMessage[] = []
    const server = createReadingSession({ host: data(), device: 'test', send: (message) => messages.push(message) })
    const speak = speaker(server)
    const engine = new Engine()
    const registered: unknown[][] = []
    const host: VoiceHost = { ...data(), load: async () => voice, createEngine: () => engine, now: Date.now, dialogOpen: () => false, readConsent: () => true, writeConsent() {}, readSettings: () => context().settings, writeSettings() {}, register: (...args) => registered.push(args), focusQuick() {} }
    const original = new VoiceController(host)
    server.onMessage({ type: 'voice.session', op: 'hello', context: context() })
    await original.turnOn(); await settle()
    for (const text of ['15번 엘레강스 만오천원', '16번 핑크프릴 이만원']) {
      engine.result({ text, final: true })
      speak(text)
      await vi.advanceTimersByTimeAsync(1900)
    }
    const latest = () => fromWire((messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1) as VoiceStateMessage).snapshot) as ReturnType<VoiceController['getSnapshot']>
    expect(latest().cards).toEqual(original.getSnapshot().cards)
    expect(latest().info).toEqual(original.getSnapshot().info)
    const id = original.getSnapshot().cards[0]?.id
    expect(id).toBeDefined()
    original.openForm(id!)
    server.onMessage({ type: 'voice.session', op: 'command', method: 'openForm', args: [id] })
    await settle()
    expect(latest().forms).toEqual(original.getSnapshot().forms)
    original.confirm(id!, 'click')
    server.onMessage({ type: 'voice.session', op: 'command', method: 'confirm', args: [id, 'click'] })
    await settle()
    const effect = messages.find((message) => message.type === 'voice.effect' && message.method === 'register')
    expect(effect?.type).toBe('voice.effect')
    if (effect?.type === 'voice.effect') {
      expect((fromWire(effect.args) as unknown[]).slice(0, 3)).toEqual(registered[0])
      expect(effect.automatic).toBe(false)
    }
    server.close(); original.dispose()
  })

  it('moves queued deadlines with the supplied device clock and discards all timers on close', async () => {
    const messages: VoiceServerMessage[] = []
    const session = createReadingSession({ host: data(), device: 'test', send: (message) => messages.push(message) })
    const speak = speaker(session)
    session.onMessage({ type: 'voice.session', op: 'hello', context: context() }); await settle()
    speak('15번 엘레강스 만오천원')
    session.onMessage({ type: 'voice.session', op: 'context', context: { ...context(), now: T0 + 1900 } })
    const state = messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)
    expect((fromWire(state?.snapshot) as { cards: unknown[] }).cards).toHaveLength(1)
    session.close()
    const count = messages.length
    await vi.advanceTimersByTimeAsync(60_000)
    session.onResult('16번 만원', 0, 100)
    expect(messages).toHaveLength(count)
  })

  it.each(['late', 'missing', 'future'] as const)('keeps %s worker results as confirmation cards without automatic writing', async (kind) => {
    const messages: VoiceServerMessage[] = []
    const session = createReadingSession({ host: { ...data(), existingProduct: () => null }, device: 'test', send: (message) => messages.push(message) })
    session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), settings: { 'voice.instant': true } } }); await settle()
    if (kind !== 'missing') session.onMessage({ type: 'voice.session', op: 'capture', at: kind === 'late' ? T0 - 20_000 : T0 + 20_000 })
    session.onResult('15번 엘레강스 만오천원', 0, 100)
    await vi.advanceTimersByTimeAsync(2000)
    expect(messages.filter((message) => message.type === 'voice.effect' && message.method === 'register')).toHaveLength(0)
    const state = messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)
    expect((fromWire(state?.snapshot) as { cards: { autoConfirmAt: unknown }[] }).cards).toEqual([expect.objectContaining({ no: 15, price: 15000, autoConfirmAt: null })])
    session.close()
  })
  it('D-LIVETEST-05 서버가 받은 방송 소리 시각은 기기 시계 차이를 더해 맞춘다 — 기기 시계가 늦어도 늦은 말로 빠지지 않는다', async () => {
    const messages: VoiceServerMessage[] = []
    const session = createReadingSession({ host: { ...data(), existingProduct: () => null }, device: 'test', send: (message) => messages.push(message) })
    // 기기 시계가 서버보다 0.5초 늦다
    session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), now: Date.now() - 500, settings: { 'voice.instant': true } } }); await settle()
    session.onServerCapture(Date.now() - 1000)
    session.onResult('15번 엘레강스 만오천원', 900, 1000)
    await vi.advanceTimersByTimeAsync(2000)
    const state = messages.filter((message): message is VoiceStateMessage => message.type === 'voice.state').at(-1)
    expect((fromWire(state?.snapshot) as { cards: { flushedAtEnd?: boolean }[] }).cards.every((card) => card.flushedAtEnd !== true)).toBe(true)
    session.close()
  })
})

describe('wire boundary', () => {
  it('retains map/set values and drops prototype keys', () => {
    const state = { forms: new Map([['a', { name: '엘레강스' }]]), paused: new Set(['a']) }
    expect(fromWire(JSON.parse(JSON.stringify(toWire(state))))).toEqual(state)
    expect(fromWire(JSON.parse('{"__proto__":{"polluted":true},"constructor":3,"name":"ok"}'))).toEqual({ name: 'ok' })
  })
  it.each([
    { type: 'voice.session', op: 'command', method: 'constructor', args: [] },
    { type: 'voice.session', op: 'command', method: 'setInstant', args: ['true'] },
    { type: 'voice.session', op: 'command', method: 'restore', args: [{ id: 'x', text: 'injected' }] },
    { type: 'voice.session', op: 'command', method: 'noteVoiceRegistered', args: [{ id: 'x', name: 'a', no: -1, price: -1 }] },
  ])('rejects malformed commands %j', (message) => { expect(isVoiceClientMessage(message)).toBe(false) })
})
