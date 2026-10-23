// 운송장 (PARCEL_RULES PC-7, D-T1-10): 100×150mm 세로 한 쪽에 택배 하나, PDF. 여러 개는 한 PDF에 준 순서대로 쪽마다 하나.
// 일반 프린터(A4에 맞춰 찍기)·100×150 라벨 프린터로 찍는다. NIIMBOT B1(폭 50mm)으로는 찍지 않는다 — 라벨·프린터 패키지와 잇지 않는다.
// 순수 함수 셋(골든 tests/golden/waybill): 송장번호 → Code 128 부호값, 받는 분 연락처 가리기, 송장번호 글(4자리마다 -).
// 받는 분 이름·주소·상세 주소는 자르지 않는다. 자리가 모자라면 글자를 7pt까지 줄이고, 그래도 넘치면 그 운송장만 TOO_LONG.
// 구매자 ID·채널 ID·닉네임·가격은 데이터 모양에 아예 없다(넣을 자리가 없다). 시계를 읽지 않는다 — 접수 날짜는 부르는 쪽이 넘긴다.
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { SERVICE_NAME } from './brand.ts'
import type { DocumentFont } from './font.ts'
import { wrapText } from './layout.ts'
import { asDocumentFont, type FontSource } from './pdf.ts'
import { NO_NAME } from './text.ts'

// ── 순수 함수 (골든) ─────────────────────────────────────────────────────

const INVOICE_PATTERN = /^[0-9]{8,20}$/

/** 송장번호 모양인가 (ASCII 숫자 8~20자리, PC-1·PC-7) */
export function isInvoiceNumber(value: unknown): value is string {
  return typeof value === 'string' && INVOICE_PATTERN.test(value)
}

export type Code128Result = { readonly codes: readonly number[] } | { readonly error: 'FORMAT' }

export const CODE128_START_C = 105
export const CODE128_CODE_B = 100
export const CODE128_STOP = 106

/**
 * 송장번호 → Code 128 부호값 (PC-7): 시작 C(105), 두 자리씩 그 수, 홀수면 마지막 한 자리 앞에 코드 B(100)와 그 자리의 B 값(글자 코드 − 32),
 * 검사값 = (105 + Σ 위치 × 값) mod 103, 끝(106). 숫자 8~20자리가 아니면 FORMAT.
 */
export function code128Codes(invoice: string): Code128Result {
  if (!isInvoiceNumber(invoice)) return { error: 'FORMAT' }
  const values: number[] = []
  let i = 0
  for (; i + 1 < invoice.length; i += 2) values.push(Number(invoice.slice(i, i + 2)))
  if (i < invoice.length) {
    values.push(CODE128_CODE_B)
    values.push((invoice.charCodeAt(i) as number) - 32)
  }
  let sum = CODE128_START_C
  values.forEach((value, index) => {
    sum += (index + 1) * value
  })
  return { codes: [CODE128_START_C, ...values, sum % 103, CODE128_STOP] }
}

