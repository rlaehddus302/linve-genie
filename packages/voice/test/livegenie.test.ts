// AC-APP1-11~14·54 (VOC-06, D-APP-05·D-APP-12, D-APP1-03·D-APP1-08): 라이브지니 받아쓰기 엔진
// 가짜 연결·넘겨받은 시계·가짜 타이머로 돈다(네트워크·마이크 없음).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LIVEGENIE_CONNECTION_FAILED_MESSAGE,
  LIVEGENIE_UNSUPPORTED_MESSAGE,
  canCaptureAudio,
  createLiveGenieEngine,
  isDeviceTag,
  isLateSpeech,
  parseLiveGenieMessage,
  voiceStreamUrl,
  type LiveGenieCloseReason,
  type LiveGenieSpeechEngine,
} from '../src/livegenie.ts'
import type { RelayHandlers } from '../src/cloud.ts'
import type { SpeechError, SpeechResult, SpeechState } from '../src/speech.ts'

class FakeRelay {
  readonly sent: Uint8Array[] = []
  closed = false
  readonly handlers: RelayHandlers
  constructor(handlers: RelayHandlers) {
    this.handlers = handlers
  }
  send(data: unknown): void {
    this.sent.push(data as Uint8Array)
  }
  close(): void {
    this.closed = true
  }
  ready(): void {
    this.handlers.onMessage('{"type":"ready"}')
  }
  result(text: string, startMs: number, endMs: number): void {
    this.handlers.onMessage(JSON.stringify({ type: 'result', text, startMs, endMs }))
  }
  closing(reason: string): void {
    this.handlers.onMessage(JSON.stringify({ type: 'closing', reason }))
    this.handlers.onClose()
  }
  drop(): void {
    this.handlers.onClose()
  }
}

interface Timer {
  readonly run: () => void
  readonly ms: number
  cancelled: boolean
}

function setup(options: { supported?: boolean } = {}) {
  const clock = { now: 1_000_000 }
  const relays: FakeRelay[] = []
  const timers: Timer[] = []
  const results: SpeechResult[] = []
  const errors: SpeechError[] = []
  const states: SpeechState[] = []
  const closings: (LiveGenieCloseReason | 'UNKNOWN')[] = []
  const engine: LiveGenieSpeechEngine = createLiveGenieEngine({
    connect: (handlers) => {
      const relay = new FakeRelay(handlers)
      relays.push(relay)
      return relay
    },
    now: () => clock.now,
    timers: {
      set: (run, ms) => {
        const timer: Timer = { run, ms, cancelled: false }
        timers.push(timer)
        return timer
      },
      clear: (handle) => {
        ;(handle as Timer).cancelled = true
      },
    },
    isSupported: () => options.supported ?? true,
  })
  engine.onResult((result) => results.push(result))
  engine.onError((error) => errors.push(error))
  engine.onState((state) => states.push(state))
  engine.onClosing((reason) => closings.push(reason))
  /** 걸린 타이머를 시계를 당겨 돌린다 */
  const fire = (): number => {
    const timer = timers.filter((item) => !item.cancelled).at(-1)
    if (timer === undefined) throw new Error('걸린 타이머 없음')
    timer.cancelled = true
    clock.now += timer.ms
    timer.run()
    return timer.ms
  }
  const last = (): FakeRelay => {
    const relay = relays.at(-1)
    if (relay === undefined) throw new Error('연결 없음')
    return relay
  }
  return { engine, clock, relays, timers, results, errors, states, closings, fire, last }
}

const chunk = (fill = 1): Uint8Array => new Uint8Array(3_200).fill(fill)

