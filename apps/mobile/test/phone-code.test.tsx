// 인증번호 칸 값 고르기와 인증 성공 움직임 모양 (D-UX3-60)
import { describe, expect, it } from 'vitest'
import { nextCode, WIN_MS, winShape } from '../src/screens/PhoneVerify.tsx'

describe('nextCode — 문자 자동 채우기가 늘 들어간다 (D-UX3-60)', () => {
  it('빈 칸에 자동 채우기·붙여 넣기면 그 6자리', () => {
    expect(nextCode('', '659019')).toBe('659019')
    expect(nextCode('', '인증번호 [659019]')).toBe('659019')
  })
  it('숫자를 몇 개 쳐 둔 뒤 자동 채우기를 눌러도 문자 속 번호가 그대로 들어간다 (옛: 앞쪽만 잘려 틀린 번호)', () => {
    expect(nextCode('12', '12659019')).toBe('659019')
  })
  it('틀린 6자리가 남아 있어도 자동 채우기가 들어간다 (옛: 6자리 제한에 막혀 통째로 거절)', () => {
    expect(nextCode('000000', '000000659019')).toBe('659019')
  })
  it('아이폰이 번호를 두 번 넣어도 6자리 하나', () => {
    expect(nextCode('', '659019659019')).toBe('659019')
  })
  it('칸 전체를 새 번호로 바꿔 넣으면 그 번호', () => {
    expect(nextCode('000000', '659019')).toBe('659019')
    expect(nextCode('12', '659019')).toBe('659019')
  })
  it('하나씩 치고 지우는 것은 그대로', () => {
    expect(nextCode('', '1')).toBe('1')
    expect(nextCode('12', '123')).toBe('123')
    expect(nextCode('123', '12')).toBe('12')
    expect(nextCode('12345', '123456')).toBe('123456')
  })
  it('입력 자리가 끝이 아니어도(앞·가운데) 들어온 번호가 그대로 (D-UX3-61)', () => {
    expect(nextCode('000000', '659019000000')).toBe('659019')
    expect(nextCode('000000', '000659019000')).toBe('659019')
    expect(nextCode('12', '65901912')).toBe('659019')
  })
  it('틀린 6자리 뒤에 더 치면 새로 친 숫자부터 다시', () => {
    expect(nextCode('000000', '0000007')).toBe('7')
  })
})

describe('winShape — 합친 칸 → 알약 → 작은 원 → 커지며 살짝 넘쳤다 제 크기 (D-UX3-60)', () => {
  const at = (t: number) => winShape(t, 300, 60)
  it('처음은 합친 칸 그대로', () => {
    expect(at(0)).toEqual({ w: 300, h: 60, r: 16 })
  })
  it('줄어드는 중에는 가로가 더 긴 알약(모서리 = 높이의 반)', () => {
    const pill = at(400)
    expect(pill.w).toBeGreaterThan(pill.h)
    expect(pill.r).toBeCloseTo(pill.h / 2)
  })
  it('작은 원 38을 거쳐 78까지 커졌다가 72로 끝난다', () => {
    expect(at(520)).toEqual({ w: 38, h: 38, r: 19 })
    expect(at(820).w).toBe(78)
    expect(at(WIN_MS)).toEqual({ w: 72, h: 72, r: 36 })
  })
})
