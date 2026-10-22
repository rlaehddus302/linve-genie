// O3 서버 연결 (AC-O3-20~24): 엔진 상태 → 상품·포장 라벨 데이터의 옵션 글·수량, 포장 모드 품목의 variant·qty, 포장 기록의 수량 비교, 내려받은 문서·라벨.
// 판매는 골든 G-ENG-O3-01(tests/golden/engine/24-o3-labels-documents.yaml)과 같은 이벤트를 서버 쓰기 경로(API·수집 함수)로 넣는다.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { checkPackingData, checkProductData, computePackingText, defaultTemplate, encodeLabelPng, renderPackingLabels, type PackingLabelData } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { loadDocumentFont, renderReceiptPng, type ReceiptData } from '@livejjim/documents'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { fontBytes, pdfPageTexts } from '../../../packages/documents/test/helpers.ts'
import { listClaims, type ClaimInfo } from '@livejjim/core'
import { MissingAmountError } from '../src/amount.ts'
import { createBackupBytes, restoreSeller, type BackupFile } from '../src/backup.ts'
import { formatLog } from '../src/log.ts'
import { randomIds } from '../src/ids.ts'
import { eventsAfter, scopeRow } from '../src/store.ts'
import { summaryLines } from '../src/youtube/outbox.ts'
import { summaryComments } from '../src/youtube/texts.ts'
import { LEDGER_FORMAT, buildLedger, confirmTimes, readLedger, sealedView } from '../src/youtube/seal.ts'
import { buildClaimIndex, packingBroadcasts, productLabelData } from '../src/label-data.ts'
import { lookupOf, packingEntry, packingStatusOf, parsePackedItems, packedItemsJson, packingWord, pairText, readPackedItem, replayPacking } from '../src/packing.ts'
import { at, chat, getFile, ok, pack, pngHeader } from './i2-support.ts'
import { printApi } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, rid, type JsonResponse, type Seller, type TestServer } from './support.ts'

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

/**
 * 옵션 칸이 있는 이벤트를 기록 경로(ScopeWriter)로 바로 쓴다 — API의 옵션 쓰기 칸은 O2 트랙(D-O2) 몫이라 이 트랙에는 아직 없다.
 * 판정은 같은 기록 경로·같은 코어가 한다 (트랜잭션·범위 락·효과·출력 작업 그대로)
 */
async function raw(world: TestServer, seller: Seller, fields: Record<string, unknown>): Promise<void> {
  const outcome = await world.server.writer.write({ sellerId: seller.sellerId, date: D, rehearsal: false, createScope: false, requestId: null, build: () => [{ fields, actor: { kind: 'account', accountId: seller.accountId } }] })
  expect(outcome.kind, JSON.stringify(outcome)).toBe('ok')
  await world.server.print.settled()
}

/**
 * 옵션 방송(claim.parseMode=OPTIONS)을 API로 연다 — 새 방송 시작의 판매 방식 `saleMode: 'OPTIONS'`(D-O2-02, 그 방송 스냅샷만 OPTIONS·접수순, 판매자 설정은 그대로).
 * O3 합치기 때는 O1 막음(RA-O1-01) 때문에 기록 경로로 broadcast.start를 직접 남겼다. O2에서 막음을 풀어 API로 되돌림
 */
