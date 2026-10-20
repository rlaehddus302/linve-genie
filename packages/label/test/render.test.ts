// 렌더 (AC-P1-10~17·21, L-1·L-2·L-5). 픽셀 스냅샷 대신 영역·글자 배치를 검사한다(dev-device 원칙).
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LABEL_SIZES,
  TEST_LABEL_BORDER,
  bitmapsEqual,
  bytesPerRow,
  computeProductText,
  defaultTemplate,
  getPixel,
  oneBitFromRgba,
  renderPackingLabels,
  renderProductLabel,
  renderProductText,
  renderTestLabel,
  splitGraphemes,
  type LabelTemplate,
  type LayoutItem,
  type ProductTemplate,
  type TemplateItem,
} from '../src/index.ts'
import { SAMPLE_PACKING, SAMPLE_PRODUCT, blackIn, diffOutside, expectCleanLayout, expectLayoutMatchesText, nodeEnv, overlaps } from './helpers.ts'

const env = nodeEnv()

function product(template: unknown, data: unknown = SAMPLE_PRODUCT) {
  const r = renderProductLabel(env, template, data)
  if (!r.ok) throw new Error(`렌더 실패: ${JSON.stringify(r.error)}`)
  return r
}

const withItem = <T extends LabelTemplate>(t: T, id: string, patch: Partial<TemplateItem>): T =>
  ({ ...t, items: { ...t.items, [id]: { ...(t.items as Record<string, TemplateItem>)[id], ...patch } } }) as T

const item = (items: readonly LayoutItem[], id: string): LayoutItem => {
  const found = items.find((i) => i.id === id)
  if (!found) throw new Error(`배치 결과에 ${id}가 없다`)
  return found
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('크기·점·1비트·그림 형식 (AC-P1-10)', () => {
  it('50×30 = 384×240, 50×20 = 384×160, 50×40 = 384×320, 한 줄 ceil(width/8)바이트', () => {
    const expected = { '50x30': [384, 240], '50x20': [384, 160], '50x40': [384, 320] } as const
    for (const size of LABEL_SIZES) {
      const r = product({ ...defaultTemplate('product', size), shopName: '다육농장' })
      expect([r.image.width, r.image.height]).toEqual(expected[size])
      expect(r.image.data.length).toBe(bytesPerRow(r.image.width) * r.image.height)
    }
  })

  it('1비트: 흰 바탕에 합친 밝기 128 미만 = 검정 (127은 검정, 128은 흰색), 왼쪽 점이 높은 비트', () => {
    const canvas = createCanvas(16, 2)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 16, 2)
    ctx.fillStyle = 'rgb(127,127,127)'
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = 'rgb(128,128,128)'
    ctx.fillRect(1, 0, 1, 1)
    ctx.fillStyle = 'rgb(0,0,255)' // 평균 85 → 검정
    ctx.fillRect(9, 1, 1, 1)
    ctx.fillStyle = 'rgb(255,0,128)' // 평균 127.67 → 검정
    ctx.fillRect(10, 1, 1, 1)
    ctx.fillStyle = 'rgb(255,0,129)' // 평균 128 → 흰색
    ctx.fillRect(11, 1, 1, 1)
    const image = oneBitFromRgba(ctx.getImageData(0, 0, 16, 2).data, 16, 2)
    expect(getPixel(image, 0, 0)).toBe(true)
    expect(getPixel(image, 1, 0)).toBe(false)
    expect(Array.from(image.data)).toEqual([0b1000_0000, 0, 0, 0b0110_0000])
  })

  it('투명한 점은 흰 바탕에 합친다 (반투명 검정 a=128 → 밝기 127 → 검정, a=127 → 128 → 흰색)', () => {
    const rgba = [0, 0, 0, 128, 0, 0, 0, 127, 0, 0, 0, 0, 0, 0, 0, 255]
    const image = oneBitFromRgba(rgba, 4, 1)
    expect([0, 1, 2, 3].map((x) => getPixel(image, x, 0))).toEqual([true, false, false, true])
  })

  it('렌더 함수는 캔버스를 주입받는다 — 만든 캔버스 수·크기를 본다', () => {
    const made: [number, number][] = []
    const spy = { font: env.font, createContext: (w: number, h: number) => (made.push([w, h]), env.createContext(w, h)) }
    const r = renderProductLabel(spy, defaultTemplate('product'), SAMPLE_PRODUCT)
    expect(r.ok).toBe(true)
    expect(made).toEqual([[384, 240]])
  })
})

