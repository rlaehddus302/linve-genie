// FB1 택배 설정 (AC-FB1-15·16, D-FB1-04·D-FB1-05): 쓰는 택배사 고르기(직접 입력 이름 포함)·자동 접수는 어댑터가 있을 때만,
// 택배 크기 = 세 변의 합 코드(60·80·100·120·160)와 옛 낱말 옮기기(요청 본문·저장된 값·마이그레이션 0019).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_FOLDER, openPglite } from '../src/db/database.ts'
import { schema } from '../src/db/schema.ts'
import { CARRIER_LABELS } from '../src/parcel/carrier.ts'
import { DEFAULT_BOX, readBox } from '../src/parcel/rules.ts'
import { D, SENDER, attempts, bookOk, dayRows, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, sell, type ParcelWorld } from './t1-support.ts'
import type { Seller } from './support.ts'

/** 0019 마이그레이션의 저널 시각 (drizzle 적용 기록 created_at) */
const MIGRATION_0019_WHEN = (JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] }).entries.find((entry) => entry.tag.startsWith('0019_'))?.when ?? 0
const NO_AUTO_BOOK = '고른 택배사는 아직 자동 접수를 할 수 없어요. 포장 화면에서 송장번호를 직접 적어 주세요.'

async function settingsRow(world: ParcelWorld, seller: Seller): Promise<{ carrier: string | null; carrier_name: string | null; box: string } | undefined> {
  const rows = await world.database.pglite?.query<{ carrier: string | null; carrier_name: string | null; box: string }>('select carrier, carrier_name, box from parcel_settings where seller_id = $1', [seller.sellerId])
  return rows?.rows[0]
}

const bookRequests = (world: ParcelWorld) => world.carrier.requests.filter((item) => item.op === 'book')

