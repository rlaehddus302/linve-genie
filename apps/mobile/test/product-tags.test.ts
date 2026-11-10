// 방송 상품 줄 꼬리표 (D-UX3-78 → D-UX4-24): [닉네임]·[문자-끝4자리] → 대기 손님 → 한 줄에 못 놓으면 [+N]. 1등·대기는 색으로만 나눈다
import { describe, expect, it } from 'vitest'
import { TAG_GAP, buyerTagText, fitTags, tagWidth, type ProductTag } from '../src/lib/product-tags.ts'
import { rowName, rowTags } from '../src/screens/console/ProductBoard.tsx'
import { koreanWon } from '../src/lib/korean-won.ts'
import { buyer, product } from './support.ts'

describe('상품 줄 꼬리표 (D-UX3-78)', () => {
  // 옛 기대(D-UX3-78): 1등 "찜 홍길동", 문자찜 "문자찜 0937". 새 기대(D-UX4-24, 사용자 지시 2026-11-09 "닉네임만 보여줘. 문자는 [문자-0937]")
  it('닉네임만, 문자 손님은 "문자-끝4자리"(전화번호 전체는 쓰지 않는다) — 1등이어도 낱말을 붙이지 않는다', () => {
    expect(buyerTagText({ kind: 'youtube', phoneLast4: null }, '홍길동', true)).toBe('홍길동')
    expect(buyerTagText({ kind: 'youtube', phoneLast4: null }, '홍길동', false)).toBe('홍길동')
    expect(buyerTagText({ kind: 'sms', phoneLast4: '0937' }, '010-1234-0937', true)).toBe('문자-0937')
    expect(buyerTagText({ kind: 'sms', phoneLast4: '0937' }, '김', false)).toBe('문자-0937')
    expect(buyerTagText({ kind: 'sms', phoneLast4: null }, '이름만손님', true)).toBe('이름만손님')
  })

  // 옛 기대: 1등 바로 뒤 손님 꼬리표(CR-7). 새 기대(D-UX4-24): 닉네임만 — 손님 꼬리표는 줄에 붙이지 않는다
  it('찜·대기 순서 그대로, 닉네임만 놓는다', () => {
    const buyers = new Map([['u1', buyer('u1', '홍길동')], ['u2', buyer('u2', '문자손님', { kind: 'sms', phoneLast4: '0937' })], ['u3', buyer('u3', '김영희')]])
    const item = product(3, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 'u3'], waitlistClaims: ['c2', 'c3'] })
    const { tags, keep } = rowTags(item, (id) => buyers.get(id), (id) => buyers.get(id)?.display ?? '')
    expect(tags).toEqual([
      { kind: 'win', text: '홍길동' },
      { kind: 'wait', text: '문자-0937' },
      { kind: 'wait', text: '김영희' },
    ])
    expect(keep).toBe(1)
    expect(rowTags(product(4), () => undefined, () => '').tags).toEqual([])
  })

  it('한 줄에 들어가는 만큼만 놓고 나머지는 +N, 폭을 모르면 모두 놓는다', () => {
    const tags: ProductTag[] = [{ kind: 'win', text: '홍길동' }, ...['김영희', '박철수', '이민지', '최다육'].map((text) => ({ kind: 'wait' as const, text }))]
    expect(fitTags(tags, 0, 12)).toEqual({ shown: tags, more: 0 })
    const all = tags.reduce((sum, tag) => sum + tagWidth(tag.text, 12), 0) + TAG_GAP * (tags.length - 1)
    expect(fitTags(tags, all, 12)).toEqual({ shown: tags, more: 0 })
    const narrow = fitTags(tags, tagWidth('홍길동', 12) + TAG_GAP + tagWidth('김영희', 12) + TAG_GAP + tagWidth('+5', 12), 12)
    expect(narrow.shown.map((tag) => tag.text)).toEqual(['홍길동', '김영희'])
    expect(narrow.more).toBe(3)
    // 아주 좁아도 1등은 남긴다
    expect(fitTags(tags, 10, 12).shown).toEqual([tags[0]])
  })

  it('한글 금액 읽기 — 토스처럼 억·만으로 끊는다 (D-UX4-23)', () => {
    expect(koreanWon(15_000)).toBe('1만 5,000원')
    expect(koreanWon(150_000)).toBe('15만원')
    expect(koreanWon(1_500)).toBe('1,500원')
    expect(koreanWon(123_456_789)).toBe('1억 2,345만 6,789원')
    expect(koreanWon(0)).toBe('0원')
  })

  // 옛 기대(D-UX3-78): 비어 있으면 "-". 새 기대(D-UX4-111, 사용자 "품종 없으면 - 했는데 그냥 아무것도 넣지 말자"): 빈 글
  it('품종이 비어 있으면 아무것도 쓰지 않는다 (옛 "품종 미입력" → "-" → 빈 글)', () => {
    expect(rowName({ name: '  ' })).toBe('')
    expect(rowName({ name: '핑크프릴' })).toBe('핑크프릴')
  })
})
