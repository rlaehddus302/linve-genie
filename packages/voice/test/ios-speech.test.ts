// AC-I5-01~06 아이폰(사파리) 음성 엔진 (VOC-01·VOC-04, D-I5-01~03, D-036). 가짜 인식 생성자 + 넣은 시계로 돈다.
import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  FAST_END_MS,
  MAX_AUTO_ENDS,
  RESTART_WINDOW_MS,
  SPEECH_ERROR_MESSAGES,
  RestartLimiter,
  checkAutoConfirm,
  confirmCard,
  createCard,
  createWebSpeechEngine,
  extractVoice,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type SpeechError,
  type SpeechResult,
  type SpeechState,
} from '../src/index.ts'

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

const T0 = Date.UTC(2026, 9, 23, 11, 0, 0)

function setup(scope: object = { webkitSpeechRecognition: FakeRecognition }, clock?: () => number) {
  FakeRecognition.instances = []
  let now = T0
  const engine = createWebSpeechEngine({ now: clock ?? (() => now), scope })
  const results: SpeechResult[] = []
  const errors: SpeechError[] = []
  const states: SpeechState[] = []
  engine.onResult((r) => results.push(r))
  engine.onError((e) => errors.push(e))
  engine.onState((s) => states.push(s))
  return {
    engine,
    results,
    errors,
    states,
    advance: (ms: number) => {
      now += ms
    },
    current: (): FakeRecognition => FakeRecognition.instances.at(-1) as FakeRecognition,
  }
}

