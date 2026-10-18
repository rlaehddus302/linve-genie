// AC-S00-26: at → UTC 변환은 고정 값과 같고, 프로세스 시간대와 무관하다 (D-022, D-026)
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { civilFromDays, daysFromCivil, formatUtcIso, isShortAt, isValidReceived, parseDate, resolveAt } from './time.ts'

function iso(text: string, base?: string): string {
  const result = resolveAt(text, base)
  if (!result.ok) throw new Error(result.reason)
  return formatUtcIso(result.utcMs)
}

describe('at → UTC (AC-S00-26 표)', () => {
  it.each([
    ['20:00:00', '2026-10-18T11:00:00.000Z'],
    ['20:00:02.1', '2026-10-18T11:00:02.100Z'],
    ['20:00:02.12', '2026-10-18T11:00:02.120Z'],
    ['20:00:02.100', '2026-10-18T11:00:02.100Z'],
    ['2026-10-19T00:00:10+09:00', '2026-10-18T15:00:10.000Z'],
    ['2026-10-18T15:00:10Z', '2026-10-18T15:00:10.000Z'],
    ['2026-10-18T15:00:10.5Z', '2026-10-18T15:00:10.500Z'],
    ['2026-10-18T05:00:10-10:00', '2026-10-18T15:00:10.000Z'],
    ['00:00:00', '2026-10-17T15:00:00.000Z'],
    ['08:59:59.999', '2026-10-17T23:59:59.999Z'],
    ['09:00:00', '2026-10-18T00:00:00.000Z'],
  ])('2026-10-18 방송의 %s → %s', (at, expected) => {
    expect(iso(at, '2026-10-18')).toBe(expected)
  })

  it('짧은 형식은 방송 날짜 기준, ISO는 방송 날짜를 무시', () => {
    expect(iso('20:00:00', '2026-10-19')).toBe('2026-10-19T11:00:00.000Z')
    expect(iso('2026-10-19T00:00:10+09:00', '2020-01-01')).toBe('2026-10-18T15:00:10.000Z')
    expect(iso('2026-10-19T00:00:10+09:00')).toBe('2026-10-18T15:00:10.000Z')
  })

  it('윤년·연말 경계', () => {
    expect(iso('2024-02-29T23:59:59+09:00')).toBe('2024-02-29T14:59:59.000Z')
    expect(iso('00:00:01', '2027-01-01')).toBe('2026-12-31T15:00:01.000Z')
  })

  it.each([
    ['20:00', '시각 형식 오류'],
    ['20:00:00.1234', '시각 형식 오류'],
    ['24:00:00', '없는 시각'],
    ['23:60:00', '없는 시각'],
    ['23:59:60', '없는 시각'],
    ['2026-10-18T20:00:00', '오프셋 없는 ISO'],
    ['2026-10-18T20:00:00.5', '오프셋 없는 ISO'],
    ['2026-10-18 20:00:00+09:00', '시각 형식 오류'],
    ['2026-10-18t20:00:00z', '시각 형식 오류'],
    ['2026-10-18T20:00:00+0900', '시각 형식 오류'],
    ['2026-10-18T20:00:00+24:00', '없는 오프셋'],
    ['2026-02-30T20:00:00Z', '없는 날짜'],
    ['', '시각 형식 오류'],
  ])('%j 는 오류 (%s)', (at, reason) => {
    const result = resolveAt(at, '2026-10-18')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(reason)
  })

  it('짧은 형식에 기준 날짜가 없거나 틀리면 오류', () => {
    expect(resolveAt('20:00:00', undefined)).toMatchObject({ ok: false })
    expect(resolveAt('20:00:00', '2026-13-01')).toMatchObject({ ok: false })
    expect(isShortAt('20:00:00.1')).toBe(true)
    expect(isShortAt('2026-10-18T20:00:00Z')).toBe(false)
  })
})

describe('날짜·수신 시각 형식', () => {
  it('parseDate는 실제 있는 날짜만', () => {
    expect(parseDate('2026-10-18')).toEqual({ year: 2026, month: 10, day: 18 })
    expect(parseDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
    for (const bad of ['2026-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-01', '26-10-18', '2026/10/18']) {
      expect(parseDate(bad)).toBeUndefined()
    }
    expect(parseDate('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 })
  })

  it('received는 HH:MM 또는 HH:MM:SS (원문 그대로 넘기므로 형식만 본다)', () => {
    for (const ok of ['20:01', '20:01:05', '00:00', '23:59:59']) expect(isValidReceived(ok)).toBe(true)
    for (const bad of ['8:01', '20:1', '24:00', '20:60', '20:01:60', '20:01:05.5', '20:01:05Z', '']) expect(isValidReceived(bad)).toBe(false)
  })
})

describe('Date 없이 계산한 값이 Date의 UTC 계산과 같다 (속성)', () => {
  it('daysFromCivil·civilFromDays 왕복', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (days) => {
        const { year, month, day } = civilFromDays(days)
        expect(daysFromCivil(year, month, day)).toBe(days)
      }),
    )
  })

  it('formatUtcIso = Date.prototype.toISOString', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(1900, 0, 1), max: Date.UTC(2200, 0, 1) }), (ms) => {
        expect(formatUtcIso(ms)).toBe(new Date(ms).toISOString())
      }),
    )
  })

  it('짧은 at = 방송 날짜 KST 시각 = Date.UTC(...) − 9시간', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 31)), noInvalidDate: true }),
        fc.integer({ min: 0, max: 86_399_999 }),
        (day, msOfDay) => {
          const date = day.toISOString().slice(0, 10)
          const h = Math.floor(msOfDay / 3_600_000)
          const m = Math.floor(msOfDay / 60_000) % 60
          const s = Math.floor(msOfDay / 1000) % 60
          const ms = msOfDay % 1000
          const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
          const result = resolveAt(`${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`, date)
          const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
          expect(result).toEqual({ ok: true, form: 'short', utcMs: Date.UTC(y, mo - 1, d, h, m, s, ms) - 9 * 3_600_000 })
        },
      ),
    )
  })
})

describe('프로세스 시간대와 무관 (D-026, NFR-07)', () => {
  it('테스트 단계는 Pacific/Honolulu에서 돈다', () => {
    expect(process.env.TZ).toBe('Pacific/Honolulu')
  })

  it.each(['UTC', 'Asia/Seoul', 'America/New_York', 'Pacific/Honolulu', 'Pacific/Kiritimati'])('TZ=%s 자식 프로세스에서도 같은 값', (tz) => {
    const script = fileURLToPath(new URL('./fixtures/print-at.ts', import.meta.url))
    const output = execFileSync(process.execPath, [script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
    expect(output.trim().split('\n')).toEqual([
      'tz=' + tz,
      '2026-10-18T11:00:00.000Z',
      '2026-10-18T11:00:02.100Z',
      '2026-10-18T15:00:10.000Z',
    ])
  })
})
