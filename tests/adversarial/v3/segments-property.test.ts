// V3 적대 시험 (test-domain, AC-V3-60 — R-17 8 조각 소비, D-V3-23·26·46·51·71·73, SA-V3-003): 화면이 실제로 바로 등록을 정하는 readSegments를
// 낱말 하나씩 늘려 넣으며 공격한다. 노리는 것: 원 가격 없이 등록, 원 가격 바로 앞이 아닌 번호와 짝, 남은 조각의 맨 수를 번호로, 글 끝 맨 수로 등록,
// 정정이 든 조각에서 등록, 한 조각에 등록 둘, 글이 늘면서 앞 등록이 바뀜, 실제 방송 변형에서 엉뚱한 번호.
// 1,000ms 안정(D-V3-71)은 시각을 받는 따로 된 함수(trackInterim)라 waiting-interim-auto.test.ts가 본다 — 여기서 품종 없는 빠른 꼴은 최종일 때만이다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseKoreanNumber } from '@livejjim/core'
import { CANCEL_WORDS, CORRECTION_MARKERS, prepareVoiceDictionary, readSegments, type SegmentPick, type SegmentReading } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const seg = (text: string, final: boolean): SegmentReading => readSegments(text, { dictionary: DICT, final, priceUnit: 'THOUSAND' })

const ENDINGS = ['이에요', '예요', '에요', '입니다', '이요', '이고', '이랑', '하고', '짜리', '에는', '은', '는', '이', '가', '을', '를', '에', '엔', '도', '요', '랑', '까지', '인데']
const formsOf = (token: string): string[] => [token, ...ENDINGS.filter((e) => token.length > e.length && token.endsWith(e)).map((e) => token.slice(0, -e.length))]
const AMOUNT = /^[0-9,.일이삼사오육칠팔구십백천만]*$/
const isWonToken = (t: string): boolean => formsOf(t).some((f) => f.endsWith('원') && AMOUNT.test(f.slice(0, -1)))

/** 토큰 i가 끝내는 `N번` 표시의 값들 (붙여 쓴 꼴·띄어 쓴 꼴의 `번` 토큰, 앞 수와 합치기는 넓게 — 합친 값과 뒤쪽 값 둘 다) */
function markerValuesAt(tokens: readonly string[], i: number): number[] {
  const out: number[] = []
  const xValue = (x: string): number | null => {
    if (x === '이' || !/^([0-9]{1,4}|[일이삼사오육칠팔구십백천]+)$/.test(x)) return null
    if (/^[공일이삼사오육칠팔구]{3}$/.test(x) && x[0] !== '공') return Number([...x].map((c) => '공일이삼사오육칠팔구'.indexOf(c)).join(''))
    return parseKoreanNumber(x)
  }
  const push = (x: string, xIndex: number): void => {
    const v = xValue(x)
    if (v === null) return
    out.push(v)
    // 앞 수와 합치기(D-V3-54)·자리 읽기(D-V3-11) — 앞 토큰 둘까지 붙여 본 값도 후보로 (넓게: 이 판단은 "번호가 그 자리 N번에서 왔는가"만 본다)
    const p1 = tokens[xIndex - 1]
    const p2 = tokens[xIndex - 2]
    if (p1 !== undefined) {
      const a = parseKoreanNumber(p1)
      if (a !== null) out.push(a + v, a * 10 + v)
      if (/^[0-9]$/.test(p1) && /^[0-9]$/.test(x)) out.push(Number(p1 + x))
      if (p2 !== undefined) {
        const b = parseKoreanNumber(p2)
        if (b !== null && a !== null) out.push(b + a + v, b * 100 + a * 10 + v)
        const digit = (t: string) => (/^[0-9]$/.test(t) ? Number(t) : '공일이삼사오육칠팔구'.indexOf(t))
        if (p1.length === 1 && p2.length === 1 && x.length === 1 && digit(p2) > 0 && digit(p1) >= 0 && digit(x) >= 0) out.push(digit(p2) * 100 + digit(p1) * 10 + digit(x))
      }
    }
  }
  const token = tokens[i] as string
  for (const form of formsOf(token)) if (form.length >= 2 && form.endsWith('번')) push(form.slice(0, -1), i)
  if (i > 0 && formsOf(token).includes('번')) push(tokens[i - 1] as string, i - 1)
  return out
}
const isMarkerToken = (tokens: readonly string[], i: number): boolean => markerValuesAt(tokens, i).length > 0

