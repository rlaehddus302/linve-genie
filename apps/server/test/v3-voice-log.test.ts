// AC-V3-70 서버 몫 (DOMAIN_RULES R-25, D-V3-64·D-V3-65): 음성 등록·고침 기록.
// 음성 바로 등록·바로 고침·번호 옮기기·되돌리기마다 서버 기록 한 줄이 상품 명령보다 먼저(같은 트랜잭션) 남고,
// 명령이 실패하면 줄에 실패 표시. 크게 바뀜 판단(정수 비교), 들은 말 가리기·300글자, 조회 API(방송·날짜·상품, 판매자 자기 것만, 보조자 403),
// 백업·복구 뒤에도 같음, 판매대장 "음성 기록" 시트 데이터, 로그에 들은 말 없음.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { getProduct } from '@livejjim/core'
import ExcelJS from 'exceljs'
import { afterAll, describe, expect, it } from 'vitest'
import { backupDigest, checkBackupBytes, createBackupBytes, FolderBackupStorage, restoreSeller } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { formatLog } from '../src/log.ts'
import { bigPriceChange, bigRegister, cleanHeard, maskHeard } from '../src/voice-log.ts'
import { getFile } from './i2-support.ts'
import { addSeller, client, createBroadcast, expectOk, login, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

interface Entry {
  readonly id: number
  readonly at: string
  readonly date: string
  readonly rehearsal: boolean
  readonly b: string
  readonly product: string | null
  readonly no: number
  readonly toNo: number | null
  readonly kind: string
  readonly before: Record<string, unknown> | null
  readonly after: Record<string, unknown> | null
  readonly source: string
  readonly by: Record<string, unknown>
  readonly device: string | null
  readonly claims: number
  readonly heard: string
  readonly big: boolean
  readonly withClaims: boolean
  readonly undone: boolean
  readonly undoOf: string | null
  readonly failed: boolean
}

async function entries(world: TestServer, seller: Seller, query: string): Promise<Entry[]> {
  const response = await expectOk(client(world, seller.cookie).get(`/api/voice/log?${query}`))
  return response.body.entries as Entry[]
}

/** 음성 쓰기 (요청 번호를 돌려준다) */
async function voiceWrite(world: TestServer, seller: Seller, event: Record<string, unknown>, heard: string, extra: Record<string, unknown> = {}) {
  const requestId = rid('vo')
  const response = await client(world, seller.cookie).post('/api/events', { requestId, ...event, voiceLog: { heard, ...extra } })
  return { requestId, response }
}

const pg = (world: TestServer) => {
  const db = world.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

async function eventCount(world: TestServer, type: string): Promise<number> {
  return (await pg(world).query<{ n: number }>(`select count(*)::int as n from events where type = $1`, [type])).rows[0]?.n ?? 0
}

describe('AC-V3-70 크게 바뀜 판단 (정수 비교)', () => {
  it('등록: 3,000,001원 → 표시, 3,000,000원 → 아님', () => {
    expect(bigRegister(3_000_001)).toBe(true)
    expect(bigRegister(3_000_000)).toBe(false)
  })
  it('고침 100,000원에서: 300,001 → 표시 · 300,000 → 아님 · 33,333 → 표시 · 34,000 → 아님 · 3,000,001(전 1,500,000) → 표시', () => {
    expect(bigPriceChange(100_000, 300_001)).toBe(true)
    expect(bigPriceChange(100_000, 300_000)).toBe(false)
    expect(bigPriceChange(100_000, 33_333)).toBe(true)
    expect(bigPriceChange(100_000, 34_000)).toBe(false)
    expect(bigPriceChange(1_500_000, 3_000_001)).toBe(true)
    expect(bigPriceChange(1_500_000, 3_000_000)).toBe(false)
  })
  it('들은 말 가리기: 끝자리 뒤 4숫자·8자리 이상 숫자 → ****, 제어 문자 빼기·줄바꿈 → 공백, 300글자까지', () => {
    expect(maskHeard('62번 끝자리 1234 김민지님')).toBe('62번 끝자리 **** 김민지님')
    expect(maskHeard('끝자리는 5678요')).toBe('끝자리는 ****요')
    expect(maskHeard('010-1234-5678 연락')).toBe('**** 연락')
    expect(maskHeard('끝자리 ****')).toBe('끝자리 ****')
    expect(cleanHeard('자 62번\n2만 원\u0000\u0007 ‮')).toBe('자 62번 2만 원 ‮')
    expect([...cleanHeard('가'.repeat(400))]).toHaveLength(300)
    expect(cleanHeard('\ud800끝')).toBe('�끝')
  })
})

describe('AC-V3-70 음성 쓰기 → 기록 한 줄 (상품 명령보다 먼저, 같은 트랜잭션)', () => {
  it('등록 3,000,001원은 크게 바뀜, 3,000,000원은 아님 — 줄 칸(시각·방송·번호·한 일·전·후·출처·누가·찜 수·들은 말·표시)과 생긴 상품 ID', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const first = await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 11, name: '청개구리', price: 3_000_001 }, '자 11번 청개구리 삼백만 일 원', { device: 'tab-1' })
    expect(first.response.status, first.response.text).toBe(200)
    expect((await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 12, name: '', price: 3_000_000 }, '12번 삼백만 원')).response.status).toBe(200)
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list).toHaveLength(2)
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(list[0]).toMatchObject({
      date: b.date,
      rehearsal: false,
      b: b.id,
      product: getProduct(state, b.id, 11)?.id,
      no: 11,
      toNo: null,
      kind: 'REGISTER',
      before: null,
      after: { name: '청개구리', price: 3_000_001 },
      source: 'voice',
      by: { kind: 'account', accountId: seller.accountId },
      device: 'tab-1',
      claims: 0,
      heard: '자 11번 청개구리 삼백만 일 원',
      big: true,
      withClaims: false,
      undone: false,
      failed: false,
    })
    expect(list[1]).toMatchObject({ no: 12, kind: 'REGISTER', big: false, device: null })
    // 줄의 시각 ≤ 상품 이벤트를 받은 시각 (줄을 먼저 넣는다)
    const received = (await pg(world).query<{ at: Date }>(`select received_at as at from events where type = 'product.register' order by seq limit 1`)).rows[0]?.at
    expect(Date.parse(list[0]?.at ?? '')).toBeLessThanOrEqual(received?.getTime() ?? 0)
  })

  it('고침 100,000원 → 300,001 표시 · 300,000 아님 · 33,333 표시 · 34,000 아님, 찜이 있으면 "찜 있을 때 고침"·찜 수', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (const no of [1, 2, 3, 4, 5]) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: '', price: 100_000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 5, received: '12:00', phone: '010-5555-6666', memo: '이모' }))
    const targets: [number, number][] = [
      [1, 300_001],
      [2, 300_000],
      [3, 33_333],
      [4, 34_000],
      [5, 40_000],
    ]
    for (const [no, price] of targets) {
      const { response } = await voiceWrite(world, seller, { type: 'product.update', b: b.id, no, price, applyTo: 'NEW_ONLY' }, `${String(no)}번 고침`)
      expect(response.status, response.text).toBe(200)
    }
    const list = await entries(world, seller, `date=${b.date}`)
    expect(list.map((entry) => [entry.no, entry.kind, entry.before, entry.after, entry.big, entry.withClaims, entry.claims])).toEqual([
      [1, 'PRICE', { price: 100_000 }, { price: 300_001 }, true, false, 0],
      [2, 'PRICE', { price: 100_000 }, { price: 300_000 }, false, false, 0],
      [3, 'PRICE', { price: 100_000 }, { price: 33_333 }, true, false, 0],
      [4, 'PRICE', { price: 100_000 }, { price: 34_000 }, false, false, 0],
      [5, 'PRICE', { price: 100_000 }, { price: 40_000 }, false, true, 1],
    ])
    // 손 고치기(기록 칸 없음)는 줄을 남기지 않는다
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 1, price: 50_000 }))
    expect(await entries(world, seller, `date=${b.date}`)).toHaveLength(5)
  })

  it('가격·품종을 함께 고치면 두 줄(PRICE·NAME), 바뀌지 않은 칸은 줄을 만들지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 7, name: '녹금', price: 30_000 }))
    await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 7, name: '청개구리', price: 30_000 }, '7번 청개구리')
    await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 7, name: '청개구리', price: 40_000 }, '7번 4만 원')
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list.map((entry) => [entry.kind, entry.before, entry.after])).toEqual([
      ['NAME', { name: '녹금' }, { name: '청개구리' }],
      ['PRICE', { price: 30_000 }, { price: 40_000 }],
    ])
  })

  it('같은 요청 번호를 다시 보내도 줄은 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const body = { requestId: rid('vo'), type: 'product.register', b: b.id, no: 3, name: '', price: 10_000, voiceLog: { heard: '3번 만 원' } }
    await expectOk(client(world, seller.cookie).post('/api/events', body))
    await expectOk(client(world, seller.cookie).post('/api/events', body))
    expect(await entries(world, seller, `b=${b.id}`)).toHaveLength(1)
  })

  it('번호 옮기기 65 → 61 (전·후 번호), 되돌리기(61 → 65, undo)는 옮긴 줄에 "되돌림"을 달고 되돌리기 줄도 남긴다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 65, name: '', price: 30_000 }))
    const moved = await voiceWrite(world, seller, { type: 'product.renumber', b: b.id, from: 65, to: 61 }, '아까 65번은 61번이에요')
    expect(moved.response.status, moved.response.text).toBe(200)
    const back = await voiceWrite(world, seller, { type: 'product.renumber', b: b.id, from: 61, to: 65 }, '', { undo: moved.requestId })
    expect(back.response.status, back.response.text).toBe(200)
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list.map((entry) => [entry.kind, entry.no, entry.toNo, entry.undone, entry.undoOf])).toEqual([
      ['RENUMBER', 65, 61, true, null],
      ['UNDO', 61, 65, false, moved.requestId],
    ])
    // 상품으로 거르기: 번호가 바뀌어도 같은 상품 ID · 번호로는 전·후 어느 쪽이든
    const product = list[0]?.product
    expect(typeof product).toBe('string')
    expect(await entries(world, seller, `b=${b.id}&product=${String(product)}`)).toHaveLength(2)
    expect(await entries(world, seller, `b=${b.id}&no=61`)).toHaveLength(2)
    expect(await entries(world, seller, `b=${b.id}&no=62`)).toHaveLength(0)
  })

  it('등록 되돌리기 = 판매 종료(undo) → 등록 줄 "되돌림" · 가격 고침 되돌리기(product.update, undo)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const registered = await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 20, name: '', price: 20_000 }, '20번 2만 원')
    const fixed = await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 20, price: 25_000 }, '20번 2만 5천 원')
    await expectOk(Promise.resolve((await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 20, price: 20_000 }, '', { undo: fixed.requestId })).response))
    await expectOk(Promise.resolve((await voiceWrite(world, seller, { type: 'product.close', b: b.id, no: 20 }, '', { undo: registered.requestId })).response))
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list.map((entry) => [entry.kind, entry.undone, entry.before, entry.after, entry.undoOf])).toEqual([
      ['REGISTER', true, null, { name: '', price: 20_000 }, null],
      ['PRICE', true, { price: 20_000 }, { price: 25_000 }, null],
      ['UNDO', false, { price: 25_000 }, { price: 20_000 }, fixed.requestId],
      ['UNDO', false, { name: '', price: 20_000 }, null, registered.requestId],
    ])
  })

  it('판매 종료에 되돌리기가 아닌 기록 칸·등록에 undo·모르는 칸·301글자·출처 seller-note는 400이고 아무것도 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '', price: 10_000 }))
    const before = await eventCount(world, 'product.close')
    const bad: [Record<string, unknown>, unknown][] = [
      [{ type: 'product.close', b: b.id, no: 1 }, { heard: '1번 끝' }],
      [{ type: 'product.register', b: b.id, no: 2, name: '', price: 1000 }, { heard: '', undo: 'x-1' }],
      [{ type: 'product.update', b: b.id, no: 1, price: 2000 }, { heard: '', extra: 1 }],
      [{ type: 'product.update', b: b.id, no: 1, price: 2000 }, { heard: '가'.repeat(301) }],
      [{ type: 'product.update', b: b.id, no: 1, price: 2000 }, { heard: '', source: 'seller-note' }],
      [{ type: 'product.update', b: b.id, no: 1, price: 2000 }, { heard: 5 }],
      [{ type: 'product.update', b: b.id, no: 1, price: 2000 }, '1번'],
    ]
    for (const [event, voiceLog] of bad) {
      const response = await client(world, seller.cookie).post('/api/events', { requestId: rid('vo'), ...event, voiceLog })
      expect(response.status, response.text).toBe(400)
    }
    // 300글자는 받는다
    expect((await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 1, price: 2000 }, '가'.repeat(300))).response.status).toBe(200)
    expect(await eventCount(world, 'product.close')).toBe(before)
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list).toHaveLength(1)
    expect([...(list[0]?.heard ?? '')]).toHaveLength(300)
    // 다른 종류(방송자 조치)에는 기록 칸이 없다
    expect((await client(world, seller.cookie).post('/api/events', { requestId: rid('vo'), type: 'product.open', b: b.id, no: 1, voiceLog: { heard: '' } })).status).toBe(400)
  })

  it('명령이 반영되지 않으면(없는 번호 고치기 — 엔진이 바꾼 것 없음) 실패 줄, 저장 실패면 실패 줄 — 상품은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const missing = await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 99, price: 5000 }, '99번 5천 원')
    expect(missing.response.body.changed).toBe(false)
    // 코어가 거절하는 값(음수 가격 — 400, 기록 안 됨)도 실패 줄
    const invalid = await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 99, price: -1 }, '99번')
    expect(invalid.response.status).toBe(400)
    let list = await entries(world, seller, `b=${b.id}`)
    expect(list).toMatchObject([
      { kind: 'PRICE', no: 99, before: null, after: { price: 5000 }, failed: true },
      { kind: 'PRICE', no: 99, after: { price: -1 }, failed: true },
    ])
    // 저장 실패 (커밋 직전에 던짐) → 상품 이벤트는 없고 실패 줄
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '', price: 10_000 }))
    const failing = await newWorldWithFailingCommit()
    const s2 = await addSeller(failing.world)
    const b2 = await createBroadcast(failing.world, s2)
    failing.fail(true)
    const saved = await voiceWrite(failing.world, s2, { type: 'product.register', b: b2.id, no: 8, name: '', price: 8000 }, '8번 8천 원')
    expect(saved.response.status).toBe(500)
    failing.fail(false)
    expect(await eventCount(failing.world, 'product.register')).toBe(0)
    expect(await entries(failing.world, s2, `b=${b2.id}`)).toMatchObject([{ kind: 'REGISTER', no: 8, failed: true }])
    // 같은 요청을 다시 보내 성공하면 실패 표시가 풀린다
    const retried = await client(failing.world, s2.cookie).post('/api/events', { requestId: saved.requestId, type: 'product.register', b: b2.id, no: 8, name: '', price: 8000, voiceLog: { heard: '8번 8천 원' } })
    expect(retried.status, retried.text).toBe(200)
    expect(await entries(failing.world, s2, `b=${b2.id}`)).toMatchObject([{ kind: 'REGISTER', no: 8, failed: false }])
    list = await entries(world, seller, `b=${b.id}`)
    expect(list).toHaveLength(2)
  })

  it('들은 말은 가려서 저장하고 로그에 원문이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 62, name: '', price: 20_000 }, '자 62번 2만 원 끝자리 1234 용용님\n010 1234 5678')
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list[0]?.heard).toBe('자 62번 2만 원 끝자리 **** 용용님 ****')
    const logs = world.logs.map((record) => formatLog(record)).join('\n')
    expect(logs).not.toContain('용용')
    expect(logs).not.toContain('1234')
  })
})

