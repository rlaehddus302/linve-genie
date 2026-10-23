// V2 적대 시험 (test-domain, AC-V2-36·37, D-V2-16·17·18): 스펙 판정 뒤 사례 S22~S24와 배우기 막기를 공격한다.
import { canLearnAlias, learnAlias, readChunk } from '@livejjim/voice'
import { describe, expect, it } from 'vitest'
import { DICT, openCards, simulate, view } from './sim.ts'

describe('새 번호면 끊기 (D-V2-16, AC-V2-36)', () => {
  it('S22: 26번 뒤 "27번 라울 이만원 아니 삼만원"(1000) → 카드 둘, 둘째는 정정 덩어리 30,000원 LOW', () => {
    const r = simulate([{ text: '26번 엘레강스 만원', at: 0 }, { text: '27번 라울 이만원 아니 삼만원', at: 1000 }], 4000)
    expect(r.chunks.map((c) => c.text)).toEqual(['26번 엘레강스 만원', '27번 라울 이만원 아니 삼만원'])
    expect(openCards(r.cards).map(view)).toEqual([{ no: 26, name: '엘레강스', price: 10_000 }, { no: 27, name: '라울', price: 30_000 }])
    expect(openCards(r.cards)[1]?.confidence).toBe('LOW')
  })
  it('S23: 번호 없는 "핑크문 만원" 뒤 "16번 루비 이만원"(1000) → 끊어서 카드 둘', () => {
    const r = simulate([{ text: '핑크문 만원', at: 0 }, { text: '16번 루비 이만원', at: 1000 }], 4000)
    expect(openCards(r.cards).map(view)).toEqual([{ no: null, name: '핑크문', price: 10_000 }, { no: 16, name: '루비', price: 20_000 }])
  })
  it('S13 그대로: "22번 라울 만원" + "아니 아니 23번"(1000) → 끊지 않고 23번 한 장', () => {
    const r = simulate([{ text: '22번 라울 만원', at: 0 }, { text: '아니 아니 23번', at: 1000 }], 4000)
    expect(openCards(r.cards).map(view)).toEqual([{ no: 23, name: '라울', price: 10_000 }])
  })
})

describe('칸 이름은 조각만 나눔 (D-V2-18, AC-V2-36)', () => {
  it('S24: "15번 품종 핑크문 만원" → 15번 · 핑크문 · 10,000원', () => {
    const r = readChunk('15번 품종 핑크문 만원', { dictionary: DICT })
    expect([r.no, r.name, r.price]).toEqual([15, '핑크문', 10_000])
  })
})

describe('사전에 있는 이름은 배우지 않음 (D-V2-17, AC-V2-37)', () => {
  it.each([['핑크문', '루비'], ['핑크 문', '루비'], ['라운', '핑크문']])('들은 말 "%s" → %s 골라도 배우지 않음', (heard, name) => {
    const learned = learnAlias([], { heard, name, at: 1 })
    expect(learned).toEqual([])
    expect(canLearnAlias(heard, name)).toBe(false)
  })
})
