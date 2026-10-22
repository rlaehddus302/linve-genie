// @livejjim/documents — 구매 내역 확인서(PDF·이미지)와 엑셀 판매대장 (STL-04·05·06, D-206~D-208).
// 화면·서버와 연결하지 않는다(P2 — 내려받기·공유·API·가게 설정 저장은 I2).
// src는 브라우저와 Node 둘 다에서 돈다: 파일·네트워크를 직접 읽지 않고 글꼴 바이트·시각은 부르는 쪽이 넘긴다.
// 금액은 코어 정산 결과 그대로다. 문서가 하는 계산은 부분 입금일 때의 "남은 금액" 하나뿐이다.
export {
  EMPTY_VARIETY,
  LEGAL_NOTICE,
  RECEIPT_TITLE,
  REHEARSAL_NOTE,
  REHEARSAL_TITLE,
  buildReceipt,
  buildReceipts,
  itemText,
  linesMatchSettlement,
  type ReceiptData,
  type ReceiptError,
  type ReceiptErrorCode,
  type ReceiptInput,
  type ReceiptLine,
  type ReceiptResult,
  type ReceiptRow,
  type ReceiptScope,
  type ReceiptsResult,
  type NameSanitizer,
  type ShippingNote,
  type ShopSettings,
} from './receipt.ts'
export { DocumentFont, loadDocumentFont, type GlyphLike } from './font.ts'
export {
  CONTENT_WIDTH,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  layoutReceipt,
  layoutTexts,
  wrapText,
  type LayoutItem,
  type LayoutPage,
  type LayoutRule,
  type LayoutText,
  type ReceiptLayout,
  type TextRole,
} from './layout.ts'
export { asDocumentFont, renderBatchPdf, renderReceiptPdf, renderReceiptsPdf, type BatchPdfResult, type FontSource } from './pdf.ts'
export { IMAGE_WIDTH_PX, encodeGrayPng, rasterizePage, renderReceiptPng } from './png.ts'
export {
  CHANNEL_WORDS,
  LEDGER_COLUMNS,
  LEDGER_OPTION_COLUMNS,
  LEDGER_SHEET_NAME,
  PAYMENT_WORDS,
  PRODUCT_STATUS_WORDS,
  buildLedger,
  hasOptionColumns,
  ledgerColumns,
  ledgerRowValues,
  ledgerRowValuesWith,
  type LedgerChannel,
  type LedgerError,
  type LedgerErrorCode,
  type LedgerInput,
  type LedgerPayment,
  type LedgerResult,
  type LedgerRow,
  type LedgerScope,
} from './ledger.ts'
export { ledgerToXlsx } from './xlsx.ts'
export { NO_NAME, compareCodePoints, optionText, printedName, stripInvisible, stripXlsxForbidden } from './text.ts'
export { formatKoreanDate, formatKstDateTime, formatKstLedgerTime } from './kst.ts'
