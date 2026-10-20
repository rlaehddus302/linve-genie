// 글 계산·다듬기·입력 검사 (AC-P1-02·03·04·05, L-2~L-4, L-10). 골든 밖의 경계와 문장을 본다.
import { describe, expect, it } from 'vitest'
import {
  NO_NAME,
  checkProductData,
  computePackingText,
  computeProductText,
  defaultTemplate,
  formatLabelPrice,
  labelContentKey,
  trimLabelText,
  type LabelBuyer,
} from '../src/index.ts'
import { formatWon } from '@livejjim/core'
import { SAMPLE_PACKING, SAMPLE_PRODUCT } from './helpers.ts'

describe('상품 라벨 글 (AC-P1-02)', () => {
  it('판매자 샘플: 가게 이름 다육농장 → 머리글, 번호·가격(천원)·날짜·품종·닉네임', () => {
    const r = computeProductText({ ...defaultTemplate('product'), shopName: '다육농장' }, SAMPLE_PRODUCT)
    expect(r.ok && r.text.items).toStrictEqual({ shop: '다육농장', number: '194', price: '8 천원', date: '26.10.08', name: '왕비뇌신금', buyer: '우주천사' })
  })

  it('원 표기는 코어 formatWon과 같다, 천원 표기는 1,000의 배수이고 0보다 클 때만', () => {
    for (const price of [0, 1, 500, 999, 1000, 1001, 8000, 8500, 150000, 1234000, 1234567, 99999999, 100000000]) {
      expect(formatLabelPrice(price, 'WON')).toBe(formatWon(price))
      const thousand = formatLabelPrice(price, 'THOUSAND')
      if (price > 0 && price % 1000 === 0) expect(thousand).toMatch(/^[\d,]+ 천원$/)
      else expect(thousand).toBe(formatWon(price))
      expect(thousand).not.toMatch(/\d\.\d/)
    }
    expect(formatLabelPrice(99999000, 'THOUSAND')).toBe('99,999 천원')
  })

  it('빈 가게 이름·머리글 끄기면 머리글이 없다, 빈 품종은 빈 값', () => {
    const r1 = computeProductText(defaultTemplate('product'), { ...SAMPLE_PRODUCT, name: '' })
    expect(r1.ok && r1.text.items).toStrictEqual({ number: '194', price: '8 천원', date: '26.10.08', name: '', buyer: '우주천사' })
    const t = defaultTemplate('product')
    const off = { ...t, shopName: '다육농장', items: { ...t.items, shop: { ...t.items.shop, visible: false } } }
    const r2 = computeProductText(off, SAMPLE_PRODUCT)
    expect(r2.ok && 'shop' in r2.text.items).toBe(false)
  })

  it('날짜는 받은 글자만 바꾼다 — 실행 환경 시간대와 상관없다', () => {
    const before = process.env.TZ
    const results = ['Pacific/Kiritimati', 'Pacific/Honolulu', 'Asia/Seoul', 'UTC'].map((tz) => {
      process.env.TZ = tz
      const r = computeProductText(defaultTemplate('product'), { ...SAMPLE_PRODUCT, date: '2026-12-31' })
      return r.ok ? r.text.items.date : undefined
    })
    process.env.TZ = before
    expect(new Set(results)).toEqual(new Set(['26.12.31']))
  })
})

describe('글 다듬기 (AC-P1-03, L-2)', () => {
  it('네 단계를 이 순서로: NFC → 제어 문자·줄 구분자는 공백 → 서식 문자 지움 → 공백 줄이기·앞뒤 지움', () => {
    expect(trimLabelText('  우주\n천사\t')).toBe('우주 천사')
    expect(trimLabelText('왕비‮뇌신금')).toBe('왕비뇌신금')
    expect(trimLabelText('﻿우주​천사')).toBe('우주천사')
    expect(trimLabelText('우주')).toBe('우주')
    expect(trimLabelText('a b c')).toBe('a b c')
    expect(trimLabelText('a　 b')).toBe('a b')
    expect(trimLabelText('👩‍🌾농부')).toBe('👩🌾농부')
    // 제어 문자는 공백이 된 뒤 줄여진다 (지워지지 않는다)
    expect(trimLabelText('a\u0000b')).toBe('a b')
    // 서식 문자는 공백이 되지 않고 지워진다
    expect(trimLabelText('a​b')).toBe('ab')
    expect(trimLabelText('​  ')).toBe('')
  })

  it('이모지는 지우지 않는다', () => {
    expect(trimLabelText('다육이맘🌵')).toBe('다육이맘🌵')
  })

  it('다듬어 빈 닉네임은 "이름 없음", 빈 방송 제목은 "제목 없음"', () => {
    const r = computeProductText(defaultTemplate('product'), { ...SAMPLE_PRODUCT, buyer: { kind: 'youtube', name: '​ \n' } })
    expect(r.ok && r.text.items.buyer).toBe(NO_NAME)
    const p = computePackingText(defaultTemplate('packing'), {
      ...SAMPLE_PACKING,
      broadcasts: [
        { title: '‎', numbers: [1] },
        { title: '2부', numbers: [2] },
      ],
    })
    expect(p.ok && p.text.pages.map((x) => x.broadcast)).toEqual(['제목 없음', '2부'])
  })
})

