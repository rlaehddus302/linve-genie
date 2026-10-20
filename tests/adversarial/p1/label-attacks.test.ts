// P1 적대 테스트 (test-domain): 라벨 공격 (AC-P1-70, AC-P1-03·04·06·11~15, L-0·L-2~L-5).
// - 아주 긴 품종·닉네임·가게 이름(1만 자), 이모지·제어 문자·방향 바꾸기·NFD·결합 문자 더미(zalgo)·RTL 닉네임
// - 가격 0원·1억 원·99,999,999원, 번호 1·9999, 포장 라벨 번호 50·200개(쪽마다 빠짐·겹침 없음)
// - 메모·전화번호를 라벨 데이터 어디에 끼워도 그림·배치 결과·PNG·PDF로 나오지 않는다(만들지 않는다)
// - 무작위 데이터: 두 번 렌더 같음, 잉크는 항목 상자 밖으로 나가지 않음, 배치 결과 = 캡션 + 글 계산 값
// - 테스트 라벨의 크기도 L-1 목록 밖은 쓰지 않는다
import {
  computePackingText,
  computeProductText,
  createLabelPdf,
  defaultTemplate,
  encodeLabelPng,
  getPixel,
  labelContentKey,
  renderPackingLabels,
  renderProductLabel,
  renderTestLabel,
  splitGraphemes,
  trimLabelText,
  type LabelBitmap,
  type LabelLayout,
  type LabelSizeId,
  type LayoutItem,
} from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const env = createNodeRenderEnv()
const SIZES: readonly LabelSizeId[] = ['50x30', '50x20', '50x40']
const SAMPLE = { no: 194, name: '왕비뇌신금', price: 8000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } } as const
const shop = (size: LabelSizeId, shopName = '다육농장') => ({ ...defaultTemplate('product', size), shopName })

/** 모든 검정 점이 어느 항목 상자(1점 넓힌) 안에 있는지 (AC-P1-12 c) */
function strayInk(image: LabelBitmap, layout: LabelLayout): number {
  let n = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!getPixel(image, x, y)) continue
      const ok = layout.items.some((i) => x >= i.box.x - 1 && x < i.box.x + i.box.width + 1 && y >= i.box.y - 1 && y < i.box.y + i.box.height + 1)
      if (!ok) n++
    }
  }
  return n
}

/** AC-P1-06: 배치 결과 = 캡션 + 값 + 꼬리, 다른 점은 줄 나누기와 끝 `…`뿐 */
function expectLayoutMatches(item: LayoutItem): void {
  const { value, valueLines: lines } = item
  expect(item.lines[0]?.startsWith(item.caption), item.id).toBe(true)
  expect(item.lines.at(-1)?.endsWith(item.suffix), item.id).toBe(true)
  if (item.method === 'fit' || item.method === 'shrunk') {
    if (item.id === 'numbers') expect(lines.join(' ')).toBe(value)
    else expect(item.lines).toEqual([`${item.caption}${value}${item.suffix}`])
  } else if (item.method === 'twoLines') {
    expect(lines).toHaveLength(2)
    expect(value.includes(' ') ? lines.join(' ') : lines.join('')).toBe(value)
  } else {
    const shown = lines.join('')
    expect(shown.endsWith('…'), item.id).toBe(true)
    const prefix = shown.slice(0, -1)
    expect(value.startsWith(prefix), item.id).toBe(true)
    const g = splitGraphemes(prefix)
    expect(g, item.id).toEqual(splitGraphemes(value).slice(0, g.length))
  }
}

function expectClean(image: LabelBitmap, layout: LabelLayout): void {
  expect(strayInk(image, layout)).toBe(0)
  for (const item of layout.items) {
    expect(item.fontSize, item.id).toBeGreaterThanOrEqual(20)
    expectLayoutMatches(item)
  }
}

const item = (layout: LabelLayout, id: string): LayoutItem => {
  const found = layout.items.find((i) => i.id === id)
  if (!found) throw new Error(`항목 없음: ${id}`)
  return found
}

