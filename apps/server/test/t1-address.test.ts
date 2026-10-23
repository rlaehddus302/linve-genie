// T1 배송지 서버 시험: AC-T1-01(세 곳이 같은 칸 코드), AC-T1-02(암호문뿐), AC-T1-03(30일에 지움), AC-T1-05(합치기·떼어 내기), AC-T1-06(백업·복구),
// AC-T1-13(판매자 배송지 API), AC-T1-23(설정 "택배").
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { FolderBackupStorage, backupDigest, checkBackupBytes, createBackupBytes, restoreSeller, type BackupFile } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { kst } from './i2-support.ts'
import { client, createBroadcast, dumpAllTables, fakeClock, rid, writeEvent } from './support.ts'
import { ADDRESS, D, SENDER, attempts, bookOk, dayRows, expect200, makeReady, packAll, parcelApi, parcelSeller, parcelWorld, pay, rowOf, sell } from './t1-support.ts'

const BAD = { name: '홍길동', phone: 'abc', address: '', detail: '', zip: '12', memo: '' }

describe('AC-T1-01 같은 함수가 세 곳에 쓰인다', () => {
  it('구매자 링크 양식·판매자 배송지 API·설정의 보내는 사람이 같은 틀린 입력에 같은 칸 코드', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const api = parcelApi(world, seller.cookie)
    const sellerSide = await api.putAddress('UC_A', BAD)
    expect(sellerSide.status).toBe(400)
    expect((sellerSide.body.codes as string[]) ?? []).toEqual(['PHONE_INVALID', 'ADDRESS_EMPTY', 'ZIP_INVALID'])
    const settings = await api.putSettings({ sender: { name: BAD.name, phone: BAD.phone, address: BAD.address, detail: BAD.detail, zip: BAD.zip } })
    expect(settings.status).toBe(400)
    expect(settings.body.codes).toEqual(['PHONE_INVALID', 'ADDRESS_EMPTY', 'ZIP_INVALID'])
    expect((settings.body.error as { problems: { field: string }[] }).problems.map((problem) => problem.field)).toEqual(['sender.phone', 'sender.address', 'sender.zip'])
    const link = await world.server.parcels.saveFromLink(seller.sellerId, D, 'UC_A', BAD)
    expect(link).toEqual({ kind: 'invalid', errors: ['PHONE_INVALID', 'ADDRESS_EMPTY', 'ZIP_INVALID'] })
  })
})

describe('AC-T1-02 배송지 저장은 암호문뿐', () => {
  it('DB 어디에도 원문이 없고, 다른 행으로 옮기면 풀리지 않아 배송지 없음, 고치면 이전 내용은 남지 않는다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const api = parcelApi(world, seller.cookie)
    await expect200(api.putAddress('UC_A', { ...ADDRESS, phone: '01012345678' }))
    const dump = await dumpAllTables(world.database)
    for (const text of ['홍길동', '01012345678', '010-1234-5678', '세종대로', '101동', '문 앞에', SENDER.address, '031-123-4567', '0311234567', '다육이네']) expect(dump, text).not.toContain(text)
    const columns = await world.database.pglite?.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'parcel_addresses' order by ordinal_position`)
    expect(columns?.rows.map((row) => row.column_name)).toEqual(['id', 'seller_id', 'date', 'buyer', 'sealed', 'source', 'confirmed', 'confirmed_by', 'updated_at', 'updated_by'])
    // 암호문을 B의 행으로 옮긴다 → 풀리지 않고 배송지 없음
    const sealed = (await world.database.pglite?.query<{ sealed: string }>(`select sealed from parcel_addresses where buyer = 'UC_A'`))?.rows[0]?.sealed as string
    await world.database.pglite?.query(
      `insert into parcel_addresses (seller_id, date, buyer, sealed, source, confirmed, updated_at) values ($1, $2, 'UC_B', $3, 'SELLER', true, now())`,
      [seller.sellerId, D, sealed],
    )
    const moved = await expect200(api.bundle('UC_B'))
    expect(moved.body.bundle).toMatchObject({ address: null, row: { address: 'NONE' } })
    // 고치면 덮어쓴다 (예전 암호문은 남지 않는다 — 옮겨 둔 사본은 지우고 본다)
    await world.database.pglite?.query(`delete from parcel_addresses where buyer = 'UC_B'`)
    await expect200(api.putAddress('UC_A', { ...ADDRESS, name: '김철수' }))
    const after = await dumpAllTables(world.database)
    expect(after).not.toContain(sealed.split('.')[2] as string)
    const rows = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from parcel_addresses where buyer = 'UC_A'`)
    expect(rows?.rows[0]?.n).toBe(1)
    expect((await expect200(api.bundle('UC_A'))).body.bundle).toMatchObject({ address: { name: '김철수', phone: '01012345678', source: 'SELLER', confirmed: true } })
  })
})

