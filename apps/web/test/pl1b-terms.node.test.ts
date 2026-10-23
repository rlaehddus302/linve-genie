// @vitest-environment node
// PL1B 약관 초안 (AC-PL1B-07, BILLING_RULES v0.1.1 BL-10, D-PL1-07): 화면의 약관 글이 문서 BL-10 1~9와 글자 하나까지 같다.
// 문서의 대괄호 법률 검토 메모(`[법률 검토: …]`·`[법률·세무 검토: …]`)는 화면에 보이지 않으므로 빼고 맞댄다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TERMS } from '../src/lib/billing-words.ts'

function rulesClauses(): { title: string; text: string }[] {
  const doc = readFileSync(new URL('../../../docs/spec/BILLING_RULES.md', import.meta.url), 'utf8')
  const section = doc.slice(doc.indexOf('## BL-10.'), doc.indexOf('## 불변식'))
  return [...section.matchAll(/^\d+\. \(([^)]+)\) (.+)$/gmu)].map((match) => ({
    title: match[1] ?? '',
    text: (match[2] ?? '').replace(/\s*\[[^\]]*\]\s*$/u, ''),
  }))
}

describe('약관 초안 = BILLING_RULES BL-10 (AC-PL1B-07)', () => {
  it('"증빙" 항목 글이 BL-10 8과 글자 하나까지 같다', () => {
    const doc = rulesClauses().find((clause) => clause.title === '증빙')
    expect(doc?.text).toBe('계좌이체로 결제한 이용권은 현금영수증(지출증빙)을 발행한다. 카드 결제는 카드 매출전표가 증빙이다. 회사는 지금 세금계산서를 발행하지 않는다.')
    expect(TERMS.find((clause) => clause.title === '증빙')?.text).toBe(doc?.text)
  })

  it('아홉 항목의 제목·글이 문서(메모 빼고)와 같은 순서로 같다', () => {
    const clauses = rulesClauses()
    expect(clauses).toHaveLength(9)
    expect(TERMS.map((clause) => clause.title)).toEqual(clauses.map((clause) => clause.title))
    expect(TERMS.map((clause) => clause.text)).toEqual(clauses.map((clause) => clause.text))
    for (const clause of TERMS) expect(clause.text).not.toMatch(/\[|검토/u)
  })
})
