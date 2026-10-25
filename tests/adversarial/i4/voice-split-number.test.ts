// I4 적대 테스트 (test-domain): 끊어 말한 번호 (AC-I4-01, R-17 3·4, D-I4-01, TD-P2-002).
// 기대값은 R-17 3 문장으로 손 계산했다: 번호 표시의 X 바로 앞 토큰(그대로 — 끝말을 떼지 않는다) + X를 공백 없이 이은 글이
// R-15(parseKoreanNumber)로 읽히면 끊어 말한 번호 → no·price = null, LOW. 품종은 평소대로.
// V3 D-V3-54(앞 수와 합치기, 상품 등록 추출만): 앞 토큰이 수 토큰(숫자 1~4자리·R-15 한글 수, `이` 아님, 문장 부호 없음)이면 D-I4-01 대신
// 둘 다 숫자 한 개 → 두 자리, 자리가 내려가면 더함(왼쪽으로 이어), 겹치면 번호·가격 비움. 앞 토큰이 수 토큰이 아니거나 `이`·문장 부호가 붙었으면 D-I4-01 그대로.
// 통과한 공격은 회귀로 남긴다. 기본 사전(DEFAULT_DICTIONARY — 핑크프릴·라울·블루엘프 포함)으로 부른다.
import { parseKoreanNumber } from '@livejjim/core'
import { DEFAULT_DICTIONARY, buildDictionary, extractVoice, prepareDictionary, readingForms, tokenize } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const dictionary = prepareDictionary(buildDictionary([], DEFAULT_DICTIONARY))
const run = (text: string) => extractVoice(text, { dictionary, maxNumber: 999 })

describe('끊어 말한 번호·겹친 앞 수 — no·price 비움, 확인 필요', () => {
  it.each([
    // 앞 토큰 끝에 문장 부호가 붙으면 수 토큰이 아니다 → D-I4-01 그대로 (부호를 지운 뒤 붙인 글이 R-15로 읽힘)
    ['1. 5번 핑크프릴 만원', '핑크프릴'],
    ['1~ 5번 핑크프릴 만원', '핑크프릴'],
    ['1, 5 번 라울 만원', '라울'],
    // 자리가 겹치는 앞 수 (D-V3-54: 1(일) vs 15(십))
    ['1 15번 라울 만원', '라울'],
    // 앞 토큰이 `이` → D-I4-01 (`이십`이 R-15로 읽힘)
    ['이 십 번 블루엘프 칠천 원', '블루엘프'],
    // 합치면 5005 — 범위 밖이라 번호 없음, 오천은 번호 토큰이라 가격도 아님
    ['오천 오번 라울', '라울'],
  ])('%s', (text, name) => {
    expect(run(text)).toEqual({ no: null, name, price: null, confidence: 'LOW' })
  })
})

describe('D-V3-54 앞 수와 합치기 — 처음 끊어 말한 번호로 비우던 꼴', () => {
  it.each([
    ['１ ５번 핑크프릴 만오천 원', 15, '핑크프릴', 15000, 'HIGH'], // 전각 숫자 (R-3 정규화 뒤 숫자 한 개 둘)
    ['십 오 번 라울 만원', 15, '라울', 10000, 'HIGH'], // 띄어 쓴 `번`
    ['1 5번이요 라울 만원', 15, '라울', 10000, 'HIGH'],
    ['십 오번이고 라울 만원', 15, '라울', 10000, 'HIGH'],
    ['15번 15번 1 5번 라울 만원', 15, '라울', 10000, 'HIGH'], // 같은 번호 되풀이
    ['15번 라울 만원 1 5번', 15, '라울', 10000, 'HIGH'],
    ['백 오 번 라울', 105, '라울', null, 'LOW'], // 백은 번호 토큰 → 가격 아님
  ] as const)('%s → %s번', (text, no, name, price, confidence) => {
    expect(run(text)).toEqual({ no, name, price, confidence })
  })
})

