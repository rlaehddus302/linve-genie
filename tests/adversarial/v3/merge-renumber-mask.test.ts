// V3 적대 시험 (test-domain, R-17 3 앞 수와 합치기·뒤 한 자리 수 D-V3-54, 흔한 말 별칭 D-V3-54, R-24 readRenumber D-V3-58, 음성 기록 가리기 D-V3-56):
// 노리는 것: 오십 삼번을 13번으로·63번을 60번으로, 겹친 앞 수를 뒤쪽 조각만 번호로, 앞 수를 가격으로, 대화 속 '녹음'이 녹금이 됨,
// 값이 섞인 말·다른 낱말이 붙은 말을 번호 옮기기로 읽음, 전화번호·끝자리가 기기 기록에 남음.
import { extractVoice, maskArchiveText, prepareVoiceDictionary, readRenumber, readSegments } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const read = (text: string) => {
  const r = extractVoice(text, { dictionary: DICT })
  return { no: r.no, price: r.price }
}

describe('D-V3-54 앞 수와 합치기 (R-17 3)', () => {
  it.each([
    ['50 3번 라울 만원', 53, 10_000],
    ['오십 삼번 라울 만원', 53, 10_000],
    ['60 3번 라울 만원', 63, 10_000],
    ['6 3번 라울 만원', 63, 10_000],
    ['20 3 번 만원', 23, 10_000],
    ['백 오십 삼번 만원', 153, 10_000],
    ['1 5번이요 라울 만원', 15, 10_000],
  ])('자리가 내려감 "%s" → %i번', (text, no, price) => {
    expect(read(text)).toEqual({ no, price })
  })

  it.each(['오 13번 라울 만원', '5 13번 라울 만원', '50 13번 라울 만원', '삼 십오번 만원', '2 15번 라울 만원', '육 삼번 라울 만원'])('자리가 겹침 "%s" → 번호·가격 비움 (뒤쪽 13번만 쓰지 않음)', (text) => {
    expect(read(text)).toEqual({ no: null, price: null })
  })

  // D-V3-66 (1) 이어 더하다 겹치면 비움 · (2) 0·영·공 토큰은 합치지도 끊어 말함으로 보지도 않음
  it.each([
    ['1 이십 오번 라울 만원', null, null],
    ['자 3 오십 삼번 라울 만원', null, null],
    ['0 삼번 라울 만원', 3, 10_000],
    ['0 5번 라울 만원', 5, 10_000],
    ['영 5번 라울 만원', 5, 10_000],
    ['공 오번 라울 만원', 5, 10_000],
    ['0 오십 삼번 라울 만원', 53, 10_000],
  ] as const)('D-V3-66 "%s" → %s번 · %s원', (text, no, price) => {
    expect(read(text)).toEqual({ no, price })
  })

  it.each([
    // 합치면 1234·5015 — 999 밖이라 번호 없음, 앞 수는 번호 토큰이라 가격도 아님
    ['천 이백 삼십 사번 만원', null, 10_000],
    ['가격 오천 15번 라울', null, null],
    // `이`는 수 토큰이 아니다 → D-I4-01 (`이십오`가 R-15) → 비움 / `이 15번`은 `이15`가 수 아님 → 15
    ['이 십오번 만원', null, null],
    ['이 15번 만원', 15, 10_000],
    // 수 토큰이 아닌 `5십삼번`은 번호 표시가 아니다
    ['5십삼번 라울 만원', null, 10_000],
  ] as const)('"%s" → %s번 · %s원', (text, no, price) => {
    expect(read(text)).toEqual({ no, price })
  })

  it.each([
    ['60번 3 라울 만원', null], // 63인지 60인지 애매
    ['60번 삼 라울 만원', null],
    ['60번 3 개 라울 만원', 60], // 다음이 단위 낱말 → 개수
    ['60번 3개 라울 만원', 60],
    ['60번 이 라울 만원', 60], // `이`는 한 자리 수로 보지 않는다
    ['60번 3만 원', 60], // 원 가격 줄의 토큰
  ] as const)('번호 뒤 한 자리 수 "%s" → %s번', (text, no) => {
    expect(read(text).no).toBe(no)
  })

  it('성질: 번호 표시 앞에 그 번호와 자리가 겹치는 수 토큰을 붙이면 늘 번호·가격 비움, 자리가 내려가는 수를 붙이면 더한 번호', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1, max: 9 }), fc.boolean(), (x, d, digits) => {
        const highX = String(x).length - 1
        // 겹침: 앞 수의 가장 낮은 자리 ≤ X의 가장 높은 자리 (한 자리 숫자 둘은 두 자리로 잇는 예외라 뺀다)
        const overlap = d * 10 ** highX
        fc.pre(!(x < 10 && overlap < 10 && digits))
        const pText = digits ? String(overlap) : (sino(overlap) as string)
        fc.pre(pText !== '이') // `이`는 수 토큰이 아니다('이것'의 이) — D-I4-01 쪽
        expect(read(`자 ${pText} ${x}번 라울 만원`)).toEqual({ no: null, price: null })
        // 내려감: 앞 수의 가장 낮은 자리 > X의 가장 높은 자리 (합이 999 안)
        const down = d * 10 ** (highX + 1)
        fc.pre(down + x <= 999)
        const dText = digits ? String(down) : (sino(down) as string)
        expect(read(`자 ${dText} ${x}번 라울 만원`)).toEqual({ no: down + x, price: 10_000 })
      }),
      { numRuns: 400 },
    )
  })
})

