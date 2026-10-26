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
  STALL_BACKOFF_AFTER,
  STALL_MIN_MS,
  STALL_MS,
  END_WAIT_MS,
  createWebSpeechEngine,
  formatSpeechDiagnostic,
  formatSpeechGap,
  readStallMs,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type SpeechDiagnostic,
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
  onspeechend: RecognitionLike['onspeechend'] = null
  /** true면 start()에서 onstart를 알리지 않는다 (시작 알림 없는 브라우저) */
  static silentStart = false
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
    // 크롬처럼 시작을 알린다 (소리 받기 시작은 시험이 audioStart()로)
    if (!FakeRecognition.silentStart) this.onstart?.()
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

  speechEnd(): void {
    this.onspeechend?.()
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

function setup(options: { readonly overlap?: boolean; readonly plannedRestart?: boolean; readonly scope?: object; readonly stallRestart?: boolean; readonly stallMs?: number } = {}) {
  FakeRecognition.instances = []
  FakeRecognition.throwOnStart = []
  FakeRecognition.silentStart = false
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
    // 멈춤 지킴이는 그 시험(아래 '멈춤 지킴이')에서만 켠다 — 다른 시험은 결과 없이 시계를 오래 넘긴다
    stallRestart: options.stallRestart ?? false,
    ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }),
  })
  const results: SpeechResult[] = []
  const errors: SpeechError[] = []
  const states: SpeechState[] = []
  const gaps: SpeechGap[] = []
  const diagnostics: SpeechDiagnostic[] = []
  engine.onDiagnostic((d) => diagnostics.push(d))
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
    diagnostics,
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