describe('끊어 말한 번호가 아님 — 번호를 쓸데없이 비우지 않는다', () => {
  it.each([
    // 흔한 말버릇 뒤 (앞 토큰 + X가 수가 아님)
    ['자 15번 라울 만원', 15, 10000],
    ['네 15번 라울 만원', 15, 10000],
    ['이 15번 라울 만원', 15, 10000],
    // D-V3-54: 한 글자 한글 수 `오`도 수 토큰 — 5(일) vs 15(십) 겹침 → 비움 (처음 기대는 15번)
    ['오 15번 라울 만원', null, null],
    ['이번 15번 라울 만원', 15, 10000],
    ['오늘 15번 라울 만원', 15, 10000],
    // 끝말은 떼지 않는다: `십이요오`는 수가 아니다
    ['십이요 오번 라울 만원', 5, 10000],
    // D-V3-54(처음 기대를 바꿈): 1(일) vs 2345(천) 겹침 → 비움
    ['1 2345번 라울 만원', null, null],
    // D-V3-54: 천(천) > 15(십) → 1015 — 999 밖이라 번호 없음, 천은 번호 토큰이라 가격은 만원
    ['천 15번 라울 만원', null, 10000],
    // D-V3-54: 십·이십(십) vs 15(십) 겹침 → 비움
    ['십 15번 라울 만원', null, null],
    ['이십 15번 라울 만원', null, null],
    // D-V3-54: 100(백) > 15(십) → 115
    ['100 15번 라울 만원', 115, 10000],
    // 고유어는 번호 표시가 아니다
    ['스물 다섯번 라울 만원', null, 10000],
    ['15번이요 라울 만원', 15, 10000],
    ['만원 15번 라울', 15, 10000],
  ])('%s', (text, no, price) => {
    const result = run(text)
    expect({ no: result.no, price: result.price }).toEqual({ no, price })
    expect(result.name).toBe('라울')
  })
})

// ── 속성: 끊어 말한 번호 ⇒ no·price null·LOW, HIGH ⇒ 끊어 말한 표시 없음 ─────────────────

const BEON = '번'
const SINO = new Set([...'일이삼사오육칠팔구십백천'])
/** R-17 3의 X: 숫자 1~4자리 또는 한자어 수사 글자만, `이` 한 글자 아님, R-15 값이 있음 */
function markerValue(x: string): number | null {
  if (x === '이') return null
  if (!/^[0-9]{1,4}$/.test(x) && !(x !== '' && [...x].every((char) => SINO.has(char)))) return null
  return parseKoreanNumber(x)
}
/** R-15 한글 수 또는 숫자 1~4자리 — 앞 수와 합치기의 수 토큰 (`이`·문장 부호 붙은 토큰 아님, D-V3-54) */
function numberTokenValue(raw: string): number | null {
  if (raw === '이' || /[.,?!~]$/.test(raw)) return null
  if (/^[0-9]{1,4}$/.test(raw)) return Number(raw)
  if (!/^[일이삼사오육칠팔구십백천]+$/.test(raw)) return null
  return parseKoreanNumber(raw)
}
const lowestPlace = (n: number): number => {
  let place = 0
  while (n % 10 === 0 && n > 0) {
    n /= 10
    place++
  }
  return place
}
const highestPlace = (n: number): number => String(n).length - 1
/**
 * R-17 3 문장 그대로의 참고 판단: 이 문장은 번호·가격을 비워야 하는가 —
 * 번호 표시의 앞 토큰이 수 토큰이면 앞 수와 합치기(겹치면 비움, D-V3-54), 아니면 D-I4-01(앞 토큰 + X가 R-15로 읽히면 비움).
 */
