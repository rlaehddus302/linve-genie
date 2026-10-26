// V3 실방송 보강: 인식 끊김 재기 · 쉬는 틈 다시 열기 · 빠른 다시 열기(InvalidStateError 다시 해 보기) · 겹쳐 열기(실험, 기본 끔) · 기기 안 인식 확인.
// 가짜 인식 생성자 + 넣은 시계·타이머로 돈다 (실기기 없음).
import { describe, expect, it } from 'vitest'
import {
  MAX_AUTO_ENDS,
  OVERLAP_PLANNED_RESTART,
  PLANNED_END_WAIT_MS,
  PLANNED_RESTART_AFTER_MS,
  START_RETRY_MAX,
  START_RETRY_MS,
  createWebSpeechEngine,
  formatSpeechGap,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type SpeechError,
  type SpeechGap,
  type SpeechResult,
  type SpeechState,
} from '../src/index.ts'

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = []
  /** 다음 start()들이 던질 오류 (앞에서부터 하나씩) */
  static throwOnStart: unknown[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: RecognitionLike['onresult'] = null
  onerror: RecognitionLike['onerror'] = null
  onend: RecognitionLike['onend'] = null
  onstart: RecognitionLike['onstart'] = null
  onaudiostart: RecognitionLike['onaudiostart'] = null
  onaudioend: RecognitionLike['onaudioend'] = null
  starts = 0
  stops = 0
  aborts = 0

  constructor() {
    FakeRecognition.instances.push(this)
  }

  start(): void {
    const error = FakeRecognition.throwOnStart.shift()
    if (error !== undefined) throw error
    this.starts++
  }

  stop(): void {
    this.stops++
  }

  abort(): void {
    this.aborts++
  }

  results(resultIndex: number, items: readonly (readonly [string, boolean])[]): void {
    // 앞자리(resultIndex 전)는 이미 받은 최종 — 크롬처럼 결과 목록 전체를 넘긴다
    const before = Array.from({ length: resultIndex }, () => ({ isFinal: true, length: 1, 0: { transcript: '' } }))
    const results = [...before, ...items.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } }))]
    this.onresult?.({ resultIndex, results } as unknown as RecognitionResultEventLike)
  }

  audioStart(): void {
    this.onaudiostart?.()
  }

  audioEnd(): void {
    this.onaudioend?.()
  }

  end(): void {
    this.onend?.()
  }

  error(code: string): void {
    this.onerror?.({ error: code })
  }
}

const T0 = Date.UTC(2026, 9, 26, 11, 0, 0)

function invalidState(): Error {
  const error = new Error('recognition has already started')
  error.name = 'InvalidStateError'
  return error
}

function setup(options: { readonly overlap?: boolean; readonly plannedRestart?: boolean; readonly scope?: object } = {}) {
  FakeRecognition.instances = []
  FakeRecognition.throwOnStart = []
  let now = T0
  const pending: { at: number; run: () => void; id: number }[] = []
  let nextId = 1
  const timers = {
    set: (run: () => void, ms: number) => {
      const id = nextId++
      pending.push({ at: now + ms, run, id })
      return id
    },
    clear: (handle: unknown) => {
      const i = pending.findIndex((t) => t.id === handle)
      if (i >= 0) pending.splice(i, 1)
    },
  }
  const engine = createWebSpeechEngine({
    now: () => now,
    scope: options.scope ?? { webkitSpeechRecognition: FakeRecognition },
    timers,
    ...(options.overlap === undefined ? {} : { overlap: options.overlap }),
    ...(options.plannedRestart === undefined ? {} : { plannedRestart: options.plannedRestart }),
  })
  const results: SpeechResult[] = []
  const errors: SpeechError[] = []
  const states: SpeechState[] = []
  const gaps: SpeechGap[] = []
  engine.onResult((r) => results.push(r))
  engine.onError((e) => errors.push(e))
  engine.onState((s) => states.push(s))
  engine.onGap((g) => gaps.push(g))
  return {
    engine,
    results,
    errors,
    states,
    gaps,
    timersPending: () => pending.length,
    /** 시계를 앞으로 (그 사이 걸린 타이머를 차례로 부른다) */
    advance: (ms: number) => {
      const until = now + ms
      for (;;) {
        pending.sort((a, b) => a.at - b.at)
        const next = pending[0]
        if (next === undefined || next.at > until) break
        pending.shift()
        now = next.at
        next.run()
      }
      now = until
    },
    current: (): FakeRecognition => FakeRecognition.instances.at(-1) as FakeRecognition,
  }
}