const isCorrectionToken = (t: string): boolean => CORRECTION_MARKERS.includes(t) || CANCEL_WORDS.includes(t) || (t.length > 2 && t.endsWith('말고'))

/** pick 하나의 성질 (a)·(b)·(e) — 그 조각 토큰만 본다 */
function checkPick(r: SegmentReading, p: SegmentPick, index: number, final: boolean, text: string): void {
  const piece = r.tokens.slice(p.start, p.end + 1)
  const where = `${text} → ${p.no}번 ${p.price}원 [${piece.join(' ')}]`
  expect(p.no >= 1 && p.no <= 999, where).toBe(true)
  expect(p.price >= 100 && Number.isSafeInteger(p.price), where).toBe(true)
  // (a) 원 가격 줄 또는 빠른 꼴 수
  if (p.priceFrom === 'won') expect(piece.some(isWonToken), `원 없이 원 가격: ${where}`).toBe(true)
  if (p.priceFrom === 'quick' && p.name === null) expect(final, `중간 결과에서 품종 없는 빠른 꼴: ${where}`).toBe(true)
  if (p.numberFrom === 'marker') {
    // 번호는 그 조각의 N번 — (e) 원 가격 바로 앞의 N번(가장 뒤), 원 가격 앞에 N번이 없으면 가격 뒤 번호 꼴(최종)의 첫 N번
    const firstWon = piece.findIndex(isWonToken)
    const limit = p.priceFrom === 'won' && firstWon >= 0 ? firstWon : piece.length
    const before: number[] = []
    for (let j = 0; j < limit; j++) if (isMarkerToken(r.tokens, p.start + j)) before.push(j)
    if (before.length > 0) {
      const last = before[before.length - 1] as number
      expect(markerValuesAt(r.tokens, p.start + last), `원 가격 바로 앞 N번이 아님: ${where}`).toContain(p.no)
    } else {
      expect(final, `중간 결과에서 가격 뒤 번호 꼴: ${where}`).toBe(true)
      const after: number[] = []
      for (let j = Math.max(firstWon, 0); j < piece.length; j++) if (isMarkerToken(r.tokens, p.start + j)) after.push(j)
      expect(after.length, `번호 표시 없는 marker: ${where}`).toBeGreaterThan(0)
      expect(markerValuesAt(r.tokens, p.start + (after[0] as number)), `가격 뒤 첫 N번이 아님: ${where}`).toContain(p.no)
    }
  } else {
    // 첫 조각의 '번' 없는 번호만 (D-V3-73) — 앞에 다른 pick이 없다. 중간 결과 글 끝 토큰이 아니다 (D-V3-26)
    expect(index, `남은 조각의 '번' 없는 번호: ${where}`).toBe(0)
    if (!final) expect(p.end < r.tokens.length - 1 || isWonToken(r.tokens[r.tokens.length - 1] as string), `글 끝 맨 수: ${where}`).toBe(true)
  }
  // (b) 정정·취소: 조각 안에 취소 낱말이 없고, 정정 표시 바로 뒤에 값(원·금액 글자·N번)이 오지 않는다 (D-V3-51 — 값이 없는 '아니'는 대화)
  piece.forEach((t, j) => {
    if (CANCEL_WORDS.includes(t)) throw new Error(`취소가 든 조각에서 등록: ${where}`)
    if (isCorrectionToken(t)) {
      const next = piece[j + 1]
      if (next !== undefined && (isWonToken(next) || AMOUNT.test(next) || isMarkerToken(r.tokens, p.start + j + 1))) throw new Error(`정정이 든 조각에서 등록: ${where}`)
    }
  })
}

