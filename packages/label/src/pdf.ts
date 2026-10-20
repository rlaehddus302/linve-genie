// PDF 내보내기 (LABEL_RULES L-6, D-P1-07) — 라벨 크기 PDF와 A4 모아찍기 PDF.
// 라벨 그림(1비트)을 다시 그리지 않고 그대로(손실 없이, 원래 점 수로) 넣는다. 인쇄 대화상자가 줄이지 않게 PrintScaling None,
// 문서 정보(만든 시각·작성자·제목)는 넣지 않는다. 같은 그림이면 같은 바이트다 — 필요한 만큼만 직접 쓴다.
import { zlibSync } from 'fflate'
import { isLabelBitmap, type LabelBitmap } from './bitmap.ts'
import { LABEL_MESSAGES, type LabelError } from './errors.ts'
import { A4_HEIGHT_MM, A4_WIDTH_MM, DOTS_PER_MM, a4Cell, labelSizeInfo, sizeOfBitmap, type LabelSizeId } from './sizes.ts'

/** 1mm = 72/25.4pt */
export const PT_PER_MM = 72 / 25.4
/** 자르는 선: 0.2mm, 회색 */
export const CUT_LINE_MM = 0.2
export const CUT_LINE_GRAY = 0.6

export type PdfResult = { readonly ok: true; readonly bytes: Uint8Array; readonly pages: number } | { readonly ok: false; readonly error: LabelError }

/** 소수 넷째 자리까지, 끝 0은 뺀다 (toFixed는 실행 환경 언어와 상관없다) */
function num(value: number): string {
  const text = value.toFixed(4).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}

const encoder = new TextEncoder()

class PdfWriter {
  private readonly parts: Uint8Array[] = []
  private length = 0
  private readonly offsets: number[] = []

