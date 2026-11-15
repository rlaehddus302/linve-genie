// 방송 정산 화면 (D-RETRO-60~64, 판매자 요청 2026-11-12 "방송이 끝나면 바로 한 화면에서 정산 정보를 보고 … 화면에 보이는 정산서를 그대로 사진으로"):
// 총 매출 · 구매자별/상품별 표 · 내보내기(사진·CSV·엑셀) · 구매자별 정산서 · 모두에게 보내기.
// - 표는 사진과 같은 그림(StatementPaper)이다 — 화면에 보이는 그 그림을 찍어 내보낸다 (D-RETRO-62).
// - 정산 정보(계좌·전화번호·배송비)를 한 번도 정하지 않았으면 방송을 끝낸 직후와 정산서를 처음 만들 때 한 번 묻는다. 건너뛸 수 있다 (D-RETRO-60).
// - 모두에게 보내기(D-RETRO-64): 문자는 판매자 휴대폰의 문자 앱으로 한 명씩 보낸다(앱이 대신 보내지 않는다) — 보내면 다음 손님으로 바로 넘어가고 보낸 손님을 표시한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import type Svg from 'react-native-svg'
import { getBytes, put, isApiError, withRetry } from '../../api/client.ts'
import { rememberCached, useCachedGet } from '../../lib/cached-get.ts'
import { type broadcastSales, salesMoney, statementName, statementRows } from '../../lib/broadcast-sales.ts'
import type { BuyerNames } from '../../lib/derive.ts'
import { markBuyerSent, markStatementInfoAsked, sentBuyers, shouldAskStatementInfo, useStatementInfo } from '../../lib/statement-info.ts'
import { BigButton, BottomSheet, ButtonRow, SmallButton, TextField, Txt } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Pill } from '../../ui/day-pills.tsx'
import { ExportRows, EXPORT_FAILED, type ExportKind } from '../order-export.tsx'
import { nativeShareFile } from '../../native/index.ts'
import { wait, SHEET_GAP_MS } from '../../lib/receipt-sms-flow.ts'
import { LOAD_FAILED, STATEMENT_INFO_TITLE, StatementInfoSheet } from '../StatementInfo.tsx'
import { StatementPages, StatementPhoto, shareStatementPhoto, statementPages, statementScreenPages } from './StatementPhoto.tsx'
import { BuyerOrderPaper } from './BuyerOrderPaper.tsx'

type Sales = ReturnType<typeof broadcastSales>

export const SEND_ALL_LABEL = '모두에게 보내기'
export const SEND_ALL_TITLE = '모두에게 정산서 보내기'
export const SEND_ALL_BODY = '한 명씩 문자 앱이 열려요. 보내고 돌아오면 다음 손님으로 넘어가요.'
export const SEND_ALL_DONE = '모두에게 보냈어요. 다시 보내려면 표에서 손님을 눌러 주세요.'
export const SENT_WORD = '보냄'
export const NOT_SENT_WORD = '아직'
export const sendAllProgress = (total: number, sent: number): string => `구매자 ${total}명 가운데 ${sent}명에게 보냈어요.`