describe('AC-I5-01 빨리 끝남만 센다 (D-I5-01)', () => {
  it('상수: 2초·60초·6번', () => {
    expect(FAST_END_MS).toBe(2_000)
    expect(RESTART_WINDOW_MS).toBe(60_000)
    expect(MAX_AUTO_ENDS).toBe(6)
  })

  it('열린 뒤 1,999ms에 끝남이 연달아 오면 1~5번째는 다시 열고, 6번째에서 멈춘다', () => {
    const t = setup()
    t.engine.start()
    for (let n = 1; n <= 5; n++) {
      t.advance(1_999)
      t.current().end()
      expect(FakeRecognition.instances).toHaveLength(n + 1)
      expect(t.engine.getState()).toBe('LISTENING')
    }
    expect(t.states).toEqual(['LISTENING', ...Array.from({ length: 5 }, () => ['RESTARTING', 'LISTENING']).flat()])
    expect(t.errors).toEqual([])
    t.advance(1_999)
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(t.errors).toEqual([{ kind: 'KEEPS_STOPPING', message: SPEECH_ERROR_MESSAGES.KEEPS_STOPPING }])
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('6번째 끝남 직전에 최종 결과가 오면 센 것이 비워져 멈추지 않는다', () => {
    const t = setup()
    t.engine.start()
    for (let n = 1; n <= 5; n++) {
      t.advance(1_999)
      t.current().end()
    }
    t.advance(1_000)
    t.current().results(0, [['15번 핑크프릴 만오천원', true]])
    t.advance(999)
    t.current().end()
    expect(t.errors).toEqual([])
    expect(FakeRecognition.instances).toHaveLength(7)
    expect(t.engine.getState()).toBe('LISTENING')
  })

  it('시계가 NaN이거나 뒤로 가면 그 끝남은 빨리 끝남으로 센다', () => {
    let back = T0 + 10_000_000
    for (const clock of [() => Number.NaN, () => (back -= 10_000)]) {
      const t = setup({ webkitSpeechRecognition: FakeRecognition }, clock)
      t.engine.start()
      for (let i = 0; i < 10; i++) t.current().end()
      expect(FakeRecognition.instances).toHaveLength(6)
      expect(t.errors.map((e) => e.kind)).toEqual(['KEEPS_STOPPING'])
    }
  })

  it('RestartLimiter: 연 시각을 주면 2초 미만만 세고, 주지 않으면 예전처럼 모두 센다', () => {
    let now = T0
    const limiter = new RestartLimiter(() => now)
    for (let i = 0; i < 100; i++) {
      const opened = now
      now += 2_000
      expect(limiter.recordEnd(opened)).toBe(true)
    }
    const plain = new RestartLimiter(() => now)
    const answers = Array.from({ length: 6 }, () => plain.recordEnd())
    expect(answers).toEqual([true, true, true, true, true, false])
  })
})

describe('AC-I5-02 조용함으로 끝난 것은 세지 않는다 (D-I5-01)', () => {
  it.each([2_000, 3_000])('열린 뒤 %ims에 끝남 100번: 모두 다시 열고 오류 없음, 그 뒤 stop()이면 꺼짐', (ms) => {
    const t = setup()
    t.engine.start()
    for (let i = 0; i < 100; i++) {
      t.advance(ms)
      t.current().end()
      expect(t.engine.getState()).not.toBe('HALTED')
    }
    expect(FakeRecognition.instances).toHaveLength(101)
    expect(t.errors).toEqual([])
    t.engine.stop()
    expect(t.engine.getState()).toBe('OFF')
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(101)
  })
})

describe('AC-I5-03 끝날 때 남은 중간 결과를 한 번 넘긴다 (D-I5-02)', () => {
  const TEXT = '15번 핑크프릴 만오천원'

  it('(a) 중간 결과 뒤 저절로 끝나면 최종·끝에서 넘김으로 한 번 넘기고 다시 시작한다', () => {
    const t = setup()
    t.engine.start()
    const first = t.current()
    first.results(0, [[TEXT, false]])
    t.advance(3_000)
    first.end()
    expect(t.results).toEqual([
      { text: TEXT, final: false },
      { text: TEXT, final: true, flushedAtEnd: true },
    ])
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.engine.getState()).toBe('LISTENING')
    // 지난 객체의 늦은 이벤트는 무시한다 (두 번 넘기지 않는다)
    first.results(0, [[TEXT, true]])
    first.end()
    expect(t.results).toHaveLength(2)
    expect(FakeRecognition.instances).toHaveLength(2)
  })

  it('넘김은 그 객체의 마지막 중간 결과 글이다 (앞 위치가 최종으로 왔어도 뒤 위치 중간 결과를 넘긴다)', () => {
    const t = setup()
    t.engine.start()
    t.current().results(0, [['라울 오천원', true], ['15번 핑크', false]])
    t.current().results(1, [['라울 오천원', true], [TEXT, false]])
    t.current().end()
    expect(t.results.filter((r) => r.final)).toEqual([
      { text: '라울 오천원', final: true },
      { text: TEXT, final: true, flushedAtEnd: true },
    ])
  })

  it('(b) 최종으로 온 뒤 끝나면 추가 결과 없음 (표시는 거짓)', () => {
    const t = setup()
    t.engine.start()
    t.current().results(0, [[TEXT, false]])
    t.current().results(0, [[TEXT, true]])
    t.current().end()
    expect(t.results).toEqual([
      { text: TEXT, final: false },
      { text: TEXT, final: true },
    ])
    expect(t.results.every((r) => r.flushedAtEnd !== true)).toBe(true)
    expect(FakeRecognition.instances).toHaveLength(2)
  })

  it('같은 위치가 이미 최종으로 왔으면 그 위치의 늦은 중간 결과를 넘기지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.current().results(0, [[TEXT, true]])
    t.current().results(0, [[TEXT, false]])
    t.current().end()
    expect(t.results.filter((r) => r.final)).toEqual([{ text: TEXT, final: true }])
  })

  it('(c) 중간 결과 뒤 판매자가 stop()하면 넘기지 않는다', () => {
    const t = setup()
    t.engine.start()
    const r = t.current()
    r.results(0, [[TEXT, false]])
    t.engine.stop()
    r.end()
    expect(t.results).toEqual([{ text: TEXT, final: false }])
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it.each(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])('(d) 중간 결과 뒤 멈추는 오류(%s)면 넘기지 않는다', (code) => {
    const t = setup()
    t.engine.start()
    const r = t.current()
    r.results(0, [[TEXT, false]])
    r.error(code)
    r.end()
    expect(t.results).toEqual([{ text: TEXT, final: false }])
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('(e) 마지막 중간 결과가 공백뿐이면 넘기지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.current().results(0, [[TEXT, false]])
    t.current().results(0, [['   ', false]])
    t.current().end()
    expect(t.results).toEqual([{ text: TEXT, final: false }])
    expect(FakeRecognition.instances).toHaveLength(2)
  })

  it('다시 시작하는 오류(no-speech 등) 뒤 끝나면 저절로 끝난 것이라 넘긴다', () => {
    const t = setup()
    t.engine.start()
    t.current().results(0, [[TEXT, false]])
    t.current().error('no-speech')
    t.current().end()
    expect(t.results.at(-1)).toEqual({ text: TEXT, final: true, flushedAtEnd: true })
  })

  it('넘긴 결과는 다시 시작 한도의 센 것을 비운다', () => {
    const t = setup()
    t.engine.start()
    for (let i = 0; i < 5; i++) t.current().end()
    t.current().results(0, [[TEXT, false]])
    t.current().end() // 넘김 → 비움 → 이 끝이 1번째
    expect(t.errors).toEqual([])
    for (let i = 0; i < 4; i++) t.current().end()
    expect(t.errors).toEqual([])
    t.current().end()
    expect(t.errors.map((e) => e.kind)).toEqual(['KEEPS_STOPPING'])
  })

  it('넘긴 결과를 받은 쪽이 stop()하면 다시 시작하지 않는다', () => {
    const t = setup()
    t.engine.onResult((r) => {
      if (r.flushedAtEnd === true) t.engine.stop()
    })
    t.engine.start()
    t.current().results(0, [[TEXT, false]])
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.engine.getState()).toBe('OFF')
  })
})

describe('AC-I5-04 넘긴 문장 카드는 자동 확정하지 않는다 (D-I5-02, VOC-04)', () => {
  const TEXT = '15번 핑크프릴 만오천원'
  const settings = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } as const
  const extraction = extractVoice(TEXT, { dictionary: ['핑크프릴'] })

  it('추출 신뢰도 HIGH여도 자동 확정 시각이 없고 30초 뒤에도 due가 아니다, "등록"은 된다', () => {
    expect(extraction.confidence).toBe('HIGH')
    const card = createCard({ id: 'c1', extraction, text: TEXT, createdAt: T0, settings, flushedAtEnd: true })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(card.autoConfirmAt).toBeNull()
    expect(card.flushedAtEnd).toBe(true)
    expect(card.touched).toBe(false)
    expect(checkAutoConfirm(card, { settings, now: T0 + 30_000, existingNumbers: [] }).due).toBe(false)
    // 시각을 억지로 넣어도 끝에서 넘긴 카드는 자동 확정하지 않는다
    expect(checkAutoConfirm({ ...card, autoConfirmAt: T0 }, { settings, now: T0 + 30_000, existingNumbers: [] }).due).toBe(false)
    const confirmed = confirmCard(card, { existingNumbers: [] })
    expect(confirmed.ok).toBe(true)
    if (confirmed.ok) expect(confirmed.registration).toEqual({ no: 15, name: '핑크프릴', price: 15_000 })
  })

  it('같은 문장이 보통 최종 결과면 I4대로 5초 뒤 자동 확정한다 (표시 없음)', () => {
    const card = createCard({ id: 'c2', extraction, text: TEXT, createdAt: T0, settings })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(card.autoConfirmAt).toBe(T0 + 5_000)
    expect('flushedAtEnd' in card).toBe(false)
    expect(checkAutoConfirm(card, { settings, now: T0 + 5_000, existingNumbers: [] }).due).toBe(true)
    expect(createCard({ id: 'c3', extraction, text: TEXT, createdAt: T0, settings, flushedAtEnd: false })?.autoConfirmAt).toBe(T0 + 5_000)
  })
})

