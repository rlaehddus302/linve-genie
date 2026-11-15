// 정산 내역서 그림 (D-RETRO-62, 판매자 요청 2026-11-12 "앱 화면에 보이는 정산서를 그대로 사진으로 … 사진이 화면과 다르면 당황스럽다"):
// 화면의 상품별·구매자별 표와 내보내는 사진이 같은 그림 하나(StatementPaper)에서 나온다 — 화면에 보이는 그 그림을 그대로 찍는다.
// 옛: 화면은 목록(글자 줄), 사진은 따로 그린 그림(₩ 기호·다른 칸 폭)이라 둘이 달랐다.
// 화면에는 장을 나누지 않고 한 장으로 잇는다. 사진으로 내보낼 때만 A4 비율로 나눠 한 장씩 저장한다(여러 장이면 몇 번째 장인지 고르는 판) (D-UX4-145).
import { forwardRef, useRef, useState } from 'react'
import { View } from 'react-native'
import Svg, { G, Line, Rect, Text as Ink } from 'react-native-svg'
import { salesMoney, type StatementRow, type StatementTab } from '../../lib/broadcast-sales.ts'
import { nativeShareFile } from '../../native/index.ts'
import { BigButton, BottomSheet, SmallButton, Tap, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { wait, SHEET_GAP_MS } from '../../lib/receipt-sms-flow.ts'
import { snapshot, wrap } from './paper-image.ts'

/** 그림 폭 (그림 안 단위 — 화면에서는 화면 폭에 맞춰 줄인다) */
export const STATEMENT_WIDTH = 360
const BAND = '#D8F1FA'
const BAND_INK = '#173B4C'
const TEXT = '#131313'
const MUTED = '#526976'
const RULE = '#D6E2E7'
const SIDE = 10
const LINE = 20
const ROW_PAD = 10
const BAND_HEIGHT = 36
/** 사진 한 장의 높이 — A4 비율(가로:세로 = 210:297) (D-UX4-145) */
export const STATEMENT_A4_HEIGHT = Math.round(STATEMENT_WIDTH * 297 / 210)
/** 사진 한 장에 담는 줄 높이 합 — 머리(가게 한 줄)·머리 띠·총계 띠·장 번호 자리를 빼고 남는 만큼. 넘으면 다음 장 */
const PAGE_ROWS_MAX = STATEMENT_A4_HEIGHT - (34 + LINE + 6) - 2 * BAND_HEIGHT - 22
export const STATEMENT_EMPTY = '판매가 확정된 상품이 없어요.'

const modeWord = (tab: StatementTab) => (tab === 'products' ? '상품별' : '구매자별')

export interface StatementPageRow {
  readonly row: StatementRow
  readonly words: readonly string[]
  readonly y: number
  readonly height: number
}

/**
 * 줄을 장으로 나눈다 (줄이 없어도 한 장). 기본은 사진용 A4 장.
 * 화면은 maxRows = Infinity로 한 장에 모두 담는다 (D-UX4-145)
 */
export function statementPages(rows: readonly StatementRow[], tab: StatementTab, maxRows = PAGE_ROWS_MAX): StatementPageRow[][] {
  const pages: StatementPageRow[][] = [[]]
  let y = 0
  for (const row of rows) {
    const words = wrap(row.label, tab === 'products' ? 10 : 13)
    const height = words.length * LINE + 2 * ROW_PAD
    if (y > 0 && y + height > maxRows) {
      pages.push([])
      y = 0
    }
    pages[pages.length - 1]!.push({ row, words, y, height })
    y += height
  }
  return pages
}

export interface StatementSheet {
  readonly tab: StatementTab
  readonly shop: string
  readonly date: string
  readonly total: number | null
  readonly qty: number
}

/** 한 장의 자리: 머리 띠 위치·줄이 시작하는 곳·끝·그림 높이 */
export function statementGeometry(page: readonly StatementPageRow[], shop: string, last: boolean, only: boolean) {
  const shopLines = wrap(shop, 22)
  const head = 34 + shopLines.length * LINE + 6
  const top = head + BAND_HEIGHT
  const tail = page[page.length - 1]
  const rowsEnd = top + (tail ? tail.y + tail.height : only ? 2 * ROW_PAD + LINE : 0)
  const height = rowsEnd + (last ? BAND_HEIGHT : 0) + (only ? 0 : 22)
  return { shopLines, head, top, rowsEnd, height }
}

function ink(value: string, x: number, y: number, bold = false, align: 'start' | 'middle' | 'end' = 'start', color = TEXT, size = 15) {
  return <Ink key={`${x}-${y}-${align}`} x={x} y={y} fontSize={size} fontWeight={bold ? '700' : '400'} textAnchor={align} fill={color}>{value}</Ink>
}

export interface StatementPaperProps extends StatementSheet {
  readonly page: readonly StatementPageRow[]
  readonly pageNo: number
  readonly pageCount: number
  /** 화면에 그릴 폭 */
  readonly width: number
}

/** 정산 내역서 한 장 — 화면에도, 사진에도 이 그림 하나를 쓴다 */
export const StatementPaper = forwardRef<Svg, StatementPaperProps>(function StatementPaper({ page, pageNo, pageCount, tab, shop, date, total, qty, width }, ref) {
  const products = tab === 'products'
  const last = pageNo === pageCount - 1
  const only = pageCount === 1
  const { shopLines, head, top, rowsEnd, height } = statementGeometry(page, shop, last, only)
  const nameX = products ? SIDE + 44 : SIDE
  const moneyX = STATEMENT_WIDTH - SIDE - 44
  const qtyX = STATEMENT_WIDTH - SIDE - 18
  return (
    <Svg ref={ref} width={width} height={width * height / STATEMENT_WIDTH} viewBox={`0 0 ${STATEMENT_WIDTH} ${height}`}>
      <Rect width={STATEMENT_WIDTH} height={height} fill="#fff" />
      {ink(`정산 내역서 · ${modeWord(tab)}`, SIDE, 22, true)}{ink(date, STATEMENT_WIDTH - SIDE, 22, false, 'end', MUTED, 13)}
      {shopLines.map((line, i) => ink(line, SIDE, 46 + i * LINE))}
      <Rect y={head} width={STATEMENT_WIDTH} height={BAND_HEIGHT} fill={BAND} />
      {products && ink('번호', SIDE, head + 24, true, 'start', BAND_INK)}{ink(products ? '상품명' : '구매자', nameX, head + 24, true, 'start', BAND_INK)}
      {ink('판매 금액', moneyX, head + 24, true, 'end', BAND_INK)}{ink('개수', qtyX, head + 24, true, 'middle', BAND_INK)}
      {page.length === 0 && only ? ink(STATEMENT_EMPTY, SIDE, top + ROW_PAD + 15, false, 'start', MUTED) : null}
      {page.map(({ row, y, words, height: rowHeight }) => <G key={row.key}>
        {products && ink(String(row.no), SIDE, top + y + ROW_PAD + 15)}
        {words.map((word, i) => ink(word, nameX, top + y + ROW_PAD + 15 + i * LINE))}
        {ink(salesMoney(row.money), moneyX, top + y + ROW_PAD + 15, false, 'end')}
        {ink(String(row.qty), qtyX, top + y + ROW_PAD + 15, false, 'middle')}
        <Line x1={0} x2={STATEMENT_WIDTH} y1={top + y + rowHeight} y2={top + y + rowHeight} stroke={RULE} />
      </G>)}
      {last && <G>
        <Rect y={rowsEnd} width={STATEMENT_WIDTH} height={BAND_HEIGHT} fill={BAND} />
        {ink('총계', SIDE, rowsEnd + 24, true, 'start', BAND_INK)}
        {ink(salesMoney(total), moneyX, rowsEnd + 24, true, 'end', BAND_INK)}
        {ink(String(qty), qtyX, rowsEnd + 24, true, 'middle', BAND_INK)}
      </G>}
      {!only && ink(`${pageNo + 1}/${pageCount}`, STATEMENT_WIDTH - SIDE, height - 7, false, 'end', MUTED, 11)}
    </Svg>
  )
})

/** 사진 파일 이름 (여러 장이면 뒤에 -1, -2) */
export const statementPhotoName = (date: string, tab: StatementTab, pageNo: number, pageCount: number): string => `정산내역서-${date}-${modeWord(tab)}${pageCount > 1 ? `-${pageNo + 1}` : ''}.png`

/** 화면에 보이는 그 그림(svg)을 찍어 공유 창으로 넘긴다 */
export async function shareStatementPhoto(svg: Svg | null, sheet: Pick<StatementSheet, 'date' | 'tab' | 'shop'>, page: readonly StatementPageRow[], pageNo: number, pageCount: number): Promise<void> {
  const { height } = statementGeometry(page, sheet.shop, pageNo === pageCount - 1, pageCount === 1)
  const bytes = await snapshot(svg, height, STATEMENT_WIDTH)
  await nativeShareFile()(bytes, statementPhotoName(sheet.date, sheet.tab, pageNo, pageCount), 'image/png')
}

/** 화면용: 모든 줄을 한 장에 (D-UX4-145) */
export const statementScreenPages = (rows: readonly StatementRow[], tab: StatementTab): StatementPageRow[][] => statementPages(rows, tab, Number.POSITIVE_INFINITY)

/**
 * 화면에 보이는 정산 내역서 — 화면에서는 statementScreenPages로 한 장만 넘긴다(여러 장을 주면 이어 그린다). 구매자별 표는 줄을 누르면 그 손님 정산서가 열린다(그림 위에 투명한 누름 자리).
 * refs: 장마다 그림(사진을 찍을 때 쓴다). 그림 위에는 아무것도 덧그리지 않는다 — 화면과 사진이 같아야 한다
 */
export function StatementPages({ pages, sheet, width, refs, onRow, rowLabel }: {
  readonly pages: readonly (readonly StatementPageRow[])[]; readonly sheet: StatementSheet; readonly width: number; readonly refs: { current: (Svg | null)[] }
  readonly onRow?: (key: string) => void; readonly rowLabel?: (row: StatementRow) => string
}) {
  const scale = width / STATEMENT_WIDTH
  return <View style={{ gap: SPACE.md }}>
    {pages.map((page, pageNo) => {
      const { top } = statementGeometry(page, sheet.shop, pageNo === pages.length - 1, pages.length === 1)
      return <View key={pageNo} style={{ width }}>
        <StatementPaper ref={node => { refs.current[pageNo] = node }} {...sheet} page={page} pageNo={pageNo} pageCount={pages.length} width={width} />
        {onRow !== undefined && page.map(({ row, y, height }) => (
          <Tap key={row.key} role="button" aria-label={rowLabel?.(row) ?? row.label} onPress={() => onRow(row.key)} pressScale={1}
            style={({ pressed }) => ({ position: 'absolute', left: 0, right: 0, top: (top + y) * scale, height: height * scale, backgroundColor: pressed ? 'rgba(23,59,76,0.08)' : 'transparent' })} />
        ))}
      </View>
    })}
  </View>
}

/** 사진이 여러 장일 때: 몇 번째 장을 사진으로 저장할지 고른다 — 보이는 그림은 화면과 같은 StatementPaper */
export function StatementPhoto({ pages, sheet, width, onClose, onError }: {
  readonly pages: readonly (readonly StatementPageRow[])[]; readonly sheet: StatementSheet; readonly width: number; readonly onClose: () => void; readonly onError: () => void
}) {
  const svg = useRef<Svg>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const pageNo = Math.min(index, pages.length - 1)
  const page = pages[pageNo]!
  const last = pageNo === pages.length - 1
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { height } = statementGeometry(page, sheet.shop, last, pages.length === 1)
      const bytes = await snapshot(svg.current, height, STATEMENT_WIDTH)
      onClose()
      await wait(SHEET_GAP_MS)
      await nativeShareFile()(bytes, statementPhotoName(sheet.date, sheet.tab, pageNo, pages.length), 'image/png')
    } catch { onError(); onClose() }
    finally { setBusy(false) }
  }
  return <BottomSheet visible onClose={onClose} title={`${modeWord(sheet.tab)} 정산 사진`} actions={<BigButton label="이 장 사진 저장" busy={busy} onPress={() => void save()} />}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.sm }}>
      <SmallButton label="이전 장" disabled={busy || pageNo === 0} onPress={() => setIndex(pageNo - 1)} /><Txt>{`${pageNo + 1} / ${pages.length}`}</Txt>
      <SmallButton label="다음 장" disabled={busy || last} onPress={() => setIndex(pageNo + 1)} />
    </View>
    <View><StatementPaper ref={svg} {...sheet} page={page} pageNo={pageNo} pageCount={pages.length} width={Math.min(width, 320)} /></View>
  </BottomSheet>
}
