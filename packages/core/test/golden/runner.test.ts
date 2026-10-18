// 골든 러너: 이벤트 변환(AC-S00-26), 결정성(AC-S00-27), 실패 보고(AC-S00-28), 파일 탐색(AC-S00-20),
// 러너 오류·효과 보고·불변식 자리, 우회 옵션 없음(AC-S00-23).
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NotImplementedError } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { createFakeCore, emptySnapshot } from './fake-core.ts'
import { listGoldenFiles, runGoldenDir } from './fs-runner.ts'
import { formatReport, formatTotals } from './report.ts'
import { stableSerialize } from './serialize.ts'
import { B1, docs, run, scenario, suiteDoc } from './test-helpers.ts'
import { formatUtcIso } from './time.ts'
import type { GoldenCore, GoldenEvent, GoldenSnapshot } from './types.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REGISTER = { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 }

/** apply에 들어온 이벤트를 모으는 가짜 코어 */
function recordingCore(): { core: GoldenCore; events: GoldenEvent[] } {
  const events: GoldenEvent[] = []
  const core = createFakeCore({
    snapshot: emptySnapshot(),
    engine: {
      apply: (state, event) => {
        events.push(event)
        return { state: { count: ((state as { count?: number }).count ?? 0) + 1 }, effects: [] }
      },
    },
  })
  return { core, events }
}

describe('이벤트 변환 (AC-S00-26)', () => {
  const golden = scenario({
    broadcasts: [B1],
    events: [
      REGISTER,
      { at: '20:00:02.1', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
      { type: 'assert', expect: {} },
      { at: '20:00:02.400', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
      { at: '20:00:03', type: 'chat', b: 'b1', id: 'm2', ch: 'UC_B', nick: '김철수', text: '15', publishedAt: '20:00:01', owner: true },
      { at: '20:00:04', type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:01', memo: '길동' },
      { at: '20:00:05', type: 'sms', b: 'b1', ref: 's2', no: 15, received: '19:59:58' },
      { type: 'assert', expect: {} },
      { at: '21:00:00', type: 'host.blockBuyer', buyer: 'UC_A', reason: '장난' },
      { at: '2026-10-19T00:00:10+09:00', type: 'settlement.payment', buyer: 'sms:s1', date: '2026-10-18', amount: 14000 },
    ],
  })

  it('seq는 assert를 뺀 1부터의 순번, 재수신 사본도 자기 seq', () => {
    const { core, events } = recordingCore()
    const report = run(golden, { core })
    expect(report.items[0]?.status).toBe('pass')
    // 두 번 실행하므로 앞 절반만 본다
    const first = events.slice(0, events.length / 2)
    expect(first.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(first.map((e) => e.type)).toEqual(['product.register', 'chat', 'chat', 'chat', 'sms', 'sms', 'host.blockBuyer', 'settlement.payment'])
    expect(first[1]?.id).toBe('m1')
    expect(first[2]?.id).toBe('m1')
  })

  it('at을 UTC 밀리초로 바꾼다 (짧은 형식 = 방송 날짜의 KST, ISO = 적힌 오프셋)', () => {
    const { core, events } = recordingCore()
    run(golden, { core })
    expect(events.slice(0, 8).map((e) => formatUtcIso(e.at))).toEqual([
      '2026-10-18T11:00:00.000Z',
      '2026-10-18T11:00:02.100Z',
      '2026-10-18T11:00:02.400Z',
      '2026-10-18T11:00:03.000Z',
      '2026-10-18T11:00:04.000Z',
      '2026-10-18T11:00:05.000Z',
      '2026-10-18T12:00:00.000Z',
      '2026-10-18T15:00:10.000Z',
    ])
  })

  it('chat의 publishedAt이 없으면 at과 같고, 있으면 UTC 밀리초로', () => {
    const { core, events } = recordingCore()
    run(golden, { core })
    expect(events[1]?.publishedAt).toBe(events[1]?.at)
    expect(formatUtcIso(events[3]?.publishedAt as number)).toBe('2026-10-18T11:00:01.000Z')
    expect(events[0]).not.toHaveProperty('publishedAt')
  })

  it('received는 원문 그대로(분·초 정밀도 포함), 나머지 필드도 적힌 값 그대로', () => {
    const { core, events } = recordingCore()
    run(golden, { core })
    expect(events[4]).toEqual({ seq: 5, at: events[4]?.at, type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:01', memo: '길동' })
    expect(events[5]?.received).toBe('19:59:58')
    expect(events[3]).toMatchObject({ owner: true, ch: 'UC_B', nick: '김철수', text: '15' })
    expect(events[7]).toEqual({ seq: 8, at: events[7]?.at, type: 'settlement.payment', buyer: 'sms:s1', date: '2026-10-18', amount: 14000 })
  })

  it('엔진은 방송·설정을 시작 시점에 받는다', () => {
    const seen: unknown[] = []
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: (setup) => {
          seen.push(setup)
          return {}
        },
      },
    })
    run(scenario({ settings: { 'waitlist.max': 2, 'cancel.buyerChat': 'OFF', 'shipping.freeThreshold': null } }), { core })
    expect(seen[0]).toEqual({ broadcasts: [B1], settings: { 'waitlist.max': 2, 'cancel.buyerChat': 'OFF', 'shipping.freeThreshold': null } })
  })

  it('엔진이 이벤트를 고쳐도 두 번째 실행에는 원래 이벤트가 들어간다', () => {
    const received: unknown[] = []
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        apply: (state, event) => {
          received.push(event.no)
          const mutable = event as unknown as { no: number }
          mutable.no = 999
          return { state, effects: [] }
        },
      },
    })
    expect(run(scenario({ events: [REGISTER] }), { core }).items[0]?.status).toBe('pass')
    expect(received).toEqual([15, 15])
  })
})

