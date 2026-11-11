// N1 라벨 크기·작은 템플릿·포장 크기·작은 테스트 라벨·내보내기 (AC-N1-10~14·60·62, LABEL_RULES L-1·L-4~L-7, D-N1-03).
// 픽셀 스냅샷 대신 영역·글자 배치를 검사한다(dev-device 원칙). 글 값은 라벨 골든(G-LBL-N1-*)이 고정한다.
import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { unzlibSync } from 'fflate'
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, type PDFPage, type PDFRawStream, type PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  ALL_LABEL_SIZES,
  LABEL_SIZES,
  NO_PACKING_TEMPLATE,
  PACKING_LABEL_SIZES,
  PRODUCT_ITEMS,
  PT_PER_MM,
  SMALL_LABEL_SIZES,
  TAPE_LABEL_SIZES,
  TEMPLATE_MESSAGES,
  TEST_LABEL_SMALL_HANGUL,
  a4Cell,
  a4Layout,
  bitmapsEqual,
  canMakePackingLabel,
  computePackingText,
  createA4Pdf,
  createBitmap,
  createLabelPdf,
  defaultTemplate,
  encodeLabelPng,
  getPixel,
  isLabelSize,
  isSmallLabelSize,
  labelSizeInfo,
  labelSizeName,
  oneBitFromRgba,
  renderPackingLabels,
  renderProductLabel,
  renderTestLabel,
  setPixel,
  sizeOfBitmap,
  templateToJson,
  validateTemplate,
  type LabelBitmap,
  type LabelSizeId,
  type LayoutItem,
  type ProductTemplate,
  type TemplateItem,
} from '../src/index.ts'
import { SAMPLE_PACKING, SAMPLE_PRODUCT, blackIn, expectCleanLayout, expectLayoutMatchesText, nodeEnv, overlaps } from './helpers.ts'
import { beforeLargeFont, revertStbDateBox, type DefaultsOf } from './base-snapshot.ts'

const env = nodeEnv()

const item = (items: readonly LayoutItem[], id: string): LayoutItem => {
  const found = items.find((i) => i.id === id)
  if (!found) throw new Error(`배치 결과에 ${id}가 없다`)
  return found
}

const withVisible = (t: ProductTemplate, visible: Partial<Record<string, boolean>>): ProductTemplate => {
  const items = { ...t.items } as Record<string, TemplateItem>
  for (const [id, v] of Object.entries(visible)) items[id] = { ...(items[id] as TemplateItem), visible: v as boolean }
  return { ...t, items: items as ProductTemplate['items'] }
}

function product(template: unknown, data: unknown = SAMPLE_PRODUCT) {
  const r = renderProductLabel(env, template, data)
  if (!r.ok) throw new Error(`렌더 실패: ${JSON.stringify(r.error)}`)
  return r
}

const SIZE_MESSAGE = '쓸 수 없는 라벨 크기예요. 라벨 크기 목록에서 다시 골라 주세요.'
const PACKING_SIZE_MESSAGE = '이 크기에는 포장 라벨을 만들 수 없어요. 높이 20mm 이상인 라벨을 골라 주세요.'