async function optionsBroadcast(world: TestServer, seller: Seller, date: string, title: string): Promise<string> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date, title, saleMode: 'OPTIONS' })
  expect(response.status, response.text).toBe(200)
  return (response.body.broadcast as { id: string }).id
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
  const b2 = await optionsBroadcast(world, seller, D, '의류 2부')
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

    // 키 글만 보내면 수량 1로 읽어(O4 D-O4-05 — TD-O3-003) 수량 2 이상 품목이 있는 묶음은 거절되고 아무것도 적지 않는다
    const keysOnly = await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => item.key) })
    expect([keysOnly.status, (keysOnly.body.error as { code: string }).code]).toEqual([409, 'ITEMS_CHANGED'])
    expect((await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from packing_records`))?.rows[0]?.n).toBe(0)
    // 변형 키와 화면이 본 수량으로 포장 완료 → 포장 완료 (변형 키 품목을 받는다)
    const packed = await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => ({ key: item.key, qty: item.qty })) }))
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
    const b = await optionsBroadcast(world, seller, D, '의류')
    at(world, D, '21:00:00')
    await ok(world, seller, { type: 'product.register', b, no: 11, name: '초코 과자', price: 2000, stock: 5 })
    at(world, D, '21:00:01')
    await chat(world, seller, b, 'q1', 'UC_A', '홍길동', '초코 과자 2')
    let a = (await entries(world, seller)).get('UC_A') as Entry
    expect(a.items.map((item) => [item.key, item.qty, item.price])).toEqual([[`${b}/11`, 2, 4000]])
    expect((await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [{ key: `${b}/11`, qty: 2 }] }))).status).toBe('포장 완료')
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
    expect((await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [{ key: `${b}/11`, qty: 3 }] }))).status).toBe('포장 완료')
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

describe('AC-O3-24 여러 날짜 판매대장의 열 모양 (D-O3-07)', () => {
  it('다육만 있는 날짜 + 상품 없는 옵션 방송만 있는 날짜 → 대장 전체가 옵션·수량·단가 열, 다육 행은 옵션 빈칸·수량 1·단가 = 가격. 다육 날짜만이면 11열', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    at(world, D, '19:59:00')
    const b = (await createBroadcast(world, seller, { date: D, title: '1부' })).id
    at(world, D, '20:00:00')
    await ok(world, seller, { type: 'product.register', b, no: 7, name: '핑크프릴', price: 8000 })
    at(world, D, '20:00:05')
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '7')
    const D2 = '2026-10-26'
    at(world, D2, '20:59:00')
    await optionsBroadcast(world, seller, D2, '의류')
    const both = await readSheet((await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${D}&to=${D2}`)).bytes)
    expect(both).toEqual([
      ['방송 날짜', '회차', '상품 번호', '품종', '옵션', '수량', '단가', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송'],
      [D, '1부', 7, '핑크프릴', '', 1, 8000, 8000, '홍길동', '유튜브', `${D} 20:00:05`, '1등', '미입금', '포장 대기'],
    ])
    const plain = await readSheet((await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${D}&to=${D}`)).bytes)
    expect(plain).toEqual([
      ['방송 날짜', '회차', '상품 번호', '품종', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송'],
      [D, '1부', 7, '핑크프릴', 8000, '홍길동', '유튜브', `${D} 20:00:05`, '1등', '미입금', '포장 대기'],
    ])
  })
})

describe('AC-O3-23 백업 — 변형 키·수량을 적은 포장 기록도 백업·복원된다', () => {
  // O3 합치기 때는 O1 막음(RA-O1-01)으로 옵션 방송이 든 파일의 복원이 거절돼 "거절" 기대로 바꿔 두었다. O2에서 막음을 풀어 왕복으로 되돌림
  // (백업 파일의 포장 기록 품목 확인은 그대로 두고, 빈 판매자로 복원 → 같은 포장 상태·변형 키·수량).
  it('옵션 묶음 포장 완료 → 백업(파일의 포장 기록 품목에 변형 키·수량) → 빈 판매자로 복원 → 같은 포장 상태(포장 완료), 기록 품목에 변형 키·수량', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellO3(world, seller)
    const a = (await entries(world, seller)).get('UC_A') as Entry
    await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => ({ key: item.key, qty: item.qty })) }))
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const expected = [
      ['7', 1],
      ['11', 3],
      ['21#M', 1],
      ['21#L', 1],
      ['22#105/검정색', 2],
    ]
    const file = JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
    const packed = file.packing.filter((record) => record.buyer === 'UC_A' && record.kind === 'PACKED')
    expect(packed).toHaveLength(1)
    const items = parsePackedItems(JSON.stringify(packed[0]?.items))
    expect(items?.map((item) => [item.key.replace(/^[^/]+\//, ''), item.qty])).toEqual(expected)
    // 다른 서버(다른 DB)의 빈 판매자로 — 방송 ID는 서버 전체에서 유일해 같은 서버로는 가져오지 않는다
    const other = await newWorld({ clock: fakeClock(world.clock.now()) })
    const target = await addSeller(other)
    const restored = await restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    other.server.writer.forgetSeller(target.sellerId)
    const after = (await entries(other, target)).get('UC_A') as Entry
    expect(after.status).toBe('포장 완료')
    expect(after.items.map((item) => [item.key.replace(/^[^/]+\//, ''), item.qty])).toEqual(expected)
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
    await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => ({ key: item.key, qty: item.qty })) }))
    const after = await readSheet((await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${D}&to=${D}`)).bytes)
    expect(after.slice(1).filter((row) => row[8] === '홍길동').map((row) => row[13])).toEqual(['포장 완료', '포장 완료', '포장 완료', '포장 완료', '포장 완료'])

    // 포장 라벨 그림 (쪽 2장 — 다육 1부, 의류 2부)
    const label = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=2`)
    expect(label.status).toBe(200)
    const labelPdf = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.pdf?buyer=UC_A`)
    expect(labelPdf.status).toBe(200)
  })
})