describe('RA-V3-001·003 찜이 있는 상품의 음성 번호 옮기기·되돌리기', () => {
  it('옮길 상품(65번)에 살아 있는 찜이 있으면 409 VOICE_RENUMBER_CLAIMED, 번호 바꾸기 없음, 실패 줄(찜 수·찜 있을 때 고침) — 되돌리기도 같음, 손 번호 바꾸기는 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 65, name: '', price: 30_000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 65, received: '12:00', phone: '010-5555-6666', memo: '이모' }))
    const moved = await voiceWrite(world, seller, { type: 'product.renumber', b: b.id, from: 65, to: 61 }, '아까 65번은 61번이에요')
    expect(moved.response.status).toBe(409)
    expect(moved.response.body.error).toEqual({ code: 'VOICE_RENUMBER_CLAIMED', message: '찜이 있는 상품이라 번호를 옮기지 않았어요.' })
    const undo = await voiceWrite(world, seller, { type: 'product.renumber', b: b.id, from: 65, to: 64 }, '', { undo: 'vo-old' })
    expect(undo.response.status).toBe(409)
    expect(await eventCount(world, 'product.renumber')).toBe(0)
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 65)).not.toBeNull()
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list.map((entry) => [entry.kind, entry.no, entry.toNo, entry.claims, entry.withClaims, entry.failed])).toEqual([
      ['RENUMBER', 65, 61, 1, true, true],
      ['UNDO', 65, 64, 1, true, true],
    ])
    // 손 번호 바꾸기(기록 칸 없음)는 지금처럼 R-10 그대로
    await expectOk(writeEvent(world, seller, { type: 'product.renumber', b: b.id, from: 65, to: 61 }))
    expect(await eventCount(world, 'product.renumber')).toBe(1)
  })

  it('찜이 있는 상품의 가격 고침을 되돌리면 UNDO 줄에도 찜 수·찜 있을 때 고침 표시 (정산 띠에 나옴)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 20, name: '', price: 20_000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 20, received: '12:00', phone: '010-5555-6666', memo: '이모' }))
    const fixed = await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 20, price: 25_000, applyTo: 'NEW_ONLY' }, '20번 2만 5천 원')
    expect(fixed.response.status).toBe(200)
    expect((await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 20, price: 20_000, applyTo: 'NEW_ONLY' }, '', { undo: fixed.requestId })).response.status).toBe(200)
    const list = await entries(world, seller, `b=${b.id}`)
    expect(list.map((entry) => [entry.kind, entry.claims, entry.withClaims, entry.undone])).toEqual([
      ['PRICE', 1, true, true],
      ['UNDO', 1, true, false],
    ])
  })
})