describe('AC-I5-05 오류 종류 나누기 (D-I5-03)', () => {
  it.each([
    ['not-allowed', 'PERMISSION_DENIED'],
    ['service-not-allowed', 'SERVICE_OFF'],
    ['audio-capture', 'NO_MICROPHONE'],
  ])('판매자의 start()가 연 객체에서 %s → %s', (code, kind) => {
    const t = setup()
    t.engine.start()
    t.current().error(code)
    t.current().end()
    expect(t.errors).toEqual([{ kind, message: SPEECH_ERROR_MESSAGES[kind as keyof typeof SPEECH_ERROR_MESSAGES] }])
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.engine.getState()).toBe('HALTED')
  })

  it.each([
    ['not-allowed', 'RESTART_BLOCKED'],
    ['service-not-allowed', 'RESTART_BLOCKED'],
    ['audio-capture', 'NO_MICROPHONE'],
  ])('저절로 끝난 뒤 엔진이 연 객체에서 %s → %s, 다시 start()하면 처음 켤 때로 본다', (code, kind) => {
    const t = setup()
    t.engine.start()
    t.advance(3_000)
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(2)
    t.current().error(code)
    t.current().end()
    expect(t.errors.map((e) => e.kind)).toEqual([kind])
    expect(t.errors[0]?.message).toBe(SPEECH_ERROR_MESSAGES[kind as keyof typeof SPEECH_ERROR_MESSAGES])
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.engine.getState()).toBe('HALTED')
    t.engine.start()
    expect(FakeRecognition.instances).toHaveLength(3)
    expect(t.engine.getState()).toBe('LISTENING')
    t.current().error(code)
    expect(t.errors.map((e) => e.kind).at(-1)).toBe(code === 'not-allowed' ? 'PERMISSION_DENIED' : code === 'service-not-allowed' ? 'SERVICE_OFF' : 'NO_MICROPHONE')
  })

  it('생성자가 없으면 UNSUPPORTED, 인식 객체를 만들지 않는다', () => {
    const t = setup({})
    expect(t.engine.isSupported()).toBe(false)
    t.engine.start()
    expect(t.errors).toEqual([{ kind: 'UNSUPPORTED', message: SPEECH_ERROR_MESSAGES.UNSUPPORTED }])
    expect(FakeRecognition.instances).toHaveLength(0)
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('webkitSpeechRecognition만 있는 곳(사파리)에서도 ko-KR·연속으로 연다', () => {
    const t = setup({ SpeechRecognition: undefined, webkitSpeechRecognition: FakeRecognition })
    expect(t.engine.isSupported()).toBe(true)
    t.engine.start()
    expect(t.current()).toMatchObject({ lang: 'ko-KR', continuous: true, interimResults: true, starts: 1 })
  })
})

