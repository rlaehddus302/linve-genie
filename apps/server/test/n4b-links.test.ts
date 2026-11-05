// N4b AC-N4b-10~14 공유 링크 관리 (만들기·전부 만들기·목록·끊기·권한·복구·백업)
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { createBackupBytes, FolderBackupStorage, restoreSeller } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { formatLog } from '../src/log.ts'
import { RECEIPT_LINK_TTL_MS, receiptTokenHash } from '../src/receipt-links.ts'
import { chat, getFile, ok } from './i2-support.ts'
import { linkApi, linkRows, openLink, sellMany, tokenOf } from './n4b-support.ts'
import { ORIGIN, addSeller, client, createBroadcast, dumpAllTables, fakeClock, newWorld, rid } from './support.ts'

const DATE = '2026-10-19'
const DAY_MS = 24 * 60 * 60 * 1000

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('AC-N4b-10 링크 만들기', () => {
  it('저장된 뒤 링크 주소·끝나는 시각, DB에는 해시·암호화한 토큰만(원문 없음), 같은 요청 번호·다른 요청 번호 모두 새 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 2]])
    const now = world.clock.now()
    const links = linkApi(world, seller.cookie)
    const requestId = rid('ln')
    const first = await links.create(DATE, 'UC_A', requestId)
    expect(first.status, first.text).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const link = first.body.link as Record<string, unknown>
    expect(first.body.created).toBe(true)
    expect(link).toMatchObject({ buyer: 'UC_A', status: 'ACTIVE', expiresAt: new Date(now + RECEIPT_LINK_TTL_MS).toISOString(), revokedAt: null })
    expect(String(link.url).startsWith(`${ORIGIN}/r/`)).toBe(true)
    const token = tokenOf(link.url)
    // 기록: 판매자·날짜·구매자·만든 시각·만든 계정·끝나는 시각 (= 만든 시각 + 14×24시간)
    const rows = await linkRows(world)
    expect(rows).toHaveLength(1)
    const row = rows[0] as Record<string, unknown>
    expect(row).toMatchObject({ seller_id: seller.sellerId, date: DATE, buyer: 'UC_A', created_by: seller.accountId, revoked_at: null, revoked_by: null })
    expect((row.created_at as Date).getTime()).toBe(now)
    expect((row.expires_at as Date).getTime()).toBe(now + 14 * DAY_MS)
    expect(row.token_hash).toBe(receiptTokenHash(token))
    // DB 어디에도 토큰 원문·링크 주소가 없다
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain(token)
    // 같은 요청 번호 → 처음 답 그대로, 다른 요청 번호 → 그 링크(새로 만들지 않음)
    const again = await links.create(DATE, 'UC_A', requestId)
    expect(again.body).toEqual(first.body)
    world.clock.advance(60_000)
    const other = await links.create(DATE, 'UC_A')
    expect(other.body).toEqual({ ...first.body, created: false })
    expect(await linkRows(world)).toHaveLength(1)
    // 로그에 토큰이 없다
    expect(world.logs.map(formatLog).join('\n')).not.toContain(token)
  })

  it('동시에 두 기기가 만들어도 쓸 수 있는 링크는 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    const links = linkApi(world, seller.cookie)
    const [a, b, c] = await Promise.all([links.create(DATE, 'UC_A'), links.create(DATE, 'UC_A'), links.all(DATE)])
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200])
    expect((a.body.link as { url: string }).url).toBe((b.body.link as { url: string }).url)
    expect(await linkRows(world)).toHaveLength(1)
  })

  it('리허설 409, 품목 없는 묶음·합쳐진 구매자·없는 구매자 409, 다른 판매자·없는 날짜 404, 본문 검사 — 모두 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await sellMany(world, seller, DATE, [
      ['UC_A', '가람', 1],
      ['UC_B', '나비', 1],
      ['UC_C', '다솜', 1],
    ])
    await ok(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_A', reason: '구매자 요청' })
    await ok(world, seller, { type: 'buyer.merge', from: 'UC_C', into: 'UC_B', reason: '같은 사람' }, DATE)
    const r = await createBroadcast(world, seller, { date: DATE, rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    const links = linkApi(world, seller.cookie)
    const rehearsal = await links.create(DATE, 'sim_a', rid(), '?rehearsal=true')
    expect(rehearsal.status).toBe(409)
    expect(rehearsal.body.error).toEqual({ code: 'REHEARSAL_RECEIPT_LINK', message: '리허설 방송은 공유 링크를 만들지 않아요.' })
    for (const buyer of ['UC_A', 'UC_C', 'UC_NOBODY']) {
      const response = await links.create(DATE, buyer)
      expect(response.status, buyer).toBe(409)
      expect(response.body.error).toEqual({ code: 'NO_ITEMS', message: '확인서를 만들 상품이 없어요.' })
    }
    expect((await linkApi(world, other.cookie).create(DATE, 'UC_B')).status).toBe(404)
    expect((await links.create('2026-10-25', 'UC_B')).status).toBe(404)
    const api = client(world, seller.cookie)
    const extra = await api.post(`/api/days/${DATE}/receipt-links`, { requestId: rid(), buyer: 'UC_B', days: 30 })
    expect(extra.status).toBe(400)
    expect((extra.body.error as { code: string }).code).toBe('UNKNOWN_FIELD')
    const missing = await api.post(`/api/days/${DATE}/receipt-links`, { requestId: rid() })
    expect((missing.body.error as { code: string }).code).toBe('INVALID_INPUT')
    const wrongType = await api.post(`/api/days/${DATE}/receipt-links`, { requestId: rid(), buyer: 5 })
    expect((wrongType.body.error as { code: string }).code).toBe('INVALID_INPUT')
    expect((await api.post(`/api/days/${DATE}/receipt-links`, { buyer: 'UC_B' })).status).toBe(400)
    expect(await linkRows(world)).toHaveLength(0)
    // 합쳐 받은 구매자(UC_B)는 만들 수 있다
    expect((await links.create(DATE, 'UC_B')).status).toBe(200)
  })
})