describe('RA-O3-001 옵션 상품의 1등 — 봉인 장부의 확정 시각·방송 후 요약 줄', () => {
  it('봉인 장부(D-012): 옵션 상품 찜도 확정 시각이 남는다 — 모든 확정 판매의 confirmedAt이 그 찜이 1등이 된 이벤트 시각', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b2 } = await sellO3(world, seller)
    const scope = await scopeRow(world.database.db, seller.sellerId, D)
    expect(scope).not.toBeNull()
    const { state, times } = confirmTimes(await eventsAfter(world.database.db, seller.sellerId, scope?.id ?? '', 0))
    const ledger = buildLedger(D, state, times, Date.parse('2026-11-25T00:00:00Z'))
    const kst = (time: string): string => new Date(Date.parse(`${D}T${time}+09:00`)).toISOString()
    const sales = ledger.sales.map((sale) => ({ no: sale.no, buyerName: sale.buyerName, confirmedAt: sale.confirmedAt }))
    expect(sales).toHaveLength(7)
    for (const sale of sales) expect(sale.confirmedAt, JSON.stringify(sale)).not.toBeNull()
    const byKey = new Map(ledger.sales.map((sale) => [String(listClaims(state).find((claim) => claim.id === sale.id)?.key), sale.confirmedAt]))
    expect(byKey.get(`${b2}/21#M`)).toBe(kst('21:00:05'))
    expect(byKey.get(`${b2}/21#L`)).toBe(kst('21:00:06'))
    expect(byKey.get(`${b2}/22#105/검정색`)).toBe(kst('21:00:07'))
    expect(byKey.get(`${b2}/22#100/흰색`)).toBe(kst('21:00:10'))
  })

  it('방송 후 요약 줄(AC-Y1-46): 옵션 상품 판매도 들어가고, 가격은 찜 금액. 옵션 글·수량(D-O3-13), 같은 번호는 확정 순. 다육 방송 줄은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2 } = await sellO3(world, seller)
    const { state } = await world.server.writer.read(seller.sellerId, D)
    expect(summaryLines(state, b1)).toEqual([{ no: 7, name: '핑크프릴', price: '8,000원', buyer: '홍길동' }])
    expect(summaryLines(state, b2)).toEqual([
      { no: 11, name: '초코 과자', qty: 3, price: '6,000원', buyer: '홍길동' },
      { no: 11, name: '초코 과자', price: '2,000원', buyer: '김철수' },
      { no: 21, name: '반바지', variant: 'M', price: '10,000원', buyer: '홍길동' },
      { no: 21, name: '반바지', variant: 'L', price: '10,000원', buyer: '홍길동' },
      // 같은 번호는 확정 순(상품마다의 확정버전, D-O3-13): 문자찜의 받은 시각(21:00)이 홍길동 채팅보다 이르지만 확정은 뒤다
      { no: 22, name: '반팔티', variant: '105/검정색', qty: 2, price: '34,000원', buyer: '홍길동' },
      { no: 22, name: '반팔티', variant: '100/흰색', price: '15,000원', buyer: '문자찜' },
    ])
  })
})

