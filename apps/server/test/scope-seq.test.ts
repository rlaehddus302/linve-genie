// AC-S05-60 범위별 지금 seq를 집계 없이 (RA-S04-008, D-085): 범위 행의 seq 칸을 이벤트 커밋과 같은 트랜잭션에서 고치고,
// SSE ready·범위 목록은 그 값을 읽는다. 기존 범위는 마이그레이션에서 채운다.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { applyEvent } from '@livejjim/core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_FOLDER, openPglite } from '../src/db/database.ts'
import { schema } from '../src/db/schema.ts'
import { INHERITED_BLOCK_REASON } from '../src/service.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, sseReader, startServer, writeEvent, type TestServer } from './support.ts'

const DAY = '2026-10-19'

async function scopeVsLog(world: TestServer): Promise<{ date: string; rehearsal: boolean; seq: number; last: number }[]> {
  const result = await world.database.pglite?.query<{ date: string; rehearsal: boolean; seq: number; last: number }>(
    `select s.date, s.rehearsal, s.seq, coalesce((select max(e.seq) from events e where e.scope_id = s.id), 0)::int as last from scopes s order by s.date, s.rehearsal`,
  )
  return result?.rows ?? []
}

describe('AC-S05-60 범위 행의 지금 seq', () => {
  it('쓰기마다 같은 트랜잭션에서 고친다 — 실패 표시 이벤트·차단 이어받기 이벤트·리허설 범위 포함', async () => {
    let explode = false
    const real = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          if (explode && event.type === 'product.hold') throw new Error('엔진 고장 주입')
          return applyEvent(state, event)
        },
      },
    })
    const seller = await addSeller(real)
    const d18 = await createBroadcast(real, seller, { date: '2026-10-18' })
    await expectOk(writeEvent(real, seller, { type: 'host.blockBuyer', buyer: 'UCx', reason: '장난' }, '2026-10-18'))
    await expectOk(writeEvent(real, seller, { type: 'product.register', b: d18.id, no: 1, name: 'a', price: 1 }))
    explode = true
    expect((await writeEvent(real, seller, { type: 'product.hold', b: d18.id, no: 1 })).status).toBe(500) // 실패 표시로 기록
    explode = false
    await createBroadcast(real, seller, { date: DAY }) // + 이어받는 차단
    const rehearsal = await createBroadcast(real, seller, { date: DAY, rehearsal: true })
    await real.server.ingestChat(seller.sellerId, { b: rehearsal.id, id: 'm1', ch: 'sim_c1', nick: 'n', text: '안녕' })
    expect(await scopeVsLog(real)).toEqual([
      { date: '2026-10-18', rehearsal: false, seq: 4, last: 4 },
      { date: DAY, rehearsal: false, seq: 2, last: 2 },
      { date: DAY, rehearsal: true, seq: 2, last: 2 },
    ])
    const history = (await client(real, seller.cookie).get(`/api/days/${DAY}/history`)).body.events as { reason: string | null }[]
    expect(history.map((event) => event.reason)).toEqual([null, INHERITED_BLOCK_REASON])
  })

  it('저장 실패(롤백)면 범위 행의 seq도 그대로다', async () => {
    let fail = false
    const world = await newWorld({
      hooks: {
        beforeCommit: () => {
          if (fail) throw new Error('저장 실패 주입')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    fail = true
    expect((await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })).status).toBe(500)
    expect(await scopeVsLog(world)).toEqual([{ date: DAY, rehearsal: false, seq: 1, last: 1 }])
    // 범위가 생기는 첫 쓰기가 롤백되면 범위 행도 없다
    expect((await client(world, seller.cookie).post('/api/broadcasts', { requestId: 'x-1', date: '2026-10-20' })).status).toBe(500)
    expect((await scopeVsLog(world)).map((row) => row.date)).toEqual([DAY])
  })

  it('두 인스턴스가 같은 범위에 번갈아 써도 범위 행의 seq는 로그의 마지막 seq와 같다', async () => {
    const world = await newWorld()
    const other = startServer(world.database, world.masterKey, { clock: world.clock })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const writes: Promise<unknown>[] = []
    for (let i = 1; i <= 30; i++) {
      const target = i % 2 === 0 ? world : other
      writes.push(target.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i % 4)}`, nick: 'n', text: '안녕' }))
    }
    await Promise.all(writes)
    expect(await scopeVsLog(world)).toEqual([{ date: DAY, rehearsal: false, seq: 31, last: 31 }])
  })

  it('SSE ready와 범위 목록은 범위 행의 seq를 읽는다 (이벤트 표를 모으지 않는다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller, { date: DAY })
    // 범위 행의 값만 바꿔 두면 목록·ready가 그 값을 보인다 = 이벤트 표에서 다시 세지 않는다
    await world.database.pglite?.exec(`update scopes set seq = 77`)
    expect((await client(world, seller.cookie).get('/api/days')).body).toEqual({ days: [{ date: DAY, rehearsal: false, seq: 77 }] })
    const reader = sseReader(await client(world, seller.cookie).raw('/api/stream', {}))
    try {
      await reader.until(() => reader.events.length >= 1)
      expect(JSON.parse(reader.events[0]?.data ?? '{}')).toEqual({ scopes: [{ date: DAY, rehearsal: false, seq: 77 }] })
    } finally {
      await reader.cancel()
      world.server.close()
    }
    // 서버 소스에 이벤트 표 seq 집계가 없다
    const store = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8')
    expect(store).not.toMatch(/max\(\$\{events\.seq\}\)/)
  })
})

describe('AC-S05-50·60 마이그레이션: 기존 범위는 실제 범위이고 seq를 채운다', () => {
  it('S04 스키마의 데이터에 S05 마이그레이션을 적용하면 rehearsal=false, seq=그 범위의 마지막 이벤트 seq (이벤트 없으면 0)', async () => {
    // S04까지의 마이그레이션(0000·0001)만 든 임시 폴더
    const folder = mkdtempSync(join(tmpdir(), 'lj-mig-'))
    try {
      mkdirSync(join(folder, 'meta'))
      const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
      const s04 = { ...journal, entries: journal.entries.filter((entry) => entry.tag.startsWith('0000') || entry.tag.startsWith('0001')) }
      expect(s04.entries).toHaveLength(2)
      writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(s04))
      for (const entry of s04.entries) copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
      const pg = await PGlite.create()
      await migrate(drizzle({ client: pg, schema }) as never, { migrationsFolder: folder })
      await pg.exec(`
        insert into sellers (id, name, phone_key_enc, created_at) values ('s1', '가게', 'k', now());
        insert into scopes (id, seller_id, date, created_at) values ('sc1', 's1', '2026-10-18', now()), ('sc2', 's1', '2026-10-19', now());
        insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, changed, digest) values
          ('s1', 'sc1', 1, 'x', '{}', 0, now(), 'server', true, 'd'),
          ('s1', 'sc1', 2, 'x', '{}', 0, now(), 'server', true, 'd'),
          ('s1', 'sc1', 3, 'x', '{}', 0, now(), 'server', true, 'd');
        insert into outbox (seller_id, scope_id, effect_id, seq, kind, body, created_at) values ('s1', 'sc1', 'e1', 3, 'NOTIFY', '{}', now());`)
      const migrated = await openPglite(pg)
      const scopes = await pg.query<{ id: string; rehearsal: boolean; seq: number }>('select id, rehearsal, seq from scopes order by id')
      expect(scopes.rows).toEqual([
        { id: 'sc1', rehearsal: false, seq: 3 },
        { id: 'sc2', rehearsal: false, seq: 0 },
      ])
      expect((await pg.query<{ rehearsal: boolean }>('select rehearsal from outbox')).rows).toEqual([{ rehearsal: false }])
      // 같은 날짜의 리허설 범위를 더 만들 수 있다 (유일 키에 리허설이 들어갔다)
      await pg.exec(`insert into scopes (id, seller_id, date, rehearsal, created_at) values ('sc3', 's1', '2026-10-18', true, now())`)
      await migrated.close()
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
