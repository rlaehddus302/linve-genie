// AC-S02-91 골든 어댑터: observe는 조회 함수 결과를 이름·모양만 바꿔 옮기고, invariants는 checkInvariants를 부르며,
// 효과 보고는 README 규칙("가장 최근에 나온, 취소되지 않은 해당 효과")으로 효과 ID를 찾아 엔진에 넘긴다.
import {
  NotImplementedError,
  activeClaimId,
  applyEvent,
  buyerOfRef,
  getBroadcast,
  getBuyer,
  listBuyers,
  listClaims,
  listEffects,
  listSettlements,
  listSmsRefs,
  normalizePhone,
  parseChat,
  type EngineEvent,
  type EngineState,
  type SmsEvent,
} from '@livejjim/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runGoldenDir } from './fs-runner.ts'
import { pdelete, pget, pset } from '../../src/engine/pmap.ts'
import { play as playEvents, sms, type EventInput } from '../unit/engine-helpers.ts'
import { realCore, reportTarget, toEngineEvent, toSnapshot } from './core-adapter.ts'
import { smsPhoneFields, testPhoneKey } from './phone-key.ts'
import { snapshotIssues } from './snapshot-check.ts'
import { run, scenario } from './test-helpers.ts'
import type { GoldenCore, GoldenEvent } from './types.ts'

function play(events: readonly EventInput[], settings = {}): EngineState {
  return playEvents(events, settings).state
}

const golden = (fields: Record<string, unknown>, seq = 99): GoldenEvent => ({ seq, at: 2_000_000, ...fields }) as GoldenEvent