describe('AC-O3-26 봉인 장부 판 2 — 옵션 글·수량·찜 금액 (D-O3-12)', () => {
  it('장부 format = livejjim-ledger/2, 판매 행의 key·variant·options·qty·amount = 코어 ClaimInfo, 상품 행의 variants. 봉인 조회에도 같은 칸', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2, sms } = await sellO3(world, seller)
    const scope = await scopeRow(world.database.db, seller.sellerId, D)
    const { state, times } = confirmTimes(await eventsAfter(world.database.db, seller.sellerId, scope?.id ?? '', 0))
    const ledger = buildLedger(D, state, times, Date.parse('2026-11-25T00:00:00Z'))
    expect(ledger.format).toBe('livejjim-ledger/2')
    expect(LEDGER_FORMAT).toBe('livejjim-ledger/2')
    const claims = new Map(listClaims(state).map((claim) => [claim.id, claim]))
    for (const sale of ledger.sales) {
      const claim = claims.get(String(sale.id)) as ClaimInfo
      expect({ key: sale.key, variant: sale.variant, options: sale.options, qty: sale.qty, amount: sale.amount, price: sale.price }).toEqual({
        key: claim.key,
        variant: claim.variant,
        options: claim.options,
        qty: claim.qty,
        amount: claim.amount,
        price: claim.price,
      })
    }
    const pick = (sale: Record<string, unknown>) => ({ key: sale.key, variant: sale.variant, options: sale.options, qty: sale.qty, amount: sale.amount, price: sale.price })
    const hong = ledger.sales.filter((sale) => sale.buyer === 'UC_A')
    expect(pick(hong.find((sale) => sale.no === 22) as Record<string, unknown>)).toEqual({
      key: `${b2}/22#105/검정색`,
      variant: '105/검정색',
      options: [
        ['사이즈', '105'],
        ['색상', '검정색'],
      ],
      qty: 2,
      amount: 34000,
      price: 17000,
    })
    expect(pick(hong.find((sale) => sale.no === 11) as Record<string, unknown>)).toEqual({ key: `${b2}/11`, variant: null, options: null, qty: 3, amount: 6000, price: 2000 })
    expect(pick(hong.find((sale) => sale.no === 7) as Record<string, unknown>)).toEqual({ key: `${b1}/7`, variant: null, options: null, qty: 1, amount: 8000, price: 8000 })
    expect(pick(ledger.sales.find((sale) => sale.buyer === sms) as Record<string, unknown>)).toMatchObject({ key: `${b2}/22#100/흰색`, variant: '100/흰색', qty: 1, amount: 15000 })
    // 상품 행의 variants (text·stock·winners), 다육은 빈 목록
    const product = (no: number, b: string) => ledger.products.find((row) => row.no === no && row.broadcast === b) as Record<string, unknown>
    const shorts = product(21, b2).variants as { text: string; stock: number; winners: string[] }[]
    expect(shorts.map((variant) => [variant.text, variant.stock, variant.winners])).toEqual([
      ['S', 1, []],
      ['M', 1, ['UC_A']],
      ['L', 1, ['UC_A']],
    ])
    expect(product(7, b1).variants).toEqual([])
    // 장부 글에 전화번호 키 없음 (표시 이름·뒤 4자리는 D-Y11 장부 그대로)
    expect(JSON.stringify(ledger)).not.toContain('kkkk')

    // 실제로 봉인 → 봉인 조회(GET /api/days/:date)의 찜·상품에 같은 칸
    expect(await world.server.sealer.seal(seller.sellerId, scope?.id ?? '', D)).toBe(true)
    const view = (await expectOk(client(world, seller.cookie).get(`/api/days/${D}`))).body as { sealed: boolean; claims: Record<string, unknown>[]; products: Record<string, unknown>[] }
    expect(view.sealed).toBe(true)
    const stored = (await world.database.pglite?.query<{ ledger: string }>(`select ledger from scopes where sealed_at is not null`))?.rows[0]?.ledger ?? ''
    expect(JSON.parse(stored).format).toBe('livejjim-ledger/2')
    expect(view.claims.map(pick)).toEqual(ledger.sales.map(pick))
    expect(view.claims.every((claim) => claim.status === 'CONFIRMED')).toBe(true)
    expect((view.products.find((row) => row.no === 22) as { variants: unknown }).variants).toEqual(product(22, b2).variants)
  })

  it('판 1 장부는 수량 1·찜 금액 = 가격·옵션 없음·variants 빈 목록으로 읽고, 판 2에 qty·amount가 없거나 모르는 판이면 읽을 수 없는 장부(채우지 않는다)', () => {
    const base = {
      date: D,
      sealedAt: '2026-11-25T00:00:00.000Z',
      broadcasts: [{ id: 'b1', date: D, title: '1부', endedAt: null }],
      products: [{ id: 'p1', key: 'b1/7', broadcast: 'b1', no: 7, name: '핑크프릴', price: 8000, stock: 1, status: 'SOLD', winners: ['UC_A'], priceHistory: [] }],
      buyers: [],
      settlements: [],
    }
    const v1Sale = { id: 'c1', product: 'b1/7', productId: 'p1', broadcast: 'b1', no: 7, buyer: 'UC_A', currentBuyer: 'UC_A', buyerName: '홍길동', price: 8000, confirmVersion: 1, confirmedAt: null, origin: 'chat' }
    const v1 = JSON.stringify({ format: 'livejjim-ledger/1', ...base, sales: [v1Sale] })
    const read = readLedger(v1)
    expect(read?.format).toBe('livejjim-ledger/2')
    expect(read?.sales).toEqual([{ ...v1Sale, key: 'b1/7', variant: null, options: null, qty: 1, amount: 8000 }])
    expect(read?.products.map((product) => product.variants)).toEqual([[]])
    const view = sealedView(D, 3, v1) as { claims: Record<string, unknown>[] }
    expect(view.claims).toEqual([{ ...v1Sale, key: 'b1/7', variant: null, options: null, qty: 1, amount: 8000, status: 'CONFIRMED' }])

    // 판 2인데 한 판매에 amount가 없다 → 읽을 수 없는 장부 (단가 × 수량으로 채우지 않는다)
    const v2Sale = { ...v1Sale, key: 'b1/7', variant: null, options: null, qty: 2, amount: 16000 }
    const v2Product = { ...base.products[0], variants: [] }
    const good = JSON.stringify({ format: 'livejjim-ledger/2', ...base, products: [v2Product], sales: [v2Sale] })
    expect(readLedger(good)?.sales).toEqual([v2Sale])
    const { amount: _amount, ...noAmount } = v2Sale
    const { qty: _qty, ...noQty } = v2Sale
    for (const sales of [[v2Sale, noAmount], [noQty], [{ ...v2Sale, amount: null }], [{ ...v2Sale, amount: 1.5 }], [{ ...v2Sale, qty: 0 }]]) {
      const text = JSON.stringify({ format: 'livejjim-ledger/2', ...base, products: [v2Product], sales })
      expect(readLedger(text), JSON.stringify(sales)).toBeNull()
      expect(sealedView(D, 3, text)).toBeNull()
    }
    // 모르는 판, JSON이 아닌 글
    for (const text of [JSON.stringify({ format: 'livejjim-ledger/9', ...base, sales: [v2Sale] }), JSON.stringify({ ...base, sales: [v1Sale] }), '{', 'null']) {
      expect(readLedger(text)).toBeNull()
      expect(sealedView(D, 3, text)).toBeNull()
    }
  })
})

