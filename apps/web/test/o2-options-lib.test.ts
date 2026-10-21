// O2 화면 도우미 단위 시험 (AC-O2-12·13·14·15·33·34·36·38·52, D-O2-04·06·07·12) — 템플릿 데이터·칸 검사·변형 재고 표·미리 채움·후보 제안·결과 낱말.
import { checkEvent, compareChars, type ReviewReason } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { OPTION_TEMPLATES } from '../src/lib/option-templates.ts'
import {
  KEPT_WORDS,
  OPTION_WORDS,
  checkDraft,
  editDistance,
  emptyChoice,
  itemDraftOf,
  optionSummary,
  outcomeOf,
  pickFor,
  prefillOf,
  readQty,
  remainingOf,
  suggestionsFor,
  type ItemDraft,
  type OptionDraft,
} from '../src/lib/options.ts'
import { claimWord, waitPosition } from '../src/lib/derive.ts'
import { CHAT_REVIEW_WORD, REJECT_REASON_WORD, REVIEW_REASON_WORD, SALE_MODE_CHOICE, saleModeOf } from '../src/lib/words.ts'
import { chat, dataOf, run } from './engine.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const

const item = (name: string, ...labels: string[]): ItemDraft => ({ name, choices: labels.map((label) => ({ ...emptyChoice(), label })) })
const draft = (items: ItemDraft[], patch: Partial<OptionDraft> = {}): OptionDraft => ({ items, aliases: '', stocks: {}, ...patch })

describe('업종 템플릿 (AC-O2-12, D-O2-04)', () => {
  it('업종 묶음 넷과 D-O2-04 표의 항목 이름', () => {
    expect(OPTION_TEMPLATES.map((group) => group.group)).toEqual(['의류', '휴대폰 케이스', '식품', '화분'])
    expect(OPTION_TEMPLATES.flatMap((group) => group.templates.map((template) => template.title))).toEqual(['사이즈', '사이즈(숫자)', '색상', '기종', '중량', '용량', '맛', '호수'])
    const pots = OPTION_TEMPLATES.find((group) => group.group === '화분')?.templates[0]?.item
    expect(pots?.name).toBe('호수')
    expect(pots?.choices.map((choice) => choice.label)).toEqual(['1호', '2호', '3호', '4호', '5호', '6호', '7호', '8호', '9호', '10호'])
    const phone = OPTION_TEMPLATES.find((group) => group.group === '휴대폰 케이스')?.templates[0]?.item
    expect(phone?.choices.find((choice) => choice.label === '아이폰 17 프로')?.aliases).toEqual(['17프로'])
  })

  it('템플릿마다 엔진의 R-19 모양 검사를 통과하고(옵션 방송 상품 등록), 템플릿 안에 비교 글자 겹침이 없다', () => {
    const { state } = run([], OPTIONS)
    for (const group of OPTION_TEMPLATES) {
      for (const template of group.templates) {
        const event = { type: 'product.register', b: 'b1', no: 1, name: '시험', price: 10000, options: [template.item], seq: 1, at: 0 }
        expect(checkEvent(state, event), `${group.group} — ${template.title}`).toEqual([])
        const words = template.item.choices.flatMap((choice) => [choice.label, ...(choice.aliases ?? [])].map(compareChars))
        expect(new Set(words).size, template.title).toBe(words.length)
        // 화면 검사도 문제 없음
        expect(checkDraft(draft([itemDraftOf(template.item)]), 10000).problems.size, template.title).toBe(0)
      }
    }
  })

  it('같은 항목 이름의 두 템플릿(사이즈·사이즈(숫자))을 함께 고르면 막힌다', () => {
    const [size, sizeNumber] = OPTION_TEMPLATES[0]?.templates ?? []
    if (size === undefined || sizeNumber === undefined) throw new Error('템플릿')
    const check = checkDraft(draft([itemDraftOf(size.item), itemDraftOf(sizeNumber.item)]), 10000)
    expect(check.payload).toBeNull()
    expect(check.problems.get('items.1.name')).toBe(OPTION_WORDS.itemNameSame)
  })
})

