// V3 적대 시험 (test-domain, R-17 8 덩어리 글 하나의 확정 읽기 readRegistration — 회귀, D-V3-02·D-V3-05·D-V3-23): 중간 결과를 낱말 하나씩 늘려 넣으며 확정 읽기를 공격한다.
// SA-V3-003: 화면의 실제 바로 등록은 조각 소비(readSegments)가 정한다 — AC-V3-60 성질은 segments-property.test.ts가 readSegments로 본다. 이 파일은 readRegistration(카드·같은 번호 판단의 읽기) 회귀로 남긴다.
// 노리는 것: '원'이 안 들렸는데 등록, 번호가 안 들렸는데 등록, 정정·취소가 든 글에서 등록, 서로 다른 'N번' 둘인데 등록, 실제 방송 문장 변형에서 엉뚱한 등록.
// 한 덩어리 등록 횟수(많아야 한 번)는 화면이 처음 확정된 결과에서만 등록한다는 뜻이라 여기서는 "처음 확정된 k"만 보는 흉내로 센다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseKoreanNumber } from '@livejjim/core'
import { CANCEL_WORDS, CORRECTION_MARKERS, prepareVoiceDictionary, readRegistration } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const read = (text: string, final = false) => readRegistration(text, { dictionary: DICT, final })

const ENDINGS = ['이에요', '예요', '에요', '입니다', '이요', '이고', '이랑', '하고', '짜리', '에는', '은', '는', '이', '가', '을', '를', '에', '엔', '도', '요', '랑', '까지', '인데']
const tokensOf = (text: string): string[] => text.trim().split(/\s+/).map((t) => t.replace(/[.,?!~]+$/, '')).filter((t) => t !== '')
const formsOf = (token: string): string[] => [token, ...ENDINGS.filter((e) => token.length > e.length && token.endsWith(e)).map((e) => token.slice(0, -e.length))]
const AMOUNT = /^[0-9,.일이삼사오육칠팔구십백천만]*$/

/** 원 가격 줄의 끝 토큰(읽는 모양 하나가 '원'으로 끝나고 앞이 비었거나 금액 글자)이 있는가 */
const hasWonToken = (tokens: readonly string[]) => tokens.some((t) => formsOf(t).some((f) => f.endsWith('원') && AMOUNT.test(f.slice(0, -1))))