describe('결과는 최종만 (AC-APP1-11)', () => {
  it('ready·result·모르는 틀·깨진 JSON → 알리는 결과는 { text, final: true } 하나', () => {
    const t = setup()
    t.engine.start()
    const relay = t.last()
    relay.ready()
    t.engine.sendAudio(chunk())
    relay.result('15번 2만 원', 0, 100)
    relay.handlers.onMessage('{"type":"partial","text":"15번"}')
    relay.handlers.onMessage('{"type":"result",')
    relay.handlers.onMessage(new ArrayBuffer(8))
    relay.handlers.onMessage('null')
    expect(t.results).toEqual([{ text: '15번 2만 원', final: true }])
    expect(t.errors).toEqual([])
    expect(t.engine.getState()).toBe('LISTENING')
  })

  it('만들기만 해서는 연결하지 않는다 (VOC-05)', () => {
    const t = setup()
    expect(t.relays).toHaveLength(0)
    t.engine.start()
    expect(t.relays).toHaveLength(1)
  })

  it('ready 전에는 소리를 보내지 않고 결과도 받지 않는다', () => {
    const t = setup()
    t.engine.start()
    expect(t.engine.sendAudio(chunk())).toBe(false)
    t.last().result('15번 2만 원', 0, 100)
    expect(t.last().sent).toHaveLength(0)
    expect(t.results).toEqual([])
    t.last().ready()
    expect(t.engine.sendAudio(chunk())).toBe(true)
    expect(t.last().sent).toHaveLength(1)
    expect(t.last().sent[0]?.byteLength).toBe(3_200)
  })

  it('음성이 안 되는 기기면 연결하지 않고 그 문장으로 멈춘다 (D-APP-18)', () => {
    const t = setup({ supported: false })
    t.engine.start()
    expect(t.relays).toHaveLength(0)
    expect(t.errors).toEqual([{ kind: 'UNSUPPORTED', message: LIVEGENIE_UNSUPPORTED_MESSAGE }])
    expect(t.engine.getState()).toBe('HALTED')
  })
})