describe('아주 긴 글 (AC-P1-70·13)', () => {
  it.each(SIZES)('%s: 1만 자 가게 이름·품종·닉네임이 함께 들어도 라벨은 만들어지고, 잉크는 상자 안, 품종은 두 줄 `…`·닉네임은 한 줄 `…`', (size) => {
    const long = '왕비뇌신금'.repeat(2000)
    const r = renderProductLabel(env, shop(size, '다육농장'.repeat(2500)), { ...SAMPLE, name: long, buyer: { kind: 'youtube', name: '우주천사'.repeat(2500) } })
    if (!r.ok) throw new Error(r.error.message)
    expectClean(r.image, r.layout)
    expect(item(r.layout, 'name').method).toBe('truncated')
    expect(item(r.layout, 'name').lines).toHaveLength(2)
    expect(item(r.layout, 'buyer').method).toBe('truncated')
    expect(item(r.layout, 'buyer').lines).toHaveLength(1)
    expect(item(r.layout, 'shop').lines).toHaveLength(1)
  })

  it('1만 자 공백 섞인 품종(공백 9999개)도 같다', () => {
    const r = renderProductLabel(env, shop('50x30'), { ...SAMPLE, name: '가 '.repeat(10000) })
    if (!r.ok) throw new Error(r.error.message)
    expectClean(r.image, r.layout)
    expect(item(r.layout, 'name').method).toBe('truncated')
  })
})

describe('특수문자·이모지·제어 문자 닉네임 (AC-P1-70·03·11)', () => {
  const nicknames: Record<string, string> = {
    zalgo: 'Z̴̧̛̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̀́̂̃̄̅̆̇̈̉̊̋̌̍̎̏̐̑̒̓̔a',
    vietnamese: 'Ỗ Ẫ Ậ ǺǼ',
    thai: 'กิ์กิ์กิ์',
    rtl: 'مرحبا 우주',
    rtlOverride: '‮우주천사‬',
    family: '👨‍👩‍👧‍👦 가족',
    flags: '🇰🇷🇰🇷 대한',
    deco: '꧁༺ 𝓢𝓽𝓪𝓻 ༻꧂',
    controls: '우\n주\t천\r사\u0000',
    nfd: '한글', // 한글(풀어 쓴)
    html: '<script>alert(1)</script>',
    fullwidth: 'ＡＢＣ　１２３',
  }
  for (const size of SIZES) {
    it.each(Object.entries(nicknames))(`${size} %s`, (_name, nick) => {
      const r = renderProductLabel(env, shop(size), { ...SAMPLE, buyer: { kind: 'youtube', name: nick } })
      if (!r.ok) throw new Error(r.error.message)
      expectClean(r.image, r.layout)
      // 글 계산 값은 L-2 다듬기 결과 그대로다 (그리기가 글을 바꾸지 않는다)
      expect(item(r.layout, 'buyer').value).toBe(trimLabelText(nick) || '이름 없음')
      // 같은 글이면 같은 그림 (결정성)
      const again = renderProductLabel(env, shop(size), { ...SAMPLE, buyer: { kind: 'youtube', name: nick } })
      if (!again.ok) throw new Error('두 번째 렌더')
      expect(Buffer.from(again.image.data).equals(Buffer.from(r.image.data))).toBe(true)
    })
  }

  it('NFD 닉네임은 NFC와 같은 그림, 방향 바꾸기 문자는 지운 것과 같은 그림', () => {
    const draw = (name: string) => {
      const r = renderProductLabel(env, shop('50x30'), { ...SAMPLE, buyer: { kind: 'youtube', name } })
      if (!r.ok) throw new Error(r.error.message)
      return Buffer.from(r.image.data)
    }
    expect(draw('한글').equals(draw('한글'))).toBe(true)
    expect(draw('‮우주천사‬').equals(draw('우주천사'))).toBe(true)
    expect(draw('우​주﻿천⁠사').equals(draw('우주천사'))).toBe(true)
  })

  it('없는 글자는 서로 달라도 같은 네모 — 시스템 글꼴로 대신 그리지 않는다', () => {
    const draw = (name: string) => {
      const r = renderProductLabel(env, shop('50x30'), { ...SAMPLE, buyer: { kind: 'youtube', name } })
      if (!r.ok) throw new Error(r.error.message)
      return r
    }
    const a = draw('가🦖나')
    const b = draw('가ꙮ나') // 키릴 확장 — 글꼴에 없는 글자
    expect(Buffer.from(a.image.data).equals(Buffer.from(b.image.data))).toBe(true)
    expect(a.layout.missing).toEqual(['🦖'])
  })
})