describe('AC-I5-06·AC-I5-28 오류 문장 표 · UA를 읽지 않는다 (D-I5-03·D-I5-12·D-I5-13, D-036)', () => {
  it('다섯 문장이 글자 그대로', () => {
    expect(SPEECH_ERROR_MESSAGES.UNSUPPORTED).toBe('이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.')
    // D-I5-12: 권한·Siri 문장은 첫 줄(무슨 일) + 기기별 줄
    expect(SPEECH_ERROR_MESSAGES.PERMISSION_DENIED).toBe('마이크 사용이 막혀 있어요.\n· PC·안드로이드 크롬: 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.\n· 아이폰: 설정 > 사파리 > 마이크에서 허용해 주세요.')
    expect(SPEECH_ERROR_MESSAGES.SERVICE_OFF).toBe('이 기기에서 음성 인식이 꺼져 있어요.\n· 아이폰: 설정에서 Siri와 받아쓰기를 켜 주세요.\n· 그래도 안 되면 PC 크롬이나 안드로이드에서 켜 주세요.')
    // D-I5-13: 빠른 입력을 권하는 줄
    expect(SPEECH_ERROR_MESSAGES.RESTART_BLOCKED).toBe("이 기기는 음성이 저절로 다시 켜지지 않아요. 말하기 전에 '음성 켜기'를 다시 눌러 주세요.\n상품이 많으면 빠른 입력이 더 빨라요.")
    expect(SPEECH_ERROR_MESSAGES.KEEPS_STOPPING).toBe('음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요. 계속 끊기면 PC 크롬이나 안드로이드에서 켜 주세요.')
    expect(SPEECH_ERROR_MESSAGES.NO_MICROPHONE).toBe('마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.')
    expect(SPEECH_ERROR_MESSAGES.CONNECTION_FAILED).toBe('음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
    expect(SPEECH_ERROR_MESSAGES.OTHER).toBe('음성 인식이 멈췄어요. 다시 켜 주세요.')
  })

  it('packages/voice/src에 userAgent·userAgentData를 읽는 코드가 없다', async () => {
    const dir = new URL('../src/', import.meta.url)
    const files = (await readdir(dir)).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const source = await readFile(new URL(name, dir), 'utf8')
      expect(source, name).not.toMatch(/userAgent/)
    }
  })
})

