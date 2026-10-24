// FB1 라벨 가게 이름 (AC-FB1-27, LABEL_RULES L-11 13, D-FB1-07): 템플릿의 가게 이름을 L-2로 다듬어 비면 설정 "가게"의 가게 이름을 채워 내준다 —
// 템플릿 조회·출력 기기가 받는 작업의 템플릿·서버가 그리는 포장 라벨 그림. 저장된 본문·판은 그대로, 다른 판매자의 이름은 오지 않는다.
import { computePackingText, computeProductText, defaultTemplate, type LabelTemplate, type PackingLabelData } from '@livejjim/label'
import { describe, expect, it } from 'vitest'
import { labelPng, renderPacking } from '../src/packing.ts'
import { fillShopName } from '../src/print.ts'
import { getFile } from './i2-support.ts'
import { DAY, DEVICE_A, becomeDevice, chat, printApi, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, type Seller, type TestServer } from './support.ts'

type Kind = 'product' | 'packing'
type Case = 'a' | 'b' | 'c' | 'd'
const STORED: Record<Exclude<Case, 'a'>, string> = { b: '', c: '   ', d: '다육상회' }

async function rename(world: TestServer, seller: Seller, name: string): Promise<void> {
  await expectOk(client(world, seller.cookie).put('/api/shop', { name }))
}

async function templates(world: TestServer, seller: Seller): Promise<Record<Kind, { template: LabelTemplate; version: number; storedShopName: string }>> {
  return (await expectOk(client(world, seller.cookie).get('/api/print/templates'))).body as unknown as Record<Kind, { template: LabelTemplate; version: number; storedShopName: string }>
}

/** 상품·포장 템플릿 둘 다 그 가게 이름으로 저장 (a는 저장하지 않음) */
async function saveBoth(world: TestServer, seller: Seller, which: Case): Promise<void> {
  if (which === 'a') return
  const p = printApi(world, seller)
  for (const kind of ['product', 'packing'] as const) {
    const saved = await expectOk(p.put(`/api/print/templates/${kind}`, { template: { ...defaultTemplate(kind), shopName: STORED[which] }, version: 0 }))
    expect(saved.body).toMatchObject({ version: 1, storedShopName: STORED[which], template: { shopName: which === 'd' ? '다육상회' : '초록다육' } })
  }
}

async function storedBodies(world: TestServer, seller: Seller): Promise<{ kind: string; shop: string; version: number }[]> {
  const rows = await world.database.pglite?.query<{ kind: string; body: string; version: number }>('select kind, body, version from label_templates where seller_id = $1 order by kind', [seller.sellerId])
  return (rows?.rows ?? []).map((row) => ({ kind: row.kind, shop: (JSON.parse(row.body) as { shopName: string }).shopName, version: row.version }))
}

/** 판매 하나(1등 확정 — 상품 라벨 작업 자동) + 출력 기기 */
async function sale(world: TestServer, seller: Seller): Promise<void> {
  const b = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, b.id, 15, '핑크프릴', 10000)
  await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
  await becomeDevice(world, seller)
}