describe('크기 다섯 더하기 — 지금 화면의 목록은 그대로 (AC-N1-10)', () => {
  it('템플릿 검사가 받는 크기 전체와 그림 점 수, 화면 이름', () => {
    expect([...ALL_LABEL_SIZES]).toEqual(['50x30', '50x20', '50x40', '50x15', '50x50', 'tape12x40', 'tape15x30', 'tape15x50'])
    expect(ALL_LABEL_SIZES.map((s) => [labelSizeInfo(s).widthDots, labelSizeInfo(s).heightDots])).toEqual([
      [384, 240],
      [384, 160],
      [384, 320],
      [384, 120],
      [384, 400],
      [320, 96],
      [240, 96],
      [400, 96],
    ])
    expect(ALL_LABEL_SIZES.map(labelSizeName)).toEqual(['50×30', '50×20', '50×40', '50×15', '50×50', '테이프 12×40', '테이프 15×30', '테이프 15×50'])
    for (const size of ALL_LABEL_SIZES) {
      expect(isLabelSize(size)).toBe(true)
      expect(validateTemplate(defaultTemplate('product', size)).ok, size).toBe(true)
    }
  })

  it('I1 화면이 쓰는 LABEL_SIZES는 B1 목록 그대로다 (테이프 크기가 B1 판매자에게 보이지 않게)', () => {
    expect([...LABEL_SIZES]).toEqual(['50x30', '50x20', '50x40'])
    expect([...TAPE_LABEL_SIZES]).toEqual(['tape12x40', 'tape15x30', 'tape15x50'])
    expect([...SMALL_LABEL_SIZES]).toEqual(['50x15', 'tape12x40', 'tape15x30', 'tape15x50'])
    expect([...PACKING_LABEL_SIZES]).toEqual(['50x30', '50x20', '50x40', '50x50'])
  })

  it('테이프의 읽는 방향 mm = 길이 × 테이프 폭, A4 칸·장 수, 그림 점 수로 크기 찾기', () => {
    expect([labelSizeInfo('tape12x40').widthMm, labelSizeInfo('tape12x40').heightMm]).toEqual([40, 12])
    expect([labelSizeInfo('tape15x30').widthMm, labelSizeInfo('tape15x30').heightMm]).toEqual([30, 15])
    expect([labelSizeInfo('tape15x50').widthMm, labelSizeInfo('tape15x50').heightMm]).toEqual([50, 15])
    expect([labelSizeInfo('50x15').widthMm, labelSizeInfo('50x15').heightMm]).toEqual([50, 15])
    expect(ALL_LABEL_SIZES.map((s) => labelSizeInfo(s).small)).toEqual([false, false, false, true, false, true, true, true])
    expect(ALL_LABEL_SIZES.map((s) => labelSizeInfo(s).tape)).toEqual([false, false, false, false, false, true, true, true])
    const counts = Object.fromEntries(ALL_LABEL_SIZES.map((s) => [s, [a4Layout(s).columns, a4Layout(s).rows, a4Layout(s).perPage]]))
    expect(counts).toEqual({
      '50x30': [3, 8, 24],
      '50x20': [3, 12, 36],
      '50x40': [3, 6, 18],
      '50x15': [3, 16, 48],
      '50x50': [3, 5, 15],
      tape12x40: [4, 19, 76],
      tape15x30: [6, 16, 96],
      tape15x50: [3, 16, 48],
    })
    for (const size of ALL_LABEL_SIZES) {
      const info = labelSizeInfo(size)
      expect(sizeOfBitmap(info.widthDots, info.heightDots)).toBe(size)
      const layout = a4Layout(size)
      for (let i = 0; i < layout.perPage + 2; i++) {
        const cell = a4Cell(size, i)
        expect(cell.leftMm).toBe(10 + cell.column * (info.widthMm + 2))
        expect(cell.topMm).toBe(10 + cell.row * (info.heightMm + 2))
        expect(cell.leftMm + cell.widthMm).toBeLessThanOrEqual(200)
        expect(cell.topMm + cell.heightMm).toBeLessThanOrEqual(287)
        expect([cell.widthMm, cell.heightMm]).toEqual([info.widthMm, info.heightMm])
      }
    }
  })

  it('목록 밖 크기의 템플릿 검사 문장은 목록을 늘어놓지 않는다', () => {
    for (const size of ['12x40', 'tape12x30', '50x60', '40x30', 'TAPE12x40', 'tape12×40']) {
      expect(isLabelSize(size), size).toBe(false)
      const r = validateTemplate({ ...defaultTemplate('product'), size })
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.error.code).toBe('INVALID_TEMPLATE')
      expect(r.error.problems).toEqual([{ path: 'size', message: SIZE_MESSAGE }])
      expect(() => labelSizeInfo(size as LabelSizeId)).toThrow(RangeError)
      expect(() => labelSizeName(size as LabelSizeId)).toThrow(RangeError)
    }
    expect(TEMPLATE_MESSAGES.size).toBe(SIZE_MESSAGE)
  })
})

