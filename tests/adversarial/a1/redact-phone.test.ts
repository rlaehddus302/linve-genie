// A1 적대 시험 (test-domain, SA-A1-02·TD-A1-002·D-A1-10·D-A1-11): 넓어진 가리기를 무작위 구분자로 공격한다.
// - 순수 함수: 숫자 글자(\p{N})가 가린 뒤 6개면 남고 7개면 빈 글, 200글자로 자르기 전에 센다, 어떤 글에도 결과에 숫자 글자 7개 이상이 남지 않는다.
// - 서버: R-1이 구분자로 보는 ㅡ·ㅣ·ㆍ·폭 없는 글자·괄호·빗금·쉼표·물결·별·쌍점·더하기 등으로 끊은 휴대폰 번호가
//   가짜 LLM 서버가 받은 요청 본문에 남지 않는다(D-A1-08 — 받은 본문을 그대로 검사).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { REDACT_MAX_CHARS, redact } from '../../../apps/server/src/assist/rules.ts'
import { chat, enableAssist, shortsBroadcast, suggest, assistWorld } from '../../../apps/server/test/a1-support.ts'
import { expectOk } from '../../../apps/server/test/support.ts'

const numberCount = (text: string): number => (text.match(/\p{N}/gu) ?? []).length
const points = (text: string): string[] => Array.from(text)

/** R-1 containsPhoneRun이 구분자로 보는 글자들 + 공백·붙임표·점 + 아무것도 없음 */
const PHONE_SEPARATOR = fc.constantFrom(
  '', ' ', '-', '.', 'ㅡ', 'ㅣ', 'ㆍ', '​', '‌', '‍', '⁠', '﻿', '­',
  ',', '~', '*', ':', '/', '(', ')', '+', ') ', ' - ', '\t', '　', 'ㅡㅡ', '—', '·',
)
/** 숫자를 쓰는 모양: ASCII·전각·동그라미·수학 굵은 숫자(서로게이트 쌍)·아라비아-인도 숫자 */
const DIGIT_FORM = fc.constantFrom<(d: number) => string>(
  (d) => String(d),
  (d) => String.fromCharCode(0xff10 + d),
  (d) => (d === 0 ? '⓪' : String.fromCharCode(0x2460 + d - 1)),
  (d) => String.fromCodePoint(0x1d7ce + d),
  (d) => String.fromCharCode(0x0660 + d),
)
const DIGITS = (length: number) => fc.array(fc.integer({ min: 0, max: 9 }), { minLength: length, maxLength: length })

/** 휴대폰 번호(010 + 8자리, 또는 01x + 7자리)를 무작위 구분자·숫자 모양으로 쓴 글과 뒤 8(7)자리 */
const phoneText = fc
  .record({
    head: fc.constantFrom('010', '011', '016', '017', '019'),
    tail: fc.oneof(DIGITS(8), DIGITS(7)),
    sep1: PHONE_SEPARATOR,
    sep2: PHONE_SEPARATOR,
    form: DIGIT_FORM,
    mixForms: fc.boolean(),
    altForm: DIGIT_FORM,
    before: fc.constantFrom('반바지 엠사이즈', '반바지엠사이즈', '반바지 큰거요 ', '번호 ', '연락주세요', ''),
    after: fc.constantFrom('', ' 입니다', '요', ' 반바지 엠 2개'),
  })
  .map(({ head, tail, sep1, sep2, form, mixForms, altForm, before, after }) => {
    const write = (digits: readonly number[], offset: number) => digits.map((d, i) => (mixForms && (i + offset) % 3 === 1 ? altForm(d) : form(d))).join('')
    const middle = tail.slice(0, tail.length - 4)
    const last = tail.slice(tail.length - 4)
    const text = `${before}${write([...head].map(Number), 0)}${sep1}${write(middle, 3)}${sep2}${write(last, 7)}${after}`
    return { text, tail: tail.join('') }
  })