describe('멈춤 지킴이 (실방송: 듣는 중인 채 결과 없이 약 10초 귀 막힘)', () => {
  it(`기본 ${STALL_MS}ms(최소 ${STALL_MIN_MS}ms) — 설정값 고르기`, () => {
    expect(STALL_MS).toBe(2_000)
    expect(readStallMs(undefined)).toBe(STALL_MS)
    expect(readStallMs('1500')).toBe(STALL_MS)
    expect(readStallMs(1.5)).toBe(STALL_MS)
    expect(readStallMs(500)).toBe(STALL_MIN_MS)
    expect(readStallMs(1_500)).toBe(1_500)
    expect(readStallMs(8_000)).toBe(8_000)
  })

  it(`소리를 받는 객체에서 ${STALL_MS}ms 동안 결과가 없으면 abort하고 같은 순간 새 객체 start() — 한도에 안 셈·"다시 시작 중" 없음, 진단 줄`, () => {
    const t = setup({ stallRestart: true })
    t.engine.start()
    const first = t.current()
    first.audioStart()
    t.advance(1_500)
    first.results(0, [['15번', false]])
    t.advance(STALL_MS - 1)
    expect(first.aborts).toBe(0)
    t.advance(1)
    expect(first.aborts).toBe(1)
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.current().starts).toBe(1)
    expect(t.diagnostics).toEqual([{ kind: 'stall', at: T0 + 1_500 + STALL_MS, ms: STALL_MS, cause: 'no-result', streak: 1 }])
    expect(formatSpeechDiagnostic(t.diagnostics[0]!)).toBe('인식 멈춤 2.0초 → 다시 켬')
    expect(t.states).toEqual(['LISTENING'])
    expect(t.errors).toEqual([])
    // 옛 객체의 aborted·끝은 새 객체를 건드리지 않는다
    first.error('aborted')
    first.end()
    expect(FakeRecognition.instances).toHaveLength(2)
    // 다시 연 뒤 첫 결과까지 (시작 알림은 start()와 같은 순간)
    t.advance(120)
    t.current().audioStart()
    t.advance(780)
    t.current().results(0, [['16번 만 원', true]])
    expect(t.diagnostics.at(-1)).toEqual({ kind: 'first-result', at: T0 + 1_500 + STALL_MS + 900, ms: 900, startMs: 0, after: 'stall' })
    expect(formatSpeechDiagnostic(t.diagnostics.at(-1)!)).toBe('다시 켠 뒤 시작 0.0초 · 첫 결과 0.9초 (stall)')
    expect(t.gaps.at(-1)).toMatchObject({ reason: 'stall', ms: 120 })
  })

  it('결과(중간 결과 포함)가 계속 오면 다시 열지 않는다', () => {
    const t = setup({ stallRestart: true })
    t.engine.start()
    t.current().audioStart()
    for (let i = 0; i < 20; i++) {
      t.advance(STALL_MS - 100)
      t.current().results(0, [[`말 ${i}`, false]])
    }
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.diagnostics).toEqual([])
  })

  it(`결과 없는 다시 열기가 ${STALL_BACKOFF_AFTER}번 이어지면 기다림을 두 배로, 결과가 오면 돌아간다 · 아무리 이어져도 멈추지 않는다`, () => {
    const t = setup({ stallRestart: true })
    t.engine.start()
    t.current().audioStart()
    t.advance(STALL_MS * STALL_BACKOFF_AFTER)
    expect(FakeRecognition.instances).toHaveLength(1 + STALL_BACKOFF_AFTER)
    t.advance(STALL_MS * 2 - 1)
    expect(FakeRecognition.instances).toHaveLength(1 + STALL_BACKOFF_AFTER)
    t.advance(1)
    expect(FakeRecognition.instances).toHaveLength(2 + STALL_BACKOFF_AFTER)
    t.advance(STALL_MS * 2 * 30)
    expect(t.errors).toEqual([])
    expect(t.engine.getState()).toBe('LISTENING')
    t.current().results(0, [['15번', true]])
    const count = FakeRecognition.instances.length
    t.advance(STALL_MS)
    expect(FakeRecognition.instances).toHaveLength(count + 1)
    expect(t.diagnostics.filter((d) => d.kind === 'stall').at(-1)).toMatchObject({ streak: 1 })
  })

  it('시작 알림(onstart·onaudiostart)이 없는 객체에는 걸지 않는다 (가짜·다른 브라우저)', () => {
    const t = setup({ stallRestart: true })
    FakeRecognition.silentStart = true
    t.engine.start()
    t.advance(STALL_MS * 10)
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('멈춰 닫은 객체에서 늦게 온 결과는 버리지 않는다 — 한 번 진단, 남은 중간 결과는 그 끝에서 넘김', () => {
    const t = setup({ stallRestart: true })
    t.engine.start()
    const first = t.current()
    first.audioStart()
    t.advance(STALL_MS)
    expect(FakeRecognition.instances).toHaveLength(2)
    t.advance(400)
    first.results(0, [['15번 만 원', true]])
    first.results(1, [['16번', false]])
    first.end()
    expect(t.results).toEqual([
      { text: '15번 만 원', final: true },
      { text: '16번', final: false },
      { text: '16번', final: true, flushedAtEnd: true },
    ])
    expect(t.diagnostics.filter((d) => d.kind === 'late-result')).toEqual([{ kind: 'late-result', at: T0 + STALL_MS + 400, ms: 400 }])
    expect(formatSpeechDiagnostic(t.diagnostics.find((d) => d.kind === 'late-result')!)).toBe('멈춘 인식에서 늦은 결과 0.4초 뒤')
  })

  it(`소리 받기 멈춤 뒤 ${END_WAIT_MS}ms 안에 끝이 없으면 다시 연다 · 끝이 오면 보통 다시 열기`, () => {
    const t = setup({ stallRestart: true, stallMs: 8_000 })
    t.engine.start()
    const first = t.current()
    first.audioStart()
    t.advance(1_000)
    first.audioEnd()
    t.advance(END_WAIT_MS - 1)
    expect(FakeRecognition.instances).toHaveLength(1)
    t.advance(1)
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.diagnostics[0]).toMatchObject({ kind: 'stall', cause: 'audio-end' })
    expect(formatSpeechDiagnostic(t.diagnostics[0]!)).toBe('인식 멈춤 3.0초 → 다시 켬 (audio-end)')
    const second = t.current()
    second.audioStart()
    t.advance(1_000)
    second.audioEnd()
    t.advance(500)
    second.end()
    expect(FakeRecognition.instances).toHaveLength(3)
    t.advance(END_WAIT_MS * 2)
    expect(FakeRecognition.instances).toHaveLength(3)
  })

  it(`말 끝 뒤 ${END_WAIT_MS}ms 안에 결과도 끝도 없으면 다시 연다 · 결과가 오면 거둔다`, () => {
    const t = setup({ stallRestart: true, stallMs: 8_000 })
    t.engine.start()
    t.current().audioStart()
    t.current().speechEnd()
    t.advance(500)
    t.current().results(0, [['15번', true]])
    t.advance(END_WAIT_MS * 2)
    expect(FakeRecognition.instances).toHaveLength(1)
    t.current().speechEnd()
    t.advance(END_WAIT_MS)
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(t.diagnostics[0]).toMatchObject({ kind: 'stall', cause: 'speech-end' })
  })

  it(`stallMs ${STALL_MIN_MS}: 1초 결과 없으면 다시 열고, 다시 열기는 그 시간에 한 번까지`, () => {
    const t = setup({ stallRestart: true, stallMs: STALL_MIN_MS })
    t.engine.start()
    t.current().audioStart()
    t.advance(STALL_MIN_MS)
    expect(FakeRecognition.instances).toHaveLength(2)
    // 새 객체가 곧바로 결과를 내고 또 멈춰도 앞 다시 열기에서 STALL_MIN_MS 안에는 다시 열지 않는다
    t.advance(100)
    t.current().results(0, [['15번', false]])
    t.advance(STALL_MIN_MS - 1)
    expect(FakeRecognition.instances).toHaveLength(2)
    t.advance(1)
    expect(FakeRecognition.instances).toHaveLength(3)
  })

  it('다시 연 객체 start()가 InvalidStateError면 50ms 뒤 다시 · 판매자가 끄면 지킴이도 멈춘다', () => {
    const t = setup({ stallRestart: true })
    t.engine.start()
    t.current().audioStart()
    FakeRecognition.throwOnStart = [invalidState()]
    t.advance(STALL_MS)
    expect(FakeRecognition.instances).toHaveLength(2)
    t.advance(START_RETRY_MS)
    expect(FakeRecognition.instances).toHaveLength(3)
    expect(t.current().starts).toBe(1)
    t.engine.stop()
    expect(t.timersPending()).toBe(0)
    t.advance(STALL_MS * 5)
    expect(FakeRecognition.instances).toHaveLength(3)
  })

  it('기본은 켬, 모든 끝남 세기(홈 화면 앱)면 끔', () => {
    FakeRecognition.instances = []
    FakeRecognition.silentStart = false
    let now = T0
    const pending: (() => void)[] = []
    const timers = { set: (run: () => void) => pending.push(run), clear: () => {} }
    const on = createWebSpeechEngine({ now: () => now, scope: { SpeechRecognition: FakeRecognition }, timers })
    on.start()
    expect(pending).toHaveLength(1)
    on.stop()
    pending.length = 0
    now += 1
    const home = createWebSpeechEngine({ now: () => now, scope: { SpeechRecognition: FakeRecognition }, timers, countAllEnds: true })
    home.start()
    expect(pending).toHaveLength(0)
    home.stop()
  })
})