  constructor() {
    this.write('%PDF-1.7\n')
    this.raw(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // 이진 파일 표시 주석
  }

  private raw(bytes: Uint8Array): void {
    this.parts.push(bytes)
    this.length += bytes.length
  }

  private write(text: string): void {
    this.raw(encoder.encode(text))
  }

  /** 객체 번호를 미리 잡는다 (1부터) */
  reserve(): number {
    this.offsets.push(-1)
    return this.offsets.length
  }

  object(id: number, body: string): void {
    this.offsets[id - 1] = this.length
    this.write(`${String(id)} 0 obj\n${body}\nendobj\n`)
  }

  stream(id: number, dict: string, data: Uint8Array): void {
    this.offsets[id - 1] = this.length
    this.write(`${String(id)} 0 obj\n<< ${dict} /Length ${String(data.length)} >>\nstream\n`)
    this.raw(data)
    this.write('\nendstream\nendobj\n')
  }

  finish(rootId: number): Uint8Array {
    const xref = this.length
    let table = `xref\n0 ${String(this.offsets.length + 1)}\n0000000000 65535 f \n`
    for (const offset of this.offsets) table += `${String(offset).padStart(10, '0')} 00000 n \n`
    this.write(`${table}trailer\n<< /Size ${String(this.offsets.length + 1)} /Root ${String(rootId)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`)
    const out = new Uint8Array(this.length)
    let at = 0
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

interface PlacedImage {
  readonly bitmap: LabelBitmap
  /** 놓을 자리 (pt, PDF 좌표 — 왼쪽 아래 기준) */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface PdfPage {
  readonly width: number
  readonly height: number
  readonly images: readonly PlacedImage[]
  /** 자르는 선 상자들 (pt) */
  readonly cutBoxes: readonly { x: number; y: number; width: number; height: number }[]
}

function writePdf(pages: readonly PdfPage[]): Uint8Array {
  const w = new PdfWriter()
  const catalog = w.reserve()
  const pagesId = w.reserve()
  const pageIds: number[] = []
  for (const page of pages) {
    const pageId = w.reserve()
    const contentId = w.reserve()
    const imageIds = page.images.map(() => w.reserve())
    pageIds.push(pageId)
    let content = ''
    if (page.cutBoxes.length > 0) {
      content += `q ${num(CUT_LINE_GRAY)} G ${num(CUT_LINE_MM * PT_PER_MM)} w\n`
      for (const b of page.cutBoxes) content += `${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)} re S\n`
      content += 'Q\n'
    }
    page.images.forEach((img, i) => {
      content += `q ${num(img.width)} 0 0 ${num(img.height)} ${num(img.x)} ${num(img.y)} cm /Im${String(i)} Do Q\n`
    })
    const xobjects = imageIds.map((id, i) => `/Im${String(i)} ${String(id)} 0 R`).join(' ')
    w.object(
      pageId,
      `<< /Type /Page /Parent ${String(pagesId)} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /XObject << ${xobjects} >> >> /Contents ${String(contentId)} 0 R >>`,
    )
    w.stream(contentId, '', encoder.encode(content))
    page.images.forEach((img, i) => {
      // 1비트 흑백, Decode [1 0]: 라벨 형식의 1(검정)이 PDF의 0(검정)이 된다 — 바이트를 바꾸지 않고 그대로 담는다
      w.stream(
        imageIds[i] as number,
        `/Type /XObject /Subtype /Image /Width ${String(img.bitmap.width)} /Height ${String(img.bitmap.height)} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Interpolate false /Filter /FlateDecode`,
        zlibSync(img.bitmap.data, { level: 9 }),
      )
    })
  }
  w.object(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageIds.length)} >>`)
  w.object(catalog, `<< /Type /Catalog /Pages ${String(pagesId)} 0 R /ViewerPreferences << /PrintScaling /None >> >>`)
  return w.finish(catalog)
}

/** 그림들이 모두 같은 크기(L-1 목록)인지 확인하고 그 크기를 돌려준다 */
function commonSize(bitmaps: readonly LabelBitmap[]): { ok: true; size: LabelSizeId } | { ok: false; error: LabelError } {
  if (bitmaps.length === 0) return { ok: false, error: { code: 'NO_LABELS', message: LABEL_MESSAGES.noLabels } }
  let size: LabelSizeId | undefined
  for (const bitmap of bitmaps) {
    const own = isLabelBitmap(bitmap) ? sizeOfBitmap(bitmap.width, bitmap.height) : undefined
    if (own === undefined) return { ok: false, error: { code: 'INVALID_IMAGE', message: LABEL_MESSAGES.invalidImage } }
    if (size !== undefined && own !== size) return { ok: false, error: { code: 'MIXED_SIZES', message: LABEL_MESSAGES.mixedSizes } }
    size = own
  }
  return { ok: true, size: size as LabelSizeId }
}

/** 그림의 실제 크기 (mm): 점 ÷ 8 */
const imageMm = (bitmap: LabelBitmap): { width: number; height: number } => ({ width: bitmap.width / DOTS_PER_MM, height: bitmap.height / DOTS_PER_MM })

/**
 * 라벨 크기 PDF: 라벨 한 장 = 한 쪽, 쪽 크기 = 라벨 크기(50×30mm = 141.73×85.04pt).
 * 그림은 실제 크기(384점 = 48mm)로 쪽 가로 가운데·세로 꽉 차게.
 */
export function createLabelPdf(bitmaps: readonly LabelBitmap[]): PdfResult {
  const checked = commonSize(bitmaps)
  if (!checked.ok) return checked
  const info = labelSizeInfo(checked.size)
  const pages: PdfPage[] = bitmaps.map((bitmap) => {
    const mm = imageMm(bitmap)
    return {
      width: info.widthMm * PT_PER_MM,
      height: info.heightMm * PT_PER_MM,
      images: [{ bitmap, x: ((info.widthMm - mm.width) / 2) * PT_PER_MM, y: (info.heightMm - mm.height) * PT_PER_MM, width: mm.width * PT_PER_MM, height: mm.height * PT_PER_MM }],
      cutBoxes: [],
    }
  })
  return { ok: true, bytes: writePdf(pages), pages: pages.length }
}

/**
 * A4 모아찍기 PDF: A4 세로, 여백 10mm, 칸 사이 2mm, 칸 = 라벨 크기, 왼쪽 위부터 줄마다 채운다(a4Cell).
 * 칸마다 라벨 그림을 실제 크기로 칸 가로 가운데에 넣고, 칸 테두리에 자르는 선(0.2mm, 회색)을 긋는다. 넘치면 다음 쪽.
 */
export function createA4Pdf(bitmaps: readonly LabelBitmap[]): PdfResult {
  const checked = commonSize(bitmaps)
  if (!checked.ok) return checked
  const size = checked.size
  const pages: { images: PlacedImage[]; cutBoxes: { x: number; y: number; width: number; height: number }[] }[] = []
  bitmaps.forEach((bitmap, i) => {
    const cell = a4Cell(size, i)
    while (pages.length <= cell.page) pages.push({ images: [], cutBoxes: [] })
    const page = pages[cell.page] as (typeof pages)[number]
    const mm = imageMm(bitmap)
    const bottom = A4_HEIGHT_MM - cell.topMm - cell.heightMm
    page.cutBoxes.push({ x: cell.leftMm * PT_PER_MM, y: bottom * PT_PER_MM, width: cell.widthMm * PT_PER_MM, height: cell.heightMm * PT_PER_MM })
    page.images.push({
      bitmap,
      x: (cell.leftMm + (cell.widthMm - mm.width) / 2) * PT_PER_MM,
      y: (bottom + (cell.heightMm - mm.height)) * PT_PER_MM,
      width: mm.width * PT_PER_MM,
      height: mm.height * PT_PER_MM,
    })
  })
  const pdfPages = pages.map((p) => ({ width: A4_WIDTH_MM * PT_PER_MM, height: A4_HEIGHT_MM * PT_PER_MM, images: p.images, cutBoxes: p.cutBoxes }))
  return { ok: true, bytes: writePdf(pdfPages), pages: pdfPages.length }
}
