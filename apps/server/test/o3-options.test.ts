// O3 서버 연결 (AC-O3-20~24): 엔진 상태 → 상품·포장 라벨 데이터의 옵션 글·수량, 포장 모드 품목의 variant·qty, 포장 기록의 수량 비교, 내려받은 문서·라벨.
// 판매는 골든 G-ENG-O3-01(tests/golden/engine/24-o3-labels-documents.yaml)과 같은 이벤트를 서버 쓰기 경로(API·수집 함수)로 넣는다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkPackingData, checkProductData, computePackingText, defaultTemplate, type PackingLabelData } from '@livejjim/label'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { pdfPageTexts } from '../../../packages/documents/test/helpers.ts'
import { listClaims, type ClaimInfo } from '@livejjim/core'
import { createBackupBytes, restoreSeller } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { packingBroadcasts } from '../src/label-data.ts'
import { parsePackedItems, packedItemsJson, packingWord, pairText, readPackedItem, replayPacking } from '../src/packing.ts'
import { at, chat, getFile, ok, pack, pngHeader } from './i2-support.ts'
import { printApi } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, type JsonResponse, type Seller, type TestServer } from './support.ts'

const D = '2026-10-25'
const GOLDEN = fileURLToPath(new URL('../../../tests/golden/', import.meta.url))

interface Item {
  id: string
  key: string
  broadcast: string
  title: string
  no: number
  name: string
  price: number
  variant: string | null
  qty: number
}
interface Entry {
  buyer: string
  name: string
  status: string
  items: Item[]
  add: Item[]
  remove: { id: string | null; key: string; no: number }[]
}

async function settings(world: TestServer, seller: Seller, value: Record<string, unknown>): Promise<void> {
  await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: value }))
}

/**
 * 옵션 칸이 있는 이벤트를 기록 경로(ScopeWriter)로 바로 쓴다 — API의 옵션 쓰기 칸은 O2 트랙(D-O2) 몫이라 이 트랙에는 아직 없다.
 * 판정은 같은 기록 경로·같은 코어가 한다 (트랜잭션·범위 락·효과·출력 작업 그대로)
 */
async function raw(world: TestServer, seller: Seller, fields: Record<string, unknown>): Promise<void> {
  const outcome = await world.server.writer.write({ sellerId: seller.sellerId, date: D, rehearsal: false, createScope: false, requestId: null, build: () => [{ fields, actor: { kind: 'account', accountId: seller.accountId } }] })
  expect(outcome.kind, JSON.stringify(outcome)).toBe('ok')
  await world.server.print.settled()
}

