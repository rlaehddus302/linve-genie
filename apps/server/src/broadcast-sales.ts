// 종료한 라이브 목록의 합계. 날짜별 엔진 기록을 처음 한 번만 읽고, 이후 변경은 범위 seq로 구별한다.
import { listBroadcasts, listClaims } from '@livejjim/core'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { scopes } from './db/schema.ts'
import { requireAmount } from './amount.ts'
import { scopeSealInfo, type BroadcastRow } from './store.ts'
import type { ScopeWriter } from './writer.ts'
import { readLedger } from './youtube/seal.ts'

export async function endedBroadcastSales(db: Db, writer: Pick<ScopeWriter, 'readDetached'>, sellerId: string, rows: readonly BroadcastRow[]) {
  const totals = new Map<string, number>()
  const ids = [...new Set(rows.filter(row => !row.rehearsal && row.endedAt !== null && row.openedAt !== null).map(row => row.scopeId))]
  if (ids.length === 0) return totals
  const days = await db.select({ id: scopes.id, date: scopes.date, seq: scopes.seq, sealedAt: scopes.sealedAt, cache: scopes.broadcastSales })
    .from(scopes).where(and(eq(scopes.sellerId, sellerId), inArray(scopes.id, ids)))
  for (const day of days) {
    let cache = day.cache
    if (cache?.seq !== day.seq) {
      const sums = new Map<string, number>()
      let seq = day.seq
      let fromLedger = day.sealedAt !== null
      if (!fromLedger) {
        const runtime = await writer.readDetached(sellerId, day.date)
        const broadcasts = listBroadcasts(runtime.state)
        fromLedger = broadcasts.length === 0
        for (const broadcast of broadcasts) sums.set(broadcast.id, 0)
        for (const claim of listClaims(runtime.state)) {
          if (claim.status === 'CONFIRMED') sums.set(claim.broadcast, (sums.get(claim.broadcast) ?? 0) + requireAmount(claim))
        }
        seq = runtime.seq
      }
      if (fromLedger) {
        const info = await scopeSealInfo(db, sellerId, day.date, false)
        const ledger = info?.ledger ? readLedger(info.ledger) : null
        if (ledger === null) continue
        for (const broadcast of ledger.broadcasts) sums.set(broadcast.id, 0)
        for (const sale of ledger.sales) {
          if (typeof sale.broadcast === 'string' && typeof sale.amount === 'number') sums.set(sale.broadcast, (sums.get(sale.broadcast) ?? 0) + sale.amount)
        }
      }
      cache = { seq, totals: Object.fromEntries(sums) }
      await db.update(scopes).set({ broadcastSales: cache }).where(and(eq(scopes.id, day.id), eq(scopes.sellerId, sellerId), eq(scopes.seq, seq)))
    }
    for (const [id, value] of Object.entries(cache.totals)) totals.set(id, value)
  }
  return totals
}
