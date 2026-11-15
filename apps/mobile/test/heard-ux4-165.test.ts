// 들린 말을 문장으로 나누기 (D-UX4-165, 사용자 2026-11-16 "음성인식이 끊기지 않고 계속 이어지면 너무 긴 문장으로 보내지는데 이렇게 해야하나?")
import { describe, expect, it } from 'vitest'
import { HEARD_SENTENCE_MAX, heardSentences, splitHeard } from '../src/screens/console/heard-history.ts'

describe('들린 말 문장 나누기 (D-UX4-165)', () => {
  it('문장 끝(. ? !) 뒤에서 나누고, 짧은 말은 그대로', () => {
    expect(heardSentences('15번 이만 원이요. 누가 가져가실래요? 좋아요!')).toEqual(['15번 이만 원이요.', '누가 가져가실래요?', '좋아요!'])
    expect(heardSentences('  16번 갑니다  ')).toEqual(['16번 갑니다'])
    expect(heardSentences('')).toEqual([])
  })
  it('문장 끝 없이 긴 말은 띄어쓰기에서 나눠 한 줄이 HEARD_SENTENCE_MAX를 넘지 않는다 — 글자는 빠지지 않는다', () => {
    const text = '자 이거 보세요 이게 진짜 색이 너무 예쁘고 잎이 통통하고 한여름에도 물러지지 않는 아이라서 키우기도 쉬워요 이거 이만 원에 드릴게요'
    const parts = heardSentences(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(HEARD_SENTENCE_MAX)
    expect(parts.join(' ')).toBe(text)
  })
  it('띄어쓰기가 없으면 나누지 않는다', () => {
    const text = '가'.repeat(HEARD_SENTENCE_MAX + 10)
    expect(heardSentences(text)).toEqual([text])
  })
  it('나뉜 문장은 원래 줄의 시각을 갖는다', () => {
    expect(splitHeard([{ at: 1_000, text: '하나. 둘.' }, { at: 2_000, text: '셋' }])).toEqual([{ at: 1_000, text: '하나.' }, { at: 1_000, text: '둘.' }, { at: 2_000, text: '셋' }])
  })
})