describe('AC-O3-27 방송 후 요약 댓글 글 — 옵션 글·수량, 같은 번호는 확정 순 (D-O3-13)', () => {
  it('b2 = 감사 문구와 같은 자리, 22번은 확정 순. b1 다육 줄은 O3 전과 글자까지 같다. 문자찜 줄에 메모·뒤 4자리 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2 } = await sellO3(world, seller)
    const { state } = await world.server.writer.read(seller.sellerId, D)
    expect(summaryComments(summaryLines(state, b2))).toEqual([
      [
        '구매 감사합니다',
        '11번 초코 과자 3개 6,000원 홍길동님',
        '11번 초코 과자 2,000원 김철수님',
        '21번 반바지 M 10,000원 홍길동님',
        '21번 반바지 L 10,000원 홍길동님',
        '22번 반팔티 105/검정색 2개 34,000원 홍길동님',
        '22번 반팔티 100/흰색 15,000원 문자찜님',
      ].join('\n'),
    ])
    expect(summaryComments(summaryLines(state, b1))).toEqual(['구매 감사합니다\n7번 핑크프릴 8,000원 홍길동님'])
    const text = summaryComments(summaryLines(state, b2)).join('\n')
    for (const secret of ['이영희', '5678']) expect(text).not.toContain(secret)
    // 품종이 빈 옵션 상품은 옵션 글만 (`{번호}번[ {품종}][ {옵션 글}]…`)
    expect(summaryComments([{ no: 31, name: '', variant: 'M', qty: 2, price: '20,000원', buyer: '가' }])).toEqual(['구매 감사합니다\n31번 M 2개 20,000원 가님'])
  })
})

