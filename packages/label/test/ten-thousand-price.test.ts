// 만원 단위 가격 표기 (D-UX4-07, 사용자 지시 2026-11-03 라벨 예시 "가격: 30만원"): priceStyle TEN_THOUSAND.
// 1,000의 배수면 만·천 단위(`30만원`·`3만 5천원`·`8천원`), 아니면 원 표기. 가장 넓은 값도 모든 크기의 기본 템플릿에 들어간다.
import { describe, expect, it } from 'vitest'
import {
  ALL_LABEL_SIZES,
  PRICE_STYLES,
  SAMPLE_PRODUCT,
  computeProductText,
  defaultTemplate,
  formatLabelPrice,
  formatLabelPriceWithQty,
  renderProductLabel,
  validateTemplate,
} from '../src/index.ts'
import { expectCleanLayout, nodeEnv } from './helpers.ts'

describe('TEN_THOUSAND(만원) 가격 표기', () => {
  it('만·천 단위, 소수·0·천 원 아래는 원 표기', () => {
    expect(formatLabelPrice(300_000, 'TEN_THOUSAND')).toBe('30만원')
    expect(formatLabelPrice(35_000, 'TEN_THOUSAND')).toBe('3만 5천원')
    expect(formatLabelPrice(8_000, 'TEN_THOUSAND')).toBe('8천원')
    expect(formatLabelPrice(10_000, 'TEN_THOUSAND')).toBe('1만원')
    expect(formatLabelPrice(12_340_000, 'TEN_THOUSAND')).toBe('1,234만원')
    expect(formatLabelPrice(99_999_000, 'TEN_THOUSAND')).toBe('9,999만 9천원')
    expect(formatLabelPrice(8_500, 'TEN_THOUSAND')).toBe('8,500원')
    expect(formatLabelPrice(500, 'TEN_THOUSAND')).toBe('500원')
    expect(formatLabelPrice(0, 'TEN_THOUSAND')).toBe('0원')
    expect(formatLabelPriceWithQty(60_000, 'TEN_THOUSAND', 2)).toBe('2개 6만원')
  })

  it('옛 표기는 그대로 (THOUSAND·WON)', () => {
    expect(formatLabelPrice(300_000, 'THOUSAND')).toBe('300 천원')
    expect(formatLabelPrice(300_000, 'WON')).toBe('300,000원')
    expect([...PRICE_STYLES]).toEqual(['THOUSAND', 'WON', 'TEN_THOUSAND'])
  })

  it('템플릿 검사가 TEN_THOUSAND를 받는다, 모르는 표기(골든 G-LBL-028의 MAN)는 그대로 거절', () => {
    expect(validateTemplate({ ...defaultTemplate('product'), priceStyle: 'TEN_THOUSAND' }).ok).toBe(true)
    expect(validateTemplate({ ...defaultTemplate('product'), priceStyle: 'MAN' }).ok).toBe(false)
  })

  it('견본 값은 앱 예시와 같다 (365번 · 삼광색금 · 30만원 · 지니다육)', () => {
    const r = computeProductText({ ...defaultTemplate('product'), shopName: '라이브다육', priceStyle: 'TEN_THOUSAND' }, SAMPLE_PRODUCT)
    expect(r.ok && r.text.items).toMatchObject({ shop: '라이브다육', number: '365', price: '30만원', date: '26.11.03', name: '삼광색금', buyer: '지니다육' })
  })

  it('가장 넓은 만원 표기(번호 9999 · 9,999만 9천원)도 모든 크기의 기본 템플릿에 20점 이상으로 깨끗이 들어간다', () => {
    const env = nodeEnv()
    for (const size of ALL_LABEL_SIZES) {
      const r = renderProductLabel(env, { ...defaultTemplate('product', size), priceStyle: 'TEN_THOUSAND', shopName: '다육농장' }, { ...SAMPLE_PRODUCT, no: 9999, price: 99_999_000 })
      expect(r.ok, size).toBe(true)
      if (!r.ok) continue
      expect(r.layout.items.find((item) => item.id === 'price')?.value, size).toBe('9,999만 9천원')
      expectCleanLayout(r.image, r.layout)
    }
  })
})