describe('다시 잇기 (AC-APP1-12, D-APP-05·D-APP1-03)', () => {
  it('ready 뒤 닫힘을 되풀이하면 1·2·4·8·8초 간격, 여섯 번째 끊김이면 "듣기 멈춤"(까닭 연결 실패)', () => {
    const t = setup()
    t.engine.start()
    const waits: number[] = []
    for (let drop = 1; drop <= 5; drop++) {
      t.last().ready()
      t.last().drop()
      expect(t.engine.getState()).toBe('RESTARTING')
      waits.push(t.fire())
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 8_000])
    t.last().ready()
    t.last().drop()
    expect(t.engine.getState()).toBe('HALTED')
    expect(t.errors).toEqual([{ kind: 'CONNECTION_FAILED', message: LIVEGENIE_CONNECTION_FAILED_MESSAGE }])
    expect(t.relays).toHaveLength(6)
    expect(t.timers.filter((timer) => !timer.cancelled)).toHaveLength(0)
  })

  it('그 사이 결과가 오면 센 것을 비운다 (간격도 1초부터)', () => {
    const t = setup()
    t.engine.start()
    const waits: number[] = []
    for (let drop = 1; drop <= 4; drop++) {
      t.last().ready()
      t.last().drop()
      waits.push(t.fire())
    }
    t.last().ready()
    t.engine.sendAudio(chunk())
    t.last().result('15번 2만 원', 0, 50)
    for (let drop = 1; drop <= 5; drop++) {
      t.last().ready()
      t.last().drop()
      waits.push(t.fire())
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 1_000, 2_000, 4_000, 8_000, 8_000])
    expect(t.engine.getState()).toBe('RESTARTING')
    expect(t.errors).toEqual([])
  })

  it('60초 창 밖의 끊김은 세지 않는다', () => {
    const t = setup()
    t.engine.start()
    for (let drop = 1; drop <= 10; drop++) {
      t.last().ready()
      t.clock.now += 30_000
      t.last().drop()
      t.fire()
    }
    expect(t.errors).toEqual([])
  })

  it('끊긴 동안 넣은 소리는 버리고, 다시 이은 뒤 첫 조각은 이은 뒤에 잡은 소리', () => {
    const t = setup()
    t.engine.start()
    const first = t.last()
    first.ready()
    expect(t.engine.sendAudio(chunk(1))).toBe(true)
    first.drop()
    expect(t.engine.sendAudio(chunk(2), t.clock.now)).toBe(false)
    t.clock.now += 300
    expect(t.engine.sendAudio(chunk(3), t.clock.now)).toBe(false)
    const capturedDuringGap = t.clock.now
    t.fire()
    const second = t.last()
    expect(second).not.toBe(first)
    expect(t.engine.sendAudio(chunk(4), t.clock.now)).toBe(false) // ready 전
    second.ready()
    expect(t.engine.sendAudio(chunk(5), capturedDuringGap)).toBe(false) // 끊긴 동안 잡은 소리
    expect(t.engine.sendAudio(chunk(6), t.clock.now)).toBe(true)
    expect(second.sent.map((sent) => sent[0])).toEqual([6])
    expect(first.sent.map((sent) => sent[0])).toEqual([1])
    expect(first.closed).toBe(true)
  })

  it('첫 켜기에 서버에 닿지 않으면(ready 전 닫힘·연결 오류·연결 함수 예외) 다시 잇는다', () => {
    const t = setup()
    t.engine.start()
    t.last().drop()
    expect(t.engine.getState()).toBe('RESTARTING')
    t.fire()
    t.last().handlers.onError()
    expect(t.engine.getState()).toBe('RESTARTING')
    expect(t.errors).toEqual([])
  })

  it('연결 함수가 예외를 던져도 다시 잇기 셈', () => {
    let calls = 0
    const timers: Timer[] = []
    const engine = createLiveGenieEngine({
      connect: () => {
        calls++
        throw new Error('막힘')
      },
      now: () => 0,
      timers: { set: (run, ms) => timers.push({ run, ms, cancelled: false }), clear: () => undefined },
      isSupported: () => true,
    })
    engine.start()
    expect(engine.getState()).toBe('RESTARTING')
    expect(calls).toBe(1)
    expect(timers[0]?.ms).toBe(1_000)
  })

  for (const [reason, kind] of [
    ['BUSY', 'TRANSCRIBE_BUSY'],
    ['NO_WORKER', 'TRANSCRIBE_OFF'],
  ] as const) {
    it(`ready 전 첫 closing ${reason} → 다시 잇지 않고 그 까닭으로 멈춤`, () => {
      const t = setup()
      t.engine.start()
      t.last().closing(reason)
      expect(t.engine.getState()).toBe('HALTED')
      expect(t.errors.map((error) => error.kind)).toEqual([kind])
      expect(t.relays).toHaveLength(1)
      expect(t.timers).toHaveLength(0)
    })

    it(`ready 뒤 다시 이을 때 받은 ${reason} → 다시 잇기 셈`, () => {
      const t = setup()
      t.engine.start()
      t.last().ready()
      t.last().drop()
      t.fire()
      t.last().closing(reason)
      expect(t.engine.getState()).toBe('RESTARTING')
      expect(t.errors).toEqual([])
      t.fire()
      expect(t.relays).toHaveLength(3)
    })
  }

  it('BUSY 문장·NO_WORKER 문장·다른 기기 문장·로그인 끝남 문장은 글자 그대로', () => {
    const sentences: Record<string, string> = {}
    for (const reason of ['BUSY', 'NO_WORKER', 'OTHER_DEVICE', 'AUTH']) {
      const t = setup()
      t.engine.start()
      t.last().closing(reason)
      sentences[reason] = t.errors[0]?.message ?? ''
    }
    expect(sentences).toEqual({
      BUSY: '지금 받아쓰기가 바빠요. 상품은 빠른 입력으로 넣어 주세요.',
      NO_WORKER: '받아쓰기 서버가 꺼져 있어요. 상품은 빠른 입력으로 넣어 주세요.',
      OTHER_DEVICE: '음성은 다른 기기에서 듣는 중이에요.',
      AUTH: '로그인이 끝나 음성 듣기를 멈췄어요. 다시 로그인해 주세요.',
    })
  })

  for (const [reason, kind] of [
    ['OTHER_DEVICE', 'OTHER_DEVICE'],
    ['AUTH', 'LOGIN_ENDED'],
  ] as const) {
    it(`${reason} → ready 전이든 뒤든 멈춤, 다시 잇지 않는다`, () => {
      for (const afterReady of [false, true]) {
        const t = setup()
        t.engine.start()
        if (afterReady) t.last().ready()
        t.last().closing(reason)
        expect(t.engine.getState()).toBe('HALTED')
        expect(t.errors.map((error) => error.kind)).toEqual([kind])
        expect(t.timers).toHaveLength(0)
        expect(t.relays).toHaveLength(1)
      }
    })
  }

  it('ENDED → 음성 끔(새 문장 없음), 까닭은 onClosing으로', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.last().closing('ENDED')
    expect(t.engine.getState()).toBe('OFF')
    expect(t.errors).toEqual([])
    expect(t.closings).toEqual(['ENDED'])
    expect(t.timers).toHaveLength(0)
  })

  it('RATE·WORKER_LOST → 다시 잇기 셈, closing 뒤 닫힘은 한 번만 센다', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.last().closing('WORKER_LOST')
    expect(t.timers.map((timer) => timer.ms)).toEqual([1_000])
    t.fire()
    t.last().ready()
    t.last().closing('RATE')
    expect(t.timers.map((timer) => timer.ms)).toEqual([1_000, 2_000])
    expect(t.closings).toEqual(['WORKER_LOST', 'RATE'])
  })

  it('다시 잇는 중 stop() → 타이머를 지우고 다시 열지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.last().drop()
    t.engine.stop()
    expect(t.engine.getState()).toBe('OFF')
    expect(t.timers.every((timer) => timer.cancelled)).toBe(true)
    expect(t.relays).toHaveLength(1)
  })

  it('stop()은 연결을 닫고 그 뒤 늦게 온 알림은 무시한다', () => {
    const t = setup()
    t.engine.start()
    const relay = t.last()
    relay.ready()
    t.engine.stop()
    expect(relay.closed).toBe(true)
    relay.result('15번 2만 원', 0, 10)
    relay.drop()
    expect(t.results).toEqual([])
    expect(t.engine.getState()).toBe('OFF')
    expect(t.engine.sendAudio(chunk())).toBe(false)
  })

  it('멈춘 뒤 다시 켜면 처음부터 (첫 거절 규칙도 다시)', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.engine.stop()
    t.engine.start()
    t.last().closing('BUSY')
    expect(t.engine.getState()).toBe('HALTED')
    expect(t.errors.map((error) => error.kind)).toEqual(['TRANSCRIBE_BUSY'])
  })
})

