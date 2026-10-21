// 복구·가져오기 계약 (AC-I2-62, D-I2-11 — RA-I2-001·RA-I2-002). 다른 트랙(I1 출력·Y1/I3 실행기·N2·N3 등)의 표와 실행기를 합칠 때
// 이 계약을 깨면 여기서 실패해 "어디에 둘지"를 정하게 한다:
// - 마이그레이션을 적용한 실제 DB의 표는 모두 복구가 바꾸는 표·그대로 두는 표·판매자 데이터가 아닌 표 중 하나에만 있다(backup.ts 목록).
// - 바꾸는 표(범위·방송 등)를 참조하는 외래 키는 모두 바꾸는 표에서 오고, 지우는 순서에서 참조하는 표가 먼저다(복구가 외래 키에 걸려 멈추지 않게).
// - 발송함 행을 골라 실행하는 질의는 리허설 조건과 함께 복구 조건(restored)도 건다(복구로 다시 만든 지난 라벨·감사 메시지를 실행하지 않게).
// - I2 마이그레이션은 기존 표의 키·제약을 바꾸지 않는다 — broadcasts(id)를 다른 표가 참조할 수 있다.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RESTORE_KEPT_TABLES, RESTORE_REPLACED_TABLES, RESTORE_UNRELATED_TABLES, executableOutboxCount } from '../src/backup.ts'
import { MIGRATIONS_FOLDER, openPglite, type Database } from '../src/db/database.ts'
import { schema } from '../src/db/schema.ts'
import { addSeller, createBroadcast, newWorld } from './support.ts'

let database: Database
let pg: PGlite

beforeAll(async () => {
  database = await openPglite()
  pg = database.pglite as PGlite
})

afterAll(async () => {
  await database.close()
})

const names = (list: readonly PgTable[]): string[] => list.map((table) => getTableConfig(table).name)
const replaced = names(RESTORE_REPLACED_TABLES)
const kept = names(RESTORE_KEPT_TABLES)
const unrelated = names(RESTORE_UNRELATED_TABLES)