describe('AC-FB1-15 쓰는 택배사 저장 (D-FB1-04)', () => {
  it('EPOST·CJ·HANJIN·LOGEN·LOTTE는 모두 고를 수 있고 조회의 이름은 화면 낱말이다 (준비 중 거절 없음)', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    const api = parcelApi(world, seller.cookie)
    const names = { EPOST: '우체국택배', CJ: 'CJ대한통운', HANJIN: '한진택배', LOGEN: '로젠택배', LOTTE: '롯데택배' } as const
    for (const [code, name] of Object.entries(names)) {
      const saved = await expect200(api.putSettings({ carrier: code }))
      expect(saved.body.settings).toMatchObject({ carrier: code, carrierName: name })
      expect((await expect200(api.settings())).body.settings).toMatchObject({ carrier: code, carrierName: name })
      expect(await settingsRow(world, seller)).toMatchObject({ carrier: code, carrier_name: null })
    }
    // 운송장 이름 표(문서 패키지)와 같은 낱말
    expect(CARRIER_LABELS).toEqual({ FAKE: '가짜 택배(시험용)', ...names })
  })

  it('직접 입력: 이름을 다듬어 저장(코드 포인트 20자까지), 비거나 넘으면 칸 carrierName에 문장 — 저장 없음', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'CJ', sender: SENDER, box: '100' })
    const api = parcelApi(world, seller.cookie)
    const before = await settingsRow(world, seller)
    for (const [carrierName, message] of [
      [undefined, '택배사 이름을 적어 주세요.'],
      ['', '택배사 이름을 적어 주세요.'],
      ['   　\t ', '택배사 이름을 적어 주세요.'],
      [42, '택배사 이름을 적어 주세요.'],
      ['가'.repeat(21), '택배사 이름은 20자까지 적어 주세요.'],
      ['🚚'.repeat(21), '택배사 이름은 20자까지 적어 주세요.'],
    ] as const) {
      const body: Record<string, unknown> = { carrier: 'OTHER', box: '160' }
      if (carrierName !== undefined) body.carrierName = carrierName
      const refused = await api.putSettings(body)
      expect(refused.status, JSON.stringify(carrierName)).toBe(400)
      expect(refused.body.error).toMatchObject({ code: 'INVALID_INPUT', problems: [{ field: 'carrierName', message }] })
      expect(await settingsRow(world, seller)).toEqual(before)
    }
    const saved = await expect200(api.putSettings({ carrier: 'OTHER', carrierName: '  경동   택배 ' }))
    expect(saved.body.settings).toMatchObject({ carrier: 'OTHER', carrierName: '경동 택배' })
    expect(await settingsRow(world, seller)).toMatchObject({ carrier: 'OTHER', carrier_name: '경동 택배' })
    // 20자(코드 포인트 — UTF-16으로는 40)는 된다
    const emoji = '🚚'.repeat(20)
    expect((await expect200(api.putSettings({ carrier: 'OTHER', carrierName: emoji }))).body.settings).toMatchObject({ carrierName: emoji })
    // OTHER 그대로면 이름만 보내도 바뀌고, 다른 칸만 보내면 이름은 그대로
    expect((await expect200(api.putSettings({ carrierName: '대신택배' }))).body.settings).toMatchObject({ carrier: 'OTHER', carrierName: '대신택배' })
    expect((await expect200(api.putSettings({ box: '60' }))).body.settings).toMatchObject({ carrier: 'OTHER', carrierName: '대신택배', box: '60' })
    expect((await api.putSettings({ carrierName: ' ' })).status).toBe(400)
    // 직접 입력 이름은 로그에 남지 않는다
    expect(JSON.stringify(world.logs)).not.toContain('경동')
    expect(JSON.stringify(world.logs)).not.toContain('대신택배')
  })

  it('(회차 2, D-FB1-16 · PC-1) 직접 입력 이름은 L-2 글 다듬기 — 서식 글자만이면 400, 글자 수는 다듬은 뒤 셈', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'CJ', sender: SENDER, box: '100' })
    const api = parcelApi(world, seller.cookie)
    const before = await settingsRow(world, seller)
    for (const carrierName of ['\u200B', '\u200D', '\u00AD', '\u202E', '\uFEFF', '\u200B\u200D\u00AD\u202E\uFEFF', ' \u200B \uFEFF\u3000\t', '\u2028\u2029\n']) {
      const refused = await api.putSettings({ carrier: 'OTHER', carrierName })
      expect(refused.status, JSON.stringify(carrierName)).toBe(400)
      expect(refused.body.error).toMatchObject({ code: 'INVALID_INPUT', problems: [{ field: 'carrierName', message: '택배사 이름을 적어 주세요.' }] })
      expect(await settingsRow(world, seller)).toEqual(before)
    }
    const nfdName = '경동'.normalize('NFD')
    expect(nfdName).not.toBe('경동')
    for (const [input, stored] of [
      ['경동\u200B택배', '경동택배'],
      ['\u202E경동', '경동'],
      ['경동\n택배', '경동 택배'],
      [nfdName, '경동'],
    ] as const) {
      const saved = await expect200(api.putSettings({ carrier: 'OTHER', carrierName: input }))
      expect(saved.body.settings, JSON.stringify(input)).toMatchObject({ carrier: 'OTHER', carrierName: stored })
      expect((await expect200(api.settings())).body.settings).toMatchObject({ carrierName: stored })
      expect(await settingsRow(world, seller)).toMatchObject({ carrier: 'OTHER', carrier_name: stored })
    }
    // 20자 + 서식 글자 3개 → 다듬은 뒤 20자라 저장, 21자 + 서식 글자 → 거절
    const twenty = '가'.repeat(20)
    const padded = `\u200B${'가'.repeat(10)}\u00AD${'가'.repeat(10)}\uFEFF`
    expect((await expect200(api.putSettings({ carrier: 'OTHER', carrierName: padded }))).body.settings).toMatchObject({ carrierName: twenty })
    const tooLong = await api.putSettings({ carrier: 'OTHER', carrierName: `\u200B${'가'.repeat(21)}` })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.error).toMatchObject({ problems: [{ field: 'carrierName', message: '택배사 이름은 20자까지 적어 주세요.' }] })
    expect(await settingsRow(world, seller)).toMatchObject({ carrier_name: twenty })
  })

  it('OTHER가 아닌 코드와 함께 온 carrierName은 저장하지 않고, 다른 택배사로 바꾸면 직접 입력 이름은 지운다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    const api = parcelApi(world, seller.cookie)
    const saved = await expect200(api.putSettings({ carrier: 'HANJIN', carrierName: '엉뚱한 이름' }))
    expect(saved.body.settings).toMatchObject({ carrier: 'HANJIN', carrierName: '한진택배' })
    expect(saved.text).not.toContain('엉뚱한 이름')
    expect(await settingsRow(world, seller)).toMatchObject({ carrier: 'HANJIN', carrier_name: null })
    await expect200(api.putSettings({ carrier: 'OTHER', carrierName: '경동택배' }))
    await expect200(api.putSettings({ carrier: 'LOTTE' }))
    expect(await settingsRow(world, seller)).toMatchObject({ carrier: 'LOTTE', carrier_name: null })
    expect((await expect200(api.settings())).text).not.toContain('경동택배')
    // 고르지 않음으로 돌리기
    expect((await expect200(api.putSettings({ carrier: null }))).body.settings).toMatchObject({ carrier: null, carrierName: null })
  })

  it('FAKE는 시험 모드에서만, 그 밖의 값은 "택배사를 골라 주세요."', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    const api = parcelApi(world, seller.cookie)
    for (const value of ['cj', 'OTHER ', ' EPOST', 'KDEXP', '', 0, true, ['CJ'], { code: 'CJ' }]) {
      const refused = await api.putSettings({ carrier: value })
      expect(refused.status, JSON.stringify(value)).toBe(400)
      expect(refused.body.error).toMatchObject({ problems: [{ field: 'carrier', message: '택배사를 골라 주세요.' }] })
    }
    expect((await expect200(api.putSettings({ carrier: 'FAKE' }))).body.settings).toMatchObject({ carrier: 'FAKE', carrierName: '가짜 택배(시험용)' })
    const production = await parcelWorld({ overrides: { parcel: {} } })
    const other = await parcelSeller(production, {})
    const fake = await parcelApi(production, other.cookie).putSettings({ carrier: 'FAKE' })
    expect(fake.status).toBe(400)
    expect(fake.body.error).toMatchObject({ problems: [{ field: 'carrier', message: '가짜 택배는 시험 모드에서만 고를 수 있어요.' }] })
  })

  it('택배사 목록: 낱말 순서 + 시험 모드면 가짜 택배(끝), 각 줄의 자동 접수 가능 여부 = 어댑터가 있음', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    const list = (await expect200(parcelApi(world, seller.cookie).settings())).body.settings as { carriers: unknown[] }
    expect(list.carriers).toEqual([
      { code: 'EPOST', name: '우체국택배', autoBook: false },
      { code: 'CJ', name: 'CJ대한통운', autoBook: false },
      { code: 'HANJIN', name: '한진택배', autoBook: false },
      { code: 'LOGEN', name: '로젠택배', autoBook: false },
      { code: 'LOTTE', name: '롯데택배', autoBook: false },
      { code: 'OTHER', name: '직접 입력', autoBook: false },
      { code: 'FAKE', name: '가짜 택배(시험용)', autoBook: true },
    ])
  })

  it('어댑터가 없는 택배사(CJ·직접 입력)를 고른 판매자: 목록 막힘 NO_AUTO_BOOK, 접수는 택배사에 아무것도 보내지 않고 409. 고르지 않았으면 NO_CARRIER', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'CJ', sender: SENDER })
    await sell(world, seller, [['UC_A', '가가', 1]])
    await makeReady(world, seller, 'UC_A')
    const api = parcelApi(world, seller.cookie)
    for (const settings of [{ carrier: 'CJ' }, { carrier: 'OTHER', carrierName: '경동택배' }, { carrier: 'EPOST' }]) {
      await expect200(api.putSettings(settings))
      const rows = await dayRows(world, seller)
      expect(rows.blocked).toEqual({ code: 'NO_AUTO_BOOK', message: NO_AUTO_BOOK })
      expect(rows.ready.map((row) => row.buyer)).toEqual(['UC_A'])
      const refused = await api.book([{ buyer: 'UC_A' }])
      expect(refused.status).toBe(409)
      expect(refused.body.error).toMatchObject({ code: 'PARCEL_BLOCKED', message: NO_AUTO_BOOK })
    }
    expect((await dayRows(world, seller)).body.carrier).toEqual({ code: 'EPOST', name: '우체국택배' })
    await expect200(api.putSettings({ carrier: 'OTHER', carrierName: '경동  택배' }))
    expect((await dayRows(world, seller)).body.carrier).toEqual({ code: 'OTHER', name: '경동 택배' })
    expect(bookRequests(world)).toEqual([])
    expect(await attempts(world, seller.sellerId, 'UC_A')).toEqual([])
    // 고르지 않음 → 지금 문장 그대로
    await expect200(api.putSettings({ carrier: null }))
    expect((await dayRows(world, seller)).blocked).toEqual({ code: 'NO_CARRIER', message: '택배사를 먼저 이어 주세요.' })
    // 시험 모드 가짜 택배는 접수된다
    await expect200(api.putSettings({ carrier: 'FAKE' }))
    expect((await dayRows(world, seller)).blocked).toBeNull()
    expect((await bookOk(world, seller, [{ buyer: 'UC_A' }]))[0]).toMatchObject({ ok: true })
  })
})