describe('AC-T1-03 30일에 지운다', () => {
  it('2026-10-30 23:59(KST)에는 두고 10-31 00:00에 지운다(두 번 돌려도 같다), 접수 기록은 남고 운송장은 409, 아직 접수 안 한 묶음은 NO_ADDRESS, 봉인한 날짜는 목록에 없다', async () => {
    const clock = fakeClock(kst('2026-10-02', '12:00:00'))
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    const date = '2026-10-01'
    // 문자찜만 있는 날짜 (봉인 대상이 아니다)
    const b = (await createBroadcast(world, seller, { date })).id
    const buyers: string[] = []
    for (const [no, phone] of [
      [1, '010-1111-2222'],
      [2, '010-3333-4444'],
    ] as const) {
      expect((await writeEvent(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 10_000 })).status).toBe(200)
      const sms = await writeEvent(world, seller, { type: 'sms', b, no, phone })
      expect(sms.status, sms.text).toBe(200)
      buyers.push(sms.body.buyer as string)
    }
    const [booked, waiting] = buyers as [string, string]
    await makeReady(world, seller, booked, ADDRESS, date)
    await makeReady(world, seller, waiting, ADDRESS, date)
    const [result] = await bookOk(world, seller, [{ buyer: booked }], date)
    expect(result?.ok).toBe(true)
    // 유튜브 채팅 날짜 (봉인 대상)
    await sell(world, seller, [['UC_Y', '유튜브', 1]], '2026-09-30')

    clock.set(kst('2026-10-30', '23:59:00'))
    expect(await world.server.parcels.sweepOnce()).toBe(0)
    expect((await rowOf(world, seller, waiting, date)).ready).toBe(true)

    clock.set(kst('2026-10-31', '00:00:00'))
    // 정리 작업이 돌기 전에도 보관 기간이 지난 배송지는 없는 것으로 본다
    expect((await rowOf(world, seller, waiting, date)).reason).toBe('NO_ADDRESS')
    expect(await world.server.parcels.sweepOnce()).toBe(2)
    expect(await world.server.parcels.sweepOnce()).toBe(0)
    const left = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from parcel_addresses where date = $1`, [date])
    expect(left?.rows[0]?.n).toBe(0)
    expect((await attempts(world, seller.sellerId, booked)).map((row) => [row.state, row.invoice])).toEqual([['BOOKED', result?.invoice]])
    const waybill = await parcelApi(world, seller.cookie).waybill(booked, date)
    expect(waybill.status).toBe(409)
    expect(await waybill.text()).toContain('배송지 보관 기간이 지나 운송장을 만들 수 없어요.')
    expect((await rowOf(world, seller, waiting, date)).reason).toBe('NO_ADDRESS')
    expect(world.logs.some((record) => record.code === 'PARCEL_ADDRESSES_SWEPT' && record.count === 2)).toBe(true)
    // 봉인한 날짜(유튜브 채팅이 있는 2026-09-30 — 10-30 0시에 봉인)는 목록에 없다
    await world.server.sealer.runOnce()
    const days = await expect200(parcelApi(world, seller.cookie).days())
    expect((days.body.dates as { date: string }[]).map((item) => item.date)).toEqual(['2026-10-01'])
    expect((await parcelApi(world, seller.cookie).day('2026-09-30')).status).toBe(404)
  })
})

describe('AC-T1-13 판매자 배송지 API', () => {
  it('묶음 자세히(여섯 칸·출처·확인 여부·no-store), 판매자가 적으면 확인함, 구매자가 적은 것 확인(그 사이 바뀌면 409), 지우기, 살아 있는 접수면 409', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const api = parcelApi(world, seller.cookie)
    const empty = await expect200(api.bundle('UC_A'))
    expect(empty.headers.get('cache-control')).toBe('no-store')
    expect(empty.body.bundle).toMatchObject({ address: null, locked: false, row: { address: 'NONE' } })
    // 구매자가 적은 것 → 확인 전
    expect((await world.server.parcels.saveFromLink(seller.sellerId, D, 'UC_A', ADDRESS)).kind).toBe('saved')
    const buyerWrote = (await expect200(api.bundle('UC_A'))).body.bundle as { address: { updatedAt: string; source: string; confirmed: boolean; phone: string } }
    expect(buyerWrote.address).toMatchObject({ source: 'BUYER', confirmed: false, phone: '01012345678', memo: '문 앞에' })
    // 그 사이 구매자가 고침 → 옛 고친 시각으로 확인하면 409
    world.clock.advance(1000)
    expect((await world.server.parcels.saveFromLink(seller.sellerId, D, 'UC_A', { ...ADDRESS, detail: '102동' })).kind).toBe('saved')
    const stale = await api.confirm('UC_A', buyerWrote.address.updatedAt)
    expect(stale.status).toBe(409)
    expect(stale.text).toContain('구매자가 배송지를 바꿨어요. 다시 확인해 주세요.')
    const fresh = (await expect200(api.bundle('UC_A'))).body.bundle as { address: { updatedAt: string } }
    const confirmed = await expect200(api.confirm('UC_A', fresh.address.updatedAt))
    expect(confirmed.body.bundle).toMatchObject({ address: { detail: '102동', confirmed: true, source: 'BUYER' }, row: { address: 'CONFIRMED' } })
    const confirmedBy = await world.database.pglite?.query<{ confirmed_by: string }>(`select confirmed_by from parcel_addresses`)
    expect(confirmedBy?.rows[0]?.confirmed_by).toBe(seller.accountId)
    // 확인한 뒤 구매자가 다시 고치면 확인 전
    expect((await world.server.parcels.saveFromLink(seller.sellerId, D, 'UC_A', ADDRESS)).kind).toBe('saved')
    expect((await expect200(api.bundle('UC_A'))).body.bundle).toMatchObject({ address: { confirmed: false } })
    // 판매자가 고치면 그 자리에서 확인함
    expect((await expect200(api.putAddress('UC_A', { ...ADDRESS, memo: '경비실' }))).body.bundle).toMatchObject({ address: { memo: '경비실', source: 'SELLER', confirmed: true } })
    // 같은 요청 번호는 처음 결과 (다시 쓰지 않는다)
    const requestId = rid('pa')
    await expect200(api.putAddress('UC_A', { ...ADDRESS, memo: '하나' }, D, requestId))
    expect((await expect200(api.putAddress('UC_A', { ...ADDRESS, memo: '둘' }, D, requestId))).body.bundle).toMatchObject({ address: { memo: '하나' } })
    // 지우기 → NO_ADDRESS
    expect((await expect200(api.remove('UC_A'))).body.bundle).toMatchObject({ address: null, row: { address: 'NONE' } })
    // 살아 있는 접수가 있으면 쓰기·확인·지우기 409
    await makeReady(world, seller, 'UC_A')
    await bookOk(world, seller, [{ buyer: 'UC_A' }])
    const locked = (await expect200(api.bundle('UC_A'))).body.bundle as { locked: boolean; address: { updatedAt: string } }
    expect(locked.locked).toBe(true)
    for (const response of [await api.putAddress('UC_A', ADDRESS), await api.confirm('UC_A', locked.address.updatedAt), await api.remove('UC_A')]) {
      expect(response.status).toBe(409)
      expect(response.text).toContain('택배 접수를 먼저 취소해 주세요.')
    }
    expect((await world.server.parcels.saveFromLink(seller.sellerId, D, 'UC_A', ADDRESS)).kind).toBe('refused')
  })

  it('틀린 배송지는 400(칸마다 문장·칸 코드, 받은 값은 되돌려 보내지 않는다), 모르는 칸·모르는 구매자는 400·404', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const api = parcelApi(world, seller.cookie)
    const bad = await api.putAddress('UC_A', { ...ADDRESS, phone: '+82 10 9999 8888', address: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.codes).toEqual(['PHONE_INVALID', 'ADDRESS_EMPTY'])
    expect(bad.text).toContain('연락처는 010으로 시작하는 숫자로 적어 주세요.')
    expect(bad.text).toContain('주소를 적어 주세요.')
    expect(bad.text).not.toContain('9999')
    expect((await api.putAddress('UC_A', { ...ADDRESS, extra: 'x' })).status).toBe(400)
    expect((await api.putAddress('UC_NOPE', ADDRESS)).status).toBe(404)
    expect((await api.bundle('UC_NOPE')).status).toBe(404)
  })
})

describe('AC-T1-05 합치기·떼어 내기와 배송지', () => {
  it('합치면 Y에 없을 때만 X의 것을 옮기고 어느 쪽이든 Y는 확인 전, X의 배송지는 지운다. 떼어 내도 Y에 남는다. 접수한 묶음은 지금처럼 막힌다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    const E = '2026-10-18'
    await sell(world, seller, [
      ['UC_X', '엑스', 1],
      ['UC_Y', '와이', 1],
    ])
    await sell(world, seller, [
      ['UC_X', '엑스', 1],
      ['UC_Y', '와이', 1],
    ], E)
    const api = parcelApi(world, seller.cookie)
    await expect200(api.putAddress('UC_X', { ...ADDRESS, name: '엑스주소' }))
    await expect200(api.putAddress('UC_X', { ...ADDRESS, name: '엑스이' }, E))
    await expect200(api.putAddress('UC_Y', { ...ADDRESS, name: '와이이' }, E))
    for (const date of [D, E]) {
      const merged = await writeEvent(world, seller, { type: 'buyer.merge', from: 'UC_X', into: 'UC_Y', reason: '같은 사람' }, date)
      expect(merged.status, merged.text).toBe(200)
    }
    expect((await expect200(api.bundle('UC_Y'))).body.bundle).toMatchObject({ address: { name: '엑스주소', confirmed: false } })
    expect((await expect200(api.bundle('UC_Y', E))).body.bundle).toMatchObject({ address: { name: '와이이', confirmed: false } })
    const xRows = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from parcel_addresses where buyer = 'UC_X'`)
    expect(xRows?.rows[0]?.n).toBe(0)
    // 떼어 내기 → 배송지는 Y에 남는다
    expect((await writeEvent(world, seller, { type: 'buyer.unmerge', from: 'UC_X', reason: '다른 사람' }, D)).status).toBe(200)
    expect((await expect200(api.bundle('UC_Y'))).body.bundle).toMatchObject({ address: { name: '엑스주소' } })
    expect((await expect200(api.bundle('UC_X'))).body.bundle).toMatchObject({ address: null })
    // 접수한 묶음(배송 완료 기록)의 구매자는 합치기가 지금 규칙대로 막힌다
    await makeReady(world, seller, 'UC_X')
    await bookOk(world, seller, [{ buyer: 'UC_X' }])
    const blocked = await writeEvent(world, seller, { type: 'buyer.merge', from: 'UC_X', into: 'UC_Y', reason: '같은 사람' }, D)
    expect(blocked.status).toBe(409)
    expect(blocked.text).toContain('포장이나 배송을 적은 구매자는 다른 구매자에 합칠 수 없어요.')
  })
})

