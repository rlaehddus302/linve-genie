import { FlatList, View } from 'react-native'
import type { ScopeData } from '../../lib/scope-data.ts'
import { formatWon } from '../../lib/words.ts'
import { Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'

interface SaleLine {
  key: string
  no: number
  name: string
  variant: string | null
  qty: number
  amount: number | null
}

export function broadcastSales(claims: ScopeData['claims'], products: ScopeData['products'], broadcast: string) {
  const grouped = new Map<string, SaleLine>()
  const buyers = new Set<string>()
  let qty = 0
  let total: number | null = 0
  for (const claim of claims.values()) {
    if (claim.broadcast !== broadcast || claim.status !== 'CONFIRMED') continue
    const product = products.get(claim.product)
    const key = claim.key ?? claim.product
    const line = grouped.get(key) ?? { key, no: claim.no, name: product?.name ?? '', variant: claim.variant, qty: 0, amount: 0 }
    line.qty += claim.qty
    line.amount = line.amount === null || claim.amount == null ? null : line.amount + claim.amount
    grouped.set(key, line)
    qty += claim.qty
    total = total === null || claim.amount == null ? null : total + claim.amount
    buyers.add(claim.currentBuyer)
  }
  const lines = [...grouped.values()].sort((a, b) => a.no - b.no)
  return { lines, qty, buyers: buyers.size, total }
}

export function salesMoney(amount: number | null) {
  return amount === null ? '금액 확인 필요' : formatWon(amount)
}

export function BroadcastSalesList({ title, sales, inset }: { readonly title: string; readonly sales: ReturnType<typeof broadcastSales>; readonly inset: number }) {
  const { p } = useKit()
  return (
    <FlatList data={sales.lines} keyExtractor={line => line.key} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: inset + SPACE.xl }}
      ListHeaderComponent={<View style={{ paddingVertical: SPACE.lg, gap: SPACE.xs }}>
        <Txt step="bodyLarge" weight="bold">{title}</Txt>
        <Txt step="caption" color="textSub">{`판매 수량 ${sales.qty}개 · 구매자 ${sales.buyers}명`}</Txt>
      </View>}
      renderItem={({ item }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, borderTopWidth: 1, borderColor: p.line }}>
        <View style={{ flex: 1, gap: SPACE.xs }}>
          <Txt weight="bold">{[`${item.no}번`, item.name].filter(Boolean).join(' ')}</Txt>
          <Txt step="caption" color="textSub">{[item.variant, `${item.qty}개`].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Txt>{salesMoney(item.amount)}</Txt>
      </View>}
      ListEmptyComponent={<Txt color="textSub">판매가 확정된 상품이 없어요.</Txt>}
      ListFooterComponent={<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACE.md, paddingVertical: SPACE.lg, borderTopWidth: 1, borderColor: p.line }}>
        <Txt step="bodyLarge" weight="bold">총계</Txt><Txt step="bodyLarge" weight="bold">{salesMoney(sales.total)}</Txt>
      </View>}
    />
  )
}
