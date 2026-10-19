// 문자찜 "받은 시각" 읽기 (AC-S06-12, R-6 D-023, D-089). 시험은 TZ=Pacific/Honolulu에서 돈다 — 날짜·시각은 늘 KST로 읽는다.
import { describe, expect, it } from 'vitest'
import { RECEIVED_INVALID, readReceived, receivedWords } from '../src/lib/received.ts'

/** KST 시각 → UTC 밀리초 */
const kst = (iso: string): number => Date.parse(`${iso}+09:00`)
const NOW = kst('2026-10-18T20:05:00')

function ok(text: string, now = NOW) {
  const read = readReceived(text, now)
  if (read.kind !== 'ok') throw new Error(`${text}: ${read.kind}`)
  return read
}

describe('받은 시각 읽기 표 (AC-S06-12, 지금 = 20:05)', () => {
  it.each([
    ['20:01', '20:01', true],
    ['2001', '20:01', true],
    ['20:01:05', '20:01:05', false],
    ['200105', '20:01:05', false],
    ['8:01', '20:01', true],
    ['801', '20:01', true],
    ['8:01:05', '20:01:05', false],
    ['80105', '20:01:05', false],
    ['오후 8:01', '20:01', true],
    ['오후8:01', '20:01', true],
    ['오전 8:01', '08:01', true],
    ['08:01', '08:01', true],
    ['0801', '08:01', true],
    ['00:30', '00:30', true],
    ['13:05', '13:05', true],
    ['  20:01  ', '20:01', true],
  ])('%s → %s', (text, value, minute) => {
    const read = ok(text)
    expect(read.value).toBe(value)
    expect(read.minute).toBe(minute)
  })

  it.each(['25:00', '20:61', '2:5', '20:01:60', '24:00', '오후 13:00', '8시 1분', 'abc', '1', '12', '1234567', '20-01'])('%s → 읽지 못함', (text) => {
    expect(readReceived(text, NOW)).toEqual({ kind: 'invalid' })
    expect(RECEIVED_INVALID).toBe('받은 시각을 20:01처럼 적어 주세요.')
  })

  it('빈칸은 비움 (서버가 도착 시각을 초까지 적는다 — received를 보내지 않는다)', () => {
    expect(readReceived('', NOW)).toEqual({ kind: 'empty' })
    expect(readReceived('   ', NOW)).toEqual({ kind: 'empty' })
  })

  it('12:30은 00:30·12:30 중 가까운 쪽 — 지금 14:00이면 오늘 12:30, 지금 20:05이면 내일 00:30(늦음 → 확인)', () => {
    expect(ok('12:30', kst('2026-10-18T14:00:00')).value).toBe('12:30')
    const late = ok('12:30')
    expect([late.value, late.day, late.late]).toEqual(['00:30', '내일', true])
  })

  it('두 읽기의 거리가 같으면 이른 쪽', () => {
    // 지금 14:00 — 8:00(오늘 08:00, 6시간 전)과 20:00(오늘 20:00, 6시간 뒤)
    expect(ok('8:00', kst('2026-10-18T14:00:00')).value).toBe('08:00')
  })
})

describe('날짜 (D-023 — 어제·오늘·내일)와 늦은 시각', () => {
  it('읽은 값과 날짜를 함께 "오늘 20:01"', () => {
    expect(receivedWords(ok('20:01'))).toBe('오늘 20:01')
  })

  it('자정 근처: 00:10에 23:50 → 어제, 23:55에 00:05 → 내일(늦음)', () => {
    const early = ok('23:50', kst('2026-10-19T00:10:00'))
    expect(early.day).toBe('어제')
    expect(early.late).toBe(false)
    const late = ok('00:05', kst('2026-10-18T23:55:00'))
    expect(late.day).toBe('내일')
    expect(late.late).toBe(true)
  })

  it('지금보다 늦으면 late (분까지면 그 분의 시작으로 비교): 20:05:30에 20:05는 늦지 않고 20:06은 늦다', () => {
    const now = kst('2026-10-18T20:05:30')
    expect(ok('20:05', now).late).toBe(false)
    expect(ok('20:06', now).late).toBe(true)
    expect(ok('20:05:31', now).late).toBe(true)
  })

  it('오전을 잘못 붙이면 가장 가까운 날짜로 읽어 늦을 수 있다 — 20:05에 "오전 8:01"은 내일 08:01', () => {
    const read = ok('오전 8:01')
    expect(read.day).toBe('내일')
    expect(read.late).toBe(true)
    expect(receivedWords(read)).toBe('내일 08:01')
  })

  it('날짜는 실행 환경 시간대와 상관없이 KST', () => {
    expect(process.env.TZ).not.toBe('Asia/Seoul')
    expect(ok('20:01').time).toBe(kst('2026-10-18T20:01:00'))
  })
})