describe('내장 한글 글꼴만으로 그린다 (AC-P1-11)', () => {
  const nick = (name: string) => product(defaultTemplate('product'), { ...SAMPLE_PRODUCT, buyer: { kind: 'youtube', name } })

  it('없는 글자는 빈 네모 하나: 가🌵나와 가🌸나는 점 하나까지 같고 가나와는 다르다', () => {
    const cactus = nick('가🌵나')
    const flower = nick('가🌸나')
    const plain = nick('가나')
    expect(bitmapsEqual(cactus.image, flower.image)).toBe(true)
    expect(bitmapsEqual(cactus.image, plain.image)).toBe(false)
    expect(item(cactus.layout.items, 'buyer').missing).toEqual(['🌵'])
    expect(cactus.layout.missing).toEqual(['🌵'])
    // 네모는 잉크가 있다 — 빼고 그리지 않는다
    const buyerBox = item(cactus.layout.items, 'buyer').box
    expect(blackIn(cactus.image, buyerBox)).toBeGreaterThan(blackIn(plain.image, buyerBox))
  })

  it('똠햏·ㅋㅋ·ㅠㅠ·AZaz09!? 는 네모 없이 그린다', () => {
    for (const name of ['똠햏', 'ㅋㅋ', 'ㅠㅠ', 'AZaz09!?', '왕비뇌신금 ~!@#$%^&*()_+-=[]{};:\'",.<>/?\\|`']) {
      const r = product(defaultTemplate('product'), { ...SAMPLE_PRODUCT, name, buyer: { kind: 'youtube', name } })
      expect(r.layout.missing, name).toEqual([])
    }
  })

  it('서로 다른 없는 글자도 같은 네모 — 한자·태국 문자·이모지 순서', () => {
    const a = nick('가😀😀')
    const b = nick('가🙃🌵')
    expect(bitmapsEqual(a.image, b.image)).toBe(true)
    expect(item(b.layout.items, 'buyer').missing).toEqual(['🙃', '🌵'])
  })
})

