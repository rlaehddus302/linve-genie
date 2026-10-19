// 내보내기 (AC-P1-30~33, L-6). PNG는 Node 캔버스로, PDF는 pdf-lib로 다시 읽어 확인한다(만든 쪽과 다른 해석기).
import { loadImage, createCanvas } from '@napi-rs/canvas'
import { unzlibSync } from 'fflate'
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, type PDFPage, type PDFRawStream, type PDFRef } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LABEL_SIZES,
  PT_PER_MM,
  a4Cell,
  a4Layout,
  bitmapsEqual,
  createA4Pdf,
  createBitmap,
  createLabelPdf,
  defaultTemplate,
  encodeLabelPng,
  getPixel,
  labelSizeInfo,
  oneBitFromRgba,
  renderProductLabel,
  setPixel,
  toPreviewRgba,
  type LabelBitmap,
  type LabelSizeId,
} from '../src/index.ts'
import { SAMPLE_PRODUCT, nodeEnv } from './helpers.ts'

const env = nodeEnv()

function label(no: number, size: LabelSizeId = '50x30'): LabelBitmap {
  const r = renderProductLabel(env, { ...defaultTemplate('product', size), shopName: '다육농장' }, { ...SAMPLE_PRODUCT, no, buyer: { kind: 'youtube', name: `구매자${String(no)}` } })
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.image
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** PNG 덩어리 목록 */
function pngChunks(bytes: Uint8Array): { type: string; body: Uint8Array }[] {
  const out: { type: string; body: Uint8Array }[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at < bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    out.push({ type, body: bytes.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return out
}

describe('PNG (AC-P1-30)', () => {
  for (const size of LABEL_SIZES) {
    it(`${size}: 점 수 같음, 검정·흰색 두 색만, pHYs 7992점/m, 다시 읽으면 같은 1비트 그림`, async () => {
      const image = label(194, size)
      const png = encodeLabelPng(image)
      expect(png.ok).toBe(true)
      if (!png.ok) return
      const chunks = pngChunks(png.bytes)
      expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
      const phys = new DataView(chunks[1]?.body.buffer ?? new ArrayBuffer(9), chunks[1]?.body.byteOffset, 9)
      expect([phys.getUint32(0), phys.getUint32(4), phys.getUint8(8)]).toEqual([7992, 7992, 1])
      const decoded = await loadImage(Buffer.from(png.bytes))
      expect([decoded.width, decoded.height]).toEqual([image.width, image.height])
      const canvas = createCanvas(decoded.width, decoded.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(decoded, 0, 0)
      const rgba = ctx.getImageData(0, 0, decoded.width, decoded.height).data
      const colors = new Set<string>()
      for (let i = 0; i < rgba.length; i += 4) colors.add(`${String(rgba[i])},${String(rgba[i + 1])},${String(rgba[i + 2])},${String(rgba[i + 3])}`)
      expect([...colors].sort()).toEqual(['0,0,0,255', '255,255,255,255'])
      const back = oneBitFromRgba(rgba, decoded.width, decoded.height)
      expect(Array.from(back.data)).toEqual(Array.from(image.data))
      // 같은 그림이면 같은 바이트
      const again = encodeLabelPng(image)
      expect(again.ok && Buffer.from(again.bytes).equals(Buffer.from(png.bytes))).toBe(true)
    })
  }

  it('폭이 8의 배수가 아닌 그림도 점 수 그대로 (줄 끝 남는 비트는 흰색)', async () => {
    const image = createBitmap(13, 3)
    setPixel(image, 0, 0, true)
    setPixel(image, 12, 2, true)
    const png = encodeLabelPng(image)
    expect(png.ok).toBe(true)
    if (!png.ok) return
    const decoded = await loadImage(Buffer.from(png.bytes))
    const ctx = createCanvas(13, 3).getContext('2d')
    ctx.drawImage(decoded, 0, 0)
    expect(bitmapsEqual(oneBitFromRgba(ctx.getImageData(0, 0, 13, 3).data, 13, 3), image)).toBe(true)
  })

  it('형식이 틀린 그림은 PNG를 만들지 않는다', () => {
    const r = encodeLabelPng({ width: 8, height: 2, data: new Uint8Array(1) })
    expect(!r.ok && r.error.code).toBe('INVALID_IMAGE')
  })
})

interface PlacedImage {
  name: string
  stream: PDFRawStream
  /** cm 연산자 [a b c d e f] */
  matrix: number[]
}

function pageContent(doc: PDFDocument, page: PDFPage): string {
  const stream = doc.context.lookup(page.node.get(PDFName.of('Contents')) as PDFRef, PDFStream) as PDFRawStream
  return new TextDecoder().decode(stream.contents)
}

function pageImages(doc: PDFDocument, page: PDFPage): PlacedImage[] {
  const resources = page.node.Resources()
  const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict)
  const text = pageContent(doc, page)
  const out: PlacedImage[] = []
  for (const m of text.matchAll(/q ([-\d. ]+) cm \/(\w+) Do Q/g)) {
    const name = m[2] ?? ''
    const ref = xobjects?.get(PDFName.of(name))
    const img = doc.context.lookup(ref as PDFRef, PDFStream) as PDFRawStream
    out.push({ name, stream: img, matrix: (m[1] ?? '').split(' ').map(Number) })
  }
  return out
}

function imageBitmap(stream: PDFRawStream): LabelBitmap {
  const dict = stream.dict
  const num = (key: string) => (dict.lookup(PDFName.of(key), PDFNumber) as PDFNumber).asNumber()
  expect(dict.get(PDFName.of('BitsPerComponent'))?.toString()).toBe('1')
  expect(dict.get(PDFName.of('ColorSpace'))?.toString()).toBe('/DeviceGray')
  expect(dict.get(PDFName.of('Decode'))?.toString()).toBe('[ 1 0 ]')
  expect(dict.get(PDFName.of('Filter'))?.toString()).toBe('/FlateDecode')
  return { width: num('Width'), height: num('Height'), data: unzlibSync(stream.contents) }
}

async function expectDocumentRules(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const prefs = doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict)
  expect(prefs.get(PDFName.of('PrintScaling'))?.toString()).toBe('/None')
  expect(doc.getCreationDate()).toBeUndefined()
  expect(doc.getModificationDate()).toBeUndefined()
  expect(doc.getAuthor()).toBeUndefined()
  expect(doc.getTitle()).toBeUndefined()
  expect(doc.getProducer()).toBeUndefined()
  expect(new TextDecoder('latin1').decode(bytes)).not.toMatch(/구매자|CreationDate|ModDate|\/Info/)
  return doc
}

describe('라벨 크기 PDF (AC-P1-31)', () => {
  it('50×30 그림 3장 → 3쪽, 쪽마다 141.73×85.04pt, 그림 하나(384×240 그대로), 놓인 크기 136.06×85.04pt·왼쪽 2.83pt', async () => {
    const images = [label(1), label(2), label(3)]
    const pdf = createLabelPdf(images)
    expect(pdf.ok).toBe(true)
    if (!pdf.ok) return
    expect(pdf.pages).toBe(3)
    const doc = await expectDocumentRules(pdf.bytes)
    expect(doc.getPageCount()).toBe(3)
    doc.getPages().forEach((page, i) => {
      const { width, height } = page.getSize()
      expect(width).toBeCloseTo(141.73, 2)
      expect(height).toBeCloseTo(85.04, 2)
      const placed = pageImages(doc, page)
      expect(placed).toHaveLength(1)
      const [a, b, c, d, e, f] = placed[0]?.matrix ?? []
      expect(a).toBeCloseTo(136.06, 2)
      expect(d).toBeCloseTo(85.04, 2)
      expect([b, c, f]).toEqual([0, 0, 0])
      expect(e).toBeCloseTo(2.83, 2)
      const back = imageBitmap(placed[0]?.stream as PDFRawStream)
      expect(bitmapsEqual(back, images[i] as LabelBitmap)).toBe(true)
    })
  })

  it('같은 그림이면 두 번 만든 PDF가 바이트까지 같다 (Date·Math.random·시간대를 쓰지 않는다)', () => {
    const images = [label(1), label(2)]
    const a = createLabelPdf(images)
    const tz = process.env.TZ
    process.env.TZ = 'Pacific/Honolulu'
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random')
    })
    try {
      const b = createLabelPdf(images)
      const c = createA4Pdf(images)
      const d = createA4Pdf(images)
      expect(a.ok && b.ok && Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
      expect(c.ok && d.ok && Buffer.from(c.bytes).equals(Buffer.from(d.bytes))).toBe(true)
    } finally {
      process.env.TZ = tz
    }
  })

  it('50×20·50×40도 쪽 크기 = 라벨 크기', async () => {
    for (const [size, h] of [['50x20', 20], ['50x40', 40]] as const) {
      const pdf = createLabelPdf([label(1, size)])
      expect(pdf.ok).toBe(true)
      if (!pdf.ok) return
      const doc = await PDFDocument.load(pdf.bytes)
      expect(doc.getPage(0).getHeight()).toBeCloseTo(h * PT_PER_MM, 2)
    }
  })

  it('빈 목록·형식이 틀린 그림은 PDF를 만들지 않는다', () => {
    expect(createLabelPdf([]).ok).toBe(false)
    const odd = createLabelPdf([createBitmap(100, 100)])
    expect(!odd.ok && odd.error.code).toBe('INVALID_IMAGE')
  })
})

describe('A4 모아찍기 PDF (AC-P1-32)', () => {
  it('칸 위치: 열 = i mod 열 수, 줄 = floor(i ÷ 열 수) mod 줄 수, 왼쪽 = 10 + 열 × (폭 + 2), 위 = 10 + 줄 × (높이 + 2)', () => {
    const expected = { '50x30': [3, 8, 24], '50x20': [3, 12, 36], '50x40': [3, 6, 18] } as const
    for (const size of LABEL_SIZES) {
      const layout = a4Layout(size)
      expect([layout.columns, layout.rows, layout.perPage]).toEqual(expected[size])
      const h = Number(size.split('x')[1])
      for (let i = 0; i < layout.perPage * 2 + 3; i++) {
        const cell = a4Cell(size, i)
        const col = i % layout.columns
        const row = Math.floor(i / layout.columns) % layout.rows
        expect([cell.column, cell.row, cell.page]).toEqual([col, row, Math.floor(i / layout.perPage)])
        expect(cell.leftMm).toBe(10 + col * 52)
        expect(cell.topMm).toBe(10 + row * (h + 2))
        // 칸이 종이 안에 있다
        expect(cell.leftMm + cell.widthMm).toBeLessThanOrEqual(200)
        expect(cell.topMm + cell.heightMm).toBeLessThanOrEqual(287)
      }
    }
  })

  it('크기 도우미는 L-1 목록 밖 크기를 받지 않는다(목록 밖 크기의 그림·칸을 만들지 않게) — TD-P1-003', () => {
    expect(LABEL_SIZES.map((size) => [labelSizeInfo(size).widthDots, labelSizeInfo(size).heightDots])).toEqual([
      [384, 240],
      [384, 160],
      [384, 320],
    ])
    for (const size of ['40x30', '100x100', 'abc', ''] as unknown as LabelSizeId[]) {
      expect(() => labelSizeInfo(size), size).toThrow(RangeError)
      expect(() => a4Layout(size), size).toThrow(RangeError)
      expect(() => a4Cell(size, 0), size).toThrow(RangeError)
    }
  })

  it('50×30 라벨 25장 → A4 세로 2쪽(24장·1장), 칸마다 실제 크기로 가로 가운데, 칸 테두리에 0.2mm 회색 자르는 선', async () => {
    const images = Array.from({ length: 25 }, (_, i) => label(i + 1))
    const pdf = createA4Pdf(images)
    expect(pdf.ok).toBe(true)
    if (!pdf.ok) return
    expect(pdf.pages).toBe(2)
    const doc = await expectDocumentRules(pdf.bytes)
    const pages = doc.getPages()
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page.getWidth()).toBeCloseTo(595.28, 2)
      expect(page.getHeight()).toBeCloseTo(841.89, 2)
    }
    const counts = pages.map((p) => pageImages(doc, p).length)
    expect(counts).toEqual([24, 1])
    pages.forEach((page, p) => {
      const placed = pageImages(doc, page)
      const text = pageContent(doc, page)
      expect(text).toMatch(/^q 0\.6 G 0\.5669 w\n/)
      const rects = [...text.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re S/g)].map((m) => m.slice(1, 5).map(Number))
      expect(rects).toHaveLength(placed.length)
      placed.forEach((img, k) => {
        const i = p * 24 + k
        const cell = a4Cell('50x30', i)
        const [a, , , d, e, f] = img.matrix
        expect(a).toBeCloseTo(48 * PT_PER_MM, 2)
        expect(d).toBeCloseTo(30 * PT_PER_MM, 2)
        expect(e).toBeCloseTo((cell.leftMm + 1) * PT_PER_MM, 2)
        expect(f).toBeCloseTo((297 - cell.topMm - 30) * PT_PER_MM, 2)
        const [rx, ry, rw, rh] = rects[k] ?? []
        expect(rx).toBeCloseTo(cell.leftMm * PT_PER_MM, 2)
        expect(ry).toBeCloseTo((297 - cell.topMm - 30) * PT_PER_MM, 2)
        expect(rw).toBeCloseTo(50 * PT_PER_MM, 2)
        expect(rh).toBeCloseTo(30 * PT_PER_MM, 2)
        expect(bitmapsEqual(imageBitmap(img.stream), images[i] as LabelBitmap)).toBe(true)
      })
    })
  })

  it('크기가 다른 그림을 섞으면 쉬운 한국어 오류이고 PDF를 만들지 않는다', () => {
    for (const make of [createA4Pdf, createLabelPdf]) {
      const r = make([label(1), label(2, '50x20')])
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.code).toBe('MIXED_SIZES')
      expect(r.error.message).toBe('크기가 다른 라벨은 한 PDF에 넣을 수 없어요. 같은 크기끼리 모아 주세요.')
      expect('bytes' in r).toBe(false)
    }
  })

  it('A4 장 수 경계: 24·25·48·49장 → 1·2·2·3쪽', () => {
    const one = label(1)
    for (const [n, pages] of [[24, 1], [25, 2], [48, 2], [49, 3]] as const) {
      const r = createA4Pdf(Array.from({ length: n }, () => one))
      expect(r.ok && r.pages).toBe(pages)
    }
  })
})