export function BroadcastSalesList({ broadcastId, title, date, sales, names, buyer, select, inset, rehearsal, sealed, justEnded = false }: {
  broadcastId: string; title: string; date: string; sales: Sales; names: BuyerNames; buyer: string | null; select: (id: string | null) => void; inset: number; rehearsal: boolean; sealed: boolean
  /** 이 화면을 보는 동안 방송이 끝났다 — 정산 정보가 비어 있으면 한 번 묻는다 */
  justEnded?: boolean
}) {
  const path = `/api/broadcasts/${encodeURIComponent(broadcastId)}/order-shop`
  const { data: shop, reload } = useCachedGet<{ name: string }>(path)
  const statement = useStatementInfo()
  const { width: windowWidth } = useWindowDimensions()
  const [products, setProducts] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [photo, setPhoto] = useState(false)
  const [saving, setSaving] = useState<ExportKind | null>(null)
  const [shareError, setShareError] = useState('')
  const [asking, setAsking] = useState(false)
  /** 정산 정보 판이 닫힌 뒤 이어서 할 일 (정산서 열기·연속 보내기 시작) */
  const afterAsk = useRef<(() => void) | null>(null)
  const [sendAll, setSendAll] = useState(false)
  const [queue, setQueue] = useState(false)
  const [sent, setSent] = useState<readonly string[]>(() => sentBuyers(broadcastId))
  const [doneNote, setDoneNote] = useState('')
  const papers = useRef<(Svg | null)[]>([])
  const tab = products ? 'products' : 'buyers'
  const rows = useMemo(() => statementRows(sales, tab, id => names.name(id)), [tab, sales, names])
  const buyerRows = useMemo(() => statementRows(sales, 'buyers', id => names.name(id)), [sales, names])
  // 화면은 한 장으로 잇고, 사진만 A4 장으로 나눈다 (D-UX4-145)
  const screenPages = useMemo(() => statementScreenPages(rows, tab), [rows, tab])
  const pages = useMemo(() => statementPages(rows, tab), [rows, tab])
  const sheet = { tab, date, shop: shop?.name ?? title, total: sales.total, qty: sales.qty } as const
  const paperWidth = Math.min(windowWidth - 2 * GUTTER, 480)
  const sentCount = buyerRows.filter(row => sent.includes(row.key)).length
  const firstUnsent = buyerRows.find(row => !sent.includes(row.key))

  // 방송을 끝낸 직후: 정산 정보가 비어 있으면 한 번 묻는다 (연습 방송은 묻지 않는다)
  const { info, editable } = statement
  useEffect(() => {
    if (!justEnded || rehearsal || asking) return
    if (!shouldAskStatementInfo('end', broadcastId, { info, editable })) return
    markStatementInfoAsked('end', broadcastId)
    setAsking(true)
  }, [justEnded, rehearsal, asking, broadcastId, info, editable])
  // 정산서 화면에서 뒤로 나오면 연속 보내기도 끝난다
  useEffect(() => {
    if (buyer === null) setQueue(false)
  }, [buyer])

  /** 정산서를 처음 만들 때: 정산 정보를 한 번도 정하지 않았으면 먼저 묻고, 판이 닫히면 이어서 한다 */
  const withInfo = (run: () => void) => {
    if (!rehearsal && shouldAskStatementInfo('first', broadcastId, { info, editable })) {
      markStatementInfoAsked('first', broadcastId)
      afterAsk.current = run
      setAsking(true)
    } else run()
  }
  const closeAsk = () => {
    setAsking(false)
    const run = afterAsk.current
    afterAsk.current = null
    run?.()
  }
  const exportFile = async (kind: ExportKind) => {
    if (saving) return
    setSaving(kind)
    setShareError('')
    try {
      if (kind === 'photo') {
        setMenu(false)
        await wait(SHEET_GAP_MS)
        // A4 한 장에 들면 화면에 보이는 그 그림을 찍는다(같은 그림). 여러 장이면 몇 번째 장인지 고른다
        if (pages.length > 1) setPhoto(true)
        else await shareStatementPhoto(papers.current[0] ?? null, sheet, pages[0]!, 0, 1)
      } else {
        const { bytes, type } = await withRetry(() => getBytes(`/api/broadcasts/${encodeURIComponent(broadcastId)}/statement/${tab}/${kind}`))
        setMenu(false)
        await wait(SHEET_GAP_MS)
        await nativeShareFile()(bytes, `정산내역서-${date}-${products ? '상품별' : '구매자별'}.${kind}`, type.split(';')[0]!)
      }
    } catch { setMenu(false); setShareError(EXPORT_FAILED) }
    finally { setSaving(null) }
  }
  const order = sales.orders.find(row => row.id === buyer)
  const save = async () => {
    if (!draft?.trim() || busy) return
    setBusy(true)
    try {
      const result = await put<{ name: string }>(path, { name: draft.trim() })
      rememberCached(path, result)
      setDraft(null)
    } catch (e) { setError(isApiError(e) ? e.message : '가게 이름을 저장하지 못했어요.') }
    finally { setBusy(false) }
  }
  /** 연속 보내기: 지금 손님 다음의 아직 보내지 않은 손님으로. 없으면 표로 돌아간다 */
  const nextBuyer = (current: string, sentNow: readonly string[]) => {
    const at = buyerRows.findIndex(row => row.key === current)
    const next = buyerRows.slice(at + 1).find(row => !sentNow.includes(row.key))
    if (next !== undefined) { select(next.key); return }
    setQueue(false)
    setDoneNote(`모두에게 보내기를 마쳤어요. ${sendAllProgress(buyerRows.length, buyerRows.filter(row => sentNow.includes(row.key)).length)}`)
    select(null)
  }
  const startSendAll = () => {
    setSendAll(false)
    if (firstUnsent === undefined) return
    const first = firstUnsent.key
    withInfo(() => { setDoneNote(''); setQueue(true); select(first) })
  }
  const askSheet = <StatementInfoSheet visible={asking} info={editable ? info : null} onLater={closeAsk} onSaved={closeAsk} />

  if (buyer !== null) {
    if (!order) return <Txt>현재 확정된 주문이 없어요.</Txt>
    if (!shop?.name) return <View style={{ padding: GUTTER, gap: SPACE.md }}><Txt>정산서의 가게 이름을 불러오는 중이에요.</Txt><SmallButton label="다시 불러오기" onPress={() => void reload()} /></View>
    // 정산 정보를 모르면 만들지 않는다 — 받지 않기로 한 배송비가 붙은 정산서가 손님에게 나가지 않게
    if (info === null) return <View style={{ padding: GUTTER, gap: SPACE.md }}><Txt>{statement.failed ? LOAD_FAILED : '정산 정보를 불러오는 중이에요.'}</Txt><SmallButton label="다시 불러오기" onPress={statement.reload} /></View>
    const at = buyerRows.findIndex(row => row.key === order.id)
    const lastInQueue = buyerRows.slice(at + 1).every(row => sent.includes(row.key))
    return <>
      <BuyerOrderPaper key={order.id} {...{ order, date, shop: shop.name, buyerName: statementName(names.name(buyer)), inset, rehearsal, sealed, info }}
        onSent={() => setSent(markBuyerSent(broadcastId, order.id))}
        queue={queue ? { position: at + 1, total: buyerRows.length, last: lastInQueue, next: () => nextBuyer(order.id, sentBuyers(broadcastId)) } : undefined} />
      {askSheet}
    </>
  }
  return <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: SPACE.md, gap: SPACE.md }}>
      <View style={{ gap: SPACE.sm, paddingTop: SPACE.md }}>
        <Txt step="caption" color="textSub">{`판매 수량 ${sales.qty}개 · 구매자 ${sales.buyers}명`}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
          <Pill label="구매자별" ariaLabel="구매자별" on={!products} onPress={() => setProducts(false)} />
          <Pill label="상품별" ariaLabel="상품별" on={products} onPress={() => setProducts(true)} />
          <View style={{ flexGrow: 1 }} />
          <SmallButton label="가게 이름" onPress={() => { setError(''); setDraft(shop?.name ?? '') }} />
          {editable ? <SmallButton label={STATEMENT_INFO_TITLE} onPress={() => { afterAsk.current = null; setAsking(true) }} /> : null}
        </View>
        {doneNote ? <Txt color="textSub">{doneNote}</Txt> : null}
      </View>
      <StatementPages key={tab} pages={screenPages} sheet={sheet} width={paperWidth} refs={papers}
        {...(products ? {} : { onRow: (key: string) => withInfo(() => select(key)), rowLabel: row => `${row.label} 정산서 · ${salesMoney(row.money)} · ${row.qty}개${sent.includes(row.key) ? ` · ${SENT_WORD}` : ''}` })} />
    </ScrollView>
    <View style={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: inset + SPACE.sm, gap: SPACE.sm }}>
      {shareError ? <Txt color="textSub">{shareError}</Txt> : null}
      <ButtonRow>
        {!products && !rehearsal && buyerRows.length > 0 ? <>
          <BigButton kind="secondary" label="내보내기" disabled={saving !== null || !shop?.name} onPress={() => { setShareError(''); setMenu(true) }} />
          <BigButton label={SEND_ALL_LABEL} disabled={!shop?.name} onPress={() => setSendAll(true)} />
        </> : <BigButton label="내보내기" disabled={saving !== null || !shop?.name} onPress={() => { setShareError(''); setMenu(true) }} />}
      </ButtonRow>
    </View>
    <BottomSheet visible={menu} title="내보내기" onClose={() => setMenu(false)}>
      <View style={{ marginHorizontal: -SPACE.xl }}><ExportRows busy={saving} save={kind => void exportFile(kind)} /></View>
    </BottomSheet>
    {photo && <StatementPhoto pages={pages} sheet={sheet} width={paperWidth} onClose={() => setPhoto(false)} onError={() => setShareError(EXPORT_FAILED)} />}
    <BottomSheet visible={draft !== null} title="정산서 가게 이름" onClose={() => setDraft(null)} actions={<BigButton label="저장" busy={busy} disabled={!draft?.trim()} onPress={() => void save()} />}>
      <TextField label="가게 이름" value={draft ?? ''} onChangeText={setDraft} maxLength={40} error={error || null} />
    </BottomSheet>
    <BottomSheet visible={sendAll} title={SEND_ALL_TITLE} description={SEND_ALL_BODY} onClose={() => setSendAll(false)} testID="send-all"
      actions={<>
        <BigButton kind="outline" label="닫기" onPress={() => setSendAll(false)} />
        <BigButton label={sentCount === 0 ? '보내기 시작' : '이어서 보내기'} disabled={firstUnsent === undefined} onPress={startSendAll} />
      </>}>
      <Txt weight="bold">{firstUnsent === undefined ? SEND_ALL_DONE : sendAllProgress(buyerRows.length, sentCount)}</Txt>
      <View role="list" aria-label="보낼 손님">
        {buyerRows.map(row => {
          const done = sent.includes(row.key)
          return <View key={row.key} role="listitem" aria-label={`${row.label} ${done ? SENT_WORD : NOT_SENT_WORD}`} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xs }}>
            <View style={{ flex: 1 }}><Txt>{row.label}</Txt></View>
            <Txt step="caption" weight={done ? 'bold' : 'regular'} color={done ? 'text' : 'textSub'}>{done ? SENT_WORD : NOT_SENT_WORD}</Txt>
          </View>
        })}
      </View>
    </BottomSheet>
    {askSheet}
  </View>
}
