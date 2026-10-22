// AC-P2-13~15 SpeechEngine · Web Speech 어댑터 · 클라우드 골격 · 끄기 (VOC-01·VOC-05, D-205). 가짜 인식 객체·가짜 연결로 돈다.
import { describe, expect, it, vi } from 'vitest'
import {
  SPEECH_ERROR_MESSAGES,
  SPEECH_STATE_LABELS,
  createDeepgramEngine,
  createReturnZeroEngine,
  createWebSpeechEngine,
  parseDeepgramMessage,
  parseReturnZeroMessage,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type RelayHandlers,
  type SpeechEngine,
  type SpeechError,
  type SpeechResult,
  type SpeechState,
} from '../src/index.ts'

// ── 가짜 SpeechRecognition ───────────────────────────────────────────────

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: RecognitionLike['onresult'] = null
  onerror: RecognitionLike['onerror'] = null
  onend: RecognitionLike['onend'] = null
  starts = 0
  stops = 0
  aborts = 0

  constructor() {
    FakeRecognition.instances.push(this)
  }

  start(): void {
    this.starts++
  }

  stop(): void {
    this.stops++
  }

  abort(): void {
    this.aborts++
  }

  // 시험 도구
  results(resultIndex: number, items: readonly (readonly [string, boolean])[]): void {
    const results = items.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } }))
    this.onresult?.({ resultIndex, results } as unknown as RecognitionResultEventLike)
  }

  end(): void {
    this.onend?.()
  }

  error(code: string): void {
    this.onerror?.({ error: code })
  }
}

function webSetup(scope: object = { webkitSpeechRecognition: FakeRecognition }) {
  FakeRecognition.instances = []
  let now = Date.UTC(2026, 9, 18, 11, 0, 0)
  const engine = createWebSpeechEngine({ now: () => now, scope })
  const log = record(engine)
  return {
    engine,
    ...log,
    advance: (ms: number) => {
      now += ms
    },
    current: (): FakeRecognition => FakeRecognition.instances.at(-1) as FakeRecognition,
  }
}

function record(engine: SpeechEngine) {
  const results: SpeechResult[] = []
  const errors: SpeechError[] = []
  const states: SpeechState[] = []
  engine.onResult((r) => results.push(r))
  engine.onError((e) => errors.push(e))
  engine.onState((s) => states.push(s))
  return { results, errors, states }
}

describe('AC-P2-13 SpeechEngine 모양과 문장', () => {
  // D-I5-03(AC-I5-06): UNSUPPORTED·PERMISSION_DENIED·KEEPS_STOPPING 문장 교체, SERVICE_OFF·RESTART_BLOCKED 추가. 나머지는 D-205 그대로
  it('오류 문장은 D-205·D-I5-03 표 그대로, 개발 용어 없음', () => {
    expect(SPEECH_ERROR_MESSAGES).toEqual({
      UNSUPPORTED: '이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.',
      PERMISSION_DENIED: '마이크 사용이 막혀 있어요. PC·안드로이드 크롬은 주소창 왼쪽 자물쇠에서, 아이폰은 설정 > 사파리 > 마이크에서 허용해 주세요.',
      SERVICE_OFF: '이 기기에서 음성 인식이 꺼져 있어요. 아이폰은 설정에서 Siri와 받아쓰기를 켜 주세요. 그래도 안 되면 PC 크롬이나 안드로이드에서 켜 주세요.',
      RESTART_BLOCKED: "이 기기는 음성이 저절로 다시 켜지지 않아요. 말하기 전에 '음성 켜기'를 다시 눌러 주세요.",
      NO_MICROPHONE: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.',
      CONNECTION_FAILED: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
      KEEPS_STOPPING: '음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요. 계속 끊기면 PC 크롬이나 안드로이드에서 켜 주세요.',
      OTHER: '음성 인식이 멈췄어요. 다시 켜 주세요.',
    })
    // D-I5-03: 아이폰 설정 화면에 보이는 이름(PC·Siri)과 기호(>·')만 허용 — 그 밖 영어 낱말 없음
    for (const text of [...Object.values(SPEECH_ERROR_MESSAGES), ...Object.values(SPEECH_STATE_LABELS)]) expect(text.replace(/PC|Siri/g, '')).not.toMatch(/[A-Za-z]/)
    expect(SPEECH_STATE_LABELS).toEqual({ OFF: '꺼짐', LISTENING: '듣는 중', RESTARTING: '다시 시작 중', HALTED: '멈춤' })
  })
})