describe('인식 끊김 재기', () => {
  it('network 끝 → 다음 객체 소리 받기 시작까지를 넣은 시계로 재어 한 번 알린다', () => {
    const t = setup()
    t.engine.start()
    const first = t.current()
    first.audioStart()
    expect(t.gaps).toEqual([]) // 처음 켤 때는 끊김이 아니다
    t.advance(10_000)
    first.audioEnd()
    t.advance(100)
    first.error('network')
    first.end()
    expect(FakeRecognition.instances).toHaveLength(2) // 끝에서 바로 새 객체
    expect(t.current().starts).toBe(1)
    t.advance(700)
    t.current().audioStart()
    expect(t.gaps).toEqual([{ from: T0 + 10_000, to: T0 + 10_800, ms: 800, reason: 'network', retries: 0 }])
    t.current().audioStart()
    expect(t.gaps).toHaveLength(1)
  })

  it('소리 받기 알림이 없으면 끝(onend)부터 첫 결과까지, 까닭은 오류 없으면 end · no-speech면 no-speech', () => {
    const t = setup()
    t.engine.start()
    t.advance(9_000)
    t.current().end()
    t.advance(1_200)
    t.current().results(0, [['15번', false]])
    expect(t.gaps).toEqual([{ from: T0 + 9_000, to: T0 + 10_200, ms: 1_200, reason: 'end', retries: 0 }])
    t.advance(9_000)
    t.current().error('no-speech')
    t.current().end()
    t.advance(300)
    t.current().audioStart()
    expect(t.gaps.at(-1)).toMatchObject({ ms: 300, reason: 'no-speech' })
  })

  it('다시 연 객체가 소리를 못 받고 또 끝나면 끊김은 처음 끝부터 이어서 잰다', () => {
    const t = setup()
    t.engine.start()
    t.current().audioStart()
    t.advance(5_000)
    t.current().error('network')
    t.current().end()
    t.advance(500)
    t.current().error('aborted')
    t.current().end()
    t.advance(400)
    t.current().audioStart()
    expect(t.gaps).toEqual([{ from: T0 + 5_000, to: T0 + 5_900, ms: 900, reason: 'network', retries: 0 }])
  })

  it('판매자가 끄면 이어지던 끊김은 버린다 · 다시 켜도 끊김이 아니다', () => {
    const t = setup()
    t.engine.start()
    t.advance(5_000)
    t.current().end()
    t.engine.stop()
    t.engine.start()
    t.advance(500)
    t.current().audioStart()
    expect(t.gaps).toEqual([])
  })

  it('한 줄 모양: 인식 끊김 0.8초 (network)', () => {
    expect(formatSpeechGap({ ms: 800, reason: 'network' })).toBe('인식 끊김 0.8초 (network)')
    expect(formatSpeechGap({ ms: 1_460, reason: 'end' })).toBe('인식 끊김 1.5초 (end)')
    expect(formatSpeechGap({ ms: 0, reason: 'planned' })).toBe('인식 끊김 0.0초 (planned)')
    expect(formatSpeechGap({ ms: Number.NaN, reason: 'aborted' })).toBe('인식 끊김 0.0초 (aborted)')
  })
})

