// PL1A 서버 시험 도우미: 30일 봉인 날짜 A(유튜브 채팅·옵션 없는 방송·옵션 방송·수량 2 이상·문자찜·입금·환불·배송비 조정·포장·배송)와
// 봉인 전 날짜 B(A의 구매자 X가 또 산다)·리허설 범위 하나. 가짜 시계로 A + 30일 0시(KST)를 지나 봉인 작업(Sealer)을 실제로 돌린다.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import { FolderBackupStorage } from '../src/backup.ts'
import { at, chat, kst, ok, pack, putShop, sellG201 } from './i2-support.ts'
import { addSeller, client, createBroadcast, fakeClock, newWorld, rid, type Seller, type TestServer } from './support.ts'

/** 봉인할 날짜 A (A + 30일 0시 KST = 2026-10-01T00:00+09:00) */
export const A = '2026-09-01'
/** 봉인 전 날짜 B */
export const B = '2026-09-20'
/** A의 봉인 시각이 지난 때 (B는 아직 봉인 전 — B + 30일 = 2026-10-20) */
export const AFTER_SEAL = kst('2026-10-01', '00:00:01')

/** X = A·B 모두 사는 유튜브 구매자, Y = A의 옵션 방송 구매자(포장 대기), 문자 = A의 문자찜 구매자 */
export const X = 'UC_A'
export const Y = 'UC_OPT'
/** 산 적 없는 시청자의 채팅 (봉인 뒤 어디에도 없어야 한다) */
export const LOOKER_NICK = '구경만한사람'
export const LOOKER_TEXT = '비밀스러운 수다 본문'

export const tempDirs: string[] = []
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-pl1a-test-'))
  tempDirs.push(dir)
  return dir
}

/** 기록 경로(ScopeWriter)로 옵션 칸이 있는 이벤트를 바로 쓴다 (o3-options 시험과 같은 방식 — API의 옵션 상품 등록 칸이 없다) */
export async function raw(world: TestServer, seller: Seller, date: string, fields: Record<string, unknown>): Promise<void> {
  const outcome = await world.server.writer.write({ sellerId: seller.sellerId, date, rehearsal: false, createScope: false, requestId: null, build: () => [{ fields, actor: { kind: 'account', accountId: seller.accountId } }] })
  expect(outcome.kind, JSON.stringify(outcome)).toBe('ok')
  await world.server.print.settled()
}

export async function optionsBroadcast(world: TestServer, seller: Seller, date: string, title: string): Promise<string> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date, title, saleMode: 'OPTIONS' })
  expect(response.status, response.text).toBe(200)
  return (response.body.broadcast as { id: string }).id
}

/** 포장 목록의 그 구매자 품목을 그대로 담아 포장 완료 */
export async function packAll(world: TestServer, seller: Seller, date: string, buyer: string): Promise<void> {
  const list = await client(world, seller.cookie).get(`/api/days/${date}/packing`)
  const entry = (list.body.entries as { buyer: string; items: { key: string; qty: number }[] }[]).find((item) => item.buyer === buyer)
  expect(entry, buyer).toBeDefined()
  const response = await pack(world, seller, date, { buyer, action: 'pack', items: (entry?.items ?? []).map((item) => ({ key: item.key, qty: item.qty })) })
  expect(response.status, response.text).toBe(200)
}

export interface Scenario {
  readonly world: TestServer
  readonly seller: Seller
  readonly storage: FolderBackupStorage
  readonly sms: string
  readonly aBroadcasts: readonly string[]
  readonly bBroadcast: string
}