describe('AC-N4b-11 링크 전부 만들기', () => {
  it('묶음 5개 중 있음 2·기간 지남 1·끊김 1·없음 1 → 새로 3개(한 트랜잭션), 묶음마다 상태, 같은 요청 번호 같은 답, 모두 있으면 0', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [
      ['UC_A', '가람', 1],
      ['UC_B', '나비', 1],
      ['UC_C', '다솜', 1],
      ['UC_D', '라온', 1],
      ['UC_E', '마루', 1],
    ])
    const links = linkApi(world, seller.cookie)
    // 다솜: 기간이 지난 링크
    await links.create(DATE, 'UC_C')
    world.clock.advance(RECEIPT_LINK_TTL_MS)
    await links.create(DATE, 'UC_A')
    await links.create(DATE, 'UC_B')
    await links.create(DATE, 'UC_D')
    await links.revoke(DATE, 'UC_D')
    expect(await linkRows(world)).toHaveLength(4)
    const requestId = rid('la')
    const all = await links.all(DATE, requestId)
    expect(all.status, all.text).toBe(200)
    expect(all.body.created).toBe(3)
    const list = all.body.links as { buyer: string; status: string; url: string }[]
    expect(list.map((row) => row.buyer)).toEqual(['UC_A', 'UC_B', 'UC_C', 'UC_D', 'UC_E'])
    expect(list.every((row) => row.status === 'ACTIVE')).toBe(true)
    expect(new Set(list.map((row) => row.url)).size).toBe(5)
    expect(await linkRows(world)).toHaveLength(7)
    // 목록과 같은 모양
    expect((await links.list(DATE)).body.links).toEqual(all.body.links)
    const replay = await links.all(DATE, requestId)
    expect(replay.body).toEqual(all.body)
    expect(await linkRows(world)).toHaveLength(7)
    const none = await links.all(DATE)
    expect(none.body.created).toBe(0)
    expect(none.body.links).toEqual(all.body.links)
  })

  it('리허설은 409, 품목 있는 묶음이 없으면 새로 만든 수 0(오류 아님)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DATE })
    await ok(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크', price: 1000 })
    const links = linkApi(world, seller.cookie)
    const empty = await links.all(DATE)
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ date: DATE, created: 0, links: [] })
    const r = await createBroadcast(world, seller, { date: DATE, rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    const rehearsal = await links.all(DATE, rid(), '?rehearsal=true')
    expect(rehearsal.status).toBe(409)
    expect(rehearsal.body.error).toEqual({ code: 'REHEARSAL_RECEIPT_LINK', message: '리허설 방송은 공유 링크를 만들지 않아요.' })
    expect(await linkRows(world)).toHaveLength(0)
  })
})