describe('D-V3-75·77 한글 수 전화번호 가리기 · 봉인 때 들은 말 지우기', () => {
  it('서버가 받은 "공일공 일이삼사 오육칠팔"·"끝번호 일이삼사"·"010-1234-5678"을 저장 전 ****로', async () => {
    expect(maskHeard('공일공 일이삼사 오육칠팔 연락')).toBe('**** 연락')
    expect(maskHeard('끝번호 일이삼사 김민지님')).toBe('끝번호 **** 김민지님')
    expect(maskHeard('뒷 번호 칠칠칠칠이요')).toBe('뒷 번호 ****이요')
    expect(maskHeard('끝 자리는 공 공 일 이')).toBe('끝 자리는 ****')
    expect(maskHeard('끝번호 5678')).toBe('끝번호 ****')
    // 값 말은 그대로
    expect(maskHeard('오십 삼번 이만 오천 원')).toBe('오십 삼번 이만 오천 원')
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 9, name: '', price: 9000 }, '9번 9천 원 공일공 일이삼사 오육칠팔 끝번호 일이삼사 010-1234-5678')
    expect((await entries(world, seller, `b=${b.id}`))[0]?.heard).toBe('9번 9천 원 **** 끝번호 **** ****')
  })

  it('방송 날짜 + 30일 봉인 뒤 그 날짜 줄들의 heard는 빈 글, 나머지 칸·다른 날짜·리허설은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const other = await createBroadcast(world, seller, { date: '2026-10-20' })
    const rehearsal = await createBroadcast(world, seller, { rehearsal: true })
    await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 1, name: '녹금', price: 3_500_000 }, '1번 녹금 용용님')
    await voiceWrite(world, seller, { type: 'product.register', b: other.id, no: 2, name: '', price: 2000 }, '2번')
    await voiceWrite(world, seller, { type: 'product.register', b: rehearsal.id, no: 3, name: '', price: 3000 }, '3번')
    const before = await entries(world, seller, `b=${b.id}`)
    const scopeId = await world.server.service.scopeId(seller.sellerId, b.date)
    expect(await world.server.sealer.seal(seller.sellerId, scopeId as string, b.date)).toBe(true)
    const after = await entries(world, seller, `b=${b.id}`)
    expect(after).toEqual(before.map((entry) => ({ ...entry, heard: '' })))
    expect(after[0]?.big).toBe(true)
    expect((await entries(world, seller, `b=${other.id}`))[0]?.heard).toBe('2번')
    expect((await entries(world, seller, `b=${rehearsal.id}`))[0]?.heard).toBe('3번')
  })
})