/** G-ENG-O3-01과 같은 판매. 돌려주는 값: 방송 ID 둘과 문자 구매자 ID */
async function sellO3(world: TestServer, seller: Seller): Promise<{ b1: string; b2: string; sms: string }> {
  at(world, D, '19:59:00')
  const b1 = (await createBroadcast(world, seller, { date: D, title: '다육 1부' })).id
  at(world, D, '20:00:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 7, name: '핑크프릴', price: 8000 })
  at(world, D, '20:00:05')
  await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '7')
  at(world, D, '21:00:00')
  await settings(world, seller, { 'claim.parseMode': 'OPTIONS' })
  const b2 = (await createBroadcast(world, seller, { date: D, title: '의류 2부' })).id
  await settings(world, seller, { 'claim.parseMode': 'STRICT' })
  at(world, D, '21:00:01')
  await raw(world, seller, { type: 'product.register', b: b2, no: 21, name: '반바지', price: 10000, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] })
  at(world, D, '21:00:02')
  await raw(world, seller, {
    type: 'product.register',
    b: b2,
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
  at(world, D, '21:00:03')
  await raw(world, seller, { type: 'product.register', b: b2, no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'] })
  at(world, D, '21:00:04')
  await raw(world, seller, { type: 'product.register', b: b2, no: 23, name: '양말', price: 3000, options: [{ name: '색상', choices: [{ label: '흰색' }, { label: '검정색' }] }] })
  at(world, D, '21:00:05')
  await chat(world, seller, b2, 'm2', 'UC_A', '홍길동', '반바지 M')
  at(world, D, '21:00:06')
  await chat(world, seller, b2, 'm3', 'UC_A', '홍길동', '반바지 L')
  at(world, D, '21:00:07')
  await chat(world, seller, b2, 'm4', 'UC_A', '홍길동', '반팔티 105 검정 2')
  at(world, D, '21:00:08')
  await chat(world, seller, b2, 'm5', 'UC_A', '홍길동', '초코 과자 3')
  at(world, D, '21:00:09')
  await chat(world, seller, b2, 'm6', 'UC_B', '김철수', '초코 1')
  at(world, D, '21:00:10')
  // 문자찜(옵션): 서버가 하는 대로 ref를 정하고 전화번호는 뒤 4자리만 담는다
  await raw(world, seller, { type: 'sms', b: b2, no: 22, ref: 's1', received: '21:00', memo: '이영희', phoneKey: 'k'.repeat(43), phoneLast4: '5678', options: { 사이즈: '100', 색상: '흰색' }, qty: 1 })
  return { b1, b2, sms: 'sms:s1' }
}

async function entries(world: TestServer, seller: Seller): Promise<Map<string, Entry>> {
  const response = await client(world, seller.cookie).get(`/api/days/${D}/packing`)
  expect(response.status, response.text).toBe(200)
  return new Map((response.body.entries as Entry[]).map((entry) => [entry.buyer, entry]))
}

async function packingLabel(world: TestServer, seller: Seller, buyer: string): Promise<{ data: PackingLabelData; pages: number }> {
  const response = await expectOk(client(world, seller.cookie).get(`/api/days/${D}/packing-label?buyer=${encodeURIComponent(buyer)}`))
  return response.body as unknown as { data: PackingLabelData; pages: number }
}

const expectPack = async (promise: Promise<JsonResponse>): Promise<Entry> => {
  const response = await promise
  expect(response.status, response.text).toBe(200)
  return response.body.entry as Entry
}

interface GoldenCase {
  id: string
  data?: unknown
  out: Record<string, unknown>
  buyer?: string
  broadcasts?: string[]
}
const goldenCase = (file: string, id: string): GoldenCase =>
  (JSON.parse(readFileSync(`${GOLDEN}${file}`, 'utf8')) as { cases: GoldenCase[] }).cases.find((c) => c.id === id) as GoldenCase

describe('AC-O3-20 상품 라벨 데이터 — 옵션 글·수량·찜 금액', () => {
  it('확정 찜마다 출력 작업의 데이터: 다육 7번은 O3 전과 같은 객체, 옵션 찜은 variant, 수량 2 이상은 qty, 가격은 찜 금액. 모두 checkProductData 통과, 메모·전화번호 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2 } = await sellO3(world, seller)
    const p = printApi(world, seller)
    const overview = await p.overview()
    const byLabel = overview.jobs.map((job) => ({ broadcast: job.label.broadcast, no: job.label.no, data: job.data }))
    const sms = { kind: 'sms' }
    expect(byLabel).toEqual([
      { broadcast: b1, no: 7, data: { no: 7, name: '핑크프릴', price: 8000, date: D, buyer: { kind: 'youtube', name: '홍길동' } } },
      { broadcast: b2, no: 21, data: { no: 21, name: '반바지', price: 10000, variant: 'M', date: D, buyer: { kind: 'youtube', name: '홍길동' } } },
      { broadcast: b2, no: 21, data: { no: 21, name: '반바지', price: 10000, variant: 'L', date: D, buyer: { kind: 'youtube', name: '홍길동' } } },
      { broadcast: b2, no: 22, data: { no: 22, name: '반팔티', price: 34000, variant: '105/검정색', qty: 2, date: D, buyer: { kind: 'youtube', name: '홍길동' } } },
      { broadcast: b2, no: 11, data: { no: 11, name: '초코 과자', price: 6000, qty: 3, date: D, buyer: { kind: 'youtube', name: '홍길동' } } },
      { broadcast: b2, no: 11, data: { no: 11, name: '초코 과자', price: 2000, date: D, buyer: { kind: 'youtube', name: '김철수' } } },
      { broadcast: b2, no: 22, data: { no: 22, name: '반팔티', price: 15000, variant: '100/흰색', date: D, buyer: sms } },
    ])
    // 다육 7번 데이터는 O3 전 다섯 칸 그대로 (칸 순서까지)
    expect(Object.keys(byLabel[0]?.data ?? {})).toEqual(['no', 'name', 'price', 'date', 'buyer'])
    for (const { data } of byLabel) {
      const checked = checkProductData(data)
      expect(checked.ok).toBe(true)
      if (checked.ok) expect(checked.data).toEqual(data)
      const text = JSON.stringify(data)
      for (const secret of ['이영희', '5678', '010', 'memo', 'phone']) expect(text).not.toContain(secret)
    }
    // 출력 기기가 받을 때 다시 만든 데이터도 같다 (L-11 4)
    await expectOk(p.register('device-aaaa-0001', '휴대폰'))
    await expectOk(p.restart())
    const seen: unknown[] = []
    for (let i = 0; i < byLabel.length; i++) {
      const claimed = await p.claim('device-aaaa-0001')
      seen.push(claimed.job?.data)
      expect(await p.done('device-aaaa-0001', claimed.job?.attempt ?? '')).toBe(true)
    }
    expect(seen).toEqual(byLabel.map((label) => label.data))
  })
})

describe('AC-O3-21 포장 라벨 데이터 — 변형마다 항목, 같은 변형은 수량 합', () => {
  it('홍길동 묶음의 데이터·글 계산 = G-LBL-O3-51, 다육만 있는 묶음은 정수 번호, 같은 변형 찜 둘은 한 항목', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b2, sms } = await sellO3(world, seller)
    const golden = goldenCase('label/packing-options.json', 'G-LBL-O3-51')
    const label = await packingLabel(world, seller, 'UC_A')
    // 같은 번호의 항목은 상품의 변형 순서(21: M → L), 번호 순 11 → 21 → 22
    expect(label.data).toEqual({
      date: D,
      buyer: { kind: 'youtube', name: '홍길동' },
      broadcasts: [
        { title: '다육 1부', numbers: [7] },
        { title: '의류 2부', numbers: [{ no: 11, qty: 3 }, { no: 21, variant: 'M' }, { no: 21, variant: 'L' }, { no: 22, variant: '105/검정색', qty: 2 }] },
      ],
      subtotal: 68000,
    })
    expect(label.pages).toBe(2)
    const computed = computePackingText(defaultTemplate('packing', '50x30'), label.data)
    expect(computed.ok).toBe(true)
    if (computed.ok) expect({ common: computed.text.common, pages: computed.text.pages }).toEqual(golden.out)
    // 김철수: 옵션 없는 수량 1 → 정수 번호 / 문자찜: 옵션 항목
    expect((await packingLabel(world, seller, 'UC_B')).data.broadcasts).toEqual([{ title: '의류 2부', numbers: [11] }])
    expect((await packingLabel(world, seller, sms)).data).toMatchObject({ buyer: { kind: 'sms' }, broadcasts: [{ title: '의류 2부', numbers: [{ no: 22, variant: '100/흰색' }] }], subtotal: 15000 })

    // 같은 구매자에게 같은 변형 확정 찜이 둘 — 지금 코어는 같은 변형의 두 번째 활성 찜을 만들지 않고(INV-2) 그런 합치기도 하지 않아
    // 서버 API로는 만들 수 없다. 그래서 지금 상태의 찜 목록에 같은 변형 확정 찜(수량 1)을 하나 더 넣어 넘긴다 → 수량을 더한 한 항목 (INVALID_DATA가 아니다)
    const runtime = await world.server.writer.read(seller.sellerId, D)
    const claims = listClaims(runtime.state)
    const black = claims.find((claim) => claim.key === `${b2}/22#105/검정색`) as ClaimInfo
    const doubled = [...claims, { ...black, id: 'c-extra', qty: 1, amount: 17000 }]
    const merged = { date: D, buyer: { kind: 'youtube', name: '홍길동' }, broadcasts: packingBroadcasts(runtime.state, 'UC_A', D, doubled), subtotal: 85000 }
    expect(merged.broadcasts[1]?.numbers).toEqual([{ no: 11, qty: 3 }, { no: 21, variant: 'M' }, { no: 21, variant: 'L' }, { no: 22, variant: '105/검정색', qty: 3 }])
    expect(checkPackingData(merged).ok).toBe(true)
    // 옵션 없는 상품도 같은 번호의 확정 찜 둘이면 { no, qty: 2 } (O3 전에는 같은 번호 둘로 INVALID_DATA였다)
    const choco = claims.find((claim) => claim.key === `${b2}/11` && claim.currentBuyer === 'UC_B') as ClaimInfo
    expect(packingBroadcasts(runtime.state, 'UC_B', D, [choco, { ...choco, id: 'c-extra2' }])).toEqual([{ title: '의류 2부', numbers: [{ no: 11, qty: 2 }] }])
  })

  it('다육만 있는 묶음의 포장 라벨 데이터는 O3 전과 같은 객체 (정수 번호, 같은 칸)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    at(world, D, '19:59:00')
    const b = (await createBroadcast(world, seller, { date: D, title: '1부' })).id
    for (const [no, price] of [
      [15, 10000],
      [3, 5000],
    ] as const) {
      at(world, D, `20:0${String(no % 10)}:00`)
      await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price })
      await chat(world, seller, b, `c${String(no)}`, 'UC_A', '홍길동', String(no))
    }
    const label = await packingLabel(world, seller, 'UC_A')
    expect(label.data).toEqual({ date: D, buyer: { kind: 'youtube', name: '홍길동' }, broadcasts: [{ title: '1부', numbers: [3, 15] }], subtotal: 15000 })
    expect(JSON.stringify(label.data)).toBe(JSON.stringify({ date: D, buyer: { kind: 'youtube', name: '홍길동' }, broadcasts: [{ title: '1부', numbers: [3, 15] }], subtotal: 15000 }))
  })
})