describe('observe — 조회 함수 결과를 이름·모양만 바꿔 옮긴다', () => {
  const state = play(
    [
      { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      { type: 'product.register', b: 'b1', no: 16, name: '', price: 800, status: 'READY' },
      { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
      { type: 'chat', b: 'b1', id: 'm2', ch: 'UC_B', nick: '김철수', text: '15' },
      { type: 'chat', b: 'b1', id: 'm3', ch: 'UC_B', nick: '철수', text: '16' },
      { type: 'chat', b: 'b1', id: 'm4', ch: 'UC_A', nick: '홍길동', text: '15 취소' },
      { type: 'host.blockBuyer', buyer: 'UC_X', reason: '장난' },
      { type: 'chat', b: 'b1', id: 'm5', ch: 'UC_X', nick: '장난꾼', text: '15' },
    ],
    { 'thanks.videoComment': 'PER_SALE' },
  )
  const snapshot = toSnapshot(state)

  it('형식 검사를 통과한다', () => {
    expect(snapshotIssues(snapshot)).toEqual([])
  })

  it('상품·구매자·정산·찜·보류·취소 요청·구매자 키', () => {
    expect(snapshot.buyerKeys).toEqual({ UC_A: 'UC_A', UC_B: 'UC_B', UC_X: 'UC_X' })
    expect(snapshot.products).toEqual({
      // confirmVersion: 확정 횟수 (N5 새 검사 키 — AC-N5-04, D-N5-14). 관찰에 더한 키라 기대값에도 더했다(교체)
      'b1/15': { status: 'SOLD', winners: ['UC_A'], waitlist: ['UC_B'], conflict: false, price: 10000, priceHistory: [], confirmedUnits: 1, confirmVersion: 1, hasOptions: false },
      'b1/16': { status: 'READY', winners: [], waitlist: [], conflict: false, price: 800, priceHistory: [], confirmedUnits: 0, confirmVersion: 0, hasOptions: false },
    })
    // O1: 옵션 상품이 없으면 변형도 확인 필요 항목도 없다
    expect(snapshot.variants).toEqual({})
    expect(snapshot.reviews).toEqual([])
    expect(snapshot.buyers.UC_B).toEqual({ display: '철수', nameHistory: ['김철수', '철수'], items: [], subtotal: 0, byBroadcast: {}, phoneLast4: null })
    expect(snapshot.buyers.UC_A).toEqual({ display: '홍길동', nameHistory: ['홍길동'], items: ['b1/15'], subtotal: 10000, byBroadcast: { b1: 10000 }, phoneLast4: null })
    expect(snapshot.settlements).toEqual({ 'UC_A@2026-10-18': { subtotal: 10000, shipping: 4000, adjustments: 0, total: 14000, refundDue: 0, payment: 'UNPAID' } })
    expect(snapshot.claims).toEqual([
      { product: 'b1/15', buyer: 'UC_A', status: 'CONFIRMED', qty: 1 },
      { product: 'b1/15', buyer: 'UC_B', status: 'WAITLISTED', qty: 1 },
      { product: 'b1/16', buyer: 'UC_B', status: 'PENDING', reason: 'UNOPENED', qty: 1 },
      { product: 'b1/15', buyer: 'UC_X', status: 'REJECTED', reason: 'BLOCKED', qty: 1 },
    ])
    expect(snapshot.pending).toEqual({ 'b1/16': ['UC_B'] })
    expect(snapshot.cancelRequests).toEqual([{ product: 'b1/15', buyer: 'UC_A' }])
  })

  it('효과: 대상·문구는 있는 효과에만, 상태와 확정버전을 함께', () => {
    expect(snapshot.effects).toEqual([
      { kind: 'PRINT_PRODUCT_LABEL', status: 'PENDING', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 },
      { kind: 'POST_THANKS', status: 'PENDING', target: 'LIVE_CHAT', product: 'b1/15', buyer: 'UC_A', text: '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다', confirmVersion: 1 },
      { kind: 'POST_THANKS', status: 'PENDING', target: 'VIDEO_COMMENT', product: 'b1/15', buyer: 'UC_A', text: '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다', confirmVersion: 1 },
    ])
  })

  it('값은 조회 함수 결과 그대로다 (어댑터에서 다시 계산하지 않는다)', () => {
    const buyer = listBuyers(state).find((b) => b.id === 'UC_A')
    expect(snapshot.buyers.UC_A?.subtotal).toBe(buyer?.subtotal)
    expect(snapshot.buyers.UC_A?.items).toEqual(buyer?.items)
    const settlement = listSettlements(state)[0]
    expect(snapshot.settlements['UC_A@2026-10-18']?.total).toBe(settlement?.total)
    expect(snapshot.effects.map((e) => e.status)).toEqual(listEffects(state).map((e) => e.status))
  })
})

describe('효과 보고 → 효과 ID (README: 가장 최근에 나온, 취소되지 않은 해당 효과)', () => {
  // A 확정(1) → A를 대기로 교체(라벨 A1 취소) → X 취소 → A 자동 승계 확정(3)
  const state = play(
    [
      { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
      { type: 'chat', b: 'b1', id: 'm2', ch: 'UC_X', nick: '단골', text: '안녕' },
      { type: 'host.assign', b: 'b1', no: 15, buyer: 'UC_X', reason: '단골', replace: 'UC_A', replaceTo: 'WAITLIST' },
      { type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_X', reason: '착오' },
    ],
    { 'thanks.videoComment': 'PER_SALE' },
  )

  it('취소된 이전 효과가 아니라 지금 확정의 효과를 고른다', () => {
    expect(reportTarget(state, golden({ type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' }))).toBe('c1:PRINT_PRODUCT_LABEL:-:3')
    expect(reportTarget(state, golden({ type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'UC_A' }))).toBe('c1:POST_THANKS:LIVE_CHAT:3')
    expect(reportTarget(state, golden({ type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'UC_A', target: 'VIDEO_COMMENT' }))).toBe('c1:POST_THANKS:VIDEO_COMMENT:3')
  })

  it('이미 완료된 효과도 대상이다 (두 번째 보고는 엔진이 무시한다, INV-11)', () => {
    const event = golden({ type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' })
    const done = applyEvent(state, toEngineEvent(state, event)).state
    expect(reportTarget(done, event)).toBe('c1:PRINT_PRODUCT_LABEL:-:3')
    expect(applyEvent(done, toEngineEvent(done, event)).state).toBe(done)
  })

  it('엔진에는 seq·at·종류·효과 ID만 넘긴다', () => {
    expect(toEngineEvent(state, golden({ type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'UC_A' }, 7))).toEqual({
      seq: 7,
      at: 2_000_000,
      type: 'effect.thanksSent',
      effectId: 'c1:POST_THANKS:LIVE_CHAT:3',
    })
  })

  it('대상 효과가 없으면 예외 (러너가 먼저 러너 오류로 잡는 경우)', () => {
    expect(() => toEngineEvent(state, golden({ type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_X' }))).toThrow('효과 보고 대상이 없다')
    expect(reportTarget(state, golden({ type: 'effect.thanksSent', b: 'b1', no: 16, buyer: 'UC_A' }))).toBeUndefined()
  })

  it('다른 이벤트는 그대로 넘긴다', () => {
    const chat = golden({ type: 'chat', b: 'b1', id: 'm9', ch: 'UC_A', nick: '홍길동', text: '15' })
    expect(toEngineEvent(state, chat)).toBe(chat)
  })
})

describe('S03 어댑터 (AC-S03-91): 이벤트 키 → 구매자 자신, 관찰 → 지금의 구매자', () => {
  // X(sms:s1)·같은 번호 s2 → X. H 채팅. X → H 합침. 51 → 50 번호 변경. 정산 기록만 있는 구매자 P
  const state = play([
    { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
    { type: 'product.register', b: 'b1', no: 51, name: '라울', price: 5000 },
    sms('s1', 15, '20:00', { phone: '010-1234-5678', memo: '이모' }),
    sms('s2', 51, '20:00', { phone: '01012345678' }),
    { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_H', nick: '홍길동', text: '안녕' },
    { type: 'chat', b: 'b1', id: 'm2', ch: 'UC_P', nick: '박', text: '16' },
    { type: 'settlement.payment', buyer: 'UC_P', date: '2026-10-18', amount: 3000 },
    { type: 'buyer.merge', from: 'sms:s1', into: 'UC_H', reason: '같은 사람' },
    { type: 'product.renumber', b: 'b1', from: 51, to: 50 },
    sms('s3', 15, '20:00', { buyer: 'UC_Z' }),
  ])
  const snapshot = toSnapshot(state)

  it('형식 검사를 통과한다', () => {
    expect(snapshotIssues(snapshot)).toEqual([])
  })

  it('이벤트의 구매자 키(buyer·replace·from·into)를 그 키의 구매자 자신으로 바꾼다. 유튜브 키·풀리지 않는 키는 그대로', () => {
    expect(toEngineEvent(state, golden({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'sms:s2', reason: 'r' }))).toMatchObject({ buyer: 'sms:s1' })
    expect(toEngineEvent(state, golden({ type: 'host.assign', b: 'b1', no: 15, buyer: 'UC_H', reason: 'r', replace: 'sms:s2', replaceTo: 'WAITLIST' }))).toMatchObject({ buyer: 'UC_H', replace: 'sms:s1' })
    expect(toEngineEvent(state, golden({ type: 'buyer.merge', from: 'sms:s2', into: 'UC_P', reason: 'r' }))).toMatchObject({ from: 'sms:s1', into: 'UC_P' })
    expect(toEngineEvent(state, golden({ type: 'settlement.payment', buyer: 'sms:s2', date: '2026-10-18', amount: 1 }))).toMatchObject({ buyer: 'sms:s1' })
    // 아무 일도 없었던 문자찜(모르는 지정 구매자)의 키는 풀리지 않는다 → 엔진에는 모르는 구매자
    expect(toEngineEvent(state, golden({ type: 'host.blockBuyer', buyer: 'sms:s3', reason: 'r' }))).toMatchObject({ buyer: 'sms:s3' })
    const chat = golden({ type: 'chat', b: 'b1', id: 'm9', ch: 'UC_A', nick: 'a', text: '1' })
    expect(toEngineEvent(state, chat)).toBe(chat)
  })

  it('buyerKeys = 유튜브 채널·받은 문자찜 ref → 지금의 구매자', () => {
    expect(snapshot.buyerKeys).toEqual({ UC_H: 'UC_H', UC_P: 'UC_P', 'sms:s1': 'UC_H', 'sms:s2': 'UC_H' })
  })

  it('상품의 1등·찜·효과의 구매자는 지금의 구매자, 찜의 상품 키는 지금의 키, 효과의 상품 키는 나온 때의 키', () => {
    expect(snapshot.products['b1/15']?.winners).toEqual(['UC_H'])
    expect(snapshot.products['b1/50']).toMatchObject({ winners: [], status: 'OPEN' })
    expect(snapshot.claims).toEqual([
      { product: 'b1/15', buyer: 'UC_H', status: 'CONFIRMED', qty: 1 },
      { product: 'b1/50', buyer: 'UC_H', status: 'REJECTED', reason: 'RENUMBERED', qty: 1 },
      { product: 'b1/16', buyer: 'UC_P', status: 'PENDING', reason: 'UNOPENED', qty: 1 },
    ])
    expect(snapshot.pending).toEqual({ 'b1/16': ['UC_P'] })
    expect(snapshot.effects.filter((e) => e.kind === 'POST_THANKS').map((e) => [e.product, e.buyer, e.status, e.text])).toEqual([
      ['b1/15', 'UC_H', 'PENDING', '15번 핑크프릴 10,000원 문자찜님 구매 감사합니다'],
      ['b1/51', 'UC_H', 'CANCELLED', '51번 라울 5,000원 문자찜님 구매 감사합니다'],
    ])
  })

  it('구매자·정산은 지금의 구매자 기준이고, 품목 없이 받은 금액만 있는 묶음도 엔진 조회 결과대로 옮긴다', () => {
    expect(snapshot.buyers.UC_H).toMatchObject({ items: ['b1/15'], subtotal: 10000, display: '홍길동' })
    expect(snapshot.buyers['sms:s1']).toMatchObject({ display: '문자찜(이모)', items: ['b1/15'], phoneLast4: '5678' })
    expect(snapshot.settlements).toEqual({
      'UC_H@2026-10-18': { subtotal: 10000, shipping: 4000, adjustments: 0, total: 14000, refundDue: 0, payment: 'UNPAID' },
      'UC_P@2026-10-18': { subtotal: 0, shipping: 0, adjustments: 0, total: 0, refundDue: 3000, payment: 'OVERPAID' },
    })
    expect(snapshot.settlements['UC_P@2026-10-18']?.refundDue).toBe(listSettlements(state).find((s) => s.buyer === 'UC_P')?.refundDue)
  })

  it('효과 보고: 상품 키는 효과가 나온 때의 것, 구매자는 지금의 구매자로 비교해 찾는다 (합쳐진 키·다른 ref로도)', () => {
    expect(reportTarget(state, golden({ type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_H' }))).toBe('c1:PRINT_PRODUCT_LABEL:-:1')
    expect(reportTarget(state, golden({ type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'sms:s2' }))).toBe('c1:POST_THANKS:LIVE_CHAT:1')
    // 51번 효과는 취소됐다(번호 변경) → 취소되지 않은 효과가 없다. 새 번호 50으로는 효과가 나온 적이 없다
    expect(reportTarget(state, golden({ type: 'effect.labelPrinted', b: 'b1', no: 51, buyer: 'sms:s1' }))).toBeUndefined()
    expect(reportTarget(state, golden({ type: 'effect.labelPrinted', b: 'b1', no: 50, buyer: 'sms:s1' }))).toBeUndefined()
    expect(reportTarget(state, golden({ type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'sms:s3' }))).toBeUndefined()
  })
})

describe('invariants 훅 — 매 이벤트 뒤 checkInvariants, 위반은 불일치', () => {
  it('실제 엔진 상태에서는 위반이 없다', () => {
    const state = play([
      { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
    ])
    expect(realCore.engine.invariants?.(state, toSnapshot(state))).toEqual([])
  })

  it('상태가 망가지면 checkInvariants가 위반을 돌려주고 러너는 불일치로 센다', () => {
    const breaking: GoldenCore = {
      ...realCore,
      engine: {
        ...realCore.engine,
        // 구매자 UC_A의 합계 기록을 1원 틀리게 만든 엔진 (INV-5) — invariants는 실제 어댑터 그대로
        apply: (state, event) => {
          const result = realCore.engine.apply(state, event)
          const next = result.state as EngineState
          const buyer = pget(next.buyers, 'UC_A')
          return buyer === undefined ? result : { state: { ...next, buyers: pset(next.buyers, 'UC_A', { ...buyer, subtotal: buyer.subtotal + 1 }) }, effects: result.effects }
        },
      },
    }
    const events = [
      { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      { at: '20:00:01', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
    ]
    const item = run(scenario({ events }), { core: breaking }).items[0]
    expect(item?.status).toBe('mismatch')
    expect(item?.problems[0]).toMatchObject({ where: 'events[1]', path: '불변식 INV-5' })
    expect(run(scenario({ events }), { core: realCore }).items[0]?.status).toBe('pass')
  })

  it('실제 어댑터로 골든 시나리오를 돌리면 통과한다 (S02 이벤트만)', () => {
    const report = run(
      scenario({
        events: [
          { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
          { at: '20:00:01', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
          { at: '20:00:02', type: 'effect.labelPrinted', b: 'b1', no: 15, buyer: 'UC_A' },
          { at: '20:00:03', type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_A', reason: '요청' },
        ],
        expect: { effectCounts: { VOID_LABEL: 1 }, pendingEffects: [{ kind: 'VOID_LABEL', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 }] },
      }),
      { core: realCore },
    )
    expect(report.items[0]?.status).toBe('pass')
  })

  // S04(D-070): broadcast.start·broadcast.end는 이제 처리한다 — 처음 쓰는 스프린트가 따로 남은 종류는 effect.failed(S11)
  it('처음 쓰는 스프린트가 따로 있는 이벤트(effect.failed)는 어댑터를 거쳐 엔진의 미구현으로 멈춘다', () => {
    const state = play([])
    expect(() => realCore.engine.apply(state, golden({ type: 'effect.failed' }))).toThrow(NotImplementedError)
  })
})

describe('S03 골든: 러너는 틀린 기대값·틀린 코어에서 실제로 실패한다', () => {
  const goldenDir = fileURLToPath(new URL('../../../../tests/golden/engine', import.meta.url))
  const read = (name: string): string => readFileSync(`${goldenDir}/${name}`, 'utf8')

  it('기대값을 1원 틀리게 바꾸면 그 시나리오만 불일치', () => {
    const text = read('13-merge-settlement.yaml').replace('UC_H: { items: [b1/15], subtotal: 10000, display: 홍길동 }', 'UC_H: { items: [b1/15], subtotal: 10001, display: 홍길동 }')
    const report = run([{ path: 'engine/13.yaml', text }], { core: realCore })
    expect(report.items.filter((item) => item.status === 'mismatch').map((item) => (item.kind === 'scenario' ? item.id : ''))).toEqual(['G-ENG-140'])
    expect(report.items.find((item) => item.status === 'mismatch')?.problems[0]).toMatchObject({ path: 'buyers.UC_H.subtotal', expected: 10001, actual: 10000 })
  })

  it('전화번호로 잇지 않는 코어(문자찜마다 새 구매자)는 문자찜 골든에서 불일치', () => {
    const noLink: GoldenCore = {
      ...realCore,
      engine: { ...realCore.engine, apply: (state, event) => realCore.engine.apply(state, event.type === 'sms' ? { ...event, phone: undefined } : event) },
    }
    const report = run([{ path: 'engine/10.yaml', text: read('10-sms.yaml') }], { core: noLink })
    expect(report.items.filter((item) => item.status === 'mismatch').map((item) => (item.kind === 'scenario' ? item.id : ''))).toEqual(['G-ENG-100', 'G-ENG-102'])
  })

  it('관찰 구매자를 지금의 구매자로 풀지 않는 어댑터는 합치기 골든에서 불일치', () => {
    const selfOnly: GoldenCore = {
      ...realCore,
      engine: {
        ...realCore.engine,
        observe: (state) => {
          const snapshot = toSnapshot(state as EngineState)
          const keys = Object.fromEntries(Object.keys(snapshot.buyerKeys).map((key) => [key, key.startsWith('sms:') ? (listBuyers(state as EngineState).find((b) => b.id === key)?.id ?? snapshot.buyerKeys[key]) : key]))
          return { ...snapshot, buyerKeys: keys as Record<string, string> }
        },
      },
    }
    const report = run([{ path: 'engine/13.yaml', text: read('13-merge-settlement.yaml') }], { core: selfOnly })
    expect(report.items.some((item) => item.status === 'mismatch')).toBe(true)
  })
})

describe('S03b 어댑터 (AC-S03b-04·11·91): 서버 흉내 — phone → phoneKey·phoneLast4, ref 재전송 사본, 뒤 4자리 관찰', () => {
  const smsEvent = (fields: Record<string, unknown>, seq = 5): GoldenEvent => golden({ type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00', ...fields }, seq)
  const empty = play([])

  it('phone은 엔진에 넘기지 않고, 휴대폰 번호 모양이면 phoneKey(테스트 전용 HMAC-SHA256 base64url)·phoneLast4를 넘긴다', () => {
    const mapped = toEngineEvent(empty, smsEvent({ phone: '010-1234-5678', memo: '이모' })) as SmsEvent
    expect(mapped).not.toHaveProperty('phone')
    expect(mapped).toEqual({ seq: 5, at: 2_000_000, type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00', memo: '이모', phoneKey: testPhoneKey('01012345678'), phoneLast4: '5678' })
    expect(mapped.phoneKey).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(mapped.phoneKey).toHaveLength(43)
    // 번호 숫자를 그대로 담지 않는다
    expect(mapped.phoneKey).not.toContain('01012345678')
    expect(mapped.phoneKey).not.toContain('12345678')
  })

  it('형식이 달라도 같은 번호면 같은 키, 다른 번호면 다른 키 (뒤 4자리만 같아도 다르다). 키는 결정적이다', () => {
    const keyOf = (phone: string): unknown => (toEngineEvent(empty, smsEvent({ phone })) as SmsEvent).phoneKey
    const same = ['010-1234-5678', '(010) 1234-5678', '01012345678', '０１０-１２３４-５６７８', ' 010 1234 5678 ']
    expect(new Set(same.map(keyOf)).size).toBe(1)
    expect(keyOf('010-7777-5678')).not.toBe(keyOf('010-1234-5678'))
    expect(keyOf('010-1234-5679')).not.toBe(keyOf('010-1234-5678'))
    expect(keyOf('011-234-5678')).toBe(testPhoneKey('0112345678'))
    expect(smsPhoneFields('010-1234-5678')).toEqual(smsPhoneFields('01012345678'))
  })

  it('휴대폰 번호 모양이 아니면(일부만·국가 번호·빈 값) 전화번호 없이 넘긴다', () => {
    for (const phone of ['5678', '+82 10-1234-5678', '', '010-1234', '02-123-4567', '전화 없음']) {
      expect(normalizePhone(phone)).toBeNull()
      const mapped = toEngineEvent(empty, smsEvent({ phone }))
      expect(mapped).not.toHaveProperty('phone')
      expect(mapped).not.toHaveProperty('phoneKey')
      expect(mapped).not.toHaveProperty('phoneLast4')
    }
    // phone이 없는 문자찜도 새 객체로 넘긴다(필드는 그대로)
    const plain = smsEvent({})
    expect(toEngineEvent(empty, plain)).toEqual(plain)
  })

  it('지정 구매자가 있어도 서버처럼 키를 만들어 넘긴다 (엔진이 보지 않는다), 지정 구매자 키는 구매자 자신으로', () => {
    const state = play([sms('s0', 15, '20:00', { phone: '010-1111-2222' })])
    const mapped = toEngineEvent(state, smsEvent({ ref: 's9', buyer: 'sms:s0', phone: '010-3333-4444' })) as SmsEvent
    expect(mapped).toMatchObject({ buyer: 'sms:s0', phoneLast4: '4444', phoneKey: testPhoneKey('01033334444') })
  })

  it('G-ENG-150을 돌린 뒤 상태·효과·관찰 어디에도 입력한 번호(정규화한 번호)가 없다', () => {
    const report = run([{ path: 'engine/14.yaml', text: readFileSync(fileURLToPath(new URL('../../../../tests/golden/engine/14-core-cleanup.yaml', import.meta.url)), 'utf8').split('\n---\n')[0] as string }], {
      core: realCore,
    })
    expect(report.items[0]?.status).toBe('pass')
    let state = realCore.engine.start({ broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }], settings: {} }) as EngineState
    const effects: unknown[] = []
    const events: Record<string, unknown>[] = [
      { type: 'product.register', b: 'b1', no: 1, name: '금황성', price: 10000 },
      { type: 'product.register', b: 'b1', no: 2, name: '라울', price: 5000 },
      { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_H', nick: '홍길동', text: '안녕하세요' },
      { type: 'sms', b: 'b1', ref: 's1', no: 1, received: '20:00:09', phone: '010-1234-5678' },
      { type: 'sms', b: 'b1', ref: 's2', no: 2, received: '20:00', phone: '(010) 1234-5678' },
      { type: 'sms', b: 'b1', ref: 's4', no: 1, received: '20:00:12', buyer: 'UC_H', phone: '010-9999-0000' },
      { type: 'sms', b: 'b1', ref: 's5', no: 2, received: '20:00:13', phone: '010-9999-0000' },
      { type: 'sms', b: 'b1', ref: 's7', no: 1, received: '20:00:15', phone: '010-7777-5678' },
    ]
    events.forEach((fields, i) => {
      const result = realCore.engine.apply(state, golden(fields, i + 1))
      state = result.state as EngineState
      effects.push(...result.effects)
    })
    const dump = JSON.stringify([state, effects, toSnapshot(state), listClaims(state), listBuyers(state), listEffects(state), listSmsRefs(state)])
    for (const number of ['01012345678', '01099990000', '01077775678', '010-1234-5678', '1234-5678', '9999-0000', '7777-5678']) expect(dump).not.toContain(number)
    expect(toSnapshot(state).buyers['sms:s1']?.phoneLast4).toBe('5678')
    expect(toSnapshot(state).buyers.UC_H?.phoneLast4).toBeNull()
  })

  it('ref 재전송 사본: sms:<ref>는 그 ref의 처음 문자찜으로 정하고, 구매자를 정하지 않은 ref는 풀지 않는다', () => {
    // s1: 모르는 지정 구매자 UC_A → ref만 기록. A가 알려진 뒤 s1 사본 → 아무 일도 없다. s2: 새 문자 구매자, s2 사본(다른 번호)
    const state = play([
      { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      sms('s1', 15, '20:00', { buyer: 'UC_A' }),
      { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕' },
      sms('s1', 15, '20:00', { buyer: 'UC_A' }),
      sms('s2', 15, '20:00', { phone: '010-1234-5678' }),
      sms('s2', 15, '20:00', { phone: '010-9999-0000', memo: '사본' }),
    ])
    expect(buyerOfRef(state, 's1')).toBeNull()
    expect(buyerOfRef(state, 's2')).toBe('sms:s2')
    expect(toEngineEvent(state, golden({ type: 'host.blockBuyer', buyer: 'sms:s1', reason: 'r' }))).toMatchObject({ buyer: 'sms:s1' })
    expect(toEngineEvent(state, golden({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'sms:s2', reason: 'r' }))).toMatchObject({ buyer: 'sms:s2' })
    const snapshot = toSnapshot(state)
    expect(snapshot.buyerKeys).toEqual({ UC_A: 'UC_A', 'sms:s2': 'sms:s2' })
    expect(snapshot.buyers['sms:s2']).toMatchObject({ phoneLast4: '5678', display: '문자찜' })
    expect(listClaims(state)).toHaveLength(1)
    expect(snapshotIssues(snapshot)).toEqual([])
  })
})

describe('S03b 골든: 러너는 바뀐 규칙을 따르지 않는 틀린 코어에서 실제로 실패한다 (AC-S03b-91)', () => {
  const text = readFileSync(fileURLToPath(new URL('../../../../tests/golden/engine/14-core-cleanup.yaml', import.meta.url)), 'utf8')
  const mismatched = (core: GoldenCore): string[] =>
    run([{ path: 'engine/14.yaml', text }], { core }).items.filter((item) => item.status !== 'pass').map((item) => (item.kind === 'scenario' ? item.id : ''))
  /** 어댑터로 바꾼 엔진 이벤트에 손을 대는 코어 */
  const engineCore = (apply: (state: EngineState, event: EngineEvent) => { state: EngineState; effects: readonly unknown[] }): GoldenCore => ({
    ...realCore,
    engine: { ...realCore.engine, apply: (state, event) => apply(state as EngineState, toEngineEvent(state as EngineState, event)) },
  })
  const withState = (state: EngineState, patch: Partial<EngineState>): EngineState => ({ ...state, ...patch })

  it('실제 코어는 14-core-cleanup의 10개 시나리오를 모두 통과한다', () => {
    expect(mismatched(realCore)).toEqual([])
  })

  it('뒤 4자리로 잇는 코어 → G-ENG-150 불일치', () => {
    const core = engineCore((state, event) => {
      if (event.type !== 'sms' || event.phoneLast4 === undefined) return applyEvent(state, event)
      return applyEvent(state, { ...event, phoneKey: `last4-only-key-${event.phoneLast4}` })
    })
    expect(mismatched(core)).toEqual(['G-ENG-150'])
  })

  it('지정 구매자의 전화번호 키를 기록하는 코어 → G-ENG-150 불일치', () => {
    const core = engineCore((state, event) => {
      const result = applyEvent(state, event)
      if (event.type !== 'sms' || event.buyer === undefined || event.phoneKey === undefined || buyerOfRef(result.state, event.ref) === null) return result
      if (pget(result.state.phoneKeys, event.phoneKey) !== undefined) return result
      return { ...result, state: withState(result.state, { phoneKeys: pset(result.state.phoneKeys, event.phoneKey, event.buyer) }) }
    })
    expect(mismatched(core)).toEqual(['G-ENG-150'])
  })

  it('모르는 지정 구매자의 ref를 기록하지 않는 코어(S03) → G-ENG-151 불일치', () => {
    const core = engineCore((state, event) => {
      const result = applyEvent(state, event)
      if (event.type !== 'sms' || pget(result.state.refs, event.ref) !== null) return result
      return { ...result, state: withState(result.state, { refs: pdelete(result.state.refs, event.ref) }) }
    })
    expect(mismatched(core)).toEqual(['G-ENG-151'])
  })

  it('주문이었던 메시지를 변환하는 코어 → G-ENG-152 불일치', () => {
    const core = engineCore((state, event) => {
      if (event.type !== 'host.convertMessage') return applyEvent(state, event)
      const key = JSON.stringify([event.b, event.msg])
      const message = pget(state.messages, key)
      if (message === undefined) return applyEvent(state, event)
      return applyEvent(withState(state, { messages: pset(state.messages, key, { ...message, order: false }) }), event)
    })
    expect(mismatched(core)).toEqual(['G-ENG-152'])
  })

  it('시청자 채팅 취소를 지금의 구매자로 찾는 코어(S03) → G-ENG-153·154 불일치', () => {
    const core = engineCore((state, event) => {
      const result = applyEvent(state, event)
      if (event.type !== 'chat') return result
      let next = result.state
      // 설정은 그 방송의 스냅샷 (S04: 상태의 시작 설정 칸이 없어졌다, D-070)
      const settings = getBroadcast(next, event.b)?.settings
      for (const no of parseChat(event.text, settings).cancels) {
        const id = activeClaimId(next, event.b, no, event.ch)
        const claim = id === null ? undefined : listClaims(next).find((c) => c.id === id)
        if (claim === undefined || claim.buyer === event.ch) continue
        if (settings?.['cancel.buyerChat'] === 'AUTO' && !claim.locked) {
          next = applyEvent(next, { type: 'host.cancel', b: event.b, no, buyer: claim.buyer, reason: '채팅 취소', seq: event.seq, at: event.at }).state
        } else {
          const record = pget(next.claims, claim.id)
          if (record !== undefined && record.request === null) next = withState(next, { claims: pset(next.claims, claim.id, { ...record, request: event.seq }) })
        }
      }
      return { state: next, effects: result.effects }
    })
    expect(mismatched(core)).toEqual(['G-ENG-153', 'G-ENG-154'])
  })

  it('충돌 중 배정을 받는 코어(S03) → G-ENG-155 불일치', () => {
    const core = engineCore((state, event) => {
      if (event.type !== 'host.assign') return applyEvent(state, event)
      const key = `${event.b}/${String(event.no)}`
      const slot = pget(state.slots, key)
      if (slot === undefined || slot.conflict === null) return applyEvent(state, event)
      const result = applyEvent(withState(state, { slots: pset(state.slots, key, { ...slot, conflict: null }) }), event)
      const after = pget(result.state.slots, key)
      if (after === undefined || pget(result.state.claims, slot.conflict)?.status !== 'CONFLICT') return result
      return { ...result, state: withState(result.state, { slots: pset(result.state.slots, key, { ...after, conflict: slot.conflict }) }) }
    })
    expect(mismatched(core)).toEqual(['G-ENG-155'])
  })

  it('충돌이 자리가 비어 풀릴 때 넘침을 먼저 정리하는 코어(S03) → G-ENG-157 불일치', () => {
    // 1등 취소·재고 늘림 전에 KEEP을 먼저 적용 = c를 넣자마자 넘침 정리 (S03 순서)
    const core = engineCore((state, event) => {
      const target =
        ((event.type === 'host.cancel' || event.type === 'host.reject') && activeClaimId(state, event.b, event.no, event.buyer) !== null) ||
        (event.type === 'product.update' && event.stock !== undefined)
          ? { b: event.b, no: event.no }
          : undefined
      const slot = target === undefined ? undefined : pget(state.slots, `${target.b}/${String(target.no)}`)
      if (target === undefined || slot === undefined || slot.conflict === null) return applyEvent(state, event)
      const kept = applyEvent(state, { type: 'host.resolveConflict', ...target, decision: 'KEEP', seq: event.seq, at: event.at }).state
      return applyEvent(kept, event)
    })
    expect(mismatched(core)).toEqual(['G-ENG-157'])
  })

  it('구매자 보기의 뒤 4자리를 지우는 어댑터 → G-ENG-150·151 불일치', () => {
    const core: GoldenCore = {
      ...realCore,
      engine: {
        ...realCore.engine,
        observe: (state) => {
          const snapshot = toSnapshot(state as EngineState)
          return { ...snapshot, buyers: Object.fromEntries(Object.entries(snapshot.buyers).map(([id, view]) => [id, { ...view, phoneLast4: null }])) }
        },
      },
    }
    expect(mismatched(core)).toEqual(['G-ENG-150', 'G-ENG-151'])
    expect(getBuyer(play([sms('s1', 1, '20:00', { phone: '010-1234-5678' })]), 'sms:s1')?.phoneLast4).toBe('5678')
  })
})

describe('S04 어댑터 (AC-S04-91): broadcast.start·broadcast.end를 그대로 넘기고, 관찰에 방송(날짜·제목·끝남)을 넣는다', () => {
  const B = { id: 'b1', date: '2026-10-18', title: '1부' }

  it('broadcast.start·broadcast.end는 바꾸지 않고 그대로 넘긴다 (사본도)', () => {
    const empty = realCore.engine.start({ broadcasts: [], settings: {} }) as EngineState
    const start = golden({ type: 'broadcast.start', b: 'b1', date: '2026-10-18', title: '1부', settings: { 'waitlist.max': 0 } }, 1)
    expect(toEngineEvent(empty, start)).toBe(start)
    const started = realCore.engine.apply(empty, start).state as EngineState
    const copy = golden({ type: 'broadcast.start', b: 'b1', date: '2026-10-19', title: '바뀐 제목' }, 2)
    expect(toEngineEvent(started, copy)).toBe(copy)
    expect(realCore.engine.apply(started, copy).state).toBe(started)
    const end = golden({ type: 'broadcast.end', b: 'b1' }, 3)
    expect(toEngineEvent(started, end)).toBe(end)
  })

  it('관찰 스냅샷의 방송 = 조회 함수(listBroadcasts)의 날짜·제목·끝남', () => {
    const empty = realCore.engine.start({ broadcasts: [B], settings: {} }) as EngineState
    let state = realCore.engine.apply(empty, golden({ type: 'broadcast.start', b: 'b2', date: '2026-10-19', title: '2부' }, 1)).state as EngineState
    state = realCore.engine.apply(state, golden({ type: 'broadcast.end', b: 'b1' }, 2)).state as EngineState
    const snapshot = toSnapshot(state)
    expect(snapshot.broadcasts).toEqual({ b1: { date: '2026-10-18', title: '1부', ended: true }, b2: { date: '2026-10-19', title: '2부', ended: false } })
    expect(snapshotIssues(snapshot)).toEqual([])
  })

  it('러너: broadcasts: []에서 broadcast.start로 선언 — 짧은 at은 그 이벤트의 date 기준(사본도), 선언 뒤의 이벤트·검사는 그 방송을 쓴다', () => {
    const report = run(
      scenario({
        broadcasts: [],
        events: [
          { at: '19:00:00', type: 'broadcast.start', b: 'b1', date: '2026-10-19', title: '1부' },
          { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
          // 사본: 짧은 at은 사본의 date(10/19) 기준 — 10/18 기준이면 at 역행으로 읽기 오류다
          { at: '20:00:01', type: 'broadcast.start', b: 'b1', date: '2026-10-19', title: '사본' },
          { at: '20:00:02', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
          { type: 'assert', expect: { broadcasts: { b1: { title: '1부', ended: false } }, products: { 'b1/15': { winner: 'UC_A' } } } },
          { at: '20:00:03', type: 'broadcast.end', b: 'b1' },
          // 방송 날짜가 하나뿐이라 방송 없는 이벤트도 짧은 at (그 날짜 = broadcast.start의 date)
          { at: '20:00:04', type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-19', amount: 14000 },
        ],
        expect: { broadcasts: { b1: { date: '2026-10-19', title: '1부', ended: true } }, settlements: { 'UC_A@2026-10-19': { total: 14000, payment: 'PAID' } } },
      }),
      { core: realCore },
    )
    expect(report.readErrors).toEqual([])
    expect(report.items[0]?.status).toBe('pass')
  })

  it('러너: 시작 때 선언한 방송만 엔진 시작 목록으로 넘기고, broadcast.start의 방송은 이벤트로 넘긴다', () => {
    const starts: unknown[] = []
    const core: GoldenCore = { ...realCore, engine: { ...realCore.engine, start: (setup) => (starts.push(setup), realCore.engine.start(setup)) } }
    const report = run(scenario({ events: [{ at: '20:00:00', type: 'broadcast.start', b: 'b2', date: '2026-10-18', title: '2부' }], expect: { broadcasts: { b2: { ended: false } } } }), { core })
    expect(report.items[0]?.status).toBe('pass')
    expect(starts[0]).toEqual({ broadcasts: [B], settings: {} })
  })
})

describe('S04 골든: 러너는 바뀐 규칙을 따르지 않는 틀린 코어에서 실제로 실패한다 (AC-S04-91)', () => {
  const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../../tests/golden/engine/${name}`, import.meta.url)), 'utf8')
  const files = [
    { path: 'engine/15.yaml', text: read('15-broadcast.yaml') },
    { path: 'engine/16.yaml', text: read('16-s04-rules.yaml') },
  ]
  /** 통과하지 못한 시나리오 — 불일치가 아니면(러너 오류 등) 상태를 붙여 드러낸다 */
  const failing = (core: GoldenCore): string[] =>
    run(files, { core })
      .items.filter((item) => item.status !== 'pass')
      .map((item) => `${item.kind === 'scenario' ? item.id : ''}${item.status === 'mismatch' ? '' : `:${item.status}`}`)
  const engineCore = (apply: (state: EngineState, event: EngineEvent) => { state: EngineState; effects: readonly unknown[] }): GoldenCore => ({
    ...realCore,
    engine: { ...realCore.engine, apply: (state, event) => apply(state as EngineState, toEngineEvent(state as EngineState, event)) },
  })
  const declared = (state: EngineState, b: string): boolean => state.broadcasts.some((broadcast) => broadcast.id === b)

  it('실제 코어는 15·16의 6개 시나리오를 모두 통과한다', () => {
    expect(failing(realCore)).toEqual([])
  })

  it('사본을 받아 설정·제목을 바꾸는 코어 → G-ENG-160 불일치 (사본이 있는 G-ENG-162도)', () => {
    const core = engineCore((state, event) => {
      if (event.type !== 'broadcast.start' || !declared(state, event.b)) return applyEvent(state, event)
      const replaced = state.broadcasts.map((broadcast) =>
        broadcast.id === event.b ? { ...broadcast, title: event.title, date: event.date, settings: { ...broadcast.settings, ...event.settings } } : broadcast,
      )
      return { state: { ...state, broadcasts: replaced }, effects: [] }
    })
    expect(failing(core)).toEqual(['G-ENG-160', 'G-ENG-162'])
  })

  it('모든 방송을 시작 설정으로 판정하는 코어 → G-ENG-160 불일치 (방송마다 경합 정책이 다른 G-ENG-161도)', () => {
    const core = engineCore((state, event) => {
      if (event.type !== 'broadcast.start' || declared(state, event.b)) return applyEvent(state, event)
      const { settings: _own, ...rest } = event
      return applyEvent(state, { ...rest, settings: state.broadcasts[0]?.settings ?? {} })
    })
    expect(failing(core)).toEqual(['G-ENG-160', 'G-ENG-161'])
  })

  it('정산 설정을 그날 가장 나중 방송으로 정하는 코어 → G-ENG-160 불일치', () => {
    const core: GoldenCore = { ...realCore, engine: { ...realCore.engine, observe: (state) => toSnapshot({ ...(state as EngineState), broadcasts: [...(state as EngineState).broadcasts].reverse() }) } }
    expect(failing(core)).toEqual(['G-ENG-160'])
  })

  it('끝난 방송의 문자찜·채팅을 거절하는 코어 → G-ENG-162 불일치', () => {
    const core = engineCore((state, event) => {
      if ((event.type === 'chat' || event.type === 'sms') && getBroadcast(state, event.b)?.ended === true) return { state, effects: [] }
      return applyEvent(state, event)
    })
    expect(failing(core)).toEqual(['G-ENG-162'])
  })

  it('취소 메시지를 변환하는 코어(S03b) → G-ENG-163 불일치', () => {
    const core = engineCore((state, event) => {
      if (event.type !== 'host.convertMessage') return applyEvent(state, event)
      const key = JSON.stringify([event.b, event.msg])
      const message = pget(state.messages, key)
      if (message === undefined) return applyEvent(state, event)
      return applyEvent({ ...state, messages: pset(state.messages, key, { ...message, cancel: false }) }, event)
    })
    expect(failing(core)).toEqual(['G-ENG-163'])
  })

  it('ASK·대기 한도 0에서 풀린 충돌 찜을 품절시키는 코어(S03b) → G-ENG-164 불일치', () => {
    // 1등 자리를 비우기 전에 KEEP을 먼저 적용 = 대기 한도 0이라 충돌 찜이 넣자마자 품절 (S03b의 결과와 같다)
    const core = engineCore((state, event) => {
      if (event.type !== 'host.cancel' && event.type !== 'host.reject') return applyEvent(state, event)
      const settings = getBroadcast(state, event.b)?.settings
      const slot = pget(state.slots, `${event.b}/${String(event.no)}`)
      if (settings?.['cancel.succession'] !== 'ASK' || settings['waitlist.max'] !== 0 || slot === undefined || slot.conflict === null) return applyEvent(state, event)
      const kept = applyEvent(state, { type: 'host.resolveConflict', b: event.b, no: event.no, decision: 'KEEP', seq: event.seq, at: event.at }).state
      return applyEvent(kept, event)
    })
    expect(failing(core)).toEqual(['G-ENG-164'])
  })
})

// 합치기(S06b + P2 + I4 + I1 + Y1 + I3 + N2 + I2 + N5): 골든이 늘어 합계를 바꿨다(교체 — 약화 아님). S06b(19·20번 엔진 파일, G-ENG-174~177),
// P2(parser/voice-extract.yaml, engine/19-p2-documents.yaml G-ENG-201·202), I4(voice-extract 끊어 말한 번호 사례),
// I1(engine/21-i1-labels.yaml G-ENG-301~304, AC-I1-80), Y1(engine/19-y1-youtube.yaml G-ENG-401·402, parser/chat.yaml 사례 6, AC-Y1-90),
// I3(engine/22-i3-settings.yaml G-ENG-701, AC-I3-95)을 함께 센다 — 기준(S06, 21·379·119·498)에 main 쪽 +5·+81·+10·+91, I3 쪽 +2·+6·+3·+9.
// N2(engine/22-n2-instagram.yaml G-ENG-N2-01~03, parser/chat.yaml N2 8사례, AC-N2-81)를 더한다 — N2 쪽 +1·+8·+3·+11.
// I2(parser/product-import.yaml 26사례 — 실제 해석 함수 apps/server/src/product-import.ts, AC-I2-50·90, 마지막 감사 D-I2-17·D-I2-21 포함)를 더한다 — I2 쪽 +1·+26·+0·+26.
// I2 합치기(main a52f5c3): main 파일 29 · 파서 474 · 엔진 135 · 통과 609 + I2 = 파일 30 · 파서 500 · 엔진 135 · 통과 635 (교체 — 약화 아님).
// N5 합치기(main c3d3659): main 파일 30 · 파서 500 · 엔진 135 · 통과 635 + N5(engine/22-n5-billing.yaml G-ENG-N5-01·02, AC-N5-04 — +1·+0·+2·+2)
// = 파일 31 · 파서 500 · 엔진 137 · 통과 637 (교체 — 약화 아님).
// N5 합치기(main 066480c): main(N3 engine/22-n3-deposits.yaml G-ENG-N3-01·02, AC-N3-04 — +1·+0·+2·+2, deposit/*.json은 러너가 읽지 않는다)과
//   N5를 합친다 — 파일 31 · 파서 500 · 엔진 137 · 통과 637 + N3 = 파일 32 · 파서 500 · 엔진 139 · 통과 639 (교체 — 약화 아님).
// 통합(track/int-final): N5 쪽 파일 32 · 파서 500 · 엔진 139 · 통과 639(main + N3 + N5) + N2b-2(engine/23-n2b2-multi-platform.yaml G-ENG-N2b-2-01·02, AC-N2b-2-90 — +1·+0·+2·+2,
//   tiktok/*.json은 러너가 읽지 않는다) = 파일 33 · 파서 500 · 엔진 141 · 통과 641. N4b는 골든을 더하지 않는다 (교체 — 약화 아님).
// O1 합치기(main c4defc7): main 파일 33 · 파서 500 · 엔진 141 · 통과 641 + O1(parser/comment-options.yaml 89사례·engine/23-o1-options.yaml G-ENG-O1-01~11·
//   engine/23-o0-strict-regression.yaml G-ENG-O0-01·parser/chat.yaml O0 회귀 7사례, AC-O1-35 — +3·+96·+12·+108) = 파일 36 · 파서 596 · 엔진 153 · 통과 749 (교체 — 약화 아님).
// O3 합치기(track/o1-options-core fa12810): O1 최종 파일 36 · 파서 596 · 엔진 153 · 통과 749 + O3(engine/24-o3-labels-documents.yaml G-ENG-O3-01, AC-O3-25 — +1·+0·+1·+1)
//   = 파일 37 · 파서 596 · 엔진 154 · 통과 750 (교체 — 약화 아님).
// O2 합치기(main 843f752): main(O1 최종 + O3) 파일 37 · 파서 596 · 엔진 154 · 통과 750 + O2(engine/24-o2-review-ui.yaml G-ENG-O2-01·02, AC-O2-62 — 새 엔진 규칙 없음,
//   +1·+0·+2·+2) = 파일 38 · 파서 596 · 엔진 156 · 통과 752 (실제 pnpm golden 결과, 교체 — 약화 아님, SA-O2-02).
// O4 통합 확인(track/o4-options-e2e ea73bc6): 파일 38 · 파서 596 · 엔진 156 · 통과 752 + O4(engine/25-o4-integration.yaml G-ENG-O4-01~03, AC-O4-01 —
//   새 엔진 규칙 없음, O4 +1·+0·+3·+3 (교체 — 약화 아님)) = 파일 39 · 파서 596 · 엔진 159 · 통과 755.
// FB1 D-FB1-11·D-FB1-12(spec 2ea576b): parser/amount.yaml TEN_THOUSAND 21사례·quick-input.yaml 12사례·product-import.yaml 1사례, chat.yaml `132 475` 3사례
//   — +0·+37·+0·+37 = 파일 39 · 파서 633 · 엔진 159 · 통과 792 (교체 — 약화 아님). product-import 만원 사례는 서버 몫(AC-FB1-04 [server])이 들어와야 통과한다.
// V3 D-V3-22 (c)(spec da8b3857): parser/voice-extract.yaml 81 → 179사례(+98, D-V3-25~66까지) — +0·+98·+0·+98 = 파일 39 · 파서 731 · 엔진 159 · 통과 890
//   (voice-register/*.json은 러너가 읽지 않는다 — packages/voice 단위 시험, 교체 — 약화 아님).
// V3 D-V3-70(spec bad7b4d3): parser/amount.yaml AUTO 20사례·quick-input.yaml AUTO 5사례 — +0·+25·+0·+25 = 파일 39 · 파서 756 · 엔진 159 · 통과 915
//   (D-V3-22 합계 숫자만 바꿈, 교체 — 약화 아님).
describe('실제 tests/golden 전체를 실제 코어로 (S06b + P2 + I4 + I1 + Y1 + I3 + N2 + I2 + N3 + N5 + N2b-2 + O1 + O3 + O2 + O4 + FB1 + V3 합계)', () => {
  it('파일 39 · 파서 756 · 엔진 159 · 통과 915, 나머지 0', () => {
    const goldenDir = fileURLToPath(new URL('../../../../tests/golden', import.meta.url))
    const report = runGoldenDir({ goldenDir, core: realCore, displayRoot: goldenDir })
    expect(report.totals).toEqual({
      files: 39,
      parserCases: 756,
      scenarios: 159,
      pass: 915,
      mismatch: 0,
      notImplementedAllowed: 0,
      notImplementedDisallowed: 0,
      readError: 0,
      determinism: 0,
      runnerError: 0,
    })
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual([])
  })
})