describe('AC-N4b-12 링크 목록', () => {
  it('품목 있는 묶음마다 일괄 순서로 상태·주소·시각, 품목 없는·합쳐진 구매자 줄 없음(기록은 남음), 리허설은 빈 목록', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await sellMany(world, seller, DATE, [
      ['UC_D', '라온', 1],
      ['UC_A', '가람', 1],
      ['UC_C', '다솜', 1],
      ['UC_B', '나비', 1],
      ['UC_X', '사라짐', 1],
    ])
    const links = linkApi(world, seller.cookie)
    const t0 = world.clock.now()
    await links.create(DATE, 'UC_C')
    await links.create(DATE, 'UC_X')
    world.clock.advance(RECEIPT_LINK_TTL_MS + 1000)
    const t1 = world.clock.now()
    const active = await links.create(DATE, 'UC_A')
    await links.create(DATE, 'UC_D')
    world.clock.advance(5000)
    await links.revoke(DATE, 'UC_D')
    // 사라짐(UC_X)은 다솜(UC_C)에 합쳐진다 — 줄 없음
    await ok(world, seller, { type: 'buyer.merge', from: 'UC_X', into: 'UC_C', reason: '같은 사람' }, DATE)
    void b
    const list = await links.list(DATE)
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    expect(list.body).toEqual({
      date: DATE,
      rehearsal: false,
      links: [
        { buyer: 'UC_A', status: 'ACTIVE', url: (active.body.link as { url: string }).url, expiresAt: new Date(t1 + RECEIPT_LINK_TTL_MS).toISOString(), revokedAt: null },
        { buyer: 'UC_B', status: 'NONE', url: null, expiresAt: null, revokedAt: null },
        { buyer: 'UC_C', status: 'EXPIRED', url: null, expiresAt: new Date(t0 + RECEIPT_LINK_TTL_MS).toISOString(), revokedAt: null },
        { buyer: 'UC_D', status: 'REVOKED', url: null, expiresAt: new Date(t1 + RECEIPT_LINK_TTL_MS).toISOString(), revokedAt: new Date(t1 + 5000).toISOString() },
      ],
    })
    expect(await linkRows(world)).toHaveLength(4)
    // 리허설 범위: 빈 목록 / 없는 날짜·다른 판매자: 404
    const r = await createBroadcast(world, seller, { date: DATE, rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    expect((await links.list(DATE, '?rehearsal=true')).body).toEqual({ date: DATE, rehearsal: true, links: [] })
    expect((await links.list('2026-10-25')).status).toBe(404)
    expect((await linkApi(world, (await addSeller(world)).cookie).list(DATE)).status).toBe(404)
  })

  it('구매자 줄(영수증 보내기 화면): 일괄 순서·이름·끝자리·상품 수·최종 금액·입금 상태·남은 금액·링크 상태 (리허설은 링크 없음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await sellMany(world, seller, DATE, [
      ['UC_B', '나비', 2],
      ['UC_A', '🌵가람', 1],
    ])
    await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_B', date: DATE, amount: 1000 }, DATE)
    void b
    const links = linkApi(world, seller.cookie)
    await links.create(DATE, 'UC_A')
    const buyers = await links.buyers(DATE)
    expect(buyers.status, buyers.text).toBe(200)
    const rows = buyers.body.buyers as Record<string, unknown>[]
    expect(rows.map((row) => [row.buyer, row.name, row.itemCount, row.payment])).toEqual([
      ['UC_A', '가람', 1, 'UNPAID'],
      ['UC_B', '나비', 2, 'PARTIAL'],
    ])
    expect((rows[0]?.link as { status: string }).status).toBe('ACTIVE')
    expect((rows[1]?.link as { status: string }).status).toBe('NONE')
    const second = rows[1] as { total: number; received: number; remaining: number }
    expect(second.remaining).toBe(second.total - second.received)
    // 리허설: 링크 없음
    const r = await createBroadcast(world, seller, { date: DATE, rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    const rehearsal = await links.buyers(DATE, '?rehearsal=true')
    expect((rehearsal.body.buyers as Record<string, unknown>[]).map((row) => [row.name, row.link])).toEqual([['연습', null]])
  })
})