describe('AC-O3-22 포장 모드 품목에 옵션 글·수량', () => {
  it('홍길동 품목 = 방송 선언 순 → 번호 → 변형 순서로 다섯 개, 항목마다 variant·qty. 다른 칸은 지금 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2 } = await sellO3(world, seller)
    const all = await entries(world, seller)
    const a = all.get('UC_A') as Entry
    expect(a.items.map((item) => [item.no, item.variant, item.qty])).toEqual([
      [7, null, 1],
      [11, null, 3],
      [21, 'M', 1],
      [21, 'L', 1],
      [22, '105/검정색', 2],
    ])
    expect(a.items.map((item) => item.key)).toEqual([`${b1}/7`, `${b2}/11`, `${b2}/21#M`, `${b2}/21#L`, `${b2}/22#105/검정색`])
    expect(a.items.map((item) => [item.title, item.name, item.price])).toEqual([
      ['다육 1부', '핑크프릴', 8000],
      ['의류 2부', '초코 과자', 6000],
      ['의류 2부', '반바지', 10000],
      ['의류 2부', '반바지', 10000],
      ['의류 2부', '반팔티', 34000],
    ])
    // 같은 상품의 변형은 같은 상품 ID
    expect(a.items[2]?.id).toBe(a.items[3]?.id)
    expect(Object.keys(a.items[0] ?? {}).sort()).toEqual(['broadcast', 'id', 'key', 'name', 'no', 'price', 'qty', 'title', 'variant'])
    expect([a.status, a.add, a.remove]).toEqual(['포장 대기', [], []])
    expect(all.get('UC_B')?.items.map((item) => [item.no, item.variant, item.qty, item.price])).toEqual([[11, null, 1, 2000]])

    // 변형 키 그대로 포장 완료 → 포장 완료 (변형 키 품목을 받는다)
    const packed = await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => item.key) }))
    expect(packed.status).toBe('포장 완료')
    // 화면이 본 수량을 함께 보내도 된다 — 지금 수량과 다르면 다시 확인하라고 거절
    const wrong = await pack(world, seller, D, { buyer: 'UC_B', action: 'pack', items: [{ key: `${b2}/11`, qty: 2 }] })
    expect([wrong.status, (wrong.body.error as { code: string }).code]).toEqual([409, 'ITEMS_CHANGED'])
    expect((await expectPack(pack(world, seller, D, { buyer: 'UC_B', action: 'pack', items: [{ key: `${b2}/11`, qty: 1 }] }))).status).toBe('포장 완료')
    // 형식이 틀린 품목은 받지 않는다
    for (const items of [[`${b2}/11#`], [{ key: `${b2}/11`, qty: 0 }], [{ key: `${b2}/11`, qty: 1, extra: 1 }], [`${b2}/11`, { key: `${b2}/11`, qty: 1 }]]) {
      expect((await pack(world, seller, D, { buyer: 'UC_B', action: 'pack', items })).status).toBe(400)
    }
  })
})