describe('AC-P2-13 Web Speech 어댑터', () => {
  it('SpeechRecognition 또는 webkitSpeechRecognition을 찾는다, 없으면 지원 안 함(다시 시작하지 않음)', () => {
    expect(webSetup({ SpeechRecognition: FakeRecognition }).engine.isSupported()).toBe(true)
    expect(webSetup({ webkitSpeechRecognition: FakeRecognition }).engine.isSupported()).toBe(true)
    const none = webSetup({})
    expect(none.engine.isSupported()).toBe(false)
    none.engine.start()
    expect(none.errors).toEqual([{ kind: 'UNSUPPORTED', message: SPEECH_ERROR_MESSAGES.UNSUPPORTED }])
    expect(none.engine.getState()).toBe('HALTED')
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('시작하면 ko-KR·연속·중간 결과 켬으로 한 번 시작한다, 이미 듣는 중이면 아무 일도 없다', () => {
    const t = webSetup()
    t.engine.start()
    t.engine.start()
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.current()).toMatchObject({ lang: 'ko-KR', continuous: true, interimResults: true, starts: 1 })
    expect(t.states).toEqual(['LISTENING'])
  })

  it('결과 이벤트마다 resultIndex부터 알린다 (앞뒤 공백 제거, 빈 글 없음, 같은 최종 결과는 한 번)', () => {
    const t = webSetup()
    t.engine.start()
    const r = t.current()
    r.results(0, [[' 15번 핑', false]])
    r.results(0, [[' 15번 핑크프릴 만원 ', true]])
    r.results(0, [[' 15번 핑크프릴 만원 ', true], ['  ', false]]) // 같은 최종 결과가 다시 온다
    r.results(1, [[' 15번 핑크프릴 만원 ', true], ['라울', false]])
    r.results(1, [['무시', true], ['라울 오천 원', true]])
    expect(t.results).toEqual([
      { text: '15번 핑', final: false },
      { text: '15번 핑크프릴 만원', final: true },
      { text: '라울', final: false },
      { text: '라울 오천 원', final: true },
    ])
  })

  it('판매자가 멈추지 않았는데 끝나면 다시 시작한다 (새 인식 객체, 다시 시작 중 → 듣는 중)', () => {
    const t = webSetup()
    t.engine.start()
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.current().starts).toBe(1)
    expect(t.states).toEqual(['LISTENING', 'RESTARTING', 'LISTENING'])
    // 지난 객체의 늦은 이벤트는 무시한다
    FakeRecognition.instances[0]?.results(0, [['늦은 결과', true]])
    FakeRecognition.instances[0]?.end()
    expect(t.results).toEqual([])
    expect(FakeRecognition.instances).toHaveLength(2)
  })

  /** 첫 끝을 0초에, 다음 네 끝을 1~4초에 낸다 (다섯 번 다시 시작) */
  function fiveEnds(t: ReturnType<typeof webSetup>): void {
    t.current().end()
    for (let i = 0; i < 4; i++) {
      t.advance(1_000)
      t.current().end()
    }
  }

  // D-I5-01: 빨리 끝남(연 지 2초 안)만 센다 — 6번째 끝도 연 지 1,999ms에 끝나게 바꿈(예전엔 55,999ms 들은 끝도 셌다)
  it('최종 결과 없이 60초 안에 빨리 끝난 것이 6번째가 되면 다시 시작하지 않고 "자꾸 끊김"으로 멈춘다', () => {
    const t = webSetup()
    t.engine.start()
    fiveEnds(t)
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(t.errors).toEqual([])
    t.advance(1_999) // 연 지 1,999ms = 빨리 끝남, 첫 끝에서 5,999ms 뒤 = 60초 안
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(t.errors).toEqual([{ kind: 'KEEPS_STOPPING', message: SPEECH_ERROR_MESSAGES.KEEPS_STOPPING }])
    expect(t.engine.getState()).toBe('HALTED')
  })

  // D-I5-01: 60초를 흘리는 동안 연 객체는 오래 들은 뒤 끝나 세지 않으므로, 그 끝(세지 않음) 뒤 새 객체에서 바로 빨리 끝나게 바꿈
  it('60초가 지난 끝은 세지 않는다, 최종 결과가 오면 센 것을 비운다', () => {
    const t = webSetup()
    t.engine.start()
    fiveEnds(t)
    t.advance(60_000 - 4_000) // 첫 끝에서 정확히 60초 뒤
    t.current().end() // 연 지 56초 = 조용함 → 세지 않고 다시 시작
    expect(FakeRecognition.instances).toHaveLength(7)
    t.current().end() // 연 지 0ms = 빨리 끝남, 첫 끝은 창 밖 → 창 안 5개
    expect(t.errors).toEqual([])
    expect(FakeRecognition.instances).toHaveLength(8)
    // 최종 결과 → 센 것을 비운다: 다시 다섯 번까지 다시 시작
    t.current().results(0, [['15번 만원', true]])
    for (let i = 0; i < 5; i++) t.current().end()
    expect(t.errors).toEqual([])
    t.current().end()
    expect(t.errors.map((e) => e.kind)).toEqual(['KEEPS_STOPPING'])
  })

  it('시계가 NaN이거나 뒤로 가도 6번째에서 멈춘다 (고장 난 시계로 무한 재시작 없음)', () => {
    for (const clock of [() => Number.NaN, (() => {
      let t = 1_000_000
      return () => (t -= 100_000)
    })()]) {
      FakeRecognition.instances = []
      const engine = createWebSpeechEngine({ now: clock, scope: { SpeechRecognition: FakeRecognition } })
      const errors: string[] = []
      engine.onError((e) => errors.push(e.kind))
      engine.start()
      for (let i = 0; i < 10; i++) FakeRecognition.instances.at(-1)?.end()
      expect(FakeRecognition.instances).toHaveLength(6)
      expect(errors).toEqual(['KEEPS_STOPPING'])
    }
  })

  it('빈 최종 결과는 센 것을 비우지 않는다', () => {
    const t = webSetup()
    t.engine.start()
    fiveEnds(t)
    t.current().results(0, [['   ', true]])
    t.current().end()
    expect(t.errors.map((e) => e.kind)).toEqual(['KEEPS_STOPPING'])
  })

  it('끝·오류 순서 조합: 시간이 흐르지 않는 끝없는 끝남도 6번째에서 멈춘다 (무한 재시작 없음)', () => {
    const t = webSetup()
    t.engine.start()
    const codes = ['network', 'no-speech', 'aborted']
    for (let i = 0; i < 20; i++) {
      t.current().error(codes[i % 3] as string)
      t.current().end()
    }
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(t.errors.map((e) => e.kind)).toEqual(['KEEPS_STOPPING'])
  })

  it.each([
    ['not-allowed', 'PERMISSION_DENIED'],
    ['service-not-allowed', 'SERVICE_OFF'], // D-I5-03: 예전엔 PERMISSION_DENIED
    ['audio-capture', 'NO_MICROPHONE'],
    ['language-not-supported', 'OTHER'],
    ['알 수 없음', 'OTHER'],
  ])('%s → %s, 다시 시작하지 않는다 (이어 오는 끝도 무시)', (code, kind) => {
    const t = webSetup()
    t.engine.start()
    const r = t.current()
    r.error(code)
    r.end()
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(r.aborts).toBe(1)
    expect(t.errors).toEqual([{ kind, message: SPEECH_ERROR_MESSAGES[kind as keyof typeof SPEECH_ERROR_MESSAGES] }])
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('멈춤 뒤엔 다시 시작하지 않는다 (늦게 온 끝·결과도 무시)', () => {
    const t = webSetup()
    t.engine.start()
    const r = t.current()
    t.engine.stop()
    expect(r.stops).toBe(1)
    r.results(0, [['늦은 결과', true]])
    r.end()
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.results).toEqual([])
    expect(t.engine.getState()).toBe('OFF')
    expect(t.states).toEqual(['LISTENING', 'OFF'])
  })

  it('멈춘 뒤 다시 켜면 새로 시작하고 센 것도 처음부터', () => {
    const t = webSetup()
    t.engine.start()
    for (let i = 0; i < 5; i++) t.current().end()
    t.engine.stop()
    t.engine.start()
    for (let i = 0; i < 5; i++) t.current().end()
    expect(t.errors).toEqual([])
    expect(t.engine.getState()).toBe('LISTENING')
  })

  it('인식 객체 start()가 예외를 던지면 "그 밖" 오류로 멈춘다', () => {
    class Throwing extends FakeRecognition {
      override start(): void {
        throw new Error('InvalidStateError')
      }
    }
    const t = webSetup({ SpeechRecognition: Throwing })
    t.engine.start()
    expect(t.errors.map((e) => e.kind)).toEqual(['OTHER'])
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('듣는 쪽이 예외를 던져도 엔진은 계속 돈다, 듣기 그만두기 함수', () => {
    const t = webSetup()
    const off = t.engine.onResult(() => {
      throw new Error('화면 오류')
    })
    t.engine.start()
    t.current().results(0, [['15번', true]])
    expect(t.results).toEqual([{ text: '15번', final: true }])
    off()
    t.current().end()
    expect(t.engine.getState()).toBe('LISTENING')
  })

  it('시계 함수 없이 만들 수 없다', () => {
    expect(() => createWebSpeechEngine({} as never)).toThrow(TypeError)
  })
})

// ── 클라우드 골격 ────────────────────────────────────────────────────────

/** 공급자 응답 표본 (공급자 문서의 형식 — 출처는 dev-notes) */
const DEEPGRAM = {
  interim: JSON.stringify({ type: 'Results', channel_index: [0, 1], duration: 1.2, start: 0, is_final: false, speech_final: false, channel: { alternatives: [{ transcript: '십오 번', confidence: 0.8, words: [] }] } }),
  final: JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: ' 15번 핑크프릴 만원 ', confidence: 0.97 }] }, metadata: { request_id: 'x' } }),
  empty: JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: '' }] } }),
  metadata: JSON.stringify({ type: 'Metadata', request_id: 'x', duration: 3 }),
  speechStarted: JSON.stringify({ type: 'SpeechStarted', timestamp: 1.5 }),
  utteranceEnd: JSON.stringify({ type: 'UtteranceEnd', last_word_end: 2.1 }),
}
const RETURN_ZERO = {
  interim: JSON.stringify({ seq: 0, start_at: 0, duration: 800, final: false, alternatives: [{ text: '십오 번 핑', confidence: 0.7 }] }),
  final: JSON.stringify({ seq: 1, start_at: 0, duration: 2100, final: true, alternatives: [{ text: '15번 핑크프릴 만원', confidence: 0.95, words: [] }] }),
  empty: JSON.stringify({ seq: 2, final: true, alternatives: [{ text: '   ' }] }),
}