describe('작은 템플릿 — 번호·가격·구매자, 최악값이 들어간다 (AC-N1-11)', () => {
  for (const size of SMALL_LABEL_SIZES) {
    describe(size, () => {
      const t = defaultTemplate('product', size)
      const hidden = [t.items.shop, t.items.date, t.items.name]

      it('번호·가격·닉네임만 켜고 가게 이름·날짜·품종은 끈다, 여섯 상자 모두 라벨 안, 경고 없이 통과, 켠 글은 20점 이상', () => {
        expect(isSmallLabelSize(size)).toBe(true)
        const { widthDots: W, heightDots: H } = labelSizeInfo(size)
        const visible = Object.fromEntries(PRODUCT_ITEMS.map((id) => [id, t.items[id].visible]))
        expect(visible).toEqual({ shop: false, number: true, price: true, date: false, name: false, buyer: true })
        for (const id of PRODUCT_ITEMS) {
          const box = t.items[id]
          expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= W && box.y + box.height <= H, id).toBe(true)
          expect(box.minFontSize, id).toBeGreaterThanOrEqual(20)
          expect(box.fontSize, id).toBeGreaterThanOrEqual(box.minFontSize)
        }
        const r = validateTemplate(t)
        expect(r.ok).toBe(true)
        expect(r.warnings).toEqual([])
        // 켠 상자끼리 겹치지 않는다
        const shown = PRODUCT_ITEMS.filter((id) => t.items[id].visible).map((id) => t.items[id])
        for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(overlaps(shown[i] as TemplateItem, shown[j] as TemplateItem)).toBe(false)
      })

      it('번호 9999 + 99,999,999원(원)·99,999 천원(천원) + 우주천사가 DOES_NOT_FIT 없이 20점 이상, 숫자는 줄지 않는다', () => {
        for (const priceStyle of ['WON', 'THOUSAND'] as const) {
          const price = priceStyle === 'WON' ? 99999999 : 99999000
          const r = product({ ...t, priceStyle, shopName: '다육농장' }, { ...SAMPLE_PRODUCT, no: 9999, price })
          expect(r.layout.items.map((i) => i.id)).toEqual(['number', 'price', 'buyer'])
          expect(item(r.layout.items, 'number').lines).toEqual(['번호: 9999'])
          expect(item(r.layout.items, 'price').lines).toEqual([priceStyle === 'WON' ? '가격: 99,999,999원' : '가격: 99,999 천원'])
          expect(item(r.layout.items, 'buyer').lines).toEqual(['닉네임: 우주천사'])
          for (const id of ['number', 'price']) expect(['fit', 'shrunk']).toContain(item(r.layout.items, id).method)
          expectCleanLayout(r.image, r.layout, hidden)
        }
      })

      it('20자 닉네임은 한 줄 …로 줄어 라벨이 만들어진다', () => {
        const long = '가나다라마바사아자차카타파하거너더러머버서'.slice(0, 20)
        const r = product(t, { ...SAMPLE_PRODUCT, buyer: { kind: 'youtube', name: long } })
        const buyer = item(r.layout.items, 'buyer')
        expect(buyer.method).toBe('truncated')
        expect(buyer.lines).toHaveLength(1)
        expect(buyer.lines[0]?.endsWith('…')).toBe(true)
        expectLayoutMatchesText(buyer, long)
        expectCleanLayout(r.image, r.layout, hidden)
      })

      it('배치 검사(AC-P1-12 (a)(c)(d)(e)) — 보통 데이터, 끈 상자 안에 검정 점 없음', () => {
        for (const data of [SAMPLE_PRODUCT, { ...SAMPLE_PRODUCT, buyer: { kind: 'sms' } }, { ...SAMPLE_PRODUCT, no: 1, price: 0 }]) {
          const r = product({ ...t, shopName: '다육농장' }, data)
          expectCleanLayout(r.image, r.layout, hidden)
          // 끈 상자 중 켠 상자와 겹치지 않는 날짜 상자는 통째로 비어 있다
          expect(blackIn(r.image, t.items.date)).toBe(0)
        }
      })

      it('꺼진 항목(가게 이름·품종·날짜)을 켜면 그 글이 배치 결과에 나오고 상자 밖으로 그리지 않는다 — 겹치면 경고일 뿐', () => {
        const on = withVisible({ ...t, shopName: '다육농장' }, { shop: true, name: true, date: true })
        const checked = validateTemplate(on)
        expect(checked.ok).toBe(true)
        expect(checked.warnings.length).toBeGreaterThan(0)
        const r = product(on)
        expect(r.layout.items.map((i) => i.id).sort()).toEqual([...PRODUCT_ITEMS].sort())
        expectLayoutMatchesText(item(r.layout.items, 'date'), '26.10.08')
        expectLayoutMatchesText(item(r.layout.items, 'shop'), '다육농장')
        expectLayoutMatchesText(item(r.layout.items, 'name'), '왕비뇌신금')
        expectCleanLayout(r.image, r.layout)
        // 날짜 하나만 켜면 겹침 없이 번호 줄 오른쪽에 찍힌다
        const dateOnly = withVisible(t, { date: true })
        const d = validateTemplate(dateOnly)
        expect(d.ok && d.warnings).toEqual([])
        const rd = product(dateOnly)
        expect(blackIn(rd.image, t.items.date)).toBeGreaterThan(0)
        expectCleanLayout(rd.image, rd.layout, [t.items.shop, t.items.name])
      })
    })
  }
})