describe('AC-O3-23 포장 뒤 수량이 바뀌면 "포장 다시 확인"', () => {
  it('초코 과자 2개 포장 완료 → 찜 취소 → 같은 구매자가 3개로 다시 1등 → 포장 다시 확인, 배송 뒤면 배송 뒤 바뀜', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    at(world, D, '20:59:00')
    await settings(world, seller, { 'claim.parseMode': 'OPTIONS' })
    const b = (await createBroadcast(world, seller, { date: D, title: '의류' })).id
    at(world, D, '21:00:00')
    await ok(world, seller, { type: 'product.register', b, no: 11, name: '초코 과자', price: 2000, stock: 5 })
    at(world, D, '21:00:01')
    await chat(world, seller, b, 'q1', 'UC_A', '홍길동', '초코 과자 2')
    let a = (await entries(world, seller)).get('UC_A') as Entry
    expect(a.items.map((item) => [item.key, item.qty, item.price])).toEqual([[`${b}/11`, 2, 4000]])
    expect((await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/11`] }))).status).toBe('포장 완료')
    // 기록에 수량이 함께 적혔다
    const stored = await world.database.pglite?.query<{ items: string }>(`select items from packing_records where kind = 'PACKED' order by id`)
    expect(JSON.parse(stored?.rows[0]?.items ?? 'null')).toEqual([{ id: a.items[0]?.id, key: `${b}/11`, qty: 2 }])

    at(world, D, '21:01:00')
    await ok(world, seller, { type: 'host.cancel', b, no: 11, buyer: 'UC_A', reason: '구매자 요청' })
    at(world, D, '21:01:10')
    await chat(world, seller, b, 'q2', 'UC_A', '홍길동', '초코 과자 3')
    a = (await entries(world, seller)).get('UC_A') as Entry
    // 품목 키는 같고 수량만 다르다
    expect(a.items.map((item) => [item.key, item.qty])).toEqual([[`${b}/11`, 3]])
    expect(a.status).toBe('포장 다시 확인')
    expect(a.add.map((item) => [item.key, item.qty])).toEqual([[`${b}/11`, 3]])
    expect(a.remove.map((item) => item.key)).toEqual([`${b}/11`])
    // 다시 포장 → 포장 완료 → 배송 완료 → 수량이 바뀌면 배송 뒤 바뀜
    expect((await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/11`] }))).status).toBe('포장 완료')
    expect((await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship' }))).status).toBe('배송 완료')
    at(world, D, '21:02:00')
    await ok(world, seller, { type: 'host.cancel', b, no: 11, buyer: 'UC_A', reason: '구매자 요청' })
    at(world, D, '21:02:10')
    await chat(world, seller, b, 'q3', 'UC_A', '홍길동', '초코 과자 1')
    expect((await entries(world, seller)).get('UC_A')?.status).toBe('배송 뒤 바뀜')
    // 판매대장 배송 칸·정산 조회도 같은 말
    const summary = await expectOk(client(world, seller.cookie).get(`/api/days/${D}`))
    expect((summary.body.packing as { buyer: string; status: string }[]).find((row) => row.buyer === 'UC_A')?.status).toBe('배송 뒤 바뀜')
  })

  it('수량 칸이 없는 이전(I2) 기록은 수량 1로 읽어 다육 묶음 상태는 O3 전과 같다. 수량 1은 기록에 적지 않는다', () => {
    const legacy = parsePackedItems(JSON.stringify([{ id: 'p1', key: 'b1/7' }, 'b1/8']))
    expect(legacy).toEqual([
      { id: 'p1', key: 'b1/7', qty: 1 },
      { id: null, key: 'b1/8', qty: 1 },
    ])
    const state = replayPacking([{ kind: 'PACKED', items: [{ id: 'p1', key: 'b1/7', qty: 1 }], invoice: null }])
    expect(packingWord(state, new Set([pairText({ id: 'p1', key: 'b1/7', qty: 1 })]))).toBe('포장 완료')
    expect(packingWord(state, new Set([pairText({ id: 'p1', key: 'b1/7', qty: 2 })]))).toBe('포장 다시 확인')
    expect(packingWord(replayPacking([{ kind: 'PACKED', items: legacy.slice(0, 1), invoice: null }, { kind: 'SHIPPED', items: null, invoice: null }]), new Set([pairText({ id: 'p1', key: 'b1/7', qty: 2 })]))).toBe(
      '배송 뒤 바뀜',
    )
    // 수량 1은 적지 않는다 (다육 기록은 O3 전과 같은 모양), 2 이상만 적는다
    expect(packedItemsJson([{ id: 'p1', key: 'b1/7', qty: 1 }])).toBe(JSON.stringify([{ id: 'p1', key: 'b1/7' }]))
    expect(packedItemsJson([{ id: 'p2', key: 'b2/22#105/검정색', qty: 2 }])).toBe(JSON.stringify([{ id: 'p2', key: 'b2/22#105/검정색', qty: 2 }]))
    // 형식 검사
    expect(readPackedItem({ id: 'p1', key: 'b1/7', qty: 0 })).toBeNull()
    expect(readPackedItem({ id: 'p1', key: 'b1/7', qty: 1.5 })).toBeNull()
    expect(readPackedItem({ id: 'p1', key: 'b1/7', qty: '2' })).toBeNull()
    expect(readPackedItem({ id: 'p1', key: 'b1/7', qty: 2, x: 1 })).toBeNull()
    expect(readPackedItem({ id: 'p1', key: 'b1/7#' })).toBeNull()
    expect(readPackedItem({ id: 'p1', key: 'b1/7#a\nb' })).toBeNull()
    expect(readPackedItem('b1/7#M')).toBeNull()
    expect(readPackedItem({ id: 'p1', key: 'b1/7#M' })).toEqual({ id: 'p1', key: 'b1/7#M', qty: 1 })
  })
})