describe('가격·번호 경계 (AC-P1-70·14)', () => {
  const cases: [string, number, 'THOUSAND' | 'WON', string][] = [
    ['0원', 0, 'THOUSAND', '0원'],
    ['1억(천원 표기)', 100_000_000, 'THOUSAND', '100,000 천원'],
    ['99,999,999원', 99_999_999, 'WON', '99,999,999원'],
    ['99,999 천원', 99_999_000, 'THOUSAND', '99,999 천원'],
  ]
  for (const size of SIZES) {
    it.each(cases)(`${size} 가격 %s`, (_label, price, priceStyle, text) => {
      for (const no of [1, 9999]) {
        const r = renderProductLabel(env, { ...shop(size), priceStyle }, { ...SAMPLE, no, price })
        if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`)
        expectClean(r.image, r.layout)
        expect(item(r.layout, 'price').lines).toEqual([`가격: ${text}`])
        expect(item(r.layout, 'number').lines).toEqual([`번호: ${String(no)}`])
        // 숫자 항목은 줄이지 않는다
        for (const id of ['number', 'price', 'date']) expect(item(r.layout, id).method).not.toBe('truncated')
      }
    })
  }

  it('1억 원(원 표기)은 기본 50×30 가격 상자에 안 들어가면 잘린 가격 대신 DOES_NOT_FIT(price) — 그림 없음', () => {
    const r = renderProductLabel(env, { ...shop('50x30'), priceStyle: 'WON' }, { ...SAMPLE, price: 100_000_000 })
    if (r.ok) {
      expect(item(r.layout, 'price').lines).toEqual(['가격: 100,000,000원'])
      expectClean(r.image, r.layout)
    } else {
      expect(r.error).toMatchObject({ code: 'DOES_NOT_FIT', item: 'price' })
      expect(r).not.toHaveProperty('image')
    }
  })
})

describe('포장 라벨 번호 50·200개 (AC-P1-70·05)', () => {
  for (const size of SIZES) {
    it.each([50, 200])(`${size}: %i개 — 쪽마다 빠짐·겹침 없이, 합치면 정렬된 전체, 쪽 표시 k/n`, (count) => {
      // 섞인 순서·한 자리~네 자리 번호
      const numbers = Array.from({ length: count }, (_, i) => ((i * 7919) % 9999) + 1)
      const data = { date: '2026-10-18', buyer: { kind: 'youtube', name: '우주천사' }, broadcasts: [{ title: '1부', numbers }], subtotal: 1_234_000 }
      const template = defaultTemplate('packing', size)
      const text = computePackingText(template, data)
      if (!text.ok) throw new Error(text.error.message)
      const pages = text.text.pages
      expect(pages.flatMap((p) => p.numbers)).toEqual([...numbers].sort((a, b) => a - b))
      expect(pages.every((p) => p.numbers.length >= 1 && p.numbers.length <= template.perPage)).toBe(true)
      expect(pages.map((p) => p.page)).toEqual(pages.map((_, k) => `${String(k + 1)}/${String(pages.length)}`))
      expect(text.text.common.count).toBe(String(count))
      const r = renderPackingLabels(env, template, data)
      if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`)
      expect(r.pages).toHaveLength(pages.length)
      r.pages.forEach((page, k) => {
        expectClean(page.image, page.layout)
        // 그린 번호 목록 = 그 쪽의 번호 (번호 하나가 두 줄로 갈라지지 않는다)
        const drawn = item(page.layout, 'numbers').valueLines.join(' ').split(', ').map(Number)
        expect(drawn).toEqual(pages[k]?.numbers)
        expect(item(page.layout, 'subtotal').lines).toEqual(['상품 합계 1,234,000원'])
      })
    })
  }

  it('여러 방송 + 다른 방송의 같은 번호: 방송마다 따로 쪽, 받은 순서, 전체 개수는 모든 번호', () => {
    const data = {
      date: '2026-10-18',
      buyer: { kind: 'sms' },
      broadcasts: [
        { title: '3부', numbers: Array.from({ length: 23 }, (_, i) => 23 - i) },
        { title: '', numbers: [5] },
        { title: '‮1부', numbers: [5, 9999] },
      ],
      subtotal: 0,
    }
    const t = computePackingText(defaultTemplate('packing'), data)
    if (!t.ok) throw new Error(t.error.message)
    expect(t.text.pages.map((p) => [p.page, p.broadcast, p.numbers.length])).toEqual([
      ['1/5', '3부', 10],
      ['2/5', '3부', 10],
      ['3/5', '3부', 3],
      ['4/5', '제목 없음', 1],
      ['5/5', '1부', 2],
    ])
    expect(t.text.common).toMatchObject({ buyer: '문자찜', count: '26', subtotal: '0원' })
  })
})

