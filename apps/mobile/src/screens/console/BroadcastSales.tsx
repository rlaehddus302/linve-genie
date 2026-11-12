import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { put, isApiError } from '../../api/client.ts'
import { rememberCached, useCachedGet } from '../../lib/cached-get.ts'
import { type broadcastSales, salesMoney } from '../../lib/broadcast-sales.ts'
import type { BuyerNames } from '../../lib/derive.ts'
import { BigButton, BottomSheet, Icon, SmallButton, Tap, TextField, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Pill } from '../../ui/day-pills.tsx'
import { BuyerOrderPaper } from './BuyerOrderPaper.tsx'

type Sales = ReturnType<typeof broadcastSales>
const BLUE = '#D8F1FA'
const INK = '#173B4C'

function TableRow({ label, money, qty, band = false }: { label: string; money: string; qty: string; band?: boolean }) {
  const { p } = useKit()
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: band ? BLUE : p.surface, borderBottomWidth: 1, borderColor: p.line }}>
    <View style={{ flex: 1 }}><Txt weight={band ? 'bold' : 'medium'} ink={band ? INK : p.text}>{label}</Txt></View>
    <View style={{ flex: 1 }}><Txt right weight={band ? 'bold' : 'regular'} ink={band ? INK : p.text}>{money}</Txt></View>
    <View style={{ minWidth: 40 }}><Txt right weight={band ? 'bold' : 'regular'} ink={band ? INK : p.text}>{qty}</Txt></View>
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
  const rows = useMemo(() => products ? sales.lines.map(line => ({
    key: line.key, label: [`${line.no}번`, line.name, line.variant].filter(Boolean).join(' '), money: line.amount, qty: line.qty,
  })) : sales.orders.map(order => ({ key: order.id, label: names.name(order.id), money: order.subtotal, qty: order.qty }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko') || a.key.localeCompare(b.key)), [products, sales, names])
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
    return <BuyerOrderPaper key={order.id} {...{ order, date, shop: shop.name, buyerName: names.name(buyer), inset, rehearsal, sealed }} />
  }
  return <View style={{ flex: 1 }}>
    <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: inset + SPACE.xl }}
      ListHeaderComponent={<View>
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
        <TableRow band label={products ? '상품' : '구매자'} money="판매 금액" qty="개수" />
      </View>}
      renderItem={({ item }) => {
        const row = <TableRow label={item.label} money={salesMoney(item.money)} qty={String(item.qty)} />
        return products ? row : <Tap role="button" aria-label={`${item.label} 주문서 · ${salesMoney(item.money)} · ${item.qty}개`} onPress={() => select(item.key)}>{row}</Tap>
      }}
      ListEmptyComponent={<Txt color="textSub">판매가 확정된 상품이 없어요.</Txt>}
      ListFooterComponent={<TableRow band label="총계" money={salesMoney(sales.total)} qty={String(sales.qty)} />}
    />
    <BottomSheet visible={draft !== null} title="주문서 가게 이름" onClose={() => setDraft(null)} actions={<BigButton label="저장" busy={busy} disabled={!draft?.trim()} onPress={() => void save()} />}>
      <TextField label="가게 이름" value={draft ?? ''} onChangeText={setDraft} maxLength={40} error={error || null} />
    </BottomSheet>
  </View>
}
