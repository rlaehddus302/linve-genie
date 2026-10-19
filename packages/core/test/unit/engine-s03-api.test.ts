// AC-S03-01 엔진 API 확장, AC-S03-03 순수·결정성·직렬화(S03 이벤트 포함), AC-S03-04 맞지 않는 명령(S03 이벤트마다).
import { spawnSync } from 'node:child_process'
import * as core from '@livejjim/core'
import { applyEvent, checkEvent, initEngine, listClaims, listEffects, listSettlements, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, T0, chat, kst, play, register, sms, type EventInput } from './engine-helpers.ts'

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

describe('AC-S03-01 엔진 API 확장', () => {
  it('입력 검사·순수 도우미·S03 조회 함수를 export한다', () => {
    for (const name of [
      'checkEvent',
      'isInvalidEvent',
      'normalizePhone',
      'phoneLast4',
      'resolveReceivedTime',
      'isValidReceivedTime',
      'isValidDate',
      'rankKey',
      'compareRank',
      'isSameMinuteTie',
      'settle',
      'currentBuyerOf',
      'buyerOfRef',
      'listSmsRefs',
    ] as const) {
      expect(core[name], name).toBeTypeOf('function')
    }
    expect(new core.InvalidEventError('sms', [{ field: 'no', message: 'x' }])).toBeInstanceOf(Error)
    expect(core.EVENT_TYPES).toEqual(expect.arrayContaining(['sms', 'product.update', 'product.renumber', 'host.convertMessage', 'host.resolveConflict', 'buyer.merge', 'buyer.unmerge', 'settlement.shippingOverride', 'settlement.adjust', 'settlement.payment', 'settlement.refund']))
    expect(core.EVENT_TYPES).not.toContain('broadcast.start')
  })

  it('S03 이벤트·RECEIVED_TIME에서 미구현을 알리지 않는다', () => {
    let state = initEngine({ broadcasts: [B1], settings: { 'contention.policy': 'RECEIVED_TIME' } })
    const events: EngineEvent[] = [
      { seq: 1, at: 0, type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      { seq: 2, at: 1, type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15번이요' },
      { seq: 3, at: 2, type: 'sms', b: 'b1', ref: 's1', no: 15, received: '09:00', memo: '이모', phone: '010-1234-5678' },
      { seq: 4, at: 3, type: 'host.convertMessage', b: 'b1', msg: 'm1', no: 15 },
      { seq: 5, at: 4, type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'KEEP' },
      { seq: 6, at: 5, type: 'product.update', b: 'b1', no: 15, price: 12000, stock: 2, applyTo: 'UNPAID_CLAIMS' },
      { seq: 7, at: 6, type: 'product.renumber', b: 'b1', from: 15, to: 51 },
      { seq: 8, at: 7, type: 'buyer.merge', from: 'UC_A', into: 'sms:s1', reason: '같은 사람' },
      { seq: 9, at: 8, type: 'buyer.unmerge', from: 'UC_A', reason: '잘못' },
      { seq: 10, at: 9, type: 'settlement.shippingOverride', buyer: 'UC_A', date: '2026-10-18', mode: 'DEFAULT' },
      { seq: 11, at: 10, type: 'settlement.adjust', buyer: 'UC_A', date: '2026-10-18', amount: -1000, reason: '할인' },
      { seq: 12, at: 11, type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-18', amount: 1000 },
      { seq: 13, at: 12, type: 'settlement.refund', buyer: 'UC_A', date: '2026-10-18', amount: 1000, reason: '환불' },
    ]
    for (const event of events) {
      expect(() => (state = applyEvent(state, event).state), event.type).not.toThrow()
    }
    expect(listClaims(state).length).toBeGreaterThan(0)
  })
})

/** 문자찜·실제 시각순·충돌·변환·상품 수정·번호 변경·합치기·정산 기록을 섞은 대표 로그 */
const LOG: readonly EventInput[] = [
  register(15, { at: kst(20) }),
  register(16, { stock: 2, at: kst(20) }),
  chat('A', '15', { at: kst(20, 0, 10) }),
  { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) },
  sms('s1', 15, '20:00:05', { at: kst(20, 0, 20), phone: '010-1234-5678', memo: '이모' }),
  chat('B', '16', { at: kst(20, 0, 21), id: 'mb' }),
  sms('s2', 16, '20:00', { at: kst(20, 0, 30), phone: '01012345678' }),
  chat('C', '15번요', { at: kst(20, 0, 31), id: 'mc', publishedAt: kst(20, 0, 1) }),
  { type: 'host.convertMessage', b: 'b1', msg: 'mc', no: 16, at: kst(20, 0, 40) },
  { type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'SWITCH', at: kst(20, 0, 41) },
  { type: 'settlement.payment', buyer: 'sms:s1', date: '2026-10-18', amount: 5000, at: kst(20, 1) },
  { type: 'product.update', b: 'b1', no: 16, price: 9000, stock: 3, applyTo: 'UNPAID_CLAIMS', at: kst(20, 1, 1) },
  { type: 'buyer.merge', from: 'B', into: 'sms:s1', reason: '같은 사람', at: kst(20, 1, 2) },
  { type: 'product.renumber', b: 'b1', from: 16, to: 61, at: kst(20, 1, 3) },
  { type: 'settlement.adjust', buyer: 'B', date: '2026-10-18', amount: -500, reason: '할인', at: kst(20, 1, 4) },
  { type: 'buyer.unmerge', from: 'B', reason: '따로', at: kst(20, 1, 5) },
  { type: 'settlement.refund', buyer: 'sms:s1', date: '2026-10-18', amount: 5000, reason: '환불', at: kst(20, 1, 6) },
]
const SETTINGS = { 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': 'HOST' } as const
const full = (i: number): EngineEvent => ({ at: T0 + i * 1000, ...LOG[i], seq: i + 1 }) as EngineEvent

describe('AC-S03-03 순수·결정성·직렬화 (S03 이벤트 포함)', () => {
  it('깊게 얼린 상태·이벤트로 호출해도 같은 결과, 넘긴 상태·이벤트를 바꾸지 않는다', () => {
    const { states } = play(LOG, SETTINGS)
    LOG.forEach((_event, i) => {
      const frozen = deepFreeze(structuredClone(states[i]) as EngineState)
      const before = JSON.stringify(frozen)
      const event = deepFreeze(full(i))
      expect(JSON.stringify(applyEvent(frozen, event).state)).toBe(JSON.stringify(states[i + 1]))
      expect(JSON.stringify(frozen)).toBe(before)
    })
  })

  it('같은 로그 두 번 → 같은 상태·효과, 어느 지점에서 JSON 왕복 뒤 이어서 적용해도 같다, 찜 ID·효과 ID가 같다', () => {
    const a = play(LOG, SETTINGS)
    const b = play(LOG, SETTINGS)
    expect(a.states.map((s) => JSON.stringify(s))).toEqual(b.states.map((s) => JSON.stringify(s)))
    expect(JSON.stringify(a.emitted)).toBe(JSON.stringify(b.emitted))
    for (let k = 0; k <= LOG.length; k++) {
      let state = JSON.parse(JSON.stringify(a.states[k])) as EngineState
      for (let i = k; i < LOG.length; i++) state = applyEvent(state, full(i)).state
      expect(JSON.stringify(state), `왕복 지점 ${String(k)}`).toBe(JSON.stringify(a.state))
    }
    // 이 로그가 S03 경로를 실제로 지나는지
    expect(listClaims(a.state).map((c) => c.status)).toEqual(expect.arrayContaining(['CONFIRMED', 'WAITLISTED', 'REJECTED']))
    expect(listEffects(a.state).length).toBeGreaterThan(4)
  })

  it('실행 환경의 시간대와 무관하다 (다른 TZ의 자식 프로세스)', () => {
    const script = [
      "import { initEngine, applyEvent, listEffects, listSettlements, listClaims } from '@livejjim/core'",
      `const log = ${JSON.stringify(LOG.map((_e, i) => full(i)))}`,
      `let state = initEngine({ broadcasts: [${JSON.stringify(B1)}], settings: ${JSON.stringify(SETTINGS)} })`,
      'for (const e of log) state = applyEvent(state, e).state',
      'process.stdout.write(JSON.stringify([state, listEffects(state), listSettlements(state), listClaims(state)]))',
    ].join('\n')
    const outputs = ['Asia/Seoul', 'UTC', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Chatham'].map((tz) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ: tz } })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout
    })
    expect(new Set(outputs).size).toBe(1)
    expect(JSON.parse(outputs[0] as string)[0]).toEqual(JSON.parse(JSON.stringify(play(LOG, SETTINGS).state)))
    expect(listSettlements(play(LOG, SETTINGS).state).length).toBeGreaterThan(0)
  })
})

describe('AC-S03-04 맞지 않는 명령은 아무것도 바꾸지 않는다 (S03 이벤트)', () => {
  // 15번: A 확정(c1), B 대기(c2). 16번(재고 2): C·D 확정. 17번 닫힘. s1 문자찜 18번 보류. H는 채팅만. E→F 합침. F 입금 1,000(10-18)
  const { state } = play([
    register(15),
    register(16, { stock: 2 }),
    register(17),
    { type: 'product.close', b: 'b1', no: 17 },
    chat('A', '15', { id: 'ma' }),
    chat('B', '15'),
    chat('C', '16'),
    chat('D', '16'),
    chat('O', '15', { id: 'mo', owner: true }),
    sms('s1', 18, '20:00'),
    chat('H', '안녕', { id: 'mh' }),
    chat('E', '안녕'),
    chat('F', '안녕'),
    { type: 'buyer.merge', from: 'E', into: 'F', reason: 'r' },
    { type: 'settlement.payment', buyer: 'F', date: '2026-10-18', amount: 1000 },
    { type: 'settlement.refund', buyer: 'E', date: '2026-10-18', amount: 1000, reason: 'r' },
  ])
  const commands: readonly (readonly [string, Record<string, unknown>])[] = [
    ['모르는 지정 구매자의 문자찜', { type: 'sms', b: 'b1', ref: 's9', no: 15, received: '20:00', buyer: 'ZZ' }],
    ['이미 받은 ref의 문자찜', { type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00', memo: '다른 메모' }],
    ['없는 상품의 수정', { type: 'product.update', b: 'b1', no: 99, price: 1 }],
    ['재고를 확정 수보다 작게 (품종·가격 포함)', { type: 'product.update', b: 'b1', no: 16, stock: 1, name: '라울', price: 1 }],
    ['같은 값만 적은 수정', { type: 'product.update', b: 'b1', no: 15, name: '핑크프릴', price: 10000, stock: 1, applyTo: 'UNPAID_CLAIMS' }],
    ['없는 상품의 번호 변경', { type: 'product.renumber', b: 'b1', from: 99, to: 98 }],
    ['있는 번호로 번호 변경', { type: 'product.renumber', b: 'b1', from: 15, to: 16 }],
    ['닫힌 상품의 번호로 번호 변경', { type: 'product.renumber', b: 'b1', from: 15, to: 17 }],
    ['같은 번호로 번호 변경', { type: 'product.renumber', b: 'b1', from: 15, to: 15 }],
    ['보류 찜만 있는 번호의 번호 변경', { type: 'product.renumber', b: 'b1', from: 18, to: 19 }],
    ['충돌 없는 상품의 결정', { type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'SWITCH' }],
    ['모르는 메시지의 변환', { type: 'host.convertMessage', b: 'b1', msg: 'nope', no: 15 }],
    ['무시한 방송자 메시지의 변환', { type: 'host.convertMessage', b: 'b1', msg: 'mo', no: 16 }],
    ['이미 그 번호의 찜을 만든 메시지의 변환', { type: 'host.convertMessage', b: 'b1', msg: 'ma', no: 15 }],
    ['같은 사람 반복이 되는 변환', { type: 'host.convertMessage', b: 'b1', msg: 'ma', no: 15 }],
    ['모르는 구매자 합치기', { type: 'buyer.merge', from: 'ZZ', into: 'A', reason: 'r' }],
    ['모르는 구매자에게 합치기', { type: 'buyer.merge', from: 'A', into: 'ZZ', reason: 'r' }],
    ['자기 자신과 합치기', { type: 'buyer.merge', from: 'A', into: 'A', reason: 'r' }],
    ['고리가 되는 합치기', { type: 'buyer.merge', from: 'F', into: 'E', reason: 'r' }],
    ['이미 합쳐진 구매자 합치기', { type: 'buyer.merge', from: 'E', into: 'H', reason: 'r' }],
    ['확정 찜이 둘이 되는 합치기', { type: 'buyer.merge', from: 'C', into: 'D', reason: 'r' }],
    ['합쳐지지 않은 구매자 떼어 내기', { type: 'buyer.unmerge', from: 'F', reason: 'r' }],
    ['받은 금액이 음수가 되는 떼어 내기', { type: 'buyer.unmerge', from: 'E', reason: 'r' }],
    ['엔진이 모르는 구매자의 입금', { type: 'settlement.payment', buyer: 'ZZ', date: '2026-10-18', amount: 1 }],
    ['엔진이 모르는 구매자의 배송비 예외', { type: 'settlement.shippingOverride', buyer: 'ZZ', date: '2026-10-18', mode: 'PICKUP' }],
    ['받은 금액보다 큰 환불', { type: 'settlement.refund', buyer: 'A', date: '2026-10-18', amount: 1, reason: 'r' }],
  ]

  it.each(commands)('%s → 형식은 맞고, 같은 상태 객체, 효과 없음', (_name, command) => {
    const event = { seq: 99, at: T0 + 99_000, ...command }
    expect(checkEvent(state, event)).toEqual([])
    const result = applyEvent(state, event as unknown as EngineEvent)
    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  })
})
