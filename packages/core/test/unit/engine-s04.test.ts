// S04 코어 (AC-S04-01~08·10·11): 방송 시작·종료와 방송마다의 설정 스냅샷, 정산 설정은 그날 첫 방송, 설정값 검사 함수,
// 표에 없는 필드 입력 오류, 판매자가 적는 칸의 휴대폰 번호(D-079·D-080 — 기록 전 검사만), 상태 형식, 취소 메시지 변환 금지, 대기 한도 0의 승계 묻기.
// 골든(15-broadcast·16-s04-rules)이 고정한 것 밖의 경계와 경로를 규칙 문장대로 본다.
import {
  DEFAULT_SETTINGS,
  InvalidEventError,
  NotImplementedError,
  STATE_FORMAT,
  StateFormatError,
  applyEvent,
  checkEvent,
  checkSettings,
  containsPhoneNumber,
  containsPhoneRun,
  getBroadcast,
  getProduct,
  getSettlement,
  initEngine,
  isInvalidEvent,
  isNotImplemented,
  isStateFormatError,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  looksLikePhoneId,
  normalizePhone,
  resolveSettings,
  type EngineEvent,
  type EngineState,
  type EventProblem,
  type SettingsOverride,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { B1, T0, chat, host, kst, play, register, sms, type EventInput } from './engine-helpers.ts'

const EMPTY = { broadcasts: [], settings: {} } as const
const json = (value: unknown): string => JSON.stringify(value)

/** 빈 엔진에서 시작하는 서버 같은 로그. seq는 1부터, at은 적지 않으면 T0 + i초 */
function server(events: readonly (EventInput | Record<string, unknown>)[]): { state: EngineState; states: EngineState[] } {
  let state = initEngine(EMPTY)
  const states = [state]
  events.forEach((event, i) => {
    state = applyEvent(state, { at: T0 + i * 1000, ...event, seq: i + 1 } as EngineEvent).state
    states.push(state)
  })
  return { state, states }
}

const start = (b: string, settings?: SettingsOverride, date = '2026-10-18', title = `${b}부`): Record<string, unknown> => ({
  type: 'broadcast.start',
  b,
  date,
  title,
  ...(settings === undefined ? {} : { settings }),
})

/** 입력 오류를 던지고 상태를 바꾸지 않으며, 검사 함수가 같은 필드를 짚는지 */
function expectInvalid(state: EngineState, fields: Record<string, unknown>, field: string): void {
  const event = { seq: 99, at: T0 + 99_000, ...fields }
  const before = json(state)
  let thrown: unknown
  try {
    applyEvent(state, event as unknown as EngineEvent)
  } catch (error) {
    thrown = error
  }
  expect(thrown, json(fields)).toBeInstanceOf(InvalidEventError)
  expect(isNotImplemented(thrown)).toBe(false)
  const problems = (thrown as InvalidEventError).problems.map((p) => p.field)
  expect(problems, json(fields)).toContain(field)
  expect(checkEvent(state, event).map((p) => p.field)).toEqual(problems)
  expect(json(state)).toBe(before)
}

// ── A. 방송 시작·종료와 설정 스냅샷 ──────────────────────────────────────

describe('AC-S04-01 broadcast.start — 새 방송 선언', () => {
  it('빈 엔진에서 방송을 선언하면 그 뒤 이벤트가 그 방송을 쓸 수 있다. 선언 전에 쓰면 입력 오류(선언하지 않은 방송)', () => {
    const empty = initEngine(EMPTY)
    expect(listBroadcasts(empty)).toEqual([])
    expectInvalid(empty, { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 }, 'b')
    const { state } = server([start('b1'), register(15), chat('A', '15')])
    expect(listBroadcasts(state)).toEqual([{ id: 'b1', date: '2026-10-18', title: 'b1부', ended: false, endedAt: null, settings: DEFAULT_SETTINGS }])
    expect(getProduct(state, 'b1', 15)?.winners).toEqual(['A'])
  })

  it('스냅샷 = 기본값 위에 그 이벤트의 settings (엔진 시작 설정과 상관없다), 선언 순서대로 조회', () => {
    let state = initEngine({ broadcasts: [B1], settings: { 'waitlist.max': 1, 'shipping.baseFee': 3500 } })
    state = applyEvent(state, { seq: 1, at: T0, ...start('b2', { 'contention.policy': 'RECEIVED_TIME' }, '2026-10-19') } as EngineEvent).state
    state = applyEvent(state, { seq: 2, at: T0 + 1, ...start('b3') } as EngineEvent).state
    expect(listBroadcasts(state).map((b) => [b.id, b.date, b.settings['waitlist.max'], b.settings['shipping.baseFee'], b.settings['contention.policy']])).toEqual([
      ['b1', '2026-10-18', 1, 3500, 'ARRIVAL'],
      ['b2', '2026-10-19', 5, 4000, 'RECEIVED_TIME'],
      ['b3', '2026-10-18', 5, 4000, 'ARRIVAL'],
    ])
    expect(getBroadcast(state, 'b2')).toEqual({ id: 'b2', date: '2026-10-19', title: 'b2부', ended: false, endedAt: null, settings: resolveSettings({ 'contention.policy': 'RECEIVED_TIME' }) })
    expect(getBroadcast(state, 'b9')).toBeNull()
  })

  it('조회 결과를 바꿔도 상태는 그대로다 (설정 스냅샷은 사본)', () => {
    const { state } = server([start('b1')])
    const before = json(state)
    const seen = listBroadcasts(state)[0] as unknown as { settings: Record<string, unknown> }
    seen.settings['waitlist.max'] = 99
    expect(json(state)).toBe(before)
  })

  it('이미 선언한 방송(시작 때 또는 앞선 broadcast.start)의 broadcast.start는 날짜·제목·설정이 달라도 같은 상태 객체 (INV-3)', () => {
    const atInit = initEngine({ broadcasts: [B1], settings: {} })
    for (const copy of [start('b1'), start('b1', { 'waitlist.max': 0 }, '2026-10-19', '다른 제목'), { type: 'broadcast.start', b: 'b1', date: '2026-10-18', title: '' }]) {
      const result = applyEvent(atInit, { seq: 1, at: T0, ...copy } as EngineEvent)
      expect(result.state).toBe(atInit)
      expect(result.effects).toEqual([])
    }
    const { state } = server([start('b2', { 'waitlist.max': 2 }), register(15, { b: 'b2' })])
    const copy = applyEvent(state, { seq: 3, at: T0 + 3000, ...start('b2', { 'waitlist.max': 0, 'claim.parseMode': 'LOOSE' }, '2026-10-20', '새 제목') } as EngineEvent)
    expect(copy.state).toBe(state)
    expect(getBroadcast(state, 'b2')?.settings['waitlist.max']).toBe(2)
  })

  const base = server([start('b1')]).state
  it.each([
    ['방송 ID 빈 문자열', { b: '' }, 'b'],
    ['방송 ID가 수', { b: 1 }, 'b'],
    ['방송 ID 없음', { b: undefined }, 'b'],
    ['없는 날짜', { date: '2026-02-30' }, 'date'],
    ['날짜 형식', { date: '2026-10-18T00:00' }, 'date'],
    ['날짜 없음', { date: undefined }, 'date'],
    ['제목이 수', { title: 1 }, 'title'],
    ['제목 없음', { title: undefined }, 'title'],
    ['설정이 배열', { settings: [] }, 'settings'],
    ['설정이 null', { settings: null }, 'settings'],
    ['설정이 문자열', { settings: 'LOOSE' }, 'settings'],
    ['모르는 설정 키', { settings: { 'waitlist.maxx': 1 } }, 'settings.waitlist.maxx'],
    ['선택지 밖', { settings: { 'claim.parseMode': 'loose' } }, 'settings.claim.parseMode'],
    ['범위 밖', { settings: { 'waitlist.max': 101 } }, 'settings.waitlist.max'],
    ['예/아니오가 문자열', { settings: { 'claim.ignoreOwner': 'true' } }, 'settings.claim.ignoreOwner'],
    ['표에 없는 필드', { extra: 1 }, 'extra'],
  ] as const)('입력 오류: %s', (_name, change, field) => {
    const fields: Record<string, unknown> = { ...start('b2'), ...change }
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete fields[key]
    expectInvalid(base, fields, field)
  })

  it('이미 선언한 방송의 사본이어도 형식이 틀리면 입력 오류 (사본 판단은 형식 검사 뒤)', () => {
    expectInvalid(base, { ...start('b1'), settings: { 'waitlist.max': -1 } }, 'settings.waitlist.max')
  })

  it('settlement.groupBy=MANUAL → NotImplementedError, 상태 그대로 — 이미 선언한 방송의 사본이어도 (로그에 남지 않게, AC-S04-22)', () => {
    for (const b of ['b2', 'b1']) {
      const event = { seq: 2, at: T0 + 2000, ...start(b, { 'settlement.groupBy': 'MANUAL' }) }
      expect(checkEvent(base, event)).toEqual([])
      const before = json(base)
      expect(() => applyEvent(base, event as unknown as EngineEvent)).toThrow(NotImplementedError)
      expect(json(base)).toBe(before)
    }
    // DATE는 그대로 받는다
    expect(getBroadcast(applyEvent(base, { seq: 2, at: T0, ...start('b2', { 'settlement.groupBy': 'DATE' }) } as EngineEvent).state, 'b2')).not.toBeNull()
  })
})

describe('AC-S04-02 판정은 그 방송의 설정으로 (두 방송의 설정이 서로 번지지 않는다)', () => {
  const two = (a: SettingsOverride, b: SettingsOverride, rest: readonly (EventInput | Record<string, unknown>)[]): EngineState => server([start('b1', a), start('b2', b), register(15), register(15, { b: 'b2' }), ...rest]).state

  it('승계: b1 AUTO는 대기 1순위 확정, b2 REOPEN은 대기 정리', () => {
    const state = two({ 'cancel.succession': 'AUTO' }, { 'cancel.succession': 'REOPEN' }, [
      chat('A', '15'),
      chat('B', '15'),
      chat('A', '15', { b: 'b2', id: 'x1' }),
      chat('B', '15', { b: 'b2', id: 'x2' }),
      host('host.cancel', 15, 'A'),
      host('host.cancel', 15, 'A', 'b2'),
    ])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['B'], status: 'SOLD' })
    expect(getProduct(state, 'b2', 15)).toMatchObject({ winners: [], waitlist: [], status: 'OPEN' })
    expect(listClaims(state).find((c) => c.broadcast === 'b2' && c.buyer === 'B')).toMatchObject({ status: 'REJECTED', reason: 'WAITLIST_CLEARED' })
  })

  it('승계 ASK: b1 대기 한도 1은 승계 결정 필요, b2 대기 한도 0은 자동 승계와 같다', () => {
    const state = two({ 'cancel.succession': 'ASK', 'waitlist.max': 1 }, { 'cancel.succession': 'ASK', 'waitlist.max': 0 }, [chat('A', '15'), chat('B', '15'), chat('A', '15', { b: 'b2', id: 'x1' }), host('host.cancel', 15, 'A'), host('host.cancel', 15, 'A', 'b2')])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: [], waitlist: ['B'], awaitingSuccession: true })
    expect(getProduct(state, 'b2', 15)).toMatchObject({ winners: [], waitlist: [], awaitingSuccession: false, status: 'OPEN' })
  })

  it('시청자 채팅 취소: b1 OFF는 무시, b2 AUTO는 바로 취소', () => {
    const state = two({ 'cancel.buyerChat': 'OFF' }, { 'cancel.buyerChat': 'AUTO' }, [chat('A', '15'), chat('A', '15', { b: 'b2', id: 'x1' }), chat('A', '15 취소'), chat('A', '15 취소', { b: 'b2', id: 'x2' })])
    expect(getProduct(state, 'b1', 15)?.winners).toEqual(['A'])
    expect(getProduct(state, 'b2', 15)?.winners).toEqual([])
    expect(listCancelRequests(state)).toEqual([])
  })

  it('공개 전 찜 유효 시간: 공개 40초 전 찜이 b1(30초)에선 만료, b2(60초)에선 판정', () => {
    const state = server([
      start('b1', { 'claim.preOpenWindowSec': 30 }),
      start('b2', { 'claim.preOpenWindowSec': 60 }),
      chat('A', '16', { at: kst(20) }),
      chat('A', '16', { b: 'b2', id: 'x1', at: kst(20) }),
      register(16, { at: kst(20, 0, 40) }),
      register(16, { b: 'b2', at: kst(20, 0, 40) }),
    ]).state
    expect(listClaims(state).map((c) => [c.broadcast, c.status, c.reason])).toEqual([
      ['b1', 'REJECTED', 'EXPIRED'],
      ['b2', 'CONFIRMED', null],
    ])
  })

  it('대기 한도: b1 0은 품절, b2 2는 대기', () => {
    const state = two({ 'waitlist.max': 0 }, { 'waitlist.max': 2 }, [chat('A', '15'), chat('B', '15'), chat('A', '15', { b: 'b2', id: 'x1' }), chat('B', '15', { b: 'b2', id: 'x2' })])
    expect(listClaims(state).filter((c) => c.buyer === 'B').map((c) => [c.broadcast, c.status])).toEqual([
      ['b1', 'REJECTED'],
      ['b2', 'WAITLISTED'],
    ])
  })

  it('방송자 본인 채팅: b1 무시, b2 다른 시청자와 같다 / 라벨·감사: b1 켬, b2 끔', () => {
    const state = two({}, { 'claim.ignoreOwner': false, 'print.autoOnConfirm': false, 'thanks.liveChat': false }, [chat('OWNER', '15', { owner: true }), chat('OWNER', '15', { b: 'b2', id: 'x1', owner: true }), chat('A', '15')])
    expect(getProduct(state, 'b1', 15)?.winners).toEqual(['A'])
    expect(getProduct(state, 'b2', 15)?.winners).toEqual(['OWNER'])
    expect(listEffects(state).map((e) => [e.product, e.kind])).toEqual([
      ['b1/15', 'PRINT_PRODUCT_LABEL'],
      ['b1/15', 'POST_THANKS'],
    ])
  })

  it('주문 인식: 같은 본문이 b2(LOOSE)에선 주문, b1(STRICT)에선 언급 — 언급 메시지는 그 방송에서 변환할 수 있다', () => {
    const state = two({}, { 'claim.parseMode': 'LOOSE' }, [chat('A', '15번 이쁘다 살게요', { id: 'm1' }), chat('A', '15번 이쁘다 살게요', { b: 'b2', id: 'm1' })])
    expect(getProduct(state, 'b1', 15)?.winners).toEqual([])
    expect(getProduct(state, 'b2', 15)?.winners).toEqual(['A'])
    const converted = applyEvent(state, { seq: 9, at: T0 + 9000, type: 'host.convertMessage', b: 'b1', msg: 'm1', no: 15 }).state
    expect(getProduct(converted, 'b1', 15)?.winners).toEqual(['A'])
    // b2의 m1은 주문이었던 메시지라 아무 일도 없다
    expect(applyEvent(state, { seq: 9, at: T0 + 9000, type: 'host.convertMessage', b: 'b2', msg: 'm1', no: 16 }).state).toBe(state)
  })

  it('경합 정책: 같은 늦은 문자찜이 b1(접수순)에선 대기, b2(실제 시각순)에선 역전', () => {
    const state = server([
      start('b1'),
      start('b2', { 'contention.policy': 'RECEIVED_TIME' }),
      register(15, { at: kst(20) }),
      register(15, { b: 'b2', at: kst(20) }),
      chat('A', '15', { at: kst(20, 0, 10) }),
      chat('A', '15', { b: 'b2', id: 'x1', at: kst(20, 0, 10) }),
      sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) }),
      sms('s2', 15, '20:00:05', { b: 'b2', at: kst(20, 0, 20) }),
    ]).state
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['A'], waitlist: ['sms:s1'] })
    expect(getProduct(state, 'b2', 15)).toMatchObject({ winners: ['sms:s2'], waitlist: ['A'] })
  })
})