describe('AC-I5-29 센 끝남 뒤에만 "다시 시작 중" (D-I5-14)', () => {
  it('(a) 연 지 3,000ms에 결과 없이 끝나면 RESTARTING 없이 LISTENING 그대로 새 객체를 연다', () => {
    const t = setup()
    t.engine.start()
    for (let i = 0; i < 10; i++) {
      t.advance(3_000)
      t.current().end()
    }
    expect(FakeRecognition.instances).toHaveLength(11)
    expect(t.states).toEqual(['LISTENING'])
    expect(t.engine.getState()).toBe('LISTENING')
  })

  it('(b) 연 지 0ms 끝남(빨리 끝남)은 RESTARTING을 알리고 LISTENING이 된다', () => {
    const t = setup()
    t.engine.start()
    t.current().end()
    expect(t.states).toEqual(['LISTENING', 'RESTARTING', 'LISTENING'])
  })

  it('(c) 연 지 3,000ms에 network 뒤 끝남은 RESTARTING을 알린다', () => {
    const t = setup()
    t.engine.start()
    t.advance(3_000)
    t.current().error('network')
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.states).toEqual(['LISTENING', 'RESTARTING', 'LISTENING'])
  })
})

describe('AC-I5-32 network 뒤 끝남은 세고 CONNECTION_FAILED로 멈춘다 (D-I5-17)', () => {
  function networkEnd(t: ReturnType<typeof setup>): void {
    t.advance(3_000)
    t.current().error('network')
    t.current().end()
  }

  it('연 지 3,000ms에 network+끝남이 이어지면 1~5번째는 다시 열고 6번째에 CONNECTION_FAILED·HALTED', () => {
    const t = setup()
    t.engine.start()
    for (let n = 1; n <= 5; n++) {
      networkEnd(t)
      expect(FakeRecognition.instances).toHaveLength(n + 1)
      expect(t.errors).toEqual([])
    }
    networkEnd(t)
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(t.errors).toEqual([{ kind: 'CONNECTION_FAILED', message: SPEECH_ERROR_MESSAGES.CONNECTION_FAILED }])
    expect(t.engine.getState()).toBe('HALTED')
  })

  it('사이에 최종 결과가 오면 센 것을 비운다', () => {
    const t = setup()
    t.engine.start()
    for (let n = 1; n <= 5; n++) networkEnd(t)
    t.current().results(0, [['15번 핑크프릴 만오천원', true]])
    networkEnd(t)
    expect(t.errors).toEqual([])
    expect(FakeRecognition.instances).toHaveLength(7)
  })

  it.each(['no-speech', 'aborted'])('%s 뒤 연 지 3,000ms 끝남 100번은 모두 다시 열고 오류 없음 (D-I5-01 그대로)', (code) => {
    const t = setup()
    t.engine.start()
    for (let i = 0; i < 100; i++) {
      t.advance(3_000)
      t.current().error(code)
      t.current().end()
    }
    expect(FakeRecognition.instances).toHaveLength(101)
    expect(t.errors).toEqual([])
  })

  it('앞 다섯은 network, 여섯째는 연 지 0ms 빈 끝남이면 KEEPS_STOPPING', () => {
    const t = setup()
    t.engine.start()
    for (let n = 1; n <= 5; n++) networkEnd(t)
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(t.errors).toEqual([{ kind: 'KEEPS_STOPPING', message: SPEECH_ERROR_MESSAGES.KEEPS_STOPPING }])
  })

  it('network 표시는 그 객체에만 — 다음 객체가 조용히 끝나면 세지 않는다', () => {
    const t = setup()
    t.engine.start()
    networkEnd(t)
    for (let i = 0; i < 20; i++) {
      t.advance(3_000)
      t.current().end()
    }
    expect(t.errors).toEqual([])
    expect(FakeRecognition.instances).toHaveLength(22)
  })
})

