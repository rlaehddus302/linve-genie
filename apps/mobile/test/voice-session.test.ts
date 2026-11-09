// 음성 세션 (VOC-06 기기 쪽, APP-02, D-APP-05·08·12): 안내 창 → 켜기 → 서버가 읽은 결과로 바로 등록(10초 안) → 늦은 글은 카드 → 끊김 여섯 번이면 멈춤 → 끄기.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DISCONNECT_WINDOW_MS, LATE_MS, STOP_AFTER_DISCONNECTS, UNDO_MS, VoiceSession } from '../src/lib/voice-session.ts'
import { MIC_START_CUT_MESSAGE, VOICE_STOPPED_BODY } from '../src/lib/words.ts'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import { FakeNativeAudio, type VoiceReading } from '../src/native/audio.ts'
import { FakeClock, flush } from './support.ts'

const reading = (patch: Partial<VoiceReading> = {}): VoiceReading => ({ no: 15, name: '', price: 20_000, instant: true, correction: false, readout: '15번 20,000원', ...patch })

function setup() {
  const audio = new FakeNativeAudio()
  const clock = new FakeClock()
  const register = vi.fn(async () => {})
  const undoRegister = vi.fn(async () => {})
  const processed = vi.fn()
  const session = new VoiceSession({ audio, register, undoRegister, ticket: async () => ({ wsUrl: 'wss://test.local/api/voice/stream', token: 't' }), now: () => clock.now, timer: clock, onProcessed: processed })
  return { audio, clock, register, undoRegister, processed, session }
}

