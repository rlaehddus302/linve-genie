// 구매자별 정산서 (D-RETRO-61, 판매자가 직접 만들어 쓰던 양식 2026-11-12):
//   ✲{가게 이름} 정산서✲ (초록 굵은 제목 · 연한 하늘색 띠) → 방송 이름 · {손님} 님 · 날짜(YYYY.MM.DD)
//   → 번호 / 종자 / 개수 / 가격(원) 표(칸 선, ₩ 기호, 금액 오른쪽 맞춤) → (배송비를 받는 설정이면) 배송비 줄 → 총 개수 줄 → 계좌 줄 → 전화번호 줄.
// - 화면에 보이는 그림(Svg)을 그대로 찍어 사진으로 만든다 — 화면과 사진이 다를 수 없다(D-RETRO-62).
// - 배송비는 정산 정보에서 정한 규칙대로(정수 원). 받지 않으면 줄 자체가 없다. 계좌·전화번호를 넣지 않았으면 그 줄을 뺀다.
// - 단추는 좌우 한 줄(D-UX4-01): 왼쪽 [사진 저장] · 오른쪽 [문자 보내기]. 연속 보내기(D-RETRO-64)에서는 왼쪽 [건너뛰기] · 오른쪽 [문자 보내기].
// - 손님 전화번호·계좌번호는 기록(로그)에 남기지 않는다.
import { useEffect, useRef, useState } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import Svg, { G as SvgGroup, Line, Rect, Text as SvgText } from 'react-native-svg'
import { wrap, snapshot } from './paper-image.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { type BuyerOrder, type SaleLine, type StatementInfo, salesMoney, statementAccount, statementTotals } from '../../lib/broadcast-sales.ts'
import { prepareSms, SHEET_GAP_MS, wait } from '../../lib/receipt-sms-flow.ts'
import { nativeSms, nativeShareFile } from '../../native/index.ts'
import { BigButton, BottomSheet, ButtonRow, SmallButton, TextField, Txt } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'

const WIDTH = 412
const INK = '#172F39'
const MUTED = '#526976'
const TITLE_GREEN = '#1E7B34'
const BAND_LIGHT = '#D8F1FA'
const BAND_DARK = '#A9DCF0'
const GRID = '#7FA9BA'
/** 표의 세로 선 자리: 번호 | 종자 | 개수 | 가격(원) */
const X = { left: 8, name: 72, qty: 236, price: 292, right: 404 } as const
const MID = { no: (X.left + X.name) / 2, name: (X.name + X.qty) / 2, qty: (X.qty + X.price) / 2, wide: (X.name + X.right) / 2 } as const
const HEAD_ROW = 30
const FEE_ROW = 34
const TOTAL_ROW = 36
/** 한 장에 담는 상품 줄 높이 합 — 넘으면 다음 장 */
const PAGE_ROWS_MAX = 650

export const SMS_SENT_NOTE = '정산서 문자를 보냈어요.'
export const SMS_OPENED_NOTE = '문자 앱을 열었어요. 보냈으면 다음 손님으로 넘어가 주세요.'
export const SMS_NO_DEVICE = '이 기기에서는 문자 앱을 열 수 없어요. 정산서 사진을 저장할 수 있어요.'
export const PAPER_CHANGED = '정산서 내용이 바뀌었어요. 금액을 확인하고 다시 눌러 주세요.'
export const PAPER_FAILED = '정산서 사진을 준비하지 못했어요. 다시 눌러 주세요.'

function pagesOf(lines: SaleLine[]) {
  const pages: { line: SaleLine; words: string[]; y: number; height: number }[][] = [[]]
  let used = 0
  for (const line of lines) {
    const words = wrap([line.name, line.variant].filter(Boolean).join(' · '), 10)
    const height = Math.max(34, words.length * 18 + 16)
    if (used + height > PAGE_ROWS_MAX && used > 0) { pages.push([]); used = 0 }
    pages[pages.length - 1]!.push({ line, words, y: used, height })
    used += height
  }
  return pages
}

