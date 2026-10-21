// RA-N3-002 성능 (pnpm perf — D-902, pnpm verify 밖): 일시 칸 6만 자(T 여럿 + 공백 조각)를 붙여 넣어도 읽기가 짧게 끝난다.
// 예전 정규식 /^(\S+?)(?:\s+|T)(\S+)$/은 2만 자에서 1초 넘게 되추적했다(제곱 시간) — 서버 전체 이벤트 루프를 막는다.
import { describe, expect, it } from 'vitest'
import { readPaste } from '../src/deposit/paste.ts'

describe('RA-N3-002 붙여넣기 긴 칸', () => {
  it('64KB 본문 거의 전부를 일시 칸 하나에 담아도 읽기 ≤ 50ms', () => {
    for (const filler of ['T', 'TT0', 'T-']) {
      const cell = filler.repeat(Math.floor(60_000 / filler.length))
      const text = `거래일시,입금액\n${cell} a b,1000`
      const started = performance.now()
      const result = readPaste(text)
      const spent = performance.now() - started
      expect('unreadable' in result && result.unreadable).toEqual([{ line: 2, why: 'BAD_TIME' }])
      expect(spent, filler).toBeLessThan(50)
    }
  })
})
