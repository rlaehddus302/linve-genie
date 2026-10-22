// 옵션 모델 도구와 댓글 옵션 인식의 경계 (R-19·R-20, AC-O1-15~18 — 골든 comment-options 89사례 밖)
import { FOCUS_GRACE_SEC, compareChars, parseChat, parseOptionComment, unitPriceOf, variantCount, variantTexts, type OptionCatalogEntry, type OptionItem } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { matchesNumberGrammar } from '../../src/parse/chat.ts'
import { indexesOfText, lowestUnitPrice, optionTextOf, pairsOfText, pickIndexes, variantIndexes } from '../../src/options.ts'

const COLOR_SIZE: readonly OptionItem[] = [
  { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', price: -500 }] },
  { name: '크기', choices: [{ label: '소형' }, { label: '대형', price: 2000 }] },
]

describe('옵션 모델 (R-19)', () => {
  it('비교 글자·변형·옵션 글·단가', () => {
    expect(compareChars('  17 Pro ')).toBe('17pro')
    expect(compareChars('１７ PRO')).toBe('17pro')
    expect(variantTexts(COLOR_SIZE)).toEqual(['흰색/소형', '흰색/대형', '검정색/소형', '검정색/대형'])
    expect(variantTexts([])).toEqual([])
    expect(variantIndexes([])).toEqual([])
    expect(variantCount([])).toBe(0)
    expect(variantCount(COLOR_SIZE)).toBe(4)
    expect(optionTextOf(COLOR_SIZE, [1, 0])).toBe('검정색/소형')
    expect(optionTextOf(COLOR_SIZE, [9, 0])).toBe('/소형')
    expect(unitPriceOf(10000, COLOR_SIZE, [1, 1])).toBe(11500)
    expect(unitPriceOf(10000, COLOR_SIZE, [0, 9])).toBe(10000)
    expect(lowestUnitPrice(1000, COLOR_SIZE)).toBe(500)
  })

  it('고른 옵션·옵션 글 → 선택지 번호 (모든 항목이 정확히 맞을 때만)', () => {
    expect(pickIndexes(COLOR_SIZE, { 색상: '검정색', 크기: '대형' })).toEqual([1, 1])
    expect(pickIndexes(COLOR_SIZE, { 색상: '검정색' })).toBeNull()
    expect(pickIndexes(COLOR_SIZE, { 색상: '검정색', 사이즈: '대형' })).toBeNull()
    expect(pickIndexes(COLOR_SIZE, { 색상: '빨강', 크기: '대형' })).toBeNull()
    expect(pickIndexes([], {})).toEqual([])
    expect(indexesOfText(COLOR_SIZE, '흰색/대형')).toEqual([0, 1])
    expect(indexesOfText(COLOR_SIZE, '흰색')).toBeNull()
    expect(indexesOfText(COLOR_SIZE, '흰색/특대')).toBeNull()
    expect(indexesOfText([], '')).toBeNull()
    expect(pairsOfText(COLOR_SIZE, '흰색/대형')).toEqual([
      ['색상', '흰색'],
      ['크기', '대형'],
    ])
    expect(pairsOfText(COLOR_SIZE, '흰색')).toEqual([
      ['색상', '흰색'],
      ['크기', ''],
    ])
  })
})

describe('parseOptionComment 경계 (R-20)', () => {
  const catalog: OptionCatalogEntry[] = [
    { no: 11, name: '초코 과자', aliases: ['초코'] },
    { no: 12, name: '' },
    { no: 31, name: '수건', options: COLOR_SIZE },
    { no: 31, name: '겹친 번호', options: [] },
    { no: 41, name: '물', options: [{ name: '용량', choices: [{ label: '500ml' }, { label: '1L' }] }] },
  ]
  const parse = (text: string, focus: { no: number; ageSec: number } | null = null, settings = {}) => parseOptionComment(text, catalog, focus, settings)

  it('번호 문법이면 multiNumber=IGNORE·범위 밖·번호 6개 이상이어도 STRICT 결과(언급) 그대로 — 옵션 해석으로 넘어가지 않는다 (R-20 2, SA-O1-04)', () => {
    const tee: OptionCatalogEntry[] = [{ no: 22, name: '반팔티', options: [{ name: '사이즈', choices: [{ label: '95' }, { label: '100' }] }] }]
    const none = { orders: [], cancels: [], review: null }
    expect(parseOptionComment('22 100', tee, null, { 'claim.multiNumber': 'IGNORE' })).toEqual({ ...none, mentions: [22, 100] })
    expect(parseOptionComment('22 100', tee, null, { 'claim.maxNumber': 99 })).toEqual({ ...none, mentions: [22] })
    expect(parseOptionComment('1 2 3 4 5 22', tee, null)).toEqual({ ...none, mentions: [1, 2, 3, 4, 5, 22] })
    expect(parseOptionComment('100 취소', tee, null, { 'claim.maxNumber': 99 })).toEqual({ orders: [], cancels: [], mentions: [], review: null })
    // 기본 설정이면 확인 필요 그대로
    expect(parseOptionComment('22 100', tee, null).review).toEqual({ reason: 'OPTION_MISSING', no: 22 })
  })

  it('matchesNumberGrammar: 번호 문법인가 (금액 덩어리·끝 신호는 문법이 아니다, LOOSE는 주문 부분)', () => {
    expect(matchesNumberGrammar('22 100')).toBe(true)
    expect(matchesNumberGrammar('22 100', { 'claim.maxNumber': 99 })).toBe(true)
    expect(matchesNumberGrammar('21 취소')).toBe(true)
    expect(matchesNumberGrammar('22 10000원')).toBe(false)
    expect(matchesNumberGrammar('22?')).toBe(false)
    expect(matchesNumberGrammar('반팔티 22')).toBe(false)
    expect(matchesNumberGrammar('22 주세요', { 'claim.parseMode': 'LOOSE' })).toBe(true)
    expect(matchesNumberGrammar('22 취소요 해주세요', { 'claim.parseMode': 'LOOSE' })).toBe(parseChat('22 취소요 해주세요', { 'claim.parseMode': 'LOOSE' }).cancels.length > 0)
    expect(matchesNumberGrammar('22 주세요 취소', { 'claim.parseMode': 'LOOSE' })).toBe(false)
    expect(matchesNumberGrammar('안녕하세요')).toBe(false)
  })

  it('같은 입력이면 같은 결과, 넘긴 값을 바꾸지 않는다, 문자열이 아니면 빈 결과', () => {
    const frozen = Object.freeze(catalog.map((entry) => Object.freeze({ ...entry })))
    expect(parseOptionComment('초코 3', frozen, null)).toEqual(parseOptionComment('초코 3', frozen, null))
    expect(parseOptionComment(undefined as unknown as string, catalog, null)).toEqual({ orders: [], cancels: [], mentions: [], review: null })
    expect(FOCUS_GRACE_SEC).toBe(15)
  })

  it('번호 문법: multiNumber·범위·같은 번호 반복·번호가 겹친 상품 목록(처음 것)', () => {
    expect(parse('11 12', null, { 'claim.multiNumber': 'FIRST' }).orders).toEqual([{ no: 11, qty: 1 }])
    expect(parse('11 12', null, { 'claim.multiNumber': 'IGNORE' }).mentions).toEqual([11, 12])
    expect(parse('1000', null, { 'claim.maxNumber': 999 }).mentions).toEqual([])
    expect(parse('31').review).toEqual({ reason: 'OPTION_MISSING', no: 31 })
    expect(parse('31 취소').cancels).toEqual([31])
    // 지금 상품의 선택지와 같은 숫자 — 숫자만인 메시지일 때만
    const sized: OptionCatalogEntry[] = [{ no: 22, name: '티', options: [{ name: '사이즈', choices: [{ label: '95' }, { label: 'L', aliases: ['100'] }] }] }]
    expect(parseOptionComment('100', sized, { no: 22, ageSec: 60 }).review).toEqual({ reason: 'NUMBER_AMBIGUOUS' })
    expect(parseOptionComment('100번', sized, { no: 22, ageSec: 60 }).orders).toEqual([{ no: 100, qty: 1 }])
    expect(parseOptionComment('100', sized, null).orders).toEqual([{ no: 100, qty: 1 }])
  })

  it('수량: 단위(한글 수·박스·세트), 맨숫자는 이름·옵션 바로 뒤(구분자 사이)만, 둘이면 해석이 맞지 않는다', () => {
    expect(parse('초코 다섯박스').orders).toEqual([{ no: 11, qty: 5 }])
    expect(parse('초코 네 세트').orders).toEqual([{ no: 11, qty: 4 }])
    expect(parse('초코, 2').orders).toEqual([{ no: 11, qty: 2 }])
    expect(parse('초코과자 2개 3개').mentions).toEqual([2, 3])
    expect(parse('초코 100개').mentions).toEqual([100])
    expect(parse('초코 한정판').mentions).toEqual([])
    expect(parse('초코 세상').mentions).toEqual([])
    expect(parse('초코 99', null, { 'claim.maxQuantity': 99 }).orders).toEqual([{ no: 11, qty: 99 }])
    // 옵션 없는 상품의 수량 범위 밖은 확인 필요
    expect(parse('초코 0개').review).toEqual({ reason: 'QTY_INVALID', no: 11, qty: 0 })
    expect(parse('초코 11개').review).toEqual({ reason: 'QTY_INVALID', no: 11, qty: 11 })
  })

  it('옵션: 숫자로 시작·끝나는 선택지는 앞뒤에 숫자가 붙으면 아니다, 꼬리 기호·이모지, 공백 무시', () => {
    expect(parse('물 500ml 2', { no: 41, ageSec: 99 }).orders).toEqual([{ no: 41, options: { 용량: '500ml' }, qty: 2 }])
    expect(parse('물 1500ml').review).toEqual({ reason: 'UNKNOWN_WORD', no: 41 })
    expect(parse('물 1L!! 🎉').orders).toEqual([{ no: 41, options: { 용량: '1L' }, qty: 1 }])
    expect(parse('물 1 L 요').orders).toEqual([{ no: 41, options: { 용량: '1L' }, qty: 1 }])
    expect(parse('1L', { no: 41, ageSec: 3 }).review).toEqual({ reason: 'FOCUS_CHANGED', no: 41, options: { 용량: '1L' } })
    expect(parse('화이트 대형 두 개', { no: 31, ageSec: 99 }).orders).toEqual([{ no: 31, options: { 색상: '흰색', 크기: '대형' }, qty: 2 }])
    expect(parse('화이트 화이트 대형', { no: 31, ageSec: 99 }).orders).toEqual([{ no: 31, options: { 색상: '흰색', 크기: '대형' }, qty: 1 }])
    // 질문·금액·취소
    expect(parse('물 1L？').mentions).toEqual([1])
    expect(parse('물 1.5L').mentions).toEqual([])
    expect(parse('물 1L 취소').mentions).toEqual([1])
  })

  it('상품: 맨 앞 번호(번·띄어 쓴 번)와 이름, 같은 상품의 번호는 함께 지운다', () => {
    expect(parse('31번 흰색 대형').orders).toEqual([{ no: 31, options: { 색상: '흰색', 크기: '대형' }, qty: 1 }])
    expect(parse('31 번 흰색 소형').orders).toEqual([{ no: 31, options: { 색상: '흰색', 크기: '소형' }, qty: 1 }])
    expect(parse('31 수건 검정색 소형').orders).toEqual([{ no: 31, options: { 색상: '검정색', 크기: '소형' }, qty: 1 }])
    expect(parse('99 수건 검정색 소형').review).toEqual({ reason: 'UNKNOWN_WORD', no: 31 })
    // 다섯 자리는 번호가 아니고, 붙여 쓴 번호는 맨 앞 번호가 아니다 — 옵션 상품 이름 + 남은 말 한 덩어리
    expect(parse('12345 수건').review).toEqual({ reason: 'UNKNOWN_WORD', no: 31 })
    expect(parse('31번수건').review).toEqual({ reason: 'UNKNOWN_WORD', no: 31 })
  })
})
