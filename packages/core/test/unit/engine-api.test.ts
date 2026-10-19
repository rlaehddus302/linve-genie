// AC-S02-02 순수·결정성·직렬화, AC-S02-03 맞지 않는 명령, AC-S02-04 S03 경계, initEngine.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_SETTINGS,
  InvalidEventError,
  NotImplementedError,
  applyEvent,
  checkEvent,
  initEngine,
  isInvalidEvent,
  isNotImplemented,
  listClaims,
  listEffects,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, T0, chat, host, play, register, type EventInput } from './engine-helpers.ts'

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

/** 순수 데이터인지: 객체·배열·문자열·유한한 수·불리언·null만 (undefined·함수·Map·Set·클래스 인스턴스 없음) */
function pureDataProblems(value: unknown, path = '$', out: string[] = []): string[] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return out
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path}: 유한하지 않은 수`)
    return out
  }
  if (typeof value !== 'object') {
    out.push(`${path}: ${typeof value}`)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => pureDataProblems(item, `${path}[${String(i)}]`, out))
    return out
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) out.push(`${path}: 평범한 객체가 아님`)
  for (const [key, item] of Object.entries(value)) pureDataProblems(item, `${path}.${key}`, out)
  return out
}

/** 골든 G-ENG-020·026·081·083 등을 섞은 대표 로그 */
const LOG: readonly EventInput[] = [
  register(15),
  register(16, { status: 'READY' }),
  register(17, { stock: 2, name: '', price: 800 }),
  chat('A', '15'),
  chat('B', '15'),
  chat('C', '15 16 17'),
  chat('D', '16'),
  chat('A', '17'),
  { type: 'effect.labelPrinted', effectId: 'c1:PRINT_PRODUCT_LABEL:-:1' },
  host('host.cancel', 15, 'A'),
  chat('A', '15', { nick: '새이름' }),
  { type: 'product.open', b: 'b1', no: 16 },
  { type: 'host.blockBuyer', buyer: 'D', reason: '장난' },
  chat('X', '안녕'),
  { type: 'host.assign', b: 'b1', no: 17, buyer: 'X', reason: '단골', replace: 'A', replaceTo: 'WAITLIST' },
  chat('B', '15 취소'),
  { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'B' },
  { type: 'effect.thanksSent', effectId: 'c2:POST_THANKS:LIVE_CHAT:2' },
  chat('C', '17 취소'),
  { type: 'host.dismissCancel', b: 'b1', no: 17, buyer: 'C' },
]

describe('AC-S02-02 순수·결정성·직렬화', () => {
  it('깊게 얼린 상태·이벤트로 호출해도 예외 없이 같은 결과', () => {
    const { states } = play(LOG)
    const reference = play(LOG)
    LOG.forEach((event, i) => {
      const frozenState = deepFreeze(structuredClone(states[i]) as EngineState)
      const frozenEvent = deepFreeze({ at: T0 + i * 1000, ...event, seq: i + 1 } as EngineEvent)
      const result = applyEvent(frozenState, frozenEvent)
      expect(JSON.stringify(result.state)).toBe(JSON.stringify(reference.states[i + 1]))
    })
  })

  it('넘긴 상태·이벤트를 바꾸지 않는다', () => {
    const { states } = play(LOG)
    LOG.forEach((event, i) => {
      const state = states[i] as EngineState
      const before = JSON.stringify(state)
      const full = { at: T0 + i * 1000, ...event, seq: i + 1 } as EngineEvent
      const eventBefore = JSON.stringify(full)
      applyEvent(state, full)
      expect(JSON.stringify(state)).toBe(before)
      expect(JSON.stringify(full)).toBe(eventBefore)
    })
  })

  it('같은 로그를 두 번 적용하면 각 단계의 상태·효과가 직렬화 수준에서 같다', () => {
    const a = play(LOG)
    const b = play(LOG)
    expect(a.states.map((s) => JSON.stringify(s))).toEqual(b.states.map((s) => JSON.stringify(s)))
    expect(JSON.stringify(a.emitted)).toBe(JSON.stringify(b.emitted))
  })

  it('상태는 JSON 순수 데이터다 (모든 단계)', () => {
    for (const state of play(LOG).states) expect(pureDataProblems(state)).toEqual([])
  })

  it('어느 시점에서 JSON으로 왕복한 뒤 나머지를 이어서 적용해도 결과가 같다', () => {
    const full = play(LOG)
    for (let k = 0; k <= LOG.length; k++) {
      let state = JSON.parse(JSON.stringify(full.states[k])) as EngineState
      for (let i = k; i < LOG.length; i++) state = applyEvent(state, { at: T0 + i * 1000, ...LOG[i], seq: i + 1 } as EngineEvent).state
      expect(JSON.stringify(state), `왕복 지점 ${String(k)}`).toBe(JSON.stringify(full.state))
    }
  })

  it('효과 ID·찜 ID는 한 상태 안에서 겹치지 않는다', () => {
    const { state } = play(LOG)
    const effectIds = listEffects(state).map((e) => e.id)
    const claimIds = listClaims(state).map((c) => c.id)
    expect(new Set(effectIds).size).toBe(effectIds.length)
    expect(new Set(claimIds).size).toBe(claimIds.length)
    expect(claimIds.every((id) => !id.includes(':'))).toBe(true)
  })

  it('실행 환경의 시간대·언어와 무관하다 (자식 프로세스)', () => {
    const script = [
      "import { initEngine, applyEvent, listEffects, listSettlements } from '@livejjim/core'",
      `const log = ${JSON.stringify(LOG.map((event, i) => ({ at: T0 + i * 1000, ...event, seq: i + 1 })))}`,
      `let state = initEngine({ broadcasts: [${JSON.stringify(B1)}], settings: {} })`,
      'for (const e of log) state = applyEvent(state, e).state',
      'process.stdout.write(JSON.stringify([state, listEffects(state), listSettlements(state)]))',
    ].join('\n')
    const outputs = ['Asia/Seoul', 'UTC', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Chatham'].map((tz) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        env: { ...process.env, TZ: tz, LANG: tz === 'UTC' ? 'C' : 'ko_KR.UTF-8', LC_ALL: tz === 'UTC' ? 'C' : 'en_US.UTF-8' },
      })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout
    })
    expect(new Set(outputs).size).toBe(1)
    expect(JSON.parse(outputs[0] as string)[0]).toEqual(JSON.parse(JSON.stringify(play(LOG).state)))
  })

  it('@livejjim/core에 런타임 의존성이 없다', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
  })
})

describe('AC-S02-03 맞지 않는 명령은 아무것도 바꾸지 않는다', () => {
  const base: readonly EventInput[] = [register(15), register(16, { status: 'READY' }), chat('A', '15'), chat('B', '15'), chat('C', '16')]
  const invalid: readonly (readonly [string, unknown])[] = [
    ['같은 번호 재등록', { type: 'product.register', b: 'b1', no: 15, name: '라울', price: 5000 }],
    ['활성 찜 없는 취소', host('host.cancel', 15, 'Z')],
    ['활성 찜 없는 무효', host('host.reject', 16, 'A')],
    ['빈 자리 없는 수동 승계', host('host.promote', 15, 'B')],
    ['대기가 아닌 수동 승계', host('host.promote', 15, 'A')],
    ['확정 아닌 찜 확인', { type: 'host.confirm', b: 'b1', no: 15, buyer: 'B' }],
    ['보류 찜 확인', { type: 'host.confirm', b: 'b1', no: 16, buyer: 'C' }],
    ['표시 없는 재오픈', { type: 'host.reopen', b: 'b1', no: 15, reason: 'r' }],
    ['없는 번호 재오픈', { type: 'host.reopen', b: 'b1', no: 99, reason: 'r' }],
    ['빈 자리 없는 배정', { type: 'host.assign', b: 'b1', no: 15, buyer: 'C', reason: 'r' }],
    ['READY 상품 배정', { type: 'host.assign', b: 'b1', no: 16, buyer: 'A', reason: 'r' }],
    ['모르는 구매자 배정', { type: 'host.assign', b: 'b1', no: 15, buyer: 'Z', reason: 'r', replace: 'A', replaceTo: 'CANCEL' }],
    ['1등이 아닌 사람 교체', { type: 'host.assign', b: 'b1', no: 15, buyer: 'C', reason: 'r', replace: 'B', replaceTo: 'CANCEL' }],
    ['교체 대상만 적은 배정', { type: 'host.assign', b: 'b1', no: 15, buyer: 'C', reason: 'r', replace: 'A' }],
    ['이미 1등에게 배정', { type: 'host.assign', b: 'b1', no: 15, buyer: 'A', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' }],
    ['요청 없는 승인', { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'A' }],
    ['요청 없는 거절', { type: 'host.dismissCancel', b: 'b1', no: 15, buyer: 'B' }],
    ['차단 안 된 사람 해제', { type: 'host.unblockBuyer', buyer: 'A', reason: 'r' }],
    ['모르는 효과 ID', { type: 'effect.labelPrinted', effectId: 'c9:PRINT_PRODUCT_LABEL:-:1' }],
  ]

  it.each(invalid)('%s → 같은 상태 객체, 효과 없음', (_name, event) => {
    const { state } = play(base)
    expect(checkEvent(state, { seq: 99, at: T0 + 99_000, ...(event as object) })).toEqual([])
    const result = applyEvent(state, { seq: 99, at: T0 + 99_000, ...(event as object) } as EngineEvent)
    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  })

  it('조치 하나로 효과·관찰 값이 바뀌지 않는다 — 신뢰할 수 없는 키(__proto__)도 안전하게 다룬다', () => {
    const { state } = play([register(15), chat('__proto__', '15'), chat('constructor', '15'), host('host.cancel', 15, '__proto__')])
    expect(listClaims(state).map((c) => [c.buyer, c.status])).toEqual([
      ['__proto__', 'CANCELLED'],
      ['constructor', 'CONFIRMED'],
    ])
    expect(({} as Record<string, unknown>).constructor).toBe(Object)
  })
})

describe('AC-S03-02 입력 오류는 조용히 무시하지 않는다 (S02의 형식 오류 항목을 스펙 변경 D-050에 따라 옮겼다)', () => {
  const base: readonly EventInput[] = [register(15), register(16, { status: 'READY' }), chat('A', '15'), chat('B', '15'), chat('C', '16')]
  const malformed: readonly (readonly [string, unknown, string | null])[] = [
    ['선언하지 않은 방송의 채팅', { type: 'chat', b: 'b9', id: 'x1', ch: 'D', nick: 'd', text: '15' }, 'b'],
    ['선언하지 않은 방송의 상품 등록', { type: 'product.register', b: 'b9', no: 1, name: 'x', price: 1 }, 'b'],
    ['번호 0', { type: 'product.register', b: 'b1', no: 0, name: 'x', price: 1 }, 'no'],
    ['번호가 문자열', { type: 'product.register', b: 'b1', no: '20', name: 'x', price: 1 }, 'no'],
    ['가격 음수', { type: 'product.register', b: 'b1', no: 20, name: 'x', price: -1 }, 'price'],
    ['가격 소수', { type: 'product.register', b: 'b1', no: 20, name: 'x', price: 1.5 }, 'price'],
    ['재고 0', { type: 'product.register', b: 'b1', no: 20, name: 'x', price: 1, stock: 0 }, 'stock'],
    ['모르는 상태', { type: 'product.register', b: 'b1', no: 20, name: 'x', price: 1, status: 'SOLD' }, 'status'],
    ['품종 없음', { type: 'product.register', b: 'b1', no: 20, price: 1 }, 'name'],
    ['방송 없음', { type: 'product.open', no: 16 }, 'b'],
    ['메시지 ID 빈 문자열', { type: 'chat', b: 'b1', id: '', ch: 'D', nick: 'd', text: '15' }, 'id'],
    ['채널 ID 없음', { type: 'chat', b: 'b1', id: 'x2', nick: 'd', text: '15' }, 'ch'],
    ['닉네임이 수', { type: 'chat', b: 'b1', id: 'x3', ch: 'D', nick: 1, text: '15' }, 'nick'],
    ['owner가 문자열', { type: 'chat', b: 'b1', id: 'x4', ch: 'D', nick: 'd', text: '15', owner: 'yes' }, 'owner'],
    ['publishedAt이 문자열', { type: 'chat', b: 'b1', id: 'x5', ch: 'D', nick: 'd', text: '15', publishedAt: '20:00' }, 'publishedAt'],
    ['교체 방법 오타', { type: 'host.assign', b: 'b1', no: 15, buyer: 'C', reason: 'r', replace: 'A', replaceTo: 'DROP' }, 'replaceTo'],
    ['구매자 없는 차단', { type: 'host.blockBuyer', reason: 'r' }, 'buyer'],
    ['효과 ID 없음', { type: 'effect.thanksSent' }, 'effectId'],
    ['모르는 이벤트 종류', { type: 'chat.message', b: 'b1', id: 'x6', ch: 'D', nick: 'd', text: '15' }, 'type'],
    ['종류 없음', { b: 'b1' }, 'type'],
    ['종류가 문자열이 아님', { type: 7 }, 'type'],
    ['__proto__ 종류', { type: '__proto__' }, 'type'],
  ]

  it.each(malformed)('%s → 입력 오류(NotImplementedError 아님), 상태 그대로, 검사 함수도 같은 필드를 짚는다', (_name, event, field) => {
    const { state } = play(base)
    const before = JSON.stringify(state)
    const full = { seq: 99, at: T0 + 99_000, ...(event as object) }
    let thrown: unknown
    try {
      applyEvent(state, full as EngineEvent)
    } catch (error) {
      thrown = error
    }
    expect(isInvalidEvent(thrown)).toBe(true)
    expect(isNotImplemented(thrown)).toBe(false)
    expect(thrown).toBeInstanceOf(InvalidEventError)
    expect((thrown as InvalidEventError).problems.map((p) => p.field)).toContain(field)
    expect(checkEvent(state, full).map((p) => p.field)).toEqual((thrown as InvalidEventError).problems.map((p) => p.field))
    expect(JSON.stringify(state)).toBe(before)
  })

  it('seq·at이 틀린 이벤트, 이벤트가 객체가 아니면 입력 오류', () => {
    const { state } = play(base)
    const chatD = { type: 'chat', b: 'b1', id: 'x7', ch: 'D', nick: 'd', text: '15' }
    for (const event of [
      { ...chatD, seq: 1.5, at: T0 },
      { ...chatD, at: T0 },
      { ...chatD, seq: '1', at: T0 },
      { ...chatD, seq: 100, at: Number.NaN },
      { ...chatD, seq: 100, at: '20:00' },
      null,
      'chat',
      42,
      [chatD],
    ]) {
      expect(() => applyEvent(state, event as unknown as EngineEvent)).toThrow(InvalidEventError)
      expect(checkEvent(state, event).length).toBeGreaterThan(0)
    }
  })
})

describe('AC-S03-01 미구현이 남는 곳은 broadcast.*·effect.failed·settlement.groupBy=MANUAL뿐이다', () => {
  it.each([
    ['broadcast.start', 'S04'],
    ['broadcast.end', 'S04'],
    ['effect.failed', 'S11'],
  ] as const)('R-1의 나중 스프린트 이벤트 %s는 조용히 무시하지 않고 미구현을 알린다 (%s)', (type, sprint) => {
    const { state } = play([register(15)])
    expect(checkEvent(state, { seq: 2, at: T0 + 2000, type })).toEqual([])
    expect(() => applyEvent(state, { seq: 2, at: T0 + 2000, type } as unknown as EngineEvent)).toThrow(sprint)
    expect(() => applyEvent(state, { seq: 2, at: T0 + 2000, type } as unknown as EngineEvent)).toThrow(NotImplementedError)
  })

  it('settlement.groupBy=MANUAL → initEngine이 NotImplementedError (D-059)', () => {
    expect(() => initEngine({ broadcasts: [B1], settings: { 'settlement.groupBy': 'MANUAL' } })).toThrow(NotImplementedError)
  })

  it('contention.policy=RECEIVED_TIME과 동률 처리 셋은 엔진을 시작한다', () => {
    for (const tie of ['YOUTUBE', 'SMS', 'HOST'] as const) {
      const state = initEngine({ broadcasts: [B1], settings: { 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': tie } })
      expect(state.settings['contention.policy']).toBe('RECEIVED_TIME')
    }
  })
})

describe('initEngine', () => {
  it('설정은 DOMAIN_RULES 기본값 위에 덮어쓴다 (넘긴 객체는 바꾸지 않는다)', () => {
    const settings = { 'waitlist.max': 2 }
    const state = initEngine({ broadcasts: [B1], settings })
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, 'waitlist.max': 2 })
    expect(settings).toEqual({ 'waitlist.max': 2 })
    expect(state.broadcasts).toEqual([B1])
  })

  it('방송 ID가 비었거나 겹치면 TypeError', () => {
    expect(() => initEngine({ broadcasts: [B1, { ...B1, title: '다른 제목' }], settings: {} })).toThrow(TypeError)
    expect(() => initEngine({ broadcasts: [{ id: '', date: '2026-10-18', title: 'x' }], settings: {} })).toThrow(TypeError)
  })
})
