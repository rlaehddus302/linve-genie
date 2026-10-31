// SMS3 골든 러너 자체 시험 (AC-SMS3-01): sms-text suite를 읽고, 틀린 기대값·더 있는 키에서 실제로 실패하고,
// 보낸 곳 from(기본값 "010-1234-5678"·null)을 그대로 넘기고, 다른 suite의 from은 읽기 오류다.
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import type { SettingsOverride } from '@livejjim/core'
import { realCore } from './core-adapter.ts'
import { formatReport } from './report.ts'
import { run } from './test-helpers.ts'
import type { GoldenReport } from './types.ts'

type SmsCall = { readonly from: string | null; readonly text: string; readonly settings: SettingsOverride }

const sms = (cases: readonly Record<string, unknown>[], settings: Record<string, unknown> = { parseMode: 'STRICT', multiNumber: 'ALL', maxNumber: 999 }): string =>
  stringify({ suite: 'sms-text', settings, cases })

const real = (text: string): GoldenReport => run(text, { core: realCore })
const ok = (report: GoldenReport): void => {
  expect(report.ok, formatReport(report)).toBe(true)
}
/** 읽기 오류 하나이고 메시지에 그 말이 있다 */
const readError = (report: GoldenReport, words: string): void => {
  expect(report.totals.readError, formatReport(report)).toBe(1)
  expect(report.readErrors.flatMap((e) => e.issues.map((i) => `${i.path ?? ''} ${i.message}`)).join('\n')).toContain(words)
}

describe('sms-text suite — 읽기', () => {
  it('실제 코어로 다섯 모양 모두 통과', () => {
    ok(
      real(
        sms([
          { in: '775 홍길동', out: { claims: [775], memo: '홍길동' } },
          { in: '775 취소', out: { cancels: [775] } },
          { in: '775?', out: { review: [775], why: 'UNCLEAR' } },
          { from: null, in: '775', out: { review: [775], why: 'NO_NUMBER' } },
          { from: '1588-9999', in: '775', out: { skip: 'NOT_MOBILE' } },
          { in: '(광고) 775', out: { skip: 'EXCLUDED' } },
          { in: '안녕하세요', out: {} },
        ]),
      ),
    )
    ok(real(sms([{ in: '775', out: { review: [775], why: 'OPTIONS' } }], { parseMode: 'OPTIONS' })))
  })

  it('형식 오류는 읽기 오류', () => {
    readError(real(sms([{ in: '775', out: { claims: [775], why: 'UNCLEAR' } }])), "모르는 sms-text claims 모양 out 키 'why'")
    readError(real(sms([{ in: '775', out: { review: [775] } }])), "필수 sms-text review 모양 out 키 'why'")
    readError(real(sms([{ in: '775', out: { review: [], why: 'UNCLEAR' } }])), 'review는 빈 목록일 수 없다')
    readError(real(sms([{ in: '775', out: { review: [775], why: 'MAYBE' } }])), 'UNCLEAR / NO_NUMBER / OPTIONS')
    readError(real(sms([{ in: '775', out: { skip: 'SPAM' } }])), 'NOT_MOBILE / EXCLUDED')
    readError(real(sms([{ in: '775', out: { skip: 'EXCLUDED', memo: '홍길동' } }])), "모르는 sms-text skip 모양 out 키 'memo'")
    readError(real(sms([{ in: '775', out: { claims: [775, 775] } }])), '같은 번호는 하나')
    readError(real(sms([{ in: '775', out: { claims: [0] } }])), '1 이상 정수 목록')
    readError(real(sms([{ in: '775', out: { claims: [775], memo: '홍' } }])), '한글 음절 2~10자')
    readError(real(sms([{ in: '775', out: { claims: [775], memo: '홍길동1' } }])), '한글 음절 2~10자')
    readError(real(sms([{ in: '775', out: { mentions: [775] } }])), "모르는 sms-text out 키 'mentions'")
    readError(real(sms([{ in: '775', out: [] }])), '')
    readError(real(sms([{ from: 1012345678, in: '775', out: {} }])), '보낸 곳은 문자열 또는 null')
    readError(real(sms([{ in: '775', out: {} }], { unit: 'WON' })), "suite 'sms-text'에 없는 설정 키 'unit'")
    readError(real(sms([{ in: '775', out: {} }], { parseMode: 'FAST' })), 'STRICT / LOOSE / OPTIONS 중 하나')
  })

  it('다른 suite의 사례에 from이 있으면 읽기 오류 (README 파서 사례 형식)', () => {
    readError(real(stringify({ suite: 'chat', cases: [{ from: '010-1234-5678', in: '15', out: { claims: [15] } }] })), "'from'는 sms-text suite의 사례에만 쓴다 (suite 'chat')")
    readError(real(stringify({ suite: 'amount', cases: [{ from: null, in: '1000', out: 1000 }] })), "suite 'amount'")
  })

  it('chat suite의 parseMode는 여전히 STRICT·LOOSE만 (sms-text만 OPTIONS를 받는다)', () => {
    readError(real(stringify({ suite: 'chat', settings: { parseMode: 'OPTIONS' }, cases: [] })), 'STRICT / LOOSE 중 하나')
    ok(real(sms([], { parseMode: 'OPTIONS' })))
  })
})

