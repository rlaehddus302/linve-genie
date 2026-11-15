// 종료한 라이브 목록의 합계. 날짜별 엔진 기록을 처음 한 번만 읽고, 이후 변경은 범위 seq로 구별한다.
import { listBroadcasts, listClaims, listProducts } from '@livejjim/core'
import { piecesPerSale, saleSetSize } from '@livejjim/core/format'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { scopes } from './db/schema.ts'
import { requireAmount } from './amount.ts'
import { scopeSealInfo, type BroadcastRow } from './store.ts'
import type { ScopeWriter } from './writer.ts'
import { readLedger } from './youtube/seal.ts'

export async function endedBroadcastSales(db: Db, writer: Pick<ScopeWriter, 'readDetached'>, sellerId: string, rows: readonly BroadcastRow[]) {
  const totals = new Map<string, { salesTotal: number; salesQty: number; buyerCount: number | null }>()
  const ids = [...new Set(rows.filter(row => !row.rehearsal && row.endedAt !== null && row.openedAt !== null).map(row => row.scopeId))]
  if (ids.length === 0) return totals
  const days = await db.select({ id: scopes.id, date: scopes.date, seq: scopes.seq, sealedAt: scopes.sealedAt, cache: scopes.broadcastSales })
    .from(scopes).where(and(eq(scopes.sellerId, sellerId), inArray(scopes.id, ids)))
  for (const day of days) {
    let cache = day.cache
    if (cache?.seq !== day.seq || !cache.counts) {
      const sums = new Map<string, number>()
      const quantities = new Map<string, number>()
      const buyers = new Map<string, Set<string>>()
      const unknownBuyer = new Set<string>()
      const add = (id: string, amount: number, qty: number, buyer: unknown) => {
        sums.set(id, (sums.get(id) ?? 0) + amount)
        quantities.set(id, (quantities.get(id) ?? 0) + qty)
        if (typeof buyer !== 'string' || !buyer) {
          unknownBuyer.add(id)
          return
        }
        const seen = buyers.get(id) ?? new Set<string>()
        seen.add(buyer)
        buyers.set(id, seen)
      }
      let seq = day.seq
      let fromLedger = day.sealedAt !== null
      if (!fromLedger) {
        const runtime = await writer.readDetached(sellerId, day.date)
        const broadcasts = listBroadcasts(runtime.state)
        fromLedger = broadcasts.length === 0
        for (const broadcast of broadcasts) sums.set(broadcast.id, 0)
        const sizes = new Map(listProducts(runtime.state).map(p => [p.key, piecesPerSale(p)]))
        for (const claim of listClaims(runtime.state)) {
          if (claim.status === 'CONFIRMED') add(claim.broadcast, requireAmount(claim), claim.qty * (sizes.get(claim.product) ?? 1), claim.currentBuyer)
        }
        seq = runtime.seq
      }
      if (fromLedger) {
        const info = await scopeSealInfo(db, sellerId, day.date, false)
        const ledger = info?.ledger ? readLedger(info.ledger) : null
        if (ledger === null) continue
        for (const broadcast of ledger.broadcasts) sums.set(broadcast.id, 0)
        const sizes = new Map(ledger.products.map(p => [p.key, typeof p.pieces === 'number' && Number.isSafeInteger(p.pieces) && p.pieces > 1 ? p.pieces : typeof p.name === 'string' ? saleSetSize(p.name) ?? 1 : 1]))
        for (const sale of ledger.sales) {
          if (typeof sale.broadcast !== 'string' || typeof sale.amount !== 'number') continue
          const qty = (typeof sale.qty === 'number' ? sale.qty : 1) * (sizes.get(sale.product) ?? 1)
          add(sale.broadcast, sale.amount, qty, sale.currentBuyer ?? sale.buyer)
        }
      }
      const counts = Object.fromEntries([...sums.keys()].map(id => [id, { qty: quantities.get(id) ?? 0, buyers: unknownBuyer.has(id) ? null : buyers.get(id)?.size ?? 0 }]))
      cache = { seq, totals: Object.fromEntries(sums), counts }
      await db.update(scopes).set({ broadcastSales: cache }).where(and(eq(scopes.id, day.id), eq(scopes.sellerId, sellerId), eq(scopes.seq, seq)))
    }
    for (const [id, salesTotal] of Object.entries(cache.totals)) {
      const count = cache.counts?.[id]
      if (count) totals.set(id, { salesTotal, salesQty: count.qty, buyerCount: count.buyers })
    }
  }
  return totals
}