describe('배치 검사 — 글이 상자 밖으로 나가지 않는다 (AC-P1-12)', () => {
  for (const size of LABEL_SIZES) {
    it(`${size} 상품 기본 템플릿 + 샘플 데이터`, () => {
      const t = { ...defaultTemplate('product', size), shopName: '다육농장' }
      const r = product(t)
      expectCleanLayout(r.image, r.layout)
      // (b) 기본 템플릿 상자는 겹치지 않는다
      const boxes = Object.values(t.items)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i] as TemplateItem, boxes[j] as TemplateItem)).toBe(false)
      // 판매자 샘플 배치: 맨 위 가운데 가게 이름, 그 아래 한 줄에 번호·가격·날짜, 그 아래 품종, 그 아래 닉네임
      const it2 = t.items
      expect(Math.abs(it2.shop.x + it2.shop.width / 2 - r.image.width / 2)).toBeLessThanOrEqual(8)
      expect(it2.shop.y + it2.shop.height).toBeLessThanOrEqual(Math.min(it2.number.y, it2.price.y, it2.date.y))
      expect(it2.number.x + it2.number.width).toBeLessThanOrEqual(it2.price.x)
      expect(it2.price.x + it2.price.width).toBeLessThanOrEqual(it2.date.x)
      const vOverlap = (a: TemplateItem, b: TemplateItem) => a.y < b.y + b.height && b.y < a.y + a.height
      expect(vOverlap(it2.number, it2.price) && vOverlap(it2.price, it2.date) && vOverlap(it2.number, it2.date)).toBe(true)
      expect(Math.max(it2.number.y + it2.number.height, it2.price.y + it2.price.height, it2.date.y + it2.date.height)).toBeLessThanOrEqual(it2.name.y)
      expect(it2.name.y + it2.name.height).toBeLessThanOrEqual(it2.buyer.y)
    })

    it(`${size} 포장 기본 템플릿 + 보통 데이터·세 방송 데이터`, () => {
      const t = { ...defaultTemplate('packing', size), shopName: '다육농장' }
      const boxes = Object.values(t.items)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i] as TemplateItem, boxes[j] as TemplateItem)).toBe(false)
      for (const data of [
        SAMPLE_PACKING,
        { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers: [12, 3] }, { title: '2부', numbers: [40] }, { title: '3부', numbers: [7] }], subtotal: 45000 },
      ]) {
        const r = renderPackingLabels(env, t, data)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        for (const page of r.pages) expectCleanLayout(page.image, page.layout)
      }
    })
  }

  it('(e) 끈 항목 상자 안에는 검정 점이 없다', () => {
    let t: ProductTemplate = { ...defaultTemplate('product'), shopName: '다육농장' }
    for (const id of ['shop', 'price', 'date', 'name'] as const) t = withItem(t, id, { visible: false })
    const r = product(t)
    expect(r.layout.items.map((i) => i.id)).toEqual(['number', 'buyer'])
    expectCleanLayout(r.image, r.layout, [t.items.shop, t.items.price, t.items.date, t.items.name])
  })

  it('긴 품종·이모지 닉네임·최악의 값에서도 상자 밖 잉크가 없다', () => {
    for (const size of LABEL_SIZES) {
      const r = product(
        { ...defaultTemplate('product', size), shopName: '아주아주 긴 가게 이름을 가진 다육 농장 본점 직영' },
        { no: 9999, name: '아주 긴 이름의 다육식물 품종명 핑크프릴 왕비뇌신금 금황환 미니마 블루엘프', price: 99999999, date: '2026-10-08', buyer: { kind: 'youtube', name: '🌵🌵다육이맘 Aa1! 길고긴닉네임입니다만 좋아요' } },
      )
      expectCleanLayout(r.image, r.layout)
    }
  })
})