describe('라벨 데이터 입력 검사 (AC-P1-04)', () => {
  const bad: [string, unknown, string][] = [
    ['문자찜 메모', { ...SAMPLE_PRODUCT, buyer: { kind: 'sms', memo: '김영희 010-1234-5678' } }, 'buyer.memo'],
    ['문자찜 뒤 4자리', { ...SAMPLE_PRODUCT, buyer: { kind: 'sms', phoneLast4: '5678' } }, 'buyer.phoneLast4'],
    ['문자찜 이름', { ...SAMPLE_PRODUCT, buyer: { kind: 'sms', name: '문자찜(김영희)' } }, 'buyer.name'],
    ['유튜브 구매자 메모', { ...SAMPLE_PRODUCT, buyer: { kind: 'youtube', name: 'a', memo: 'x' } }, 'buyer.memo'],
    ['맨 위 메모', { ...SAMPLE_PRODUCT, memo: '010 빼고' }, 'memo'],
    ['번호 0', { ...SAMPLE_PRODUCT, no: 0 }, 'no'],
    ['번호 10000', { ...SAMPLE_PRODUCT, no: 10000 }, 'no'],
    ['번호 소수', { ...SAMPLE_PRODUCT, no: 1.5 }, 'no'],
    ['번호 글자', { ...SAMPLE_PRODUCT, no: '15' }, 'no'],
    ['번호 NaN', { ...SAMPLE_PRODUCT, no: Number.NaN }, 'no'],
    ['가격 음수', { ...SAMPLE_PRODUCT, price: -1 }, 'price'],
    ['가격 소수', { ...SAMPLE_PRODUCT, price: 1.5 }, 'price'],
    ['가격 2^53', { ...SAMPLE_PRODUCT, price: 2 ** 53 }, 'price'],
    ['가격 Infinity', { ...SAMPLE_PRODUCT, price: Number.POSITIVE_INFINITY }, 'price'],
    ['없는 날짜', { ...SAMPLE_PRODUCT, date: '2026-02-29' }, 'date'],
    ['13월', { ...SAMPLE_PRODUCT, date: '2026-13-01' }, 'date'],
    ['다른 형식 날짜', { ...SAMPLE_PRODUCT, date: '2026/10/08' }, 'date'],
    ['전각 숫자 날짜', { ...SAMPLE_PRODUCT, date: '２０２６-10-08' }, 'date'],
    ['모르는 구매자 종류', { ...SAMPLE_PRODUCT, buyer: { kind: 'manual', name: '김영희' } }, 'buyer.kind'],
    ['품종 빠짐', { no: 1, price: 1, date: '2026-10-08', buyer: { kind: 'sms' } }, 'name'],
    ['품종 글자 아님', { ...SAMPLE_PRODUCT, name: 15 }, 'name'],
    ['데이터가 목록', [SAMPLE_PRODUCT], ''],
    ['데이터가 null', null, ''],
  ]
  for (const [title, data, field] of bad) {
    it(`${title} → INVALID_DATA(${field || '데이터'})와 쉬운 한국어 문장, 글을 만들지 않는다`, () => {
      const r = computeProductText(defaultTemplate('product'), data)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.code).toBe('INVALID_DATA')
      expect(r.error.field).toBe(field)
      expect(r.error.message).toMatch(/^라벨에 넣을 수 없는 값이 있어요: [가-힣 ]+$/)
      // 오류에는 값이 담기지 않는다 (메모·전화번호가 새지 않게)
      expect(JSON.stringify(r.error)).not.toMatch(/김영희|010|5678/)
    })
  }

  it('예시 문장 "라벨에 넣을 수 없는 값이 있어요: 번호"', () => {
    const r = computeProductText(defaultTemplate('product'), { ...SAMPLE_PRODUCT, no: 0 })
    expect(!r.ok && r.error.message).toBe('라벨에 넣을 수 없는 값이 있어요: 번호')
  })

  it('포장 라벨: 빈 방송 목록·빈 번호 목록·겹친 번호·배송비 칸·문자찜 메모는 INVALID_DATA', () => {
    const cases: unknown[] = [
      { ...SAMPLE_PACKING, broadcasts: [] },
      { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers: [] }] },
      { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers: [3, 3] }] },
      { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers: [3], memo: 'x' }] },
      { ...SAMPLE_PACKING, broadcasts: [{ numbers: [3] }] },
      { ...SAMPLE_PACKING, total: 14000 },
      { ...SAMPLE_PACKING, shipping: 4000 },
      { ...SAMPLE_PACKING, buyer: { kind: 'sms', memo: '김영희' } },
      { ...SAMPLE_PACKING, subtotal: 1.5 },
    ]
    for (const data of cases) {
      const r = computePackingText(defaultTemplate('packing'), data)
      expect(r.ok, JSON.stringify(data)).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_DATA')
    }
  })

  it('받은 데이터를 바꾸지 않는다 (얼린 데이터로도 돈다)', () => {
    const data = Object.freeze({ ...SAMPLE_PACKING, broadcasts: Object.freeze([Object.freeze({ title: '1부', numbers: Object.freeze([31, 15, 28]) })]) })
    const r = computePackingText(defaultTemplate('packing'), data)
    expect(r.ok).toBe(true)
    expect(data.broadcasts[0]?.numbers).toEqual([31, 15, 28])
  })

  it('문자찜 구매자 타입에는 메모·전화번호 칸이 없다 (TypeScript)', () => {
    const ok: LabelBuyer = { kind: 'sms' }
    // @ts-expect-error -- 문자찜 구매자는 kind 하나뿐이다 (AC-P1-04)
    const withMemo: LabelBuyer = { kind: 'sms', memo: '김영희' }
    expect(checkProductData({ ...SAMPLE_PRODUCT, buyer: ok }).ok).toBe(true)
    expect(checkProductData({ ...SAMPLE_PRODUCT, buyer: withMemo }).ok).toBe(false)
  })
})