describe('말 끝 시각 (AC-APP1-13, D-APP1-08)', () => {
  it('첫 소리를 T에 잡았고 endMs 3,000 → 말 끝 T + 3,000. T + 13,000은 바로, T + 13,001은 늦은 글', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    const captured = t.clock.now + 20
    t.engine.sendAudio(chunk(), captured)
    for (let index = 1; index < 40; index++) t.engine.sendAudio(chunk(), captured + index * 100)
    t.last().result('15번 2만 원', 1_200, 3_000)
    const [result] = t.results
    expect(result?.spokenEndAt).toBe(captured + 3_000)
    expect(isLateSpeech(result as SpeechResult, captured + 13_000)).toBe(false)
    expect(isLateSpeech(result as SpeechResult, captured + 13_001)).toBe(true)
  })

  it('다시 이은 흐름은 그 흐름의 첫 소리 시각으로 다시 잰다', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.engine.sendAudio(chunk(), t.clock.now)
    t.last().drop()
    t.fire()
    t.clock.now += 5_000
    t.last().ready()
    const second = t.clock.now + 10
    t.engine.sendAudio(chunk(), second)
    t.last().result('16번 3만 원', 0, 2_000)
    expect(t.results[0]?.spokenEndAt).toBe(second + 2_000)
  })

  it('시각을 주지 않으면 지금 − 조각 길이(100ms), 단 ready 시각보다 앞서지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    const readyAt = t.clock.now
    t.engine.sendAudio(chunk())
    t.last().result('a', 0, 500)
    expect(t.results[0]?.spokenEndAt).toBe(readyAt + 500)
    const u = setup()
    u.engine.start()
    u.last().ready()
    u.clock.now += 1_000
    u.engine.sendAudio(chunk())
    u.last().result('a', 0, 500)
    expect(u.results[0]?.spokenEndAt).toBe(u.clock.now - 100 + 500)
  })

  it('말 끝 시각이 셀 수 없는 속성이라 결과 모양은 { text, final }', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.engine.sendAudio(chunk())
    t.last().result('15번', 0, 10)
    expect(Object.keys(t.results[0] ?? {})).toEqual(['text', 'final'])
  })

  it('다른 엔진의 결과(말 끝 시각 없음)는 늦은 글이 아니다', () => {
    expect(isLateSpeech({ text: '15번', final: true }, 10 ** 12)).toBe(false)
  })
})