describe('AC-O3-28 포장 "뺄 것"에 포장 때의 옵션 글·수량 (D-O3-14)', () => {
  it('초코 과자 2개 포장 → 취소 → 3개로 다시 1등: add 11(qty 3), remove 11(variant null, qty 2). 다른 칸은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    at(world, D, '20:59:00')
    const b = await optionsBroadcast(world, seller, D, '의류')
    at(world, D, '21:00:00')
    await ok(world, seller, { type: 'product.register', b, no: 11, name: '초코 과자', price: 2000, stock: 5 })
    at(world, D, '21:00:01')
    await chat(world, seller, b, 'q1', 'UC_A', '홍길동', '초코 과자 2')
    let a = (await entries(world, seller)).get('UC_A') as Entry
    const id = a.items[0]?.id
    await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [{ key: `${b}/11`, qty: 2 }] }))
    at(world, D, '21:01:00')
    await ok(world, seller, { type: 'host.cancel', b, no: 11, buyer: 'UC_A', reason: '구매자 요청' })
    at(world, D, '21:01:10')
    await chat(world, seller, b, 'q2', 'UC_A', '홍길동', '초코 과자 3')
    a = (await entries(world, seller)).get('UC_A') as Entry
    expect(a.status).toBe('포장 다시 확인')
    expect(a.add.map((item) => [item.key, item.variant, item.qty])).toEqual([[`${b}/11`, null, 3]])
    expect(a.remove).toEqual([{ id, key: `${b}/11`, broadcast: b, title: '의류', no: 11, name: '초코 과자', variant: null, qty: 2 }])
  })

  it('반바지 M 포장 완료 뒤 그 찜 취소 → remove 21(variant "M", qty 1). 수량 칸 없는 이전 다육 기록에서 빠진 상품 → variant null·qty 1', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2 } = await sellO3(world, seller)
    const a = (await entries(world, seller)).get('UC_A') as Entry
    await expectPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: a.items.map((item) => ({ key: item.key, qty: item.qty })) }))
    at(world, D, '21:05:00')
    await raw(world, seller, { type: 'host.cancel', b: b2, no: 21, options: { 사이즈: 'M' }, buyer: 'UC_A', reason: '변심' })
    const after = (await entries(world, seller)).get('UC_A') as Entry
    expect(after.status).toBe('포장 다시 확인')
    expect(after.add).toEqual([])
    const shorts = a.items.find((item) => item.key === `${b2}/21#M`) as Item
    expect(after.remove).toEqual([{ id: shorts.id, key: `${b2}/21#M`, broadcast: b2, title: '의류 2부', no: 21, name: '반바지', variant: 'M', qty: 1 }])

    // 이전(I2) 모양 기록 — 수량 칸 없음. 다육 두 상품을 담고 하나가 빠졌다
    const world2 = await newWorld()
    const seller2 = await addSeller(world2)
    at(world2, D, '19:59:00')
    const b = (await createBroadcast(world2, seller2, { date: D, title: '다육' })).id
    for (const no of [7, 8]) {
      at(world2, D, `20:0${String(no)}:00`)
      await ok(world2, seller2, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no })
      await chat(world2, seller2, b, `c${String(no)}`, 'UC_A', '홍길동', String(no))
    }
    const before = (await entries(world2, seller2)).get('UC_A') as Entry
    await expectPack(pack(world2, seller2, D, { buyer: 'UC_A', action: 'pack', items: before.items.map((item) => item.key) }))
    const stored = await world2.database.pglite?.query<{ items: string }>(`select items from packing_records where kind = 'PACKED'`)
    // 다육 수량 1은 수량 칸 없이 적힌다 (I2 기록과 같은 모양)
    expect((JSON.parse(stored?.rows[0]?.items ?? '[]') as Record<string, unknown>[]).every((item) => !('qty' in item))).toBe(true)
    at(world2, D, '20:10:00')
    await ok(world2, seller2, { type: 'host.cancel', b, no: 8, buyer: 'UC_A', reason: '구매자 요청' })
    const legacy = (await entries(world2, seller2)).get('UC_A') as Entry
    const eight = before.items.find((item) => item.no === 8) as Item
    expect(legacy.remove).toEqual([{ id: eight.id, key: `${b}/8`, broadcast: b, title: '다육', no: 8, name: '품종8', variant: null, qty: 1 }])
    void b1
  })
})

