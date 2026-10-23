// 구매 내역 확인서 PDF (STL-04·STL-05, D-206·D-207): A4 세로, 한글 글꼴을 문서 안에 넣는다(쓰는 글자만 넣은 부분 글꼴).
// 기본 14 글꼴·시스템 글꼴 이름만 적은 참조로 한글을 그리지 않는다. 모든 쪽 하단에 고지 문장과 쪽 번호.
// 전원 일괄은 구매자마다 새 쪽에서 시작하고 쪽 번호는 구매자마다 1/n부터.
// 시계를 읽지 않는다(문서 날짜 정보를 넣지 않는다) — 같은 확인서·글꼴이면 같은 PDF.
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { SERVICE_NAME } from './brand.ts'
import { DocumentFont } from './font.ts'
import { layoutReceipt, type ReceiptLayout } from './layout.ts'
import { RECEIPT_TITLE, buildReceipts, type ReceiptData, type ReceiptError, type ReceiptScope } from './receipt.ts'

export type FontSource = Uint8Array | DocumentFont

export function asDocumentFont(font: FontSource): DocumentFont {
  return font instanceof DocumentFont ? font : new DocumentFont(font)
}

const INK = rgb(0, 0, 0)
const RULE_GRAY = rgb(0.55, 0.55, 0.55)

function drawLayout(page: PDFPage, layout: ReceiptLayout['pages'][number], font: PDFFont): void {
  const height = layout.height
  for (const item of layout.items) {
    if (item.kind === 'rule') {
      page.drawRectangle({ x: item.x, y: height - item.y - item.height, width: item.width, height: item.height, color: RULE_GRAY })
      continue
    }
    page.drawText(item.text, { x: item.x, y: height - item.baseline, size: item.size, font, color: INK })
  }
}

/** 확인서 여러 개를 PDF 하나로 (확인서마다 새 쪽, 쪽 번호는 확인서마다 1/n부터) */
export async function renderReceiptsPdf(receipts: readonly ReceiptData[], fontSource: FontSource): Promise<Uint8Array> {
  if (receipts.length === 0) throw new RangeError('확인서가 하나 이상 있어야 한다')
  const font = asDocumentFont(fontSource)
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0])
  const embedded = await doc.embedFont(font.bytes, { subset: true })
  doc.setTitle(receipts.length === 1 ? (receipts[0] as ReceiptData).title : RECEIPT_TITLE)
  doc.setCreator(SERVICE_NAME)
  doc.setProducer(SERVICE_NAME)
  doc.setLanguage('ko-KR')
  for (const receipt of receipts) {
    for (const pageLayout of layoutReceipt(receipt, font, 'pdf').pages) {
      const page = doc.addPage([pageLayout.width, pageLayout.height])
      drawLayout(page, pageLayout, embedded)
    }
  }
  return doc.save()
}

/** 한 사람 확인서 PDF */
export function renderReceiptPdf(receipt: ReceiptData, fontSource: FontSource): Promise<Uint8Array> {
  return renderReceiptsPdf([receipt], fontSource)
}

export type BatchPdfResult =
  | { readonly ok: true; readonly pdf: Uint8Array; readonly receipts: readonly ReceiptData[] }
  | { readonly ok: false; readonly error: ReceiptError }

/** 전원 일괄 PDF (D-207, I2 D-I2-04): 그 날짜 품목이 있는 묶음 전부, 이 글꼴로 찍힌 구매자 이름의 코드 포인트 순. 품목 없는 묶음은 빠진다 */
export async function renderBatchPdf(scope: ReceiptScope, fontSource: FontSource): Promise<BatchPdfResult> {
  const font = asDocumentFont(fontSource)
  const built = buildReceipts(scope, font)
  if (!built.ok) return built
  return { ok: true, pdf: await renderReceiptsPdf(built.receipts, font), receipts: built.receipts }
}