describe('메모·전화번호 끼워 넣기 (AC-P1-70·04, R-11)', () => {
  const PHONE = '010-1234-5678'
  const productInjections: [string, unknown][] = [
    ['문자찜 메모', { ...SAMPLE, buyer: { kind: 'sms', memo: '문 앞에 두세요' } }],
    ['문자찜 전화', { ...SAMPLE, buyer: { kind: 'sms', phone: PHONE } }],
    ['문자찜 뒤 4자리', { ...SAMPLE, buyer: { kind: 'sms', phoneLast4: '5678' } }],
    ['문자찜 이름', { ...SAMPLE, buyer: { kind: 'sms', name: '홍길동' } }],
    ['유튜브에 전화', { ...SAMPLE, buyer: { kind: 'youtube', name: '우주천사', phone: PHONE } }],
    ['맨 위 메모', { ...SAMPLE, memo: PHONE }],
    ['맨 위 note', { ...SAMPLE, note: PHONE }],
    ['구매자 종류 없음', { ...SAMPLE, buyer: { name: PHONE } }],
    ['구매자 종류 대문자', { ...SAMPLE, buyer: { kind: 'SMS' } }],
    ['구매자가 글', { ...SAMPLE, buyer: PHONE }],
    ['구매자가 배열', { ...SAMPLE, buyer: [{ kind: 'sms' }] }],
    ['데이터가 클래스 객체', Object.assign(new (class Data {})(), SAMPLE)],
    ['JSON __proto__', JSON.parse(`{"no":194,"name":"x","price":1,"date":"2026-10-08","buyer":{"kind":"sms","__proto__":{"memo":"${PHONE}"}}}`) as unknown],
  ]
  it.each(productInjections)('상품 라벨 %s → INVALID_DATA, 글·그림·내용 키 없음', (_label, data) => {
    const t = computeProductText(shop('50x30'), data)
    expect(t.ok).toBe(false)
    const r = renderProductLabel(env, shop('50x30'), data)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_DATA')
      expect(r.error.message).toMatch(/^라벨에 넣을 수 없는 값이 있어요: /)
      expect(JSON.stringify(r.error)).not.toContain('1234')
      expect(JSON.stringify(r.error)).not.toContain('문 앞')
    }
    expect(r).not.toHaveProperty('image')
    expect(labelContentKey('product', data).ok).toBe(false)
  })

  const packingBase = { date: '2026-10-18', buyer: { kind: 'sms' }, broadcasts: [{ title: '1부', numbers: [3, 12] }], subtotal: 45000 }
  const packingInjections: [string, unknown][] = [
    ['구매자 메모', { ...packingBase, buyer: { kind: 'sms', memo: PHONE } }],
    ['방송에 메모', { ...packingBase, broadcasts: [{ title: '1부', numbers: [3], memo: PHONE }] }],
    ['합계 칸 total', { ...packingBase, total: 48000 }],
    ['배송비', { ...packingBase, shipping: 3000 }],
    ['번호가 글', { ...packingBase, broadcasts: [{ title: '1부', numbers: ['3'] }] }],
    ['번호 0', { ...packingBase, broadcasts: [{ title: '1부', numbers: [0] }] }],
    ['번호 겹침', { ...packingBase, broadcasts: [{ title: '1부', numbers: [3, 3] }] }],
    ['합계 음수', { ...packingBase, subtotal: -1 }],
    ['합계 소수', { ...packingBase, subtotal: 0.5 }],
  ]
  it.each(packingInjections)('포장 라벨 %s → INVALID_DATA, 쪽 없음', (_label, data) => {
    const r = renderPackingLabels(env, defaultTemplate('packing'), data)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_DATA')
    expect(r).not.toHaveProperty('pages')
  })

  it('문자찜 라벨의 배치 결과·PNG·PDF 어디에도 전화번호 꼴 숫자가 없다(받을 칸이 없다)', () => {
    const r = renderProductLabel(env, shop('50x30'), { ...SAMPLE, buyer: { kind: 'sms' } })
    if (!r.ok) throw new Error(r.error.message)
    expect(item(r.layout, 'buyer').lines).toEqual(['닉네임: 문자찜'])
    expect(JSON.stringify(r.layout)).not.toMatch(/010|1234|5678/)
    const png = encodeLabelPng(r.image)
    const pdf = createLabelPdf([r.image])
    if (!png.ok || !pdf.ok) throw new Error('내보내기')
    expect(Buffer.from(pdf.bytes).toString('latin1')).not.toMatch(/010-|문자찜|우주/)
  })
})