describe('AC-O3-29 찜 금액이 없으면 단가 × 수량으로 채우지 않는다 (D-O3-15)', () => {
  it('amount를 null로 바꾼 확정 찜(옵션 수량 2·다육 수량 1): 요약 줄·상품 라벨 데이터·포장 품목·포장 라벨 항목을 만들지 않는다. 오류 로그엔 찜 ID만', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b1, b2 } = await sellO3(world, seller)
    const { state } = await world.server.writer.read(seller.sellerId, D)
    const claims = listClaims(state)
    const black = claims.find((claim) => claim.key === `${b2}/22#105/검정색`) as ClaimInfo
    const pink = claims.find((claim) => claim.key === `${b1}/7`) as ClaimInfo
    for (const target of [black, pink]) {
      const injected = claims.map((claim) => (claim.id === target.id ? { ...claim, amount: null } : claim))
      const b = target === black ? b2 : b1
      // 방송 후 요약: 그 방송은 만들지 않는다 (MissingAmountError — 실행기는 발송함 행 없이 넘긴다)
      expect(() => summaryLines(state, b, injected)).toThrow(MissingAmountError)
      try {
        summaryLines(state, b, injected)
      } catch (error) {
        expect((error as MissingAmountError).claimId).toBe(target.id)
      }
      // 금액이 있는 다른 방송은 그대로
      const other = b === b1 ? b2 : b1
      expect(summaryLines(state, other, injected)).toEqual(summaryLines(state, other))
      // 상품 라벨 데이터: 만들지 않고 찜 ID를 알린다
      const reported: string[] = []
      const index = buildClaimIndex(state)
      const injectedIndex = new Map([...index].map(([id, claim]) => [id, id === target.id ? { ...claim, amount: null } : claim]))
      expect(productLabelData(state, injectedIndex, { claim: target.id, version: target.confirmVersion ?? 0, buyer: { kind: 'youtube', name: '홍길동' } }, (id) => reported.push(id))).toBeNull()
      expect(reported).toEqual([target.id])
      expect(productLabelData(state, index, { claim: target.id, version: target.confirmVersion ?? 0, buyer: { kind: 'youtube', name: '홍길동' } })).not.toBeNull()
      // 포장 라벨 항목·포장 품목: 만들지 않는다(오류)
      expect(() => packingBroadcasts(state, 'UC_A', D, injected)).toThrow(MissingAmountError)
      expect(() => packingEntry(state, D, 'UC_A', [], lookupOf(state, injected))).toThrow(MissingAmountError)
      // 포장 상태 말(판매대장 배송 칸)은 금액을 보지 않아 그대로
      expect(packingStatusOf(state, D, 'UC_A', [], lookupOf(state, injected)).status).toBe('포장 대기')
    }
    // 오류 로그 한 줄: 찜 ID만 (닉네임·금액·전화번호 없음)
    const line = formatLog({ level: 'error', code: 'AMOUNT_MISSING', date: D, claim: black.id })
    expect(line).toContain(`claim=${black.id}`)
    for (const secret of ['홍길동', '34,000', '34000', '5678', '010']) expect(line).not.toContain(secret)
    // 찜 ID 모양이 아닌 값은 남기지 않는다
    expect(formatLog({ level: 'error', code: 'AMOUNT_MISSING', claim: '홍길동' })).not.toContain('홍길동')
  })
})