describe('50×50과 포장 라벨 크기 (AC-N1-12)', () => {
  it('50×50 상품 기본 템플릿은 보통 템플릿(판매자 샘플 배치), 상자는 겹치지 않고 최악값이 20점 이상', () => {
    const t = { ...defaultTemplate('product', '50x50'), shopName: '다육농장' }
    expect(PRODUCT_ITEMS.every((id) => t.items[id].visible)).toBe(true)
    const boxes = Object.values(t.items)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i] as TemplateItem, boxes[j] as TemplateItem)).toBe(false)
    const it2 = t.items
    expect(Math.abs(it2.shop.x + it2.shop.width / 2 - 192)).toBeLessThanOrEqual(8)
    expect(it2.shop.y + it2.shop.height).toBeLessThanOrEqual(Math.min(it2.number.y, it2.price.y, it2.date.y))
    expect(it2.number.x + it2.number.width).toBeLessThanOrEqual(it2.price.x)
    expect(it2.price.x + it2.price.width).toBeLessThanOrEqual(it2.date.x)
    expect(Math.max(it2.number.y + it2.number.height, it2.price.y + it2.price.height, it2.date.y + it2.date.height)).toBeLessThanOrEqual(it2.name.y)
    expect(it2.name.y + it2.name.height).toBeLessThanOrEqual(it2.buyer.y)
    expect(validateTemplate(t).warnings).toEqual([])
    for (const priceStyle of ['WON', 'THOUSAND'] as const) {
      const r = product({ ...t, priceStyle }, { ...SAMPLE_PRODUCT, no: 9999, price: priceStyle === 'WON' ? 99999999 : 99999000 })
      expectCleanLayout(r.image, r.layout)
    }
    const normal = product(t)
    expect([normal.image.width, normal.image.height]).toEqual([384, 400])
    expectCleanLayout(normal.image, normal.layout)
  })

  it('50×50 포장 기본 템플릿: 한 쪽 20개, 네 자리 번호 20개 + 상품 합계 99,999,999원 + 상품 999개가 20점 이상', () => {
    const t = { ...defaultTemplate('packing', '50x50'), shopName: '다육농장' }
    expect(t.perPage).toBe(20)
    expect(validateTemplate(t).warnings).toEqual([])
    const boxes = Object.values(t.items)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i] as TemplateItem, boxes[j] as TemplateItem)).toBe(false)
    const numbers = Array.from({ length: 998 }, (_, i) => 9999 - i)
    const r = renderPackingLabels(env, t, { ...SAMPLE_PACKING, broadcasts: [{ title: '1부', numbers }, { title: '2부', numbers: [9999] }], subtotal: 99999999 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const first = r.pages[0]
    if (!first) throw new Error('쪽 없음')
    expect(item(first.layout.items, 'numbers').value.split(', ')).toHaveLength(20)
    expect(item(first.layout.items, 'count').lines).toEqual(['상품 999개'])
    expect(item(first.layout.items, 'subtotal').lines).toEqual(['상품 합계 99,999,999원'])
    for (const page of [first, r.pages.at(-1) ?? first]) expectCleanLayout(page.image, page.layout)
  })

  it('작은 크기의 포장 템플릿은 템플릿 검사 오류(문제 size 하나) — 포장 글·그림을 만들지 않는다', () => {
    for (const size of SMALL_LABEL_SIZES) {
      expect(canMakePackingLabel(size)).toBe(false)
      const t = { ...defaultTemplate('packing'), size }
      const r = validateTemplate(t)
      expect(r.ok, size).toBe(false)
      if (r.ok) continue
      expect(r.error.code).toBe('INVALID_TEMPLATE')
      expect(r.error.problems).toEqual([{ path: 'size', message: PACKING_SIZE_MESSAGE }])
      const text = computePackingText(t, SAMPLE_PACKING)
      expect(!text.ok && text.error.code).toBe('INVALID_TEMPLATE')
      const made: number[] = []
      const watched = { ...env, createContext: (w: number, h: number) => (made.push(w), env.createContext(w, h)) }
      const rendered = renderPackingLabels(watched, t, SAMPLE_PACKING)
      expect(!rendered.ok && rendered.error.code).toBe('INVALID_TEMPLATE')
      expect(made).toEqual([])
    }
    for (const size of PACKING_LABEL_SIZES) expect(validateTemplate(defaultTemplate('packing', size)).ok, size).toBe(true)
  })

  it('작은 크기의 기본 포장 템플릿은 없다 — 달라고 하면 만들지 않고 그 문장으로 알린다(RangeError)', () => {
    for (const size of SMALL_LABEL_SIZES) expect(() => defaultTemplate('packing', size)).toThrow(new RangeError(PACKING_SIZE_MESSAGE))
    expect(NO_PACKING_TEMPLATE).toBe(PACKING_SIZE_MESSAGE)
    expect(TEMPLATE_MESSAGES.packingSize).toBe(PACKING_SIZE_MESSAGE)
    expect(() => defaultTemplate('product', '40x30' as LabelSizeId)).toThrow(RangeError)
  })
})