/** 날짜 A·B·리허설 범위의 판매. 시계는 B의 판매 뒤(봉인 전)에 둔다 */
export async function scenario(options: { storage?: FolderBackupStorage } = {}): Promise<Scenario> {
  const storage = options.storage ?? new FolderBackupStorage(tempDir())
  const world = await newWorld({ clock: fakeClock(kst(A, '09:00:00')), backupStorage: storage })
  const seller = await addSeller(world)
  await putShop(world, seller)
  // A: 1부·2부 (옵션 없는 방송 — 채팅·문자찜(전화번호)·가격 변경·할인·직접 수령·부분 입금)
  const { b1, b2, sms } = await sellG201(world, seller, A)
  at(world, A, '22:20:00')
  await chat(world, seller, b1, 'look1', 'UC_LOOK', LOOKER_NICK, LOOKER_TEXT)
  // A: 옵션 방송 (변형·수량 2 이상)
  at(world, A, '23:00:00')
  const b3 = await optionsBroadcast(world, seller, A, '의류 3부')
  at(world, A, '23:00:01')
  await raw(world, seller, A, { type: 'product.register', b: b3, no: 21, name: '반바지', price: 10000, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] })
  at(world, A, '23:00:02')
  await raw(world, seller, A, {
    type: 'product.register',
    b: b3,
    no: 22,
    name: '반팔티',
    price: 15000,
    stock: 2,
    stocks: { '105/검정색': 3 },
    options: [
      { name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105', price: 2000 }] },
      { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', aliases: ['검정', '블랙'] }] },
    ],
  })
  at(world, A, '23:00:03')
  await raw(world, seller, A, { type: 'product.register', b: b3, no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'] })
  at(world, A, '23:00:05')
  await chat(world, seller, b3, 'o1', Y, '옵션손님', '반바지 M')
  at(world, A, '23:00:06')
  await chat(world, seller, b3, 'o2', Y, '옵션손님', '반팔티 105 검정 2')
  at(world, A, '23:00:07')
  await chat(world, seller, b3, 'o3', X, '길동이', '초코 과자 3')
  // A: 환불·배송비 조정(따로 정함)·입금
  at(world, A, '23:10:00')
  await ok(world, seller, { type: 'settlement.payment', buyer: Y, date: A, amount: 50000, memo: '옵션 입금' }, A)
  await ok(world, seller, { type: 'settlement.refund', buyer: Y, date: A, amount: 3000, reason: '부분 환불' }, A)
  await ok(world, seller, { type: 'settlement.shippingOverride', buyer: Y, date: A, mode: 'FIXED', amount: 4000 }, A)
  // A: 포장 완료·배송 완료(송장) — X는 배송 완료, 문자 구매자는 포장 완료, Y는 포장 대기
  at(world, A, '23:30:00')
  await packAll(world, seller, A, X)
  expect((await pack(world, seller, A, { buyer: X, action: 'ship', invoice: '123456789012' })).status).toBe(200)
  await packAll(world, seller, A, sms)
  // B: X가 또 산다 (지난 구매 — A의 항목이 보여야 한다)
  at(world, B, '20:00:00')
  const bb = (await createBroadcast(world, seller, { date: B, title: 'B 1부' })).id
  await ok(world, seller, { type: 'product.register', b: bb, no: 3, name: '블루엘프', price: 7000 })
  at(world, B, '20:00:05')
  await chat(world, seller, bb, 'b1', X, '홍길동', '3')
  // 리허설 범위
  const r = (await createBroadcast(world, seller, { date: B, rehearsal: true })).id
  await ok(world, seller, { type: 'product.register', b: r, no: 5, name: '연습', price: 1000 })
  await chat(world, seller, r, 'r1', 'sim_x', '연습손님', '5')
  await world.server.print.settled()
  return { world, seller, storage, sms, aBroadcasts: [b1, b2, b3], bBroadcast: bb }
}

/** 봉인 작업 한 바퀴 (A가 봉인된다) */
export async function sealA(world: TestServer): Promise<void> {
  world.clock.set(Math.max(world.clock.now(), AFTER_SEAL))
  expect(await world.server.sealer.runOnce()).toBe(1)
}

/** A 범위 행 (봉인 시각·장부·장부 요약값) */
export async function scopeRowOf(world: TestServer, seller: Seller, date: string): Promise<{ id: string; sealed_at: Date | null; ledger: string | null; ledger_digest: string | null } | undefined> {
  const rows = await world.database.pglite?.query<{ id: string; sealed_at: Date | null; ledger: string | null; ledger_digest: string | null }>(
    `select id, sealed_at, ledger, ledger_digest from scopes where seller_id = $1 and date = $2 and rehearsal = false`,
    [seller.sellerId, date],
  )
  return rows?.rows[0]
}