describe('AC-V3-70 조회 API', () => {
  it('방송·날짜로 거르고, 시각순, 판매자 자기 것만 — 다른 판매자·로그인 없음·보조자는 못 본다, 거르기 없으면 400', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const rehearsal = await createBroadcast(world, seller, { rehearsal: true })
    await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 1, name: '', price: 1000 }, '1번')
    world.clock.advance(1000)
    await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 2, name: '', price: 2000 }, '2번')
    await voiceWrite(world, seller, { type: 'product.register', b: rehearsal.id, no: 3, name: '', price: 3000 }, '3번')
    const ob = await createBroadcast(world, other)
    await voiceWrite(world, other, { type: 'product.register', b: ob.id, no: 9, name: '', price: 9000 }, '9번')

    expect((await entries(world, seller, `date=${b.date}`)).map((entry) => entry.no)).toEqual([1, 2])
    expect((await entries(world, seller, `date=${b.date}&rehearsal=true`)).map((entry) => entry.no)).toEqual([3])
    expect((await entries(world, seller, `b=${rehearsal.id}`)).map((entry) => entry.no)).toEqual([3])
    expect((await entries(world, seller, `date=2026-10-18`)).map((entry) => entry.no)).toEqual([])
    const times = (await entries(world, seller, `b=${b.id}`)).map((entry) => Date.parse(entry.at))
    expect(times[1]! - times[0]!).toBe(1000)
    // 다른 판매자의 방송 ID로 물어도 빈 목록
    expect(await entries(world, other, `b=${b.id}`)).toEqual([])
    expect((await entries(world, other, `date=${b.date}`)).map((entry) => entry.no)).toEqual([9])
    expect((await client(world, null).get(`/api/voice/log?b=${b.id}`)).status).toBe(401)
    expect((await client(world, seller.cookie).get('/api/voice/log')).status).toBe(400)
    expect((await client(world, seller.cookie).get('/api/voice/log?date=2026-13-01')).status).toBe(400)
    expect((await client(world, seller.cookie).get(`/api/voice/log?b=${b.id}&no=0`)).status).toBe(400)
    // 보조자는 403
    const made = await expectOk(client(world, seller.cookie).post('/api/assistants', { name: '도우미' }))
    const assistant = made.body.assistant as { loginId: string }
    const cookie = await login(world, assistant.loginId, made.body.password as string)
    const forbidden = await client(world, cookie).get(`/api/voice/log?b=${b.id}`)
    expect(forbidden.status).toBe(403)
  })
})

