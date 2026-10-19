// AC-S04-20 데이터베이스와 시험 환경: Drizzle 스키마와 저장소의 마이그레이션이 같고, PGlite에 적용되며, 판매자 ID·유일 제약이 DB에 있다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_FOLDER, openPglite, type Database } from '../src/db/database.ts'
import { schema } from '../src/db/schema.ts'

let database: Database
let pg: PGlite

beforeAll(async () => {
  database = await openPglite()
  pg = database.pglite as PGlite
})

afterAll(async () => {
  await database.close()
})

const tables = Object.values(schema) as PgTable[]
const sqlType = (type: string) => (type === 'bigserial' ? 'bigint' : type)

describe('마이그레이션 = Drizzle 스키마 (AC-S04-20)', () => {
  it('마이그레이션 파일이 저장소에 있고 저널과 맞는다', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    const files = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('.sql')).sort()
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(files)
    expect(files.length).toBeGreaterThan(0)
  })

  it('테이블·컬럼(타입·NOT NULL)이 스키마 정의와 같다', async () => {
    const actual = await pg.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
    )
    const expected = tables.flatMap((table) => {
      const config = getTableConfig(table)
      return config.columns.map((column) => ({
        table_name: config.name,
        column_name: column.name,
        data_type: sqlType(column.getSQLType()),
        is_nullable: column.notNull ? 'NO' : 'YES',
      }))
    })
    const key = (row: { table_name: string; column_name: string }) => `${row.table_name}.${row.column_name}`
    expect([...actual.rows].sort((a, b) => key(a).localeCompare(key(b)))).toEqual([...expected].sort((a, b) => key(a).localeCompare(key(b))))
  })

  it('유일 제약·인덱스·외래 키 이름이 스키마 정의와 같다', async () => {
    const constraints = await pg.query<{ conname: string; contype: string }>(
      `select conname, contype from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and contype in ('u', 'f')`,
    )
    const indexes = await pg.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public' and indexname not like '%_pkey'`)
    const expectedUnique = tables.flatMap((table) => getTableConfig(table).uniqueConstraints.map((u) => u.getName()))
    const expectedFk = tables.flatMap((table) => getTableConfig(table).foreignKeys.map((fk) => fk.getName()))
    const expectedIndexes = tables.flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name))
    expect(constraints.rows.filter((row) => row.contype === 'u').map((row) => row.conname).sort()).toEqual([...expectedUnique].sort())
    expect(constraints.rows.filter((row) => row.contype === 'f').map((row) => row.conname).sort()).toEqual([...expectedFk].sort())
    // 유일 제약도 인덱스로 보인다
    expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([...expectedIndexes, ...expectedUnique].sort())
  })

  it('같은 DB에 다시 열어도(마이그레이션 두 번) 그대로다', async () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }
    const again = await openPglite(pg)
    const count = await pg.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations`)
    // 마이그레이션 파일마다 한 번씩만 적용된다 (두 번 열어도 늘지 않는다)
    expect(count.rows[0]?.n).toBe(journal.entries.length)
    expect(again.db).toBeDefined()
  })
})

describe('판매자 ID와 유일 제약 (SYS-02, AC-S04-20·25)', () => {
  it('판매자 데이터가 들어가는 모든 테이블에 판매자 ID가 있다 (판매자 테이블은 id가 판매자 ID)', () => {
    for (const table of tables) {
      const config = getTableConfig(table)
      const names = config.columns.map((column) => column.name)
      if (config.name === 'sellers') expect(names).toContain('id')
      else if (config.name === 'login_limits') continue // 아래 시험: 판매자 데이터가 아니다
      else expect(names, config.name).toContain('seller_id')
    }
  })

  it('판매자 ID가 없는 테이블은 로그인 시도 수 하나뿐이고, 아이디 키·실패 수·잠금 시각·마지막 시도 시각만 둔다 (SA-S04-002)', () => {
    // 로그인 전이라 판매자를 모르고 없는 아이디도 센다 — 있는 아이디와 같은 표에 두어야 잠금으로 아이디가 있는지 갈리지 않는다
    const withoutSeller = tables.map((table) => getTableConfig(table)).filter((config) => config.name !== 'sellers' && !config.columns.some((column) => column.name === 'seller_id'))
    expect(withoutSeller.map((config) => config.name)).toEqual(['login_limits'])
    expect(withoutSeller[0]?.columns.map((column) => column.name)).toEqual(['key', 'failures', 'locked_until', 'updated_at'])
    expect(withoutSeller[0]?.foreignKeys).toEqual([])
  })

  it('요청 번호·채팅 ID·문자찜 ref·(범위, seq)·발송함 효과 ID에 DB 유일 제약이 있다', async () => {
    const rows = await pg.query<{ conname: string; columns: string }>(`
      select c.conname, string_agg(a.attname, ',' order by k.ord) as columns
      from pg_constraint c
      join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'u'
      group by c.conname`)
    const byName = new Map(rows.rows.map((row) => [row.conname, row.columns]))
    expect(byName.get('events_scope_seq_uq')).toBe('scope_id,seq')
    expect(byName.get('events_request_uq')).toBe('seller_id,request_id')
    expect(byName.get('events_chat_uq')).toBe('seller_id,chat_broadcast,chat_message_id')
    expect(byName.get('events_sms_ref_uq')).toBe('seller_id,sms_ref')
    expect(byName.get('outbox_effect_uq')).toBe('seller_id,scope_id,effect_id')
    expect(byName.get('scopes_seller_date_uq')).toBe('seller_id,date')
  })

  it('앱 검사를 거치지 않은 중복 행도 DB가 막는다', async () => {
    await pg.exec(`
      insert into sellers (id, name, phone_key_enc, created_at) values ('s1', 'x', 'k', now());
      insert into scopes (id, seller_id, date, created_at) values ('sc1', 's1', '2026-10-19', now());
      insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, request_id, changed, digest)
        values ('s1', 'sc1', 1, 'x', '{}', 0, now(), 'server', 'r1', true, 'd');`)
    const duplicate = (sql: string) => pg.exec(sql).then(
      () => 'ok',
      (error: { code?: string }) => error.code,
    )
    expect(await duplicate(`insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, changed, digest) values ('s1', 'sc1', 1, 'x', '{}', 0, now(), 'server', true, 'd')`)).toBe('23505')
    expect(await duplicate(`insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, request_id, changed, digest) values ('s1', 'sc1', 2, 'x', '{}', 0, now(), 'server', 'r1', true, 'd')`)).toBe('23505')
    // 요청 번호가 없는(null) 행은 여러 개여도 된다
    expect(await duplicate(`insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, changed, digest) values ('s1', 'sc1', 3, 'x', '{}', 0, now(), 'server', true, 'd')`)).toBe('ok')
    expect(await duplicate(`insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, changed, digest) values ('s1', 'sc1', 4, 'x', '{}', 0, now(), 'server', true, 'd')`)).toBe('ok')
  })
})