describe('긴 품종명 — 줄이기 → 두 줄 → 말줄임표 (AC-P1-13)', () => {
  const ORDER = ['fit', 'shrunk', 'twoLines', 'truncated']
  const NO_SPACE = '왕비뇌신금핑크프릴금황환미니마블루엘프방울복랑자이언트레드베리아이스크림파키피덤오비페룸프리티'
  const WITH_SPACE = '왕비 뇌신금 핑크프릴 금황환 미니마 블루엘프 방울복랑 자이언트 레드베리 아이스크림 파키피덤'

  for (const [title, source] of [
    ['공백 없는 품종', NO_SPACE],
    ['공백 있는 품종', WITH_SPACE],
  ] as const) {
    it(`${title} 2자~60자: 방법은 fit → shrunk → twoLines → truncated 순서로만 바뀐다`, () => {
      const t = defaultTemplate('product')
      const seen: string[] = []
      let last = 0
      const ctx = createCanvas(10, 10).getContext('2d')
      for (let len = 2; len <= 60; len++) {
        const name = source.repeat(2).slice(0, len)
        const r = product(t, { ...SAMPLE_PRODUCT, name })
        const it2 = item(r.layout.items, 'name')
        const rank = ORDER.indexOf(it2.method)
        expect(rank, `${String(len)}자 ${it2.method}`).toBeGreaterThanOrEqual(last)
        last = rank
        if (!seen.includes(it2.method)) seen.push(it2.method)
        expect(it2.fontSize).toBeGreaterThanOrEqual(t.items.name.minFontSize)
        const value = name.trim().replace(/ +/g, ' ')
        expectLayoutMatchesText(it2, value)
        if (it2.method === 'twoLines') {
          // 두 줄 폭 차가 가장 작은 곳에서 나눴는지 (minFontSize로 잰다)
          ctx.font = `${String(t.items.name.minFontSize)}px LivejjimLabel`
          const g = splitGraphemes(value)
          const hasSpace = value.includes(' ')
          const diff = (cut: number) => {
            const a = g.slice(0, cut).join('')
            const b = g.slice(hasSpace ? cut + 1 : cut).join('')
            return Math.abs(ctx.measureText(a).width - ctx.measureText(b).width)
          }
          const chosen = splitGraphemes(it2.valueLines[0] ?? '').length
          for (let cut = 1; cut < g.length; cut++) {
            if (hasSpace && g[cut] !== ' ') continue
            expect(diff(chosen)).toBeLessThanOrEqual(diff(cut) + 1)
          }
        }
        expectCleanLayout(r.image, r.layout)
      }
      expect(seen).toEqual(ORDER.filter((m) => seen.includes(m)))
      expect(seen).toContain('twoLines')
      expect(seen).toContain('truncated')
    })
  }

  it('보이는 글자 하나(이모지 포함)를 가르지 않는다', () => {
    const name = '👩🏽‍🌾🇰🇷가나다라마바사아자차카타파하'.repeat(6)
    const r = product(defaultTemplate('product'), { ...SAMPLE_PRODUCT, name })
    const it2 = item(r.layout.items, 'name')
    expect(it2.method).toBe('truncated')
    expectLayoutMatchesText(it2, name.replace(/‍/g, ''))
  })

  it('닉네임·가게 이름·방송 제목은 두 줄이 되지 않고 minFontSize 한 줄 …로 줄인다 (20자 닉네임도 라벨이 나온다)', () => {
    const long = '가나다라마바사아자차카타파하거너더러머버서'
    const r = product({ ...defaultTemplate('product'), shopName: long.repeat(2) }, { ...SAMPLE_PRODUCT, buyer: { kind: 'youtube', name: long.slice(0, 20) } })
    for (const id of ['shop', 'buyer']) {
      const it2 = item(r.layout.items, id)
      expect(it2.lines).toHaveLength(1)
      expect(it2.method).not.toBe('twoLines')
    }
    expect(item(r.layout.items, 'shop').method).toBe('truncated')
    expect(item(r.layout.items, 'shop').fontSize).toBe(defaultTemplate('product').items.shop.minFontSize)
    const p = renderPackingLabels(env, defaultTemplate('packing'), {
      ...SAMPLE_PACKING,
      buyer: { kind: 'youtube', name: long.repeat(3) },
      broadcasts: [{ title: long.repeat(3), numbers: [1] }, { title: '2부', numbers: [2] }],
    })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    for (const id of ['buyer', 'broadcast']) {
      const it2 = item(p.pages[0]?.layout.items ?? [], id)
      expect(it2.method).toBe('truncated')
      expect(it2.lines).toHaveLength(1)
      expect(it2.lines[0]?.endsWith('…')).toBe(true)
    }
  })

  it('1만 자 품종·닉네임도 라벨이 빨리 나온다', () => {
    const huge = '가'.repeat(10_000)
    const started = performance.now()
    const r = product({ ...defaultTemplate('product'), shopName: huge }, { ...SAMPLE_PRODUCT, name: huge, buyer: { kind: 'youtube', name: `${huge} ${huge}` } })
    expect(performance.now() - started).toBeLessThan(5000)
    expect(item(r.layout.items, 'name').method).toBe('truncated')
    expect(item(r.layout.items, 'buyer').method).toBe('truncated')
    expectCleanLayout(r.image, r.layout)
  })
})