/** 낱말 하나씩 늘려 넣기 (k < n 중간 결과, k = n 최종): 성질 (a)~(d)를 보고, 화면처럼 `${no}@${start}`마다 한 번 등록한다고 센다 */
function feed(text: string, stable = false): { registered: { no: number; price: number; start: number }[] } {
  const tokens = text.split(' ').filter((t) => t !== '')
  const done = new Map<string, { no: number; price: number; start: number }>()
  let previous: readonly SegmentPick[] = []
  for (let k = 1; k <= tokens.length; k++) {
    const prefix = tokens.slice(0, k).join(' ')
    const final = k === tokens.length
    const r = seg(prefix, final)
    // (c) 한 조각에 pick 하나 — 조각은 겹치지 않고 차례대로
    let last = -1
    r.picks.forEach((p, i) => {
      expect(p.start > last, `조각이 겹침: ${prefix}`).toBe(true)
      last = p.end
      if (!stable) checkPick(r, p, i, final, prefix)
      const key = `${String(p.no)}@${String(p.start)}`
      if (!done.has(key)) done.set(key, { no: p.no, price: p.price, start: p.start })
    })
    // (d) 글이 늘어도 앞 pick은 바뀌지 않는다 — 앞 글의 pick은 그대로(같은 자리·번호·가격) 남는다 (stable일 때만 — TD-V3-008은 따로)
    // 빠른 꼴(priceFrom quick) pick은 뺀다 — R-17 8 문장("수 뒤가 조각 끝 — 뒤에 군말만")대로면 "15번 라울 60 자"의 pick이 "… 자 뿌리"에서 사라져
    // AC-V3-60 (d)와 부딪힌다(스펙 확인 필요로 보고). 원 가격 짝·'번' 없는 번호 pick만 본다
    if (stable) for (const old of previous.filter((p) => p.priceFrom === 'won')) {
      expect(
        r.picks.some((p) => p.start === old.start && p.no === old.no && p.price === old.price),
        `앞 pick ${old.no}번 ${old.price}원@${old.start}이 바뀜: ${prefix}`,
      ).toBe(true)
    }
    previous = r.picks
  }
  return { registered: [...done.values()] }
}

const VOCAB = [
  '15번', '십오번', '108번', '189번인데', '139번', '15', '번', '일육팔', '일육팔은', '1', '6', '8번', '백육십팔', '170', '174', '이번', '한', '이',
  '25만', '원', '원까지', '10만', '만원', '만원짜리', '삼십', '오만', '30', '5만', '천', '오천원', '1.5', '이만원이에요', '60', '180', '갑니다',
  '자', '요', '아이', '요 아이', 'UI는', 'bts', '라울', '삼광색금', '3강', '3강색급', '9cm에', '이거', '그대로', '28마리까지', '3개',
  '아니', '말고', '만오천말고', '취소', '다시', '품종은', '가격이', '문자찜',
] as const

const PLAIN = VOCAB.filter((word) => !isCorrectionToken(word) && word !== '다시')

