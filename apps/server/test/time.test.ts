// NFR-07, D-026: 시각은 UTC로, KST는 날짜·받은 시각 기본값 계산에만 — 실행 환경 시간대와 상관없이 같은 결과
import { describe, expect, it } from 'vitest'
import { iso, kstDate, kstTime, withIsoTimes } from '../src/time.ts'

describe('KST 날짜·시각 (NFR-07)', () => {
  it('UTC 15:00 전후로 KST 날짜가 바뀐다 (시험 시간대와 상관없이)', () => {
    expect(process.env.TZ).toBe('Pacific/Honolulu')
    expect(kstDate(Date.UTC(2026, 9, 18, 14, 59, 59))).toBe('2026-10-18')
    expect(kstDate(Date.UTC(2026, 9, 18, 15, 0, 0))).toBe('2026-10-19')
    expect(kstTime(Date.UTC(2026, 9, 18, 15, 4, 5))).toBe('00:04:05')
    expect(kstDate(Date.UTC(2026, 11, 31, 15, 0, 0))).toBe('2027-01-01')
  })

  it('ISO 8601은 Z로 끝난다', () => {
    expect(iso(Date.UTC(2026, 9, 18, 15, 0, 0))).toBe('2026-10-18T15:00:00.000Z')
  })

  it('코어 조회 결과의 시각 필드(at·endedAt·rankTime)만 ISO로 바꾼다', () => {
    const value = { at: 0, endedAt: null, rankTime: 1000, seq: 5, nested: [{ at: 60000, price: 3 }], settings: { 'waitlist.max': 5 } }
    expect(withIsoTimes(value)).toEqual({
      at: '1970-01-01T00:00:00.000Z',
      endedAt: null,
      rankTime: '1970-01-01T00:00:01.000Z',
      seq: 5,
      nested: [{ at: '1970-01-01T00:01:00.000Z', price: 3 }],
      settings: { 'waitlist.max': 5 },
    })
  })

  it('신뢰할 수 없는 키(__proto__)도 자기 속성으로 남는다', () => {
    const value = JSON.parse('{"__proto__": {"at": 0}}') as Record<string, unknown>
    const converted = withIsoTimes(value)
    expect(Object.hasOwn(converted, '__proto__')).toBe(true)
    expect(JSON.stringify(converted)).toBe('{"__proto__":{"at":"1970-01-01T00:00:00.000Z"}}')
  })
})