/** 'N번' 표시 값들 (붙여 쓴 꼴·띄어 쓴 꼴, `이`·고유어 제외, 자리 읽기 + 번 포함) — 스펙 문장으로 따로 센다 */
function beonValues(tokens: readonly string[]): number[] {
  const values: number[] = []
  const xValue = (x: string): number | null => {
    if (x === '이' || !/^([0-9]{1,4}|[일이삼사오육칠팔구십백천]+)$/.test(x)) return null
    if (/^[공일이삼사오육칠팔구]{3}$/.test(x) && x[0] !== '공') return Number([...x].map((c) => '공일이삼사오육칠팔구'.indexOf(c)).join(''))
    return parseKoreanNumber(x)
  }
  // 자리 읽기 ⓑ + 번 (D-V3-11·27): 이어진 한 자리 토큰 셋, 셋째가 `X번` → 세 자리 번호 하나 (`6 이 8번` = 628번)
  const DIGITS = '0123456789'
  const HANGUL = '공일이삼사오육칠팔구'
  const one = (t: string | undefined) => t !== undefined && t.length === 1 && (DIGITS.includes(t) || HANGUL.includes(t))
  const val = (c: string) => (DIGITS.includes(c) ? Number(c) : HANGUL.indexOf(c))
  const triple = (i: number): number | null => {
    const third = formsOf(tokens[i] as string).find((f) => f.length === 2 && f.endsWith('번') && one(f.charAt(0)))
    if (third === undefined || !one(tokens[i - 1]) || !one(tokens[i - 2]) || one(tokens[i - 3]) || one(tokens[i + 1])) return null
    const first = val(tokens[i - 2] as string)
    return first === 0 ? null : first * 100 + val(tokens[i - 1] as string) * 10 + val(third.charAt(0))
  }
  // 앞 수와 합치기 (D-V3-54): X 앞 토큰이 수 토큰이면 숫자 한 개 둘은 두 자리, 자리가 내려가면 더함(왼쪽으로 이어), 겹치면 그 표시는 값 없음
  const numberToken = (t: string | undefined): number | null => {
    if (t === undefined || t === '이') return null
    if (/^[0-9]{1,4}$/.test(t)) return Number(t)
    return /^[일이삼사오육칠팔구십백천]+$/.test(t) ? parseKoreanNumber(t) : null
  }
  const low = (n: number): number => (n === 0 ? -1 : String(n).length - String(n).replace(/0+$/, '').length)
  const high = (n: number): number => String(n).length - 1
  const merged = (xIndex: number, x: string, v: number): number | null => {
    const p = numberToken(tokens[xIndex - 1])
    if (p === null) return v
    if (/^[0-9]$/.test(tokens[xIndex - 1] as string) && /^[0-9]$/.test(x)) return p * 10 + v
    let sum = v
    for (let k = xIndex - 1; k >= 0; k--) {
      const left = numberToken(tokens[k])
      if (left === null) break
      if (low(left) <= high(sum)) return k === xIndex - 1 ? null : sum
      sum += left
    }
    return sum
  }
  tokens.forEach((token, i) => {
    const t3 = triple(i)
    if (t3 !== null) {
      values.push(t3)
      return
    }
    for (const form of formsOf(token)) {
      if (form.length >= 2 && form.endsWith('번')) {
        const v = xValue(form.slice(0, -1))
        const m = v === null ? null : merged(i, form.slice(0, -1), v)
        if (m !== null) values.push(m)
      }
    }
    const next = tokens[i + 1]
    if (next !== undefined && formsOf(next).includes('번')) {
      const v = xValue(token)
      const m = v === null ? null : merged(i, token, v)
      if (m !== null) values.push(m)
    }
  })
  return values
}

/** 번호로 읽힐 수 있는 것이 하나라도 있는가 (N번 · 자리 읽기 · 번 없는 수) */
function hasNumberSource(tokens: readonly string[], no: number): boolean {
  if (beonValues(tokens).includes(no)) return true
  const digit = (t: string | undefined) => t !== undefined && /^([0-9]|[공일이삼사오육칠팔구])$/.test(t)
  for (let i = 0; i + 2 < tokens.length; i++) {
    const tail = (tokens[i + 2] as string).replace(/번$/, '')
    if (digit(tokens[i]) && digit(tokens[i + 1]) && digit(tail)) return true
  }
  return tokens.some((t) => formsOf(t).some((f) => /^[공일이삼사오육칠팔구]{3}$/.test(f) || (/^([0-9]{1,4}|[일이삼사오육칠팔구십백천]{2,})$/.test(f) && parseKoreanNumber(f) === no)))
}

const hasCorrection = (tokens: readonly string[]) => tokens.some((t) => CORRECTION_MARKERS.includes(t) || CANCEL_WORDS.includes(t) || t.endsWith('말고'))