describe('결정성 검사 (AC-S00-27)', () => {
  const golden = scenario({
    events: [REGISTER, { at: '20:00:01', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' }, { at: '20:00:02', type: 'product.hold', b: 'b1', no: 15 }],
  })

  it('결정적인 엔진은 통과', () => {
    expect(run(golden, { fake: { snapshot: emptySnapshot() } }).items[0]?.status).toBe('pass')
  })

  it('호출마다 달라지는 숨은 상태 → 결정성 위반, 처음 달라진 events[n]', () => {
    let hidden = 0
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        apply: (state, event) => {
          // chat(events[1])에서만 숨은 카운터가 상태에 섞인다
          if (event.type === 'chat') hidden++
          return { state: { ...(state as object), [`e${event.seq}`]: event.type === 'chat' ? hidden : 0 }, effects: [] }
        },
      },
    })
    const report = run(golden, { core })
    const item = report.items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('events[1]')
    expect(report.totals.determinism).toBe(1)
    expect(report.ok).toBe(false)
  })

  it('실행할 때마다 순서가 바뀌는 효과 목록 → 결정성 위반', () => {
    let flip = false
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        apply: (state) => {
          flip = !flip
          return { state, effects: flip ? ['라벨', '감사'] : ['감사', '라벨'] }
        },
      },
    })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('events[0]')
  })

  it('관찰 스냅샷이 호출마다 다르면 결정성 위반', () => {
    let calls = 0
    const core = createFakeCore({ snapshot: () => emptySnapshot({ buyerKeys: { [`k${calls++}`]: 'x' } }) })
    expect(run(golden, { core }).items[0]?.status).toBe('determinism')
  })

  it('객체 키 순서만 달라도 결정성 위반', () => {
    let calls = 0
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { start: () => (calls++ % 2 === 0 ? { a: 1, b: 2 } : { b: 2, a: 1 }) } })
    const item = run(scenario(), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('시작 상태')
  })

  it('두 번째 실행에서만 예외 → 결정성 위반', () => {
    let starts = 0
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: () => {
          if (++starts === 2) throw new RangeError('두 번째만')
          return {}
        },
      },
    })
    const item = run(scenario(), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.message).toContain('두 번째 실행에서만 예외')
  })

  it('결정성 위반과 함께 첫 실행의 불일치도 보여 준다', () => {
    let calls = 0
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { start: () => ({ n: calls++ }) } })
    const item = run(scenario({ expect: { claimCount: 1 } }), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems.map((p) => p.path)).toEqual([undefined, 'claimCount'])
  })

  it('러너 출력도 결정적이다 (같은 입력 → 글자 하나까지 같음)', () => {
    const files = [
      { path: 'b.yaml', text: golden },
      { path: 'a.yaml', text: docs(suiteDoc('chat', [{ in: '15', out: { claims: [15] } }]), scenario({ id: 'G-ENG-002', expect: { prodcuts: {} } })) },
    ]
    const first = formatReport(run(files, { allowlist: 'suites: [chat]\n' }))
    const second = formatReport(run([...files].reverse(), { allowlist: 'suites: [chat]\n' }))
    expect(second).toBe(first)
    expect(first).not.toMatch(/\d+ms/)
  })

  it('직렬화: 순수 데이터만, 키 순서·undefined·-0·NaN을 구분', () => {
    expect(stableSerialize({ a: [1, 'x', null, undefined, true], m: new Map([[1, 2]]), s: new Set(['a']) })).toBe('{"a":[1,"x",null,undefined,true],"m":Map{1=>2},"s":Set{"a"}}')
    expect(stableSerialize({ a: 1, b: 2 })).not.toBe(stableSerialize({ b: 2, a: 1 }))
    expect(stableSerialize({ a: undefined })).not.toBe(stableSerialize({}))
    expect(stableSerialize([-0, NaN, Infinity, -Infinity, 10n])).toBe('[-0,NaN,Infinity,-Infinity,10n]')
    expect(stableSerialize(Object.create(null) as object)).toBe('{}')
    expect(() => stableSerialize({ f: () => 1 })).toThrow('직렬화할 수 없는 값(function)')
    expect(() => stableSerialize({ s: Symbol('x') })).toThrow('직렬화할 수 없는 값(symbol)')
    expect(() => stableSerialize({ d: new Date(0) })).toThrow('순수 데이터가 아닌 객체(Date)')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => stableSerialize(cyclic)).toThrow('순환 참조')
    const shared = { x: 1 }
    expect(stableSerialize({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}')
  })

  it('상태에 함수가 있으면 러너 오류', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { start: () => ({ fn: () => 1 }) } })
    const item = run(golden, { core }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('직렬화할 수 없는 값')
  })
})