describe('AC-S04-03 정산 설정은 그날 첫 방송', () => {
  it('2부에서만 산 구매자도 1부 배송비, 날짜마다 그날 첫 방송', () => {
    const state = server([
      start('b1', { 'shipping.baseFee': 4000 }),
      start('b2', { 'shipping.baseFee': 3000, 'shipping.freeThreshold': 1000 }),
      start('n1', { 'shipping.baseFee': 2500 }, '2026-10-19'),
      register(15, { b: 'b2', price: 5000 }),
      register(15, { b: 'n1', price: 5000 }),
      chat('A', '15', { b: 'b2' }),
      chat('A', '15', { b: 'n1' }),
    ]).state
    expect(getSettlement(state, 'A', '2026-10-18')).toMatchObject({ subtotal: 5000, shipping: 4000, total: 9000 })
    expect(getSettlement(state, 'A', '2026-10-19')).toMatchObject({ subtotal: 5000, shipping: 2500, total: 7500 })
  })

  it('뒤 방송을 시작해도 앞서 계산한 묶음 금액이 바뀌지 않는다', () => {
    const { state } = server([start('b1', { 'shipping.freeThreshold': 50_000 }), register(15), chat('A', '15'), { type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 14000 }])
    const before = listSettlements(state)
    const later = applyEvent(state, { seq: 9, at: T0 + 9000, ...start('b2', { 'shipping.baseFee': 0, 'shipping.freeThreshold': 0 }) } as EngineEvent).state
    expect(listSettlements(later)).toEqual(before)
    expect(getSettlement(later, 'A', '2026-10-18')).toMatchObject({ shipping: 4000, total: 14000, payment: 'PAID' })
  })

  it('그 날짜에 방송이 없는 묶음(입금만)은 품목이 없어 배송비 0, 받은 금액은 환불 필요', () => {
    const { state } = server([start('b1'), register(15), chat('A', '안녕'), { type: 'settlement.payment', buyer: 'A', date: '2026-10-25', amount: 1000 }])
    expect(getSettlement(state, 'A', '2026-10-25')).toMatchObject({ items: [], subtotal: 0, shipping: 0, total: 0, received: 1000, refundDue: 1000, payment: 'OVERPAID' })
  })
})