/** 확정 읽기의 성질 (R-17 8) — 확정이면 그 순간 글에 '원' 토큰·번호·정정 없음 */
function checkPrefix(prefix: string, final: boolean): void {
  const tokens = tokensOf(prefix)
  const reading = read(prefix, final)
  const distinctBeon = new Set(beonValues(tokens))
  if (distinctBeon.size >= 2) expect(reading.ready, `서로 다른 N번 ${[...distinctBeon].join('·')}: ${prefix}`).toBeNull()
  if (reading.ready === null) return
  expect(hasWonToken(tokens), `'원' 없이 등록: ${prefix}`).toBe(true)
  expect(hasNumberSource(tokens, reading.ready.no), `번호 없이 등록: ${prefix}`).toBe(true)
  expect(hasCorrection(tokens), `정정·취소가 든 글에서 등록: ${prefix}`).toBe(false)
  expect(reading.heardNumbers).toEqual([reading.ready.no])
  expect(reading.ready.no).toBeGreaterThanOrEqual(1)
  expect(reading.ready.no).toBeLessThanOrEqual(999)
  expect(reading.ready.price).toBeGreaterThanOrEqual(100)
  expect(Number.isSafeInteger(reading.ready.price)).toBe(true)
  expect(reading.priceSure).toBe(true)
  expect(reading.correction).toBe(false)
  // D-V3-34: '번' 없는 번호의 (처음) 후보 토큰이 첫 원 가격 줄보다 뒤면 확정이 아니다 — '번' 없는 번호면 그 수가 첫 '원' 토큰보다 앞에 있어야 한다
  if (!beonValues(tokens).includes(reading.ready.no)) {
    const firstWon = tokens.findIndex((t) => formsOf(t).some((f) => f.endsWith('원') && AMOUNT.test(f.slice(0, -1))))
    const before = tokens.slice(0, firstWon)
    expect(hasNumberSource(before, reading.ready.no), `원 가격 뒤의 '번' 없는 번호로 등록: ${prefix}`).toBe(true)
  }
  // D-V3-26: 중간 결과에서 '번' 없는 번호의 후보 토큰이 글의 마지막 토큰이면 확정이 아니다 ('N번'은 글 끝이어도 바로)
  if (!final && !beonValues(tokens).includes(reading.ready.no)) {
    const last = tokens[tokens.length - 1] as string
    // 한글 한 글자는 '번' 없이 번호가 되지 않는다(D-V3-23·27) — 숫자 한 개는 `1 6 8`의 끝일 수 있다
    const lastIsNumber = /^[0-9]$/.test(last) || [last, ...['은', '는', '이', '가', '요'].filter((e) => last.length > e.length && last.endsWith(e)).map((e) => last.slice(0, -e.length))].some((f) => /^[공일이삼사오육칠팔구]{3}$/.test(f) || (/^([0-9]{1,4}|[일이삼사오육칠팔구십백천]{2,})$/.test(f) && parseKoreanNumber(f) === reading.ready?.no))
    expect(lastIsNumber, `중간 결과 끝의 '번' 없는 수로 확정: ${prefix}`).toBe(false)
  }
}

/** 낱말 하나씩 늘려 넣은 결과(k = 1..n)마다 검사하고, 처음 확정된 k의 등록을 센다(화면 흉내: 덩어리에 많아야 한 번) */
function feedWords(text: string): { firstK: number | null; registrations: number } {
  const tokens = text.split(' ').filter((t) => t !== '')
  let firstK: number | null = null
  let registrations = 0
  for (let k = 1; k <= tokens.length; k++) {
    const prefix = tokens.slice(0, k).join(' ')
    // 사례 표의 중간 결과 꼴: 결과 k < n은 중간 결과, 결과 n은 최종 결과 (D-V3-26)
    const final = k === tokens.length
    checkPrefix(prefix, final)
    if (firstK === null && read(prefix, final).ready !== null) {
      firstK = k
      registrations++
    }
  }
  return { firstK, registrations }
}

const VOCAB = [
  '15번', '십오번', '108번', '189번인데', '139번', '15', '번', '일육팔', '일육팔은', '1', '6', '8번', '백육십팔', '170', '174', '이번', '한', '이',
  '25만', '원', '원까지', '10만', '만원', '만원짜리', '삼십', '오만', '30', '5만', '천', '오천원', '1.5', '이만원이에요',
  '자', '요', '아이', '요 아이', 'UI는', 'bts', '라울', '삼광색금', '3강', '3강색급', '9cm에', '이거', '그대로', '28마리까지', '3개',
  '아니', '말고', '만오천말고', '취소', '다시', '품종은', '문자찜',
] as const