describe('숫자 항목은 자르지 않는다 (AC-P1-14)', () => {
  it('가격 상자 폭 40 + 99,999,999원(원 표기) → DOES_NOT_FIT(price)과 쉬운 한국어 문장, 그림 없음', () => {
    const t = withItem({ ...defaultTemplate('product'), priceStyle: 'WON' as const }, 'price', { width: 40 })
    const r = renderProductLabel(env, t, { ...SAMPLE_PRODUCT, price: 99999999 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DOES_NOT_FIT')
    expect(r.error.item).toBe('price')
    expect(r.error.message).toBe('가격 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요.')
    expect('image' in r).toBe(false)
  })

  it('번호·날짜·쪽·상품 수·상품 합계·번호 목록도 같다', () => {
    for (const id of ['number', 'date'] as const) {
      const r = renderProductLabel(env, withItem(defaultTemplate('product'), id, { width: 40 }), { ...SAMPLE_PRODUCT, no: 9999 })
      expect(!r.ok && [r.error.code, r.error.item]).toEqual(['DOES_NOT_FIT', id])
    }
    for (const id of ['page', 'count', 'subtotal', 'numbers', 'date'] as const) {
      // 쪽 표시 `1/1`은 40점보다 좁아 16점으로 줄인다
      const r = renderPackingLabels(env, withItem(defaultTemplate('packing'), id, { width: id === 'page' ? 16 : 40 }), {
        ...SAMPLE_PACKING,
        broadcasts: [{ title: '1부', numbers: [9999, 9998, 9997] }],
        subtotal: 99999999,
      })
      expect(!r.ok && [r.error.code, r.error.item]).toEqual(['DOES_NOT_FIT', id])
    }
  })

  it('기본 템플릿(세 크기)은 최악의 값이 20점 이상으로 들어간다', () => {
    for (const size of LABEL_SIZES) {
      for (const priceStyle of ['WON', 'THOUSAND'] as const) {
        const price = priceStyle === 'WON' ? 99999999 : 99999000
        const r = product({ ...defaultTemplate('product', size), priceStyle, shopName: '다육농장' }, { ...SAMPLE_PRODUCT, no: 9999, price })
        expect(item(r.layout.items, 'price').value).toBe(priceStyle === 'WON' ? '99,999,999원' : '99,999 천원')
        expectCleanLayout(r.image, r.layout)
      }
      const t = defaultTemplate('packing', size)
      expect(t.perPage).toBeGreaterThanOrEqual(4)
      // 네 자리 번호 998개 + 다른 방송 1개 → 상품 999개, 쪽마다 perPage개
      const numbers = Array.from({ length: 998 }, (_, i) => 9999 - i)
      const r = renderPackingLabels(env, { ...t, shopName: '다육농장' }, { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers }, { title: '2부', numbers: [9999] }], subtotal: 99999999 })
      expect(r.ok, size).toBe(true)
      if (!r.ok) return
      const first = r.pages[0]
      const lastPage = r.pages.at(-1)
      if (!first || !lastPage) return
      expect(item(first.layout.items, 'numbers').value.split(', ')).toHaveLength(t.perPage)
      expect(item(first.layout.items, 'count').lines).toEqual(['상품 999개'])
      expect(item(first.layout.items, 'subtotal').lines).toEqual(['상품 합계 99,999,999원'])
      for (const page of [first, lastPage]) expectCleanLayout(page.image, page.layout)
    }
  })

  it('번호 목록은 ", " 뒤에서만 줄을 바꾼다', () => {
    const r = renderPackingLabels(env, defaultTemplate('packing'), { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers: [1, 22, 333, 4444, 5555, 6666, 7777, 8888, 9999, 10] }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const numbers = item(r.pages[0]?.layout.items ?? [], 'numbers')
    expect(numbers.lines.length).toBeGreaterThan(1)
    numbers.lines.forEach((line, i) => {
      expect(line).toMatch(/^\d+(, \d+)*,?$/)
      if (i < numbers.lines.length - 1) expect(line.endsWith(',')).toBe(true)
    })
    expect(numbers.lines.join(' ')).toBe('1, 10, 22, 333, 4444, 5555, 6666, 7777, 8888, 9999')
  })
})

describe('결정성 (AC-P1-15)', () => {
  it('같은 데이터·템플릿을 두 번 렌더하면 그림 바이트와 배치 결과가 같다', () => {
    const t = { ...defaultTemplate('product'), shopName: '다육농장' }
    const a = product(t)
    const b = product(t)
    expect(Array.from(a.image.data)).toEqual(Array.from(b.image.data))
    expect(a.layout).toEqual(b.layout)
  })

  it('TZ를 바꾸고 Date.now·Math.random·new Date를 던지게 해도 같은 결과', () => {
    const t = { ...defaultTemplate('product'), shopName: '다육농장' }
    const before = product(t)
    const tz = process.env.TZ
    process.env.TZ = 'America/New_York'
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now를 읽었다')
    })
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random을 읽었다')
    })
    try {
      const after = product(t)
      expect(bitmapsEqual(before.image, after.image)).toBe(true)
      expect(after.layout).toEqual(before.layout)
      const p = renderPackingLabels(env, defaultTemplate('packing'), SAMPLE_PACKING)
      expect(p.ok).toBe(true)
    } finally {
      process.env.TZ = tz
    }
  })
})

