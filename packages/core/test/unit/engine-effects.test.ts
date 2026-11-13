// 효과 (AC-S02-70~73): 확정버전, 효과 ID, 감사 문구, 확정 해제, 효과 보고·잠금, 늦은 보고.
import { formatThanksHead, formatThanksText, formatWon, listClaims, listEffects, type EngineEffect, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { chat, host, play, register, type EventInput } from './engine-helpers.ts'

const report = (type: 'effect.labelPrinted' | 'effect.thanksSent', effectId: string): EventInput => ({ type, effectId })
const effectsOf = (state: EngineState) => listEffects(state).map((e) => [e.id, e.status])
const locked = (state: EngineState, buyer: string) => listClaims(state).find((c) => c.buyer === buyer && c.status === 'CONFIRMED')?.locked

describe('확정 때 효과와 확정버전 (AC-S02-70)', () => {
  it('효과 ID = {찜ID}:{효과종류}:{대상}:{확정버전}, 라벨은 대상 자리에 -', () => {
    const { emitted } = play([register(15), chat('A', '15')], { 'thanks.videoComment': 'PER_SALE' })
    expect(emitted[1]?.map((e) => e.id)).toEqual(['c1:PRINT_PRODUCT_LABEL:-:1', 'c1:POST_THANKS:LIVE_CHAT:1', 'c1:POST_THANKS:VIDEO_COMMENT:1'])
    expect(emitted[1]?.[1]).toEqual({
      id: 'c1:POST_THANKS:LIVE_CHAT:1',
      kind: 'POST_THANKS',
      target: 'LIVE_CHAT',
      claim: 'c1',
      product: 'b1/15',
      broadcast: 'b1',
      no: 15,
      buyer: 'A',
      text: '15번 핑크프릴 10,000원 A님 구매 감사합니다',
      confirmVersion: 1,
    } satisfies EngineEffect)
  })

  it('효과 목록 = 처음부터 applyEvent가 돌려준 효과를 모두 모은 것 (빠짐·추가 없음)', () => {
    const { state, emitted } = play([
      register(15),
      chat('A', '15'),
      chat('B', '15'),
      report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1'),
      host('host.cancel', 15, 'A'),
      chat('C', '15'),
      host('host.reject', 15, 'B'),
    ])
    expect(listEffects(state).map((e) => e.id)).toEqual(emitted.flat().map((e) => e.id))
  })

  it('출력·감사를 모두 끄면 효과가 없고 확정버전만 오른다', () => {
    const { state } = play([register(15), chat('A', '15'), host('host.cancel', 15, 'A'), chat('B', '15')], { 'print.autoOnConfirm': false, 'thanks.liveChat': false })
    expect(listEffects(state)).toEqual([])
    expect(listClaims(state).map((c) => c.confirmVersion)).toEqual([1, 2])
  })
})

describe('감사 문구 (AC-S02-71)', () => {
  it('규칙 문장의 예', () => {
    expect(formatThanksText({ no: 15, name: '', price: 8000, buyerName: '홍길동' })).toBe('15번 8,000원 홍길동님 구매 감사합니다')
    expect(formatThanksText({ no: 15, name: '   ', price: 8000, buyerName: '홍길동' })).toBe('15번 8,000원 홍길동님 구매 감사합니다')
    expect(formatThanksText({ no: 18, name: ' 방울복랑 금 ', price: 15000, buyerName: '김철수' })).toBe('18번 방울복랑 금 15,000원 김철수님 구매 감사합니다')
    expect(formatThanksText({ no: 1, name: '미니마', price: 0, buyerName: 'x' })).toBe('1번 미니마 0원 x님 구매 감사합니다')
  })

  it('앞머리(D-RETRO-02): 구매자 이름 앞까지이고 끝에 공백 하나 — 전체 문구 = 앞머리 + `{구매자}님 구매 감사합니다`', () => {
    expect(formatThanksHead({ no: 15, name: '핑크프릴', price: 10000 })).toBe('15번 핑크프릴 10,000원 ')
    expect(formatThanksHead({ no: 15, name: '  ', price: 8000 })).toBe('15번 8,000원 ')
    expect(formatThanksHead({ no: 31, name: '수건', price: 10000, optionText: '흰색/대형', qty: 2 })).toBe('31번 수건 흰색/대형 2개 20,000원 ')
    for (const input of [
      { no: 15, name: '', price: 8000 },
      { no: 18, name: ' 방울복랑 금 ', price: 15000 },
      { no: 31, name: '수건', price: 10000, optionText: '흰색/대형', qty: 2 },
    ]) {
      expect(formatThanksText({ ...input, buyerName: '홍길동' })).toBe(`${formatThanksHead(input)}홍길동님 구매 감사합니다`)
    }
    expect(() => formatThanksHead({ no: 1, name: 'x', price: 1, qty: 0 })).toThrow(RangeError)
  })

  it('금액: 800원·10,000원·1,000,000원, 음수는 앞에 -, 정수가 아니면 RangeError', () => {
    expect([800, 10000, 1000000, 999, 1000, 0, -1234567].map(formatWon)).toEqual(['800원', '10,000원', '1,000,000원', '999원', '1,000원', '0원', '-1,234,567원'])
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) expect(() => formatWon(bad)).toThrow(RangeError)
  })

  it('속성: 0 ≤ 가격 ≤ 10^12에서 쉼표를 지우면 원래 수, 쉼표 사이는 정확히 세 자리', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 12 }), (price) => {
        const text = formatWon(price)
        expect(text.endsWith('원')).toBe(true)
        const body = text.slice(0, -1)
        expect(Number(body.replaceAll(',', ''))).toBe(price)
        const groups = body.split(',')
        expect(groups[0]?.length).toBeGreaterThanOrEqual(1)
        expect(groups[0]?.length).toBeLessThanOrEqual(3)
        for (const group of groups.slice(1)) expect(group).toMatch(/^\d{3}$/)
        if (groups.length > 1) expect(groups[0]).not.toMatch(/^0/)
      }),
    )
  })

  it('구매자 = 확정되는 순간의 표시 이름', () => {
    const { state } = play([register(15), chat('A', '15', { nick: '처음' }), chat('B', '15', { nick: '김철수' }), chat('B', '안녕', { nick: '철수맘' }), host('host.cancel', 15, 'A')])
    expect(listEffects(state).filter((e) => e.kind === 'POST_THANKS').map((e) => e.text)).toEqual([
      '15번 핑크프릴 10,000원 처음님 구매 감사합니다',
      '15번 핑크프릴 10,000원 철수맘님 구매 감사합니다',
    ])
  })
})

