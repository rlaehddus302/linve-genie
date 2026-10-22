// O4 서버: 포장 완료의 키 글 = 수량 1 (AC-O4-22, D-O4-05), 지난 구매 품목의 옵션 글·수량·찜 금액 (AC-O4-24, D-O4-06)
import { listClaims, type ClaimInfo } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { pastItemLines } from '../src/past.ts'
import { at, chat, kst, ok, pack } from './i2-support.ts'
import { addSeller, client, createBroadcast, fakeClock, newWorld, rid, type Seller, type TestServer } from './support.ts'

const TEE_OPTIONS = [
  { name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105', price: 2000 }] },
  { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', aliases: ['검정', '블랙'] }] },
]

async function optionsBroadcast(world: TestServer, seller: Seller, date: string, title: string): Promise<string> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date, title, saleMode: 'OPTIONS' })
  expect(response.status, response.text).toBe(200)
  return (response.body.broadcast as { id: string }).id
}

async function packingCount(world: TestServer): Promise<number> {
  return (await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from packing_records`))?.rows[0]?.n ?? -1
}

/** 그날 다육 방송(7 핑크프릴 8,000 — 홍길동 1개)과 옵션 방송(22 반팔티 105/검정색 2개 34,000) */
async function sellDay(world: TestServer, seller: Seller, date: string): Promise<{ succulent: string; clothes: string }> {
  at(world, date, '19:59:00')
  const succulent = (await createBroadcast(world, seller, { date, title: '다육' })).id
  at(world, date, '20:00:00')
  await ok(world, seller, { type: 'product.register', b: succulent, no: 7, name: '핑크프릴', price: 8000 })
  at(world, date, '20:00:05')
  await chat(world, seller, succulent, `${date}-m1`, 'UC_A', '홍길동', '7')
  at(world, date, '21:00:00')
  const clothes = await optionsBroadcast(world, seller, date, '의류')
  at(world, date, '21:00:01')
  await ok(world, seller, { type: 'product.register', b: clothes, no: 22, name: '반팔티', price: 15000, stocks: { '105/검정색': 2 }, options: TEE_OPTIONS })
  at(world, date, '21:00:30')
  await chat(world, seller, clothes, `${date}-m2`, 'UC_A', '홍길동', '반팔티 105 검정 2')
  return { succulent, clothes }
}

describe('AC-O4-22 포장 완료 — 키 글만 보낸 품목은 수량 1로 읽는다 (D-O4-05)', () => {
  it('지금 품목 b/22#105/검정색(qty 2)·b/7(qty 1): 키 글만 → 409·기록 없음, {key, qty: 2}+키 글 → 포장 완료(수량 2), qty 3 → 409', async () => {
    const date = '2026-10-28'
    const world = await newWorld({ clock: fakeClock(kst(date, '19:00:00')) })
    const seller = await addSeller(world)
    const { succulent, clothes } = await sellDay(world, seller, date)
    const tee = `${clothes}/22#105/검정색`
    const plant = `${succulent}/7`

    const keysOnly = await pack(world, seller, date, { buyer: 'UC_A', action: 'pack', items: [tee, plant] })
    expect([keysOnly.status, (keysOnly.body.error as { code: string } | undefined)?.code]).toEqual([409, 'ITEMS_CHANGED'])
    expect(await packingCount(world)).toBe(0)

    const more = await pack(world, seller, date, { buyer: 'UC_A', action: 'pack', items: [{ key: tee, qty: 3 }, plant] })
    expect([more.status, (more.body.error as { code: string } | undefined)?.code]).toEqual([409, 'ITEMS_CHANGED'])
    expect(await packingCount(world)).toBe(0)

    const packed = await pack(world, seller, date, { buyer: 'UC_A', action: 'pack', items: [{ key: tee, qty: 2 }, plant] })
    expect(packed.status, packed.text).toBe(200)
    expect((packed.body.entry as { status: string }).status).toBe('포장 완료')
    const stored = await world.database.pglite?.query<{ items: string }>(`select items from packing_records where kind = 'PACKED'`)
    expect(stored?.rows).toHaveLength(1)
    const items = JSON.parse(stored?.rows[0]?.items ?? '[]') as { key: string; qty?: number }[]
    expect(items.map((item) => [item.key, item.qty ?? 1])).toEqual([
      [plant, 1],
      [tee, 2],
    ])
    world.server.close()
  })

  it('다육(모두 수량 1) 묶음은 키 글만 보내도 지금처럼 포장 완료', async () => {
    const date = '2026-10-28'
    const world = await newWorld({ clock: fakeClock(kst(date, '19:00:00')) })
    const seller = await addSeller(world)
    at(world, date, '19:59:00')
    const b = (await createBroadcast(world, seller, { date, title: '다육' })).id
    for (const no of [7, 8]) {
      at(world, date, `20:0${String(no)}:00`)
      await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no })
      await chat(world, seller, b, `c${String(no)}`, 'UC_A', '홍길동', String(no))
    }
    const packed = await pack(world, seller, date, { buyer: 'UC_A', action: 'pack', items: [`${b}/7`, `${b}/8`] })
    expect(packed.status, packed.text).toBe(200)
    expect((packed.body.entry as { status: string }).status).toBe('포장 완료')
    world.server.close()
  })
})

