// SA-APP2-001 독립 재현: 서버가 폐기한 읽기 세션을 모바일이 "듣는 중"으로 남기면 이후 상품을 놓친다.
import { afterEach, expect, it } from 'vitest'
import { toWire } from '../../packages/voice-session/src/wire.ts'

// Expo 소스는 앱의 bundler tsconfig로 검사한다. NodeNext인 적대 시험으로 재분류하지 않고
// 실제 실행 모듈을 불러와 아래 전송 경계로 시험한다(제품 코드를 복제/가짜로 바꾸지 않는다).
const mobileSource = new URL('../../apps/mobile/src/', import.meta.url)
interface Session {
  turnOn(broadcastId: string, title: string): Promise<void>
  acceptConsent(): Promise<void>
  turnOff(): Promise<void>
  dispose(): void
  getView(): { on: boolean; state: { kind: string; message?: string }; remote: { cards: readonly unknown[] } | null; problem: string | null }
}
interface SessionOptions {
  audio: ServerAudio
  deviceId: string
  ticket: () => Promise<{ wsUrl: string }>
  register: () => Promise<void>
  undoRegister: () => Promise<void>
}
const { VoiceSession } = await import(new URL('lib/voice-session.ts', mobileSource).href) as { VoiceSession: new(options: SessionOptions) => Session }
const { configureVoiceStorage } = await import(new URL('lib/voice-preferences.ts', mobileSource).href) as { configureVoiceStorage(store: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }): void }

class ServerAudio {
  state = { kind: 'off' }
  stops = 0
  readonly states = new Set<(state: { kind: string }) => void>()
  readonly sent: unknown[] = []
  readonly listeners = new Set<(message: unknown) => void>()
  async startListening(): Promise<void> { this.state = { kind: 'listening' }; for (const listener of this.states) listener(this.state) }
  async stopListening(): Promise<void> { this.stops++; this.state = { kind: 'off' }; for (const listener of this.states) listener(this.state) }
  onResult() { return () => undefined }
  onState(listener: (state: { kind: string }) => void) { this.states.add(listener); return () => this.states.delete(listener) }
  sendSession(message: unknown): void { this.sent.push(message) }
  onSession(listener: (message: unknown) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  message(value: unknown) { for (const listener of this.listeners) listener(value) }
}
const sessions: Session[] = []
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
afterEach(async () => { for (const session of sessions.splice(0)) { await session.turnOff(); session.dispose() } })

it('TD-APP2-02 / SA-APP2-001: RESUME_INVALID는 마이크·세션을 멈추고 대기 카드를 보존하며 다음 켜기에 거절된 토큰을 싣지 않는다', async () => {
  configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  const audio = new ServerAudio()
  const session = new VoiceSession({ audio, deviceId: 'auditdevice1', ticket: async () => ({ wsUrl: 'ws://localhost:3000/api/voice/stream?broadcastId=b1&device=auditdevice1' }), register: async () => undefined, undoRegister: async () => undefined })
  sessions.push(session)
  await session.turnOn('b1', '복원 검증'); await session.acceptConsent()
  const card = { id: 'c1', no: 15, price: 20000, name: '핑크프릴', text: '15번 핑크프릴 이만 원' }
  audio.message({ type: 'voice.state', sessionId: 'old-session', sessionReady: true, resumeToken: 'valid-but-expiring-token', snapshot: toWire({ cards: [card], forms: new Map(), notes: new Map(), instant: true, error: null }), display: toWire({}) })
  expect(session.getView().on).toBe(true)
  audio.message({ type: 'ready' })
  audio.message({ type: 'voice.state', sessionId: 'new-session', sessionReady: false, resumeToken: '', snapshot: toWire({ cards: [], forms: new Map() }), display: toWire({}) })
  audio.message({ type: 'voice.error', code: 'RESUME_INVALID', message: '음성 대기 내용을 다시 연결하지 못했어요. 남은 상품과 문자찜을 확인하고 손으로 입력해 주세요.' })
  await flush()
  expect(session.getView().on).toBe(false)
  expect(audio.stops).toBeGreaterThan(0)
  expect(audio.state.kind).toBe('off')
  expect(session.getView().state).toMatchObject({ kind: 'stopped', message: expect.stringContaining('다시 연결하지 못했어요') })
  expect(session.getView().remote?.cards).toEqual([card])
  expect(session.getView().problem).toContain('다시 연결하지 못했어요')
  await session.turnOn('b1', '복원 검증')
  const hellos = audio.sent.filter((value) => (value as { op?: string }).op === 'hello') as { context: Record<string, unknown> }[]
  expect(hellos).toHaveLength(2)
  expect(hellos.at(-1)?.context).not.toHaveProperty('resumeToken')
})