describe('바로 알림 — 겹침·한도·모양 (AC-O2-13, D-O2-06)', () => {
  it('선택지 M과 다른 선택지의 별칭 m — 두 자리를 말한다, 고치면 사라진다', () => {
    const choices = [{ label: 'S', aliases: '', price: '' }, { label: 'M', aliases: '', price: '' }, { label: 'L', aliases: 'm', price: '' }]
    const items: ItemDraft[] = [{ name: '사이즈', choices }]
    const check = checkDraft(draft(items), 15000)
    expect(check.problems.get('items.0.choices.2.aliases')).toBe('‘m’이 사이즈 M과 사이즈 L에 함께 있어요')
    expect(check.payload).toBeNull()
    const fixed = checkDraft(draft([{ name: '사이즈', choices: choices.map((choice) => ({ ...choice, aliases: '' })) }]), 15000)
    expect(fixed.problems.size).toBe(0)
    expect(fixed.payload).not.toBeNull()
  })

  it('S와 "s "(공백)도 겹침이다', () => {
    const check = checkDraft(draft([item('사이즈', 'S', 's ')]), 1000)
    expect(check.problems.get('items.0.choices.1.label')).toMatch(/^‘s’이 사이즈 S와 사이즈 s에 함께 있어요$/)
  })

  it('이름의 / · #, 21자 이름, 선택지 21개, 변형 101개, 가격 차이 1.5·1,000,001', () => {
    expect(checkDraft(draft([item('사이즈', 'S/M')]), 1000).problems.get('items.0.choices.0.label')).toBe(OPTION_WORDS.word)
    expect(checkDraft(draft([item('사이즈', '#1')]), 1000).problems.get('items.0.choices.0.label')).toBe(OPTION_WORDS.word)
    expect(checkDraft(draft([item('사이즈', 'ㄱ'.repeat(21))]), 1000).problems.get('items.0.choices.0.label')).toBe(OPTION_WORDS.word)
    expect(checkDraft(draft([item('ㄱ'.repeat(11), 'S')]), 1000).problems.get('items.0.name')).toBe(OPTION_WORDS.itemName)
    const many = Array.from({ length: 21 }, (_, i) => `c${String(i)}`)
    expect(checkDraft(draft([item('사이즈', ...many)]), 1000).problems.get('items.0.choices')).toBe(OPTION_WORDS.choiceCount)
    const eleven = Array.from({ length: 11 }, (_, i) => `a${String(i)}`)
    const ten = Array.from({ length: 10 }, (_, i) => `b${String(i)}`)
    expect(checkDraft(draft([item('가', ...eleven), item('나', ...ten)]), 1000).problems.get('items')).toBe(OPTION_WORDS.variants)
    expect(checkDraft(draft([item('가', ...ten), item('나', ...ten.map((label) => `${label}x`))]), 1000).problems.size).toBe(0)
    const priced = (price: string) => checkDraft(draft([{ name: '사이즈', choices: [{ label: 'S', aliases: '', price }] }]), 10000).problems.get('items.0.choices.0.price')
    expect(priced('1.5')).toBe(OPTION_WORDS.price)
    expect(priced('1,000,001')).toBe(OPTION_WORDS.price)
    expect(priced('1,000,000')).toBeUndefined()
    expect(priced('-2000')).toBeUndefined()
    expect(checkDraft(draft([item('a', 'x'), item('b', 'y'), item('c', 'z'), item('d', 'w')]), 1000).problems.get('items')).toBe(OPTION_WORDS.tooManyItems)
  })

  it('상품 별칭 11개째는 막힌다', () => {
    const aliases = Array.from({ length: 11 }, (_, i) => `별칭${String(i)}`).join(', ')
    expect(checkDraft(draft([], { aliases }), 1000).problems.get('aliases')).toBe(OPTION_WORDS.productAliases)
    expect(checkDraft(draft([], { aliases: '초코과자, 초코' }), 1000).payload?.aliases).toEqual(['초코과자', '초코'])
  })
})