describe('AC-S04-04 broadcast.end — 끝났다는 기록만', () => {
  const log: readonly (EventInput | Record<string, unknown>)[] = [
    start('b1'),
    register(15),
    chat('A', '15'),
    chat('B', '15'),
    { type: 'broadcast.end', b: 'b1' },
    chat('C', '15', { publishedAt: T0 }),
    sms('s1', 15, '20:00'),
    host('host.cancel', 15, 'A'),
    { type: 'settlement.payment', buyer: 'B', date: '2026-10-18', amount: 14000 },
  ]

  it('끝남과 끝난 시각(그 이벤트의 at)이 조회에 보이고, 끝난 뒤의 채팅·문자찜·방송자 조치·정산 기록은 끝나지 않은 방송과 같다', () => {
    const { state, states } = server(log)
    expect(getBroadcast(state, 'b1')).toMatchObject({ ended: true, endedAt: T0 + 4000 })
    expect(getBroadcast(states[4] as EngineState, 'b1')?.ended).toBe(false)
    // 시각은 원래 로그 그대로 (종료를 빼도 다른 이벤트의 at이 밀리지 않게)
    const without = server(log.map((event, i): Record<string, unknown> => ({ at: T0 + i * 1000, ...event })).filter((event) => event.type !== 'broadcast.end')).state
    const views = (s: EngineState): string => json([listProducts(s), listClaims(s).map(({ seq: _s, ...rest }) => rest), listBuyers(s), listSettlements(s).map((x) => ({ ...x, records: x.records.map(({ seq: _q, at: _a, ...rest }) => rest) })), listEffects(s), listPending(s)])
    expect(views(state)).toBe(views(without))
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['B'], waitlist: ['C', 'sms:s1'] })
  })

  it('끝나는 이벤트 자체는 효과를 내지 않고 방송 기록 밖을 바꾸지 않는다. 이미 끝난 방송이면 같은 상태 객체', () => {
    const { states } = server(log.slice(0, 4))
    const before = states.at(-1) as EngineState
    const ended = applyEvent(before, { seq: 5, at: T0 + 5000, type: 'broadcast.end', b: 'b1' })
    expect(ended.effects).toEqual([])
    expect({ ...ended.state, broadcasts: before.broadcasts }).toEqual(before)
    const again = applyEvent(ended.state, { seq: 6, at: T0 + 6000, type: 'broadcast.end', b: 'b1' })
    expect(again.state).toBe(ended.state)
    expect(getBroadcast(again.state, 'b1')?.endedAt).toBe(T0 + 5000)
  })

  it('선언하지 않은 방송·표에 없는 필드·방송 없음은 입력 오류', () => {
    const { state } = server(log.slice(0, 2))
    expectInvalid(state, { type: 'broadcast.end', b: 'b9' }, 'b')
    expectInvalid(state, { type: 'broadcast.end', b: 'b1', at2: 1 }, 'at2')
    expectInvalid(state, { type: 'broadcast.end' }, 'b')
  })
})

describe('AC-S04-05 설정값 검사 함수 (checkSettings)', () => {
  it('문제가 없으면 빈 목록 — 기본값 전부, 빈 객체, MANUAL(미구현은 엔진이 알린다)', () => {
    expect(checkSettings({})).toEqual([])
    expect(checkSettings({ ...DEFAULT_SETTINGS })).toEqual([])
    expect(checkSettings({ 'settlement.groupBy': 'MANUAL' })).toEqual([])
  })

  it.each([null, [], 'LOOSE', 5, undefined, true])('객체가 아니면 키 없는 문제 하나 (%s)', (value) => {
    expect(checkSettings(value)).toEqual([{ key: null, message: expect.stringContaining('객체') }])
  })

  const RANGES: readonly (readonly [string, number, number])[] = [
    ['claim.maxNumber', 1, 9999],
    ['claim.preOpenWindowSec', 0, 300],
    ['waitlist.max', 0, 100],
    ['shipping.baseFee', 0, 1_000_000],
    ['shipping.freeThreshold', 0, 100_000_000],
    ['thanks.batchWindowSec', 0, 600],
  ]
  it.each(RANGES)('%s: 최솟값·최댓값은 받고, 최솟값 - 1·최댓값 + 1·정수가 아닌 수는 문제', (key, min, max) => {
    expect(checkSettings({ [key]: min })).toEqual([])
    expect(checkSettings({ [key]: max })).toEqual([])
    for (const bad of [min - 1, max + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, String(min), null, true, undefined]) {
      if (bad === null && key === 'shipping.freeThreshold') continue
      const problems = checkSettings({ [key]: bad })
      expect(problems, `${key}=${String(bad)}`).toHaveLength(1)
      expect(problems[0]?.key).toBe(key)
      expect(problems[0]?.message).toContain('정수')
    }
  })

  it('무료배송 기준은 null(없음)을 받는다. 문구는 세 자리마다 쉼표', () => {
    expect(checkSettings({ 'shipping.freeThreshold': null })).toEqual([])
    expect(checkSettings({ 'shipping.freeThreshold': -1 })).toEqual([{ key: 'shipping.freeThreshold', message: '비워 두거나 0부터 100,000,000까지의 정수로 적어 주세요' }])
    expect(checkSettings({ 'shipping.baseFee': 1_000_001 })).toEqual([{ key: 'shipping.baseFee', message: '0부터 1,000,000까지의 정수로 적어 주세요' }])
  })

  it('모르는 키·선택지 밖·true/false가 아닌 예/아니오 — 문제마다 키와 쉬운 이유', () => {
    expect(checkSettings({ 'waitlist.maxx': 1, 'claim.parseMode': 'loose', 'claim.ignoreOwner': 'yes', 'print.autoOnConfirm': 1, 'cancel.succession': 'ASK' })).toEqual([
      { key: 'waitlist.maxx', message: '모르는 설정이에요' },
      { key: 'claim.parseMode', message: '고를 수 있는 값이 아니에요' },
      { key: 'claim.ignoreOwner', message: '예나 아니오로만 정할 수 있어요' },
      { key: 'print.autoOnConfirm', message: '예나 아니오로만 정할 수 있어요' },
    ])
  })

  it('문제 문장에는 영어(true·false 같은 값 이름)가 없다 — 서버가 판매자에게 그대로 보여 준다 (SA-S04-004)', () => {
    const bad = { 'waitlist.maxx': 1, 'claim.parseMode': 'loose', 'claim.ignoreOwner': 'yes', 'thanks.liveChat': null, 'print.autoOnConfirm': 1, 'claim.maxNumber': 0, 'shipping.freeThreshold': -1 }
    const messages = [...checkSettings(bad), ...checkSettings(null), ...checkSettings([])].map((p) => p.message)
    expect(messages).toHaveLength(9)
    for (const message of messages) expect(message, message).not.toMatch(/[A-Za-z]/)
  })

  it('자기 속성을 모두 본다 — 열거되지 않는 속성, 기호 키, __proto__ 키. 상속된 속성은 보지 않는다', () => {
    const hidden = {}
    Object.defineProperty(hidden, 'waitlist.max', { value: 101, enumerable: false })
    expect(checkSettings(hidden).map((p) => p.key)).toEqual(['waitlist.max'])
    expect(checkSettings({ [Symbol('x')]: 1 }).map((p) => p.key)).toEqual(['Symbol(x)'])
    expect(checkSettings(JSON.parse('{"__proto__": 1}')).map((p) => p.key)).toEqual(['__proto__'])
    expect(checkSettings(Object.create({ 'waitlist.max': 101 }))).toEqual([])
  })

  it('initEngine: 시작 설정이 범위 밖이면 TypeError(프로그램 오류), MANUAL은 NotImplementedError. resolveSettings는 그대로 검사하지 않는다', () => {
    expect(() => initEngine({ broadcasts: [B1], settings: { 'waitlist.max': 101 } })).toThrow(TypeError)
    expect(() => initEngine({ broadcasts: [], settings: { 'claim.maxNumber': 0 } })).toThrow('claim.maxNumber')
    expect(() => initEngine({ broadcasts: [], settings: [] as unknown as SettingsOverride })).toThrow(TypeError)
    expect(() => initEngine({ broadcasts: [], settings: { 'settlement.groupBy': 'MANUAL' } })).toThrow(NotImplementedError)
    expect(initEngine({ broadcasts: [B1] } as unknown as Parameters<typeof initEngine>[0]).broadcasts[0]?.settings).toEqual(DEFAULT_SETTINGS)
    expect(resolveSettings({ 'waitlist.max': -1 })['waitlist.max']).toBe(-1)
  })

  it('broadcast.start의 설정 검사는 checkSettings와 같은 판정이다 (필드 이름 = settings.<키>)', () => {
    const state = initEngine(EMPTY)
    for (const settings of [{ 'waitlist.max': 101, 'claim.parseMode': 'x' }, { 'thanks.batchWindowSec': 600 }, { nope: 1 }, { 'shipping.freeThreshold': null }]) {
      const problems = checkEvent(state, { seq: 1, at: T0, ...start('b1', settings as SettingsOverride) })
      expect(problems).toEqual(checkSettings(settings).map((p) => ({ field: `settings.${String(p.key)}`, message: p.message })))
    }
  })
})

