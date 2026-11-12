import { useMemo, useRef, useState } from 'react'
import { View, useWindowDimensions } from 'react-native'
import Svg, { G, Rect, Text as Ink } from 'react-native-svg'
import { salesMoney, type StatementRow, type StatementTab } from '../../lib/broadcast-sales.ts'
import { nativeShareFile } from '../../native/index.ts'
import { BigButton, BottomSheet, SmallButton, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { wait, SHEET_GAP_MS } from '../../lib/receipt-sms-flow.ts'
import { snapshot, wrap } from './paper-image.ts'

const WIDTH = 480
const TINT = '#BDE4F3'
function text(value: string, x: number, y: number, bold = false, align: 'start' | 'middle' | 'end' = 'start') {
  return <Ink key={x+'-'+y} x={x} y={y} fontSize={15} fontWeight={bold ? '700' : '400'} textAnchor={align} fill="#131313">{value}</Ink>
}
function photoPages(rows: StatementRow[], products: boolean) {
  const pages: { row: StatementRow; words: string[]; y: number }[][] = [[]]
  let y = 0
  for (const row of rows) {
    const words = wrap(row.label, products ? 12 : 15)
    const h = words.length * 20 + 5
    if (y && y + h > 1400) { pages.push([]); y = 0 }
    pages[pages.length - 1]!.push({ row, words, y })
    y += h
  }
  return pages
}

export function StatementPhoto({ rows, tab, shop, date, total, qty, onClose, onError }: {
  rows: StatementRow[]; tab: StatementTab; shop: string; date: string; total: number | null; qty: number; onClose: () => void; onError: () => void
}) {
  const svg = useRef<Svg>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const products = tab === 'products'
  const pages = useMemo(() => photoPages(rows, products), [rows, products])
  const pageNo = Math.min(index, pages.length - 1)
  const page = pages[pageNo]!
  const shopLines = wrap(shop, 21)
  const head = 32 + shopLines.length * 20
  const top = head + 28
  const tail = page[page.length - 1]
  const foot = top + (tail ? tail.y + tail.words.length * 20 + 5 : 0)
  const last = pageNo === pages.length - 1
  const height = foot + (last ? 30 : 0) + 4
  const display = Math.min(useWindowDimensions().width - 56, WIDTH)
  const mode = products ? '상품별' : '구매자별'
  const nameX = products ? 58 : 8
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const bytes = await snapshot(svg.current, height, WIDTH)
      onClose()
      await wait(SHEET_GAP_MS)
      const part = pages.length > 1 ? `-${pageNo + 1}` : ''
      await nativeShareFile()(bytes, `정산내역서-${date}-${mode}${part}.png`, 'image/png')
    } catch { onError(); onClose() }
    finally { setBusy(false) }
  }
  return <BottomSheet visible onClose={onClose} title={`${mode} 정산 사진`} actions={<BigButton label="사진 저장" busy={busy} onPress={() => void save()} />}>
    {pages.length > 1 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.sm }}>
      <SmallButton label="이전 장" disabled={busy || pageNo === 0} onPress={() => setIndex(pageNo - 1)} /><Txt>{`${pageNo + 1} / ${pages.length}`}</Txt>
      <SmallButton label="다음 장" disabled={busy || last} onPress={() => setIndex(pageNo + 1)} />
    </View>}
    <View>
      <Svg ref={svg} width={display} height={display * height / WIDTH} viewBox={`0 0 ${WIDTH} ${height}`}>
        <Rect width={WIDTH} height={height} fill="#fff" />
        {text('정산 내역서 · '+mode, 8, 20, true)}{text(date, 472, 20, false, 'end')}
        {shopLines.map((line, i) => text(line, 8, 42 + i * 20))}
        <Rect y={head} width={WIDTH} height={28} fill={TINT} />
        {products && text('번호', 8, head + 20, true)}{text(products ? '상품명' : '구매자', nameX, head + 20, true)}
        {text('판매 금액(원)', 382, head + 20, true, 'end')}{text('개수', 438, head + 20, true, 'middle')}
        {page.map(({ row, y, words }) => <G key={row.key}>
          {products && text(String(row.no), 8, top + y + 18)}
          {words.map((word, i) => text(word, nameX, top + y + 18 + i * 20))}
          {text(row.money === null ? '확인 필요' : '₩', 251, top + y + 18)}
          {row.money !== null && text(salesMoney(row.money).slice(0,-1), 382, top + y + 18, false, 'end')}
          {text(String(row.qty), 438, top + y + 18, false, 'middle')}
        </G>)}
        {last && <G><Rect y={foot} width={WIDTH} height={30} fill={TINT} />{text('총계', 8, foot + 21, true)}
          {text(total === null ? '확인 필요' : '₩', 251, foot + 21, true)}{total !== null && text(salesMoney(total).slice(0,-1), 382, foot + 21, true, 'end')}
          {text(String(qty), 438, foot + 21, true, 'middle')}</G>}
      </Svg>
    </View>
  </BottomSheet>
}