describe('AC-I5-33 모든 끝남 세기 (D-I5-18)', () => {
  it('켜면 연 지 3,000ms 끝남도 세어 6번째에 KEEPS_STOPPING, 다시 열 때 RESTARTING을 알린다', () => {
    FakeRecognition.instances = []
    let now = T0
    const engine = createWebSpeechEngine({ now: () => now, scope: { webkitSpeechRecognition: FakeRecognition }, countAllEnds: true })
    const errors: SpeechError[] = []
    const states: SpeechState[] = []
    engine.onError((e) => errors.push(e))
    engine.onState((s) => states.push(s))
    engine.start()
    for (let n = 1; n <= 5; n++) {
      now += 3_000
      FakeRecognition.instances.at(-1)?.end()
      expect(FakeRecognition.instances).toHaveLength(n + 1)
    }
    expect(states).toEqual(['LISTENING', ...Array.from({ length: 5 }, () => ['RESTARTING', 'LISTENING']).flat()])
    now += 3_000
    FakeRecognition.instances.at(-1)?.end()
    expect(FakeRecognition.instances).toHaveLength(6)
    expect(errors).toEqual([{ kind: 'KEEPS_STOPPING', message: SPEECH_ERROR_MESSAGES.KEEPS_STOPPING }])
    expect(engine.getState()).toBe('HALTED')
  })

  it('켜도 network 뒤 6번째면 CONNECTION_FAILED', () => {
    FakeRecognition.instances = []
    let now = T0
    const engine = createWebSpeechEngine({ now: () => now, scope: { webkitSpeechRecognition: FakeRecognition }, countAllEnds: true })
    const errors: SpeechError[] = []
    engine.onError((e) => errors.push(e))
    engine.start()
    for (let n = 1; n <= 6; n++) {
      now += 3_000
      FakeRecognition.instances.at(-1)?.error('network')
      FakeRecognition.instances.at(-1)?.end()
    }
    expect(errors.map((e) => e.kind)).toEqual(['CONNECTION_FAILED'])
  })

  it('끄면(기본·false) 연 지 3,000ms 끝남은 세지 않는다', () => {
    for (const countAllEnds of [undefined, false]) {
      FakeRecognition.instances = []
      let now = T0
      const engine = createWebSpeechEngine({ now: () => now, scope: { webkitSpeechRecognition: FakeRecognition }, ...(countAllEnds === undefined ? {} : { countAllEnds }) })
      const errors: SpeechError[] = []
      engine.onError((e) => errors.push(e))
      engine.start()
      for (let i = 0; i < 30; i++) {
        now += 3_000
        FakeRecognition.instances.at(-1)?.end()
      }
      expect(errors).toEqual([])
      expect(FakeRecognition.instances).toHaveLength(31)
    }
  })
})