describe('복구가 다루는 표 (RA-I2-001)', () => {
  it('마이그레이션을 적용한 DB의 표는 모두 바꾸는 표·그대로 두는 표·판매자 데이터가 아닌 표 중 하나에만 있다 — 판매자 ID 칸이 있는 표는 앞의 둘 중 하나', async () => {
    const tables = (await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).rows.map(
      (row) => row.table_name,
    )
    const classified = [...replaced, ...kept, ...unrelated]
    expect(new Set(classified).size, '한 표가 두 목록에 있다').toBe(classified.length)
    const unclassified = tables.filter((table) => !classified.includes(table))
    expect(unclassified, '복구가 이 표를 어떻게 할지 backup.ts의 RESTORE_REPLACED_TABLES·RESTORE_KEPT_TABLES·RESTORE_UNRELATED_TABLES에 정해 주세요').toEqual([])
    expect([...classified].sort(), '목록에 DB에 없는 표가 있다').toEqual(tables)
    // 스키마 모듈의 표도 같은 셋이다
    expect(names(Object.values(schema) as PgTable[]).sort()).toEqual(tables)
    const withSeller = (await pg.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'seller_id' order by table_name`)).rows.map(
      (row) => row.table_name,
    )
    expect(withSeller.length).toBeGreaterThan(5)
    for (const table of withSeller) expect([...replaced, ...kept], `${table}에 판매자 ID가 있다`).toContain(table)
    // 판매자 행은 그대로 둔다(가게 설정·판매 규칙 설정 칸만 바꾼다) — 판매자 ID·계정·세션이 유지된다
    expect(kept).toEqual(expect.arrayContaining(['sellers', 'accounts', 'sessions']))
  })

  it('바꾸는 표를 참조하는 외래 키는 모두 바꾸는 표에서 오고, 지우는 순서에서 참조하는 표가 먼저 지워진다', async () => {
    const keys = await pg.query<{ child: string; parent: string; name: string }>(
      `select conrelid::regclass::text as child, confrelid::regclass::text as parent, conname as name from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace order by conname`,
    )
    const intoReplaced = keys.rows.filter((key) => replaced.includes(key.parent) && key.child !== key.parent)
    expect(intoReplaced.map((key) => key.name)).toEqual(expect.arrayContaining(['events_scope_id_scopes_id_fk', 'broadcasts_scope_id_scopes_id_fk', 'packing_records_scope_id_scopes_id_fk']))
    for (const key of intoReplaced) {
      expect(replaced, `${key.child}가 ${key.parent}를 참조한다 — 복구가 ${key.parent}를 지울 때 외래 키에 걸린다. RESTORE_REPLACED_TABLES에 두거나 참조를 바꿔 주세요`).toContain(key.child)
      expect(replaced.indexOf(key.child), `${key.child}를 ${key.parent}보다 먼저 지워야 한다`).toBeLessThan(replaced.indexOf(key.parent))
    }
  })
})

/** 발송함 행을 고르는 질의가 리허설 조건(outbox.rehearsal)을 거는데 복구 조건(restored)이나 executableOutbox가 없는 파일인가 */
function missesRestored(text: string): boolean {
  if (!/\boutbox\b/.test(text)) return false
  const filtersRehearsal = /\boutbox\.rehearsal\b/.test(text) || /"outbox"\."rehearsal"/.test(text)
  if (!filtersRehearsal) return false
  return !(/\bexecutableOutbox\b/.test(text) || /\boutbox\.restored\b/.test(text) || /"outbox"\."restored"/.test(text))
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('발송함 실행 대상 (RA-I2-001, D-I2-11)', () => {
  it('판별: 리허설 조건만 건 실행 질의는 걸리고, 복구 조건이나 executableOutbox를 함께 건 질의는 통과한다', () => {
    // 다른 트랙 실행기 모양 (합칠 때 이렇게 들어오면 이 시험이 실패해야 한다)
    expect(missesRestored(`const REAL = and(eq(outbox.rehearsal, false), inArray(outbox.kind, RUNNER_KINDS))`)).toBe(true)
    expect(missesRestored(`db.select().from(outbox).where(and(eq(outbox.sellerId, s), eq(outbox.rehearsal, false), eq(outbox.kind, 'PRINT_PRODUCT_LABEL')))`)).toBe(true)
    expect(missesRestored(`db.select().from(outbox).where(and(eq(outbox.sellerId, s), eq(outbox.rehearsal, false), eq(outbox.restored, false)))`)).toBe(false)
    expect(missesRestored(`db.select().from(outbox).where(and(eq(outbox.sellerId, s), executableOutbox))`)).toBe(false)
    expect(missesRestored(`insertOutbox(tx, rows) // rehearsal: job.rehearsal`)).toBe(false)
  })

  it('apps/server/src의 발송함 질의 중 리허설 조건을 거는 곳은 모두 복구 조건도 건다 (스키마 파일 빼고)', () => {
    const root = fileURLToPath(new URL('../src/', import.meta.url))
    const offenders = sourceFiles(root)
      .filter((file) => !file.endsWith(join('db', 'schema.ts')))
      .filter((file) => missesRestored(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
    expect(offenders, '발송함 실행 질의에 executableOutbox(db/schema.ts) 조건을 걸어 주세요 — 복구로 다시 만든 행(restored)을 실행하면 지난 라벨·감사 메시지가 다시 나간다').toEqual([])
  })

  it('executableOutbox = 실제 범위이고 복구로 다시 만든 행이 아님 (행마다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller, { date: '2026-10-19' })
    const p = world.database.pglite as PGlite
    const scope = (await p.query<{ id: string }>('select id from scopes where seller_id = $1', [seller.sellerId])).rows[0]?.id
    let n = 0
    for (const rehearsal of [false, true]) {
      for (const restored of [false, true]) {
        n++
        await p.query(`insert into outbox (seller_id, scope_id, effect_id, seq, kind, body, rehearsal, restored, created_at) values ($1, $2, $3, 1, 'POST_THANKS', '{}', $4, $5, now())`, [seller.sellerId, scope, `fx${String(n)}`, rehearsal, restored])
      }
    }
    expect(await executableOutboxCount(world.database.db, seller.sellerId)).toBe(1)
  })
})

describe('I2 마이그레이션은 기존 표의 키·제약을 바꾸지 않는다 (RA-I2-002)', () => {
  it('I2 마이그레이션 파일에 DROP·기본 키 바꾸기가 없다 — 더하기만', () => {
    const files = readdirSync(MIGRATIONS_FOLDER).filter((file) => /_i2_/.test(file))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = readFileSync(join(MIGRATIONS_FOLDER, file), 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('--'))
        .join('\n')
      expect(text, file).not.toMatch(/\bDROP\b/i)
      expect(text, file).not.toMatch(/ALTER TABLE "(sellers|accounts|sessions|scopes|broadcasts|events|outbox|snapshots)" (ADD CONSTRAINT|ALTER COLUMN)/i)
    }
  })

  it('다른 표가 broadcasts(id)를 외래 키로 참조할 수 있다 (방송 ID는 서버 전체에서 유일)', async () => {
    await pg.exec(`create table probe_live_links (id text primary key, broadcast_id text not null references broadcasts(id))`)
    await pg.exec(`drop table probe_live_links`)
  })
})