describe('readRegistration 회귀 — 무작위 문장을 낱말 하나씩 늘려 넣기', () => {
  it('확정이면 그 순간 글에 원 토큰·번호가 있고 정정·취소가 없으며, 서로 다른 N번 둘이면 확정이 아니다', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 14 }), (parts) => {
        const { registrations } = feedWords(parts.join(' '))
        expect(registrations).toBeLessThanOrEqual(1)
      }),
      { numRuns: 1500 },
    )
  })

  it.each([
    ['15번 라울 삼십 오만 원', 5, 15, 350_000],
    ['180번 30 5만 원', 4, 180, 350_000],
    ['일육팔 삼광색금 이십오만 원', 4, 168, 250_000],
    ['1 6 8번 라울 만원', 5, 168, 10_000],
    ['백육십팔 삼광색금 이십오만 원', 4, 168, 250_000],
    ['170 25만 원', 3, 170, 250_000],
    ['108번 10만원 아니 12만원', 2, 108, 100_000],
    ['21번 핑크문 만원 취소', 3, 21, 10_000],
    ['174 28만 원', 3, 174, 280_000],
    // D-V3-54: 앞 수와 합치기 — 글 끝 맨 수(`1`·`이십`)는 기다리고(D-V3-26), `5번`·`오번`이 오면 15·25번 (처음 기대 "확정 없음"을 바꿈)
    ['25만 원 1 5번', 4, 15, 250_000],
    // D-V3-64: 300만 원 넘어도 '원'이 들린 순간 등록 (처음 기대 "확정 없음"을 바꿈)
    ['38번 605만 원까지', 3, 38, 6_050_000],
    ['25만 원 이십 오번', 4, 25, 250_000],
  ])('"%s" → 처음 확정 k=%i, %i번 · %i원 (사례 표)', (text, k, no, price) => {
    expect(feedWords(text).firstK).toBe(k)
    const ready = read(text.split(' ').slice(0, k).join(' '), k === text.split(' ').length).ready
    expect([ready?.no, ready?.price]).toEqual([no, price])
  })

  it.each(['택배는 이삼 일 걸리고 만 원이에요', '삼광색금 3강 25만 원', '15번 라울 174 28만 원', '백 육십팔 라울 만원', '15번 핑크프릴 만오천', '189번 빅뱅금 139번 50만 원', '자 9cm에 이거 25만 원 170', '요 아이는 65만 원까지 자 색감이 이렇게 예쁘게 나왔네요 자 60 어 자', '25만 원 170', '100 5만 원', '이백 오만 원', '택배는 이 삼 일 걸리고 만 원이에요'])('"%s" → 어느 k에서도 확정 없음', (text) => {
    expect(feedWords(text).firstK).toBeNull()
  })
})

describe('readRegistration 회귀 — 실제 방송 6문장 변형 500개', () => {
  const lines = readFileSync(join(import.meta.dirname, '../../../harness/sprints/V3/real-broadcast.txt'), 'utf8')
    .split('\n')
    .map((line) => /^([1-6])\. (.+)$/.exec(line)?.[2])
    .filter((line): line is string => line !== undefined)

  it('원문 6문장을 읽었다', () => {
    expect(lines).toHaveLength(6)
  })

  it('낱말 하나 빼기·이웃 둘 바꾸기 변형: 서로 다른 N번 둘이 든 글은 어느 k에서도 확정이 아니다', () => {
    let twoNumberVariants = 0
    let checked = 0
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.array(fc.tuple(fc.boolean(), fc.nat()), { minLength: 1, maxLength: 3 }),
        (which, edits) => {
          const tokens = (lines[which] as string).split(' ')
          for (const [drop, at] of edits) {
            const i = at % tokens.length
            if (drop && tokens.length > 1) tokens.splice(i, 1)
            else if (i + 1 < tokens.length) [tokens[i], tokens[i + 1]] = [tokens[i + 1] as string, tokens[i] as string]
          }
          checked++
          if (new Set(beonValues(tokensOf(tokens.join(' ')))).size >= 2) twoNumberVariants++
          const { registrations } = feedWords(tokens.join(' '))
          expect(registrations).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 500, seed: 20_261_025 },
    )
    expect(checked).toBe(500)
    expect(twoNumberVariants).toBeGreaterThan(50)
  })
})
