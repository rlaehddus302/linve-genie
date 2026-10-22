// N3 적대 테스트 (test-domain): 붙여넣기 읽기(DP-2) 퍼징 — acceptance L "붙여넣기 퍼징".
// 은행 표를 복사한 모양의 글에 제어 문자·긴 줄·따옴표 짝 안 맞음·이모지·수식 모양(=,+,@)·전각 숫자·출금 줄을 섞는다.
// 함수는 예외를 던지지 않고, 읽은 줄은 금액 1~100,000,000·`at` 형식·이름 40자 이하이며, 출금 모양 줄(입금액 0·구분 "출금"·`-` 금액)은 절대 rows에 없다.
import { readPaste } from '@livejjim/server'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/

const junk = fc.constantFrom('', ' ', '\u0000', '\u0007', '​', '﻿', '😀', '=1+2', '+SUM(A1)', '@cmd', '"', '""', '"a,b', '１４，０００', '\t', ',', '원', '-', '+', '0', '00', '1e3', '1.5', '９')
const name = fc.oneof(fc.constantFrom('김영희', '다육이 맘', '<script>alert(1)</script>', '=HYPERLINK("x")', '@@', '😀😀', 'ＡＢＣ'), fc.string({ maxLength: 80 }), fc.stringMatching(/^[가-힣]{30,60}$/))
const when = fc.oneof(
  fc.constantFrom('2026-10-18 21:03', '2026.10.18 21:03:15', '2026/10/18 9:03', '20261018 21:03', '2026-10-18T21:03:05', '2026-02-30 10:00', '2026-10-18 25:00', '2026-10-18', '2026-10-18  21:03', '2026-10-18 21:03:60'),
  fc.string({ maxLength: 20 }),
)
const money = fc.oneof(
  fc.constantFrom('14,000', '14000', '14,000원', '+14,000', '-14,000', '0', '-0', '1,00', '100000001', '100,000,000', '999999999999999999999', '', '1', '+0'),
  fc.integer({ min: -200_000_000, max: 200_000_000 }).map(String),
  junk,
)

type Layout = 'deposit' | 'kind' | 'signed'
const layoutArb = fc.constantFrom<Layout>('deposit', 'kind', 'signed')

interface Line {
  text: string
  /** 출금 모양 줄 (이 줄은 rows에 있으면 안 된다) */
  withdrawal: boolean
}

function lineFor(layout: Layout, w: string, n: string, m: string, kind: string, extra: string, csv: boolean): Line {
  const q = (s: string) => (csv ? `"${s.replace(/"/g, '""')}"` : s.replace(/\t|\r|\n/g, ' '))
  const sep = csv ? ',' : '\t'
  const mt = m.trim()
  if (layout === 'deposit') {
    // 거래일시 · 입금자명 · 출금액 · 입금액 · 잔액
    const out = mt === '0' || mt === '-0' || mt === '' ? '5,000' : '0'
    return { text: [q(w), q(n), q(out), q(m), q(extra)].join(sep), withdrawal: /^-?0$/.test(mt) || mt === '' }
  }
  if (layout === 'kind') {
    // 거래일시 · 구분 · 거래금액 · 내용
    return { text: [q(w), q(kind), q(m), q(n)].join(sep), withdrawal: !kind.replace(/\s/g, '').endsWith('입금') }
  }
  // 거래일시 · 거래금액(부호) · 적요
  return { text: [q(w), q(m), q(n)].join(sep), withdrawal: mt.startsWith('-') }
}

const HEADER: Record<Layout, string[]> = {
  deposit: ['거래일시', '입금자명', '출금액', '입금액', '잔액'],
  kind: ['거래일시', '구분', '거래금액', '내용'],
  signed: ['거래일시', '거래금액', '적요'],
}

describe('DP-2 붙여넣기 퍼징 (fast-check)', () => {
  it('예외 없음 · 읽은 줄의 값 범위 · 출금 줄은 rows에 없음 · 줄 번호는 결과 셋에 한 번씩', () => {
    fc.assert(
      fc.property(
        layoutArb,
        fc.boolean(),
        fc.array(fc.string({ maxLength: 30 }), { maxLength: 2 }),
        fc.array(fc.record({ w: when, n: name, m: money, kind: fc.constantFrom('입금', '출금', '타행입금', '입금취소', '일반 입금', '', '이체'), extra: junk }), { maxLength: 30 }),
        fc.constantFrom('\n', '\r\n', '\r'),
        (layout, csv, title, rows, nl) => {
          const lines = rows.map((r) => lineFor(layout, r.w, r.n, r.m, r.kind, r.extra, csv))
          const headerText = HEADER[layout].join(csv ? ',' : '\t')
          const before = title.map((t) => t.replace(/[\r\n]/g, ''))
          const text = [...before, headerText, ...lines.map((l) => l.text)].join(nl)
          const result = readPaste(text)
          if ('error' in result) {
            // 머리글 위의 제목 줄이 우연히 머리글이면 그 줄이 머리글이다 — 그 밖에는 머리글을 찾아야 한다
            expect(result.error).not.toBe('TOO_MANY_ROWS')
            return
          }
          const seen = new Set<number>()
          for (const r of result.rows) {
            expect(Number.isSafeInteger(r.amount)).toBe(true)
            expect(r.amount).toBeGreaterThanOrEqual(1)
            expect(r.amount).toBeLessThanOrEqual(100_000_000)
            expect(r.at).toMatch(AT_RE)
            expect([...r.name].length).toBeLessThanOrEqual(40)
            expect(r.name).toBe(r.name.trim() === r.name ? r.name : r.name)
            seen.add(r.line)
          }
          for (const s of [...result.skipped, ...result.unreadable]) {
            expect(seen.has(s.line)).toBe(false)
            seen.add(s.line)
          }
          // 제목 줄이 머리글로 잡히지 않은 경우(대부분): 데이터 줄 번호 = 제목 수 + 2 + 인덱스
          const headerLine = before.length + 1
          for (const r of result.rows) {
            const index = r.line - headerLine - 1
            if (index < 0 || index >= lines.length) continue
            const line = lines[index] as Line
            if (text.split(/\r\n|\n|\r/)[headerLine - 1] === headerText) expect(line.withdrawal, `줄 ${String(r.line)}: ${line.text}`).toBe(false)
          }
        },
      ),
      { numRuns: 500 },
    )
  })

  it('1만 자 줄·짝 없는 따옴표·제어 문자만 있는 글도 예외 없이 끝난다', () => {
    const header = '거래일시,입금자명,입금액'
    for (const body of ['"'.repeat(10_000), `2026-10-18 21:03,"${'가'.repeat(10_000)},14000`, '\u0000\u0001\u0002', `${'\t'.repeat(5000)}`, '=cmd|\' /C calc\'!A0,=1,=2']) {
      const r = readPaste(`${header}\n${body}`)
      expect('error' in r ? r.error : 'ok').toBe('ok')
    }
    const long = readPaste(`${header}\n2026-10-18 21:03,"${'가'.repeat(10_000)}",14000`)
    expect('rows' in long && long.rows[0]?.name.length).toBe(40)
  })
})