describe('AC-FB1-16 택배 크기 코드와 옛 값 옮기기 (D-FB1-05)', () => {
  it('설정 저장: 새 코드 다섯은 그대로, 옛 낱말 넷은 옮긴 코드로 저장, 그 밖은 400 "상자 크기를 골라 주세요." (골든 함수와 같다)', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    const api = parcelApi(world, seller.cookie)
    // 설정이 없는 판매자의 기본 = 80
    expect((await expect200(api.settings())).body.settings).toMatchObject({ box: '80', boxes: ['60', '80', '100', '120', '160'] })
    expect(DEFAULT_BOX).toBe('80')
    for (const [value, code] of [
      ['60', '60'],
      ['80', '80'],
      ['100', '100'],
      ['120', '120'],
      ['160', '160'],
      ['극소', '60'],
      ['소', '80'],
      ['중', '100'],
      ['대', '120'],
    ] as const) {
      expect((await expect200(api.putSettings({ box: value }))).body.settings).toMatchObject({ box: code })
      expect(await settingsRow(world, seller)).toMatchObject({ box: code })
    }
    for (const value of ['80cm 이하', '', ' 80', '소 ', '90', '080', '１６０', '특대', 80, null, ['80'], { box: '80' }, '소']) {
      const refused = await api.putSettings({ box: value })
      expect(refused.status, JSON.stringify(value)).toBe(400)
      expect(refused.body.error).toMatchObject({ problems: [{ field: 'box', message: '상자 크기를 골라 주세요.' }] })
      expect('error' in readBox(value)).toBe(true)
      expect(await settingsRow(world, seller)).toMatchObject({ box: '120' })
    }
  })

  it('접수 본문 items[].box: 옛 낱말은 옮긴 코드로 접수(어댑터도 새 코드를 받는다), 표 밖 값은 400이고 아무것도 접수하지 않는다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER, box: '중' })
    await sell(world, seller, [
      ['UC_A', '가가', 1],
      ['UC_B', '나나', 1],
      ['UC_C', '다다', 1],
    ])
    for (const buyer of ['UC_A', 'UC_B', 'UC_C']) await makeReady(world, seller, buyer)
    expect((await dayRows(world, seller)).body.box).toBe('100')
    const refused = await parcelApi(world, seller.cookie).book([{ buyer: 'UC_A', box: '대' }, { buyer: 'UC_B', box: '특대' }])
    expect(refused.status).toBe(400)
    expect(refused.text).toContain('상자 크기를 골라 주세요.')
    expect(bookRequests(world)).toEqual([])
    const results = await bookOk(world, seller, [{ buyer: 'UC_A', box: '대' }, { buyer: 'UC_B', box: '160' }, { buyer: 'UC_C' }])
    expect(results.every((item) => item.ok)).toBe(true)
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.box)).toEqual(['120'])
    expect((await attempts(world, seller.sellerId, 'UC_B')).map((row) => row.box)).toEqual(['160'])
    expect((await attempts(world, seller.sellerId, 'UC_C')).map((row) => row.box)).toEqual(['100'])
    expect(bookRequests(world).map((item) => (item.body as { box: unknown }).box).sort()).toEqual(['100', '120', '160'])
    const booked = (await dayRows(world, seller)).booked
    expect(booked.map((row) => [row.buyer, (row.parcel as unknown as { box: string }).box])).toEqual([
      ['UC_A', '120'],
      ['UC_B', '160'],
      ['UC_C', '100'],
    ])
  })

  it('BASE 코드로 만든 DB(설정 box = 중, 접수 기록 box = 대)에 0019를 적용하면 설정 100, 접수 기록 120 (택배 화면·운송장), 직접 입력 칸이 생긴다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER, box: '80' })
    await sell(world, seller, [['UC_A', '가가', 1]])
    await makeReady(world, seller, 'UC_A')
    expect((await bookOk(world, seller, [{ buyer: 'UC_A' }]))[0]).toMatchObject({ ok: true })
    const pg = world.database.pglite as PGlite
    // BASE(0018까지)의 모양으로 되돌린다: 옛 낱말, 기본값 소, carrier_name 없음, 0019 적용 기록 없음
    // (V3에서 0020 seller_names·0021 voice_log가 뒤에 생겨 0019 기록만 지우던 것을 0019 이후 기록 모두와 0020·0021 표를 지우는 것으로 바꿈 — 되돌린 모양은 그대로 0018까지)
    await pg.exec(`
      update parcel_settings set box = '중' where seller_id = '${seller.sellerId}';
      update parcels set box = '대' where seller_id = '${seller.sellerId}';
      alter table parcel_settings alter column box set default '소';
      alter table parcel_settings drop column carrier_name;
      drop table seller_names;
      drop table voice_log;
      delete from drizzle.__drizzle_migrations where created_at >= ${String(MIGRATION_0019_WHEN)};`)
    const reopened = await openPglite(pg)
    expect((await pg.query<{ box: string }>('select box from parcel_settings')).rows).toEqual([{ box: '100' }])
    expect((await pg.query<{ box: string }>('select box from parcels')).rows).toEqual([{ box: '120' }])
    expect((await pg.query<{ carrier_name: string | null }>('select carrier_name from parcel_settings')).rows).toEqual([{ carrier_name: null }])
    const api = parcelApi(world, seller.cookie)
    expect((await expect200(api.settings())).body.settings).toMatchObject({ box: '100' })
    const rows = await dayRows(world, seller)
    expect(rows.body.box).toBe('100')
    expect(rows.booked.map((row) => [row.buyer, row.box, (row.parcel as unknown as { box: string }).box])).toEqual([['UC_A', '120', '120']])
    const waybill = await api.waybill('UC_A')
    expect(waybill.status).toBe(200)
    expect(waybill.headers.get('content-type')).toContain('application/pdf')
    await reopened.close()
  })

  it('0018까지 만든 빈 DB에 0019를 적용하면 옛 낱말 넷이 하나씩 옮겨지고 옛 낱말이 0개, 새 설정 행의 기본값은 80', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lj-fb1-'))
    try {
      mkdirSync(join(folder, 'meta'))
      const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
      const base = { ...journal, entries: journal.entries.filter((entry) => entry.tag < '0019') }
      expect(base.entries).toHaveLength(19)
      writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(base))
      for (const entry of base.entries) copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
      const pg = await PGlite.create()
      await migrate(drizzle({ client: pg, schema }) as never, { migrationsFolder: folder })
      const words = ['극소', '소', '중', '대', '160']
      const values = words.map((_, index) => `('s${String(index)}', '가게', 'k', now())`).join(', ')
      await pg.exec(`insert into sellers (id, name, phone_key_enc, created_at) values ${values}, ('s9', '가게', 'k', now());`)
      for (const [index, word] of words.entries()) {
        await pg.query('insert into parcel_settings (seller_id, carrier, box, updated_at) values ($1, $2, $3, now())', [`s${String(index)}`, 'EPOST', word])
        await pg.query(`insert into parcels (id, seller_id, date, buyer, carrier, request_key, state, box, qty, created_at, updated_at) values ($1, $2, $3, 'UC_A', 'FAKE', $4, 'BOOKED', $5, 1, now(), now())`, [
          `pc${String(index)}`,
          `s${String(index)}`,
          D,
          `lj-${String(index)}`,
          word,
        ])
      }
      // BASE의 기본값(소)으로 만든 행도 옮겨진다
      await pg.query(`insert into parcel_settings (seller_id, updated_at) values ('s9', now())`)
      const migrated = await openPglite(pg)
      const settings = await pg.query<{ seller_id: string; box: string; carrier: string; carrier_name: string | null }>('select seller_id, box, carrier, carrier_name from parcel_settings order by seller_id')
      expect(settings.rows.map((row) => [row.seller_id, row.box])).toEqual([
        ['s0', '60'],
        ['s1', '80'],
        ['s2', '100'],
        ['s3', '120'],
        ['s4', '160'],
        ['s9', '80'],
      ])
      expect(settings.rows.every((row) => row.carrier_name === null)).toBe(true)
      expect((await pg.query<{ id: string; box: string }>('select id, box from parcels order by id')).rows.map((row) => row.box)).toEqual(['60', '80', '100', '120', '160'])
      const left = await pg.query<{ n: number }>(`select (select count(*) from parcel_settings where box in ('극소','소','중','대')) + (select count(*) from parcels where box in ('극소','소','중','대')) as n`)
      expect(Number(left.rows[0]?.n)).toBe(0)
      await pg.exec(`insert into sellers (id, name, phone_key_enc, created_at) values ('s10', '가게', 'k', now()); insert into parcel_settings (seller_id, updated_at) values ('s10', now());`)
      expect((await pg.query<{ box: string }>(`select box from parcel_settings where seller_id = 's10'`)).rows).toEqual([{ box: '80' }])
      await migrated.close()
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