describe('미구현으로 멈춘 시나리오 — 뒤의 미구현이 앞의 실패를 가리지 않는다 (README "결과 상태", AC-S00-23, AC-S00-27, TD-S00-001)', () => {
  const PAYMENT = { at: '20:10:00', type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-18', amount: 1000 }
  const ALLOW = 'scenarios: ["G-ENG-*"]\n'
  const CLAIM = { product: 'b1/15', buyer: 'X', status: 'CONFIRMED' } as const

  /** settlement.payment에서만 미구현을 던지는 엔진 (판정만 구현하고 정산은 아직인 스프린트를 흉내 낸다) */
  function partial(options: { snapshot?: (count: number) => GoldenSnapshot; hidden?: () => number; invariants?: GoldenCore['engine']['invariants'] } = {}): GoldenCore {
    return createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: () => ({ count: 0 }),
        apply: (state, event) => {
          if (event.type === 'settlement.payment') throw new NotImplementedError('정산(가짜)')
          const count = (state as { count: number }).count + 1
          return { state: { count, ...(options.hidden ? { hidden: options.hidden() } : {}) }, effects: [] }
        },
        observe: (state) => options.snapshot?.((state as { count: number }).count) ?? emptySnapshot(),
        ...(options.invariants ? { invariants: options.invariants } : {}),
      },
    })
  }

  it('중간 검사 불일치 뒤 미구현 → 불일치 (허용 목록에 있어도 실패), 멈춘 지점도 보여 준다', () => {
    const core = partial({ snapshot: (count) => emptySnapshot({ claims: count > 0 ? [CLAIM] : [] }) })
    const report = run(scenario({ events: [REGISTER, { type: 'assert', expect: { claimCount: 0 } }, PAYMENT] }), { core, allowlist: ALLOW })
    const item = report.items[0]
    expect(item).toMatchObject({ status: 'mismatch', listed: true, allowed: false })
    expect(item?.problems).toEqual([
      { where: 'events[1]', path: 'claimCount', expected: 0, actual: 1 },
      { where: 'events[2]', message: '여기서 코어가 미구현을 알려 멈췄다. 이 뒤는 확인하지 못했다: 아직 구현하지 않은 기능: 정산(가짜)' },
    ])
    expect(report.totals).toMatchObject({ mismatch: 1, notImplementedAllowed: 0 })
    expect(report.ok).toBe(false)
    expect(formatReport(report)).toContain('✗ 불일치 · fixture.yaml · G-ENG-901')
  })

  it('불변식 위반 뒤 미구현 → 불일치', () => {
    const core = partial({ invariants: () => [{ id: 'INV-1', message: '한 상품을 두 명에게 팔았다' }] })
    const item = run(scenario({ events: [REGISTER, PAYMENT] }), { core, allowlist: ALLOW }).items[0]
    expect(item?.status).toBe('mismatch')
    expect(item?.problems[0]).toEqual({ where: 'events[0]', path: '불변식 INV-1', message: '한 상품을 두 명에게 팔았다' })
  })

  it('미구현 앞까지의 결정성도 본다: 숨은 상태 → 결정성 위반, 처음 달라진 events[n]', () => {
    let calls = 0
    const core = partial({ hidden: () => ++calls })
    const item = run(scenario({ events: [REGISTER, PAYMENT] }), { core, allowlist: ALLOW }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('events[0]')
    expect(calls).toBe(2) // 첫 실행이 미구현으로 끝나도 두 번째 실행을 같은 지점까지 돌렸다
  })

  it('두 실행이 멈춘 지점이 다르면 결정성 위반', () => {
    let runs = 0
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: () => {
          runs++
          return {}
        },
        observe: () => {
          // 두 번째 실행의 최종 비교에서만 미구현
          if (runs === 2) throw new NotImplementedError('관찰(가짜)')
          return emptySnapshot()
        },
        apply: (state) => ({ state, effects: [] }),
      },
    })
    const golden = scenario({ events: [{ type: 'assert', expect: {} }] })
    const item = run(golden, { core, allowlist: ALLOW }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]).toMatchObject({ where: 'events[0]', expected: '끝까지 실행', actual: 'events[0]에서 미구현으로 멈춤' })
  })

  it('첫 실행은 미구현으로 멈췄는데 두 번째 실행에서만 다른 예외 → 결정성 위반', () => {
    let runs = 0
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: () => {
          runs++
          if (runs === 1) throw new NotImplementedError('시작(가짜)')
          throw new RangeError('두 번째만')
        },
      },
    })
    const item = run(scenario(), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.message).toBe('첫 실행은 시작 상태에서 미구현으로 멈췄는데 두 번째 실행에서만 예외가 났다: RangeError: 두 번째만')
  })

  it('앞에 실패가 없으면 미구현 (허용 목록에 있으면 허용), 멈춘 지점을 적는다', () => {
    const report = run(scenario({ events: [REGISTER, { type: 'assert', expect: { claimCount: 0 } }, PAYMENT] }), { core: partial(), allowlist: ALLOW })
    expect(report.items[0]).toMatchObject({ status: 'not-implemented', allowed: true, problems: [{ where: 'events[2]', message: '아직 구현하지 않은 기능: 정산(가짜)' }] })
    expect(report.ok).toBe(true)
  })

  it('최종 expect에서 미구현이면 위치는 최종 비교', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { observe: createFakeCore().engine.observe } })
    expect(run(scenario(), { core }).items[0]?.problems[0]?.where).toBe('expect (최종 비교)')
  })
})