describe('비밀 없음 (AC-APP1-14, VOC-06 AC3)', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const files = readdirSync(src).filter((name) => name.endsWith('.ts'))

  it('packages/voice/src에 일꾼 경로·일꾼 토큰 이름이 없다', () => {
    for (const name of files) {
      const text = readFileSync(join(src, name), 'utf8')
      expect(text, name).not.toContain('/api/voice/worker')
      expect(text, name).not.toContain('TRANSCRIBE_WORKER_TOKEN')
      expect(text, name).not.toMatch(/Bearer/)
    }
  })

  it('엔진 옵션은 연결 함수·시계·타이머·지원 여부뿐 (주소·토큰을 받지 않는다)', () => {
    const text = readFileSync(join(src, 'livegenie.ts'), 'utf8')
    const options = /export interface LiveGenieOptions \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ''
    const keys = [...options.matchAll(/readonly (\w+)\??:/g)].map((match) => match[1])
    expect(keys).toEqual(['connect', 'now', 'timers', 'isSupported'])
    expect(text.toLowerCase()).not.toContain('token')
    expect(text).not.toMatch(/new WebSocket|fetch\(/)
  })
})

describe('기기 엔진 적대 입력 (AC-APP1-54)', () => {
  it('다시 잇기 중 지난 연결의 result 폭주(1초에 100개)는 알리지 않는다', () => {
    const t = setup()
    t.engine.start()
    const old = t.last()
    old.ready()
    t.engine.sendAudio(chunk())
    old.drop()
    for (let index = 0; index < 100; index++) {
      t.clock.now += 10
      old.result(`${String(index)}번 1만 원`, 0, 10)
    }
    expect(t.results).toEqual([])
    expect(t.engine.getState()).toBe('RESTARTING')
  })

  it('지금 연결의 result 폭주는 하나씩 알리고 엔진은 그대로', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.engine.sendAudio(chunk())
    for (let index = 0; index < 100; index++) t.last().result(`${String(index)}번`, 0, 10)
    expect(t.results).toHaveLength(100)
    expect(t.engine.getState()).toBe('LISTENING')
  })

  it('endMs < startMs·음수·정수 아님·매우 큰 수 → 늦은 글로 본다(등록 쪽으로 틀리지 않음)', () => {
    const cases: [unknown, unknown][] = [
      [500, 100],
      [-1, 100],
      [0, -5],
      [0, 1.5],
      [0, '100'],
      [0, Number.MAX_SAFE_INTEGER],
      [0, 1e300],
      [0, 10 ** 12],
    ]
    for (const [startMs, endMs] of cases) {
      const t = setup()
      t.engine.start()
      t.last().ready()
      t.engine.sendAudio(chunk(), t.clock.now)
      t.last().handlers.onMessage(JSON.stringify({ type: 'result', text: '15번 2만 원', startMs, endMs }))
      const [result] = t.results
      expect(result, JSON.stringify([startMs, endMs])).toBeDefined()
      expect(isLateSpeech(result as SpeechResult, t.clock.now + 1_000), JSON.stringify([startMs, endMs])).toBe(true)
    }
  })

  it('처리 시각이 이상해도 늦은 글', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    t.engine.sendAudio(chunk(), t.clock.now)
    t.last().result('15번', 0, 100)
    const [result] = t.results
    expect(isLateSpeech(result as SpeechResult, Number.NaN)).toBe(true)
    expect(isLateSpeech(result as SpeechResult, t.clock.now - 60_000)).toBe(true)
  })

  it('closing 까닭이 모르는 값이면 다시 잇기 셈', () => {
    for (const reason of ['WHAT', '', 'busy', 42]) {
      const t = setup()
      t.engine.start()
      t.last().ready()
      t.last().handlers.onMessage(JSON.stringify({ type: 'closing', reason }))
      expect(t.engine.getState()).toBe('RESTARTING')
      expect(t.closings).toEqual(['UNKNOWN'])
    }
    // ready 전에 모르는 까닭이어도 다시 잇는다(멈추는 것은 BUSY·NO_WORKER·OTHER_DEVICE·AUTH·ENDED뿐)
    const u = setup()
    u.engine.start()
    u.last().closing('???')
    expect(u.engine.getState()).toBe('RESTARTING')
  })

  it('이상한 조각(빈 것·홀수 바이트·64KB 넘음)은 보내지 않는다', () => {
    const t = setup()
    t.engine.start()
    t.last().ready()
    expect(t.engine.sendAudio(new Uint8Array(0))).toBe(false)
    expect(t.engine.sendAudio(new Uint8Array(3_201))).toBe(false)
    expect(t.engine.sendAudio(new Uint8Array(65_538))).toBe(false)
    expect(t.last().sent).toHaveLength(0)
  })
})