describe('AC-V3-70 백업·복구·판매대장', () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('백업 파일에 들어가고 복구 뒤에도 같다 (되돌림·실패 표시 포함), 고친 파일은 검사에서 거절', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const registered = await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 5, name: '녹금', price: 3_500_000 }, '5번 녹금 삼백오십만 원')
    await voiceWrite(world, seller, { type: 'product.close', b: b.id, no: 5 }, '', { undo: registered.requestId })
    await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 77, price: 1000 }, '77번')
    const before = await entries(world, seller, `b=${b.id}`)
    expect(before.map((entry) => [entry.kind, entry.big, entry.undone, entry.failed])).toEqual([
      ['REGISTER', true, true, false],
      ['UNDO', false, false, false],
      ['PRICE', false, false, true],
    ])
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const checked = await checkBackupBytes(bytes)
    expect(checked.ok).toBe(true)
    // 파일의 음성 기록 칸: 줄 3개, 같은 내용. 고친 줄(모르는 칸·301글자·모르는 한 일·겹친 줄)은 요약값을 다시 맞춰도 거절
    const file = JSON.parse(gunzipSync(bytes).toString('utf8')) as Record<string, unknown> & { voiceLog: Record<string, unknown>[] }
    expect(file.voiceLog.map((row) => row.kind)).toEqual(['REGISTER', 'UNDO', 'PRICE'])
    const forged = async (change: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => {
      const copy: Record<string, unknown> = { ...file, voiceLog: change(file.voiceLog.map((row) => ({ ...row }))) }
      copy.digest = backupDigest(copy as unknown as Parameters<typeof backupDigest>[0])
      return checkBackupBytes(gzipSync(Buffer.from(JSON.stringify(copy), 'utf8')))
    }
    expect((await forged((rows) => rows)).ok).toBe(true)
    expect((await forged((rows) => rows.map((row) => ({ ...row, phone: '01012345678' })))).ok).toBe(false)
    expect((await forged((rows) => rows.map((row) => ({ ...row, heard: '가'.repeat(301) })))).ok).toBe(false)
    expect((await forged((rows) => rows.map((row) => ({ ...row, kind: 'DELETE' })))).ok).toBe(false)
    expect((await forged((rows) => [...rows, rows[0] as Record<string, unknown>])).ok).toBe(false)
    expect((await forged((rows) => rows.map((row) => ({ ...row, before: '{"__proto__":{"x":1}}' })))).ok).toBe(false)
    const dir = mkdtempSync(join(tmpdir(), 'v3-voice-log-'))
    dirs.push(dir)
    await pg(world).query(`delete from voice_log`)
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage: new FolderBackupStorage(dir), clock: world.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    const after = await entries(world, seller, `b=${b.id}`)
    const strip = (list: Entry[]) => list.map(({ id: _id, ...rest }) => rest)
    expect(strip(after)).toEqual(strip(before))
    // 복구한 상태의 상품 ID와 줄의 상품 ID가 같다
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(after[0]?.product).toBe(getProduct(state, b.id, 5)?.id)
  })

  it('판매대장 .xlsx에 "음성 기록" 시트 — 시각순 줄, 실패 줄은 빼고, 기존 시트는 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await voiceWrite(world, seller, { type: 'product.register', b: b.id, no: 62, name: '청개구리', price: 100_000 }, '자 62번 청개구리 10만 원')
    await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 62, price: 20_000 }, '자 62번 2만 원')
    await voiceWrite(world, seller, { type: 'product.update', b: b.id, no: 63, price: 1000 }, '63번')
    const file = await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${b.date}&to=${b.date}`)
    expect(file.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(file.bytes) as unknown as ArrayBuffer)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['판매대장', '음성 기록'])
    const sheet = workbook.getWorksheet('음성 기록')
    const rows: unknown[][] = []
    sheet?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
    expect(rows).toHaveLength(3)
    expect(rows[1]?.slice(1, 8)).toEqual([62, '등록', undefined, '청개구리 100,000원', '음성', 0, '자 62번 청개구리 10만 원'])
    expect(rows[2]?.slice(1, 9)).toEqual([62, '가격 고침', 100_000, 20_000, '음성', 0, '자 62번 2만 원', '크게 바뀜'])
  })
})

/** 커밋 직전에 던지게 할 수 있는 세상 (저장 실패 주입) */
async function newWorldWithFailingCommit(): Promise<{ world: TestServer; fail: (on: boolean) => void }> {
  let failing = false
  const world = await newWorld({
    hooks: {
      beforeCommit: () => {
        if (failing) throw new Error('저장 실패 주입')
      },
    },
  })
  return { world, fail: (on) => (failing = on) }
}