describe('AC-T1-05 떼어 내기와 접수 결과를 기다리는 시도 (SA-T1-01 — 스펙 확인 요청 중인 막기)', () => {
  const unmergeCount = async (world: Awaited<ReturnType<typeof parcelWorld>>) =>
    (await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'buyer.unmerge'`))?.rows[0]?.n

  it('붙은 구매자 Y에 UNKNOWN·PENDING 시도가 있으면 떼어 내기는 409(이벤트 없음), FAILED·접수 취소 뒤에는 떼어 낼 수 있다', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_X', '엑스', 1],
      ['UC_Y', '와이', 1],
    ])
    expect((await writeEvent(world, seller, { type: 'buyer.merge', from: 'UC_X', into: 'UC_Y', reason: '같은 사람' }, D)).status).toBe(200)
    // UNKNOWN: 택배사 응답 없음
    await makeReady(world, seller, 'UC_Y', { ...ADDRESS, address: '서울 [응답없음] 1' })
    expect((await bookOk(world, seller, [{ buyer: 'UC_Y' }]))[0]).toMatchObject({ ok: false, reason: 'UNAVAILABLE' })
    expect((await attempts(world, seller.sellerId, 'UC_Y')).map((row) => row.state)).toEqual(['UNKNOWN'])
    const before = await unmergeCount(world)
    const unknown = await writeEvent(world, seller, { type: 'buyer.unmerge', from: 'UC_X', reason: '다른 사람' }, D)
    expect(unknown.status, unknown.text).toBe(409)
    expect(unknown.text).toContain('택배 접수 결과를 기다리는 구매자에게서는 떼어 낼 수 없어요.')
    expect(await unmergeCount(world)).toBe(before)
    // PENDING(보내는 중 멈춘 시도)도 같다 — 시도를 FAILED로 바꾸고 PENDING 하나를 직접 만든다
    await world.database.pglite?.query(`update parcels set state = 'FAILED', reason = 'ADDRESS' where seller_id = $1 and buyer = 'UC_Y'`, [seller.sellerId])
    await world.database.pglite?.query(
      `insert into parcels (id, seller_id, date, buyer, carrier, request_key, state, box, qty, created_at, updated_at) values ('pc_pending', $1, $2, 'UC_Y', 'FAKE', 'lj-pending', 'PENDING', '소', 1, $3, $3)`,
      [seller.sellerId, D, new Date(clock.now()).toISOString()],
    )
    const pending = await writeEvent(world, seller, { type: 'buyer.unmerge', from: 'UC_X', reason: '다른 사람' }, D)
    expect(pending.status, pending.text).toBe(409)
    expect(await unmergeCount(world)).toBe(before)
    // 시도가 끝나(FAILED) 살아 있는 시도가 없으면 지금 규칙대로 떼어 낼 수 있다
    await world.database.pglite?.query(`update parcels set state = 'FAILED', reason = 'REJECTED' where id = 'pc_pending'`)
    const freed = await writeEvent(world, seller, { type: 'buyer.unmerge', from: 'UC_X', reason: '다른 사람' }, D)
    expect(freed.status, freed.text).toBe(200)
  })
})

describe('AC-T1-06 백업·전체 기록·복구', () => {
  it('판매자 백업·전체 기록에 배송지 원문·암호문이 없고 판매대장 배송 칸은 지금 규칙대로, 복구는 같은 트랜잭션에 배송지를 모두 지운다(실패하면 그대로)', async () => {
    const storage = new FolderBackupStorage(mkdtempSync(join(tmpdir(), 'livejjim-t1-backup-')))
    const world = await parcelWorld({ overrides: { backupStorage: storage } })
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    for (const buyer of ['UC_A', 'UC_B']) await makeReady(world, seller, buyer)
    await expect200(parcelApi(world, seller.cookie).putAddress('UC_C', ADDRESS))
    await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }])
    await expect200(parcelApi(world, seller.cookie).cancel('UC_B'))
    const sealedValues = ((await world.database.pglite?.query<{ sealed: string }>('select sealed from parcel_addresses'))?.rows ?? []).map((row) => row.sealed)
    expect(sealedValues).toHaveLength(3)
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const text = gunzipSync(bytes).toString('utf8')
    for (const value of ['홍길동', '01012345678', '세종대로', '101동', '문 앞에', '04524', ...sealedValues.map((value) => value.split('.')[2] as string)]) expect(text, value).not.toContain(value)
    // 접수 기록은 (날짜, 구매자, 택배사, 송장번호, 상태, 시각)만 — 접수한 것·취소한 것 모두 (SA-T1-01, D-T1-07)
    const file = JSON.parse(text) as BackupFile
    const invoiceA = (await attempts(world, seller.sellerId, 'UC_A'))[0]?.invoice as string
    const invoiceB = (await attempts(world, seller.sellerId, 'UC_B'))[0]?.invoice as string
    expect(file.parcels?.map((record) => Object.keys(record))).toEqual([
      ['date', 'buyer', 'carrier', 'invoice', 'state', 'at'],
      ['date', 'buyer', 'carrier', 'invoice', 'state', 'at'],
    ])
    expect(file.parcels).toEqual([
      { date: D, buyer: 'UC_A', carrier: 'FAKE', invoice: invoiceA, state: 'BOOKED', at: expect.stringMatching(/Z$/) },
      { date: D, buyer: 'UC_B', carrier: 'FAKE', invoice: invoiceB, state: 'CANCELLED', at: expect.stringMatching(/Z$/) },
    ])
    expect(invoiceA).toMatch(/^\d{8,20}$/)
    expect(file.digest).toBe(backupDigest(file))
    expect((await checkBackupBytes(bytes)).ok).toBe(true)
    // 접수 기록 칸이 없는 옛 파일(T1 전)도 같은 형식 번호로 읽는다
    const { parcels: _dropped, ...old } = file
    const oldBytes = new Uint8Array(gzipSync(JSON.stringify({ ...old, digest: backupDigest(old) })))
    expect((await checkBackupBytes(oldBytes)).ok).toBe(true)
    // 접수 기록에 다른 칸(배송지 따위)이 섞이면 거절
    const tampered = { ...file, parcels: [{ ...(file.parcels?.[0] as object), address: '세종대로' }, ...(file.parcels ?? []).slice(1)] }
    const tamperedCheck = await checkBackupBytes(new Uint8Array(gzipSync(JSON.stringify({ ...tampered, digest: backupDigest(tampered) }))))
    expect(tamperedCheck).toEqual({ ok: false, reason: '택배 접수 기록 1번의 형식이 올바르지 않아요.' })
    // 칸을 고치면 요약값이 어긋난다
    const edited = { ...file, parcels: [{ ...(file.parcels?.[0] as object), state: 'FAILED' }, ...(file.parcels ?? []).slice(1)] }
    expect((await checkBackupBytes(new Uint8Array(gzipSync(JSON.stringify(edited))))).ok).toBe(false)
    const exported = await client(world, seller.cookie).raw('/api/export/records.json.gz', {})
    expect(exported.status).toBe(200)
    expect(gunzipSync(new Uint8Array(await exported.arrayBuffer())).toString('utf8')).not.toContain('세종대로')
    // 판매대장 배송 칸 (지금 규칙: 배송 완료 · 송장 …)
    const invoice = (await attempts(world, seller.sellerId, 'UC_A'))[0]?.invoice as string
    const ledger = await client(world, seller.cookie).raw(`/api/ledger.xlsx?from=${D}&to=${D}`, {})
    expect(ledger.status).toBe(200)
    const xlsx = await import('exceljs')
    const book = new xlsx.default.Workbook()
    await book.xlsx.load(Buffer.from(await ledger.arrayBuffer()) as unknown as ArrayBuffer)
    const cells: string[] = []
    book.worksheets[0]?.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value))))
    expect(cells).toContain(`배송 완료 · 송장 ${invoice}`)
    expect(cells.join('\n')).not.toContain('세종대로')

    // 복구가 실패하면 배송지는 그대로
    const failed = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage, clock: world.clock, ids: randomIds, beforeCommit: () => { throw new Error('주입한 실패') } })
    expect(failed.ok).toBe(false)
    expect((await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from parcel_addresses'))?.rows[0]?.n).toBe(3)
    // 복구하면 그 판매자의 배송지를 모두 지운다 (접수 시도는 그대로)
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage, clock: world.clock, ids: randomIds })
    expect(restored.ok).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    expect((await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from parcel_addresses'))?.rows[0]?.n).toBe(0)
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.state)).toEqual(['BOOKED'])
    expect((await rowOf(world, seller, 'UC_A')).reason).toBe('BOOKED')
  })
})

describe('AC-T1-23 설정 "택배"', () => {
  it('택배사·고객 번호(응답엔 끝 4자리, 암호화)·보내는 사람(이름 기본값 = 가게 이름, 암호화)·기본 상자 크기(기본 소)', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    const api = parcelApi(world, seller.cookie)
    const initial = await expect200(api.settings())
    expect(initial.body.settings).toMatchObject({
      carrier: null,
      customerNoLast4: null,
      sender: null,
      shopName: `가게 ${seller.loginId}`,
      box: '소',
      boxes: ['극소', '소', '중', '대'],
      carriers: [
        { code: 'FAKE', name: '가짜 택배(시험용)', available: true, note: null },
        { code: 'EPOST', name: '우체국 택배', available: false, note: '준비 중' },
      ],
    })
    const saved = await expect200(api.putSettings({ carrier: 'FAKE', customerNo: 'CUST-998877', sender: SENDER, box: '중' }))
    expect(saved.body.settings).toMatchObject({ carrier: 'FAKE', customerNoLast4: '8877', sender: { ...SENDER, phone: '0311234567' }, box: '중' })
    const dump = await dumpAllTables(world.database)
    for (const value of ['CUST-998877', '998877', '다육이네', '효원로', '0311234567']) expect(dump, value).not.toContain(value)
    // 고객 번호를 적지 않으면 그대로, 빈 글이면 지운다
    expect((await expect200(api.putSettings({ box: '대' }))).body.settings).toMatchObject({ customerNoLast4: '8877', box: '대' })
    expect((await expect200(api.putSettings({ customerNo: '' }))).body.settings).toMatchObject({ customerNoLast4: null })
    expect((await api.putSettings({ customerNo: 'x'.repeat(31) })).status).toBe(400)
    expect((await api.putSettings({ box: '특대' })).status).toBe(400)
    expect((await api.putSettings({ sender: { ...SENDER, memo: '안 받음' } })).status).toBe(400)
    expect((await api.putSettings({ other: 1 })).status).toBe(400)
  })

  it('보내는 사람 없음·택배사 없음은 줄마다의 이유가 아니라 목록 위 한 문장', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, {})
    await sell(world, seller, [['UC_A', '가람', 1]])
    await pay(world, seller, 'UC_A')
    await packAll(world, seller, 'UC_A')
    await expect200(parcelApi(world, seller.cookie).putAddress('UC_A', ADDRESS))
    const rows = await dayRows(world, seller)
    expect(rows.blocked).toEqual({ code: 'NO_CARRIER', message: '택배사를 먼저 이어 주세요.' })
    expect(rows.ready.map((row) => row.buyer)).toEqual(['UC_A'])
  })
})