describe('AC-O3-23 백업 — 변형 키·수량을 적은 포장 기록도 백업·복원된다', () => {
  it('옵션 묶음 포장 완료 → 백업 → 빈 판매자로 복원 → 같은 포장 상태(포장 완료), 기록 품목에 변형 키·수량', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellO3(world, seller)
    const a = (await entries(world, seller)).get('UC_A') as Entry
    await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => item.key) }))
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    // 다른 서버(다른 DB)의 빈 판매자로 — 방송 ID는 서버 전체에서 유일해 같은 서버로는 가져오지 않는다
    const other = await newWorld({ clock: fakeClock(world.clock.now()) })
    const target = await addSeller(other)
    const restored = await restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    other.server.writer.forgetSeller(target.sellerId)
    const after = (await entries(other, target)).get('UC_A') as Entry
    expect(after.status).toBe('포장 완료')
    expect(after.items.map((item) => [item.key.replace(/^[^/]+\//, ''), item.qty])).toEqual([
      ['7', 1],
      ['11', 3],
      ['21#M', 1],
      ['21#L', 1],
      ['22#105/검정색', 2],
    ])
  })
})

async function readSheet(bytes: Uint8Array): Promise<(string | number)[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (sheet === undefined) return []
  const rows: (string | number)[][] = []
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const cells: (string | number)[] = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      const value = row.getCell(c).value
      cells.push(value === null || value === undefined ? '' : typeof value === 'number' ? value : String(value))
    }
    rows.push(cells)
  }
  return rows
}