describe('AC-P2-14 공급자 응답 → { text, final }', () => {
  it('Deepgram', () => {
    expect(parseDeepgramMessage(DEEPGRAM.interim)).toEqual({ text: '십오 번', final: false })
    expect(parseDeepgramMessage(DEEPGRAM.final)).toEqual({ text: '15번 핑크프릴 만원', final: true })
    expect(parseDeepgramMessage(JSON.parse(DEEPGRAM.final))).toEqual({ text: '15번 핑크프릴 만원', final: true })
    for (const message of [DEEPGRAM.empty, DEEPGRAM.metadata, DEEPGRAM.speechStarted, DEEPGRAM.utteranceEnd]) expect(parseDeepgramMessage(message)).toBe(null)
  })

  it('리턴제로', () => {
    expect(parseReturnZeroMessage(RETURN_ZERO.interim)).toEqual({ text: '십오 번 핑', final: false })
    expect(parseReturnZeroMessage(RETURN_ZERO.final)).toEqual({ text: '15번 핑크프릴 만원', final: true })
    expect(parseReturnZeroMessage(RETURN_ZERO.empty)).toBe(null)
  })

  it.each([
    '{',
    'null',
    '[]',
    '"글"',
    '{"type":"Results"}',
    '{"type":"Results","channel":{"alternatives":"x"}}',
    '{"alternatives":[null]}',
    '{"alternatives":[{"text":5}]}',
    new Uint8Array([1, 2, 3]),
    null,
    undefined,
    42,
  ])('모르는 형식 %s → 알리지 않고 예외도 없다', (message) => {
    expect(() => parseDeepgramMessage(message)).not.toThrow()
    expect(() => parseReturnZeroMessage(message)).not.toThrow()
    expect(parseDeepgramMessage(message)).toBe(null)
    expect(parseReturnZeroMessage(message)).toBe(null)
  })
})