/** 글 폭 어림 (한글 1 · 영문·숫자 0.68, wrap과 같은 셈) */
const units = (text: string): number => [...text].reduce((sum, ch) => sum + (/[\x20-\x7e]/u.test(ch) ? 0.68 : 1), 0)

function ink(text: string, x: number, y: number, size = 14, bold = false, align: 'start' | 'middle' | 'end' = 'start', color = INK) {
  return <SvgText key={`${x}:${y}:${align}`} x={x} y={y} fontSize={size} fontWeight={bold ? '700' : '400'} fill={color} textAnchor={align}>{text}</SvgText>
}
/** 가격 칸: 왼쪽 ₩ · 오른쪽 맞춘 숫자. 금액을 모르면 "확인 필요" */
function price(amount: number | null, y: number, bold = false) {
  if (amount === null) return ink('확인 필요', X.right - 8, y, 13, bold, 'end')
  return <SvgGroup key={`price:${y}`}>{ink('₩', X.price + 8, y, 14, bold)}{ink(salesMoney(amount).slice(0, -1), X.right - 8, y, 14, bold, 'end')}</SvgGroup>
}
const paperDate = (date: string): string => date.split('-').join('.')

/** 연속 보내기 (D-RETRO-64): 몇 번째 손님인지와 다음 손님으로 넘어가기. next가 null이면 마지막 손님 */
export interface SendQueue {
  readonly position: number
  readonly total: number
  readonly next: () => void
  readonly last: boolean
}