describe('쉬는 틈 다시 열기', () => {
  it(`연 지 ${PLANNED_RESTART_AFTER_MS}ms 넘은 객체에서 최종이 오고 남은 중간 결과가 없으면 stop → 끝에서 새 객체, "다시 시작 중" 없음·한도에 안 셈`, () => {
    const t = setup()
    t.engine.start()
    const first = t.current()
    first.audioStart()
    t.advance(PLANNED_RESTART_AFTER_MS - 1)
    first.results(0, [['15번 만 원', true]])
    expect(first.stops).toBe(0) // 아직 젊다
    t.advance(1)
    first.results(1, [['16번 만 원', true]])
    expect(first.stops).toBe(1)
    expect(FakeRecognition.instances).toHaveLength(1)
    // stop 뒤 남은 최종은 받는다
    first.results(2, [['17번', true]])
    first.end()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.current().starts).toBe(1)
    t.advance(250)
    t.current().audioStart()
    expect(t.gaps).toEqual([{ from: T0 + PLANNED_RESTART_AFTER_MS, to: T0 + PLANNED_RESTART_AFTER_MS + 250, ms: 250, reason: 'planned', retries: 0 }])
    expect(t.states).toEqual(['LISTENING'])
    expect(t.results.map((r) => r.text)).toEqual(['15번 만 원', '16번 만 원', '17번'])
  })

  it('중간 결과가 남아 있으면(말하는 중) 다시 열지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.advance(PLANNED_RESTART_AFTER_MS + 5_000)
    t.current().results(0, [['15번 만 원', true], ['16번', false]])
    expect(t.current().stops).toBe(0)
    t.current().results(1, [['16번 만 원', true]])
    expect(t.current().stops).toBe(1)
  })

  it('쉬는 틈 다시 열기를 여러 번 해도 한도(KEEPS_STOPPING)에 걸리지 않는다 — 다시 연 객체가 바로 끝나도 그 끝남만 센다', () => {
    const t = setup()
    t.engine.start()
    for (let i = 0; i < MAX_AUTO_ENDS * 2; i++) {
      t.advance(PLANNED_RESTART_AFTER_MS)
      t.current().results(0, [[`${i + 1}번`, true]])
      t.current().end()
    }
    expect(t.errors).toEqual([])
    expect(t.states).toEqual(['LISTENING'])
    expect(FakeRecognition.instances).toHaveLength(MAX_AUTO_ENDS * 2 + 1)
  })

  it(`끝(onend)이 ${PLANNED_END_WAIT_MS}ms 안에 오지 않으면 abort하고 새 객체를 연다 · 그 뒤 늦은 끝은 무시`, () => {
    const t = setup()
    t.engine.start()
    const first = t.current()
    t.advance(PLANNED_RESTART_AFTER_MS)
    first.results(0, [['15번', true]])
    t.advance(PLANNED_END_WAIT_MS - 1)
    expect(FakeRecognition.instances).toHaveLength(1)
    t.advance(1)
    expect(first.aborts).toBe(1)
    expect(FakeRecognition.instances).toHaveLength(2)
    first.end()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.states).toEqual(['LISTENING'])
  })

  it('stop 뒤 network가 오면 그 끝남은 센다 (D-I5-17 그대로)', () => {
    const t = setup()
    t.engine.start()
    t.advance(PLANNED_RESTART_AFTER_MS)
    t.current().results(0, [['15번', true]])
    t.current().error('network')
    t.current().end()
    expect(t.states).toEqual(['LISTENING', 'RESTARTING', 'LISTENING'])
  })

  it('판매자가 끄면 기다림 타이머도 버린다 · plannedRestart: false면 하지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.advance(PLANNED_RESTART_AFTER_MS)
    t.current().results(0, [['15번', true]])
    t.engine.stop()
    expect(t.timersPending()).toBe(0)
    const off = setup({ plannedRestart: false })
    off.engine.start()
    off.advance(PLANNED_RESTART_AFTER_MS * 2)
    off.current().results(0, [['15번', true]])
    expect(off.current().stops).toBe(0)
  })
})