describe('확정이 풀릴 때 (AC-S02-72)', () => {
  it('미실행 효과는 취소, 출력된 라벨만 VOID_LABEL(그 확정버전), 게시된 감사는 그대로', () => {
    const { state, emitted } = play([
      register(15),
      chat('A', '15'),
      report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1'),
      report('effect.thanksSent', 'c1:POST_THANKS:LIVE_CHAT:1'),
      host('host.reject', 15, 'A'),
    ])
    expect(emitted[4]?.map((e) => e.id)).toEqual(['c1:VOID_LABEL:-:1'])
    expect(effectsOf(state)).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'DONE'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'DONE'],
      ['c1:VOID_LABEL:-:1', 'PENDING'],
    ])
  })

  it('차단은 확정을 풀지 않는다 (효과 그대로)', () => {
    const { state } = play([register(15), chat('A', '15'), { type: 'host.blockBuyer', buyer: 'A', reason: 'r' }])
    expect(effectsOf(state).map(([, status]) => status)).toEqual(['PENDING', 'PENDING'])
  })
})

describe('효과 보고와 잠금 (AC-S02-73)', () => {
  it('실행 대상인 효과의 보고 → 완료 + 지금 확정이면 잠금', () => {
    const { state } = play([register(15), chat('A', '15'), report('effect.thanksSent', 'c1:POST_THANKS:LIVE_CHAT:1')])
    expect(effectsOf(state)).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'PENDING'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'DONE'],
    ])
    expect(locked(state, 'A')).toBe(true)
  })

  it('이미 완료된 효과의 보고·모르는 효과 ID·종류가 다른 보고·VOID_LABEL의 출력 보고는 아무 일도 없다', () => {
    const base = [register(15), chat('A', '15'), report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1'), host('host.cancel', 15, 'A')]
    for (const event of [
      report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1'),
      report('effect.labelPrinted', 'c9:PRINT_PRODUCT_LABEL:-:1'),
      report('effect.labelPrinted', 'c1:POST_THANKS:LIVE_CHAT:1'),
      report('effect.thanksSent', 'c1:PRINT_PRODUCT_LABEL:-:1'),
      report('effect.labelPrinted', 'c1:VOID_LABEL:-:1'),
    ]) {
      const { states, emitted } = play([...base, event])
      expect(states[5], JSON.stringify(event)).toBe(states[4])
      expect(emitted[4]).toEqual([])
    }
  })

  it('취소된 라벨의 늦은 보고: 완료로 기록, 잠금 없음, VOID_LABEL(그 확정버전)', () => {
    // A 확정(1) → A 취소(라벨 A1 출력 전 → 취소) → B 승계(2) → 늦게 A1 출력 보고
    const { state, emitted } = play([register(15), chat('A', '15'), chat('B', '15'), host('host.cancel', 15, 'A'), report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1')])
    expect(emitted[4]?.map((e) => [e.id, e.buyer, e.confirmVersion])).toEqual([['c1:VOID_LABEL:-:1', 'A', 1]])
    expect(effectsOf(state).filter(([id]) => (id as string).startsWith('c1:'))).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'DONE'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'CANCELLED'],
      ['c1:VOID_LABEL:-:1', 'PENDING'],
    ])
    expect(locked(state, 'B')).toBe(false)
    expect(listClaims(state).find((c) => c.buyer === 'A')?.locked).toBe(false)
    // 같은 늦은 보고를 한 번 더 → 이미 완료 → 아무 일도 없음 (VOID_LABEL 중복 없음)
    const again = play([register(15), chat('A', '15'), chat('B', '15'), host('host.cancel', 15, 'A'), report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1'), report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1')])
    expect(again.states[6]).toBe(again.states[5])
  })

  it('취소된 감사의 늦은 보고: 완료로 기록, 잠금 없음, 폐기 없음', () => {
    const { state, emitted } = play([register(15), chat('A', '15'), host('host.cancel', 15, 'A'), report('effect.thanksSent', 'c1:POST_THANKS:LIVE_CHAT:1')])
    expect(emitted[3]).toEqual([])
    expect(effectsOf(state)).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'CANCELLED'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'DONE'],
    ])
  })

  it('잠금은 확정 하나에 대한 것: 다시 확정되면 이전 확정의 늦은 보고로는 잠기지 않는다', () => {
    const { state } = play([
      register(15),
      chat('A', '15'),
      chat('X', '안녕'),
      { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' },
      host('host.cancel', 15, 'X'),
      report('effect.thanksSent', 'c1:POST_THANKS:LIVE_CHAT:1'),
    ])
    expect(locked(state, 'A')).toBe(false)
    const fresh = play([
      register(15),
      chat('A', '15'),
      chat('X', '안녕'),
      { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' },
      host('host.cancel', 15, 'X'),
      report('effect.thanksSent', 'c1:POST_THANKS:LIVE_CHAT:3'),
    ])
    expect(locked(fresh.state, 'A')).toBe(true)
  })

  it('AUTO 시청자 취소의 잠금 경계: 출력 보고 뒤면 요청, 직전이면 바로 취소', () => {
    const settings = { 'cancel.buyerChat': 'AUTO' } as const
    const after = play([register(15), chat('A', '15'), report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1'), chat('A', '15 취소')], settings)
    expect(listClaims(after.state)[0]?.status).toBe('CONFIRMED')
    const before = play([register(15), chat('A', '15'), chat('A', '15 취소'), report('effect.labelPrinted', 'c1:PRINT_PRODUCT_LABEL:-:1')], settings)
    expect(listClaims(before.state)[0]?.status).toBe('CANCELLED')
    // 취소된 라벨의 늦은 보고 → 폐기 표시
    expect(listEffects(before.state).map((e) => e.kind)).toEqual(['PRINT_PRODUCT_LABEL', 'POST_THANKS', 'VOID_LABEL'])
  })
})