/** 가짜 서버 중계 */
function relaySetup(create = createDeepgramEngine) {
  const connections: { handlers: RelayHandlers; sent: unknown[]; closed: number }[] = []
  let failNext = 0
  const connect = vi.fn((handlers: RelayHandlers) => {
    if (failNext > 0) {
      failNext--
      throw new Error('연결 실패')
    }
    const connection = { handlers, sent: [] as unknown[], closed: 0 }
    connections.push(connection)
    return { send: (data: unknown) => connection.sent.push(data), close: () => connection.closed++ }
  })
  let now = Date.UTC(2026, 9, 18, 11, 0, 0)
  const engine = create({ connect, now: () => now })
  return {
    engine,
    connect,
    connections,
    ...record(engine),
    failNextConnects: (n: number) => {
      failNext = n
    },
    advance: (ms: number) => {
      now += ms
    },
    last: () => connections.at(-1) as (typeof connections)[number],
  }
}

describe('AC-P2-14 클라우드 엔진 골격 (Deepgram·리턴제로)', () => {
  it('시작 = 연결, 음성 조각 보내기 = 그대로 전달, 멈춤 = 닫기', () => {
    const t = relaySetup()
    expect(t.engine.isSupported()).toBe(true)
    t.engine.start()
    expect(t.connect).toHaveBeenCalledTimes(1)
    const chunk = new Uint8Array([1, 2, 3])
    t.engine.sendAudio(chunk)
    expect(t.last().sent).toEqual([chunk])
    expect(t.last().sent[0]).toBe(chunk)
    t.last().handlers.onMessage(DEEPGRAM.final)
    t.last().handlers.onMessage(DEEPGRAM.metadata)
    expect(t.results).toEqual([{ text: '15번 핑크프릴 만원', final: true }])
    t.engine.stop()
    expect(t.last().closed).toBe(1)
    t.engine.sendAudio(chunk)
    expect(t.last().sent).toHaveLength(1)
    expect(t.engine.getState()).toBe('OFF')
    // 멈춘 뒤의 늦은 알림은 무시, 다시 연결하지 않는다
    t.last().handlers.onMessage(DEEPGRAM.final)
    t.last().handlers.onClose()
    expect(t.connect).toHaveBeenCalledTimes(1)
    expect(t.results).toHaveLength(1)
  })

  it('리턴제로 엔진도 같은 골격', () => {
    const t = relaySetup(createReturnZeroEngine)
    t.engine.start()
    t.last().handlers.onMessage(RETURN_ZERO.interim)
    t.last().handlers.onMessage(RETURN_ZERO.final)
    expect(t.engine.kind).toBe('returnzero')
    expect(t.results).toEqual([
      { text: '십오 번 핑', final: false },
      { text: '15번 핑크프릴 만원', final: true },
    ])
  })

  it('끊기면 한도 안에서 다시 연결하고, 6번째면 "연결 실패"로 멈춘다 (닫힘·오류가 같이 와도 한 번으로 센다)', () => {
    const t = relaySetup()
    t.engine.start()
    for (let i = 0; i < 5; i++) {
      const connection = t.last()
      connection.handlers.onError()
      connection.handlers.onClose() // 같은 연결의 닫힘 — 다시 세지 않는다
      expect(connection.closed).toBe(1)
    }
    expect(t.connect).toHaveBeenCalledTimes(6)
    expect(t.errors).toEqual([])
    t.last().handlers.onClose()
    expect(t.connect).toHaveBeenCalledTimes(6)
    expect(t.errors).toEqual([{ kind: 'CONNECTION_FAILED', message: SPEECH_ERROR_MESSAGES.CONNECTION_FAILED }])
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('연결 함수가 예외를 던져도 같은 한도 — 무한 재시도 없음', () => {
    const t = relaySetup()
    t.failNextConnects(100)
    t.engine.start()
    expect(t.connect).toHaveBeenCalledTimes(6)
    expect(t.errors.map((e) => e.kind)).toEqual(['CONNECTION_FAILED'])
  })

  it('최종 결과가 오면 센 것을 비운다', () => {
    const t = relaySetup()
    t.engine.start()
    for (let i = 0; i < 5; i++) t.last().handlers.onClose()
    t.last().handlers.onMessage(RETURN_ZERO.final.replace('"final":true', '"final":false'))
    t.last().handlers.onMessage(DEEPGRAM.final)
    for (let i = 0; i < 5; i++) t.last().handlers.onClose()
    expect(t.errors).toEqual([])
  })

  it('연결 함수가 안에서 바로 닫힘을 알려도 돌려받은 연결을 쓰지 않는다', () => {
    let calls = 0
    const engine = createDeepgramEngine({
      now: () => 0,
      connect: (handlers) => {
        calls++
        if (calls === 1) handlers.onClose()
        return { send: () => undefined, close: () => undefined }
      },
    })
    engine.start()
    expect(calls).toBe(2)
    expect(engine.getState()).toBe('LISTENING')
  })

  it('키·주소를 받는 옵션이 없다 — 연결 함수와 시계만', () => {
    expect(() => createDeepgramEngine({ now: () => 0 } as never)).toThrow(TypeError)
    expect(() => createReturnZeroEngine({ connect: () => ({ send: () => undefined, close: () => undefined }) } as never)).toThrow(TypeError)
  })
})

describe('AC-P2-15 끄기: 만들기만 해서는 인식·연결·마이크를 열지 않는다', () => {
  it('엔진을 만들고 지원 여부를 물어도 인식 객체·연결·getUserMedia를 부르지 않는다 — start()에서만', () => {
    const getUserMedia = vi.fn()
    const Recognition = vi.fn(FakeRecognition)
    const scope = { SpeechRecognition: Recognition, navigator: { mediaDevices: { getUserMedia } } }
    const connect = vi.fn(() => ({ send: () => undefined, close: () => undefined }))
    const web = createWebSpeechEngine({ now: () => 0, scope })
    const deepgram = createDeepgramEngine({ connect, now: () => 0 })
    const returnZero = createReturnZeroEngine({ connect, now: () => 0 })
    web.isSupported()
    deepgram.isSupported()
    returnZero.isSupported()
    for (const engine of [web, deepgram, returnZero]) expect(engine.getState()).toBe('OFF')
    expect(Recognition).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    web.start()
    expect(Recognition).toHaveBeenCalledTimes(1)
    deepgram.start()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('기본 scope(globalThis)도 만들 때는 보지 않는다', () => {
    const g = globalThis as { webkitSpeechRecognition?: unknown }
    const before = g.webkitSpeechRecognition
    let touched = 0
    Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
      configurable: true,
      get: () => {
        touched++
        return undefined
      },
    })
    try {
      const engine = createWebSpeechEngine({ now: () => 0 })
      expect(touched).toBe(0)
      expect(engine.isSupported()).toBe(false)
      expect(touched).toBeGreaterThan(0)
    } finally {
      Object.defineProperty(globalThis, 'webkitSpeechRecognition', { configurable: true, writable: true, value: before })
      delete g.webkitSpeechRecognition
    }
  })
})