describe('SA-O3-006 내려받은 포장 라벨·공유 그림 = 같은 데이터의 패키지 그림', () => {
  it('포장 라벨 PNG 쪽마다 = renderPackingLabels(기본 포장 템플릿, G-LBL-O3-51 데이터) 바이트, 공유 PNG = 같은 확인서 데이터의 renderReceiptPng 바이트', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellO3(world, seller)
    const api = client(world, seller.cookie)
    const shop = ((await expectOk(api.get('/api/shop'))).body.shop as { name: string }).name
    const golden = goldenCase('label/packing-options.json', 'G-LBL-O3-51')
    const rendered = renderPackingLabels(createNodeRenderEnv(), { ...defaultTemplate('packing', '50x30'), shopName: shop }, golden.data as PackingLabelData)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return
    expect(rendered.pages).toHaveLength(2)
    for (const [i, page] of rendered.pages.entries()) {
      const want = encodeLabelPng(page.image)
      expect(want.ok).toBe(true)
      const file = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=${String(i + 1)}`)
      expect(file.status).toBe(200)
      if (want.ok) expect(Buffer.from(file.bytes).equals(Buffer.from(want.bytes)), `쪽 ${String(i + 1)}`).toBe(true)
    }
    const png = await getFile(world, seller.cookie, `/api/days/${D}/receipt.png?buyer=UC_A`)
    expect(png.status).toBe(200)
    expect(png.headers.get('x-receipt-created-at')).toBe(String(world.clock.now()))
    const receipt = (await expectOk(api.get(`/api/days/${D}/receipt?buyer=UC_A`))).body as unknown as ReceiptData
    expect(Buffer.from(renderReceiptPng(receipt, loadDocumentFont(fontBytes()))).equals(Buffer.from(png.bytes))).toBe(true)
  })
})
