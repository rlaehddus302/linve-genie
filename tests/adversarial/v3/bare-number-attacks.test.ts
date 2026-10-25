// V3 적대 시험 (test-domain, AC-V3-62·AC-V3-64, R-17 3·4, D-V3-03·D-V3-11·D-V3-23): '번' 없는 번호·자리 읽기·원 가격 줄을 공격한다.
// 노리는 것: 'N번'이 있는데 '번' 없는 수가 번호를 바꿈, 단위가 붙은 수·한 글자 한글 수가 번호가 됨, 다른 '번' 없는 수 둘인데 번호가 나옴,
// 원 가격 줄이 말한 금액 m이 아닌 다른 값으로 읽힘(삼십…오만원 → 30번 5만원).
import { extractVoice, numberToSino, prepareVoiceDictionary, readRegistration, readyToRegister } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const read = (text: string) => extractVoice(text, { dictionary: DICT })

/** 숫자가 없고 번호·금액·단위·정정이 아닌 낱말 (앞뒤 말) */
const WORDS = ['자', '네', '요', '얘는', '이거', '그대로', '보냅니다', '요 아이', '뿌리', '예쁘게', '나왔습니다', 'bts', '라울', '삼광색금', '핑크프릴', '색감', '들어요'] as const
const word = fc.constantFrom(...WORDS)
const words = (max: number) => fc.array(word, { maxLength: max })

/** '번' 없는 번호로 읽히는 수 (값, 꼴) */
const bareNumber = fc.integer({ min: 1, max: 999 }).chain((n) => {
  const sino = numberToSino(n) as string
  // 한글은 두 글자 이상만 (R-17 3 ⓑ — `십`·`백`·`오` 한 글자는 번호가 아니다)
  return fc.constantFrom(...(sino.length >= 2 ? [String(n), sino] : [String(n)])).map((text) => ({ value: n, text }))
})