describe('AC-N4b-13 링크 끊기', () => {
  it('끊은 시각·계정 저장 → 다음 요청부터 열 수 없음, 기록은 남음, 없으면 성공(바뀐 것 없음), 다시 만들면 새 주소', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    const links = linkApi(world, seller.cookie)
    const created = await links.create(DATE, 'UC_A')
    const url = (created.body.link as { url: string }).url
    const token = tokenOf(url)
    expect((await openLink(world, `/r/${token}`)).status).toBe(200)
    world.clock.advance(1000)
    const requestId = rid('lr')
    const revoked = await links.revoke(DATE, 'UC_A', requestId)
    expect(revoked.status, revoked.text).toBe(200)
    expect(revoked.body).toMatchObject({ date: DATE, revoked: true, link: { buyer: 'UC_A', status: 'REVOKED', url: null, revokedAt: new Date(world.clock.now()).toISOString() } })
    const rows = await linkRows(world)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ revoked_by: seller.accountId })
    expect((rows[0]?.revoked_at as Date).getTime()).toBe(world.clock.now())
    expect((await openLink(world, `/r/${token}`)).status).toBe(404)
    // 같은 요청 번호 → 같은 답, 이미 끊김 → 성공·바뀐 것 없음
    expect((await links.revoke(DATE, 'UC_A', requestId)).body).toEqual(revoked.body)
    const nothing = await links.revoke(DATE, 'UC_A')
    expect(nothing.status).toBe(200)
    expect(nothing.body.revoked).toBe(false)
    const unknown = await links.revoke(DATE, 'UC_NOBODY')
    expect(unknown.body).toEqual({ date: DATE, revoked: false, link: { buyer: 'UC_NOBODY', status: 'NONE', url: null, expiresAt: null, revokedAt: null } })
    // 다시 만들면 새 토큰, 옛 링크는 다시 열리지 않는다
    const again = await links.create(DATE, 'UC_A')
    expect(again.body.created).toBe(true)
    expect((again.body.link as { url: string }).url).not.toBe(url)
    expect((await openLink(world, `/r/${token}`)).status).toBe(404)
    expect((await openLink(world, `/r/${tokenOf((again.body.link as { url: string }).url)}`)).status).toBe(200)
  })

  it('요청 번호를 다른 일·다른 날짜에 다시 쓰면 409 (처음 기록 그대로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    await sellMany(world, seller, '2026-10-20', [['UC_A', '가람', 1]])
    const links = linkApi(world, seller.cookie)
    const requestId = rid('same')
    expect((await links.create(DATE, 'UC_A', requestId)).status).toBe(200)
    expect((await links.revoke(DATE, 'UC_A', requestId)).status).toBe(409)
    expect((await links.create('2026-10-20', 'UC_A', requestId)).status).toBe(409)
    expect((await links.list(DATE)).body.links).toMatchObject([{ status: 'ACTIVE' }])
  })
})