describe('러너 오류', () => {
  it('apply가 미구현이 아닌 예외를 던지면 러너 오류', () => {
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        apply: () => {
          throw new TypeError('undefined는 객체가 아니다')
        },
      },
    })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item).toMatchObject({ status: 'runner-error', problems: [{ message: '미구현이 아닌 예외: TypeError: undefined는 객체가 아니다' }] })
  })

  it('apply 결과 모양이 틀리면 러너 오류', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { apply: (state) => ({ state, effects: '없음' }) as never } })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item).toMatchObject({ status: 'runner-error', problems: [{ where: 'events[0]', message: 'apply 결과는 { state, effects: [] } 모양이어야 한다' }] })
  })

  it('관찰 스냅샷 형식이 틀려 비교 중 예외가 나면 러너 오류', () => {
    const core = createFakeCore({ snapshot: { buyerKeys: {} } as GoldenSnapshot })
    const item = run(scenario({ expect: { claimCount: 0 } }), { core }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('관찰 스냅샷 비교 중 예외')
  })

  it('파서가 미구현이 아닌 예외를 던지면 러너 오류', () => {
    const core = createFakeCore({
      parser: {
        amount: () => {
          throw new SyntaxError('버그')
        },
      },
    })
    expect(run(suiteDoc('amount', [{ in: '1만', out: 10000 }]), { core }).items[0]).toMatchObject({ status: 'runner-error' })
  })

  it('observe가 미구현이면 시나리오는 미구현', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { observe: createFakeCore().engine.observe } })
    expect(run(scenario({ events: [REGISTER] }), { core }).items[0]?.status).toBe('not-implemented')
  })
})

