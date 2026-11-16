// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toWire } from '@livejjim/voice-session/wire'
import { VoiceSession } from '../src/lib/voice-session.ts'
import { FakeNativeAudio } from '../src/native/audio.ts'
import { configureVoiceStorage, readVoicePreferences } from '../src/lib/voice-preferences.ts'
import { flush, FakeServer, product } from './support.ts'
import { createVoiceEffects } from '../src/lib/voice-effects.ts'
import { fetchJobBitmap, fetchTestBitmap, parseBitmap } from '../src/api/labels.ts'
import { fetchVoiceTicket } from '../src/api/voice.ts'

class RemoteAudio extends FakeNativeAudio {
  readonly sent: unknown[] = []
  readonly messages = new Set<(value: unknown) => void>()
  sendSession(message: unknown): void { this.sent.push(message) }
  onSession(cb: (value: unknown) => void): () => void { this.messages.add(cb); return () => this.messages.delete(cb) }
  message(value: unknown): void { const input = value as Record<string, unknown>; for (const cb of this.messages) cb({ sessionId: 'session-test', ...input }) }
}
const sessions: VoiceSession[] = []
async function setup() {
  configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  const audio = new RemoteAudio()
  const effect = vi.fn(async (_b: string, _method: string, _args: readonly unknown[], _session: VoiceSession): Promise<unknown> => ({ kind: 'ok' }))
  const session = new VoiceSession({ audio, effect, now: () => 30000, deviceId: 'abcdefgh', register: async () => undefined, undoRegister: async () => undefined })
  sessions.push(session)
  await session.turnOn('b1', '방송'); await session.acceptConsent(); audio.message({ type: 'ready' })
  audio.message({ type: 'voice.state', snapshot: toWire({ cards: [], forms: new Map(), notes: new Map(), instant: true, error: null }), display: toWire({}) })
  return { audio, effect, session }
}
afterEach(async () => { for (const session of sessions.splice(0)) { await session.turnOff(); session.dispose() } vi.useRealTimers() })
describe('모바일 전체 서버 음성 세션', () => {
  it.each([['register', false], ['writeSms', false], ['fixRecent', false], ['register', true]] as const)('RA-APP1b-002: %s 조회 대기 후 연결 중단=%s이면 최초 HTTP 직전에 유효성을 재검사한다', async (method, disconnect) => {
    let now = 30000
    let release!: () => void
    const delayed = new Promise<void>((resolve) => { release = resolve })
    const server = new FakeServer(); server.install()
    server.on('GET', /^\/api\/days\//, async () => {
      await delayed
      return { body: { broadcasts: [{ id: 'b1', settings: {} }], products: [product(15, { key: 'p1', name: '', price: 20000 })] } }
    })
    const effect = createVoiceEffects(async () => {
      if (method === 'register') await delayed
      return { date: '2026-10-29', rehearsal: false }
    })
    configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
    const audio = new RemoteAudio()
    const session = new VoiceSession({ audio, effect, now: () => now, ticket: async () => ({ wsUrl: 'ws://localhost/api/voice/stream' }), register: async () => undefined, undoRegister: async () => undefined })
    sessions.push(session)
    await session.turnOn('b1', '방송'); await session.acceptConsent(); audio.message({ type: 'ready' })
    audio.message({ type: 'voice.state', snapshot: toWire({ cards: [], forms: new Map(), instant: true, error: null }), display: toWire({}) })
    const args = method === 'register' ? [{ id: 'c1', no: 15 }, { no: 15, name: '', price: 20000 }, 'instant'] : method === 'writeSms' ? [{ no: 15, memo: null, buyer: 'buyer1' }, null, 'same-sms-request'] : ['p1', { name: '핑크프릴' }, {}]
    audio.message({ type: 'voice.effect', id: 991, method, automatic: true, source: 'livegenie', spokenEndAt: 29000, args: toWire(args) })
    await flush(); now += disconnect ? 2000 : 12000
    if (disconnect) audio.setState({ kind: 'reconnecting', attempt: 1 })
    release(); await flush(30)
    const note = disconnect ? '음성 연결이 바뀌어 보내지 않았어요. 확인하고 다시 눌러 주세요.' : '늦게 인식한 말이에요. 확인하고 다시 눌러 주세요.' // 문구 바뀜 (D-UX4-96, 옛 기대: "늦게 들린 말이에요.")
    expect(server.callsTo('POST', /^\/api\/events/)).toHaveLength(0)
    expect(audio.sent).toContainEqual(expect.objectContaining({ op: 'effectResult', id: 991, value: { kind: 'failed', message: note } }))
    if (method === 'register' && !disconnect) expect(audio.sent).toContainEqual(expect.objectContaining({ method: 'restore', args: [args[0], { touched: true, note }] }))
  })

  it('방송 소리로 듣기(D-LIVETEST-02): 마이크 없이 조작 전용 연결을 열어 두고 쉬지 않으며, 마이크를 끄면 다시 조작 전용으로 연다', async () => {
    configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
    const audio = new RemoteAudio()
    const effect = vi.fn(async (): Promise<unknown> => ({ kind: 'ok' }))
    const session = new VoiceSession({ audio, effect, now: () => 30000, ticket: async () => ({ wsUrl: 'ws://localhost/api/voice/stream?broadcastId=b1' }), register: async () => undefined, undoRegister: async () => undefined })
    sessions.push(session)
    session.holdStream('b1', '방송', true); await flush()
    expect(audio.starts).toHaveLength(1)
    expect(audio.starts[0]?.capture).toBe(false)
    expect(audio.starts[0]?.wsUrl).toContain('capture=false')
    expect(session.getView().on).toBe(false)
    // 서버 읽기는 listening=false인 인사면 읽기를 끈다 — 방송 소리 연결은 듣는 중으로 인사한다
    expect(audio.sent).toContainEqual(expect.objectContaining({ op: 'hello', context: expect.objectContaining({ listening: true }) }))
    audio.message({ type: 'ready' })
    audio.message({ type: 'result', text: '15번 핑크프릴 이만 원', startMs: 0, endMs: 1000 })
    expect(session.getView().transcript).toEqual(['15번 핑크프릴 이만 원'])
    // 방송 소리로 듣는 중에는 서버가 바로 등록한 자동 쓰기도 보낸다 (마이크가 꺼져 있어도)
    audio.message({ type: 'voice.state', snapshot: toWire({ cards: [], forms: new Map(), notes: new Map(), instant: true, error: null }), display: toWire({}) })
    audio.message({ type: 'voice.effect', id: 7, method: 'register', automatic: true, source: 'livegenie', spokenEndAt: 29000, args: toWire([{ id: 'c1', no: 15 }, { no: 15, name: '', price: 20000 }, 'instant']) })
    await flush(10)
    // 서버의 해석 문장은 받아쓴 글 목록을 덮지 않는다
    expect(session.getView().transcript).toEqual(['15번 핑크프릴 이만 원'])
    expect(effect).toHaveBeenCalledTimes(1)
    expect(audio.sent).toContainEqual(expect.objectContaining({ op: 'effectResult', id: 7, value: { kind: 'ok' } }))
    await new Promise((resolve) => setTimeout(resolve, 1700))
    expect(audio.stops).toBe(0)
    session.holdStream('b1', '방송', true); await flush()
    expect(audio.starts).toHaveLength(1)
    await session.turnOn('b1', '방송'); await session.acceptConsent(); await flush()
    expect(audio.starts.at(-1)?.capture).toBe(true)
    await session.turnOff(); await flush()
    expect(audio.starts.at(-1)?.capture).toBe(false)
    session.holdStream('b1', '방송', false)
    await new Promise((resolve) => setTimeout(resolve, 1700))
    expect(audio.stops).toBeGreaterThan(1)
  })

  it('마이크를 켜기 전에 바꾼 바로 등록 설정을 저장하고 첫 연결·새 앱에서도 복원한다', async () => {
    let stored = JSON.stringify({ consent: true, settings: { 'voice.autoConfirm': true, 'voice.autoRegister': true } })
    configureVoiceStorage({ getItem: async () => stored, setItem: async (_key, value) => { stored = value } })
    const audio = new RemoteAudio()
    const options = { audio, ticket: async () => ({ wsUrl: 'ws://localhost/api/voice/stream' }), register: async () => undefined, undoRegister: async () => undefined }
    const session = new VoiceSession(options)
    sessions.push(session)
    session.setInstant(false)
    expect(audio.starts).toHaveLength(0)
    expect(audio.sent).toHaveLength(0)
    await session.turnOn('b1', '방송')
    expect(audio.sent).toContainEqual(expect.objectContaining({ op: 'hello', context: expect.objectContaining({ settings: { 'voice.autoConfirm': true, 'voice.autoRegister': false } }) }))
    expect(JSON.parse(stored)).toMatchObject({ consent: true, settings: { 'voice.autoRegister': false } })
    await session.turnOff()
    const reopened = new VoiceSession({ ...options, audio: new RemoteAudio() })
    sessions.push(reopened)
    await readVoicePreferences()
    expect(reopened.getView().instant).toBe(false)
  })

  it('늦게 도착한 설정 화면·저장 효과가 바로 등록 끄기를 되돌리지 않는다', async () => {
    const { audio, session } = await setup()
    session.setInstant(false)
    audio.message({ type: 'voice.state', snapshot: toWire({ cards: [], forms: new Map(), instant: true, settings: { 'voice.autoRegister': true }, error: null }), display: toWire({}) })
    audio.message({ type: 'voice.effect', id: 901, method: 'writeSettings', args: toWire([{ 'voice.autoRegister': true, 'voice.autoConfirm': true }]) })
    await flush()
    const preferences = await readVoicePreferences()
    expect(session.getView().instant).toBe(false)
    expect(preferences.settings).toMatchObject({ 'voice.autoRegister': false, 'voice.autoConfirm': true })
  })
  it('SA-APP2-001: 복원표 거절은 마이크·주기 전송을 멈추고 카드는 남기며 새 표 없이 다시 켠다', async () => {
    vi.useFakeTimers()
    const { audio, session, effect } = await setup()
    const snapshot = { cards: [{ id: 'c1', no: 15 }], forms: new Map(), notes: new Map(), instant: true, error: null }
    audio.message({ type: 'voice.state', sessionReady: true, resumeToken: 'old-token', snapshot: toWire(snapshot), display: toWire({}) })
    audio.message({ type: 'voice.error', code: 'RESUME_INVALID', message: '음성 대기 내용을 다시 연결하지 못했어요.' })
    await vi.advanceTimersByTimeAsync(0)
    expect(session.getView()).toMatchObject({ on: false, state: { kind: 'stopped' }, remote: snapshot })
    expect(audio.stops).toBe(1)
    const sent = audio.sent.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(audio.sent).toHaveLength(sent)
    audio.message({ type: 'voice.effect', id: 91, method: 'register', args: toWire([]), automatic: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(effect).not.toHaveBeenCalled()
    await session.retry()
    expect(audio.sent.filter((item) => (item as { op?: string }).op === 'hello').at(-1)).toMatchObject({ context: { listening: true } })
    expect((audio.sent.at(-1) as { context: Record<string, unknown> }).context).not.toHaveProperty('resumeToken')
  })
  it('SA-APP2-001: 빈 복원표를 재전송하지 않고 끄기 전에 대기 내용 확인을 안내한다', async () => {
    const { audio, session } = await setup()
    audio.message({ type: 'voice.state', sessionReady: true, resumeToken: '', snapshot: toWire({ cards: [], forms: new Map(), notes: new Map(), instant: true, error: null }), display: toWire({}) })
    expect(session.getView().problem).toBe('대기 내용이 많아 다시 연결할 수 없어요. 음성을 끄기 전에 남은 카드와 문자찜을 확인해 주세요.')
    await session.turnOff(); await session.retry()
    expect((audio.sent.at(-1) as { context: Record<string, unknown> }).context).not.toHaveProperty('resumeToken')
  })
  it('쿠키 인증 endpoint만 만들며 토큰·가짜 표를 붙이지 않는다', async () => {
    const ticket = await fetchVoiceTicket('b1', 'abcdefgh')
    const url = new URL(ticket.wsUrl)
    expect(url.pathname).toBe('/api/voice/stream')
    expect([...url.searchParams.keys()]).toEqual(['broadcastId', 'device'])
    expect(ticket.token).toBeUndefined()
  })
  it('카드·정정·문자찜 전체 state와 Map을 유지한다', async () => {
    const { audio, session } = await setup()
    const snapshot = { cards: [{ id: 'c1', no: 15 }], forms: new Map([['c1', { price: '2만' }]]), offers: [{ id: 'o1', message: '고칠까요?' }], sms: [{ card: { id: 's1' } }], instant: true, readout: { text: '15번 2만 원' }, error: null }
    audio.message({ type: 'voice.state', snapshot: toWire(snapshot), display: toWire({ cards: new Map([['c1', '15번 20,000원']]) }) })
    expect(session.getView().remote).toEqual(snapshot)
    expect(session.getView().display.cards).toBeInstanceOf(Map)
    session.command('smsChoose', ['s1', 'buyer1'])
    expect(audio.sent.at(-1)).toEqual({ type: 'voice.session', op: 'command', method: 'smsChoose', args: ['s1', 'buyer1'] })
  })
  it('늦거나 시각이 없는 자동쓰기 모두 차단하고 확인한 사용자 동작은 허용한다', async () => {
    const { audio, effect } = await setup()
    const card = { id: 'c1', text: '15번 2만 원' }
    audio.message({ type: 'voice.effect', id: 1, method: 'register', args: toWire([card, { no: 15, price: 20000, name: '' }, 'instant']), spokenEndAt: 19000, automatic: true, source: 'livegenie' })
    audio.message({ type: 'voice.effect', id: 2, method: 'writeSms', args: toWire([{ no: 15 }, null, 'r1']), automatic: true, source: 'livegenie' })
    await flush(20)
    expect(effect).not.toHaveBeenCalled()
    expect(audio.sent).toContainEqual({ type: 'voice.session', op: 'command', method: 'restore', args: [card, { touched: true, note: '늦게 인식한 말이에요. 확인하고 다시 눌러 주세요.' }] }) // 문구 바뀜 (D-UX4-96, 옛 기대: "늦게 들린 말이에요.")
    expect(audio.sent).toContainEqual(expect.objectContaining({ op: 'effectResult', id: 2, value: { kind: 'failed', message: '늦게 인식한 말이에요. 확인하고 다시 눌러 주세요.' } })) // 문구 바뀜 (D-UX4-96, 옛 기대: "늦게 들린 말이에요.")
    audio.message({ type: 'voice.effect', id: 3, method: 'writeSms', args: toWire([{ no: 15 }, null, 'r2']), automatic: false, source: 'livegenie' })
    await flush()
    expect(effect).toHaveBeenCalledTimes(1)
  })
  it('같은 효과 중복 수신은 한번만 쓰고 재연결 전 완료되지 않은 효과를 재생하지 않는다', async () => {
    const { audio, effect } = await setup()
    const message = { type: 'voice.effect', id: 1, method: 'renumber', args: toWire([15, 16]), automatic: false }
    audio.message(message); audio.message(message)
    await flush()
    expect(effect).toHaveBeenCalledTimes(1)
    audio.message({ ...message, id: 2 }); audio.message({ type: 'ready' })
    await flush()
    expect(effect).toHaveBeenCalledTimes(1)
  })
  it('연결이 끊겨도 서버 확인 DTO를 한 번만 소비하고 같은 요청 번호로 재전송한다', async () => {
    const { audio, effect, session } = await setup()
    const card = { id: 'c1', text: '15번 2만 원', no: 15, name: null, price: 20000 }
    const dto = { sessionId: 'session-test', broadcastId: 'b1', device: 'abcdefgh', cardId: 'c1', cardVersion: 1, registration: { no: 15, name: '', price: 20000 } }
    audio.message({ type: 'voice.state', snapshot: toWire({ cards: [card], forms: new Map(), notes: new Map(), instant: true, error: null }), display: toWire({ confirmations: new Map([['c1', dto]]) }) })
    audio.setState({ kind: 'reconnecting', attempt: 1 })
    effect.mockResolvedValueOnce({ kind: 'failed', message: '연결을 확인해 주세요.' }).mockResolvedValueOnce({ kind: 'registered' })
    await session.confirmCard('c1'); await session.confirmCard('c1')
    expect(effect).toHaveBeenCalledTimes(1)
    const pending = session.getView().manualRetries[0]!
    expect(pending.error).toBe('연결을 확인해 주세요.')
    await session.retryManualRegistration(pending.id)
    expect(effect).toHaveBeenCalledTimes(2)
    expect(effect.mock.calls[0]![2]).toEqual(effect.mock.calls[1]![2])
    expect((effect.mock.calls[0]![2] as unknown[])[1]).toEqual(dto.registration)
    expect(session.getView().manualRetries).toEqual([])
  })
  it('폼이나 후보를 고치면 이전 확인 DTO로 등록하지 않는다', async () => {
    const { audio, effect, session } = await setup()
    audio.message({ type: 'voice.state', snapshot: toWire({ cards: [{ id: 'c1', text: '15번 2만 원' }], forms: new Map(), notes: new Map(), instant: true, error: null }), display: toWire({ confirmations: new Map([['c1', { sessionId: 'session-test', broadcastId: 'b1', device: 'abcdefgh', cardId: 'c1', cardVersion: 1, registration: { no: 15, name: '', price: 20000 } }]]) }) })
    session.command('chooseCandidate', ['c1', '핑크프릴'])
    audio.setState({ kind: 'reconnecting', attempt: 1 })
    await session.confirmCard('c1')
    expect(effect).not.toHaveBeenCalled()
    expect(session.getView().problem).toContain('서버에서 확인')
  })
  it('서버의 changed:false 등록은 새 등록이나 되돌리기로 알리지 않는다', async () => {
    const server = new FakeServer(); server.install()
    server.on('POST', /^\/api\/events$/, () => ({ body: { changed: false } }))
    const { session } = await setup()
    const command = vi.spyOn(session, 'command'); const registered = vi.spyOn(session, 'noteRegistered')
    await createVoiceEffects(async () => ({ date: '2026-10-29', rehearsal: false }))('b1', 'register', [{ id: 'c1', text: '15번 2만 원' }, { no: 15, name: '', price: 20000 }, 'instant', null], session)
    expect(command).toHaveBeenCalledWith('instantExists', [{ id: 'c1', text: '15번 2만 원' }])
    expect(registered).not.toHaveBeenCalled()
  })
  it('D-RECOG-28: 가격이 빈 확인 중 상품의 가격 채우기는 가격만 적는 상품 고치기 — 찜 범위 물음 없이, 앞 가격은 적지 않는다(0원 아님)', async () => {
    const server = new FakeServer(); server.install()
    server.on('GET', /^\/api\/days\//, () => ({ body: { broadcasts: [{ id: 'b1', settings: {} }], products: [product(5, { key: 'b1/5', name: '', price: null, status: 'READY' })] } }))
    server.on('POST', /^\/api\/events/, () => ({ body: { changed: true, seq: 9 } }))
    const { session } = await setup()
    const ask = vi.spyOn(session, 'choosePriceScope')
    const voiceLog = { heard: '5번 3만 원', source: 'voice' }
    const result = await createVoiceEffects(async () => ({ date: '2026-10-29', rehearsal: false }))('b1', 'fixRecent', ['b1/5', { price: 30000 }, { requestId: 'fill-5', voiceLog }], session)
    expect(result).toEqual({ kind: 'fixed', before: {} })
    expect(ask).not.toHaveBeenCalled()
    expect(server.callsTo('POST', /^\/api\/events/).map((call) => call.body)).toEqual([{ type: 'product.update', b: 'b1', no: 5, price: 30000, voiceLog, requestId: 'fill-5' }])
  })
  it('없거나 손상된 서버 비트맵은 빈 그림 성공으로 대체하지 않는다', async () => {
    const server = new FakeServer(); server.install()
    await expect(fetchJobBitmap({ id: 'missing', attempt: 'a1' }, 'abcdefgh')).rejects.toThrow()
    await expect(fetchTestBitmap('50x30')).rejects.toThrow()
    expect(parseBitmap({ width: 8, height: 1, data: '!!!!AA==' })).toBeNull()
    expect(parseBitmap({ width: 8, height: 1, data: 'AAA=' })).toBeNull()
    expect(parseBitmap({ width: 1000000, height: 1000000, data: '' })).toBeNull()
  })
})