describe('AC-V3-62 — N번 우선', () => {
  const MARKERS: readonly (readonly [string, number])[] = [
    ['15번', 15],
    ['십오번', 15],
    ['108번', 108],
    ['15 번', 15],
    ['백육십팔번', 168],
    ['일육팔번', 168],
    ['189번인데', 189],
  ]
  it('N번이 든 문장에 어떤 번 없는 수를 (N번 바로 앞이 아닌 곳에) 더해도 no가 바뀌지 않는다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MARKERS),
        words(3),
        words(3),
        fc.array(fc.tuple(bareNumber, fc.boolean()), { minLength: 1, maxLength: 3 }),
        fc.constantFrom('', '25만 원', '35만 원까지', '만원'),
        ([marker, value], before, after, extras, price) => {
          // 더할 수는 말 사이에 '자'를 두어 N번·가격 줄과 붙지 않게 한다 (붙으면 끊어 말한 번호·가격 줄 규칙의 다른 사례다)
          const head = extras.filter(([, front]) => front).map(([n]) => `자 ${n.text} 자`)
          const tail = extras.filter(([, front]) => !front).map(([n]) => `자 ${n.text} 자`)
          const text = [...head, ...before, '자', marker, ...after, ...tail, price].filter((part) => part !== '').join(' ')
          expect(read(text).no).toBe(value)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('N번이 범위 밖(maxNumber 99)이어도 번 없는 수를 보지 않는다 → no 없음', () => {
    expect(extractVoice('자 108번 자 15 자 25만 원', { maxNumber: 99 }).no).toBeNull()
    expect(readyToRegister('자 108번 자 15 자 25만 원', { maxNumber: 99 })).toBeNull()
  })
})

describe('AC-V3-62 — 단위가 뒤에 오는 수·한 글자 한글 수는 번호가 아니다', () => {
  const UNITS = ['개', '개요', '마리', '살', '년', '월', '일', '시', '분', '초', 'cm', '센치', '센티', 'mm', '미리', '키로', 'kg', '그램', '프로', '등', '위', '번째'] as const
  it('따로 선 수 + 단위 낱말 → 어떤 앞뒤 말과도 번호가 되지 않는다', () => {
    fc.assert(
      fc.property(bareNumber, fc.constantFrom(...UNITS), words(4), words(4), fc.constantFrom('', '25만 원', '만원', '오천 원'), (n, unit, before, after, price) => {
        const text = [...before, n.text, unit, ...after, price].filter((part) => part !== '').join(' ')
        expect(read(text).no).toBeNull()
        expect(readyToRegister(text, { dictionary: DICT })).toBeNull()
      }),
      { numRuns: 400 },
    )
  })

  it('한 글자 한글 수(백·오·이·일·삼·십·천)는 어떤 앞뒤 말과도 번호가 되지 않는다', () => {
    fc.assert(
      fc.property(fc.constantFrom('백', '오', '이', '일', '삼', '사', '구', '십', '천'), words(4), words(4), fc.constantFrom('', '25만 원', '35만 원까지'), (n, before, after, price) => {
        const text = [...before, n, ...after, price].filter((part) => part !== '').join(' ')
        expect(read(text).no).toBeNull()
      }),
      { numRuns: 300 },
    )
  })

  it.each(['3강 25만 원', '자 3강 세금 25만 원', '703강 세금 25만 원', '9cm에 25만 원', '28마리 25만 원', '2개 25만 원', '3강색급 35만 원'])('숫자 뒤에 글자가 붙은 토큰 "%s" → 번호 없음, 바로 등록 없음', (text) => {
    expect(read(text).no).toBeNull()
    expect(readyToRegister(text, { dictionary: DICT })).toBeNull()
  })

  it('번 없는 수 둘이 다르면 no는 늘 null', () => {
    fc.assert(
      fc.property(bareNumber, bareNumber, words(3), words(3), fc.constantFrom('', '25만 원', '만원'), (a, b, mid, after, price) => {
        fc.pre(a.value !== b.value)
        const text = [a.text, '자', ...mid, b.text, '자', ...after, price].filter((part) => part !== '').join(' ')
        expect(read(text).no).toBeNull()
        expect(readyToRegister(text, { dictionary: DICT })).toBeNull()
      }),
      { numRuns: 400 },
    )
  })

  it('번 없는 수 하나 + 원 가격 → 그 번호로 확정 (R31~R36 꼴)', () => {
    fc.assert(
      fc.property(bareNumber, words(3), fc.constantFrom('25만 원', '35만 원까지', '만원'), (n, mid, price) => {
        const text = [n.text, '자', ...mid, price].join(' ')
        expect(readyToRegister(text, { dictionary: DICT })?.no).toBe(n.value)
      }),
      { numRuns: 300 },
    )
  })

  // TD-V3-001: 자리 읽기(일육팔·일 육 팔)의 '번' 없는 번호 후보에 R-17 3의 후보 조건(끝말은 은·는·이·가·요만, 다음 토큰이 단위 낱말이면 아님)이 빠졌다.
  // 같은 꼴의 숫자(`168에`·`168 개`)는 후보가 아닌데 자리 읽기만 번호가 되어 바로 등록된다.
  it.each([
    ['일육팔에 25만 원', '168에 25만 원'],
    ['일육팔까지 25만 원', '168까지 25만 원'],
    ['일육팔이에요 25만 원', '168이에요 25만 원'],
    ['일육팔 개 25만 원', '168 개 25만 원'],
    ['일육팔 마리 25만 원', '168 마리 25만 원'],
    ['일 육 팔 개 25만 원', '168 개 25만 원'],
  ])('TD-V3-001: "%s"는 번 없는 번호 후보가 아니다("%s"와 같이 no 없음, 바로 등록 없음)', (text, sameAs) => {
    expect(read(sameAs).no).toBeNull()
    expect(read(text).no).toBeNull()
    expect(readyToRegister(text, { dictionary: DICT })).toBeNull()
  })

  it.each([
    ['일육팔은 25만 원', 168],
    ['일육팔이 25만 원', 168],
    ['일육팔요 25만 원', 168],
    ['1 6 8 bts 25만 원', 168],
  ])('자리 읽기 + 허용 끝말 "%s" → %i번 확정 (TD-V3-001 회귀 짝)', (text, no) => {
    expect(readyToRegister(text, { dictionary: DICT })?.no).toBe(no)
  })

  // D-V3-27: 띄어 쓴 한글 한 글자 셋은 '번'이 붙을 때만 번호다 (`일 육 팔`·`이 삼 일` = 번호 아님, `이 삼 일번` = 231번)
  it.each(['일 육 팔 bts 25만 원', '택배는 이 삼 일 걸리고 만 원이에요'])('D-V3-27: "%s" → 번호 없음, 바로 등록 없음', (text) => {
    expect(read(text).no).toBeNull()
    expect(readyToRegister(text, { dictionary: DICT, final: true })).toBeNull()
  })
  it('D-V3-27: "이 삼 일번 만 원" → 231번', () => {
    expect(read('이 삼 일번 만 원').no).toBe(231)
  })
})

describe('AC-V3-64 — 원 가격 줄은 m이거나 비움', () => {
  /** 1..9999의 자리 항(1000·100·10·1 자리) */
  const termsOf = (n: number): number[] => [1000, 100, 10, 1].map((place) => Math.floor(n / place) % 10 * place).filter((term) => term > 0)

  /** m(원)을 R-15 거꾸로 한 한글·숫자 섞어 띄어 쓴 꼴로 쓴다: 자리 항을 이어진 토큰으로 묶고 토큰마다 한글/숫자를 고른다 */
  const spoken = (m: number) =>
    fc
      .record({
        manCuts: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        restCuts: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        manDigits: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        restDigits: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        manApart: fc.boolean(),
        wonApart: fc.boolean(),
        wonTail: fc.constantFrom('', '까지', '이에요', '짜리', '요', '에'),
      })
      .map((choice) => {
        const group = (n: number, cuts: boolean[], digits: boolean[]): string[] => {
          const tokens: number[][] = []
          let current: number[] = []
          termsOf(n).forEach((term, i) => {
            current.push(term)
            if (cuts[i]) {
              tokens.push(current)
              current = []
            }
          })
          if (current.length > 0) tokens.push(current)
          return tokens.map((terms, i) => {
            const sum = terms.reduce((a, b) => a + b, 0)
            return digits[i] ? String(sum) : (numberToSino(sum) as string)
          })
        }
        const man = Math.floor(m / 10_000)
        const rest = m % 10_000
        const out: string[] = []
        if (man > 0) {
          const g = group(man, choice.manCuts, choice.manDigits)
          if (choice.manApart) g.push('만')
          else g[g.length - 1] += '만'
          out.push(...g)
        }
        if (rest > 0) out.push(...group(rest, choice.restCuts, choice.restDigits))
        if (choice.wonApart) out.push(`원${choice.wonTail}`)
        else out[out.length - 1] += `원${choice.wonTail}`
        return out.join(' ')
      })

  const money = fc.integer({ min: 1, max: 99_999 }).map((k) => k * 100)

  it('어떤 앞말과도 값은 m이거나 null, 절대 m이 아닌 값이 아니다 (바로 등록 값도)', () => {
    fc.assert(
      fc.property(
        money.chain((m) => spoken(m).map((line) => ({ m, line }))),
        fc.constantFrom('', '15번 라울', '자', '라울', '15번', '180번 상관 세금 자', '일육팔 삼광색금', '자 170 자'),
        ({ m, line }, head) => {
          const text = head === '' ? line : `${head} ${line}`
          const price = read(text).price
          expect(price === null || price === m, `${text} → ${price}`).toBe(true)
          const ready = readyToRegister(text, { dictionary: DICT })
          expect(ready === null || ready.price === m, `${text} → 등록 ${ready?.price}`).toBe(true)
        },
      ),
      { numRuns: 3000 },
    )
  })

  // TD-V3-002: 만의 계수에 백·천 자리 + 일의 자리가 있는 금액(백오만·이백삼만)을 띄어 말하면, 붙여 읽기가 R-14(D-032 — 백 뒤 일의 자리 실패)에서
  // 막히고 줄 왼쪽 토큰(100·이백·육백)이 '번' 없는 번호로 떨어져 나가 꼬리(5만 원·3만원)만 가격이 된다. 사용자 결정(D-V3-03 "삼십…오만원을
  // 30번 5만원으로 알아먹지 말라")과 AC-V3-64("절대 m이 아닌 값이 아니다")를 어긴다 — m이거나 비워야 한다.
  it.each([
    ['100 5만 원', 1_050_000],
    ['이백 오만 원', 2_050_000],
    ['육백 삼만원', 6_030_000],
    ['자 300 2만 원', 3_020_000],
  ])('TD-V3-002: "%s"(m = %i원) → 가격은 m이거나 비움, 다른 금액으로 바로 등록하지 않는다', (text, m) => {
    const price = read(text).price
    expect(price === null || price === m, `가격 ${price}`).toBe(true)
    const ready = readyToRegister(text, { dictionary: DICT })
    expect(ready === null || ready.price === m, `등록 ${ready?.no}번 ${ready?.price}원`).toBe(true)
  })

  it.each([
    ['15번 라울 삼십 오만 원', 350_000],
    ['180번 30 5만 원', 350_000],
    ['15번 이십 오 만원', 250_000],
    ['15번 20 5 만원', 250_000],
    ['15번 3 만 5천 원', 35_000],
    ['15번 천 오백 원', 1_500],
    ['15번 2 천 5 백 원', 2_500],
    ['15번 999 만 9천9백 원', 9_999_900],
  ])('"%s" → %i원 바로 등록', (text, price) => {
    expect(readyToRegister(text, { dictionary: DICT })?.price).toBe(price)
  })

  it.each(['15번 백 오만 원', '15번 100 5만 원', '15번 1.5 만원', '15번 이 만원짜리', '15번 라울 174 28만 원', '15번 170 25만 원'])('애매한 줄 "%s" → 가격 비움, 바로 등록 없음', (text) => {
    expect(read(text).price).toBeNull()
    expect(readyToRegister(text, { dictionary: DICT })).toBeNull()
  })

  it('원이 아직 안 들린 줄은 바로 등록이 아니다 (낱말 하나씩 늘려 넣기 — 30,000·50,000 쓰기 없음)', () => {
    fc.assert(
      fc.property(
        money.chain((m) => spoken(m).map((line) => ({ m, line }))),
        fc.constantFrom('15번 라울', '180번', '일육팔'),
        ({ m, line }, head) => {
          const tokens = `${head} ${line}`.split(' ')
          for (let k = 1; k <= tokens.length; k++) {
            const prefix = tokens.slice(0, k).join(' ')
            const reading = readRegistration(prefix, { dictionary: DICT })
            if (reading.ready === null) continue
            expect(k, `${prefix}: 원이 들리기 전 등록`).toBe(tokens.length)
            expect(reading.ready.price).toBe(m)
          }
        },
      ),
      { numRuns: 1500 },
    )
  })
})