// ── B. 입력 검사·상태 형식 ───────────────────────────────────────────────

describe('AC-S04-06 표에 없는 필드는 입력 오류 — 모든 종류', () => {
  const { state } = server([start('b1'), register(15), chat('A', '15')])
  const smsBase = { type: 'sms', b: 'b1', ref: 's9', no: 15, received: '20:00' }
  it.each([
    ['sms의 Phone', { ...smsBase, Phone: '010-1234-5678' }, 'Phone'],
    ['sms의 phoneNumber', { ...smsBase, phoneNumber: '01012345678' }, 'phoneNumber'],
    ['sms의 phone_number', { ...smsBase, phone_number: '01012345678' }, 'phone_number'],
    ['sms의 tel', { ...smsBase, tel: '01012345678' }, 'tel'],
    ['sms의 contact', { ...smsBase, contact: '01012345678' }, 'contact'],
    ['sms의 meta: { phone }', { ...smsBase, meta: { phone: '01012345678' } }, 'meta'],
    ['sms의 phone (원문 필드, D-061)', { ...smsBase, phone: '01012345678' }, 'phone'],
    ['chat의 extra', { type: 'chat', b: 'b1', id: 'x1', ch: 'B', nick: 'b', text: '15', extra: 1 }, 'extra'],
    ['host.cancel의 note', { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: 'r', note: '010-1234-5678' }, 'note'],
    ['settlement.payment의 phone', { type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 1, phone: '01012345678' }, 'phone'],
    ['product.register의 memo', { type: 'product.register', b: 'b1', no: 16, name: 'x', price: 1, memo: 'm' }, 'memo'],
    ['host.reopen의 buyer', { type: 'host.reopen', b: 'b1', no: 15, reason: 'r', buyer: 'A' }, 'buyer'],
    ['effect.labelPrinted의 b', { type: 'effect.labelPrinted', effectId: 'c1:PRINT_PRODUCT_LABEL:-:1', b: 'b1' }, 'b'],
    ['값이 undefined여도', { ...smsBase, Phone: undefined }, 'Phone'],
  ] as const)('%s', (_name, event, field) => {
    expectInvalid(state, event, field)
  })

  it('JSON에서 온 __proto__ 자기 속성, 기호 키도 표에 없는 필드다', () => {
    expectInvalid(state, JSON.parse('{"type":"host.blockBuyer","buyer":"A","reason":"r","__proto__":{"phone":"01012345678"}}') as Record<string, unknown>, '__proto__')
    const symbolic = { type: 'host.blockBuyer', buyer: 'A', reason: 'r', [Symbol('phone')]: '01012345678' }
    expect(checkEvent(state, { seq: 99, at: T0, ...symbolic }).map((p) => p.field)).toEqual(['Symbol(phone)'])
    expect(() => applyEvent(state, { seq: 99, at: T0, ...symbolic } as unknown as EngineEvent)).toThrow(InvalidEventError)
  })

  it('서버가 허용 필드로 만드는 이벤트는 모두 통과한다 (선택 필드 포함)', () => {
    const events: Record<string, unknown>[] = [
      start('b2', resolveSettings({})),
      { type: 'broadcast.end', b: 'b1' },
      { type: 'chat', b: 'b1', id: 'x1', ch: 'B', nick: 'b', text: '15', owner: false, publishedAt: T0 },
      { ...smsBase, memo: '김영희 이모', phoneKey: 'k'.repeat(43), phoneLast4: '5678', buyer: 'A' },
      { type: 'host.assign', b: 'b1', no: 15, buyer: 'A', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' },
      { type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 1, memo: '입금자 홍길동' },
    ]
    for (const event of events) expect(checkEvent(state, { seq: 99, at: T0, ...event }), json(event)).toEqual([])
  })
})

// ── 판매자가 적는 칸의 휴대폰 번호 (AC-S04-07, R-1, D-079·D-080) ─────────────
// S04 마무리(AC-S04-93 교체): 숫자 모으기 판단(normalizePhone을 글 전체에)·국가 번호 표기(`+82 10-…`)를 번호로 기대한 항목과
// "applyEvent가 번호 글 칸을 입력 오류로 던진다"는 기대를 D-079·D-080 판단으로 바꿨다 — 글 칸은 containsPhoneRun, ID 칸은 looksLikePhoneId,
// 번호 검사는 기록 전 검사(checkEvent)에서만 하고 재생(applyEvent)은 처리한다.

/** checkEvent만 그 칸을 휴대폰 번호 문제(code PHONE_NUMBER)로 짚고 applyEvent(재생)는 입력 오류 없이 처리한다 (D-079 ⑤). 넘긴 상태는 그대로 */
function expectPhoneRejected(state: EngineState, fields: Record<string, unknown>, field: string): void {
  const event = { seq: 99, at: T0 + 99_000, ...fields }
  const before = json(state)
  const problems = checkEvent(state, event)
  expect(problems, json(fields)).toEqual([{ field, message: expect.any(String) as unknown, code: 'PHONE_NUMBER' }])
  // 문제 문장에 받은 값(번호)을 되풀이하지 않는다
  expect(problems[0]?.message).not.toMatch(/[0-9０-９]{4}/)
  expect(() => applyEvent(state, event as unknown as EngineEvent), json(fields)).not.toThrow()
  expect(json(state)).toBe(before)
}

const accepted = (state: EngineState, fields: Record<string, unknown>): EventProblem[] => checkEvent(state, { seq: 9, at: T0, ...fields })

describe('AC-S04-07 글 칸 — 휴대폰 번호는 기록 전 검사만 거절한다 (D-079·D-080)', () => {
  const { state } = server([start('b1'), register(15), { type: 'chat', b: 'b1', id: 'm1', ch: 'A', nick: 'a', text: '15' }])
  const smsEvent = (fields: Record<string, unknown>): Record<string, unknown> => ({ type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00', ...fields })

  it.each(['01012345678', '010-1234-5678', 's01012345678', '0111234567', 'r_010_1234_5678', 'r-010-1234-5678-2', 'x15-01012345678', '0161234567'])('ref %s → checkEvent만 거절', (ref) => {
    expectPhoneRejected(state, smsEvent({ ref }), 'ref')
  })

  it('ref 형식이 틀리면 구조 오류가 먼저다 — 번호 문제를 따로 더하지 않고 applyEvent도 던진다', () => {
    expectInvalid(state, smsEvent({ ref: '010 1234 5678' }), 'ref')
    expect(checkEvent(state, { seq: 9, at: T0, ...smsEvent({ ref: '010 1234 5678' }) }).some((p) => p.code === 'PHONE_NUMBER')).toBe(false)
  })

  // AC-S04-07의 글 칸 거절 예 전부 + 앞뒤에 다른 숫자가 붙은 번호, 구분자 여러 가지
  it.each([
    '010-1234-5678',
    '김영희 010 1234 5678',
    '01012345678',
    '3시,010,1234,5678',
    '010:1234:5678 3시',
    '3시 010ㅡ1234ㅡ5678',
    '010ㆍ1234ㆍ5678',
    '010ㅣ1234ㅣ5678',
    '010-1234-5678 2개',
    '(010)1234.5678',
    '010 12345678',
    '０１０-１２３４-５６７８',
    '０１０１２３４５６７８',
    '+82 010-1234-5678',
    '+82-010-1234-5678',
    '연락처01012345678',
    '15번 01012345678',
    '김영희 3시 15번 010 1234 5678 2개',
    '010​1234​5678 1개',
    '011-123-4567 3시',
    '010 ㅡ 1234 ㅡ 5678 2개',
    '3시 010~1234~5678',
    '15번 010*1234*5678',
    '010😀1234😀5678',
    '010\n1234\n5678',
  ])('memo %s → checkEvent만 거절', (memo) => {
    expectPhoneRejected(state, smsEvent({ memo }), 'memo')
  })

  it('받는 예 (AC-S04-07): 날짜·금액이 섞인 글, 010을 뺀 8자리, 국가 번호 표기, 주소·시각·수량, 12자리 한 덩어리', () => {
    for (const ref of ['1234567', 's1', 'r-20261018-0001']) expect(accepted(state, smsEvent({ ref })), ref).toEqual([])
    for (const memo of [
      '01/05 3개 25,000원',
      '01/05 구피 30종 1000원',
      '01/05 100,000원 이상 무료',
      '1234-5678',
      '3시 15번 2개',
      '101동 1203호',
      '1,2,3번 각 1개',
      '김영희 이모',
      '010123456789',
      '+82 10-1234-5678',
      '0082 10 1234 5678',
      '김영희010가1234나5678',
      '10/18 15번 2개',
      '2026-10-18 01:30 받음',
      '뒷번호 5678',
      '010-1234',
      '02-123-4567',
      '1~3번 2개씩',
      '10,000원 입금',
      '12:30~13:00 받음',
      '50,000 01,02번',
      '',
    ]) {
      expect(accepted(state, smsEvent({ memo })), memo).toEqual([])
    }
  })

  const PHONES = ['010-1234-5678', '홍길동 010-1234-5678', '3시 010ㅡ1234ㅡ5678', '+82 010-1234-5678', '같은 분 010,1234,5678', '010ㆍ1234ㆍ5678']
  const cases: readonly (readonly [string, (value: string) => Record<string, unknown>, string])[] = [
    ['입금 메모', (v) => ({ type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 1, memo: v }), 'memo'],
    ['방송자 취소 사유', (v) => ({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: v }), 'reason'],
    ['확정 사유(선택)', (v) => ({ type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', reason: v }), 'reason'],
    ['다시 열기 사유', (v) => ({ type: 'host.reopen', b: 'b1', no: 15, reason: v }), 'reason'],
    ['충돌 결정 사유(선택)', (v) => ({ type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'KEEP', reason: v }), 'reason'],
    ['메시지 변환 사유', (v) => ({ type: 'host.convertMessage', b: 'b1', msg: 'm1', no: 15, reason: v }), 'reason'],
    ['차단 사유', (v) => ({ type: 'host.blockBuyer', buyer: 'A', reason: v }), 'reason'],
    ['합치기 사유', (v) => ({ type: 'buyer.merge', from: 'A', into: 'B', reason: v }), 'reason'],
    ['떼어 내기 사유', (v) => ({ type: 'buyer.unmerge', from: 'A', reason: v }), 'reason'],
    ['조정 사유', (v) => ({ type: 'settlement.adjust', buyer: 'A', date: '2026-10-18', amount: -1, reason: v }), 'reason'],
    ['환불 사유', (v) => ({ type: 'settlement.refund', buyer: 'A', date: '2026-10-18', amount: 1, reason: v }), 'reason'],
    ['방송 제목', (v) => start('b2', undefined, '2026-10-18', v), 'title'],
    ['상품 이름(등록)', (v) => ({ type: 'product.register', b: 'b1', no: 16, name: v, price: 1000 }), 'name'],
    ['상품 이름(수정)', (v) => ({ type: 'product.update', b: 'b1', no: 15, name: v }), 'name'],
  ]

  for (const [label, make, field] of cases) {
    it(`${label}: 휴대폰 번호가 들어 있으면 checkEvent만 거절하고 applyEvent는 처리한다`, () => {
      for (const phone of PHONES) expectPhoneRejected(state, make(phone), field)
    })

    it(`${label}: 번호가 아닌 숫자는 받는다 (SA-S04-007 회귀)`, () => {
      for (const value of ['입금자 홍길동', '3시 15번 2개', '101동 1203호', '10,000원 3시', '뒷번호 5678', '1~3번', '01/05 3개 25,000원', '01/05 구피 30종 1000원', '01/05 100,000원 이상 무료', '1234-5678', '+82 10-1234-5678']) {
        expect(accepted(state, make(value)), `${label}: ${value}`).toEqual([])
      }
    })
  }

  it("'01/05 구피 30종 1000원' 방송 제목으로 방송이 시작된다 (SA-S04-007)", () => {
    const { state: next } = server([start('b1'), start('b2', undefined, '2026-10-18', '01/05 구피 30종 1000원')])
    expect(getBroadcast(next, 'b2')?.title).toBe('01/05 구피 30종 1000원')
  })

  it('시청자 쪽 값(chat의 id·ch·nick·text)은 번호가 있어도 검사하지 않는다 — 찜을 버리지 않는다 (R-3)', () => {
    const chatEvent = { type: 'chat', b: 'b1', id: '010-1234-5678', ch: '01012345678', nick: '010 1234 5678', text: '15 010-1234-5678' }
    expect(accepted(state, chatEvent)).toEqual([])
  })

  it('구조 검사가 틀린 사유(빈 글)는 구조 오류 — 번호 문제는 구조 검사를 통과한 칸만', () => {
    expectInvalid(state, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: '  ' }, 'reason')
    expectPhoneRejected(state, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: ' 010-1234-5678 ' }, 'reason')
  })
})

describe('AC-S04-07 ID 칸 — 숫자·구분자로만 된 휴대폰 번호는 기록 전 검사만 거절한다 (D-079 ④, TD-S04-004)', () => {
  const { state } = server([start('b1'), register(15), { type: 'chat', b: 'b1', id: 'm1', ch: 'A', nick: 'a', text: '15' }])
  const cases: readonly (readonly [string, (value: string) => Record<string, unknown>, string])[] = [
    ['차단', (v) => ({ type: 'host.blockBuyer', buyer: v, reason: '노쇼' }), 'buyer'],
    ['차단 풀기', (v) => ({ type: 'host.unblockBuyer', buyer: v, reason: '풀기' }), 'buyer'],
    ['방송자 취소', (v) => ({ type: 'host.cancel', b: 'b1', no: 15, buyer: v, reason: '요청' }), 'buyer'],
    ['확정', (v) => ({ type: 'host.confirm', b: 'b1', no: 15, buyer: v }), 'buyer'],
    ['직접 배정', (v) => ({ type: 'host.assign', b: 'b1', no: 15, buyer: v, reason: '전화 주문' }), 'buyer'],
    ['교체할 1등', (v) => ({ type: 'host.assign', b: 'b1', no: 15, buyer: 'A', reason: '전화 주문', replace: v, replaceTo: 'CANCEL' }), 'replace'],
    ['문자찜 지정 구매자', (v) => ({ type: 'sms', b: 'b1', ref: 's9', no: 15, received: '20:00', buyer: v }), 'buyer'],
    ['입금', (v) => ({ type: 'settlement.payment', buyer: v, date: '2026-10-18', amount: 1000 }), 'buyer'],
    ['배송비 예외', (v) => ({ type: 'settlement.shippingOverride', buyer: v, date: '2026-10-18', mode: 'PICKUP' }), 'buyer'],
    ['조정', (v) => ({ type: 'settlement.adjust', buyer: v, date: '2026-10-18', amount: -500, reason: '할인' }), 'buyer'],
    ['환불', (v) => ({ type: 'settlement.refund', buyer: v, date: '2026-10-18', amount: 500, reason: '환불' }), 'buyer'],
    ['합치기 from', (v) => ({ type: 'buyer.merge', from: v, into: 'A', reason: '같은 사람' }), 'from'],
    ['합치기 into', (v) => ({ type: 'buyer.merge', from: 'A', into: v, reason: '같은 사람' }), 'into'],
    ['떼어 내기 from', (v) => ({ type: 'buyer.unmerge', from: v, reason: '잘못 합침' }), 'from'],
    ['메시지 변환 msg', (v) => ({ type: 'host.convertMessage', b: 'b1', msg: v, no: 15 }), 'msg'],
  ]
  const PHONE_IDS = ['010-5151-6161', '01051516162', '010 5151 6163', '(010)5151-6164', '０１０５１５１６１６５', '010.5151.6166', '010ㅡ5151ㅡ6167']
  const OPAQUE_IDS = ['UC_A', 'sms:s1', 'UC01012345678abcdEFGH_-', 'm1', '1234-5678', '010-5151', '02-123-4567', '+82 10-5151-6161', '010123456789', 'A01051516161']

  for (const [label, make, field] of cases) {
    it(`${label}: 휴대폰 번호 ID → checkEvent만 거절, 영문이 섞인 ID·번호로 정규화되지 않는 값은 받는다`, () => {
      for (const value of PHONE_IDS) expectPhoneRejected(state, make(value), field)
      for (const value of OPAQUE_IDS) expect(accepted(state, make(value)), `${label}: ${value}`).toEqual([])
    })
  }

  it('효과 보고의 effectId·번호 바꾸기의 from(수)은 ID 칸 판단을 하지 않는다', () => {
    expect(accepted(state, { type: 'effect.thanksSent', effectId: '01012345678' })).toEqual([])
    expect(accepted(state, { type: 'product.renumber', b: 'b1', from: 15, to: 16 })).toEqual([])
  })

  it('번호 ID 문제와 구조 문제가 함께 있으면 구조 문제 뒤에 번호 문제가 오고, applyEvent는 구조 문제만 던진다', () => {
    const event = { seq: 9, at: T0, type: 'host.blockBuyer', buyer: '010-5151-6161', reason: '노쇼 010-1234-5678', note: 'x' }
    const problems = checkEvent(state, event)
    expect(problems.map((p) => [p.field, p.code ?? null])).toEqual([
      ['note', null],
      ['buyer', 'PHONE_NUMBER'],
      ['reason', 'PHONE_NUMBER'],
    ])
    let thrown: unknown
    try {
      applyEvent(state, event as unknown as EngineEvent)
    } catch (error) {
      thrown = error
    }
    expect((thrown as InvalidEventError).problems).toEqual([problems[0]])
  })
})

describe('D-079 ⑤ 재생 — applyEvent는 글 칸·ID 칸의 번호 검사를 하지 않는다 (RA-S04-011)', () => {
  // D-079 전 서버가 기록했을 수 있는 로그: 번호가 든 방송 제목·상품 이름·문자찜 메모·사유·입금 메모, 번호 ID 차단·입금
  const oldLog: readonly Record<string, unknown>[] = [
    start('b1', undefined, '2026-10-18', '문자 주문 010-1234-5678'),
    { type: 'product.register', b: 'b1', no: 15, name: '니트 010ㅡ1234ㅡ5678', price: 10000 },
    { type: 'chat', b: 'b1', id: 'm1', ch: 'A', nick: 'a', text: '15' },
    { type: 'sms', b: 'b1', ref: 'r-010-1234-5678-2', no: 15, received: '20:00', memo: '김영희 010 1234 5678' },
    { type: 'host.blockBuyer', buyer: '010-5151-6161', reason: '노쇼 3시,010,1234,5678' },
    { type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 10000, memo: '홍길동 010-1234-5678' },
    { type: 'settlement.payment', buyer: '01051516162', date: '2026-10-18', amount: 5000 },
  ]

  it('기록된 로그를 처음부터 재생해도 입력 오류 없이 모두 처리된다 (기록 전 검사는 이벤트마다 번호 문제를 짚는다)', () => {
    let state = initEngine(EMPTY)
    oldLog.forEach((fields, i) => {
      const event = { at: T0 + i * 1000, ...fields, seq: i + 1 }
      if (i !== 2) expect(checkEvent(state, event).map((p) => p.code), json(fields)).toContain('PHONE_NUMBER')
      state = applyEvent(state, event as unknown as EngineEvent).state
    })
    expect(getBroadcast(state, 'b1')?.title).toBe('문자 주문 010-1234-5678')
    expect(getProduct(state, 'b1', 15)?.name).toBe('니트 010ㅡ1234ㅡ5678')
    expect(listClaims(state).map((c) => c.buyer)).toEqual(['A', 'sms:r-010-1234-5678-2'])
    expect(getSettlement(state, 'A', '2026-10-18')?.received).toBe(10000)
    // 같은 로그를 다시 재생하면 같은 상태 (INV-4)
    expect(json(server(oldLog).state)).toBe(json(state))
  })
})

/** containsPhoneRun을 다른 방식(정규식)으로 다시 적은 기준 — R-1 문장 그대로: 숫자 덩어리·구분자·끊는 글자로 바꾼 뒤 (가)·(나) */
function phoneRunOracle(text: string): boolean {
  const shape = [...text]
    .map((char) => {
      const code = char.codePointAt(0) as number
      if (code >= 0x30 && code <= 0x39) return char
      if (code >= 0xff10 && code <= 0xff19) return String.fromCharCode(code - 0xff10 + 0x30)
      if ('ㅡᅳￚㅣᅵￜㆍᆞ'.includes(char)) return '-'
      return /[\p{L}\p{N}]/u.test(char) ? '|' : '-'
    })
    .join('')
  return /(?<![0-9])01[016789][0-9]{7,8}(?![0-9])/.test(shape) || /(?<![0-9])01[016789]-+(?:[0-9]-*){6,7}[0-9](?![0-9])/.test(shape)
}

describe('containsPhoneRun — 글 칸의 휴대폰 번호 판단 (R-1, D-079 ②, D-080)', () => {
  it.each([
    // (가) 덩어리 하나가 01X로 시작하는 10~11자리
    ['01012345678', true],
    ['0111234567', true],
    ['s01012345678', true],
    ['15번 01012345678', true],
    ['０１０１２３４５６７８', true],
    ['01212345678', false], // 01X의 X는 0·1·6·7·8·9만
    ['010123456789', false], // 12자리 한 덩어리 — 일부만 떼어 보지 않는다
    ['010123456', false], // 9자리
    // (나) 01X 세 자리 덩어리 뒤 덩어리들을 붙여 정확히 7~8자리
    ['010-1234-5678', true],
    ['3시 010-1234-5678', true],
    ['010-1234-5678 2개', true],
    ['010-1234-5678/2개', true],
    ['(010) 1234 5678 김영희', true],
    ['010 － 1234 － 5678', true],
    ['２개 ０１０ １２３４ ５６７８', true],
    ['+82 010 1234 5678', true],
    ['011-123-4567', true],
    ['010 12345678', true],
    ['010 1234567', true],
    ['국민 010-12-345678', true], // 01X로 시작하는 계좌번호도 거른다 — 다시 적으면 되는 안전 쪽 비용
    ['0-010-1234-5678', true], // 앞 덩어리는 상관없다
    ['010,1234,5678,9', true], // 8자리가 되는 곳이 있으면
    ['010,1234,56789', false], // 4+5 = 9 — 정확히 7·8이 되는 곳이 없다
    ['010 123456', false], // 6자리
    ['0101 234 5678', false], // 시작 덩어리가 01X 세 자리가 아니다
    ['2010,1234,5678', false],
    // 구분자: 글자·숫자가 아닌 모든 글자 + 자모 ㅡ·ㅣ·ㆍ (호환·조합형·반각)
    ['3시 010ㅡ1234ㅡ5678', true],
    ['3시 010ᅳ1234ᅳ5678', true],
    ['3시 010ￚ1234ￚ5678', true],
    ['010ㅣ1234ㅣ5678', true],
    ['010ᅵ1234ᅵ5678', true],
    ['010ￜ1234ￜ5678', true],
    ['010ㆍ1234ㆍ5678', true],
    ['010ᆞ1234ᆞ5678', true],
    ['3시 010─1234─5678', true],
    ['3시 010～1234～5678', true],
    ['15번 010＊1234＊5678', true],
    ['3시,010,1234,5678', true],
    ['３시，０１０，１２３４，５６７８', true],
    ['010:1234:5678 3시', true],
    ['12:30~13:00 010:1234:5678', true],
    ['011;123;4567 2개', true],
    ['010😀1234😀5678', true],
    ['010́1234́5678', true], // 결합 부호도 글자·숫자가 아니다
    // 끊는 글자: 한글 음절·영문·가나·다른 숫자 문자
    ['김영희010가1234나5678', false], // 숫자를 모두 모으면 번호 모양이지만 모으지 않는다 (D-079 ①)
    ['010a1234b5678', false],
    ['3시 010ー1234ー5678', false], // ー(U+30FC)는 글자(가나 장음)
    ['010①1234①5678', false],
    ['٠١٠١٢٣٤٥٦٧٨', false], // 아라비아 숫자는 숫자 덩어리가 아니다
    // 받는 글 (AC-S04-07)
    ['01/05 3개 25,000원', false],
    ['01/05 구피 30종 1000원', false],
    ['01/05 100,000원 이상 무료', false],
    ['1234-5678', false],
    ['3시 15번 2개', false],
    ['101동 1203호', false],
    ['1,2,3번 각 1개', false],
    ['r-20261018-0001', false],
    ['+82 10-1234-5678', false], // 국가 번호 표기
    ['+821012345678', false],
    ['0082-10-1234-5678', false],
    ['2026-10-18 01:30', false],
    ['10/18 15번 2개', false],
    ['뒷번호 5678', false],
    ['010-1234', false],
    ['02-123-4567', false],
    ['10-1234-5678', false],
    ['1982 10 1234 5678', false],
    ['1~3번 2개씩', false],
    ['3*2개', false],
    ['10,000원', false],
    ['50,000 01,02번', false],
    ['12:30~13:00', false],
    ['', false],
  ])('%s → %s', (text, expected) => {
    expect(containsPhoneRun(text)).toBe(expected)
    expect(phoneRunOracle(text), `기준: ${text}`).toBe(expected)
  })

  it('문자열이 아니면 false', () => {
    for (const value of [null, undefined, 1012345678, ['010-1234-5678'], { memo: '010-1234-5678' }]) expect(containsPhoneRun(value as unknown as string)).toBe(false)
  })

  it('containsPhoneNumber는 containsPhoneRun과 같은 함수다 (다른 판단이 둘 있으면 안 된다, AC-S04-07)', () => {
    expect(containsPhoneNumber).toBe(containsPhoneRun)
  })

  const PIECES = ['010', '011', '016', '019', '012', '01', '0', '1', '5', '1234', '5678', '12345678', '1234567', '０１０', '１２３４']
  const SEPARATORS = [' ', '-', ',', '.', '/', ':', '(', ')', '+', '~', 'ㅡ', 'ㆍ', 'ㅣ', '​', '\n', '😀', '－']
  const BREAKERS = ['가', '번', 'a', 'Z', 'ー', '①', '٣']
  const textArb = fc.array(fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...PIECES) }, { weight: 3, arbitrary: fc.constantFrom(...SEPARATORS) }, { weight: 1, arbitrary: fc.constantFrom(...BREAKERS) }), { maxLength: 12 }).map((parts) => parts.join(''))

  it('속성: 정규식으로 다시 적은 기준과 늘 같다 (덩어리·배열 판단만, 숫자 모으기 없음)', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        expect(containsPhoneRun(text), text).toBe(phoneRunOracle(text))
      }),
      { numRuns: 3000, seed: 20261019 },
    )
  })

  const NOT_DIGIT = fc.constantFrom(' ', '-', '.', '/', '(', ')', '+', '_', '번', '시', '개', 'a', ':', ',', '　', '​')
  const anyText = fc.array(fc.oneof(fc.constantFrom(...'0123456789'), NOT_DIGIT, fc.constantFrom('김', '영', '희', '０', '８')), { maxLength: 16 }).map((chars) => chars.join(''))

  it('속성: 휴대폰 번호(여러 형식) 앞뒤에 아무 글이 붙어도, 숫자가 아닌 글자로 띄우면 true', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), fc.nat(4), anyText, NOT_DIGIT, NOT_DIGIT, anyText, (digits, form, before, left, right, after) => {
        const d = String(digits).padStart(8, '0')
        const phone = [`010${d}`, `010-${d.slice(0, 4)}-${d.slice(4)}`, `010 ${d.slice(0, 4)} ${d.slice(4)}`, `+82 010-${d.slice(0, 4)}-${d.slice(4)}`, `(010)${d.slice(0, 4)}.${d.slice(4)}`][form] as string
        const text = `${before}${left}${phone}${right}${after}`
        expect(containsPhoneRun(text), text).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('속성: 0으로 시작하는 숫자 덩어리가 없으면 false (번호는 01X로 시작한다)', () => {
    const run = fc.integer({ min: 1, max: 7 }).chain((first) => fc.array(fc.constantFrom(...'0123456789'), { maxLength: 5 }).map((rest) => `${String(first === 7 ? 9 : first)}${rest.join('')}`))
    fc.assert(
      fc.property(fc.array(fc.tuple(run, NOT_DIGIT), { maxLength: 8 }), (parts) => {
        const text = parts.map(([r, sep]) => `${r}${sep}`).join('')
        expect(containsPhoneRun(text), text).toBe(false)
      }),
      { numRuns: 500 },
    )
  })
})