export function BuyerOrderPaper({ order, shop, date, buyerName, inset, sealed, rehearsal, info, queue, onSent }: {
  order: BuyerOrder; shop: string; date: string; buyerName: string; inset: number; sealed: boolean; rehearsal: boolean
  /** 정산 정보 — 계좌·전화번호·방송 이름·배송비 규칙 */
  info: StatementInfo
  queue?: SendQueue | undefined
  /** 이 손님에게 문자를 보냈다 (마지막 장까지) */
  onSent?: (() => void) | undefined
}) {
  const svg = useRef<Svg>(null)
  const { width } = useWindowDimensions()
  const [pageIndex, setPageIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [askPhone, setAskPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const [notice, setNotice] = useState('')
  const [phoneError, setPhoneError] = useState('')
  /** 연속 보내기에서 문자 앱을 열었지만 보냈는지 알 수 없다(안드로이드) — [다음 손님]을 기다린다 */
  const [opened, setOpened] = useState(false)
  const pages = pagesOf(order.lines)
  const index = Math.min(pageIndex, pages.length - 1)
  const page = pages[index]!
  const last = index === pages.length - 1
  const { charged, shipping, total } = statementTotals(order.subtotal, info.shipping)
  const account = statementAccount(info)
  const sellerPhone = info.phone.trim()
  const host = info.hostName.trim()

  // ── 자리 잡기 ──
  // 가게 이름이 길어 줄이 넘어가도 "정산서✲"는 한 덩이로 둔다
  const titleLines = wrap(`✲${shop}`, 16)
  const TITLE_TAIL = ' 정산서✲'
  if (units(titleLines[titleLines.length - 1]! + TITLE_TAIL) <= 16) titleLines[titleLines.length - 1] += TITLE_TAIL
  else titleLines.push(TITLE_TAIL.trim())
  const titleHeight = 16 + 28 * titleLines.length
  const buyerWord = `${buyerName} 님`
  const dateWord = paperDate(date)
  // 방송 이름 · 손님 · 날짜가 한 줄에 들어가면 한 줄로, 길면 손님 이름을 아랫줄에
  // (손님 이름은 가운데에 놓으므로 이름 반쪽 + 양옆 글 가운데 긴 쪽이 표 반쪽에 들어가야 한다)
  const oneLine = (units(buyerWord) * 14) / 2 + Math.max(units(host), units(dateWord)) * 13 + 16 <= (X.right - X.left) / 2
  const buyerLines = oneLine ? [buyerWord] : wrap(buyerWord, 24)
  const infoY = titleHeight + 21
  const buyerY = oneLine ? infoY : infoY + 22
  const tableTop = (oneLine ? infoY : buyerY + (buyerLines.length - 1) * 20) + 12
  const start = tableTop + HEAD_ROW
  const rowsEnd = start + page.reduce((sum, row) => sum + row.height, 0)
  const feeY = rowsEnd
  const totalY = feeY + (charged ? FEE_ROW : 0)
  const accountLines = account === null ? [] : wrap(account, 22)
  const accountY = totalY + TOTAL_ROW
  const accountHeight = account === null ? 0 : Math.max(32, accountLines.length * 18 + 14)
  const phoneY = accountY + accountHeight
  const phoneHeight = sellerPhone === '' ? 0 : 32
  const tableEnd = last ? phoneY + phoneHeight : rowsEnd
  const gridEnd = last ? accountY : rowsEnd
  const height = tableEnd + (pages.length > 1 ? 24 : 10)
  const displayWidth = Math.min(width - 2 * GUTTER, 540)

  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const version = JSON.stringify([order, shop, buyerName, index, info])
  const latest = useRef(version)
  latest.current = version
  const pageWord = `${index + 1}/${pages.length}`
  const totalWord = `${charged ? '배송비 포함 ' : '합계 '}${salesMoney(total)}`

  const action = async (kind: 'sms' | 'save', typed?: string) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    setPhoneError('')
    try {
      let recipient = ''
      if (kind === 'sms') {
        if (!(await nativeSms().available())) { setNotice(SMS_NO_DEVICE); return }
        if (sealed) {
          if (!typed) { setAskPhone(true); return }
          recipient = typed.replace(/[-\s]/g, '')
          if (!/^01[016789]\d{7,8}$/.test(recipient)) { setPhoneError('휴대폰 번호를 확인해 주세요.'); return }
        } else recipient = (await prepareSms(date, order.id, typed ?? null)).phone
      }
      if (!mounted.current) return
      const bytes = await snapshot(svg.current, height, WIDTH)
      if (!mounted.current) return
      if (version !== latest.current) { setNotice(PAPER_CHANGED); return }
      const name = `order-${date}-${newRequestId()}-${index + 1}.png`
      if (kind === 'save') await nativeShareFile()(bytes, name, 'image/png')
      else {
        if (askPhone) { setAskPhone(false); await wait(SHEET_GAP_MS) }
        if (!mounted.current) return
        const text = `[${shop}] ${date} ${buyerName}님 정산서${pages.length > 1 ? ' (' + pageWord + ')' : ''}\n${totalWord}${account === null ? '' : `\n입금 계좌 ${account}`}`
        const result = await nativeSms().compose(recipient, text, { bytes, name, mimeType: 'image/png' })
        if (!mounted.current || result === 'cancelled') return
        // 여러 장이면 다음 장으로, 마지막 장까지 보냈으면 보낸 손님으로 적는다
        if (!last) { setPageIndex(index + 1); setNotice(`${pageWord} 장을 보냈어요. 다음 장도 보내 주세요.`); return }
        onSent?.()
        if (queue === undefined) { if (result === 'sent') setNotice(SMS_SENT_NOTE) }
        // 아이폰은 보냈는지 알려 준다 — 바로 다음 손님으로. 안드로이드는 알 수 없어 판매자가 [다음 손님]을 누른다
        else if (result === 'sent') queue.next()
        else { setOpened(true); setNotice(SMS_OPENED_NOTE) }
      }
    } catch (e) {
      if (!mounted.current) return
      if (isApiError(e) && e.code === 'NO_PHONE') setAskPhone(true)
      else if (askPhone) setPhoneError(isApiError(e) ? e.message : PAPER_FAILED)
      else setNotice(isApiError(e) ? e.message : PAPER_FAILED)
    } finally { setBusy(false) }
  }
  const label = [
    `${shop} 정산서`, host, buyerWord, dateWord,
    page.map(({ line }) => `${line.no}번 ${line.name} ${line.qty}개 ${salesMoney(line.amount)}`).join(', '),
    ...(last ? [...(charged ? [`배송비 ${shipping === 0 ? '무료' : salesMoney(shipping)}`] : []), `총 ${order.qty}개 ${salesMoney(total)}`, ...(account === null ? [] : [`계좌 ${account}`]), ...(sellerPhone === '' ? [] : [`전화번호 ${sellerPhone}`])] : []),
  ].filter(part => part !== '').join('. ')
  const smsLabel = pages.length > 1 ? '이 장 문자 보내기' : '문자 보내기'
  return <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: inset + SPACE.xl, gap: SPACE.md, alignItems: 'center' }}>
    {queue !== undefined ? <Txt step="caption" color="textSub">{`모두에게 보내기 · ${queue.total}명 가운데 ${queue.position}번째`}</Txt> : null}
    <View accessibilityLabel={label}>
      <Svg ref={svg} width={displayWidth} height={displayWidth * height / WIDTH} viewBox={`0 0 ${WIDTH} ${height}`}>
        <Rect width={WIDTH} height={height} fill="white" />
        <Rect width={WIDTH} height={titleHeight} fill={BAND_LIGHT} />
        {titleLines.map((line, i) => ink(line, WIDTH / 2, 33 + i * 28, 22, true, 'middle', TITLE_GREEN))}
        {host !== '' && ink(host, X.left + 4, infoY, 13, false, 'start', MUTED)}
        {ink(dateWord, X.right - 4, infoY, 13, false, 'end', MUTED)}
        {buyerLines.map((line, i) => ink(line, WIDTH / 2, buyerY + i * 20, 14, true, 'middle'))}
        <Rect x={X.left} y={tableTop} width={X.right - X.left} height={HEAD_ROW} fill={BAND_DARK} />
        {ink('번호', MID.no, tableTop + 20, 13, true, 'middle')}{ink('종자', MID.name, tableTop + 20, 13, true, 'middle')}
        {ink('개수', MID.qty, tableTop + 20, 13, true, 'middle')}{ink('가격(원)', (X.price + X.right) / 2, tableTop + 20, 13, true, 'middle')}
        {page.map(({ line, words, y, height: rowHeight }) => {
          const mid = start + y + rowHeight / 2 + 5
          return <SvgGroup key={line.key}>
            {ink(String(line.no), MID.no, mid, 14, false, 'middle')}
            {words.map((word, i) => ink(word, MID.name, mid - (words.length - 1) * 9 + i * 18, 14, false, 'middle'))}
            {ink(String(line.qty), MID.qty, mid, 14, false, 'middle')}
            {price(line.amount, mid)}
            <Line x1={X.left} x2={X.right} y1={start + y + rowHeight} y2={start + y + rowHeight} stroke={GRID} />
          </SvgGroup>
        })}
        {last && <>
          {charged && <SvgGroup>
            {ink('배송비', MID.name, feeY + 22, 14, false, 'middle')}
            {shipping === 0 ? ink('무료', X.right - 8, feeY + 22, 14, false, 'end') : price(shipping, feeY + 22)}
            <Line x1={X.left} x2={X.right} y1={feeY + FEE_ROW} y2={feeY + FEE_ROW} stroke={GRID} />
          </SvgGroup>}
          <Rect x={X.left} y={totalY} width={X.right - X.left} height={TOTAL_ROW} fill={BAND_LIGHT} />
          {ink('총 개수', MID.no, totalY + 24, 13, true, 'middle')}{ink(String(order.qty), MID.name, totalY + 24, 15, true, 'middle')}
          {ink('개', MID.qty, totalY + 24, 14, true, 'middle')}{price(total, totalY + 24, true)}
          {account !== null && <SvgGroup>
            <Line x1={X.left} x2={X.right} y1={accountY} y2={accountY} stroke={GRID} />
            {ink('계좌', MID.no, accountY + accountHeight / 2 + 5, 13, true, 'middle')}
            {accountLines.map((line, i) => ink(line, MID.wide, accountY + accountHeight / 2 + 5 - (accountLines.length - 1) * 9 + i * 18, 14, false, 'middle'))}
          </SvgGroup>}
          {sellerPhone !== '' && <SvgGroup>
            <Line x1={X.left} x2={X.right} y1={phoneY} y2={phoneY} stroke={GRID} />
            {ink('전화번호', MID.no, phoneY + 21, 13, true, 'middle')}
            {ink(sellerPhone, MID.wide, phoneY + 21, 14, false, 'middle')}
          </SvgGroup>}
        </>}
        {/* 칸 선: 표 바깥 테두리 · 세로 선(상품·배송비·총 개수 줄은 네 칸, 계좌·전화번호 줄은 두 칸) */}
        <Rect x={X.left} y={tableTop} width={X.right - X.left} height={tableEnd - tableTop} fill="none" stroke={GRID} />
        <Line x1={X.left} x2={X.right} y1={start} y2={start} stroke={GRID} />
        <Line x1={X.name} x2={X.name} y1={tableTop} y2={tableEnd} stroke={GRID} />
        <Line x1={X.qty} x2={X.qty} y1={tableTop} y2={gridEnd} stroke={GRID} />
        <Line x1={X.price} x2={X.price} y1={tableTop} y2={gridEnd} stroke={GRID} />
        {pages.length > 1 && ink(pageWord, X.right, height - 7, 11, false, 'end', MUTED)}
      </Svg>
    </View>
    {pages.length > 1 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
      <SmallButton label="이전 장" disabled={busy || index === 0} onPress={() => setPageIndex(index - 1)} /><Txt>{pageWord}</Txt>
      <SmallButton label="다음 장" disabled={busy || last} onPress={() => setPageIndex(index + 1)} />
    </View>}
    <View style={{ width: displayWidth, gap: SPACE.sm }}>
      {queue !== undefined && !rehearsal ? (
        // 연속 보내기: 왼쪽은 넘어가기(건너뛰기 · 다시 보내기), 오른쪽은 다음으로 가는 일
        opened ? <ButtonRow>
          <BigButton kind="secondary" label="다시 보내기" disabled={busy || total === null} onPress={() => { setOpened(false); void action('sms') }} />
          <BigButton label={queue.last ? '마치기' : '다음 손님'} onPress={() => { setOpened(false); setNotice(''); queue.next() }} />
        </ButtonRow> : <ButtonRow>
          <BigButton kind="secondary" label={queue.last ? '건너뛰고 마치기' : '건너뛰기'} disabled={busy} onPress={queue.next} />
          <BigButton label={smsLabel} busy={busy} disabled={total === null} onPress={() => void action('sms')} />
        </ButtonRow>
      ) : <ButtonRow>
        <BigButton kind="secondary" label="사진 저장" disabled={busy || total === null} onPress={() => void action('save')} />
        {!rehearsal && <BigButton label={smsLabel} busy={busy} disabled={total === null} onPress={() => void action('sms')} />}
      </ButtonRow>}
      {notice ? <Txt>{notice}</Txt> : null}
    </View>
    <BottomSheet visible={askPhone} onClose={() => setAskPhone(false)} title={`${buyerName}님에게 문자 보내기`} actions={<BigButton label="문자 앱 열기" disabled={phone.replace(/\D/g, '').length < 10} busy={busy} onPress={() => void action('sms', phone)} />}>
      <TextField label="받는 번호" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} error={phoneError || null} />
    </BottomSheet>
  </ScrollView>
}