describe('테스트 라벨 — 작은 크기 (AC-N1-13)', () => {
  const borders = (image: LabelBitmap) => {
    const { width, height } = image
    const row = (y: number) => Array.from({ length: width }, (_, x) => getPixel(image, x, y)).filter(Boolean).length
    const col = (x: number) => Array.from({ length: height }, (_, y) => getPixel(image, x, y)).filter(Boolean).length
    return [row(0) / width, row(height - 1) / width, col(0) / height, col(width - 1) / height]
  }

  for (const size of SMALL_LABEL_SIZES) {
    it(`${size}: 한글 확인 글과 숫자·날짜 두 줄, 가게 이름·테스트 라벨 없음, 20점 이상, 네 변 테두리`, () => {
      const r = renderTestLabel(env, { shopName: '다육농장', date: '2026-10-20', size })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect([r.image.width, r.image.height]).toEqual([labelSizeInfo(size).widthDots, labelSizeInfo(size).heightDots])
      expect(r.layout.items.flatMap((i) => i.lines)).toEqual(['한글 확인: 가나다 똠햏', '0123456789 26.10.20'])
      expect(r.layout.items.map((i) => i.lines.join(''))).not.toContain('테스트 라벨')
      expect(r.layout.missing).toEqual([])
      for (const it2 of r.layout.items) expect(it2.fontSize, it2.id).toBeGreaterThanOrEqual(20)
      for (const ratio of borders(r.image)) expect(ratio).toBeGreaterThanOrEqual(0.9)
      expect(TEST_LABEL_SMALL_HANGUL).toBe('한글 확인: 가나다 똠햏')
    })
  }

  it('50×50 테스트 라벨은 보통 테스트 라벨이다', () => {
    const r = renderTestLabel(env, { shopName: '다육농장', date: '2026-10-20', size: '50x50' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.layout.items.flatMap((i) => i.lines)).toEqual(['다육농장', '테스트 라벨', '한글 확인: 가나다 똠햏 ㄱㄴㄷ', '0123456789', '26.10.20'])
    for (const ratio of borders(r.image)) expect(ratio).toBeGreaterThanOrEqual(0.9)
  })

  it('목록 밖 크기는 크기 오류 문장으로 INVALID_TEMPLATE', () => {
    const r = renderTestLabel(env, { shopName: '', date: '2026-10-20', size: 'tape12x30' as LabelSizeId })
    expect(!r.ok && r.error.problems).toEqual([{ path: 'size', message: SIZE_MESSAGE }])
  })
})

// ── 내보내기 (AC-N1-14) ──

function pngChunks(bytes: Uint8Array): { type: string; body: Uint8Array }[] {
  const out: { type: string; body: Uint8Array }[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at < bytes.length) {
    const length = view.getUint32(at)
    out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), body: bytes.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return out
}

interface Placed {
  readonly stream: PDFRawStream
  readonly matrix: number[]
}

function placedImages(doc: PDFDocument, page: PDFPage): Placed[] {
  const content = doc.context.lookup(page.node.get(PDFName.of('Contents')) as PDFRef, PDFStream) as PDFRawStream
  const text = new TextDecoder().decode(content.contents)
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
  return [...text.matchAll(/q ([-\d. ]+) cm \/(\w+) Do Q/g)].map((m) => ({
    stream: doc.context.lookup(xobjects?.get(PDFName.of(m[2] ?? '')) as PDFRef, PDFStream) as PDFRawStream,
    matrix: (m[1] ?? '').split(' ').map(Number),
  }))
}

function streamBitmap(stream: PDFRawStream): LabelBitmap {
  const num = (key: string) => (stream.dict.lookup(PDFName.of(key), PDFNumber) as PDFNumber).asNumber()
  return { width: num('Width'), height: num('Height'), data: unzlibSync(stream.contents) }
}

function sampleLabel(size: LabelSizeId, no = 194): LabelBitmap {
  return product({ ...defaultTemplate('product', size), shopName: '다육농장' }, { ...SAMPLE_PRODUCT, no }).image
}

/** P1 PDF 바이트를 고정할 때 쓴 결정적 무늬 그림 (글꼴과 상관없다) */
function pattern(width: number, height: number, seed: number): LabelBitmap {
  const b = createBitmap(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if ((x * 7 + y * 13 + seed) % 11 === 0 || x === 0 || y === 0 || x === width - 1 || y === height - 1) setPixel(b, x, y, true)
  }
  return b
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('PNG·PDF·A4 — 새 크기 (AC-N1-14)', () => {
  it('새 크기의 PNG는 그 그림 그대로(두 색, pHYs 7992점/m) — 바우아토 전용 롤(50×30·50×15·50×50) 포함', async () => {
    for (const size of ['50x15', '50x50', 'tape12x40', 'tape15x30', 'tape15x50', '50x30'] as const) {
      const image = sampleLabel(size)
      const png = encodeLabelPng(image)
      expect(png.ok, size).toBe(true)
      if (!png.ok) continue
      const chunks = pngChunks(png.bytes)
      expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
      const phys = chunks[1]?.body ?? new Uint8Array(9)
      const view = new DataView(phys.buffer, phys.byteOffset, 9)
      expect([view.getUint32(0), view.getUint32(4), view.getUint8(8)]).toEqual([7992, 7992, 1])
      const decoded = await loadImage(Buffer.from(png.bytes))
      const ctx = createCanvas(decoded.width, decoded.height).getContext('2d')
      ctx.drawImage(decoded, 0, 0)
      const rgba = ctx.getImageData(0, 0, decoded.width, decoded.height).data
      const colors = new Set<string>()
      for (let i = 0; i < rgba.length; i += 4) colors.add(`${String(rgba[i])},${String(rgba[i + 1])},${String(rgba[i + 2])}`)
      expect([...colors].sort()).toEqual(['0,0,0', '255,255,255'])
      expect(bitmapsEqual(oneBitFromRgba(rgba, decoded.width, decoded.height), image)).toBe(true)
    }
  })

  it('라벨 크기 PDF의 쪽은 읽는 방향 크기, 그림은 실제 크기로 가로·세로 가운데에 손실 없이', async () => {
    const cases = [
      // 크기, 쪽 폭·높이(pt), 그림 폭·높이(pt), 그림 왼쪽·아래(pt)
      ['tape12x40', 113.39, 34.02, 113.39, 34.02, 0, 0],
      ['tape15x30', 85.04, 42.52, 85.04, 34.02, 0, 4.25],
      ['tape15x50', 141.73, 42.52, 141.73, 34.02, 0, 4.25],
      ['50x15', 141.73, 42.52, 136.06, 42.52, 2.83, 0],
      ['50x50', 141.73, 141.73, 136.06, 141.73, 2.83, 0],
    ] as const
    for (const [size, pw, ph, iw, ih, ix, iy] of cases) {
      const images = [sampleLabel(size, 1), sampleLabel(size, 2)]
      const pdf = createLabelPdf(images)
      expect(pdf.ok, size).toBe(true)
      if (!pdf.ok) continue
      expect(pdf.pages).toBe(2)
      const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false })
      doc.getPages().forEach((page, i) => {
        expect(page.getWidth()).toBeCloseTo(pw, 2)
        expect(page.getHeight()).toBeCloseTo(ph, 2)
        const placed = placedImages(doc, page)
        expect(placed).toHaveLength(1)
        const [a, b, c, d, e, f] = placed[0]?.matrix ?? []
        expect([b, c]).toEqual([0, 0])
        expect(a).toBeCloseTo(iw, 2)
        expect(d).toBeCloseTo(ih, 2)
        expect(e).toBeCloseTo(ix, 2)
        expect(f).toBeCloseTo(iy, 2)
        expect(bitmapsEqual(streamBitmap(placed[0]?.stream as PDFRawStream), images[i] as LabelBitmap)).toBe(true)
      })
    }
  })

  it('A4 모아찍기: 장 수 50×15 48·50×50 15·테이프 12×40 76·15×30 96·15×50 48, 칸 = 읽는 방향 크기, 그림은 칸 가운데', async () => {
    const expected = { '50x15': 48, '50x50': 15, tape12x40: 76, tape15x30: 96, tape15x50: 48 } as const
    for (const [size, perPage] of Object.entries(expected) as [LabelSizeId, number][]) {
      expect(a4Layout(size).perPage).toBe(perPage)
      const one = sampleLabel(size)
      const pdf = createA4Pdf(Array.from({ length: perPage + 1 }, () => one))
      expect(pdf.ok && pdf.pages, size).toBe(2)
      if (!pdf.ok) continue
      const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false })
      const pages = doc.getPages()
      expect(pages.map((p) => placedImages(doc, p).length)).toEqual([perPage, 1])
      const info = labelSizeInfo(size)
      const imgW = one.width / 8
      const imgH = one.height / 8
      for (const k of [0, 1, perPage - 1]) {
        const cell = a4Cell(size, k)
        const [a, , , d, e, f] = placedImages(doc, pages[0] as PDFPage)[k]?.matrix ?? []
        expect(a).toBeCloseTo(imgW * PT_PER_MM, 2)
        expect(d).toBeCloseTo(imgH * PT_PER_MM, 2)
        expect(e).toBeCloseTo((cell.leftMm + (info.widthMm - imgW) / 2) * PT_PER_MM, 2)
        expect(f).toBeCloseTo((297 - cell.topMm - info.heightMm + (info.heightMm - imgH) / 2) * PT_PER_MM, 2)
      }
    }
  })

  it('기존 세 크기의 PDF·A4 바이트는 P1 때와 같다 (같은 그림 → 같은 바이트, SHA-256 고정)', () => {
    // 값은 N1 변경 전(P1 코드, 커밋 070218b)으로 만든 바이트의 SHA-256이다
    const pinned = {
      '384x240': ['78a089bfcea74104650ef235c714017ce56a864a5f90512b36f6ae41025491a9', 'ace4e1e62240afff7523674081afb594624f8907c70c07fd2e2f55542a5beea4'],
      '384x160': ['175c855cc0c51c575ac7b2593bf80eb7c4cb2842d57f9bdbe751d9755f61457f', 'e5d42c8fe4b85bc3695015ce744d95060400a0059cea8685aad8e433051d3299'],
      '384x320': ['cbefb29e40657267d7f6d8e680f13bbf93f63c60d5f1b246bbc69ffa18df5702', '84a9bd8304d7ddd096f53da66d5117b4cb608a7a9913b1a401f768dc7e19bba5'],
    } as const
    for (const [key, [labelHash, a4Hash]] of Object.entries(pinned)) {
      const [w, h] = key.split('x').map(Number) as [number, number]
      const images = [pattern(w, h, 1), pattern(w, h, 2), pattern(w, h, 3)]
      const label = createLabelPdf(images)
      const a4 = createA4Pdf(Array.from({ length: 26 }, (_, i) => images[i % 3] as LabelBitmap))
      expect(label.ok && sha256(label.bytes), key).toBe(labelHash)
      expect(a4.ok && sha256(a4.bytes), key).toBe(a4Hash)
    }
  })

  it('크기가 다른 그림(테이프와 50mm)을 섞으면 PDF를 만들지 않는다', () => {
    for (const make of [createA4Pdf, createLabelPdf]) {
      const r = make([sampleLabel('tape12x40'), sampleLabel('50x30')])
      expect(!r.ok && r.error.code).toBe('MIXED_SIZES')
    }
  })
})