describe('looksLikePhoneId — ID 칸의 휴대폰 번호 판단 (R-1, D-079 ④)', () => {
  it.each([
    ['010-5151-6161', true],
    ['01051516162', true],
    ['010 5151 6163', true],
    ['(010)5151-6164', true],
    ['０１０５１５１６１６５', true],
    ['010ㅡ5151ㅡ6166', true],
    ['010ㆍ5151ㆍ6167', true],
    [' 010-5151-6168 ', true],
    ['0125151616', true], // normalizePhone 결과가 있다 (R-11은 01 + 8~9자리)
    ['UC_A', false],
    ['sms:s1', false],
    ['UC01012345678abcdEFGH_-', false],
    ['A01051516161', false],
    ['01051516161a', false],
    ['m1', false],
    ['1234-5678', false],
    ['010-5151', false],
    ['02-123-4567', false],
    ['+82 10-5151-6161', false],
    ['010123456789', false],
    ['010①5151①6161', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(looksLikePhoneId(value)).toBe(expected)
  })

  it('문자열이 아니면 false', () => {
    for (const value of [null, undefined, 1051516161, ['01051516161']]) expect(looksLikePhoneId(value as unknown as string)).toBe(false)
  })

  const B64URL = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_']
  it('속성: 영문이 하나라도 섞인 값(불투명 ID)은 늘 false', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...B64URL, '0', '1', '0', '1'), { maxLength: 80 }), fc.constantFrom(...'abcXYZ가'), fc.nat(), (chars, letter, at) => {
        const s = chars.join('')
        const i = at % (s.length + 1)
        const value = `${s.slice(0, i)}${letter}${s.slice(i)}`
        expect(looksLikePhoneId(value), value).toBe(false)
      }),
      { numRuns: 1000, seed: 20261019 },
    )
  })

  it('속성: 숫자와 구분자로만 된 값이면 normalizePhone 결과가 있을 때만 true', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('0', '1', '0', '1', '5', '6', '-', ' ', '.', '(', ')', 'ㅡ', '０', '１'), { maxLength: 16 }), (chars) => {
        const value = chars.join('')
        expect(looksLikePhoneId(value), value).toBe(normalizePhone(value) !== null)
      }),
      { numRuns: 1000 },
    )
  })
})