describe('AC-O4-24 지난 구매 품목의 옵션 글·수량·찜 금액 (D-O4-06)', () => {
  it('지난 날짜 옵션 방송 반팔티 105/검정색 2개 34,000원·다육 7번 8,000원 → variant·qty·amount, 합계는 그날 정산 묶음 값', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-27', '19:00:00')) })
    const seller = await addSeller(world)
    await sellDay(world, seller, '2026-10-27')
    // 오늘: 같은 채널이 다육 방송에서 하나
    at(world, '2026-10-28', '19:59:00')
    const today = (await createBroadcast(world, seller, { date: '2026-10-28', title: '오늘' })).id
    at(world, '2026-10-28', '20:00:00')
    await ok(world, seller, { type: 'product.register', b: today, no: 3, name: '라울', price: 5000 })
    await chat(world, seller, today, 't1', 'UC_A', '홍길동', '3')

    const response = await client(world, seller.cookie).get('/api/days/2026-10-28/past?buyer=UC_A')
    expect(response.status, response.text).toBe(200)
    const items = response.body.items as { date: string; items: unknown[]; subtotal: number; shipping: number; total: number; broadcasts: string[] }[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ date: '2026-10-27', broadcasts: ['다육', '의류'], subtotal: 42000, shipping: 4000, total: 46000 })
    expect(items[0]?.items).toEqual([
      { title: '다육', no: 7, name: '핑크프릴', price: 8000, variant: null, qty: 1, amount: 8000 },
      { title: '의류', no: 22, name: '반팔티', price: 17000, variant: '105/검정색', qty: 2, amount: 34000 },
    ])
    world.server.close()
  })

  it('찜 금액이 없는 찜(시험 주입)은 amount null이고 AMOUNT_MISSING 로그에 찜 ID만 (닉네임·금액 없음)', async () => {
    const date = '2026-10-27'
    const world = await newWorld({ clock: fakeClock(kst(date, '19:00:00')) })
    const seller = await addSeller(world)
    await sellDay(world, seller, date)
    const { state } = await world.server.writer.read(seller.sellerId, date)
    const claims = listClaims(state) as ClaimInfo[]
    const target = claims.find((claim) => claim.status === 'CONFIRMED' && claim.variant === '105/검정색') as ClaimInfo
    const injected = claims.map((claim) => (claim.id === target.id ? { ...claim, amount: null } : claim))
    const logs: Record<string, unknown>[] = []
    const products = [...new Set(claims.filter((claim) => claim.status === 'CONFIRMED').flatMap((claim) => [claim.key, claim.product]))]
    const lines = pastItemLines(state, injected, 'UC_A', products, date, (record) => logs.push(record as unknown as Record<string, unknown>))
    expect(lines.map(({ no, variant, qty, amount }) => ({ no, variant, qty, amount }))).toEqual([
      { no: 7, variant: null, qty: 1, amount: 8000 },
      { no: 22, variant: '105/검정색', qty: 2, amount: null },
    ])
    expect(logs).toEqual([{ level: 'error', code: 'AMOUNT_MISSING', date, claim: target.id }])
    expect(JSON.stringify(logs)).not.toContain('홍길동')
    expect(JSON.stringify(logs)).not.toContain('34000')
    world.server.close()
  })
})