describe('빠른 다시 열기 (InvalidStateError)', () => {
  it(`끝 뒤 새 객체 start()가 InvalidStateError면 ${START_RETRY_MS}ms 뒤 새 객체로 다시 해 본다 · 끊김에 횟수`, () => {
    const t = setup()
    t.engine.start()
    t.current().audioStart()
    t.advance(5_000)
    FakeRecognition.throwOnStart = [invalidState(), invalidState()]
    t.current().end()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.errors).toEqual([])
    t.advance(START_RETRY_MS)
    expect(FakeRecognition.instances).toHaveLength(3)
    t.advance(START_RETRY_MS)
    expect(FakeRecognition.instances).toHaveLength(4)
    expect(t.current().starts).toBe(1)
    t.advance(20)
    t.current().audioStart()
    expect(t.gaps).toEqual([{ from: T0 + 5_000, to: T0 + 5_000 + START_RETRY_MS * 2 + 20, ms: START_RETRY_MS * 2 + 20, reason: 'end', retries: 2 }])
    expect(t.errors).toEqual([])
  })

  it(`${START_RETRY_MAX}번 다시 해도 안 되면 OTHER로 멈춘다 · 판매자가 누른 start()는 다시 해 보지 않는다`, () => {
    const t = setup()
    t.engine.start()
    t.advance(5_000)
    FakeRecognition.throwOnStart = Array.from({ length: START_RETRY_MAX + 1 }, invalidState)
    t.current().end()
    t.advance(START_RETRY_MS * (START_RETRY_MAX + 1))
    expect(t.errors.map((e) => e.kind)).toEqual(['OTHER'])
    expect(t.engine.getState()).toBe('HALTED')
    const u = setup()
    FakeRecognition.throwOnStart = [invalidState()]
    u.engine.start()
    expect(u.errors.map((e) => e.kind)).toEqual(['OTHER'])
    expect(u.timersPending()).toBe(0)
  })

  it('다시 해 보기를 기다리는 동안 끄면 새 객체를 열지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.advance(5_000)
    FakeRecognition.throwOnStart = [invalidState()]
    t.current().end()
    t.engine.stop()
    t.advance(START_RETRY_MS * 3)
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.engine.getState()).toBe('OFF')
  })
})

describe('겹쳐 열기 (실험)', () => {
  it('기본은 끔', () => {
    expect(OVERLAP_PLANNED_RESTART).toBe(false)
  })

  it('켜면 새 객체를 먼저 열고 옛 객체를 닫는다 — 옛 객체의 남은 최종·aborted·끝은 새 객체를 방해하지 않는다', () => {
    const t = setup({ overlap: true })
    t.engine.start()
    const first = t.current()
    t.advance(PLANNED_RESTART_AFTER_MS)
    first.results(0, [['15번', true]])
    expect(FakeRecognition.instances).toHaveLength(2)
    const second = t.current()
    expect(second.starts).toBe(1)
    expect(first.stops).toBe(1)
    first.results(1, [['16번', true]])
    first.error('aborted')
    first.end()
    expect(FakeRecognition.instances).toHaveLength(2)
    second.results(0, [['17번', true]])
    expect(t.results.map((r) => r.text)).toEqual(['15번', '16번', '17번'])
    expect(t.states).toEqual(['LISTENING'])
    expect(t.errors).toEqual([])
  })

  it('옛 객체가 중간 결과를 남기고 끝나면 끝에서 넘김으로 한 번', () => {
    const t = setup({ overlap: true })
    t.engine.start()
    const first = t.current()
    t.advance(PLANNED_RESTART_AFTER_MS)
    first.results(0, [['15번', true]])
    first.results(1, [['16번 만', false]])
    first.end()
    expect(t.results.at(-1)).toEqual({ text: '16번 만', final: true, flushedAtEnd: true })
  })
})

describe('기기 안 인식 확인 (processLocally — 확인만)', () => {
  it('SpeechRecognition.available({ langs: [ko-KR], processLocally: true }) 결과를 돌려주고 인식 객체를 만들지 않는다', async () => {
    const calls: unknown[] = []
    class Local extends FakeRecognition {
      static available(options: unknown): Promise<string> {
        calls.push(options)
        return Promise.resolve('downloadable')
      }
    }
    const t = setup({ scope: { SpeechRecognition: Local } })
    expect(await t.engine.onDeviceStatus()).toBe('downloadable')
    expect(calls).toEqual([{ langs: ['ko-KR'], processLocally: true }])
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('확인 방법이 없거나 던지거나 모르는 값이면 unsupported', async () => {
    expect(await setup().engine.onDeviceStatus()).toBe('unsupported')
    expect(await setup({ scope: {} }).engine.onDeviceStatus()).toBe('unsupported')
    class Throws extends FakeRecognition {
      static available(): Promise<string> {
        return Promise.reject(new Error('x'))
      }
    }
    expect(await setup({ scope: { SpeechRecognition: Throws } }).engine.onDeviceStatus()).toBe('unsupported')
    class Odd extends FakeRecognition {
      static available(): string {
        return 'maybe'
      }
    }
    expect(await setup({ scope: { SpeechRecognition: Odd } }).engine.onDeviceStatus()).toBe('unsupported')
  })
})