describe('변형 재고 표·단가 (AC-O2-14·15)', () => {
  it('항목 순서의 행 4개, 처음 값 1, 0이면 처음부터 품절, 보낼 stocks', () => {
    const base = draft([item('색상', '흰색', '검정색'), item('크기', '대형', '소형')])
    const first = checkDraft(base, 10000)
    expect(first.rows.map((row) => [row.text, row.stock])).toEqual([
      ['흰색/대형', '1'],
      ['흰색/소형', '1'],
      ['검정색/대형', '1'],
      ['검정색/소형', '1'],
    ])
    const filled = checkDraft({ ...base, stocks: { '흰색/대형': '3', '흰색/소형': '3', '검정색/대형': '3', '검정색/소형': '0' } }, 10000)
    expect(filled.rows.find((row) => row.text === '검정색/소형')?.soldOut).toBe(true)
    expect(filled.payload?.stocks).toEqual({ '흰색/대형': 3, '흰색/소형': 3, '검정색/대형': 3, '검정색/소형': 0 })
    expect(checkDraft({ ...base, stocks: { '흰색/대형': '1.5' } }, 10000).problems.get('stocks.흰색/대형')).toBe(OPTION_WORDS.stock)
  })

  it('가격 차이로 행마다 단가, 0원 아래면 그 행을 알린다', () => {
    const sizes: ItemDraft = { name: '사이즈', choices: [{ label: '100', aliases: '', price: '' }, { label: '105', aliases: '', price: '2000' }] }
    expect(checkDraft(draft([sizes]), 15000).rows.map((row) => [row.text, row.unitPrice])).toEqual([
      ['100', 15000],
      ['105', 17000],
    ])
    const cheap: ItemDraft = { name: '사이즈', choices: [{ label: '100', aliases: '', price: '-20000' }] }
    expect(checkDraft(draft([cheap]), 15000).problems.get('unit.100')).toBe(OPTION_WORDS.unitPrice)
  })

  it('요약 글', () => {
    expect(optionSummary([{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }])).toBe('옵션: 사이즈 S/M/L · 변형 3개')
  })
})

