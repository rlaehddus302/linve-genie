// D-V2-19 말고 앞 값이 카드 값과 다르면 고칠까요 (AC-V2-35 단위), D-V2-20 음성 기록의 8자리 이상 숫자 가림 (AC-V2-37 단위)
import { describe, expect, it } from 'vitest'
import { chooseAction, confirmEditMessage, createLogEntry, maskLongDigits, readChunk, type SuggestionCard } from '../src/index.ts'

const card = (price: number | null, name: string | null = '핑크문'): SuggestionCard => ({
  id: 'c1',
  no: 15,
  name,
  price,
  confidence: 'HIGH',
  text: '15번 핑크문',
  createdAt: 0,
  status: 'OPEN',
  touched: false,
  autoConfirmAt: 5000,
})

const act = (text: string, cards: SuggestionCard[]) => chooseAction(readChunk(text, { dictionary: ['핑크문', '루비'] }), { cards, now: 1000 })

describe('D-V2-19 말고 앞 값 비교', () => {
  it('카드 12,000원에 "만오천 말고 만팔천" → 바로 고치지 않고 묻는다', () => {
    const action = act('만오천 말고 만팔천', [card(12_000)])
    expect(action.kind).toBe('confirmEdit')
    if (action.kind !== 'confirmEdit') return
    expect(action.cardId).toBe('c1')
    expect(action.changes).toEqual({ price: 18_000 })
    expect(action.message).toBe('12,000원을 18,000원으로 고칠까요?')
    expect(action.editMessage).toBe('고쳤어요: 가격 12,000원 → 18,000원')
  })
  it('카드 15,000원이면 S5처럼 바로 고친다', () => {
    const action = act('만오천 말고 만팔천', [card(15_000)])
    expect(action.kind).toBe('edit')
  })
  it('앞 조각에 그 칸이 없으면("아니 만팔천") 바로 고친다', () => {
    expect(act('아니 만팔천', [card(12_000)]).kind).toBe('edit')
  })
  it('카드 그 칸이 비었으면 덮을 값이 없어 바로 고친다', () => {
    expect(act('만오천 말고 만팔천', [card(null)]).kind).toBe('edit')
  })
  it('품종도 앞 값이 다르면 묻는다', () => {
    const action = act('루비 말고 핑크문', [card(10_000, '루비')])
    expect(action.kind).toBe('edit')
    const other = act('루비 말고 핑크문', [{ ...card(10_000, '라울') }])
    expect(other.kind).toBe('confirmEdit')
    if (other.kind === 'confirmEdit') expect(other.message).toBe('라울을 핑크문으로 고칠까요?')
  })
  it('readChunk lead는 정정 덩어리 첫 조각만', () => {
    expect(readChunk('만오천 말고 만팔천').lead).toEqual({ no: null, name: null, price: 15_000 })
    expect(readChunk('아니 만팔천').lead).toEqual({ no: null, name: null, price: null })
    expect(readChunk('만오천').lead).toEqual({ no: null, name: null, price: null })
  })
  it('문장 조사', () => {
    expect(confirmEditMessage(card(12_000), { price: 20_000 })).toBe('12,000원을 20,000원으로 고칠까요?')
  })
})

describe('D-V2-20 긴 숫자 가림', () => {
  it('8자리 이상(공백·- 포함)은 ••••, 7자리 이하는 그대로', () => {
    expect(maskLongDigits('끝자리 010-1234-5678 만원')).toBe('끝자리 •••• 만원')
    expect(maskLongDigits('01012345678')).toBe('••••')
    expect(maskLongDigits('1234 5678')).toBe('••••')
    expect(maskLongDigits('15번 만오천 15000')).toBe('15번 만오천 15000')
    expect(maskLongDigits('1234567')).toBe('1234567')
    expect(maskLongDigits('12345678')).toBe('••••')
  })
  it('기록에 넣을 때 가린다 — 가리기 전 글은 남지 않는다', () => {
    const entry = createLogEntry({ at: 0, pieces: [{ text: '끝자리 010-1234-5678 만원' }], action: 'discard' })
    expect(entry.pieces[0]?.text).toBe('끝자리 •••• 만원')
    expect(JSON.stringify(entry)).not.toContain('5678')
  })
})