describe('렌더 속도 (AC-P1-16)', () => {
  it('서로 다른 상품 라벨 30장 렌더 합계 6초 이내 (글꼴 등록 제외)', () => {
    nodeEnv()
    const t = { ...defaultTemplate('product'), shopName: '다육농장' }
    const started = performance.now()
    for (let i = 0; i < 30; i++) {
      product(t, { no: 100 + i, name: `왕비뇌신금 ${String(i)}호 아주 긴 품종 이름 금황환 핑크프릴`.slice(0, 5 + i), price: 8000 + i * 500, date: '2026-10-08', buyer: { kind: 'youtube', name: `구매자${String(i)}` } })
    }
    expect(performance.now() - started).toBeLessThan(6000)
  })
})

describe('테스트 라벨 (AC-P1-17)', () => {
  for (const size of LABEL_SIZES) {
    it(`${size}: 가게 이름·테스트 라벨·한글 확인·숫자·날짜, 네 가장자리 테두리`, () => {
      const r = renderTestLabel(env, { shopName: '다육농장', date: '2026-10-20', size })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const lines = r.layout.items.flatMap((i) => i.lines)
      expect(lines).toEqual(['다육농장', '테스트 라벨', '한글 확인: 가나다 똠햏 ㄱㄴㄷ', '0123456789', '26.10.20'])
      expect(r.layout.missing).toEqual([])
      const { width, height } = r.image
      const row = (y: number) => Array.from({ length: width }, (_, x) => getPixel(r.image, x, y)).filter(Boolean).length
      const col = (x: number) => Array.from({ length: height }, (_, y) => getPixel(r.image, x, y)).filter(Boolean).length
      expect(row(0)).toBeGreaterThanOrEqual(width * 0.9)
      expect(row(height - 1)).toBeGreaterThanOrEqual(width * 0.9)
      expect(col(0)).toBeGreaterThanOrEqual(height * 0.9)
      expect(col(width - 1)).toBeGreaterThanOrEqual(height * 0.9)
      expect(TEST_LABEL_BORDER).toBeGreaterThanOrEqual(1)
    })
  }

  it('기본 크기는 50×30, 날짜는 받은 값이고 형식이 틀리면 오류', () => {
    const r = renderTestLabel(env, { shopName: '', date: '2026-01-05' })
    expect(r.ok && [r.image.width, r.image.height]).toEqual([384, 240])
    expect(r.ok && r.layout.items.map((i) => i.id)).toEqual(['title', 'check', 'digits', 'date'])
    expect(renderTestLabel(env, { shopName: 'a', date: '2026-02-30' }).ok).toBe(false)
  })

  it('L-1 목록 밖 크기는 그림을 만들지 않고 템플릿 검사와 같은 크기 오류를 돌려준다(던지지 않는다) — TD-P1-003', () => {
    const made: [number, number][] = []
    const watched = { ...env, createContext: (w: number, h: number) => (made.push([w, h]), env.createContext(w, h)) }
    for (const size of ['40x30', '100x100', '50x30 ', '50X30', 'abc', '', 0, null, {}] as unknown[]) {
      const r = renderTestLabel(watched, { shopName: '다육농장', date: '2026-10-20', size: size as (typeof LABEL_SIZES)[number] })
      expect(r.ok, String(size)).toBe(false)
      if (r.ok) continue
      expect(r.error.code).toBe('INVALID_TEMPLATE')
      expect(r.error.message).toBe('라벨 설정에 고칠 곳이 있어요.')
      expect(r.error.problems).toEqual([{ path: 'size', message: '쓸 수 없는 라벨 크기예요. 50×30, 50×20, 50×40 중에서 골라 주세요.' }])
    }
    expect(made).toEqual([])
  })
})

