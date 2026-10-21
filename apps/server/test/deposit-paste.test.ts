// RA-N3-002: 붙여넣기 일시 칸 나누기(DP-2 4.2)는 되추적 없이 한 번 훑는다 — 예전 정규식과 결과가 같고, 긴 칸도 같은 규칙으로 읽는다.
// 걸린 시간은 여기서 재지 않는다(D-902) — deposit-paste.perf.test.ts.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { readPaste, splitDateTime } from '../src/deposit/paste.ts'

/** 예전 정규식 (같은 결과인지 보는 기준) */
const OLD_DATE_TIME_RE = /^(\S+?)(?:\s+|T)(\S+)$/
const old = (text: string): readonly [string, string] | null => {
  const match = OLD_DATE_TIME_RE.exec(text)
  return match === null ? null : [match[1] as string, match[2] as string]
}

describe('RA-N3-002 일시 칸 나누기', () => {
  it('예전 정규식과 같은 결과 (공백·T·전각 공백·탭·숫자·글자를 섞은 무작위 칸)', () => {
    const piece = fc.constantFrom('2026', '-', '.', '/', '10', '18', ':', '21', '03', 'T', 't', ' ', '  ', '\t', '　', ' ', 'a', '가', '😀', '')
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (pieces) => {
        const text = pieces.join('')
        expect(splitDateTime(text)).toEqual(old(text))
      }),
      { numRuns: 3000 },
    )
  })

  it('정한 사례', () => {
    expect(splitDateTime('2026-10-18 21:03')).toEqual(['2026-10-18', '21:03'])
    expect(splitDateTime('2026-10-18  \t21:03:15')).toEqual(['2026-10-18', '21:03:15'])
    expect(splitDateTime('2026-10-18T21:03:05')).toEqual(['2026-10-18', '21:03:05'])
    expect(splitDateTime('T2026-10-18T21:03')).toEqual(['T2026-10-18', '21:03'])
    expect(splitDateTime('2026-10-18T')).toBeNull()
    expect(splitDateTime('2026-10-18 21:03 x')).toBeNull()
    expect(splitDateTime(' 2026-10-18 21:03')).toBeNull()
    expect(splitDateTime('2026-10-18')).toBeNull()
  })

  it('6만 자 일시 칸(T 여럿 + 공백 조각)은 읽지 못한 줄 BAD_TIME — 다른 줄은 그대로 읽는다', () => {
    const text = `거래일시,입금액\n${'T'.repeat(60_000)} a b,1000\n2026-10-18 21:03,2000`
    const result = readPaste(text)
    expect(result).toEqual({ rows: [{ line: 3, at: '2026-10-18T21:03:00+09:00', precision: 'minute', amount: 2000, name: '', balance: null }], skipped: [], unreadable: [{ line: 2, why: 'BAD_TIME' }] })
  })
})