describe('AC-V3-60 — readSegments에 무작위 문장을 낱말 하나씩 (a)~(d)', () => {
  it('(a)(c) 정정·취소 낱말 없는 글: pick마다 원 가격 줄·빠른 꼴, 원 가격 바로 앞 N번(또는 첫 조각의 번 없는 번호), 한 조각 하나', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...PLAIN), { minLength: 1, maxLength: 16 }), (parts) => {
        feed(parts.join(' '))
      }),
      { numRuns: 2000 },
    )
  })

  it('TD-V3-009 (b) 정정·취소 낱말이 섞인 글: 위 성질 + 정정·취소가 든 조각엔 pick이 없다', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 16 }), (parts) => {
        feed(parts.join(' '))
      }),
      { numRuns: 2000 },
    )
  })

  // TD-V3-008: AC-V3-60 (d) "글이 늘어도 앞 pick은 바뀌지 않는다" — 첫 조각의 '번' 없는 번호 pick이 뒤에 붙은 말(남은 조각의 맨 수·N번)에 따라
  // 사라진다. D-V3-73으로 남은 조각에선 '번' 없는 수가 번호가 아닌데, 구현은 덩어리 글 전체의 '번' 없는 번호·N번 우선 판단을 첫 조각에 다시 적용한다.
  // 화면은 중간 결과에서 이미 170번을 등록한 뒤라, 최종 읽기와 등록이 어긋난다(덩어리 끝 처리·기록이 그 등록을 모름).
  it.each([
    ['170 25만 원', '170 25만 원 1'],
    ['170 25만 원', '170 25만 원 자 3번'],
    ['170 25만 원', '170 25만 원 자 15번 만원'],
    ['15 5만 원까지', '15 5만 원까지 15번'],
  ])('TD-V3-008: "%s"의 pick이 "%s"에서도 그대로', (head, longer) => {
    const before = seg(head, false).picks.map((p) => [p.no, p.price, p.start])
    expect(before).toHaveLength(1)
    const after = seg(longer, false).picks.map((p) => [p.no, p.price, p.start])
    expect(after).toContainEqual(before[0])
  })

  // TD-V3-009: AC-V3-60 (b) "정정·취소 낱말(D-V3-51 꼴)이 든 조각엔 pick이 없다". 빠른 꼴(D-V3-48·63)이 정정·취소 낱말을 군말처럼 건너뛰어
  // "15번 취소 180"을 15번 · 180,000원으로 바로 등록한다(취소라고 말했는데 등록). 원 가격 꼴("15번 취소 만 원")은 막힌다.
  it.each(['15번 취소 180', '15번 아니 180', '15번 아니 오만', '15번 다시 180', '15번 정정 180', '15번 삼광색금 만오천말고 25만', '15번 라울 만오천 말고 25만'])('TD-V3-009: "%s"(최종, 천원) → pick 없음', (text) => {
    expect(seg(text, true).picks).toEqual([])
  })
  it.each(['15번 취소 만 원', '15번 아니 만 원', '15번 라울 취소 180'])('"%s"(최종) → pick 없음 (회귀)', (text) => {
    expect(seg(text, true).picks).toEqual([])
  })

  it('TD-V3-008 성질 (d): 무작위 문장에서 글이 늘어도 앞 원 가격 pick은 그대로', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 16 }), (parts) => {
        feed(parts.join(' '), true)
      }),
      { numRuns: 1000 },
    )
  })

  it.each([
    ['93번 청개구리 7만 원 97번 23만 원', [[93, 70_000], [97, 230_000]]],
    ['107번 10만 원 108번 12만 원', [[107, 100_000], [108, 120_000]]],
    ['93번 청개구리 97번 23만 원', [[97, 230_000]]],
    ['15번 만 원 15번 2만 원', [[15, 10_000], [15, 20_000]]], // (c) 같은 번호 둘째 = 같은 번호 처리(R-22)
    ['자 9cm에 이거 25만 원 170', []],
    ['15번 라울 삼십 오만 원', [[15, 350_000]]], // 30,000·50,000 등록 없음
    ['10만 원 108번', [[108, 100_000]]], // 가격 뒤 번호 꼴은 덩어리 끝에만
  ])('사례 "%s" → 등록 %o', (text, want) => {
    expect(feed(text).registered.map((x) => [x.no, x.price])).toEqual(want)
  })
})

describe('AC-V3-60 (e) — 실제 방송 6문장 변형 500개', () => {
  const lines = readFileSync(join(import.meta.dirname, '../../../harness/sprints/V3/real-broadcast.txt'), 'utf8')
    .split('\n')
    .map((line) => /^([1-6])\. (.+)$/.exec(line)?.[2])
    .filter((line): line is string => line !== undefined)

  it('낱말 하나 빼기·이웃 둘 바꾸기: pick 번호는 늘 그 조각 원 가격 바로 앞 N번(또는 덩어리 끝의 가격 뒤 첫 N번)', () => {
    expect(lines).toHaveLength(6)
    let picks = 0
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), fc.array(fc.tuple(fc.boolean(), fc.nat()), { minLength: 1, maxLength: 3 }), (which, edits) => {
        const tokens = (lines[which] as string).split(' ')
        for (const [drop, at] of edits) {
          const i = at % tokens.length
          if (drop && tokens.length > 1) tokens.splice(i, 1)
          else if (i + 1 < tokens.length) [tokens[i], tokens[i + 1]] = [tokens[i + 1] as string, tokens[i] as string]
        }
        picks += feed(tokens.join(' ')).registered.length
      }),
      { numRuns: 500, seed: 20_261_025 },
    )
    expect(picks).toBeGreaterThan(200)
  })
})