describe('AC-S04-08 상태 형식 확인', () => {
  const { state } = server([start('b1'), register(15), chat('A', '15')])
  const event = { seq: 9, at: T0 + 9000, type: 'chat', b: 'b1', id: 'x9', ch: 'B', nick: 'b', text: '15' } as EngineEvent

  it('지금 형식 번호를 내보내고, 새 상태·JSON 왕복한 상태는 그 형식이다', () => {
    expect(STATE_FORMAT).toBe(4)
    expect(state.format).toBe(STATE_FORMAT)
    expect(() => applyEvent(JSON.parse(json(state)) as EngineState, event)).not.toThrow()
  })

  it.each([
    ['이전 형식 3', { ...state, format: 3 }, 3, '받은 형식: 3'],
    ['형식 없음', (({ format: _f, ...rest }) => rest)(state), null, '형식 번호 없음'],
    ['형식이 문자열', { ...state, format: '4' }, null, '형식 번호 없음'],
    ['null', null, null, '상태가 객체가 아님'],
    ['배열', [], null, '상태가 객체가 아님'],
    ['문자열', 'state', null, '상태가 객체가 아님'],
  ] as const)('%s → StateFormatError (입력 오류·미구현과 구별), 아무것도 바꾸지 않는다', (_name, wrong, received, shown) => {
    const before = json(wrong)
    for (const call of [() => applyEvent(wrong as unknown as EngineState, event), () => checkEvent(wrong as unknown as EngineState, event)]) {
      let thrown: unknown
      try {
        call()
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(StateFormatError)
      expect(isStateFormatError(thrown)).toBe(true)
      expect(isInvalidEvent(thrown)).toBe(false)
      expect(isNotImplemented(thrown)).toBe(false)
      expect((thrown as StateFormatError).received).toBe(received)
      expect((thrown as StateFormatError).supported).toBe(4)
      expect((thrown as StateFormatError).message).toContain(shown)
      expect((thrown as StateFormatError).message).toContain('지원 형식: 4')
    }
    expect(json(wrong)).toBe(before)
    expect(isStateFormatError(new Error('상태 형식이 다르다'))).toBe(false)
  })

  it('형식 검사는 이벤트 검사보다 먼저다 (형식이 다르면 이벤트가 틀려도 StateFormatError)', () => {
    expect(() => checkEvent({ ...state, format: 3 } as unknown as EngineState, null)).toThrow(StateFormatError)
  })
})

// ── C. 넘어온 판정 규칙 ──────────────────────────────────────────────────

describe('AC-S04-10 취소 메시지는 찜으로 바꾸지 않는다', () => {
  const convert = (msg: string, no: number): EventInput => ({ type: 'host.convertMessage', b: 'b1', msg, no })

  it.each(['OFF', 'REQUEST', 'AUTO'] as const)('cancel.buyerChat=%s: 찜 없는 취소·자기 찜 취소·남의 찜 취소 메시지 모두 어느 번호로도 아무 일도 없다', (mode) => {
    const { state } = play([register(15), register(16), chat('A', '15'), chat('B', '15 취소', { id: 'mb' }), chat('A', '15번 취소요 ㅠㅠ', { id: 'ma' }), chat('C', '16 취소', { id: 'mc' })], { 'cancel.buyerChat': mode })
    for (const [msg, no] of [['mb', 15], ['mb', 16], ['ma', 16], ['ma', 15], ['mc', 16]] as const) {
      const result = applyEvent(state, { seq: 99, at: T0 + 99_000, ...convert(msg, no) } as EngineEvent)
      expect(result.state, `${mode} ${msg}→${String(no)}`).toBe(state)
    }
  })

  it('LOOSE: "15 취소할게요 죄송해요"·"15번 취소 😭 죄송해요"(취소)는 변환 안 됨, "15번 사려다 취소"(언급)는 변환됨', () => {
    const { state } = play([register(15), chat('A', '15 취소할게요 죄송해요', { id: 'm1' }), chat('B', '15번 취소 😭 죄송해요', { id: 'm2' }), chat('C', '15번 사려다 취소', { id: 'm3' })], { 'claim.parseMode': 'LOOSE' })
    expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...convert('m1', 15) } as EngineEvent).state).toBe(state)
    expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...convert('m2', 15) } as EngineEvent).state).toBe(state)
    const converted = applyEvent(state, { seq: 9, at: T0 + 9000, ...convert('m3', 15) } as EngineEvent).state
    expect(getProduct(converted, 'b1', 15)?.winners).toEqual(['C'])
  })

  it('STRICT의 취소 꼬리 이모지도 취소 메시지 — 변환 안 됨. 한글 수사·언급 메시지는 S03b 그대로 번호마다 한 번', () => {
    const { state } = play([register(15), register(16), chat('A', '15번 취소 😭', { id: 'm1' }), chat('B', '십오번이요', { id: 'm2' })])
    expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...convert('m1', 15) } as EngineEvent).state).toBe(state)
    const once = applyEvent(state, { seq: 9, at: T0 + 9000, ...convert('m2', 15) } as EngineEvent).state
    expect(getProduct(once, 'b1', 15)?.winners).toEqual(['B'])
    expect(applyEvent(once, { seq: 10, at: T0 + 10_000, ...convert('m2', 15) } as EngineEvent).state).toBe(once)
  })
})