const SINO_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
/** 10^k의 배수 하나 (d × 10^k) → 한자어 (`오십`·`삼백`·`칠`) */
function sino(n: number): string | null {
  const text = String(n)
  const d = Number(text[0])
  const zeros = text.length - 1
  const unit = ['', '십', '백', '천'][zeros]
  if (unit === undefined) return null
  return (d === 1 && zeros > 0 ? '' : SINO_DIGITS[d]) + unit
}

describe('D-V3-54 흔한 말 별칭(녹음 → 녹금)은 N번 조각 안에서만', () => {
  const picks = (text: string) => readSegments(text, { dictionary: DICT, final: true }).picks.map((p) => [p.no, p.name, p.price])
  it.each([
    ['89번 녹음 3만 원', [[89, '녹금', 30_000]]],
    ['녹음 89번 3만 원', [[89, null, 30_000]]],
    ['지금 녹음 중이에요 89번 3만 원', [[89, null, 30_000]]],
    ['89번 3만 원 녹음 90번 2만 원', [[89, null, 30_000], [90, null, 20_000]]],
    ['89번 녹색금 3만 원', [[89, '녹금', 30_000]]], // 흔한 말이 아닌 별칭은 그대로
  ])('"%s"', (text, want) => {
    expect(picks(text)).toEqual(want)
  })
  it('N번이 없는 글에서는 녹음이 품종이 되지 않는다', () => {
    expect(extractVoice('녹음 3만 원', { dictionary: DICT }).name).toBeNull()
  })
})

describe('R-24 번호 옮기기 말 (readRenumber, D-V3-58)', () => {
  it.each([
    ['아까 65번은 61번이야', { from: 65, to: 61 }],
    ['자 아까 65번은 61번이에요', { from: 65, to: 61 }], // 군말은 빼고 본다
    ['방금 65번은 61번요', { from: 65, to: 61 }],
    ['그 65번은 61번입니다', { from: 65, to: 61 }],
    ['육십오번은 육십일번', { from: 65, to: 61 }],
    ['65번 아니 61번', { from: 65, to: 61 }],
    ['65번 아니요 61번', { from: 65, to: 61 }],
    ['65번 아니 아니 61번', { from: 65, to: 61 }],
    ['65번 말고 61번', { from: 65, to: 61 }],
    ['65번 정정 61번', { from: 65, to: 61 }],
    ['아니 61번', { from: null, to: 61 }],
    ['아니 아니 61번', { from: null, to: 61 }],
  ])('"%s" → %o', (text, want) => {
    expect(readRenumber(text)).toEqual(want)
  })

  it.each([
    ['값이 같이 있음', '65번 아니 61번 만 원'],
    ['값이 같이 있음 (ⓐ)', '아까 65번은 61번 3만 원'],
    ['원 없는 가격 묶음', '65번 아니 61번 만오천'],
    ['그 밖의 낱말', '아까 65번은 61번이랑 비슷해요'],
    ['같은 번호', '65번은 65번'],
    ['같은 번호 (ⓑ)', '65번 아니 65번'],
    ['범위 밖', '65번은 1000번'],
    ['은·는이 아님', '65번이 61번'],
    ['은·는 뒤 끝말', '65번은요 61번'],
    ['정정 표시 뒤 번호 둘', '아니 61번 62번'],
    ['정정 표시만', '아니'],
    ['번호만', '61번'],
    ['고유어 번호', '여섯 번은 한 번'],
    ['이번', '아까 이번은 61번'],
  ])('%s "%s" → null', (_t, text) => {
    expect(readRenumber(text)).toBeNull()
  })

  // D-V3-66 (4): R-24 번호는 R-17 3 번호 표시 그대로 — 띄어 쓴 `번`·앞 수와 합치기 포함, 겹쳐 비우는 꼴은 null
  it.each([
    ['65 번은 61번', { from: 65, to: 61 }],
    ['6 5번은 6 1번', { from: 65, to: 61 }],
    ['육십 오번은 육십 일번', { from: 65, to: 61 }],
    ['65번 아니 6 1번', { from: 65, to: 61 }],
    ['아니 6 1번', { from: null, to: 61 }],
    ['아까 65 번은 61 번이에요', { from: 65, to: 61 }],
  ])('D-V3-66 "%s" → %o', (text, want) => {
    expect(readRenumber(text)).toEqual(want)
  })
  it.each(['오 13번은 61번', '65번 아니 오 13번', '1 이십 오번은 61번'])('D-V3-66 겹쳐 비우는 번호 "%s" → null', (text) => {
    expect(readRenumber(text)).toBeNull()
  })

  it('maxNumber 밖 번호는 null', () => {
    expect(readRenumber('65번 아니 61번', { maxNumber: 63 })).toBeNull()
    expect(readRenumber('아까 61번은 63번', { maxNumber: 63 })).toEqual({ from: 61, to: 63 })
  })

  it('무작위 낱말: 예외 없음, 결과면 from ≠ to · 1..999 · 글에 원·가격 낱말 없음', () => {
    const piece = fc.constantFrom('아까', '방금', '그', '65번은', '61번', '61번이야', '65번', '아니', '말고', '정정', '자', '요', '만 원', '3만', '만오천', '비슷해요', '이번', '번')
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 7 }), (parts) => {
        const text = parts.join(' ')
        const r = readRenumber(text)
        if (r === null) return
        expect(r.from).not.toBe(r.to)
        expect(r.to >= 1 && r.to <= 999).toBe(true)
        expect(/만|원/.test(text), text).toBe(false)
      }),
      { numRuns: 1500 },
    )
    for (const x of [null, undefined, 3, {}, [], 'a'.repeat(10_000)]) expect(() => readRenumber(x)).not.toThrow()
  })
})

