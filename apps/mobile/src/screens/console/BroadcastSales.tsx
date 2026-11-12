import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { getBytes, put, isApiError, withRetry } from '../../api/client.ts'
import { rememberCached, useCachedGet } from '../../lib/cached-get.ts'
import { type broadcastSales, salesMoney, statementName, statementRows } from '../../lib/broadcast-sales.ts'
import type { BuyerNames } from '../../lib/derive.ts'
import { BigButton, BottomSheet, Icon, SmallButton, Tap, TextField, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Pill } from '../../ui/day-pills.tsx'
import { ExportRows, EXPORT_FAILED, type ExportKind } from '../order-export.tsx'
import { nativeShareFile } from '../../native/index.ts'
import { wait, SHEET_GAP_MS } from '../../lib/receipt-sms-flow.ts'
import { StatementPhoto } from './StatementPhoto.tsx'
import { BuyerOrderPaper } from './BuyerOrderPaper.tsx'

type Sales = ReturnType<typeof broadcastSales>
const BLUE = '#D8F1FA'
const INK = '#173B4C'

function TableRow({ no, label, money, qty, band = false }: { no?: string; label: string; money: string; qty: string; band?: boolean }) {
  const { p } = useKit()
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: band ? BLUE : p.surface, borderBottomWidth: 1, borderColor: p.line }}>
    {no !== undefined && <View style={{ width: 36 }}><Txt weight={band ? 'bold' : 'regular'} ink={band ? INK : p.text}>{no}</Txt></View>}
    <View style={{ flex: 1 }}><Txt weight={band ? 'bold' : 'medium'} ink={band ? INK : p.text}>{label}</Txt></View>
    <View style={{ flex: 1 }}><Txt right weight={band ? 'bold' : 'regular'} ink={band ? INK : p.text}>{money}</Txt></View>
    <View style={{ width: 38 }}><Txt center weight={band ? 'bold' : 'regular'} ink={band ? INK : p.text}>{qty}</Txt></View>
  </View>
}

export function BroadcastSalesList({ broadcastId, title, date, sales, names, buyer, select, inset, rehearsal, sealed }: {
  broadcastId: string; title: string; date: string; sales: Sales; names: BuyerNames; buyer: string | null; select: (id: string) => void; inset: number; rehearsal: boolean; sealed: boolean
}) {
  const path = `/api/broadcasts/${encodeURIComponent(broadcastId)}/order-shop`
  const { data: shop, reload } = useCachedGet<{ name: string }>(path)
  const { p } = useKit()
  const [products, setProducts] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [photo, setPhoto] = useState(false)
  const [saving, setSaving] = useState<ExportKind | null>(null)
  const [shareError, setShareError] = useState('')
  const tab = products ? 'products' : 'buyers'
  const rows = useMemo(() => statementRows(sales, tab, id => names.name(id)), [tab, sales, names])
  const exportFile = async (kind: ExportKind) => {
    if (saving) return
    setSaving(kind)
    setShareError('')
    try {
      if (kind === 'photo') {
        setMenu(false)
        await wait(SHEET_GAP_MS)
        setPhoto(true)
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
  if (buyer !== null) {
    if (!order) return <Txt>현재 확정된 주문이 없어요.</Txt>
    if (!shop?.name) return <View style={{ padding: GUTTER, gap: SPACE.md }}><Txt>주문서의 가게 이름을 불러오는 중이에요.</Txt><SmallButton label="다시 불러오기" onPress={() => void reload()} /></View>
    return <BuyerOrderPaper key={order.id} {...{ order, date, shop: shop.name, buyerName: statementName(names.name(buyer)), inset, rehearsal, sealed }} />
  }
  return <View style={{ flex: 1 }}>
    <View style={{ paddingHorizontal: GUTTER }}>
      <View style={{ gap: SPACE.xs, paddingVertical: SPACE.lg }}>
        <Txt step="caption" color="textSub">{date}</Txt>
        <Tap role="button" aria-label="주문서 가게 이름 수정" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }} onPress={() => { setError(''); setDraft(shop?.name ?? '') }}>
          <Txt step="bodyLarge" weight="bold">{shop?.name || title}</Txt><Icon name="edit" size={16} color={p.textSub} />
        </Tap>
        <Txt step="caption" color="textSub">{`판매 수량 ${sales.qty}개 · 구매자 ${sales.buyers}명`}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: SPACE.sm, paddingBottom: SPACE.md }}>
        <Pill label="구매자별" ariaLabel="구매자별" on={!products} onPress={() => setProducts(false)} />
        <Pill label="상품별" ariaLabel="상품별" on={products} onPress={() => setProducts(true)} />
      </View>
    </View>
    <FlatList key={tab} data={rows} keyExtractor={row => row.key} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: SPACE.md }}
      ListHeaderComponent={<TableRow band {...(products ? { no: '번호' } : {})} label={products ? '상품명' : '구매자'} money="판매 금액" qty="개수" />}
      renderItem={({ item }) => {
        const row = <TableRow {...(item.no === null ? {} : { no: String(item.no) })} label={item.label} money={salesMoney(item.money)} qty={String(item.qty)} />
        return products ? row : <Tap role="button" aria-label={`${item.label} 주문서 · ${salesMoney(item.money)} · ${item.qty}개`} onPress={() => select(item.key)}>{row}</Tap>
      }}
      ListEmptyComponent={<Txt color="textSub">판매가 확정된 상품이 없어요.</Txt>}
      ListFooterComponent={<TableRow band {...(products ? { no: '총계' } : {})} label={products ? '' : '총계'} money={salesMoney(sales.total)} qty={String(sales.qty)} />}
    />
    <View style={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: inset + SPACE.sm }}>
      {shareError ? <Txt color="textSub">{shareError}</Txt> : null}
      <BigButton label="내보내기" disabled={saving !== null || !shop?.name} onPress={() => { setShareError(''); setMenu(true) }} />
    </View>
    <BottomSheet visible={menu} title="내보내기" onClose={() => setMenu(false)}>
      <View style={{ marginHorizontal: -SPACE.xl }}><ExportRows busy={saving} save={kind => void exportFile(kind)} /></View>
    </BottomSheet>
    {photo && <StatementPhoto {...{ rows, tab, date, shop: shop?.name ?? title, total: sales.total, qty: sales.qty }} onClose={() => setPhoto(false)} onError={() => setShareError(EXPORT_FAILED)} />}
    <BottomSheet visible={draft !== null} title="주문서 가게 이름" onClose={() => setDraft(null)} actions={<BigButton label="저장" busy={busy} disabled={!draft?.trim()} onPress={() => void save()} />}>
      <TextField label="가게 이름" value={draft ?? ''} onChangeText={setDraft} maxLength={40} error={error || null} />
    </BottomSheet>
  </View>
}