describe('AC-S04-11 대기 한도 0이면 승계=묻기는 자동 승계와 같다', () => {
  const ASK0 = { 'cancel.succession': 'ASK', 'waitlist.max': 0 } as const
  /** A의 언급 메시지(m0)를 변환해 B의 1등과 충돌 (재고 stock) */
  const conflicted = (settings: SettingsOverride, stock = 1, more: readonly EventInput[] = []): EventInput[] => [
    register(15, { stock }),
    chat('A', '15번이용ㅎ', { id: 'm0' }),
    chat('B', '15'),
    ...more,
    { type: 'host.convertMessage', b: 'b1', msg: 'm0', no: 15 },
  ]

  it('취소 승인: 풀린 충돌 찜이 확정(확정버전 +1, 확정 효과), 아무도 품절되지 않고 표시도 없다', () => {
    const { state } = play([...conflicted(ASK0), chat('B', '15 취소'), { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'B' }], ASK0)
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['A'], waitlist: [], conflict: false, awaitingSuccession: false, confirmVersion: 2, status: 'SOLD' })
    expect(listClaims(state).some((c) => c.reason === 'SOLD_OUT')).toBe(false)
    expect(listEffects(state).filter((e) => e.buyer === 'A').map((e) => [e.kind, e.confirmVersion, e.status])).toEqual([
      ['PRINT_PRODUCT_LABEL', 2, 'PENDING'],
      ['POST_THANKS', 2, 'PENDING'],
    ])
  })

  it('시청자 자동 취소(AUTO): 1등이 "15 취소"를 쓰면 풀린 충돌 찜이 확정', () => {
    const settings = { ...ASK0, 'cancel.buyerChat': 'AUTO' } as const
    const { state } = play([...conflicted(settings), chat('B', '15 취소')], settings)
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['A'], waitlist: [], awaitingSuccession: false })
    expect(listClaims(state).map((c) => [c.buyer, c.status])).toEqual([
      ['B', 'CANCELLED'],
      ['A', 'CONFIRMED'],
    ])
  })

  it('재고 2: 1등 둘 중 하나를 취소하면 풀린 충돌 찜이 그 자리를 채운다', () => {
    const { state } = play([...conflicted(ASK0, 2, [chat('C', '15')]), host('host.reject', 15, 'C')], ASK0)
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['B', 'A'], waitlist: [], awaitingSuccession: false, confirmVersion: 3 })
    expect(listClaims(state).some((c) => c.reason === 'SOLD_OUT')).toBe(false)
  })

  it('충돌이 없으면(대기가 늘 비어 있다) 표시 없이 판매 중', () => {
    const { state } = play([register(15), chat('B', '15'), chat('C', '15'), host('host.cancel', 15, 'B')], ASK0)
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: [], waitlist: [], awaitingSuccession: false, status: 'OPEN' })
    expect(listClaims(state).map((c) => [c.buyer, c.status, c.reason])).toEqual([
      ['B', 'CANCELLED', null],
      ['C', 'REJECTED', 'SOLD_OUT'],
    ])
  })

  it('대기 한도 1의 ASK는 그대로 승계 결정 필요, 대기 한도 0의 REOPEN은 충돌 찜도 정리', () => {
    const ask1 = play([...conflicted({ 'cancel.succession': 'ASK', 'waitlist.max': 1 }), host('host.cancel', 15, 'B')], { 'cancel.succession': 'ASK', 'waitlist.max': 1 }).state
    expect(getProduct(ask1, 'b1', 15)).toMatchObject({ winners: [], waitlist: ['A'], awaitingSuccession: true })
    const reopen = play([...conflicted({ 'cancel.succession': 'REOPEN', 'waitlist.max': 0 }), host('host.cancel', 15, 'B')], { 'cancel.succession': 'REOPEN', 'waitlist.max': 0 }).state
    expect(listClaims(reopen).find((c) => c.buyer === 'A')).toMatchObject({ status: 'REJECTED', reason: 'WAITLIST_CLEARED' })
  })
})