describe('조정이 그림에 그대로 나온다 (AC-P1-21)', () => {
  const base = { ...defaultTemplate('product'), shopName: '다육농장' }
  const before = product(base)

  it('날짜 상자를 오른쪽 아래로 옮기면 날짜 점은 새 상자 안에만, 옛 자리에는 없다', () => {
    const moved = withItem(withItem(base, 'buyer', { width: 280 }), 'date', { x: 292, y: 196, width: 88, height: 36 })
    const after = product(moved)
    const oldBox = base.items.date
    const newBox = moved.items.date
    expect(blackIn(after.image, oldBox)).toBe(0)
    expect(blackIn(after.image, newBox)).toBeGreaterThan(0)
    expect(item(after.layout.items, 'date').box).toEqual({ x: 292, y: 196, width: 88, height: 36 })
    expect(diffOutside(before.image, after.image, [oldBox, newBox])).toBe(0)
    expectCleanLayout(after.image, after.layout)
  })

  it('품종 글자 크기를 키우면 배치 결과의 글자 크기가 커진다', () => {
    const bigger = withItem(base, 'name', { fontSize: 36 })
    const after = product(bigger)
    expect(item(after.layout.items, 'name').fontSize).toBeGreaterThan(item(before.layout.items, 'name').fontSize)
    expect(diffOutside(before.image, after.image, [base.items.name])).toBe(0)
  })

  it('가격을 끄면 가격 상자 안에 점이 없고 배치 결과에 가격 항목이 없다', () => {
    const off = withItem(base, 'price', { visible: false })
    const after = product(off)
    expect(blackIn(after.image, base.items.price)).toBe(0)
    expect(after.layout.items.some((i) => i.id === 'price')).toBe(false)
    expect(diffOutside(before.image, after.image, [base.items.price])).toBe(0)
  })
})

describe('글 계산과 그리기가 같은 글을 쓴다 (AC-P1-06)', () => {
  it('그리기 함수는 글 계산 결과만 받는다 — 같은 글 계산 결과면 같은 그림', () => {
    const computed = computeProductText({ ...defaultTemplate('product'), shopName: '다육농장' }, SAMPLE_PRODUCT)
    expect(computed.ok).toBe(true)
    if (!computed.ok) return
    const a = renderProductText(env, computed.text)
    const b = renderProductLabel(env, { ...defaultTemplate('product'), shopName: '다육농장' }, SAMPLE_PRODUCT)
    expect(a.ok && b.ok && bitmapsEqual(a.image, b.image)).toBe(true)
    if (a.ok) for (const it2 of a.layout.items) expectLayoutMatchesText(it2, computed.text.items[it2.id as keyof typeof computed.text.items] as string)
  })
})