let unclear = false
function mustVoid(text: string): boolean {
  unclear = false
  const tokens = tokenize(text)
  if (tokens === null) return false
  // 문장 부호 붙은 토큰을 알려고 원래 토큰도 본다 (R-17 1과 같이 나누고 부호를 지우기 전 — 빈 토큰은 tokenize도 버린다)
  const raws = text.normalize('NFKC').trim().split(/\s+/).filter((raw) => raw.replace(/[.,?!~]+$/, '') !== '')
  if (raws.length !== tokens.length) return false
  const forms = tokens.map(readingForms)
  // V3 자리 읽기 ⓑ + 번 (D-V3-11): 이어진 토큰 정확히 셋이 저마다 자리 글자 하나이고 셋째가 `X번`이면(`1 1 5번` = 115번) 끊어 말한 번호 검사를 하지 않는다
  const DIGIT = /^([0-9]|[공일이삼사오육칠팔구])$/
  const isDigit = (t: string | undefined) => t !== undefined && DIGIT.test(t)
  const digitReadingBeon = (i: number, form: string): boolean =>
    form.length === 2 && isDigit(form.charAt(0)) && isDigit(tokens[i - 1]) && isDigit(tokens[i - 2]) && !isDigit(tokens[i - 3]) && !isDigit(tokens[i + 1]) && !/^[0공]$/.test(tokens[i - 2] as string)
  const voidFor = (xIndex: number, x: string): boolean => {
    const value = markerValue(x)
    if (value === null || xIndex === 0) return false
    const previous = tokens[xIndex - 1] as string
    const pValue = numberTokenValue(raws[xIndex - 1] as string)
    if (pValue === null) return parseKoreanNumber(previous + x) !== null // D-I4-01
    if (/^[0-9]$/.test(previous) && /^[0-9]$/.test(x)) return false // 숫자 한 개 둘 → 두 자리
    // 앞 수 0(`0 삼번`)은 '0이 아닌 가장 낮은 자리'가 없다 — 스펙이 정하지 않았다(보고에 올림)
    if (pValue === 0) {
      unclear = true
      return false
    }
    if (lowestPlace(pValue) <= highestPlace(value)) return true // 겹침 → 비움
    // 왼쪽으로 이어 더하다 겹치는 꼴(`1 이십 오번`)은 스펙이 비움인지 멈춤인지 적지 않았다 — 판단하지 않는다(보고에 올림)
    let sum = value + pValue
    for (let k = xIndex - 2; k >= 0; k--) {
      const left = numberTokenValue(raws[k] as string)
      if (left === null) break
      if (left === 0 || lowestPlace(left) <= highestPlace(sum)) {
        unclear = true
        break
      }
      sum += left
    }
    return false
  }
  return tokens.some((token, i) => {
    const attached = (forms[i] ?? []).some((form) => {
      if (form.length < 2 || !form.endsWith(BEON) || digitReadingBeon(i, form)) return false
      return voidFor(i, form.slice(0, -1))
    })
    const spaced = (forms[i + 1] ?? []).includes(BEON) && voidFor(i, token)
    return attached || spaced
  })
}

const TOKENS = [
  '1', '5', '15', '2', '0', '05', '100', '1.', '1,', '１', '５번',
  '십', '오', '이', '백', '삼', '일', '천', '십오', '이십', '십이요', '오천',
  '번', '5번', '15번', '오번', '십번', '이번', '번째', '5번이요', '번이요', '삼번',
  '자', '네', '오늘', '라울', '핑크프릴', '블루엘프', '만원', '오천', '원', '만', '천원', '칠천', '만오천',
]

describe('속성 (AC-I4-01 확인): 임의 문장', () => {
  it('끊어 말한 표시·겹친 앞 수(D-V3-54)가 있으면 no·price가 null이고 LOW, HIGH면 끊어 말한 표시가 없다', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TOKENS), { minLength: 1, maxLength: 8 }), (tokens) => {
        const text = tokens.join(' ')
        const result = run(text)
        const expectVoid = mustVoid(text)
        if (unclear) return
        if (expectVoid) {
          expect(result.no).toBeNull()
          expect(result.price).toBeNull()
          expect(result.confidence).toBe('LOW')
        }
        if (result.confidence === 'HIGH') expect(expectVoid).toBe(false)
      }),
      { numRuns: 3000, seed: 20261020 },
    )
  })
})
