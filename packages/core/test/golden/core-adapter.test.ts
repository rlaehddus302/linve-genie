// AC-S02-91 골든 어댑터: observe는 조회 함수 결과를 이름·모양만 바꿔 옮기고, invariants는 checkInvariants를 부르며,
// 효과 보고는 README 규칙("가장 최근에 나온, 취소되지 않은 해당 효과")으로 효과 ID를 찾아 엔진에 넘긴다.
import {
  NotImplementedError,
  applyEvent,
  listBuyers,
  listEffects,
  listSettlements,
  type EngineState,
} from '@livejjim/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runGoldenDir } from './fs-runner.ts'
import { pget, pset } from '../../src/engine/pmap.ts'
import { play as playEvents, type EventInput } from '../unit/engine-helpers.ts'
import { realCore, reportTarget, toEngineEvent, toSnapshot } from './core-adapter.ts'
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
      'b1/15': { status: 'SOLD', winners: ['UC_A'], waitlist: ['UC_B'], conflict: false, price: 10000, priceHistory: [] },
      'b1/16': { status: 'READY', winners: [], waitlist: [], conflict: false, price: 800, priceHistory: [] },
    })
    expect(snapshot.buyers.UC_B).toEqual({ display: '철수', nameHistory: ['김철수', '철수'], items: [], subtotal: 0, byBroadcast: {} })
    expect(snapshot.buyers.UC_A).toEqual({ display: '홍길동', nameHistory: ['홍길동'], items: ['b1/15'], subtotal: 10000, byBroadcast: { b1: 10000 } })
    expect(snapshot.settlements).toEqual({ 'UC_A@2026-10-18': { subtotal: 10000, shipping: 4000, adjustments: 0, total: 14000, refundDue: 0, payment: 'UNPAID' } })
    expect(snapshot.claims).toEqual([
      { product: 'b1/15', buyer: 'UC_A', status: 'CONFIRMED' },
      { product: 'b1/15', buyer: 'UC_B', status: 'WAITLISTED' },
      { product: 'b1/16', buyer: 'UC_B', status: 'PENDING', reason: 'UNOPENED' },
      { product: 'b1/15', buyer: 'UC_X', status: 'REJECTED', reason: 'BLOCKED' },
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
    { type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00', phone: '010-1234-5678', memo: '이모' },
    { type: 'sms', b: 'b1', ref: 's2', no: 51, received: '20:00', phone: '01012345678' },
    { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_H', nick: '홍길동', text: '안녕' },
    { type: 'chat', b: 'b1', id: 'm2', ch: 'UC_P', nick: '박', text: '16' },
    { type: 'settlement.payment', buyer: 'UC_P', date: '2026-10-18', amount: 3000 },
    { type: 'buyer.merge', from: 'sms:s1', into: 'UC_H', reason: '같은 사람' },
    { type: 'product.renumber', b: 'b1', from: 51, to: 50 },
    { type: 'sms', b: 'b1', ref: 's3', no: 15, received: '20:00', buyer: 'UC_Z' },
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
      { product: 'b1/15', buyer: 'UC_H', status: 'CONFIRMED' },
      { product: 'b1/50', buyer: 'UC_H', status: 'REJECTED', reason: 'RENUMBERED' },
      { product: 'b1/16', buyer: 'UC_P', status: 'PENDING', reason: 'UNOPENED' },
    ])
    expect(snapshot.pending).toEqual({ 'b1/16': ['UC_P'] })
    expect(snapshot.effects.filter((e) => e.kind === 'POST_THANKS').map((e) => [e.product, e.buyer, e.status, e.text])).toEqual([
      ['b1/15', 'UC_H', 'PENDING', '15번 핑크프릴 10,000원 문자찜님 구매 감사합니다'],
      ['b1/51', 'UC_H', 'CANCELLED', '51번 라울 5,000원 문자찜님 구매 감사합니다'],
    ])
  })

  it('구매자·정산은 지금의 구매자 기준이고, 품목 없이 받은 금액만 있는 묶음도 엔진 조회 결과대로 옮긴다', () => {
    expect(snapshot.buyers.UC_H).toMatchObject({ items: ['b1/15'], subtotal: 10000, display: '홍길동' })
    expect(snapshot.buyers['sms:s1']).toMatchObject({ display: '문자찜(이모)', items: ['b1/15'] })
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

  it('처음 쓰는 스프린트가 따로 있는 이벤트는 어댑터를 거쳐 엔진의 미구현으로 멈춘다', () => {
    const state = play([])
    expect(() => realCore.engine.apply(state, golden({ type: 'broadcast.start' }))).toThrow(NotImplementedError)
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

describe('실제 tests/golden 전체를 실제 코어로 (AC-S03-90 합계)', () => {
  it('파일 16 · 파서 379 · 엔진 95 · 통과 474, 나머지 0', () => {
    const goldenDir = fileURLToPath(new URL('../../../../tests/golden', import.meta.url))
    const report = runGoldenDir({ goldenDir, core: realCore, displayRoot: goldenDir })
    expect(report.totals).toEqual({
      files: 16,
      parserCases: 379,
      scenarios: 95,
      pass: 474,
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