describe('AC-O3-24 문서 내보내기·출력은 같은 데이터', () => {
  it('확인서 데이터 = G-DOC-O3-01~03, PDF·PNG·전원 PDF에 옵션 줄, 판매대장 엑셀 = G-DOC-O3-04~06(배송 칸은 서버 포장 기록 말), 포장 라벨 그림', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2, sms } = await sellO3(world, seller)
    const api = client(world, seller.cookie)

    // 확인서 데이터 (줄·상품 수·상품 합계)
    for (const [id, buyer] of [
      ['G-DOC-O3-01', 'UC_A'],
      ['G-DOC-O3-02', 'UC_B'],
      ['G-DOC-O3-03', sms],
    ] as const) {
      const golden = goldenCase('documents/receipt.json', id)
      const receipt = (await expectOk(api.get(`/api/days/${D}/receipt?buyer=${encodeURIComponent(buyer)}`))).body as {
        lines: { session: string; no: number; name: string; priceText: string }[]
        itemCount: number
        subtotal: number
        total: number
      }
      expect({ lines: receipt.lines.map((line) => ({ session: line.session, no: line.no, item: line.name, price: line.priceText })), itemCount: receipt.itemCount, subtotal: receipt.subtotal }).toEqual(golden.out)
      if (buyer === 'UC_A') expect(receipt.total).toBe(72000)
    }

    // 한 사람 PDF·PNG, 전원 PDF
    const pdf = await getFile(world, seller.cookie, `/api/days/${D}/receipt.pdf?buyer=UC_A`)
    expect(pdf.status).toBe(200)
    const text = (await pdfPageTexts(pdf.bytes)).flat().join('\n')
    expect(text).toContain('34,000원')
    expect(text.replace(/\s+/g, '')).toContain('반팔티105/검정색(17,000원×2개)')
    expect(text).not.toContain('…')
    const png = await getFile(world, seller.cookie, `/api/days/${D}/receipt.png?buyer=UC_A`)
    expect(png.status).toBe(200)
    expect(pngHeader(png.bytes).width).toBe(1080)
    const batch = await getFile(world, seller.cookie, `/api/days/${D}/receipts.pdf`)
    expect(batch.status).toBe(200)
    const batchText = (await pdfPageTexts(batch.bytes)).flat().join('\n').replace(/\s+/g, '')
    for (const want of ['반팔티105/검정색(17,000원×2개)', '반팔티100/흰색', '초코과자(2,000원×3개)']) expect(batchText).toContain(want)

    // 판매대장 엑셀: 모든 방송·b2만은 14열, b1만은 11열. 배송 칸 = 서버 포장 기록 말 (확정 행 "포장 대기", 확정 없는 행 빈칸)
    for (const [id, query] of [
      ['G-DOC-O3-04', ''],
      ['G-DOC-O3-05', `&b=${b1}`],
      ['G-DOC-O3-06', `&b=${b2}`],
    ] as const) {
      const golden = goldenCase('documents/ledger.json', id).out as { columns: string[]; rows: (string | number)[][] }
      const file = await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${D}&to=${D}${query}`)
      expect(file.status).toBe(200)
      const sheet = await readSheet(file.bytes)
      expect(sheet[0]).toEqual(golden.columns)
      const buyerCol = golden.columns.indexOf('구매자')
      const expected = golden.rows.map((row) => [...row.slice(0, -1), row[buyerCol] === '' ? '' : '포장 대기'])
      expect(sheet.slice(1)).toEqual(expected)
    }
    // 포장 기록을 적으면 대장의 배송 칸이 그 말
    const a = (await entries(world, seller)).get('UC_A') as Entry
    await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => item.key) }))
    const after = await readSheet((await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${D}&to=${D}`)).bytes)
    expect(after.slice(1).filter((row) => row[8] === '홍길동').map((row) => row[13])).toEqual(['포장 완료', '포장 완료', '포장 완료', '포장 완료', '포장 완료'])

    // 포장 라벨 그림 (쪽 2장 — 다육 1부, 의류 2부)
    const label = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=2`)
    expect(label.status).toBe(200)
    const labelPdf = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.pdf?buyer=UC_A`)
    expect(labelPdf.status).toBe(200)
  })
})
