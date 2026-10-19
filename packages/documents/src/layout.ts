// 확인서 배치 모델 (STL-04·05, D-206·D-207). PDF와 이미지가 같은 함수로 같은 글자를 같은 자리에 놓는다.
// 단위는 pt(1/72인치), 원점은 쪽 왼쪽 위(y는 아래로). PDF = A4 세로 쪽 여러 장(모든 쪽 하단에 고지·쪽 번호),
// 이미지 = 같은 폭의 긴 한 장(쪽 나눔 없음, 맨 아래 고지 한 번, 쪽 번호 없음 — 그 밖의 글자는 PDF와 같다).
// 글자는 그리기 전에 글꼴로 그릴 수 있는 글자만 남긴다(D-207 ③). 긴 품종·이름은 칸 안에서 줄을 바꿔 다 보인다(자르지 않는다).
import type { DocumentFont } from './font.ts'
import type { ReceiptData } from './receipt.ts'

/** A4 세로 (pt) */
export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89
const MARGIN_X = 48
const MARGIN_TOP = 48
const MARGIN_BOTTOM = 36
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

const SIZE = { title: 20, body: 10.5, total: 12, small: 8.5 } as const
const LINE = 1.5
const RULE = 0.6
const NO_NAME = '(이름 없음)'
const NO_TITLE = '(제목 없음)'

export type TextRole = 'content' | 'notice' | 'pageNumber'

export interface LayoutText {
  readonly kind: 'text'
  readonly role: TextRole
  readonly text: string
  /** 글자 상자 왼쪽 위 (pt) */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 기준선 y (pt) */
  readonly baseline: number
  readonly size: number
}