describe('약속 풀기·주소', () => {
  it('parseLiveGenieMessage', () => {
    expect(parseLiveGenieMessage('{"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parseLiveGenieMessage({ type: 'result', text: ' 15번 ', startMs: 0, endMs: 1 })).toEqual({ type: 'result', text: '15번', startMs: 0, endMs: 1 })
    expect(parseLiveGenieMessage({ type: 'result', text: '   ', startMs: 0, endMs: 1 })).toBeNull()
    expect(parseLiveGenieMessage({ type: 'result', text: 'a'.repeat(2_001), startMs: 0, endMs: 1 })).toBeNull()
    expect(parseLiveGenieMessage({ type: 'result', text: 7, startMs: 0, endMs: 1 })).toBeNull()
    expect(parseLiveGenieMessage({ type: 'closing', reason: 'BUSY' })).toEqual({ type: 'closing', reason: 'BUSY' })
    expect(parseLiveGenieMessage({ type: 'closing' })).toEqual({ type: 'closing', reason: 'UNKNOWN' })
    expect(parseLiveGenieMessage('x'.repeat(100_000))).toBeNull()
  })

  it('voiceStreamUrl: http→ws, https→wss, 방송 ID·기기 표지는 주소 글자로 감싼다', () => {
    expect(voiceStreamUrl('https://live.example.com', 'b_1', 'abcd1234')).toBe('wss://live.example.com/api/voice/stream?broadcastId=b_1&device=abcd1234')
    expect(voiceStreamUrl('http://localhost:7700/console?x=1', 'b 2&x', 'abcd1234')).toBe('ws://localhost:7700/api/voice/stream?broadcastId=b+2%26x&device=abcd1234')
  })

  it('기기 표지는 영숫자 8~64자', () => {
    expect(isDeviceTag('abcd1234')).toBe(true)
    expect(isDeviceTag('a'.repeat(64))).toBe(true)
    expect(isDeviceTag('abc')).toBe(false)
    expect(isDeviceTag('a'.repeat(65))).toBe(false)
    expect(isDeviceTag('abcd-1234')).toBe(false)
  })

  it('canCaptureAudio: getUserMedia·AudioWorkletNode·AudioContext가 다 있어야 참', () => {
    const fn = (): void => undefined
    expect(canCaptureAudio({ navigator: { mediaDevices: { getUserMedia: fn } }, AudioWorkletNode: fn, AudioContext: fn })).toBe(true)
    expect(canCaptureAudio({ navigator: { mediaDevices: { getUserMedia: fn } }, AudioContext: fn })).toBe(false)
    expect(canCaptureAudio({ navigator: {}, AudioWorkletNode: fn, AudioContext: fn })).toBe(false)
    expect(canCaptureAudio({})).toBe(false)
  })
})