describe('AC-N4b-14 권한·복구·백업', () => {
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('로그인 없음 401(아무것도 기록하지 않음), 다른 출처 403', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    for (const cookie of [null]) {
      const links = linkApi(world, cookie)
      const expected = 401
      for (const response of [await links.create(DATE, 'UC_A'), await links.all(DATE), await links.revoke(DATE, 'UC_A'), await links.list(DATE), await links.buyers(DATE)]) {
        expect(response.status).toBe(expected)
      }
      for (const path of ['receipt.jpg?buyer=UC_A', 'receipts.zip']) expect((await getFile(world, cookie, `/api/days/${DATE}/${path}`)).status).toBe(expected)
    }
    expect(await linkRows(world)).toHaveLength(0)
    const foreign = await client(world, seller.cookie).raw(`/api/days/${DATE}/receipt-links`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: rid(), buyer: 'UC_A' }),
    })
    expect(foreign.status).toBe(403)
    expect(await linkRows(world)).toHaveLength(0)
  })

  it('운영자 복구(바꾸기)는 그 판매자의 링크를 모두 지운다 — 복구 전 링크는 열 수 없음, 다른 판매자 링크는 그대로, 백업 파일에는 링크가 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-n4b-'))
    dirs.push(dir)
    const storage = new FolderBackupStorage(dir)
    const world = await newWorld({ clock: fakeClock(), backupStorage: storage })
    const seller = await addSeller(world)
    const other = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    await sellMany(world, other, '2026-10-20', [['UC_Z', '자두', 1]])
    const mine = tokenOf(((await linkApi(world, seller.cookie).create(DATE, 'UC_A')).body.link as { url: string }).url)
    const theirs = tokenOf(((await linkApi(world, other.cookie).create('2026-10-20', 'UC_Z')).body.link as { url: string }).url)
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const text = gunzipSync(bytes).toString('utf8')
    expect(text).not.toContain('receipt_links')
    expect(text).not.toContain(receiptTokenHash(mine))
    expect(text).not.toContain(mine)
    // 백업 뒤 링크를 하나 더 만들어 둔다 — 복구 뒤에도 남지 않는다
    await linkApi(world, seller.cookie).revoke(DATE, 'UC_A')
    const later = tokenOf(((await linkApi(world, seller.cookie).create(DATE, 'UC_A')).body.link as { url: string }).url)
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage, clock: world.clock, ids: randomIds })
    expect(restored.ok).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    const rows = await linkRows(world)
    expect(rows.map((row) => row.seller_id)).toEqual([other.sellerId])
    for (const token of [mine, later]) expect((await openLink(world, `/r/${token}`)).status).toBe(404)
    expect((await openLink(world, `/r/${theirs}`)).status).toBe(200)
    // 복구한 판매자는 새 링크를 만들 수 있다
    expect((await linkApi(world, seller.cookie).create(DATE, 'UC_A')).body.created).toBe(true)
  })

  it('기록이 없던 판매자로의 가져오기도 그 판매자 링크가 남지 않는다', async () => {
    const world = await newWorld()
    const source = await addSeller(world)
    await sellMany(world, source, DATE, [['UC_A', '가람', 1]])
    const bytes = await createBackupBytes(world.database.db, source.sellerId, world.clock.now())
    // 다른 서버의 빈 판매자 — 링크 요청 기록만 있는 상태(범위 없음)에서 가져오기
    const target = await newWorld()
    const empty = await addSeller(target)
    const pg = target.database.pglite as PGlite
    await pg.query(`insert into receipt_link_requests (seller_id, request_id, date, kind, result, created_at) values ($1, 'x', $2, 'CREATE_ALL', '{}', now())`, [empty.sellerId, DATE])
    const restored = await restoreSeller({ db: target.database.db, sellerId: empty.sellerId, bytes, replace: false, storage: null, clock: target.clock, ids: randomIds })
    expect(restored.ok).toBe(true)
    target.server.writer.forgetSeller(empty.sellerId)
    expect(await linkRows(target)).toHaveLength(0)
    const left = (await pg.query('select * from receipt_link_requests')).rows
    expect(left).toHaveLength(0)
  })
})