export interface LayoutRule {
  readonly kind: 'rule'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type LayoutItem = LayoutText | LayoutRule

export interface LayoutPage {
  readonly width: number
  readonly height: number
  readonly items: readonly LayoutItem[]
}

export interface ReceiptLayout {
  readonly mode: 'pdf' | 'image'
  readonly pages: readonly LayoutPage[]
}

// ── 줄 바꾸기 ────────────────────────────────────────────────────────────

/** 폭 안에 들어가게 줄을 바꾼다: 띄어쓰기에서 먼저, 한 낱말이 넘치면 글자 단위로. 글자를 버리지 않는다 */
export function wrapText(font: DocumentFont, text: string, size: number, width: number): string[] {
  const words = text.split(' ').filter((word) => word !== '')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const joined = current === '' ? word : `${current} ${word}`
    if (font.widthOf(joined, size) <= width) {
      current = joined
      continue
    }
    if (current !== '') lines.push(current)
    current = ''
    if (font.widthOf(word, size) <= width) {
      current = word
      continue
    }
    for (const char of word) {
      const next = current + char
      if (current === '' || font.widthOf(next, size) <= width) current = next
      else {
        lines.push(current)
        current = char
      }
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

// ── 줄 묶음 (행) ──────────────────────────────────────────────────────────

interface Cell {
  /** 행 안의 x (내용 영역 기준) */
  readonly x: number
  readonly width: number
  readonly align: 'left' | 'right'
  readonly size: number
  readonly lines: readonly string[]
}

interface Row {
  readonly kind: 'cells'
  readonly cells: readonly Cell[]
}

interface RuleRow {
  readonly kind: 'rule'
}

/** 같은 블록 안의 띄움 (쪽 맨 위에 오면 없앤다) */
interface SpaceRow {
  readonly kind: 'space'
  readonly height: number
}

type FlowRow = Row | RuleRow | SpaceRow

interface Block {
  readonly rows: readonly FlowRow[]
  /** 블록 앞 띄움 (쪽 맨 위면 없음) */
  readonly spaceBefore: number
  /** 쪽을 넘기지 않고 한 쪽에 같이 둔다 (한 쪽보다 크면 행 단위로 나눈다) */
  readonly keepTogether: boolean
}

const lineHeight = (size: number): number => size * LINE
const RULE_ROW_HEIGHT = 8

function rowHeight(row: FlowRow): number {
  if (row.kind === 'rule') return RULE_ROW_HEIGHT
  if (row.kind === 'space') return row.height
  return Math.max(...row.cells.map((cell) => Math.max(1, cell.lines.length) * lineHeight(cell.size)))
}

/** 한 쪽 몸통보다 큰 행은 줄 단위로 나눈다 (아주 긴 이름도 빠지거나 겹치지 않게) */
function splitRow(row: Row, maxHeight: number): Row[] {
  const perLine = Math.max(...row.cells.map((cell) => lineHeight(cell.size)))
  const linesPerChunk = Math.max(1, Math.floor(maxHeight / perLine))
  const total = Math.max(...row.cells.map((cell) => cell.lines.length))
  const out: Row[] = []
  for (let start = 0; start < total; start += linesPerChunk) {
    out.push({ kind: 'cells', cells: row.cells.map((cell) => ({ ...cell, lines: cell.lines.slice(start, start + linesPerChunk) })) })
  }
  return out
}

// ── 확인서 → 블록 ─────────────────────────────────────────────────────────

const INFO_LABEL_WIDTH = 84
const INFO_VALUE_X = 92
const COL = {
  session: { x: 0, width: 92 },
  no: { x: 98, width: 38 },
  name: { x: 148, width: CONTENT_WIDTH - 148 - 108 },
  price: { x: CONTENT_WIDTH - 100, width: 100 },
} as const
const SUMMARY_LABEL_X = CONTENT_WIDTH - 300
const SUMMARY_LABEL_WIDTH = 180
const SUMMARY_VALUE_WIDTH = 112

/** pageBodyHeight = PDF 한 쪽 몸통 높이 (PDF·이미지가 같은 블록 = 같은 글자 순서를 쓰도록 둘 다 PDF 기준으로 정한다) */
function receiptBlocks(receipt: ReceiptData, font: DocumentFont, pageBodyHeight: number): Block[] {
  const clean = (text: string): string => font.sanitize(text).split(' ').filter((part) => part !== '').join(' ')
  const cell = (x: number, width: number, text: string, size: number = SIZE.body, align: 'left' | 'right' = 'left'): Cell => ({
    x,
    width,
    align,
    size,
    lines: wrapText(font, text, size, width),
  })
  const infoRow = (label: string, value: string): Row => ({
    kind: 'cells',
    cells: [cell(0, INFO_LABEL_WIDTH, label), cell(INFO_VALUE_X, CONTENT_WIDTH - INFO_VALUE_X, value)],
  })

  const head: FlowRow[] = [{ kind: 'cells', cells: [cell(0, CONTENT_WIDTH, clean(receipt.title), SIZE.title)] }]
  if (receipt.rehearsalNote !== null) head.push({ kind: 'cells', cells: [cell(0, CONTENT_WIDTH, clean(receipt.rehearsalNote))] })

  const info: FlowRow[] = []
  const shop = receipt.shopName === null ? '' : clean(receipt.shopName)
  if (shop !== '') info.push(infoRow('가게', shop))
  info.push(infoRow('구매자', clean(receipt.buyerName) || NO_NAME))
  if (receipt.phoneLast4 !== null) info.push(infoRow('휴대폰 끝자리', clean(receipt.phoneLast4)))
  info.push(infoRow('주문 날짜', receipt.orderDate))
  info.push(infoRow('방송 회차', receipt.sessions.map((session) => clean(session) || NO_TITLE).join(', ')))
  info.push(infoRow('만든 시각', receipt.createdAt))

  const tableHead: FlowRow[] = [
    { kind: 'rule' },
    {
      kind: 'cells',
      cells: [cell(COL.session.x, COL.session.width, '회차'), cell(COL.no.x, COL.no.width, '번호', SIZE.body, 'right'), cell(COL.name.x, COL.name.width, '품종'), cell(COL.price.x, COL.price.width, '가격', SIZE.body, 'right')],
    },
    { kind: 'rule' },
  ]
  const lineRows: Row[] = receipt.lines.map((line) => ({
    kind: 'cells',
    cells: [
      cell(COL.session.x, COL.session.width, clean(line.session) || NO_TITLE),
      cell(COL.no.x, COL.no.width, String(line.no), SIZE.body, 'right'),
      cell(COL.name.x, COL.name.width, clean(line.name) || '품종 미입력'),
      cell(COL.price.x, COL.price.width, line.priceText, SIZE.body, 'right'),
    ],
  }))

  const summary: FlowRow[] = [{ kind: 'rule' }]
  for (const row of receipt.rows) {
    const size = row.key === 'total' ? SIZE.total : SIZE.body
    summary.push({ kind: 'cells', cells: [cell(SUMMARY_LABEL_X, SUMMARY_LABEL_WIDTH, row.label, size), cell(CONTENT_WIDTH - SUMMARY_VALUE_WIDTH, SUMMARY_VALUE_WIDTH, row.text, size, 'right')] })
  }

  const account: FlowRow[] = []
  if (receipt.account !== null) {
    const accountText = clean(receipt.account.text)
    if (accountText !== '') {
      account.push(infoRow('입금 계좌', accountText))
      const note = receipt.account.note === null ? '' : clean(receipt.account.note)
      if (note !== '') account.push({ kind: 'cells', cells: [cell(INFO_VALUE_X, CONTENT_WIDTH - INFO_VALUE_X, note)] })
    }
  }

  const blocks: Block[] = [
    { rows: head, spaceBefore: 0, keepTogether: true },
    { rows: info, spaceBefore: 10, keepTogether: true },
    // 표 머리와 첫 줄은 같은 쪽에 (머리만 쪽 끝에 남지 않게)
    { rows: [...tableHead, ...lineRows.slice(0, 1)], spaceBefore: 10, keepTogether: true },
    ...lineRows.slice(1).map((row): Block => ({ rows: [row], spaceBefore: 0, keepTogether: true })),
  ]
  // 금액 블록과 입금 계좌는 한 블록이다 — 계좌만 다음 쪽으로 넘어가 마지막 쪽에 합계·최종 금액이 없는 일이 없게 (AC-P2-23).
  // 계좌 안내가 아주 길어 둘을 합치면 한 쪽보다 크면, 계좌를 먼저 두고 금액 블록을 맨 끝에 둔다(금액 블록 하나는 늘 한 쪽에 들어간다).
  const closing: FlowRow[] = account.length === 0 ? summary : [...summary, { kind: 'space', height: 14 }, ...account]
  if (closing.reduce((sum, row) => sum + rowHeight(row), 0) <= pageBodyHeight) blocks.push({ rows: closing, spaceBefore: 4, keepTogether: true })
  else blocks.push({ rows: account, spaceBefore: 14, keepTogether: true }, { rows: summary, spaceBefore: 4, keepTogether: true })
  return blocks
}

// ── 놓기 ─────────────────────────────────────────────────────────────────

function placeRow(row: FlowRow, top: number, font: DocumentFont, items: LayoutItem[]): void {
  if (row.kind === 'space') return
  if (row.kind === 'rule') {
    items.push({ kind: 'rule', x: MARGIN_X, y: top + (RULE_ROW_HEIGHT - RULE) / 2, width: CONTENT_WIDTH, height: RULE })
    return
  }
  for (const cell of row.cells) {
    const step = lineHeight(cell.size)
    const box = font.boxHeight(cell.size)
    cell.lines.forEach((text, i) => {
      if (text === '') return
      const width = font.widthOf(text, cell.size)
      const x = MARGIN_X + cell.x + (cell.align === 'right' ? cell.width - width : 0)
      const y = top + i * step + (step - box) / 2
      items.push({ kind: 'text', role: 'content', text, x, y, width, height: box, baseline: y + font.baselineOffset(cell.size), size: cell.size })
    })
  }
}

/** 고지(와 쪽 번호) 줄 */
function footerLines(font: DocumentFont, notice: string): string[] {
  return wrapText(font, font.sanitize(notice), SIZE.small, CONTENT_WIDTH)
}

function placeFooter(font: DocumentFont, notice: readonly string[], pageNumber: string | null, top: number, items: LayoutItem[]): void {
  const step = lineHeight(SIZE.small)
  const box = font.boxHeight(SIZE.small)
  notice.forEach((text, i) => {
    const y = top + i * step + (step - box) / 2
    items.push({ kind: 'text', role: 'notice', text, x: MARGIN_X, y, width: font.widthOf(text, SIZE.small), height: box, baseline: y + font.baselineOffset(SIZE.small), size: SIZE.small })
  })
  if (pageNumber !== null) {
    const y = top + notice.length * step + (step - box) / 2
    const width = font.widthOf(pageNumber, SIZE.small)
    items.push({ kind: 'text', role: 'pageNumber', text: pageNumber, x: MARGIN_X + CONTENT_WIDTH - width, y, width, height: box, baseline: y + font.baselineOffset(SIZE.small), size: SIZE.small })
  }
}

/**
 * 확인서 하나의 배치.
 * - pdf: A4 쪽들. 블록은 넘치면 다음 쪽으로(한 쪽보다 크면 행·줄 단위로 나눈다). 모든 쪽 하단에 고지와 쪽 번호 `n/전체`.
 * - image: 같은 폭의 한 장. 높이는 내용만큼, 맨 아래 고지 한 번.
 */
export function layoutReceipt(receipt: ReceiptData, font: DocumentFont, mode: 'pdf' | 'image'): ReceiptLayout {
  const notice = footerLines(font, receipt.notice)
  const footerHeight = (notice.length + (mode === 'pdf' ? 1 : 0)) * lineHeight(SIZE.small)
  // PDF 한 쪽의 몸통: 위 여백 ~ (고지 + 쪽 번호 + 띄움) 위
  const bodyBottom = PAGE_HEIGHT - MARGIN_BOTTOM - (notice.length + 1) * lineHeight(SIZE.small) - 12
  const bodyHeight = bodyBottom - MARGIN_TOP
  const blocks = receiptBlocks(receipt, font, bodyHeight)

  if (mode === 'image') {
    const items: LayoutItem[] = []
    let y = MARGIN_TOP
    blocks.forEach((block, i) => {
      if (i > 0) y += block.spaceBefore
      for (const row of block.rows) {
        placeRow(row, y, font, items)
        y += rowHeight(row)
      }
    })
    y += 18
    placeFooter(font, notice, null, y, items)
    return { mode, pages: [{ width: PAGE_WIDTH, height: y + footerHeight + MARGIN_BOTTOM, items }] }
  }

  const pages: LayoutItem[][] = [[]]
  let y = MARGIN_TOP
  let pageHasContent = false
  const newPage = (): void => {
    pages.push([])
    y = MARGIN_TOP
    pageHasContent = false
  }
  for (const block of blocks) {
    const rows = block.rows.flatMap((row) => (row.kind === 'cells' && rowHeight(row) > bodyHeight ? splitRow(row, bodyHeight) : [row]))
    const height = rows.reduce((sum, row) => sum + rowHeight(row), 0)
    const space = pageHasContent ? block.spaceBefore : 0
    if (pageHasContent && block.keepTogether && height <= bodyHeight && y + space + height > bodyBottom) newPage()
    y += pageHasContent ? block.spaceBefore : 0
    for (const row of rows) {
      const h = rowHeight(row)
      if (pageHasContent && y + h > bodyBottom) newPage()
      // 쪽 맨 위의 줄 긋기·띄움은 그리지 않는다
      if (!(row.kind !== 'cells' && !pageHasContent && pages.length > 1)) {
        placeRow(row, y, font, pages[pages.length - 1] as LayoutItem[])
        y += h
        pageHasContent = true
      }
    }
  }
  const footerTop = PAGE_HEIGHT - MARGIN_BOTTOM - footerHeight
  pages.forEach((items, i) => placeFooter(font, notice, `${String(i + 1)}/${String(pages.length)}`, footerTop, items))
  return { mode, pages: pages.map((items) => ({ width: PAGE_WIDTH, height: PAGE_HEIGHT, items })) }
}

/** 배치의 글자 목록 (쪽 순서·놓인 순서). 시험·화면 미리보기용 */
export function layoutTexts(layout: ReceiptLayout, roles: readonly TextRole[] = ['content', 'notice', 'pageNumber']): string[] {
  return layout.pages.flatMap((page) => page.items.flatMap((item) => (item.kind === 'text' && roles.includes(item.role) ? [item.text] : [])))
}
