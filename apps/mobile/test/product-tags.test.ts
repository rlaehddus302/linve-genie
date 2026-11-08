// 방송 상품 줄 꼬리표 (D-UX3-78): [찜 닉네임]·[문자찜 끝4자리] → 대기 손님 → 한 줄에 못 놓으면 [+N]
import { describe, expect, it } from 'vitest'
import { TAG_GAP, buyerTagText, fitTags, tagWidth, type ProductTag } from '../src/lib/product-tags.ts'
import { rowName, rowTags } from '../src/screens/console/ProductBoard.tsx'
import { buyer, product } from './support.ts'

describe('상품 줄 꼬리표 (D-UX3-78)', () => {
  it('1등은 "찜 닉네임", 문자찜은 "문자찜 끝4자리"(전화번호 전체는 쓰지 않는다), 대기 손님은 이름만', () => {
    expect(buyerTagText({ kind: 'youtube', phoneLast4: null }, '홍길동', true)).toBe('찜 홍길동')
    expect(buyerTagText({ kind: 'youtube', phoneLast4: null }, '홍길동', false)).toBe('홍길동')
    expect(buyerTagText({ kind: 'sms', phoneLast4: '0937' }, '010-1234-0937', true)).toBe('문자찜 0937')
    expect(buyerTagText({ kind: 'sms', phoneLast4: '0937' }, '김', false)).toBe('문자찜 0937')
    expect(buyerTagText({ kind: 'sms', phoneLast4: null }, '이름만손님', true)).toBe('문자찜 이름만손님')
  })

  it('찜·대기 순서 그대로, 손님 꼬리표는 1등 바로 뒤에 두고 잘리지 않게 한다', () => {
    const buyers = new Map([['u1', buyer('u1', '홍길동')], ['u2', buyer('u2', '문자손님', { kind: 'sms', phoneLast4: '0937' })], ['u3', buyer('u3', '김영희')]])
    const item = product(3, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 'u3'], waitlistClaims: ['c2', 'c3'] })
    const { tags, keep } = rowTags(item, (id) => buyers.get(id), (id) => buyers.get(id)?.display ?? '', '입금 늦음 주의')
    expect(tags).toEqual([
      { kind: 'win', text: '찜 홍길동' },
      { kind: 'badge', text: '입금 늦음 주의' },
      { kind: 'wait', text: '문자찜 0937' },
      { kind: 'wait', text: '김영희' },
    ])
    expect(keep).toBe(2)
    expect(rowTags(product(4), () => undefined, () => '').tags).toEqual([])
  })

  it('한 줄에 들어가는 만큼만 놓고 나머지는 +N, 폭을 모르면 모두 놓는다', () => {
    const tags: ProductTag[] = [{ kind: 'win', text: '찜 홍길동' }, ...['김영희', '박철수', '이민지', '최다육'].map((text) => ({ kind: 'wait' as const, text }))]
    expect(fitTags(tags, 0, 12)).toEqual({ shown: tags, more: 0 })
    const all = tags.reduce((sum, tag) => sum + tagWidth(tag.text, 12), 0) + TAG_GAP * (tags.length - 1)
    expect(fitTags(tags, all, 12)).toEqual({ shown: tags, more: 0 })
    const narrow = fitTags(tags, tagWidth('찜 홍길동', 12) + TAG_GAP + tagWidth('김영희', 12) + TAG_GAP + tagWidth('+5', 12), 12)
    expect(narrow.shown.map((tag) => tag.text)).toEqual(['찜 홍길동', '김영희'])
    expect(narrow.more).toBe(3)
    // 아주 좁아도 1등은 남긴다
    expect(fitTags(tags, 10, 12).shown).toEqual([tags[0]])
  })

  it('품종이 비어 있으면 "-" (옛 "품종 미입력")', () => {
    expect(rowName({ name: '  ' })).toBe('-')
    expect(rowName({ name: '핑크프릴' })).toBe('핑크프릴')
  })
})
