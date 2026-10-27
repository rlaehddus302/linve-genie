// AC-V3-93 (R-17 8 7, D-V3-102): 앞 결과 끝 수와 이어질 수 있는 새 결과 첫 'N번'
import { describe, expect, it } from 'vitest'
import { JOIN_PREV_MS, joinPrevious, joinPreviousNote } from '../src/index.ts'

const T = 1_000_000
const join = (previous: string, text: string, after = 1_000, maxNumber = 300) => joinPrevious({ previous, previousAt: T, text, now: T + after, maxNumber })

describe('AC-V3-93 앞 결과와 이어질 수 있는 번호', () => {
  it('(1) ⓐ "자 이 아이 3만 원 159" 뒤 "59번 3만 원" → 159', () => {
    expect(join('자 이 아이 3만 원 159', '59번 3만 원')).toEqual({ heard: 59, joined: 159 })
  })
  it('(2) ⓑ 끝 "23" 뒤 "1번 2만 원" → 231', () => {
    expect(join('자 요거 23', '1번 2만 원')).toEqual({ heard: 1, joined: 231 })
  })
  it('(3) ⓐ 끝 "173" 뒤 "3번 5만 원" → 173', () => {
    expect(join('세금 173', '3번 5만 원')).toEqual({ heard: 3, joined: 173 })
  })
  it('(4) 끝 "128 자"(군말 건너뜀) 뒤 "28번 5만 원" → 128', () => {
    expect(join('블루 녹금 128 자', '28번 5만 원')).toEqual({ heard: 28, joined: 128 })
  })
  it('(5) 앞 결과 끝이 가격 줄 "3만 원" → 해당 없음', () => {
    expect(join('자 이 아이 3만 원', '59번 3만 원')).toBeNull()
  })
  it('(6) 앞 결과가 끝난 지 10,000ms면 보고 10,001ms면 안 본다', () => {
    expect(join('3만 원 159', '59번 3만 원', JOIN_PREV_MS)).toEqual({ heard: 59, joined: 159 })
    expect(join('3만 원 159', '59번 3만 원', JOIN_PREV_MS + 1)).toBeNull()
  })
  it('(7) 끝 "23" 뒤 "9번", maxNumber 200 → 239 > 200이고 ⓐ 아님 → 해당 없음', () => {
    expect(join('자 23', '9번 2만 원', 1_000, 200)).toBeNull()
  })
  it('(9) 새 결과 첫 번호 앞에 군말 아닌 말 "자 좋아요 59번 3만 원" → 해당 없음, 군말만이면 "자 59번" → 159', () => {
    expect(join('3만 원 159', '자 좋아요 59번 3만 원')).toBeNull()
    expect(join('3만 원 159', '자 59번 3만 원')).toEqual({ heard: 59, joined: 159 })
  })
  it('끝 문장 부호는 지운다 · 한글 수는 보지 않는다 · 앞 결과가 없으면 해당 없음', () => {
    expect(join('3만 원 159.', '59번이고요 3만 원')).toEqual({ heard: 59, joined: 159 })
    expect(join('3만 원 백오십구', '59번 3만 원')).toBeNull()
    expect(joinPrevious({ previous: null, previousAt: null, text: '59번 3만 원', now: T, maxNumber: 300 })).toBeNull()
  })
  it('안내 글', () => {
    expect(joinPreviousNote(59, 159)).toBe('59번으로 들렸어요. 159번이 맞는지 확인해 주세요')
  })
})