/** 받는 분 연락처 가리기 (PC-7): 숫자 n자리(9~11) → 앞 3자리 + `*` (n−7)개 + 뒤 4자리. 그 밖의 모양은 숫자를 하나도 보이지 않는다 */
export function maskPhone(phone: string): string {
  if (typeof phone !== 'string' || !/^[0-9]{9,11}$/.test(phone)) return '*'.repeat(typeof phone === 'string' ? Math.min([...phone].length, 11) : 0)
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`
}

/** 송장번호 글 (PC-7): 앞에서부터 4자리마다 `-` */
export function formatInvoiceNumber(invoice: string): string {
  const groups: string[] = []
  for (let i = 0; i < invoice.length; i += 4) groups.push(invoice.slice(i, i + 4))
  return groups.join('-')
}

// ── Code 128 막대 무늬 ───────────────────────────────────────────────────

/**
 * Code 128 표준 무늬 (값 0~106). 글자 하나 = 막대·빈칸을 번갈아 6개(끝은 7개)의 폭(칸 수). 값마다 11칸, 끝 13칸.
 * 짝 검사: 막대 칸 합이 짝수다(단위 시험이 표 전체를 검사한다).
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

/** 앞뒤 빈칸 (칸 수, PC-7 — 10칸 이상) */
export const CODE128_QUIET_MODULES = 10

/** 부호값 → 막대 [시작 칸, 폭 칸] 목록 (빈칸 제외, 앞 빈칸 뒤 0부터) 과 전체 칸 수(빈칸 제외) */
export function code128Bars(codes: readonly number[]): { readonly bars: readonly (readonly [number, number])[]; readonly modules: number } {
  const bars: [number, number][] = []
  let x = 0
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code]
    if (pattern === undefined) throw new RangeError('Code 128 부호값은 0~106이다')
    for (let k = 0; k < pattern.length; k++) {
      const width = Number(pattern[k])
      if (k % 2 === 0) bars.push([x, width])
      x += width
    }
  }
  return { bars, modules: x }
}

// ── 운송장 데이터 ─────────────────────────────────────────────────────────

export type CarrierCode = 'FAKE' | 'EPOST'
export const CARRIER_NAMES: Readonly<Record<CarrierCode, string>> = {
  FAKE: '가짜 택배 · 시험용 — 실제로 보낼 수 없어요',
  EPOST: '우체국 택배',
}

export const BOX_SIZES = ['극소', '소', '중', '대'] as const
export type BoxSize = (typeof BOX_SIZES)[number]

/** 받는 분 (PC-2가 다듬은 여섯 칸 — 연락처는 숫자만, 우편번호·메모는 빈 글 가능) */
export interface WaybillReceiver {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
  readonly memo: string
}

/** 보내는 사람 (설정 "택배", PC-6 — 연락처는 그대로 찍는다) */
export interface WaybillSender {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail?: string
}

export interface WaybillData {
  readonly carrier: CarrierCode
  /** 송장번호 (숫자 8~20자리) */
  readonly invoice: string
  readonly receiver: WaybillReceiver
  readonly sender: WaybillSender
  /** 물품 수 (그 묶음 품목 수량 합) */
  readonly itemCount: number
  readonly box: BoxSize
  /** 접수 날짜 (KST YYYY-MM-DD) */
  readonly bookedDate: string
}

export type WaybillErrorCode = 'TOO_LONG' | 'FORMAT'

export interface WaybillError {
  readonly code: WaybillErrorCode
  readonly message: string
}

export const WAYBILL_TOO_LONG_MESSAGE = '주소가 길어 운송장에 다 들어가지 않아요.'
export const WAYBILL_FORMAT_MESSAGE = '운송장에 넣을 수 없는 값이 있어요.'

// ── 배치 ─────────────────────────────────────────────────────────────────

const MM = 72 / 25.4
/** 100×150mm 세로 (pt) */
export const WAYBILL_WIDTH = 100 * MM
export const WAYBILL_HEIGHT = 150 * MM
const MARGIN = 5 * MM
const CONTENT = WAYBILL_WIDTH - MARGIN * 2
/** 막대 한 칸 = 1.2pt ≈ 0.423mm (PC-7 — 0.33mm 이상. 300dpi에서 딱 5화소) */
export const BAR_MODULE = 1.2
/** 막대 높이 = 17mm (PC-7 — 15mm 이상) */
export const BAR_HEIGHT = 17 * MM
/** 가장 작은 글자 (PC-7 — 7pt까지 줄인다) */
export const MIN_TEXT_SIZE = 7
const GAP = 2.5
const RULE = 0.8

export type WaybillField =
  | 'carrier'
  | 'invoice'
  | 'receiverHeading'
  | 'receiverName'
  | 'receiverPhone'
  | 'receiverAddress'
  | 'receiverZip'
  | 'receiverMemo'
  | 'senderHeading'
  | 'senderName'
  | 'senderPhone'
  | 'senderAddress'
  | 'items'
  | 'box'
  | 'date'

export interface WaybillText {
  readonly kind: 'text'
  readonly field: WaybillField
  readonly text: string
  /** 글자 상자 왼쪽 위 (pt, 원점은 쪽 왼쪽 위·y는 아래로) */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly baseline: number
  readonly size: number
}

export interface WaybillBox {
  /** bar = 바코드 막대(검정), rule = 칸 나눔 선 */
  readonly kind: 'bar' | 'rule'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type WaybillItem = WaybillText | WaybillBox

export interface WaybillLayout {
  readonly width: number
  readonly height: number
  readonly items: readonly WaybillItem[]
  /** 받는 분·보내는 사람 칸에 쓴 글자 크기 (pt) */
  readonly textSize: number
  /** 바코드 자리 (빈칸 포함, pt) */
  readonly barcode: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly module: number; readonly quietModules: number }
}

export type WaybillLayoutResult = { readonly ok: true; readonly layout: WaybillLayout } | { readonly ok: false; readonly error: WaybillError }

interface Line {
  readonly field: WaybillField
  readonly text: string
  readonly size: number
}

class Placer {
  readonly items: WaybillItem[] = []
  y: number
  private readonly font: DocumentFont
  constructor(font: DocumentFont, top: number) {
    this.font = font
    this.y = top
  }
  lineHeight(size: number): number {
    return this.font.boxHeight(size) * 1.12
  }
  text(field: WaybillField, text: string, size: number, align: 'left' | 'center' = 'left'): void {
    const width = this.font.widthOf(text, size)
    const x = align === 'center' ? (WAYBILL_WIDTH - width) / 2 : MARGIN
    this.items.push({ kind: 'text', field, text, x, y: this.y, width, height: this.font.boxHeight(size), baseline: this.y + this.font.baselineOffset(size), size })
    this.y += this.lineHeight(size)
  }
  lines(lines: readonly Line[]): void {
    for (const line of lines) this.text(line.field, line.text, line.size)
  }
  rule(): void {
    this.y += GAP
    this.items.push({ kind: 'rule', x: MARGIN, y: this.y, width: CONTENT, height: RULE })
    this.y += RULE + GAP
  }
}

/** 칸 글을 줄로 (자르지 않는다 — 줄을 바꾼다) */
function wrapField(font: DocumentFont, field: WaybillField, text: string, size: number): Line[] {
  return wrapText(font, text, size, CONTENT).map((piece) => ({ field, text: piece, size }))
}

function clean(font: DocumentFont, text: unknown): string {
  return font
    .sanitize(typeof text === 'string' ? text : '')
    .split(/\s+/u)
    .filter((part) => part !== '')
    .join(' ')
}

/** 받는 분·보내는 사람 칸의 줄 (크기 size) */
function flexibleLines(data: WaybillData, font: DocumentFont, size: number): { receiver: Line[]; sender: Line[] } {
  const r = data.receiver
  const s = data.sender
  const nameSize = Math.min(size * 1.35, 18)
  const small = Math.max(MIN_TEXT_SIZE, size * 0.8)
  const receiver: Line[] = [
    { field: 'receiverHeading', text: '받는 분', size: small },
    ...wrapField(font, 'receiverName', clean(font, r.name) || NO_NAME, nameSize),
    { field: 'receiverPhone', text: maskPhone(r.phone), size },
    ...wrapField(font, 'receiverAddress', [clean(font, r.address), clean(font, r.detail)].filter((part) => part !== '').join(' '), size),
  ]
  const zip = clean(font, r.zip)
  if (zip !== '') receiver.push({ field: 'receiverZip', text: `우편번호 ${zip}`, size })
  const memo = clean(font, r.memo)
  if (memo !== '') receiver.push(...wrapField(font, 'receiverMemo', `배송 메모: ${memo}`, small))
  const senderDetail = [clean(font, s.address), clean(font, s.detail ?? '')].filter((part) => part !== '').join(' ')
  const sender: Line[] = [
    { field: 'senderHeading', text: '보내는 사람', size: small },
    ...wrapField(font, 'senderName', clean(font, s.name) || NO_NAME, small),
    { field: 'senderPhone', text: clean(font, s.phone), size: small },
    ...wrapField(font, 'senderAddress', senderDetail, small),
  ]
  return { receiver, sender }
}

const CARRIER_SIZE = 9
const INVOICE_SIZE = 14
const FOOTER_SIZE = 10
const SIZE_STEPS = [12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7] as const

/** 운송장 한 장 배치 (PDF가 이것 그대로 그린다) */
export function layoutWaybill(data: WaybillData, fontSource: FontSource): WaybillLayoutResult {
  const font = asDocumentFont(fontSource)
  const codes = code128Codes(data.invoice)
  if ('error' in codes || !(data.carrier in CARRIER_NAMES) || !Number.isSafeInteger(data.itemCount) || data.itemCount < 0) {
    return { ok: false, error: { code: 'FORMAT', message: WAYBILL_FORMAT_MESSAGE } }
  }
  const { bars, modules } = code128Bars(codes.codes)
  const totalModules = modules + CODE128_QUIET_MODULES * 2
  const barcodeWidth = totalModules * BAR_MODULE

  const footer = (placer: Placer): void => {
    placer.rule()
    placer.text('items', `물품 ${String(data.itemCount)}개`, FOOTER_SIZE)
    placer.text('box', `상자 크기 ${clean(font, data.box)}`, FOOTER_SIZE)
    placer.text('date', `접수 날짜 ${clean(font, data.bookedDate)}`, FOOTER_SIZE)
  }

  for (const size of SIZE_STEPS) {
    const placer = new Placer(font, MARGIN)
    placer.lines(wrapField(font, 'carrier', CARRIER_NAMES[data.carrier], CARRIER_SIZE))
    placer.y += GAP
    const barcodeX = (WAYBILL_WIDTH - barcodeWidth) / 2
    const barcodeY = placer.y
    for (const [start, width] of bars) {
      placer.items.push({ kind: 'bar', x: barcodeX + (CODE128_QUIET_MODULES + start) * BAR_MODULE, y: barcodeY, width: width * BAR_MODULE, height: BAR_HEIGHT })
    }
    placer.y += BAR_HEIGHT + GAP
    placer.text('invoice', formatInvoiceNumber(data.invoice), INVOICE_SIZE, 'center')
    const { receiver, sender } = flexibleLines(data, font, size)
    placer.rule()
    placer.lines(receiver)
    placer.rule()
    placer.lines(sender)
    footer(placer)
    if (placer.y <= WAYBILL_HEIGHT - MARGIN) {
      return {
        ok: true,
        layout: {
          width: WAYBILL_WIDTH,
          height: WAYBILL_HEIGHT,
          items: placer.items,
          textSize: size,
          barcode: { x: barcodeX, y: barcodeY, width: barcodeWidth, height: BAR_HEIGHT, module: BAR_MODULE, quietModules: CODE128_QUIET_MODULES },
        },
      }
    }
  }
  return { ok: false, error: { code: 'TOO_LONG', message: WAYBILL_TOO_LONG_MESSAGE } }
}

// ── PDF ─────────────────────────────────────────────────────────────────

const INK = rgb(0, 0, 0)

function drawWaybill(page: PDFPage, layout: WaybillLayout, font: PDFFont): void {
  const height = layout.height
  for (const item of layout.items) {
    if (item.kind === 'text') {
      page.drawText(item.text, { x: item.x, y: height - item.baseline, size: item.size, font, color: INK })
      continue
    }
    page.drawRectangle({ x: item.x, y: height - item.y - item.height, width: item.width, height: item.height, color: INK })
  }
}

export interface WaybillOutcome {
  /** 준 목록의 자리 */
  readonly index: number
  readonly invoice: string
  readonly ok: boolean
  readonly error?: WaybillError
}

export interface WaybillsPdfResult {
  /** 만든 운송장이 하나도 없으면 null */
  readonly pdf: Uint8Array | null
  /** 준 순서대로 하나씩 — 만들지 못한 것은 오류와 함께 */
  readonly outcomes: readonly WaybillOutcome[]
}

/** 운송장 여러 개 → PDF 하나 (준 순서대로 쪽마다 하나). 넘치는 운송장은 그것만 빠지고(TOO_LONG) 다른 것은 만든다 */
export async function renderWaybillsPdf(list: readonly WaybillData[], fontSource: FontSource): Promise<WaybillsPdfResult> {
  const font = asDocumentFont(fontSource)
  const outcomes: WaybillOutcome[] = []
  const layouts: WaybillLayout[] = []
  list.forEach((data, index) => {
    const result = layoutWaybill(data, font)
    if (result.ok) {
      layouts.push(result.layout)
      outcomes.push({ index, invoice: data.invoice, ok: true })
    } else outcomes.push({ index, invoice: data.invoice, ok: false, error: result.error })
  })
  if (layouts.length === 0) return { pdf: null, outcomes }
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0])
  const embedded = await doc.embedFont(font.bytes, { subset: true })
  doc.setTitle('운송장')
  doc.setCreator(SERVICE_NAME)
  doc.setProducer(SERVICE_NAME)
  doc.setLanguage('ko-KR')
  for (const layout of layouts) {
    const page = doc.addPage([layout.width, layout.height])
    drawWaybill(page, layout, embedded)
  }
  return { pdf: await doc.save(), outcomes }
}
