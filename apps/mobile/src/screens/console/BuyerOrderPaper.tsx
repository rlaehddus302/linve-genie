import { useEffect, useRef, useState } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import Svg, { G as SvgGroup, Line, Rect, Text as SvgText } from 'react-native-svg'
import { wrap, snapshot } from './paper-image.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { type BuyerOrder, type SaleLine, salesMoney, shippingFor } from '../../lib/broadcast-sales.ts'
import { prepareSms, SHEET_GAP_MS, wait } from '../../lib/receipt-sms-flow.ts'
import { nativeSms, nativeShareFile } from '../../native/index.ts'
import { BigButton, BottomSheet, SmallButton, TextField, Txt } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'

const WIDTH = 412
const INK = '#172F39'
const MUTED = '#526976'
const TINT = '#D8F1FA'
const RULE = '#D6E2E7'

function pagesOf(lines: SaleLine[]) {
  const pages: { line: SaleLine; words: string[]; y: number; height: number }[][] = [[]]
  let used = 0
  for (const line of lines) {
    const words = wrap([line.name, line.variant].filter(Boolean).join(' · '), 9)
    const height = Math.max(37, words.length * 18 + 14)
    if (used + height > 650 && used > 0) { pages.push([]); used = 0 }
    pages[pages.length - 1]!.push({ line, words, y: used, height })
    used += height
  }
  return pages
}

function ink(text: string, x: number, y: number, size = 14, bold = false, align: 'start' | 'end' = 'start', color = INK) {
  return <SvgText key={`${x}:${y}`} x={x} y={y} fontSize={size} fontWeight={bold ? '700' : '400'} fill={color} textAnchor={align}>{text}</SvgText>
}