describe('확인 필요 한 줄 (AC-O2-33·34·38, D-O2-07)', () => {
  const shorts = { name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }, { label: 'XL' }] }
  const product = { key: 'b1/21', name: '반바지', aliases: [] as string[], options: [shorts] }

  it('미리 채움은 읽은 것만 — 수량을 읽지 않았으면 빈 칸, 선택지 하나뿐인 항목은 그 값', () => {
    const products = new Map([['b1/21', product]])
    expect(prefillOf({ broadcast: 'b1', product: 'b1/21', no: 21, options: null, qty: null }, products)).toEqual({ product: 'b1/21', options: {}, qty: '' })
    expect(prefillOf({ broadcast: 'b1', product: 'b1/21', no: 21, options: [['사이즈', 'L']], qty: 3 }, products)).toEqual({ product: 'b1/21', options: { 사이즈: 'L' }, qty: '3' })
    expect(prefillOf({ broadcast: 'b1', product: null, no: null, options: null, qty: null }, products)).toEqual({ product: '', options: {}, qty: '' })
    expect(pickFor({ options: [{ name: '색', choices: [{ label: '흰색' }] }, shorts] }, [])).toEqual({ 색: '흰색' })
  })

  it('후보 제안: 편집 거리 1, 많아야 3개, 한 글자 낱말은 제안 없음 — 칸만 채운다(보내지 않는다)', () => {
    expect(editDistance('xll', 'xl')).toBe(1)
    expect(suggestionsFor('반바지 XLL', product)).toEqual([{ item: '사이즈', label: 'XL' }])
    expect(suggestionsFor('반바지 X', product)).toEqual([])
    const wide = { ...product, options: [{ name: '사이즈', choices: ['AB', 'AC', 'AD', 'AE'].map((label) => ({ label })) }] }
    expect(suggestionsFor('AA', wide)).toHaveLength(3)
  })

  it('수량 칸은 1~최대 정수', () => {
    expect(readQty('', 10)).toBeNull()
    expect(readQty('0', 10)).toBeNull()
    expect(readQty('11', 10)).toBeNull()
    expect(readQty('3', 10)).toBe(3)
  })

  it('보낸 결과: 1등·대기 n번·품절, 아무 일도 없으면 까닭 (판매 중 아님 → 같은 옵션 이미 찜 → 남은 수량 부족)', () => {
    const events = [
      { type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 15000, options: [shorts], stocks: { L: 2 } },
      chat('m1', 'UC_a', '홍길동', '반바지 M'),
      chat('m2', 'UC_b', '박민수', '반바지 M'),
    ]
    const data = dataOf(events, OPTIONS)
    const p = data.products.get('b1/21')
    if (p === undefined) throw new Error('상품')
    expect(outcomeOf(true, { product: 'b1/21', variant: 'M', qty: 1, buyer: 'UC_a' }, p)).toEqual({ kind: 'claimed', word: '1등' })
    expect(outcomeOf(true, { product: 'b1/21', variant: 'M', qty: 1, buyer: 'UC_b' }, p)).toEqual({ kind: 'claimed', word: '대기 1번' })
    expect(outcomeOf(true, { product: 'b1/21', variant: 'S', qty: 1, buyer: 'UC_z' }, p)).toEqual({ kind: 'claimed', word: '품절' })
    expect(outcomeOf(false, { product: 'b1/21', variant: 'M', qty: 1, buyer: 'UC_a' }, p)).toEqual({ kind: 'kept', word: KEPT_WORDS.already })
    expect(outcomeOf(false, { product: 'b1/21', variant: 'L', qty: 3, buyer: 'UC_z' }, p)).toEqual({ kind: 'kept', word: KEPT_WORDS.stock })
    expect(outcomeOf(false, { product: 'b1/21', variant: 'L', qty: 1, buyer: 'UC_z' }, { ...p, status: 'HOLD' })).toEqual({ kind: 'kept', word: KEPT_WORDS.notOnSale })
    expect(remainingOf(p, { 사이즈: 'L' })).toBe(2)
    expect(remainingOf(p, {})).toBeNull()
    // 변형 대기 순번 (대기 n번)
    const waiting = [...data.claims.values()].find((claim) => claim.currentBuyer === 'UC_b')
    if (waiting === undefined) throw new Error('찜')
    expect(waitPosition(data, waiting)).toBe(1)
    expect(claimWord(data, waiting)).toBe('대기 1번')
  })
})

describe('화면 낱말 (AC-O2-52, D-O2-12)', () => {
  it('확인 필요 사유 9개 전체와 거절 사유 OPTION_MISSING', () => {
    const reasons: Record<ReviewReason, string> = {
      OPTION_MISSING: '옵션 빠짐',
      OPTION_CONFLICT: '옵션이 둘',
      UNKNOWN_WORD: '모르는 말',
      QTY_INVALID: '수량 확인',
      NUMBER_AMBIGUOUS: '숫자가 애매함',
      PRODUCT_AMBIGUOUS: '상품이 애매함',
      MULTI_PRODUCT: '상품이 여럿',
      FOCUS_CHANGED: '지금 상품이 막 바뀜',
      STOCK_SHORT: '남은 수량 부족',
    }
    expect(REVIEW_REASON_WORD).toEqual(reasons)
    expect(REJECT_REASON_WORD.OPTION_MISSING).toBe('옵션 빠짐')
    expect(CHAT_REVIEW_WORD).toBe('확인 필요')
    for (const word of [...Object.values(REVIEW_REASON_WORD), ...Object.values(SALE_MODE_CHOICE)]) expect(word).not.toMatch(/[A-Z_]{4,}/)
  })

  it('판매 방식: OPTIONS면 상품명·옵션도 받기, 그 밖(STRICT·LOOSE)은 번호로만 받기', () => {
    expect(saleModeOf({ 'claim.parseMode': 'OPTIONS' })).toBe('OPTIONS')
    expect(saleModeOf({ 'claim.parseMode': 'LOOSE' })).toBe('NUMBERS')
    expect(SALE_MODE_CHOICE).toEqual({ NUMBERS: '번호로만 받기 (다육 등 — 기본)', OPTIONS: '상품명·옵션도 받기 (의류·식품·케이스 등)' })
  })
})