describe('sms-text suite — 러너가 실제로 실패한다 (가짜 코어)', () => {
  const calls: SmsCall[] = []
  const smsText = (result: unknown) => (from: string | null, text: string, settings: SettingsOverride): unknown => {
    calls.push({ from, text, settings })
    return typeof result === 'function' ? (result as (t: string) => unknown)(text) : structuredClone(result)
  }

  it('from을 적지 않으면 "010-1234-5678", null·빈 글은 그대로, 설정은 DOMAIN_RULES 키로 넘긴다', () => {
    calls.length = 0
    const report = run(sms([{ in: 'a', out: {} }, { from: null, in: 'b', out: {} }, { from: '', in: 'c', out: {} }, { from: '홍길동', in: 'd', out: {} }], { parseMode: 'LOOSE', multiNumber: 'FIRST', maxNumber: 50 }), {
      fake: { parser: { smsText: smsText({}) } },
    })
    ok(report)
    expect(calls.map((c) => [c.from, c.text])).toEqual([
      ['010-1234-5678', 'a'],
      [null, 'b'],
      ['', 'c'],
      ['홍길동', 'd'],
    ])
    expect(calls[0]?.settings).toEqual({ 'claim.parseMode': 'LOOSE', 'claim.multiNumber': 'FIRST', 'claim.maxNumber': 50 })
  })

  it.each([
    ['값이 다름', { claims: [775], memo: '홍길동' }, { claims: [775], memo: '김영희' }, 'out.memo'],
    ['순서가 다름', { claims: [775, 776] }, { claims: [776, 775] }, 'out.claims'],
    ['out에 없는 키(memo)가 실제에 있음', { claims: [775] }, { claims: [775], memo: '홍길동' }, 'out.memo'],
    ['out에 없는 키가 undefined로 있음', { claims: [775] }, { claims: [775], memo: undefined }, 'out.memo'],
    ['찜 아님인데 빈 claims가 있음', {}, { claims: [] }, 'out.claims'],
    ['실제에 키가 없음', { review: [775], why: 'UNCLEAR' }, { review: [775] }, 'out.why'],
    ['모양이 다름', { cancels: [775] }, { claims: [775] }, 'out.cancels'],
    ['맵이 아님', {}, null, 'out'],
  ])('%s → 불일치', (_name, out, actual, path) => {
    const report = run(sms([{ in: '775', out }]), { fake: { parser: { smsText: smsText(actual) } } })
    expect(report.ok).toBe(false)
    expect(report.totals.mismatch).toBe(1)
    const item = report.items[0]
    expect(item?.problems.map((p) => p.path)).toContain(path)
    expect(formatReport(report)).toContain('보낸 곳 "010-1234-5678"')
  })

  it('코어에 smsText가 없으면 미구현(불허), 예외는 러너 오류', () => {
    const missing = run(sms([{ in: '775', out: {} }]))
    expect(missing.totals.notImplementedDisallowed, formatReport(missing)).toBe(1)
    const thrown = run(sms([{ in: '775', out: {} }]), {
      fake: {
        parser: {
          smsText: () => {
            throw new Error('펑')
          },
        },
      },
    })
    expect(thrown.totals.runnerError, formatReport(thrown)).toBe(1)
  })
})
