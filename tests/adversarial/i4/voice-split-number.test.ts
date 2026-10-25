// I4 적대 테스트 (test-domain): 끊어 말한 번호 (AC-I4-01, R-17 3·4, D-I4-01, TD-P2-002).
// 기대값은 R-17 3 문장으로 손 계산했다: 번호 표시의 X 바로 앞 토큰(그대로 — 끝말을 떼지 않는다) + X를 공백 없이 이은 글이
// R-15(parseKoreanNumber)로 읽히면 끊어 말한 번호 → no·price = null, LOW. 품종은 평소대로.
// 통과한 공격은 회귀로 남긴다. 기본 사전(DEFAULT_DICTIONARY — 핑크프릴·라울·블루엘프 포함)으로 부른다.
import { parseKoreanNumber } from '@livejjim/core'
import { DEFAULT_DICTIONARY, buildDictionary, extractVoice, prepareDictionary, readingForms, tokenize } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const dictionary = prepareDictionary(buildDictionary([], DEFAULT_DICTIONARY))
const run = (text: string) => extractVoice(text, { dictionary, maxNumber: 999 })

describe('끊어 말한 번호의 변형 — no·price 비움, 확인 필요', () => {
  it.each([
    // 전각 숫자 (R-3 정규화 뒤 `1` `5번`)
    ['１ ５번 핑크프릴 만오천 원', '핑크프릴'],
    // 앞 토큰 끝 문장 부호는 지운 뒤 붙인다
    ['1. 5번 핑크프릴 만원', '핑크프릴'],
    ['1~ 5번 핑크프릴 만원', '핑크프릴'],
    ['1, 5 번 라울 만원', '라울'],
    // 띄어 쓴 `번` (X 토큰의 앞 토큰)
    ['십 오 번 라울 만원', '라울'],
    // 끝말이 붙은 번호 표시
    ['1 5번이요 라울 만원', '라울'],
    ['십 오번이고 라울 만원', '라울'],
    // 같은 번호 되풀이 + 끊어 말함 (하나라도 있으면)
    ['15번 15번 1 5번 라울 만원', '라울'],
    ['15번 라울 만원 1 5번', '라울'],
    // 앞 조각이 수가 되면(115·105·이십)
    ['1 15번 라울 만원', '라울'],
    ['0 5번 라울 만원', '라울'],
    ['백 오 번 라울', '라울'],
    ['이 십 번 블루엘프 칠천 원', '블루엘프'],
    // 가격으로 읽힐 앞 조각(`오천` + `오` = 5005)
    ['오천 오번 라울', '라울'],
  ])('%s', (text, name) => {
    expect(run(text)).toEqual({ no: null, name, price: null, confidence: 'LOW' })
  })
})

describe('끊어 말한 번호가 아님 — 번호를 쓸데없이 비우지 않는다', () => {
  it.each([
    // 흔한 말버릇 뒤 (앞 토큰 + X가 수가 아님)
    ['자 15번 라울 만원', 15, 10000],
    ['네 15번 라울 만원', 15, 10000],
    ['이 15번 라울 만원', 15, 10000],
    ['오 15번 라울 만원', 15, 10000],
    ['이번 15번 라울 만원', 15, 10000],
    ['오늘 15번 라울 만원', 15, 10000],
    // 끝말은 떼지 않는다: `십이요오`는 수가 아니다
    ['십이요 오번 라울 만원', 5, 10000],
    // 4자리를 넘는 이어 붙이기(`12345`)는 R-15 밖 — 끊어 말함 아님. 2345번은 maxNumber 999 밖이라 번호 없음
    ['1 2345번 라울 만원', null, 10000],
    // 한자어·숫자 섞기(`천15`·`십15`)는 R-15 실패 — 끊어 말함 아님
    ['천 15번 라울 만원', 15, null],
    ['십 15번 라울 만원', 15, 10000],
    ['이십 15번 라울 만원', 15, 10000],
    // 5자리 이어 붙이기(`10015`)
    ['100 15번 라울 만원', 15, 10000],
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
/** R-17 3 문장 그대로의 참고 판단: 끊어 말한 번호 표시가 하나라도 있는가 */
function hasSplitMarker(text: string): boolean {
  const tokens = tokenize(text)
  if (tokens === null) return false
  const forms = tokens.map(readingForms)
  // V3 자리 읽기 ⓑ + 번 (D-V3-11): 이어진 토큰 정확히 셋이 저마다 자리 글자 하나이고 셋째가 `X번`이면(`1 1 5번` = 115번) 끊어 말한 번호 검사를 하지 않는다
  const DIGIT = /^([0-9]|[공일이삼사오육칠팔구])$/
  const isDigit = (t: string | undefined) => t !== undefined && DIGIT.test(t)
  const digitReadingBeon = (i: number, form: string): boolean =>
    form.length === 2 && isDigit(form.charAt(0)) && isDigit(tokens[i - 1]) && isDigit(tokens[i - 2]) && !isDigit(tokens[i - 3]) && !isDigit(tokens[i + 1]) && !/^[0공]$/.test(tokens[i - 2] as string)
  return tokens.some((token, i) => {
    const previous = i > 0 ? tokens[i - 1] : undefined
    if (previous === undefined) return false
    const attached = (forms[i] ?? []).some((form) => {
      if (form.length < 2 || !form.endsWith(BEON)) return false
      if (digitReadingBeon(i, form.slice(0, -1) + BEON)) return false
      const x = form.slice(0, -1)
      return markerValue(x) !== null && parseKoreanNumber(previous + x) !== null
    })
    const spaced = (forms[i + 1] ?? []).includes(BEON) && markerValue(token) !== null && parseKoreanNumber(previous + token) !== null
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
  it('끊어 말한 표시가 있으면 no·price가 null이고 LOW, HIGH면 끊어 말한 표시가 없다', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TOKENS), { minLength: 1, maxLength: 8 }), (tokens) => {
        const text = tokens.join(' ')
        const result = run(text)
        if (hasSplitMarker(text)) {
          expect(result.no).toBeNull()
          expect(result.price).toBeNull()
          expect(result.confidence).toBe('LOW')
        }
        if (result.confidence === 'HIGH') expect(hasSplitMarker(text)).toBe(false)
      }),
      { numRuns: 3000, seed: 20261020 },
    )
  })
})