describe('무작위 데이터 (AC-P1-70·06·15)', () => {
  // 실제로 칠 법한 글: 한글·영문·숫자·공백·이모지·특수문자·제어 문자를 섞는다
  const piece = fc.constantFrom('가', '똠', '햏', 'ㅋ', 'ㅠ', 'A', 'z', '9', ' ', '　', '🌵', '🌸', '❤️', '★', '♡', '~', '!', '\n', '\t', '​', 'é', 'é', '(', ')', '-', '_', '.', '…', '多肉')
  const text = (max: number) => fc.array(piece, { maxLength: max }).map((a) => a.join(''))
  const product = fc.record({
    no: fc.integer({ min: 1, max: 9999 }),
    name: text(60),
    price: fc.oneof(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 99_999 }).map((k) => k * 1000)),
    date: fc.constantFrom('2026-10-08', '2024-02-29', '2099-12-31', '2000-01-01'),
    buyer: fc.oneof(fc.constant({ kind: 'sms' as const }), text(40).map((name) => ({ kind: 'youtube' as const, name }))),
  })

  it('상품 라벨: 두 번 렌더 같음, 잉크는 상자 안, 배치 결과 = 캡션 + 글 계산 값, 20점 이상', () => {
    fc.assert(
      fc.property(product, fc.constantFrom(...SIZES), fc.constantFrom('THOUSAND' as const, 'WON' as const), fc.constantFrom('', '다육농장', '🌵초록 정원🌵'), (data, size, priceStyle, shopName) => {
        const template = { ...shop(size, shopName), priceStyle }
        const a = renderProductLabel(env, template, data)
        const b = renderProductLabel(env, template, structuredClone(data))
        expect(a.ok).toBe(b.ok)
        if (!a.ok || !b.ok) {
          // 기본 템플릿에서 생길 수 있는 유일한 실패는 원 표기 1억 이상(여기엔 없다)
          throw new Error(`${a.ok ? '' : a.error.code} ${JSON.stringify(data)}`)
        }
        expect(Buffer.from(a.image.data).equals(Buffer.from(b.image.data))).toBe(true)
        expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout))
        expectClean(a.image, a.layout)
        for (const it of a.layout.items) expect(it.value).toBe(a.text.items[it.id as keyof typeof a.text.items])
      }),
      { numRuns: 150, seed: 1018 },
    )
  })
})

describe('테스트 라벨 크기 (AC-P1-17, L-1)', () => {
  it('TD-P1-003: L-1 목록 밖 크기(40×30·100×100·글자)로는 테스트 라벨을 만들지 않고 오류를 돌려준다(던지지 않는다)', () => {
    // render.ts renderTestLabel은 size를 검사하지 않는다: '40x30'은 320×240, '100x100'은 384×800 그림을 만들고,
    // 'abc'는 NaN 글자 크기로 캔버스 예외를 그대로 던진다. 상품·포장 라벨은 템플릿 검사가 막는 크기다.
    for (const size of ['40x30', '100x100', 'abc']) {
      let result: { ok: boolean } | undefined
      expect(() => {
        result = renderTestLabel(env, { shopName: '다육농장', date: '2026-10-20', size: size as LabelSizeId })
      }, size).not.toThrow()
      expect(result?.ok, size).toBe(false)
    }
  })
})
