// 결과 자리 slot·첫 자리 lead (R-17 8 7·R-17 8, D-V3-107·108): 크롬이 한 결과를 여러 자리로 갈라 낼 때 가린다. 셀 수 없는 속성이라 결과 모양 비교는 그대로
import { describe, expect, it } from 'vitest'
import {
  createWebSpeechEngine,
  type RecognitionLike,
  type RecognitionResultEventLike,
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

describe('결과 자리 slot · 첫 자리 lead', () => {
  it('같은 객체의 같은 위치는 같은 자리, 아직 최종이 아닌 첫 자리만 lead, 다음 객체는 다른 자리', () => {
    const s = webSetup()
    s.engine.start()
    s.current().results(0, [['59번 오스카', false], ['유아는 3만 원까지', false]])
    s.current().results(0, [['59번 오스카 유아는 3만 원까지', true]])
    s.current().results(1, [['59번 오스카 유아는 3만 원까지', true], ['자 다음', false]])
    expect(s.results.map((r) => [r.text, r.final, r.slot, r.lead])).toEqual([
      ['59번 오스카', false, '1:0', true],
      ['유아는 3만 원까지', false, '1:1', false],
      ['59번 오스카 유아는 3만 원까지', true, '1:0', true],
      ['자 다음', false, '1:1', true],
    ])
    // 셀 수 없는 속성 — 결과 모양 비교는 그대로
    expect(s.results[0]).toEqual({ text: '59번 오스카', final: false })
    expect(Object.keys(s.results[0] as object)).toEqual(['text', 'final'])
    s.current().end()
  })
})
