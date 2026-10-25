// FB1 적대 시험 (test-domain): 마이그레이션 0019 — 옛 택배 크기 낱말 옮기기 (AC-FB1-16·89, D-FB1-05).
// BASE 모양(0018까지)의 DB에 여러 판매자의 설정·접수 기록(옛 낱말 넷과 새 코드가 무작위로 섞임)을 넣고 0019를 적용하면
// 하나씩 정확히 옮겨지고(극소→60·소→80·중→100·대→120, 새 코드는 그대로), DB에 옛 낱말이 0개, 행 수는 그대로(지우는 것 없음),
// 옮긴 뒤 서버 조회(storedBox)도 같은 값을 읽는다.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_FOLDER, openPglite } from '../../../apps/server/src/db/database.ts'
import { storedBox } from '../../../apps/server/src/parcel/rules.ts'

/**
 * BASE 모양(0018까지)의 빈 DB: 마이그레이션 기록(journal)에서 이름(`0018_…`)으로 0018을 찾아 거기까지만 SQL을 차례로 적용하고
 * drizzle 적용 기록도 같은 모양(해시·시각)으로 남긴다. 그 뒤 openPglite가 0019부터 끝까지를 적용한다.
 * (처음엔 "새 DB에서 마지막 기록 하나만 지우면 0018 모양"이라고 가정해 마이그레이션이 늘 때마다 깨졌다 — 전제 고침, 공격 뜻은 그대로)
 */
async function baseDatabaseAt0018() {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] }
  const cut = journal.entries.findIndex((entry) => entry.tag.startsWith('0018_'))
  if (cut < 0 || !journal.entries.some((entry) => entry.tag.startsWith('0019_fb1_parcel_box_carrier'))) throw new Error('0018·0019 마이그레이션을 찾지 못했다')
  const database = await openPglite(undefined, { migrate: false })
  const pg = database.pglite
  if (pg === null || pg === undefined) throw new Error('PGlite가 아니다')
  await pg.exec('create schema if not exists drizzle; create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)')
  for (const entry of journal.entries.slice(0, cut + 1)) {
    const sql = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim() !== '') await pg.exec(statement)
    await pg.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [createHash('sha256').update(sql).digest('hex'), entry.when])
  }
  return { database, pg }
}

const MOVE: Readonly<Record<string, string>> = { 극소: '60', 소: '80', 중: '100', 대: '120', '60': '60', '80': '80', '100': '100', '120': '120', '160': '160' }

describe('TD-FB1 0019 옛 낱말 옮기기 (AC-FB1-16)', () => {
  it('무작위 판매자 40명·접수 기록 200개: 하나씩 정확히 옮기고 옛 낱말 0개, 행 수 그대로, 서버가 읽는 값도 같다', async () => {
    // BASE(0018까지) 모양의 DB: 기본값 '소', carrier_name 없음 — 그 위에 옛 행을 넣고 0019(와 그 뒤 마이그레이션)를 적용
    const { database, pg } = await baseDatabaseAt0018()
    const base = await pg.query<{ column_default: string | null }>(`select column_default from information_schema.columns where table_name = 'parcel_settings' and column_name = 'box'`)
    expect(base.rows[0]?.column_default).toContain('소')
    const noCarrierName = await pg.query(`select 1 from information_schema.columns where table_name = 'parcel_settings' and column_name = 'carrier_name'`)
    expect(noCarrierName.rows).toHaveLength(0)
    {
      const words = Object.keys(MOVE)
      const sellerBoxes = fc.sample(fc.constantFrom(...words), { numRuns: 40, seed: 3 })
      const parcelBoxes = fc.sample(fc.tuple(fc.integer({ min: 0, max: 39 }), fc.constantFrom(...words)), { numRuns: 200, seed: 4 })
      for (const [i, word] of sellerBoxes.entries()) {
        await pg.query(`insert into sellers (id, name, phone_key_enc, created_at) values ($1, '가게', 'k', now())`, [`s${String(i)}`])
        // 절반은 BASE 기본값(옛 '소')으로 만든 행
        if (i % 2 === 0) await pg.query('insert into parcel_settings (seller_id, carrier, box, updated_at) values ($1, $2, $3, now())', [`s${String(i)}`, 'EPOST', word])
        else await pg.query('insert into parcel_settings (seller_id, updated_at) values ($1, now())', [`s${String(i)}`])
      }
      for (const [j, [seller, word]] of parcelBoxes.entries()) {
        await pg.query(`insert into parcels (id, seller_id, date, buyer, carrier, request_key, state, box, qty, created_at, updated_at) values ($1, $2, '2026-10-19', $3, 'FAKE', $4, 'BOOKED', $5, 1, now(), now())`, [
          `pc${String(j)}`,
          `s${String(seller)}`,
          `UC_${String(j)}`,
          `lj-${String(j)}`,
          word,
        ])
      }
      const migrated = await openPglite(pg as never)
      const settings = await pg.query<{ seller_id: string; box: string; carrier_name: string | null }>('select seller_id, box, carrier_name from parcel_settings')
      expect(settings.rows).toHaveLength(40)
      for (const row of settings.rows) {
        const i = Number(row.seller_id.slice(1))
        const want = i % 2 === 0 ? (MOVE[sellerBoxes[i] as string] as string) : '80'
        expect(row.box, row.seller_id).toBe(want)
        expect(storedBox(row.box)).toBe(want)
        expect(row.carrier_name).toBeNull()
      }
      const parcels = await pg.query<{ id: string; box: string }>('select id, box from parcels')
      expect(parcels.rows).toHaveLength(200)
      for (const row of parcels.rows) {
        const want = MOVE[parcelBoxes[Number(row.id.slice(2))]?.[1] as string] as string
        expect(row.box, row.id).toBe(want)
        expect(storedBox(row.box)).toBe(want)
      }
      const left = await pg.query<{ n: number }>(`select (select count(*) from parcel_settings where box in ('극소','소','중','대')) + (select count(*) from parcels where box in ('극소','소','중','대')) as n`)
      expect(Number(left.rows[0]?.n)).toBe(0)
      await migrated.close()
      await database.close().catch(() => {})
    }
  })
})