describe('VoiceSession', () => {
  it('처음 켜면 안내 창이 먼저 보이고, 알겠어요를 누르면 네이티브 마이크를 켠다 — 받아쓰기 서버 주소는 넘기지 않는다', async () => {
    const { audio, session } = setup()
    await session.turnOn('b1', '저녁 방송')
    expect(session.getView().askConsent).toBe(true)
    expect(audio.starts.length).toBe(0)
    await session.acceptConsent()
    expect(session.getView().askConsent).toBe(false)
    expect(session.getView().on).toBe(true)
    expect(session.getView().state.kind).toBe('listening')
    expect(audio.starts[0]?.wsUrl).toBe('wss://test.local/api/voice/stream')
    expect(audio.starts[0]?.notificationTitle).toBe('라이브지니 · 음성 인식 중') // 문구 바뀜 (D-UX4-96, 옛 기대: "라이브지니 · 음성 듣는 중")
    // 두 번째부터는 안내 없이 바로
    await session.turnOff()
    expect(audio.stops).toBe(1)
    await session.turnOn('b1', '저녁 방송')
    expect(session.getView().askConsent).toBe(false)
    expect(audio.starts.length).toBe(2)
  })

  it('안 켤래요를 누르면 켜지 않는다', async () => {
    const { audio, session } = setup()
    await session.turnOn('b1', '저녁 방송')
    session.declineConsent()
    expect(session.getView().on).toBe(false)
    expect(audio.starts.length).toBe(0)
  })

  it('서버가 바로 등록 가능이라 한 결과는 10초 안이면 등록하고 5초 되돌리기를 보인다', async () => {
    const { audio, clock, register, undoRegister, processed, session } = setup()
    await session.turnOn('b1', '저녁 방송')
    await session.acceptConsent()
    audio.emit({ text: '15번 2만 원', startMs: clock.now - 1500, endMs: clock.now - 200, reading: reading() })
    await flush()
    expect(register).toHaveBeenCalledWith('b1', reading())
    expect(processed).toHaveBeenCalledTimes(1)
    expect(session.getView().heard).toBe('15번 2만 원')
    expect(session.getView().undo).toEqual({ no: 15, until: clock.now + UNDO_MS })
    expect(session.getView().cards).toEqual([])
    await session.undo()
    expect(undoRegister).toHaveBeenCalledWith('b1', 15)
    expect(session.getView().undo).toBeNull()
  })

  it('말 끝에서 10초 넘게 늦은 글은 등록하지 않고 카드로만 (D-APP-12)', async () => {
    const { audio, clock, register, session } = setup()
    await session.turnOn('b1', '저녁 방송')
    await session.acceptConsent()
    audio.emit({ text: '15번 2만 원', startMs: clock.now - LATE_MS - 2000, endMs: clock.now - LATE_MS - 1, reading: reading() })
    await flush()
    expect(register).not.toHaveBeenCalled()
    const card = session.getView().cards[0]!
    expect(card.late).toBe(true)
    await session.registerCard(card.id)
    expect(register).toHaveBeenCalledTimes(1)
    expect(session.getView().cards).toEqual([])
  })

  it('"바로 등록" 설정을 끄면 카드로만, 서버가 바로 등록 불가라 해도 카드로만', async () => {
    const { audio, clock, register, session } = setup()
    await session.turnOn('b1', '저녁 방송')
    await session.acceptConsent()
    session.setInstant(false)
    audio.emit({ text: '15번 2만 원', startMs: clock.now - 500, endMs: clock.now - 100, reading: reading() })
    session.setInstant(true)
    audio.emit({ text: '15번', startMs: clock.now - 500, endMs: clock.now - 100, reading: reading({ price: null, instant: false, readout: '15번' }) })
    await flush()
    expect(register).not.toHaveBeenCalled()
    expect(session.getView().cards.length).toBe(2)
    session.dismissCard(session.getView().cards[0]!.id)
    expect(session.getView().cards.length).toBe(1)
  })

  it('최종 결과 없이 60초 안에 여섯 번째 끊김이면 멈추고 큰 글 문장 + 다시 켜기 (D-APP-05)', async () => {
    const { audio, clock, session } = setup()
    await session.turnOn('b1', '저녁 방송')
    await session.acceptConsent()
    for (let i = 1; i < STOP_AFTER_DISCONNECTS; i++) {
      audio.setState({ kind: 'reconnecting', attempt: i })
      clock.now += 1000
    }
    expect(session.getView().state.kind).toBe('reconnecting')
    expect(session.getView().on).toBe(true)
    // 결과가 하나 오면 다시 센다
    audio.setState({ kind: 'listening' })
    audio.emit({ text: '안녕하세요', startMs: clock.now - 500, endMs: clock.now - 100, reading: null })
    await flush()
    audio.setState({ kind: 'reconnecting', attempt: 1 })
    expect(session.getView().on).toBe(true)
    // 60초 안 여섯 번째
    for (let i = 2; i <= STOP_AFTER_DISCONNECTS; i++) {
      clock.now += Math.floor(DISCONNECT_WINDOW_MS / 10)
      audio.setState({ kind: 'reconnecting', attempt: i })
    }
    expect(session.getView().on).toBe(false)
    expect(session.getView().state).toEqual({ kind: 'stopped', message: VOICE_STOPPED_BODY })
    expect(audio.stops).toBe(1)
    await session.retry()
    expect(session.getView().on).toBe(true)
    expect(audio.starts.length).toBe(2)
  })

  it('서버가 흐름을 거절하면 그 문장을 보이고 켜지 않는다 (D-APP-10)', async () => {
    const audio = new FakeNativeAudio()
    const session = new VoiceSession({
      audio,
      register: async () => {},
      undoRegister: async () => {},
      ticket: async () => {
        const { VoiceRefused } = await import('../src/api/voice.ts')
        throw new VoiceRefused('음성은 다른 기기에서 듣는 중이에요.')
      },
    })
    await session.turnOn('b1', '저녁 방송')
    await session.acceptConsent()
    expect(session.getView().on).toBe(false)
    expect(session.getView().problem).toBe('음성은 다른 기기에서 듣는 중이에요.')
    expect(audio.starts.length).toBe(0)
  })
  it('지난번 마이크를 켜다가 앱이 꺼졌으면 방송 화면을 열 때 저절로 다시 켜지 않고 알린다, 직접 누르면 켠다', async () => {
    configureVoiceStorage({ getItem: async (k) => k === 'livegenie.voice.preferences.v1' ? JSON.stringify({ consent: true }) : null, setItem: async () => undefined })
    const { audio, session } = setup()
    let cut = true
    Object.assign(audio, { canResume: async () => true, startWasCut: async () => cut })
    await session.resumeIfConsented('b1', '저녁 방송')
    expect(audio.starts.length).toBe(0)
    expect(session.getView().on).toBe(false)
    expect(session.getView().problem).toBe(MIC_START_CUT_MESSAGE)
    cut = false
    await session.resumeIfConsented('b1', '저녁 방송')
    await session.acceptConsent() // 가짜 오디오에는 서버 세션이 없어 안내 창을 한 번 거친다
    expect(audio.starts.length).toBe(1)
    configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  })
})