describe('SA-A1-02: 숫자 글자 7개 경계 — 순수 함수 속성 (D-A1-10)', () => {
  it('가리기 구분자가 아닌 글자로 흩어 둔 숫자 k개: k ≤ 6이면 그 숫자 그대로 보내고, k ≥ 7이면 빈 글', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.array(fc.constantFrom('ㅡ', '번', 'ㅣ', ')', '/', ',', '​', '개 ', ' 엠 '), { minLength: 13, maxLength: 13 }),
        DIGIT_FORM,
        fc.constantFrom('반바지 ', '반바지엠사이즈', '수건 하양 '),
        (k, separators, form, lead) => {
          let text = lead
          for (let i = 0; i < k; i++) text += `${form((i * 7 + 3) % 10)}${separators[i] as string}`
          const out = redact(text)
          if (k >= 7) expect(out, text).toBe('')
          else {
            expect(out, text).not.toBe('')
            expect(numberCount(out), text).toBe(k)
          }
        },
      ),
      { numRuns: 400 },
    )
  })

  it('200글자로 자르기 전에 센다: 앞을 길게 채우고 숫자가 200글자 밖에 있어도 7개면 빈 글, 6개면 200글자로 잘린 글', () => {
    fc.assert(
      fc.property(fc.integer({ min: 150, max: 600 }), fc.integer({ min: 6, max: 7 }), fc.constantFrom('ㅡ', ')', '/', '번'), (filler, k, sep) => {
        let text = `${'가'.repeat(filler)} `
        for (let i = 0; i < k; i++) text += `${String(i)}${sep}`
        const out = redact(text)
        if (k === 7) expect(out).toBe('')
        else {
          expect(out).not.toBe('')
          expect(points(out).length).toBeLessThanOrEqual(REDACT_MAX_CHARS)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('*** 로 가린 번호는 세지 않는다: 가려지는 번호 + 흩어진 숫자 k개 → k ≤ 6이면 *** 와 함께 보냄, k ≥ 7이면 빈 글', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), fc.constantFrom('010-1234-5678', '010 1234 5678', '010.1234.5678', '01012345678', '０１０-１２３４-５６７８'), (k, masked) => {
        let text = `반바지 ${masked} 엠`
        for (let i = 0; i < k; i++) text += `${String(i)}ㅡ`
        const out = redact(text)
        if (k >= 7) expect(out).toBe('')
        else {
          expect(out).toContain('***')
          expect(numberCount(out)).toBe(k)
          expect(out).not.toContain('5678')
        }
      }),
      { numRuns: 200 },
    )
  })

  it('아무 글(숫자·구분자·한글·이모지·서로게이트가 많은 글)에도 결과의 숫자 글자는 7개 미만, 200글자 이하, 두 번 가려도 같다', () => {
    const alphabet = fc.constantFrom('0', '1', '7', '９', '①', '⓪', '٣', '𝟕', '¹', 'Ⅻ', '〇', ' ', '-', '.', 'ㅡ', '​', ')', '/', '반', '엠', '@', '😀', '\t', '\n')
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 400 }).map((parts) => parts.join('')), (text) => {
        const out = redact(text)
        expect(numberCount(out), text).toBeLessThan(7)
        expect(points(out).length).toBeLessThanOrEqual(REDACT_MAX_CHARS)
        expect(redact(out)).toBe(out)
      }),
      { numRuns: 500 },
    )
  })

  it('무작위 구분자·숫자 모양으로 쓴 휴대폰 번호(10~11자리)는 *** 로 가려지거나 빈 글 — 뒤 7~8자리·숫자 7개가 남지 않는다', () => {
    fc.assert(
      fc.property(phoneText, ({ text, tail }) => {
        const out = redact(text)
        expect(numberCount(out), text).toBeLessThan(7)
        // 7자리 이상이 *** 로 가려지면 남은 4자리는 보일 수 있다(골든 222와 같은 셈) — 번호 전체(뒤 7~8자리)는 남지 않는다
        const asciiOut = out.normalize('NFKC').replace(/[^0-9]/g, '')
        expect(asciiOut, text).not.toContain(tail)
        expect(asciiOut.length, text).toBeLessThan(7)
      }),
      { numRuns: 600 },
    )
  })
})

describe('TD-A1-002·D-A1-11: 끊어 쓴 휴대폰 번호가 가짜 LLM 서버가 받은 본문에 없다 (AC-A1-05·30)', () => {
  it('무작위로 만든 번호 글 30개 + 대조 글: 받은 요청의 어느 항목에도 숫자 글자 7개 이상·번호 뒤 7~8자리가 없고, 대조 글은 보냈다', async () => {
    const samples = fc.sample(phoneText, { numRuns: 30, seed: 20261023 })
    // 손으로 고른 R-1 구분자 모양도 더한다(무작위가 놓쳐도 늘 시험)
    const fixed = [
      { text: '반바지엠사이즈010ㅡ1234ㅡ5678', tail: '12345678' },
      { text: '반바지 엠사이즈0101234ㅡ5678', tail: '12345678' },
      { text: '반바지 엠사이즈010ㅣ2345ㅣ6789', tail: '23456789' },
      { text: '반바지 엠사이즈010ㆍ3456ㆍ7890', tail: '34567890' },
      { text: '반바지 엠사이즈010​4567​8901', tail: '45678901' },
      { text: '반바지 엠사이즈(010)5678)9012', tail: '56789012' },
      { text: '반바지 엠사이즈010/6789/0123', tail: '67890123' },
      { text: '반바지 엠사이즈010,7890,1234', tail: '78901234' },
      { text: '반바지 엠사이즈010~8901~2345', tail: '89012345' },
      { text: '반바지 엠사이즈010*9012*3456', tail: '90123456' },
      { text: '반바지 엠사이즈010:1357:2468', tail: '13572468' },
      { text: '반바지 엠사이즈+82 10ㅡ2468ㅡ1357', tail: '24681357' },
    ]
    const { world, fake, seller } = await assistWorld({ daily: 50, global: 500 })
    const b = await shortsBroadcast(world, seller)
    const all = [...fixed, ...samples]
    for (const [index, sample] of all.entries()) await chat(world, seller, b.id, sample.text, `홍길동${String(index)}`)
    const controls = ['반바지 엠사이즈', '반바지 엠사이즈12ㅡ34ㅡ56']
    for (const text of controls) await chat(world, seller, b.id, text)
    await enableAssist(world, seller)
    for (let round = 0; round < 10; round++) {
      const response = await expectOk(suggest(world, seller))
      expect(response.body.result).toBe('DONE')
      if (response.body.called === 0) break
    }
    expect(fake.requests.length).toBeGreaterThan(0)
    const sent: string[] = []
    for (const request of fake.requests) {
      const body = request.body as { messages?: { content?: string }[] }
      const items = (JSON.parse(body.messages?.[0]?.content ?? '{}') as { items?: { text: string }[] }).items ?? []
      for (const item of items) sent.push(item.text)
      expect(request.raw).not.toContain('홍길동')
    }
    for (const control of controls) expect(sent).toContain(control)
    for (const text of sent) expect(numberCount(text), text).toBeLessThan(7)
    for (const { text, tail } of all) {
      for (const item of sent) expect(item.normalize('NFKC').replace(/[^0-9]/g, ''), `${text} → ${item}`).not.toContain(tail)
      // 원문의 번호 부분 모양이 받은 본문 그대로 남지 않는다
      for (const request of fake.requests) expect(request.raw, text).not.toContain(JSON.stringify(text).slice(1, -1))
    }
  })
})