async function packingPng(world: TestServer, seller: Seller): Promise<{ data: PackingLabelData; png: Uint8Array }> {
  const info = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/packing-label?buyer=UC_A`))
  const file = await getFile(world, seller.cookie, `/api/days/${DAY}/packing-label.png?buyer=UC_A&page=1`)
  expect(file.status).toBe(200)
  return { data: info.body.data as PackingLabelData, png: file.bytes }
}

const expectedPng = (data: PackingLabelData, shopName: string): Uint8Array => {
  const rendered = renderPacking(data, shopName)
  if (!rendered.ok) throw new Error(rendered.code)
  return labelPng(rendered.labels.pages[0] as never) as Uint8Array
}

describe('AC-FB1-27 비면 가게 이름 (D-FB1-07)', () => {
  it('fillShopName: L-2로 다듬어 빈 글일 때만 채우고, 그 밖엔 템플릿 그대로(같은 객체)', () => {
    const base = defaultTemplate('product')
    for (const blank of ['', ' ', '   ', '　', '\t\n']) expect(fillShopName({ ...base, shopName: blank }, '초록다육').shopName, JSON.stringify(blank)).toBe('초록다육')
    const named = { ...base, shopName: ' 다육상회 ' }
    expect(fillShopName(named, '초록다육')).toBe(named)
  })

  for (const which of ['a', 'b', 'c', 'd'] as const) {
    it(`(${which}) 템플릿 조회·출력 기기 작업·포장 라벨 PNG의 가게 이름 = ${which === 'd' ? '다육상회' : '초록다육'}, 저장된 본문·판은 그대로`, async () => {
      const world = await newWorld()
      const seller = await addSeller(world)
      await rename(world, seller, '초록다육')
      await saveBoth(world, seller, which)
      const before = await storedBodies(world, seller)
      const expected = which === 'd' ? '다육상회' : '초록다육'
      const read = await templates(world, seller)
      for (const kind of ['product', 'packing'] as const) {
        expect(read[kind].template.shopName).toBe(expected)
        expect(read[kind].storedShopName).toBe(which === 'a' ? '' : STORED[which])
        expect(read[kind].version).toBe(which === 'a' ? 0 : 1)
      }
      await sale(world, seller)
      const p = printApi(world, seller)
      // 상품 라벨 작업: 기기가 받은 템플릿으로 글을 계산하면 맨 위 가게 이름이 있다 (L-0 1 같은 렌더러)
      const product = await p.claim(DEVICE_A)
      expect(product.job?.kind).toBe('product')
      expect(product.job?.template.shopName).toBe(expected)
      const text = computeProductText(product.job?.template, product.job?.data)
      expect(text.ok && text.text.items.shop).toBe(expected)
      expect(await p.done(DEVICE_A, product.job?.attempt ?? '')).toBe(true)
      // 포장 라벨 작업
      await expectOk(p.packing(DAY, 'UC_A'))
      const packing = await p.claim(DEVICE_A)
      expect(packing.job?.kind).toBe('packing')
      expect(packing.job?.template.shopName).toBe(expected)
      const packed = computePackingText(packing.job?.template, packing.job?.data)
      expect(packed.ok && packed.text.common.shop).toBe(expected)
      // 서버가 그리는 포장 라벨 그림 = 그 이름으로 그린 것
      const { data, png } = await packingPng(world, seller)
      expect(png).toEqual(expectedPng(data, expected))
      if (which !== 'd') expect(png).not.toEqual(expectedPng(data, ''))
      // DB의 템플릿 본문·판은 그대로
      expect(await storedBodies(world, seller)).toEqual(before)
    })
  }

  it('설정 "가게"에서 이름을 바꾸면 비어 있는 템플릿의 다음 조회·작업·그림은 새 이름 — 적어 둔 이름은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await rename(world, seller, '초록다육')
    // 상품 템플릿은 빈 이름, 포장 템플릿은 다육상회
    const p = printApi(world, seller)
    await expectOk(p.put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '' }, version: 0 }))
    await expectOk(p.put('/api/print/templates/packing', { template: { ...defaultTemplate('packing'), shopName: '다육상회' }, version: 0 }))
    await sale(world, seller)
    await rename(world, seller, '새이름')
    const read = await templates(world, seller)
    expect(read.product.template.shopName).toBe('새이름')
    expect(read.packing.template.shopName).toBe('다육상회')
    const product = await p.claim(DEVICE_A)
    expect(product.job?.template.shopName).toBe('새이름')
    expect(await p.done(DEVICE_A, product.job?.attempt ?? '')).toBe(true)
    await expectOk(p.packing(DAY, 'UC_A'))
    expect((await p.claim(DEVICE_A)).job?.template.shopName).toBe('다육상회')
    const { data, png } = await packingPng(world, seller)
    expect(png).toEqual(expectedPng(data, '다육상회'))
    // 포장 템플릿 이름을 비우면 포장 그림도 새 이름
    await expectOk(p.put('/api/print/templates/packing', { template: { ...defaultTemplate('packing'), shopName: ' ' }, version: 1 }))
    const again = await packingPng(world, seller)
    expect(again.png).toEqual(expectedPng(again.data, '새이름'))
  })

  it('두 판매자: 템플릿 이름이 빈 B의 조회·작업·그림에는 B의 가게 이름만 — A의 가게 이름·템플릿 이름은 오지 않는다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    await rename(world, a, '에이농원')
    await rename(world, b, '비농원')
    await expectOk(printApi(world, a).put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '에이라벨' }, version: 0 }))
    await expectOk(printApi(world, b).put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '' }, version: 0 }))
    await sale(world, a)
    await sale(world, b)
    const readB = await expectOk(client(world, b.cookie).get('/api/print/templates'))
    for (const word of ['에이농원', '에이라벨']) expect(readB.text).not.toContain(word)
    expect((readB.body as { product: { template: LabelTemplate } }).product.template.shopName).toBe('비농원')
    const job = await printApi(world, b).claim(DEVICE_A)
    expect(job.job?.template.shopName).toBe('비농원')
    expect(JSON.stringify(job)).not.toContain('에이')
    const readA = await expectOk(client(world, a.cookie).get('/api/print/templates'))
    expect(readA.text).not.toContain('비농원')
    expect((readA.body as { product: { template: LabelTemplate } }).product.template.shopName).toBe('에이라벨')
  })
})