describe('미리보기 = 출력 (AC-P1-33)', () => {
  it('1비트 그림 → RGBA 정수 배 확대(가장 가까운 점). 줄여 읽으면 원래 그림과 같다', () => {
    const image = label(194)
    for (const scale of [1, 2, 3]) {
      const preview = toPreviewRgba(image, scale)
      expect([preview.width, preview.height]).toEqual([image.width * scale, image.height * scale])
      const sampled = createBitmap(image.width, image.height)
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          // 확대한 칸 안의 점이 모두 같은 색이다
          const colors = new Set<number>()
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) colors.add(preview.data[((y * scale + dy) * preview.width + x * scale + dx) * 4] ?? -1)
          expect(colors.size).toBe(1)
          setPixel(sampled, x, y, [...colors][0] === 0)
        }
      }
      expect(bitmapsEqual(sampled, image)).toBe(true)
    }
    expect(() => toPreviewRgba(image, 0)).toThrow()
    expect(() => toPreviewRgba(image, 1.5)).toThrow()
  })

  it('PNG·PDF·미리보기는 렌더한 그림 객체 하나만 받는다 — 렌더 환경(캔버스)을 받지 않아 다시 그릴 수 없다', () => {
    const image = label(194)
    // 인자는 그림(들)과 확대 배수뿐이다
    expect([encodeLabelPng.length, createLabelPdf.length, createA4Pdf.length, toPreviewRgba.length]).toEqual([1, 1, 1, 1])
    const png = encodeLabelPng(image)
    const pdf = createLabelPdf([image])
    expect(png.ok && pdf.ok).toBe(true)
    // 그림을 바꾸지 않는다
    expect(bitmapsEqual(image, label(194))).toBe(true)
    // 그림 형식 하나: 왼쪽 점이 높은 비트, 1 = 검정
    const one = createBitmap(8, 1)
    setPixel(one, 0, 0, true)
    expect(one.data[0]).toBe(0x80)
    expect(getPixel(one, 0, 0)).toBe(true)
  })
})