export function BuyerOrderPaper({ order, shop, date, buyerName, inset, sealed, rehearsal }: {
  order: BuyerOrder; shop: string; date: string; buyerName: string; inset: number; sealed: boolean; rehearsal: boolean
}) {
  const svg = useRef<Svg>(null)
  const { width } = useWindowDimensions()
  const [pageIndex, setPageIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [askPhone, setAskPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const [notice, setNotice] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const pages = pagesOf(order.lines)
  const index = Math.min(pageIndex, pages.length - 1)
  const page = pages[index]!
  const last = index === pages.length - 1
  const shopLines = wrap(shop, 14)
  const buyerLines = wrap(`${buyerName}님`, 20)
  const buyerY = 64 + 26 * shopLines.length
  const headY = buyerY + 22 * buyerLines.length + 12
  const start = headY + 32
  const foot = start + page.reduce((sum, row) => sum + row.height, 0)
  const height = foot + (last ? 126 : 28)
  const displayWidth = Math.min(width - 2 * GUTTER, 540)
  const shipping = order.subtotal === null ? null : shippingFor(order.subtotal)
  const total = shipping === null || order.subtotal === null ? null : order.subtotal + shipping
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const version = JSON.stringify([order, shop, buyerName, index])
  const latest = useRef(version)
  latest.current = version
  const pageWord = `${index + 1}/${pages.length}`

  const action = async (kind: 'sms' | 'save', typed?: string) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    setPhoneError('')
    try {
      let recipient = ''
      if (kind === 'sms') {
        if (!(await nativeSms().available())) { setNotice('이 기기에서는 문자 앱을 열 수 없어요. 주문서 사진을 저장할 수 있어요.'); return }
        if (sealed) {
          if (!typed) { setAskPhone(true); return }
          recipient = typed.replace(/[-\s]/g, '')
          if (!/^01[016789]\d{7,8}$/.test(recipient)) { setPhoneError('휴대폰 번호를 확인해 주세요.'); return }
        } else recipient = (await prepareSms(date, order.id, typed ?? null)).phone
      }
      if (!mounted.current) return
      const bytes = await snapshot(svg.current, height, WIDTH)
      if (!mounted.current) return
      if (version !== latest.current) { setNotice('주문 내용이 바뀌었어요. 금액을 확인하고 다시 눌러 주세요.'); return }
      const name = `order-${date}-${newRequestId()}-${index + 1}.png`
      if (kind === 'save') await nativeShareFile()(bytes, name, 'image/png')
      else {
        if (askPhone) { setAskPhone(false); await wait(SHEET_GAP_MS) }
        if (!mounted.current) return
        const result = await nativeSms().compose(recipient, `[${shop}] ${date} ${buyerName}님 주문서${pages.length > 1 ? ' (' + pageWord + ')' : ''}\n배송비 포함 ${salesMoney(total)}`, { bytes, name, mimeType: 'image/png' })
        if (result === 'sent') setNotice('주문서 문자를 보냈어요.')
      }
    } catch (e) {
      if (!mounted.current) return
      if (isApiError(e) && e.code === 'NO_PHONE') setAskPhone(true)
      else if (askPhone) setPhoneError(isApiError(e) ? e.message : '주문서 사진을 준비하지 못했어요. 다시 눌러 주세요.')
      else setNotice(isApiError(e) ? e.message : '주문서 사진을 준비하지 못했어요. 다시 눌러 주세요.')
    } finally { setBusy(false) }
  }
  return <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: inset + SPACE.xl, gap: SPACE.md, alignItems: 'center' }}>
    <View accessibilityLabel={`${shop}, ${date}, ${buyerName} 주문서. ${page.map(({ line }) => `${line.no}번 ${line.name} ${line.qty}개 ${salesMoney(line.amount)}`).join(', ')}. 배송비 포함 ${salesMoney(total)}`}>
      <Svg ref={svg} width={displayWidth} height={displayWidth * height / WIDTH} viewBox={`0 0 ${WIDTH} ${height}`}>
        <Rect width={WIDTH} height={height} fill="white" />
        {ink('주문서', 18, 29, 14, true, 'start', MUTED)}
        {ink(date, 394, 29, 14, false, 'end', MUTED)}
        {shopLines.map((line, i) => ink(line, 18, 63 + i * 26, 24, true))}
        {buyerLines.map((line, i) => ink(line, 18, buyerY + i * 22, 17, true))}
        <Rect x={12} y={headY} width={388} height={32} rx={4} fill={TINT} />
        {ink('번호', 20, headY + 21, 13, true)}{ink('상품명', 74, headY + 21, 13, true)}
        {ink('개수', 275, headY + 21, 13, true, 'end')}{ink('가격', 392, headY + 21, 13, true, 'end')}
        {page.map(({ line, words, y, height: rowHeight }) => <SvgGroup key={line.key}>
          {ink(String(line.no), 20, start + y + 23)}
          {words.map((word, i) => ink(word, 74, start + y + 23 + i * 18))}
          {ink(String(line.qty), 275, start + y + 23, 14, false, 'end')}
          {ink(salesMoney(line.amount), 392, start + y + 23, 14, false, 'end')}
          <Line x1={16} x2={396} y1={start + y + rowHeight} y2={start + y + rowHeight} stroke={RULE} />
        </SvgGroup>)}
        {last && <>
          {ink('상품 합계', 20, foot + 25)}{ink(salesMoney(order.subtotal), 392, foot + 25, 14, false, 'end')}
          {ink('배송비', 20, foot + 49)}{ink(shipping === 0 ? '무료' : salesMoney(shipping), 392, foot + 49, 14, false, 'end')}
          <Rect x={12} y={foot + 61} width={388} height={37} rx={4} fill={TINT} />
          {ink('총 주문 금액', 20, foot + 85, 16, true)}{ink(salesMoney(total), 392, foot + 85, 18, true, 'end')}
          {ink('상품 합계 50,000원 이상 무료 배송', 20, foot + 116, 11, false, 'start', MUTED)}
        </>}
        {pages.length > 1 && ink(pageWord, 392, height - 8, 11, false, 'end', MUTED)}
      </Svg>
    </View>
    {pages.length > 1 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
      <SmallButton label="이전 장" disabled={busy || index === 0} onPress={() => setPageIndex(index - 1)} /><Txt>{pageWord}</Txt>
      <SmallButton label="다음 장" disabled={busy || last} onPress={() => setPageIndex(index + 1)} />
    </View>}
    <View style={{ width: displayWidth, gap: SPACE.sm }}>
      {!rehearsal && <BigButton label={pages.length > 1 ? '이 장을 문자로 보내기' : '주문서 문자 보내기'} busy={busy} disabled={total === null} onPress={() => void action('sms')} />}
      <BigButton kind="secondary" label="주문서 사진 저장" disabled={busy || total === null} onPress={() => void action('save')} />
      {notice ? <Txt>{notice}</Txt> : null}
    </View>
    <BottomSheet visible={askPhone} onClose={() => setAskPhone(false)} title={`${buyerName}님에게 문자 보내기`} actions={<BigButton label="문자 앱 열기" disabled={phone.replace(/\D/g, '').length < 10} busy={busy} onPress={() => void action('sms', phone)} />}>
      <TextField label="받는 번호" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} error={phoneError || null} />
    </BottomSheet>
  </ScrollView>
}
