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

  it('S03 이벤트는 어댑터를 거쳐 엔진의 미구현으로 멈춘다', () => {
    const state = play([])
    expect(() => realCore.engine.apply(state, golden({ type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00' }))).toThrow(NotImplementedError)
  })
})

describe('실제 tests/golden 전체를 실제 코어로 (AC-S02-90과 같은 합계)', () => {
  it('통과 427 · 미구현(허용) 20 · 나머지 0, S03 시나리오는 모두 중간 검사 전에 미구현으로 멈춘다', () => {
    const goldenDir = fileURLToPath(new URL('../../../../tests/golden', import.meta.url))
    const report = runGoldenDir({ goldenDir, core: realCore, displayRoot: goldenDir })
    expect(report.totals).toEqual({
      files: 12,
      parserCases: 379,
      scenarios: 68,
      pass: 427,
      mismatch: 0,
      notImplementedAllowed: 20,
      notImplementedDisallowed: 0,
      readError: 0,
      determinism: 0,
      runnerError: 0,
    })
    expect(report.ok).toBe(true)
    for (const item of report.items) {
      if (item.kind === 'scenario' && item.status === 'not-implemented') expect(item.problems[0]?.message, item.id).toContain('S03')
    }
  })
})