describe('효과 보고 이벤트 (README: 대상 효과가 없으면 러너 오류)', () => {
  const buyerKeys = { UC_A: 'UC_A', UC_B: 'UC_B' }
  const label = { kind: 'PRINT_PRODUCT_LABEL', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 } as const
  const thanks = { kind: 'POST_THANKS', target: 'LIVE_CHAT', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 } as const
  const golden = (event: Record<string, unknown>): string => scenario({ events: [REGISTER, { at: '20:00:01', ...event }] })

  it.each([
    ['출력된 라벨 보고', { type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' }, [{ ...label, status: 'PENDING' }], 'pass'],
    ['이미 실행된 효과도 대상', { type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' }, [{ ...label, status: 'DONE' }], 'pass'],
    ['취소된 효과뿐이면 대상 없음', { type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' }, [{ ...label, status: 'CANCELLED' }], 'runner-error'],
    ['효과가 없음', { type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' }, [], 'runner-error'],
    ['다른 구매자의 효과', { type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_B' }, [{ ...label, status: 'PENDING' }], 'runner-error'],
    ['감사 보고 (대상 기본 LIVE_CHAT)', { type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'UC_A' }, [{ ...thanks, status: 'PENDING' }], 'pass'],
    ['감사 보고 대상이 다름', { type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'UC_A', target: 'VIDEO_COMMENT' }, [{ ...thanks, status: 'PENDING' }], 'runner-error'],
    ['라벨 보고에 감사 효과만 있음', { type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' }, [{ ...thanks, status: 'PENDING' }], 'runner-error'],
  ] as const)('%s', (_name, event, effects, status) => {
    const report = run(golden(event), { fake: { snapshot: emptySnapshot({ buyerKeys, effects }) } })
    const item = report.items[0]
    expect(item?.status).toBe(status)
    if (status === 'runner-error') {
      expect(item?.problems[0]?.where).toBe('events[1]')
      expect(item?.problems[0]?.message).toContain('효과 보고 대상이 없다')
    }
  })
})

describe('불변식 검사 자리 (S02에서 INV-1~12를 붙인다)', () => {
  it('위반은 불일치로 센다 (위치 events[n], 경로 "불변식 INV-n")', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { invariants: () => [{ id: 'INV-1', message: '확정 찜이 재고보다 많다' }] } })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item?.status).toBe('mismatch')
    expect(item?.problems).toEqual([{ where: 'events[0]', path: '불변식 INV-1', message: '확정 찜이 재고보다 많다' }])
  })
})

describe('실패 보고 (AC-S00-28)', () => {
  const snapshot = emptySnapshot({
    buyerKeys: { UC_A: 'UC_A', UC_B: 'UC_B' },
    products: { 'b1/15': { status: 'SOLD', winners: ['UC_B'], waitlist: [], conflict: false, price: 10000, priceHistory: [] } },
  })

  it('불일치마다 파일·시나리오 ID·events[n]·경로·기대값·실제값을 보여 준다', () => {
    const golden = scenario({
      id: 'G-ENG-123',
      events: [REGISTER, { type: 'assert', expect: { products: { 'b1/15': { winner: 'UC_A' } } } }],
      expect: { products: { 'b1/15': { status: 'OPEN' } } },
    })
    const text = formatReport(run([{ path: 'tests/x/engine.yaml', text: golden }], { fake: { snapshot } }))
    expect(text).toContain('✗ 불일치 · tests/x/engine.yaml · G-ENG-123')
    expect(text).toContain(['      - 위치: events[1] (중간 검사)', '        경로: products.b1/15.winner', '        기대: "UC_A"', '        실제: "UC_B"'].join('\n'))
    expect(text).toContain(['      - 경로: products.b1/15.status', '        기대: "OPEN"', '        실제: "SOLD"'].join('\n'))
    expect(text).toContain('결과: 실패')
  })

  it('파서 불일치는 suite·문서 번호·사례 번호·입력을 보여 준다', () => {
    const golden = docs(suiteDoc('amount', [{ in: '1만', out: 10000 }]), suiteDoc('chat', [{ in: '15', out: {} }, { in: '15번', out: { claims: [15] } }]))
    const core = createFakeCore({ parser: { amount: () => 10000, chat: () => ({ claims: [16], cancels: [], mentions: [] }) } })
    const text = formatReport(run([{ path: 'p.yaml', text: golden }], { core }))
    expect(text).toContain('✗ 불일치 · p.yaml · chat 문서 2 · 사례 2 · 입력 "15번"')
    expect(text).toContain(['      - 경로: out.claims', '        기대: [15]', '        실제: [16]'].join('\n'))
    expect(text).not.toContain('문서 1 · 사례 1 · 입력 "1만"')
  })

  it('미구현(불허)·결정성 위반·러너 오류도 위치와 함께 실패로 나온다, 미구현(허용)은 합계만', () => {
    const golden = docs(suiteDoc('chat', [{ in: '15', out: {} }]), scenario({ id: 'G-ENG-001' }))
    const text = formatReport(run(golden, { allowlist: 'scenarios: ["G-ENG-*"]\n' }))
    expect(text).toContain('✗ 미구현(불허) · fixture.yaml · chat 문서 1 · 사례 1 · 입력 "15"')
    expect(text).toContain('설명: 아직 구현하지 않은 기능: 가짜 chat')
    expect(text).not.toContain('✗ 미구현(허용)')
    expect(text).toContain('미구현(허용) 1 · 미구현(불허) 1')
  })

  it('끝에 README "결과 상태"의 합계를 보여 준다', () => {
    const report = run(docs(suiteDoc('chat', [{ in: '15', out: {} }]), scenario()), { allowlist: 'suites: [chat]\nscenarios: ["G-ENG-901"]\n' })
    expect(formatTotals(report.totals)).toBe(
      '합계: 파일 1 · 파서 사례 1 · 엔진 시나리오 1 · 통과 0 · 불일치 0 · 미구현(허용) 2 · 미구현(불허) 0 · 읽기 오류 0 · 결정성 위반 0 · 러너 오류 0',
    )
    const lines = formatReport(report).split('\n')
    expect(lines.at(-2)).toBe(formatTotals(report.totals))
    expect(lines.at(-1)).toBe('결과: 통과')
  })
})

describe('골든 파일 탐색 (AC-S00-20)', () => {
  const TREE = fileURLToPath(new URL('./fixtures/tree/', import.meta.url)).replace(/\/$/, '')

  it('하위 폴더까지 *.yaml·*.yml, 골든 폴더 바로 아래 예약 파일만 뺀다, 경로의 문자 코드 순서', () => {
    const files = listGoldenFiles(TREE).map((file) => file.slice(TREE.length + 1))
    expect(files).toEqual(['a/known-unimplemented.yaml', 'a/z.yaml', 'b.yml'])
  })

  it('폴더를 읽어 허용 목록과 함께 돌린다 (하위 폴더의 같은 이름은 골든으로 읽혀 읽기 오류)', () => {
    const report = runGoldenDir({ goldenDir: TREE, core: createFakeCore(), displayRoot: TREE })
    expect(report.files.map((f) => f.file)).toEqual(['a/known-unimplemented.yaml', 'a/z.yaml', 'b.yml'])
    expect(report.allowlist).toEqual({ file: 'known-unimplemented.yaml', present: true, sprint: 'T00' })
    expect(report.readErrors.map((e) => [e.file, e.issues[0]?.message])).toEqual([['a/known-unimplemented.yaml', 'suite도 id도 없는 문서']])
    expect(report.totals).toMatchObject({ files: 3, parserCases: 1, scenarios: 1, notImplementedAllowed: 2, readError: 1 })
  })

  it('허용 목록 경로를 null로 주면 빈 목록, 없는 파일이면 빈 목록', () => {
    const none = runGoldenDir({ goldenDir: TREE, allowlistPath: null, core: createFakeCore(), displayRoot: TREE })
    expect(none.totals).toMatchObject({ notImplementedAllowed: 0, notImplementedDisallowed: 2 })
    const missing = runGoldenDir({ goldenDir: TREE, allowlistPath: `${TREE}/없는-목록.yaml`, core: createFakeCore(), displayRoot: TREE })
    expect(missing.allowlist.present).toBe(false)
    expect(missing.totals.notImplementedDisallowed).toBe(2)
  })

  it('골든 파일이 하나도 없으면 읽기 오류 (항상 통과하는 러너 방지)', () => {
    const empty = runGoldenDir({ goldenDir: `${TREE}/없는-폴더`, core: createFakeCore(), displayRoot: TREE })
    expect(empty.totals.files).toBe(0)
    expect(empty.readErrors[0]?.issues[0]?.message).toContain('하나도 없다')
    expect(empty.ok).toBe(false)
  })

  it('파일 순서는 넘긴 순서와 상관없이 경로의 문자 코드 순서', () => {
    const doc = (id: string): string => scenario({ id })
    const report = run([
      { path: 'b.yaml', text: doc('G-ENG-004') },
      { path: 'a/z.yaml', text: doc('G-ENG-003') },
      { path: 'B.yaml', text: doc('G-ENG-001') },
      { path: 'a.yaml', text: doc('G-ENG-002') },
    ])
    expect(report.items.map((item) => item.file)).toEqual(['B.yaml', 'a.yaml', 'a/z.yaml', 'b.yaml'])
  })

  it('YAML 문서가 없는 파일은 읽기 오류', () => {
    expect(run('# 주석만\n').readErrors[0]?.issues[0]?.message).toBe('YAML 문서가 없다')
  })
})

describe('우회 옵션 없음 (AC-S00-23, D-020)', () => {
  it('CLI는 인자를 거부한다 (골든 폴더·허용 목록을 바꿀 수 없다)', () => {
    const result = spawnSync(process.execPath, [`${HERE}cli.ts`, '--allow-all'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('골든 러너는 옵션을 받지 않는다')
    expect(result.stdout).toBe('')
  })

  it('러너 코드는 환경변수를 읽지 않고, 명령행은 CLI의 거부에만 쓴다', () => {
    const sources = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(5)
    for (const file of sources) {
      const text = readFileSync(`${HERE}${file}`, 'utf8')
      expect(text, file).not.toMatch(/process\.env|import\.meta\.env|getenv/)
      if (file !== 'cli.ts') expect(text, file).not.toMatch(/process\.argv/)
    }
    const cli = readFileSync(`${HERE}cli.ts`, 'utf8')
    expect(cli).toContain("join(REPO_ROOT, 'tests', 'golden')")
    expect(cli).toContain("allowlistPath: join(GOLDEN_DIR, 'known-unimplemented.yaml')")
  })
})
