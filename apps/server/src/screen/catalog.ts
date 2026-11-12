// 공동 운영이 확인된 판매자의 같은 라이브 사이에서 상품 편집만 전달한다.
// 원본 쓰기와 같은 트랜잭션에 넣고, 각 수신 방송은 편집 순서대로 처리한다.
import { randomBytes } from 'node:crypto'
import { getProduct } from '@livejjim/core'
import { sql, type SQL } from 'drizzle-orm'
import { scopeLockKey } from '../db/schema.ts'
import type { Db } from '../db/database.ts'
import type { ScopeWriter, TxHookContext, Draft } from '../writer.ts'

type Edit = {
  type: 'product.update' | 'product.register' | 'product.close' | 'product.renumber'
  no: number
  name: string
  price: number
  from?: number
  setName: boolean
  setPrice: boolean
}
type Delivery = { id: string; seller_id: string; broadcast_id: string; scope_date: string; body: Edit }

async function rows<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query)
  return Array.isArray(result) ? (result as T[]) : (result as { rows: T[] }).rows
}

export async function enqueueCatalogEdits(tx: Db, ctx: TxHookContext) {
  if (ctx.rehearsal) return false
  let queued = false
  for (const [index, record] of ctx.records.entries()) {
    const e = record.event
    if (
      !record.changed ||
      !['product.update', 'product.register', 'product.close', 'product.renumber'].includes(e.type) ||
      !('b' in e)
    )
      continue
    if (
      e.type !== 'product.update' &&
      e.type !== 'product.register' &&
      e.type !== 'product.close' &&
      e.type !== 'product.renumber'
    )
      continue
    if (e.type === 'product.update' && e.name === undefined && e.price === undefined) continue
    const no = e.type === 'product.renumber' ? e.to : e.no
    const product = getProduct(ctx.states[index]!, e.b, no)
    if (!product) continue
    const member = await rows<{ team: string; video_id: string }>(
      tx,
      sql`
      SELECT m.team,m.video_id FROM live_catalog_members m JOIN youtube_links l ON l.seller_id=m.seller_id AND l.broadcast_id=m.broadcast_id AND l.video_id=m.video_id
      WHERE m.seller_id=${ctx.sellerId} AND m.broadcast_id=${e.b} AND l.unlinked_at IS NULL
        AND EXISTS (SELECT 1 FROM events WHERE scope_id=${ctx.scopeId} AND seq=${record.seq} AND actor='account') LIMIT 1`,
    )
    const team = member[0]
    if (!team) continue
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${team.team}), hashtext(${team.video_id}))`)
    const edit: Edit = {
      type: e.type,
      no,
      name: product.name,
      price: product.price,
      ...(e.type === 'product.renumber' ? { from: e.from } : {}),
      setName: e.type !== 'product.update' || e.name !== undefined,
      setPrice: e.type !== 'product.update' || e.price !== undefined,
    }
    await tx.execute(sql`INSERT INTO live_catalog_delivery (seller_id,broadcast_id,scope_date,body)
      SELECT DISTINCT m.seller_id,m.broadcast_id,b.date,${JSON.stringify(edit)}::jsonb FROM live_catalog_members m
      JOIN broadcasts b ON b.id=m.broadcast_id AND b.seller_id=m.seller_id
      JOIN youtube_links l ON l.seller_id=m.seller_id AND l.broadcast_id=m.broadcast_id AND l.video_id=m.video_id
      WHERE m.team=${team.team} AND m.video_id=${team.video_id} AND l.unlinked_at IS NULL AND b.ended_at IS NULL`)
    queued = true
  }
  return queued
}

/** 합류 전 각 계정에서 저장된 상품 이벤트를 순서대로 합친 최종값만 전달한다. */
async function mergeExisting(tx: Db, participants: { seller_id: string; broadcast_id: string; date: string }[]) {
  const ids = participants.map((p) => p.broadcast_id)
  const history = await rows<{
    kind: string
    no: number | null
    name: string | null
    price: number | null
    old: number | null
    next: number | null
  }>(
    tx,
    sql`
    SELECT type AS kind,(body::jsonb->>'no')::int AS no,body::jsonb->>'name' AS name,(body::jsonb->>'price')::bigint AS price,
      (body::jsonb->>'from')::int AS old,(body::jsonb->>'to')::int AS next FROM events
    WHERE changed AND NOT failed AND type IN ('product.register','product.open','product.update','product.renumber','product.close')
    AND body::jsonb->>'b' IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )}) ORDER BY id`,
  )
  const latest = new Map<number, Edit>()
  for (const e of history) {
    if (e.kind === 'product.renumber' && e.old !== null && e.next !== null) {
      const old = latest.get(e.old)
      if (old) {
        latest.set(e.next, { ...old, no: e.next })
        latest.set(e.old, { ...old, type: 'product.close' })
      }
      continue
    }
    if (e.no === null) continue
    const last = latest.get(e.no)
    if (e.kind === 'product.register') {
      if (!last)
        latest.set(e.no, {
          type: 'product.register',
          no: e.no,
          name: e.name ?? '',
          price: Number(e.price),
          setName: true,
          setPrice: true,
        })
    } else if (last) {
      if (e.kind === 'product.open') last.type = 'product.register'
      if (e.kind === 'product.close') last.type = 'product.close'
      if (e.name !== null) last.name = e.name
      if (e.price !== null) last.price = Number(e.price)
    }
  }
  for (const member of participants) {
    if (latest.size)
      await tx.execute(sql`INSERT INTO live_catalog_delivery(seller_id,broadcast_id,scope_date,body)
      SELECT ${member.seller_id},${member.broadcast_id},${member.date},value FROM jsonb_array_elements(${JSON.stringify([...latest.values()])}::jsonb)`)
  }
}

export class CatalogDelivery {
  #running = false
  #stopped = false
  #timer?: ReturnType<typeof setInterval>
  readonly db: Db
  readonly writer: ScopeWriter
  constructor(db: Db, writer: ScopeWriter) {
    this.db = db
    this.writer = writer
  }
  async team(seller: string, b: string, invite: string | null) {
    const links = await rows<{ video_id: string; date: string }>(
      this.db,
      sql`SELECT l.video_id,b.date FROM youtube_links l JOIN broadcasts b ON b.seller_id=l.seller_id AND b.id=l.broadcast_id
      WHERE l.seller_id=${seller} AND l.broadcast_id=${b} AND b.ended_at IS NULL AND l.unlinked_at IS NULL LIMIT 1`,
    )
    const link = links[0]
    if (!link) return null
    const existing = await rows<{ team: string }>(
      this.db,
      sql`SELECT team FROM live_catalog_members WHERE seller_id=${seller} AND broadcast_id=${b} AND video_id=${link.video_id}`,
    )
    if (existing[0]) return invite === null || invite === existing[0].team ? existing[0].team : null
    const code = invite ?? randomBytes(12).toString('base64url')
    const owners =
      invite === null
        ? []
        : await rows<{ seller_id: string; broadcast_id: string; date: string }>(
            this.db,
            sql`
      SELECT m.seller_id,m.broadcast_id,b.date FROM live_catalog_members m JOIN broadcasts b ON b.id=m.broadcast_id AND b.seller_id=m.seller_id
      JOIN youtube_links l ON l.broadcast_id=m.broadcast_id AND l.seller_id=m.seller_id AND l.video_id=m.video_id
      WHERE m.team=${code} AND m.video_id=${link.video_id} AND b.ended_at IS NULL AND l.unlinked_at IS NULL ORDER BY m.broadcast_id`,
          )
    const host = owners[0]
    if (invite !== null && !host) return null
    const joined = await this.db.transaction(async (tx) => {
      const member = { seller_id: seller, broadcast_id: b, date: link.date }
      const participants = [...owners, member].sort((a, b) => a.seller_id.localeCompare(b.seller_id))
      for (const p of participants)
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${scopeLockKey(p.seller_id, p.date, false)})`)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${code}),hashtext(${link.video_id}))`)
      const linked = await rows<{ team: string }>(
        tx,
        sql`INSERT INTO live_catalog_members (seller_id,broadcast_id,video_id,team)
        SELECT ${seller},${b},${link.video_id},${code} WHERE EXISTS (SELECT 1 FROM youtube_links WHERE seller_id=${seller} AND broadcast_id=${b} AND video_id=${link.video_id} AND unlinked_at IS NULL)
        ON CONFLICT DO NOTHING RETURNING team`,
      )
      if (!linked[0]) return null
      if (host) await mergeExisting(tx, participants)
      return code
    })
    if (joined && host) void this.drain()
    return joined
  }
  start() {
    this.#timer ??= setInterval(() => {
      void this.drain()
    }, 2500)
    this.#timer.unref()
    void this.drain()
  }
  close() {
    this.#stopped = true
    clearInterval(this.#timer)
  }

  async drain() {
    if (this.#running || this.#stopped) return
    this.#running = true
    try {
      for (let i = 0; i < 64 && !this.#stopped; i++) {
        const got = await rows<Delivery>(
          this.db,
          sql`UPDATE live_catalog_delivery q SET lease_until=now()+interval '30 seconds' WHERE id=(
          SELECT d.id FROM live_catalog_delivery d WHERE NOT d.done AND (d.lease_until IS NULL OR d.lease_until < now())
            AND NOT EXISTS (SELECT 1 FROM live_catalog_delivery older WHERE older.seller_id=d.seller_id AND older.broadcast_id=d.broadcast_id AND NOT older.done AND older.id<d.id)
          ORDER BY d.id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING q.id,q.seller_id,q.broadcast_id,q.scope_date,q.body`,
        )
        const item = got[0]
        if (!item) break
        const edit = item.body
        const b = item.broadcast_id
        const requestId = 'catalog-' + String(item.id)
        let problem: string | null = null
        const result = await this.writer.write({
          sellerId: item.seller_id,
          date: item.scope_date,
          rehearsal: false,
          createScope: false,
          requestId,
          build: ({ state }) => {
            const target = getProduct(state, b, edit.no)
            const drafts: Draft[] = []
            const add = (fields: Record<string, unknown>) =>
              drafts.push({ fields: { ...fields, b }, actor: { kind: 'server' }, ...(drafts.length ? {} : { requestId }) })
            if (edit.type === 'product.close') {
              if (target && target.status !== 'CLOSED') add({ type: edit.type, no: edit.no })
            } else if (
              edit.type === 'product.renumber' &&
              edit.from !== undefined &&
              getProduct(state, b, edit.from)?.status !== 'CLOSED' &&
              getProduct(state, b, edit.from)
            ) {
              if (target && target.status !== 'CLOSED') problem = 'NUMBER_TAKEN'
              else add({ type: edit.type, from: edit.from, to: edit.no, reuseClosed: true })
            } else if (!target) {
              add({ type: 'product.register', no: edit.no, name: edit.name, price: edit.price })
            } else {
              const name = edit.setName && target.name !== edit.name
              const price = edit.setPrice && target.price !== edit.price
              if (name || price)
                add({
                  type: 'product.update',
                  no: edit.no,
                  ...(name ? { name: edit.name } : {}),
                  ...(price ? { price: edit.price, applyTo: 'NEW_ONLY' } : {}),
                })
              if (edit.type === 'product.register' && target.status === 'CLOSED') add({ type: 'product.open', no: edit.no })
            }
            return drafts
          },
        })
        if (result.kind === 'save_failed') break
        if (result.kind === 'rejected' || result.kind === 'not_found' || (result.kind === 'ok' && !result.result.changed))
          problem = result.kind
        await this.db.execute(
          sql`UPDATE live_catalog_delivery SET done=true, problem=${problem}, lease_until=NULL WHERE id=${item.id}`,
        )
      }
    } catch {
      // 만료된 작업은 다음 주기에 같은 요청 번호로 이어간다.
    } finally {
      this.#running = false
    }
  }
}