describe('지금 템플릿은 그대로 (AC-N1-60)', () => {
  const templatesText = (make: DefaultsOf): string => {
    let text = ''
    for (const size of LABEL_SIZES) for (const kind of ['product', 'packing'] as const) text += `${size} ${kind} ${templateToJson(make(kind, size))}\n`
    return text
  }

  it('50×30·50×20·50×40 상품·포장 기본 템플릿의 JSON이 P1과 같다 — D-STB-01 날짜 칸 두 값만 되돌리면 (SHA-256 고정)', () => {
    // N1 변경 전(커밋 070218b)의 같은 글의 SHA-256. D-STB-01(계약 교체)로 바뀐 것은 상품 템플릿 날짜 칸 x 292→290 · 폭 88→90뿐이라,
    // 그 두 값만 옛 값으로 되돌리면 옛 고정값과 같아야 한다
    expect(createHash('sha256').update(templatesText(revertStbDateBox)).digest('hex')).toBe('1354c2fdf2eacc0226d9ac4fb0d063a8d4fa255da74a45b3ca9e7d37b97c8395')
  })

  it('기존 저장 템플릿 JSON (D-STB-01 날짜 칸 x 290 · 폭 90, SHA-256 고정)', () => {
    expect(createHash('sha256').update(templatesText(beforeLargeFont)).digest('hex')).toBe('3ac970cfbad7fca9ecef01b2175c661adf6050c5a8ccd0f14748e5ee1f955a75')
  })
})

describe('화면 문장 (AC-N1-62)', () => {
  it('새 문장은 쉬운 한국어이고 영어·개발 용어가 없다', () => {
    for (const text of [TEMPLATE_MESSAGES.size, TEMPLATE_MESSAGES.packingSize, NO_PACKING_TEMPLATE, TEST_LABEL_SMALL_HANGUL, ...ALL_LABEL_SIZES.map(labelSizeName)]) {
      expect(text).toMatch(/[가-힣]|^\d+×\d+$/)
      // 단위 mm만 허용한다
      expect(text.replace(/mm/g, '')).not.toMatch(/[A-Za-z]/)
    }
  })
})