describe('포장 라벨 쪽 나누기 (AC-P1-05)', () => {
  it('같은 날 1부(12·3)·2부(40)·3부(7), 상품 합계 45,000', () => {
    const r = computePackingText(defaultTemplate('packing'), {
      date: '2026-10-18',
      buyer: { kind: 'youtube', name: '우주천사' },
      broadcasts: [
        { title: '1부', numbers: [12, 3] },
        { title: '2부', numbers: [40] },
        { title: '3부', numbers: [7] },
      ],
      subtotal: 45000,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text.pages).toEqual([
      { page: '1/3', broadcast: '1부', numbers: [3, 12] },
      { page: '2/3', broadcast: '2부', numbers: [40] },
      { page: '3/3', broadcast: '3부', numbers: [7] },
    ])
    expect(r.text.common).toEqual({ date: '26.10.18', buyer: '우주천사', count: '4', subtotal: '45,000원' })
  })

  it('번호 200개를 perPage 7로: 쪽마다 빠지거나 겹치지 않고 합이 같다', () => {
    const numbers = Array.from({ length: 200 }, (_, i) => 9999 - i * 3)
    const r = computePackingText({ ...defaultTemplate('packing'), perPage: 7 }, { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const all = r.text.pages.flatMap((p) => p.numbers)
    expect(all).toEqual([...numbers].sort((a, b) => a - b))
    expect(r.text.pages).toHaveLength(Math.ceil(200 / 7))
    expect(r.text.pages.every((p) => p.numbers.length <= 7)).toBe(true)
    expect(r.text.common.count).toBe('200')
  })
})

describe('내용 키 (L-10, AC-P1-55 재료)', () => {
  it('같은 값이면 같은 키, 다듬으면 같은 글이면 같은 키, 템플릿과 상관없다', () => {
    const a = labelContentKey('product', SAMPLE_PRODUCT)
    const b = labelContentKey('product', { ...SAMPLE_PRODUCT, name: '왕비뇌신금 ' })
    expect(a.ok && b.ok && a.key === b.key).toBe(true)
    for (const changed of [{ no: 195 }, { name: '핑크프릴' }, { price: 8001 }, { date: '2026-10-09' }, { buyer: { kind: 'sms' } }, { buyer: { kind: 'youtube', name: '다른사람' } }]) {
      const c = labelContentKey('product', { ...SAMPLE_PRODUCT, ...changed })
      expect(c.ok && a.ok && c.key !== a.key, JSON.stringify(changed)).toBe(true)
    }
    const p1 = labelContentKey('packing', SAMPLE_PACKING)
    const p2 = labelContentKey('packing', { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers: [15, 28, 31] }] })
    expect(p1.ok && p2.ok && p1.key === p2.key).toBe(true)
    expect(labelContentKey('product', { ...SAMPLE_PRODUCT, memo: 'x' }).ok).toBe(false)
  })
})
