// AC-L1-08 가린 이름 (D-L1-05): 순수 함수 표 시험 — 이메일 원문·닉네임 원문 대신 이 값만 저장한다.
import { describe, expect, it } from 'vitest'
import { MASKED_LABEL_MAX, maskedLabel } from '../src/social/masked.ts'

describe('AC-L1-08 가린 이름 규칙', () => {
  it.each([
    ['seller.kim@gmail.com', null, 'se***@gmail.com'],
    ['ab@naver.com', null, 'a***@naver.com'],
    ['a@kakao.com', null, 'a***@kakao.com'],
    [null, '다육이네', '다***'],
    [null, null, ''],
    ['', '', ''],
    ['no-at-sign', '다육이네', '다***'],
    ['@gmail.com', '초록', '초***'],
    ['seller@', null, ''],
    ['seller@', '밤톨맘', '밤***'],
    ['@', null, ''],
    // 코드 포인트로 센다 (그림 문자 하나 = 한 글자)
    ['🌵🌵🌵@kakao.com', null, '🌵🌵***@kakao.com'],
    ['🌵@kakao.com', null, '🌵***@kakao.com'],
    [null, '🌵다육', '🌵***'],
    // 이메일이 있으면 닉네임보다 앞선다
    ['seller.kim@gmail.com', '다육이네', 'se***@gmail.com'],
  ])('이메일 %j · 닉네임 %j → %j', (email, nickname, expected) => {
    expect(maskedLabel(email, nickname)).toBe(expected)
  })

  it('제어·서식 글자는 빼고(줄바꿈·방향 바꾸기·폭 없는 글자) 앞뒤 공백을 지운다', () => {
    expect(maskedLabel('se‮ll\ner@gmail.com', null)).toBe('se***@gmail.com')
    expect(maskedLabel(null, '​\n다육')).toBe('다***')
    expect(maskedLabel('  seller@naver.com ', null)).toBe('se***@naver.com')
    expect(maskedLabel(null, '\u0000\u0007')).toBe('')
  })

  it('40자에서 자른다 (코드 포인트)', () => {
    const label = maskedLabel(`seller@${'a'.repeat(60)}.com`, null)
    expect([...label].length).toBe(MASKED_LABEL_MAX)
    expect(label.startsWith('se***@aaa')).toBe(true)
    expect(MASKED_LABEL_MAX).toBe(40)
  })

  it('이메일 앞부분 원문은 2글자까지만 남는다', () => {
    const label = maskedLabel('secret.name.here@example.com', null)
    expect(label).not.toContain('secret')
    expect(label).toBe('se***@example.com')
  })
})