describe('음성 기록 가리기 (maskArchiveText, D-V3-56·R-21 4)', () => {
  it.each([
    ['끝자리 1234 김민지님', '끝자리 **** 김민지님'],
    ['끝 자리 1234', '끝 자리 ****'],
    ['뒷 번호 1234', '뒷 번호 ****'],
    ['뒷번호1234', '뒷번호****'],
    ['뒷자리 1234 뒷번호 5678', '뒷자리 **** 뒷번호 ****'],
    ['끝자리 1234번', '끝자리 ****번'],
    ['010-1234-5678', '****'],
    ['010 1234 5678', '****'],
    ['12345678', '****'],
    ['계좌 110-123-456789', '계좌 ****'],
    ['15번 만오천 원', '15번 만오천 원'],
    ['1234567', '1234567'], // 7자리는 그대로 (8자리 이상만)
    // D-V3-66 (3): 가리기 목록 = R-21 4 끝자리 낱말 전부 (끝번호 포함)
    ['끝번호 1234 김민지님', '끝번호 **** 김민지님'],
    ['끝번호는 5678', '끝번호는 ****'],
  ])('"%s" → "%s"', (text, want) => {
    expect(maskArchiveText(text)).toBe(want)
  })

  // TD-V3-006: D-V3-56은 끝자리 낱말을 R-21 4대로 본다 — R-21 4의 낱말은 "읽는 모양"(끝말 뗀 모양)이 끝자리·뒷자리·뒷번호이고,
  // 숫자도 읽는 모양이 숫자 4개면 뒤 4자리다. 구현은 낱말 바로 뒤(공백만)의 숫자만 가려 "끝자리는 1234"·"끝자리가 1234요"의 뒤 4자리가 기기 기록에 그대로 남는다.
  it.each([
    ['끝자리는 1234 김민지님', '끝자리는 **** 김민지님'],
    ['뒷번호가 5678이요', '뒷번호가 ****이요'],
    ['끝자리 1234요', '끝자리 ****요'],
  ])('TD-V3-006: "%s" → "%s" (끝말 붙은 끝자리 낱말·숫자)', (text, want) => {
    expect(maskArchiveText(text)).toBe(want)
  })

  it('성질: 8자리 이상 숫자(공백·- 섞임)는 어떤 앞뒤 글과도 남지 않는다, 결과에 원래 숫자 8개가 이어 남지 않는다', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 13 }), fc.array(fc.constantFrom('', ' ', '-'), { minLength: 13, maxLength: 13 }), fc.constantFrom('', '전화 ', '15번 ', '자 '), fc.constantFrom('', ' 김민지님', '이요', '번'), (digits, seps, head, tail) => {
        const number = digits.map((d, i) => `${String(d)}${i < digits.length - 1 ? (seps[i] as string) : ''}`).join('')
        const out = maskArchiveText(`${head}${number}${tail}`)
        expect(out.replace(/[^0-9]/g, '').length, out).toBeLessThan(8)
        expect(out).toContain('****')
      }),
      { numRuns: 500 },
    )
    for (const x of [null, undefined, 3, {}, []]) expect(maskArchiveText(x)).toBe('')
  })
})
